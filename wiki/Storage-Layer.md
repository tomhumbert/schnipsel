# Storage Layer

Source file: `storage/store.js`

All browser storage calls in Schnipsel go through `store.js`. Nothing in the UI or search layer calls `browser.storage.*` or `indexedDB` directly. This is a deliberate constraint that makes the storage backend swappable — if the P2P layer eventually wants to write clips to IPFS or Hypercore, that change is confined to one file.

---

## Backends

### IndexedDB — `schnipsel` database (v2)

The database has two object stores:

| Store | Key | Contents |
|---|---|---|
| `clips` | `clip.id` (SHA-256 hex) | Own clips — `{ id, html, sourceUrl, pageTitle, elementTag, indexTokens, savedAt }` |
| `friendClips` | `"${ownerFp}:${clipId}"` | Sanitised friend-sourced clips — `{ key, owner, id, html, sourceUrl, pageTitle, indexTokens, savedAt }` |

`friendClips` has an index on `owner` (the friend's fingerprint) so all clips from a given friend can be fetched or deleted together in a single cursor walk.

The database version is 2. Version 1 had only `clips`. The v1→v2 upgrade creates `friendClips`. The upgrade handler is additive and never destroys existing data.

### `browser.storage.local`

All small, structured data lives in `storage.local` under predictable keys:

| Key | Type | Contents |
|---|---|---|
| `"bags"` | `{ [id]: bag }` | Bag metadata (name, clipIds, visibility, version) |
| `"profile"` | `{ name, avatar, updatedAt }` | Local user's display name + avatar |
| `"friends"` | `{ [fingerprint]: friend }` | Trusted friends (public keys + display info) |
| `"pendingInvites"` | `{ [token]: { token, exp, createdAt } }` | Invites we generated and are waiting for responses to |
| `"friendBags"` | `{ [ownerFp]: { [bagId]: bag } }` | Metadata for received shared bags |
| `"friendIndex"` | `{ [ownerFp]: tokenMap }` | Per-friend inverted search indices |
| `"searchIndex"` | `{ [token]: [clipId] }` | Own clip search index |
| `"identityPub"` | `{ fingerprint, signPubJwk, ecdhPubJwk, createdAt }` | Public key mirror (quick read without hitting key IDB) |
| `"theme"` | `{ mode, accent }` | Light/dark + accent colour, shared by sidebar and collage |
| `"collageData"` | `{ canvases: {…}, currentCanvasId }` | Collage canvas state |

---

## Public API

```js
// Own clips
store.saveClip(clipData)             → clipId (SHA-256 hex)
store.getClip(clipId)               → clipData | undefined
store.getAllClips()                  → [clipData]
store.deleteClip(clipId)            // removes from IDB + removes from all bags

// Bags
store.saveBag({ name, id? })        → bag
store.getBags()                     → [bag]
store.deleteBag(bagId)
store.addClipToBag(clipId, bagId)
store.removeClipFromBag(clipId, bagId)
store.setBagVisibility(bagId, "public" | "private")  → bag (bumps version)

// Profile
store.getProfile()                  → { name, avatar, updatedAt }
store.saveProfile({ name, avatar }) → profile

// Friends
store.getFriends()                  → [friend]
store.getFriend(fingerprint)        → friend | null
store.addFriend(party)              → friend  (validates + sanitises untrusted fields)
store.removeFriend(fingerprint)     // also calls removeFriendData

// Invites
store.addPendingInvite(token, exp)
store.consumePendingInvite(token)   → boolean (true = valid + consumed)

// Friend-sourced content
store.getFriendBags()               → { [ownerFp]: { [bagId]: bag } }
store.getFriendBagsList()           → [{ ...bag, ownerFp }]
store.getFriendClips(ownerFp)       → [clipData]
store.getFriendIndices()            → { [ownerFp]: tokenMap }
store.setFriendIndex(ownerFp, map)
store.saveSharedBagClips(ownerFp, bag, clips)  → savedBag (enforces quota)
store.removeFriendData(ownerFp)     // purges clips + bags + index for one friend

// Export / import
store.exportData(bagIds?)           → snapshot object
store.importData(snapshot)          → { clipCount, newBags, bagCount, restoredClips }
```

---

## Content-addressed clip IDs

Every clip ID is `SHA-256(clip.html + clip.sourceUrl)` in lowercase hex. This means:

- **Deduplication is free.** Clipping the same element from the same URL twice produces the same ID, and `idbPut` simply overwrites the existing record.
- **IDs are stable across imports.** A clip exported and re-imported always lands at the same ID. Bag membership is preserved by reference.
- **IDs are P2P-ready.** SHA-256 content addresses are natively compatible with IPFS, Hypercore, and other content-addressed storage systems. No ID migration is needed when the P2P layer is added.

Bag IDs are random UUIDs — bags are mutable, so content addressing doesn't make sense.

---

## Bag schema

```js
{
  id: string,          // random UUID
  name: string,        // user-chosen display name
  clipIds: [string],   // ordered list of clip IDs in this bag
  visibility: "private" | "public",  // private by default
  version: number,     // monotonic counter, starts at 1, bumped when shared state changes
}
```

`version` is a replay guard for the P2P sharing layer. When a friend receives a bag bundle, they reject it if its version number is ≤ the version they already have. See [Friends and Sharing](Friends-and-Sharing#replay-protection).

Old bags saved before `visibility` and `version` were added are lazily upgraded with defaults on `getBags()`.

---

## Profile and avatar validation

Display names are sanitised by `store.cleanDisplayName()`:
- Strip control characters (U+0000–U+001F, U+007F)
- Trim whitespace
- Cap at 48 characters

Avatars are validated by `store.validateAvatar()`:
- Must be a `data:image/(png|jpeg|webp);base64,…` URI
- SVG is rejected (SVG can carry script)
- Capped at ~64 KB of raw data (the UI re-encodes to 128×128 before calling this)
- Returns `""` for empty input; throws for anything present but invalid

Both functions are called on `addFriend()` to re-validate untrusted peer-supplied names and avatars before storing them.

---

## Export / import

### `store.exportData(bagIds?)`

Produces a self-contained snapshot:

```js
{
  schnipsel: true,
  kind: "schnipsel-export",
  version: 1,
  exportedAt: ISO8601 string,
  bags: { [id]: bag },
  clips: [clip],   // only clips referenced by the exported bags
}
```

The `clips` array contains the full HTML, `indexTokens`, `sourceUrl`, and `pageTitle` for each clip. This is intentional: the snapshot is a complete backup that can restore the search index without re-parsing the stored HTML.

### `store.importData(snapshot)`

Import is **idempotent and non-destructive**:

1. Each clip is stored via `idbPut` (upsert). A clip with the same ID as an existing one overwrites it with identical content.
2. Each bag is merged: if a bag with the same ID already exists, its `clipIds` become the union of old + imported. A new bag is created if the ID is unknown.
3. Returns `{ clipCount, newBags, bagCount, restoredClips }` — the caller (background.js) uses `restoredClips` to rebuild the search index entries.

**Note on `indexTokens`:** `store.saveClip` persists `indexTokens` in the IDB record. This is load-bearing for import — without persisted tokens, re-indexing a restored clip would only have access to `pageTitle` and `sourceUrl`, losing all image alt text, link labels, and other rich content.

---

## Per-friend quota

To prevent a hostile or spammy friend from filling the user's disk:

```js
store.MAX_FRIEND_CLIPS_PER_OWNER = 2000
```

`saveSharedBagClips` counts existing clips for the owner before writing and throws if the incoming new clips would exceed the cap. The bundle ingest pipeline also enforces its own cap at 1000 clips per bundle (`MAX_BUNDLE_CLIPS` in `transport.js`).

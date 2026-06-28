# Friends and Sharing

Source files: `p2p/invites.js`, `p2p/transport.js`

Schnipsel's peer-to-peer layer is built on two primitives: **mutual friendship** (so a leaked code can never silently add a stranger) and **signed, encrypted bag bundles** (so only the addressed friends can read a share).

The current *transport* for these bundles is a text code — paste it into any channel you like. The security layer is decoupled from the transport so that a WebRTC or relay backend can be swapped in later without touching the cryptographic pipeline.

---

## Friend handshake

Source: `p2p/invites.js`

### Why mutual?

A one-sided "follow" model (send a link, they get access) means that if your invite link leaks, a stranger silently gains access to your shared bags. The mutual model requires both parties to explicitly confirm before either trusts the other. A leaked invite is useless unless the recipient completes the handshake.

### Three-step flow

```
Alice                          Bob
  │                             │
  │   INVITE code               │
  ├────────────────────────────►│  (1) Alice generates, shares via any channel
  │                             │
  │                             │  Bob: review Alice's name + fingerprint
  │                             │  Bob: Accept
  │                             │
  │   RESPONSE code             │
  │◄────────────────────────────┤  (2) Bob sends back a response code
  │                             │
  │  Alice: review Bob's        │
  │  name + fingerprint         │
  │  Alice: Confirm             │
  │                             │  (3) Both now trust each other
```

### Invite code format

An invite code is a base64url-encoded, ECDSA-signed JSON object:

```js
{
  t: "schnipsel-invite",
  v: 1,
  token: string,       // random 32-byte token (base64url), one-time use
  exp: number,         // Unix ms timestamp (7 days from creation)
  from: {
    fingerprint: string,   // 64-char hex SHA-256 of the signing public key
    signPubJwk: JWK,       // ECDSA P-256 public key
    ecdhPubJwk: JWK,       // ECDH P-256 public key
    name: string,          // display name (cleaned)
    avatar: string,        // data: URI or ""
  },
  sig: string,         // ECDSA signature over stableStringify({t,v,token,exp,from})
}
```

The code is prefixed with `schnipsel-friend:` as a human-readable marker and stripped on parse.

### Security guarantees on the invite

When Bob receives Alice's invite code, `invites.acceptInvite()` verifies:

1. **Not too large** — codes over 512 KB are rejected before parsing.
2. **Well-formed** — correct `t`, `v`, and required fields.
3. **Fingerprint consistency** — `SHA-256(signPubJwk)` must equal the claimed fingerprint. This binds the name and avatar to the actual signing key; a man-in-the-middle cannot swap in different keys or claim a different fingerprint.
4. **Valid signature** — the signature over the payload (minus `sig`) verifies against the embedded signing key.
5. **Not expired** — `exp` has not passed.
6. **Not self** — you can't add yourself.

### Response code

After accepting, Bob generates a response code (same structure but `t: "schnipsel-response"`, carrying Bob's own identity) and sends it to Alice.

### Confirm step

When Alice receives Bob's response code, `invites.confirmResponse()` verifies:

1. All the same checks as for an invite (signature, fingerprint, size, shape).
2. **Token matches a pending invite** — the response carries the same one-time token Alice's invite contained. Alice's invite store is checked: the token must exist and not be expired. It is **consumed** on use, so the same response code cannot be replayed.

This token binding ties the response to *Alice's specific invite* — Bob cannot use a response code from a previous session or a different Alice.

---

## Bag bundles

Source: `p2p/transport.js`

### Bundle structure

```js
{
  t: "schnipsel-bundle",
  v: 1,
  sender: { fingerprint, signPubJwk, ecdhPubJwk },
  recipients: [
    { fingerprint, iv, wrappedKey },  // one per addressed friend
  ],
  iv: string,          // AES-GCM IV for the ciphertext (base64)
  ciphertext: string,  // encrypted payload (base64)
  sentAt: number,      // Unix ms timestamp
  sig: string,         // ECDSA signature over all fields except sig
}
```

### Encryption scheme

1. Generate a random **content key** (AES-GCM 256-bit).
2. Encrypt the JSON payload once with the content key → `{ iv, ciphertext }`.
3. For each recipient, derive a **wrapping key** via ECDH (sender's ECDH private + recipient's ECDH public) → HKDF → AES-GCM 256, then encrypt the raw content key bytes with it.
4. Sign the complete envelope (minus `sig`) with the sender's ECDSA key.

This is a "hybrid encryption" scheme:
- **One ciphertext** regardless of the number of recipients (efficient).
- **Per-recipient wrapped key** — only the addressed recipient can unwrap the content key.
- **ECDSA signature** — authenticity and integrity of the entire bundle.

### Payload (decrypted)

```js
{
  bag: { id, name, version, visibility: "public" },
  clips: [
    { id, html, sourceUrl, pageTitle, indexTokens }
  ],
  sentAt: number,
}
```

Only clips referenced by the bag are included. Clips carry their `indexTokens` so the recipient can build a searchable index without re-fetching the original pages.

---

## 8-step ingest pipeline

`transport.ingestBundle(code)` runs these checks in order. Any failure throws an error and nothing is stored.

| Step | What is checked |
|---|---|
| 1. Size + schema | Code not over 12 MB; correct `t`, `v`; required fields present |
| 2. Known friend | Sender fingerprint is in our friends list; sender's keys match what we stored |
| 3. Fingerprint + signature | `SHA-256(signPubJwk)` = claimed fingerprint; ECDSA signature verifies |
| 4. Addressed to us | Our fingerprint is in `recipients`; content key decrypts successfully |
| 5. Replay protection | `bag.version` must be strictly greater than any previously stored version for this bag+sender |
| 6. Per-clip integrity | `SHA-256(clip.html + clip.sourceUrl)` = `clip.id` for every clip |
| 7. DOMPurify + remote-ref strip | `sanitize.clip(html, { allowRemote: false })` on every clip |
| 8. Store + reindex | `store.saveSharedBagClips()` (quota enforced); rebuild namespaced friend index |

### Replay protection

Each bag has a monotonic `version` counter that starts at 1 and is bumped whenever the bag's shareable state changes (e.g., visibility is flipped, new clips are added). The ingest pipeline rejects any bundle whose `bag.version` is ≤ the version already stored for that `sender + bag.id`. This prevents replaying a stale bundle to downgrade a friend's view of your bag.

---

## Removing a friend

`store.removeFriend(fingerprint)` deletes the friend record and calls `store.removeFriendData(fingerprint)`, which:

- Deletes all friend clips from `friendClips` IDB store (cursor-walk by `owner` index)
- Removes the friend's bag metadata from `storage.local["friendBags"]`
- Removes the friend's search index from `storage.local["friendIndex"]`

After removal, the friend's content is completely gone from storage.

---

## Planned: live transport

The current transport is copy-paste text codes. The planned WebRTC/relay backend will use the same bundle format and the same 8-step ingest pipeline. The only change will be how the bundle travels — not how it is built or verified.

See [Roadmap](Roadmap).

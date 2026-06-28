# Architecture

## Overview

Schnipsel is a Firefox WebExtension built on Manifest V2 (MV2). It has no framework, no bundler, and no transpilation step. Every file is plain HTML, CSS, and JavaScript that runs directly in the browser.

The extension is composed of four execution contexts that communicate via message passing:

```
┌─────────────────────────────────────────────────────────────────┐
│  Background page  (background/background.js + its dependencies) │
│  · Central message router                                        │
│  · Owns all storage (store.js) and crypto (identity.js)         │
│  · Single source of truth; never directly touched by UI pages   │
└──────────┬──────────────────────────┬───────────────────────────┘
           │ browser.runtime.sendMessage  │
           │                              │
           ▼                              ▼
┌──────────────────────┐     ┌────────────────────────────────────┐
│  Content script      │     │  Extension pages                   │
│  (schnipsel.js)      │     │  · sidebar/sidebar.html + .js      │
│  · Runs inside every │     │  · collage/collage.html + .js      │
│    web page          │     │  · Trusted senders (moz-ext://)    │
│  · Element picker    │     │  · Full access to background msgs  │
│  · Sends CLIP_CREATED│     └────────────────────────────────────┘
└──────────────────────┘
```

### Why MV2?

Firefox's MV3 support is still maturing. MV2 allows the background page to be persistent (non-service-worker), which makes it straightforward to keep the cryptographic identity loaded in memory across messages. This will be revisited when MV3 is fully stable in Firefox.

---

## File map

```
schnipsel/
├── manifest.json
│
├── background/
│   └── background.js        Message router; toolbar button → sidebar toggle;
│                            identity.ensure() on startup
│
├── content_scripts/
│   └── schnipsel.js         Element picker, hover highlight, range selection,
│                            style inliner, token extractor. Injected into all pages.
│
├── storage/
│   └── store.js             Storage abstraction. All browser storage calls go here.
│                            · Clips    → IndexedDB ("schnipsel" db, v2)
│                            · Friend clips → IndexedDB ("friendClips" store)
│                            · Bags, profile, friends, invites → storage.local
│                            · Export / import helpers
│
├── search/
│   └── index.js             Inverted token index in storage.local.
│                            · addClip / removeClip / search
│                            · federatedSearch (local + per-friend namespaced indices)
│                            · buildMap (for friend index construction)
│
├── crypto/
│   └── identity.js          Long-term ECDSA + ECDH keypairs.
│                            · Private keys stored non-extractable in "schnipsel-keys" IDB
│                            · sign / verify / deriveAesKey / encryptFor / decryptFrom
│
├── p2p/
│   ├── invites.js           Mutual friend handshake protocol.
│                            · createInvite → acceptInvite → confirmResponse
│   └── transport.js         Signed+encrypted bag bundle builder + 8-step ingest pipeline.
│
├── security/
│   └── sanitize.js          DOMPurify wrapper + remote-ref stripper + srcdoc CSP builder.
│                            · sanitize.clip(html, opts)   → safe HTML string
│                            · sanitize.srcdoc(html, opts) → full iframe srcdoc document
│
├── vendor/
│   └── dompurify.js         DOMPurify 3.2.4, pinned, audited (see vendor/README.md)
│
├── sidebar/
│   ├── sidebar.html
│   ├── sidebar.css          Glass morphism + CRT theme; light/dark; 3 accent profiles
│   └── sidebar.js           Bags view, clips view, search, preview, profile, friends UI
│
├── collage/
│   ├── collage.html
│   ├── collage.css
│   └── collage.js           Full-page workspace: Search tab + Collage tab (canvas)
│
└── icons/
    ├── schnipsel-32.png
    └── schnipsel-48.png
```

---

## Message passing

All data operations go through the background script via `browser.runtime.sendMessage`. The sidebar and collage page are the clients; the background page is the server.

### Trusted sender gate

The background enforces a strict sender check before handling any sensitive message:

```js
function isTrustedSender(sender) {
  return !!(
    sender &&
    sender.id === browser.runtime.id &&
    typeof sender.url === "string" &&
    sender.url.startsWith(browser.runtime.getURL(""))
  );
}
```

Only extension pages (`moz-extension://<id>/…`) pass this check. Content scripts run inside arbitrary web pages, so their `sender.url` is an `https://` URL and they fail the check. The only message type a content script may send is `CLIP_CREATED`.

### Message catalogue

| Message type | Sender | What it does |
|---|---|---|
| `CLIP_CREATED` | content script | Forwards an unsaved clip to the sidebar for preview |
| `SAVE_CLIP` | sidebar | Persists a clip + indexes it |
| `GET_CLIPS` | sidebar | Returns all own clips |
| `GET_BAGS` | sidebar/collage | Returns all bags |
| `SAVE_BAG` | sidebar | Creates or updates a bag |
| `DELETE_CLIP` | sidebar | Removes clip from IDB + index |
| `DELETE_BAG` | sidebar | Removes bag |
| `BAG_SET_VISIBILITY` | sidebar | Flips bag public/private + bumps version |
| `ADD_TO_BAG` / `REMOVE_FROM_BAG` | sidebar | Manages bag membership |
| `SEARCH` | sidebar/collage | Federated search (local + friends) |
| `GET_PEERS` | collage | Peer list for the scope picker |
| `EXPORT_DATA` / `IMPORT_DATA` | sidebar | Snapshot / restore all bags and clips |
| `GET_IDENTITY` | sidebar | Public keys + fingerprint + profile |
| `GET_PROFILE` / `SAVE_PROFILE` | sidebar | Display name + avatar |
| `GET_FRIENDS` | sidebar | Friends list |
| `CREATE_INVITE` | sidebar | Generates invite code + stores pending token |
| `INSPECT_CODE` | sidebar | Validates a pasted code without committing |
| `ACCEPT_INVITE` | sidebar | Trusts the inviter + produces a response code |
| `CONFIRM_RESPONSE` | sidebar | Validates the response + trusts the responder |
| `REMOVE_FRIEND` | sidebar | Deletes friend + their shared content |
| `SHARE_BAG` | sidebar | Builds an encrypted bundle for chosen friends |
| `RECEIVE_BUNDLE` | sidebar | Runs the full ingest pipeline on a received code |
| `GET_FRIEND_BAGS` | sidebar | Lists all received friend bags |
| `ACTIVATE_PICKER` | sidebar | Tells the active tab's content script to start the picker |

---

## Script loading order (background page)

The manifest specifies scripts in a specific order so that each one's dependencies exist before it runs. No module system is used; all globals (store, index, identity, invites, transport, sanitize) are assigned to `window` by their respective files.

```json
"background": {
  "scripts": [
    "vendor/dompurify.js",
    "security/sanitize.js",
    "crypto/identity.js",
    "storage/store.js",
    "search/index.js",
    "p2p/invites.js",
    "p2p/transport.js",
    "background/background.js"
  ]
}
```

The same files (except `background.js` itself) are also loaded via `<script>` tags in the sidebar and collage HTML pages, in the same order, so those pages can call the same APIs without going through the background page for everything.

---

## Storage topology

| Data | Backend | Key scheme |
|---|---|---|
| Own clips (HTML blobs) | IndexedDB `schnipsel`, store `clips` | clip ID (SHA-256 hex) |
| Friend clips (sanitized HTML) | IndexedDB `schnipsel`, store `friendClips` | `"${ownerFp}:${clipId}"` |
| Bags (metadata) | `storage.local["bags"]` | object keyed by bag UUID |
| Profile | `storage.local["profile"]` | single object |
| Friends | `storage.local["friends"]` | object keyed by fingerprint |
| Pending invites | `storage.local["pendingInvites"]` | object keyed by token |
| Friend bags (metadata) | `storage.local["friendBags"]` | `{ [ownerFp]: { [bagId]: bag } }` |
| Friend search index | `storage.local["friendIndex"]` | `{ [ownerFp]: tokenMap }` |
| Own search index | `storage.local["searchIndex"]` | token → `[clipId]` map |
| Cryptographic keys | IndexedDB `schnipsel-keys` | `"signing"` and `"ecdh"` |
| Public key cache | `storage.local["identityPub"]` | single object |
| Theme | `storage.local["theme"]` | single string |
| Collage state | `storage.local["collageData"]` | single object |

---

## Design constraints that shape the code

1. **No build step** — any contributor can clone and load without installing a build chain.
2. **No framework** — plain DOM APIs everywhere. No React, Vue, Svelte, or templating library.
3. **Single storage abstraction** — nothing outside `store.js` calls browser storage APIs directly. This makes the storage backend swappable for a future P2P implementation.
4. **Content-addressed clip IDs** — clip ID = `SHA-256(html + sourceUrl)`. Identical clips are deduplicated automatically; the ID scheme is compatible with IPFS, Hypercore, and other content-addressed backends.
5. **P2P readiness** — the sharing transport is deliberately pluggable. Today it uses text codes; WebRTC or a relay server can be swapped in without changing the security layer.

See [Design Philosophy](Design-Philosophy) for the reasoning behind each of these.

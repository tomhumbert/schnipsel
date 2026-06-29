# ✂ Schnipsel

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://github.com/tomhumbert/schnipsel/blob/main/LICENSE)
[![Firefox 109+](https://img.shields.io/badge/Firefox-109%2B-orange.svg)](https://www.mozilla.org/firefox/)
[![Manifest V2](https://img.shields.io/badge/WebExtension-MV2-lightgrey.svg)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
[![No build step](https://img.shields.io/badge/build-none-brightgreen.svg)]()

**Collect pieces of the web. Arrange them into collages. Search them. Share them.**

Schnipsel is a Firefox browser extension that lets you clip fragments of any web page — preserving their exact HTML structure and computed styles — and organise them into named *bags*. Bags can be assembled into spatial collage canvases, searched through a rich local index, and shared with friends as signed, encrypted codes over any channel you like.

The long-term ambition is a **community-curated, peer-to-peer search engine** built from collectively clipped content — distributed, signed, and searchable without a central server.

> *Schnipsel* is German for *snippet* or *clipping* — a small piece cut from something larger.

---

## What it does today

| Feature | Description |
|---------|-------------|
| **Element picker** | Hover any page element to highlight it; click to clip. Full computed styles are preserved so the clip renders correctly anywhere. |
| **Sibling-range selection** | Shift+click to select a contiguous run of sibling elements — like cutting a strip from a newspaper while keeping the column framing. |
| **Bags** | Named collections that live in the sidebar. Private by default; flip to public to share with friends. |
| **Sidebar** | A persistent Firefox sidebar panel with light/dark mode and three accent colour profiles (red, purple, pink). |
| **Search** | A local full-text index covering plain text, image alt text, captions, aria-labels, video/audio metadata, and URL tokens. Supports prefix matching. |
| **Collage workspace** | A full-page canvas where you drag, resize, and rotate clip cards into a composition. Multiple named canvases. Export as standalone HTML. |
| **OpenSearch** | Register Schnipsel as a Firefox search engine and run queries from the address bar. |
| **Cryptographic identity** | Each installation has ECDSA/ECDH keypairs. Your fingerprint is your real, unforgeable identifier. |
| **Friends (mutual)** | Add a friend by exchanging short invite/response codes. Both sides must confirm — a leaked invite can't silently add a stranger. |
| **Encrypted sharing** | Share a public bag as a signed, encrypted text code addressed to specific friends. No server required. |
| **Federated search** | Search spans your clips and your friends' public bags. Results carry a verified "from \<friend\>" badge. |

---

## How it works

```
 Web page                Extension                        Storage
 ─────────              ──────────────────────────────   ───────────────────
 Any element   ──clip──► content script                  IndexedDB
  (HTML+CSS)             · inlines computed styles        · clips (by SHA-256)
                         · extracts tokens                · friend clips
                         · resolves URLs          ──────► storage.local
                               │                          · bags
                               ▼                          · search index
                         background page                  · profile & friends
                         · stores clip                    · collage state
                         · indexes tokens
                         · manages identity              schnipsel-keys IDB
                               │                          · ECDSA private key
                               ▼                          · ECDH private key
                         sidebar / workspace
                         · search results
                         · bag management
                         · collage canvas
                         · friend sharing UI
```

When you share a bag with a friend, the background page:
1. Encrypts the bag contents with a random AES-GCM content key
2. Wraps that key individually for each recipient using ECDH key agreement
3. Signs the whole envelope with your ECDSA key
4. Gives you a text code to send over any channel

When your friend receives the code, an 8-step pipeline verifies the sender, checks the signature, decrypts the payload, recomputes every clip's SHA-256 hash, sanitises the HTML through DOMPurify, and only then stores the clips — namespaced, under a quota.

---

## Key concepts

**Clip** — a self-contained snapshot of a web page element. HTML is cloned with all computed styles inlined, relative URLs rewritten to absolute, and fonts embedded as data URIs. Identified by `SHA-256(html + sourceUrl)`.

**Bag** — a named, ordered collection of clips. Either private (local only) or public (shareable with friends). Has a monotonic version number used as a replay guard.

**Fingerprint** — `SHA-256` of your ECDSA public key, displayed as a 64-character hex string. Your real identity in the P2P system — independent of your display name.

**Bundle** — a signed, encrypted bag shared with one or more friends. One ciphertext, one wrapped content key per recipient. Travels as a base64url text code.

**Federated search** — a query that spans your own clips and your friends' public-bag indices in a single call, with results round-robin interleaved by source and labelled by provenance.

---

## Technology

| Layer | Technology |
|-------|-----------|
| Extension platform | Firefox WebExtension, Manifest V2 |
| Language | Plain JavaScript (ES2020), HTML, CSS — no TypeScript, no transpilation |
| Build tooling | None. Load directly from source. |
| Framework | None. Plain DOM APIs. |
| Storage | IndexedDB (clip HTML blobs) + `browser.storage.local` (all metadata) |
| Cryptography | Web Crypto API — ECDSA P-256 (signing), ECDH P-256 + HKDF + AES-GCM (encryption) |
| Search | Hand-written inverted token index, stored as JSON in `storage.local` |
| HTML sanitisation | [DOMPurify 3.2.4](https://github.com/cure53/DOMPurify) — vendored, pinned, audited |
| Development tool | [web-ext](https://github.com/mozilla/web-ext) (optional) |

---

## Project structure

```
schnipsel/
├── manifest.json                 MV2 manifest — permissions, scripts, sidebar definition
├── background/background.js      Central message router; toolbar toggle; identity init
├── content_scripts/schnipsel.js  Element picker, style inliner, token extractor
├── storage/store.js              Single abstraction over all browser storage
├── search/index.js               Inverted token index + federated peer search
├── crypto/identity.js            ECDSA/ECDH keypairs, sign/verify/encrypt/decrypt
├── p2p/invites.js                Mutual friend handshake (invite → accept → confirm)
├── p2p/transport.js              Signed+encrypted bag bundles + 8-step ingest pipeline
├── security/sanitize.js          DOMPurify wrapper + remote-ref stripping + srcdoc CSP
├── vendor/dompurify.js           Pinned, audited HTML sanitiser
├── sidebar/                      Persistent sidebar panel (HTML + CSS + JS)
└── collage/                      Full-tab search + collage workspace (HTML + CSS + JS)
```

All inter-component communication goes through `browser.runtime.sendMessage` to the background page. Nothing in the UI or search layers calls browser storage APIs directly — everything goes through `store.js`.

---

## Roadmap snapshot

| Milestone | Status |
|-----------|--------|
| Element picker + style serialisation | ✅ Done |
| Bag management + search index | ✅ Done |
| Sidebar, collage workspace, export | ✅ Done |
| Cryptographic identity + profiles | ✅ Done |
| Friends (mutual handshake) | ✅ Done |
| Signed + encrypted bag sharing | ✅ Done |
| Federated peer search | ✅ Done |
| Live P2P transport (serverless WebRTC) | 🔲 Planned |
| Decentralised / P2P index | 🔲 Planned |
| Collage canvas: text boxes + pen tool | 🔲 Planned |
| Storage usage display (total + per bag, incl. friends) | 🔲 Planned |

Full details: [Roadmap](Roadmap)

---

## Wiki contents

| Page | What it covers |
|------|----------------|
| [Getting Started](Getting-Started) | Installation, dev setup, persistent install, `web-ext` |
| [Architecture](Architecture) | Execution contexts, message catalogue, storage topology, design constraints |
| [Element Picker and Clipping](Element-Picker-and-Clipping) | Picker interaction, range selection model, serialisation pipeline, token extraction |
| [Storage Layer](Storage-Layer) | `store.js` API, IDB schema, content-addressed IDs, export/import, quotas |
| [Search Index](Search-Index) | Tokenisation, prefix matching, AND semantics, federated search, prototype-pollution hardening |
| [Collage and Workspace](Collage-and-Workspace) | Canvas model, drag/resize/rotate, collage export, OpenSearch integration |
| [Security Model](Security-Model) | Threat model, defence-in-depth layers, summary threat table |
| [Cryptographic Identity](Cryptographic-Identity) | Keypairs, non-extractable keys, fingerprint derivation, signing, ECDH derivation |
| [Friends and Sharing](Friends-and-Sharing) | Handshake protocol, bundle encryption, 8-step ingest pipeline, replay protection |
| [Design Philosophy](Design-Philosophy) | No-bundler rationale, content-addressed IDs, visual design, P2P vision |
| [Contributing](Contributing) | Dev workflow, coding conventions, security-sensitive areas, PR guide |
| [Roadmap](Roadmap) | All feature milestones and what's planned |

---

## Start here

| I want to… | Go to |
|------------|-------|
| Install and try the extension | [Getting Started](Getting-Started) |
| Understand how a clip is captured and stored | [Element Picker and Clipping](Element-Picker-and-Clipping) → [Storage Layer](Storage-Layer) |
| Understand the search implementation | [Search Index](Search-Index) |
| Understand the security guarantees | [Security Model](Security-Model) |
| Work on the P2P sharing layer | [Friends and Sharing](Friends-and-Sharing) + [Cryptographic Identity](Cryptographic-Identity) |
| Add a new feature or fix a bug | [Architecture](Architecture) → [Contributing](Contributing) |
| Understand the design decisions | [Design Philosophy](Design-Philosophy) |

---

## Links

- **Repository:** [github.com/tomhumbert/schnipsel](https://github.com/tomhumbert/schnipsel)
- **Issues:** [github.com/tomhumbert/schnipsel/issues](https://github.com/tomhumbert/schnipsel/issues)
- **Licence:** [GNU General Public License v3.0](https://github.com/tomhumbert/schnipsel/blob/main/LICENSE)

# ✂ Schnipsel

**Collect pieces of the web. Arrange them into collages. Search them. Share them.**

Schnipsel is a Firefox extension that lets you clip fragments of any web page — retaining the original HTML structure and computed styles — and organise them into named *bags*. Bags can be assembled into collage canvases, searched through a local index, and shared with friends via signed, encrypted codes.

The long-term vision is a community-curated search engine built from collectively clipped content, distributed over a peer-to-peer network.

> *Schnipsel* is German for *snippet* or *clipping* — a small piece cut from something larger.

---

## Features

- **Element picker** — hover any page element to highlight it; click to clip it with full computed styles preserved. Shift+click to start a contiguous range of siblings.
- **Bags** — named collections in the extension sidebar. Private by default; flip to public to share with friends.
- **Sidebar** — persistent Firefox sidebar panel with light/dark mode and three accent colour profiles.
- **Search index** — local full-text index covering text, image alt text, captions, aria-labels, video/audio metadata, and URL tokens. Supports prefix matching.
- **Collage workspace** — drag, resize, and rotate clip cards on a named canvas. Export as standalone HTML.
- **OpenSearch** — register as a Firefox search engine and search from the address bar.
- **Profile & cryptographic identity** — display name and avatar tied to an ECDSA/ECDH keypair. Your fingerprint is your real identifier.
- **Friends** — mutual two-step handshake. A leaked invite code can't silently add a stranger.
- **Signed, encrypted sharing** — share a public bag as a text code, encrypted to specific friends. No server required.
- **Federated search** — search spans your clips and your friends' public bags. Results show a verified "from \<friend\>" badge.

---

## Install

**Requirements:** Firefox 140+

1. Download the latest `schnipsel-*.xpi` from the [**Releases**](https://github.com/tomhumbert/schnipsel/releases/latest) page.
2. In Firefox, open `about:addons`.
3. Click the gear icon ⚙ → **Install Add-on From File…** and select the `.xpi`.
4. Click the ✂ button in the toolbar to open the sidebar.

The `.xpi` is Mozilla-signed, so it installs and persists on regular release Firefox. Because the extension ID is fixed, your bags and clips carry over when you install a newer version.

## Develop

To run the extension from source as a temporary add-on:

1. Clone the repository:
   ```bash
   git clone https://github.com/tomhumbert/schnipsel.git
   ```
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…** and select `manifest.json`.

Temporary add-ons are removed when Firefox restarts. For the `web-ext` workflow and other details, see the [wiki: Getting Started](https://github.com/tomhumbert/schnipsel/wiki/Getting-Started).

---

## Project structure

```
manifest.json               Firefox WebExtension manifest (MV2)
background/background.js    Message router; toolbar toggle; identity init
content_scripts/schnipsel.js  Element picker, style inliner, token extractor
storage/store.js            Storage abstraction — all browser storage calls go here
search/index.js             Inverted token index; federated peer search
crypto/identity.js          ECDSA/ECDH keypairs, sign/verify/encrypt/decrypt
p2p/invites.js              Mutual friend handshake (invite → accept → confirm)
p2p/transport.js            Signed+encrypted bag bundles + 8-step ingest pipeline
security/sanitize.js        DOMPurify wrapper + remote-ref stripping + srcdoc CSP
vendor/dompurify.js         Pinned, audited HTML sanitizer (see vendor/README.md)
sidebar/                    Persistent sidebar panel
collage/                    Full-tab search + collage workspace
```

No build tooling, no framework, no transpilation. The only third-party code is [DOMPurify](https://github.com/cure53/DOMPurify) (vendored, pinned, audited — see `vendor/README.md`).

---

## Documentation

Full technical documentation is in the **[GitHub Wiki](https://github.com/tomhumbert/schnipsel/wiki)**:

| | |
|---|---|
| [Getting Started](https://github.com/tomhumbert/schnipsel/wiki/Getting-Started) | Installation, dev setup, persistent install |
| [Architecture](https://github.com/tomhumbert/schnipsel/wiki/Architecture) | Extension layout, message passing, storage topology |
| [Element Picker and Clipping](https://github.com/tomhumbert/schnipsel/wiki/Element-Picker-and-Clipping) | Picker interaction, range selection, serialisation |
| [Storage Layer](https://github.com/tomhumbert/schnipsel/wiki/Storage-Layer) | `store.js` API, clip IDs, export/import |
| [Search Index](https://github.com/tomhumbert/schnipsel/wiki/Search-Index) | Tokenisation, prefix matching, federated search |
| [Collage and Workspace](https://github.com/tomhumbert/schnipsel/wiki/Collage-and-Workspace) | Canvas model, export, OpenSearch |
| [Security Model](https://github.com/tomhumbert/schnipsel/wiki/Security-Model) | Defence layers, threat model, DOMPurify, CSP |
| [Cryptographic Identity](https://github.com/tomhumbert/schnipsel/wiki/Cryptographic-Identity) | Keypairs, fingerprints, signing, encryption |
| [Friends and Sharing](https://github.com/tomhumbert/schnipsel/wiki/Friends-and-Sharing) | Handshake protocol, bundle format, ingest pipeline |
| [Design Philosophy](https://github.com/tomhumbert/schnipsel/wiki/Design-Philosophy) | No-bundler rationale, content-addressed IDs, visual design |
| [Contributing](https://github.com/tomhumbert/schnipsel/wiki/Contributing) | Dev workflow, conventions, security-sensitive areas |
| [Roadmap](https://github.com/tomhumbert/schnipsel/wiki/Roadmap) | Feature status and what's planned |

---

## Roadmap

| Milestone | Status |
|---|---|
| Element picker + style serialisation | ✅ |
| Bag management + search index | ✅ |
| Sidebar, collage workspace, export | ✅ |
| OpenSearch integration | ✅ |
| Cryptographic identity + profiles | ✅ |
| Friends (mutual handshake) | ✅ |
| Signed + encrypted bag sharing | ✅ |
| Federated peer search | ✅ |
| Live P2P transport (serverless WebRTC) | 🔲 Planned |
| Decentralised / P2P index | 🔲 Planned |
| Collage canvas: text boxes + pen tool | 🔲 Planned |

---

## Contributing

Contributions are welcome. See [Contributing](https://github.com/tomhumbert/schnipsel/wiki/Contributing) in the wiki for the dev setup, code conventions, and security-sensitive areas to be aware of.

---

## Licence

GNU General Public License v3.0 — see [`LICENSE`](LICENSE).

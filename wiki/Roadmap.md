# Roadmap

Feature milestones and their current status.

---

## Completed

| Feature | Notes |
|---|---|
| ✅ Element picker + style serialisation | Single-click clip; full computed-style inlining; URL rewriting; font embedding |
| ✅ Sibling-range selection | Shift+click + arrow keys; contiguous siblings only; wrapper container preserved |
| ✅ Bag management + IndexedDB storage | Named collections; content-addressed clip IDs; stable extension ID |
| ✅ Sidebar UI with theming | Persistent `sidebar_action` panel; light/dark; three accent profiles (red, purple, pink) |
| ✅ Local search index (all content types) | Inverted token index; text, images, video, audio, URLs; prefix matching; AND semantics |
| ✅ Workspace page | Full-tab search + collage interface |
| ✅ OpenSearch integration (address bar) | Dynamic Blob URL descriptor; address-bar search |
| ✅ Multi-canvas collage | Named canvases, dropdown selector; drag + resize + rotate; stacking |
| ✅ Collage export (standalone HTML) | Self-contained static file, dark theme, no JS required |
| ✅ Bag export / import (JSON backup) | Idempotent, content-addressed merge; full indexTokens preserved |
| ✅ Clip sanitisation + render hardening | DOMPurify (vendored + pinned + audited); sandbox without `allow-scripts`; per-iframe CSP |
| ✅ Cryptographic identity + profiles | ECDSA + ECDH P-256 keypairs; non-extractable private keys; fingerprint |
| ✅ Friends (mutual handshake) | Three-step invite/accept/confirm; signed codes; one-time expiring tokens |
| ✅ Public / private bags | Visibility toggle; monotonic version for replay protection |
| ✅ Signed + encrypted bag sharing (codes) | Hybrid encryption; per-recipient key wrapping; ECDSA-signed envelope |
| ✅ 8-step ingest pipeline | Size cap → known friend → sig verify → decrypt → version check → hash check → sanitise → store |
| ✅ Federated + advanced peer search | Local + namespaced friend indices; round-robin interleaving; scope picker |

---

## Planned

### Live P2P transport

Replace the copy-paste text code with an automatic transport. The bundle format, encryption scheme, and ingest pipeline stay identical — only the delivery mechanism changes.

**Decided: purely serverless (WebRTC).** No relay or signalling server, ever — the project stays fully peer-to-peer. (A relay would have made signalling trivial, but it's ruled out on principle.)

**Two goals:**
1. **Big payloads stop being pasted.** Shared bag bundles — large because they carry full clip HTML with inlined fonts/images — travel over the live WebRTC data channel instead of the clipboard. The huge per-share string disappears.
2. **The remaining strings must shrink.** Serverless WebRTC still needs a one-time, out-of-band bootstrap to establish a channel, and friends are added via a handshake. Today these are walls of base64; they need to become small enough to be painless — e.g. short codes, QR codes, and compressing/trimming the identity payload (drop the avatar from the code, fetch it over the channel after connecting).

**What needs to happen:**
- Implement a transport module that wraps `buildBundle` / `ingestBundle` dispatch over a WebRTC data channel
- Design a minimal serverless signalling bootstrap (small enough to QR/short-code), reusing the existing mutual-friend handshake where possible
- Shrink the handshake/identity codes (compression, QR, defer large fields like avatars to post-connection)
- Handle the offline case (peer not reachable) — fall back to the existing pasteable bundle

### Decentralised / P2P index

Contribute clipped content to a shared, distributed search network. This is the long-term goal of the project.

**Design constraints (already in place):**
- Clip IDs are SHA-256 content hashes — natively compatible with IPFS and Hypercore
- All storage goes through `store.js` — swapping the backend is a single-file change
- Clips are append-only / immutable — compatible with append-only distributed logs
- Signatures on shared content mean provenance is verifiable at scale

**Open questions:**
- Discovery: how does a user find other users' public bags without a central registry?
- Trust: how does the community index prevent spam and low-quality content from dominating results?
- Incentives: what motivates clipping and sharing high-quality content?

### Collage canvas enhancements

Make the canvas a richer composition surface, not just a place to arrange clips.

- **Text boxes** — add free-standing, editable text elements to a canvas (titles, captions, annotations between clips). Should persist in the canvas item model and be included in the standalone HTML export.
- **Pen / drawing tool** — freehand drawing directly on the canvas (arrows, highlights, doodles) layered with the clip cards, also persisted and exported.

---

## Not planned (deliberate non-goals)

- **A browser chrome UI (MV3 popup)** — the sidebar is the primary UI and will stay that way
- **A companion server that stores clips** — clips are stored locally or shared peer-to-peer; no central hosting
- **A web app version** — the extension model gives access to content scripts and browser storage that a web app cannot replicate

---

## Version history

| Version | Notable changes |
|---|---|
| 0.1.0 | Initial release: picker, bags, sidebar, search, collage, export/import, P2P foundation (identity + friends + sharing + federated search) |

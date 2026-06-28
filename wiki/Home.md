# Schnipsel — Developer Wiki

**Collect pieces of the web. Arrange them into collages. Search them. Share them.**

Schnipsel is a Firefox browser extension (Manifest V2) that clips fragments of any web page — retaining the full DOM structure and computed styles — and organises them into named *bags*. Bags can be shared with friends via signed, encrypted codes. The long-term ambition is a community-curated, peer-to-peer search engine built from collectively clipped content.

> *Schnipsel* is German for *snippet* or *clipping*.

This wiki is the technical companion to the project. If you want to **use** the extension, start with [Getting Started](Getting-Started). If you want to **understand or contribute to** the code, read on.

---

## Wiki contents

| Page | What it covers |
|------|---------------|
| [Getting Started](Getting-Started) | Installation, dev setup, `web-ext` workflow |
| [Architecture](Architecture) | How the extension is laid out, the message-passing backbone, and the no-bundler philosophy |
| [Element Picker and Clipping](Element-Picker-and-Clipping) | How the picker works, the sibling-range selection model, and the serialisation pipeline |
| [Storage Layer](Storage-Layer) | `store.js` — clips in IndexedDB, bags/profile/friends in `storage.local`, export/import |
| [Search Index](Search-Index) | Inverted token index, what gets indexed, prefix matching, AND semantics, federated search |
| [Collage and Workspace](Collage-and-Workspace) | The full-page canvas workspace, drag/resize/rotate, collage export, and OpenSearch integration |
| [Security Model](Security-Model) | Threat model, DOMPurify, sandboxing, CSP layers, background message gating, prototype-pollution hardening |
| [Cryptographic Identity](Cryptographic-Identity) | ECDSA and ECDH keypairs, non-extractable private keys, fingerprints, signing, and key derivation |
| [Friends and Sharing](Friends-and-Sharing) | Mutual invite handshake, signed/encrypted bag bundles, the 8-step ingest pipeline, replay protection |
| [Design Philosophy](Design-Philosophy) | Visual design decisions, the no-framework constraint, content-addressed IDs, P2P readiness |
| [Contributing](Contributing) | Dev workflow, coding conventions, security-sensitive areas, how to submit a PR |
| [Roadmap](Roadmap) | Feature milestones and their status |

---

## Quick orientation

```
schnipsel/
├── manifest.json               MV2 manifest (permissions, background scripts, sidebar)
├── background/background.js    Central message router; toolbar toggle; identity init
├── content_scripts/schnipsel.js  Element picker + style inliner + token extractor
├── storage/store.js            Storage abstraction (IndexedDB + storage.local)
├── search/index.js             Inverted token index; federated peer search
├── crypto/identity.js          ECDSA/ECDH keypairs, sign/verify/encrypt/decrypt
├── p2p/invites.js              Mutual friend handshake (invite → accept → confirm)
├── p2p/transport.js            Signed+encrypted bag bundles + 8-step ingest pipeline
├── security/sanitize.js        DOMPurify wrapper + remote-ref stripping + srcdoc CSP
├── vendor/dompurify.js         Pinned, audited HTML sanitizer (see vendor/README.md)
├── sidebar/                    Persistent Firefox sidebar panel (HTML + CSS + JS)
└── collage/                    Full-tab search + collage workspace (HTML + CSS + JS)
```

The extension has **no build step and no framework dependencies**. Every file is plain HTML, CSS, and JavaScript. The only bundled third-party code is DOMPurify (vendored under `vendor/`, pinned to a specific hash, audited before vendoring).

---

## Where to start depending on your goal

| Goal | Start here |
|------|-----------|
| Install and try it | [Getting Started](Getting-Started) |
| Understand how clips are captured | [Element Picker and Clipping](Element-Picker-and-Clipping) |
| Understand how data is stored | [Storage Layer](Storage-Layer) |
| Understand the search implementation | [Search Index](Search-Index) |
| Understand the security guarantees | [Security Model](Security-Model) |
| Implement or replace the P2P transport | [Friends and Sharing](Friends-and-Sharing) + [Cryptographic Identity](Cryptographic-Identity) |
| Contribute code | [Contributing](Contributing) |
| See what's planned | [Roadmap](Roadmap) |

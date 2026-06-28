# Design Philosophy

This page documents the reasoning behind the choices that shape Schnipsel's codebase and visual design. These are not defaults or defaults-until-someone-argues-otherwise — they are deliberate decisions. Proposals that conflict with them should come with a strong reason.

---

## Long-term vision: a community search engine

Schnipsel's ultimate goal is a **community-curated search engine** built from collectively clipped web content, distributed over a peer-to-peer network. Every architectural decision is made with this in mind, even the features that exist today.

The current state — local clips, local search, friend sharing — is the foundation, not the product. The P2P layer is being built from the ground up with the final goal in mind, rather than bolted on later.

---

## Content-addressed clip IDs

Every clip ID is `SHA-256(clip.html + clip.sourceUrl)`.

**Why not a UUID?** Random IDs would require a central authority or coordination to prevent collisions across multiple users. Content-addressed IDs are inherently unique across all users without coordination: two different clips always have different content, so they produce different hashes. Two identical clips (same page element, same source URL) produce the same hash, giving free deduplication.

**P2P compatibility:** SHA-256 content addresses are natively understood by IPFS, Hypercore, and other content-addressed storage systems. When the P2P backend is added, no migration is needed — clip IDs are already in the right format.

**Immutability:** because the ID is derived from content, clips are effectively append-only. Editing a clip creates a new clip with a new ID. This is intentional — it means clips can be exchanged between peers without version conflicts.

---

## Storage abstraction

Nothing outside `storage/store.js` calls browser storage APIs directly. Every read and write goes through the `store` object.

**Why?** To make the storage backend swappable. The P2P layer will need to write clips to a distributed store (IPFS, Hypercore, Gun.js, etc.). If storage calls were scattered across the codebase, that migration would touch dozens of files. With the abstraction, it is a change to one file.

This is one of the few places in the codebase where a layer of indirection is worth the cost.

---

## No build step, no framework

No bundler (webpack, Vite, Rollup), no framework (React, Vue, Svelte), no transpilation (TypeScript, Babel). Plain HTML, CSS, and JavaScript that runs directly in Firefox.

**Why?** Several reasons:

1. **Contributor onboarding:** anyone can clone the repository and load the extension immediately. No `npm install`, no build command, no understanding of a framework's abstractions.
2. **Debuggability:** browser devtools work directly on the source. There is no source map dependency and no minified output to work around.
3. **Longevity:** browser APIs are stable for decades; framework APIs churn constantly. Schnipsel's code will still work without changes in ten years.
4. **Security surface:** no `node_modules` directory means no supply-chain attack surface. The only third-party code is DOMPurify, vendored as a single audited file.

The tradeoff is more verbose DOM manipulation and no component model. For an extension of this size, that is an acceptable cost.

---

## No module system

Files are concatenated by the browser in the order specified in `manifest.json` (for the background page) and in `<script>` tags (for extension pages). Globals like `store`, `index`, `identity`, `invites`, `transport`, and `sanitize` are used directly.

This is consistent with the no-build philosophy: ES modules require either a bundler or the `type="module"` attribute (which changes how scripts execute and complicates the extension model). The current approach is simple and explicit.

---

## DOMPurify as the only vendored dependency

DOMPurify is the only third-party library in the codebase, and it is **vendored** (committed verbatim, not fetched at runtime).

**Why vendored?** Extensions run offline. A CDN-fetched library would fail without internet access and would also be a runtime network dependency that could be replaced by a CDN compromise.

**Why audited?** Before vendoring, the file was inspected for the absence of any network or storage calls. The SHA-256 hash is pinned in `vendor/README.md` so any future change to the file is immediately detectable.

**Why not other libraries?** The web platform in 2025 has rich APIs for everything Schnipsel needs — Web Crypto, IndexedDB, DOM manipulation, CSS, Fetch. Libraries that wrap these APIs add complexity without adding capability.

---

## Pluggable transport

The P2P sharing protocol is designed so the *transport* is replaceable without changing the *security layer*.

Today, bundles travel as text codes. A user copies a string and sends it to a friend over any channel — email, SMS, a chat app. This requires no server infrastructure and no new browser permissions.

In the future, a serverless WebRTC transport (no relay server) can replace the copy-paste mechanic. The bundle format, the encryption scheme, and the 8-step ingest pipeline stay the same. Only the function that moves bytes changes.

This is why `transport.buildBundle()` returns a code string and `transport.ingestBundle()` takes a code string — the underlying format does not assume anything about how the string travels.

---

## Visual design: glass morphism + CRT

The Schnipsel aesthetic combines two influences:

- **Glass morphism:** frosted glass panels (`backdrop-filter: blur(…)`), subtle transparency, soft shadows. Modern, restrained.
- **CRT / retro:** scanline overlay (`repeating-linear-gradient`), warm paper-toned backgrounds, monospace font throughout. Nostalgic, tactile.

Together they aim for something that feels like a well-worn notebook kept on a modern desk — functional and personal, not corporate.

**Monospace everywhere** — `'Courier New', monospace` is used for hostnames, fingerprints, IDs, and other technical strings. For body text in cards and labels it provides a consistent texture throughout the UI.

**Three accent profiles** — red, purple, and pink (a soft bubblegum tone, not saturated). They share the same structure (primary + lighter highlight) and are switched by clicking coloured dots in the header. The choice is saved and shared between the sidebar and the collage page.

**Light/dark** — toggled by clicking the ☀/☾ icon. Both modes use the same accent colours and the same glass morphism approach. The theme is stored in `storage.local["theme"]` and read by both the sidebar and the collage page so they stay in sync.

**No marketing headlines** — the UI says what it does, not what it aspires to be. Function over branding.

---

## Mutual friendship model

The friend system is deliberately mutual. Adding a friend requires both parties to go through a three-step handshake: invite → accept → confirm. Neither side is added to the other's list until both have confirmed.

**Why?** A one-sided follow model means that if an invite link leaks (forwarded by the recipient, shared in a chat, found in a backup), any third party can silently gain access to your shared bags. With mutual confirmation, a leaked invite is useless — the stranger who finds it would have to accept it and send a response, and you would see their name and fingerprint before confirming. You always know exactly who you're adding.

The tradeoff is an extra round trip (three messages instead of one). For a feature as significant as granting someone access to your content, that round trip is the right call.

---

## Namespaced friend indices

Friend search results are always drawn from per-friend index namespaces, never merged into the local index.

**Why?** If friend indices were merged, a malicious friend could insert tokens that return your own clips in their context, or inject noise that pollutes your own search results. With separate namespaces, every search result carries verified provenance, and removing a friend removes exactly their content — no surgery required.

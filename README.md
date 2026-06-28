# ✂ Schnipsel

**Collect pieces of the web. Arrange them into collages. Search them. Share them.**

Schnipsel is a Firefox extension that lets you clip fragments of any web page — retaining the original HTML structure and computed styles — and organise them into named *bags*. Clipped content can be assembled into shareable collage pages and searched through a local index that understands text, images, and all other media types.

The long-term vision is a community-curated search engine built from collectively clipped content, distributed via a peer-to-peer network.

> *Schnipsel* is German for *snippet* or *clipping* — a small piece cut from something larger.

---

## Features

### Now
- **Element picker** — hover any page element to highlight it, click to clip it. The clip captures the full computed style so it renders correctly outside the original page.
- **Bags** — named collections that live in the extension sidebar. Create as many as you like and move clips between them. Each bag is **private** by default and can be flipped **public** to share with friends.
- **Sidebar UI** — a persistent Firefox sidebar panel with light/dark mode and three accent colour profiles (red, purple, pink).
- **Search index** — a local full-text index built from clipped content. Covers plain text, image alt text, captions, aria-labels, surrounding prose context, video/audio metadata, and URL tokens. Not text-only.
- **Profile** — a display name and avatar, tied to a cryptographic identity (a keypair). Your fingerprint is your real, unforgeable identifier.
- **Friends (peer-to-peer)** — add a friend by exchanging short invite/response codes over any channel you like. Friendship is **mutual** — both sides explicitly confirm — so a leaked invite can't silently add a stranger.
- **Shared bags** — share a public bag with chosen friends as a single signed, **encrypted** code. Only the friends you address can read it.
- **Federated & advanced search** — search spans your own clips *and* your friends' public bags. The Workspace's **Search scope** picker lets you choose exactly which peers to include. Results show a verified "from <friend>" badge.

### Planned
- **Live transport** — move the same signed/encrypted bundles automatically over WebRTC or a relay, instead of pasting codes by hand.
- **Decentralised index** — contribute to a shared, P2P-distributed search network. Architecture is content-addressed and signed from day one to support this.

---

## Project structure

```
schnipsel/
├── manifest.json               Firefox WebExtension manifest (MV2)
├── background/
│   └── background.js           Message router; toolbar toggle
├── content_scripts/
│   └── schnipsel.js            Element picker, style inliner, token extractor
├── storage/
│   └── store.js                Storage abstraction — clips in IndexedDB, bags/friends/profile in storage.local
├── search/
│   └── index.js                Inverted index over all content types; federated peer search
├── crypto/
│   └── identity.js             ECDSA/ECDH keypairs, sign/verify, ECDH+HKDF+AES-GCM
├── p2p/
│   ├── invites.js              Mutual friend handshake (invite/response codes)
│   └── transport.js            Signed+encrypted bag bundles + ingest pipeline
├── security/
│   └── sanitize.js             DOMPurify wrapper + remote-ref stripping + srcdoc CSP
├── vendor/
│   └── dompurify.js            Pinned, audited HTML sanitizer (see vendor/README.md)
├── sidebar/
│   ├── sidebar.html            Sidebar panel markup
│   ├── sidebar.css             Theming: light/dark, three accent profiles, glass + retro aesthetic
│   └── sidebar.js              Sidebar UI controller
└── icons/
    ├── schnipsel-32.png
    └── schnipsel-48.png
```

---

## Installation

### Requirements
- Firefox 109 or later (for `sidebar_action` support)
- No build step — plain JavaScript, no bundler required

### Quick start (temporary, for development)

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/schnipsel.git
   cd schnipsel
   ```

2. **Open Firefox's add-on debugger** at `about:debugging#/runtime/this-firefox`

3. **Load the extension** — click **Load Temporary Add-on…** and select `manifest.json`.

4. **Open the sidebar** — click the ✂ Schnipsel button in the toolbar, or **View → Sidebar → Schnipsel**.

> Temporary add-ons are removed when Firefox closes. Because the manifest declares a **stable extension ID** (`browser_specific_settings.gecko.id`), your stored bags and search index *do* survive a reload within the same Firefox session and across version bumps — but a full browser restart still drops a temporary add-on entirely. For storage that survives restarts, install it persistently (below) and/or use the built-in **bag export/import** as a backup.

### Persistent installation

A temporary add-on is wiped on browser close. To keep Schnipsel (and its data) permanently you need an installed, signed package. Two options:

**Option A — Self-distributed signed XPI (recommended for personal use)**

1. Create a free account at [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. Package and submit for **unlisted** signing (no public listing, no review wait):
   ```bash
   npm install -g web-ext
   web-ext sign --channel=unlisted \
     --api-key=<JWT issuer> --api-secret=<JWT secret>
   ```
   The API credentials come from your AMO account → **Manage API Keys**.
3. `web-ext sign` downloads a signed `.xpi` into `web-ext-artifacts/`.
4. In Firefox, open `about:addons` → gear icon → **Install Add-on From File…** → pick the `.xpi`. It now persists across restarts and updates.

To ship a new version, bump `"version"` in `manifest.json`, sign again, and install the new `.xpi` over the old one. Because the extension ID is fixed, your bags and index carry over.

**Option B — Disable signature enforcement (Developer Edition / Nightly / ESR only)**

1. Use Firefox **Developer Edition**, **Nightly**, or **ESR** (regular release Firefox does *not* allow this).
2. Go to `about:config` and set `xpinstall.signatures.required` to `false`.
3. Zip the project and install the zip via `about:addons` → **Install Add-on From File…**, or just keep loading it via `about:debugging` (data persists thanks to the fixed ID).

### Backing up your data

Regardless of install method, use **⤓ Export** in the Bags header to save all bags and their clips to a JSON file, and **⤒ Import** to restore them — see [Exporting & importing bags](#exporting--importing-bags). This is the most reliable way to move data between machines or guard against losing a temporary add-on.

### Developing with web-ext

```bash
npm install -g web-ext
web-ext run        # launches Firefox with the extension pre-loaded, auto-reloads on changes
web-ext lint       # checks manifest and JS for common issues
web-ext build      # packages a .zip for submission to AMO
```

---

## Usage

### Clipping a page element

1. Open the Schnipsel sidebar.
2. Click **✂ Clip** in the sidebar header. The cursor changes to a crosshair and elements highlight in orange as you hover.
3. Clip a single element, or a run of neighbours:

   | Action | Result |
   |--------|--------|
   | Click | Clip that element immediately, close the picker |
   | Shift+click | Start a selection at that element (its parent becomes the kept container) |
   | Shift+click another sibling | Extend the selection to span that sibling |
   | ↑ ↓ ← → | Grow / shrink the selection to adjacent siblings, one at a time |
   | Enter | Clip the selection |
   | Esc | Cancel |

   A selection is a **contiguous run of sibling elements inside one container**. The clip keeps that container — so its background, padding, and layout framing are preserved — but drops the container's *other* children. (Think: keep two paragraphs of a card, lose the rest, but the card itself stays.) Trying to extend to an element in a *different* container is refused with a red, "not-allowed" cursor — no dialog. A status bar at the bottom of the page shows the count, the container tag, and the shortcuts.

4. A preview of the clip appears in the sidebar. Choose a bag (or create a new one) and click **Save**.

### Managing bags

- Click **+** next to *Bags* to create a new bag.
- Click any bag to open it and browse its clips.
- Hover a bag and click **×** to delete it (clips are also removed from the index).

### Exporting & importing bags

The *Bags* header has two buttons:

- **⤓ Export** — downloads a single `schnipsel-bags-YYYY-MM-DD.json` file containing every bag and the full content of the clips inside them (HTML, styles, source URL, and search tokens). This is a complete, self-contained backup.
- **⤒ Import** — pick a previously exported JSON file to merge it into your current bags.

Import is **non-destructive and idempotent**:

- Clips are restored by their content-addressed ID, so re-importing the same file never creates duplicates.
- A bag that already exists (same ID) keeps its name and gains any clips from the import it didn't already have. Bags that don't exist yet are created.
- Restored clips are automatically re-added to the search index.

Use this to move your collection between machines or Firefox profiles, or as a safety net against losing a temporary add-on on browser restart.

### Searching

**In the sidebar** — type in the search box. Results draw from the full local index across all bags. Prefix matching is supported: `"schnip"` matches `"schnipsel"`.

**From the Firefox address bar** — visit the Workspace page once (click **⊞ Workspace** in the sidebar). Firefox will detect Schnipsel as a search engine. Go to **Preferences → Search** and add it to your search bar, or select it from the address bar dropdown. Subsequent searches with Schnipsel selected open the Workspace page with results pre-loaded.

### Workspace (collage & search page)

Click **⊞ Workspace** in the sidebar to open the full-page search and collage interface. Each clip result shows a thumbnail, the source hostname, and a **↗ visit** link to the original page.

### Profile & friends (peer-to-peer)

**Set up your profile** — click the profile strip at the top of the sidebar. Pick a display name and an avatar (PNG/JPEG/WEBP; it's re-encoded to a small square locally). Your **fingerprint** is shown — this is your cryptographic identity; share or compare it out-of-band to be sure a friend is really who they say.

**Add a friend** — friendship is a mutual, two-step exchange so a leaked link can't add a stranger:

1. Click **+** in the *Friends* section → **Generate invite code**. Send that code to your friend over any channel.
2. Your friend pastes it into *their* extension, reviews your name + fingerprint, and **Accepts** — which produces a **reply code** they send back to you.
3. You paste their reply, review *their* name + fingerprint, and **Confirm**. You're now friends.

Invite codes are one-time and expire after 7 days.

### Sharing a bag

1. Flip a bag to **public** with its 🔒/🌐 toggle (a confirmation explains exactly what's shared — including the source URLs of pages you visited).
2. Click the **📤** button on the public bag → choose which friends to share with → **Create share code**.
3. Send the code to those friends. The code is **signed by you and encrypted to each chosen friend** — nobody else can read it.

To receive, click **📥** in the *Friends* section and paste a code a friend sent you. It's verified, decrypted, integrity-checked, and sanitized before anything is stored.

### Searching across friends

Search (in the sidebar or the Workspace) automatically spans **your clips plus every friend's public bags**. Friend results carry a verified **"from <friend>"** badge. In the Workspace, open **⚙ Search scope** to pick exactly which peers (you and/or specific friends) a query should include.

### Theming

The sidebar and Workspace page share theme preferences:
- Click the ☀/☾ icon to toggle light and dark mode.
- Click one of the three coloured dots to switch accent colour (red, purple, or pink).

Preferences are saved across sessions.

### Removing the Firefox sidebar header

By default Firefox renders a native grey header (with title and × close button) above every sidebar panel. To remove it and have Schnipsel's own header sit flush at the top:

1. Go to `about:config` and set `toolkit.legacyUserProfileCustomizations.stylesheets` to `true`.
2. Go to `about:support` and click **Open Profile Folder**.
3. Inside that folder create `chrome/userChrome.css` (create the `chrome/` directory if needed) with:
   ```css
   #sidebar-header {
     display: none !important;
   }
   ```
4. Restart Firefox.

This hides the native header for all sidebars. Revert by removing those lines and restarting.

---

## Architecture notes

### Content-addressed clip IDs

Every clip is identified by a SHA-256 hash of its HTML content and source URL. This is intentional: it makes Schnipsel ready for content-addressed storage backends (IPFS, Hypercore/Dat, Gun.js) without requiring a migration when the P2P layer is added. Identical clips clipped from the same page always produce the same ID — deduplication comes for free.

### Storage abstraction

All reads and writes go through `storage/store.js`. Nothing in the UI or search layer calls browser storage APIs directly. Swapping the backend to a P2P store is a change to one file.

### Search index design

The index in `search/index.js` is a simple inverted token index persisted to `browser.storage.local`. Tokens are extracted from:

| Source | Fields indexed |
|--------|---------------|
| Text elements | `innerText`, `textContent` |
| `<img>` | `alt`, `title`, `aria-label`, `aria-labelledby` target, parent `<figcaption>`, nearest `<p>`/`<li>`/`<blockquote>` prose context |
| `<video>` / `<audio>` | `title`, `aria-label`, `<source src>` filename |
| `<a>` | `title`, `aria-label` |
| Any element | `aria-label`, `role="img"` |
| Page metadata | `<title>`, source URL hostname + path segments |

Search uses AND semantics across terms and supports prefix matching. Friends' indices are kept **namespaced per friend** (never merged into your own), so a hostile peer can't pollute your index, and results always carry provenance.

### Security model

Once clips can come from other people, every byte of a clip is untrusted. The defenses are layered so no single one is load-bearing:

- **No script execution, ever.** Clips render in sandboxed `<iframe srcdoc>` elements that are **never** given `allow-scripts` (and never `allow-same-origin`). On top of that, every clip is run through **DOMPurify** (vendored in `vendor/`, pinned and audited — no network access) on both ingest and render, and each iframe carries a strict `<meta>` CSP (`script-src 'none'`).
- **No tracking beacons.** Friend-sourced clips additionally have all remote resource references stripped, and their CSP locks images/fonts/media to `data:` only — so viewing a clip can't phone home and reveal your IP or that you saw it.
- **Cryptographic identity.** Each user has ECDSA (signing) + ECDH (key-agreement) P-256 keypairs, stored **non-extractable** in IndexedDB. Identity is the key fingerprint, not the name.
- **Authenticated, encrypted sharing.** Bag bundles are ECDSA-signed and encrypted (ECDH → HKDF → AES-GCM) to each addressed friend. Recipients reject bundles that aren't from a known friend, whose keys don't match, whose signature fails, that aren't addressed to them, or that replay an old version.
- **Integrity.** Clips are content-addressed (`SHA-256(html + sourceUrl)`); a received clip's hash is recomputed and must match before it's stored.
- **Hardening.** Strict extension CSP; background message handlers reject any sender that isn't an extension page; the search index rejects prototype-pollution keys (`__proto__`, `constructor`, `prototype`) and caps per-friend size; avatars are re-encoded through a canvas (SVG rejected) and friend content is quota-limited.

See [`vendor/README.md`](vendor/README.md) for how to re-verify the bundled sanitizer.

---

## Roadmap

| Milestone | Status |
|-----------|--------|
| Element picker + style serialisation | ✅ Done |
| Multi-select (Shift/Alt+click) | ✅ Done |
| Bag management + IndexedDB storage | ✅ Done |
| Sidebar UI with theming | ✅ Done |
| Local search index (all content types) | ✅ Done |
| Workspace page (search + collage shell) | ✅ Done |
| OpenSearch integration (address bar) | ✅ Done |
| Collage drag-and-drop canvas | ✅ Done |
| Collage export (standalone HTML) | ✅ Done |
| Clip sanitization + render hardening | ✅ Done |
| Cryptographic identity + profiles | ✅ Done |
| Friends (mutual, link-based) | ✅ Done |
| Public/private bags | ✅ Done |
| Signed + encrypted bag sharing (codes) | ✅ Done |
| Federated + advanced peer search | ✅ Done |
| Live P2P transport (WebRTC / relay) | 🔲 Planned |
| Decentralised / P2P index | 🔲 Planned |

---

## Contributing

This is an early-stage personal project. Contributions, ideas, and issue reports are welcome.

```bash
git clone https://github.com/your-username/schnipsel.git
web-ext run
```

No build tooling, no framework dependencies, no transpilation. Plain HTML, CSS, and JavaScript. The only bundled third-party code is [DOMPurify](https://github.com/cure53/DOMPurify) (vendored under `vendor/`, pinned and audited — see `vendor/README.md`); everything else relies solely on the WebExtension and Web Crypto APIs.

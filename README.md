# ✂ Schnipsel

**Collect pieces of the web. Arrange them into collages. Search them. Share them.**

Schnipsel is a Firefox extension that lets you clip fragments of any web page — retaining the original HTML structure and computed styles — and organise them into named *bags*. Clipped content can be assembled into shareable collage pages and searched through a local index that understands text, images, and all other media types.

The long-term vision is a community-curated search engine built from collectively clipped content, distributed via a peer-to-peer network.

> *Schnipsel* is German for *snippet* or *clipping* — a small piece cut from something larger.

---

## Features

### Now
- **Element picker** — hover any page element to highlight it, click to clip it. The clip captures the full computed style so it renders correctly outside the original page.
- **Bags** — named collections that live in the extension sidebar. Create as many as you like and move clips between them.
- **Sidebar UI** — a persistent Firefox sidebar panel with light/dark mode and three accent colour profiles (red, purple, pink).
- **Search index** — a local full-text index built from clipped content. Covers plain text, image alt text, captions, aria-labels, surrounding prose context, video/audio metadata, and URL tokens. Not text-only.

### Planned
- **Collage page** — drag-and-drop canvas to compose clipped fragments into a layout.
- **Sharing** — export a collage as a standalone HTML page or a hosted snapshot.
- **Decentralised index** — contribute your index to a shared, P2P-distributed search network. Architecture is content-addressed from day one to support this.

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
│   └── store.js                Storage abstraction — clips in IndexedDB, bags in storage.local
├── search/
│   └── index.js                Inverted index over all content types
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
3. Clip one or more elements:

   | Action | Result |
   |--------|--------|
   | Click | Clip that element immediately, close the picker |
   | Shift+click | Add element to selection (picker stays open) |
   | Shift+click again | Deselect that element |
   | Alt+click | Remove element from selection |
   | Enter | Clip all selected elements as individual clips |
   | Esc | Cancel, clear all selections |

   A status bar appears at the bottom of the page while elements are selected, showing the count and available shortcuts.

4. A preview of each clipped element appears in the sidebar. Choose a bag (or create a new one) and click **Save**.

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

Search uses AND semantics across terms and supports prefix matching.

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
| Collage sharing (hosted) | 🔲 Planned |
| Decentralised / P2P index | 🔲 Planned |

---

## Contributing

This is an early-stage personal project. Contributions, ideas, and issue reports are welcome.

```bash
git clone https://github.com/your-username/schnipsel.git
web-ext run
```

No build tooling, no framework dependencies, no transpilation. Plain HTML, CSS, and JavaScript — the WebExtension APIs are the only runtime dependency.

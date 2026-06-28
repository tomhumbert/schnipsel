# Collage and Workspace

Source files: `collage/collage.html`, `collage/collage.css`, `collage/collage.js`

The Workspace is a full browser tab opened via the **⊞ Workspace** button in the sidebar. It has two tabs at the top: **Search** and **Collage**.

---

## Search tab

The Search tab provides a full-page search experience with:
- A search input (keyboard shortcut: the page auto-focuses on load)
- Results rendered as a grid of clip thumbnails with source hostname and **↗ visit** link
- Federated results — own clips and friends' public bags — with a "from \<friend\>" badge on external results

### OpenSearch integration

Schnipsel registers itself as a search engine with Firefox so queries can be issued directly from the address bar.

**Why a Blob URL?** The OpenSearch XML specification requires an exact URL for the `<Url template>`. Extension pages use `moz-extension://<extension-id>/…`, and the extension ID differs between Firefox profiles and between temporary and signed installs. Rather than hard-coding an ID that would silently break, Schnipsel generates the OpenSearch descriptor at runtime and registers it as a `Blob URL`:

```js
const xml = `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Schnipsel</ShortName>
  <Url type="text/html" template="${collageUrl}?q={searchTerms}"/>
</OpenSearchDescription>`;
const blob = new Blob([xml], { type: "application/opensearchdescription+xml" });
const blobUrl = URL.createObjectURL(blob);
```

The `<link rel="search">` tag in `collage.html` then points to this Blob URL. Firefox detects it when the page loads and offers to add Schnipsel as a search engine.

After visiting the Workspace page once, go to **Preferences → Search** to add Schnipsel to the address bar. Searches will open the Workspace at `?q=<query>` with results pre-loaded.

---

## Collage tab

The Collage tab is a spatial canvas for arranging clip cards into a composition.

### Layout

```
┌────────────────────────────────────────┐
│  Header (tabs + canvas selector + controls)  │
├──────────┬─────────────────────────────┤
│  Left    │                             │
│  tray    │   Canvas                    │
│  (240px) │   (dot-grid background)     │
│          │                             │
│  Bags    │                             │
│  accordions                           │
│  Clips   │                             │
│  (drag)  │                             │
└──────────┴─────────────────────────────┘
```

### Multi-canvas

There can be multiple named canvases. A dropdown in the header switches between them. New canvases are created with **+ New** (prompts for a name). The **🗑 Delete** button removes the current canvas (disabled when there is only one).

State is persisted to `storage.local["collageData"]`:

```js
{
  canvases: {
    [canvasId]: {
      id: string,
      name: string,
      items: [canvasItem],
    }
  },
  currentCanvasId: string,
}
```

A default canvas named `"My first collage"` is created on first run.

### Canvas items

Each item on the canvas is a draggable, resizable, rotatable clip card.

```js
{
  uid: string,       // random UUID (canvas-local identifier)
  clipId: string,    // reference to the clip in the store
  x: number,        // left offset in pixels from canvas origin
  y: number,        // top offset in pixels from canvas origin
  w: number,        // card width
  h: number,        // card height
  rotation: number, // degrees
  naturalW: number, // original on-page width of the clip (drives content scaling)
  z: number,        // stacking order (z-index)
}
```

`naturalW` is stored so the card's iframe can scale the clip content correctly. Clips are rendered at 300% zoom then scaled to 33.3% via `transform: scale(0.333)` at `transform-origin: top left`, producing a sharp thumbnail at 1× the iframe's logical dimensions.

### Drag

Cards have a title bar at the top. Dragging the title bar moves the card on the canvas. Position is tracked as `(x, y)` offsets from the canvas origin and persisted after mouseup.

### Resize

A small `◢` handle in the bottom-right corner of each card. Dragging it changes `w` and `h` with a minimum of 160×120 px.

### Rotate

A `⟳` handle appears above the card on hover. Dragging it rotates the card around its centre. The angle is computed with `atan2` from the card's centre to the current mouse position, offset by the initial grab angle so the card doesn't jump on first drag.

### Z-order

Clicking (bringing focus to) a card bumps its `z` value above all others, so the clicked card is always on top.

---

## Collage export

The **↓ Export** button (in the header) generates a standalone HTML file:
- All cards are positioned and rotated exactly as on the canvas using `position: absolute` and `transform: rotate(Ndeg)`.
- Dark theme with a warm paper gradient and dot-grid background is included inline.
- No JavaScript required — the exported file is a pure static HTML document.
- Each card's clip content is embedded directly as the iframe's `srcdoc` (via `sanitize.srcdoc()`), so the export file is self-contained.

The export file can be opened in any modern browser and shared as a single file.

---

## Peer scope picker (Search tab)

The Search tab has an **⚙ Search scope** control that lets the user choose exactly which peers to include in a search. Options are:
- **All** (default) — local clips + every friend's public bags
- **Me only** — local clips only
- **Individual friends** — one or more specific friends

This maps directly to the `peers` parameter of `index.federatedSearch(query, peers)`.

# Element Picker and Clipping

Source file: `content_scripts/schnipsel.js`

The content script is injected into every page at `document_idle`. It stays dormant until the background script sends it an `ACTIVATE_PICKER` message (triggered by the **✂ Clip** button in the sidebar).

---

## Picker interaction model

When the picker is active, a fixed status bar appears at the bottom of the page and elements highlight as the user moves the cursor.

| Input | Effect |
|---|---|
| Hover | Highlight hovered element (dashed orange outline) |
| Click | Clip that element immediately; close picker |
| Shift+click | Start or extend a range selection |
| ↑ ↓ ← → (arrow keys) | Grow or shrink the current range by one sibling |
| Enter | Clip the current range |
| Esc | Cancel; deactivate picker |

---

## Selection models

### Single-element clip

A plain click clips one element and closes the picker immediately. The clip is forwarded to the sidebar for the user to choose a bag before saving.

### Sibling-range clip

A range is a **contiguous run of element children inside one container element**. The design is intentional: it models how you'd "cut out a strip of a newspaper" — you keep a section of the page, including its outer container (for background, padding, and layout), but you drop the container's other children.

**State variables:**

```
wrapperEl    — the kept container (fixed when the first Shift+click happens)
siblings[]   — wrapperEl's element children in document order
anchorIndex  — the fixed end of the selection
focusIndex   — the moving end (changed by arrow keys and Shift+clicks)
```

**Rules:**

- `wrapperEl` is set to the **direct parent** of the first Shift+clicked element. It never changes for the lifetime of a range.
- Only elements that are direct children of `wrapperEl` can be included (siblings — no cousins or elements from a different container).
- If the user tries to Shift+click or arrow-key to an element outside `wrapperEl`, the request is refused silently (cursor turns red and blinks briefly).
- `selectedChildren()` is always `siblings.slice(min(anchor, focus), max(anchor, focus) + 1)` — always contiguous, always within the wrapper.

**Visual feedback:**

| Style | Meaning |
|---|---|
| Orange dashed outline | Hovered element (no range active) |
| Orange solid outline | Elements within the selected range |
| Orange dashed outer ring | The wrapper container |
| Orange dotted outline | Siblings that are within the wrapper but outside the range (candidates) |
| Red outline + not-allowed cursor | Refused extension attempt |

The status bar shows: `N in <tagname>  ·  ↑↓ grow  ·  Shift-click a sibling  ·  Enter to clip  ·  Esc to cancel`

---

## Serialisation pipeline

When a clip is confirmed (click on single, Enter on range), the content script calls the serialiser before sending the result to the background.

### Single element: `buildStyledClone(el)`

1. **Clone the subtree** — `el.cloneNode(true)`
2. **Inline computed styles** — walk every element in the clone in parallel with the live DOM, copying `window.getComputedStyle(liveEl).cssText` to `clone.style.cssText`. This ensures the clip renders correctly outside the original page's stylesheets.
3. **Materialise pseudo-elements** — `::before` and `::after` are synthesised as real `<span>` elements with their computed styles and `content` inlined, so they survive outside the page.
4. **Rewrite relative URLs to absolute** — every `src`, `href`, and `url(…)` in inline styles is resolved against `document.baseURI` so assets remain reachable.
5. **Embed `@font-face` as data URIs** — font files referenced in the page's stylesheets are fetched and embedded as `data:` URIs in a `<style>` block inside the clip, so the clip renders in the correct typeface even on other machines.
6. **Wrap in a width container** — the clone is wrapped in a `<div>` whose width matches the original element's `offsetWidth`, so the clip renders at its natural size when thumbnailed.

### Sibling range: `serializeSiblingRange(wrapper, kept)`

The range variant keeps the wrapper element (its styles are inlined) but prunes all children that are *not* in the kept set.

1. Mark each live child in `kept` with `data-schnipsel-keep="1"`.
2. Call `buildStyledClone(wrapper)` — a full clone of the wrapper including *all* its children (this is necessary so the parallel-walk style inliner stays in sync with the live DOM).
3. Remove any cloned children that don't have `data-schnipsel-keep`, then strip the markers.
4. The output shape is identical to a single-element clip — the storage and search layers never need to know which variant was used.

---

## Token extraction

While serialising, the content script also walks the element tree to build an `indexTokens` object. This is what the search index uses — extracting tokens at clip time means the index can be rebuilt from a stored clip without re-fetching the original page (important for export/import).

```js
indexTokens: {
  text: string,          // innerText of the whole clip
  images: [{ tokens, src }],  // alt + aria-label + figcaption + prose context per image
  links: [string],       // link title + aria-label
  ariaLabels: [string],  // any element's aria-label
  media: [{ title, src }],   // video/audio metadata
}
```

`pageTitle` and `sourceUrl` are stored separately on the clip record and tokenised by the search index on `addClip`.

---

## CLIP_CREATED message

Once serialisation is complete, the content script sends:

```js
browser.runtime.sendMessage({
  type: "CLIP_CREATED",
  clip: {
    html: string,         // serialised clip HTML
    sourceUrl: string,    // current page URL
    pageTitle: string,    // document.title
    elementTag: string,   // tagName of the root element
    indexTokens: { … },  // pre-extracted search tokens
  }
})
```

The background script forwards this to the sidebar via `browser.extension.getViews({ type: "sidebar" })`. The sidebar shows a preview and lets the user choose a bag before committing the save.

---

## Why tokens are pre-extracted

Tokens could be extracted at query time from the stored HTML. Pre-extraction at clip time costs a bit of storage but provides three benefits:

1. Export/import can rebuild the full search index without needing to re-parse HTML.
2. Friend clips (received over the P2P layer) include pre-extracted tokens, so their source pages don't need to be fetched.
3. Tokenisation at clip time has access to the live DOM (aria-labelledby targets, computed roles, etc.) that a parser-only approach would miss.

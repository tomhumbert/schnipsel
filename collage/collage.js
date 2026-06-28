/**
 * Collage / search page.
 *
 * On load:
 *   1. Registers itself as a Firefox OpenSearch engine (via a dynamically
 *      generated descriptor blob). Firefox detects the <link rel="search">
 *      and adds Schnipsel to the address-bar search-engine dropdown.
 *   2. If ?q=<query> is in the URL (from an address-bar search), runs the
 *      search immediately.
 *   3. Applies saved theme preferences.
 *   4. Initialises the collage canvas (tray + canvas state).
 */

// ----------------------------------------------------------------
// Boot
// ----------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  await applyStoredTheme();
  bindThemeControls();
  registerOpenSearch();
  bindTabSwitcher();
  bindSearchForm();

  const q = new URLSearchParams(location.search).get("q");
  if (q) {
    document.getElementById("search-input").value = q;
    await runSearch(q);
  }

  await initCollage();
});

// ----------------------------------------------------------------
// OpenSearch registration
//
// Firefox discovers a search engine when a page has:
//   <link rel="search" type="application/opensearchdescription+xml" href="…">
// We generate the XML as a Blob at runtime so the extension URL
// (which includes the dynamic UUID) is always correct.
// ----------------------------------------------------------------

function registerOpenSearch() {
  const pageUrl   = location.href.split("?")[0];   // collage/index.html, no query
  const searchUrl = pageUrl + "?q={searchTerms}";
  const iconUrl   = browser.runtime.getURL("icons/schnipsel-48.png");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Schnipsel</ShortName>
  <Description>Search your clipped web content across all bags</Description>
  <Url type="text/html" method="get" template="${searchUrl}"/>
  <Image width="48" height="48" type="image/png">${iconUrl}</Image>
  <InputEncoding>UTF-8</InputEncoding>
</OpenSearchDescription>`;

  const blob    = new Blob([xml], { type: "application/opensearchdescription+xml" });
  const blobUrl = URL.createObjectURL(blob);

  const link    = document.createElement("link");
  link.rel      = "search";
  link.type     = "application/opensearchdescription+xml";
  link.title    = "Schnipsel";
  link.href     = blobUrl;
  document.head.appendChild(link);
}

// ----------------------------------------------------------------
// Theme (mirrors sidebar logic, reads same storage key)
// ----------------------------------------------------------------

async function applyStoredTheme() {
  const { theme } = await browser.storage.local.get("theme");
  setMode(theme?.mode   || "light", false);
  setAccent(theme?.accent || "red",  false);
}

function setMode(mode, save = true) {
  document.documentElement.dataset.mode = mode;
  document.getElementById("btn-mode").textContent = mode === "dark" ? "☾" : "☀";
  if (save) browser.storage.local.set({ theme: currentTheme() });
}

function setAccent(accent, save = true) {
  document.documentElement.dataset.accent = accent;
  document.querySelectorAll(".accent-dot").forEach((dot) => {
    dot.classList.toggle("active", dot.dataset.accent === accent);
  });
  if (save) browser.storage.local.set({ theme: currentTheme() });
}

function currentTheme() {
  return {
    mode:   document.documentElement.dataset.mode,
    accent: document.documentElement.dataset.accent,
  };
}

function bindThemeControls() {
  document.getElementById("btn-mode").addEventListener("click", () => {
    setMode(document.documentElement.dataset.mode === "dark" ? "light" : "dark");
  });
  document.querySelectorAll(".accent-dot").forEach((dot) => {
    dot.addEventListener("click", () => setAccent(dot.dataset.accent));
  });
}

// ----------------------------------------------------------------
// Tab switcher
// ----------------------------------------------------------------

function bindTabSwitcher() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === target)
      );
      document.querySelectorAll(".tab-panel").forEach((panel) =>
        panel.classList.toggle("active", panel.id === `tab-${target}`)
      );
      // Cards rendered while the collage panel was hidden couldn't be scaled
      // (a hidden element has zero width). Now that it's visible, re-fit them.
      if (target === "collage") requestAnimationFrame(rescaleAllCards);
    });
  });
}

// Re-fit every canvas card's content to its current body size. Safe to call any
// time; needed after the collage panel becomes visible (see bindTabSwitcher).
function rescaleAllCards() {
  const c = currentCanvas();
  if (!c) return;
  const byUid = Object.fromEntries(c.items.map((i) => [i.uid, i]));
  document.querySelectorAll(".canvas-card").forEach((card) => {
    const item = byUid[card.dataset.uid];
    if (item) applyCardScale(card, item);
  });
}

// ----------------------------------------------------------------
// Search
// ----------------------------------------------------------------

function bindSearchForm() {
  document.getElementById("search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = document.getElementById("search-input").value.trim();
    if (!q) return;
    // Update the URL so the page is bookmarkable / shareable
    history.replaceState({}, "", "?q=" + encodeURIComponent(q));
    await runSearch(q);
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    document.getElementById("search-input").value = "";
    document.getElementById("results-section").classList.add("hidden");
    history.replaceState({}, "", location.pathname);
  });

  document.getElementById("btn-toggle-peers").addEventListener("click", () => {
    document.getElementById("peer-picker").classList.toggle("hidden");
  });

  initPeerPicker();
}

// --- Advanced search: choose which peers to include ---

async function initPeerPicker() {
  const picker = document.getElementById("peer-picker");
  let me, friends;
  try {
    ({ me, friends } = await browser.runtime.sendMessage({ type: "GET_PEERS" }));
  } catch (_) { return; }

  picker.innerHTML = "";
  const mkRow = (value, label, avatar) => {
    const row = document.createElement("label");
    row.className = "peer-row";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = value; cb.checked = true;
    cb.addEventListener("change", () => {});
    const av = document.createElement("span");
    av.className = "avatar avatar-xs";
    setAvatarEl(av, avatar, value === "me" ? "🙂" : "👤");
    const name = document.createElement("span");
    name.textContent = label;
    row.append(cb, av, name);
    return row;
  };

  picker.appendChild(mkRow("me", "You" + (me?.name ? ` (${me.name})` : ""), me?.avatar));
  for (const f of friends || []) {
    picker.appendChild(mkRow(f.fingerprint, f.name || "(unnamed friend)", f.avatar));
  }
  if (!friends || friends.length === 0) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Add friends to search their public bags too.";
    picker.appendChild(note);
  }
}

// Selected peers for the query, or null when everything is selected (= everyone).
function currentPeers() {
  const boxes = [...document.querySelectorAll("#peer-picker input[type=checkbox]")];
  if (boxes.length === 0) return null;
  const checked = boxes.filter((b) => b.checked).map((b) => b.value);
  if (checked.length === boxes.length) return null;
  return checked;
}

async function runSearch(query) {
  const { results } = await browser.runtime.sendMessage({
    type: "SEARCH", query, peers: currentPeers(),
  });
  renderResults(results || [], query);
}

function renderResults(results, query) {
  const section = document.getElementById("results-section");
  const grid    = document.getElementById("results-grid");
  const count   = document.getElementById("results-count");

  section.classList.remove("hidden");
  grid.innerHTML = "";
  count.textContent = results.length === 0
    ? "No results"
    : `${results.length} clip${results.length === 1 ? "" : "s"}`;

  if (results.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        Nothing matches <em>"${esc(query)}"</em>.
      </div>`;
    return;
  }

  for (const r of results) {
    grid.appendChild(buildClipCard(r.clip, r.owner));
  }
}

function buildClipCard(clip, owner = { kind: "me" }) {
  const isFriend = owner && owner.kind === "friend";
  const card = document.createElement("div");
  card.className = "clip-card fade-in";

  const thumb = document.createElement("div");
  thumb.className = "clip-thumb";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", sanitize.IFRAME_SANDBOX);
  iframe.srcdoc = sanitize.srcdoc(clip.html, { allowRemote: !isFriend });
  thumb.appendChild(iframe);

  const meta   = document.createElement("div");
  meta.className = "clip-meta";

  const title  = document.createElement("div");
  title.className = "clip-title";
  title.textContent = clip.pageTitle || clip.sourceUrl || "Untitled";

  const footer = document.createElement("div");
  footer.className = "clip-footer";

  const source = document.createElement("span");
  source.className = "clip-source";
  try {
    source.textContent = new URL(clip.sourceUrl).hostname;
    source.title       = clip.sourceUrl;
  } catch (_) {
    source.textContent = clip.sourceUrl || "";
  }

  const visitBtn = document.createElement("a");
  visitBtn.className = "btn-visit";
  visitBtn.textContent = "↗ visit";
  visitBtn.href   = clip.sourceUrl;
  visitBtn.target = "_blank";
  visitBtn.rel    = "noopener noreferrer";

  footer.append(source, visitBtn);
  meta.append(title, footer);

  // Verified provenance badge for friend-sourced clips.
  if (isFriend) {
    const badge = document.createElement("div");
    badge.className = "clip-owner";
    const av = document.createElement("span");
    av.className = "avatar avatar-xs";
    setAvatarEl(av, owner.avatar, "👤");
    const who = document.createElement("span");
    who.textContent = "from " + (owner.name || "a friend");
    badge.append(av, who);
    card.appendChild(badge);
  }

  card.append(thumb, meta);
  return card;
}

// Render an avatar into an element: an <img> for a data URL, else a fallback glyph.
function setAvatarEl(el, dataUrl, fallback = "👤") {
  el.innerHTML = "";
  if (dataUrl) {
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "";
    el.appendChild(img);
    el.classList.add("has-img");
  } else {
    el.textContent = fallback;
    el.classList.remove("has-img");
  }
}

// ----------------------------------------------------------------
// Collage — data
//
// Storage key "collageData":
//   { canvases: { [id]: { id, name, items[] } }, currentCanvasId: string }
//
// Each item: { uid, clipId, x, y, w, h, rotation }
// ----------------------------------------------------------------

/** In-memory clip map: clipId → clip object. Populated on initCollage. */
let clipMap = {};

/** All canvases. { [id]: { id, name, items[] } } */
let canvases = {};
/** ID of the currently visible canvas. */
let currentCanvasId = null;
/** Tracks the last drop position for stacking offset. */
let lastDropPos = { x: 40, y: 40 };

function currentCanvas() {
  return canvases[currentCanvasId] || null;
}

async function loadClipMap() {
  try {
    const { clips } = await browser.runtime.sendMessage({ type: "GET_CLIPS" });
    clipMap = {};
    for (const clip of clips || []) clipMap[clip.id] = clip;
  } catch (_) { clipMap = {}; }
}

async function loadCollageData() {
  try {
    const stored = await browser.storage.local.get("collageData");
    const data = stored.collageData;
    if (data && data.canvases && Object.keys(data.canvases).length > 0) {
      canvases = data.canvases;
      currentCanvasId = data.currentCanvasId && canvases[data.currentCanvasId]
        ? data.currentCanvasId
        : Object.keys(canvases)[0];
    } else {
      // First run — create a default canvas
      const id = uid8();
      canvases = { [id]: { id, name: "My first collage", items: [] } };
      currentCanvasId = id;
      await saveCollageData();
    }
  } catch (_) {
    const id = uid8();
    canvases = { [id]: { id, name: "My first collage", items: [] } };
    currentCanvasId = id;
  }
}

async function saveCollageData() {
  try {
    await browser.storage.local.set({ collageData: { canvases, currentCanvasId } });
  } catch (_) {}
}

// ----------------------------------------------------------------
// Collage — init
// ----------------------------------------------------------------

async function initCollage() {
  await Promise.all([loadClipMap(), loadCollageData()]);

  renderTrayAsync();
  renderCanvasSelect();
  renderCanvasItems();
  updateDropHint();

  document.getElementById("tray-search").addEventListener("input", (e) => {
    renderTrayAsync(e.target.value.trim().toLowerCase());
  });

  const canvas = document.getElementById("collage-canvas");
  canvas.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  canvas.addEventListener("drop", handleCanvasDrop);

  document.getElementById("canvas-select").addEventListener("change", (e) => {
    switchCanvas(e.target.value);
  });
  document.getElementById("btn-new-canvas").addEventListener("click", createCanvas);
  document.getElementById("btn-delete-canvas").addEventListener("click", deleteCanvas);
  document.getElementById("btn-export").addEventListener("click", exportCanvas);
  document.getElementById("btn-clear-canvas").addEventListener("click", clearCanvas);
}

// ----------------------------------------------------------------
// Collage — canvas management
// ----------------------------------------------------------------

function renderCanvasSelect() {
  const sel = document.getElementById("canvas-select");
  sel.innerHTML = "";
  for (const c of Object.values(canvases)) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    opt.selected = c.id === currentCanvasId;
    sel.appendChild(opt);
  }
  // Only allow delete when more than one canvas exists
  document.getElementById("btn-delete-canvas").disabled = Object.keys(canvases).length <= 1;
}

async function createCanvas() {
  const name = prompt("Canvas name:", `Collage ${Object.keys(canvases).length + 1}`);
  if (!name) return;
  const id = uid8();
  canvases[id] = { id, name: name.trim() || "Untitled", items: [] };
  await saveCollageData();
  switchCanvas(id);
}

async function switchCanvas(id) {
  if (!canvases[id]) return;
  currentCanvasId = id;
  await saveCollageData();
  renderCanvasSelect();
  clearCanvasDOM();
  lastDropPos = { x: 40, y: 40 };
  renderCanvasItems();
  updateDropHint();
}

async function deleteCanvas() {
  const ids = Object.keys(canvases);
  if (ids.length <= 1) return;
  const c = currentCanvas();
  if (!c) return;
  if (!confirm(`Delete canvas "${c.name}"? This cannot be undone.`)) return;
  delete canvases[currentCanvasId];
  currentCanvasId = Object.keys(canvases)[0];
  await saveCollageData();
  renderCanvasSelect();
  clearCanvasDOM();
  renderCanvasItems();
  updateDropHint();
}

function clearCanvasDOM() {
  document.querySelectorAll(".canvas-card").forEach((el) => el.remove());
}

function renderCanvasItems() {
  const c = currentCanvas();
  if (!c) return;
  for (const item of c.items) renderCanvasCard(item);
  growCanvasToFit();
}

// ----------------------------------------------------------------
// Collage — tray
// ----------------------------------------------------------------

function renderTrayAsync(filterText = "") {
  renderTray(filterText).catch(() => {});
}

async function renderTray(filterText = "") {
  const trayList = document.getElementById("tray-list");

  let bags = [];
  try {
    const res = await browser.runtime.sendMessage({ type: "GET_BAGS" });
    bags = res.bags || [];
  } catch (_) {}

  trayList.innerHTML = "";

  if (bags.length === 0) {
    trayList.innerHTML = '<div class="tray-empty">No bags yet. Save some clips first.</div>';
    return;
  }

  let anyVisible = false;

  for (const bag of bags) {
    const clips = (bag.clipIds || [])
      .map((id) => clipMap[id])
      .filter(Boolean);

    const matchingClips = filterText
      ? clips.filter((c) => clipMatchesFilter(c, filterText))
      : clips;

    if (matchingClips.length === 0) continue;
    anyVisible = true;

    const bagEl = document.createElement("div");
    bagEl.className = "tray-bag open";

    const header = document.createElement("div");
    header.className = "tray-bag-header";
    header.innerHTML = `
      <span class="tray-bag-arrow">▶</span>
      <span class="tray-bag-name">${esc(bag.name || "Unnamed bag")}</span>
      <span class="tray-bag-count">${matchingClips.length}</span>
    `;
    header.addEventListener("click", () => {
      bagEl.classList.toggle("open");
    });

    const clipsEl = document.createElement("div");
    clipsEl.className = "tray-bag-clips";

    for (const clip of matchingClips) {
      clipsEl.appendChild(buildTrayClip(clip));
    }

    bagEl.append(header, clipsEl);
    trayList.appendChild(bagEl);
  }

  if (!anyVisible) {
    trayList.innerHTML = '<div class="tray-empty">No clips match your filter.</div>';
  }
}

function clipMatchesFilter(clip, filterText) {
  const haystack = [
    clip.pageTitle || "",
    clip.sourceUrl || "",
  ].join(" ").toLowerCase();
  return haystack.includes(filterText);
}

function filterTray(text) {
  renderTray(text);
}

function buildTrayClip(clip) {
  const el = document.createElement("div");
  el.className = "tray-clip";
  el.draggable = true;
  el.dataset.clipId = clip.id;

  let hostname = "";
  try { hostname = new URL(clip.sourceUrl).hostname; } catch (_) {}

  const thumbEl = document.createElement("div");
  thumbEl.className = "tray-clip-thumb";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", sanitize.IFRAME_SANDBOX);
  iframe.srcdoc = sanitize.srcdoc(clip.html);
  thumbEl.appendChild(iframe);

  const infoEl = document.createElement("div");
  infoEl.className = "tray-clip-info";
  infoEl.innerHTML = `
    <div class="tray-clip-title">${esc(clip.pageTitle || hostname || "Untitled")}</div>
    <div class="tray-clip-host">${esc(hostname)}</div>
    <div class="tray-drag-hint">drag me</div>
  `;

  el.append(thumbEl, infoEl);

  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", clip.id);
    e.dataTransfer.effectAllowed = "copy";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
  });

  return el;
}

// ----------------------------------------------------------------
// Collage — canvas drop
// ----------------------------------------------------------------

function handleCanvasDrop(e) {
  e.preventDefault();
  const clipId = e.dataTransfer.getData("text/plain");
  if (!clipId || !clipMap[clipId]) return;

  const c = currentCanvas();
  if (!c) return;

  const canvas = document.getElementById("collage-canvas");
  const rect   = canvas.getBoundingClientRect();
  const wrap   = canvas.parentElement;
  let x = e.clientX - rect.left + wrap.scrollLeft;
  let y = e.clientY - rect.top  + wrap.scrollTop;

  x = Math.max(0, x - 20);
  y = Math.max(0, y - 14);

  if (Math.abs(x - lastDropPos.x) < 10 && Math.abs(y - lastDropPos.y) < 10) {
    x += 20; y += 20;
  }
  lastDropPos = { x, y };

  const naturalW = clipNaturalWidth(clipMap[clipId]);
  const item = { uid: uid8(), clipId, x, y, w: 320, h: 240, rotation: 0, naturalW, z: nextZ() };
  c.items.push(item);
  saveCollageData();
  renderCanvasCard(item);
  growCanvasToFit();
  updateDropHint();
}

// The clip wrapper records the element's on-page width as `width:Npx`.
// We use it as the content's natural width so the card can scale it to fit.
function clipNaturalWidth(clip) {
  const m = /width:\s*(\d+)px/.exec((clip && clip.html) || "");
  return m ? parseInt(m[1], 10) : 320;
}

// ----------------------------------------------------------------
// Collage — stacking order (z-index)
// ----------------------------------------------------------------

function zValues() {
  const c = currentCanvas();
  return (c?.items || []).map((it) => (typeof it.z === "number" ? it.z : 0));
}

// Next free z above everything currently placed.
function nextZ() {
  const zs = zValues();
  return (zs.length ? Math.max(...zs) : 0) + 1;
}

function applyZ(item, card) {
  card.style.zIndex = item.z;
  saveCollageData();
}

function bringToFront(item, card) {
  const max = Math.max(0, ...zValues());
  if (item.z === max && zValues().filter((z) => z === max).length === 1) return;
  item.z = max + 1;
  applyZ(item, card);
}

function sendToBack(item, card) {
  const min = Math.min(0, ...zValues());
  item.z = min - 1;
  applyZ(item, card);
}

// ----------------------------------------------------------------
// Collage — canvas card rendering
// ----------------------------------------------------------------

function renderCanvasCard(item) {
  const clip = clipMap[item.clipId];
  if (!clip) return;

  // Backfill natural width for items saved before content scaling existed.
  if (!item.naturalW) item.naturalW = clipNaturalWidth(clip);

  let hostname = "";
  try { hostname = new URL(clip.sourceUrl).hostname; } catch (_) {}

  const card = document.createElement("div");
  card.className = "canvas-card fade-in";
  card.dataset.uid = item.uid;
  // Backfill stacking order for items saved before z-index existed.
  if (typeof item.z !== "number") item.z = nextZ();
  card.style.left      = `${item.x}px`;
  card.style.top       = `${item.y}px`;
  card.style.width     = `${item.w}px`;
  card.style.height    = `${item.h}px`;
  card.style.zIndex    = item.z;
  card.style.transform = `rotate(${item.rotation || 0}deg)`;

  // Rotate handle (above card, centred)
  const rotateHandle = document.createElement("div");
  rotateHandle.className = "canvas-card-rotate";
  rotateHandle.title = "Rotate";
  rotateHandle.textContent = "⟳";

  // Title bar
  const titlebar = document.createElement("div");
  titlebar.className = "canvas-card-titlebar";

  const hostSpan = document.createElement("span");
  hostSpan.className = "canvas-card-host";
  hostSpan.textContent = hostname || clip.pageTitle || "Untitled";
  hostSpan.title = clip.sourceUrl || "";

  const visitLink = document.createElement("a");
  visitLink.className = "canvas-card-visit";
  visitLink.textContent = "↗";
  visitLink.href = clip.sourceUrl || "#";
  visitLink.target = "_blank";
  visitLink.rel = "noopener noreferrer";
  visitLink.title = "Visit original page";

  const frontBtn = document.createElement("button");
  frontBtn.className = "canvas-card-layer";
  frontBtn.textContent = "⤒";
  frontBtn.title = "Bring to front";
  frontBtn.addEventListener("click", () => bringToFront(item, card));

  const backBtn = document.createElement("button");
  backBtn.className = "canvas-card-layer";
  backBtn.textContent = "⤓";
  backBtn.title = "Send to back";
  backBtn.addEventListener("click", () => sendToBack(item, card));

  const closeBtn = document.createElement("button");
  closeBtn.className = "canvas-card-close";
  closeBtn.textContent = "×";
  closeBtn.title = "Remove from canvas";
  closeBtn.addEventListener("click", () => removeCanvasCard(item.uid));

  titlebar.append(hostSpan, frontBtn, backBtn, visitLink, closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "canvas-card-body";
  const iframe = document.createElement("iframe");
  // allow-popups + escape lets links inside the clip open in a new tab;
  // the injected <base target="_blank"> routes every click there. No allow-scripts
  // and no allow-same-origin: framed clip content stays inert with an opaque origin.
  iframe.setAttribute("sandbox", sanitize.IFRAME_SANDBOX_POPUP);
  iframe.srcdoc = sanitize.srcdoc(clip.html, { extraHead: `<base target="_blank">` });
  body.appendChild(iframe);

  // Resize handle
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "canvas-card-resize";
  resizeHandle.textContent = "◢";
  resizeHandle.title = "Resize";

  // Inner wrapper clips the visible card content; outer card stays overflow:visible for the rotate handle
  const inner = document.createElement("div");
  inner.className = "canvas-card-inner";
  inner.append(titlebar, body);
  card.append(rotateHandle, inner, resizeHandle);
  document.getElementById("collage-canvas").appendChild(card);

  // Scale the clip content to fit the card once layout has settled.
  requestAnimationFrame(() => applyCardScale(card, item));

  bindCardMove(card, titlebar, item);
  bindCardResize(card, resizeHandle, item);
  bindCardRotate(card, rotateHandle, item);
}

// Scale the clip's content (rendered at its natural width) so it fills the
// card body's current width — content zooms with the frame as you resize.
function applyCardScale(card, item) {
  const body   = card.querySelector(".canvas-card-body");
  const iframe = card.querySelector(".canvas-card-body iframe");
  if (!body || !iframe) return;
  const naturalW = item.naturalW || 320;
  const bodyW = body.clientWidth;
  const bodyH = body.clientHeight;
  if (bodyW <= 0) return;
  const scale = bodyW / naturalW;
  iframe.style.width  = `${naturalW}px`;
  iframe.style.height = `${bodyH / scale}px`;
  iframe.style.transform = `scale(${scale})`;
}

// While a drag/resize/rotate is in progress we must stop the card iframes
// from swallowing mousemove events (otherwise the pointer crossing an iframe
// freezes the gesture). Toggling this class disables iframe hit-testing for
// the duration of the interaction.
function setInteracting(on) {
  const canvas = document.getElementById("collage-canvas");
  if (canvas) canvas.classList.toggle("interacting", on);
}

// Coalesce expensive layout work (reflows from measuring/sizing) to one run
// per animation frame instead of once per mousemove.
function rafThrottle(fn) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...args);
    });
  };
}

// Grow the canvas so its dotted background always covers every card, even
// ones dragged past the original viewport edge.
function growCanvasToFit() {
  const c = currentCanvas();
  const canvas = document.getElementById("collage-canvas");
  if (!canvas) return;
  const wrap = canvas.parentElement;
  let maxR = 0, maxB = 0;
  for (const it of (c?.items || [])) {
    maxR = Math.max(maxR, it.x + it.w);
    maxB = Math.max(maxB, it.y + it.h);
  }
  canvas.style.minWidth  = `${Math.max(wrap.clientWidth,  maxR + 200)}px`;
  canvas.style.minHeight = `${Math.max(wrap.clientHeight, maxB + 200)}px`;
}

function removeCanvasCard(uid) {
  const c = currentCanvas();
  if (c) c.items = c.items.filter((i) => i.uid !== uid);
  saveCollageData();
  const el = document.querySelector(`.canvas-card[data-uid="${uid}"]`);
  if (el) el.remove();
  updateDropHint();
}

function updateDropHint() {
  const hint = document.getElementById("canvas-drop-hint");
  if (!hint) return;
  const c = currentCanvas();
  if (!c || c.items.length === 0) {
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }
}

// ----------------------------------------------------------------
// Collage — card move (mousedown on titlebar)
// ----------------------------------------------------------------

function bindCardMove(card, handle, item) {
  handle.addEventListener("mousedown", (startEvt) => {
    // Don't start drag if clicking a button/link inside the titlebar
    if (startEvt.target.tagName === "BUTTON" || startEvt.target.tagName === "A") return;
    startEvt.preventDefault();

    const startX = startEvt.clientX;
    const startY = startEvt.clientY;
    const origX  = item.x;
    const origY  = item.y;

    // Interacting with a card raises it above the others (and persists).
    bringToFront(item, card);
    setInteracting(true);
    const grow = rafThrottle(growCanvasToFit);

    function onMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      item.x = Math.max(0, origX + dx);
      item.y = Math.max(0, origY + dy);
      card.style.left = `${item.x}px`;
      card.style.top  = `${item.y}px`;
      grow();
    }

    function onUp() {
      setInteracting(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      growCanvasToFit();
      saveCollageData();
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ----------------------------------------------------------------
// Collage — card resize (mousedown on resize handle)
// ----------------------------------------------------------------

function bindCardResize(card, handle, item) {
  handle.addEventListener("mousedown", (startEvt) => {
    startEvt.preventDefault();
    startEvt.stopPropagation();

    const startX = startEvt.clientX;
    const startY = startEvt.clientY;
    const origW  = item.w;
    const origH  = item.h;

    bringToFront(item, card);
    setInteracting(true);
    const refresh = rafThrottle(() => {
      applyCardScale(card, item);
      growCanvasToFit();
    });

    function onMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      item.w = Math.max(160, origW + dx);
      item.h = Math.max(120, origH + dy);
      card.style.width  = `${item.w}px`;
      card.style.height = `${item.h}px`;
      refresh();
    }

    function onUp() {
      setInteracting(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      applyCardScale(card, item);
      growCanvasToFit();
      saveCollageData();
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ----------------------------------------------------------------
// Collage — card rotate
// ----------------------------------------------------------------

function bindCardRotate(card, handle, item) {
  handle.addEventListener("mousedown", (startEvt) => {
    startEvt.preventDefault();
    startEvt.stopPropagation();

    // Capture card centre in screen coordinates at drag start
    const rect = card.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;

    // Initial angle offset so the handle doesn't snap on pickup
    const startAngle = Math.atan2(startEvt.clientY - cy, startEvt.clientX - cx) * (180 / Math.PI);
    const startRotation = item.rotation || 0;

    bringToFront(item, card);
    setInteracting(true);

    function onMove(e) {
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
      item.rotation = (startRotation + angle - startAngle + 360) % 360;
      card.style.transform = `rotate(${item.rotation}deg)`;
    }

    function onUp() {
      setInteracting(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveCollageData();
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ----------------------------------------------------------------
// Collage — clear canvas
// ----------------------------------------------------------------

function clearCanvas() {
  const c = currentCanvas();
  if (!c || c.items.length === 0) return;
  if (!confirm(`Clear all items from "${c.name}"?`)) return;
  c.items = [];
  saveCollageData();
  clearCanvasDOM();
  growCanvasToFit();
  updateDropHint();
}

// ----------------------------------------------------------------
// Collage — export
// ----------------------------------------------------------------

function exportCanvas() {
  const c = currentCanvas();
  if (!c || c.items.length === 0) {
    alert("The canvas is empty — add some clips first.");
    return;
  }

  const date = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });

  let maxRight = 0;
  let maxBottom = 0;
  for (const item of c.items) {
    maxRight  = Math.max(maxRight,  item.x + item.w);
    maxBottom = Math.max(maxBottom, item.y + item.h);
  }

  const cardHtml = c.items.map((item) => {
    const clip = clipMap[item.clipId];
    if (!clip) return "";
    let hostname = "";
    try { hostname = new URL(clip.sourceUrl).hostname; } catch (_) {}

    // Scale the clip content to fit the card, matching the editor.
    const naturalW = item.naturalW || clipNaturalWidth(clip);
    const bodyW = item.w;
    const bodyH = item.h - 29; // minus title bar
    const scale = bodyW / naturalW;
    const iframeStyle =
      `width:${naturalW}px;height:${bodyH / scale}px;border:none;display:block;` +
      `transform:scale(${scale});transform-origin:top left;`;
    // Sanitize + wrap with the clip CSP at build time, so the exported standalone
    // file (which has no access to DOMPurify) still carries inert, locked-down clips.
    const srcdoc = sanitize.srcdoc(clip.html || "", { extraHead: `<base target="_blank">` });

    return `
  <div class="card" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;z-index:${item.z || 0};transform:rotate(${item.rotation || 0}deg);">
    <div class="card-titlebar">
      <span class="card-host">${esc(hostname || clip.pageTitle || "Untitled")}</span>
      <a class="card-visit" href="${esc(clip.sourceUrl || "#")}" target="_blank" rel="noopener noreferrer">↗ visit</a>
    </div>
    <div class="card-body">
      <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc(srcdoc)}" style="${iframeStyle}"></iframe>
    </div>
  </div>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>✂ Schnipsel Collage — ${esc(date)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', monospace, system-ui, sans-serif;
      background: #ffffff;
      color: #2a2520;
      min-height: 100vh;
    }
    .export-header {
      padding: 16px 24px;
      border-bottom: 1px solid rgba(0,0,0,0.10);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255,255,255,0.80);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .export-logo {
      font-size: 16px;
      font-weight: 700;
      background: linear-gradient(90deg, #c0392b, #e74c3c);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .export-date {
      font-size: 11px;
      color: #8a8178;
      letter-spacing: 0.04em;
    }
    .canvas {
      position: relative;
      width: ${maxRight + 40}px;
      min-height: ${maxBottom + 40}px;
      background-image: radial-gradient(circle, rgba(0,0,0,0.12) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    .card {
      position: absolute;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.10);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 4px 28px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08);
    }
    .card-titlebar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      background: rgba(0,0,0,0.03);
      border-bottom: 1px solid rgba(0,0,0,0.08);
      flex-shrink: 0;
      min-height: 28px;
    }
    .card-host {
      flex: 1;
      font-size: 10px;
      color: #8a8178;
      font-family: 'Courier New', monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-visit {
      font-size: 10px;
      color: #c0392b;
      text-decoration: none;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .card-body {
      flex: 1;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="export-header">
    <span class="export-logo">✂ Schnipsel</span>
    <span class="export-date">Exported ${esc(date)}</span>
  </div>
  <div class="canvas">
${cardHtml}
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `schnipsel-collage-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uid8() {
  return Math.random().toString(36).slice(2, 10) +
         Math.random().toString(36).slice(2, 10);
}

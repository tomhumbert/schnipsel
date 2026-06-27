/**
 * Sidebar UI controller.
 *
 * Views:  "bags" (default) | "clips" (bag open) | "search" (query active)
 * Themes: [data-mode="light"|"dark"] × [data-accent="red"|"purple"|"pink"]
 */

let pendingClip  = null;
let currentBagId = null;

// --- Messaging ---

function send(msg) {
  return browser.runtime.sendMessage(msg);
}

// --- Boot ---

document.addEventListener("DOMContentLoaded", async () => {
  await applyStoredTheme();
  bindThemeControls();
  bindUIEvents();
  await renderBags();

  // Clips forwarded from the background script via postMessage
  window.addEventListener("message", (e) => {
    if (e.data?.type === "CLIP_PREVIEW") showPreview(e.data.clip);
  });
});

// ================================================================
// Theme
// ================================================================

async function applyStoredTheme() {
  const { theme } = await browser.storage.local.get("theme");
  const mode   = theme?.mode   || "light";
  const accent = theme?.accent || "red";
  setMode(mode, false);
  setAccent(accent, false);
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
    const next = document.documentElement.dataset.mode === "dark" ? "light" : "dark";
    setMode(next);
  });

  document.querySelectorAll(".accent-dot").forEach((dot) => {
    dot.addEventListener("click", () => setAccent(dot.dataset.accent));
  });
}

// ================================================================
// UI events
// ================================================================

function bindUIEvents() {
  document.getElementById("btn-collect").addEventListener("click", () => {
    send({ type: "ACTIVATE_PICKER" });
  });

  document.getElementById("btn-open-collage").addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("collage/index.html") });
  });

  document.getElementById("btn-save-clip").addEventListener("click", saveClip);
  document.getElementById("btn-discard-clip").addEventListener("click", discardPreview);

  document.getElementById("btn-export-bags").addEventListener("click", exportBags);
  document.getElementById("btn-import-bags").addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });
  document.getElementById("import-file-input").addEventListener("change", importBags);

  document.getElementById("btn-add-bag").addEventListener("click", openNewBagDialog);
  document.getElementById("btn-new-bag").addEventListener("click", openNewBagDialog);
  document.getElementById("btn-create-bag").addEventListener("click", createBag);
  document.getElementById("btn-cancel-bag").addEventListener("click", closeNewBagDialog);

  document.getElementById("btn-back").addEventListener("click", showBagsView);

  document.getElementById("new-bag-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter")  createBag();
    if (e.key === "Escape") closeNewBagDialog();
  });

  let searchTimer;
  document.getElementById("search-input").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length === 0) { showBagsView(); return; }
    searchTimer = setTimeout(() => runSearch(q), 220);
  });
}

// ================================================================
// Preview panel
// ================================================================

function showPreview(clip) {
  pendingClip = clip;
  document.getElementById("preview-frame").srcdoc = clip.html;
  populateBagSelect();
  document.getElementById("preview-panel").classList.remove("hidden");
}

function discardPreview() {
  pendingClip = null;
  document.getElementById("preview-panel").classList.add("hidden");
}

async function saveClip() {
  if (!pendingClip) return;
  const bagId = document.getElementById("bag-select").value;
  if (!bagId || bagId === "__none__") return;
  await send({ type: "SAVE_CLIP", clip: { ...pendingClip, bagId } });
  discardPreview();
  currentBagId === bagId ? await renderClips(bagId) : await renderBags();
}

// ================================================================
// Export / import
// ================================================================

async function exportBags() {
  const { data, error } = await send({ type: "EXPORT_DATA" });
  if (error) { alert("Export failed: " + error); return; }

  const bagCount = Object.keys(data.bags || {}).length;
  if (bagCount === 0) { alert("No bags to export yet."); return; }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `schnipsel-bags-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importBags(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // allow re-importing the same file later
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (_) {
    alert("That file isn't valid JSON.");
    return;
  }

  const res = await send({ type: "IMPORT_DATA", data });
  if (res.error) { alert("Import failed: " + res.error); return; }

  alert(`Imported ${res.clipCount} clip(s) across ${res.bagCount} bag(s) ` +
        `(${res.newBags} new).`);
  await renderBags();
}

async function populateBagSelect() {
  const { bags } = await send({ type: "GET_BAGS" });
  const select = document.getElementById("bag-select");
  select.innerHTML = "";
  if (!bags || bags.length === 0) {
    select.innerHTML = '<option value="__none__">— create a bag first —</option>';
    return;
  }
  for (const bag of bags) {
    const opt = document.createElement("option");
    opt.value = bag.id;
    opt.textContent = bag.name;
    if (bag.id === currentBagId) opt.selected = true;
    select.appendChild(opt);
  }
}

// ================================================================
// Bags view
// ================================================================

async function renderBags() {
  showBagsView();
  const { bags } = await send({ type: "GET_BAGS" });
  const list = document.getElementById("bag-list");
  list.innerHTML = "";

  if (!bags || bags.length === 0) {
    list.innerHTML = `
      <li style="list-style:none">
        <div class="empty-state">
          <span class="empty-icon">🗂</span>
          No bags yet.<br>Create one to start collecting.
        </div>
      </li>`;
    return;
  }

  for (const bag of bags) {
    const li = document.createElement("li");
    li.className = "fade-in";
    if (bag.id === currentBagId) li.classList.add("active");

    li.innerHTML = `
      <span class="bag-icon">🗂</span>
      <span class="bag-name">${esc(bag.name)}</span>
      <span class="bag-count">${bag.clipIds?.length ?? 0}</span>
      <button class="btn-ghost btn-delete-bag" title="Delete bag">×</button>`;

    li.querySelector(".btn-delete-bag").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteBag(bag.id);
    });
    li.addEventListener("click", () => openBag(bag));
    list.appendChild(li);
  }
}

function showBagsView() {
  currentBagId = null;
  document.getElementById("bags-section").classList.remove("hidden");
  document.getElementById("clips-section").classList.add("hidden");
  document.getElementById("search-input").value = "";
}

// ================================================================
// Clips view
// ================================================================

async function openBag(bag) {
  currentBagId = bag.id;
  document.getElementById("current-bag-name").textContent = bag.name;
  document.getElementById("bags-section").classList.add("hidden");
  document.getElementById("clips-section").classList.remove("hidden");
  await renderClips(bag.id);
}

async function renderClips(bagId) {
  const [{ bags }, { clips }] = await Promise.all([
    send({ type: "GET_BAGS" }),
    send({ type: "GET_CLIPS" }),
  ]);
  const bag = (bags || []).find((b) => b.id === bagId);
  if (!bag) return;

  const bagClips = (clips || []).filter((c) => bag.clipIds?.includes(c.id));
  const container = document.getElementById("clip-list");
  container.innerHTML = "";

  if (bagClips.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">✂</span>
        No clips in this bag yet.<br>Use the Clip button to start.
      </div>`;
    return;
  }

  for (const clip of bagClips) {
    container.appendChild(buildClipCard(clip, bagId));
  }
}

function buildClipCard(clip, bagId) {
  const card = document.createElement("div");
  card.className = "clip-card fade-in";

  const thumb = document.createElement("div");
  thumb.className = "clip-thumb";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.srcdoc = clip.html;
  thumb.appendChild(iframe);

  const meta = document.createElement("div");
  meta.className = "clip-meta";

  const source = document.createElement("span");
  source.className = "clip-source";
  try {
    source.textContent = new URL(clip.sourceUrl).hostname;
    source.title = clip.sourceUrl;
  } catch (_) {
    source.textContent = clip.sourceUrl || "";
  }

  const visitBtn = document.createElement("a");
  visitBtn.className = "btn-visit";
  visitBtn.textContent = "↗";
  visitBtn.title = clip.sourceUrl;
  visitBtn.href = clip.sourceUrl;
  visitBtn.target = "_blank";
  visitBtn.rel = "noopener noreferrer";

  const delBtn = document.createElement("button");
  delBtn.className = "btn-ghost";
  delBtn.title = "Remove clip";
  delBtn.textContent = "×";
  delBtn.addEventListener("click", () => deleteClip(clip.id, bagId));

  meta.append(source, visitBtn, delBtn);
  card.append(thumb, meta);
  return card;
}

// ================================================================
// Bag management
// ================================================================

function openNewBagDialog() {
  document.getElementById("new-bag-name").value = "";
  document.getElementById("new-bag-dialog").classList.remove("hidden");
  requestAnimationFrame(() => document.getElementById("new-bag-name").focus());
}

function closeNewBagDialog() {
  document.getElementById("new-bag-dialog").classList.add("hidden");
}

async function createBag() {
  const name = document.getElementById("new-bag-name").value.trim();
  if (!name) return;
  closeNewBagDialog();
  await send({ type: "SAVE_BAG", bag: { name } });
  await renderBags();
  if (pendingClip) await populateBagSelect();
}

async function deleteBag(bagId) {
  await send({ type: "DELETE_BAG", bagId });
  if (currentBagId === bagId) showBagsView();
  await renderBags();
}

async function deleteClip(clipId, bagId) {
  await send({ type: "DELETE_CLIP", clipId });
  if (bagId) await renderClips(bagId);
}

// ================================================================
// Search
// ================================================================

async function runSearch(query) {
  const [{ results: clipIds }, { clips }] = await Promise.all([
    send({ type: "SEARCH", query }),
    send({ type: "GET_CLIPS" }),
  ]);
  const matched = (clips || []).filter((c) => (clipIds || []).includes(c.id));

  document.getElementById("bags-section").classList.add("hidden");
  const section = document.getElementById("clips-section");
  section.classList.remove("hidden");
  document.getElementById("current-bag-name").textContent = `"${query}"`;
  document.getElementById("btn-back").textContent = "← clear";

  const container = document.getElementById("clip-list");
  container.innerHTML = "";

  if (matched.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        No clips match your search.
      </div>`;
    return;
  }

  for (const clip of matched) {
    container.appendChild(buildClipCard(clip, null));
  }
}

// ================================================================
// Helpers
// ================================================================

function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

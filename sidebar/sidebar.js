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
  bindProfileEvents();
  bindFriendEvents();
  await renderProfile();
  await renderFriends();
  await renderBags();

  // Clips forwarded from the background script via postMessage. Only trust
  // messages from our own extension origin (reject any real cross-origin sender).
  window.addEventListener("message", (e) => {
    if (e.origin && e.origin !== location.origin) return;
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
// Profile (you)
// ================================================================

let pendingAvatar = null; // normalized data URL held while the editor is open

async function renderProfile() {
  const { identity: id, profile } = await send({ type: "GET_IDENTITY" });
  setAvatarEl(document.getElementById("profile-avatar"), profile?.avatar);
  const nameEl = document.getElementById("profile-name");
  // textContent only — names are self-asserted, never trusted as markup.
  nameEl.textContent = profile?.name || "Set up your profile";
  nameEl.classList.toggle("muted", !profile?.name);
  document.getElementById("profile-fingerprint").textContent =
    id?.fingerprint ? shortFingerprint(id.fingerprint) : "—";
}

// Render an avatar into an element: an <img> if we have one, else a fallback glyph.
function setAvatarEl(el, dataUrl, fallback = "🙂") {
  el.innerHTML = "";
  if (dataUrl) {
    const img = document.createElement("img");
    img.src = dataUrl;        // a re-encoded data: PNG produced locally — safe
    img.alt = "";
    el.appendChild(img);
    el.classList.add("has-img");
  } else {
    el.textContent = fallback;
    el.classList.remove("has-img");
  }
}

function shortFingerprint(fp) {
  return (fp || "").slice(0, 16).match(/.{1,4}/g)?.join(" ") || "";
}

function bindProfileEvents() {
  const open = () => openProfileDialog();
  document.getElementById("profile-bar").addEventListener("click", open);
  document.getElementById("btn-edit-profile").addEventListener("click", (e) => {
    e.stopPropagation(); open();
  });
  document.getElementById("btn-choose-avatar").addEventListener("click", () =>
    document.getElementById("avatar-file-input").click());
  document.getElementById("avatar-file-input").addEventListener("change", onAvatarChosen);
  document.getElementById("btn-clear-avatar").addEventListener("click", () => {
    pendingAvatar = "";
    setAvatarEl(document.getElementById("profile-avatar-preview"), "");
  });
  document.getElementById("btn-save-profile").addEventListener("click", saveProfile);
  document.getElementById("btn-cancel-profile").addEventListener("click", closeProfileDialog);
  document.getElementById("profile-name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter")  saveProfile();
    if (e.key === "Escape") closeProfileDialog();
  });
}

async function openProfileDialog() {
  const { profile } = await send({ type: "GET_PROFILE" });
  pendingAvatar = null; // null = "unchanged"; "" = cleared
  document.getElementById("profile-name-input").value = profile?.name || "";
  setAvatarEl(document.getElementById("profile-avatar-preview"), profile?.avatar);
  document.getElementById("profile-dialog").classList.remove("hidden");
  requestAnimationFrame(() => document.getElementById("profile-name-input").focus());
}

function closeProfileDialog() {
  document.getElementById("profile-dialog").classList.add("hidden");
  document.getElementById("avatar-file-input").value = "";
  pendingAvatar = null;
}

async function onAvatarChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    pendingAvatar = await normalizeAvatar(file);
    setAvatarEl(document.getElementById("profile-avatar-preview"), pendingAvatar);
  } catch (err) {
    alert(err.message || "That image couldn't be used.");
  }
}

async function saveProfile() {
  const name = document.getElementById("profile-name-input").value;
  const msg = { type: "SAVE_PROFILE", profile: { name } };
  // Only send avatar if it changed (null = unchanged). "" means explicit removal.
  if (pendingAvatar !== null) msg.profile.avatar = pendingAvatar;
  else {
    const { profile } = await send({ type: "GET_PROFILE" });
    msg.profile.avatar = profile?.avatar || "";
  }
  const res = await send(msg);
  if (res.error) { alert("Couldn't save profile: " + res.error); return; }
  closeProfileDialog();
  await renderProfile();
}

/**
 * Turn an uploaded image file into a safe, normalized avatar:
 *   - reject SVG outright (can carry script) and non-raster types,
 *   - cap source bytes + decoded dimensions (decompression-bomb guard),
 *   - re-encode through a 128×128 canvas to a PNG, which strips ALL original
 *     bytes/metadata/embedded payloads — the output is freshly-drawn pixels.
 */
async function normalizeAvatar(file) {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) {
    throw new Error("SVG images aren't allowed (they can contain scripts).");
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error("Please choose a PNG, JPEG, or WEBP image.");
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("Image is too large (max 8 MB).");

  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("That file isn't a valid image."));
    im.src = dataUrl;
  });

  if (img.naturalWidth > 10000 || img.naturalHeight > 10000) {
    throw new Error("Image dimensions are too large.");
  }

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // cover-fit: scale to fill the square, centre-crop the overflow
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/png");
}

// ================================================================
// Friends
// ================================================================

let inspected = null; // { kind, code } currently shown in the add-friend dialog

async function renderFriends() {
  const { friends } = await send({ type: "GET_FRIENDS" });
  const list = document.getElementById("friend-list");
  list.innerHTML = "";

  if (!friends || friends.length === 0) {
    list.innerHTML = `
      <li style="list-style:none">
        <div class="empty-state">
          <span class="empty-icon">👥</span>
          No friends yet.<br>Add one to share public bags.
        </div>
      </li>`;
    return;
  }

  for (const f of friends) {
    const li = document.createElement("li");
    li.className = "friend-item fade-in";

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    setAvatarEl(avatar, f.avatar, "👤");

    const meta = document.createElement("div");
    meta.className = "friend-item-meta";
    const name = document.createElement("span");
    name.className = "friend-name";
    name.textContent = f.name || "(unnamed)"; // textContent — never trust friend markup
    const fp = document.createElement("code");
    fp.className = "friend-fp";
    fp.textContent = shortFingerprint(f.fingerprint);
    meta.append(name, fp);

    const del = document.createElement("button");
    del.className = "btn-ghost btn-remove-friend";
    del.title = "Remove friend";
    del.textContent = "×";
    del.addEventListener("click", () => removeFriend(f));

    li.append(avatar, meta, del);
    list.appendChild(li);
  }
}

async function removeFriend(friend) {
  if (!confirm(`Remove ${friend.name || "this friend"}? Their shared bags will be deleted from your device.`)) return;
  await send({ type: "REMOVE_FRIEND", fingerprint: friend.fingerprint });
  await renderFriends();
}

function bindFriendEvents() {
  document.getElementById("btn-add-friend").addEventListener("click", openFriendsDialog);
  document.getElementById("btn-close-friends").addEventListener("click", closeFriendsDialog);
  document.getElementById("btn-receive-bundle").addEventListener("click", openReceiveDialog);
  document.getElementById("btn-close-receive").addEventListener("click", () =>
    document.getElementById("receive-dialog").classList.add("hidden"));
  document.getElementById("btn-ingest-bundle").addEventListener("click", ingestBundle);
  document.getElementById("btn-create-share").addEventListener("click", createShare);
  document.getElementById("btn-close-share").addEventListener("click", () =>
    document.getElementById("share-dialog").classList.add("hidden"));
  document.getElementById("btn-copy-share").addEventListener("click", () =>
    copyText(document.getElementById("share-code-out").value));
  document.getElementById("btn-gen-invite").addEventListener("click", generateInvite);
  document.getElementById("btn-copy-invite").addEventListener("click", () =>
    copyText(document.getElementById("invite-code-out").value));
  document.getElementById("btn-copy-response").addEventListener("click", () =>
    copyText(document.getElementById("response-code-out").value));
  document.getElementById("btn-check-code").addEventListener("click", checkCode);
  document.getElementById("btn-commit-code").addEventListener("click", commitCode);
}

function openFriendsDialog() {
  // Reset every transient bit of the multi-step dialog.
  inspected = null;
  document.getElementById("invite-code-wrap").classList.add("hidden");
  document.getElementById("invite-code-out").value = "";
  document.getElementById("friend-code-in").value = "";
  document.getElementById("code-result").classList.add("hidden");
  document.getElementById("response-code-wrap").classList.add("hidden");
  document.getElementById("friends-dialog").classList.remove("hidden");
}

function closeFriendsDialog() {
  document.getElementById("friends-dialog").classList.add("hidden");
}

async function generateInvite() {
  const res = await send({ type: "CREATE_INVITE" });
  if (res.error) { alert("Couldn't create invite: " + res.error); return; }
  document.getElementById("invite-code-out").value = res.code;
  document.getElementById("invite-code-wrap").classList.remove("hidden");
}

async function checkCode() {
  const code = document.getElementById("friend-code-in").value.trim();
  if (!code) return;
  const res = await send({ type: "INSPECT_CODE", code });
  if (res.error) { alert(res.error); return; }

  inspected = { kind: res.kind, code };
  setAvatarEl(document.getElementById("result-avatar"), res.party.avatar);
  document.getElementById("result-name").textContent = res.party.name || "(unnamed)";
  document.getElementById("result-fp").textContent = shortFingerprint(res.party.fingerprint);
  document.getElementById("response-code-wrap").classList.add("hidden");

  const isInvite = res.kind === "invite";
  document.getElementById("result-action-hint").textContent = isInvite
    ? "This is an invite. Accepting adds them and creates a reply to send back."
    : "This is a reply to your invite. Confirm to finish adding them.";
  document.getElementById("btn-commit-code").textContent = isInvite ? "Accept & create reply" : "Confirm friend";
  document.getElementById("code-result").classList.remove("hidden");
}

async function commitCode() {
  if (!inspected) return;
  if (inspected.kind === "invite") {
    const res = await send({ type: "ACCEPT_INVITE", code: inspected.code });
    if (res.error) { alert(res.error); return; }
    document.getElementById("response-code-out").value = res.responseCode;
    document.getElementById("response-code-wrap").classList.remove("hidden");
    await renderFriends();
  } else {
    const res = await send({ type: "CONFIRM_RESPONSE", code: inspected.code });
    if (res.error) { alert(res.error); return; }
    await renderFriends();
    closeFriendsDialog();
  }
}

// --- Sharing a public bag with friends ---

let shareBagId = null;

async function openShareDialog(bag) {
  shareBagId = bag.id;
  document.getElementById("share-bag-name").textContent = bag.name;
  document.getElementById("share-code-wrap").classList.add("hidden");
  document.getElementById("share-code-out").value = "";

  const { friends } = await send({ type: "GET_FRIENDS" });
  const list = document.getElementById("share-friend-list");
  list.innerHTML = "";
  if (!friends || friends.length === 0) {
    list.innerHTML = `<p class="hint">Add a friend first — there's no one to share with yet.</p>`;
    document.getElementById("btn-create-share").disabled = true;
  } else {
    document.getElementById("btn-create-share").disabled = false;
    for (const f of friends) {
      const row = document.createElement("label");
      row.className = "share-friend-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = f.fingerprint;
      cb.checked = true;
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      setAvatarEl(avatar, f.avatar, "👤");
      const name = document.createElement("span");
      name.className = "friend-name";
      name.textContent = f.name || "(unnamed)";
      row.append(cb, avatar, name);
      list.appendChild(row);
    }
  }
  document.getElementById("share-dialog").classList.remove("hidden");
}

async function createShare() {
  const recipients = [...document.querySelectorAll("#share-friend-list input:checked")].map((c) => c.value);
  if (recipients.length === 0) { alert("Pick at least one friend."); return; }
  const res = await send({ type: "SHARE_BAG", bagId: shareBagId, recipients });
  if (res.error) { alert("Couldn't create share code: " + res.error); return; }
  document.getElementById("share-code-out").value = res.code;
  document.getElementById("share-code-wrap").classList.remove("hidden");
}

// --- Receiving a shared bag ---

function openReceiveDialog() {
  document.getElementById("receive-code-in").value = "";
  document.getElementById("receive-dialog").classList.remove("hidden");
}

async function ingestBundle() {
  const code = document.getElementById("receive-code-in").value.trim();
  if (!code) return;
  const res = await send({ type: "RECEIVE_BUNDLE", code });
  if (res.error) { alert(res.error); return; }
  document.getElementById("receive-dialog").classList.add("hidden");
  alert(`Received ${res.clipCount} clip(s) from ${res.friend?.name || "a friend"}'s bag "${res.bagName}". ` +
        `Search to see them.`);
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    // Fallback for contexts where the async clipboard API is unavailable.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (__) {}
    document.body.removeChild(ta);
  }
}

// ================================================================
// Preview panel
// ================================================================

function showPreview(clip) {
  pendingClip = clip;
  // Even our own freshly-clipped HTML is rendered through the sanitizer + CSP:
  // the picker clones arbitrary page DOM, so the bytes are never fully trusted.
  document.getElementById("preview-frame").srcdoc = sanitize.srcdoc(clip.html);
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

    const isPublic = bag.visibility === "public";
    li.innerHTML = `
      <span class="bag-icon">🗂</span>
      <span class="bag-name">${esc(bag.name)}</span>
      <span class="bag-count">${bag.clipIds?.length ?? 0}</span>
      ${isPublic ? `<button class="btn-ghost btn-share-bag" title="Share with friends">📤</button>` : ""}
      <button class="btn-ghost btn-bag-vis ${isPublic ? "public" : ""}"
        title="${isPublic ? "Public — shared with friends. Click to make private." : "Private. Click to share with friends."}">${isPublic ? "🌐" : "🔒"}</button>
      <button class="btn-ghost btn-delete-bag" title="Delete bag">×</button>`;

    li.querySelector(".btn-bag-vis").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBagVisibility(bag);
    });
    li.querySelector(".btn-share-bag")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openShareDialog(bag);
    });
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
  document.getElementById("friends-section").classList.remove("hidden");
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
  document.getElementById("friends-section").classList.add("hidden");
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

function buildClipCard(clip, bagId, owner = { kind: "me" }) {
  const isFriend = owner && owner.kind === "friend";
  const card = document.createElement("div");
  card.className = "clip-card fade-in";

  const thumb = document.createElement("div");
  thumb.className = "clip-thumb";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", sanitize.IFRAME_SANDBOX);
  // Friend clips render with the strict (no-remote) CSP so they can't beacon.
  iframe.srcdoc = sanitize.srcdoc(clip.html, { allowRemote: !isFriend });
  thumb.appendChild(iframe);

  // Provenance badge: who this clip came from ("from <friend>"). Verified by key,
  // so it can't be spoofed by a hostile source URL.
  if (isFriend) {
    const badge = document.createElement("div");
    badge.className = "clip-owner";
    const av = document.createElement("span");
    av.className = "avatar avatar-xs";
    setAvatarEl(av, owner.avatar, "👤");
    const who = document.createElement("span");
    who.textContent = "from " + (owner.name || "a friend"); // textContent, untrusted
    badge.append(av, who);
    card.appendChild(badge);
  }

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

  meta.append(source, visitBtn);

  // Only your own clips can be deleted from here (friend clips go when you remove
  // the friend).
  if (!isFriend) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn-ghost";
    delBtn.title = "Remove clip";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => deleteClip(clip.id, bagId));
    meta.append(delBtn);
  }

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

async function toggleBagVisibility(bag) {
  const makePublic = bag.visibility !== "public";
  if (makePublic) {
    const okay = confirm(
      `Make "${bag.name}" public?\n\n` +
      `Its clips — including the source URLs of the pages you visited — will be ` +
      `shareable with your friends, encrypted so only they can read them.\n\n` +
      `You can switch it back to private anytime, but copies you've already shared ` +
      `can't be recalled.`);
    if (!okay) return;
  }
  const res = await send({
    type: "BAG_SET_VISIBILITY",
    bagId: bag.id,
    visibility: makePublic ? "public" : "private",
  });
  if (res.error) { alert(res.error); return; }
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
  // Federated by default: your clips + every friend's public bags.
  const { results } = await send({ type: "SEARCH", query });

  document.getElementById("bags-section").classList.add("hidden");
  document.getElementById("friends-section").classList.add("hidden");
  const section = document.getElementById("clips-section");
  section.classList.remove("hidden");
  document.getElementById("current-bag-name").textContent = `"${query}"`;
  document.getElementById("btn-back").textContent = "← clear";

  const container = document.getElementById("clip-list");
  container.innerHTML = "";

  if (!results || results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        No clips match your search.
      </div>`;
    return;
  }

  for (const r of results) {
    container.appendChild(buildClipCard(r.clip, null, r.owner));
  }
}

// ================================================================
// Helpers
// ================================================================

function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Storage abstraction layer.
 *
 * All clips are identified by a content hash (SHA-256) so the ID scheme is
 * compatible with content-addressed storage backends (IPFS, Hypercore, etc.)
 * when the time comes to go P2P. The current backend is browser.storage.local
 * for metadata and IndexedDB for HTML blobs.
 *
 * Public API:
 *   store.saveClip(clipData)  → clipId
 *   store.getClip(clipId)     → clipData
 *   store.getAllClips()        → [clipData]
 *   store.deleteClip(clipId)
 *   store.saveBag(bag)        → bag
 *   store.getBags()           → [bag]
 *   store.deleteBag(bagId)
 *   store.addClipToBag(clipId, bagId)
 *   store.removeClipFromBag(clipId, bagId)
 */

const DB_NAME = "schnipsel";
const DB_VERSION = 2;
const CLIPS_STORE = "clips";
// Friend-sourced (sanitized) clips live in a separate store keyed `${ownerFp}:${id}`
// so they never mingle with the user's own clips and are easy to purge per friend.
const FRIEND_CLIPS_STORE = "friendClips";

// --- IndexedDB for HTML blobs ---

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CLIPS_STORE)) {
        db.createObjectStore(CLIPS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FRIEND_CLIPS_STORE)) {
        const fs = db.createObjectStore(FRIEND_CLIPS_STORE, { keyPath: "key" });
        fs.createIndex("owner", "owner", { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readwrite");
    tx.objectStore(CLIPS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function idbGet(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readonly");
    const req = tx.objectStore(CLIPS_STORE).get(id);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readonly");
    const req = tx.objectStore(CLIPS_STORE).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readwrite");
    tx.objectStore(CLIPS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Friend-clip IDB helpers ---

async function friendClipPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FRIEND_CLIPS_STORE, "readwrite");
    tx.objectStore(FRIEND_CLIPS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function friendClipsByOwner(owner) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FRIEND_CLIPS_STORE, "readonly");
    const req = tx.objectStore(FRIEND_CLIPS_STORE).index("owner").getAll(owner);
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function friendClipsDeleteByOwner(owner) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FRIEND_CLIPS_STORE, "readwrite");
    const storeObj = tx.objectStore(FRIEND_CLIPS_STORE);
    const req = storeObj.index("owner").openKeyCursor(owner);
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { storeObj.delete(cursor.primaryKey); cursor.continue(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Content hash (SHA-256) for content-addressed IDs ---

async function contentHash(str) {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Bag metadata via browser.storage.local ---

async function getBagMeta() {
  const result = await browser.storage.local.get("bags");
  return result.bags || {};
}

async function saveBagMeta(bags) {
  await browser.storage.local.set({ bags });
}

// --- Public API ---

const store = {
  /**
   * Save a clip. Returns the content-addressed clip ID.
   * clipData: { html, sourceUrl, pageTitle, elementTag, bagId? }
   */
  async saveClip(clipData) {
    const id = await contentHash(clipData.html + clipData.sourceUrl);
    const record = {
      id,
      html: clipData.html,
      sourceUrl: clipData.sourceUrl,
      pageTitle: clipData.pageTitle,
      elementTag: clipData.elementTag,
      // Persist the search tokens so the index can be rebuilt after an
      // import or migration without re-fetching the original page.
      indexTokens: clipData.indexTokens || null,
      savedAt: Date.now(),
    };
    await idbPut(record);

    if (clipData.bagId) {
      await store.addClipToBag(id, clipData.bagId);
    }

    return id;
  },

  async getClip(clipId) {
    return idbGet(clipId);
  },

  async getAllClips() {
    return idbGetAll();
  },

  async deleteClip(clipId) {
    await idbDelete(clipId);
    // Remove from all bags
    const bags = await getBagMeta();
    for (const bag of Object.values(bags)) {
      bag.clipIds = (bag.clipIds || []).filter((id) => id !== clipId);
    }
    await saveBagMeta(bags);
  },

  /**
   * Save or update a bag. Auto-generates an ID if not provided.
   * bag: { name, id? }
   */
  async saveBag(bag) {
    const bags = await getBagMeta();
    const id = bag.id || crypto.randomUUID();
    const prev = bags[id] || {};
    // Bags default to PRIVATE. `version` is a monotonic counter bumped whenever the
    // shareable state changes, so peers can reject stale (replayed) bundles.
    bags[id] = {
      id,
      name: bag.name,
      clipIds: prev.clipIds || [],
      visibility: prev.visibility || "private",
      version: prev.version || 1,
    };
    await saveBagMeta(bags);
    return bags[id];
  },

  async getBags() {
    const bags = await getBagMeta();
    // Lazily fill in defaults for bags created before visibility existed.
    return Object.values(bags).map((b) => ({
      visibility: "private",
      version: 1,
      ...b,
    }));
  },

  /** Flip a bag between "private" and "public"; bumps version on a real change. */
  async setBagVisibility(bagId, visibility) {
    const vis = visibility === "public" ? "public" : "private";
    const bags = await getBagMeta();
    const b = bags[bagId];
    if (!b) return null;
    if (b.visibility !== vis) b.version = (b.version || 1) + 1;
    b.visibility = vis;
    if (!b.version) b.version = 1;
    await saveBagMeta(bags);
    return b;
  },

  async deleteBag(bagId) {
    const bags = await getBagMeta();
    delete bags[bagId];
    await saveBagMeta(bags);
  },

  async addClipToBag(clipId, bagId) {
    const bags = await getBagMeta();
    if (!bags[bagId]) return;
    const ids = bags[bagId].clipIds || [];
    if (!ids.includes(clipId)) {
      bags[bagId].clipIds = [...ids, clipId];
      await saveBagMeta(bags);
    }
  },

  async removeClipFromBag(clipId, bagId) {
    const bags = await getBagMeta();
    if (!bags[bagId]) return;
    bags[bagId].clipIds = (bags[bagId].clipIds || []).filter((id) => id !== clipId);
    await saveBagMeta(bags);
  },

  // --- Profile (self-asserted display name + avatar) ---

  // Bound the avatar payload. The UI re-encodes to a <=128x128 PNG before this is
  // ever called, so anything materially larger is malformed/hostile → reject.
  // (~64KB easily covers a 128px PNG.)
  MAX_AVATAR_BYTES: 64 * 1024,
  MAX_NAME_LEN: 48,

  // Strip control chars, trim, length-cap a display name -> safe plain text.
  cleanDisplayName(name) {
    return String(name == null ? "" : name)
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, store.MAX_NAME_LEN);
  },

  // Accept an avatar only if it's a raster data: URL (png/jpeg/webp) under the byte
  // cap. SVG and every non-data scheme are rejected (SVG can carry script). Returns
  // "" for empty input; throws for anything present but invalid. Used for both our
  // own profile and untrusted friend profiles.
  validateAvatar(avatar) {
    if (!avatar) return "";
    const a = String(avatar);
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(a)) {
      throw new Error("Avatar must be a PNG/JPEG/WEBP image.");
    }
    if (a.length > store.MAX_AVATAR_BYTES * 1.4) throw new Error("Avatar is too large.");
    return a;
  },

  async getProfile() {
    const { profile } = await browser.storage.local.get("profile");
    return profile || { name: "", avatar: "", updatedAt: 0 };
  },

  /** Persist the local user's profile (name + avatar validated above). */
  async saveProfile({ name, avatar }) {
    const profile = {
      name: store.cleanDisplayName(name),
      avatar: store.validateAvatar(avatar),
      updatedAt: Date.now(),
    };
    await browser.storage.local.set({ profile });
    return profile;
  },

  // --- Friends & invites (P2P) ---

  async getFriends() {
    const { friends } = await browser.storage.local.get("friends");
    return Object.values(friends || {});
  },

  async getFriend(fingerprint) {
    const { friends } = await browser.storage.local.get("friends");
    return (friends || {})[fingerprint] || null;
  },

  /**
   * Add (or refresh) a friend. `party` carries untrusted, peer-supplied fields;
   * the name + avatar are re-validated here. The caller (p2p/invites.js) must have
   * already verified the signature and that `fingerprint` matches the public key.
   */
  async addFriend(party) {
    if (!party || !party.fingerprint || !party.signPubJwk || !party.ecdhPubJwk) {
      throw new Error("Incomplete friend identity.");
    }
    const { friends = {} } = await browser.storage.local.get("friends");
    const existing = friends[party.fingerprint];
    friends[party.fingerprint] = {
      fingerprint: party.fingerprint,
      signPubJwk: party.signPubJwk,
      ecdhPubJwk: party.ecdhPubJwk,
      name: store.cleanDisplayName(party.name),
      avatar: store.validateAvatar(party.avatar),
      addedAt: existing?.addedAt || Date.now(),
    };
    await browser.storage.local.set({ friends });
    return friends[party.fingerprint];
  },

  async removeFriend(fingerprint) {
    const { friends = {} } = await browser.storage.local.get("friends");
    delete friends[fingerprint];
    await browser.storage.local.set({ friends });
    // Friend-sourced content is removed alongside the relationship (Phase 5+).
    if (store.removeFriendData) await store.removeFriendData(fingerprint);
  },

  // Pending invites = invites *we* created and are waiting on a reply for. The
  // token correlates an incoming response to one we actually started; confirming a
  // response consumes its token (one-time use).
  async addPendingInvite(token, exp) {
    const { pendingInvites = {} } = await browser.storage.local.get("pendingInvites");
    pendingInvites[token] = { token, exp, createdAt: Date.now() };
    await browser.storage.local.set({ pendingInvites });
  },

  /** True iff `token` matches an unexpired invite we created; consumes it. */
  async consumePendingInvite(token) {
    const { pendingInvites = {} } = await browser.storage.local.get("pendingInvites");
    const inv = pendingInvites[token];
    delete pendingInvites[token];
    // Opportunistically drop expired invites while we're here.
    const now = Date.now();
    for (const [k, v] of Object.entries(pendingInvites)) {
      if (v.exp && v.exp < now) delete pendingInvites[k];
    }
    await browser.storage.local.set({ pendingInvites });
    return !!(inv && (!inv.exp || inv.exp >= now));
  },

  // --- Shared bags (friend-sourced, sanitized content) ---

  // Quota caps — a friend can't fill your disk via shared bags.
  MAX_FRIEND_CLIPS_PER_OWNER: 2000,

  /** All friends' shared-bag metadata: { [ownerFp]: { [bagId]: {…} } }. */
  async getFriendBags() {
    const { friendBags } = await browser.storage.local.get("friendBags");
    return friendBags || {};
  },

  /** Flat list of shared bags across all friends, each tagged with its owner. */
  async getFriendBagsList() {
    const all = await store.getFriendBags();
    const out = [];
    for (const [ownerFp, bags] of Object.entries(all)) {
      for (const bag of Object.values(bags)) out.push({ ...bag, ownerFp });
    }
    return out;
  },

  /** A friend's stored (sanitized) clips, as clip-shaped objects. */
  async getFriendClips(ownerFp) {
    const recs = await friendClipsByOwner(ownerFp);
    return recs.map((r) => ({
      id: r.id, html: r.html, sourceUrl: r.sourceUrl,
      pageTitle: r.pageTitle, indexTokens: r.indexTokens, owner: r.owner,
    }));
  },

  async getFriendIndices() {
    const { friendIndex } = await browser.storage.local.get("friendIndex");
    return friendIndex || {};
  },

  async setFriendIndex(ownerFp, map) {
    const { friendIndex = {} } = await browser.storage.local.get("friendIndex");
    friendIndex[ownerFp] = map;
    await browser.storage.local.set({ friendIndex });
  },

  /**
   * Persist a friend's shared bag + its already-sanitized, hash-verified clips.
   * Enforces the per-friend clip quota. The caller (p2p/transport.js) is
   * responsible for signature/decryption/hash/sanitize before reaching here.
   */
  async saveSharedBagClips(ownerFp, bag, clips) {
    const existing = await friendClipsByOwner(ownerFp);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingNew = clips.filter((c) => !existingIds.has(c.id)).length;
    if (existing.length + incomingNew > store.MAX_FRIEND_CLIPS_PER_OWNER) {
      throw new Error("This friend has shared too much content (quota exceeded).");
    }

    const now = Date.now();
    for (const clip of clips) {
      await friendClipPut({
        key: `${ownerFp}:${clip.id}`,
        owner: ownerFp,
        id: clip.id,
        html: clip.html,
        sourceUrl: clip.sourceUrl,
        pageTitle: clip.pageTitle,
        indexTokens: clip.indexTokens,
        savedAt: now,
      });
    }

    const { friendBags = {} } = await browser.storage.local.get("friendBags");
    friendBags[ownerFp] = friendBags[ownerFp] || {};
    friendBags[ownerFp][bag.id] = {
      id: bag.id,
      name: store.cleanDisplayName(bag.name) || "Shared bag",
      version: bag.version,
      clipIds: clips.map((c) => c.id),
      receivedAt: now,
    };
    await browser.storage.local.set({ friendBags });
    return friendBags[ownerFp][bag.id];
  },

  /** Drop everything a friend ever shared (called when removing the friend). */
  async removeFriendData(ownerFp) {
    await friendClipsDeleteByOwner(ownerFp);
    const { friendBags = {}, friendIndex = {} } =
      await browser.storage.local.get(["friendBags", "friendIndex"]);
    delete friendBags[ownerFp];
    delete friendIndex[ownerFp];
    await browser.storage.local.set({ friendBags, friendIndex });
  },

  // --- Export / import ---

  /**
   * Snapshot every bag and the clips they reference into a single
   * self-contained object. If bagIds is given, only those bags (and the clips
   * they contain) are exported; otherwise everything is exported.
   */
  async exportData(bagIds = null) {
    const allBags = await getBagMeta();
    const bags = bagIds
      ? Object.fromEntries(Object.entries(allBags).filter(([id]) => bagIds.includes(id)))
      : allBags;

    // Only export clips actually referenced by the exported bags.
    const wanted = new Set();
    for (const bag of Object.values(bags)) {
      for (const id of bag.clipIds || []) wanted.add(id);
    }
    const allClips = await idbGetAll();
    const clips = allClips.filter((c) => wanted.has(c.id));

    return {
      schnipsel: true,
      kind: "schnipsel-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      bags,
      clips,
    };
  },

  /**
   * Merge an exported snapshot into the current store. Clips are restored by
   * their content-addressed ID (so duplicates collapse). Bags are merged:
   * an existing bag of the same ID keeps its name and gains the imported
   * clip references; new bags are created. Returns counts and the list of
   * restored clips so the caller can reindex them.
   */
  async importData(data) {
    if (!data || data.kind !== "schnipsel-export") {
      throw new Error("Not a Schnipsel export file.");
    }

    const restoredClips = [];
    for (const clip of data.clips || []) {
      if (clip && clip.id && clip.html) {
        await idbPut(clip);
        restoredClips.push(clip);
      }
    }

    const existing = await getBagMeta();
    let newBags = 0;
    for (const bag of Object.values(data.bags || {})) {
      if (!bag || !bag.id) continue;
      const incoming = bag.clipIds || [];
      if (existing[bag.id]) {
        const union = new Set([...(existing[bag.id].clipIds || []), ...incoming]);
        existing[bag.id].clipIds = [...union];
      } else {
        existing[bag.id] = { id: bag.id, name: bag.name || "Imported bag", clipIds: [...incoming] };
        newBags++;
      }
    }
    await saveBagMeta(existing);

    return {
      clipCount: restoredClips.length,
      newBags,
      bagCount: Object.keys(data.bags || {}).length,
      restoredClips,
    };
  },
};

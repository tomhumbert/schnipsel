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
const DB_VERSION = 1;
const CLIPS_STORE = "clips";

// --- IndexedDB for HTML blobs ---

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CLIPS_STORE)) {
        db.createObjectStore(CLIPS_STORE, { keyPath: "id" });
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
    bags[id] = { id, name: bag.name, clipIds: bags[id]?.clipIds || [] };
    await saveBagMeta(bags);
    return bags[id];
  },

  async getBags() {
    const bags = await getBagMeta();
    return Object.values(bags);
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

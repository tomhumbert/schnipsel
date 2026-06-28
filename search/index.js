/**
 * Search index — persisted to browser.storage.local as a JSON inverted index.
 *
 * Indexes all content types:
 *   - Text nodes (innerText / textContent)
 *   - Images: alt, title, aria-label, figcaption, surrounding prose context
 *   - Links: title, aria-label
 *   - Video / audio: title, aria-label, src filename
 *   - Metadata: page title, source URL domain + path
 *
 * The index format is intentionally simple so it can be serialised and
 * exchanged with a P2P backend later. Each entry is:
 *   { clipId, tokens: [string] }
 * and the index itself is:
 *   { [token]: [clipId] }
 *
 * This is not a ranked relevance engine — it's a fast inclusion filter.
 * Ranking can be layered on top later.
 */

const INDEX_KEY = "searchIndex";

// Tokens are used directly as object keys in the inverted index. These three are
// special property names that, if written, can corrupt the object's prototype
// chain (prototype-pollution). Own clips can't produce them (normalizeTokens
// strips underscores), but friend-sourced tokens are untrusted — reject them
// everywhere a token becomes a key.
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function isSafeToken(t) {
  return typeof t === "string" && t.length > 0 && !UNSAFE_KEYS.has(t);
}

const index = {
  async _load() {
    const result = await browser.storage.local.get(INDEX_KEY);
    return result[INDEX_KEY] || {};
  },

  async _save(idx) {
    await browser.storage.local.set({ [INDEX_KEY]: idx });
  },

  async addClip(clip) {
    const idx = await this._load();
    const tokens = tokenize(clip);
    for (const token of tokens) {
      if (!isSafeToken(token)) continue;
      if (!idx[token]) idx[token] = [];
      if (!idx[token].includes(clip.id)) {
        idx[token].push(clip.id);
      }
    }
    await this._save(idx);
  },

  async removeClip(clipId) {
    const idx = await this._load();
    for (const token of Object.keys(idx)) {
      idx[token] = idx[token].filter((id) => id !== clipId);
      if (idx[token].length === 0) delete idx[token];
    }
    await this._save(idx);
  },

  /**
   * Returns an array of clip IDs matching all query terms (AND semantics).
   * Partial prefix matching: "schnip" matches "schnipsel".
   */
  async search(query) {
    const idx = await this._load();
    return searchInMap(idx, query);
  },

  /** Safe, normalized tokens for a clip — reused when building a friend's index. */
  tokensFor(clip) {
    return tokenize(clip).filter(isSafeToken);
  },

  /**
   * Build an inverted index (token → [clipId]) from a set of clips. Uses a
   * null-prototype object and rejects unsafe keys so a friend's tokens can never
   * pollute the prototype chain.
   */
  buildMap(clips) {
    const map = Object.create(null);
    for (const clip of clips || []) {
      for (const token of this.tokensFor(clip)) {
        if (!map[token]) map[token] = [];
        if (!map[token].includes(clip.id)) map[token].push(clip.id);
      }
    }
    return map;
  },

  /** Run a query against an arbitrary token map (local or a friend's). */
  searchInMap(idx, query) {
    return searchInMap(idx, query);
  },

  /**
   * Search across the local index AND friends' public-bag indices.
   *
   * `peers`: which sources to include — null/undefined means everyone (you + all
   * friends). Otherwise an array of selectors: the string "me" for your own clips
   * and a friend fingerprint for each friend to include.
   *
   * Returns provenance-tagged refs `{ owner: "me" | <fingerprint>, clipId }`,
   * round-robin interleaved across sources so no single peer can dominate results.
   */
  async federatedSearch(query, peers) {
    const localIdx = await this._load();
    const friendIndices = await store.getFriendIndices(); // { [fp]: tokenMap }

    const includeMe = !peers || peers.includes("me");
    const friendFps = Object.keys(friendIndices).filter((fp) => !peers || peers.includes(fp));

    const buckets = [];
    if (includeMe) buckets.push({ owner: "me", ids: searchInMap(localIdx, query) });
    for (const fp of friendFps) buckets.push({ owner: fp, ids: searchInMap(friendIndices[fp], query) });

    const out = [];
    for (let i = 0; ; i++) {
      let any = false;
      for (const b of buckets) {
        if (i < b.ids.length) { out.push({ owner: b.owner, clipId: b.ids[i] }); any = true; }
      }
      if (!any) break;
    }
    return out;
  },
};

// Prefix-match AND search over a token→[clipId] map. Shared by the local index
// and each friend's namespaced index.
function searchInMap(idx, query) {
  const terms = normalizeTokens(query.split(/\s+/));
  if (terms.length === 0) return [];

  const allTokens = Object.keys(idx);
  const matchedSets = terms.map((term) => {
    const matchingTokens = allTokens.filter((t) => t.startsWith(term));
    const ids = new Set();
    for (const t of matchingTokens) idx[t].forEach((id) => ids.add(id));
    return ids;
  });

  const [first, ...rest] = matchedSets;
  return [...first].filter((id) => rest.every((set) => set.has(id)));
}

// --- Tokenization ---

function tokenize(clip) {
  const raw = [];
  const tokens = clip.indexTokens;
  if (!tokens) return [];

  // Text
  if (tokens.text) raw.push(...tokens.text.split(/\s+/));

  // Images
  for (const img of tokens.images || []) {
    if (img.tokens) raw.push(...img.tokens.split(/\s+/));
    if (img.src) raw.push(...urlTokens(img.src));
  }

  // Links
  for (const link of tokens.links || []) raw.push(...link.split(/\s+/));

  // Aria labels
  for (const label of tokens.ariaLabels || []) raw.push(...label.split(/\s+/));

  // Video / audio
  for (const media of tokens.media || []) {
    if (media.title) raw.push(...media.title.split(/\s+/));
    if (media.src) raw.push(...urlTokens(media.src));
  }

  // Metadata
  if (clip.pageTitle) raw.push(...clip.pageTitle.split(/\s+/));
  if (clip.sourceUrl) raw.push(...urlTokens(clip.sourceUrl));

  return normalizeTokens(raw);
}

function normalizeTokens(tokens) {
  return tokens
    .map((t) => t.toLowerCase().replace(/[^a-z0-9äöüàáâãåæçèéêëìíîïñòóôõøùúûýÿ]/g, ""))
    .filter((t) => t.length >= 2);
}

function urlTokens(url) {
  try {
    const u = new URL(url);
    return [...u.hostname.split("."), ...u.pathname.split(/[\/\-_.]/)].filter(Boolean);
  } catch (_) {
    return [];
  }
}

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
    const terms = normalizeTokens(query.split(/\s+/));
    if (terms.length === 0) return [];

    const allTokens = Object.keys(idx);

    // For each query term, find all index tokens that start with it
    const matchedSets = terms.map((term) => {
      const matchingTokens = allTokens.filter((t) => t.startsWith(term));
      const ids = new Set();
      for (const t of matchingTokens) idx[t].forEach((id) => ids.add(id));
      return ids;
    });

    // Intersect all sets (AND)
    const [first, ...rest] = matchedSets;
    const result = [...first].filter((id) => rest.every((set) => set.has(id)));
    return result;
  },
};

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

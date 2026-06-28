# Search Index

Source file: `search/index.js`

The search index is an inverted token index: a map from normalised tokens to the list of clip IDs that contain them. It is stored in `browser.storage.local` under the key `"searchIndex"` for own clips, and under `"friendIndex"` (keyed per-friend fingerprint) for friend-sourced content.

This is explicitly **not** a ranked relevance engine — it is a fast inclusion filter. Every match either contains all query terms or it doesn't. Ranking can be layered on top later.

---

## Index format

```js
{
  "token": ["clipId1", "clipId2", …],
  "another": ["clipId3", …],
  …
}
```

The map is persisted as JSON. It is loaded into memory on each operation and re-saved. For the typical use case (hundreds to low thousands of clips on a single machine) this is fast enough. A persistent in-memory cache or a proper IDB-based index would be the natural next step if the collection size grows.

---

## What gets indexed

Tokens are extracted from the `indexTokens` object that the content script pre-computes at clip time (see [Element Picker and Clipping](Element-Picker-and-Clipping#token-extraction)):

| Source | Fields |
|---|---|
| Text elements | `innerText` / `textContent` |
| `<img>` | `alt`, `title`, `aria-label`, `aria-labelledby` target text, enclosing `<figcaption>`, nearest `<p>` / `<li>` / `<blockquote>` prose context |
| `<video>` / `<audio>` | `title`, `aria-label`, `<source src>` filename segments |
| `<a>` | `title`, `aria-label` |
| Any element | `aria-label`, `role="img"` content |
| Page metadata | `pageTitle`, source URL hostname + path segments |

The goal is to index what the *user* understands the content to be, not just what a text extractor would find. An image clipped for its alt text is just as searchable as a paragraph clipped for its prose.

---

## Tokenisation and normalisation

```js
function normalizeTokens(tokens) {
  return tokens
    .map(t => t.toLowerCase()
                .replace(/[^a-z0-9äöüàáâãåæçèéêëìíîïñòóôõøùúûýÿ]/g, ""))
    .filter(t => t.length >= 2);
}
```

- **Lowercase** — case-insensitive matching
- **Strip non-alphanumeric** — except a broad set of extended Latin characters so German, French, Spanish, etc. words survive normalisation intact
- **Minimum length 2** — single-character tokens are noise

URLs are tokenised by splitting on hostname dots and path separators (`/`, `-`, `_`, `.`):

```js
function urlTokens(url) {
  const u = new URL(url);
  return [...u.hostname.split("."), ...u.pathname.split(/[\/\-_.]/)].filter(Boolean);
}
```

So `https://www.nytimes.com/2024/article-title` produces tokens like `www`, `nytimes`, `com`, `2024`, `article`, `title`.

---

## Query semantics

### AND across terms

Every query term must match at least one token in a clip for that clip to appear in the results. Multi-word queries narrow the result set.

```
"firefox extension" → clips that contain BOTH "firefox" AND "extension" tokens
```

### Prefix matching

Queries match any token that *starts with* the query term:

```
"schnip" → matches "schnipsel", "schnipselbar", etc.
```

Implemented by iterating all index keys and filtering with `token.startsWith(queryTerm)`.

### Implementation

```js
function searchInMap(idx, query) {
  const terms = normalizeTokens(query.split(/\s+/));
  const allTokens = Object.keys(idx);
  const matchedSets = terms.map(term => {
    const ids = new Set();
    allTokens.filter(t => t.startsWith(term)).forEach(t => idx[t].forEach(id => ids.add(id)));
    return ids;
  });
  const [first, ...rest] = matchedSets;
  return [...first].filter(id => rest.every(set => set.has(id)));
}
```

The shared `searchInMap` function is used by both `index.search()` (local) and `index.federatedSearch()` (per-friend indices). No code duplication between the two search paths.

---

## Federated search

`index.federatedSearch(query, peers)` spans multiple sources in a single call:

- **`peers = null`** — include the local index and all friends' indices
- **`peers = ["me", fp1, fp2]`** — include only the specified sources

Each source is searched independently. Results are **round-robin interleaved** across buckets so no single peer can dominate the result list:

```
bucket[me]:   [A, B, C]
bucket[fp1]:  [D, E]
bucket[fp2]:  [F]

output: [A, D, F, B, E, C]
```

Each result is a provenance-tagged ref `{ owner: "me" | fingerprint, clipId }`. The background script resolves each ref to its full clip record before returning results to the UI.

Friend indices are kept **namespaced per friend** — they are never merged into the local index. This means:

1. A hostile peer cannot inject tokens into your own index.
2. Every result carries clear provenance: you always know which friend a clip came from.
3. Removing a friend removes their entire index namespace.

---

## Prototype-pollution hardening

Index tokens are used directly as object property keys. The search index is an object (albeit stored as JSON, not a live prototype chain), but defensive practice demands guarding against prototype pollution — especially since friend-sourced tokens are untrusted.

```js
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function isSafeToken(t) {
  return typeof t === "string" && t.length > 0 && !UNSAFE_KEYS.has(t);
}
```

All writes to the index check `isSafeToken` before inserting. `buildMap` (used when constructing a friend's index from their clips) uses a **null-prototype object** (`Object.create(null)`) as the base, which has no prototype chain to pollute in the first place.

Own clip tokens cannot produce `__proto__` or friends because `normalizeTokens` strips underscores. The guard is belt-and-suspenders for friend-sourced token objects that arrive already formed (from the `indexTokens` field of a received bundle).

---

## Public API

```js
index.addClip(clip)              // index a clip's tokens
index.removeClip(clipId)         // remove a clip from all token lists
index.search(query)              → [clipId]   // local only
index.federatedSearch(query, peers?) → [{ owner, clipId }]
index.tokensFor(clip)            → [string]   // safe + normalised tokens for a clip
index.buildMap(clips)            → tokenMap   // build an index map from a clip list
index.searchInMap(idx, query)    → [clipId]   // search an arbitrary token map
```

# Contributing

Contributions — code, bug reports, ideas — are welcome. Read this page before submitting a pull request.

---

## Development setup

```bash
git clone https://github.com/tomhumbert/schnipsel.git
cd schnipsel

# Install web-ext for development tooling (optional but recommended)
npm install -g web-ext

# Launch Firefox with the extension loaded and auto-reload on file changes
web-ext run

# Lint the manifest and source files
web-ext lint
```

No build step. No `npm install` for the project itself. Everything runs directly in Firefox.

If you don't use `web-ext`, load the extension manually:
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and select `manifest.json`
3. Reload manually after code changes (click the **Reload** button on the extension card)

---

## Repository structure

| Directory | What's there |
|---|---|
| `background/` | Message router and startup logic |
| `content_scripts/` | Element picker, injected into all web pages |
| `storage/` | The storage abstraction (touch before any persistence work) |
| `search/` | The inverted search index |
| `crypto/` | Cryptographic identity (ECDSA + ECDH) |
| `p2p/` | Friend handshake and bag-bundle transport |
| `security/` | DOMPurify wrapper, remote-ref stripping, CSP builder |
| `vendor/` | Pinned, audited third-party libraries |
| `sidebar/` | The sidebar panel (HTML + CSS + JS) |
| `collage/` | The full-page workspace (HTML + CSS + JS) |

Read [Architecture](Architecture) for the full picture before diving into code.

---

## Coding conventions

### No build tooling
Plain JavaScript only. No TypeScript, no transpilation, no `import`/`export` (ES modules). Use the same global-variable pattern as the rest of the codebase.

### Script loading order
New files that must be available in the background page need to be added to the `background.scripts` array in `manifest.json` in the correct dependency order. Sidebar and collage pages load their own copies via `<script>` tags.

### Storage access goes through `store.js`
**Never** call `browser.storage.*` or `indexedDB` directly outside of `storage/store.js`. This is the most important architectural invariant in the codebase.

### All clip rendering goes through `sanitize.js`
**Never** set `innerHTML` or `srcdoc` with raw clip HTML. Call `sanitize.clip()` or `sanitize.srcdoc()` first. For friend clips, pass `{ allowRemote: false }`.

### `allow-scripts` is prohibited
Clip iframes are sandboxed without `allow-scripts`. Treat any PR that adds `allow-scripts` to a sandbox attribute as a security regression.

### Comments only for the non-obvious
The codebase follows a minimal-comment style. Add a comment only when the *why* is not evident from reading the code — a hidden constraint, a subtle invariant, or a bug workaround. Do not write comments that describe *what* the code does.

### Stable JSON for signatures
Any data that is signed (invite payloads, bundle envelopes) must use `stableStringify()` — a deterministic JSON serialiser with sorted keys. Standard `JSON.stringify()` has no key-order guarantee and will produce verification failures.

---

## Testing

There is no automated test suite in the repository right now. Testing is manual:

1. Load the extension via `about:debugging`.
2. Test the feature you changed across its happy path and edge cases.
3. Run `web-ext lint` — it catches manifest errors, deprecated APIs, and basic JS issues.

When writing security-sensitive code (crypto, sanitisation, P2P pipeline), write standalone Node.js test scripts in a scratch directory and run them with `node`. The existing pipeline was verified with 54 checks across sanitize/crypto/invites/transport/search before it was merged.

Contributing a proper test harness is a welcome addition to the project.

---

## Security-sensitive areas

These areas require extra care. Changes here should be reviewed against the [Security Model](Security-Model) page before submission.

| Area | File | Key invariant |
|---|---|---|
| Clip sanitisation | `security/sanitize.js` | DOMPurify must run before any clip HTML is stored or rendered |
| iframe sandbox | anywhere clip iframes are created | `allow-scripts` must never appear |
| Background sender gate | `background/background.js` | `isTrustedSender` must be checked for all non-`CLIP_CREATED` messages |
| Search index keys | `search/index.js` | `UNSAFE_KEYS` must be checked before any token is written as a key |
| Friend content | `p2p/transport.js`, `storage/store.js` | Friend clips must stay in `friendClips` store, never merged into `clips` |
| Private keys | `crypto/identity.js` | Private keys must remain non-extractable (`extractable: false`) |
| Avatar validation | `storage/store.js` | SVG must be rejected; only PNG/JPEG/WEBP data URIs are valid |

If you are unsure whether a change affects security, ask in the issue rather than submitting a PR.

---

## Submitting a pull request

1. **Open an issue first** for anything non-trivial. This saves both parties time.
2. Keep the change focused. One logical change per PR.
3. Test manually. If you're changing the picker, test single clicks and range selections. If you're changing the search, test prefix matching and multi-term AND behaviour.
4. Run `web-ext lint` before submitting. Fix any errors it reports.
5. Write a clear PR description explaining *what* changed and *why*.

---

## Areas where contributions are especially welcome

- **Automated test suite** — unit or integration tests for `store.js`, `index.js`, and the crypto/P2P modules
- **MV3 migration** — tracking Firefox's MV3 support and planning the migration
- **Serverless WebRTC transport** — implementing `transport.buildBundle` / `transport.ingestBundle` dispatch over a live data channel (no relay server)
- **Accessibility** — keyboard navigation, screen-reader labels, focus management in the sidebar and collage UI
- **Performance** — the search index currently loads and saves the full JSON on every operation; a smarter persistence strategy would help for large collections
- **Localisation** — the UI is English-only; infrastructure for l10n would be welcome

---

## Licence

Schnipsel is released under the GNU General Public License v3.0. Contributions are accepted under the same licence. See the `LICENSE` file in the repository root.

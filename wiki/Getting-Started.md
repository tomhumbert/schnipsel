# Getting Started

## Requirements

- **Firefox 109 or later** — version 109 introduced the `sidebar_action` API that Schnipsel's sidebar panel depends on.
- **No build step** — the extension is plain JavaScript. Nothing to compile or bundle.

---

## Development install (temporary)

The fastest way to load Schnipsel is as a *temporary add-on*, which Firefox removes when the browser closes.

1. Clone the repository:
   ```bash
   git clone https://github.com/tomhumbert/schnipsel.git
   cd schnipsel
   ```

2. Open Firefox's add-on debugger:
   ```
   about:debugging#/runtime/this-firefox
   ```

3. Click **Load Temporary Add-on…** and select `manifest.json`.

4. Click the ✂ Schnipsel button in the Firefox toolbar, or go to **View → Sidebar → Schnipsel**.

### Why data survives reloads but not restarts

The manifest declares a stable extension ID (`browser_specific_settings.gecko.id = "schnipsel@tomhumbert"`). This makes Firefox tie IndexedDB and `storage.local` data to that specific ID rather than a random per-session UUID. As a result:

- **Reload** the extension (via about:debugging) → your clips and bags are intact.
- **Restart Firefox** → the temporary add-on is gone and data is inaccessible until you reload it.

For data that must survive browser restarts, either install persistently (below) or use **⤓ Export** as a backup — see [Storage Layer](Storage-Layer#export--import).

---

## Persistent installation

Unsigned extensions cannot be installed persistently in standard release Firefox. You have two options:

### Option A — Self-signed XPI (recommended for personal use)

1. Create a free developer account at [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. Retrieve your API credentials: **Manage API Keys** in your AMO account.
3. Install `web-ext`:
   ```bash
   npm install -g web-ext
   ```
4. Sign the extension for unlisted distribution:
   ```bash
   web-ext sign --channel=unlisted \
     --api-key=<JWT issuer> --api-secret=<JWT secret>
   ```
   This produces a signed `.xpi` in `web-ext-artifacts/`.
5. In Firefox: `about:addons` → gear icon → **Install Add-on From File…** → pick the `.xpi`.

The extension now persists across restarts. To update, bump `version` in `manifest.json`, re-sign, and install the new `.xpi` — Firefox keeps your data because the extension ID is unchanged.

### Option B — Disable signature enforcement (Firefox Dev Edition / Nightly / ESR only)

Standard release Firefox does not allow this.

1. Open `about:config` and set `xpinstall.signatures.required` to `false`.
2. Load the extension via `about:debugging` as in the development install above, or zip the directory and install the zip via `about:addons` → **Install Add-on From File…`.

---

## Developing with web-ext

`web-ext` is Mozilla's official development tool for WebExtensions.

```bash
npm install -g web-ext

# Launch Firefox with the extension pre-loaded; auto-reloads on source changes
web-ext run

# Lint the manifest and source files for common issues
web-ext lint

# Package a distributable .zip
web-ext build
```

`web-ext run` opens a temporary Firefox profile that stays alive for as long as the command runs. It watches the source directory and reloads the extension automatically when any file changes.

---

## Optional: remove Firefox's native sidebar header

Firefox renders a grey title bar with a × close button above every sidebar panel. To remove it and have Schnipsel's own header flush at the top:

1. Go to `about:config` and set `toolkit.legacyUserProfileCustomizations.stylesheets` to `true`.
2. Go to `about:support` → **Open Profile Folder**.
3. Inside that folder, create `chrome/userChrome.css` (create `chrome/` if it doesn't exist):
   ```css
   #sidebar-header {
     display: none !important;
   }
   ```
4. Restart Firefox.

> **Why `chrome/`?** The `chrome/` directory is Mozilla's term for the browser's own UI layer (it predates Google Chrome by many years). `userChrome.css` is a stylesheet that applies to Firefox's own interface, not to web pages.

This hides the native header for all sidebars, not just Schnipsel's. Revert by removing those lines and restarting.

---

## Next steps

- [Architecture](Architecture) — understand how the extension pieces fit together before reading source code
- [Contributing](Contributing) — code style, testing workflow, and PR guidelines

# Releasing

Schnipsel is distributed as an **unlisted, Mozilla-signed XPI** via GitHub Releases. Releases are triggered automatically by pushing a git tag. Every version is uploaded to and signed by Mozilla via their API (the AMO credentials only authenticate your account — you never hold a signing key yourself); the signed `.xpi` is then attached to the GitHub Release as a downloadable asset.

---

## One-time setup

### 1. AMO API credentials

1. Log in to [addons.mozilla.org](https://addons.mozilla.org/developers/) with your developer account.
2. Go to **Manage API Keys** and generate a JWT issuer + secret. ⚠️ The secret is shown **only once** — copy it immediately; if lost, revoke and regenerate.
3. In the GitHub repository go to **Settings → Secrets and variables → Actions** and add two secrets:

| Secret name | Value |
|-------------|-------|
| `AMO_API_KEY` | Your JWT **issuer** (looks like `user:12345678:123`) |
| `AMO_API_SECRET` | Your JWT **secret** (the long random string) |

The names must match exactly — a typo just makes the sign step fail with empty credentials. These are the only credentials the workflow needs; GitHub masks them in logs. Guard the secret: it can sign add-ons under your identity, so it lives only in GitHub Actions secrets, never in the repo.

### 2. `GITHUB_TOKEN` permissions

The workflow uses the automatically-provided `GITHUB_TOKEN` to create GitHub Releases. No extra setup is required — it is scoped to `contents: write` in the workflow file.

---

## Shipping a release

### 1. Update the version

Bump `version` in `manifest.json` to the next semantic version:

```json
"version": "1.0.0"
```

Commit the change:

```bash
git add manifest.json
git commit -m "Bump version to 1.0.0"
git push
```

### 2. Tag and push

```bash
git tag v1.0.0
git push --tags
```

Pushing the tag triggers the release workflow. That's it.

### 3. What happens automatically

The GitHub Actions workflow (`.github/workflows/release.yml`):

1. **Lints** the extension with `web-ext lint`
2. **Signs** it via `web-ext sign --channel=unlisted` using the AMO API — Mozilla returns a signed `.xpi`
3. **Creates a GitHub Release** at `github.com/tomhumbert/schnipsel/releases/tag/v1.0.0` with:
   - The signed `.xpi` attached as a downloadable asset
   - Auto-generated release notes from commits since the previous tag

### 4. Install the new version

Download the `.xpi` from the GitHub Release and install it via `about:addons` → gear icon → **Install Add-on From File…**

Because the extension ID is fixed (`schnipsel@tomhumbert`), Firefox keeps all existing bags, clips, and settings when updating.

---

## Versioning convention

Follow [Semantic Versioning](https://semver.org/):

| Increment | When |
|-----------|------|
| `MAJOR` (1.x.x → 2.x.x) | Breaking change to storage format, crypto protocol, or bundle format |
| `MINOR` (x.1.x → x.2.x) | New feature, backwards-compatible |
| `PATCH` (x.x.1 → x.x.2) | Bug fix |

Note: Firefox WebExtension version numbers must be `major.minor.patch` integers with no pre-release suffixes (no `-beta`, `-rc`). Test pre-release builds locally without tagging.

---

## Switching to a listed AMO release

When you're ready to have a public AMO page (discoverable by anyone on addons.mozilla.org):

1. Change `--channel=unlisted` to `--channel=listed` in the workflow.
2. Push a new tag — the workflow submits the build to AMO for review.
3. Mozilla's review team will approve or request changes. First reviews typically take a few days to a few weeks.
4. Once approved, users can install directly from your AMO listing without downloading an `.xpi`.

Listed and unlisted can coexist during a transition: keep distributing the unlisted `.xpi` via GitHub Releases while the listed version is under review.

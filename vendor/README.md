# Vendored third-party code

Everything here is committed verbatim (no CDN at runtime) so the extension has
**zero network dependencies** and the exact bytes can be audited and diffed
against the upstream release.

## dompurify.js

- **Library:** [DOMPurify](https://github.com/cure53/DOMPurify) by Cure53
- **Version:** 3.2.4 (pinned)
- **License:** Apache-2.0 OR MPL-2.0 (permissive; reuse-safe)
- **Source:** `https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.js`
- **SHA-256:** `e1c2d0caf18b482d5fe3930a867e73ab2029adc80e3bc9272f3c681c2ee45039`

Audited on vendoring — contains **no** network/exfiltration calls (`fetch`,
`XMLHttpRequest`, `sendBeacon`, `WebSocket`, `new Image`, `importScripts`), **no**
cookie/storage access, and **no** dynamic code execution (`eval`, `new Function`).
It is a pure in-memory HTML string → sanitized HTML string transform.

To re-verify:

```sh
sha256sum vendor/dompurify.js   # must equal the hash above
grep -nE "fetch|XMLHttpRequest|sendBeacon|WebSocket|new Image|eval\(|new Function" vendor/dompurify.js
```

### Upgrading

Download the new pinned version, re-run the audit grep above, update the version
+ hash here, and re-test the XSS corpus (see README "Security").

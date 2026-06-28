/**
 * Sanitization & safe-render helpers — the single choke point through which all
 * clip HTML must pass before it is shown or stored.
 *
 * Clip HTML is produced by cloning arbitrary page DOM (content_scripts/schnipsel.js)
 * and, once P2P sharing lands, can originate from other users. It must therefore be
 * treated as fully untrusted. Defense in depth, three independent layers:
 *
 *   1. DOMPurify        — strips <script>, event handlers, javascript: URLs and
 *                         other active content from the HTML string.
 *   2. Remote-ref strip — for friend-sourced clips, removes references to remote
 *                         resources so a clip can't phone home (tracking beacons)
 *                         even with scripts already disabled.
 *   3. srcdoc CSP        — every clip renders inside an <iframe srcdoc> that carries
 *                         a restrictive <meta> CSP, so scripts never execute and
 *                         (for friend clips) no remote fetches happen, even if a
 *                         sanitizer somehow missed something.
 *
 * The fourth, non-negotiable layer lives at every call site: clip iframes are
 * sandboxed and MUST NEVER be given `allow-scripts`. See sanitize.IFRAME_SANDBOX.
 *
 * Exposes a global `sanitize` object (matching the project's no-module pattern,
 * like `store` and `index`). Requires vendor/dompurify.js to be loaded first.
 */

const sanitize = (() => {
  // Structural tags that can execute script or redirect/navigate. DOMPurify already
  // drops most of these by default; listing them is belt-and-suspenders.
  const FORBID_TAGS = [
    "script", "iframe", "object", "embed", "form",
    "base", "meta", "link", "noscript", "template",
  ];
  const FORBID_ATTR = ["ping", "formaction", "target"];

  // Resource-loading attributes we neutralize for friend clips.
  const REMOTE_ATTRS = ["src", "srcset", "poster", "background", "data", "href"];
  const DATA_URI = /^\s*data:/i;

  function purify(html) {
    if (typeof DOMPurify === "undefined") {
      // Fail closed: if the sanitizer didn't load, render nothing rather than
      // risk injecting raw untrusted HTML.
      console.error("Schnipsel: DOMPurify not loaded — refusing to render clip HTML.");
      return "";
    }
    return DOMPurify.sanitize(String(html == null ? "" : html), {
      FORBID_TAGS,
      FORBID_ATTR,
      ALLOW_DATA_ATTR: true, // keep data-schnipsel-* markers
      USE_PROFILES: { html: true, svg: false, svgFilters: false, mathMl: false },
    });
  }

  // Drop every reference to a non-data: resource. Used for friend-sourced clips so
  // rendering one cannot leak the viewer's IP / "I saw this" signal to a remote host.
  function stripRemoteRefs(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");

    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of REMOTE_ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        const val = el.getAttribute(attr);
        if (!DATA_URI.test(val)) el.removeAttribute(attr);
      }
      // Inline style url(...) → keep only data: URIs.
      const style = el.getAttribute("style");
      if (style && style.includes("url(")) {
        el.setAttribute("style", stripCssUrls(style));
      }
    });

    // <style> blocks (e.g. @font-face) — strip remote url() there too.
    doc.querySelectorAll("style").forEach((styleEl) => {
      if (styleEl.textContent.includes("url(")) {
        styleEl.textContent = stripCssUrls(styleEl.textContent);
      }
    });

    return doc.body.innerHTML;
  }

  function stripCssUrls(css) {
    return css.replace(/url\(\s*['"]?([^'")]*)['"]?\s*\)/gi, (match, url) =>
      DATA_URI.test(url) ? match : "none"
    );
  }

  // Content-Security-Policy injected into every clip iframe document.
  //   - script-src 'none'      → no JS, ever (independent of the sandbox attr)
  //   - object-src/base-uri/form-action 'none' → no plugins, no <base> hijack, no submits
  //   - style-src 'unsafe-inline' → clips depend on inlined styles
  // For own clips remote images/fonts/media are allowed (functionality); for friend
  // clips everything is locked to data: so a clip cannot make any network request.
  function cspMeta(allowRemote) {
    const remote = allowRemote ? " https: http:" : "";
    const policy = [
      "default-src 'none'",
      `img-src data:${remote}`,
      `media-src data:${remote}`,
      `font-src data:${remote}`,
      "style-src 'unsafe-inline'",
      "script-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
    return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  }

  return {
    /**
     * The ONLY sandbox values clip iframes may use. Neither includes
     * `allow-scripts` or `allow-same-origin`, so framed clip content runs no
     * JavaScript and gets an opaque origin. `POPUP` additionally lets in-clip
     * links open in a new tab (collage canvas / export).
     */
    IFRAME_SANDBOX: "",
    IFRAME_SANDBOX_POPUP: "allow-popups allow-popups-to-escape-sandbox",

    /**
     * Clean a clip's HTML into a safe subset.
     * @param {string} html
     * @param {{allowRemote?: boolean}} opts  allowRemote=false also strips remote
     *        resource references (use for friend-sourced clips).
     */
    clip(html, { allowRemote = true } = {}) {
      let clean = purify(html);
      if (!allowRemote) clean = stripRemoteRefs(clean);
      return clean;
    },

    /**
     * Build the full document string for an <iframe srcdoc>: a restrictive CSP
     * <meta>, optional extra <head> content (e.g. `<base target="_blank">` for the
     * collage), then the sanitized clip body.
     * @param {string} html
     * @param {{allowRemote?: boolean, extraHead?: string}} opts
     */
    srcdoc(html, { allowRemote = true, extraHead = "" } = {}) {
      const body = this.clip(html, { allowRemote });
      return `<!doctype html><html><head>${cspMeta(allowRemote)}${extraHead}</head><body>${body}</body></html>`;
    },
  };
})();

// Make available to background (service-worker-ish) and page contexts alike.
if (typeof window !== "undefined") window.sanitize = sanitize;

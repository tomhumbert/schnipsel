/**
 * Content script — element picker with single and multi-select.
 *
 * Activated by { type: "ACTIVATE_PICKER" } from the background script.
 *
 * Interaction model:
 *   Click          — clip the element immediately (single-select, closes picker)
 *   Shift+click    — add element to selection (picker stays open)
 *   Alt+click      — remove element from selection
 *   Enter          — clip all selected elements as individual clips
 *   Esc            — cancel, deactivate picker
 */

(function () {
  let pickerActive = false;
  let hoveredEl    = null;
  const selected   = new Set(); // Set<Element>

  // --- Styles injected into the page ---

  const HOVER_STYLE    = "outline: 2px dashed #e05c00 !important; outline-offset: 2px !important; cursor: crosshair !important;";
  const SELECTED_STYLE = "outline: 3px solid #e05c00 !important; outline-offset: 2px !important; cursor: crosshair !important;";

  // --- Status bar (fixed overlay) ---

  let statusBar = null;

  function ensureStatusBar() {
    if (statusBar) return;
    statusBar = document.createElement("div");
    Object.assign(statusBar.style, {
      position:       "fixed",
      bottom:         "24px",
      left:           "50%",
      transform:      "translateX(-50%)",
      zIndex:         "2147483647",
      background:     "rgba(20,18,16,0.88)",
      color:          "#fff",
      fontFamily:     "'Courier New', monospace",
      fontSize:       "12px",
      padding:        "8px 18px",
      borderRadius:   "8px",
      border:         "1px solid rgba(224,92,0,0.6)",
      boxShadow:      "0 4px 20px rgba(0,0,0,0.4)",
      backdropFilter: "blur(10px)",
      pointerEvents:  "none",
      whiteSpace:     "nowrap",
      letterSpacing:  "0.04em",
    });
    document.body.appendChild(statusBar);
  }

  function updateStatusBar() {
    if (selected.size === 0) {
      removeStatusBar();
      return;
    }
    ensureStatusBar();
    statusBar.textContent =
      `${selected.size} selected  ·  Enter to clip  ·  Shift+click to add  ·  Alt+click to remove  ·  Esc to cancel`;
  }

  function removeStatusBar() {
    if (statusBar) {
      statusBar.remove();
      statusBar = null;
    }
  }

  // --- Activation / deactivation ---

  function activatePicker() {
    if (pickerActive) return;
    pickerActive = true;
    document.addEventListener("mouseover",  onMouseOver,  true);
    document.addEventListener("mouseout",   onMouseOut,   true);
    // Selection is driven by mousedown, not click: when the picker is started
    // from the sidebar the page is unfocused, and the browser swallows the
    // first synthesized click to focus the window. mousedown is always
    // delivered, so the very first pick works. The click listener only blocks
    // navigation (e.g. following a link) while the picker is active.
    document.addEventListener("mousedown",  onMouseDown,  true);
    document.addEventListener("click",      onClickBlock, true);
    document.addEventListener("keydown",    onKeyDown,    true);
  }

  function deactivatePicker() {
    pickerActive = false;
    clearHover();
    clearAllSelections();
    removeStatusBar();
    document.removeEventListener("mouseover",  onMouseOver,  true);
    document.removeEventListener("mouseout",   onMouseOut,   true);
    document.removeEventListener("mousedown",  onMouseDown,  true);
    document.removeEventListener("click",      onClickBlock, true);
    document.removeEventListener("keydown",    onKeyDown,    true);
  }

  // --- Hover highlight ---

  function clearHover() {
    if (hoveredEl && !selected.has(hoveredEl)) {
      hoveredEl.style.removeProperty("outline");
      hoveredEl.style.removeProperty("outline-offset");
      hoveredEl.style.removeProperty("cursor");
    }
    hoveredEl = null;
  }

  function onMouseOver(e) {
    clearHover();
    hoveredEl = e.target;
    // Don't overwrite the selected style
    if (!selected.has(hoveredEl)) {
      applyStyle(hoveredEl, HOVER_STYLE);
    }
    e.stopPropagation();
  }

  function onMouseOut(e) {
    if (e.target === hoveredEl && !selected.has(hoveredEl)) {
      removeStyle(hoveredEl);
    }
    hoveredEl = null;
    e.stopPropagation();
  }

  // --- Click / mousedown handlers ---

  // Swallow click events while the picker is active so that links, buttons
  // and form controls don't fire when the user is just selecting elements.
  function onClickBlock(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseDown(e) {
    // Only respond to the primary (left) button
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target;

    if (e.altKey) {
      // Alt+click — deselect
      if (selected.has(target)) {
        selected.delete(target);
        removeStyle(target);
        // Restore hover style since cursor is still over it
        applyStyle(target, HOVER_STYLE);
        updateStatusBar();
      }
      return;
    }

    if (e.shiftKey) {
      // Shift+click — add to selection (toggle off if already selected)
      if (selected.has(target)) {
        selected.delete(target);
        applyStyle(target, HOVER_STYLE);
      } else {
        selected.add(target);
        applyStyle(target, SELECTED_STYLE);
      }
      updateStatusBar();
      return;
    }

    // Plain click — clip immediately (single element)
    deactivatePicker();
    serializeElement(target)
      .then((clip) => browser.runtime.sendMessage({ type: "CLIP_CREATED", clip }))
      .catch((err) => console.error("Schnipsel: failed to serialize clip", err));
  }

  // --- Keyboard handler ---

  function onKeyDown(e) {
    if (e.key === "Escape") {
      deactivatePicker();
      return;
    }

    if (e.key === "Enter" && selected.size > 0) {
      // Preserve DOM order so the collated layout is stable.
      const elements = [...selected].sort((a, b) => {
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      deactivatePicker();
      serializeElements(elements)
        .then((clip) => browser.runtime.sendMessage({ type: "CLIP_CREATED", clip }))
        .catch((err) => console.error("Schnipsel: failed to serialize clip", err));
    }
  }

  // --- Selection helpers ---

  function clearAllSelections() {
    for (const el of selected) removeStyle(el);
    selected.clear();
  }

  function applyStyle(el, styleStr) {
    // Preserve any existing inline style, replacing just our properties
    const existing = el.getAttribute("style") || "";
    // Strip previously applied schnipsel outline properties
    const stripped = existing
      .replace(/outline[^;]*;?/gi, "")
      .replace(/outline-offset[^;]*;?/gi, "")
      .replace(/cursor[^;]*;?/gi, "")
      .trim();
    el.setAttribute("style", stripped + ";" + styleStr);
  }

  function removeStyle(el) {
    const existing = el.getAttribute("style") || "";
    const stripped = existing
      .replace(/outline[^;]*;?/gi, "")
      .replace(/outline-offset[^;]*;?/gi, "")
      .replace(/cursor[^;]*;?/gi, "")
      .trim()
      .replace(/^;+|;+$/g, "");
    if (stripped) {
      el.setAttribute("style", stripped);
    } else {
      el.removeAttribute("style");
    }
  }

  // --- Serialization ---

  // Produce a fully self-contained clone of one element: inlined computed
  // styles, materialised pseudo-elements, and absolute URLs. Does NOT tear
  // down the style probe — the caller does that once after all clones are
  // built, so multi-element clips only pay for it once.
  function buildStyledClone(el) {
    // Remove any picker outline we injected before copying styles
    removeStyle(el);
    const clone = el.cloneNode(true);
    inlineStyles(el, clone);
    inlinePseudos(el, clone);
    rewriteUrls(clone);
    rewriteStyleUrls(clone);
    return clone;
  }

  async function serializeElement(el) {
    const clone = buildStyledClone(el);
    teardownProbe();
    const fontStyle = await collectFontFaces();
    const width = el.getBoundingClientRect().width;
    // Wrap in a container that sets the original width and font baseline so
    // the clip renders at the right size when displayed in an iframe or export.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-schnipsel-clip", "1");
    wrapper.style.cssText = `width:${Math.round(width)}px;box-sizing:border-box;`;
    if (fontStyle) {
      const styleEl = document.createElement("style");
      styleEl.textContent = fontStyle;
      wrapper.appendChild(styleEl);
    }
    wrapper.appendChild(clone);
    return {
      html:        wrapper.outerHTML,
      elementTag:  el.tagName.toLowerCase(),
      sourceUrl:   location.href,
      pageTitle:   document.title,
      indexTokens: extractIndexTokens(el),
    };
  }

  // Collate several selected elements into ONE clip, positioned absolutely so
  // they keep their approximate on-page layout relative to each other.
  async function serializeElements(els) {
    if (els.length === 1) return serializeElement(els[0]);

    // Measure all elements first (positions shift once we start mutating).
    const rects = els.map((el) => el.getBoundingClientRect());
    let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    for (const r of rects) {
      minLeft   = Math.min(minLeft,   r.left);
      minTop    = Math.min(minTop,    r.top);
      maxRight  = Math.max(maxRight,  r.right);
      maxBottom = Math.max(maxBottom, r.bottom);
    }
    const W = Math.max(1, Math.round(maxRight - minLeft));
    const H = Math.max(1, Math.round(maxBottom - minTop));

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-schnipsel-clip", "1");
    wrapper.style.cssText =
      `position:relative;width:${W}px;height:${H}px;box-sizing:border-box;`;

    for (let i = 0; i < els.length; i++) {
      const r = rects[i];
      const clone = buildStyledClone(els[i]);
      // The holder is placed at the element's border-box position; the clone's
      // own margins would shift it away from that, so neutralise them.
      clone.style.setProperty("margin", "0", "important");
      // Each element gets an absolutely-positioned holder at its offset within
      // the union bounding box, preserving the original spatial arrangement.
      const holder = document.createElement("div");
      holder.style.cssText =
        `position:absolute;` +
        `left:${Math.round(r.left - minLeft)}px;` +
        `top:${Math.round(r.top - minTop)}px;` +
        `width:${Math.round(r.width)}px;`;
      holder.appendChild(clone);
      wrapper.appendChild(holder);
    }
    teardownProbe();

    const fontStyle = await collectFontFaces();
    if (fontStyle) {
      const styleEl = document.createElement("style");
      styleEl.textContent = fontStyle;
      wrapper.insertBefore(styleEl, wrapper.firstChild);
    }

    // Merge index tokens from every element so search covers the whole group.
    const merged = { text: [], images: [], links: [], ariaLabels: [], media: [] };
    for (const el of els) {
      const t = extractIndexTokens(el);
      merged.text.push(t.text);
      merged.images.push(...t.images);
      merged.links.push(...t.links);
      merged.ariaLabels.push(...t.ariaLabels);
      merged.media.push(...t.media);
    }
    merged.text = merged.text.join(" ");

    return {
      html:        wrapper.outerHTML,
      elementTag:  "group",
      sourceUrl:   location.href,
      pageTitle:   document.title,
      indexTokens: merged,
    };
  }

  // CSS properties we skip — they describe animation/transition state that
  // makes no sense in a static snapshot, or cause layout thrash.
  const SKIP_PROPS = new Set([
    "animation", "animation-delay", "animation-direction", "animation-duration",
    "animation-fill-mode", "animation-iteration-count", "animation-name",
    "animation-play-state", "animation-timing-function",
    "transition", "transition-delay", "transition-duration",
    "transition-property", "transition-timing-function",
    "will-change",
  ]);

  // Cache default computed values per tag so we only inline props that the
  // page actually changed. Defaults are measured inside a clean, isolated
  // iframe that carries ONLY the browser's UA stylesheet — never the page's
  // CSS. Measuring against the live page would let inherited typography
  // (font-family, color, line-height set on <html>/<body>) read as "default"
  // and get stripped, leaving the clip unstyled when rendered elsewhere.
  const defaultCache = {};
  let probeDoc = null;
  let probeWin = null;

  function ensureProbeDoc() {
    if (probeDoc) return;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:absolute;width:0;height:0;border:0;visibility:hidden;left:-9999px;";
    document.documentElement.appendChild(frame);
    probeDoc = frame.contentDocument;
    probeWin = frame.contentWindow;
    // Pristine document — no page styles, just the UA stylesheet.
    probeDoc.open();
    probeDoc.write("<!doctype html><html><head></head><body></body></html>");
    probeDoc.close();
  }

  function getDefaults(tagName) {
    if (defaultCache[tagName]) return defaultCache[tagName];
    ensureProbeDoc();
    const tmp = probeDoc.createElement(tagName);
    probeDoc.body.appendChild(tmp);
    const c = probeWin.getComputedStyle(tmp);
    const result = {};
    for (let i = 0; i < c.length; i++) result[c[i]] = c.getPropertyValue(c[i]);
    probeDoc.body.removeChild(tmp);
    defaultCache[tagName] = result;
    return result;
  }

  function teardownProbe() {
    if (probeWin && probeWin.frameElement) probeWin.frameElement.remove();
    probeDoc = null;
    probeWin = null;
  }

  function inlineStyles(liveEl, cloneEl, isRoot = true) {
    const liveEls  = [liveEl,  ...liveEl.querySelectorAll("*")];
    const cloneEls = [cloneEl, ...cloneEl.querySelectorAll("*")];
    for (let i = 0; i < liveEls.length; i++) {
      const live  = liveEls[i];
      const clone = cloneEls[i];
      const computed  = window.getComputedStyle(live);
      const defaults  = getDefaults(live.tagName);
      let styleStr = "";
      for (let j = 0; j < computed.length; j++) {
        const prop = computed[j];
        if (SKIP_PROPS.has(prop)) continue;
        const val = computed.getPropertyValue(prop);
        // Only inline if it differs from the element-type default
        if (val !== defaults[prop]) styleStr += `${prop}:${val};`;
      }
      // Normalize position on the root element — fixed/absolute cards should
      // sit naturally in the clip container, not fly off to viewport coords.
      if (i === 0 && isRoot) {
        const pos = computed.getPropertyValue("position");
        if (pos === "fixed" || pos === "absolute") {
          styleStr = styleStr.replace(/\bposition:[^;]+;/, "position:relative;");
        }
      }
      clone.setAttribute("style", styleStr);
    }
  }

  // Convert ::before / ::after pseudo-elements into real <span> nodes so they
  // survive being moved out of the page's stylesheet context.
  function inlinePseudos(liveEl, cloneEl) {
    const pairs = [
      [liveEl,  cloneEl],
      ...[...liveEl.querySelectorAll("*")].map((l, i) => [l, cloneEl.querySelectorAll("*")[i]]),
    ];
    for (const [live, clone] of pairs) {
      if (!clone) continue;
      for (const pseudo of ["::before", "::after"]) {
        const cs = window.getComputedStyle(live, pseudo);
        const content = cs.getPropertyValue("content");
        if (!content || content === "none" || content === '""' || content === "normal") continue;
        const span = document.createElement("span");
        span.setAttribute("data-schnipsel-pseudo", pseudo);
        let pStyle = "";
        for (let j = 0; j < cs.length; j++) {
          const p = cs[j];
          if (SKIP_PROPS.has(p)) continue;
          pStyle += `${p}:${cs.getPropertyValue(p)};`;
        }
        // Force the pseudo to render inline; remove pseudo-specific `content` so
        // the text content we set below isn't doubled.
        span.setAttribute("style", pStyle + "display:inline;");
        // Unquote CSS string value — e.g. '"→"' → '→'
        span.textContent = content.replace(/^["']|["']$/g, "");
        if (pseudo === "::before") clone.prepend(span);
        else                       clone.append(span);
      }
    }
  }

  function rewriteUrls(root) {
    root.querySelectorAll("[src]").forEach((el) => {
      try { el.src = new URL(el.getAttribute("src"), location.href).href; } catch (_) {}
    });
    root.querySelectorAll("[href]").forEach((el) => {
      try { el.href = new URL(el.getAttribute("href"), location.href).href; } catch (_) {}
    });
    root.querySelectorAll("[srcset]").forEach((el) => {
      el.setAttribute("srcset",
        el.getAttribute("srcset").replace(/(\S+)(\s)/g, (_, url, ws) => {
          try { return new URL(url, location.href).href + ws; } catch (_) { return _ + ws; }
        })
      );
    });
  }

  // Rewrite url(...) references inside inlined style attributes so that
  // background images and masks still load when the clip is displayed elsewhere.
  function rewriteStyleUrls(root) {
    const all = [root, ...root.querySelectorAll("*")];
    for (const el of all) {
      const style = el.getAttribute("style");
      if (!style || !style.includes("url(")) continue;
      el.setAttribute("style", style.replace(
        /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g,
        (match, url) => {
          // Skip already-absolute and data URLs
          if (/^(https?:|data:|blob:)/.test(url)) return match;
          try { return `url("${new URL(url, location.href).href}")`; }
          catch (_) { return match; }
        }
      ));
    }
  }

  // Collect @font-face rules from all accessible stylesheets, fetch the font
  // files and re-encode as data: URIs so the clip renders with the right font
  // even without access to the original page.
  async function collectFontFaces() {
    const fontUrls = new Map(); // url → data URI
    const faceRules = [];

    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (_) { continue; } // cross-origin
      for (const rule of rules) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        faceRules.push(rule.cssText);
        const src = rule.style.getPropertyValue("src");
        for (const match of src.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g)) {
          const abs = (() => {
            try { return new URL(match[1], sheet.href || location.href).href; }
            catch (_) { return null; }
          })();
          if (abs && !fontUrls.has(abs)) fontUrls.set(abs, null);
        }
      }
    }

    if (fontUrls.size === 0) return "";

    // Fetch each font file and convert to base64 data URI
    await Promise.all([...fontUrls.keys()].map(async (url) => {
      try {
        const resp = await fetch(url, { mode: "cors" });
        if (!resp.ok) return;
        const blob = await resp.blob();
        const dataUri = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        fontUrls.set(url, dataUri);
      } catch (_) {
        // CORS or network failure — font won't be embedded, falls back to system font
      }
    }));

    // Rebuild @font-face rules with data URIs substituted
    const css = faceRules.map((ruleText) =>
      ruleText.replace(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g, (match, url) => {
        const abs = (() => {
          try { return new URL(url, location.href).href; } catch (_) { return null; }
        })();
        const data = abs && fontUrls.get(abs);
        return data ? `url("${data}")` : match;
      })
    ).join("\n");

    return css;
  }

  function extractIndexTokens(el) {
    const tokens = {
      text:       el.innerText || el.textContent || "",
      images:     [],
      links:      [],
      ariaLabels: [],
      media:      [],
    };

    el.querySelectorAll("img, [role='img']").forEach((img) => {
      const imgTokens = [
        img.alt,
        img.title,
        img.getAttribute("aria-label"),
        img.getAttribute("aria-labelledby")
          ? document.getElementById(img.getAttribute("aria-labelledby"))?.textContent
          : null,
      ].filter(Boolean).join(" ");

      const figure  = img.closest("figure");
      const caption = figure?.querySelector("figcaption")?.textContent || "";
      const prose   = img.closest("p, li, td, blockquote");
      const context = prose ? prose.textContent : "";

      tokens.images.push({
        src:    img.src || img.getAttribute("src"),
        tokens: [imgTokens, caption, context].join(" ").trim(),
      });
    });

    el.querySelectorAll("a[title], a[aria-label]").forEach((a) => {
      tokens.links.push(a.title || a.getAttribute("aria-label"));
    });

    el.querySelectorAll("[aria-label]").forEach((node) => {
      tokens.ariaLabels.push(node.getAttribute("aria-label"));
    });

    el.querySelectorAll("video, audio").forEach((media) => {
      tokens.media.push({
        type:  media.tagName.toLowerCase(),
        title: media.title || media.getAttribute("aria-label") || "",
        src:   media.src || media.querySelector("source")?.src || "",
      });
    });

    return tokens;
  }

  // --- Message listener ---

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === "ACTIVATE_PICKER") activatePicker();
  });
})();

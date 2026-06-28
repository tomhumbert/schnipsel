/**
 * Content script — element picker.
 *
 * Activated by { type: "ACTIVATE_PICKER" } from the background script.
 *
 * Interaction model:
 *   Click          — clip that element immediately (single, closes picker)
 *   Shift+click    — start a range, or extend it to another sibling. A range is a
 *                    CONTIGUOUS run of sibling elements inside one parent container;
 *                    the clip keeps that container (so its framing survives) but
 *                    prunes the container's other children. Endpoints outside the
 *                    container are refused with a visual cue (no dialog).
 *   ↑ ↓ ← →        — grow / shrink the range to adjacent siblings
 *   Enter          — clip the kept-container range
 *   Esc            — cancel, deactivate picker
 */

(function () {
  let pickerActive = false;
  let hoveredEl    = null;

  // --- Range-selection state ---
  // A range is a contiguous slice of one container's element children.
  let wrapperEl   = null;  // the kept container (fixed once a range starts)
  let siblings    = [];    // wrapperEl's element children, in document order
  let anchorIndex = -1;    // fixed end of the range
  let focusIndex  = -1;    // moving end of the range

  function rangeActive() { return wrapperEl !== null; }

  function selectedChildren() {
    if (!rangeActive()) return [];
    const lo = Math.min(anchorIndex, focusIndex);
    const hi = Math.max(anchorIndex, focusIndex);
    return siblings.slice(lo, hi + 1);
  }

  // Walk up from `el` to the element that is a DIRECT child of wrapperEl.
  // Returns null if `el` isn't inside wrapperEl (so it can't extend the range).
  function resolveToWrapperChild(el) {
    if (!wrapperEl || el === wrapperEl) return null;
    let n = el;
    while (n && n.parentElement !== wrapperEl) n = n.parentElement;
    return n;
  }

  // --- Styles injected into the page ---

  const HOVER_STYLE     = "outline: 2px dashed #e05c00 !important; outline-offset: 2px !important; cursor: crosshair !important;";
  const SELECTED_STYLE  = "outline: 3px solid #e05c00 !important; outline-offset: 2px !important; cursor: crosshair !important;";
  const WRAPPER_STYLE   = "outline: 2px dashed rgba(224,92,0,0.55) !important; outline-offset: 5px !important; cursor: crosshair !important;";
  const CANDIDATE_STYLE = "outline: 2px dotted #e05c00 !important; outline-offset: 2px !important; cursor: crosshair !important;";
  const DENIED_STYLE    = "outline: 2px dashed #c0392b !important; outline-offset: 2px !important; cursor: not-allowed !important;";
  const DENIED_FLASH    = "outline: 3px solid #c0392b !important; outline-offset: 2px !important; cursor: not-allowed !important;";

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
    if (!rangeActive()) {
      removeStatusBar();
      return;
    }
    ensureStatusBar();
    const count = selectedChildren().length;
    const tag = wrapperEl.tagName.toLowerCase();
    statusBar.textContent =
      `${count} in <${tag}>  ·  ↑↓ grow  ·  Shift-click a sibling  ·  Enter to clip  ·  Esc to cancel`;
  }

  function removeStatusBar() {
    if (statusBar) {
      statusBar.remove();
      statusBar = null;
    }
  }

  // --- Hint toast (shown when the picker arms; auto-fades) ---

  let hintBar   = null;
  let hintTimer = null;

  function showHint() {
    removeHint();
    hintBar = document.createElement("div");
    hintBar.textContent = "✂ Click to clip  ·  hold Shift to select a range  ·  Esc to cancel";
    Object.assign(hintBar.style, {
      position:       "fixed",
      top:            "24px",
      left:           "50%",
      transform:      "translateX(-50%) translateY(-6px)",
      zIndex:         "2147483647",
      background:     "rgba(20,18,16,0.9)",
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
      opacity:        "0",
      transition:     "opacity 0.2s ease, transform 0.2s ease",
    });
    document.body.appendChild(hintBar);
    requestAnimationFrame(() => {
      if (!hintBar) return;
      hintBar.style.opacity = "1";
      hintBar.style.transform = "translateX(-50%) translateY(0)";
    });
    clearTimeout(hintTimer);
    hintTimer = setTimeout(fadeHint, 3500);
  }

  function fadeHint() {
    if (!hintBar) return;
    hintBar.style.opacity = "0";
    hintBar.style.transform = "translateX(-50%) translateY(-6px)";
    setTimeout(removeHint, 220);
  }

  function removeHint() {
    clearTimeout(hintTimer);
    if (hintBar) { hintBar.remove(); hintBar = null; }
  }

  // --- Activation / deactivation ---

  function activatePicker() {
    showHint();
    if (pickerActive) return; // already armed — we just re-showed the hint
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
    clearRange();
    removeStatusBar();
    removeHint();
    document.removeEventListener("mouseover",  onMouseOver,  true);
    document.removeEventListener("mouseout",   onMouseOut,   true);
    document.removeEventListener("mousedown",  onMouseDown,  true);
    document.removeEventListener("click",      onClickBlock, true);
    document.removeEventListener("keydown",    onKeyDown,    true);
  }

  // --- Hover highlight ---

  // The persistent style an element should carry based on its range role
  // (so hover can be layered on top and cleanly removed again).
  function baseStyleFor(el) {
    if (!rangeActive()) return "";
    if (el === wrapperEl) return WRAPPER_STYLE;
    if (selectedChildren().includes(el)) return SELECTED_STYLE;
    return "";
  }

  function restoreBase(el) {
    const base = baseStyleFor(el);
    if (base) applyStyle(el, base);
    else removeStyle(el);
  }

  function clearHover() {
    if (hoveredEl) restoreBase(hoveredEl);
    hoveredEl = null;
  }

  // Layer the right hover affordance on the element under the cursor.
  function applyHover(el) {
    if (!rangeActive()) { applyStyle(el, HOVER_STYLE); return; }
    if (el === wrapperEl || selectedChildren().includes(el)) return; // keep its role style
    // Inside the container → a valid extend target; outside → not allowed.
    applyStyle(el, resolveToWrapperChild(el) ? CANDIDATE_STYLE : DENIED_STYLE);
  }

  function onMouseOver(e) {
    const prev = hoveredEl;
    hoveredEl = e.target;
    if (prev && prev !== hoveredEl) restoreBase(prev);
    applyHover(hoveredEl);
    e.stopPropagation();
  }

  function onMouseOut(e) {
    if (e.target === hoveredEl) restoreBase(hoveredEl);
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
    removeHint(); // first interaction — the hint has done its job

    const target = e.target;

    if (e.shiftKey) {
      if (!rangeActive()) startRange(target);
      else                extendRangeTo(target);
      return;
    }

    // Plain click — clip that single element immediately.
    deactivatePicker();
    serializeElement(target)
      .then((clip) => browser.runtime.sendMessage({ type: "CLIP_CREATED", clip }))
      .catch((err) => console.error("Schnipsel: failed to serialize clip", err));
  }

  // --- Range building ---

  function startRange(target) {
    if (!target.parentElement) return; // e.g. <html>
    clearHover();
    wrapperEl = target.parentElement;
    siblings  = [...wrapperEl.children];
    const idx = siblings.indexOf(target);
    if (idx === -1) { wrapperEl = null; siblings = []; return; }
    anchorIndex = focusIndex = idx;
    renderSelection();
    updateStatusBar();
  }

  function extendRangeTo(target) {
    const child = resolveToWrapperChild(target);
    const idx = child ? siblings.indexOf(child) : -1;
    if (idx === -1) { flashDenied(target); return; }
    focusIndex = idx;
    clearHover();
    renderSelection();
    updateStatusBar();
  }

  // Grow/shrink the moving end of the range by one sibling.
  function growFocus(delta) {
    const next = focusIndex + delta;
    if (next < 0 || next >= siblings.length) { pulseWrapper(); return; }
    focusIndex = next;
    renderSelection();
    updateStatusBar();
  }

  // Acknowledge an invalid shift-click with a brief red pulse (no dialog).
  function flashDenied(el) {
    applyStyle(el, DENIED_FLASH);
    setTimeout(() => {
      if (el === wrapperEl || selectedChildren().includes(el)) return;
      if (el === hoveredEl) applyHover(el);
      else removeStyle(el);
    }, 450);
  }

  // Brief edge pulse when the range can't grow any further.
  function pulseWrapper() {
    if (!wrapperEl) return;
    applyStyle(wrapperEl, SELECTED_STYLE);
    setTimeout(() => { if (wrapperEl) applyStyle(wrapperEl, WRAPPER_STYLE); }, 180);
  }

  // Repaint container + selected siblings from the current anchor/focus.
  function renderSelection() {
    if (wrapperEl) removeStyle(wrapperEl);
    for (const el of siblings) removeStyle(el);
    if (!rangeActive()) return;
    applyStyle(wrapperEl, WRAPPER_STYLE);
    for (const el of selectedChildren()) applyStyle(el, SELECTED_STYLE);
  }

  // --- Keyboard handler ---

  function onKeyDown(e) {
    if (e.key === "Escape") {
      deactivatePicker();
      return;
    }

    if (!rangeActive()) return;

    // Grow / shrink the range to adjacent siblings (and stop the page scrolling).
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault(); e.stopPropagation();
      growFocus(+1);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault(); e.stopPropagation();
      growFocus(-1);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      const wrapper = wrapperEl;
      const sel = selectedChildren();
      deactivatePicker(); // strips picker chrome from the live nodes before cloning
      serializeSiblingRange(wrapper, sel)
        .then((clip) => clip && browser.runtime.sendMessage({ type: "CLIP_CREATED", clip }))
        .catch((err) => console.error("Schnipsel: failed to serialize clip", err));
    }
  }

  // --- Selection helpers ---

  function clearRange() {
    if (wrapperEl) removeStyle(wrapperEl);
    for (const el of siblings) removeStyle(el);
    wrapperEl = null;
    siblings = [];
    anchorIndex = focusIndex = -1;
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

  // Serialize a contiguous run of sibling elements while KEEPING their parent
  // container, so the container's framing (background, padding, flex, …) survives
  // but its other children are pruned away — like cutting a piece out of the page.
  async function serializeSiblingRange(wrapper, kept) {
    if (!wrapper || kept.length === 0) return null;

    // Strip any picker chrome from the container + its children so it isn't baked
    // into the inlined computed styles.
    removeStyle(wrapper);
    for (const child of wrapper.children) removeStyle(child);

    // Mark the live children we keep so we can find them in the clone after the
    // style/pseudo passes (which add nodes and would shift positional indices).
    const KEEP = "data-schnipsel-keep";
    for (const child of kept) child.setAttribute(KEEP, "1");

    let clone;
    try {
      // Clone the FULL container so inlineStyles' parallel live/clone walk aligns.
      clone = buildStyledClone(wrapper);
    } finally {
      for (const child of kept) child.removeAttribute(KEEP);
    }
    teardownProbe();

    // Prune: keep marked children + the container's own ::before/::after spans.
    for (const node of [...clone.children]) {
      if (node.hasAttribute(KEEP) || node.hasAttribute("data-schnipsel-pseudo")) {
        node.removeAttribute(KEEP);
      } else {
        node.remove();
      }
    }

    // inlineStyles froze the container's height as a pixel value measured WITH all
    // its original children. With most of them pruned, that height is too tall — let
    // the container shrink to just the kept content. We must clear BOTH the physical
    // and the logical (block-size) forms, since getComputedStyle inlines both.
    for (const prop of ["height", "min-height", "block-size", "min-block-size"]) {
      clone.style.removeProperty(prop);
    }

    const fontStyle = await collectFontFaces();
    const width = wrapper.getBoundingClientRect().width;
    const outer = document.createElement("div");
    outer.setAttribute("data-schnipsel-clip", "1");
    outer.style.cssText = `width:${Math.round(width)}px;box-sizing:border-box;`;
    if (fontStyle) {
      const styleEl = document.createElement("style");
      styleEl.textContent = fontStyle;
      outer.appendChild(styleEl);
    }
    outer.appendChild(clone);

    // Merge index tokens from each kept child so search covers the whole range.
    const merged = { text: [], images: [], links: [], ariaLabels: [], media: [] };
    for (const child of kept) {
      const t = extractIndexTokens(child);
      merged.text.push(t.text);
      merged.images.push(...t.images);
      merged.links.push(...t.links);
      merged.ariaLabels.push(...t.ariaLabels);
      merged.media.push(...t.media);
    }
    merged.text = merged.text.join(" ");

    return {
      html:        outer.outerHTML,
      elementTag:  wrapper.tagName.toLowerCase(),
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
    try {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText =
        "position:absolute;width:0;height:0;border:0;visibility:hidden;left:-9999px;";
      document.documentElement.appendChild(frame);
      // A freshly-created same-origin about:blank iframe already exposes a complete
      // <html><head></head><body></body> with ONLY the UA stylesheet applied — which
      // is exactly the pristine context we want. We deliberately do NOT call
      // document.open()/write(): on the *initial* about:blank, Firefox throws
      // "The operation is insecure", which used to abort the very first clip.
      probeDoc = frame.contentDocument || null;
      probeWin = frame.contentWindow || null;
      if (!probeDoc || !probeDoc.body) { teardownProbe(); }
    } catch (_) {
      teardownProbe(); // fall back to inlining every property (see getDefaults)
    }
  }

  function getDefaults(tagName) {
    if (defaultCache[tagName]) return defaultCache[tagName];
    ensureProbeDoc();
    // If the probe couldn't be set up, return no defaults — inlineStyles then keeps
    // every computed property (larger clips, but always correct).
    if (!probeDoc || !probeDoc.body || !probeWin) return {};
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

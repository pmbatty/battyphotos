/**
 * Browse mode: render every variant of a scenario as an image + metadata block.
 *
 * Clicking a variant's display image opens the lightbox in one of two modes:
 *   - Single mode: just the clicked image (used when you click the baseline /
 *     RAW variant — there's nothing to compare against).
 *   - Compare mode: baseline (RAW) on the left, the clicked variant on the
 *     right, with a draggable vertical divider revealing one or the other.
 *     Both viewers stay synced for pan / zoom / 1:1.
 */
import { escapeHtml } from "./escape.js";

let viewerA = null; // baseline / single
let viewerB = null; // top variant in compare mode

export function renderBrowseMode(root, data) {
  root.removeAttribute("aria-busy");

  const dims = data.image_dimensions;
  if (dims && dims.width && dims.height) {
    // Repurposed: the hero (above the variant cards) reserves layout space
    // using this aspect-ratio, eliminating CLS while the JPEG decodes.
    root.style.setProperty("--variant-aspect", `${dims.width} / ${dims.height}`);
  }
  if (data.detail_crop && data.detail_crop.w && data.detail_crop.h) {
    root.style.setProperty(
      "--crop-aspect",
      `${data.detail_crop.w} / ${data.detail_crop.h}`,
    );
    // detail_crop.w/h are *source* pixel dimensions; the build script
    // nearest-upscales 2× so the JPEG file is (2w × 2h) pixels with each
    // source pixel rendered as a 2×2 block (= "200% zoom"). To match
    // Lightroom's 200% on a Retina display, the JPEG must render at one
    // JPEG pixel per *device* pixel, which means CSS width = (2w) / dpr.
    // - DPR=1: crop renders at 2w CSS px = 2w device px = 200% view.
    // - DPR=2: crop renders at  w CSS px = 2w device px = 200% view.
    // Without the /dpr scaling, on DPR=2 the browser would stretch the JPEG
    // to 4w device px wide — a 400% view masquerading as 200%.
    // See: docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md (gotcha #4)
    const dpr = window.devicePixelRatio || 1;
    root.style.setProperty("--crop-width", `${(data.detail_crop.w * 2) / dpr}px`);
  }

  // Pass intrinsic dimensions through to the templated <img> tags so the
  // browser can reserve layout space before the source loads (eliminates
  // CLS, especially with loading="lazy") and decode off the main thread.
  const variantW = dims?.width || 0;
  const variantH = dims?.height || 0;
  const cropW = data.detail_crop?.w || 0;
  const cropH = data.detail_crop?.h || 0;

  const heroVariant = data.hero_slug
    ? data.images.find((v) => v.slug === data.hero_slug)
    : null;

  const prevLink = data.previous_scenario
    ? `<a class="scenario__nav-link" href="scenario.html?id=${encodeURIComponent(
        data.previous_scenario,
      )}" rel="prev">&larr; Previous scenario</a>`
    : "";
  const nextLink = data.next_scenario
    ? `<a class="scenario__nav-link" href="scenario.html?id=${encodeURIComponent(
        data.next_scenario,
      )}" rel="next">Next scenario &rarr;</a>`
    : "";

  root.innerHTML = `
    <nav class="scenario__breadcrumb">
      <a href="./">Noise reduction &amp; sharpening</a>
      <span aria-hidden="true">/</span>
      <span>${escapeHtml(data.title)}</span>
    </nav>

    <header class="scenario__header">
      <h1>${escapeHtml(data.title)}</h1>
      ${data.subtitle ? `<p class="lede">${escapeHtml(data.subtitle)}</p>` : ""}
      ${data.editor_note ? `<aside class="editor-note" role="note"><strong>Editor's note:</strong> ${escapeHtml(data.editor_note)}</aside>` : ""}
    </header>

    ${heroBlock(data, heroVariant, variantW, variantH)}

    <section class="variants">
      ${data.images.map((img) => variantCard(img, cropW, cropH)).join("")}
    </section>

    <nav class="scenario__pager" aria-label="Scenario navigation">
      ${prevLink}
      <a class="scenario__nav-link" href="./">All scenarios</a>
      ${nextLink}
    </nav>
  `;

  attachLightboxHandlers(data);
}

function heroBlock(data, heroVariant, variantW, variantH) {
  // Hero is optional. When the manifest's hero_image isn't found among
  // variants the build script emits page-data without one, and we render
  // the page without it.
  if (!data.hero || !heroVariant) return "";
  const sizeAttrs = variantW && variantH ? ` width="${variantW}" height="${variantH}"` : "";
  const altText = heroVariant.caption || heroVariant.title || data.title;
  return `
    <figure class="scenario__hero">
      <button
        class="scenario__hero-btn"
        type="button"
        data-slug="${escapeAttr(heroVariant.slug)}"
        aria-label="Open ${escapeAttr(heroVariant.title)} at full resolution"
      >
        <img
          src="${escapeAttr(data.hero)}"${sizeAttrs}
          alt="${escapeAttr(altText)}"
          fetchpriority="high"
          decoding="async"
        />
        <span class="scenario__hero-hint">${escapeHtml(heroVariant.title)} &middot; click to compare</span>
      </button>
    </figure>
  `;
}

function variantCard(img, cropW, cropH) {
  // The crop JPEG's intrinsic dimensions are (2 × baseline.crop.w, 2 × baseline.crop.h)
  // regardless of the variant's source-pixel scale — the build script resamples
  // to a constant output size so all crop cards occupy the same physical screen
  // area. Emit those as the img attrs so the natural-size aspect matches the
  // file and CLS reservation is exact.
  const cropAttrs = cropW && cropH ? ` width="${cropW * 2}" height="${cropH * 2}"` : "";
  return `
    <article class="variant" data-slug="${escapeAttr(img.slug)}">
      <button
        class="variant__open-btn"
        type="button"
        data-slug="${escapeAttr(img.slug)}"
        aria-label="Open ${escapeAttr(img.title)} at full resolution"
      >
        <figure class="variant__crop">
          <img src="${img.crop}"${cropAttrs} alt="200% pixel-zoom detail of ${escapeAttr(img.title)}" loading="lazy" decoding="async" />
          <figcaption>200% pixel zoom (centred on the same scene point)</figcaption>
        </figure>
        <span class="variant__zoom-hint">Click to compare &middot; full resolution</span>
      </button>
      <div class="variant__meta">
        <h2 class="variant__title">${escapeHtml(img.title)}</h2>
        ${img.caption ? `<p class="variant__caption">${escapeHtml(img.caption)}</p>` : ""}
        ${critiqueBlock(img.critique)}
      </div>
    </article>
  `;
}

function critiqueBlock(critique) {
  if (!critique || !critique.text) {
    return `<p class="variant__no-critique">AI critique not yet available for this variant.</p>`;
  }
  const score = Number.isInteger(critique.potential_score)
    ? renderStars(critique.potential_score)
    : "";
  const attribution = critique.model
    ? `<span class="critique__model">${escapeHtml(critique.model)}</span>`
    : "";
  return `
    <div class="critique">
      <div class="critique__header">
        ${score}
        <span class="critique__label">darwain critique</span>
        ${attribution}
      </div>
      <details class="critique__details" open>
        <summary class="critique__summary">Show analysis</summary>
        <p class="critique__text">${escapeHtml(critique.text)}</p>
      </details>
    </div>
  `;
}

function renderStars(score) {
  const filled = Math.max(0, Math.min(5, score));
  const empty = 5 - filled;
  const stars = "★".repeat(filled) + "☆".repeat(empty);
  return `<span class="critique__score" aria-label="Score: ${filled} out of 5">${stars}</span>`;
}

function attachLightboxHandlers(data) {
  const lightbox = document.getElementById("lightbox");
  const zoomEl = document.getElementById("lightbox-zoom");
  const fitBtn = document.getElementById("lightbox-fit");
  const zoom100Btn = document.getElementById("lightbox-100");
  const zoom200Btn = document.getElementById("lightbox-200");
  const closeBtn = lightbox.querySelector(".lightbox__close");
  const stage = document.getElementById("lightbox-stage");
  const viewerAEl = document.getElementById("lightbox-viewer-a");
  const viewerBEl = document.getElementById("lightbox-viewer-b");
  const layerB = document.getElementById("lightbox-layer-b");
  const divider = document.getElementById("lightbox-divider");
  const handle = document.getElementById("lightbox-divider-handle");
  const badgeLeft = document.getElementById("lightbox-badge-left");
  const badgeRight = document.getElementById("lightbox-badge-right");
  const critiqueLeft = document.getElementById("lightbox-critique-left");
  const critiqueRight = document.getElementById("lightbox-critique-right");
  const pickA = document.getElementById("lightbox-pick-a");
  const pickB = document.getElementById("lightbox-pick-b");

  const sides = {
    left: { badge: badgeLeft, panel: critiqueLeft },
    right: { badge: badgeRight, panel: critiqueRight },
  };
  const pickers = { a: pickA, b: pickB };

  // First image in display order is the baseline (RAW) for compare mode.
  const baseline = data.images[0];

  // ---- Lightbox state ----------------------------------------------------
  // `swapsInFlight` counts viewer.open() calls whose post-load handlers
  // haven't fired yet. While > 0, viewport-sync handlers suppress
  // themselves so an in-flight swap doesn't yank the partner viewer.
  // `insideSync` is the conventional bidirectional-sync feedback guard.
  let swapsInFlight = 0;
  let insideSync = false;
  const pendingSwapTokens = new Set();
  let currentA = null;
  let currentB = null;
  let lastZoomText = null;
  function shouldSuppressSync() {
    return swapsInFlight > 0 || insideSync;
  }

  // ---- Picker option HTML ------------------------------------------------
  function buildOptions(selectedSlug) {
    return data.images
      .map((img) => {
        const score = img.critique && Number.isInteger(img.critique.potential_score)
          ? img.critique.potential_score
          : null;
        const label = score !== null ? `${img.title} (${score})` : img.title;
        const sel = img.slug === selectedSlug ? " selected" : "";
        const titleAttr = img.caption
          ? ` title="${escapeAttr(img.caption)}"`
          : "";
        return `<option value="${escapeAttr(img.slug)}"${sel}${titleAttr}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  // ---- Variant grid + hero → open lightbox ------------------------------
  // Both the per-variant crop button and the page hero use `data-slug` to
  // identify the right-hand variant; baseline (RAW) is always the left.
  // If the slug is the baseline itself the lightbox renders single-image
  // mode automatically (A==B path inside openLightbox).
  document.querySelectorAll(".variant__open-btn, .scenario__hero-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.dataset.slug;
      const variant = data.images.find((v) => v.slug === slug);
      if (!variant) return;
      openLightbox({ a: baseline, b: variant });
    });
  });

  // ---- Picker change → swap viewer image --------------------------------
  pickA.addEventListener("change", () => {
    const variant = data.images.find((v) => v.slug === pickA.value);
    if (variant) swapVariant("a", variant);
  });
  pickB.addEventListener("change", () => {
    const variant = data.images.find((v) => v.slug === pickB.value);
    if (variant) swapVariant("b", variant);
  });

  // ---- Critique badges + panels -----------------------------------------
  Object.keys(sides).forEach((sideKey) => {
    const { badge, panel } = sides[sideKey];
    badge.addEventListener("click", () => {
      if (badge.disabled) return;
      setCritiqueOpen(sideKey, panel.hidden);
    });
    const close = panel.querySelector(".lightbox__critique-close");
    close.addEventListener("click", () => setCritiqueOpen(sideKey, false));
  });

  // ---- Close, zoom presets, backdrop ------------------------------------
  closeBtn.addEventListener("click", closeLightbox);

  // The viewer of the larger image. Defines what 100%/200% mean in scale-aware
  // mode (upsizing project) — its pixel zoom is the canonical reading; the
  // smaller viewer follows via sync at proportionally higher pixel zoom.
  // For same-size variants (noise-sharpening), returns viewerA arbitrarily;
  // sync makes the choice immaterial.
  function getReferenceViewer() {
    if (!viewerA || !viewerB) return null;
    const aW = (currentA && currentA.width) || 0;
    const bW = (currentB && currentB.width) || 0;
    return aW >= bW ? viewerA : viewerB;
  }

  function isSwapping() {
    return swapsInFlight > 0;
  }

  // Lock the zoom toolbar while a swap is in flight. Without this, clicking
  // 100%/200% mid-swap drives zoom on a viewer whose visible image is the
  // PREVIOUS variant — confusing and wrong. Pickers also self-lock per side
  // (see setPickerLocked) so the user can still swap the OTHER side.
  function setSwapToolbarLocked(locked) {
    fitBtn.disabled = locked;
    zoom100Btn.disabled = locked;
    zoom200Btn.disabled = locked;
  }

  // Photo-app-style zoom: pct=100 → 1 source pixel per device pixel on the
  // REFERENCE (larger) viewer. The smaller viewer's pixel zoom is whatever
  // the same VIEWPORT zoom resolves to for its pixel dimensions — typically
  // higher (e.g. a 1× partner of a 2× reference renders at 200% pixel zoom).
  //
  // The /dpr term converts CSS-pixels-per-source-pixel (what OSD's
  // imageToViewportZoom takes) to device-pixels-per-source-pixel (what
  // photographers mean by "100%"). See gotcha #4 in
  // docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md.
  //
  // Race fix #1: clamp + sync-to-partner happen inside `insideSync` so the
  // partner doesn't react twice — once to the pre-clamp zoom, once to the
  // post-clamp zoom. Drive the partner ONCE explicitly with the post-clamp
  // viewport state.
  function zoomToPct(pct) {
    if (isSwapping()) return;
    const ref = getReferenceViewer();
    if (!ref || !ref.viewport) return;
    const dpr = window.devicePixelRatio || 1;
    const target = ref.viewport.imageToViewportZoom(pct / 100 / dpr);
    insideSync = true;
    try {
      ref.viewport.zoomTo(target);
      ref.viewport.applyConstraints();
    } finally {
      insideSync = false;
    }
    const other = ref === viewerA ? viewerB : viewerA;
    if (other && other.viewport) {
      insideSync = true;
      try {
        other.viewport.zoomTo(ref.viewport.getZoom(), null, true);
        other.viewport.panTo(ref.viewport.getCenter(), true);
      } finally {
        insideSync = false;
      }
    }
    updateZoomReadout();
  }
  fitBtn.addEventListener("click", () => {
    if (isSwapping()) return;
    // Reset to the configured defaultZoomLevel (0 → fit-to-viewport). Sync
    // propagates to the partner — both viewers fit their respective full
    // images, which means same scene region (full image) for any pair.
    if (!viewerA || !viewerA.viewport) return;
    viewerA.viewport.goHome();
  });
  zoom100Btn.addEventListener("click", () => zoomToPct(100));
  zoom200Btn.addEventListener("click", () => zoomToPct(200));
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  // Document-level Escape close. Skip when focus is inside a `<select>` —
  // native dropdowns also consume Escape to cancel; we don't want to steal
  // it and accidentally close the whole lightbox while the user is just
  // backing out of a picker.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || lightbox.hidden) return;
    if (e.target && e.target.tagName === "SELECT") return;
    closeLightbox();
  });

  // ---- Divider drag (rAF-throttled) -------------------------------------
  let dragging = false;
  let capturedPointerId = null;
  let dragRect = null;
  let pendingDividerPct = null;
  let dividerRafQueued = false;

  function setDividerX(percent) {
    const pct = Math.max(0, Math.min(100, percent));
    divider.style.left = `${pct}%`;
    // Clip the layer (the absolutely-positioned shell) — OSD owns the inner
    // viewer's inline styles, so we can't reliably target that.
    layerB.style.clipPath = `inset(0 0 0 ${pct}%)`;
    handle.setAttribute("aria-valuenow", String(Math.round(pct)));
  }

  function readDividerPct() {
    const parsed = parseFloat(divider.style.left);
    return Number.isFinite(parsed) ? parsed : 50;
  }

  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    capturedPointerId = e.pointerId;
    // Cache the stage rect once: it doesn't move during a drag, and reading
    // getBoundingClientRect on every pointermove forces synchronous layout
    // (especially after the previous frame's clip-path write dirtied things).
    dragRect = stage.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging || !dragRect) return;
    pendingDividerPct = ((e.clientX - dragRect.left) / dragRect.width) * 100;
    if (!dividerRafQueued) {
      dividerRafQueued = true;
      requestAnimationFrame(() => {
        dividerRafQueued = false;
        if (pendingDividerPct !== null) {
          setDividerX(pendingDividerPct);
          pendingDividerPct = null;
        }
      });
    }
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    dragRect = null;
    pendingDividerPct = null;
    if (e && handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    capturedPointerId = null;
  }
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("dblclick", (e) => {
    e.preventDefault();
    setDividerX(50);
  });
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 2;
    const current = readDividerPct();
    if (e.key === "ArrowLeft") {
      setDividerX(current - step);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      setDividerX(current + step);
      e.preventDefault();
    } else if (e.key === "Home") {
      setDividerX(0);
      e.preventDefault();
    } else if (e.key === "End") {
      setDividerX(100);
      e.preventDefault();
    }
  });

  // ---- Open / close lightbox --------------------------------------------
  function openLightbox({ a, b }) {
    closeViewers();

    currentA = a;
    currentB = b;
    lastZoomText = null;

    pickA.innerHTML = buildOptions(a.slug);
    pickB.innerHTML = buildOptions(b.slug);
    pickA.title = a.caption || "";
    pickB.title = b.caption || "";
    setPickerLocked("a", false);
    setPickerLocked("b", false);

    zoomEl.textContent = "Current: …";
    lightbox.hidden = false;
    document.body.classList.add("body--lightbox-open");

    // Race fix #2: bump maxZoomPixelRatio per-pair so the smaller viewer can
    // reach the pixel zoom required to mirror the larger viewer's scene
    // region at "200%" or beyond. With a (1×, 4×) pair clicked to 200%,
    // the smaller side needs 800% pixel zoom (8 device px per source px) —
    // OSD's default 4 silently clamps that, decoupling the views and
    // making the readout lie. Default to the larger of 4 (for same-size
    // pairs) or scaleRatio×2 (covers up to "200%" on any pair).
    const maxPixelRatio = computeMaxPixelRatio(a, b);

    // Always create both viewers — they always exist, we just toggle visibility
    // of the divider / badges / clip-path based on whether A and B differ.
    viewerA = OpenSeadragon({
      element: viewerAEl,
      tileSources: { type: "image", url: a.display, buildPyramid: false },
      // Path resolves to noise-sharpening/vendor/... from BOTH
      // noise-sharpening/scenario.html (../noise-sharpening = self) and
      // upsizing/scenario.html (sibling), so the same viewer.js works for
      // both sub-projects without parameterization.
      prefixUrl: "../noise-sharpening/vendor/openseadragon-4.1.1/images/",
      showNavigator: false,
      showRotationControl: false,
      showFullPageControl: false,
      autoHideControls: false,
      maxZoomPixelRatio: maxPixelRatio,
      minZoomImageRatio: 0.5,
      defaultZoomLevel: 0,
      gestureSettingsMouse: { clickToZoom: false, scrollToZoom: true },
      gestureSettingsTouch: { clickToZoom: false },
      animationTime: 0.4,
    });

    viewerB = OpenSeadragon({
      element: viewerBEl,
      tileSources: { type: "image", url: b.display, buildPyramid: false },
      // Top viewer reuses A's controls — no zoom buttons of its own.
      showNavigationControl: false,
      showNavigator: false,
      showRotationControl: false,
      showFullPageControl: false,
      autoHideControls: false,
      maxZoomPixelRatio: maxPixelRatio,
      minZoomImageRatio: 0.5,
      defaultZoomLevel: 0,
      gestureSettingsMouse: { clickToZoom: false, scrollToZoom: true },
      gestureSettingsTouch: { clickToZoom: false },
      // Snap immediately — A drives the animation; B follows frame-by-frame.
      animationTime: 0,
    });

    // Race fix #3: register sync handlers BEFORE the readout subscriber.
    // OSD fires zoom-event handlers in registration order; if readout ran
    // first, it would read the stale partner zoom (pre-sync) and flicker
    // the wrong intermediate value during animated zooms.
    bindViewportSync(viewerA, viewerB);
    viewerA.addHandler("open", updateZoomReadout);
    viewerA.addHandler("zoom", updateZoomReadout);
    // pan + zoom cover both interactive and animated viewport changes; we
    // intentionally don't subscribe to `animation` (every-frame) — it fires
    // on top of pan/zoom and would multiply the work without adding signal.
    viewerB.addHandler("zoom", updateZoomReadout);

    setDividerX(50);
    updateMode();
  }

  // Returns the OSD `maxZoomPixelRatio` to use for a given (A, B) pair.
  // For same-size variants, 4 (the OSD-friendly default). For different
  // sizes, scaleRatio × 2 — enough to support the "200%" preset, where the
  // smaller viewer needs to render at scaleRatio × 200 percent pixel zoom.
  function computeMaxPixelRatio(a, b) {
    const aW = (a && a.width) || 0;
    const bW = (b && b.width) || 0;
    if (!aW || !bW) return 4;
    const scaleRatio = Math.max(aW, bW) / Math.min(aW, bW);
    return Math.max(4, scaleRatio * 2);
  }

  function closeViewers() {
    // Cancel any in-flight swap restorations so they don't fire on a
    // destroyed viewer (and don't leave swapsInFlight counter stranded).
    pendingSwapTokens.forEach((token) => {
      token.cancelled = true;
    });
    pendingSwapTokens.clear();
    swapsInFlight = 0;
    insideSync = false;

    if (viewerA) {
      try { viewerA.destroy(); } catch (e) { /* ignore */ }
      viewerA = null;
    }
    if (viewerB) {
      try { viewerB.destroy(); } catch (e) { /* ignore */ }
      viewerB = null;
    }
  }

  function closeLightbox() {
    // Release pointer capture if mid-drag — otherwise `dragging` would stay
    // true into the next open and the divider would jump on first hover.
    if (dragging && capturedPointerId !== null) {
      try {
        if (handle.hasPointerCapture(capturedPointerId)) {
          handle.releasePointerCapture(capturedPointerId);
        }
      } catch (e) { /* ignore */ }
    }
    dragging = false;
    capturedPointerId = null;
    dragRect = null;
    pendingDividerPct = null;
    dividerRafQueued = false;

    lightbox.hidden = true;
    document.body.classList.remove("body--lightbox-open");
    closeViewers();
  }

  // ---- Mode + side state ------------------------------------------------
  function updateMode() {
    const isCompare = !!(currentA && currentB && currentA.slug !== currentB.slug);
    divider.hidden = !isCompare;
    badgeLeft.hidden = !isCompare;
    badgeRight.hidden = !isCompare;
    // Layer B is always visible (its OSD instance always renders); single-mode
    // visually hides it via clip-path: inset(0 0 0 100%) below.
    if (isCompare) {
      setBadgeContent("left", currentA);
      setBadgeContent("right", currentB);
      // Restore the divider's last position (default 50%).
      setDividerX(readDividerPct());
    } else {
      // Single-image presentation: clip the top layer entirely so only A
      // shows even though both viewers exist.
      layerB.style.clipPath = "inset(0 0 0 100%)";
      setCritiqueOpen("left", false);
      setCritiqueOpen("right", false);
    }
  }

  function setBadgeContent(sideKey, variant) {
    const { badge, panel } = sides[sideKey];
    const titleEl = badge.querySelector(".lightbox__badge-title");
    const iconEl = badge.querySelector(".lightbox__info-icon");
    titleEl.textContent = variant.title;
    const hasCritique = !!(variant.critique && variant.critique.text);
    iconEl.hidden = !hasCritique;
    badge.disabled = !hasCritique;
    panel.querySelector(".lightbox__critique-caption").textContent =
      variant.caption || "";
    if (hasCritique) {
      const stars = renderStars(variant.critique.potential_score);
      panel.querySelector(".lightbox__critique-stars").innerHTML = stars;
      panel.querySelector(".lightbox__critique-model").textContent =
        variant.critique.model || "";
      panel.querySelector(".lightbox__critique-text").textContent = variant.critique.text;
    } else {
      panel.querySelector(".lightbox__critique-stars").innerHTML = "";
      panel.querySelector(".lightbox__critique-model").textContent = "";
      panel.querySelector(".lightbox__critique-text").textContent = "";
      setCritiqueOpen(sideKey, false);
    }
  }

  function setCritiqueOpen(sideKey, open) {
    const { badge, panel } = sides[sideKey];
    panel.hidden = !open;
    badge.setAttribute("aria-expanded", String(!!open));
  }

  function setPickerLocked(which, locked) {
    pickers[which].disabled = locked;
  }

  // ---- Picker swap with viewport preservation ---------------------------
  function swapVariant(which, variant) {
    const viewer = which === "a" ? viewerA : viewerB;
    if (!viewer || !viewer.viewport) return;

    const previousVariant = which === "a" ? currentA : currentB;
    const zoom = viewer.viewport.getZoom();
    const center = viewer.viewport.getCenter();

    // Disable the picker while its swap is in flight — prevents back-to-back
    // changes piling up on the same viewer. Other side's picker stays usable.
    setPickerLocked(which, true);
    // Race fix #4: also lock the zoom toolbar. Click-100% mid-swap would
    // drive zoom on a viewer whose visible image is the previous variant.
    setSwapToolbarLocked(true);

    // Track this swap so closeViewers can cancel it cleanly. swapsInFlight
    // suppresses sync until ALL pending swaps complete.
    //
    // Race fix #5: `swapsInFlight++` MUST happen before `viewer.open()`.
    // OSD's `open` event handler internally fires `goHome`-like pan/zoom
    // events; without the counter raised first, those events would
    // propagate through the still-active sync handler to the partner
    // viewer (snap-to-home, then back). Don't reorder.
    const token = { cancelled: false };
    pendingSwapTokens.add(token);
    swapsInFlight++;

    function clearSwap() {
      if (pendingSwapTokens.has(token)) {
        pendingSwapTokens.delete(token);
        swapsInFlight = Math.max(0, swapsInFlight - 1);
      }
      setPickerLocked(which, false);
      // Re-enable toolbar only when ALL swaps have cleared.
      if (swapsInFlight === 0) setSwapToolbarLocked(false);
    }

    viewer.addOnceHandler("open", () => {
      if (token.cancelled || !viewer.viewport) {
        clearSwap();
        return;
      }
      // Race fix #2: the new variant may have a different scale to its
      // partner — recompute maxZoomPixelRatio for the new pair before any
      // user zoom-preset action lands.
      const maxPixelRatio = computeMaxPixelRatio(currentA, currentB);
      if (viewerA && viewerA.viewport) viewerA.viewport.maxZoomPixelRatio = maxPixelRatio;
      if (viewerB && viewerB.viewport) viewerB.viewport.maxZoomPixelRatio = maxPixelRatio;

      // Restore captured viewport. Uses insideSync so the partner viewer
      // doesn't react to A's transient zoom/pan events during the restore.
      // Viewport coords are scene-relative (image-normalized), so the
      // captured (zoom, center) preserves the user's scene region across
      // a 1×↔4× swap without any per-scale math here.
      insideSync = true;
      try {
        viewer.viewport.zoomTo(zoom, null, true);
        viewer.viewport.panTo(center, true);
      } finally {
        insideSync = false;
      }
      clearSwap();
      updateZoomReadout();
    });
    viewer.addOnceHandler("open-failed", () => {
      if (token.cancelled) {
        clearSwap();
        return;
      }
      // Roll back the picker selection + currentA/B to the last good value.
      // Otherwise the picker shows variant X while the viewer is empty.
      pickers[which].value = previousVariant ? previousVariant.slug : "";
      pickers[which].title = previousVariant && previousVariant.caption ? previousVariant.caption : "";
      if (which === "a") currentA = previousVariant;
      else currentB = previousVariant;
      clearSwap();
      updateMode();
    });

    // Optimistically update state — `open-failed` rolls back if the load fails.
    if (which === "a") {
      currentA = variant;
      pickA.title = variant.caption || "";
    } else {
      currentB = variant;
      pickB.title = variant.caption || "";
    }
    updateMode();

    viewer.open({ type: "image", url: variant.display });
  }

  // ---- Viewport sync ----------------------------------------------------
  function bindViewportSync(a, b) {
    function sync(src, dst) {
      if (shouldSuppressSync()) return;
      if (!dst || !dst.viewport) return;
      insideSync = true;
      try {
        dst.viewport.zoomTo(src.viewport.getZoom(), null, true);
        dst.viewport.panTo(src.viewport.getCenter(), true);
      } finally {
        insideSync = false;
      }
    }
    a.addHandler("pan", () => sync(a, b));
    a.addHandler("zoom", () => sync(a, b));
    b.addHandler("pan", () => sync(b, a));
    b.addHandler("zoom", () => sync(b, a));
  }

  function pctFor(viewer) {
    if (!viewer || !viewer.viewport) return null;
    const dpr = window.devicePixelRatio || 1;
    const z = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom());
    const pct = Math.round(z * dpr * 100);
    return Number.isFinite(pct) ? pct : null;
  }

  function updateZoomReadout() {
    const pctA = pctFor(viewerA);
    const pctB = pctFor(viewerB);
    if (pctA === null) return;
    // Single-image mode (A == B) or same-size variants (e.g. all of
    // noise-sharpening) → one reading. Different sizes → two readings,
    // ordered to match the lightbox's left/right badges (A | B).
    const isCompare = !!(currentA && currentB && currentA.slug !== currentB.slug);
    const sameSize = ((currentA && currentA.width) || 0) === ((currentB && currentB.width) || 0);
    const text = (!isCompare || sameSize)
      ? `Current: ${pctA}%`
      : `Current: ${pctA}% | ${pctB}%`;
    if (text !== lastZoomText) {
      zoomEl.textContent = text;
      lastZoomText = text;
    }
  }
}

// `escapeAttr` is identical to `escapeHtml` — kept as an alias to make sinks
// self-documenting (template-literal use in attribute vs body context).
const escapeAttr = escapeHtml;

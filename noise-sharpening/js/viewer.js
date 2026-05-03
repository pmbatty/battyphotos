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
    root.style.setProperty("--crop-width", `${data.detail_crop.w}px`);
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
  const cropAttrs = cropW && cropH ? ` width="${cropW}" height="${cropH}"` : "";
  return `
    <article class="variant" data-slug="${escapeAttr(img.slug)}">
      <button
        class="variant__open-btn"
        type="button"
        data-slug="${escapeAttr(img.slug)}"
        aria-label="Open ${escapeAttr(img.title)} at full resolution"
      >
        <figure class="variant__crop">
          <img src="${img.crop_200}"${cropAttrs} alt="200% pixel detail of ${escapeAttr(img.title)}" loading="lazy" decoding="async" />
          <figcaption>200% pixel detail (centered, nearest-neighbor upscaled)</figcaption>
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
  const oneToOneBtn = document.getElementById("lightbox-1to1");
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
  let lastZoomPct = null;
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

  // ---- Close, 1:1, backdrop ---------------------------------------------
  closeBtn.addEventListener("click", closeLightbox);
  oneToOneBtn.addEventListener("click", () => {
    if (!viewerA || !viewerA.viewport) return;
    const vp = viewerA.viewport;
    // Lightroom's 1:1 = 1 source pixel per *device* pixel. Account for DPR.
    vp.zoomTo(vp.imageToViewportZoom(1 / (window.devicePixelRatio || 1)));
    vp.applyConstraints();
  });
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
    lastZoomPct = null;

    pickA.innerHTML = buildOptions(a.slug);
    pickB.innerHTML = buildOptions(b.slug);
    pickA.title = a.caption || "";
    pickB.title = b.caption || "";
    setPickerLocked("a", false);
    setPickerLocked("b", false);

    zoomEl.textContent = "…";
    lightbox.hidden = false;
    document.body.classList.add("body--lightbox-open");

    // Always create both viewers — they always exist, we just toggle visibility
    // of the divider / badges / clip-path based on whether A and B differ.
    viewerA = OpenSeadragon({
      element: viewerAEl,
      tileSources: { type: "image", url: a.display, buildPyramid: false },
      prefixUrl: "vendor/openseadragon-4.1.1/images/",
      showNavigator: false,
      showRotationControl: false,
      showFullPageControl: false,
      autoHideControls: false,
      maxZoomPixelRatio: 4,
      minZoomImageRatio: 0.5,
      defaultZoomLevel: 0,
      gestureSettingsMouse: { clickToZoom: false, scrollToZoom: true },
      gestureSettingsTouch: { clickToZoom: false },
      animationTime: 0.4,
    });
    viewerA.addHandler("open", updateZoomReadout);
    // pan + zoom cover both interactive and animated viewport changes; we
    // intentionally don't subscribe to `animation` (every-frame) — it fires
    // on top of pan/zoom and would multiply the work without adding signal.
    viewerA.addHandler("zoom", updateZoomReadout);

    viewerB = OpenSeadragon({
      element: viewerBEl,
      tileSources: { type: "image", url: b.display, buildPyramid: false },
      // Top viewer reuses A's controls — no zoom buttons of its own.
      showNavigationControl: false,
      showNavigator: false,
      showRotationControl: false,
      showFullPageControl: false,
      autoHideControls: false,
      maxZoomPixelRatio: 4,
      minZoomImageRatio: 0.5,
      defaultZoomLevel: 0,
      gestureSettingsMouse: { clickToZoom: false, scrollToZoom: true },
      gestureSettingsTouch: { clickToZoom: false },
      // Snap immediately — A drives the animation; B follows frame-by-frame.
      animationTime: 0,
    });

    bindViewportSync(viewerA, viewerB);

    setDividerX(50);
    updateMode();
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

    // Track this swap so closeViewers can cancel it cleanly. swapsInFlight
    // suppresses sync until ALL pending swaps complete.
    const token = { cancelled: false };
    pendingSwapTokens.add(token);
    swapsInFlight++;

    function clearSwap() {
      if (pendingSwapTokens.has(token)) {
        pendingSwapTokens.delete(token);
        swapsInFlight = Math.max(0, swapsInFlight - 1);
      }
      setPickerLocked(which, false);
    }

    viewer.addOnceHandler("open", () => {
      if (token.cancelled || !viewer.viewport) {
        clearSwap();
        return;
      }
      // Restore captured viewport. Uses insideSync so the partner viewer
      // doesn't react to A's transient zoom/pan events during the restore.
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

  function updateZoomReadout() {
    if (!viewerA || !viewerA.viewport) return;
    const vp = viewerA.viewport;
    const dpr = window.devicePixelRatio || 1;
    const pct = Math.round(vp.viewportToImageZoom(vp.getZoom()) * dpr * 100);
    if (Number.isFinite(pct) && pct !== lastZoomPct) {
      zoomEl.textContent = `${pct}%`;
      lastZoomPct = pct;
    }
  }
}

// `escapeAttr` is identical to `escapeHtml` — kept as an alias to make sinks
// self-documenting (template-literal use in attribute vs body context).
const escapeAttr = escapeHtml;

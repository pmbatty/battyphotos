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
  root.classList.add("scenario--browse");
  root.removeAttribute("aria-busy");

  const dims = data.image_dimensions;
  if (dims && dims.width && dims.height) {
    root.style.setProperty("--variant-aspect", `${dims.width} / ${dims.height}`);
  }
  if (data.detail_crop && data.detail_crop.w && data.detail_crop.h) {
    root.style.setProperty(
      "--crop-aspect",
      `${data.detail_crop.w} / ${data.detail_crop.h}`,
    );
    root.style.setProperty("--crop-width", `${data.detail_crop.w}px`);
  }

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

    <section class="variants">
      ${data.images.map((img) => variantCard(img)).join("")}
    </section>

    <nav class="scenario__pager" aria-label="Scenario navigation">
      ${prevLink}
      <a class="scenario__nav-link" href="./">All scenarios</a>
      ${nextLink}
    </nav>
  `;

  attachLightboxHandlers(data);
}

function variantCard(img) {
  return `
    <article class="variant" data-slug="${escapeAttr(img.slug)}">
      <div class="variant__display">
        <button
          class="variant__display-btn"
          type="button"
          data-slug="${escapeAttr(img.slug)}"
          aria-label="Open ${escapeAttr(img.title)} at full resolution"
        >
          <img src="${img.display}" alt="${escapeAttr(img.caption || img.title)}" loading="lazy" />
          <span class="variant__zoom-hint">Click to compare &middot; full resolution</span>
        </button>
      </div>
      <div class="variant__meta">
        <h2 class="variant__title">${escapeHtml(img.title)}</h2>
        ${img.caption ? `<p class="variant__caption">${escapeHtml(img.caption)}</p>` : ""}
        ${critiqueBlock(img.critique)}
      </div>
      <div class="variant__crops">
        <figure class="variant__crop" data-level="100">
          <img src="${img.crop_100}" alt="100% pixel detail of ${escapeAttr(img.title)}" loading="lazy" />
          <figcaption>100% pixel detail</figcaption>
        </figure>
        <figure class="variant__crop" data-level="200">
          <img src="${img.crop_200}" alt="200% pixel detail of ${escapeAttr(img.title)}" loading="lazy" />
          <figcaption>200% pixel detail (centered, nearest-neighbor upscaled)</figcaption>
        </figure>
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
  const sepEl = document.getElementById("lightbox-sep");

  const sides = {
    left: { badge: badgeLeft, panel: critiqueLeft },
    right: { badge: badgeRight, panel: critiqueRight },
  };

  // First image in display order is the baseline (RAW) for compare mode.
  // image_order in the manifest puts RAW first in every Spotted Owlet-style
  // scenario; we'll add an explicit baseline_image manifest field if the
  // convention ever needs to bend.
  const baseline = data.images[0];

  // Sync state shared between the in-flight viewport-sync handlers and the
  // image-swap operation so swapping doesn't trigger feedback loops.
  let syncing = false;
  let currentA = null; // variant currently in viewerA
  let currentB = null; // variant currently in viewerB

  // Picker option HTML — title plus AI rating in parens (1-5) when present.
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

  document.querySelectorAll(".variant__display-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.dataset.slug;
      const variant = data.images.find((v) => v.slug === slug);
      if (!variant) return;
      // Always open with both A and B set: A=baseline, B=clicked variant.
      // If user clicked the baseline, A==B and we visually present as single mode.
      openLightbox({ a: baseline, b: variant });
    });
  });

  pickA.addEventListener("change", () => {
    const variant = data.images.find((v) => v.slug === pickA.value);
    if (variant) swapVariant("a", variant);
  });
  pickB.addEventListener("change", () => {
    const variant = data.images.find((v) => v.slug === pickB.value);
    if (variant) swapVariant("b", variant);
  });

  // Critique badge / panel toggles. The badge is the trigger (clicking the
  // whole title or the "i" icon does the same thing). Each panel also has its
  // own close button for explicit dismissal.
  Object.keys(sides).forEach((sideKey) => {
    const { badge, panel } = sides[sideKey];
    badge.addEventListener("click", () => {
      if (badge.disabled) return;
      setCritiqueOpen(sideKey, panel.hidden);
    });
    const close = panel.querySelector(".lightbox__critique-close");
    close.addEventListener("click", () => setCritiqueOpen(sideKey, false));
  });

  closeBtn.addEventListener("click", closeLightbox);
  oneToOneBtn.addEventListener("click", () => {
    if (!viewerA) return;
    const vp = viewerA.viewport;
    // Lightroom's 1:1 = 1 source pixel per *device* pixel. Account for DPR.
    vp.zoomTo(vp.imageToViewportZoom(1 / (window.devicePixelRatio || 1)));
    vp.applyConstraints();
  });
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
  });

  // Divider drag: handle is the only pointer-target so OSD pan still works
  // anywhere else inside the stage.
  let dragging = false;
  function setDividerX(percent) {
    const pct = Math.max(0, Math.min(100, percent));
    divider.style.left = `${pct}%`;
    // Clip the layer (the absolutely-positioned shell) — OSD owns the inner
    // viewer's inline styles, so we can't reliably target that.
    layerB.style.clipPath = `inset(0 0 0 ${pct}%)`;
    handle.setAttribute("aria-valuenow", String(Math.round(pct)));
  }
  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = stage.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    setDividerX(x);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("dblclick", (e) => {
    e.preventDefault();
    setDividerX(50);
  });
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 2;
    const current = parseFloat(divider.style.left) || 50;
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

  function openLightbox({ a, b }) {
    closeViewers();

    currentA = a;
    currentB = b;

    pickA.innerHTML = buildOptions(a.slug);
    pickB.innerHTML = buildOptions(b.slug);
    pickA.title = a.caption || "";
    pickB.title = b.caption || "";

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
    viewerA.addHandler("zoom", updateZoomReadout);
    viewerA.addHandler("animation", updateZoomReadout);

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

  // Toggle divider / badges / layer visibility based on whether A and B differ.
  // Both pickers + the separator stay visible in single mode so the user can
  // change the right picker to enter compare mode without any extra step.
  function updateMode() {
    const isCompare = !!(currentA && currentB && currentA.slug !== currentB.slug);
    divider.hidden = !isCompare;
    badgeLeft.hidden = !isCompare;
    badgeRight.hidden = !isCompare;
    layerB.hidden = false; // layer always present so OSD keeps rendering
    if (isCompare) {
      setBadgeContent("left", currentA);
      setBadgeContent("right", currentB);
      // Restore the divider's last position (default 50%).
      const pct = parseFloat(divider.style.left) || 50;
      setDividerX(pct);
    } else {
      // Single-image presentation: clip the top layer entirely so only A shows,
      // even though both viewers exist behind the scenes.
      layerB.style.clipPath = "inset(0 0 0 100%)";
      // Force-close any open critique panels — their badges are now hidden.
      setCritiqueOpen("left", false);
      setCritiqueOpen("right", false);
    }
  }

  // Set a side's badge title + info-icon visibility based on whether the
  // variant has a critique. Also refresh the critique panel content so a panel
  // that's currently open updates in place when the user swaps the variant.
  // The variant's caption (from XMP dc:description) is included in the panel
  // even when there's no AI critique — though in that case the badge is
  // disabled and there's nothing to click open. The badge with no critique
  // still surfaces the caption via the picker's hover tooltip, set elsewhere.
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
      // Close panel if a previously-open variant gets swapped to one without
      // a critique.
      setCritiqueOpen(sideKey, false);
    }
  }

  function setCritiqueOpen(sideKey, open) {
    const { badge, panel } = sides[sideKey];
    panel.hidden = !open;
    badge.setAttribute("aria-expanded", String(!!open));
  }

  // Swap the variant in viewer A or B (driven by picker change). Preserves the
  // current viewport (zoom + center) so the user doesn't lose their place. The
  // sync handler is suppressed during the swap to avoid the partner viewer
  // getting yanked while the new image is loading.
  function swapVariant(which, variant) {
    const viewer = which === "a" ? viewerA : viewerB;
    if (!viewer || !viewer.viewport) return;
    const zoom = viewer.viewport.getZoom();
    const center = viewer.viewport.getCenter();
    syncing = true;
    viewer.addOnceHandler("open", () => {
      viewer.viewport.zoomTo(zoom, null, true);
      viewer.viewport.panTo(center, true);
      syncing = false;
      updateZoomReadout();
    });
    viewer.open({ type: "image", url: variant.display });
    if (which === "a") {
      currentA = variant;
      pickA.title = variant.caption || "";
    } else {
      currentB = variant;
      pickB.title = variant.caption || "";
    }
    updateMode();
  }

  function bindViewportSync(a, b) {
    function sync(src, dst) {
      if (syncing) return;
      if (!dst || !dst.viewport) return;
      syncing = true;
      try {
        dst.viewport.zoomTo(src.viewport.getZoom(), null, true);
        dst.viewport.panTo(src.viewport.getCenter(), true);
      } finally {
        syncing = false;
      }
    }
    a.addHandler("pan", () => sync(a, b));
    a.addHandler("zoom", () => sync(a, b));
    a.addHandler("animation", () => sync(a, b));
    b.addHandler("pan", () => sync(b, a));
    b.addHandler("zoom", () => sync(b, a));
    b.addHandler("animation", () => sync(b, a));
  }

  function updateZoomReadout() {
    if (!viewerA || !viewerA.viewport) return;
    const vp = viewerA.viewport;
    const dpr = window.devicePixelRatio || 1;
    const pct = Math.round(vp.viewportToImageZoom(vp.getZoom()) * dpr * 100);
    if (Number.isFinite(pct)) {
      zoomEl.textContent = `${pct}%`;
    }
  }

  function closeViewers() {
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
    lightbox.hidden = true;
    document.body.classList.remove("body--lightbox-open");
    closeViewers();
  }
}

// `escapeAttr` is identical to `escapeHtml` — kept as an alias to make sinks
// self-documenting (template-literal use in attribute vs body context).
const escapeAttr = escapeHtml;

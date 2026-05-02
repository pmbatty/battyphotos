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
  const captionEl = document.getElementById("lightbox-caption");
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

  // First image in display order is the baseline (RAW) for compare mode.
  // image_order in the manifest puts RAW first in every Spotted Owlet-style
  // scenario; we'll add an explicit baseline_image manifest field if the
  // convention ever needs to bend.
  const baseline = data.images[0];

  document.querySelectorAll(".variant__display-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.dataset.slug;
      const variant = data.images.find((v) => v.slug === slug);
      if (!variant) return;
      const compare = baseline && variant.slug !== baseline.slug;
      openLightbox({ baseline, variant, compare });
    });
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

  function openLightbox({ baseline, variant, compare }) {
    closeViewers();

    if (compare) {
      captionEl.innerHTML = `
        <strong>${escapeHtml(baseline.title)}</strong>
        <span class="lightbox__sep" aria-hidden="true">&#x21C4;</span>
        <strong>${escapeHtml(variant.title)}</strong>
        ${variant.caption ? `<span class="lightbox__caption-detail"> &middot; ${escapeHtml(variant.caption)}</span>` : ""}
      `;
      badgeLeft.textContent = baseline.title;
      badgeRight.textContent = variant.title;
      badgeLeft.hidden = false;
      badgeRight.hidden = false;
      divider.hidden = false;
      layerB.hidden = false;
      setDividerX(50);
    } else {
      captionEl.innerHTML = `
        <strong>${escapeHtml(baseline.title)}</strong>
        ${baseline.caption ? `<span> &middot; ${escapeHtml(baseline.caption)}</span>` : ""}
      `;
      badgeLeft.hidden = true;
      badgeRight.hidden = true;
      divider.hidden = true;
      layerB.hidden = true;
      layerB.style.clipPath = "";
    }

    zoomEl.textContent = "…";
    lightbox.hidden = false;
    document.body.classList.add("body--lightbox-open");

    viewerA = OpenSeadragon({
      element: viewerAEl,
      tileSources: { type: "image", url: baseline.display, buildPyramid: false },
      prefixUrl: "https://cdn.jsdelivr.net/npm/openseadragon@4.1/build/openseadragon/images/",
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

    if (compare) {
      viewerB = OpenSeadragon({
        element: viewerBEl,
        tileSources: { type: "image", url: variant.display, buildPyramid: false },
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
    }
  }

  function bindViewportSync(a, b) {
    let syncing = false;
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s);
}

/**
 * Browse mode: render every variant of a scenario as an image + metadata block.
 * Provides click-to-zoom into an OpenSeadragon-powered lightbox for full-resolution
 * pixel inspection.
 */

let viewerInstance = null;

export function renderBrowseMode(root, data) {
  root.classList.add("scenario--browse");
  root.removeAttribute("aria-busy");

  // Reserve layout space for variant images and crops so lazy-loading doesn't shift
  // the page. All variants share the same dimensions (LR crop is identical).
  const dims = data.image_dimensions;
  if (dims && dims.width && dims.height) {
    root.style.setProperty("--variant-aspect", `${dims.width} / ${dims.height}`);
  }
  if (data.detail_crop && data.detail_crop.w && data.detail_crop.h) {
    root.style.setProperty(
      "--crop-aspect",
      `${data.detail_crop.w} / ${data.detail_crop.h}`,
    );
    // Intrinsic width for the crop JPEG (so 100% crop renders 1:1 when column has
    // room; falls back to scaling proportionally on narrow viewports).
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
          data-zoom-src="${escapeAttr(img.display)}"
          data-zoom-title="${escapeAttr(img.title)}"
          data-zoom-caption="${escapeAttr(img.caption)}"
          aria-label="Open ${escapeAttr(img.title)} at full resolution"
        >
          <img src="${img.display}" alt="${escapeAttr(img.caption || img.title)}" loading="lazy" />
          <span class="variant__zoom-hint">Click to zoom &middot; full resolution</span>
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
  const viewerEl = document.getElementById("lightbox-viewer");
  const captionEl = document.getElementById("lightbox-caption");
  const zoomEl = document.getElementById("lightbox-zoom");
  const oneToOneBtn = document.getElementById("lightbox-1to1");
  const closeBtn = lightbox.querySelector(".lightbox__close");

  document.querySelectorAll(".variant__display-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openLightbox(btn.dataset.zoomSrc, btn.dataset.zoomTitle, btn.dataset.zoomCaption);
    });
  });

  closeBtn.addEventListener("click", closeLightbox);
  oneToOneBtn.addEventListener("click", () => {
    if (!viewerInstance) return;
    const vp = viewerInstance.viewport;
    // Lightroom's "1:1" means 1 source pixel = 1 *device* pixel. On a Retina
    // display, 1 CSS pixel covers `devicePixelRatio` device pixels, so we need
    // OSD's image-zoom (which is CSS-pixels-per-source-pixel) to be 1 / DPR.
    vp.zoomTo(vp.imageToViewportZoom(1 / (window.devicePixelRatio || 1)));
    vp.applyConstraints();
  });
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
  });

  function openLightbox(src, title, caption) {
    captionEl.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      ${caption ? `<span> &middot; ${escapeHtml(caption)}</span>` : ""}
    `;
    zoomEl.textContent = "…";
    lightbox.hidden = false;
    document.body.classList.add("body--lightbox-open");

    if (viewerInstance) {
      viewerInstance.destroy();
      viewerInstance = null;
    }
    viewerInstance = OpenSeadragon({
      element: viewerEl,
      tileSources: { type: "image", url: src, buildPyramid: false },
      // Point at the CDN-hosted control icons so the zoom-in / zoom-out / home
      // buttons render. Without this, OSD looks for /images/ relative to the page.
      prefixUrl: "https://cdn.jsdelivr.net/npm/openseadragon@4.1/build/openseadragon/images/",
      showNavigator: false,
      showRotationControl: false,
      showFullPageControl: false,
      // Keep the zoom-in / zoom-out / home buttons permanently visible — OSD's
      // default fades them out after a few seconds of inactivity which Peter
      // (and likely many others) finds disorienting.
      autoHideControls: false,
      maxZoomPixelRatio: 4,
      minZoomImageRatio: 0.5,
      defaultZoomLevel: 0,
      gestureSettingsMouse: { clickToZoom: false, scrollToZoom: true },
      gestureSettingsTouch: { clickToZoom: false },
      animationTime: 0.4,
    });

    // Keep the zoom percentage in sync with the viewport. Wire on `open` so
    // the viewport is initialised; update on every viewport change.
    viewerInstance.addHandler("open", updateZoomReadout);
    viewerInstance.addHandler("zoom", updateZoomReadout);
    viewerInstance.addHandler("animation", updateZoomReadout);
  }

  function updateZoomReadout() {
    if (!viewerInstance) return;
    const vp = viewerInstance.viewport;
    if (!vp) return;
    // viewportToImageZoom() returns CSS-pixels-per-source-pixel. To match
    // Lightroom / Photoshop's notion of percent (where 100% means 1 source
    // pixel = 1 *device* pixel), multiply by devicePixelRatio. On a 2x Retina
    // display this means OSD's "image zoom 1.0" maps to "200%" here.
    const dpr = window.devicePixelRatio || 1;
    const pct = Math.round(vp.viewportToImageZoom(vp.getZoom()) * dpr * 100);
    if (Number.isFinite(pct)) {
      zoomEl.textContent = `${pct}%`;
    }
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.classList.remove("body--lightbox-open");
    if (viewerInstance) {
      viewerInstance.destroy();
      viewerInstance = null;
    }
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

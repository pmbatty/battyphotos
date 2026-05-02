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
        <figure class="variant__crop">
          <img src="${img.crop_100}" alt="100% pixel crop of ${escapeAttr(img.title)}" loading="lazy" />
          <figcaption>100% pixel detail</figcaption>
        </figure>
        <figure class="variant__crop">
          <img src="${img.crop_200}" alt="200% pixel crop of ${escapeAttr(img.title)}" loading="lazy" />
          <figcaption>200% pixel detail</figcaption>
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
  const closeBtn = lightbox.querySelector(".lightbox__close");

  document.querySelectorAll(".variant__display-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openLightbox(btn.dataset.zoomSrc, btn.dataset.zoomTitle, btn.dataset.zoomCaption);
    });
  });

  closeBtn.addEventListener("click", closeLightbox);
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
    lightbox.hidden = false;
    document.body.classList.add("body--lightbox-open");

    if (viewerInstance) {
      viewerInstance.destroy();
      viewerInstance = null;
    }
    viewerInstance = OpenSeadragon({
      element: viewerEl,
      tileSources: { type: "image", url: src, buildPyramid: false },
      showNavigator: false,
      showRotationControl: false,
      showFullPageControl: false,
      maxZoomPixelRatio: 4,
      minZoomImageRatio: 0.5,
      defaultZoomLevel: 0,
      gestureSettingsMouse: { clickToZoom: false, scrollToZoom: true },
      gestureSettingsTouch: { clickToZoom: false },
      animationTime: 0.4,
    });
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

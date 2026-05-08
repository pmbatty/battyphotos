/**
 * Gallery landing page — fetches data/scenarios.json and renders one card per scenario.
 */
import { escapeHtml } from "./escape.js";

const galleryEl = document.getElementById("gallery");

async function render() {
  let scenarios;
  try {
    // `cache: 'no-cache'` forces a conditional request — see app.js for why.
    const res = await fetch("data/scenarios.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    scenarios = await res.json();
  } catch (err) {
    galleryEl.innerHTML = `<p class="gallery__error">Couldn't load the scenario list: ${escapeHtml(err.message)}</p>`;
    galleryEl.removeAttribute("aria-busy");
    return;
  }

  if (!scenarios.length) {
    galleryEl.innerHTML = `<p class="gallery__empty">No scenarios yet — check back soon.</p>`;
    galleryEl.removeAttribute("aria-busy");
    return;
  }

  galleryEl.classList.add("gallery--grid");
  galleryEl.innerHTML = scenarios.map(card).join("");
  galleryEl.removeAttribute("aria-busy");
}

function card(s) {
  const variants = `${s.variant_count} variant${s.variant_count === 1 ? "" : "s"}`;
  return `
    <a class="scenario-card" href="scenario.html?id=${encodeURIComponent(s.slug)}">
      <div class="scenario-card__thumb">
        <img src="${s.thumbnail}" alt="" loading="lazy" decoding="async" />
      </div>
      <div class="scenario-card__body">
        <h2 class="scenario-card__title">${escapeHtml(s.title)}</h2>
        ${s.subtitle ? `<p class="scenario-card__subtitle">${escapeHtml(s.subtitle)}</p>` : ""}
        <p class="scenario-card__meta">${variants}</p>
      </div>
    </a>
  `;
}

render();

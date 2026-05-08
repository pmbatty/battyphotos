/**
 * Scenario page bootstrap. Reads ?id= from the URL, fetches page-data.json,
 * dispatches to the appropriate mode renderer.
 */
import { renderBrowseMode } from "./viewer.js";
import { escapeHtml } from "./escape.js";

const root = document.getElementById("scenario-root");

async function boot() {
  const params = new URLSearchParams(location.search);
  const slug = params.get("id");
  if (!slug) {
    showError("No scenario id in URL.");
    return;
  }

  let pageData;
  try {
    // `cache: 'no-cache'` forces a conditional request (If-None-Match) on
    // every load, so a fresh build is reflected without a hard refresh.
    // Server returns 304 Not Modified when unchanged — cheap. Without this,
    // GitHub Pages' default Cache-Control: max-age=600 hides crop/manifest
    // changes for ~10 minutes.
    const res = await fetch(
      `data/${encodeURIComponent(slug)}/page-data.json`,
      { cache: "no-cache" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pageData = await res.json();
  } catch (err) {
    showError(`Couldn't load scenario "${slug}": ${err.message}`);
    return;
  }

  document.title = `${pageData.title} — Noise reduction & sharpening — batty.photos`;
  renderBrowseMode(root, pageData);
}

function showError(message) {
  root.innerHTML = `<p class="scenario__error">${escapeHtml(message)}</p>`;
  root.removeAttribute("aria-busy");
}

boot();

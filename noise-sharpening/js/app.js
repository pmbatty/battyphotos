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
    const res = await fetch(`data/${encodeURIComponent(slug)}/page-data.json`);
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

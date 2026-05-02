/**
 * Scenario page bootstrap. Reads ?id= from the URL, fetches page-data.json,
 * dispatches to the appropriate mode renderer.
 */
import { renderBrowseMode } from "./viewer.js";

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
    const res = await fetch(`data/${encodeURIComponent(slug)}/page-data.json`, {
      cache: "no-cache",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pageData = await res.json();
  } catch (err) {
    showError(`Couldn't load scenario "${slug}": ${err.message}`);
    return;
  }

  document.title = `${pageData.title} — Noise reduction & sharpening — batty.photos`;
  // For now there's only one mode. v1.1 will add a comparison mode toggle here.
  renderBrowseMode(root, pageData);
}

function showError(message) {
  root.innerHTML = `<p class="scenario__error">${escapeHtml(message)}</p>`;
  root.removeAttribute("aria-busy");
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

boot();

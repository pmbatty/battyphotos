/**
 * HTML / attribute string escaping.
 *
 * The site renders text from JSON files (page-data.json, scenarios.json) into
 * the DOM. Some of that text is partially LLM-authored (darwain critique
 * output), so every value flowing through `innerHTML` MUST be passed through
 * one of these helpers. Single canonical implementation lives here so there's
 * one place to audit if the contract ever changes.
 */

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

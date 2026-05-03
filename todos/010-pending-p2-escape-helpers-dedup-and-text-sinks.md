---
status: pending
priority: p2
issue_id: 010
tags: [code-review, frontend, security, simplicity]
dependencies: []
---

# `escapeHtml` duplicated across three modules; some `innerHTML` sinks should use `textContent`

## Problem Statement

Two related issues with shared root cause:

**1. Triplicated escaper.** `escapeHtml` is copy-pasted in `viewer.js`, `gallery.js`, and `app.js` (with an `escapeAttr` alias in `viewer.js` that's literally identical). Three places to audit when the contract changes.

**2. `innerHTML` sinks are correctly escaped today, but the contract is fragile.** Every template literal that builds DOM via `innerHTML` has to remember to call `escapeHtml`. The darwain critique text is the longest user-controlled string on the page and is literally LLM output — Gemini will happily emit `<script>` or `<img onerror>` if the prompt is mis-handled. A future regression here would be stored XSS via JSON. We're protected today; we should make it harder to accidentally regress.

`gallery.js:13` also has an `${err.message}` interpolation that is NOT escaped. Today this is just visual ugliness (`err.message` from runtime not user data), but route it through `escapeHtml` for symmetry with `app.js`.

## Findings

- `noise-sharpening/js/viewer.js:486-498` — `escapeHtml`, `escapeAttr`
- `noise-sharpening/js/app.js:39-47` — duplicate `escapeHtml`
- `noise-sharpening/js/gallery.js:45-53` — duplicate `escapeHtml`
- `noise-sharpening/js/gallery.js:13` — `err.message` not escaped
- `noise-sharpening/js/viewer.js:391` — `panel.querySelector(".lightbox__critique-stars").innerHTML = stars` is safe today (renderStars only emits `★`/`☆`) but is another `innerHTML` sink to keep mental track of.

## Proposed Solutions

### Option A: extract shared `escape.js` module + escape err.message

Create `noise-sharpening/js/escape.js`:
```js
export function escapeHtml(s) { ... }
```
Import in all three files. Drop the `escapeAttr` alias (or keep one canonical re-export).

- Pros: single auditable definition; zero behaviour change.
- Cons: tiny extra file. Worth it.
- Effort: Small (~10 LOC change).
- Risk: Low.

### Option B: A + migrate critique-rendering paths to `textContent`/`createElement`

For the variant card and gallery card render paths, build the DOM tree with `document.createElement` calls and `.textContent` assignments instead of template-literal `innerHTML`. Reserve `innerHTML` for the static parts (chrome, layout). Critique panel already uses `textContent` for the long text — extend that pattern.

- Pros: structurally un-XSS-able. The long-form critique text is the highest-risk surface; protecting it by construction is cheap.
- Cons: more verbose; harder to read at a glance than a template literal.
- Effort: Medium (~50 LOC refactor).
- Risk: Low — pure rendering change, easy to verify visually.

### Option C: A + add a CSP `<meta>` tag as defense-in-depth

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';">
```

- Pros: browser refuses to execute inline scripts even if escaping fails. Strong second line of defence.
- Cons: requires careful testing — OSD may need policy adjustments. `style-src 'unsafe-inline'` weakens the policy (OSD inlines styles).
- Effort: Small (config) + Medium (testing).
- Risk: Medium — easy to break OSD or future features.

Likely best: **A + later C** (after vendoring OSD per todo 007 lets us tighten `script-src` to `'self'`).

## Recommended Action
_(Filled during triage)_

## Technical Details

- New file: `noise-sharpening/js/escape.js`
- `noise-sharpening/js/viewer.js:486-498`, `app.js:39-47`, `gallery.js:13, 45-53`

## Acceptance Criteria

- [ ] Single `escapeHtml` definition imported across all three files.
- [ ] `err.message` in `gallery.js:13` is escaped.
- [ ] No regression on rendered variant cards / gallery cards / critique panels.

## Work Log

- 2026-05-02: created from /workflows:review (simplicity P2-10/11, security P2-2 partial)

## Resources

- code-simplicity-reviewer report
- security-sentinel report

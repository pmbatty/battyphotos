---
status: complete
priority: p3
issue_id: 019
tags: [code-review, security, defense-in-depth]
dependencies: [007, 010]
---

# Add Content-Security-Policy `<meta>` tag for defense-in-depth

## Problem Statement

The site renders text from JSON files into the DOM. Today every sink is correctly escaped via `escapeHtml`, but the contract is fragile — every new template literal added by future contributors has to remember to escape. Stored XSS via the LLM-authored darwain critique JSON would be a real bug if escaping ever regresses.

A CSP `<meta>` tag adds a second line of defence: even if a `<script>` tag slips through escaping, the browser refuses to execute it.

## Findings

- No CSP currently set. GitHub Pages doesn't add one by default for user pages.
- `index.html`, `noise-sharpening/index.html`, `noise-sharpening/scenario.html` all lack the meta tag.

## Proposed Solutions

### Option A: ship a tight CSP after vendoring OSD (depends on todo 007)

Once OSD is vendored locally, add to each HTML `<head>`:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  img-src 'self' data:;
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none';
">
```

`'unsafe-inline'` for `style-src` is reluctantly necessary — OSD inlines styles on its viewer DOM. We can revisit if/when OSD ships an external stylesheet option.

- Pros: blocks inline-script execution by default; immediately improves XSS surface.
- Cons: requires careful testing — any inline script in the HTML breaks. We have no inline scripts today, but new contributors might add them.
- Effort: Small.
- Risk: Medium (likely to break something on first try; needs testing).

### Option B: ship a looser CSP that accommodates the current CDN

Same policy, but include `https://cdn.jsdelivr.net` in `script-src`, `img-src`, etc.

- Pros: immediate protection without waiting for vendoring.
- Cons: weaker — supply-chain compromise of jsDelivr still allows script execution.
- Effort: Small.
- Risk: Low.

### Option C: skip until vendoring done, then go straight to A

Cleanest path.

- Effort: depends.
- Risk: Lowest cumulative risk.

Likely best: **C — wait for todo 007 (OSD vendoring), then ship Option A.**

## Recommended Action
_(Filled during triage)_

## Technical Details

- `index.html:7` (head section)
- `noise-sharpening/index.html:7`
- `noise-sharpening/scenario.html:8` (head section)

## Acceptance Criteria

- [ ] CSP `<meta>` tag present in all three HTML files.
- [ ] Lightbox functions identically (zoom, pan, compare, divider drag).
- [ ] Browser console shows no CSP violations.
- [ ] Test inline-script injection (e.g. paste `<script>alert(1)</script>` into a darwain critique field via fixture) — blocked.

## Work Log

- 2026-05-02: created from /workflows:review (security-sentinel P2-2 secondary)

## Resources

- security-sentinel report
- depends on todo 007 (vendor OSD) and todo 010 (escape consolidation)
- 2026-05-03: resolved during /workflows:work P3 sweep

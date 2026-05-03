---
status: complete
priority: p3
issue_id: 016
tags: [code-review, frontend, performance, accessibility]
dependencies: []
---

# `<img>` tags lack explicit width/height + decoding=async, rely solely on CSS aspect-ratio

## Problem Statement

The variant card and crop `<img>` tags use only `loading="lazy"` and no `width` / `height` attributes. Layout space is reserved via the `aspect-ratio` CSS variable on the parent `.variant__display-btn` and `.variant__crop > img`. This works in Chrome / Firefox / Safari today, but:

1. Without intrinsic dimensions on the `<img>`, layout reservation depends on the CSS variables being set before image arrival. In edge cases (CSS load fails, very early frames) you can get layout shift.
2. No `decoding="async"` — large JPEG decode happens on the main thread by default, which can block scroll and click responsiveness.

The build script knows the dimensions; passing them as attributes is free.

## Findings

- `noise-sharpening/js/viewer.js:78` — display image: no `width`/`height`/`decoding`.
- `noise-sharpening/js/viewer.js:88, 92` — crop images: same.
- `noise-sharpening/js/gallery.js:34` — thumbnail: same.

## Proposed Solutions

### Option A: set width/height/decoding from page-data dimensions

```js
const w = data.image_dimensions?.width || 0;
const h = data.image_dimensions?.height || 0;
// ...
<img src="${img.display}" width="${w}" height="${h}" decoding="async" alt="..." loading="lazy" />
```

For crops, use `data.detail_crop.w` / `.h`. For thumbnails, use a fixed expected size (600×400).

- Pros: ironclad layout reservation; async decoding off the main thread; minor improvement to LCP and CLS.
- Cons: tiny code increase.
- Effort: Small.
- Risk: Low.

### Option B: also add `<link rel="preconnect">` for the OSD CDN (if not vendored per todo 007)

Reduces TLS handshake latency.

- Effort: Tiny.

Likely best: **A** (conditional on todo 003 also assertively recording dimensions).

## Recommended Action
_(Filled during triage)_

## Technical Details

- `noise-sharpening/js/viewer.js:78, 88, 92` — display/crop image template literals.
- `noise-sharpening/js/gallery.js:34` — thumbnail template literal.

## Acceptance Criteria

- [ ] Each `<img>` has `width`, `height`, and `decoding="async"`.
- [ ] No layout shift when scrolling the variants list (verifiable via Lighthouse CLS metric or visual test).
- [ ] No regression on existing render.

## Work Log

- 2026-05-02: created from /workflows:review (performance-oracle P2-3, P2-4)

## Resources

- performance-oracle report
- 2026-05-03: resolved during /workflows:work P3 sweep

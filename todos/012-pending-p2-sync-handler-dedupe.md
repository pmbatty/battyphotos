---
status: pending
priority: p2
issue_id: 012
tags: [code-review, frontend, performance]
dependencies: []
---

# Sync handlers triple-fire on every viewport change; zoom readout writes per frame

## Problem Statement

`bindViewportSync` registers three handlers per direction (`pan`, `zoom`, `animation`). OSD's `animation` event fires every frame during a wheel-zoom and overlaps with `pan`/`zoom`, so during a single zoom interaction the sync function runs 2-3× per frame. Each call sets the partner's viewport (which then fires the partner's `animation` event, suppressed by `syncing` but still entered).

Same shape on the zoom readout: `updateZoomReadout` is hooked to `open`, `zoom`, AND `animation`. It writes `textContent` on `#lightbox-zoom` every animation frame even though most frames the rounded percent doesn't change.

## Findings

- `noise-sharpening/js/viewer.js:438-456` — `bindViewportSync` registers `pan`, `zoom`, `animation` for both directions (six handlers total, all firing during a zoom).
- `noise-sharpening/js/viewer.js:319-321` — `updateZoomReadout` registered for `open`, `zoom`, `animation`.

## Proposed Solutions

### Option A: collapse to `animation` only; memoize the readout

`animation` fires during all viewport changes (including programmatic ones). It subsumes `pan` and `zoom` for our purposes.

```js
a.addHandler("animation", () => sync(a, b));
b.addHandler("animation", () => sync(b, a));
```

Memoize zoom readout:

```js
let lastZoomPct = null;
function updateZoomReadout() {
  ...
  if (Number.isFinite(pct) && pct !== lastZoomPct) {
    zoomEl.textContent = `${pct}%`;
    lastZoomPct = pct;
  }
}
```

- Pros: 3× reduction in handler invocations during zoom; eliminates redundant `textContent` writes; one fewer style invalidation per frame.
- Cons: very minor — `animation` only fires during animated transitions, so a hard-stop pan (no animation) might miss a sync tick. OSD does animate by default, so this isn't a real concern.
- Effort: Small.
- Risk: Low.

### Option B: rAF-throttle sync independently

Keep all three handlers, but only do the sync work once per frame via `requestAnimationFrame`.

- Pros: works regardless of which OSD events fire.
- Cons: more code; the `animation`-only fix is simpler and arguably more correct.
- Effort: Small.
- Risk: Low.

Likely best: **A.**

## Recommended Action
_(Filled during triage)_

## Technical Details

- `noise-sharpening/js/viewer.js:319-321` — readout handlers
- `noise-sharpening/js/viewer.js:438-456` — `bindViewportSync`

## Acceptance Criteria

- [ ] Wheel-zoom in compare mode — both viewers stay perfectly synced.
- [ ] Zoom readout still updates smoothly during a zoom.
- [ ] Performance panel during a fast wheel-zoom shows fewer JS invocations than before.

## Work Log

- 2026-05-02: created from /workflows:review (performance-oracle P2-1, P2-2; julik P3.1)

## Resources

- performance-oracle report
- julik-frontend-races-reviewer report

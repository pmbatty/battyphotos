---
status: pending
priority: p2
issue_id: 011
tags: [code-review, frontend, performance]
dependencies: []
---

# Divider `pointermove` calls `getBoundingClientRect()` on every event, unthrottled

## Problem Statement

The divider drag handler reads `stage.getBoundingClientRect()` on every `pointermove` event and writes `style.left` + `style.clipPath` synchronously. On a 1000 Hz mouse during a drag, that's 1000+ events per second; each `getBoundingClientRect` forces a synchronous layout flush (because the previous `clipPath` write has dirtied layout). Classic layout-thrashing pattern.

Real impact: noticeable jank on lower-spec hardware during a fast drag.

## Findings

- `noise-sharpening/js/viewer.js:250-255` — `pointermove` handler.
- `getBoundingClientRect()` called per event; stage doesn't move during drag, so the rect can be cached on `pointerdown`.
- Two style writes per event combine to dirty layout-then-read.

## Proposed Solutions

### Option A: cache `stage.getBoundingClientRect()` on `pointerdown` + rAF-throttle the writes

```js
let dragRect = null;
let pendingX = null;
let rafQueued = false;

handle.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragRect = stage.getBoundingClientRect();
  handle.setPointerCapture(e.pointerId);
  e.preventDefault();
});

handle.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  pendingX = ((e.clientX - dragRect.left) / dragRect.width) * 100;
  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      if (pendingX !== null) setDividerX(pendingX);
    });
  }
});
```

- Pros: caps work at the screen refresh rate; eliminates per-event layout reads; capture point latency is unchanged.
- Cons: slightly more code. Edge case if window resizes during a drag (rect goes stale) — easy to ignore (resize during drag is exotic).
- Effort: Small (~15 LOC).
- Risk: Low.

### Option B: only cache the rect, leave per-event style writes

Cheaper but only addresses the layout-read half of the thrash.

- Pros: smaller diff.
- Cons: still does style writes at mouse-poll rate.
- Effort: Small.
- Risk: Low.

Likely best: **A.**

## Recommended Action
_(Filled during triage)_

## Technical Details

- `noise-sharpening/js/viewer.js:245-264` — divider drag block.

## Acceptance Criteria

- [ ] Drag the divider rapidly — no perceptible stutter on a typical laptop trackpad.
- [ ] Performance panel shows no Forced Synchronous Layout warnings during drag.
- [ ] Window-resize-during-drag still works (or is acceptably broken — handle should release on `pointerup` regardless).

## Work Log

- 2026-05-02: created from /workflows:review (performance-oracle P1-4)

## Resources

- performance-oracle report

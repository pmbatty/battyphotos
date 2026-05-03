---
status: pending
priority: p3
issue_id: 017
tags: [code-review, frontend, lifecycle, polish]
dependencies: []
---

# Misc frontend polish: pointer-capture cleanup, picker desync handling, divider parseFloat NaN

## Problem Statement

A handful of small frontend issues noted during review. Each is minor on its own but cheap to fix together:

1. **Pointer capture not released on lightbox close.** If the user starts dragging the divider then triggers `closeLightbox` (Escape, backdrop click), `dragging` stays `true` and pointer capture isn't released. Next time the lightbox opens, hovering the handle without pressing fires `pointermove`, sees `dragging === true`, and snaps the divider to wherever the cursor is.

2. **Picker `<select>` value can desync from `currentA`/`currentB` if `viewer.open` fails.** `swapVariant` updates `currentA`/`currentB` optimistically before the once-handler fires. If OSD fails to load the new image, the picker shows variant X, `currentA` says X, but the actual viewer is still showing the previous variant. Need an `open-failed` handler to revert the picker.

3. **`parseFloat(divider.style.left) || 50`** relies on `NaN || 50 === 50`. Works but brittle if anyone changes the unit. Use explicit `Number.isFinite` check.

4. **`viewerA.viewport` may not exist before `open` event fires** — the 1:1 button reads `viewerA.viewport` directly without a null check. Already guarded in other places.

5. **`lightbox.addEventListener("click", e => e.target === lightbox && closeLightbox())`** is fragile: a `pointerdown` inside an OSD viewer that drifts to release outside any layer counts as a click on `lightbox` and triggers an unwanted close.

## Findings

- `noise-sharpening/js/viewer.js:245-264, 479-483` — pointer capture cleanup
- `noise-sharpening/js/viewer.js:415-436` — `swapVariant` open-failed handling
- `noise-sharpening/js/viewer.js:271` — parseFloat NaN coercion
- `noise-sharpening/js/viewer.js:222` — 1:1 button null check
- `noise-sharpening/js/viewer.js:227-229` — backdrop click target check

## Proposed Solutions

### Option A: handle each independently, all in one polish pass

1. Track `capturedPointerId` in module-level state; release it in `closeLightbox` if set.
2. Add `viewer.addOnceHandler("open-failed", () => revertPicker(which, prevSlug))` alongside the current open handler. Capture the previous slug before optimistic update.
3. `Number.isFinite(parseFloat(divider.style.left)) ? parseFloat(divider.style.left) : 50`.
4. `if (!viewerA || !viewerA.viewport) return;` in the 1:1 click handler.
5. Use `mousedown` target tracking for backdrop close — only close if both pointerdown and pointerup hit `lightbox` directly.

- Pros: each is small; all are independent.
- Cons: a few small changes scattered around the file.
- Effort: Small (~30 LOC).
- Risk: Low.

### Option B: subset only

Take only the first two (pointer capture + open-failed) since they're the most user-visible. Defer the rest.

- Pros: smaller diff.
- Cons: leaves the parseFloat / null-check / backdrop polish for later.
- Effort: Tiny.
- Risk: Low.

Note: items 1-2 here overlap with todo 004 (race conditions). Coordinate when implementing — todo 004 will likely sweep these up.

## Recommended Action
_(Filled during triage)_

## Technical Details

See line refs above.

## Acceptance Criteria

- [ ] Drag divider, hit Escape mid-drag, reopen lightbox, hover handle without pressing — divider stays put.
- [ ] Force a 404 on a `display` URL via DevTools — picker reverts to last good value, no zombie state.
- [ ] No errors or unexpected closes from the misc edge cases.

## Work Log

- 2026-05-02: created from /workflows:review (julik P2.1, P2.4, P3.2-P3.5)

## Resources

- julik-frontend-races-reviewer report

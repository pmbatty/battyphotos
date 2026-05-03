---
status: complete
priority: p1
issue_id: 004
tags: [code-review, frontend, races, concurrency]
dependencies: []
---

# Lightbox swap operations have multiple race conditions; `syncing` flag can stick `true` permanently

## Problem Statement

`viewer.js`'s lightbox is a clever piece of work — two OpenSeadragon instances stacked, clip-path divider, bidirectional viewport sync — but the swap-while-something-else-is-happening paths have several race conditions that will eventually bite a real user. The single shared `syncing` boolean is a particular weak point: across realistic interaction sequences it can stick `true` and leave the comparison broken with no recovery.

## Findings

(All in `noise-sharpening/js/viewer.js`. Source: julik-frontend-races-reviewer.)

### F1. Stale `addOnceHandler` fires on a destroyed viewer

`swapVariant` (line 415-436) registers `addOnceHandler("open", ...)` referencing the viewer through closure, then calls `viewer.open(...)`. The `open` event fires async. If the user closes the lightbox (Escape, backdrop click, or a sibling click) before `open` fires, `closeViewers()` runs `viewer.destroy()` and nulls the module-level reference — but the queued once-handler still fires on the destroyed viewer's `viewport`, which may be `null` or partially torn down.

### F2. `syncing` flag stuck `true` after F1

`syncing` is set true in `swapVariant` (line 420) and only unset in the once-handler (line 424). If the once-handler never fires (F1 path, or `open-failed`, or page navigates), `syncing` stays `true` forever within that page render. Future pan/zoom on either viewer skip sync. The user sees what looks like a broken comparison and has no recovery short of a full reload.

### F3. Two pickers in rapid succession

User changes A; before A's `open` fires, user changes B. B's swap captures B's viewport mid-sync from A's still-pending swap, so the saved viewport may not reflect what A *will be* after restore. Restoring A's animation chain then yanks B via sync (because `syncing` is briefly `false` between the two swap callbacks). Subjectively: a wobble.

### F4. Click-while-mid-swap

User clicks a different variant card while a previous swap is in flight. `openLightbox` calls `closeViewers()` which destroys the in-flight viewer; same destroyed-viewer problem as F1.

### F5. Pointer capture not released on close

If the user starts dragging the divider and then triggers `closeLightbox` (Escape, backdrop), `dragging` stays `true` and the pointer capture isn't released. Next time the lightbox opens, hovering the handle without pressing fires `pointermove`, sees `dragging === true`, and snaps the divider to the cursor.

## Proposed Solutions

### Option A: Cancellation tokens for in-flight swaps + watchdog reset on close

Track swaps in a `pendingSwaps` set. Each swap creates a token; the once-handler checks `token.cancelled` before doing work. `closeViewers` cancels all pending tokens and explicitly resets `syncing = false`. Also wire OSD's `open-failed` event to reset `syncing` and revert the picker `<select>` to the last-known-good slug.

- Pros: targeted fix; preserves the existing single-flag model with explicit lifecycle. Restores broken state cleanly.
- Cons: adds bookkeeping; doesn't address F3 wobble (still allowed but state stays consistent).
- Effort: Small-Medium (~30 LOC).
- Risk: Low.

### Option B: State machine replacing `syncing` boolean

Replace `syncing` with explicit states: `IDLE`, `SYNCING_PAN`, `SWAPPING_A`, `SWAPPING_B`, `SWAPPING_BOTH`. Transitions enforced. F3 modeled explicitly (concurrent swaps suppress sync until both complete).

- Pros: comprehensive — addresses F1-F4 in one structure. Future-proofs.
- Cons: bigger code change; small chance of introducing new bugs via state-transition oversight.
- Effort: Medium.
- Risk: Medium.

### Option C: Disable picker during swap

Set `pickA.disabled = true` (or visually freeze) for the duration of a swap. Eliminates F3 by forbidding it.

- Pros: simplest possible fix for F3; matches normal "operation in progress" UX.
- Cons: cosmetic latency on slow networks (picker briefly unresponsive); doesn't address F1/F2/F4.
- Effort: Small.
- Risk: Low.

Likely best: **A + C combined.** Tokens fix F1/F2/F4; disable-during-swap fixes F3.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `noise-sharpening/js/viewer.js:415-436` — `swapVariant`
- `noise-sharpening/js/viewer.js:438-456` — `bindViewportSync`
- `noise-sharpening/js/viewer.js:468-477` — `closeViewers`
- `noise-sharpening/js/viewer.js:479-483` — `closeLightbox`
- `noise-sharpening/js/viewer.js:245-264` — divider drag (pointer capture)

## Acceptance Criteria

- [ ] DevTools Slow-3G + change picker A + Escape within 200ms → no console error, sync intact on next open.
- [ ] Slow-3G + change picker A + change picker B within 100ms → either swap correctly serialized or B disabled until A completes; final state matches both selected variants.
- [ ] Pointer capture released by `closeLightbox` even if `pointerup` never fires.
- [ ] OSD `open-failed` resets `syncing` and reverts the picker to its last-known-good value.

## Work Log

- 2026-05-02: created from /workflows:review (julik-frontend-races-reviewer, P1.1-1.5)

## Resources

- julik-frontend-races-reviewer report
- code-simplicity-reviewer also flagged that the `syncing` flag's three call sites could be simplified
- 2026-05-02: resolved during /workflows:work pass on review findings

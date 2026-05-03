---
status: pending
priority: p2
issue_id: 013
tags: [code-review, frontend, accessibility, lifecycle]
dependencies: []
---

# Document `keydown` listener leaks across re-renders + Escape eats picker dropdown

## Problem Statement

Two related issues:

**1. Listener leak.** `document.addEventListener("keydown", ...)` is registered every time `attachLightboxHandlers` runs. Static-site navigation creates a fresh document per page, so this is fine today. But there's no removal path, and as soon as anyone introduces client-side navigation (Turbo, View Transitions, or even a partial re-render of `renderBrowseMode`), N copies of the Escape handler all fire.

**2. Escape conflict.** The Escape handler closes the lightbox unconditionally. Native `<select>` elements also consume Escape to cancel an open dropdown — but on some browsers Escape both cancels the dropdown and bubbles. Net effect: user opens picker, decides not to change anything, hits Escape, the whole lightbox vanishes. Frustrating.

## Findings

- `noise-sharpening/js/viewer.js:230-232` — anonymous `keydown` listener on `document`, no removal reference.
- Same handler doesn't check `e.defaultPrevented` or `e.target`.

## Proposed Solutions

### Option A: keep references + scope check + remove on close

Save the handler reference; remove in `closeLightbox`. Scope the close-on-Escape to cases where focus isn't on a `<select>`:

```js
function onDocKeyDown(e) {
  if (e.key !== "Escape") return;
  if (lightbox.hidden) return;
  // Don't steal Escape from a native dropdown
  if (e.target.tagName === "SELECT") return;
  closeLightbox();
}
document.addEventListener("keydown", onDocKeyDown);
// in closeLightbox:
// document.removeEventListener("keydown", onDocKeyDown);  // or keep mounted and just guard on hidden
```

Or simpler — keep listener for the lifetime of the page and only check `lightbox.hidden`/`e.target` in the handler. No leak in the static-site model.

- Pros: targeted; preserves existing behaviour for the common case.
- Cons: still document-scoped, so still relies on the SELECT-as-target heuristic.
- Effort: Small.
- Risk: Low.

### Option B: scope Escape handling to the lightbox itself

Listen on `lightbox` instead of `document`, tabindex it so it can take focus, and scope Escape to keys not consumed by interior elements.

- Pros: cleaner scoping; auto-cleaned when lightbox is removed.
- Cons: requires focus management on open (focus the lightbox itself initially).
- Effort: Small-Medium.
- Risk: Low.

Likely best: **Option A.**

## Recommended Action
_(Filled during triage)_

## Technical Details

- `noise-sharpening/js/viewer.js:230-232`

## Acceptance Criteria

- [ ] Open picker, hit Escape — picker closes, lightbox stays open.
- [ ] Hit Escape with no picker open — lightbox closes.
- [ ] If `attachLightboxHandlers` is called twice in one document (test by manually re-running), no double-fire of the Escape handler.

## Work Log

- 2026-05-02: created from /workflows:review (julik P2.2, P2.3 grouped)

## Resources

- julik-frontend-races-reviewer report

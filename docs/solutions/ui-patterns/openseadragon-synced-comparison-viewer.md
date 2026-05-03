---
date: 2026-05-03
status: solved
problem_type: ui_pattern
component: lightbox / image-comparison
tags: [openseadragon, javascript, frontend, races, performance, retina, csp]
related_commits:
  - 25f50b1  # comparison mode initial
  - b89e83d  # A/B picker dropdowns
  - 574074f  # DPR-aware 1:1
  - ba0ec5d  # prefixUrl fix
  - f467c50  # autoHideControls + zoom readout
  - 20de9a3  # race conditions + perf
  - b307e4b  # vendor OSD locally
  - b7d45e8  # CSP
related_todos:
  - todos/004-complete-p1-lightbox-swap-race-conditions.md
  - todos/007-complete-p2-osd-cdn-pin-and-sri.md
  - todos/011-complete-p2-pointermove-throttle-cached-rect.md
  - todos/012-complete-p2-sync-handler-dedupe.md
  - todos/019-complete-p3-csp-defense-in-depth.md
---

# Synchronized OpenSeadragon dual-viewer comparison mode

A pattern + ~10 non-obvious gotchas for building a "before/after" image
comparison UI on top of [OpenSeadragon](https://openseadragon.github.io/) (OSD).
The end result: two stacked viewers, perfectly synced pan / zoom / 1:1, with a
draggable clip-path divider that reveals one or the other. Plus picker
dropdowns to swap either image without losing the user's zoom/pan position.

## Problem

Build a comparison-mode lightbox where:

1. Two large source images stack on top of each other.
2. A vertical draggable divider clips the top image to reveal the bottom underneath.
3. Both images stay perfectly synced for pan and zoom — wheel-zoom on either side
   zooms both; pan one, both pan.
4. Pickers in the top bar swap either image without losing the user's current
   zoom/pan position.
5. A "1:1" button shows native pixel resolution that matches what Lightroom /
   Photoshop call 1:1 (one source pixel per device pixel) — so the same scene at
   100% looks the same in both apps on a Retina display.

OSD has built-in single-viewer pan/zoom but no built-in multi-viewer sync, no
built-in slider, and several defaults that bite when you build this from
primitives.

## What worked: architecture

```
┌─────────────────────────────────────────────────┐
│ [Picker A ▼]  ⇄  [Picker B ▼]   100%  [1:1] [×] │  Top bar
├─────────────────────────────────────────────────┤
│  ┌────────────┬─────────────────────────────┐  │
│  │ viewer A   │                             │  │  Layer A (bottom):
│  │ (RAW)      │     viewer A image          │  │  always visible.
│  │            │                             │  │
│  │            │      ┌──────────────────┐   │  │
│  │  Layer B clipped at X% from left  ──→│   │  │  Layer B (top):
│  │            │      │  viewer B image  │   │  │  clip-path inset(0 0 0 X%)
│  │            │      │                  │   │  │  so only X..100% shows.
│  │            │      └──────────────────┘   │  │
│  └────────────┴─────────────────────────────┘  │
│                       ↑                         │
│                  divider line + handle          │
└─────────────────────────────────────────────────┘
```

- Both layers are absolutely-positioned shells inside a `position: relative`
  stage. Inside each shell sits an OSD-mounted div.
- Layer B carries an inline `clip-path: inset(0 0 0 X%)` updated as the divider
  drags. Layer B always renders; in single-mode (A == B) we set X = 100% to
  clip it entirely.
- Layer A always renders the full bottom image.
- The divider is a 2-pixel-wide line + circular handle at vertical center.
  `pointer-events: none` on the line, `auto` on the handle, so OSD pan still
  works everywhere except on the handle itself.
- Two OSD instances (`viewerA`, `viewerB`) bound bidirectionally for sync.
  Picker change → `viewer.open()` to swap that side's image.

## Gotchas (the compound learnings)

### 1. The OSD host element gets `position: relative` set inline by OSD itself

If you `position: absolute; inset: 0` the host directly, OSD will overwrite it
with `position: relative` when it initializes. The host then collapses to 0
height (relative + no content), child canvases get sized 0, the screen is black.

**Fix**: wrap the OSD mount in your own absolutely-positioned shell. Let OSD do
whatever it wants to its host; the shell holds the layout.

```html
<div class="lightbox__layer">                      <!-- shell stays absolute -->
  <div class="lightbox__viewer" id="viewer-a">     <!-- OSD owns this -->
  </div>
</div>
```

```css
.lightbox__layer {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
}
.lightbox__viewer {
  width: 100%;
  height: 100%;
}
```

### 2. OSD's default `prefixUrl` 404s when the host page has its own `images/` directory

OSD's zoom/home button sprites live at `prefixUrl + "zoomin_rest.png"` etc.
Default `prefixUrl` is `/images/` *relative to the page* — which conflicts with
any site that already serves images out of its own `images/` directory.

The icons render as broken images at top-left of the viewer.

**Fix**: set `prefixUrl` explicitly when constructing the viewer.

```js
viewerA = OpenSeadragon({
  // ...
  prefixUrl: "vendor/openseadragon-4.1.1/images/",
});
```

### 3. OSD's `autoHideControls` defaults to `true`

The zoom in / zoom out / home buttons fade out after a few seconds of inactivity
and only reappear on mouse movement. To users who don't know they exist, this
looks like the controls aren't there at all.

**Fix**: pass `autoHideControls: false`.

### 4. Lightroom-style "1:1" needs `devicePixelRatio` math

OSD's `viewport.viewportToImageZoom(viewport.getZoom())` returns
**CSS-pixels-per-source-pixel**. Treating that 1.0 as "1:1" looks correct on a
1× display but on a Retina (DPR=2) display each source pixel covers 2 device
pixels — which Lightroom calls 200%, not 100%.

Lightroom / Photoshop "1:1" = **device-pixel-per-source-pixel**.

**Fix**:

```js
// 1:1 button — divide image-zoom target by DPR
const dpr = window.devicePixelRatio || 1;
viewer.viewport.zoomTo(viewer.viewport.imageToViewportZoom(1 / dpr));

// Zoom percent readout — multiply by DPR
const pct = Math.round(
  viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom()) * dpr * 100
);
```

### 5. Bidirectional viewport sync needs a guard, but a single boolean isn't enough

The naïve sync:

```js
let syncing = false;
function sync(src, dst) {
  if (syncing) return;
  syncing = true;
  dst.viewport.zoomTo(src.viewport.getZoom(), null, true);
  dst.viewport.panTo(src.viewport.getCenter(), true);
  syncing = false;
}
viewerA.addHandler("zoom", () => sync(viewerA, viewerB));
viewerA.addHandler("pan",  () => sync(viewerA, viewerB));
viewerB.addHandler("zoom", () => sync(viewerB, viewerA));
viewerB.addHandler("pan",  () => sync(viewerB, viewerA));
```

This works for plain user pan/zoom. But add picker swaps and it breaks down:

- A swap captures the current viewport, calls `viewer.open()`, then restores
  viewport on `addOnceHandler("open", …)`.
- During the in-flight swap you set `syncing = true` so the partner doesn't
  react to the transient pre-restore viewport.
- If the user does a *second* swap before the first's `open` fires, the second
  swap also flips `syncing = true` (already was). The first swap's `open`
  handler sets `syncing = false`. Now the second swap's restore can drag the
  partner with it.

**Fix**: split state into two separate concepts.

- `swapsInFlight` — counter of `viewer.open()` calls whose post-load handlers
  haven't fired yet. Sync is suppressed while > 0.
- `insideSync` — the conventional bidirectional feedback guard. True only
  during the synchronous body of a sync call.

```js
let swapsInFlight = 0;
let insideSync = false;
function shouldSuppressSync() {
  return swapsInFlight > 0 || insideSync;
}
```

### 6. `addOnceHandler("open", …)` fires on a destroyed viewer

If the user closes the lightbox between `viewer.open(...)` and the open event
firing, `viewer.destroy()` runs but the queued once-handler still fires,
referencing `viewer.viewport` which may be null or torn down. The closure has a
live reference to the destroyed viewer.

Three knock-on effects:

1. Console errors / partial state corruption.
2. `swapsInFlight` counter never decremented → sync stays suppressed forever.
3. The `syncing` flag from gotcha 5 sticks `true` if the once-handler was the
   only place that reset it.

**Fix**: cancellation tokens.

```js
const pendingSwapTokens = new Set();

function swapVariant(which, variant) {
  const viewer = which === "a" ? viewerA : viewerB;
  // ... capture viewport ...
  swapsInFlight++;
  const token = { cancelled: false };
  pendingSwapTokens.add(token);

  function clearSwap() {
    if (pendingSwapTokens.has(token)) {
      pendingSwapTokens.delete(token);
      swapsInFlight = Math.max(0, swapsInFlight - 1);
    }
  }

  viewer.addOnceHandler("open", () => {
    if (token.cancelled || !viewer.viewport) {
      clearSwap();
      return;
    }
    insideSync = true;
    try {
      viewer.viewport.zoomTo(zoom, null, true);
      viewer.viewport.panTo(center, true);
    } finally {
      insideSync = false;
    }
    clearSwap();
  });

  viewer.open({ type: "image", url: variant.display });
}

function closeViewers() {
  // Cancel anything in-flight before destroying viewers.
  pendingSwapTokens.forEach((t) => (t.cancelled = true));
  pendingSwapTokens.clear();
  swapsInFlight = 0;
  insideSync = false;
  // ... viewer.destroy() ...
}
```

### 7. Picker selection desyncs from viewer state on `open-failed`

Picker change → `swapVariant("a", v)` optimistically updates `currentA = v` and
the picker's `<select>` value. If `viewer.open()` fails (404, network, decode
error), the once-handler never fires and the user sees: picker shows variant
X, viewer shows whatever was there before, no warning.

**Fix**: register `open-failed` alongside `open` and roll back the picker.

```js
viewer.addOnceHandler("open-failed", () => {
  if (token.cancelled) { clearSwap(); return; }
  pickers[which].value = previousVariant.slug;
  if (which === "a") currentA = previousVariant;
  else currentB = previousVariant;
  clearSwap();
  updateMode();
});
```

### 8. Pointer capture leaks across lightbox open/close

Drag the divider, hit Escape mid-drag, the lightbox closes — but `dragging` is
still `true` and `setPointerCapture` was never released. Reopen the lightbox,
hover the handle without pressing, and `pointermove` fires immediately, sees
`dragging === true`, snaps the divider to wherever your cursor happens to be.

**Fix**: track the captured pointer ID and release it explicitly in
`closeLightbox`.

```js
let capturedPointerId = null;

handle.addEventListener("pointerdown", (e) => {
  dragging = true;
  capturedPointerId = e.pointerId;
  handle.setPointerCapture(e.pointerId);
});

function closeLightbox() {
  if (dragging && capturedPointerId !== null) {
    try { handle.releasePointerCapture(capturedPointerId); } catch (e) {}
  }
  dragging = false;
  capturedPointerId = null;
  // ... close ...
}
```

### 9. Document-level Escape steals focus from native `<select>`

`document.addEventListener("keydown", e => { if (e.key === "Escape") close() })`
also fires when the user is cancelling an open `<select>` dropdown — most
browsers fire the Escape on the document anyway. User clicks the picker, decides
not to change, hits Escape: whole lightbox vanishes.

**Fix**: skip when the event target is a `<select>`.

```js
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || lightbox.hidden) return;
  if (e.target && e.target.tagName === "SELECT") return;
  closeLightbox();
});
```

### 10. `pointermove` on the divider is a layout-thrash hotspot

Naïve drag handler:

```js
handle.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const rect = stage.getBoundingClientRect();   // ← every event
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  setDividerX(x);                                // ← writes style.left + clip-path
});
```

`getBoundingClientRect()` forces a synchronous layout each call, which the
previous frame's `clip-path` write has dirtied. On a 1000 Hz mouse during a
fast drag, that's 1000 layout flushes/sec — visible jank on slower hardware.

**Fix**: cache the rect once on `pointerdown` (stage doesn't move during a
drag), and rAF-throttle the writes.

```js
let dragRect = null;
let pendingPct = null;
let rafQueued = false;

handle.addEventListener("pointerdown", (e) => {
  dragRect = stage.getBoundingClientRect();
  // ...
});

handle.addEventListener("pointermove", (e) => {
  if (!dragging || !dragRect) return;
  pendingPct = ((e.clientX - dragRect.left) / dragRect.width) * 100;
  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      if (pendingPct !== null) {
        setDividerX(pendingPct);
        pendingPct = null;
      }
    });
  }
});
```

### 11. `pan` + `zoom` + `animation` triple-fire on every viewport change

Hooking all three for sync feels safe but means each animation frame does
~3× the work. `animation` fires every frame; `pan` and `zoom` fire too. Drop
`animation` — `pan` + `zoom` already cover all viewport state changes.

### 12. CSP needs `style-src 'unsafe-inline'` for OSD-using sites

If you ship a Content-Security-Policy meta tag (recommended — defense in depth
when rendering JSON to DOM), you'll find OSD breaks under
`style-src 'self'`. OSD inlines styles on its viewer DOM and you've probably
got `element.style.foo = ...` in your own code (e.g., the divider's `style.left`,
the layer's inline `clip-path`).

The minimum-surface CSP that works:

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

`script-src 'self'` is only possible if you've also vendored OSD locally.
Otherwise you'd need `script-src 'self' https://cdn.jsdelivr.net` (or
wherever it's hosted), which weakens the policy.

## Reference implementation

The full pattern lives in
[`noise-sharpening/js/viewer.js`](../../../noise-sharpening/js/viewer.js)
(`attachLightboxHandlers`) and the supporting scaffold in
[`noise-sharpening/scenario.html`](../../../noise-sharpening/scenario.html) +
[`noise-sharpening/css/styles.css`](../../../noise-sharpening/css/styles.css).

The key entry points:

| Function | Role |
|---|---|
| `openLightbox({a, b})` | Mounts both viewers, populates pickers, sets up sync. |
| `closeViewers()` | Cancels in-flight swaps, resets sync state, destroys viewers. |
| `swapVariant(which, variant)` | Preserves viewport across `viewer.open()` swap with `open-failed` rollback. |
| `bindViewportSync(a, b)` | Bidirectional `pan` + `zoom` handlers with `shouldSuppressSync()` guard. |
| `setDividerX(pct)` | Updates divider position + `layerB.style.clipPath`. |
| `updateZoomReadout()` | DPR-aware percent display, memoized to skip same-value writes. |

## Prevention strategies

For the next dual-viewer comparison build:

1. **Wrap the OSD mount.** Don't rely on the host element keeping the layout
   styles you set on it.
2. **Track lifecycle explicitly.** Cancellation tokens + an in-flight counter
   beat a single boolean for any async swap pattern.
3. **Test the cancel path.** "Close the lightbox / navigate away while a swap is
   loading" is the most common race-condition vector.
4. **Account for DPR.** Anywhere you'd say "100%" or "1:1" needs to know whether
   you mean CSS pixels or device pixels.
5. **Listen to `open-failed`.** Optimistic UI updates need a rollback hook.
6. **Vendor third-party scripts before adding CSP.** Otherwise CSP work
   accumulates technical debt against the third-party allow-list.
7. **Cache layout reads in drag handlers.** `getBoundingClientRect()` per
   `pointermove` is a layout-thrash invitation on high-Hz pointers.

## Testing notes

Easy ways to surface the gotchas during development:

- **Stuck sync flag**: open DevTools → Network → Slow 3G. Trigger picker swap,
  hit Escape within 200 ms, reopen lightbox, try to pan. If sync is dead,
  gotcha 5 + 6 are still present.
- **Pointer capture leak**: start dragging the divider, press Escape (without
  releasing), reopen lightbox, hover over the handle without pressing. If
  the divider snaps to the cursor, gotcha 8 is present.
- **DPR-aware 1:1**: open the same image in Lightroom at 1:1 and the lightbox
  at 1:1 on a Retina laptop. The visible image area should match. If the
  lightbox shows a 2× zoomed view, gotcha 4 is present.
- **CSP regression**: add a `securitypolicyviolation` listener; if any future
  inline-script regression introduces a violation, you'll catch it.

```js
document.addEventListener("securitypolicyviolation", (e) => {
  console.warn("CSP violation:", e.violatedDirective, e.blockedURI);
});
```

## Performance characteristics

For reference: on the production Spotted Owlet scenario (7 variants, 2883×2162
images at ~3 MB each, after the build script's progressive JPEG re-encode):

- Lightbox initial render: < 200 ms (cold), < 50 ms (warm).
- Picker swap with viewport restore: < 300 ms (cached), 1-2 s (cold network).
- Divider drag: stable 60 fps with the rAF-throttle pattern from gotcha 10.

## See also

- [todos/004-complete-p1-lightbox-swap-race-conditions.md](../../../todos/004-complete-p1-lightbox-swap-race-conditions.md) — the race-condition findings that drove most of these patterns.
- [todos/007-complete-p2-osd-cdn-pin-and-sri.md](../../../todos/007-complete-p2-osd-cdn-pin-and-sri.md) — vendoring rationale.
- [OpenSeadragon synchronized viewers — Ian Gilman demo](https://codepen.io/iangilman/pen/BpwBJe) — the upstream sync pattern this is built on.
- [OpenSeadragon issue #1483](https://github.com/openseadragon/openseadragon/issues/1483) — discussion of the canonical sync pattern.

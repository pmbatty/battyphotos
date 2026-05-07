---
title: "feat: AI upsizing comparisons + scale-aware lightbox sync"
type: feat
date: 2026-05-07
related_plan: docs/plans/2026-05-02-feat-noise-sharpening-comparison-site-plan.md
related_solution: docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md
---

# feat: AI upsizing comparisons + scale-aware lightbox sync

## Overview

Extend the comparison tool to a second case: comparing AI image-upsizing tools (Topaz Gigapixel, Adobe Super Resolution, ON1 Resize, Lightroom AI Enhance, …) on the same source. Unlike noise/sharpening — where every variant has identical pixel dimensions — upsizing variants differ in size by integer scale factors (typically 1×, 2×, 4×).

The existing lightbox synchronizes pan and zoom by feeding [OpenSeadragon](https://openseadragon.github.io/)'s viewport coordinates from one viewer into another. Those coordinates are already image-normalized (image width = 1 viewport unit), so *scene-relative* sync works for free as long as the two variants share an aspect ratio. The interesting work is the **zoom semantics**:

- The current `100%` / `200%` buttons mean "1 source pixel = 1 device pixel" / "1 source pixel = 2 device pixels". With same-size variants, both viewers land at the same pixel zoom. With different sizes, that interpretation produces *different scene regions*, which defeats the comparison.
- New rule (from Peter): the buttons apply to the **larger** of the two images. The smaller image displays the same scene region at proportionally higher pixel zoom. So `100%` on a (1×, 2×) pair means the 2× image is at 100% and the 1× image is at 200%.
- Readout reflects this: `Current: 100%` becomes `Current: 100% | 200%` when sizes differ. Order matches the lightbox's existing left/right badges (A | B = baseline | variant).

The bulk of the work breaks into:

1. **Build pipeline**: auto-detect each variant's pixel size, derive scale factors, generate diagnostic crops at a common screen size regardless of source pixel count.
2. **Lightbox**: scale-aware zoom presets (apply to larger image), dual-pct readout, and **a set of hardening fixes** (raised `maxZoomPixelRatio`, single-pass clamp+sync, ordered handler registration, gated zoom toolbar) without which 4× pairs silently misbehave.
3. **New `upsizing/` sub-project**: gallery + scenario shells that reuse the existing `noise-sharpening/` JS/CSS via relative paths. No premature shared-infrastructure refactor — that's deferred until a third sub-project lands and informs the right layout.

## Problem Statement

Upsizing comparisons matter because AI upsamplers don't just enlarge pixels — they *invent* detail. Different tools invent different things, and "good detail" vs. "plausible-looking noise" can only be judged at native pixel scale. Two requirements follow:

1. **Same-scene viewing**: a viewer panning around a 4× upsized image should see the same scene region as the 1× original they're comparing it against. Not the same pixel zoom.
2. **Native-pixel inspection**: when the user clicks `100%`, the larger image is at 1:1 (so they see exactly what the AI produced), and the smaller image is upscaled to match.

The existing lightbox can't do this. Three things hard-code the same-size assumption:

- [`zoomToPct(pct)`](noise-sharpening/js/viewer.js#L289-L295) drives `viewerA` only and assumes the synced `viewerB` lands at the same pixel zoom (which it would, with same-size variants).
- [`updateZoomReadout()`](noise-sharpening/js/viewer.js#L650-L659) reads `viewerA`'s zoom as the truth for both viewers.
- The build pipeline emits **one** `image_dimensions` block per scenario at [`tools/build-site.py`](tools/build-site.py) and assumes all variants share it. That's used for CSS aspect-ratio reservation and crop math.

Beyond the lightbox, the per-variant 200% diagnostic crop card (introduced in [docs/plans/2026-05-03-feat-scenario-page-hero-and-crop-cards-plan.md](docs/plans/2026-05-03-feat-scenario-page-hero-and-crop-cards-plan.md)) crops a fixed pixel rectangle from each variant. That breaks for upsizing variants — the crop region needs to scale with the variant's pixel dimensions to show the same scene region.

## Research Findings

### Local research

- **Sync is already scene-relative.** [`bindViewportSync`](noise-sharpening/js/viewer.js#L632-L648) calls `dst.viewport.zoomTo(src.viewport.getZoom())` and `dst.viewport.panTo(src.viewport.getCenter())`. OSD's viewport coordinates are normalized to *image width = 1.0*, so for two same-aspect images of any pixel size, the same `zoom` value gives the same scene-fit and the same `center` gives the same scene point. **No change needed to the sync handler itself.**
- **`imageToViewportZoom` is per-image.** OSD's `viewport.imageToViewportZoom(z)` translates "CSS-pixels-per-source-pixel" into a viewport zoom for *that specific viewer's image dimensions*. So we drive zoom on whichever viewer is the "reference" (largest), and let sync propagate — the partner's own `imageToViewportZoom` math gives it the right pixel zoom for its dimensions automatically.
- **Existing crop pipeline assumes uniform pixel dims.** [`save_crop_at_level()`](tools/build-site.py) reads `manifest.detail_crop` directly as variant-pixel coordinates and 2× nearest-neighbor upscales. For upsizing, `detail_crop` must be interpreted as *baseline (1×) source coordinates* and scaled per variant.
- **Page-data already carries `image_dimensions`** at scenario level (used by [`viewer.js:19-23`](noise-sharpening/js/viewer.js#L19-L23) for `--variant-aspect`). Adding per-variant `width`/`height` is additive; existing scenarios continue to render unchanged.
- **`image_order` and `hero_image` reference titles, not slugs**, and titles come from JPEG XMP `dc:title`. No change needed to that part of the manifest schema for upsizing.
- **`maxZoomPixelRatio: 4`** at [viewer.js:425](noise-sharpening/js/viewer.js#L425) and [:447](noise-sharpening/js/viewer.js#L447) caps OSD at "1 source pixel ≤ 4 device pixels". For a (1×, 4×) pair zoomed to "200%" via the new rules, the smaller (1×) image needs 8 device px per source px. The cap will silently clamp it, the readout will read the clamp back, and the two viewers will decouple. This must be raised per-pair to `Math.max(4, scaleRatio * 2)`.
- **Past plan for scenario-page restructure** ([2026-05-03 plan](docs/plans/2026-05-03-feat-scenario-page-hero-and-crop-cards-plan.md)) deferred renaming `*-crop-200.jpg` → `*-crop.jpg`. Now is a good time — the "200" suffix is wrong for upsizing (a 2× variant's crop is at 100% pixel zoom, a 4× variant's at 50%).

### External research

Skipped — local context is strong, the OSD synchronized-viewer pattern is documented in [docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md](docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md), and the math is straightforward.

## Technical Approach

### 1. Site structure (no shared-infrastructure refactor)

The current sub-project shape stays — `noise-sharpening/` keeps its own `js/`, `css/`, `vendor/`. The new `upsizing/` sub-project is added as a sibling that references those assets via relative paths.

```
battyphotos/
├── index.html                       # Umbrella landing — adds an upsizing card
├── tools/
│   ├── build-site.py                # Gains --project routing (Phase 1)
│   └── requirements.txt
├── noise-sharpening/                # Existing sub-project — js/css/vendor stay here
│   ├── index.html
│   ├── scenario.html
│   ├── js/
│   │   ├── app.js
│   │   ├── escape.js
│   │   ├── gallery.js
│   │   └── viewer.js                # Scale-aware + race hardening (Phase 2)
│   ├── css/styles.css
│   ├── vendor/openseadragon-4.1.1/
│   ├── data/...
│   └── images/...
└── upsizing/                        # New sub-project (Phase 3)
    ├── index.html                   # References ../noise-sharpening/{js,css,vendor}/
    ├── scenario.html                # Same
    ├── data/...
    └── images/...
```

This is **deliberately unfashionable**: `upsizing/scenario.html` referencing `../noise-sharpening/js/viewer.js` looks awkward in directory listings. The trade-off is real:

- **No "shared infrastructure" refactor** — keeps the existing live pages untouched, no relative-path rewrites across all of `noise-sharpening/`'s HTML, no `data-source` / `data-page-data-prefix` indirection invented purely to support a path move.
- **The "what counts as shared?" question gets answered by data** — when a third project lands, two real call-sites inform the right layout instead of guesswork from one.
- **One new prefix path to rewrite, one time**: in `viewer.js`, `prefixUrl: "vendor/openseadragon-4.1.1/images/"` becomes `"../noise-sharpening/vendor/openseadragon-4.1.1/images/"`. Both pages live at repo-root depth, so the same path resolves correctly from `noise-sharpening/scenario.html` and `upsizing/scenario.html`.

### 2. Source format

Source folders mirror today's convention:

```
~/Pictures/MHWPC-training-upsizing/{Scenario}/
├── manifest.json                    # Scenario-level (slug, title, detail_crop, …)
├── jpeg/                            # Lightroom exports of all variants
│   ├── {stem}.jpg                   # 1× original
│   ├── {stem}-Edit-2.jpg            # e.g., Topaz Gigapixel 2×
│   ├── {stem}-Edit-3.jpg            # e.g., Adobe SR 2×
│   └── {stem}-Edit-5.jpg            # e.g., Topaz Gigapixel 4×
└── *.darwain.json                   # AI critiques (optional, same as today)
```

Manifest schema is unchanged from noise-sharpening except for the **invariant**: `detail_crop` is in baseline (1×) source coordinates. This invariant is the single load-bearing convention for the entire scale-aware pipeline; it must be documented in the manifest schema comment, in `save_diagnostic_crop()`, and anywhere `viewer.js` does crop math.

```json
{
  "slug": "feather-detail-eagle",
  "title": "Bald Eagle — feather detail",
  "subtitle": "Comparing AI upsamplers on a low-res ISO 6400 capture.",
  "detail_crop": { "x": 920, "y": 540, "w": 600, "h": 400 },
  "hero_image": "Topaz Gigapixel 4×",
  "sort_order": 1,
  "image_order": [
    "Original",
    "Lightroom AI Enhance",
    "Adobe Super Resolution 2×",
    "Topaz Gigapixel 2×",
    "Topaz Gigapixel 4×",
    "ON1 Resize 4×"
  ]
}
```

**Scale factor is auto-detected.** The build script reads each JPEG's intrinsic width and computes:

```python
baseline_w = min(v.width for v in variants)
v.scale = round(v.width / baseline_w)
```

That's the entire derivation. No defensive theater (range checks, aspect-drift tolerances, etc.) — Peter is the sole content author and any problem is visible on first preview. If a real authoring failure mode shows up, add validation then.

### 3. Coordinate system

The build script and the frontend agree on one convention: **`detail_crop` is in baseline (1×) source pixels.** Everything else is derived.

| Quantity | Source of truth | Example (1× = 2880 px wide, scenario crop 600×400 at (920, 540)) |
|---|---|---|
| Variant `width` × `height` | JPEG intrinsic dims | 1×: 2880×2160, 2×: 5760×4320, 4×: 11520×8640 |
| Variant `scale` | `width / baseline_w`, rounded | 1, 2, 4 |
| Variant pixel crop region | `{x*s, y*s, w*s, h*s}` where `s = scale` | 1×: 920,540,600,400; 2×: 1840,1080,1200,800; 4×: 3680,2160,2400,1600 |
| Crop card output dimensions | Constant: `2 × baseline.crop.w` × `2 × baseline.crop.h` | 1200×800 for every variant in this scenario |

The "constant card output size" is the trick from option 1 (same screen size). All cards render at the same physical size; the *content* of those pixels differs (true AI output for 2×, downsampled AI output for 4×, Lanczos-resampled source for 1×). The lightbox is where you go to see actual native-pixel detail.

### 4. Build pipeline changes (`tools/build-site.py`)

**A. Project-aware CLI via `ProjectConfig`.**

Today: `python tools/build-site.py --source ~/Pictures/MHWPC-training-noise-sharpening --out .`

After: `python tools/build-site.py --project upsizing --source ~/Pictures/MHWPC-training-upsizing --out .`

`--project` is required (no default). Internally, route through a small `ProjectConfig` dataclass:

```python
@dataclass
class ProjectConfig:
    slug: str               # Routes output to {out}/{slug}/...
    display_title: str      # For build-log clarity; not used at runtime

PROJECTS = {
    "noise-sharpening": ProjectConfig("noise-sharpening", "Noise reduction & sharpening"),
    "upsizing":         ProjectConfig("upsizing",         "AI image upsizing"),
}
```

This is a one-entry abstraction today, but it's the right place for per-project knobs to grow (quality settings, validation rules, hero dimensions) without growing CLI flags. When a third project arrives, you add an entry, not a flag.

**B. Per-variant dimensions.**

In the variant-walk loop, capture each JPEG's intrinsic `width` and `height` via `Image.open(jpeg_path).size`. Store on the `VariantBuilt` dataclass. Surface in `page-data.json` per variant.

**C. Scale-factor derivation.**

After the variant walk:

```python
baseline_w = min(v.width for v in variants)
for v in variants:
    v.scale = round(v.width / baseline_w)
log_info(f"Baseline: {baseline_w}px wide. Scales: {{v.title: v.scale for v in variants}}")
```

The log line gives Peter immediate eyeball-able feedback during build. Wrong output is visible on the next page render.

**D. Scale-aware crop with a single resampler.**

Replace `save_crop_at_level()` with `save_diagnostic_crop()`:

```python
def save_diagnostic_crop(jpeg_path, baseline_crop, variant_scale, out_path, icc):
    """Crop the same scene region from variant pixels; resample to a constant
    output size.

    INVARIANT: baseline_crop is in baseline (1×) source coordinates. The
    per-variant pixel rectangle is baseline_crop × variant_scale.
    """
    with Image.open(jpeg_path) as im:
        sx = baseline_crop["x"] * variant_scale
        sy = baseline_crop["y"] * variant_scale
        sw = baseline_crop["w"] * variant_scale
        sh = baseline_crop["h"] * variant_scale
        cropped = im.crop((sx, sy, sx + sw, sy + sh))
        out_w = baseline_crop["w"] * 2
        out_h = baseline_crop["h"] * 2
        # Single resampler for every scale — Lanczos handles both up and down.
        # No fake "200% nearest-neighbor" pretense for the 1× variant; the
        # diagnostic card is a thumbnail, the lightbox is for true native pixels.
        resampled = cropped.resize((out_w, out_h), Image.LANCZOS)
        resampled.save(out_path, quality=92, icc_profile=icc, optimize=True, progressive=True)
```

Rename the output file from `{slug}-crop-200.jpg` to `{slug}-crop.jpg`. The "200" suffix is no longer accurate (it's only "200%" for the 1× variant; for 2× variants the file is at 100%; for 4× it's at 50%).

**E. page-data.json shape.**

Top-level `image_dimensions` is the *baseline* dimensions (used for `--variant-aspect` CSS). Added field per variant: `width`, `height`. Renamed field per variant: `crop_200` → `crop`. **Per-variant `scale` is omitted** — the lightbox derives it from `width / image_dimensions.width` when needed, and storing both creates a consistency hazard.

```json
{
  "slug": "feather-detail-eagle",
  "title": "Bald Eagle — feather detail",
  "image_dimensions": { "width": 2880, "height": 2160 },
  "detail_crop": { "x": 920, "y": 540, "w": 600, "h": 400 },
  "hero": "images/feather-detail-eagle/hero.jpg",
  "hero_slug": "topaz-gigapixel-4x",
  "images": [
    {
      "slug": "original",
      "title": "Original",
      "width": 2880, "height": 2160,
      "display": "images/feather-detail-eagle/original.jpg",
      "crop": "images/feather-detail-eagle/original-crop.jpg",
      "critique": null
    },
    {
      "slug": "topaz-gigapixel-2x",
      "title": "Topaz Gigapixel 2×",
      "width": 5760, "height": 4320,
      "display": "images/feather-detail-eagle/topaz-gigapixel-2x.jpg",
      "crop": "images/feather-detail-eagle/topaz-gigapixel-2x-crop.jpg",
      "critique": null
    },
    {
      "slug": "topaz-gigapixel-4x",
      "title": "Topaz Gigapixel 4×",
      "width": 11520, "height": 8640,
      "display": "images/feather-detail-eagle/topaz-gigapixel-4x.jpg",
      "crop": "images/feather-detail-eagle/topaz-gigapixel-4x-crop.jpg",
      "critique": null
    }
  ]
}
```

For the existing noise-sharpening project, the same code path runs: every variant gets `width = baseline_w`, the lightbox falls into the same-size code path, no visible behavior change. The schema rename `crop_200` → `crop` is breaking for any external consumer of `page-data.json` — none documented or expected.

**F. Hero generation.** Existing hero downscale (≤1600 px wide) works on whichever variant is `hero_image` regardless of scale. No change needed.

### 5. Frontend / lightbox changes (`noise-sharpening/js/viewer.js`)

**A. Read per-variant width/height.** In `attachLightboxHandlers`, when opening or swapping, capture `currentA.width`, `currentA.height`, `currentB.{width,height}` from `page-data`.

**B. `getReferenceViewer()` helper.** Centralize the "larger drives" rule so it lives in one spot rather than inline checks scattered across `zoomToPct` and `updateZoomReadout`.

```js
function getReferenceViewer() {
  // The viewer of the larger image. Defines what 100%/200% mean. For same-size
  // variants this returns viewerA arbitrarily, which is fine (sync makes it
  // immaterial). Returns null when viewers aren't open.
  if (!viewerA || !viewerB) return null;
  const aW = currentA?.width || 0;
  const bW = currentB?.width || 0;
  return aW >= bW ? viewerA : viewerB;
}
```

**C. Scale-aware zoom presets — single-pass clamp + drive partner once.** Race fixes #1 and #5 from the hardening checklist (§6) bake into this rewrite:

```js
function zoomToPct(pct) {
  const ref = getReferenceViewer();
  if (!ref || !ref.viewport) return;
  const dpr = window.devicePixelRatio || 1;
  const target = ref.viewport.imageToViewportZoom(pct / 100 / dpr);

  // Apply zoom + constraints inside `insideSync` so the partner doesn't
  // chase the pre-clamp value. Then drive the partner ONCE explicitly with
  // the post-clamp viewport zoom + center, also inside `insideSync`.
  insideSync = true;
  try {
    ref.viewport.zoomTo(target);
    ref.viewport.applyConstraints();
  } finally {
    insideSync = false;
  }
  const other = ref === viewerA ? viewerB : viewerA;
  if (other && other.viewport) {
    insideSync = true;
    try {
      other.viewport.zoomTo(ref.viewport.getZoom(), null, true);
      other.viewport.panTo(ref.viewport.getCenter(), true);
    } finally {
      insideSync = false;
    }
  }
}
```

**D. Dual-pct zoom readout — registration order matters.** Race fix #3:

```js
function pctFor(viewer) {
  if (!viewer || !viewer.viewport) return null;
  const dpr = window.devicePixelRatio || 1;
  const z = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom());
  return Math.round(z * dpr * 100);
}

function updateZoomReadout() {
  const pctA = pctFor(viewerA);
  const pctB = pctFor(viewerB);
  if (pctA === null) return;
  const isCompare = currentA && currentB && currentA.slug !== currentB.slug;
  const sameSize = (currentA?.width || 0) === (currentB?.width || 0);
  const text = (!isCompare || sameSize)
    ? `Current: ${pctA}%`
    : `Current: ${pctA}% | ${pctB}%`;
  if (text !== lastZoomText) {
    zoomEl.textContent = text;
    lastZoomText = text;
  }
}
```

Subscribe `viewerB.zoom` to `updateZoomReadout` **after** `bindViewportSync` registers its handlers. OSD fires zoom-event subscribers in registration order; the sync handler must run before the readout so the readout reads the post-sync value of the partner viewer. Concretely: in `openLightbox`, the call order is:

```
viewerA = OpenSeadragon({...});
viewerB = OpenSeadragon({...});
bindViewportSync(viewerA, viewerB);            // register sync FIRST
viewerA.addHandler("zoom", updateZoomReadout); // readout runs after sync
viewerB.addHandler("zoom", updateZoomReadout); // ditto
viewerA.addHandler("open", updateZoomReadout); // initial render
```

Pin this ordering with a comment — anyone refactoring is one line away from a one-frame readout flicker.

**E. Picker swap viewport preservation.** [`swapVariant`](noise-sharpening/js/viewer.js#L560-L629) captures `viewer.viewport.getZoom()` and `getCenter()` (in viewport coords). Those are scene-relative — invariant to image pixel dimensions for same-aspect images. So swapping between a 1× and 4× variant on the same side preserves the user's scene-region view. **No code change**, but pin the `swapsInFlight++` ordering with a comment (race fix #5): it must increment **before** `viewer.open()` so OSD's internal `goHome` after `open` is suppressed by `shouldSuppressSync()`.

**F. Hero / variant-card click flow.** Both still pass `{a: baseline, b: clickedVariant}` to `openLightbox()`. Same as today.

### 6. Race conditions and hardening (drawn from frontend-races review)

The lightbox already has documented race patterns ([12 gotchas](docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md)). Going scale-aware reopens the surface in five new ways. All five are addressed by the code in §5 above; the checklist below is for the implementation phase (Phase 2) and for QA verification.

| # | Issue | Fix | Tested by |
|---|---|---|---|
| 1 | `zoomTo` → `applyConstraints` on the reference viewer fires zoom event → sync drives partner → clamp re-fires zoom → partner re-syncs to clamped value (visible jitter on every preset click) | `zoomToPct` wraps both calls in `insideSync` and drives the partner once with the post-clamp value (§5C) | Click `100%` / `200%` repeatedly on every (1×, 2×) and (1×, 4×) pair — no visible jitter on either viewer |
| 2 | `maxZoomPixelRatio: 4` silently clamps the smaller viewer when scale ratio > 2 (e.g., a (1×, 4×) pair at "200%" needs 800% pixel zoom on the 1× side; OSD clamps it; readout shows the lie; viewers decouple) | Compute `maxZoomPixelRatio = Math.max(4, scaleRatio * 2)` per pair when constructing OSD viewers; `scaleRatio = Math.max(currentA.width, currentB.width) / Math.min(...)` | (1×, 4×) pair clicked to "200%": readout matches displayed scene region; the divider clip-shows the same eye/feather on both halves |
| 3 | Readout subscriber added before sync handler registration → on every animated zoom frame, readout reads stale partner zoom for one frame before sync corrects it | Register sync **before** readout (§5D); pin order with a comment | DevTools "Slow 3G" + click `200%` on a different-size pair: readout never flickers a wrong intermediate value during the 0.4s OSD `animationTime` |
| 4 | Click `100%` while a 4× swap is in flight → `currentB.width` reflects the new (loading) variant but the displayed image is the previous one; reference selection picks the right "logical" larger but the wrong "visible" target | Gate the zoom toolbar (Fit / 100% / 200% buttons) while `swapsInFlight > 0`. CSS class on the toolbar; `disabled` attribute on the buttons | Trigger a slow-network 4× swap, click `200%` mid-swap: button is disabled or click is ignored; once swap completes, toolbar re-enables |
| 5 | `swapsInFlight++` after `viewer.open()` would let OSD's internal `goHome` (fired by `open`) propagate through the still-active sync handler to the partner viewer | Comment at the `swapsInFlight++` line pinning it before `viewer.open()`. Already correct in current code; the comment prevents future regressions | N/A (regression prevention) |

The plan deliberately does **not** rAF-coalesce the readout — registering after sync and the existing `lastZoomText` memoization is enough. Add coalescing only if Phase 2 QA shows visible flicker we can't explain otherwise.

### 7. Per-variant 200% crop card

Driven by the build pipeline change in §4D — every variant's crop file is the same dimensions, so the existing CSS rule that sizes `.variant__crop` from `--crop-aspect` and `--crop-width` (computed from baseline `detail_crop`) needs no change. The only frontend touch is renaming `crop_200` → `crop` everywhere it's referenced and updating the figcaption:

- [viewer.js:138](noise-sharpening/js/viewer.js#L138): `<img src="${img.crop_200}" ...>` → `<img src="${img.crop}" ...>`
- The `figcaption` text "200% pixel detail (centered, nearest-neighbor upscaled)" is no longer accurate for any variant after switching to single-Lanczos resampling. Replace with "Detail crop · same scene region across variants" — accurate for both projects.

### 8. New `upsizing/` sub-project

Mirror the noise-sharpening shell, referencing shared infrastructure via relative paths:

```html
<!-- upsizing/index.html (gallery shell) -->
<link rel="stylesheet" href="../noise-sharpening/css/styles.css">
...
<script type="module" src="../noise-sharpening/js/gallery.js"></script>

<!-- upsizing/scenario.html (detail shell) -->
<link rel="stylesheet" href="../noise-sharpening/css/styles.css">
<link rel="stylesheet" href="../noise-sharpening/vendor/openseadragon-4.1.1/openseadragon.css">
...
<script type="module" src="../noise-sharpening/js/app.js"></script>
```

`gallery.js` and `app.js` already fetch `data/scenarios.json` and `data/{id}/page-data.json` relative to the *page*, not the script. Both pages live at the same depth from repo root, so the relative fetches resolve correctly without any parameterization.

The `prefixUrl` inside `viewer.js` becomes `"../noise-sharpening/vendor/openseadragon-4.1.1/images/"` — same path resolves from both `noise-sharpening/scenario.html` and `upsizing/scenario.html`.

The two HTML shells in `upsizing/` are nearly identical to noise-sharpening's — copy, adjust the title/lede copy, adjust the `<script>` and `<link>` paths, done. Top-level `index.html` adds an upsizing card alongside the noise-sharpening one.

### 9. Build & verification flow

```bash
# Existing — flag is required now:
python tools/build-site.py --project noise-sharpening \
  --source ~/Pictures/MHWPC-training-noise-sharpening --out .

# New:
python tools/build-site.py --project upsizing \
  --source ~/Pictures/MHWPC-training-upsizing --out .

# Verify
ls -la upsizing/images/{slug}/    # display.jpg + crop.jpg per variant + hero.jpg
ls -la noise-sharpening/images/{slug}/   # same (no orphan crop-200.jpg files)

# Local preview
python -m http.server 8000
open http://localhost:8000/upsizing/scenario.html?id={slug}
```

## Implementation Phases

### Phase 1 — Build pipeline: scale awareness (May 8 morning)

**Estimated effort: 2–3 hours.**

- [ ] Add `ProjectConfig` dataclass + `PROJECTS` registry (§4A); make `--project` required
- [ ] Capture per-variant `width`, `height` from `Image.open(...).size`; surface on `VariantBuilt`
- [ ] After variant walk, derive `baseline_w = min(v.width)`, `v.scale = round(v.width / baseline_w)`; log a one-line scale summary (§4C)
- [ ] Replace `save_crop_at_level()` with single-Lanczos `save_diagnostic_crop()` (§4D); output filename `{slug}-crop.jpg`
- [ ] Surface per-variant `width`, `height` in page-data; rename `crop_200` → `crop`; **omit** per-variant `scale` and top-level `image_dimensions.scale` (derivable; not worth the consistency hazard)
- [ ] Rebuild `noise-sharpening/` with the new pipeline; verify all five scenarios produce visually-equivalent output (1× variants now Lanczos-upscaled instead of nearest-neighbor — slight visual change in crop cards, expected and arguably better)
- [ ] `git rm noise-sharpening/images/*/*-crop-200.jpg` (orphan cleanup)
- [ ] Verify build is still idempotent

### Phase 2 — Frontend: scale-aware lightbox + race hardening (May 8 afternoon – May 9 morning)

**Estimated effort: 3–5 hours.** This is the trickiest piece because of the race-hardening checklist (§6).

- [ ] `viewer.js`: read per-variant `width/height` from page-data; store on `currentA` / `currentB`
- [ ] Add `getReferenceViewer()` helper (§5B)
- [ ] Rewrite `zoomToPct()` per §5C: `insideSync`-wrapped clamp + explicit single partner drive
- [ ] Bump `maxZoomPixelRatio` per-pair: `Math.max(4, scaleRatio * 2)` where `scaleRatio = max(A.w,B.w) / min(A.w,B.w)`. Recompute on every `openLightbox` and `swapVariant`
- [ ] Rewrite `updateZoomReadout()` for dual-pct display (§5D); register sync **before** readout subscriber
- [ ] Add a CSS class + handler to gate the zoom toolbar while `swapsInFlight > 0` (race #4)
- [ ] Pin `swapsInFlight++`-before-`viewer.open()` ordering with a comment (race #5)
- [ ] Pin sync-before-readout registration order with a comment (race #3)
- [ ] Update `prefixUrl` to `"../noise-sharpening/vendor/openseadragon-4.1.1/images/"` so the path resolves from both `noise-sharpening/scenario.html` and (Phase 3) `upsizing/scenario.html`
- [ ] Rename `img.crop_200` → `img.crop` in the variant card template; update figcaption copy
- [ ] **QA against existing noise-sharpening scenarios** — sync, zoom presets, readout, divider, picker swaps must all behave identically to before (every variant has scale=1; the new code paths fall through to the same-size case)

### Phase 3 — `upsizing/` sub-project shells (May 9 afternoon)

**Estimated effort: 1–2 hours.**

- [ ] Create `upsizing/index.html` mirroring `noise-sharpening/index.html` with adjusted copy and `../noise-sharpening/{js,css,vendor}/` paths
- [ ] Create `upsizing/scenario.html` mirroring `noise-sharpening/scenario.html`
- [ ] Create empty `upsizing/data/` and `upsizing/images/` (build script will populate)
- [ ] Update top-level `index.html` to add an upsizing card alongside noise-sharpening
- [ ] Land Phases 1–3 as a small commit series; push to `main`; verify both projects load on Pages

### Phase 4 — First upsizing scenario end-to-end (May 9 evening – May 10)

**Estimated effort: 2–3 hours, plus Peter's content time.**

- [ ] Peter chooses a source image and runs it through 2–3 AI upsamplers (Lightroom AI Enhance, Adobe SR, Topaz Gigapixel at 2× and 4×, ON1 Resize)
- [ ] Lightroom catalog: title and caption each variant via XMP metadata (same as noise-sharpening workflow)
- [ ] Export JPEGs to `~/Pictures/MHWPC-training-upsizing/{Scenario}/jpeg/`
- [ ] Author `manifest.json` for the scenario (slug, title, subtitle, `detail_crop` in 1× source coords, `hero_image`, `sort_order`, `image_order`)
- [ ] Run `python tools/build-site.py --project upsizing --source ~/Pictures/MHWPC-training-upsizing --out .`
- [ ] **End-to-end QA against the §6 hardening checklist** — every row's "Tested by" column must pass
- [ ] Smoke test on Safari, Chrome, iPad

### Phase 5 — Polish and additional scenarios (May 11+, opportunistic)

**Estimated effort: 2–4 hours per scenario, depending on darwain critiques.**

- [ ] Add 2–3 more upsizing scenarios as time / interest allows
- [ ] Optional: append `×N` badge to variant titles when `scale > 1` and the title doesn't already contain it
- [ ] Update `comparison-website-requirements.md` to describe the upsizing workflow
- [ ] Update `README.md` to mention the upsizing sub-project

## Acceptance Criteria

### Phase 1 (build pipeline)

- [ ] `python tools/build-site.py --project noise-sharpening ...` rebuilds the existing scenarios with the renamed crop file (`-crop.jpg` instead of `-crop-200.jpg`); 1× crops are now Lanczos-resampled (expected slight quality difference vs. nearest-neighbor)
- [ ] Per-variant `width`, `height` present in every page-data file
- [ ] Top-level `image_dimensions` reflects the baseline (1×) variant dims
- [ ] No `*-crop-200.jpg` files remain in `noise-sharpening/images/`
- [ ] Build is still idempotent on no-source-change re-runs

### Phase 2 (lightbox)

- [ ] **Same-size variant comparisons (existing noise-sharpening scenarios) behave identically** — sync, zoom presets, readout. No visible regression.
- [ ] Different-size variant comparisons: panning either viewer keeps both centered on the same scene point at the same scene scale
- [ ] `100%` button on a (1×, 2×) pair: 2× image at 100% pixel zoom, 1× image at 200% pixel zoom, same scene region centered
- [ ] `200%` button on a (1×, 4×) pair: 4× image at 200%, 1× image at 800%, same scene region — **and `maxZoomPixelRatio` does not clamp** (race #2 verified)
- [ ] No visible viewer jitter when clicking zoom presets repeatedly on a different-size pair (race #1 verified)
- [ ] Zoom readout never flickers a wrong intermediate value during animated zoom on a different-size pair (race #3 verified)
- [ ] Zoom toolbar disables / ignores clicks while a swap is in flight (race #4 verified) — observable on DevTools "Slow 3G"
- [ ] Picker swap preserves the user's scene-region view across scale changes (1× → 4× → 1× round-trip)
- [ ] Divider drag works exactly as before (clip-path percent doesn't depend on image size)

### Phase 3 (upsizing shell)

- [ ] `https://pmbatty.github.io/battyphotos/upsizing/` loads, shows gallery skeleton (empty state if no scenarios yet)
- [ ] `https://pmbatty.github.io/battyphotos/upsizing/scenario.html?id=...` shell loads, renders correctly once a scenario exists
- [ ] Top-level umbrella page lists both noise-sharpening and upsizing projects

### Phase 4 (first upsizing scenario)

- [ ] At least one upsizing scenario built end-to-end with 1× and ≥2× variants
- [ ] Variant titles, captions, and crops render correctly
- [ ] Comparison lightbox synchronizes correctly across all (A, B) combinations of variants
- [ ] Zoom presets and readout behave per the rules above
- [ ] All five rows of the §6 hardening checklist pass on this scenario
- [ ] Smoke-tested on Safari, Chrome, and iPad

### Non-functional

- [ ] 4× variant JPEGs ≤ 30 MB each (warn manually if larger; bump down quality on `display.jpg` to 85 if needed)
- [ ] No JS console errors on any noise-sharpening or upsizing page
- [ ] Lightbox compare-mode initial render < 500 ms for 4× variants on a typical laptop
- [ ] Repo size remains under GitHub's 1 GB recommended ceiling

## File-by-file scope

| Path | Change | Phase |
|---|---|---|
| `tools/build-site.py` | `ProjectConfig` + required `--project` flag; per-variant dim capture; scale derivation; single-Lanczos `save_diagnostic_crop()`; `crop_200` → `crop` rename | 1 |
| `noise-sharpening/data/{slug}/page-data.json` | Regenerated; gains `width`/`height` per variant; `crop_200` renamed `crop`; top-level `image_dimensions` is baseline dims | 1 |
| `noise-sharpening/images/{slug}/*-crop-200.jpg` | Deleted; replaced by `*-crop.jpg` | 1 |
| `noise-sharpening/js/viewer.js` | `getReferenceViewer()`; scale-aware `zoomToPct` with single-pass clamp + partner drive; per-pair `maxZoomPixelRatio`; dual-pct readout; sync-before-readout handler order; gated zoom toolbar; `prefixUrl` updated to `../noise-sharpening/vendor/...`; `crop_200` → `crop` rename; figcaption update | 2 |
| `upsizing/index.html` | New gallery shell; references `../noise-sharpening/{js,css,vendor}/` | 3 |
| `upsizing/scenario.html` | New detail shell; same | 3 |
| `upsizing/data/scenarios.json` | Built by script | 4 |
| `upsizing/data/{slug}/page-data.json` | Built by script | 4 |
| `upsizing/images/{slug}/*.jpg` | Built by script | 4 |
| `index.html` (root) | Add upsizing project card | 3 |
| `~/Pictures/MHWPC-training-upsizing/{Scenario}/manifest.json` | Authored by Peter | 4 |
| `~/Pictures/MHWPC-training-upsizing/{Scenario}/jpeg/*.jpg` | Lightroom exports | 4 |
| `comparison-website-requirements.md` | Document the upsizing workflow + the `detail_crop = baseline-coords` invariant | 5 |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `maxZoomPixelRatio` bump fails to apply on swap (e.g., `swapVariant` doesn't update it) and a (1×, 4×) pair clamps at "200%" | Medium | High | Recompute on every `openLightbox` AND `swapVariant`. Phase 2 acceptance criteria explicitly verifies the (1×, 4×) "200%" case |
| 1× variants now look Lanczos-resampled in the crop card instead of nearest-neighbor — visible quality shift on existing noise-sharpening scenarios | Medium | Low | Eyeball Phase 1 output on Spotted Owlet before pushing; if Lanczos looks worse than expected, branch on `variant_scale == 1` to keep nearest-neighbor for that case only (re-add the trivial branch). Cost: ~2 lines |
| `upsizing/` referencing `../noise-sharpening/{js,css,vendor}/` looks weird; future contributor moves things and breaks both projects | Low | Medium | Comment at the top of each `upsizing/*.html` file explaining the deliberate choice and pointing at this plan. When a third project arrives, do the proper extraction |
| 4× upsizer JPEG file sizes balloon repo (20–40 MB each) | Medium | Medium | Cap quality at 92 on display, monitor on first scenario. Limit to 1 hero scenario at 4× initially |
| OSD allocates a huge tile pyramid for a 12000-px wide image, slow lightbox open | Low | Low | Already configured `buildPyramid: false` and `tileSources: { type: "image", url }`. Verify in Phase 2 QA |
| Scale mis-detection: smallest variant isn't the 1× original (e.g., Peter forgot to include it) | Low | Medium | Build script logs the chosen baseline + each derived scale per scenario. Eyeball log during build. If recurrent, add explicit `baseline_image: "Original"` manifest field |

## Open Questions

- **Scale labels in titles**: AI upsizer outputs are typically titled like "Topaz Gigapixel 2×" already. If a title is bare ("Topaz Gigapixel"), should the build script auto-append `×{scale}`? **Defer** — let Peter author titles however he likes
- **darwain critiques on upsamplers**: darwain's evaluation is geared at noise/sharpening artifacts. Does it produce useful commentary on AI-invented detail? Probe on the first scenario before committing to author critiques across all of them. **Decide after Phase 4**
- **Mobile UX for 4× variants**: a 4× JPEG at 11520 px wide is heavy. Should the lightbox lazy-load or downscale-on-mobile? **Defer** — typical mobile users will be on the gallery and scenario pages, not deep in the lightbox
- **`hero_image` for upsizing**: typically the hero would be the most-impressive 2× or 4× variant. The hero downscale to 1600 px wide loses most of the upsampler's output detail. Is that OK? **Yes** — hero is for context, lightbox is for detail
- **When does the third sub-project trigger the shared-infrastructure refactor?** The `upsizing/` shell deliberately defers it. If/when a third sibling lands, do the move (probably to `lib/` or root `js/`/`css/`/`vendor/`) with two real call-sites informing the shape

## Future Considerations

- **Cross-project scenarios**: a scenario could in principle live in both projects (e.g., "Bald Eagle — feather detail" comparing both noise reduction *and* upsizing on the same image). Today the manifest has one `slug` per scenario per project; cross-listing would need a relationship table. **Not in scope.**
- **Mixed-mode comparison**: a scenario could include both noise-sharpening variants *and* upsizing variants in one set. Current architecture supports this — variants vary in size, scale-aware code paths kick in. Whether that's pedagogically clear is a separate question
- **Explicit baseline override**: a `baseline_image: "Original"` manifest field would let the user pin which variant defines the 1× scale, instead of inferring from the smallest. Trivial to add when needed
- **Per-variant detail-crop overrides**: the 2026-05-03 plan flagged this as a future consideration. For upsizing, a 4× variant might benefit from a tighter crop region to show more pixel detail. Same conclusion: defer until a real scenario asks for it
- **Quantitative metrics on upsizing**: PSNR / SSIM / LPIPS / DISTS computed against ground truth (if available). Trivially additive once an upsizer dataset has known-good ground truth

## References

### Internal

- Parent plan: [docs/plans/2026-05-02-feat-noise-sharpening-comparison-site-plan.md](docs/plans/2026-05-02-feat-noise-sharpening-comparison-site-plan.md)
- Hero + crop card refactor: [docs/plans/2026-05-03-feat-scenario-page-hero-and-crop-cards-plan.md](docs/plans/2026-05-03-feat-scenario-page-hero-and-crop-cards-plan.md)
- OSD synced-viewer pattern + 12 gotchas: [docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md](docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md)
- Lightbox code: [noise-sharpening/js/viewer.js:184-660](noise-sharpening/js/viewer.js#L184-L660)
- Build script: [tools/build-site.py](tools/build-site.py)
- Live noise-sharpening page: https://pmbatty.github.io/battyphotos/noise-sharpening/scenario.html?id=spotted-owlet

### External

- [OpenSeadragon Viewport docs](https://openseadragon.github.io/docs/OpenSeadragon.Viewport.html) — `getZoom`, `getCenter`, `imageToViewportZoom`, `viewportToImageZoom`, `applyConstraints`
- [OpenSeadragon synchronized viewers — Ian Gilman demo](https://codepen.io/iangilman/pen/BpwBJe) — the upstream sync pattern
- [Pillow `Image.resize` resampling filters](https://pillow.readthedocs.io/en/stable/handbook/concepts.html#filters) — Lanczos as the universal good-quality resampler

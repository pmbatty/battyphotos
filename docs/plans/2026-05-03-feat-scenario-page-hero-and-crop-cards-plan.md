---
title: "feat: scenario page — single hero + per-variant 200% crop cards"
type: feat
date: 2026-05-03
related_plan: docs/plans/2026-05-02-feat-noise-sharpening-comparison-site-plan.md
---

# feat: scenario page — single hero + per-variant 200% crop cards

## Overview

Restructure the scenario detail page (e.g. [Spotted Owlet](https://pmbatty.github.io/battyphotos/noise-sharpening/scenario.html?id=spotted-owlet)) so that the bulk of the page is no longer dominated by per-variant full-resolution JPEGs.

Today, each of the 7 variant cards inlines the full-res JPEG (1.3–2.7 MB each) plus a 100% and 200% diagnostic crop. Total page weight: **~14.5 MB**, of which ~13.8 MB is full-res JPEGs that visually convey almost no signal at the size they're rendered.

After this change:
- **One hero image at the top** (downscaled from the variant named in `hero_image`, ~300–500 KB) — provides scene context, eager-loaded for LCP.
- **Each variant card is the 200% diagnostic crop + meta + critique** in a single side-by-side row. The 100% crop is dropped; the comparison lightbox already covers true 1:1 viewing for anyone who wants it.
- Full-res JPEGs **still ship and still load on click** — the comparison lightbox is unchanged. They just stop being inlined as `<img>` tags.

Estimated new page weight: **~1.5–2 MB** (one 1600px-wide hero, seven ~50–80 KB crops, plus CSS/JS), an order-of-magnitude improvement. The same template applies to all 5 noise-sharpening scenarios.

## Problem Statement

The Spotted Owlet page is slow on first load and on poor connections, and the weight buys nothing. At the size the full-res JPEGs render in a variant card (≈600–800 px wide), differences in noise reduction and sharpening simply aren't visible — they're below the perceptual threshold of the rendered image. Users can't see the thing the page is supposed to demonstrate.

The detail crops *do* show meaningful differences. The comparison lightbox (and its synced 1:1 button) handles deep examination. So inlining the full image per variant occupies bandwidth, scroll real-estate, and attention without informing the comparison.

Peter's framing during ideation:

> Now that we have the comparison viewer I think we can possibly reduce some of the detail on this page — users will use the comparison viewer for any detailed viewing / comparison of images. […] At the size that we show the full photo on this page, we can't really see meaningful differences / information.

## Proposed Solution

### Page anatomy after the change

```
┌─────────────────────────────────────────┐
│  breadcrumb / title / lede               │
├─────────────────────────────────────────┤
│                                         │
│      HERO IMAGE                         │  ← 1600px wide, downscaled from
│      (best-of variant, downscaled)      │     manifest.hero_image; click
│      [click → lightbox]                 │     opens lightbox (compare vs RAW)
│                                         │
├─────────────────────────────────────────┤
│  ┌──────────┐  RAW                      │
│  │  200%    │  caption…                 │  ← variant card, single column,
│  │  crop    │  ★★★★★ darwain critique   │     crop on left, meta + critique
│  └──────────┘  …                        │     stacked on right.
│  [click → lightbox in compare mode]                                       
├─────────────────────────────────────────┤
│  ┌──────────┐  Lightroom Denoise        │
│  │  200%    │  caption…                 │
│  │  crop    │  ★★★★★ darwain critique   │
│  └──────────┘  …                        │
├─────────────────────────────────────────┤
│  …5 more variants…                      │
├─────────────────────────────────────────┤
│  prev / all / next pager                │
└─────────────────────────────────────────┘
```

### Design decisions (locked)

| Decision | Choice |
|---|---|
| 100% crop | **Drop.** Keep only the 200% crop. Comparison lightbox + 1:1 button covers the native-pixel use case. |
| Crop source | **Pipeline-generated** from `manifest.detail_crop` coords (no change). |
| Hero source | **Pipeline-downscaled** from existing `manifest.hero_image` reference, ~1600 px wide @ q90. |
| Card layout | **Single column,** crop on the left, title + caption + critique on the right. |

## Technical Approach

### 1. Build pipeline (`tools/build-site.py`)

Three surgical changes to the existing pipeline. None of the source-side conventions change — Peter's manifest schema and Lightroom export workflow stay identical.

**A. Drop 100% crop generation.**

- `VariantBuilt` dataclass at [tools/build-site.py:68-69](tools/build-site.py#L68-L69): remove the `crop_100` field. Keep `crop_200`.
- The two-rebuild branches at [tools/build-site.py:411-435](tools/build-site.py#L411-L435): drop `out_crop_100` declaration, drop the `needs_rebuild(jpeg_path, out_crop_100, …)` check, drop `save_crop_at_level(im, crop, out_crop_100, 100, icc)`. Keep the 200% path.
- The `VariantBuilt` constructor at [tools/build-site.py:460-461](tools/build-site.py#L460-L461): drop `crop_100=`. Keep `crop_200=`.
- `save_crop_at_level()` itself stays general — it's still a single-purpose function, the `level` arg is no longer needed but renaming it is out of scope. Either keep `level=200` as the only call site, or simplify to a single 200%-only function. Either is fine; pick whichever minimizes diff.

**B. Generate a hero image alongside the thumbnail.**

The script already resolves `hero_title = manifest.get("hero_image")` and uses it to pick the thumbnail source ([tools/build-site.py:365-366](tools/build-site.py#L365-L366), then `pick_jpeg_for_title(...)` to find the matching JPEG by `dc:title`). Reuse that resolution.

Add: a `write_hero(jpeg_path, out_path, max_width=1600, quality=90)` helper that opens the JPEG, applies `Image.thumbnail((1600, 1600), Image.LANCZOS)` (preserves aspect, never upscales), embeds the original ICC profile, saves with `optimize=True, progressive=True`. Save to `noise-sharpening/images/{slug}/hero.jpg`.

Wire it next to the existing thumbnail write (around [tools/build-site.py:365-366](tools/build-site.py#L365-L366)). When `hero_image` is missing or doesn't match a variant, log the same warning ([tools/build-site.py:470](tools/build-site.py#L470)) and skip the hero — the frontend will gracefully render without one.

**C. Surface the hero path in `page-data.json`.**

Add `hero: "images/{slug}/hero.jpg"` (or `null`) at the top level of the page-data output, alongside `image_dimensions`, `detail_crop`, etc. Drop `crop_100` from each variant entry, keep `crop_200`.

**Cleanup of orphaned files.** Existing `*-crop-100.jpg` files become unreferenced. Either:
1. Add a one-time cleanup pass to the build script that deletes `*-crop-100.jpg` from `noise-sharpening/images/{slug}/` after a successful build, OR
2. Add `git rm` of the crop-100s to the same commit as the build-script change.

Option 2 is simpler and the diff is honest. **Recommend (2).**

### 2. page-data.json shape

Before:
```json
{
  "slug": "spotted-owlet",
  "title": "...",
  "image_dimensions": { "width": 2883, "height": 2162 },
  "detail_crop": { "x": 1140, "y": 660, "w": 600, "h": 400 },
  "images": [
    {
      "slug": "raw",
      "display": "images/spotted-owlet/raw.jpg",
      "crop_100": "images/spotted-owlet/raw-crop-100.jpg",
      "crop_200": "images/spotted-owlet/raw-crop-200.jpg",
      ...
    }
  ]
}
```

After:
```json
{
  "slug": "spotted-owlet",
  "title": "...",
  "image_dimensions": { "width": 2883, "height": 2162 },
  "detail_crop": { "x": 1140, "y": 660, "w": 600, "h": 400 },
  "hero": "images/spotted-owlet/hero.jpg",
  "images": [
    {
      "slug": "raw",
      "display": "images/spotted-owlet/raw.jpg",
      "crop_200": "images/spotted-owlet/raw-crop-200.jpg",
      ...
    }
  ]
}
```

`display` (the full-res JPEG) stays — the comparison lightbox still loads it on click. Variant `display` URLs are no longer rendered inline as `<img>`, only used as OpenSeadragon tile sources.

### 3. Frontend (`noise-sharpening/js/viewer.js`, `scenario.html`, `css/styles.css`)

**A. New hero render block.**

In [viewer.js renderBrowseMode()](noise-sharpening/js/viewer.js#L16), inject a `<figure class="scenario__hero">` between the header and the variants section. The figure wraps a button (so it's keyboard-focusable) containing the `<img>`. The img:
- `src={data.hero}` (omit the whole figure when `data.hero` is null)
- `width` / `height` derived from the `image_dimensions` aspect, scaled to ≤1600 wide (or just emit the actual image dims if the build script writes them into page-data — see open question)
- `loading="eager" fetchpriority="high" decoding="async"` — the hero is the LCP element
- `alt={data.title}` (the scenario title doubles as a clean description)
- Click handler opens the lightbox with `a=baseline, b=heroVariant` (compare mode if hero ≠ baseline; falls back to single mode automatically when they match)

**B. Variant card markup.**

In [variantCard()](noise-sharpening/js/viewer.js#L76), drop:
- The `<div class="variant__display">` block (lines 81–91): no inline full image.
- The `<figure class="variant__crop" data-level="100">` block (lines 98–101): no 100% crop.

Restructure the remaining DOM as a single-column row. The `<button>` that opens the lightbox now wraps the 200% crop figure (instead of the full image). The "Click to compare · full resolution" hint sits as an overlay on the crop, same pattern as today.

```html
<article class="variant" data-slug="raw">
  <button class="variant__open-btn" type="button" data-slug="raw"
          aria-label="Open RAW at full resolution for comparison">
    <figure class="variant__crop">
      <img src="images/spotted-owlet/raw-crop-200.jpg"
           width="600" height="400"
           alt="200% pixel detail of RAW"
           loading="lazy" decoding="async" />
      <figcaption>200% pixel detail (centered, nearest-neighbor upscaled)</figcaption>
    </figure>
    <span class="variant__zoom-hint">Click to compare · full resolution</span>
  </button>
  <div class="variant__meta">
    <h2 class="variant__title">RAW</h2>
    <p class="variant__caption">…</p>
    <!-- critique block: stars + label + model attribution + collapsible text -->
  </div>
</article>
```

The lightbox click handler in [attachLightboxHandlers()](noise-sharpening/js/viewer.js#L143) currently selects `.variant__display-btn`; rename the selector match to `.variant__open-btn`. No behavioral change.

**C. CSS changes (`noise-sharpening/css/styles.css`).**

The current `.variant` grid is templated `"display" / "meta" / "crops"` ([styles.css:159-180](noise-sharpening/css/styles.css#L159-L180)). Collapse to a 2-column grid: `crop` on the left at `var(--crop-width)`, `meta` on the right takes remaining space. Stack vertically below ~720 px viewport. Specifically:

- `.variants` — keep the wrapper, no change.
- `.variant` — change `grid-template-areas` from `"display" / "meta" / "crops"` to `"crop meta"` on desktop, `"crop" / "meta"` on mobile. `grid-template-columns: var(--crop-width, 1fr) minmax(0, 1fr)` on desktop.
- Drop `.variant__display`, `.variant__display-btn`, `.variant__display-btn img`, `.variant__zoom-hint` (or repurpose under `.variant__open-btn`). Reuse the hover/focus styling on the new button-on-the-crop.
- Drop `.variant__crops` wrapper and `.variant__crop[data-level="100"]` / `[data-level="200"]` distinguishing rules. Keep one `.variant__crop` rule that sizes to `var(--crop-width)` and aspect `var(--crop-aspect)`. Keep `image-rendering: pixelated` on the crop img (it's still a 2× upscale).
- Add `.scenario__hero` block: max-width matches the `.site-main` content width, `aspect-ratio: var(--variant-aspect)`, `width: 100%; height: auto;`, button reset, `cursor: zoom-in`.

**D. scenario.html.**

No structural changes needed — the hero and variant rows are both injected by `viewer.js` into `#scenario-root`. Optional polish: add a `<link rel="preload" as="image">` for the hero in `app.js` *after* page-data.json fetches, before the first paint of the variants, to nudge LCP further. Defer to v1.1 of this change.

### 4. File-by-file scope

| Path | Change |
|---|---|
| `tools/build-site.py` | Drop 100% crop generation; add `write_hero()`; surface `hero` in page-data; drop `crop_100` from variant entries |
| `noise-sharpening/data/{slug}/page-data.json` | Regenerated by build script |
| `noise-sharpening/images/{slug}/hero.jpg` | New, generated by build script |
| `noise-sharpening/images/{slug}/*-crop-100.jpg` | Deleted (`git rm`) |
| `noise-sharpening/js/viewer.js` | New hero render; variant card markup restructure; selector rename |
| `noise-sharpening/css/styles.css` | Collapse `.variant` grid to `crop / meta` two-column; drop `.variant__display*` rules; drop 100%-crop rules; add `.scenario__hero` |
| `comparison-website-requirements.md` | Update the page anatomy description if it references the old layout |

### 5. Build & verification flow

```bash
# Regenerate site assets from source
python tools/build-site.py --source ~/Pictures/MHWPC-training-noise-sharpening --out . --force

# Verify
ls -la noise-sharpening/images/spotted-owlet/  # hero.jpg present, no *-crop-100.jpg
du -sh noise-sharpening/images/spotted-owlet/  # should drop noticeably

# Local preview
python -m http.server 8000
open http://localhost:8000/noise-sharpening/scenario.html?id=spotted-owlet
```

## Acceptance Criteria

### Functional

- [x] Scenario page renders a single hero image at the top, downscaled to ≤1600 px wide
- [x] Hero image loads with `fetchpriority="high"` and is the LCP element
- [x] Clicking the hero opens the lightbox with the hero variant (compare mode against baseline if they differ)
- [x] Each variant card shows: 200% crop on the left, title + caption + star rating + critique on the right
- [x] Clicking the 200% crop opens the lightbox in compare mode (or single mode for the baseline) — same behaviour as today
- [x] No 100% crop is rendered anywhere on the page
- [x] No `*-crop-100.jpg` files exist in `noise-sharpening/images/{slug}/` after a clean build
- [ ] All five scenarios render correctly under the new template after a full rebuild *(only spotted-owlet has a manifest today; the other four will exercise the same code path once Peter authors them)*
- [ ] Scenarios where `hero_image` is missing/invalid render cleanly without a hero (warning in build log only) *(code path in place, not exercised)*
- [x] Mobile (≤720 px) stacks crop above meta; desktop renders side-by-side

### Non-functional

- [x] Spotted Owlet page total transfer drops from ~14.5 MB to under 2.5 MB on first load *(measured: 1.2 MB)*
- [ ] LCP under 1.5 s on a typical home connection (hero is the LCP) *(not measured)*
- [x] No JavaScript errors in console under any normal flow (browse, click variant, swap variants in lightbox, close)
- [ ] Lighthouse accessibility ≥ 90 on the redesigned page *(not run)*
- [x] No CLS regression — hero and crops both have explicit `width`/`height` so layout reserves space

### Quality gates

- [x] Build script is still idempotent — re-running with no source changes produces no diff (no orphan rewrites of hero.jpg)
- [x] `--force` regenerates all hero JPEGs
- [ ] Manual smoke test on Safari, Chrome, Firefox, iPad *(headless Chromium only; deferred to Peter on deploy)*
- [x] Comparison lightbox unchanged — synced pan/zoom, picker swaps, 1:1 button, divider all work as before

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hero downscale to 1600 px loses too much detail for a presentation projector | Low | Low | The hero is for context, not pixel-peeping. The lightbox loads full-res on click. If 1600 looks soft on a projector, bump to 2000 px in one place. |
| Removing the 100% crop loses information someone valued | Low | Medium | The 1:1 button in the lightbox covers it (same source pixels at native density). If feedback comes in post-talk, restoring is one build-script change. |
| Variant card layout looks awkward at intermediate viewport widths | Medium | Low | Mobile/desktop breakpoint at ~720 px; eyeball at 600/720/1024/1440 widths during QA. |
| Existing `*-crop-100.jpg` files left in repo because cleanup forgotten | Medium | Low | `git rm` them in the same commit as the build-script change; CI is unnecessary for this. |
| Hero variant for some scenario has bad metadata (no `hero_image` or wrong title) | Medium | Low | Build script already warns — same fallback (no hero rendered, page still works). |

## Open Questions

- **Hero downscale dimensions.** 1600 px wide @ q90 is the recommended starting point — fits a typical 1280–1920 px viewport, ~300–500 KB. If that's too soft on Peter's review hardware, bump to 2000 px and re-evaluate. Single config value in the build script. **Default: 1600 px.**
- **Should `image_dimensions` in page-data describe the full-res or the hero?** Currently it's the full-res variant dims (used for `--variant-aspect`, which set the inline image's reserved space). Now used for the hero's reserved space — same aspect, different render size — so no semantic change needed; just keep using it. **No action.**
- **Hero image preload.** Could add a `<link rel="preload" as="image" href="…">` after page-data.json resolves for faster LCP. Defer — see if measured LCP needs it before adding the complexity.
- **Crop file rename `-crop-200.jpg` → `-crop.jpg`.** Now that there's only one crop, the `-200` suffix is decorative. Rename is tempting but adds churn; **defer.** Filenames stay as-is.

## Future Considerations

- **Per-variant crop regions.** If a scenario benefits from showing a different region for one variant (e.g., one of the owls' faces vs. the bark texture), a `crop_override` field on the variant entry could point to a hand-authored Lightroom virtual-copy export. Build script falls back to the manifest-level rectangle. Not needed for v1.1 of this change.
- **Multiple hero variants / hero strip.** A scenario could later expose a small horizontal strip of "context" images at the top instead of a single hero — same downscale pipeline, multiple `hero_*` references. Defer until a real scenario asks for it.
- **CMS-style hero captions.** A short caption ("Our pick — Lightroom Denoise") under the hero could explain *why* it's the chosen example. Could be a new `hero_caption` manifest field. Trivial to add later.

## References

### Internal

- Parent plan: [docs/plans/2026-05-02-feat-noise-sharpening-comparison-site-plan.md](docs/plans/2026-05-02-feat-noise-sharpening-comparison-site-plan.md)
- Comparison viewer pattern: [docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md](docs/solutions/ui-patterns/openseadragon-synced-comparison-viewer.md)
- Build script: [tools/build-site.py:411-435](tools/build-site.py#L411-L435) (crop generation), [tools/build-site.py:365-366](tools/build-site.py#L365-L366) (hero_image resolution)
- Browse-mode renderer: [noise-sharpening/js/viewer.js:76-109](noise-sharpening/js/viewer.js#L76-L109)
- Variant CSS: [noise-sharpening/css/styles.css:152-370](noise-sharpening/css/styles.css#L152-L370)
- Live page (current state): https://pmbatty.github.io/battyphotos/noise-sharpening/scenario.html?id=spotted-owlet

### External

- [Pillow `Image.thumbnail` docs](https://pillow.readthedocs.io/en/stable/reference/Image.html#PIL.Image.Image.thumbnail) — preserves aspect, never upscales, in-place mutation
- [`fetchpriority="high"` / LCP guidance](https://web.dev/articles/fetch-priority) — eager hero load
- [Web Vitals: LCP](https://web.dev/articles/lcp) — target < 2.5 s

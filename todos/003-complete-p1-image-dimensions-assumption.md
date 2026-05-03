---
status: complete
priority: p1
issue_id: 003
tags: [code-review, build-script, correctness]
dependencies: []
---

# `image_dimensions` taken from the first JPEG only — silent miscrop if variants differ

## Problem Statement

`build_scenario` captures `image_dimensions` from whichever JPEG is processed first in directory order, and writes that single value into `page-data.json`. The frontend (CSS variables `--variant-aspect`, `--crop-aspect`) and the build script's `detail_crop` bounds-check both assume every variant in the scenario has the same dimensions.

If a single variant has been re-cropped or re-exported at a different size — easy to do accidentally in Lightroom — the build script silently:
1. Records the *first* variant's dimensions for the whole scenario.
2. Applies the same `detail_crop` rectangle to every variant; on the smaller variant the crop may still fit but is taken from a different region of the image.
3. The frontend reserves layout space using the wrong aspect ratio.

The crop bounds-check at `tools/build-site.py:218` only catches the egregious case where the rectangle falls outside the image; same-aspect-but-different-pixels mismatches sail right through.

This is currently masked by Peter's careful Lightroom workflow (one crop applied to every variant in a scenario), but it's an easy regression to introduce and the failure is silent.

## Findings

- `tools/build-site.py:295, 319-321` — single-variant capture point.
- `tools/build-site.py:218` — bounds check only protects against out-of-image crops, not size mismatches.

## Proposed Solutions

### Option A: assert every variant shares dimensions, fail fast

When processing each subsequent JPEG, compare `(im.width, im.height)` against the recorded dimensions and raise with a clear message if they differ.

- Pros: preserves single-`image_dimensions` contract the JS already depends on; catches the bug at build time with a clear message; zero data-shape changes.
- Cons: forces re-export if the photographer wanted to compare different sizes (which makes no sense for this site anyway).
- Effort: Small (~5 LOC in `build_scenario`).
- Risk: Low — fails the build on bad input, doesn't silently mis-render.

### Option B: record dimensions per variant in page-data

Move `image_dimensions` from scenario level into each variant. Frontend would need to handle differing aspect ratios.

- Pros: supports the (unlikely) future where variants legitimately differ.
- Cons: complicates layout reservation in CSS — `--variant-aspect` would need to be set per variant. Real complexity for a benefit nobody asked for.
- Effort: Medium.
- Risk: Medium.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `tools/build-site.py:319-321` — `image_dimensions = {"width": im.width, "height": im.height}` once → expand to per-variant comparison.

## Acceptance Criteria

- [ ] A scenario with mismatched-dimension JPEGs aborts with a message naming the offending file and both dimensions.
- [ ] No regression on Spotted Owlet (all 7 share 2883×2162).
- [ ] Acceptance test scenario can be added: a small folder with two JPEGs at different sizes that triggers the assertion.

## Work Log

- 2026-05-02: created from /workflows:review (kieran-python-reviewer, P1-5)

## Resources

- kieran-python-reviewer report
- 2026-05-02: resolved during /workflows:work pass on review findings

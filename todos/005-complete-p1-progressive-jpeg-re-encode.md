---
status: complete
priority: p1
issue_id: 005
tags: [code-review, build-script, performance]
dependencies: []
---

# Display JPEGs are baseline-encoded, served at full Lightroom size with redundant XMP

## Problem Statement

`copy_display_jpeg` does a `shutil.copy2` of the Lightroom export, untouched. Verified on disk: every served display JPEG is baseline (non-progressive), 8-bit precision, with the full Lightroom Exif/XMP/ICC metadata still attached. Per-variant payloads run 2.4–5.9 MB; total per-scenario load is ~27 MB.

Two perf consequences:

1. **No progressive reveal.** Baseline JPEGs paint nothing until the full file lands. Over a typical mobile/LTE connection this means several seconds of black inside the lightbox before the user sees anything. Progressive encoding would let the browser paint a usable preview after ~10–20% of bytes arrive — the difference is dramatic on the lightbox open + on every picker swap.
2. **Quality 92+ at full Lightroom size is overkill.** JPEG quality past 90 is mostly preserving compression noise. A 90-quality re-encode with `optimize=True, progressive=True` typically saves 20–30% on file size with imperceptible quality loss (the original JPEG was already lossy, so we're shaving the second-order coefficients). XMP metadata is ~50–200 KB per file and is not consumed by the browser.

## Findings

- `tools/build-site.py:193-197` — `copy_display_jpeg` is a `shutil.copy2`, not an encode.
- Verified: `file noise-sharpening/images/spotted-owlet/raw.jpg` reports baseline.
- Performance-oracle: this is the highest perceived-load impact item.

## Proposed Solutions

### Option A: re-encode display JPEGs as progressive, quality 90, optimized

Replace the `shutil.copy2` with a Pillow re-save:

```python
def copy_display_jpeg(src: Path, dst: Path, force: bool) -> None:
    if not needs_rebuild(src, dst, force):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        icc = im.info.get("icc_profile")
        kwargs = {"quality": 90, "optimize": True, "progressive": True}
        if icc:
            kwargs["icc_profile"] = icc
        im.save(dst, "JPEG", **kwargs)
```

- Pros: 20–30% byte reduction + much better perceived load + no XMP bloat.
- Cons: Two-stage lossy compression (LR JPEG → re-encoded JPEG) — but quality 90 is gentle enough that the user won't see degradation in practice. Build is slightly slower.
- Effort: Small (~5 LOC).
- Risk: Low — easy to A/B compare visually.

### Option B: only re-encode but at quality 92 (matching crops)

Like A but keep quality 92 for safety.

- Pros: even more imperceptible.
- Cons: smaller byte savings.
- Effort: Small.
- Risk: Lower.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `tools/build-site.py:193-197` — `copy_display_jpeg`
- Note: rename function to `write_display_jpeg` or similar since it no longer copies.
- ICC profile must be preserved (currently the LR export has it embedded; the re-save kwarg above does this).

## Acceptance Criteria

- [ ] `file noise-sharpening/images/spotted-owlet/raw.jpg` reports `progressive`.
- [ ] Each display JPEG is at least 15% smaller than the LR-exported source.
- [ ] Visual A/B with the original LR export at full lightbox zoom shows no perceptible difference.
- [ ] ICC profile preserved (verify with `exiftool` or Pillow `info.get("icc_profile")`).

## Work Log

- 2026-05-02: created from /workflows:review (performance-oracle, P1-2)

## Resources

- performance-oracle report
- kieran-python-reviewer also flagged the multiple-`Image.open`-per-JPEG perf concern (todo 014) that should land alongside this
- 2026-05-02: resolved during /workflows:work pass on review findings

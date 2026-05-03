---
status: pending
priority: p2
issue_id: 014
tags: [code-review, build-script, performance, cleanup]
dependencies: []
---

# Build script re-opens each JPEG ~3 times, writes page-data.json twice, has a dead helper

## Problem Statement

A handful of related cleanups in `tools/build-site.py`:

1. **Multiple `Image.open` per variant.** For each JPEG, the script opens it once for `read_xmp` (whole bytes), once inside `write_crop` (level=100), once inside `write_crop` (level=200), once for `image_dimensions`, and once for the hero thumbnail. On a 7-variant scenario that's ~21 source JPEG decodes (each ~3-4 MB and ~50-150 ms of decode work). Clean-build cost is several seconds of redundant decoding.

2. **`write_page_data` runs twice per scenario.** First during initial build, then again after computing prev/next links. The first write is immediately invalidated.

3. **`_variant_to_dict` is a no-op.** `asdict(v)` already produces `{"critique": None, ...}` when `v.critique is None`. The `if` branch is pure ceremony.

4. **`build_scenario` returns `(PageData, Path)` but the `Path` is never used.**

5. **`resolve_source` takes `jpeg_dir` parameter that's never used.**

6. **`needs_rebuild` uses strict `>`, but `shutil.copy2` preserves mtime so source = dest after copy → no rebuild even if manifest's `detail_crop` changed.**

## Findings

- `tools/build-site.py:99-105, 218-220, 245-253, 295-321` — multiple opens.
- `tools/build-site.py:404-421` — `write_page_data` called twice.
- `tools/build-site.py:364-368` — `_variant_to_dict` no-op.
- `tools/build-site.py:280, 404` — `(PageData, Path)` return; `Path` unused.
- `tools/build-site.py:124, 309` — `jpeg_dir` parameter unused after the bug-fix in #1 above will already remove this, but flag here too.
- `tools/build-site.py:187-190` — `needs_rebuild` mtime equality.

## Proposed Solutions

### Option A: consolidate per-variant opens + delete dead code

```python
def derive_outputs(jpeg_path, crop, out_display, out_crop_100, out_crop_200, force):
    with Image.open(jpeg_path) as im:
        # Read XMP from im.info["xmp"] (Pillow 9.1+)
        # Capture dimensions
        # Save display (with progressive=True per todo 005)
        # Save crops at level 100 and 200
        ...
```

Plus:
- Delete `_variant_to_dict`; replace its call site with `asdict(v)`.
- Drop the unused return value from `build_scenario`.
- Move `write_page_data` to a single call in the second pass loop.
- For `needs_rebuild`: also compare manifest mtime (so manifest edits force rebuild of derived crops/data).

- Pros: roughly halves clean-build time; less code to maintain.
- Cons: bigger refactor.
- Effort: Medium.
- Risk: Low (verify outputs byte-stable for the same inputs).

### Option B: spot-fix only the easy wins

Just delete `_variant_to_dict`, drop the unused `Path` return, drop `jpeg_dir` param. Skip the open-consolidation for now.

- Pros: tiny diff.
- Cons: doesn't address the perf or rebuild issues.
- Effort: Tiny.
- Risk: Low.

Likely best: **Option A** if combined with todo 005 (progressive JPEG re-encode) — they touch the same functions.

## Recommended Action
_(Filled during triage)_

## Technical Details

- See line refs above. Largely encapsulated in `build_scenario` and its helpers.

## Acceptance Criteria

- [ ] Each source JPEG is opened at most once per build.
- [ ] `_variant_to_dict` is deleted; output JSON is byte-identical for the same input.
- [ ] `page-data.json` is written exactly once per scenario per build.
- [ ] `Path` removed from `build_scenario` return signature.
- [ ] `jpeg_dir` removed from `resolve_source` signature.
- [ ] Editing only `manifest.json` (without re-exporting JPEGs) triggers a crop rebuild.
- [ ] Clean-build wall time on the Spotted Owlet scenario is meaningfully faster.

## Work Log

- 2026-05-02: created from /workflows:review (kieran P2-7, P2-9, P2-10, P3-14, P3-16; performance P2-7)

## Resources

- kieran-python-reviewer report
- performance-oracle report

---
status: complete
priority: p3
issue_id: 018
tags: [code-review, build-script, polish]
dependencies: []
---

# Build script style nits: type hints, sort tie-breaker, slugify error message, XMP encoding

## Problem Statement

A small batch of style / robustness nits in `tools/build-site.py` from the Python review. None affect correctness, but each is cheap and worth folding into the next refactor.

## Findings

- **Type-hint completeness.** `PageData.image_dimensions: dict` and `detail_crop: dict` should be `TypedDict`s; `PageData.images: list = field(default_factory=list)` should be `list[dict]` or a `TypedDict`. Mix of `Optional[X]` and `X | None` — pick one (the file already has `from __future__ import annotations`).
- **Sort-order tie-breaker.** `sorted(entries, key=lambda x: x.sort_order)` is stable but ties resolve by filesystem iteration order. Add `(sort_order, slug)` as the key so order is deterministic if two scenarios share `sort_order`.
- **`slugify` error message** doesn't include the offending title. `raise ValueError(f"slug for {value!r} is empty after ASCII normalisation")`.
- **`read_xmp` decode error handling.** `errors="replace"` silently substitutes U+FFFD on malformed XMP. Prefer `errors="strict"` so the build aborts the scenario with a clear "utf-8 codec can't decode" message.
- **`read_xmp` whole-file read.** Read the entire JPEG into memory just to find the XMP packet. Pillow can read XMP via `Image.open(path).info["xmp"]` (Pillow 9.1+) — drops the regex entirely. Belongs to todo 014's open-consolidation work.
- **`crop dimensions can become zero`** — if `detail_crop.w < 2` or `h < 2`, the level=200 crop produces a 0-byte image. Add `if w < 2 or h < 2: raise ValueError(...)` precondition.
- **`dc:description` silently empty** — title is required, description is empty-string-defaulted with no comment. Add a one-line comment so the next reader knows it's intentional.
- **`needs_rebuild` doesn't notice manifest changes** — already covered in todo 014.

## Proposed Solutions

### Option A: fold into the next time `build-site.py` is touched

Most of these are 1-3 LOC each. Easiest to bundle with todo 014 (build perf cleanup).

- Pros: zero additional context-switch.
- Cons: deferred until that work happens.
- Effort: Small.
- Risk: Low.

### Option B: dedicated polish commit

Take all the nits as one chore commit.

- Pros: clean separation.
- Cons: another build-script touch.
- Effort: Small.
- Risk: Low.

Likely best: **A** unless triage decides otherwise.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `tools/build-site.py:33` — `Optional` import vs `X | None`
- `tools/build-site.py:69-77` — TypedDict candidates
- `tools/build-site.py:90-96` — slugify error
- `tools/build-site.py:99-105` — read_xmp encoding/perf
- `tools/build-site.py:225-230` — crop dim minimum
- `tools/build-site.py:299-301` — caption silent default
- `tools/build-site.py:380, 413` — sort tie-breaker

## Acceptance Criteria

- [ ] Type hints consistent across the file.
- [ ] Sort key includes `slug` as tie-breaker.
- [ ] slugify error names the offending title.
- [ ] `read_xmp` aborts loudly on malformed UTF-8.
- [ ] `detail_crop` with w<2 or h<2 fails fast with a clear message.

## Work Log

- 2026-05-02: created from /workflows:review (kieran-python-reviewer P2-2, P2-4, P2-8, P2-11, P2-13, P3-18, P3-21)

## Resources

- kieran-python-reviewer report
- 2026-05-03: resolved during /workflows:work P3 sweep

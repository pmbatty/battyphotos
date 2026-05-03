---
status: complete
priority: p1
issue_id: 001
tags: [code-review, build-script, correctness]
dependencies: []
---

# Virtual-copy resolution mis-handles masters whose stem ends in `-N`

## Problem Statement

`resolve_source` in `tools/build-site.py` strips at most a single trailing `-N` segment to find the LR virtual-copy master. This works for `Q1013570-2.jpg → Q1013570.orf`, but breaks down for legitimate Lightroom workflows where the master's own filename ends in `-N` (e.g. `Q1013570-Edit-2.tif` → JPEG `Q1013570-Edit-3.jpg` is its first virtual copy).

Failure modes:
- **Hard fail.** If `Q1013570-Edit-3.jpg` exists with no source `-Edit-3.{orf,tif,dng}`, the script raises `FileNotFoundError` even though a real master (`-Edit-2.tif`) exists with `-3.jpg` as its virtual copy.
- **Silent mis-attribution.** If the photographer kept only the JPEG-as-master (no `-Edit-2.tif`), the regex falls back to `Q1013570.orf` as the parent and assigns `Copy 2`. The critique attribution is then wrong without any warning.

Currently not triggered (Spotted Owlet's `-Edit-N.tif` files all have direct master JPEGs), but a foreseeable LR workflow as soon as Peter authors a virtual copy of a `-Edit-N` variant.

## Findings

- `tools/build-site.py:124-154` — single-strip regex with no awareness that the *base* itself may end in `-M`.
- Disambiguation today is entirely a function of which sibling source files happen to exist on disk (kieran-python-reviewer).

## Proposed Solutions

### Option A: walk back stripping `-N` until a known master stem is found

Build the set of master stems first (filenames with `.orf`/`.tif`/`.dng`), then peel `-N` suffixes off the JPEG stem one at a time and stop on the first match.

- Pros: handles arbitrary nesting, "longest prefix wins" matches LR's naming intuition, removes the unused `jpeg_dir` parameter.
- Cons: ambiguous if both `-Edit.tif` and `-Edit-2.tif` exist as masters and `-Edit-3.jpg` is a virtual copy — needs a one-line comment documenting the "stop at first match (longest prefix)" rule.
- Effort: Small (~20 LOC change in `resolve_source` + one-line scenario-level prep).
- Risk: Low — the existing single-strip case is a strict subset of the new behaviour.

### Option B: require an explicit mapping in the manifest

Add per-image `source_filename` and optional `copy_name` fields to the manifest, removing convention-driven inference altogether.

- Pros: zero ambiguity, intent-explicit.
- Cons: violates "title + caption come from JPEG XMP, manifest stays tiny" principle the user pushed for. Re-introduces per-image manifest entries.
- Effort: Medium — manifest schema change + every scenario manifest needs editing.
- Risk: Medium (UX regression).

## Recommended Action
_(Filled during triage)_

## Technical Details

- `tools/build-site.py:124-154` — `resolve_source`, `_find_source_with_stem`
- Helper functions: `_master_stems(scenario_dir)` could be added at scenario scope and passed into `resolve_source`
- `tools/build-site.py:309` — `jpeg_dir` argument becomes unused (drop it)

## Acceptance Criteria

- [ ] A scenario with a `-Edit-N` master plus a `-Edit-(N+1).jpg` virtual copy resolves correctly: master = `-Edit-N`, copy_name = `Copy 1`.
- [ ] A scenario with `-Edit.tif`, `-Edit-2.tif` (both masters) plus `-Edit-3.jpg` resolves to longest-prefix match (`-Edit-2`) with explanatory comment.
- [ ] A JPEG with no resolvable master raises a clear error naming the file.
- [ ] No regression on Spotted Owlet (existing 7 variants still resolve correctly with their critiques).

## Work Log

- 2026-05-02: created from /workflows:review (kieran-python-reviewer, P1-1)

## Resources

- kieran-python-reviewer report
- 2026-05-02: resolved during /workflows:work pass on review findings

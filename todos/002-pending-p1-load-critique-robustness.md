---
status: pending
priority: p1
issue_id: 002
tags: [code-review, build-script, robustness]
dependencies: []
---

# `load_critique` aborts the entire scenario on a malformed darwain JSON

## Problem Statement

`load_critique` in `tools/build-site.py` calls `json.loads(darwain_path.read_text())` with no try/except. If a sibling `*.darwain.json` is zero-byte, truncated, or otherwise malformed (entirely possible if a darwain run was interrupted), the build script raises `JSONDecodeError`, which bubbles up through `build_scenario` and **kills the entire scenario** even though every other variant might be fine and the AI critique is *optional* metadata anyway.

A second related edge case: `analyses` can be missing, but `data.get("analyses", [])` succeeds. If `analyses` is present but is e.g. a string or `None` (defensive against future schema changes), the list comprehension throws a confusing error far from the actual cause.

Third subtle bug: `max(..., key=lambda a: a.get("timestamp", ""))` — if `timestamp` is present but `None`, comparison between `str` and `NoneType` raises `TypeError`.

## Findings

- `tools/build-site.py:165-184` — `load_critique` is not defensive; one corrupt sidecar nukes a whole scenario build.
- `tools/build-site.py:178` — `key=lambda a: a.get("timestamp", "")` returns `None` if `timestamp` is `None`, blowing up the sort.

## Proposed Solutions

### Option A: catch parse errors, log a warning, return None

Wrap the parse + filter in try/except, write a `WARN` to stderr with the path + error, fall through to `return None`. The scenario continues and the variant simply has `critique: null` in its page-data.

- Pros: graceful degradation matches "darwain critique is optional" design intent. Build never abortable by a single bad sidecar.
- Cons: silent degradation could hide a problem the photographer should know about — but the WARN line gives them visibility.
- Effort: Small (~10 LOC).
- Risk: Low — null-critique already handled cleanly throughout the frontend.

### Option B: validate with jsonschema + fail-fast

Add a tiny schema for the darwain JSON shape and validate up front.

- Pros: explicit contract, catches schema drift loudly.
- Cons: adds a dep, requires keeping schema in sync with darwain's evolving format.
- Effort: Medium.
- Risk: Low.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `tools/build-site.py:165-184` — `load_critique`
- Suggested fix:
  ```python
  if not darwain_path.exists():
      return None
  try:
      data = json.loads(darwain_path.read_text())
      analyses = data.get("analyses") or []
      matching = [a for a in analyses if isinstance(a, dict) and a.get("copy_name") == copy_name]
  except (json.JSONDecodeError, OSError) as e:
      print(f"  WARN  unreadable critique {darwain_path.name}: {e}", file=sys.stderr)
      return None
  if not matching:
      return None
  latest = max(matching, key=lambda a: a.get("timestamp") or "")
  ```

## Acceptance Criteria

- [ ] A scenario containing a zero-byte `*.darwain.json` builds successfully; the affected variant has `critique: null`; a WARN is logged.
- [ ] A scenario containing an `*.darwain.json` with malformed `analyses` (string, None, missing) builds successfully with WARN.
- [ ] A `null` `timestamp` on an analysis entry doesn't blow up the sort.
- [ ] No regression on Spotted Owlet — all 7 critiques still extracted correctly.

## Work Log

- 2026-05-02: created from /workflows:review (kieran-python-reviewer, P1-3)

## Resources

- kieran-python-reviewer report

---
status: complete
priority: p2
issue_id: 008
tags: [code-review, security, supply-chain, build-script]
dependencies: []
---

# `requirements.txt` has no upper bound on Pillow / defusedxml

## Problem Statement

`tools/requirements.txt` reads:

```
Pillow>=10.0
defusedxml>=0.7
```

Pillow has a long history of image-decoder CVEs (e.g. CVE-2023-50447, CVE-2024-28219). The build script processes Lightroom-exported JPEGs — practically friendly content, but a low-bound-only pin means a fresh `pip install` could resolve to either an old vulnerable version (10.0.0 had unpatched issues at release) or a future major (12.x, 13.x) with breaking API changes. `defusedxml>=0.7` is similar shape; current is 0.7.1.

## Findings

- `tools/requirements.txt` — both lines have a floor only.
- The build script is run locally on the maintainer's machine, so direct exposure is low — but a fresh-clone reproducible build is a foreseeable use case (CI, contributor onboarding).

## Proposed Solutions

### Option A: pin to a tight range matching tested versions

```
Pillow>=11,<12
defusedxml>=0.7.1,<0.8
```

(Verify against latest patched versions when implementing.)

- Pros: minimal, no new tooling, locks out known-vulnerable floors and future breaking changes.
- Cons: requires manual bumps. CVEs in 11.x not auto-pulled.
- Effort: Small.
- Risk: Low.

### Option B: switch to a lockfile (`pip-compile`, `uv`, or `poetry`)

Generate `requirements.lock` with exact versions including transitive deps.

- Pros: full reproducibility; clear deltas on bump.
- Cons: extra tooling for a 2-dep build script.
- Effort: Medium.
- Risk: Low.

### Option C: add `pip-audit` to the build workflow

Run `pip-audit` either pre-commit or in CI to catch known CVEs.

- Pros: continuous protection without manual review.
- Cons: requires CI (none today).
- Effort: Medium.
- Risk: Low.

Likely best: **Option A** as the immediate fix; revisit B/C if the project grows.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `tools/requirements.txt`

## Acceptance Criteria

- [ ] Both deps have upper bounds; chosen versions are at least as recent as the latest patched.
- [ ] `pip install -r tools/requirements.txt` resolves the same versions on a fresh checkout.
- [ ] Build still passes with the pinned versions.

## Work Log

- 2026-05-02: created from /workflows:review (security-sentinel P2-5, kieran-python-reviewer P2-12)

## Resources

- security-sentinel report
- kieran-python-reviewer report
- 2026-05-02: resolved during /workflows:work pass on review findings

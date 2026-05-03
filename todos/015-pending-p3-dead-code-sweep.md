---
status: pending
priority: p3
issue_id: 015
tags: [code-review, simplicity, cleanup]
dependencies: []
---

# Dead-code sweep across viewer.js, scenario.html, styles.css, build-site.py

## Problem Statement

The simplicity reviewer flagged a small batch of definitely-dead code: variables assigned and never read, CSS rules that never apply, HTML attributes referencing state that's never toggled, fields written but never consumed by the frontend. None are correctness issues; all are pure noise in the source. Worth a single sweep.

## Findings

- **`viewer.js:150`** — `const sepEl = document.getElementById("lightbox-sep")` assigned, never read. (Was wired up in earlier draft, no longer toggled.)
- **`styles.css:467-469`** — `.lightbox__sep[hidden] { display: none }` — JS never sets `hidden` on this element; browser default already hides `[hidden]`.
- **`styles.css:544-546`** — `.lightbox__layer[hidden] { display: none }` — `viewer.js:355` explicitly sets `layerB.hidden = false` on every `updateMode()` call; layer is intentionally never hidden.
- **`scenario.html:61`** — initial `hidden` attribute on `lightbox-layer-b` is misleading scaffolding; JS unconditionally sets it `false` on first `updateMode`.
- **`viewer.js:355-356`** — `layerB.hidden = false` and its three-line comment are operating on an attribute that, after the previous fix, is never set to `true`.
- **`viewer.js:16`** — `root.classList.add("scenario--browse")` — class has zero matches in CSS. Speculative scaffolding for a "future toggle" mode that doesn't exist.
- **`app.js:30`** — comment "v1.1 will add a comparison mode toggle here" is now obsolete since compare mode shipped in the lightbox itself.
- **`build-site.py:53-54`** — `Critique.darwain_version` and `Critique.timestamp` are written to every page-data.json but never read by the frontend (grep confirms only `model`, `text`, `potential_score` are consumed).
- **`build-site.py:178-184`** — corresponding two lines in `load_critique` that populate the unused fields.
- **`styles.css:455-456`** — comment "Native option list shows on dark systems differently — leave styling to UA" contradicts the rule it precedes (which DOES style the option). Comment is wrong; the rule is fine.

## Proposed Solutions

### Option A: take the entire list as one cleanup commit

All deletions are independent and risk-free.

- Pros: ~30 LOC reduction; clearer code.
- Cons: small commit-noise risk if the user wants atomic changes.
- Effort: Small.
- Risk: Low.

### Option B: defer until adjacent feature work

Skip; only address each item when touching the surrounding file for another reason.

- Pros: zero immediate effort.
- Cons: dead code accumulates, future readers wonder why scaffolding exists.
- Effort: None now.
- Risk: Low.

Likely best: **A.**

## Recommended Action
_(Filled during triage)_

## Technical Details

See line refs above.

## Acceptance Criteria

- [ ] All listed lines deleted.
- [ ] No regression in lightbox / scenario / build behaviour.
- [ ] Generated page-data.json is byte-identical apart from the dropped `darwain_version` / `timestamp` fields.
- [ ] If the frontend ever needs `darwain_version` or `timestamp` (e.g. for surfacing critique provenance), re-add — but only at that point.

## Work Log

- 2026-05-02: created from /workflows:review (code-simplicity-reviewer, P1 list)

## Resources

- code-simplicity-reviewer report

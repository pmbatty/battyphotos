---
status: pending
priority: p2
issue_id: 009
tags: [code-review, security, build-script]
dependencies: []
---

# `manifest["slug"]` flows directly into output paths without validation

## Problem Statement

In `build_scenario`, `manifest["slug"]` is concatenated into `noise-sharpening/images/{slug}/` and `noise-sharpening/data/{slug}/page-data.json` with no validation. A typo'd slug like `"../../tmp/foo"` would write outputs outside the repo silently.

Threat model: the manifest is authored locally by Peter, so this is a foot-gun, not an attacker vector. But it becomes a real concern if the build is ever automated (CI on PR, contributor build).

The same concern doesn't apply to per-variant `slug` — those go through `slugify` which already restricts to `[a-z0-9-]`. The variant pipeline is safe.

## Findings

- `tools/build-site.py:281-282, 372-374` — `manifest["slug"]` used directly as a path component.
- `tools/build-site.py:90-96` — `slugify` is solid for variant slugs (raises on non-ASCII titles, strips `..` and `/`).

## Proposed Solutions

### Option A: validate `manifest["slug"]` against a regex

Add at top of `build_scenario`:

```python
if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug):
    raise ValueError(f"manifest slug {slug!r} must match [a-z0-9][a-z0-9-]*")
```

- Pros: one line; protects against typos and (theoretical) hostile manifest input.
- Cons: marginally restrictive (no underscores). Acceptable.
- Effort: Small.
- Risk: Low.

### Option B: validate via jsonschema for the whole manifest

Add a tiny schema covering slug, title, subtitle, detail_crop, hero_image, sort_order, image_order shapes.

- Pros: catches a wider class of typos (missing fields, wrong types).
- Cons: adds `jsonschema` dep; more to maintain as schema evolves.
- Effort: Medium.
- Risk: Low.

### Option C: defense-in-depth path containment

After computing the output path, assert it resolves inside `repo_root`:

```python
out = repo_root / "noise-sharpening" / "images" / slug
if not out.resolve().is_relative_to(repo_root.resolve()):
    raise ValueError(...)
```

- Pros: belt-and-braces — even with malformed slug, can't escape the tree.
- Cons: redundant if Option A is in place.
- Effort: Small.
- Risk: Low.

Likely best: **A + C combined.** Cheap and totally defensive.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `tools/build-site.py:281-282` — slug origin
- `tools/build-site.py:372-374` — `write_page_data` path construction

## Acceptance Criteria

- [ ] Manifest with `"slug": "../foo"` or `"slug": "/etc"` raises with clear error.
- [ ] Manifest with valid slug builds normally.
- [ ] No regression on existing scenarios.

## Work Log

- 2026-05-02: created from /workflows:review (security-sentinel P2-4, kieran-python-reviewer P2-6)

## Resources

- security-sentinel report
- kieran-python-reviewer report

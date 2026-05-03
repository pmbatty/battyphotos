---
status: complete
priority: p1
issue_id: 006
tags: [code-review, frontend, performance]
dependencies: []
---

# `fetch(..., {cache: "no-cache"})` forces revalidation on every JSON load

## Problem Statement

Both `gallery.js` and `app.js` pass `{cache: "no-cache"}` to `fetch()` for the JSON manifests. `no-cache` does NOT mean "skip the cache" — it means "always send a conditional request and revalidate with the server". Every navigation between scenarios round-trips a 304 (or worse, a 200 if GitHub Pages doesn't honour the conditional) for the JSON file.

The data is content-addressed by the build process — it's not freshness-sensitive. Default cache behaviour respects GitHub Pages' headers, which is what we want. If we ever need to bust caches we can append a `?v=<build-hash>` at build time.

## Findings

- `noise-sharpening/js/gallery.js:9` — `fetch("data/scenarios.json", { cache: "no-cache" })`
- `noise-sharpening/js/app.js:20` — `fetch(\`data/${id}/page-data.json\`, { cache: "no-cache" })`

## Proposed Solutions

### Option A: drop `cache: "no-cache"`

One-character change in each file.

- Pros: trivial; eliminates per-navigation revalidation; respects GitHub Pages defaults (`max-age` + `etag`).
- Cons: stale JSON could persist briefly until the user hard-refreshes or the cached entry expires. Not a real concern for content-addressed JSON shipped via deploys.
- Effort: Small.
- Risk: Low.

### Option B: drop and add `?v=<hash>` cache-buster at build time

Compute a content hash of the JSON during build, append as query string to the fetch URL.

- Pros: instant invalidation on every deploy.
- Cons: more moving parts, requires the build to write the cache-buster value somewhere readable by the JS (e.g. into the HTML).
- Effort: Medium.
- Risk: Low.

Likely best: A — the data only changes on deploy and GitHub Pages' default `max-age` is reasonable.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `noise-sharpening/js/gallery.js:9`
- `noise-sharpening/js/app.js:20`

## Acceptance Criteria

- [ ] Network panel shows `(disk cache)` or `(memory cache)` for `scenarios.json` on the second gallery visit within a session.
- [ ] Same for `page-data.json` on the second visit to a scenario.
- [ ] Fresh deploy still shows updated content (verify deployments invalidate via `Cache-Control: max-age` defaults; if not, fall back to Option B).

## Work Log

- 2026-05-02: created from /workflows:review (performance-oracle, P1-1)

## Resources

- performance-oracle report
- 2026-05-02: resolved during /workflows:work pass on review findings

---
status: pending
priority: p2
issue_id: 007
tags: [code-review, security, supply-chain]
dependencies: []
---

# OpenSeadragon loaded from jsDelivr at floating major version, no SRI

## Problem Statement

`scenario.html` loads OpenSeadragon (4.1.x) from `cdn.jsdelivr.net` with **no Subresource Integrity hash** and at a **floating major-minor version** (`@4.1`). Every patch release flows directly into visitors' browsers without review. Same path is used for the OSD button-icon images via `prefixUrl` in `viewer.js`.

Threat model: GitHub Pages site, no auth, no cookies, no PII. A supply-chain compromise of jsDelivr or the `openseadragon` npm package would still allow defacement / phishing redirect / cryptominer / cross-tab pivot in visitors' browsers. Limited blast radius compared to an authenticated app, but completely preventable.

## Findings

- `noise-sharpening/scenario.html:11-14` — `<link rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/openseadragon@4.1/...">` (no SRI)
- `noise-sharpening/scenario.html:141` — `<script src="https://cdn.jsdelivr.net/npm/openseadragon@4.1/...">` (no SRI)
- `noise-sharpening/js/viewer.js:307` — `prefixUrl: "https://cdn.jsdelivr.net/npm/openseadragon@4.1/build/openseadragon/images/"`

## Proposed Solutions

### Option A: vendor OpenSeadragon locally (best)

Copy `openseadragon@4.1.x` into `noise-sharpening/vendor/openseadragon-4.1/` (script + images). Serve from same origin.

- Pros: zero supply-chain surface; same-origin caching; no extra DNS+TLS handshake; works offline; survives jsDelivr outage.
- Cons: ~150 KB minified gzipped checked in; deps bumped manually.
- Effort: Small (download + commit + path swap).
- Risk: Low.

### Option B: pin exact version + SRI

Pin to `openseadragon@4.1.0` (not `@4.1`) and add `integrity="sha384-..." crossorigin="anonymous"` on both `<link rel="preload">` and `<script>`.

- Pros: keeps CDN; fast; stops attacker-controlled patch updates.
- Cons: still depends on jsDelivr availability + reputation; requires hash regeneration on every version bump.
- Effort: Small (compute hash, paste in two tags).
- Risk: Low.

### Option C: import map + ESM

Use ESM build of OSD if it exists (it doesn't currently — OSD is UMD-only). Future option.

Likely best: **Option A.** Fits the static-site model and removes the only third-party dep entirely.

## Recommended Action
_(Filled during triage)_

## Technical Details

- `noise-sharpening/scenario.html` — replace both CDN references with local paths
- `noise-sharpening/js/viewer.js:307` — point `prefixUrl` at the local copy
- New folder: `noise-sharpening/vendor/openseadragon-4.1/`

## Acceptance Criteria

- [ ] Lightbox functions identically (zoom controls, pan, click-to-zoom, comparison mode)
- [ ] No external network requests to `cdn.jsdelivr.net` when loading `scenario.html`
- [ ] OSD version recorded in a comment or README near the vendored files

## Work Log

- 2026-05-02: created from /workflows:review (security-sentinel, P2-1)

## Resources

- security-sentinel report
- performance-oracle also flagged that `<link rel="preconnect">` is missing if we keep the CDN (P2-4)

# OpenSeadragon (vendored)

Pinned copy of [OpenSeadragon](https://openseadragon.github.io/) used by the
lightbox in `noise-sharpening/scenario.html` and `noise-sharpening/js/viewer.js`.

- **Version:** 4.1.1 (npm `openseadragon@4.1.1`, latest 4.1.x as of May 2026).
- **Source:**
  - `openseadragon.min.js` from `https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/openseadragon.min.js`
  - `images/*.png` from `https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/images/`
- **License:** New BSD (see <https://github.com/openseadragon/openseadragon/blob/master/LICENSE.txt>).

Vendored locally to remove the third-party-script supply-chain surface and so
the lightbox keeps working without network access to a CDN.

## Bumping the version

1. Pick the new version (`X.Y.Z`).
2. Update the four references:
   - `noise-sharpening/scenario.html` (the `<link rel="preload">` and `<script src>` lines).
   - `noise-sharpening/js/viewer.js` (the `prefixUrl` value).
   - `noise-sharpening/vendor/openseadragon-X.Y.Z/` directory name (or rename in place).
   - This README.
3. Re-download the script + every icon listed in `images/`. The set used today
   is in the original commit's bash that vendored 4.1.1 — easiest path is to
   `ls images/` here and curl each file at the new version.
4. Test the lightbox: zoom controls render, the 1:1 button works, comparison-
   mode sync still feels tight.

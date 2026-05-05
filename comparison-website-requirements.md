# NR / Sharpening / Upsizing Comparison Website

## Background & Requirements

**Purpose:** A static website (GitHub Pages) that lets viewers compare the results of different noise reduction, sharpening, and upsizing tools applied to the same wildlife photograph. It serves as a companion to Peter Batty's May 2026 MHWPC digital training session, and should also work as a standalone reference for wildlife photographers interested in these tools.

**Why a website?** Zoom's screen-sharing compression destroys the fine detail (feather barbs, noise grain, sharpening artifacts) that these comparisons depend on. A website with full-resolution images lets attendees examine results on their own screens during and after the presentation. It also becomes a companion resource for a potential YouTube video, where similar compression issues apply.

**Repository:** This site lives in the existing `battyphotos` repo, served at the default GitHub Pages URL `https://pmbatty.github.io/battyphotos/` for v1. The custom domain `batty.photos` (Peter's wildlife photography domain) is deferred for now — it can be flipped on later by dropping in a `CNAME` file and configuring DNS, with no code changes if all internal links are kept relative. The repo's root hosts a small landing page; this comparison project lives under a subfolder (working name `noise-sharpening/`). Future photo-club presentations or comparison projects can be added as additional sibling subfolders.

---

## Source Data

### Folder Structure

The source images live in `~/Pictures/MHWPC-training-noise-sharpening/`. Each subfolder represents one comparison scenario — the same base photograph processed through different tools/settings:

```
MHWPC-training-noise-sharpening/
├── Barred Owl/          (6 images, 4 darwain JSONs)
├── Burrowing Owls/      (2 images, 0 darwain JSONs — in progress)
├── Hummingbird1/         (6 images, 7 darwain JSONs)
├── Sandhill Crane/       (3 images, 0 darwain JSONs — in progress)
└── Spotted Owlet/        (6 images, 6 darwain JSONs)
```

Each folder contains:

- **One original RAW file** (`.orf` — Olympus OM-1 RAW format) — the unprocessed starting point
- **Multiple processed variants** (`.tif`, `.dng`) — each processed through a different tool or with different settings
- **Optional Lightroom virtual copies** of any source file (no extra physical file on disk; tracked inside Lightroom's catalog and surfaced at JPEG export time as `{stem}-2.jpg`, `{stem}-3.jpg`, etc. — see "Virtual Copies" below)
- **A `jpeg/` subfolder** containing **Lightroom-exported JPEGs** for every variant in the folder, **including any virtual copies**. These are the actual inputs to the website build — the website never touches the RAW or TIF files directly. Peter exports these from Lightroom in one batch per scenario with consistent settings (sRGB, quality ~90, full resolution after the Lightroom crop). Confirmed dimensions for the Spotted Owlet scenario: all 7 JPEGs are 2883×2162, embedded sRGB ICC profile.
- **darwain JSON sidecar files** (`{filename}.darwain.json`) — AI-generated analysis and critique, sitting alongside the source files (not inside `jpeg/`). Note: virtual copies do **not** get their own `.darwain.json` file; their analyses live inside the master file's JSON, distinguished by a `copy_name` field. See "darwain JSON Sidecar Format" below.
- **One XMP sidecar** (`{base-filename}.xmp`) — Lightroom metadata for the RAW file; contains `dc:title` and `dc:description` fields
- **Optionally a burst JSON** (`*.darwain-burst.json`) — multi-image grouping metadata (not needed for the website)

### Virtual Copies

Lightroom virtual copies are alternate develop-setting variants of the same source file, stored only in Lightroom's catalog (no extra file on disk). They're useful for showing things like "the same RAW with two different baseline tone curves" without duplicating storage. The Spotted Owlet scenario includes one example: a virtual copy of the RAW with brightened exposure.

When exported as JPEGs, Lightroom names them with a numeric suffix:

| JPEG filename | What it is | darwain `copy_name` |
|---------------|------------|---------------------|
| `…Q1013570.jpg` | Master (the source itself) | (field absent) |
| `…Q1013570-2.jpg` | First virtual copy | `"Copy 1"` |
| `…Q1013570-3.jpg` | Second virtual copy | `"Copy 2"` |

The build script needs to know, for each JPEG, which source file it derives from and which `copy_name` to filter on when extracting the darwain critique.

### Example: Spotted Owlet Folder

This is the most complete example and a good reference for implementation. Mapping confirmed by inspecting the JPEG XMP metadata Peter authored in Lightroom:

| Source file | JPEG export | XMP `dc:title` | XMP `dc:description` |
|-------------|-------------|----------------|----------------------|
| `…Q1013570.orf` | `…Q1013570.jpg` | `RAW` | Original RAW with no editing, shot at ISO 10,000. |
| `…Q1013570.orf` (LR virtual copy) | `…Q1013570-2.jpg` | `Lightroom Denoise` | Lightroom's new AI Denoise with default setting of 50 |
| `…Q1013570-Edit.tif` | `…Q1013570-Edit.jpg` | `Topaz Photo` | Topaz Photo with default noise reduction only (strength 53, original detail 0) |
| `…Q1013570-Edit-2.tif` | `…Q1013570-Edit-2.jpg` | `Topaz Photo 2` | Topaz Photo with default NR (strength 69) plus default sharpening across whole image |
| `…Q1013570-Edit-3.tif` | `…Q1013570-Edit-3.jpg` | `Topaz Photo 3` | Topaz Photo with NR plus Wildlife-setting sharpening |
| `…Q1013570-Edit-4.tif` | `…Q1013570-Edit-4.jpg` | `ON1 RAW` | Processed in ON1 RAW using NoNoise and TackSharp combined |
| `…Q1013570-DxO_DeepPRIME XD3.dng` | `…Q1013570-DxO_DeepPRIME XD3.jpg` | `DxO PureRAW 6` | DxO PureRAW with DeepPRIME XD3 |

Notes:
- The Lightroom AI Denoise variant is a **virtual copy** of the RAW (no separate TIFF on disk). Its analyses live inside `…Q1013570.orf.darwain.json` with `copy_name: "Copy 1"`.
- Each physical TIFF/DNG has its own `…{filename}.darwain.json` sidecar.
- All seven JPEGs share the same dimensions (2883×2162 in this scenario) because Peter applies one Lightroom crop across all variants before exporting.

### darwain JSON Sidecar Format

Each `.darwain.json` file has this structure:

```json
{
  "schema_version": 1,
  "image_file": "filename.tif",
  "analyses": [
    {
      "source": "multi_image_selected",
      "timestamp": "2026-05-01T10:30:00Z",
      "darwain_version": "1.2.0",
      "species": [],
      "potential_score": 5,
      "critique_text": "This edited version shows a dramatic improvement over the original RAW in both noise reduction and sharpness...",
      "request": {
        "provider": "gemini",
        "model": "gemini-3.1-pro-preview",
        "prompt_file": "multi_image_comparison.txt",
        "image_size": 2000,
        "additional_prompt": ""
      },
      "response": {
        "critiques": ["critique for image 1...", "critique for image 2...", "..."],
        "potential-scores": [5, 2, 3]
      },
      "usage": {
        "prompt_tokens": 12345,
        "completion_tokens": 2345,
        "total_tokens": 14690
      }
    }
  ]
}
```

**Key fields for the website:**

- `critique_text` — The AI's per-image analysis text. This is the primary content to display alongside each image. It discusses noise, sharpness, detail preservation, artifacts, and overall quality relative to the other variants.
- `potential_score` — An integer 1–5 quality rating assigned by the AI for that variant. The website should display this alongside each image (e.g., as 1–5 stars or a numeric badge) so viewers can see darwain's overall verdict at a glance.
- `request.model` — Which AI model produced the analysis (for attribution/context).
- `copy_name` — **Present only on analyses for Lightroom virtual copies** (e.g., `"Copy 1"`, `"Copy 2"`). Absent on analyses for the master image. The same `.darwain.json` file holds analyses for both the master and all of its virtual copies, intermingled chronologically. The build script must filter analyses by `copy_name` (absent vs. specific copy) before picking the most recent.
- `analyses` is an array because the same image (and its virtual copies) may have been analyzed many times across different multi-image comparison runs. The website should use the **most recent matching analysis** (latest by timestamp, filtered by `copy_name`).

### Metadata Lives in the JPEG (XMP), Not the Manifest

Each Lightroom-exported JPEG already carries:

- `dc:title` (XMP) — the short label (e.g., `Lightroom Denoise`, `Topaz Photo 2`, `ON1 RAW`). Peter authors this on the photo in Lightroom; it gets embedded automatically on export.
- `dc:description` (XMP) — the caption / processing description (e.g., "Topaz Photo with default noise reduction only (strength 69) plus default sharpening across whole image"). Same authoring path.

The build script reads these directly from each JPEG's XMP block. **No per-image entries in `manifest.json` are needed.** The manifest only carries scenario-level metadata and (optionally) display order.

**Per-scenario `manifest.json` schema (minimal):**

```json
{
  "slug": "spotted-owlet",
  "title": "Spotted Owlet — ISO 10,000",
  "subtitle": "High-ISO test on the OM-1 micro four-thirds sensor. Fine feather detail and dark plumage stress noise reduction and sharpening simultaneously.",
  "detail_crop": { "x": 1200, "y": 800, "w": 600, "h": 400 },
  "hero_image": "Lightroom Denoise",
  "sort_order": 1,
  "image_order": [
    "RAW",
    "Lightroom Denoise",
    "Topaz Photo",
    "Topaz Photo 2",
    "Topaz Photo 3",
    "ON1 RAW",
    "DxO PureRAW 6"
  ]
}
```

- `slug`, `title`, `subtitle`, `sort_order` — scenario-level display metadata.
- `editor_note` — optional plain-text note rendered as a callout under the lede on the scenario page (cream background, gold left border, "Editor's note:" prefix). Use for human commentary alongside the AI evaluation — e.g. flagging a darwain score you disagree with.
- `detail_crop` — `{x, y, w, h}` for the 200% detail crop, applied identically to every variant in the scenario. **`(x, y)` is the centre of the diagnostic region** in source pixels (top-left origin, +y down) and **`(w, h)` is the source region size** (also in source pixels). The build script pulls a `(w × h)` region centred on `(x, y)` and nearest-upscales it 2× to a `(2w × 2h)` JPEG so 1 source pixel renders as a 2×2 block. The frontend then displays that JPEG at `(2w / devicePixelRatio)` CSS px wide so 1 JPEG pixel = 1 device pixel — matching Lightroom's 200% on Retina.
- `hero_image` — the title (matching a JPEG's `dc:title`) used to generate both the gallery thumbnail and the downscaled hero image at the top of the scenario page.
- `image_order` — array of titles in display order. Optional; if omitted, build script falls back to alphabetical-by-title. Useful because alphabetical sort puts RAW last and we want it first.
- `variant_sort` — how the build script orders variants on the scenario page. Optional; defaults to `"manual"`. One of:
    - `"manual"` — use `image_order` exactly (current behaviour).
    - `"rating_desc"` — sort by darwain `potential_score` descending. Ties break on `image_order` position then alphabetical. Variants without a critique drop to the end.
    - `"rating_desc_baseline_first"` — pin `image_order[0]` (the "before" baseline, typically RAW) at the top regardless of its score, then sort the rest by `rating_desc` rules.
- `variant_sources` — optional per-variant override of the JPEG-stem-based critique-source heuristic. Use when each variant in a scenario derives from a *different* processed source file (e.g. one variant from `.rw2`, another from a Topaz `.tif`, a third from a DxO `.dng`) rather than the simple "single master + LR virtual copies" model. Keyed by variant title (matching XMP `dc:title`), each value is one of:
    - **String form** — the source filename. The build script reads `<source>.darwain.json` and filters by `copy_name = None` (master analysis).
        ```json
        "Topaz Photo": "scene-Edit.tif"
        ```
    - **Object form** — explicit `source` and `copy` for cases where the darwain analysis sits under a virtual-copy tag rather than the master.
        ```json
        "Lightroom Denoise": { "source": "scene.rw2", "copy": "Copy 1" }
        ```
  Variants not listed in `variant_sources` use the default JPEG-stem virtual-copy resolution against `master_stems`. Unknown title keys produce a WARN.

The build script:
1. Walks `jpeg/*.jpg`.
2. Reads `dc:title` and `dc:description` from each JPEG's XMP.
3. Derives a slug from the title (`slugify("Lightroom Denoise") → "lightroom-denoise"`); errors on collisions.
4. Maps each JPEG → master source file + `copy_name` using the naming convention (`{stem}.jpg` → master; `{stem}-N.jpg` for N≥2 → master with `copy_name = "Copy {N-1}"`).
5. Loads the matching darwain `.darwain.json` for the master, filters analyses by `copy_name`, takes the most recent.

---

## Image Preparation

Peter exports JPEGs from Lightroom directly (one batch per scenario, full resolution, sRGB, quality ~90). The build script consumes those JPEGs — it never touches RAW or TIFF files. This dramatically simplifies the pipeline: no RAW decoding, no color-space conversion, no `rawpy`/`dcraw` dependencies.

### What the Build Script Produces

From each Lightroom-exported full-resolution JPEG, the script generates:

- **The display JPEG** — re-encoded as a progressive, optimised JPEG with the original ICC profile preserved. Used by the comparison lightbox at full resolution; no longer inlined as an `<img>` on the scenario page (a smaller hero takes that role). Quality ~90.
- **Detail crop at 200%** — the centred half of `detail_crop`, nearest-neighbor upscaled 2× so each source pixel becomes a 2×2 block. This is the at-a-glance comparison view shown next to each variant. JPEG quality ~92.

Once per scenario, additionally (from the variant matching `hero_image`):

- **Hero JPEG** — `hero.jpg`, downscaled to 1600 px wide @ q90 (~300–500 KB). Sits at the top of the scenario page as the "best of" example, eager-loaded as the LCP element.
- **Thumbnail** — `thumbnail.jpg`, ~600 px wide, for the gallery card.

### Conversion Notes

- **All variants in a scenario share the same pixel dimensions** because the Lightroom crop is applied identically across every variant of a scenario before export. This means the detail-crop rectangle (specified once per scenario in the manifest, e.g., `detail_crop: [x, y, w, h]`) applies cleanly to all variants without alignment fuss.
- The Lightroom crop also applies to the "Original RAW" variant — it's exported through Lightroom too, with all develop settings reset to defaults (representing the camera's default rendering with no added NR/sharpening). This is the practical "before" baseline.
- Color profile is already sRGB (Lightroom export setting) — the build script can assume sRGB and skip color management.

### Build Script Outline

A Python script (`tools/build-site.py`) that:

1. Reads a path to the source root (e.g., `~/Pictures/MHWPC-training-noise-sharpening/`).
2. For each scenario folder, reads `manifest.json` and the matching `jpeg/` subfolder.
3. For each image in the manifest: produces a re-encoded display JPEG and a 200% nearest-upscaled detail crop. The variant matching `hero_image` additionally yields the scenario hero (1600 px wide) and thumbnail (600 px wide).
4. Extracts the most recent `critique_text` and `potential_score` from each darwain JSON sidecar → writes a per-scenario `critiques.json`.
5. Writes outputs into the site repo's `images/{scenario-slug}/` and `data/{scenario-slug}/` directories.

The source folder lives outside the git repo (RAW/TIF too large to commit). Only the generated web assets are committed and deployed via GitHub Pages.

---

## Website Structure & UI

### Page 1: Gallery / Landing Page

A grid of scenario cards. Each card shows:

- **Thumbnail** of the subject (the "best" processed version, or the original — Peter's choice)
- **Scenario title** (e.g., "Spotted Owlet — ISO 10,000")
- **Brief description** (1–2 sentences about what this scenario demonstrates)
- **Number of variants** (e.g., "6 processing variants")

Clicking a card navigates to the scenario detail page.

The landing page should also include a brief introduction explaining what the site is — a comparison of AI noise reduction, sharpening, and upsizing tools for wildlife photography — with a link back to the MHWPC presentation context.

### Page 2: Scenario Detail Page

Shows all image variants for one scenario. Two viewing modes:

#### Browse Mode (default)

A single hero image at the top followed by a vertical list of variant cards. For each variant card:

- **200% detail crop** on the left — the diagnostic view of the scenario's `detail_crop` region (centred half, nearest-neighbor upscaled 2×). This is the at-a-glance comparison element — the viewer can see individual feather barbs, noise grain texture, sharpening halos, etc., without zooming.
- Click target: the crop opens the comparison lightbox with the clicked variant on top of the baseline (RAW). The full-resolution display JPEG is loaded lazily by the lightbox via OpenSeadragon.
- **Title** — short label (e.g., "Topaz Default")
- **Caption** — what processing was applied
- **AI Critique** — the `critique_text` from the darwain JSON, displayed in a collapsible/expandable panel below the meta. This is typically 3–6 sentences of detailed analysis.
- **Potential Score** — the 1–5 star rating from darwain, displayed as stars in the critique header.

Above the variant list, the **hero image** (downscaled to 1600 px wide from the variant named in `hero_image`) gives scene context and is also a click target into the lightbox. Native-pixel and deeper-than-200% viewing happen in the lightbox via the 1:1 button rather than as separate inline crops.

#### Comparison Mode

The viewer selects exactly **two images** from the scenario to compare side by side. The comparison view should include:

- **Side-by-side layout** — two images at the same size, with **synchronized zoom and pan** (when you zoom into one image, the other zooms to the same region). This is the single most important feature of the comparison mode.
- **Before/after slider** — a draggable vertical divider overlaying both images at the same zoom level. The user drags left/right to reveal one image or the other. This is the classic comparison UI pattern.
- A **selection mechanism** to change which two images are being compared (dropdown, thumbnail strip, or similar).
- Both images' **title, caption, and AI critique** visible alongside (or toggleable).
- The **pre-cropped detail views** for both images shown below the comparison, also side by side.

### Navigation

- Breadcrumb or back link from scenario page to gallery
- Previous/next scenario navigation from within a scenario page
- A way to quickly switch between browse and comparison modes

### Responsive Design

- Should work well on desktop (primary) and tablet
- Mobile is lower priority but should be usable (stack side-by-side to vertical on narrow screens)

---

## Technical Approach

### Static Site on GitHub Pages

The site is fully static — no server-side processing. All data is in JSON files and all images are pre-built JPEGs committed to the repo. GitHub Pages serves it from `main` at `https://pmbatty.github.io/battyphotos/`. Custom domain (`batty.photos`) deferred — easy to add later without code changes as long as internal links stay relative.

**Size budget:** Total image payload is <100 images × ~2 MB average ≈ 200 MB at the very upper bound, more realistically ~50–100 MB. Comfortably under GitHub's 1 GB recommended repo size, no need for Git LFS.

### Multi-Section Site Structure

`battyphotos` is an umbrella for multiple photo-club / educational pages. The root has a small landing page; each project lives in its own subfolder. This first project goes under `noise-sharpening/`. Future siblings (other comparisons, presentation companions) can follow the same pattern.

### Recommended Stack

Keep it simple — this is a content site, not a web application:

- **Vanilla HTML/CSS/JavaScript** or a lightweight framework. No heavy build toolchain.
- A JavaScript image comparison library for the before/after slider. Good options:
  - [img-comparison-slider](https://github.com/nicecatch/img-comparison-slider) — web component, lightweight
  - [TwentyTwenty](https://zurb.com/playground/twentytwenty) — jQuery-based, classic
  - Or a custom implementation — the slider mechanic is straightforward
- For synchronized zoom/pan: [OpenSeadragon](https://openseadragon.github.io/) is the gold standard for deep-zoom image viewing and supports synchronized multi-image viewing. May be more than needed — evaluate whether a simpler pan/zoom approach suffices.
- CSS Grid or Flexbox for layout
- JSON data files loaded via fetch()

### Data Flow

```
Source images (RAW/TIF, ~50MB each)
    ↓  [build script — convert, crop, generate thumbnails]
Web images (JPEG, ~2-5MB full-res, ~200KB crops, ~50KB thumbs)
    +
manifest.json (per scenario — titles, captions, sort order)
    +
darwain JSON sidecars (AI critiques — can be bundled into manifest or loaded separately)
    ↓
Static site (HTML + CSS + JS + images + JSON)
    ↓
GitHub Pages
```

### Repository Structure

```
battyphotos/                              # Repo root, served at batty.photos
├── index.html                            # Top-level landing page (links to all sub-projects)
├── CNAME                                 # Custom domain config (batty.photos)
├── css/
│   └── site.css                          # Shared site-wide styles (header, typography)
├── tools/
│   └── build-site.py                     # Build script (reads source folder, writes images/data)
├── README.md
└── noise-sharpening/                     # The NR/Sharpening/Upsizing comparison project
    ├── index.html                        # Project landing / scenario gallery
    ├── scenario.html                     # Scenario detail page (browse + comparison modes)
    ├── css/
    │   └── styles.css
    ├── js/
    │   ├── gallery.js
    │   ├── viewer.js                     # Browse mode with zoom
    │   └── comparison.js                 # Comparison mode with slider + sync zoom
    ├── data/
    │   ├── scenarios.json                # Master list of scenarios in this project
    │   └── spotted-owlet/
    │       ├── manifest.json             # Image metadata, titles, captions, detail-crop
    │       └── critiques.json            # AI critique text (from darwain JSONs)
    └── images/
        └── spotted-owlet/
            ├── thumbnail.jpg
            ├── hero.jpg                  # downscaled hero, displayed atop the page
            ├── original-raw.jpg          # full-res, served only by the lightbox
            ├── original-raw-crop-200.jpg
            ├── lr-ai-denoise.jpg
            ├── ...
```

### Build Script Requirements

The `tools/build-site.py` script should:

1. Take a path to the source root (e.g., `~/Pictures/MHWPC-training-noise-sharpening/`) and walk each scenario subfolder.
2. Read each scenario's `manifest.json` and the matching `jpeg/` subfolder of Lightroom exports.
3. For each image in the manifest:
   - Recompress the source JPEG (progressive, quality ~90, ICC profile preserved) → `{slug}.jpg`
   - 200% nearest-upscaled crop of the scenario's defined region → `{slug}-crop-200.jpg`
4. From the variant matching `hero_image`: generate the scenario hero (1600 px wide @ q90) → `hero.jpg`, and the gallery thumbnail (600 px wide) → `thumbnail.jpg`.
5. Extract the most recent `critique_text` and `potential_score` from each darwain JSON sidecar → write to `data/{scenario-slug}/critiques.json`.
6. Write outputs into the site repo's `images/{scenario-slug}/` and `data/{scenario-slug}/` directories.

**Dependencies:** Pillow only. No RAW decoding required.

---

## darwain Integration

The AI critiques displayed on this site are generated by [darwain](https://github.com/pmbatty/darwain), Peter's AI-powered image analysis tool for Lightroom. The site should include a brief attribution, e.g.:

> "AI image analysis powered by darwain, using Google Gemini vision models."

This ties naturally to Peter's broader darwain project and online presence.

---

## Future Expansion

These are not requirements for v1, but worth keeping in mind so the architecture doesn't preclude them:

- **Explanatory content** around comparisons — background on each tool, what settings were used, what to look for. Could be markdown rendered alongside the images.
- **More scenarios** added over time — the site should make it easy to add a new folder with a manifest and have it appear automatically.
- **YouTube companion** — the site URL would be linked from a YouTube video on the same topic. The video would reference specific scenarios on the site for viewers to examine at full resolution.
- **User-submitted comparisons** — eventually other photographers could contribute their own comparison sets (much later, if ever).
- **Quantitative metrics** — if objective measurements (SNR, MTF, etc.) are computed for the images, they could be displayed alongside the AI critique.

---

## Implementation Priority

The MHWPC presentation is on **May 11, 2026**. Working backward from there, the plan is to ship in two passes:

### v1 (target: ~May 7) — Browse mode live

1. **Repo skeleton + GitHub Pages + custom domain.** `battyphotos` deploying to `batty.photos`, top-level `index.html` linking to the noise-sharpening sub-project.
2. **Build script (Pillow-only).** Reads source folder, copies display JPEGs, generates detail crops + thumbnails, extracts darwain critiques into `critiques.json`.
3. **Scenario gallery page.** Cards with thumbnail + title + variant count.
4. **Scenario detail page — browse mode.** Single hero image at the top, then a vertical list of variant cards (200% detail crop + title + caption + star rating + AI critique). Click-to-zoom from any card opens the comparison lightbox (OpenSeadragon).

### v1.1 (target: by/just after May 11) — Comparison mode

5. **Comparison mode** on the scenario page. Two-image picker, side-by-side with synchronized pan/zoom (OpenSeadragon dual-viewer pattern), and a draggable before/after slider as an alternative view.
6. **Polish.** Responsive layout for tablet, transitions, loading states, intro copy explaining the project and tool list.

If browse mode lands cleanly with a few days to spare, comparison mode can land before the presentation. If not, the presentation works fine on browse mode alone — comparison mode follows shortly after.

---

## Open Questions for Peter

Resolved:
- ✅ JPEG export folder: `jpeg/` subfolder per scenario.
- ✅ JPEG size: no cap, use Lightroom export as-is. Confirmed 2883×2162 with embedded sRGB ICC profile for Spotted Owlet.
- ✅ RAW baseline: LR export with develop settings reset; same Lightroom crop applied as the other variants so all dimensions match.
- ✅ Manifest at source: authored alongside images in `~/Pictures/...`, build script copies into repo.
- ✅ Repo: `battyphotos` umbrella, `noise-sharpening/` subfolder for this project. Hosted at default `pmbatty.github.io/battyphotos/` for v1; custom domain `batty.photos` deferred.
- ✅ Timeline: v1 (browse) before May 11 presentation; comparison mode shortly after.
- ✅ Title and caption authoring: lives in the JPEG XMP (`dc:title`, `dc:description`), authored once in Lightroom. Build script reads it. No duplication into manifest.
- ✅ ON1 variants: in the dataset as `Q1013570-Edit-4.jpg` (`ON1 RAW`).
- ✅ Lightroom virtual copies: supported; mapped to darwain analyses by `copy_name`, JPEG named `{stem}-N.jpg` (N≥2).

Still open:
- **Detail crop region per scenario:** Specified as `detail_crop: {x, y, w, h}` in the per-scenario `manifest.json`, applied identically to all variants. Peter eyeballs the coordinates from a JPEG in Preview/Photoshop. OK?
- **Which darwain analysis to display:** When a darwain JSON has multiple analyses (different models, different runs), always show the most recent matching `copy_name`, or offer a UI toggle? Recommendation: most recent for v1; toggle is easy to add later.
- **Burrowing Owls / Sandhill Crane:** These folders currently have few or no darwain JSON sidecars. Will they be fully processed before launch, or should the site handle scenarios with missing AI critique gracefully? (Easy either way.)

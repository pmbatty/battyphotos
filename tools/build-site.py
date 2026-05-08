#!/usr/bin/env python3
"""Build a comparison sub-project from a source folder of Lightroom-exported JPEGs.

Two sub-projects share this pipeline:
  - `noise-sharpening`: every variant has identical pixel dimensions (compare
    AI denoise / sharpening tools at the original resolution).
  - `upsizing`:         variants differ in pixel dimensions by integer scale
    factors (1×, 2×, 4×) (compare AI upsamplers).

The CLI selects the project: `--project noise-sharpening|upsizing`. Output is
routed to `{out}/{project}/...`.

Reads each scenario folder under SOURCE, expects:

    {Scenario}/
        manifest.json                       (scenario-level metadata, authored by Peter)
        jpeg/*.jpg                          (Lightroom exports — title/caption in XMP)
        {original}.{orf,tif,dng,rw2}        (source files; never read directly)
        {original}.{ext}.darwain.json       (AI critique sidecars)

For each JPEG under jpeg/:
  - reads dc:title and dc:description from XMP
  - derives a URL slug from the title (slugify)
  - maps filename -> (master source file, copy_name) using LR virtual-copy naming
  - loads matching darwain analysis (filtered by copy_name, latest by timestamp)
  - writes a re-encoded display JPEG + a Lanczos-resampled detail crop

INVARIANT: `manifest.detail_crop` (`{x, y, w, h}` with x/y as the CENTRE of the
diagnostic region, w/h as size) is in *baseline (1×) source pixels* always.
The per-variant pixel rectangle is `detail_crop × variant_scale`. For the
noise-sharpening project (every variant scale=1) this is a no-op; for upsizing
the smaller-scale variants get a smaller crop region in their own pixel space
mapped back to the same scene region.

The hero variant (manifest.hero_image) additionally yields hero.jpg (a
HERO_WIDTH-wide downscaled JPEG used at the top of the scenario page) and
thumbnail.jpg (smaller still, for the gallery card).

Writes per-scenario {project}/data/{slug}/page-data.json plus a top-level
{project}/data/scenarios.json index for the gallery page.

The image is opened exactly once per variant — XMP, dimensions, and all derivative
outputs come out of a single `Image.open` context. A cheap header-only pre-pass
captures every variant's intrinsic width to derive the baseline before the main walk.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path

from defusedxml import ElementTree as ET
from PIL import Image

XMP_NS = {
    "x": "adobe:ns:meta/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "dc": "http://purl.org/dc/elements/1.1/",
}
SOURCE_EXTS = (".orf", ".tif", ".tiff", ".dng", ".rw2")


@dataclass(frozen=True)
class ProjectConfig:
    """Per-project routing + display knobs.

    `slug` doubles as the output sub-folder name AND the URL path segment
    (e.g. `noise-sharpening/scenario.html?id=...`). Today only `slug` is
    needed; the dataclass exists so per-project knobs (quality settings,
    crop dims, validation rules) can grow here without growing CLI flags.
    """
    slug: str
    display_title: str


PROJECTS = {
    "noise-sharpening": ProjectConfig("noise-sharpening", "Noise reduction & sharpening"),
    "upsizing":         ProjectConfig("upsizing",         "AI image upsizing"),
}

# Display JPEG re-encode params. We re-save Lightroom exports rather than
# copying them so the served files are progressive (visible incrementally as
# bytes arrive — meaningful win on a 4-6 MB JPEG over typical broadband) and
# stripped of the unconsumed Lightroom XMP / Exif blocks (~50-200 KB / file).
JPEG_QUALITY_DISPLAY = 90
JPEG_QUALITY_CROP = 92
THUMBNAIL_WIDTH = 600
HERO_WIDTH = 1600
JPEG_QUALITY_HERO = 90
SLUG_RE = re.compile(r"[a-z0-9][a-z0-9-]*")


@dataclass
class Critique:
    text: str
    potential_score: int | None
    model: str | None


@dataclass
class Variant:
    slug: str
    title: str
    caption: str
    width: int
    height: int
    display: str
    crop: str
    critique: Critique | None = None


@dataclass
class PageData:
    slug: str
    title: str
    subtitle: str
    image_dimensions: dict
    detail_crop: dict
    hero: str | None = None
    hero_slug: str | None = None
    editor_note: str | None = None
    previous_scenario: str | None = None
    next_scenario: str | None = None
    images: list = field(default_factory=list)


@dataclass
class ScenarioIndexEntry:
    slug: str
    title: str
    subtitle: str
    thumbnail: str
    variant_count: int
    sort_order: int


def slugify(value: str) -> str:
    """Lowercase, ascii-normalize, dash-separate. Raises if the result is empty."""
    normalised = (
        unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    )
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalised).strip("-").lower()
    if not slug:
        raise ValueError(f"slug for {value!r} is empty after ASCII normalisation")
    return slug


def validate_slug(value: str, field_name: str) -> str:
    """Ensure a slug is path-safe before it joins an output path."""
    if not SLUG_RE.fullmatch(value):
        raise ValueError(
            f"{field_name} {value!r} must match [a-z0-9][a-z0-9-]*"
        )
    return value


def find_master_stems(scenario_dir: Path) -> dict[str, Path]:
    """Index every recognised raw/source file in the scenario folder by its stem.

    Matches `SOURCE_EXTS` case-insensitively (Olympus exports `.ORF` uppercase;
    Lightroom may preserve it). Preserves `SOURCE_EXTS` precedence: when two
    files share a stem (e.g. `scene.rw2` and `scene.tif`) the one whose
    extension appears later in the tuple wins.
    """
    files = [
        p for p in scenario_dir.iterdir()
        if p.is_file() and not p.name.startswith(".")
    ]
    stems: dict[str, Path] = {}
    for ext in SOURCE_EXTS:
        ext_lower = ext.lower()
        for p in files:
            if p.suffix.lower() == ext_lower:
                stems[p.stem] = p
    return stems


def resolve_source(stem: str, master_stems: dict[str, Path]) -> tuple[str, str | None]:
    """Map a JPEG stem to (master source filename, copy_name).

    A JPEG is a Lightroom virtual copy IFF its full stem isn't itself a master
    stem but a shorter base — produced by stripping a trailing -N suffix — is.
    The walk-back is iterative, so virtual copies of masters whose own filename
    ends in `-N` resolve correctly: e.g. master `Q1013570-Edit-2.tif` plus JPEG
    `Q1013570-Edit-3.jpg` walks back base="Q1013570-Edit-2", finds it, returns
    `("Q1013570-Edit-2.tif", "Copy 1")`. Stops at the longest matching prefix
    (the LR-natural reading).
    """
    if stem in master_stems:
        return master_stems[stem].name, None

    candidate = stem
    while m := re.match(r"^(?P<base>.+)-(?P<n>\d+)$", candidate):
        n = int(m.group("n"))
        if n < 2:
            break
        base = m.group("base")
        if base in master_stems:
            return master_stems[base].name, f"Copy {n - 1}"
        candidate = base

    raise FileNotFoundError(
        f"No source file matching {stem}.{{orf,tif,dng}} and no LR virtual-copy "
        f"interpretation that lands on a known master stem"
    )


def resolve_critique_source(
    jpeg_stem: str,
    title: str,
    variant_sources: dict,
    master_stems: dict[str, Path],
) -> tuple[str, str | None]:
    """Determine which darwain JSON file + copy_name to use for this variant.

    `variant_sources` (manifest field, optional) lets a manifest override the
    default JPEG-stem-based virtual-copy heuristic when each variant comes
    from a different processed source file (e.g. one variant from .rw2,
    another from a Topaz .tif, a third from a DxO .dng — all in the same
    scenario folder). Two value forms per variant title:

      "Topaz Photo": "scene-Edit.tif"
        # string form: source filename. copy_name implicitly None.

      "Lightroom Denoise": {"source": "scene.rw2", "copy": "Copy 1"}
        # object form: explicit (source, copy) override.

    When `variant_sources` has no entry for `title`, falls back to the
    standard JPEG-stem virtual-copy resolution against `master_stems`.
    """
    spec = variant_sources.get(title) if variant_sources else None
    if isinstance(spec, str):
        return spec, None
    if isinstance(spec, dict):
        source = spec.get("source")
        if not source:
            raise ValueError(
                f"variant_sources[{title!r}] requires a 'source' key"
            )
        return source, spec.get("copy")
    if spec is not None:
        raise ValueError(
            f"variant_sources[{title!r}] must be a string or "
            f"{{source, copy}} object, got {type(spec).__name__}"
        )
    return resolve_source(jpeg_stem, master_stems)


def read_xmp(im: Image.Image, jpeg_path: Path) -> tuple[str, str]:
    """Return (dc:title, dc:description) from a Pillow-opened JPEG.

    Pulls the XMP packet out of `im.info` (Pillow 9.1+), parses with defusedxml.
    Returns empty strings if XMP is absent. Logs a WARN and returns empties on
    a parse error rather than crashing the build.
    """
    xmp_bytes = im.info.get("xmp") or im.info.get("XML:com.adobe.xmp")
    if not xmp_bytes:
        return "", ""
    try:
        if isinstance(xmp_bytes, bytes):
            xmp_str = xmp_bytes.decode("utf-8", errors="replace")
        else:
            xmp_str = xmp_bytes
        root = ET.fromstring(xmp_str)
    except ET.ParseError as e:
        print(
            f"  WARN  unparseable XMP in {jpeg_path.name}: {e}", file=sys.stderr
        )
        return "", ""

    rdf_desc = f"{{{XMP_NS['rdf']}}}Description"
    rdf_li = f".//{{{XMP_NS['rdf']}}}li"
    dc_ns = f"{{{XMP_NS['dc']}}}"

    def first_text(tag: str) -> str:
        for desc in root.iter(rdf_desc):
            element = desc.find(f"{dc_ns}{tag}")
            if element is None:
                continue
            # rdf:Alt > rdf:li > text  (typical XMP pattern)
            li = element.find(rdf_li)
            if li is not None and li.text:
                return li.text.strip()
            if element.text and element.text.strip():
                return element.text.strip()
        return ""

    return first_text("title"), first_text("description")


def load_critique(darwain_path: Path, copy_name: str | None) -> Critique | None:
    """Pull the most recent matching analysis out of a darwain JSON sidecar.

    Returns None when the sidecar is missing, malformed, or has no entry whose
    `copy_name` matches `copy_name` (None for a master, "Copy N" for the Nth
    virtual copy). A corrupt sidecar logs a WARN and degrades to `null`
    critique rather than aborting the scenario build — AI critiques are
    optional metadata.
    """
    if not darwain_path.exists():
        return None
    try:
        data = json.loads(darwain_path.read_text())
        analyses = data.get("analyses") or []
        matching = [
            a
            for a in analyses
            if isinstance(a, dict) and a.get("copy_name") == copy_name
        ]
    except (json.JSONDecodeError, OSError) as e:
        print(
            f"  WARN  unreadable critique {darwain_path.name}: {e}",
            file=sys.stderr,
        )
        return None
    if not matching:
        return None
    latest = max(matching, key=lambda a: a.get("timestamp") or "")
    text = latest.get("critique_text") or ""
    if not text:
        return None
    return Critique(
        text=text,
        potential_score=latest.get("potential_score"),
        model=(latest.get("request") or {}).get("model"),
    )


def needs_rebuild(
    src: Path, dst: Path, force: bool, manifest_mtime: float = 0.0
) -> bool:
    """Rebuild if the destination is missing, the source is newer, or the
    scenario manifest is newer (so manifest-only edits — e.g. tweaking the
    detail-crop rectangle — invalidate dependent outputs even when the source
    JPEG hasn't changed)."""
    if force or not dst.exists():
        return True
    dst_mtime = dst.stat().st_mtime
    return src.stat().st_mtime > dst_mtime or manifest_mtime > dst_mtime


def save_display(im: Image.Image, dst: Path, icc: bytes | None) -> None:
    """Re-encode the open Pillow image as a progressive, optimised JPEG.

    Keeps the ICC profile (so sRGB tagging survives). Drops everything else —
    EXIF / XMP / IPTC blocks aren't read by the site, and we already extracted
    title/caption upstream.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    kwargs: dict = {
        "quality": JPEG_QUALITY_DISPLAY,
        "optimize": True,
        "progressive": True,
    }
    if icc:
        kwargs["icc_profile"] = icc
    im.save(dst, "JPEG", **kwargs)


def save_diagnostic_crop(
    im: Image.Image,
    crop: dict,
    variant_scale: int,
    dst: Path,
    icc: bytes | None,
) -> None:
    """Render the per-variant detail crop at 200% pixel zoom (variant native).

    INVARIANT: `crop` is in baseline (1×) source coordinates always.
      - x, y    centre of the diagnostic region (scene coordinates × 1)
      - w, h    size of the cropped region in baseline source pixels

    For every variant, the crop is centred at (x × scale, y × scale) — same
    SCENE point, scaled to the variant's pixel space — and sized exactly
    (w × h) variant pixels (NO × scale on the dimensions). Then nearest-
    neighbour upscaled 2× to (2w × 2h) for the output JPEG.

    Effect across variants of the same scenario:
      - 1× variant: shows w × h of baseline source pixels (the whole crop
        region) at 200% pixel zoom. Original behaviour.
      - 2× variant: shows w × h of the 2× variant's pixels — same screen
        area as the 1× card, but covering 1/4 the scene area, displaying
        the upsampler's actual pixels at 200% zoom.
      - 4× variant: same screen area, 1/16 the scene area, 4× variant's
        actual pixels at 200% zoom.

    Trade-off: cards no longer share a scene region. The lightbox is where
    cross-variant scene-region comparison happens; the diagnostic card is
    "look at this tool's output for this spot at native scale".

    Nearest-neighbour resampling matches Lightroom / Photoshop's "200% zoom"
    rendering (each source pixel = 2×2 device pixels block, no smoothing) —
    visceral pixel grid, no resampling artefacts confused with AI output.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    cx_b, cy_b, w_b, h_b = crop["x"], crop["y"], crop["w"], crop["h"]
    cx = cx_b * variant_scale
    cy = cy_b * variant_scale
    ix = cx - w_b // 2
    iy = cy - h_b // 2
    inner = im.crop((ix, iy, ix + w_b, iy + h_b))
    resampled = inner.resize((w_b * 2, h_b * 2), Image.Resampling.NEAREST)
    kwargs: dict = {"quality": JPEG_QUALITY_CROP, "optimize": True}
    if icc:
        kwargs["icc_profile"] = icc
    resampled.save(dst, "JPEG", **kwargs)


def save_thumbnail(im: Image.Image, dst: Path, icc: bytes | None) -> None:
    """Resize the open image to THUMBNAIL_WIDTH wide (proportional height) and
    save as a small JPEG for the gallery card."""
    _save_resized(im, dst, THUMBNAIL_WIDTH, quality=85, icc=icc)


def save_hero(im: Image.Image, dst: Path, icc: bytes | None) -> None:
    """Resize the chosen hero variant to HERO_WIDTH wide (proportional height)
    and save as a progressive JPEG for the scenario page header.

    The hero gives scene context above the variant cards. It is the LCP
    element for the page; ~1600 px wide @ q90 lands around 300-500 KB and
    looks crisp on retina up to ~800 CSS pixels."""
    _save_resized(
        im, dst, HERO_WIDTH, quality=JPEG_QUALITY_HERO, icc=icc, progressive=True
    )


def _save_resized(
    im: Image.Image,
    dst: Path,
    width: int,
    quality: int,
    icc: bytes | None,
    progressive: bool = False,
) -> None:
    """Shared core: LANCZOS-downscale to `width` px wide (never upscale), save."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if im.width <= width:
        # Source narrower than target — copy intrinsic dims, no upscale.
        resized = im.copy()
    else:
        h = round(im.height * width / im.width)
        resized = im.resize((width, h), Image.Resampling.LANCZOS)
    kwargs: dict = {"quality": quality, "optimize": True}
    if progressive:
        kwargs["progressive"] = True
    if icc:
        kwargs["icc_profile"] = icc
    resized.save(dst, "JPEG", **kwargs)


VALID_VARIANT_SORTS = ("manual", "rating_desc", "rating_desc_baseline_first")


def order_variants(
    variants: list[Variant],
    image_order: list[str] | None,
    variant_sort: str = "manual",
) -> list[Variant]:
    """Order variants for a scenario.

    Modes:
      - "manual" (default): use `image_order` as a list of titles in display
        order; titles missing or extra produce WARNs and are appended at end.
        Without `image_order`, falls back to alphabetical-by-title.
      - "rating_desc": sort by darwain potential_score descending. Variants
        with no critique drop to the end. Ties break on image_order position
        (if provided) then alphabetical title.
      - "rating_desc_baseline_first": pin the first entry of `image_order`
        (the "before" baseline, e.g. RAW) at the top regardless of its
        score, then sort the remaining variants by rating_desc rules.
    """
    if variant_sort not in VALID_VARIANT_SORTS:
        raise ValueError(
            f"unknown variant_sort {variant_sort!r}; "
            f"expected one of {VALID_VARIANT_SORTS}"
        )

    if variant_sort == "manual":
        return _order_manual(variants, image_order)

    title_pos = {t: i for i, t in enumerate(image_order or [])}

    def rating_key(v: Variant) -> tuple:
        score = v.critique.potential_score if v.critique else None
        if not isinstance(score, int):
            score = None
        return (
            0 if score is not None else 1,        # rated variants first
            -score if score is not None else 0,   # higher score first
            title_pos.get(v.title, 1_000_000),    # then image_order position
            v.title.lower(),                      # then alphabetical
        )

    if variant_sort == "rating_desc":
        return sorted(variants, key=rating_key)

    # rating_desc_baseline_first
    if not image_order:
        raise ValueError(
            "variant_sort 'rating_desc_baseline_first' requires image_order "
            "(its first element identifies the baseline to pin at the top)"
        )
    baseline_title = image_order[0]
    baseline = next((v for v in variants if v.title == baseline_title), None)
    if baseline is None:
        raise ValueError(
            f"variant_sort baseline {baseline_title!r} (image_order[0]) "
            "not found among variants"
        )
    rest = [v for v in variants if v.title != baseline_title]
    return [baseline] + sorted(rest, key=rating_key)


def _order_manual(
    variants: list[Variant], image_order: list[str] | None
) -> list[Variant]:
    if not image_order:
        return sorted(variants, key=lambda v: v.title.lower())
    by_title = {v.title: v for v in variants}
    ordered: list[Variant] = []
    seen: set[str] = set()
    for title in image_order:
        v = by_title.get(title)
        if v is None:
            print(
                f"  WARN  image_order references unknown title {title!r}",
                file=sys.stderr,
            )
            continue
        ordered.append(v)
        seen.add(title)
    leftover = [v for v in variants if v.title not in seen]
    if leftover:
        print(
            f"  WARN  variants not in image_order: {[v.title for v in leftover]!r} "
            f"(appended at end)",
            file=sys.stderr,
        )
        ordered.extend(sorted(leftover, key=lambda v: v.title.lower()))
    return ordered


def build_scenario(
    scenario_dir: Path,
    manifest: dict,
    manifest_mtime: float,
    repo_root: Path,
    project: ProjectConfig,
    force: bool,
) -> PageData:
    slug = validate_slug(manifest["slug"], "manifest.slug")
    images_out = repo_root / project.slug / "images" / slug
    # Belt-and-braces: ensure the output dir really resolves under the repo
    # root, even though `validate_slug` already restricts the character set.
    if not images_out.resolve().is_relative_to(repo_root.resolve()):
        raise ValueError(f"output path {images_out} escapes repo root {repo_root}")
    images_out.mkdir(parents=True, exist_ok=True)

    jpeg_dir = scenario_dir / "jpeg"
    if not jpeg_dir.is_dir():
        raise FileNotFoundError(f"no jpeg/ subfolder in {scenario_dir}")
    jpegs = sorted(p for p in jpeg_dir.glob("*.jpg") if not p.name.startswith("."))
    if not jpegs:
        raise FileNotFoundError(f"no JPEGs in {jpeg_dir}")

    # Pre-pass: header-only read of every JPEG's intrinsic dimensions. Cheap
    # (Image.open with no .load() reads only the SOI/SOF markers) but tells
    # us the baseline width before we start writing crops, which need each
    # variant's per-source-pixel scale factor.
    variant_dims: dict[Path, tuple[int, int]] = {}
    for jp in jpegs:
        with Image.open(jp) as probe:
            variant_dims[jp] = probe.size
    baseline_w = min(w for (w, _h) in variant_dims.values())
    variant_scales: dict[Path, int] = {
        jp: max(1, round(w / baseline_w)) for jp, (w, _h) in variant_dims.items()
    }
    if any(s != 1 for s in variant_scales.values()):
        # Only log when this is actually an upsizing scenario — keeps the
        # noise-sharpening build output tidy.
        scale_summary = ", ".join(
            f"{jp.name}={variant_scales[jp]}×" for jp in jpegs
        )
        print(f"      baseline_w={baseline_w}px, scales: {scale_summary}")

    crop = manifest["detail_crop"]
    master_stems = find_master_stems(scenario_dir)
    variant_sources = manifest.get("variant_sources") or {}
    if not isinstance(variant_sources, dict):
        raise ValueError(
            f"manifest.variant_sources must be an object, got "
            f"{type(variant_sources).__name__}"
        )
    hero_title = manifest.get("hero_image")
    out_thumbnail = images_out / "thumbnail.jpg"
    out_hero = images_out / "hero.jpg"

    variants: list[Variant] = []
    seen_slugs: set[str] = set()
    image_dimensions: dict | None = None
    hero_jpeg_path: Path | None = None
    hero_variant_slug: str | None = None
    fallback_thumb_handled = False

    for jpeg_path in jpegs:
        variant_scale = variant_scales[jpeg_path]
        # Single open per variant. Read XMP + dims, then conditionally write
        # all derivative outputs from the same in-memory image.
        with Image.open(jpeg_path) as im:
            title, caption = read_xmp(im, jpeg_path)
            if not title:
                raise ValueError(f"no dc:title in XMP for {jpeg_path}")
            dims = (im.width, im.height)
            icc = im.info.get("icc_profile")

            variant_slug = slugify(title)
            if variant_slug in seen_slugs:
                raise ValueError(
                    f"slug collision: title {title!r} -> {variant_slug!r} already used"
                )
            seen_slugs.add(variant_slug)

            # `image_dimensions` reflects the BASELINE (1× / smallest) variant.
            # The frontend uses this for `--variant-aspect` CSS reservation;
            # all variants share the same aspect ratio (modulo upsamper
            # rounding noise), so any baseline-scale variant's dims work.
            if image_dimensions is None and variant_scale == 1:
                image_dimensions = {"width": dims[0], "height": dims[1]}

            try:
                master_filename, copy_name = resolve_critique_source(
                    jpeg_path.stem, title, variant_sources, master_stems
                )
            except FileNotFoundError as e:
                raise FileNotFoundError(f"{e} in {scenario_dir}") from e
            critique = load_critique(
                scenario_dir / f"{master_filename}.darwain.json", copy_name
            )

            out_display = images_out / f"{variant_slug}.jpg"
            out_crop = images_out / f"{variant_slug}-crop.jpg"

            if needs_rebuild(jpeg_path, out_display, force, manifest_mtime):
                save_display(im, out_display, icc)

            if needs_rebuild(jpeg_path, out_crop, force, manifest_mtime):
                # Validate the crop rectangle against actual dimensions before
                # we touch the crop output. detail_crop centre is scaled to
                # variant pixel space; size stays (w_b × h_b) variant pixels
                # (200%-zoom-of-variant semantics — see save_diagnostic_crop).
                cx_b, cy_b, cw_b, ch_b = crop["x"], crop["y"], crop["w"], crop["h"]
                if cw_b < 2 or ch_b < 2:
                    raise ValueError(
                        f"detail_crop {crop} too small (need w,h >= 2)"
                    )
                cx = cx_b * variant_scale
                cy = cy_b * variant_scale
                left = cx - cw_b // 2
                top = cy - ch_b // 2
                if left < 0 or top < 0 or left + cw_b > im.width or top + ch_b > im.height:
                    raise ValueError(
                        f"detail_crop centre=({cx_b},{cy_b}) × scale {variant_scale} "
                        f"= ({cx},{cy}) with size={cw_b}x{ch_b} extends outside "
                        f"{jpeg_path.name} ({im.width}x{im.height}); region would be "
                        f"({left},{top})..({left + cw_b},{top + ch_b})"
                    )
                save_diagnostic_crop(im, crop, variant_scale, out_crop, icc)

            # If this variant is the configured hero, write its thumbnail and
            # downscaled hero JPEG now — saves extra Image.open passes after.
            if title == hero_title:
                hero_jpeg_path = jpeg_path
                hero_variant_slug = variant_slug
                if needs_rebuild(jpeg_path, out_thumbnail, force, manifest_mtime):
                    save_thumbnail(im, out_thumbnail, icc)
                if needs_rebuild(jpeg_path, out_hero, force, manifest_mtime):
                    save_hero(im, out_hero, icc)

            # If hero was missing or didn't match, write a fallback thumbnail
            # from the very first variant rather than re-opening it later. No
            # fallback for the hero — page-data.hero stays null and the
            # frontend renders without one.
            if (
                hero_title is None or hero_jpeg_path is None
            ) and not fallback_thumb_handled and jpeg_path == jpegs[0]:
                fallback_thumb_handled = True
                if needs_rebuild(jpeg_path, out_thumbnail, force, manifest_mtime):
                    save_thumbnail(im, out_thumbnail, icc)

        rel_dir = f"images/{slug}"
        variants.append(
            Variant(
                slug=variant_slug,
                title=title,
                caption=caption,
                width=dims[0],
                height=dims[1],
                display=f"{rel_dir}/{out_display.name}",
                crop=f"{rel_dir}/{out_crop.name}",
                critique=critique,
            )
        )

    unused_overrides = set(variant_sources.keys()) - {v.title for v in variants}
    if unused_overrides:
        print(
            f"  WARN  variant_sources references unknown titles: "
            f"{sorted(unused_overrides)} (variants found: "
            f"{sorted(v.title for v in variants)})",
            file=sys.stderr,
        )

    if hero_title is not None and hero_jpeg_path is None:
        # Misconfigured hero — emit a WARN. Fallback thumbnail was already
        # saved from the first variant; no hero is rendered on the page.
        print(
            f"  WARN  hero_image {hero_title!r} not found among variants; "
            f"using {jpegs[0].name} for thumbnail and skipping page hero",
            file=sys.stderr,
        )

    variants = order_variants(
        variants,
        manifest.get("image_order"),
        manifest.get("variant_sort", "manual"),
    )

    return PageData(
        slug=slug,
        title=manifest["title"],
        subtitle=manifest.get("subtitle", ""),
        image_dimensions=image_dimensions or {},
        detail_crop=crop,
        hero=f"images/{slug}/hero.jpg" if hero_jpeg_path else None,
        hero_slug=hero_variant_slug,
        editor_note=manifest.get("editor_note") or None,
        images=[asdict(v) for v in variants],
    )


def write_page_data(
    page_data: PageData, repo_root: Path, project: ProjectConfig
) -> None:
    out = (
        repo_root
        / project.slug
        / "data"
        / page_data.slug
        / "page-data.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(asdict(page_data), indent=2, ensure_ascii=False) + "\n"
    )


def write_scenarios_index(
    entries: list[ScenarioIndexEntry], repo_root: Path, project: ProjectConfig
) -> None:
    out = repo_root / project.slug / "data" / "scenarios.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    # Tie-break on slug so order is deterministic when sort_orders collide.
    payload = [
        asdict(e) for e in sorted(entries, key=lambda x: (x.sort_order, x.slug))
    ]
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def build(
    source_root: Path,
    repo_root: Path,
    project: ProjectConfig,
    scenario_filter: str | None,
    force: bool,
) -> int:
    scenarios: list[tuple[dict, PageData]] = []
    failures = 0
    for scenario_dir in sorted(source_root.iterdir()):
        if not scenario_dir.is_dir():
            continue
        manifest_path = scenario_dir / "manifest.json"
        if not manifest_path.exists():
            print(f"SKIP  {scenario_dir.name}: no manifest.json")
            continue
        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as e:
            print(
                f"FAIL  {scenario_dir.name}: invalid manifest.json: {e}",
                file=sys.stderr,
            )
            failures += 1
            continue
        if scenario_filter and manifest.get("slug") != scenario_filter:
            continue
        manifest_mtime = manifest_path.stat().st_mtime
        print(f"BUILD {manifest['slug']:30s} ({scenario_dir.name})")
        try:
            page_data = build_scenario(
                scenario_dir, manifest, manifest_mtime, repo_root, project, force
            )
        except Exception as e:
            print(
                f"FAIL  {manifest.get('slug', scenario_dir.name)}: {e}",
                file=sys.stderr,
            )
            failures += 1
            continue
        scenarios.append((manifest, page_data))

    # Sort by manifest.sort_order (slug as tie-breaker) and link prev/next
    # before writing each page-data exactly once.
    sorted_scenarios = sorted(
        scenarios, key=lambda x: (x[0].get("sort_order", 0), x[1].slug)
    )
    for i, (_, page_data) in enumerate(sorted_scenarios):
        page_data.previous_scenario = (
            sorted_scenarios[i - 1][1].slug if i > 0 else None
        )
        page_data.next_scenario = (
            sorted_scenarios[i + 1][1].slug
            if i < len(sorted_scenarios) - 1
            else None
        )
        write_page_data(page_data, repo_root, project)

    entries = [
        ScenarioIndexEntry(
            slug=page_data.slug,
            title=page_data.title,
            subtitle=page_data.subtitle,
            thumbnail=f"images/{page_data.slug}/thumbnail.jpg",
            variant_count=len(page_data.images),
            sort_order=manifest.get("sort_order", 0),
        )
        for manifest, page_data in sorted_scenarios
    ]
    write_scenarios_index(entries, repo_root, project)
    print(f"\nDONE  {project.slug}: {len(entries)} scenarios, {failures} failures")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project",
        required=True,
        choices=sorted(PROJECTS.keys()),
        help="which sub-project to build (routes output to {out}/{project}/...)",
    )
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help="root folder of scenario directories",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="repo root (where the {project}/ sub-folder lives)",
    )
    parser.add_argument(
        "--scenario", help="only rebuild a single scenario (matches manifest.slug)"
    )
    parser.add_argument(
        "--force", action="store_true", help="rebuild even if outputs are up to date"
    )
    args = parser.parse_args()

    if not args.source.is_dir():
        print(f"source folder not found: {args.source}", file=sys.stderr)
        return 2
    if not args.out.is_dir():
        print(f"out folder not found: {args.out}", file=sys.stderr)
        return 2

    project = PROJECTS[args.project]
    return build(args.source, args.out, project, args.scenario, args.force)


if __name__ == "__main__":
    sys.exit(main())

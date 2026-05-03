#!/usr/bin/env python3
"""Build the noise-sharpening sub-project from a source folder of Lightroom-exported JPEGs.

Reads each scenario folder under SOURCE, expects:

    {Scenario}/
        manifest.json                       (scenario-level metadata, authored by Peter)
        jpeg/*.jpg                          (Lightroom exports — title/caption in XMP)
        {original}.{orf,tif,dng}            (source files; never read directly)
        {original}.{ext}.darwain.json       (AI critique sidecars)

For each JPEG under jpeg/:
  - reads dc:title and dc:description from XMP
  - derives a URL slug from the title (slugify)
  - maps filename -> (master source file, copy_name) using LR virtual-copy naming
  - loads matching darwain analysis (filtered by copy_name, latest by timestamp)
  - writes a re-encoded display JPEG + a 200% nearest-upscaled detail crop

The hero variant (manifest.hero_image) additionally yields hero.jpg (a
HERO_WIDTH-wide downscaled JPEG used at the top of the scenario page) and
thumbnail.jpg (smaller still, for the gallery card).

Writes per-scenario noise-sharpening/data/{slug}/page-data.json plus a top-level
noise-sharpening/data/scenarios.json index for the gallery page.

The image is opened exactly once per variant — XMP, dimensions, and all derivative
outputs come out of a single `Image.open` context.
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
SOURCE_EXTS = (".orf", ".tif", ".tiff", ".dng")

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
    display: str
    crop_200: str
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
    """Index every {orf,tif,dng} source file in the scenario folder by its stem."""
    stems: dict[str, Path] = {}
    for ext in SOURCE_EXTS:
        for p in scenario_dir.glob(f"*{ext}"):
            if p.name.startswith("."):
                continue
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


def save_crop_200(
    im: Image.Image,
    crop: dict,
    dst: Path,
    icc: bytes | None,
) -> None:
    """Render the 200% detail crop and save it.

    `crop` carries (x, y) as the CENTRE of the diagnostic region and
    (w, h) as the SOURCE region size in source pixels. The build script
    pulls a (w × h) region centred on (x, y), nearest-upscales 2× to
    (2w × 2h), and saves the JPEG. Each source pixel becomes a 2×2 block
    — the honest "200% zoom" look that photo apps render natively.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    cx, cy, w, h = crop["x"], crop["y"], crop["w"], crop["h"]
    ix = cx - w // 2
    iy = cy - h // 2
    inner = im.crop((ix, iy, ix + w, iy + h))
    cropped = inner.resize((w * 2, h * 2), Image.Resampling.NEAREST)
    kwargs: dict = {"quality": JPEG_QUALITY_CROP, "optimize": True}
    if icc:
        kwargs["icc_profile"] = icc
    cropped.save(dst, "JPEG", **kwargs)


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


def order_variants(
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
    force: bool,
) -> PageData:
    slug = validate_slug(manifest["slug"], "manifest.slug")
    images_out = repo_root / "noise-sharpening" / "images" / slug
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

    crop = manifest["detail_crop"]
    master_stems = find_master_stems(scenario_dir)
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

            if image_dimensions is None:
                image_dimensions = {"width": dims[0], "height": dims[1]}
            elif (image_dimensions["width"], image_dimensions["height"]) != dims:
                raise ValueError(
                    f"{jpeg_path.name} is {dims[0]}x{dims[1]}, but scenario expects "
                    f"{image_dimensions['width']}x{image_dimensions['height']} "
                    f"(every variant in a scenario must share dimensions)"
                )

            try:
                master_filename, copy_name = resolve_source(
                    jpeg_path.stem, master_stems
                )
            except FileNotFoundError as e:
                raise FileNotFoundError(f"{e} in {scenario_dir}") from e
            critique = load_critique(
                scenario_dir / f"{master_filename}.darwain.json", copy_name
            )

            out_display = images_out / f"{variant_slug}.jpg"
            out_crop_200 = images_out / f"{variant_slug}-crop-200.jpg"

            if needs_rebuild(jpeg_path, out_display, force, manifest_mtime):
                save_display(im, out_display, icc)

            if needs_rebuild(jpeg_path, out_crop_200, force, manifest_mtime):
                # Validate the crop rectangle against actual dimensions before
                # we touch the crop output. (cx, cy) is the centre of the
                # diagnostic region in source pixels; (cw, ch) is the SOURCE
                # region size (not the rendered output, which is 2× each axis).
                cx, cy, cw, ch = crop["x"], crop["y"], crop["w"], crop["h"]
                if cw < 2 or ch < 2:
                    raise ValueError(
                        f"detail_crop {crop} too small (need w,h >= 2)"
                    )
                left = cx - cw // 2
                top = cy - ch // 2
                if left < 0 or top < 0 or left + cw > im.width or top + ch > im.height:
                    raise ValueError(
                        f"detail_crop center=({cx},{cy}) size={cw}x{ch} extends "
                        f"outside {jpeg_path.name} ({im.width}x{im.height}); "
                        f"source region would be ({left},{top})..({left + cw},{top + ch})"
                    )
                save_crop_200(im, crop, out_crop_200, icc)

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
                display=f"{rel_dir}/{out_display.name}",
                crop_200=f"{rel_dir}/{out_crop_200.name}",
                critique=critique,
            )
        )

    if hero_title is not None and hero_jpeg_path is None:
        # Misconfigured hero — emit a WARN. Fallback thumbnail was already
        # saved from the first variant; no hero is rendered on the page.
        print(
            f"  WARN  hero_image {hero_title!r} not found among variants; "
            f"using {jpegs[0].name} for thumbnail and skipping page hero",
            file=sys.stderr,
        )

    variants = order_variants(variants, manifest.get("image_order"))

    return PageData(
        slug=slug,
        title=manifest["title"],
        subtitle=manifest.get("subtitle", ""),
        image_dimensions=image_dimensions or {},
        detail_crop=crop,
        hero=f"images/{slug}/hero.jpg" if hero_jpeg_path else None,
        hero_slug=hero_variant_slug,
        images=[asdict(v) for v in variants],
    )


def write_page_data(page_data: PageData, repo_root: Path) -> None:
    out = (
        repo_root
        / "noise-sharpening"
        / "data"
        / page_data.slug
        / "page-data.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(asdict(page_data), indent=2, ensure_ascii=False) + "\n"
    )


def write_scenarios_index(
    entries: list[ScenarioIndexEntry], repo_root: Path
) -> None:
    out = repo_root / "noise-sharpening" / "data" / "scenarios.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    # Tie-break on slug so order is deterministic when sort_orders collide.
    payload = [
        asdict(e) for e in sorted(entries, key=lambda x: (x.sort_order, x.slug))
    ]
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def build(
    source_root: Path,
    repo_root: Path,
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
                scenario_dir, manifest, manifest_mtime, repo_root, force
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
        write_page_data(page_data, repo_root)

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
    write_scenarios_index(entries, repo_root)
    print(f"\nDONE  {len(entries)} scenarios, {failures} failures")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path.home() / "Pictures" / "MHWPC-training-noise-sharpening",
        help="root folder of scenario directories",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="repo root (where noise-sharpening/ lives)",
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

    return build(args.source, args.out, args.scenario, args.force)


if __name__ == "__main__":
    sys.exit(main())

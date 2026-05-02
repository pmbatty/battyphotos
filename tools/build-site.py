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
  - copies the display JPEG into noise-sharpening/images/{scenario-slug}/{slug}.jpg
  - writes 100% and 200% detail crops alongside it

Writes per-scenario noise-sharpening/data/{slug}/page-data.json plus a top-level
noise-sharpening/data/scenarios.json index for the gallery page.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

from defusedxml import ElementTree as ET
from PIL import Image

XMP_NS = {
    "x": "adobe:ns:meta/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "dc": "http://purl.org/dc/elements/1.1/",
}
SOURCE_EXTS = (".orf", ".tif", ".tiff", ".dng")
JPEG_QUALITY_DISPLAY = 92  # only used when re-encoding crops
THUMBNAIL_WIDTH = 600


@dataclass
class Critique:
    text: str
    potential_score: Optional[int]
    model: Optional[str]
    darwain_version: Optional[str]
    timestamp: Optional[str]


@dataclass
class Variant:
    slug: str
    title: str
    caption: str
    display: str
    crop_100: str
    crop_200: str
    critique: Optional[Critique] = None


@dataclass
class PageData:
    slug: str
    title: str
    subtitle: str
    image_dimensions: dict
    detail_crop: dict
    previous_scenario: Optional[str] = None
    next_scenario: Optional[str] = None
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
    """Lowercase, ascii-normalize, dash-separate."""
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    if not value:
        raise ValueError("slug is empty")
    return value


def read_xmp(jpeg_path: Path) -> tuple[str, str]:
    """Return (title, description) from JPEG XMP. Empty strings if absent."""
    data = jpeg_path.read_bytes()
    match = re.search(rb"<x:xmpmeta\b.*?</x:xmpmeta>", data, re.DOTALL)
    if not match:
        return "", ""
    root = ET.fromstring(match.group(0).decode("utf-8", errors="replace"))

    def first_text(tag: str) -> str:
        # Look in any rdf:Description for the dc tag.
        for desc in root.iter(f"{{{XMP_NS['rdf']}}}Description"):
            element = desc.find(f"{{{XMP_NS['dc']}}}{tag}")
            if element is None:
                continue
            # rdf:Alt > rdf:li > text  (typical XMP pattern)
            li = element.find(f".//{{{XMP_NS['rdf']}}}li")
            if li is not None and li.text:
                return li.text.strip()
            if element.text and element.text.strip():
                return element.text.strip()
        return ""

    return first_text("title"), first_text("description")


def resolve_source(jpeg_name: str, scenario_dir: Path, jpeg_dir: Path) -> tuple[str, Optional[str]]:
    """Map a JPEG filename to (master source filename, copy_name).

    Disambiguation: a JPEG is a Lightroom virtual copy IFF its full stem has no
    corresponding source file (.orf/.tif/.dng) but the stripped base does. So:

      `Q1013570.jpg`         -> source `Q1013570.orf` exists           -> master, None
      `Q1013570-Edit-2.jpg`  -> source `Q1013570-Edit-2.tif` exists    -> master, None
      `Q1013570-2.jpg`       -> source `Q1013570-2.*` does NOT exist;
                                source `Q1013570.orf` does             -> Copy 1
    """
    stem = Path(jpeg_name).stem
    # First: prefer a direct source-file match on the JPEG's own stem.
    direct = _find_source_with_stem(scenario_dir, stem)
    if direct is not None:
        return direct.name, None

    # No direct match — try virtual-copy interpretation: trailing -N (N>=2) -> Copy {N-1}
    vc_match = re.match(r"^(?P<base>.+)-(?P<n>\d+)$", stem)
    if vc_match:
        n = int(vc_match.group("n"))
        if n >= 2:
            base = vc_match.group("base")
            master_source = _find_source_with_stem(scenario_dir, base)
            if master_source is not None:
                return master_source.name, f"Copy {n - 1}"

    raise FileNotFoundError(
        f"No source file matching {stem}.{{orf,tif,dng}} in {scenario_dir} "
        f"and JPEG name doesn't fit the LR virtual-copy pattern"
    )


def _find_source_with_stem(scenario_dir: Path, stem: str) -> Optional[Path]:
    for ext in SOURCE_EXTS:
        candidate = scenario_dir / f"{stem}{ext}"
        if candidate.exists():
            return candidate
    return None


def load_critique(darwain_path: Path, copy_name: Optional[str]) -> Optional[Critique]:
    if not darwain_path.exists():
        return None
    data = json.loads(darwain_path.read_text())
    matching = [
        a for a in data.get("analyses", []) if a.get("copy_name") == copy_name
    ]
    if not matching:
        return None
    latest = max(matching, key=lambda a: a.get("timestamp", ""))
    text = latest.get("critique_text") or ""
    if not text:
        return None
    return Critique(
        text=text,
        potential_score=latest.get("potential_score"),
        model=(latest.get("request") or {}).get("model"),
        darwain_version=latest.get("darwain_version"),
        timestamp=latest.get("timestamp"),
    )


def needs_rebuild(src: Path, dst: Path, force: bool) -> bool:
    if force or not dst.exists():
        return True
    return src.stat().st_mtime > dst.stat().st_mtime


def copy_display_jpeg(src: Path, dst: Path, force: bool) -> None:
    if not needs_rebuild(src, dst, force):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def write_crop(
    src: Path, crop: dict, dst: Path, upscale: int, force: bool
) -> None:
    if not needs_rebuild(src, dst, force):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        x, y, w, h = crop["x"], crop["y"], crop["w"], crop["h"]
        x2, y2 = x + w, y + h
        if x2 > im.width or y2 > im.height or x < 0 or y < 0:
            raise ValueError(
                f"detail_crop {crop} falls outside {src.name} ({im.width}x{im.height})"
            )
        cropped = im.crop((x, y, x2, y2))
        if upscale != 1:
            cropped = cropped.resize(
                (w * upscale, h * upscale), Image.Resampling.BILINEAR
            )
        # Preserve sRGB ICC profile if present
        icc = im.info.get("icc_profile")
        save_kwargs = {"quality": JPEG_QUALITY_DISPLAY, "optimize": True}
        if icc:
            save_kwargs["icc_profile"] = icc
        cropped.save(dst, "JPEG", **save_kwargs)


def write_thumbnail(src: Path, dst: Path, force: bool) -> None:
    if not needs_rebuild(src, dst, force):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        w = THUMBNAIL_WIDTH
        h = round(im.height * w / im.width)
        thumb = im.resize((w, h), Image.Resampling.LANCZOS)
        icc = im.info.get("icc_profile")
        save_kwargs = {"quality": 85, "optimize": True}
        if icc:
            save_kwargs["icc_profile"] = icc
        thumb.save(dst, "JPEG", **save_kwargs)


def order_variants(variants: list[Variant], image_order: Optional[list[str]]) -> list[Variant]:
    if not image_order:
        return sorted(variants, key=lambda v: v.title.lower())
    by_title = {v.title: v for v in variants}
    ordered: list[Variant] = []
    seen: set[str] = set()
    for title in image_order:
        v = by_title.get(title)
        if v is None:
            print(f"  WARN  image_order references unknown title {title!r}", file=sys.stderr)
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


def build_scenario(scenario_dir: Path, manifest: dict, repo_root: Path, force: bool) -> tuple[PageData, Path]:
    slug = manifest["slug"]
    images_out = repo_root / "noise-sharpening" / "images" / slug
    images_out.mkdir(parents=True, exist_ok=True)

    jpeg_dir = scenario_dir / "jpeg"
    if not jpeg_dir.is_dir():
        raise FileNotFoundError(f"no jpeg/ subfolder in {scenario_dir}")
    jpegs = sorted(p for p in jpeg_dir.glob("*.jpg") if not p.name.startswith("."))
    if not jpegs:
        raise FileNotFoundError(f"no JPEGs in {jpeg_dir}")

    crop = manifest["detail_crop"]
    variants: list[Variant] = []
    seen_slugs: set[str] = set()
    image_dimensions: Optional[dict] = None
    hero_jpeg_path: Optional[Path] = None

    for jpeg_path in jpegs:
        title, caption = read_xmp(jpeg_path)
        if not title:
            raise ValueError(f"no dc:title in XMP for {jpeg_path}")
        variant_slug = slugify(title)
        if variant_slug in seen_slugs:
            raise ValueError(
                f"slug collision: title {title!r} -> {variant_slug!r} already used"
            )
        seen_slugs.add(variant_slug)

        master_filename, copy_name = resolve_source(jpeg_path.name, scenario_dir, jpeg_dir)
        critique = load_critique(scenario_dir / f"{master_filename}.darwain.json", copy_name)

        out_display = images_out / f"{variant_slug}.jpg"
        out_crop_100 = images_out / f"{variant_slug}-crop-100.jpg"
        out_crop_200 = images_out / f"{variant_slug}-crop-200.jpg"
        copy_display_jpeg(jpeg_path, out_display, force)
        write_crop(jpeg_path, crop, out_crop_100, upscale=1, force=force)
        write_crop(jpeg_path, crop, out_crop_200, upscale=2, force=force)

        if image_dimensions is None:
            with Image.open(jpeg_path) as im:
                image_dimensions = {"width": im.width, "height": im.height}

        if title == manifest.get("hero_image"):
            hero_jpeg_path = jpeg_path

        rel_dir = f"images/{slug}"
        variants.append(
            Variant(
                slug=variant_slug,
                title=title,
                caption=caption,
                display=f"{rel_dir}/{out_display.name}",
                crop_100=f"{rel_dir}/{out_crop_100.name}",
                crop_200=f"{rel_dir}/{out_crop_200.name}",
                critique=critique,
            )
        )

    variants = order_variants(variants, manifest.get("image_order"))

    if hero_jpeg_path is None:
        # Fallback: use the first variant's display image as the hero
        first_jpeg = jpegs[0]
        print(
            f"  WARN  hero_image {manifest.get('hero_image')!r} not found; "
            f"using {first_jpeg.name} for thumbnail",
            file=sys.stderr,
        )
        hero_jpeg_path = first_jpeg
    write_thumbnail(hero_jpeg_path, images_out / "thumbnail.jpg", force)

    page_data = PageData(
        slug=slug,
        title=manifest["title"],
        subtitle=manifest.get("subtitle", ""),
        image_dimensions=image_dimensions or {},
        detail_crop=crop,
        images=[],  # populated after dataclass-to-dict below
    )
    page_data.images = [_variant_to_dict(v) for v in variants]
    return page_data, images_out


def _variant_to_dict(v: Variant) -> dict:
    d = asdict(v)
    if v.critique is None:
        d["critique"] = None
    return d


def write_page_data(page_data: PageData, repo_root: Path) -> None:
    out = repo_root / "noise-sharpening" / "data" / page_data.slug / "page-data.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(asdict(page_data), indent=2, ensure_ascii=False) + "\n")


def write_scenarios_index(entries: list[ScenarioIndexEntry], repo_root: Path) -> None:
    out = repo_root / "noise-sharpening" / "data" / "scenarios.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(e) for e in sorted(entries, key=lambda x: x.sort_order)]
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def build(source_root: Path, repo_root: Path, scenario_filter: Optional[str], force: bool) -> int:
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
            print(f"FAIL  {scenario_dir.name}: invalid manifest.json: {e}", file=sys.stderr)
            failures += 1
            continue
        if scenario_filter and manifest.get("slug") != scenario_filter:
            continue
        print(f"BUILD {manifest['slug']:30s} ({scenario_dir.name})")
        try:
            page_data, _ = build_scenario(scenario_dir, manifest, repo_root, force)
        except Exception as e:
            print(f"FAIL  {manifest.get('slug', scenario_dir.name)}: {e}", file=sys.stderr)
            failures += 1
            continue
        write_page_data(page_data, repo_root)
        scenarios.append((manifest, page_data))

    # Sort by manifest.sort_order, compute prev/next links, rewrite page-data
    sorted_scenarios = sorted(scenarios, key=lambda x: x[0].get("sort_order", 0))
    for i, (manifest, page_data) in enumerate(sorted_scenarios):
        page_data.previous_scenario = (
            sorted_scenarios[i - 1][1].slug if i > 0 else None
        )
        page_data.next_scenario = (
            sorted_scenarios[i + 1][1].slug if i < len(sorted_scenarios) - 1 else None
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

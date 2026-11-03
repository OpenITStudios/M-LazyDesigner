"""Render Core: compact real-output diagnostics, never a fabricated QA PASS.

The PNG is produced by Cycles; its low-resolution luminance/alpha statistics
are measured from that SAME file. No screenshot animation, diffusion image,
LLM aesthetic number, or speculative geometry/material changes.
"""
from __future__ import annotations

import json
import math
from array import array
from pathlib import Path

import bpy

from core_assets import PublicationRenderError, require

PREVIEW_STAT_SIDE = 96
EVIDENCE_MAX_SIDE = 384

def make_visual_evidence_png(job: dict) -> dict:
    """Downsample ONLY a fresh copy of the genuine Cycles output.

    Never replace the publication PNG, source texture or scene data.
    The preview is intentionally low-resolution for bounded AI observation.
    """
    rendered = Path(job["output_path"])
    preview = Path(job["preview_path"])
    require(preview.is_absolute() and preview.parent == rendered.parent
            and preview.name == "evidence.png" and not preview.exists(),
            "PUBLICATION_EVIDENCE_PATH_UNSAFE_OR_EXISTS")
    image = bpy.data.images.load(str(rendered), check_existing=False)
    try:
        if tuple(image.size) != (job["width"], job["height"]):
            raise PublicationRenderError("PUBLICATION_EVIDENCE_INPUT_DIMENSIONS_CHANGED")
        factor = min(1.0, EVIDENCE_MAX_SIDE / max(image.size))
        w = max(1, int(image.size[0] * factor))
        h = max(1, int(image.size[1] * factor))
        image.scale(w, h)
        image.filepath_raw = str(preview)
        image.file_format = "PNG"
        image.save()
        require(preview.is_file() and 32 < preview.stat().st_size <= 2_000_000,
                "PUBLICATION_EVIDENCE_PNG_MISSING_OR_TOO_LARGE")
        with preview.open("rb") as file:
            header = file.read(24)
        require(len(header) == 24 and header[:8] == b"\x89PNG\r\n\x1a\n"
                and int.from_bytes(header[16:20], "big") == w
                and int.from_bytes(header[20:24], "big") == h,
                "PUBLICATION_EVIDENCE_PNG_HEADER_INVALID")
        return {
            "dimensions": [w, h],
            "source": "DOWNSAMPLED_FINAL_CYCLES_PNG",
            "artistic_approval": False,
        }
    finally:
        bpy.data.images.remove(image, do_unlink=True)



def _sample_png(job: dict) -> dict:
    filepath = job["output_path"]
    image = bpy.data.images.load(filepath, check_existing=False)
    try:
        actual = tuple(image.size)
        require(actual == (job["width"], job["height"]),
                "PUBLICATION_RENDERED_PNG_DIMENSIONS_MISMATCH")
        # This image datablock is loaded separately from the original model
        # and source atlases. Scale only the disposable copy, not the disk PNG.
        image.scale(PREVIEW_STAT_SIDE, PREVIEW_STAT_SIDE)
        rgba = array("f", [0]) * (PREVIEW_STAT_SIDE * PREVIEW_STAT_SIDE * 4)
        image.pixels.foreach_get(rgba)
        luminances = []
        alphas = []
        for idx in range(0, len(rgba), 4):
            red, green, blue, alpha = rgba[idx:idx + 4]
            require(all(math.isfinite(v) for v in (red, green, blue, alpha)),
                    "PUBLICATION_OUTPUT_PIXEL_NONFINITE")
            alphas.append(alpha)
            if alpha > 0.01:
                luminances.append(0.2126 * red + 0.7152 * green + 0.0722 * blue)
        n = len(luminances)
        require(n > 0, "PUBLICATION_OUTPUT_ALL_TRANSPARENT")
        return {
            "image_dimensions": [job["width"], job["height"]],
            "sampled_pixels": PREVIEW_STAT_SIDE ** 2,
            "visible_samples": n,
            "mean_visible_luminance": round(sum(luminances) / n, 5),
            "high_luminance_fraction": round(sum(v >= 0.98 for v in luminances) / n, 5),
            "near_black_visible_fraction": round(sum(v <= 0.02 for v in luminances) / n, 5),
            "nonopaque_fraction": round(sum(a < 0.99 for a in alphas) / len(alphas), 5),
            "analysis_type": "MEASURED_DOWNSAMPLED_CYCLES_PNG",
            "artistic_quality_score": None,
        }
    finally:
        bpy.data.images.remove(image, do_unlink=True)


def write_render_report(job: dict, asset: dict, camera: dict,
                        lighting: dict, compositor: dict,
                        render_config: dict) -> dict:
    path = Path(job["report_path"])
    target = Path(job["output_path"])
    require(path.is_absolute() and path.suffix.lower() == ".json"
            and path.parent == target.parent and path.name == "report.json",
            "PUBLICATION_REPORT_PATH_OUTSIDE_JOB_DIRECTORY")
    require(not path.exists(), "PUBLICATION_REPORT_ALREADY_EXISTS")
    image = _sample_png(job)
    preview = make_visual_evidence_png(job)
    warnings = []
    # Warn only on overwhelming signals. Dark studio backdrops make average
    # histogram metrics unsuitable for claims about the subject's brightness.
    if image["high_luminance_fraction"] > 0.9:
        warnings.append("OUTPUT_NEARLY_ALL_OVEREXPOSED_VISIBLE_PIXELS")
    if image["near_black_visible_fraction"] > 0.98:
        warnings.append("OUTPUT_NEARLY_ALL_UNDEREXPOSED_VISIBLE_PIXELS")
    result = {
        "schema_version": 1,
        "status": "RENDERED_DIAGNOSTICS_NOT_VISUAL_APPROVAL",
        "asset": asset,
        "camera": camera,
        "lighting": lighting,
        "compositor": compositor,
        "render": render_config,
        "image": image,
        "preview": preview,
        "warnings": warnings,
        "artistic_quality": "NOT_EVALUATED",
        "source_model_edited": False,
    }
    serialized = json.dumps(result, separators=(",", ":"), ensure_ascii=True)
    require(len(serialized.encode("utf8")) <= 64_000,
            "PUBLICATION_RENDER_REPORT_TOO_LARGE")
    with path.open("x", encoding="utf8") as file:
        file.write(serialized)
    return result

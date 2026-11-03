"""LazyDesigner Blender Core — trusted Blender 5.2 Cycles worker entry point.

This script is bundled from source with its fixed sibling modules by the
LazyDesigner plugin. It accepts only a validated JSON job on the command line,
not arbitrary Python supplied by an AI client or imported .blend projects.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

# In Blender --background --python mode sibling modules are not always placed
# on sys.path. Add only this trusted bundled worker directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy

from core_assets import PublicationRenderError, geometry_bounds, geometry_receipt, imported_meshes
from camera_director import configure_camera
from lighting_director import configure_environment_and_lighting
from compositor_director import configure_cycles, configure_compositor, render_cycles_with_fallback
from quality_report import write_render_report


def fail(code: str) -> None:
    print("LAZYDESIGNER_RENDER_ERROR=" + code, file=sys.stderr)
    raise PublicationRenderError(code)


def _range(data: dict, key: str, low: float, high: float) -> None:
    value = data.get(key)
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        fail("PUBLICATION_JOB_FIELD_INVALID:" + key)


def require_job() -> dict:
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1:]) != 1:
        fail("PUBLICATION_JOB_FILE_ARGUMENT_REQUIRED")
    path = Path(sys.argv[sys.argv.index("--") + 1])
    if not path.is_absolute() or not path.is_file() or path.stat().st_size > 256_000:
        fail("PUBLICATION_JOB_FILE_INVALID")
    try:
        job = json.loads(path.read_text(encoding="utf8"))
    except (UnicodeError, ValueError, OSError) as exc:
        fail("PUBLICATION_JOB_JSON_INVALID:" + type(exc).__name__)
    if not isinstance(job, dict) or job.get("schema_version") != 1:
        fail("PUBLICATION_JOB_SCHEMA_VERSION_INVALID")
    for name, suffix in (
        ("glb_path", ".glb"),
        ("output_path", ".png"),
        ("report_path", ".json"),
        ("preview_path", ".png"),
    ):
        value = job.get(name)
        if not isinstance(value, str):
            fail("PUBLICATION_JOB_PATH_INVALID:" + name)
        resolved = Path(value)
        if not resolved.is_absolute() or resolved.suffix.lower() != suffix:
            fail("PUBLICATION_JOB_PATH_INVALID:" + name)
        job[name] = str(resolved)
    if not Path(job["glb_path"]).is_file():
        fail("PUBLICATION_GLB_SOURCE_NOT_FOUND")
    output = Path(job["output_path"])
    report = Path(job["report_path"])
    preview = Path(job["preview_path"])
    if output.exists() or report.exists() or preview.exists():
        fail("PUBLICATION_JOB_WOULD_OVERWRITE_EXISTING_FILE")
    if report.parent != output.parent or report.name != "report.json":
        fail("PUBLICATION_JOB_REPORT_PATH_INVALID")
    if preview.parent != output.parent or preview.name != "evidence.png":
        fail("PUBLICATION_JOB_EVIDENCE_PATH_INVALID")
    width, height = job.get("width"), job.get("height")
    if type(width) is not int or type(height) is not int or not (
        256 <= width <= 4096 and 256 <= height <= 4096
        and width * height <= 12_000_000
    ):
        fail("PUBLICATION_JOB_RESOLUTION_INVALID")
    if job.get("quality") not in ("preview", "publication", "high") or \
        job.get("background") not in ("dark", "light", "transparent"):
        fail("PUBLICATION_JOB_QUALITY_OR_BACKGROUND_INVALID")
    environment = job.get("environment")
    if not isinstance(environment, dict) or environment.get("mode") not in ("studio", "hdri"):
        fail("PUBLICATION_JOB_ENVIRONMENT_INVALID")
    if environment["mode"] == "studio":
        if environment.get("hdri_path") is not None or environment.get("hdri_sha256") is not None:
            fail("PUBLICATION_JOB_STUDIO_WITH_UNDECLARED_HDRI")
    else:
        hdri = environment.get("hdri_path")
        sha = environment.get("hdri_sha256")
        if not isinstance(hdri, str) or not isinstance(sha, str) or len(sha) != 64 or any(
            ch not in "0123456789abcdef" for ch in sha
        ):
            fail("PUBLICATION_JOB_HDRI_SOURCE_PROVENANCE_INVALID")
        selected = Path(hdri)
        output_dir = Path(job["output_path"]).parent
        if not selected.is_absolute() or selected.parent != output_dir or selected.name not in (
            "environment.hdr", "environment.exr"
        ):
            fail("PUBLICATION_JOB_HDRI_OUTSIDE_ISOLATED_DIRECTORY")
    if job.get("device") not in ("cpu", "auto"):
        fail("PUBLICATION_JOB_DEVICE_INVALID")
    if job.get("view_transform") not in ("AgX", "Standard"):
        fail("PUBLICATION_JOB_VIEW_TRANSFORM_INVALID")
    _range(job, "samples", 1, 256)
    _range(job, "noise_threshold", 0.001, 0.1)
    if type(job["samples"]) is not int:
        fail("PUBLICATION_JOB_SAMPLES_NOT_INTEGER")
    for key in ("expected_mesh_count", "expected_material_count"):
        _range(job, key, 1, 10_000)
        if type(job[key]) is not int:
            fail("PUBLICATION_JOB_INVENTORY_NONINTEGER")
    cam = job.get("camera")
    if not isinstance(cam, dict) or cam.get("mode") not in ("auto", "manual") \
        or cam.get("projection") not in ("perspective", "orthographic"):
        fail("PUBLICATION_JOB_CAMERA_INVALID")
    for key, lo, hi in (
        ("yaw_degrees", -180, 180), ("elevation_degrees", -30, 80),
        ("framing_padding", 1.08, 2.2),
    ):
        _range(cam, key, lo, hi)
    look = job.get("look")
    if not isinstance(look, dict):
        fail("PUBLICATION_JOB_LOOK_INVALID")
    for key, lo, hi in (
        ("key", 0.2, 2.5), ("fill", 0, 2), ("rim", 0, 2),
        ("softness", 0.5, 2.5), ("environment", 0, 2),
        ("exposure_ev", -3, 3), ("glow_strength", 0, 0.35),
        ("glow_threshold", 0.5, 20), ("glow_size", 0.1, 0.8),
    ):
        _range(look, key, lo, hi)
    if not isinstance(job.get("materials"), dict) or len(job["materials"]) != job["expected_material_count"]:
        fail("PUBLICATION_JOB_SOURCE_MATERIAL_INVENTORY_INVALID")
    for name, material in job["materials"].items():
        if not isinstance(name, str) or not isinstance(material, dict):
            fail("PUBLICATION_JOB_MATERIAL_RECEIPT_INVALID")
        gltf = material.get("gltf")
        pngs = material.get("import_png_sha256")
        if not isinstance(gltf, dict) or not isinstance(pngs, dict):
            fail("PUBLICATION_JOB_IMPORT_PNG_PROVENANCE_REQUIRED")
        expected_roles = {"base"}
        if gltf.get("metallic_roughness_texture") is True:
            expected_roles.add("mer")
        if gltf.get("normal_texture") is True:
            expected_roles.add("normal")
        if gltf.get("emissive_texture") is True:
            expected_roles.add("emission")
        if set(pngs) != expected_roles:
            fail("PUBLICATION_JOB_IMPORT_PNG_ROLE_INVENTORY_MISMATCH")
        if any(not isinstance(value, str) or len(value) != 64 or
               any(ch not in "0123456789abcdef" for ch in value)
               for value in pngs.values()):
            fail("PUBLICATION_JOB_IMPORT_PNG_SHA_INVALID")
    return job


def main() -> None:
    if tuple(bpy.app.version[:2]) != (5, 2):
        fail("PUBLICATION_BLENDER_VERSION_MUST_BE_5_2")
    job = require_job()
    meshes = imported_meshes(job)
    bounds = geometry_bounds(meshes)
    # Set render dimensions BEFORE camera projection/framing.
    render_settings = configure_cycles(job)
    camera = configure_camera(job, meshes, bounds[2], bounds[3])
    lighting = configure_environment_and_lighting(job, bounds)
    compositor = configure_compositor(job)
    render_cycles_with_fallback(job, render_settings)
    target = Path(job["output_path"])
    if not target.is_file() or target.stat().st_size <= 100:
        fail("PUBLICATION_CYCLES_OUTPUT_MISSING")
    with target.open("rb") as file:
        header = file.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or (
        int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")
    ) != (job["width"], job["height"]):
        fail("PUBLICATION_CYCLES_OUTPUT_HEADER_OR_SIZE_INVALID")
    write_render_report(
        job, geometry_receipt(meshes, bounds), camera,
        lighting, compositor, render_settings
    )
    print("LAZYDESIGNER_RENDER_OUTPUT=" + str(target))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("LAZYDESIGNER_RENDER_ERROR=" + str(exc), file=sys.stderr)
        raise

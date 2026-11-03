"""Render Core: version-pinned Cycles and Blender 5.2 compositor director.

All configuration is confined to the isolated headless Blender worker.
No arbitrary Python text, scene imports, unbounded GPU retries or image synthesis.
"""
from __future__ import annotations

import math

import bpy

from core_assets import PublicationRenderError, require


def _device(job: dict) -> dict:
    requested = job["device"]
    scene = bpy.context.scene
    scene.cycles.device = "CPU"
    if requested == "cpu":
        return {"requested": requested, "actual": "CPU", "backend": None}
    # "auto" can use a GPU only after Blender itself enumerates an available
    # compatible Cycles backend; CPU fallback is truthful in the receipt.
    addon = bpy.context.preferences.addons.get("cycles")
    if addon is None or getattr(addon, "preferences", None) is None:
        return {"requested": requested, "actual": "CPU", "backend": None}
    prefs = addon.preferences
    for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            devices = list(prefs.devices)
            compatible = [d for d in devices if d.type != "CPU"]
            if not compatible:
                continue
            for device in devices:
                device.use = bool(device in compatible)
            scene.cycles.device = "GPU"
            return {"requested": requested, "actual": "GPU", "backend": backend}
        except (AttributeError, RuntimeError, TypeError, ValueError):
            continue
    return {"requested": requested, "actual": "CPU", "backend": None}


def configure_cycles(job: dict) -> dict:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = int(job["samples"])
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = float(job["noise_threshold"])
    # Current Blender versions may expose denoising at Scene or ViewLayer.
    denoising_enabled = False
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = True
        denoising_enabled = True
    view_cycles = getattr(bpy.context.view_layer, "cycles", None)
    if view_cycles is not None and hasattr(view_cycles, "use_denoising"):
        view_cycles.use_denoising = True
        denoising_enabled = True
    require(denoising_enabled, "PUBLICATION_CYCLES_DENOISER_UNAVAILABLE")
    scene.render.resolution_x = int(job["width"])
    scene.render.resolution_y = int(job["height"])
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = job["background"] == "transparent"
    scene.render.filepath = job["output_path"]
    try:
        scene.view_settings.view_transform = job["view_transform"]
    except (TypeError, ValueError) as exc:
        raise PublicationRenderError(
            "PUBLICATION_VIEW_TRANSFORM_UNAVAILABLE:" + str(exc)
        ) from exc
    scene.view_settings.exposure = float(job["look"]["exposure_ev"])
    scene.view_settings.gamma = 1.0
    device = _device(job)
    return {
        "engine": "CYCLES",
        "view_transform": job["view_transform"],
        "sampling": {"samples": int(job["samples"]),
                     "adaptive_threshold": float(job["noise_threshold"]),
                     "denoising": True},
        "device": device,
        "render_size": [int(job["width"]), int(job["height"])],
    }


def render_cycles_with_fallback(job: dict, settings: dict) -> None:
    """One GPU render, with at most one CPU retry on caught Cycles exceptions.

    Blender process crashes are not recoverable from inside Python. Any
    successful CPU retry is reported explicitly, never mislabeled a GPU pass.
    """
    try:
        bpy.ops.render.render(write_still=True)
        return
    except Exception as first_error:
        if job["device"] != "auto" or settings["device"]["actual"] != "GPU":
            raise
        # No repeated GPU/backend cycling and no silent low-sample fallback.
        import sys
        from pathlib import Path
        print(
            "LAZYDESIGNER_GPU_TO_CPU_FALLBACK=" + type(first_error).__name__,
            file=sys.stderr,
        )
        existing = Path(job["output_path"])
        # The destination is constrained to the isolated render workdir.
        if existing.exists():
            existing.unlink()
        bpy.context.scene.cycles.device = "CPU"
        settings["device"]["actual"] = "CPU"
        settings["device"]["backend"] = None
        settings["device"]["fallback_reason"] = "GPU_RENDER_EXCEPTION"
        bpy.ops.render.render(write_still=True)

def configure_compositor(job: dict) -> dict:
    scene = bpy.context.scene
    tree = bpy.data.node_groups.new(
        "LD_Publication_Compositor", "CompositorNodeTree"
    )
    scene.compositing_node_group = tree
    scene.render.use_compositing = True
    tree.interface.new_socket(
        name="Image", in_out="OUTPUT", socket_type="NodeSocketColor"
    )
    layers = tree.nodes.new("CompositorNodeRLayers")
    output = tree.nodes.new("NodeGroupOutput")
    output.is_active_output = True
    look = job["look"]
    strength = float(look["glow_strength"])
    if strength > 0:
        node = tree.nodes.new("CompositorNodeGlare")
        expected = ("Type", "Quality", "Threshold", "Strength", "Size", "Image")
        require(all(name in node.inputs for name in expected),
                "PUBLICATION_BLENDER_52_GLARE_SOCKET_CONTRACT_CHANGED")
        node.inputs["Type"].default_value = "Fog Glow"
        node.inputs["Quality"].default_value = "Medium"
        node.inputs["Threshold"].default_value = float(look["glow_threshold"])
        node.inputs["Strength"].default_value = strength
        node.inputs["Size"].default_value = float(look["glow_size"])
        tree.links.new(layers.outputs["Image"], node.inputs["Image"])
        tree.links.new(node.outputs["Image"], output.inputs["Image"])
    else:
        tree.links.new(layers.outputs["Image"], output.inputs["Image"])
    return {
        "node_group": tree.name,
        "highlight_glow_enabled": strength > 0,
        "glow_strength": strength,
        "glow_threshold": float(look["glow_threshold"]),
        "pixel_art_filtering": "CLOSEST_IN_MATERIALS",
        "automatic_artistic_approval": False,
    }

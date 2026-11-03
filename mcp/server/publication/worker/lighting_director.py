"""Render Core: deterministic professional studio lighting and environment.

The system edits ONLY the disposable Blender scene imported from detached GLB.
No object-category presets, random materials, user .blend execution or asset
replacement. Positions follow the actual camera, so key/rim orientation remains
consistent when the subject view changes.
"""
from __future__ import annotations

import math
import hashlib
from pathlib import Path

import bpy
from mathutils import Vector

from core_assets import require


# Cap pathological geometry sizes rather than silently clamp authored light
# settings or let Cycles accept infinite/high-overflow radiant power values.
MAX_AREA_LIGHT_WATTS = 50_000_000.0


def _aim(light_obj, center: Vector) -> None:
    light_obj.rotation_euler = (center - light_obj.location).to_track_quat("-Z", "Y").to_euler()


def _light(name: str, position: Vector, center: Vector,
           energy: float, softness: float, color: tuple) -> dict:
    require(math.isfinite(energy) and 0.0 <= energy <= MAX_AREA_LIGHT_WATTS,
            "PUBLICATION_STUDIO_LIGHT_ENERGY_OUT_OF_BUDGET:" + name)
    require(math.isfinite(softness) and 0 < softness <= 1_000_000,
            "PUBLICATION_STUDIO_LIGHT_SIZE_OUT_OF_BUDGET:" + name)
    require(len(color) == 3 and all(
        isinstance(value, (int, float)) and
        math.isfinite(value) and 0.0 <= value <= 1.0 for value in color
    ), "PUBLICATION_STUDIO_LIGHT_COLOR_INVALID:" + name)
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = softness
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = position
    _aim(obj, center)
    return {
        "name": name,
        "power": round(data.energy, 5),
        "size": round(data.size, 5),
        "position": [round(v, 5) for v in position],
        "distance_to_subject": round((position - center).length, 5),
        "color_rgb": [round(v, 4) for v in color],
    }


def _world(background: str, factor: float, environment: dict) -> dict:
    scene = bpy.context.scene
    world = bpy.data.worlds.new("LD_Publication_World")
    scene.world = world
    if world.node_tree is None and hasattr(world, "use_nodes"):
        world.use_nodes = True
    require(world.node_tree is not None, "PUBLICATION_WORLD_SHADER_GRAPH_UNAVAILABLE")
    nodes = world.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputWorld")
    ambient = nodes.new("ShaderNodeBackground")
    world.node_tree.links.new(ambient.outputs["Background"], output.inputs["Surface"])
    if background == "light":
        base_color, strength = (0.46, 0.48, 0.53, 1.0), 0.65
    else:
        base_color, strength = (0.05, 0.07, 0.12, 1.0), 0.7
    ambient.inputs["Color"].default_value = base_color
    ambient.inputs["Strength"].default_value = strength * factor
    if environment["mode"] == "hdri":
        selected = Path(environment["hdri_path"])
        require(
            selected.is_absolute() and selected.parent == Path(bpy.context.scene.render.filepath).parent
            and selected.name in ("environment.hdr", "environment.exr")
            and selected.is_file(),
            "PUBLICATION_HDRI_WORKER_SOURCE_OUTSIDE_ISOLATED_JOB",
        )
        digest = hashlib.sha256()
        with selected.open("rb") as file:
            for block in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(block)
        require(digest.hexdigest() == environment["hdri_sha256"],
                "PUBLICATION_HDRI_SOURCE_SHA_MISMATCH")
        tex = nodes.new("ShaderNodeTexEnvironment")
        tex.image = bpy.data.images.load(str(selected), check_existing=False)
        tex.projection = "EQUIRECTANGULAR"
        world.node_tree.links.new(tex.outputs["Color"], ambient.inputs["Color"])
    return {
        "background_color": list(base_color),
        "background_color_role": (
            "HDRI_FALLBACK_UNUSED" if environment["mode"] == "hdri"
            else "ACTIVE_PROCEDURAL_WORLD"
        ),
        "world_strength": strength * factor,
    }


def _studio_ground(job: dict, bounds: tuple) -> dict:
    low, _high, center, radius = bounds
    bpy.ops.mesh.primitive_plane_add(
        size=2, location=(center.x, center.y, low.z - 0.002 * radius)
    )
    floor = bpy.context.object
    floor.name = "LD_Publication_Ground"
    floor.scale = (radius * 5, radius * 5, 1)
    background = job["background"]
    if background == "transparent":
        # Retain physically real contact shadows without painting a flat
        # studio floor into the author's transparent render.
        require(hasattr(floor, "is_shadow_catcher"),
                "PUBLICATION_SHADOW_CATCHER_UNAVAILABLE")
        floor.is_shadow_catcher = True
    material = bpy.data.materials.new("LD_Publication_Ground_Material")
    color = (0.10, 0.11, 0.13, 1) if background != "light" else (0.50, 0.53, 0.56, 1)
    material.diffuse_color = color
    if material.node_tree is None and hasattr(material, "use_nodes"):
        material.use_nodes = True
    require(material.node_tree is not None, "PUBLICATION_GROUND_SHADER_GRAPH_UNAVAILABLE")
    nodes = material.node_tree.nodes
    nodes.clear()
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    output = nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = 0.95
    floor.data.materials.append(material)
    return {
        "mode": background,
        "shadow_catcher": background == "transparent",
        "position_z": round(floor.location.z, 5),
    }


def configure_environment_and_lighting(job: dict, bounds: tuple) -> dict:
    _low, _high, center, radius = bounds
    look = job["look"]
    background = job["background"]
    world = _world(background, float(look["environment"]), job["environment"])
    ground = _studio_ground(job, bounds)

    camera = bpy.context.scene.camera
    require(camera is not None, "PUBLICATION_LIGHTING_CAMERA_REQUIRED")
    bpy.context.view_layer.update()
    orientation = camera.matrix_world.to_quaternion()
    right = orientation @ Vector((1.0, 0.0, 0.0))
    toward = (camera.location - center).normalized()
    up = Vector((0.0, 0.0, 1.0))
    r = max(radius, 0.05)
    # Scale luminous power with square of real geometry extent, not the
    # model's name or an inferred physical object category.
    scale = r * r
    lights = [
        _light(
            "LD_Key", center + (-2.2 * right + 1.5 * toward + 3.2 * up) * r,
            center, 240 * scale * look["key"],
            2.0 * r * look["softness"], (1.0, 0.85, 0.72),
        ),
        _light(
            "LD_Fill", center + (2.3 * right + 1.5 * toward + 1.4 * up) * r,
            center, 90 * scale * look["fill"],
            2.8 * r * look["softness"], (0.67, 0.79, 1.0),
        ),
        _light(
            "LD_Rim", center + (1.8 * right - 2.2 * toward + 2.8 * up) * r,
            center, 340 * scale * look["rim"],
            1.6 * r * look["softness"], (0.87, 0.94, 1.0),
        ),
    ]
    require(all(math.isfinite(item["power"]) for item in lights),
            "PUBLICATION_LIGHTING_NONFINITE")
    key, fill, rim = lights
    # This ratio is emitted ENERGY, not a measured brightness or aesthetic
    # quality estimate. Zero fill is intentional and reported as null.
    key_to_fill = (key["power"] / fill["power"]) if fill["power"] > 0 else None
    return {
        "world": world,
        "ground": ground,
        "lights": lights,
        "key_to_fill_energy_ratio": round(key_to_fill, 5)
                                    if key_to_fill is not None else None,
        "hdr_environment": "USER_PROVIDED" if job["environment"]["mode"] == "hdri"
                            else "NONE_BUNDLED",
        "hdri_sha256": job["environment"]["hdri_sha256"],
        "source_geometry_edited": False,
    }

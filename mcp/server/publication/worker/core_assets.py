"""Render Core: authoritative imported asset inspection and source protection.

This module does not mutate authored geometry, UVs or source color maps.
Execution occurs only in the trusted Blender 5.2 worker.
"""
from __future__ import annotations

import math

import bpy
from mathutils import Vector


class PublicationRenderError(RuntimeError):
    pass


def require(condition: bool, code: str) -> None:
    if not condition:
        raise PublicationRenderError(code)


def imported_meshes(job: dict) -> list:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.scale_length = 1.0
    # Preserve glTF object extras and source material slots for structural
    # fidelity. Blender does the official Y-up -> Z-up conversion.
    bpy.ops.import_scene.gltf(
        filepath=job["glb_path"],
        import_scene_extras=True,
        import_merge_material_slots=False,
    )
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    require(bool(meshes), "PUBLICATION_IMPORTED_MESH_EMPTY")
    require(len(meshes) == job["expected_mesh_count"],
            "PUBLICATION_IMPORTED_MESH_COUNT_MISMATCH")
    bpy.context.view_layer.update()
    found_cubes = set()
    for obj in meshes:
        cube_id = obj.get("lazydesigner_cube_uuid")
        expected_min = obj.get("lazydesigner_bounds_min")
        expected_max = obj.get("lazydesigner_bounds_max")
        require(isinstance(cube_id, str) and cube_id
                and obj.name == "cube_" + cube_id
                and cube_id not in found_cubes,
                "PUBLICATION_IMPORT_SOURCE_CUBE_IDENTITY_MISMATCH:" + obj.name)
        found_cubes.add(cube_id)
        try:
            minimum = [float(value) for value in expected_min]
            maximum = [float(value) for value in expected_max]
        except (TypeError, ValueError):
            raise PublicationRenderError(
                "PUBLICATION_IMPORT_SOURCE_BOUNDS_EXTRAS_MISSING:" + obj.name,
            )
        require(
            len(minimum) == 3 and len(maximum) == 3 and
            all(math.isfinite(value) and minimum[axis] <= maximum[axis]
                for axis in range(3) for value in (minimum[axis], maximum[axis])),
            "PUBLICATION_IMPORT_SOURCE_BOUNDS_EXTRAS_INVALID:" + obj.name,
        )
        actual_points = [
            obj.matrix_world @ Vector(corner) for corner in obj.bound_box
        ]
        actual_min = [min(v[axis] for v in actual_points) for axis in range(3)]
        actual_max = [max(v[axis] for v in actual_points) for axis in range(3)]
        # A conservative float32 import tolerance, not an artistic-quality
        # verdict. Must be calibrated at the future Blender 5.2 native gate.
        for axis in range(3):
            tolerance = max(
                1e-4,
                max(abs(minimum[axis]), abs(maximum[axis])) * 1e-5,
            )
            require(
                abs(actual_min[axis] - minimum[axis]) <= tolerance and
                abs(actual_max[axis] - maximum[axis]) <= tolerance,
                "PUBLICATION_IMPORT_CUBE_BOUNDS_DIVERGED:" +
                obj.name + ":axis=" + str(axis),
            )
    for obj in meshes:
        require(bool(obj.data.polygons) and bool(obj.data.uv_layers),
                "PUBLICATION_IMPORTED_MESH_FACE_OR_UV_MISSING:" + obj.name)
        require(all(math.isfinite(v) for vertex in obj.data.vertices for v in vertex.co),
                "PUBLICATION_IMPORTED_NONFINITE_GEOMETRY:" + obj.name)
    materials = {
        material.name: material for obj in meshes
        for material in obj.data.materials if material
    }
    require(len(materials) == job["expected_material_count"],
            "PUBLICATION_IMPORTED_MATERIAL_COUNT_MISMATCH")
    expected = job["materials"]
    # Materials with Blender-generated numeric suffixes must never masquerade
    # as a different source atlas, including intentionally duplicated names.
    for name, material in materials.items():
        source = expected.get(name)
        require(isinstance(source, dict),
                "PUBLICATION_IMPORTED_UNKNOWN_SOURCE_MATERIAL:" + name)
        require(source.get("alpha_mode") == "OPAQUE",
                "PUBLICATION_IMPORTED_UNSUPPORTED_ALPHA:" + name)
        require(source.get("pbr") in ("NONE", "MAPPED"),
                "PUBLICATION_IMPORTED_PBR_CONTRACT_INVALID:" + name)
        require(bool(material.node_tree),
                "PUBLICATION_IMPORTED_NO_SHADER_GRAPH:" + name)
        nodes = material.node_tree.nodes
        maps = [n for n in nodes if n.type == "TEX_IMAGE" and n.image]
        require(bool(maps), "PUBLICATION_IMPORTED_COLOR_MAP_MISSING:" + name)
        for node in maps:
            require(node.image.size[0] > 0 and node.image.size[1] > 0,
                    "PUBLICATION_IMPORTED_TEXTURE_PIXEL_MISSING:" + name)
            node.interpolation = "Closest"
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        require(bsdf is not None,
                "PUBLICATION_IMPORTED_PRINCIPLED_MISSING:" + name)
        if source["pbr"] == "NONE":
            metallic = bsdf.inputs.get("Metallic")
            roughness = bsdf.inputs.get("Roughness")
            if metallic and not metallic.is_linked:
                metallic.default_value = 0.0
            if roughness and not roughness.is_linked:
                roughness.default_value = 0.85
        if source.get("mer_sha256"):
            metallic = bsdf.inputs.get("Metallic")
            roughness = bsdf.inputs.get("Roughness")
            require(
                bool(metallic and metallic.is_linked and roughness and roughness.is_linked),
                "PUBLICATION_IMPORTED_MER_SHADER_LINKS_MISSING:" + name,
            )
        if source.get("normal_sha256"):
            normal = bsdf.inputs.get("Normal")
            require(bool(normal and normal.is_linked),
                    "PUBLICATION_IMPORTED_NORMAL_SHADER_LINK_MISSING:" + name)
    require(set(materials) == set(expected),
            "PUBLICATION_IMPORTED_SOURCE_MATERIAL_IDENTITY_MISMATCH")
    bpy.context.view_layer.update()
    return meshes


def geometry_bounds(meshes: list) -> tuple:
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in meshes for corner in obj.bound_box
    ]
    require(bool(points), "PUBLICATION_SOURCE_WORLD_BOUNDS_EMPTY")
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    require(all(math.isfinite(v) for v in (*low, *high)),
            "PUBLICATION_SOURCE_WORLD_BOUNDS_NONFINITE")
    span = high - low
    require(max(span) > 0, "PUBLICATION_SOURCE_WORLD_BOUNDS_DEGENERATE")
    center = (low + high) * 0.5
    radius = max(span.length * 0.5, 0.01)
    return low, high, center, radius


def geometry_receipt(meshes: list, bounds: tuple) -> dict:
    low, high, _center, radius = bounds
    return {
        "mesh_count": len(meshes),
        "polygon_count": sum(len(obj.data.polygons) for obj in meshes),
        "vertex_count": sum(len(obj.data.vertices) for obj in meshes),
        "material_count": len({
            material.name for obj in meshes for material in obj.data.materials
            if material is not None
        }),
        "world_min": [round(v, 5) for v in low],
        "world_max": [round(v, 5) for v in high],
        "bounding_radius": round(radius, 5),
        "source_fidelity_visual": "NOT_EVALUATED",
    }

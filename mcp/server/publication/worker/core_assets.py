"""Render Core: authoritative imported asset inspection and source protection.

This module does not mutate authored geometry, UVs or source color maps.
Execution occurs only in the trusted Blender 5.2 worker.
"""
from __future__ import annotations

import hashlib
import math

import bpy
from mathutils import Vector


class PublicationRenderError(RuntimeError):
    pass


def require(condition: bool, code: str) -> None:
    if not condition:
        raise PublicationRenderError(code)


def _reaches_socket(links, source_node, source_output, destination) -> bool:
    """Check an actual shader path through imported nodes, not only socket presence."""
    if source_output is None or destination is None:
        return False
    pending = [(source_node, source_output.name)]
    visited = set()
    while pending:
        node, output_name = pending.pop()
        identity = (node.as_pointer(), output_name)
        if identity in visited:
            continue
        visited.add(identity)
        for link in links:
            if link.from_node != node or (
                output_name is not None and link.from_socket.name != output_name
            ):
                continue
            if link.to_socket == destination:
                return True
            pending.append((link.to_node, None))
    return False


def _verify_imported_material(material, source: dict, image_digests: dict) -> None:
    name = material.name
    require(source.get("alpha_mode") == "OPAQUE" and source.get("pbr") in ("NONE", "MAPPED"),
            "PUBLICATION_IMPORTED_MATERIAL_CONTRACT_INVALID:" + name)
    gltf = source.get("gltf")
    png_shas = source.get("import_png_sha256")
    require(isinstance(gltf, dict) and isinstance(png_shas, dict),
            "PUBLICATION_IMPORTED_MATERIAL_PROVENANCE_MISSING:" + name)
    require(bool(material.node_tree), "PUBLICATION_IMPORTED_NO_SHADER_GRAPH:" + name)
    tree = material.node_tree
    bsdfs = [node for node in tree.nodes if node.type == "BSDF_PRINCIPLED"]
    require(len(bsdfs) == 1, "PUBLICATION_IMPORTED_PRINCIPLED_MISMATCH:" + name)
    bsdf = bsdfs[0]
    require(any(
        link.from_node == bsdf and link.to_node.type == "OUTPUT_MATERIAL" and
        link.to_socket.name == "Surface" for link in tree.links
    ), "PUBLICATION_IMPORTED_MATERIAL_OUTPUT_DISCONNECTED:" + name)

    roles = {"BASE COLOR": ("base", False)}
    if gltf.get("metallic_roughness_texture") is True:
        roles["METALLIC ROUGHNESS"] = ("mer", True)
    if gltf.get("normal_texture") is True:
        roles["NORMAL MAP"] = ("normal", True)
    if gltf.get("emissive_texture") is True:
        roles["EMISSIVE"] = ("emission", False)
    require(set(png_shas) == {role for role, _is_data in roles.values()},
            "PUBLICATION_IMPORTED_TEXTURE_ROLE_INVENTORY_MISMATCH:" + name)

    imported = {}
    for node in tree.nodes:
        if node.type != "TEX_IMAGE":
            continue
        label = node.label.strip().upper()
        require(label in roles and label not in imported,
                "PUBLICATION_IMPORTED_TEXTURE_ROLE_UNKNOWN_OR_DUPLICATE:" + name)
        kind, is_data = roles[label]
        require(node.image is not None and min(node.image.size) > 0,
                "PUBLICATION_IMPORTED_TEXTURE_PIXEL_MISSING:" + name + ":" + label)
        require(node.interpolation == "Closest" and node.extension == "EXTEND",
                "PUBLICATION_IMPORTED_TEXTURE_SAMPLING_MISMATCH:" + name + ":" + label)
        require(bool(node.image.colorspace_settings.is_data) == is_data,
                "PUBLICATION_IMPORTED_TEXTURE_COLORSPACE_MISMATCH:" + name + ":" + label)
        packed = node.image.packed_file
        require(packed is not None,
                "PUBLICATION_IMPORTED_TEXTURE_UNPACKED:" + name + ":" + label)
        image_id = node.image.as_pointer()
        if image_id not in image_digests:
            image_digests[image_id] = hashlib.sha256(bytes(packed.data)).hexdigest()
        require(image_digests[image_id] == png_shas[kind],
                "PUBLICATION_IMPORTED_TEXTURE_SOURCE_BYTES_MISMATCH:" + name + ":" + label)
        imported[label] = node
    require(set(imported) == set(roles),
            "PUBLICATION_IMPORTED_TEXTURE_ROLE_MISSING:" + name)

    def path(label, output_name, target_name):
        node = imported[label]
        return _reaches_socket(
            tree.links, node, node.outputs.get(output_name),
            bsdf.inputs.get(target_name),
        )

    require(path("BASE COLOR", "Color", "Base Color"),
            "PUBLICATION_IMPORTED_BASE_COLOR_DISCONNECTED:" + name)
    metallic = bsdf.inputs.get("Metallic")
    roughness = bsdf.inputs.get("Roughness")
    require(metallic is not None and roughness is not None,
            "PUBLICATION_IMPORTED_PBR_SOCKET_MISSING:" + name)
    if "METALLIC ROUGHNESS" in imported:
        mer = imported["METALLIC ROUGHNESS"]
        splits = [
            link.to_node for link in tree.links
            if link.from_node == mer and link.from_socket.name == "Color" and
            link.to_node.type == "SEPARATE_COLOR" and link.to_socket.name == "Color"
        ]
        require(len(splits) == 1 and splits[0].mode == "RGB",
                "PUBLICATION_IMPORTED_MER_CHANNEL_SPLIT_MISSING:" + name)
        split = splits[0]
        require(_reaches_socket(tree.links, split, split.outputs.get("Blue"), metallic) and
                _reaches_socket(tree.links, split, split.outputs.get("Green"), roughness),
                "PUBLICATION_IMPORTED_MER_CHANNEL_BINDING_MISMATCH:" + name)
    else:
        require(not metallic.is_linked and not roughness.is_linked,
                "PUBLICATION_IMPORTED_UNDECLARED_MER_LINKS:" + name)
        for socket, factor in (
            (metallic, gltf.get("metallic_factor")),
            (roughness, gltf.get("roughness_factor")),
        ):
            require(isinstance(factor, (int, float)) and math.isfinite(factor) and
                    abs(socket.default_value - factor) <= 1e-4,
                    "PUBLICATION_IMPORTED_PBR_FACTOR_DIVERGED:" + name)
    normal = bsdf.inputs.get("Normal")
    if "NORMAL MAP" in imported:
        img = imported["NORMAL MAP"]
        normal_nodes = [
            link.to_node for link in tree.links
            if link.from_node == img and link.from_socket.name == "Color" and
            link.to_node.type == "NORMAL_MAP" and link.to_socket.name == "Color"
        ]
        require(len(normal_nodes) == 1 and normal_nodes[0].space == "TANGENT" and
                _reaches_socket(
                    tree.links, normal_nodes[0], normal_nodes[0].outputs.get("Normal"), normal,
                ), "PUBLICATION_IMPORTED_NORMAL_MAP_BINDING_MISMATCH:" + name)
    else:
        require(normal is not None and not normal.is_linked,
                "PUBLICATION_IMPORTED_UNDECLARED_NORMAL_LINK:" + name)
    emission = bsdf.inputs.get("Emission Color")
    strength = bsdf.inputs.get("Emission Strength")
    emissive_factor = gltf.get("emissive_factor")
    require(emission is not None and strength is not None and
            isinstance(emissive_factor, (int, float)) and math.isfinite(emissive_factor) and
            not strength.is_linked and abs(strength.default_value - emissive_factor) <= 1e-4,
            "PUBLICATION_IMPORTED_EMISSION_FACTOR_DIVERGED:" + name)
    if "EMISSIVE" in imported:
        require(path("EMISSIVE", "Color", "Emission Color"),
                "PUBLICATION_IMPORTED_EMISSIVE_DISCONNECTED:" + name)


def _imported_triangle_witness(obj) -> str:
    """Hash oriented world-space triangle corners, UV and source material.

    The official glTF importer can reindex vertices per primitive. Sorting
    triangle records and allowing cyclic corner starts protects that valid
    behavior without treating reversed winding as equivalent.
    """
    uv = obj.data.uv_layers.active
    require(uv is not None, "PUBLICATION_IMPORT_TRIANGLE_UV_LAYER_MISSING:" + obj.name)
    records = []

    def quantize(value, scale):
        value = float(value)
        require(math.isfinite(value), "PUBLICATION_IMPORT_TRIANGLE_NONFINITE:" + obj.name)
        number = math.floor(value * scale + 0.5)
        require(abs(number) <= 9007199254740991,
                "PUBLICATION_IMPORT_TRIANGLE_PRECISION_EXCEEDED:" + obj.name)
        return str(number)

    for poly in obj.data.polygons:
        require(len(poly.loop_indices) == 3,
                "PUBLICATION_IMPORT_NON_TRIANGLE_PRIMITIVE:" + obj.name)
        require(0 <= poly.material_index < len(obj.data.materials),
                "PUBLICATION_IMPORT_TRIANGLE_MATERIAL_INVALID:" + obj.name)
        material = obj.data.materials[poly.material_index]
        require(material is not None and material.name.startswith("ld_color_"),
                "PUBLICATION_IMPORT_TRIANGLE_MATERIAL_UNRESOLVED:" + obj.name)
        corner_keys = []
        for index in poly.loop_indices:
            loop = obj.data.loops[index]
            point = obj.matrix_world @ obj.data.vertices[loop.vertex_index].co
            texel = uv.data[index].uv
            corner_keys.append(",".join([
                quantize(point[0], 10000),
                quantize(point[1], 10000),
                quantize(point[2], 10000),
                quantize(texel[0], 100000),
                quantize(texel[1], 100000),
            ]))
        a, b, c = corner_keys
        records.append(material.name + "|" + min(
            a + ";" + b + ";" + c,
            b + ";" + c + ";" + a,
            c + ";" + a + ";" + b,
        ))
    require(bool(records), "PUBLICATION_IMPORT_TRIANGLE_INVENTORY_EMPTY:" + obj.name)
    return hashlib.sha256("\n".join(sorted(records)).encode("utf8")).hexdigest()


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
        expected_triangle_sha = obj.get("lazydesigner_triangle_sha256")
        require(isinstance(expected_triangle_sha, str) and
                len(expected_triangle_sha) == 64 and
                all(ch in "0123456789abcdef" for ch in expected_triangle_sha),
                "PUBLICATION_IMPORT_TRIANGLE_WITNESS_MISSING:" + obj.name)
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
        expected_triangle_sha = obj.get("lazydesigner_triangle_sha256")
        actual_triangle_sha = _imported_triangle_witness(obj)
        require(actual_triangle_sha == expected_triangle_sha,
                "PUBLICATION_IMPORT_TRIANGLE_UV_MATERIAL_DIVERGED:" + obj.name)
        require(bool(obj.data.polygons) and bool(obj.data.uv_layers),
                "PUBLICATION_IMPORTED_MESH_FACE_OR_UV_MISSING:" + obj.name)
        uv = obj.data.uv_layers.active
        require(uv is not None and len(uv.data) == len(obj.data.loops) and
                all(math.isfinite(value) for point in uv.data for value in point.uv),
                "PUBLICATION_IMPORTED_MESH_UV_INVALID:" + obj.name)
        require(all(math.isfinite(v) for vertex in obj.data.vertices for v in vertex.co),
                "PUBLICATION_IMPORTED_NONFINITE_GEOMETRY:" + obj.name)
        require(all(
            0 <= poly.material_index < len(obj.data.materials) and
            obj.data.materials[poly.material_index] is not None
            for poly in obj.data.polygons
        ), "PUBLICATION_IMPORTED_FACE_MATERIAL_UNRESOLVED:" + obj.name)
    materials = {
        material.name: material for obj in meshes
        for material in obj.data.materials if material
    }
    require(len(materials) == job["expected_material_count"],
            "PUBLICATION_IMPORTED_MATERIAL_COUNT_MISMATCH")
    expected = job["materials"]
    require(set(materials) == set(expected),
            "PUBLICATION_IMPORTED_SOURCE_MATERIAL_IDENTITY_MISMATCH")
    # Blender may share one Image among several supported shader roles.
    # Hash each packed image once without replacing source pixels or nodes.
    image_digests = {}
    for name, material in materials.items():
        source = expected.get(name)
        require(isinstance(source, dict),
                "PUBLICATION_IMPORTED_UNKNOWN_SOURCE_MATERIAL:" + name)
        _verify_imported_material(material, source, image_digests)
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

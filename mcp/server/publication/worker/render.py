"""LazyDesigner publication renderer — trusted bundled Blender worker.

Executed only by the permission-gated local Blockbench publication service.
Never run arbitrary model-supplied Python or import user-supplied .blend files.
Source appearance is always validated independently before a publication claim.
"""
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view


def fail(message):
    print("LAZYDESIGNER_RENDER_ERROR: " + message, file=sys.stderr)
    raise RuntimeError(message)


def require_job():
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1:]) != 1:
        fail("Expected one absolute JSON job path after --.")
    source = Path(sys.argv[sys.argv.index("--") + 1])
    if not source.is_absolute() or not source.is_file():
        fail("Job path is not an existing absolute file.")
    if source.stat().st_size > 256_000:
        fail("Job exceeds bounded JSON size.")
    job = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(job, dict) or job.get("schema_version") != 1:
        fail("Unsupported job schema.")
    width, height = job.get("width"), job.get("height")
    if not all(type(v) is int and 256 <= v <= 4096 for v in (width, height)):
        fail("Invalid image dimensions.")
    if width * height > 12_000_000:
        fail("Image exceeds 12 megapixels.")
    if job.get("quality") not in ("preview", "publication", "high"):
        fail("Unsupported quality.")
    if job.get("background") not in ("dark", "light", "transparent"):
        fail("Unsupported background.")
    samples = job.get("samples")
    if type(samples) is not int or not 1 <= samples <= 256:
        fail("Sampling budget is invalid.")
    threshold = job.get("noise_threshold")
    if type(threshold) not in (int, float) or not 0.001 <= threshold <= 0.1:
        fail("Noise threshold is invalid.")
    for name, suffix in (("glb_path", ".glb"), ("output_path", ".png")):
        item = Path(job.get(name, ""))
        if not item.is_absolute() or item.suffix.lower() != suffix:
            fail(name + " must be an absolute " + suffix + " file.")
        job[name] = str(item)
    if not os.path.isfile(job["glb_path"]):
        fail("GLB file does not exist.")
    if os.path.exists(job["output_path"]):
        fail("Refusing to overwrite existing render output.")
    look = job.get("look")
    if not isinstance(look, dict):
        fail("Missing validated scene lighting contract.")
    for name, lower, upper in (
        ("key", 0.2, 2.5), ("fill", 0.0, 2.0),
        ("rim", 0.0, 2.0), ("softness", 0.5, 2.5),
        ("environment", 0.0, 2.0), ("exposure_ev", -3.0, 3.0),
        ("glow_strength", 0.0, 0.35), ("glow_threshold", 0.5, 20.0),
        ("glow_size", 0.1, 0.8),
    ):
        val = look.get(name)
        if type(val) not in (int, float) or not math.isfinite(val) or not lower <= val <= upper:
            fail("Invalid scene lighting parameter: " + name)
    camera = job.get("camera")
    if not isinstance(camera, dict) or camera.get("projection") not in ("perspective", "orthographic"):
        fail("Camera contract is invalid.")
    for name, lower, upper in (("yaw_degrees", -180, 180), ("elevation_degrees", -30, 80)):
        val = camera.get(name)
        if type(val) not in (int, float) or not math.isfinite(val) or not lower <= val <= upper:
            fail("Invalid camera " + name)
    return job


def focus(obj, point):
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def bounds_of_objects(mesh_objects):
    values = []
    for obj in mesh_objects:
        for corner in obj.bound_box:
            values.append(obj.matrix_world @ Vector(corner))
    if not values:
        fail("GLB contains no bounded mesh geometry.")
    lower = Vector(tuple(min(v[i] for v in values) for i in range(3)))
    upper = Vector(tuple(max(v[i] for v in values) for i in range(3)))
    if any(not math.isfinite(n) for n in (*lower, *upper)):
        fail("Imported world bounds are invalid.")
    delta = upper - lower
    if min(delta) < 0 or max(delta) <= 0:
        fail("Model has empty bounds.")
    return lower, upper, (lower + upper) * 0.5, max(delta.length * 0.5, 0.01)


def stage_materials(meshes, job):
    for obj in meshes:
        for item in obj.material_slots:
            material = item.material
            if not material:
                fail("Imported mesh has no material.")
            material.use_nodes = True
            nodes = material.node_tree.nodes
            # A material that has a valid name but lost its imported atlas is
            # not acceptable; never replace a broken PBR map with a flat color.
            image_nodes = [n for n in nodes if n.type == "TEX_IMAGE" and n.image]
            if not image_nodes or any(
                n.image.size[0] < 1 or n.image.size[1] < 1 for n in image_nodes
            ):
                fail("Imported material is missing usable native texture pixels: " + material.name)
            bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
            if not bsdf:
                fail("Imported GLB has no Principled material.")
            source_materials = job.get("materials", {})
            # Blender may append .001 to duplicate material names on import.
            base_name = material.name.rsplit(".", 1)[0] if material.name.rsplit(".", 1)[-1].isdigit() else material.name
            source = source_materials.get(material.name) or source_materials.get(base_name)
            if not isinstance(source, dict):
                fail("Imported GLB material has no source identity: " + material.name)
            if source.get("alpha_mode") != "OPAQUE":
                fail("Unsupported alpha semantics were imported.")
            if source.get("pbr") not in ("NONE", "MAPPED"):
                fail("Material source PBR contract is invalid.")
            metallic = bsdf.inputs.get("Metallic")
            roughness = bsdf.inputs.get("Roughness")
            if source["pbr"] == "NONE":
                if metallic and not metallic.is_linked:
                    metallic.default_value = 0.0
                if roughness and not roughness.is_linked:
                    roughness.default_value = 0.85
            for node in nodes:
                if node.type == "TEX_IMAGE" and node.image:
                    node.interpolation = "Closest"
            material.use_backface_culling = False


def configure_world(scene, background, look):
    scene.world = bpy.data.worlds.new("LD_Publication_World")
    # Blender 5.0+ creates an empty shader graph for a new world.
    # Deprecated world.use_nodes no longer constructs default nodes.
    nodes = scene.world.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputWorld")
    bg = nodes.new("ShaderNodeBackground")
    scene.world.node_tree.links.new(bg.outputs["Background"], out.inputs["Surface"])
    if background == "light":
        bg.inputs["Color"].default_value = (0.46, 0.48, 0.53, 1.0)
        bg.inputs["Strength"].default_value = 0.65 * look["environment"]
    else:
        bg.inputs["Color"].default_value = (0.05, 0.07, 0.12, 1.0)
        bg.inputs["Strength"].default_value = 0.7 * look["environment"]


def area_light(name, point, target, energy, radius, color):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = max(radius, 0.05)
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = point
    focus(obj, target)
    return obj


def place_camera(job, center, radius):
    req = job["camera"]
    yaw = math.radians(req["yaw_degrees"])
    elevation = math.radians(req["elevation_degrees"])
    direction = Vector((
        math.sin(yaw) * math.cos(elevation),
        -math.cos(yaw) * math.cos(elevation),
        math.sin(elevation),
    ))
    camera_data = bpy.data.cameras.new("LD_Publication_Camera")
    camera = bpy.data.objects.new("LD_Publication_Camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    # The smaller camera half-FOV, not simply lens or model size, determines
    # whether a sphere fits in 16:9 landscape or 4:5 portrait framing.
    aspect = job["width"] / job["height"]
    fit_padding = 1.28
    camera_data.sensor_fit = "HORIZONTAL"
    if req["projection"] == "orthographic":
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 2 * radius * fit_padding * max(1, aspect)
        distance = radius * 4.0 + 0.01
    else:
        camera_data.type = "PERSP"
        camera_data.lens = 45
        horizontal_half_fov = math.atan(camera_data.sensor_width / (2 * camera_data.lens))
        vertical_half_fov = math.atan(math.tan(horizontal_half_fov) / aspect)
        fit_half_fov = min(horizontal_half_fov, vertical_half_fov)
        distance = fit_padding * radius / math.sin(fit_half_fov)
    camera_data.clip_start = max(0.001, min(radius * 0.001, distance / 100))
    camera_data.clip_end = max(1000, distance + radius * 4)
    camera.location = center + direction * distance
    focus(camera, center)


def verify_camera_coverage(meshes):
    """Fail on objectively clipped native geometry; this is not an aesthetic score."""
    scene = bpy.context.scene
    camera = scene.camera
    if camera is None:
        fail("Publication camera was not created.")
    bpy.context.view_layer.update()
    bounds = [
        world_to_camera_view(scene, camera, obj.matrix_world @ Vector(corner))
        for obj in meshes for corner in obj.bound_box
    ]
    if not bounds or any(not all(math.isfinite(v) for v in p) for p in bounds):
        fail("Publication camera produced invalid projected coordinates.")
    margin = 0.015
    if any(
        p.z <= 0 or p.x < margin or p.x > 1 - margin
        or p.y < margin or p.y > 1 - margin for p in bounds
    ):
        fail("PUBLICATION_CAMERA_SUBJECT_CLIPPED: adjust yaw, elevation or aspect ratio.")

def create_stage(job, lower, upper, center, radius):
    background = job["background"]
    look = job["look"]
    configure_world(bpy.context.scene, background, look)
    if background != "transparent":
        bpy.ops.mesh.primitive_plane_add(size=2, location=(center.x, center.y, lower.z - 0.002 * radius))
        ground = bpy.context.object
        ground.name = "LD_Publication_Ground"
        ground.scale = (radius * 5, radius * 5, 1)
        ground_mat = bpy.data.materials.new("LD_Publication_Ground_Material")
        ground_mat.diffuse_color = (0.10, 0.11, 0.13, 1) if background == "dark" else (0.50, 0.53, 0.56, 1)
        # Build an explicit shader graph: material.use_nodes is deprecated.
        nodes = ground_mat.node_tree.nodes
        nodes.clear()
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        output = nodes.new("ShaderNodeOutputMaterial")
        ground_mat.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        shader.inputs["Base Color"].default_value = ground_mat.diffuse_color
        shader.inputs["Roughness"].default_value = 0.95
        ground.data.materials.append(ground_mat)
    else:
        bpy.context.scene.render.film_transparent = True
    # Scale lights from actual model dimensions. Energies are benchmark starters.
    r = radius
    area_light("LD_Key", center + Vector((-2.2*r, -2*r, 3.2*r)),
               center, 240 * r * r * look["key"],
               2.0*r * look["softness"], (1.0, 0.85, 0.72))
    area_light("LD_Fill", center + Vector((2.3*r, -1.2*r, 1.4*r)),
               center, 90 * r * r * look["fill"],
               2.8*r * look["softness"], (0.67, 0.79, 1.0))
    area_light("LD_Rim", center + Vector((1.8*r, 2.2*r, 2.8*r)),
               center, 340 * r * r * look["rim"],
               1.6*r * look["softness"], (0.87, 0.94, 1.0))
    place_camera(job, center, r)


def configure_render(job):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = job["samples"]
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = job["noise_threshold"]
    scene.cycles.use_denoising = True
    scene.render.resolution_x = job["width"]
    scene.render.resolution_y = job["height"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = job["background"] == "transparent"
    scene.render.filepath = job["output_path"]
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        fail("Expected AgX color management is unavailable.")
    scene.view_settings.exposure = job["look"]["exposure_ev"]
    scene.view_settings.gamma = 1
    # Blender 5.2 compositing uses a compositor NodeGroup assigned to Scene.
    # The restrained glare only affects actual scene highlights; it never
    # generates un-authored geometry, painted details or arbitrary pixels.
    compositor = bpy.data.node_groups.new("LD_Publication_Compositor", "CompositorNodeTree")
    scene.compositing_node_group = compositor
    compositor.interface.new_socket(
        name="Image", in_out="OUTPUT", socket_type="NodeSocketColor"
    )
    layers = compositor.nodes.new("CompositorNodeRLayers")
    output = compositor.nodes.new("NodeGroupOutput")
    if job["look"]["glow_strength"] > 0:
        glare = compositor.nodes.new("CompositorNodeGlare")
        # Blender 5.x Glare configuration uses input sockets, NOT the removed
        # legacy glare_type, threshold, quality or size attributes.
        glare.inputs["Type"].default_value = "Fog Glow"
        glare.inputs["Quality"].default_value = "Medium"
        glare.inputs["Threshold"].default_value = job["look"]["glow_threshold"]
        glare.inputs["Strength"].default_value = job["look"]["glow_strength"]
        glare.inputs["Size"].default_value = job["look"]["glow_size"]
        compositor.links.new(layers.outputs["Image"], glare.inputs["Image"])
        compositor.links.new(glare.outputs["Image"], output.inputs["Image"])
    else:
        compositor.links.new(layers.outputs["Image"], output.inputs["Image"])


def render(job):
    if tuple(bpy.app.version[:2]) != (5, 2):
        fail("This worker is pinned to Blender 5.2.x, found " + str(bpy.app.version[:3]))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=job["glb_path"])
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        fail("Imported GLB contains no mesh.")
    for obj in meshes:
        if not obj.data.polygons or not obj.data.uv_layers:
            fail("Imported mesh lost its polygon/UV inventory: " + obj.name)
    if len(meshes) != job.get("expected_mesh_count"):
        fail("Imported Blender mesh inventory differs from Blockbench source.")
    imported_materials = {material.name for obj in meshes for material in obj.data.materials if material}
    if len(imported_materials) != job.get("expected_material_count"):
        fail("Imported Blender material inventory differs from Blockbench source.")
    stage_materials(meshes, job)
    bpy.context.view_layer.update()
    low, high, center, radius = bounds_of_objects(meshes)
    create_stage(job, low, high, center, radius)
    verify_camera_coverage(meshes)
    configure_render(job)
    bpy.ops.render.render(write_still=True)
    output = Path(job["output_path"])
    if not output.is_file() or output.stat().st_size < 100:
        fail("Cycles did not write an image.")
    with output.open("rb") as handle:
        header = handle.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        fail("Output is not a PNG.")
    width = int.from_bytes(header[16:20], "big")
    height = int.from_bytes(header[20:24], "big")
    if (width, height) != (job["width"], job["height"]):
        fail("Rendered PNG dimensions differ from the job contract.")
    print("LAZYDESIGNER_RENDER_OUTPUT=" + str(output))


def main():
    job = require_job()
    render(job)


if __name__ == "__main__":
    main()

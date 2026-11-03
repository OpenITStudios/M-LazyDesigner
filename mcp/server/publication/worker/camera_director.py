"""LazyDesigner Camera Director: source geometry -> bounded Cycles framing.

All candidate camera views use Blender's own projected camera frame, not a
separate guessed aspect-ratio formula. A projected-bounds convex hull is only
a GEOMETRIC composition heuristic, never an artistic or occlusion score.
No alternative Blender renderer, model categorization or 15-image search.
"""
from __future__ import annotations

import math

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

from core_assets import PublicationRenderError, require

MAX_AUTO_CANDIDATES = 15
MAX_SCORING_MESHES = 128
MAX_FINAL_CANDIDATES = 3
FIT_MULTIPLIERS = (1.0, 1.12, 1.30, 1.60, 2.0, 3.0)
FRAME_MARGIN = 0.015


def _world_points(meshes: list, limit: int | None = None) -> list:
    subset = meshes
    if limit and len(meshes) > limit:
        step = max(1, math.ceil(len(meshes) / limit))
        subset = meshes[::step][:limit]
    return [
        obj.matrix_world @ Vector(corner)
        for obj in subset for corner in obj.bound_box
    ]


def _look_at(camera, target):
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def _normalize_yaw(value: float) -> float:
    return (value + 180.0) % 360.0 - 180.0


def _position_camera(camera, job: dict, center: Vector, radius: float,
                     yaw: float, elevation: float, fit_multiplier: float) -> None:
    yaw_r = math.radians(yaw)
    elevation_r = math.radians(elevation)
    direction = Vector((
        math.sin(yaw_r) * math.cos(elevation_r),
        -math.cos(yaw_r) * math.cos(elevation_r),
        math.sin(elevation_r),
    ))
    aspect = job["width"] / job["height"]
    camera_data = camera.data
    camera_data.sensor_fit = "HORIZONTAL"
    padding = job["camera"]["framing_padding"] * fit_multiplier
    if job["camera"]["projection"] == "orthographic":
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 2 * radius * padding * max(1.0, aspect)
        distance = radius * 4.0 * fit_multiplier + 0.01
    else:
        camera_data.type = "PERSP"
        camera_data.lens = 45
        horizontal_half_fov = math.atan(camera_data.sensor_width / (2 * camera_data.lens))
        vertical_half_fov = math.atan(math.tan(horizontal_half_fov) / aspect)
        distance = padding * radius / math.sin(min(horizontal_half_fov, vertical_half_fov))
    camera_data.clip_start = max(0.0001, min(radius * 0.001, distance / 1000))
    camera_data.clip_end = max(1000.0, distance + radius * 5)
    camera.location = center + direction * distance
    _look_at(camera, center)
    # Critical: world_to_camera_view uses the evaluated camera.matrix_world.
    # Location/rotation changes may not be reflected until dependency refresh.
    bpy.context.view_layer.update()


def _hull_area(coordinates: list) -> float:
    """Projected 2D bounds hull: cheap geometric occupancy proxy only."""
    points = sorted(set((float(x), float(y)) for x, y in coordinates))
    if len(points) < 3:
        return 0.0

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - \
               (b[1] - a[1]) * (c[0] - a[0])

    lower = []
    for point in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper = []
    for point in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    hull = lower[:-1] + upper[:-1]
    return abs(sum(
        hull[i][0] * hull[(i + 1) % len(hull)][1] -
        hull[(i + 1) % len(hull)][0] * hull[i][1]
        for i in range(len(hull))
    )) * 0.5


def _projection(scene, camera, points: list, *, include_hull: bool = True) -> dict:
    projected = [world_to_camera_view(scene, camera, point) for point in points]
    if not projected or any(not all(math.isfinite(v) for v in item) for item in projected):
        raise PublicationRenderError("PUBLICATION_CAMERA_PROJECTION_INVALID")
    left = min(point.x for point in projected)
    right = max(point.x for point in projected)
    bottom = min(point.y for point in projected)
    top = max(point.y for point in projected)
    behind = sum(point.z <= 0 for point in projected)
    frame_safe = behind == 0 and left >= FRAME_MARGIN and right <= 1 - FRAME_MARGIN \
        and bottom >= FRAME_MARGIN and top <= 1 - FRAME_MARGIN
    area = max(0.0, right - left) * max(0.0, top - bottom)
    # The whole-model fit loop needs only clipping bounds. Avoid re-sorting
    # up to 80,000 model points per refit, reserving hull metrics for ranking
    # and the final verified camera.
    hull_area = _hull_area([(p.x, p.y) for p in projected]) if include_hull else 0.0
    return {
        "frame_safe": frame_safe,
        "bounding_box": [round(left, 5), round(bottom, 5),
                         round(right, 5), round(top, 5)],
        "bounding_area": round(area, 5),
        "hull_area": round(hull_area, 5),
        "off_camera_points": behind,
        "offset_center": abs((left + right) * 0.5 - 0.5) +
                         abs((bottom + top) * 0.5 - 0.5),
    }


def _fit_candidate(scene, camera, job: dict, center: Vector, radius: float,
                   yaw: float, elevation: float, points: list,
                   include_hull: bool = True):
    """Fit actual projected corners; no Cycles render or extra scene objects."""
    for count, multiple in enumerate(FIT_MULTIPLIERS, 1):
        _position_camera(camera, job, center, radius, yaw, elevation, multiple)
        evidence = _projection(scene, camera, points, include_hull=include_hull)
        if evidence["frame_safe"]:
            return evidence, multiple, count
    return None


def configure_camera(job: dict, meshes: list, center: Vector, radius: float) -> dict:
    scene = bpy.context.scene
    data = bpy.data.cameras.new("LD_Publication_Camera")
    camera = bpy.data.objects.new("LD_Publication_Camera", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    request = job["camera"]
    base_yaw = float(request["yaw_degrees"])
    base_elev = float(request["elevation_degrees"])
    auto = request["mode"] == "auto"
    if auto:
        options = [
            (_normalize_yaw(base_yaw + dy),
             max(-30.0, min(80.0, base_elev + de)),
             dy, de)
            for dy in (-30.0, -15.0, 0.0, 15.0, 30.0)
            for de in (-10.0, 0.0, 10.0)
        ]
    else:
        # Manual camera preserves the exact artist-specified orientation.
        options = [(base_yaw, base_elev, 0.0, 0.0)]
    require(len(options) <= MAX_AUTO_CANDIDATES,
            "PUBLICATION_CAMERA_CANDIDATE_BUDGET_EXCEEDED")

    sampled_points = _world_points(meshes, MAX_SCORING_MESHES) if auto \
        else _world_points(meshes)
    require(bool(sampled_points), "PUBLICATION_CAMERA_SOURCE_POINTS_EMPTY")
    ranked = []
    for yaw, elevation, dy, de in options:
        fitted = _fit_candidate(
            scene, camera, job, center, radius, yaw, elevation, sampled_points,
        )
        if fitted is None:
            continue
        evidence, multiple, _attempts = fitted
        # Use bounded 2D geometry occupancy rather than bounding-rectangle
        # area alone: the latter can favor edge-on or highly empty views.
        score = evidence["hull_area"] - 0.025 * evidence["offset_center"] - \
            0.00010 * (abs(dy) + abs(de))
        ranked.append((score, yaw, elevation, multiple))
    require(bool(ranked), "PUBLICATION_CAMERA_NO_SAFE_CANDIDATE")
    ranked.sort(key=lambda item: -item[0])

    # Expensive full-asset projection is run for at most three best candidates.
    # Never accept sampled frame coverage as proof that ALL model parts fit.
    full_points = _world_points(meshes)
    selected = None
    for _score, yaw, elevation, _sample_fit in ranked[:MAX_FINAL_CANDIDATES]:
        fitted = _fit_candidate(
            scene, camera, job, center, radius, yaw, elevation, full_points,
            include_hull=False,
        )
        if fitted is not None:
            selected = (yaw, elevation, *fitted)
            break
    require(selected is not None, "PUBLICATION_CAMERA_SUBJECT_CLIPPED")
    yaw, elevation, full, multiple, attempts = selected
    _position_camera(camera, job, center, radius, yaw, elevation, multiple)
    # Recheck final exact camera transform before the worker adds any lights.
    full = _projection(scene, camera, full_points)
    require(full["frame_safe"], "PUBLICATION_CAMERA_SUBJECT_CLIPPED")
    return {
        "mode": request["mode"],
        "requested_yaw_degrees": base_yaw,
        "requested_elevation_degrees": base_elev,
        "resolved_yaw_degrees": round(yaw, 3),
        "resolved_elevation_degrees": round(elevation, 3),
        "projection": request["projection"],
        "candidate_count": len(options),
        "projected_bounds": full["bounding_box"],
        "projected_area": full["bounding_area"],
        "projected_hull_area": full["hull_area"],
        "framing_fit_multiplier": round(multiple, 3),
        "framing_fit_attempts": attempts,
        "frame_safe": full["frame_safe"],
        "quality_is_artistic_score": False,
    }

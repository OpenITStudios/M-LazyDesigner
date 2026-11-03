"""Render Core: bounded camera composition based on actual 3D geometry.

No asset-name/type lookup, no synthetic shape generation and no ML guesswork.
The authored camera is an intent anchor, not a semantic object classifier.
"""
from __future__ import annotations

import math

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

from core_assets import PublicationRenderError, require

MAX_AUTO_CANDIDATES = 15
MAX_SCORING_MESHES = 128


def _world_points(meshes: list, limit: int | None = None) -> list:
    subset = meshes
    if limit and len(meshes) > limit:
        step = max(1, math.ceil(len(meshes) / limit))
        subset = meshes[::step]
    return [
        obj.matrix_world @ Vector(corner)
        for obj in subset for corner in obj.bound_box
    ]


def _look_at(camera, target):
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def _position_camera(camera, job: dict, center: Vector, radius: float,
                     yaw: float, elevation: float) -> None:
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
    padding = job["camera"]["framing_padding"]
    if job["camera"]["projection"] == "orthographic":
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 2 * radius * padding * max(1, aspect)
        distance = radius * 4 + 0.01
    else:
        camera_data.type = "PERSP"
        camera_data.lens = 45
        half_h = math.atan(camera_data.sensor_width / (2 * camera_data.lens))
        half_v = math.atan(math.tan(half_h) / aspect)
        distance = padding * radius / math.sin(min(half_h, half_v))
    camera_data.clip_start = max(0.001, min(radius * 0.001, distance / 100))
    camera_data.clip_end = max(1000, distance + radius * 4)
    camera.location = center + direction * distance
    _look_at(camera, center)


def _projection(scene, camera, points: list) -> dict:
    projected = [world_to_camera_view(scene, camera, point) for point in points]
    if not projected or any(not all(math.isfinite(v) for v in p) for p in projected):
        raise PublicationRenderError("PUBLICATION_CAMERA_PROJECTION_INVALID")
    left = min(p.x for p in projected)
    right = max(p.x for p in projected)
    bottom = min(p.y for p in projected)
    top = max(p.y for p in projected)
    behind = sum(p.z <= 0 for p in projected)
    frame_safe = behind == 0 and left >= 0.015 and right <= 0.985 \
        and bottom >= 0.015 and top <= 0.985
    area = max(0, right - left) * max(0, top - bottom)
    return {
        "frame_safe": frame_safe,
        "bounding_box": [round(left, 5), round(bottom, 5),
                         round(right, 5), round(top, 5)],
        "bounding_area": round(area, 5),
        "off_camera_points": behind,
        "offset_center": abs((left + right) * 0.5 - 0.5)
                         + abs((bottom + top) * 0.5 - 0.5),
    }


def configure_camera(job: dict, meshes: list, center: Vector, radius: float) -> dict:
    scene = bpy.context.scene
    data = bpy.data.cameras.new("LD_Publication_Camera")
    camera = bpy.data.objects.new("LD_Publication_Camera", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    request = job["camera"]
    base_yaw = float(request["yaw_degrees"])
    base_elev = float(request["elevation_degrees"])
    sample_points = _world_points(meshes, MAX_SCORING_MESHES)
    auto = request["mode"] == "auto"
    if auto:
        yaw_offsets = (-30, -15, 0, 15, 30)
        elev_offsets = (-10, 0, 10)
        options = [
            (base_yaw + dy, max(-30, min(80, base_elev + de)), dy, de)
            for dy in yaw_offsets for de in elev_offsets
        ]
    else:
        options = [(base_yaw, base_elev, 0, 0)]
    require(len(options) <= MAX_AUTO_CANDIDATES,
            "PUBLICATION_CAMERA_CANDIDATE_BUDGET_EXCEEDED")
    best = None
    for yaw, elev, dy, de in options:
        _position_camera(camera, job, center, radius, yaw, elev)
        evidence = _projection(scene, camera, sample_points)
        if not evidence["frame_safe"]:
            continue
        # Favor higher visible projected surface area while retaining the
        # artist-specified direction; small deviations never dominate.
        score = evidence["bounding_area"] \
            - 0.025 * evidence["offset_center"] \
            - 0.00010 * (abs(dy) + abs(de))
        if best is None or score > best["score"]:
            best = {"score": score, "yaw": yaw, "elevation": elev,
                    "evidence": evidence}
    require(best is not None, "PUBLICATION_CAMERA_NO_SAFE_CANDIDATE")
    _position_camera(camera, job, center, radius, best["yaw"], best["elevation"])
    # Final safety uses ALL mesh world bounds, never just the scoring subset.
    full = _projection(scene, camera, _world_points(meshes))
    require(full["frame_safe"], "PUBLICATION_CAMERA_SUBJECT_CLIPPED")
    return {
        "mode": request["mode"],
        "requested_yaw_degrees": base_yaw,
        "requested_elevation_degrees": base_elev,
        "resolved_yaw_degrees": round(best["yaw"], 3),
        "resolved_elevation_degrees": round(best["elevation"], 3),
        "projection": request["projection"],
        "candidate_count": len(options),
        "projected_bounds": full["bounding_box"],
        "projected_area": full["bounding_area"],
        "frame_safe": full["frame_safe"],
        "quality_is_artistic_score": False,
    }

import { expect, test } from "bun:test";
import type { OrientedBox, Vec3 } from "@/lib/orientedBoxContact";
import {
  analyzeCurrentPreviewObbContainment,
  analyzeGeometryPoseSequence,
  analyzeAxisAlignedSurfaceEvidence,
  analyzeStaticCubeContainment,
  analyzeStaticMarginalProjection,
  analyzeStaticCubeMergeCandidates,
} from "@/lib/geometrySurfaceEvidence";

const cube = (uuid: string, from: number[], to: number[], rotation = [0, 0, 0]) => ({
  uuid,
  name: uuid,
  from,
  to,
  rotation,
  inflate: 0,
});

test("same-facing coplanar layers block while butt joints do not", () => {
  const layered = analyzeAxisAlignedSurfaceEvidence([
    cube("a", [0, 0, 0], [4, 4, 4]),
    cube("b", [0, 0, 0], [4, 4, 2]),
  ]);
  expect(layered.coplanar_overlap_count).toBeGreaterThan(0);
  expect(layered.state).toBe("blocked");

  const butt = analyzeAxisAlignedSurfaceEvidence([
    cube("left", [0, 0, 0], [4, 4, 4]),
    cube("right", [4, 0, 0], [8, 4, 4]),
  ]);
  expect(butt.coplanar_overlap_count).toBe(0);
  expect(butt.positive_volume_intersection_count).toBe(0);
  expect(butt.state).toBe("clean");
});

test("positive volume overlap is evidence but not automatically a texture blocker", () => {
  const result = analyzeAxisAlignedSurfaceEvidence([
    cube("outer", [0, 0, 0], [6, 6, 6]),
    cube("inner", [2, 2, 2], [4, 4, 4]),
  ]);
  expect(result.positive_volume_intersection_count).toBe(1);
  expect(result.coplanar_overlap_count).toBe(0);
  expect(result.state).toBe("clean");
});

test("same-parent fully enclosed Cubes are review candidates, not automatic deletions", () => {
  const outer = { ...cube("body", [0, 0, 0], [8, 8, 8]), parent_id: "torso" };
  const inside = { ...cube("detail", [2, 2, 2], [4, 4, 4]), parent_id: "torso" };
  const observed = analyzeStaticCubeContainment([inside, outer]);
  expect(observed.state).toBe("available");
  expect(observed.contained_candidate_count).toBe(1);
  expect(observed.examples).toEqual([
    expect.objectContaining({
      cube_uuid: "detail", containing_cube_uuid: "body",
      reason: "STRICT_INTERIOR_REST_POSE",
    }),
  ]);
  expect(observed.note).toContain("do not automatically remove");
  // An otherwise clean surface scan can still identify a geometric economy
  // review; "clean" never certifies that every Cube was necessary.
  const surface = analyzeAxisAlignedSurfaceEvidence([inside, outer]);
  expect(surface.rest_pose_containment_review.contained_candidate_count).toBe(1);
  expect(surface.state).toBe("clean");
});

test("surface detail candidates do not cross bones, protrusions, rotation, or planes", () => {
  const body = { ...cube("body", [0, 0, 0], [8, 8, 8]), parent_id: "torso" };
  const variants = [
    { ...cube("horn", [7, 5, 3], [10, 7, 5]), parent_id: "torso" },
    { ...cube("wrist", [2, 2, 2], [4, 4, 4]), parent_id: "arm" },
    { ...cube("plate", [2, 2, 2], [4, 4, 4], [0, 45, 0]), parent_id: "torso" },
    { ...cube("leaf", [2, 2, 2], [2, 4, 4]), parent_id: "torso" },
    { ...cube("touching", [0, 2, 2], [2, 4, 4]), parent_id: "torso" },
    { ...cube("unknown", [2, 2, 2], [4, 4, 4]) },
  ];
  const observed = analyzeStaticCubeContainment([body, ...variants],
    { target_cube_ids: variants.map((item) => item.uuid) });
  expect(observed.contained_candidate_count).toBe(0);
  expect(observed.state).toBe("partial");
  // Rotated, plane-like and unknown-parent targets require separate review.
  expect(observed.unsupported_target_count).toBe(3);
});

test("bounded containment results are input-order invariant and show partial scan work", () => {
  const all = [
    { ...cube("outer", [0, 0, 0], [12, 12, 12]), parent_id: "root" },
    { ...cube("a", [1, 1, 1], [2, 2, 2]), parent_id: "root" },
    { ...cube("b", [3, 3, 3], [4, 4, 4]), parent_id: "root" },
    { ...cube("c", [5, 5, 5], [6, 6, 6]), parent_id: "root" },
  ];
  const first = analyzeStaticCubeContainment(all, { exampleLimit: 1 });
  const reversed = analyzeStaticCubeContainment([...all].reverse(), { exampleLimit: 1 });
  expect(first).toEqual(reversed);
  expect(first.contained_candidate_count).toBe(3);
  expect(first.examples).toHaveLength(1);
  expect(first.examples_truncated).toBe(true);
  const capped = analyzeStaticCubeContainment(all, { pairBudget: 1 });
  expect(capped.state).toBe("partial");
  expect(capped.checked_target_count).toBe(1);
  expect(capped.unvisited_target_count).toBeGreaterThan(0);
  expect(capped.examples_truncated).toBe(true);
});

test("multi-Cube projected coverage detects zero marginal outline without a containing Cube", () => {
  const target = { ...cube("panel", [0, 0, 0], [4, 4, 1]), parent_id: "root" };
  const left = { ...cube("left", [0, 0, 0], [2, 4, 1]), parent_id: "root" };
  const right = { ...cube("right", [2, 0, 0], [4, 4, 1]), parent_id: "root" };
  const result = analyzeStaticMarginalProjection([right, target, left], {
    target_cube_ids: ["panel"],
  });
  expect(result.state).toBe("available");
  expect(result.no_new_projected_outline_count).toBe(1);
  expect(result.examples[0]).toMatchObject({
    cube_uuid: "panel", outcome: "NO_ADDITIONAL_PROJECTED_OUTLINE",
    projected_added_ratio: { front: 0, side: 0, top: 0 },
  });
  expect(analyzeStaticCubeContainment([target, left, right], {
    target_cube_ids: ["panel"],
  }).contained_candidate_count).toBe(0);
});

test("protruding horns keep measurable marginal outlines in front and top", () => {
  const body = { ...cube("body", [0, 0, 0], [8, 8, 8]), parent_id: "root" };
  const horn = { ...cube("horn", [7, 5, 3], [10, 7, 5]), parent_id: "root" };
  const result = analyzeStaticMarginalProjection([horn, body], {
    target_cube_ids: ["horn"],
  });
  expect(result.adds_projected_outline_count).toBe(1);
  expect(result.no_new_projected_outline_count).toBe(0);
  expect(result.examples[0].outcome).toBe("ADDS_PROJECTED_OUTLINE");
  expect(result.examples[0].projected_added_ratio.front).toBeGreaterThan(0);
  expect(result.examples[0].projected_added_ratio.top).toBeGreaterThan(0);
  expect(result.examples[0].projected_added_ratio.side).toBe(0);
});

test("different bones or rotation cannot erase a target outline review", () => {
  const body = { ...cube("body", [0, 0, 0], [8, 8, 8]), parent_id: "torso" };
  const arm = { ...cube("arm", [2, 2, 2], [4, 4, 4]), parent_id: "arm" };
  const distinct = analyzeStaticMarginalProjection([body, arm], {
    target_cube_ids: ["arm"],
  });
  expect(distinct.state).toBe("available");
  expect(distinct.examples[0].projected_added_ratio.front).toBe(1);
  const rotatedPeer = { ...cube("other", [0, 0, 0], [8, 8, 8], [0, 45, 0]),
    parent_id: "arm" };
  const partial = analyzeStaticMarginalProjection([arm, rotatedPeer], {
    target_cube_ids: ["arm"],
  });
  expect(partial.state).toBe("partial");
  expect(partial.checked_target_count).toBe(0);
  expect(partial.no_new_projected_outline_count).toBe(0);
});

test("projection examples prioritize hidden contour review over many independent visible masses", () => {
  const base = { ...cube("zz_hidden", [1, 1, 1], [2, 2, 2]), parent_id: "root" };
  const outer = { ...cube("zz_shell", [0, 0, 0], [8, 8, 8]), parent_id: "root" };
  const independent = Array.from({ length: 6 }, (_, index) => ({
    ...cube("a_" + index, [20 + index * 2, 0, 0], [21 + index * 2, 1, 1]),
    parent_id: "root",
  }));
  const result = analyzeStaticMarginalProjection([...independent, outer, base],
    { exampleLimit: 1 });
  expect(result.no_new_projected_outline_count).toBeGreaterThan(0);
  expect(result.examples).toHaveLength(1);
  expect(result.examples[0].cube_uuid).toBe("zz_hidden");
  expect(result.examples_truncated).toBe(true);
});

test("extreme projected area remains partial rather than emitting nonfinite footprint metrics", () => {
  const huge = { ...cube("huge", [0, 0, 0], [1e200, 1e200, 1e200]),
    parent_id: "root" };
  const result = analyzeStaticMarginalProjection([huge]);
  expect(result.state).toBe("partial");
  expect(result.unsupported_target_count).toBe(1);
  expect(result.examples).toEqual([]);
});

test("projected union handles a hole, remains input-order stable and respects pair budget", () => {
  const data = [
    { ...cube("target", [0, 0, 0], [4, 4, 1]), parent_id: "root" },
    { ...cube("bottom", [0, 0, 0], [4, 1, 1]), parent_id: "root" },
    { ...cube("top", [0, 3, 0], [4, 4, 1]), parent_id: "root" },
  ];
  const full = analyzeStaticMarginalProjection(data, { target_cube_ids: ["target"] });
  expect(full.adds_projected_outline_count).toBe(1);
  expect(full.examples[0].projected_added_ratio.front).toBe(0.5);
  expect(analyzeStaticMarginalProjection([...data].reverse(),
    { target_cube_ids: ["target"] })).toEqual(full);
  const capped = analyzeStaticMarginalProjection(data, {
    target_cube_ids: ["target"], pairBudget: 1,
  });
  expect(capped.state).toBe("partial");
  expect(capped.checked_target_count).toBe(0);
  expect(capped.unvisited_target_count).toBe(1);
});

test("exact same-parent adjacent Cubes produce review-only merge candidates", () => {
  const left = { ...cube("left", [0, 0, 0], [2, 2, 2]),
    parent_id: "root", origin: [0, 0, 0] };
  const right = { ...cube("right", [2, 0, 0], [4, 2, 2]),
    parent_id: "root", origin: [0, 0, 0] };
  const result = analyzeStaticCubeMergeCandidates([right, left]);
  expect(result.merge_candidate_count).toBe(1);
  expect(result.examples[0]).toMatchObject({
    cube_uuids: ["left", "right"], axis: "x",
    merged_from: [0, 0, 0], merged_to: [4, 2, 2],
    requirement: "UV_TEXTURE_PIVOT_RIG_REVIEW",
  });
  expect(result.note).toContain("not permission to merge");
  const inspection = analyzeAxisAlignedSurfaceEvidence([left, right]);
  expect(inspection.rest_pose_merge_candidates.merge_candidate_count).toBe(1);
  const wrongPivot = { ...right, origin: [1, 0, 0] };
  expect(analyzeStaticCubeMergeCandidates([left, wrongPivot]).merge_candidate_count).toBe(0);
  expect(analyzeStaticCubeMergeCandidates([left,
    { ...right, parent_id: "different_bone" }]).merge_candidate_count).toBe(0);
  expect(analyzeStaticCubeMergeCandidates([left,
    { ...right, from: [2.01, 0, 0] }]).merge_candidate_count).toBe(0);
  expect(analyzeStaticCubeMergeCandidates([left,
    { ...right, inflate: 0.1 }]).merge_candidate_count).toBe(0);
});

const ORTHO_AXES: [Vec3, Vec3, Vec3] = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1],
];
const DIAGONAL_AXES: [Vec3, Vec3, Vec3] = [
  [Math.SQRT1_2, Math.SQRT1_2, 0],
  [-Math.SQRT1_2, Math.SQRT1_2, 0],
  [0, 0, 1],
];
function poseBox(
  uuid: string, parent_id: string | null, center: Vec3,
  halfSizes: Vec3, axes: [Vec3, Vec3, Vec3] = ORTHO_AXES
) {
  return { uuid, name: uuid, parent_id, obb: {
    center, axes, halfSizes,
  } satisfies OrientedBox };
}

test("current preview OBB identifies rotated enclosed geometry without claiming pose sweep", () => {
  const outer = poseBox("shell", "bone", [0, 0, 0], [5, 5, 5], DIAGONAL_AXES);
  const inside = poseBox("detail", "bone", [0, 0, 0], [1, 1, 1], DIAGONAL_AXES);
  const result = analyzeCurrentPreviewObbContainment([inside, outer]);
  expect(result.contained_candidate_count).toBe(1);
  expect(result.examples).toContainEqual(expect.objectContaining({
    cube_uuid: "detail", containing_cube_uuid: "shell",
    world_rotation_involved: true,
  }));
  expect(result.scope).toBe("single_current_preview_world_obb");
  expect(result.pose_sweep).toBe("not_evaluated");
  expect(result.visual_verdict).toBe("not_evaluated");
  expect(analyzeCurrentPreviewObbContainment([outer, inside])).toEqual(result);
});

test("a rotated protrusion or differently rigged child never becomes contained review", () => {
  const shell = poseBox("shell", "body", [0, 0, 0], [5, 5, 5], DIAGONAL_AXES);
  const horn = poseBox("horn", "body", [6, 0, 0], [1, 1, 1], DIAGONAL_AXES);
  const arm = poseBox("arm", "arm_joint", [0, 0, 0], [1, 1, 1], DIAGONAL_AXES);
  const report = analyzeCurrentPreviewObbContainment([shell, horn, arm]);
  expect(report.contained_candidate_count).toBe(0);
  expect(report.state).toBe("available");
  const nextPose = poseBox("detail", "body", [6, 0, 0], [1, 1, 1], DIAGONAL_AXES);
  expect(analyzeCurrentPreviewObbContainment([shell, nextPose])
    .contained_candidate_count).toBe(0);
});

test("missing native world matrix or partial sample never yields false complete evidence", () => {
  const shell = poseBox("shell", "body", [0, 0, 0], [5, 5, 5]);
  const unknown = { uuid: "hidden", name: "hidden", parent_id: "body",
    obb: null as OrientedBox | null };
  const result = analyzeCurrentPreviewObbContainment([shell, unknown]);
  expect(result.state).toBe("partial");
  expect(result.unsupported_target_count).toBe(2);
  expect(result.contained_candidate_count).toBe(0);
  const truncated = analyzeCurrentPreviewObbContainment([
    shell, poseBox("detail", "body", [0, 0, 0], [1, 1, 1]),
  ], { targetLimit: 1 });
  expect(truncated.state).toBe("partial");
  expect(truncated.unvisited_target_count).toBe(1);
  expect(truncated.examples_truncated).toBe(true);
  expect(() => analyzeCurrentPreviewObbContainment([shell, shell]))
    .toThrow("unique");
});

test("invalid native OBB and zero-thickness planes are unsupported even without peers", () => {
  const malformed = poseBox("bad", "arm", [0, 0, 0], [1, 1, 1]);
  malformed.obb.axes = [[1, 0, 0], [1, 0, 0], [0, 0, 1]];
  const missing = analyzeCurrentPreviewObbContainment([malformed]);
  expect(missing.state).toBe("partial");
  expect(missing.unsupported_target_count).toBe(1);
  expect(missing.checked_target_count).toBe(0);
  const plane = poseBox("leaf", "arm", [0, 0, 0], [0, 1, 1]);
  const review = analyzeCurrentPreviewObbContainment([plane]);
  expect(review.state).toBe("partial");
  expect(review.contained_candidate_count).toBe(0);
});

function animatedFrame(
  time_seconds: number,
  detailCenter: Vec3 = [0, 0, 0],
  animation_uuid = "walk"
) {
  return {
    project_uuid: "project",
    animation_uuid,
    time_seconds,
    cubes: [
      poseBox("body", "torso", [0, 0, 0], [5, 5, 5]),
      poseBox("detail", "torso", detailCenter, [1, 1, 1]),
    ],
  };
}

test("pose-aware geometry retains a Cube that becomes uncovered during an animation", () => {
  const samples = [
    animatedFrame(0),
    animatedFrame(0.5, [1, 0, 0]),
    animatedFrame(1, [6, 0, 0]),
  ];
  const report = analyzeGeometryPoseSequence(samples, {
    target_cube_ids: ["detail"],
    sampling_window: { start: 0, end: 1, max_gap_seconds: 0.5 },
  });
  expect(report.state).toBe("sampled_times_only");
  expect(report.pose_dependent_retain_count).toBe(1);
  expect(report.contained_at_sampled_poses_review_count).toBe(0);
  expect(report.geometry_mutation_authorized).toBe(false);
  expect(report.sample_provenance).toBe("not_native_attested");
  expect(report.visual_verdict).toBe("not_evaluated");
  expect(report.examples).toEqual([expect.objectContaining({
    cube_uuid: "detail",
    outcome: "POSE_DEPENDENT_RETAIN",
    time_observations: [
      { time_seconds: 0, containing_cube_uuid: "body" },
      { time_seconds: 0.5, containing_cube_uuid: "body" },
      { time_seconds: 1, containing_cube_uuid: null },
    ],
  })]);
  expect(analyzeGeometryPoseSequence([...samples].reverse(), {
    target_cube_ids: ["detail"],
    sampling_window: { start: 0, end: 1, max_gap_seconds: 0.5 },
  })).toEqual(report);
});

test("geometry enclosed at every sampled time remains review-only, not deletion eligible", () => {
  const report = analyzeGeometryPoseSequence([
    animatedFrame(0), animatedFrame(1, [2, 0, 0]),
  ], {
    target_cube_ids: ["detail"],
    sampling_window: { start: 0, end: 1, max_gap_seconds: 1 },
  });
  expect(report.state).toBe("sampled_times_only");
  expect(report.contained_at_sampled_poses_review_count).toBe(1);
  expect(report.examples[0].outcome).toBe("CONTAINED_AT_SAMPLED_POSES_REVIEW");
  expect(report.geometry_mutation_authorized).toBe(false);
  expect(report.note).toContain("Never auto-delete");
  const onePose = analyzeGeometryPoseSequence([animatedFrame(0)], {
    target_cube_ids: ["detail"],
  });
  expect(onePose.state).toBe("insufficient_pose_samples");
  expect(onePose.examples[0].outcome).toBe("UNVERIFIED");
  expect(onePose.examples[0].reason).toBe("ADDITIONAL_POSE_OBSERVATIONS_REQUIRED");
});

test("rotation can expose Geometry that was enclosed at another animated pose", () => {
  const frame = (time_seconds: number,
    axes: [Vec3, Vec3, Vec3]) => ({
    project_uuid: "entity", animation_uuid: "wave", time_seconds,
    cubes: [
      poseBox("torso", "body", [0, 0, 0], [2, 4, 4]),
      poseBox("wing", "body", [0, 0, 0], [3, 0.5, 0.5], axes),
    ],
  });
  // Long axis points along world Z at rest (fits within body), then
  // rotates into world X (protrudes outside the torso envelope).
  const alongZ: [Vec3, Vec3, Vec3] = [
    [0, 0, 1], [0, 1, 0], [-1, 0, 0],
  ];
  const result = analyzeGeometryPoseSequence([
    frame(0, alongZ), frame(1, ORTHO_AXES),
  ], {
    target_cube_ids: ["wing"],
    sampling_window: { start: 0, end: 1, max_gap_seconds: 1 },
  });
  expect(result.pose_dependent_retain_count).toBe(1);
  expect(result.examples[0].time_observations).toEqual([
    { time_seconds: 0, containing_cube_uuid: "torso" },
    { time_seconds: 1, containing_cube_uuid: null },
  ]);
  expect(result.geometry_mutation_authorized).toBe(false);
});

test("geometry from different bones is never erased by another bone's envelope", () => {
  const samples = [0, 1].map((time_seconds) => ({
    project_uuid: "project", animation_uuid: "walk", time_seconds,
    cubes: [
      poseBox("body", "torso", [0, 0, 0], [5, 5, 5]),
      poseBox("arm", "arm_bone", [0, 0, 0], [1, 1, 1]),
    ],
  }));
  const report = analyzeGeometryPoseSequence(samples, {
    target_cube_ids: ["arm"],
    sampling_window: { start: 0, end: 1, max_gap_seconds: 1 },
  });
  expect(report.no_containment_observed_count).toBe(1);
  expect(report.pose_dependent_retain_count).toBe(0);
});

test("pose sample identity, incomplete windows and invalid OBBs fail closed", () => {
  const base = animatedFrame(0);
  const next = animatedFrame(1);
  expect(() => analyzeGeometryPoseSequence([base, { ...next, animation_uuid: "other" }]))
    .toThrow("GEOMETRY_POSE_CROSS_PROJECT_OR_ANIMATION");
  expect(() => analyzeGeometryPoseSequence([base, { ...next, time_seconds: 0 }]))
    .toThrow("GEOMETRY_POSE_TIME_INVALID_OR_DUPLICATED");
  const absent = analyzeGeometryPoseSequence([
    base, { ...next, cubes: next.cubes.slice(0, 1) },
  ], { target_cube_ids: ["detail"] });
  expect(absent.state).toBe("partial");
  expect(absent.unverified_target_count).toBe(1);
  const invalid = analyzeGeometryPoseSequence([
    base, { ...next, cubes: next.cubes.map((cube) =>
      cube.uuid === "body" ? { ...cube, obb: null } : cube
    ) },
  ], { target_cube_ids: ["detail"] });
  expect(invalid.state).toBe("partial");
  expect(invalid.examples[0].outcome).toBe("UNVERIFIED");
  const window = analyzeGeometryPoseSequence([base, next], {
    target_cube_ids: ["detail"],
    sampling_window: { start: 0, end: 1, max_gap_seconds: 0.25 },
  });
  expect(window.state).toBe("partial");
  expect(window.sampling_window_coverage).toBe("incomplete");
  const capped = analyzeGeometryPoseSequence([base, next], {
    target_cube_ids: ["detail"], pairBudget: 1,
  });
  expect(capped.state).toBe("partial");
  expect(capped.examples[0].outcome).toBe("UNVERIFIED");
  expect(capped.examples_truncated).toBe(true);
});

test("unsupported transforms remain partial rather than false-clean", () => {
  const result = analyzeAxisAlignedSurfaceEvidence([
    cube("rotated", [0, 0, 0], [4, 4, 4], [0, 45, 0]),
  ]);
  expect(result.complete).toBe(false);
  expect(result.excluded_rotated_cube_count).toBe(1);
  expect(result.state).toBe("partial");
});

import { expect, test } from "bun:test";
import {
  analyzeAxisAlignedSurfaceEvidence,
  analyzeStaticCubeContainment,
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

test("unsupported transforms remain partial rather than false-clean", () => {
  const result = analyzeAxisAlignedSurfaceEvidence([
    cube("rotated", [0, 0, 0], [4, 4, 4], [0, 45, 0]),
  ]);
  expect(result.complete).toBe(false);
  expect(result.excluded_rotated_cube_count).toBe(1);
  expect(result.state).toBe("partial");
});

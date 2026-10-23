import { describe, expect, test } from "bun:test";
import {
  analyzeTextureCoverage,
  analyzeTextureOptimizationOpportunities,
} from "@/lib/textureOptimization";
import {
  analyzeAnimationQuality,
  planLinearKeyframeReduction,
  compactLinearCreationKeyframes,
} from "@/lib/animationQuality";

function rgba(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values.flatMap((value) => [value, 0, 0, 255]));
}

function borderedPatch(size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const value = border ? 96 : 100;
      pixels.set([value, 0, 0, 255], offset);
    }
  }
  return pixels;
}

describe("usage-efficient authoring intelligence", () => {
  test("an empty texture scan cannot advertise readiness", () => {
    const result = analyzeTextureCoverage([]);
    expect(result.gate.state).toBe("incomplete");
    expect(result.gate.reasons).toContain("NO_MAPPED_FACES");
    expect(result.visual_verdict).toBe("not_evaluated");
  });

  test("flat-face review identifies the largest affected surfaces without a style verdict", () => {
    const patches = [4, 8].map((size) => ({
      cube_uuid: `cube-${size}`, cube_name: `panel-${size}`, face: "north",
      texture_uuid: "atlas", texture_name: "atlas", uv: [0, 0, size, size],
      width: size, height: size, pixels: rgba(Array(size * size).fill(100)),
    }));
    const result = analyzeTextureCoverage(patches, [], 1);
    expect(result.review.solid_color_faces.count).toBe(2);
    expect(result.review.solid_color_faces.examples[0].cube_uuid).toBe("cube-8");
    expect(result.review.solid_color_faces.examples_truncated).toBe(true);
    expect(result.gate.state).toBe("review_required");
    expect(result.visual_verdict).toBe("not_evaluated");
  });

  test("loop diagnostics distinguish unevaluated expression and single-key tracks", () => {
    const result = analyzeAnimationQuality({ loop_mode: "loop", length: 1, tracks: [
      { group_uuid: "a", group_name: "a", is_root: false, channel: "rotation",
        keyframes: [{ time: 0, value: [0, 0, 0] }] },
      { group_uuid: "b", group_name: "b", is_root: false, channel: "rotation",
        keyframes: [{ time: 0, value: ["math.sin(query.anim_time)", 0, 0] },
          { time: 1, value: ["math.sin(query.anim_time)", 0, 0] }] },
    ] });
    if (result.state !== "available") throw new Error("expected diagnostics");
    expect(result.loop_seam.numeric_evaluated_track_count).toBe(0);
    expect(result.loop_seam.insufficient_key_track_count).toBe(1);
    expect(result.loop_seam.non_numeric_boundary_track_count).toBe(1);
    expect(result.visual_verdict).toBe("not_evaluated");
  });
  test("detects pixel-identical UV regions across rotation without requiring pairwise tool calls", () => {
    const result = analyzeTextureOptimizationOpportunities([
      {
        cube_uuid: "cube-a",
        cube_name: "panel_a",
        face: "north",
        texture_uuid: "texture",
        texture_name: "atlas",
        uv: [0, 0, 2, 3],
        width: 2,
        height: 3,
        pixels: rgba([1, 2, 3, 4, 5, 6]),
      },
      {
        cube_uuid: "cube-b",
        cube_name: "panel_b",
        face: "north",
        texture_uuid: "texture",
        texture_name: "atlas",
        uv: [2, 0, 5, 2],
        width: 3,
        height: 2,
        pixels: rgba([5, 3, 1, 6, 4, 2]),
      },
    ]);

    expect(result.state).toBe("available");
    expect(result.uv_stack_opportunities.group_count).toBe(1);
    expect(result.uv_stack_opportunities.examples[0].face_count).toBe(2);
    expect(result.uv_stack_opportunities.examples[0].distinct_uv_region_count).toBe(2);
  });

  test("does not report already-shared UV coordinates as a new stack opportunity", () => {
    const pixels = rgba([1, 2, 3, 4]);
    const result = analyzeTextureOptimizationOpportunities([
      {
        cube_uuid: "cube-a",
        cube_name: "a",
        face: "north",
        texture_uuid: "texture",
        texture_name: "atlas",
        uv: [0, 0, 2, 2],
        width: 2,
        height: 2,
        pixels,
      },
      {
        cube_uuid: "cube-b",
        cube_name: "b",
        face: "south",
        texture_uuid: "texture",
        texture_name: "atlas",
        uv: [0, 0, 2, 2],
        width: 2,
        height: 2,
        pixels,
      },
    ]);

    expect(result.uv_stack_opportunities.group_count).toBe(0);
  });

  test("transparent and solid face candidates share the same bounded scan with coverage", () => {
    const result = analyzeTextureOptimizationOpportunities(
      [
        {
          cube_uuid: "transparent",
          cube_name: "transparent",
          face: "north",
          texture_uuid: "texture",
          texture_name: "atlas",
          uv: [0, 0, 2, 2],
          width: 2,
          height: 2,
          pixels: new Uint8ClampedArray(2 * 2 * 4),
        },
        {
          cube_uuid: "solid",
          cube_name: "solid",
          face: "north",
          texture_uuid: "texture",
          texture_name: "atlas",
          uv: [2, 0, 6, 4],
          width: 4,
          height: 4,
          pixels: new Uint8ClampedArray(
            Array.from({ length: 16 }, () => [64, 32, 16, 255]).flat()
          ),
        },
      ],
      [
        {
          kind: "budget",
          cube_uuid: "omitted",
          cube_name: "omitted",
          face: "north",
        },
      ]
    );

    expect(result.state).toBe("partial");
    expect(result.transparent_faces.count).toBe(1);
    expect(result.solid_color_faces.count).toBe(1);
    expect(result.scan.omission_counts.budget).toBe(1);
    expect(result.coverage.gate.state).toBe("partial");
    expect(result.coverage.gate.reasons).toContain("SCAN_BUDGET_EXHAUSTED");
    expect(result.coverage.gate.reasons).toContain("TRANSPARENT_FACE_REVIEW");
    expect(result.coverage.gate.reasons).toContain("FLAT_FACE_REVIEW");
    expect(result.coverage.review.transparent_face_count).toBe(1);
    expect(result.coverage.review.detail_capable_solid_face_count).toBe(1);
    expect(result.efficiency.pixel_scan_reused_for_coverage).toBe(true);
  });

  test("coverage catches template-like border-only faces and blocks incomplete accounting", () => {
    const coverage = analyzeTextureCoverage(
      [
        {
          cube_uuid: "template-like",
          cube_name: "template_like_panel",
          face: "north",
          texture_uuid: "texture",
          texture_name: "atlas",
          uv: [0, 0, 8, 8],
          width: 8,
          height: 8,
          pixels: borderedPatch(8),
        },
      ],
      [
        {
          kind: "blank",
          cube_uuid: "missing",
          cube_name: "missing_panel",
          face: "south",
        },
      ]
    );

    expect(coverage.states.low_variation).toBe(1);
    expect(coverage.review.low_variation_faces.count).toBe(1);
    expect(coverage.review.low_variation_faces.examples[0].border_only_variation).toBe(true);
    expect(coverage.gate.state).toBe("incomplete");
    expect(coverage.gate.reasons).toContain("FACE_ACCOUNTING_INCOMPLETE");
    expect(coverage.omissions.counts.blank).toBe(1);
  });

  test("coverage becomes ready for visual verification when every scanned face has interior variation", () => {
    const coverage = analyzeTextureCoverage([
      {
        cube_uuid: "styled",
        cube_name: "styled_panel",
        face: "north",
        texture_uuid: "texture",
        texture_name: "atlas",
        uv: [0, 0, 4, 4],
        width: 4,
        height: 4,
        pixels: rgba([
          10, 20, 30, 40,
          50, 60, 70, 80,
          90, 100, 110, 120,
          130, 140, 150, 160,
        ]),
      },
    ]);

    expect(coverage.gate.state).toBe("ready");
    expect(coverage.states.varied).toBe(1);
    expect(coverage.visual_verdict).toBe("not_evaluated");
    expect(coverage.review.candidate_face_count).toBe(0);
    expect(coverage.accounted_ratio).toBe(1);
  });

  test("loop diagnostics flag non-root seam discontinuity but preserve root locomotion", () => {
    const result = analyzeAnimationQuality({
      loop_mode: "loop",
      length: 1,
      tracks: [
        {
          group_uuid: "root",
          group_name: "root",
          is_root: true,
          channel: "position",
          keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 1, value: [16, 0, 0] },
          ],
        },
        {
          group_uuid: "arm",
          group_name: "arm",
          is_root: false,
          channel: "rotation",
          keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 1, value: [5, 0, 0] },
          ],
        },
      ],
    });

    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected animation quality");
    expect(result.loop_seam.review_track_count).toBe(1);
    expect(result.loop_seam.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classification: "root_locomotion_observation" }),
        expect.objectContaining({ group_uuid: "arm", classification: "seam_review" }),
      ])
    );
  });

  test("create-animation compaction removes exact collinear channel keys without changing other tracks", () => {
    const original = [0, 0.25, 0.5, 0.75, 1].map((time) => ({
      time,
      position: [time * 8, 0, 0],
      rotation: [0, time === 0.5 ? 30 : 0, 0],
    }));
    const copy = structuredClone(original);
    const result = compactLinearCreationKeyframes(original, [0.25]);
    expect(result.removed_by_channel).toEqual({ position: 2, rotation: 0, scale: 0 });
    expect(result.frames.map((frame) => frame.time)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(result.frames.find((frame) => frame.time === 0.25)?.position).toEqual([2, 0, 0]);
    expect(result.frames.find((frame) => frame.time === 0.5)?.position).toBeUndefined();
    expect(result.frames.find((frame) => frame.time === 0.5)?.rotation).toEqual([0, 30, 0]);
    expect(original).toEqual(copy);
  });

  test("exact-linear compression reduces creation payload with no effect markers", () => {
    const values = [0, 0.25, 0.5, 0.75, 1].map((time) => ({
      time, position: [time * 4, 0, 0],
    }));
    const reduced = compactLinearCreationKeyframes(values);
    expect(reduced.frames.map((f) => f.time)).toEqual([0, 1]);
    expect(reduced.removed_channel_key_count).toBe(3);
    const protectedResult = compactLinearCreationKeyframes(values, [0.5]);
    expect(protectedResult.frames.map((f) => f.time)).toEqual([0, 0.5, 1]);
  });

  test("creation compaction keeps curved impact and scalar/vector scale semantics", () => {
    const impact = [
      { time: 0, position: [0, 0, 0] },
      { time: 0.5, position: [5, 0, 0] },
      { time: 1, position: [0, 0, 0] },
    ];
    expect(compactLinearCreationKeyframes(impact).removed_channel_key_count).toBe(0);
    const scale = [
      { time: 0, scale: 1 },
      { time: 0.5, scale: [1.5, 1.5, 1.5] },
      { time: 1, scale: 2 },
    ];
    expect(compactLinearCreationKeyframes(scale).removed_channel_key_count).toBe(0);
    expect(compactLinearCreationKeyframes([
      { time: 0, scale: 1 },
      { time: 0.5, scale: 1.5 },
      { time: 1, scale: 2 },
    ]).frames.map((f) => f.time)).toEqual([0, 1]);
  });

  test("strict linear numeric key reduction is read-only and protects authored times", () => {
    const keys = [0, 0.25, 0.5, 0.75, 1].map((time) => ({
      time, value: [10 * time, 0, 0],
      interpolation: "linear", has_multiple_data_points: false,
    }));
    const plan = planLinearKeyframeReduction("position", keys);
    expect(plan.state).toBe("candidate");
    expect(plan.candidate_times).toEqual([0.25, 0.5, 0.75]);
    expect(plan.candidate_count).toBe(3);
    expect(plan.max_error).toBeLessThanOrEqual(1e-8);
    expect(keys).toHaveLength(5);
    expect(planLinearKeyframeReduction("position", keys, { protected_times: [0.5] }).candidate_times)
      .toEqual([0.25, 0.75]);
  });

  test("nonlinear, Bezier, Molang, pre/post and duplicated times are never reduced", () => {
    const key = (time: number, value: readonly unknown[], interpolation = "linear",
      has_multiple_data_points = false) =>
      ({ time, value, interpolation, has_multiple_data_points });
    expect(planLinearKeyframeReduction("position", [
      key(0, [0, 0, 0]), key(0.5, [2, 0, 0]), key(1, [0, 0, 0]),
    ]).candidate_count).toBe(0);
    for (const unsafe of [
      [key(0, [0, 0, 0]), key(0.5, [1, 0, 0], "bezier"), key(1, [2, 0, 0])],
      [key(0, [0, 0, 0]), key(0.5, ["query.anim_time", 0, 0]), key(1, [2, 0, 0])],
      [key(0, [0, 0, 0]), key(0.5, [1, 0, 0], "linear", true), key(1, [2, 0, 0])],
      [key(0, [0, 0, 0]), key(0.5, [1, 0, 0]), key(0.5, [2, 0, 0])],
    ]) expect(planLinearKeyframeReduction("position", unsafe).state).toBe("unverified");
    expect(planLinearKeyframeReduction("rotation", [
      key(0, [0, -179, 0]), key(0.5, [0, 0, 0]), key(1, [0, 179, 0]),
    ]).candidate_count).toBe(0);
  });

  test("animation quality reports bounded savings candidates, not native PASS", () => {
    const keys = [0, 0.25, 0.5, 0.75, 1].map((time) => ({
      time, value: [time * 8, 0, 0],
      interpolation: "linear", has_multiple_data_points: false,
    }));
    const result = analyzeAnimationQuality({ loop_mode: "once", length: 1, tracks: [
      { group_uuid: "arm", group_name: "arm", is_root: false,
        channel: "position", keyframes: keys },
    ] });
    if (result.state !== "available") throw Error("expected diagnostics");
    expect(result.keyframe_efficiency.candidate_keyframe_count).toBe(3);
    expect(result.keyframe_efficiency.examples[0].candidate_times).toEqual([0.25, 0.5, 0.75]);
    expect(result.visual_verdict).toBe("not_evaluated");
  });

  test("directional texture coverage retains small underside defects", () => {
    const make = (face: string, size: number, flat: boolean) => ({
      cube_uuid: face, cube_name: face, face,
      texture_uuid: "atlas", texture_name: "atlas", uv: [0, 0, size, size],
      width: size, height: size,
      pixels: rgba(Array.from({ length: size * size }, (_, i) => flat ? 64 : (i % 240))),
    });
    const result = analyzeTextureCoverage([
      make("north", 16, false), make("down", 4, true),
    ], [{ kind: "blank", cube_uuid: "upper", cube_name: "upper", face: "up" }]);
    expect(result.gate.state).toBe("incomplete");
    const directions = result.cube_local_face_coverage.directions;
    expect(directions.map((entry) => entry.local_face)).toEqual(["down", "up", "north"]);
    expect(directions[0]).toMatchObject({
      scanned: 1, detail_capable_flat: 1,
      review_example: { cube_uuid: "down", reason: "FLAT_FACE_REVIEW" },
    });
    expect(directions[1]).toMatchObject({
      omitted: 1, review_example: { cube_uuid: "upper", reason: "SCAN_OMISSION:blank" },
    });
  });

  test("cadence diagnostics remain advisory and do not invent a failure", () => {
    const result = analyzeAnimationQuality({
      loop_mode: "once",
      length: 2,
      tracks: [
        {
          group_uuid: "arm",
          group_name: "arm",
          is_root: false,
          channel: "rotation",
          keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.05, value: [1, 0, 0] },
            { time: 2, value: [2, 0, 0] },
          ],
        },
      ],
    });

    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected animation quality");
    expect(result.loop_seam.applicable).toBe(false);
    expect(result.loop_seam.review_track_count).toBe(0);
    expect(result.cadence.high_variability_track_count).toBe(1);
  });
});

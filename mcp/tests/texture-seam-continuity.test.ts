import { describe, expect, test } from "bun:test";
import {
  analyzeTextureSeamContinuity,
  analyzeCrossCubeSeamContinuity,
  type TextureSeamEdgeInput,
  type CrossCubeSeamEdgeInput,
} from "@/lib/textureSeamContinuity";

function edge(
  overrides: Partial<TextureSeamEdgeInput> = {}
): TextureSeamEdgeInput {
  return {
    cube_uuid: "cube-a",
    cube_name: "Cube A",
    face: "north",
    edge: "right",
    start: [1, 0, 0],
    end: [1, 1, 0],
    samples: [
      [20, 20, 20, 255],
      [20, 20, 20, 255],
      [20, 20, 20, 255],
      [20, 20, 20, 255],
    ],
    ...overrides,
  };
}

describe("texture seam continuity", () => {
  test("reports intra-Cube scope instead of certifying coincident edges on different Cubes", () => {
    const result = analyzeTextureSeamContinuity([
      edge(), edge({ cube_uuid: "cube-b", face: "east", samples: [[255, 255, 255, 255]] }),
    ]);
    expect(result.scope).toBe("intra_cube");
    expect(result.cross_cube_continuity).toBe("not_evaluated");
    expect(result.paired_seam_count).toBe(0);
    expect(result.unpaired_edge_count).toBe(2);
  });
  test("pairs reversed physical edges and ranks strong contrast as advisory review", () => {
    const result = analyzeTextureSeamContinuity([
      edge(),
      edge({
        face: "east",
        edge: "left",
        start: [1, 1, 0],
        end: [1, 0, 0],
        samples: [
          [240, 240, 240, 255],
          [240, 240, 240, 255],
          [240, 240, 240, 255],
          [240, 240, 240, 255],
        ],
      }),
    ]);

    expect(result.paired_seam_count).toBe(1);
    expect(result.review.candidate_count).toBe(1);
    expect(result.gate.state).toBe("advisory");
    expect(result.gate.reasons).toContain("SEAM_CONTINUITY_REVIEW");
    expect(result.review.examples[0].faces.map((item) => item.face)).toEqual([
      "north",
      "east",
    ]);
  });

  test("matching edge pixels do not create a seam review candidate", () => {
    const result = analyzeTextureSeamContinuity([
      edge(),
      edge({
        face: "east",
        edge: "left",
        start: [1, 1, 0],
        end: [1, 0, 0],
      }),
    ]);

    expect(result.paired_seam_count).toBe(1);
    expect(result.review.candidate_count).toBe(0);
    expect(result.gate.reasons).toEqual([]);
  });

  test("unpaired outer edges remain inventory rather than false seam failures", () => {
    const result = analyzeTextureSeamContinuity([edge()]);
    expect(result.paired_seam_count).toBe(0);
    expect(result.unpaired_edge_count).toBe(1);
    expect(result.review.candidate_count).toBe(0);
  });
});


describe("cross-Cube seam continuity diagnostics", () => {
  function cross(overrides: Partial<CrossCubeSeamEdgeInput> = {}): CrossCubeSeamEdgeInput {
    return {
      ...edge(),
      cube_uuid: "cube-left",
      cube_name: "Left",
      material_id: "wood",
      surface_id: "front_panel",
      world_normal: [0, 0, -1],
      continuity_intent: "REQUIRED",
      samples: [[20, 20, 20, 255], [20, 20, 20, 255], [20, 20, 20, 255]],
      ...overrides,
    };
  }
  const adjoining = (overrides: Partial<CrossCubeSeamEdgeInput> = {}) => cross({
    cube_uuid: "cube-right", cube_name: "Right",
    edge: "left", start: [1, 1, 0], end: [1, 0, 0],
    ...overrides,
  });

  test("compares two declared same-facing continuous Cube edges as advisory only", () => {
    const result = analyzeCrossCubeSeamContinuity([
      cross(), adjoining({ samples: [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]] }),
    ]);
    expect(result.scope).toBe("cross_cube");
    expect(result.compared_pair_count).toBe(1);
    expect(result.cross_cube_continuity).toBe("diagnostic_only");
    expect(result.visual_verdict).toBe("not_evaluated");
    expect(result.native_sampling_attested).toBe(false);
    expect(result.review.candidate_count).toBe(1);
    expect(result.gate.state).toBe("advisory");
    expect(result.review.examples[0].cubes.map((item) => item.uuid))
      .toEqual(["cube-left", "cube-right"]);
  });

  test("reverses samples along a physically reversed Cube edge", () => {
    const result = analyzeCrossCubeSeamContinuity([
      cross({ samples: [[5, 5, 5, 255], [70, 70, 70, 255], [140, 140, 140, 255]] }),
      adjoining({ samples: [[140, 140, 140, 255], [70, 70, 70, 255], [5, 5, 5, 255]] }),
    ]);
    expect(result.compared_pair_count).toBe(1);
    expect(result.ranked_examples[0].mean_rgb_difference).toBe(0);
    expect(result.review.candidate_count).toBe(0);
  });

  test("invisible RGB mismatches never create false contrast alerts", () => {
    const result = analyzeCrossCubeSeamContinuity([
      cross({ samples: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }),
      adjoining({ samples: [[255, 255, 255, 0], [255, 255, 255, 0], [255, 255, 255, 0]] }),
    ]);
    expect(result.compared_pair_count).toBe(1);
    expect(result.ranked_examples[0].rgb_evaluated_sample_count).toBe(0);
    expect(result.ranked_examples[0].mean_rgb_difference).toBeNull();
    expect(result.review.candidate_count).toBe(0);
  });

  test("one-sided alpha holes remain review candidates without visible RGB samples", () => {
    const result = analyzeCrossCubeSeamContinuity([
      cross({ samples: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }),
      adjoining({ samples: [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]] }),
    ]);
    expect(result.ranked_examples[0].rgb_evaluated_sample_count).toBe(0);
    expect(result.ranked_examples[0].alpha_discontinuity).toBe(true);
    expect(result.review.candidate_count).toBe(1);
  });

  test("intentional material boundary is not a seam defect", () => {
    const result = analyzeCrossCubeSeamContinuity([
      cross(), adjoining({ continuity_intent: "INTENTIONAL_BOUNDARY", material_id: "iron" }),
    ]);
    expect(result.compared_pair_count).toBe(0);
    expect(result.exclusions.INTENTIONAL_BOUNDARY).toBe(1);
    expect(result.gate.reasons).toEqual([]);
  });

  test("does not merge undeclared or conflicting material/surface identities", () => {
    const unknown = analyzeCrossCubeSeamContinuity([cross(), adjoining({ continuity_intent: "UNSPECIFIED" })]);
    const mixed = analyzeCrossCubeSeamContinuity([cross(), adjoining({ surface_id: "other_panel" })]);
    expect(unknown.exclusions.CONTINUITY_UNDECLARED).toBe(1);
    expect(mixed.exclusions.SURFACE_OR_MATERIAL_MISMATCH).toBe(1);
    expect(unknown.review.candidate_count).toBe(0);
    expect(mixed.review.candidate_count).toBe(0);
  });

  test("rejects perpendicular faces and under-sampled data as comparable seams", () => {
    expect(analyzeCrossCubeSeamContinuity([
      cross(), adjoining({ world_normal: [1, 0, 0] }),
    ]).exclusions.NORMAL_ALIGNMENT_UNVERIFIED).toBe(1);
    expect(analyzeCrossCubeSeamContinuity([
      cross(), adjoining({ samples: [[20, 20, 20, 255], [20, 20, 20, 255]] }),
    ]).exclusions.SAMPLE_ALIGNMENT_UNVERIFIED).toBe(1);
  });

  test("pairs edges across quantization boundaries when physical endpoints remain within epsilon", () => {
    // 1.000005 is the old 1e-5 rounding boundary. Difference is only 2e-7.
    const result = analyzeCrossCubeSeamContinuity([
      cross({ start: [1.0000049, 0, 0], end: [1.0000049, 1, 0] }),
      adjoining({
        start: [1.0000051, 1, 0], end: [1.0000051, 0, 0],
        samples: [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]],
      }),
    ]);
    expect(result.compared_pair_count).toBe(1);
    expect(result.unpaired_edge_count).toBe(0);
    expect(result.review.candidate_count).toBe(1);
    expect(result.visual_verdict).toBe("not_evaluated");
  });

  test("intentional boundary remains excluded even when endpoint tolerance groups it", () => {
    const result = analyzeCrossCubeSeamContinuity([
      cross({ start: [1.0000049, 0, 0], end: [1.0000049, 1, 0] }),
      adjoining({
        continuity_intent: "INTENTIONAL_BOUNDARY", material_id: "metal",
        start: [1.0000051, 1, 0], end: [1.0000051, 0, 0],
        samples: [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]],
      }),
    ]);
    expect(result.exclusions.INTENTIONAL_BOUNDARY).toBe(1);
    expect(result.compared_pair_count).toBe(0);
    expect(result.review.candidate_count).toBe(0);
    expect(result.gate.reasons).toEqual([]);
  });

  test("nearby-but-separated world edges remain unresolved even when rounded keys used to match", () => {
    const result = analyzeCrossCubeSeamContinuity([
      cross({ start: [1.000002, 0, 0], end: [1.000002, 1, 0] }),
      adjoining({ start: [1.000004, 1, 0], end: [1.000004, 0, 0] }),
    ]);
    expect(result.compared_pair_count).toBe(0);
    expect(result.unpaired_edge_count).toBe(2);
    expect(result.review.candidate_count).toBe(0);
  });

  test("tolerance-chain with three candidate edges stays ambiguous instead of arbitrarily paired", () => {
    const result = analyzeCrossCubeSeamContinuity([
      cross({ start: [1.0000044, 0, 0], end: [1.0000044, 1, 0] }),
      adjoining({ start: [1.0000050, 1, 0], end: [1.0000050, 0, 0] }),
      adjoining({
        cube_uuid: "cube-third",
        start: [1.0000056, 1, 0], end: [1.0000056, 0, 0],
      }),
    ]);
    expect(result.ambiguous_group_count).toBe(1);
    expect(result.compared_pair_count).toBe(0);
    expect(result.review.candidate_count).toBe(0);
  });

  test("bounded repeated endpoints are grouped without claiming false clean seams", () => {
    const edges = Array.from({ length: 256 }, (_, i) =>
      cross({ cube_uuid: "repeat-" + i })
    );
    const result = analyzeCrossCubeSeamContinuity(edges);
    expect(result.ambiguous_group_count).toBe(1);
    expect(result.compared_pair_count).toBe(0);
    expect(result.input_edge_count).toBe(256);
  });

  test("near-but-not-touching edges and T-junctions remain unresolved", () => {
    const offset = analyzeCrossCubeSeamContinuity([
      cross(), adjoining({ start: [1 + 5e-6, 1, 0], end: [1 + 5e-6, 0, 0] }),
    ]);
    expect(offset.compared_pair_count).toBe(0);
    const tee = analyzeCrossCubeSeamContinuity([
      cross(), adjoining({ start: [1, 0.5, 0], end: [1, 0, 0] }),
    ]);
    expect(tee.compared_pair_count).toBe(0);
    expect(tee.unpaired_edge_count).toBe(2);
  });

  test("duplicate edges are ambiguous instead of double-counted", () => {
    const result = analyzeCrossCubeSeamContinuity([cross(), adjoining(), adjoining({ cube_uuid: "cube-third" })]);
    expect(result.ambiguous_group_count).toBe(1);
    expect(result.compared_pair_count).toBe(0);
  });

  test("separate Cube and same Cube owners remain distinct", () => {
    const crossResult = analyzeCrossCubeSeamContinuity([cross(), adjoining({ cube_uuid: "cube-left" })]);
    expect(crossResult.exclusions.SAME_CUBE).toBe(1);
    expect(crossResult.compared_pair_count).toBe(0);
    expect(analyzeTextureSeamContinuity([edge(), edge({ cube_uuid: "cube-b" })]).cross_cube_continuity)
      .toBe("not_evaluated");
  });

  test("malformed endpoints, normals, samples, and budgets fail closed", () => {
    const bad = [
      cross({ world_normal: [0, 0, 0] }),
      cross({ start: [1, 1, 0], end: [1, 1, 0] }),
      cross({ samples: [[20, 20, 20, 255]] }),
      cross({ cube_uuid: "" }),
      cross({ start: [31_000_000, 0, 0] }),
    ];
    for (const item of bad) {
      expect(() => analyzeCrossCubeSeamContinuity([item])).toThrow();
    }
    expect(() => analyzeCrossCubeSeamContinuity([cross()], 0)).toThrow();
    expect(() => analyzeCrossCubeSeamContinuity(Array.from({ length: 2049 }, () => cross()))).toThrow();
  });
});

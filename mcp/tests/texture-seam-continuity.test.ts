import { describe, expect, test } from "bun:test";
import {
  analyzeTextureSeamContinuity,
  analyzeCrossCubeSeamContinuity,
  projectNativeCubeSeamEdgeToWorld,
  summarizeTextureSeamScanEvidence,
  summarizeTextureModelFaceInventory,
  type TextureModelFaceInventoryInput,
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
  test("bounded seam coverage never attests whole-scene or cross-Cube visual quality", () => {
    const scan = summarizeTextureSeamScanEvidence({
      face_budget: 64,
      scanned_faces: 3,
      skipped_animated_faces: 0,
      skipped_mapping_faces: 0,
      budget_skipped_faces: 0,
      samples_per_edge_max: 4,
    });
    expect(scan.coverage_state).toBe("edge_samples_only");
    expect(scan.eligible_textured_face_count).toBe(3);
    expect(scan.unexamined_face_count).toBe(0);
    expect(scan.scene_coverage_attested).toBe(false);
    expect(scan.cross_cube_sampling_attested).toBe(false);
    expect(scan.visual_verdict).toBe("not_evaluated");
    expect(scan.limitations).toContain("CROSS_CUBE_NATIVE_SEAMS_NOT_EVALUATED");
    const none = summarizeTextureSeamScanEvidence({
      face_budget: 64, scanned_faces: 0,
      skipped_animated_faces: 0, skipped_mapping_faces: 0,
      budget_skipped_faces: 0, samples_per_edge_max: 4,
    });
    expect(none.coverage_state).toBe("not_evaluated");
    expect(none.scene_coverage_attested).toBe(false);
  });

  test("seam omission ledger identifies bounded skipped faces, not a false clean result", () => {
    const scan = summarizeTextureSeamScanEvidence({
      face_budget: 64, scanned_faces: 2,
      skipped_animated_faces: 1, skipped_mapping_faces: 2,
      budget_skipped_faces: 3, samples_per_edge_max: 4,
      skipped_examples: [
        { cube_uuid: "head", face: "north", reason: "animated_texture" },
        { cube_uuid: "cuff", face: "down", reason: "mapping_unavailable" },
        { cube_uuid: "wing", face: "west", reason: "sampling_budget" },
      ],
    });
    expect(scan.coverage_state).toBe("partial");
    expect(scan.eligible_textured_face_count).toBe(8);
    expect(scan.unexamined_face_count).toBe(6);
    expect(scan.omission_examples).toHaveLength(3);
    expect(scan.omission_examples_truncated).toBe(true);
    expect(scan.limitations).toEqual(expect.arrayContaining([
      "EDGE_SAMPLES_NOT_FULL_FACE_COVERAGE",
      "CROSS_CUBE_NATIVE_SEAMS_NOT_EVALUATED",
      "ANIMATED_FACES_UNEVALUATED",
      "FACE_UV_MAPPING_UNEVALUATED",
      "SAMPLING_BUDGET_EXHAUSTED",
    ]));
    const noneScanned = summarizeTextureSeamScanEvidence({
      face_budget: 64, scanned_faces: 0,
      skipped_animated_faces: 0, skipped_mapping_faces: 1,
      budget_skipped_faces: 0, samples_per_edge_max: 4,
    });
    expect(noneScanned.coverage_state).toBe("not_evaluated");
    expect(noneScanned.unexamined_face_count).toBe(1);
  });

  test("seam scan evidence refuses impossible counts and invented skipped-face examples", () => {
    const base = {
      face_budget: 64, scanned_faces: 2,
      skipped_animated_faces: 0, skipped_mapping_faces: 1,
      budget_skipped_faces: 0, samples_per_edge_max: 4,
    };
    expect(() => summarizeTextureSeamScanEvidence({
      ...base, scanned_faces: 65,
    })).toThrow("valid bounded face and sample counts");
    expect(() => summarizeTextureSeamScanEvidence({
      ...base, skipped_mapping_faces: -1,
    })).toThrow();
    expect(() => summarizeTextureSeamScanEvidence({
      ...base, skipped_examples: [
        { cube_uuid: "cube", face: "north", reason: "invalid" as never },
      ],
    })).toThrow("omission evidence");
    expect(() => summarizeTextureSeamScanEvidence({
      ...base, skipped_examples: [
        { cube_uuid: "cube", face: "north", reason: "mapping_unavailable" },
        { cube_uuid: "other", face: "down", reason: "mapping_unavailable" },
      ],
    })).toThrow("omission evidence");
  });

  const faceInventory = (
    overrides: Partial<TextureModelFaceInventoryInput> = {}
  ): TextureModelFaceInventoryInput => ({
    cube_count: 1,
    duplicate_cube_uuid_count: 0,
    missing_face_slot_count: 0,
    disabled_face_count: 0,
    untextured_enabled_face_count: 0,
    foreign_texture_enabled_face_count: 0,
    resolver_error_enabled_face_count: 0,
    eligible_textured_face_count: 6,
    texture_inventory_state: "verified",
    outliner_element_count: 1,
    outliner_cube_entry_count: 1,
    outliner_non_cube_count: 0,
    outliner_missing_cube_count: 0,
    outliner_duplicate_entry_count: 0,
    sampled_faces: 6,
    skipped_animated_faces: 0,
    skipped_mapping_faces: 0,
    budget_skipped_faces: 0,
    ...overrides,
  });

  test("six slots per Cube can be enumerated without certifying their pixels or visual quality", () => {
    const cleanInventory = summarizeTextureModelFaceInventory(faceInventory());
    expect(cleanInventory).toMatchObject({
      source: "native_cube_face_inventory",
      cube_count: 1,
      face_slot_count: 6,
      enabled_face_count: 6,
      eligible_textured_face_count: 6,
      sampled_face_count: 6,
      unexamined_enabled_face_count: 0,
      unexamined_face_slot_count: 0,
      inventory_state: "cube_face_slots_enumerated",
      coverage_state: "edge_samples_only",
      face_interior_sampled: false,
      non_cube_texture_coverage_attested: false,
      whole_scene_visual_coverage_attested: false,
      visual_verdict: "not_evaluated",
    });
    expect(cleanInventory.limitations).toContain(
      "FACE_INTERIOR_PIXELS_NOT_SAMPLED"
    );
  });

  test("disabled, missing, untextured, foreign, unreadable and unsampled are separate model counts", () => {
    const inventory = summarizeTextureModelFaceInventory(faceInventory({
      cube_count: 2,
      missing_face_slot_count: 2,
      disabled_face_count: 4,
      untextured_enabled_face_count: 2,
      foreign_texture_enabled_face_count: 1,
      resolver_error_enabled_face_count: 1,
      eligible_textured_face_count: 2,
      sampled_faces: 1,
      skipped_mapping_faces: 1,
      outliner_element_count: 3,
      outliner_cube_entry_count: 2,
      outliner_non_cube_count: 1,
      omission_examples: [
        { cube_uuid: "head", face: "down", reason: "face_slot_missing" },
        { cube_uuid: "cuff", face: "up", reason: "face_disabled" },
        { cube_uuid: "jacket", face: "north", reason: "texture_not_resolved" },
        { cube_uuid: "arm", face: "south", reason: "texture_outside_project" },
        { cube_uuid: "hat", face: "east", reason: "texture_resolver_failed" },
      ],
    }));
    expect(inventory.face_slot_count).toBe(12);
    expect(inventory.enabled_face_count).toBe(6);
    expect(inventory.unexamined_enabled_face_count).toBe(5);
    expect(inventory.unexamined_face_slot_count).toBe(11);
    expect(inventory.sample_skipped_face_count).toBe(1);
    expect(inventory.enabled_face_count).toBe(
      inventory.sampled_face_count + inventory.unexamined_enabled_face_count
    );
    expect(inventory.outliner.non_cube_count).toBe(1);
    expect(inventory.inventory_state).toBe("scene_scope_partial");
    expect(inventory.coverage_state).toBe("partial");
    expect(inventory.omission_examples).toHaveLength(5);
    expect(inventory.omission_examples_truncated).toBe(true);
    expect(inventory.limitations).toEqual(expect.arrayContaining([
      "MODEL_FACE_TEXTURE_OWNERSHIP_UNRESOLVED",
      "NON_CUBE_ELEMENT_COVERAGE_UNEVALUATED",
      "MODEL_FACE_EDGE_SAMPLING_PARTIAL",
    ]));
  });

  test("unknown Outliner identity or missing Texture inventory must not impersonate complete model scope", () => {
    const incomplete = summarizeTextureModelFaceInventory(faceInventory({
      texture_inventory_state: "unavailable",
      outliner_element_count: null,
      outliner_cube_entry_count: null,
      outliner_non_cube_count: null,
      outliner_missing_cube_count: null,
      outliner_duplicate_entry_count: null,
    }));
    expect(incomplete.inventory_state).toBe("outliner_unknown");
    expect(incomplete.coverage_state).toBe("partial");
    expect(incomplete.outliner.state).toBe("unavailable");
    expect(incomplete.whole_scene_visual_coverage_attested).toBe(false);
    expect(incomplete.limitations).toEqual(expect.arrayContaining([
      "OUTLINER_SCENE_SCOPE_UNKNOWN",
      "TEXTURE_INVENTORY_NOT_FULLY_ATTESTED",
    ]));
    const none = summarizeTextureModelFaceInventory(faceInventory({
      cube_count: 0,
      missing_face_slot_count: 0, disabled_face_count: 0,
      eligible_textured_face_count: 0, sampled_faces: 0,
      outliner_element_count: 0, outliner_cube_entry_count: 0,
    }));
    expect(none.coverage_state).toBe("not_evaluated");
    expect(none.whole_scene_visual_coverage_attested).toBe(false);
  });

  test("model face ledger rejects lost Cube slots, inaccurate sampling and inconsistent Outliner claims", () => {
    expect(() => summarizeTextureModelFaceInventory(faceInventory({
      missing_face_slot_count: 1,
    }))).toThrow("MODEL_FACE_INVENTORY_INVALID");
    expect(() => summarizeTextureModelFaceInventory(faceInventory({
      eligible_textured_face_count: 6, sampled_faces: 5,
    }))).toThrow("MODEL_FACE_INVENTORY_INVALID");
    expect(() => summarizeTextureModelFaceInventory(faceInventory({
      outliner_element_count: 2,
    }))).toThrow("MODEL_FACE_INVENTORY_INVALID");
    expect(() => summarizeTextureModelFaceInventory(faceInventory({
      outliner_cube_entry_count: null,
    }))).toThrow("MODEL_FACE_INVENTORY_INVALID");
    expect(() => summarizeTextureModelFaceInventory(faceInventory({
      cube_count: -1,
    }))).toThrow("MODEL_FACE_INVENTORY_INVALID");
  });

  test("model omission ledger is capped, invalid examples cannot masquerade as known face evidence", () => {
    expect(() => summarizeTextureModelFaceInventory(faceInventory({
      omission_examples: [{
        cube_uuid: "face", face: "north", reason: "unknown" as never,
      }],
    }))).toThrow("MODEL_FACE_INVENTORY_INVALID");
    expect(() => summarizeTextureModelFaceInventory(faceInventory({
      omission_examples: Array.from({ length: 13 }, () => ({
        cube_uuid: "face", face: "north",
        reason: "face_disabled" as const,
      })),
    }))).toThrow("MODEL_FACE_INVENTORY_INVALID");
  });

  test("Runtime list_textures wires bounded seam omissions without claiming visual PASS", async () => {
    const runtime = await Bun.file("server/runtime/extensions/texture/authoring.ts").text();
    expect(runtime).toContain("summarizeTextureSeamScanEvidence({");
    expect(runtime).toContain("noteSkipped(cubeUuid, faceKey");
    expect(runtime).toContain('"SEAM_SCAN_PARTIAL"');
    expect(runtime).toContain("scan.unexamined_face_count > 0");
  });

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

  test("nearby noncoincident intra-Cube edges stay unpaired, not false seam review", () => {
    const result = analyzeTextureSeamContinuity([
      edge(),
      edge({
        face: "east", edge: "left",
        // 2e-6 previously rounded into the same 1e-5 edge key.
        start: [1.000002, 1, 0], end: [1.000002, 0, 0],
        samples: Array.from({ length: 4 },
          () => [255, 255, 255, 255] as [number, number, number, number]),
      }),
    ]);
    expect(result.paired_seam_count).toBe(0);
    expect(result.unpaired_edge_count).toBe(2);
    expect(result.review.candidate_count).toBe(0);
    expect(result.gate.reasons).not.toContain("SEAM_CONTINUITY_REVIEW");
  });

  test("intra-Cube edges match across a rounded-key boundary when physically coincident", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ start: [1.0000049, 0, 0], end: [1.0000049, 1, 0] }),
      edge({
        face: "east", edge: "left",
        start: [1.0000051, 1, 0], end: [1.0000051, 0, 0],
        samples: Array.from({ length: 4 },
          () => [255, 255, 255, 255] as [number, number, number, number]),
      }),
    ]);
    expect(result.paired_seam_count).toBe(1);
    expect(result.unpaired_edge_count).toBe(0);
    expect(result.review.candidate_count).toBe(1);
  });

  test("nontransitive three-edge intra-Cube matches stay ambiguous", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ start: [1.0000044, 0, 0], end: [1.0000044, 1, 0] }),
      edge({
        face: "east", edge: "left",
        start: [1.0000050, 1, 0], end: [1.0000050, 0, 0],
      }),
      edge({
        face: "south", edge: "right",
        start: [1.0000056, 1, 0], end: [1.0000056, 0, 0],
      }),
    ]);
    expect(result.ambiguous_edge_count).toBe(1);
    expect(result.paired_seam_count).toBe(0);
    expect(result.review.candidate_count).toBe(0);
    expect(result.gate.reasons).toContain("SEAM_EVIDENCE_AMBIGUOUS");
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

  test("explicit intentional intra-Cube boundary is not a broken seam candidate", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ continuity_intent: "INTENTIONAL_BOUNDARY" }),
      edge({
        face: "east", edge: "left",
        start: [1, 1, 0], end: [1, 0, 0],
        samples: Array.from({ length: 4 },
          () => [255, 255, 255, 255] as [number, number, number, number]),
      }),
    ]);
    expect(result.excluded_intentional_boundary_pair_count).toBe(1);
    expect(result.paired_seam_count).toBe(0);
    expect(result.unpaired_edge_count).toBe(0);
    expect(result.review.candidate_count).toBe(0);
    expect(result.ranked_examples).toEqual([]);
    expect(result.gate).toEqual({ state: "advisory", reasons: [] });
    expect(result.cross_cube_continuity).toBe("not_evaluated");
  });

  test("undeclared or required intra-Cube continuity keeps existing advisory contrast checks", () => {
    const right = edge({
      face: "east", edge: "left",
      start: [1, 1, 0], end: [1, 0, 0],
      samples: Array.from({ length: 4 },
        () => [255, 255, 255, 255] as [number, number, number, number]),
    });
    for (const intent of [undefined, "UNSPECIFIED", "REQUIRED"] as const) {
      const result = analyzeTextureSeamContinuity([
        edge({ continuity_intent: intent }), right,
      ]);
      expect(result.paired_seam_count).toBe(1);
      expect(result.excluded_intentional_boundary_pair_count).toBe(0);
      expect(result.review.candidate_count).toBe(1);
      expect(result.review.high_contrast_count).toBe(1);
      expect(result.gate.reasons).toContain("SEAM_CONTINUITY_REVIEW");
    }
  });

  test("intentional boundaries do not suppress independent seam review candidates", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ continuity_intent: "INTENTIONAL_BOUNDARY" }),
      edge({
        face: "east", edge: "left",
        start: [1, 1, 0], end: [1, 0, 0],
        samples: [[255, 255, 255, 255]],
      }),
      edge({ start: [2, 0, 0], end: [2, 1, 0] }),
      edge({
        face: "east", edge: "left",
        start: [2, 1, 0], end: [2, 0, 0],
        samples: Array.from({ length: 4 },
          () => [255, 255, 255, 255] as [number, number, number, number]),
      }),
    ]);
    expect(result.excluded_intentional_boundary_pair_count).toBe(1);
    expect(result.paired_seam_count).toBe(1);
    expect(result.review.candidate_count).toBe(1);
    expect(result.review.high_contrast_count).toBe(1);
  });

  test("ambiguous intra-Cube edge groups stay unresolved even with boundary intent", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ continuity_intent: "INTENTIONAL_BOUNDARY" }),
      edge({ face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0] }),
      edge({ face: "top", edge: "bottom", start: [1, 1, 0], end: [1, 0, 0] }),
    ]);
    expect(result.ambiguous_edge_count).toBe(1);
    expect(result.excluded_intentional_boundary_pair_count).toBe(0);
    expect(result.paired_seam_count).toBe(0);
  });

  test("invalid caller-declared continuity intent is rejected, not silently trusted", () => {
    expect(() => analyzeTextureSeamContinuity([
      edge({ continuity_intent: "AUTO_PASS" as never }),
    ])).toThrow("continuity intent is invalid");
    expect(() => analyzeCrossCubeSeamContinuity([
      {
        ...edge(),
        cube_uuid: "left", material_id: "wood", surface_id: "front",
        world_normal: [0, 0, 1],
        continuity_intent: "AUTO_PASS" as never,
      },
    ])).toThrow("continuity intent is invalid");
  });

  test("duplicate same-face edge group remains ambiguous instead of disappearing", () => {
    const result = analyzeTextureSeamContinuity([
      edge(), edge({ samples: [[255, 255, 255, 255]] }),
    ]);
    expect(result.sampled_edge_count).toBe(2);
    expect(result.paired_seam_count).toBe(0);
    expect(result.unpaired_edge_count).toBe(0);
    expect(result.ambiguous_edge_count).toBe(1);
    expect(result.review.candidate_count).toBe(0);
    expect(result.gate.reasons).toContain("SEAM_EVIDENCE_AMBIGUOUS");
    expect(result.evidence_gaps.ambiguous_examples[0]).toEqual({
      cube_uuid: "cube-a", faces: ["north", "north"], edge_count: 2,
    });
  });

  test("unequal sampled edge lengths remain unresolved instead of downsampled into a false clean seam", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ samples: [[20, 20, 20, 255], [255, 255, 255, 255],
                       [20, 20, 20, 255], [255, 255, 255, 255]] }),
      edge({
        face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0],
        samples: [[20, 20, 20, 255], [20, 20, 20, 255]],
      }),
    ]);
    expect(result.sampled_edge_count).toBe(2);
    expect(result.sample_alignment_unverified_pair_count).toBe(1);
    expect(result.paired_seam_count).toBe(0);
    expect(result.review.candidate_count).toBe(0);
    expect(result.gate.reasons).toContain("SEAM_SAMPLE_ALIGNMENT_UNVERIFIED");
    expect(result.evidence_gaps.sample_alignment_examples[0]).toEqual({
      cube_uuid: "cube-a", faces: ["north", "east"], sample_counts: [4, 2],
    });
  });

  test("intentional material boundaries remain excluded even when sample counts differ", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ continuity_intent: "INTENTIONAL_BOUNDARY" }),
      edge({
        face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0],
        samples: [[255, 255, 255, 255]],
      }),
    ]);
    expect(result.excluded_intentional_boundary_pair_count).toBe(1);
    expect(result.sample_alignment_unverified_pair_count).toBe(0);
    expect(result.gate.reasons).toEqual([]);
    expect(result.review.candidate_count).toBe(0);
  });

  test("uncertain sampling and a confirmed discontinuity are reported independently", () => {
    const result = analyzeTextureSeamContinuity([
      edge(),
      edge({
        face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0],
        samples: [[255, 255, 255, 255]],
      }),
      edge({ start: [2, 0, 0], end: [2, 1, 0] }),
      edge({
        face: "east", edge: "left", start: [2, 1, 0], end: [2, 0, 0],
        samples: Array.from({ length: 4 },
          () => [255, 255, 255, 255] as [number, number, number, number]),
      }),
    ]);
    expect(result.sample_alignment_unverified_pair_count).toBe(1);
    expect(result.paired_seam_count).toBe(1);
    expect(result.review.candidate_count).toBe(1);
    expect(result.gate.reasons).toContain("SEAM_SAMPLE_ALIGNMENT_UNVERIFIED");
    expect(result.gate.reasons).toContain("SEAM_CONTINUITY_REVIEW");
  });

  test("intra-Cube evidence gaps are bounded and do not require full seam dumps", () => {
    const edges: TextureSeamEdgeInput[] = [];
    for (let i = 0; i < 5; i++) {
      edges.push(edge({
        start: [i + 5, 0, 0], end: [i + 5, 1, 0],
      }));
      edges.push(edge({
        face: "east", edge: "left",
        start: [i + 5, 1, 0], end: [i + 5, 0, 0],
        samples: [[20, 20, 20, 255]],
      }));
    }
    const result = analyzeTextureSeamContinuity(edges, 2);
    expect(result.sample_alignment_unverified_pair_count).toBe(5);
    expect(result.evidence_gaps.sample_alignment_examples).toHaveLength(2);
    expect(result.evidence_gaps.sample_alignment_examples_truncated).toBe(true);
    expect(result.paired_seam_count).toBe(0);
    expect(result.gate.reasons).toContain("SEAM_SAMPLE_ALIGNMENT_UNVERIFIED");
    expect(() => analyzeTextureSeamContinuity(edges, 31))
      .toThrow("example limit");
  });

  test("intra-Cube hidden RGB cannot create a false high-contrast review", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ samples: Array.from({ length: 4 }, () => [0, 0, 0, 0] as [number, number, number, number]) }),
      edge({
        face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0],
        samples: Array.from({ length: 4 }, () => [255, 255, 255, 0] as [number, number, number, number]),
      }),
    ]);
    expect(result.paired_seam_count).toBe(1);
    expect(result.ranked_examples[0].rgb_evaluated_sample_count).toBe(0);
    expect(result.ranked_examples[0].mean_rgb_difference).toBeNull();
    expect(result.ranked_examples[0].max_rgb_difference).toBeNull();
    expect(result.ranked_examples[0].high_contrast).toBe(false);
    expect(result.review.candidate_count).toBe(0);
    expect(result.gate.reasons).toEqual([]);
  });

  test("non-opacity alpha masks keep underlying RGB relevant to intra-Cube seams", () => {
    const input = [
      edge({ samples: Array.from({ length: 4 }, () => [0, 0, 0, 0] as [number, number, number, number]) }),
      edge({
        face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0],
        samples: Array.from({ length: 4 }, () => [255, 255, 255, 0] as [number, number, number, number]),
      }),
    ];
    const opacity = analyzeTextureSeamContinuity(input);
    const mask = analyzeTextureSeamContinuity(input, 6, "NON_OPACITY");
    expect(opacity.review.candidate_count).toBe(0);
    expect(mask.alpha_semantics).toBe("NON_OPACITY");
    expect(mask.ranked_examples[0].rgb_evaluated_sample_count).toBe(4);
    expect(mask.ranked_examples[0].mean_rgb_difference).toBe(1);
    expect(mask.review.high_contrast_count).toBe(1);
    // A color/emissive mask is not physical transparency evidence.
    expect(mask.review.alpha_discontinuity_count).toBe(0);
  });

  test("intra-Cube one-sided alpha hole remains an advisory seam candidate", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ samples: Array.from({ length: 4 }, () => [0, 0, 0, 0] as [number, number, number, number]) }),
      edge({
        face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0],
        samples: Array.from({ length: 4 }, () => [255, 255, 255, 255] as [number, number, number, number]),
      }),
    ]);
    expect(result.ranked_examples[0].rgb_evaluated_sample_count).toBe(0);
    expect(result.ranked_examples[0].high_contrast).toBe(false);
    expect(result.ranked_examples[0].alpha_discontinuity).toBe(true);
    expect(result.review.candidate_count).toBe(1);
    expect(result.review.alpha_discontinuity_count).toBe(1);
  });

  test("only mutually visible samples count toward intra-Cube RGB contrast", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ samples: [
        [10, 10, 10, 255], [0, 0, 0, 0],
        [10, 10, 10, 255], [0, 0, 0, 0],
      ] }),
      edge({
        face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0],
        samples: [
          [255, 255, 255, 0], [10, 10, 10, 255],
          [255, 255, 255, 0], [10, 10, 10, 255],
        ],
      }),
    ]);
    const seam = result.ranked_examples[0];
    // Reversed alignment pairs two mutually visible matching pixels; hidden
    // underlying RGB at the other two positions must not dilute or bias.
    expect(seam.rgb_evaluated_sample_count).toBe(2);
    expect(seam.mean_rgb_difference).toBe(0);
    expect(seam.alpha_discontinuity).toBe(false);
    expect(result.review.candidate_count).toBe(0);
  });

  test("mutually visible mismatched RGB remains a review candidate", () => {
    const result = analyzeTextureSeamContinuity([
      edge({ samples: [
        [0, 0, 0, 255], [0, 0, 0, 0],
        [0, 0, 0, 255], [0, 0, 0, 0],
      ] }),
      edge({
        face: "east", edge: "left", start: [1, 1, 0], end: [1, 0, 0],
        samples: [
          [255, 255, 255, 0], [255, 255, 255, 255],
          [255, 255, 255, 0], [255, 255, 255, 255],
        ],
      }),
    ]);
    // Reverse alignment makes the two visible pairs 0 versus 255.
    expect(result.ranked_examples[0].rgb_evaluated_sample_count).toBe(2);
    expect(result.ranked_examples[0].mean_rgb_difference).toBe(1);
    expect(result.ranked_examples[0].high_contrast).toBe(true);
    expect(result.review.candidate_count).toBe(1);
  });

  test("unpaired outer edges remain inventory rather than false seam failures", () => {
    const result = analyzeTextureSeamContinuity([edge()]);
    expect(result.paired_seam_count).toBe(0);
    expect(result.unpaired_edge_count).toBe(1);
    expect(result.review.candidate_count).toBe(0);
  });
});


describe("world-space native Cube face projection", () => {
  const identity = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ] as const;

  test("rotates and translates mesh-local UVToLocal endpoints into world coordinates", () => {
    const z90 = [
      0, 1, 0, 0,
      -1, 0, 0, 0,
      0, 0, 1, 0,
      3, 5, 7, 1,
    ];
    const result = projectNativeCubeSeamEdgeToWorld({
      face: "north",
      local_start: [0, 0, 0],
      local_end: [2, 0, 0],
      matrix_world: z90,
    });
    expect(result.start).toEqual([3, 5, 7]);
    expect(result.end).toEqual([3, 7, 7]);
    expect(result.world_normal).toEqual([0, 0, -1]);

    const y90 = [
      0, 0, -1, 0,
      0, 1, 0, 0,
      1, 0, 0, 0,
      4, 0, 1, 1,
    ];
    const rotated = projectNativeCubeSeamEdgeToWorld({
      face: "north", local_start: [0, 0, 0],
      local_end: [0, 2, 0], matrix_world: y90,
    });
    expect(rotated.start).toEqual([4, 0, 1]);
    expect(rotated.end).toEqual([4, 2, 1]);
    expect(rotated.world_normal).toEqual([-1, 0, 0]);
  });

  test("accepts native THREE Matrix4 typed elements without incorrectly requiring Array.isArray", () => {
    const matrix_world = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      2, 3, 4, 1,
    ]);
    expect(Array.isArray(matrix_world)).toBe(false);
    const projected = projectNativeCubeSeamEdgeToWorld({
      face: "north",
      local_start: [0, 0, 0],
      local_end: [0, 1, 0],
      matrix_world,
    });
    expect(projected.start).toEqual([2, 3, 4]);
    expect(projected.end).toEqual([2, 4, 4]);
    expect(projected.world_normal).toEqual([0, 0, -1]);

    matrix_world[3] = Number.NaN;
    expect(() => projectNativeCubeSeamEdgeToWorld({
      face: "north",
      local_start: [0, 0, 0],
      local_end: [0, 1, 0],
      matrix_world,
    })).toThrow("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED");
  });

  test("orthogonal nonuniform Cube scale preserves comparable world normals", () => {
    const scaled = [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      0, 0, 0, 1,
    ];
    const result = projectNativeCubeSeamEdgeToWorld({
      face: "up", local_start: [0, 0, 0],
      local_end: [1, 0, 0], matrix_world: scaled,
    });
    expect(result.end).toEqual([2, 0, 0]);
    expect(result.world_normal).toEqual([0, 1, 0]);
  });

  test("reflections, shear, degeneracy, perspective and invalid transforms fail closed", () => {
    const edge = {
      face: "north" as const,
      local_start: [0, 0, 0] as [number, number, number],
      local_end: [1, 0, 0] as [number, number, number],
      matrix_world: [...identity] as number[],
    };
    const reflected: number[] = [...identity];
    reflected[0] = -1;
    const sheared: number[] = [...identity];
    sheared[4] = 0.25;
    const perspective: number[] = [...identity];
    perspective[3] = 0.1;
    const broken: number[] = [...identity];
    broken[0] = NaN;
    for (const matrix_world of [reflected, sheared, perspective, broken, [1, 2, 3]]) {
      expect(() => projectNativeCubeSeamEdgeToWorld({
        ...edge, matrix_world,
      })).toThrow("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED");
    }
    expect(() => projectNativeCubeSeamEdgeToWorld({
      ...edge, local_end: [0, 0, 0],
    })).toThrow("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED");
    expect(() => projectNativeCubeSeamEdgeToWorld({
      ...edge, local_end: [30_000_001, 0, 0],
    })).toThrow("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED");
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

  test("cross-Cube opacity and non-opacity masks use the same declared RGB policy", () => {
    const input = [
      cross({ samples: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }),
      adjoining({ samples: [[255, 255, 255, 0], [255, 255, 255, 0], [255, 255, 255, 0]] }),
    ];
    const opacity = analyzeCrossCubeSeamContinuity(input);
    const mask = analyzeCrossCubeSeamContinuity(input, 6, "NON_OPACITY");
    expect(opacity.ranked_examples[0].mean_rgb_difference).toBeNull();
    expect(mask.ranked_examples[0].rgb_evaluated_sample_count).toBe(3);
    expect(mask.ranked_examples[0].mean_rgb_difference).toBe(1);
    expect(mask.review.candidate_count).toBe(1);
    expect(mask.visual_verdict).toBe("not_evaluated");
  });

  test("invalid alpha semantic is rejected instead of silently using opacity", () => {
    expect(() => analyzeTextureSeamContinuity([edge()], 6, "UNKNOWN" as never))
      .toThrow("alpha semantics");
    expect(() => analyzeCrossCubeSeamContinuity([cross()], 6, "UNKNOWN" as never))
      .toThrow("alpha semantics");
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

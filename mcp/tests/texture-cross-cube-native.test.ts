import { describe, expect, test } from "bun:test";
import {
  inspectDeclaredNativeCrossCubeSeams,
  inspectTreatmentBoundNativeCrossCubeSeams,
  inspectTreatmentNativePatternPhysicalFit,
  inspectRevisionPinnedNativeCrossCubeSeams,
  inspectRevisionPinnedTreatmentCrossCubeSeams,
  seamContinuityRuntime,
  type DeclaredNativeCrossCubeSeamEdge,
} from "@/server/runtime/extensions/texture/authoring";
import { planTextureTreatment } from "@/lib/textureTreatmentPlan";
import { computeTextureRevision } from "@/lib/texture/revision";

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
function translation(x: number, y: number, z: number) {
  const world = [...identity];
  world[12] = x;
  world[13] = y;
  world[14] = z;
  return world;
}
function fakeTexture(uuid: string, shade: number) {
  const mutable = { shade };
  return {
    uuid,
    name: uuid,
    width: 2,
    height: 2,
    display_height: 2,
    canvas: { width: 2, height: 2 },
    layers_enabled: false,
    frameCount: 1,
    setShade(value: number) { mutable.shade = value; },
    getUVWidth: () => 2,
    getUVHeight: () => 2,
    ctx: {
      getImageData(_x: number, _y: number, width: number, height: number) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
          data.set([mutable.shade, mutable.shade, mutable.shade, 255], i);
        }
        return { data };
      },
    },
  };
}
function fakeCube(
  uuid: string,
  name: string,
  shade: number,
  offsetX: number
) {
  const texture = fakeTexture(uuid + "-texture", shade);
  const face = {
    enabled: true,
    uv: [0, 0, 2, 2] as [number, number, number, number],
    rotation: 0,
    material_name: "",
    texture: uuid + "-texture",
    getTexture: () => texture,
    UVToLocal(uv: [number, number]) {
      // Same mesh-local semantics as CubeFace.UVToLocal. The matrixWorld
      // below is responsible for locating this Cube in the scene.
      return { x: uv[0], y: uv[1], z: 0 };
    },
  };
  const mesh = {
    matrixWorld: {
      elements: translation(offsetX, 0, 0) as number[] | Float32Array,
    },
    updateWorldMatrix(_parents: boolean, _children: boolean) {
      return;
    },
  };
  return {
    uuid, name, from: [0, 0, 0], to: [2, 2, 2],
    faces: { north: face }, mesh,
  };
}
const left: DeclaredNativeCrossCubeSeamEdge = {
  cube_uuid: "left",
  face: "north",
  edge: "right",
  continuity_intent: "REQUIRED",
  surface_id: "front_cohort",
  material_id: "stone",
  expected_texture_uuid: "left-texture",
  expected_native_material_name: "",
};
const right: DeclaredNativeCrossCubeSeamEdge = {
  ...left,
  cube_uuid: "right",
  edge: "left",
  expected_texture_uuid: "right-texture",
};

function withMockNative<T>(
  invoke: (cubes: {
    left: ReturnType<typeof fakeCube>;
    right: ReturnType<typeof fakeCube>;
  }) => T
): T {
  const keys = ["Cube", "Texture", "Project", "Outliner"] as const;
  const saved = keys.map(key =>
    Object.getOwnPropertyDescriptor(globalThis, key)
  );
  const cubes = {
    left: fakeCube("left", "Left", 15, 0),
    right: fakeCube("right", "Right", 245, 2),
  };
  try {
    Object.defineProperty(globalThis, "Cube", {
      configurable: true,
      value: { all: [cubes.left, cubes.right] },
    });
    const nativeAtlases = [
      cubes.left.faces.north.getTexture(),
      cubes.right.faces.north.getTexture(),
    ];
    Object.defineProperty(globalThis, "Texture", {
      configurable: true,
      value: { all: nativeAtlases },
    });
    Object.defineProperty(globalThis, "Project", {
      configurable: true,
      value: { textures: nativeAtlases },
    });
    Object.defineProperty(globalThis, "Outliner", {
      configurable: true,
      value: { elements: [cubes.left, cubes.right] },
    });
    return invoke(cubes);
  } finally {
    keys.forEach((key, i) => {
      if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

async function withMockNativeAsync<T>(
  invoke: (cubes: {
    left: ReturnType<typeof fakeCube>;
    right: ReturnType<typeof fakeCube>;
  }) => Promise<T>
): Promise<T> {
  const keys = ["Cube", "Texture", "Project"] as const;
  const originals = keys.map(key =>
    Object.getOwnPropertyDescriptor(globalThis, key)
  );
  const cubes = {
    left: fakeCube("left", "Left", 15, 0),
    right: fakeCube("right", "Right", 245, 2),
  };
  const atlases = [
    cubes.left.faces.north.getTexture(),
    cubes.right.faces.north.getTexture(),
  ];
  try {
    Object.defineProperty(globalThis, "Cube", {
      configurable: true, value: { all: [cubes.left, cubes.right] },
    });
    Object.defineProperty(globalThis, "Texture", {
      configurable: true, value: { all: atlases },
    });
    Object.defineProperty(globalThis, "Project", {
      configurable: true, value: { textures: atlases },
    });
    // Unlike the synchronous helper, preserve global fixtures across the
    // crypto.subtle.digest await and final decoded-image readback.
    return await invoke(cubes);
  } finally {
    keys.forEach((key, index) => {
      const previous = originals[index];
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

async function pinnedRevisions(cubes: {
  left: ReturnType<typeof fakeCube>;
  right: ReturnType<typeof fakeCube>;
}) {
  const result: Record<string, string> = {};
  for (const cube of [cubes.left, cubes.right]) {
    const texture = cube.faces.north.getTexture();
    const bytes = texture.ctx.getImageData(0, 0, 2, 2).data;
    result[texture.uuid] = await computeTextureRevision(bytes, 2, 2);
  }
  return result;
}

function observedTreatmentWithCrossCubeSeam() {
  return planTextureTreatment({
    required_faces: [
      { cube_uuid: "left", face: "north" },
      { cube_uuid: "right", face: "north" },
    ],
    regions: [{
      region: "front-panel", evidence: "observed",
      surface_pattern: "painted_metal", render_profile: "opaque",
      face_targets: [
        { cube_uuid: "left", face: "north", treatment: "PAINT" },
        { cube_uuid: "right", face: "north", treatment: "PAINT" },
      ],
    }],
    seam_pairs: [{
      left: { cube_uuid: "left", face: "north", edge: "right" },
      right: { cube_uuid: "right", face: "north", edge: "left" },
      continuity_intent: "REQUIRED",
      surface_id: "front_cohort",
      material_id: "stone",
      reference_observation: {
        reference_id: "reference:front-cohort",
        reference_revision: "revision:2026-10",
        observation_id: "front-panel-joint",
        observed_edges: [
          { cube_uuid: "left", face: "north", edge: "right" },
          { cube_uuid: "right", face: "north", edge: "left" },
        ],
      },
    }],
  });
}

describe("explicit cross-Cube native seam samples (unregistered)", () => {

  test("native Texture pattern review reads exact current face pixels and signed motif direction", () => {
    withMockNative(cubes => {
      const plan = planTextureTreatment({
        required_faces: [{ cube_uuid: "left", face: "north" }],
        regions: [{
          region: "body", evidence: "observed",
          surface_pattern: "wood_grain", render_profile: "opaque",
          face_targets: [{ cube_uuid: "left", face: "north", treatment: "PAINT" }],
        }],
      });
      const intent = {
        cube_uuid: "left", face: "north" as const,
        expected_texture_uuid: "left-texture",
        minimum_pixels_per_model_unit: 1,
        orientation: {
          atlas: { axis: "u" as const, sign: 1 as const },
          expected_face: { axis: "u" as const, sign: 1 as const },
        },
      };
      const result = inspectTreatmentNativePatternPhysicalFit(plan, [intent]);
      expect(result.state).toBe("advisory_metrics_consistent");
      expect(result.faces[0]).toMatchObject({
        texture_uuid: "left-texture",
        treatment_region: "body",
        face_local_physical_pixels: [2, 2],
        pixels_per_model_unit: [1, 1],
        state: "metrics_consistent",
        orientation: {
          actual_face: { axis: "u", sign: 1 },
          state: "consistent_with_declared_mapping",
        },
        source_pattern_axis_attested: false,
        painting_authorized: false,
      });
      expect(result.native_scene_revision_attested).toBe(false);
      expect(result.visual_verdict).toBe("not_evaluated");

      cubes.left.faces.north.uv = [2, 0, 0, 2];
      const mirrored = inspectTreatmentNativePatternPhysicalFit(plan, [intent]);
      expect(mirrored.state).toBe("review_required");
      expect(mirrored.faces[0].reasons).toContain("TEXTURE_PATTERN_DIRECTION_MISMATCH");

      cubes.left.faces.north.uv = [0, 0, 2, 2];
      cubes.left.faces.north.rotation = 90;
      const rotated = inspectTreatmentNativePatternPhysicalFit(plan, [{
        ...intent,
        orientation: {
          atlas: { axis: "u", sign: 1 },
          expected_face: { axis: "v", sign: 1 },
        },
      }]);
      expect(rotated.faces[0].orientation?.actual_face).toEqual({
        axis: "v", sign: 1,
      });
      expect(rotated.state).toBe("advisory_metrics_consistent");

      const dense = inspectTreatmentNativePatternPhysicalFit(plan, [{
        ...intent, minimum_pixels_per_model_unit: 2,
      }]);
      expect(dense.faces[0].reasons)
        .toContain("TEXTURE_PATTERN_TEXEL_DENSITY_INSUFFICIENT");
    });
  });


  test("multi-face pattern readback refuses a UV rewrite triggered by a later face", () => {
    withMockNative(cubes => {
      const plan = planTextureTreatment({
        required_faces: [
          { cube_uuid: "left", face: "north" },
          { cube_uuid: "right", face: "north" },
        ],
        regions: [{
          region: "cohort", evidence: "observed",
          surface_pattern: "painted_metal", render_profile: "opaque",
          face_targets: [
            { cube_uuid: "left", face: "north", treatment: "PAINT" },
            { cube_uuid: "right", face: "north", treatment: "PAINT" },
          ],
        }],
      });
      const intents = [
        { cube_uuid: "left", face: "north" as const,
          expected_texture_uuid: "left-texture", minimum_pixels_per_model_unit: 1 },
        { cube_uuid: "right", face: "north" as const,
          expected_texture_uuid: "right-texture", minimum_pixels_per_model_unit: 1 },
      ];
      // A normal, unchanged two-face read is still only an advisory result.
      const stable = inspectTreatmentNativePatternPhysicalFit(plan, intents);
      expect(stable.state).toBe("advisory_metrics_consistent");
      expect(stable.scoped_face_count).toBe(2);
      expect(stable.native_scene_revision_attested).toBe(false);

      const secondFace = cubes.right.faces.north;
      const original = secondFace.getTexture;
      let changed = false;
      secondFace.getTexture = () => {
        if (!changed) {
          changed = true;
          cubes.left.faces.north.uv = [0, 0, 1, 2];
        }
        return original();
      };
      expect(() => inspectTreatmentNativePatternPhysicalFit(plan, intents))
        .toThrow("TEXTURE_PATTERN_NATIVE_FACE_CHANGED_DURING_READ");
      expect(changed).toBe(true);
    });
  });

  test("multi-face pattern readback also pins Cube placement, not only box size", () => {
    withMockNative(cubes => {
      const plan = planTextureTreatment({
        required_faces: [
          { cube_uuid: "left", face: "north" },
          { cube_uuid: "right", face: "north" },
        ],
        regions: [{
          region: "cohort", evidence: "observed",
          surface_pattern: "painted_metal", render_profile: "opaque",
          face_targets: [
            { cube_uuid: "left", face: "north", treatment: "PAINT" },
            { cube_uuid: "right", face: "north", treatment: "PAINT" },
          ],
        }],
      });
      const intents = [
        { cube_uuid: "left", face: "north" as const,
          expected_texture_uuid: "left-texture", minimum_pixels_per_model_unit: 1 },
        { cube_uuid: "right", face: "north" as const,
          expected_texture_uuid: "right-texture", minimum_pixels_per_model_unit: 1 },
      ];
      const getSecond = cubes.right.faces.north.getTexture;
      let moved = false;
      cubes.right.faces.north.getTexture = () => {
        if (!moved) {
          moved = true;
          cubes.left.from = [5, 0, 0];
          cubes.left.to = [7, 2, 2]; // same 2×2×2 size, different location
        }
        return getSecond();
      };
      expect(() => inspectTreatmentNativePatternPhysicalFit(plan, intents))
        .toThrow("TEXTURE_PATTERN_NATIVE_FACE_CHANGED_DURING_READ");
    });
  });

  test("native pattern reviewer refuses foreign textures and undeclared face ownership", () => {
    withMockNative(() => {
      const plan = planTextureTreatment({
        required_faces: [{ cube_uuid: "left", face: "north" }],
        regions: [{
          region: "body", evidence: "observed",
          surface_pattern: "wood_grain", render_profile: "opaque",
          face_targets: [{ cube_uuid: "left", face: "north", treatment: "PAINT" }],
        }],
      });
      const valid = {
        cube_uuid: "left", face: "north" as const,
        expected_texture_uuid: "left-texture",
        minimum_pixels_per_model_unit: 1,
      };
      expect(() => inspectTreatmentNativePatternPhysicalFit(plan, [{
        ...valid, expected_texture_uuid: "stale-texture",
      }])).toThrow("TEXTURE_PATTERN_NATIVE_TEXTURE_STALE_OR_FOREIGN");
      expect(() => inspectTreatmentNativePatternPhysicalFit(plan, [{
        ...valid, cube_uuid: "right",
      }])).toThrow("TEXTURE_PATTERN_NATIVE_OUT_OF_SCOPE");
      expect(() => inspectTreatmentNativePatternPhysicalFit(plan, [
        valid, valid,
      ])).toThrow("TEXTURE_PATTERN_NATIVE_DUPLICATE_FACE");
      expect(() => inspectTreatmentNativePatternPhysicalFit(plan, []))
        .toThrow("TEXTURE_PATTERN_NATIVE_SCOPE_INVALID");
      expect(inspectTreatmentNativePatternPhysicalFit(plan, [valid])
        .faces[0].reasons).toContain("TEXTURE_PATTERN_DIRECTION_INTENT_REQUIRED");
    });
  });

  test("world-transform projection compares only declared same-material edges", () => {
    withMockNative(() => {
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.scope).toBe("cross_cube");
      expect(result.declaration_state).toBe("explicit");
      expect(result.sampled_declared_edge_count).toBe(2);
      expect(result.omitted_declared_edge_count).toBe(0);
      expect(result.compared_pair_count).toBe(1);
      expect(result.review.high_contrast_count).toBe(1);
      expect(result.gate.reasons).toContain("CROSS_CUBE_SEAM_REVIEW");
      expect(result.comparison_state).toBe("advisory_only");
      expect(result.binding_mismatch_count).toBe(0);
      expect(result.texture_revision_attested).toBe(false);
      expect(result.material_approval_attested).toBe(false);
      expect(result.native_sampling_attested).toBe(false);
      expect(result.scene_coverage_attested).toBe(false);
      expect(result.visual_verdict).toBe("not_evaluated");
      expect(result.diagnostic_io?.read_calls).toBe(4);
    });
  });

  test("treatment-owned explicit seam pair uses native face ownership and preserves review-only status", () => {
    withMockNative(() => {
      const result = inspectTreatmentBoundNativeCrossCubeSeams(
        observedTreatmentWithCrossCubeSeam()
      );
      expect(result.treatment_handoff).toMatchObject({
        source: "texture_treatment_plan",
        state: "review_required",
        scope: "explicit_face_inventory",
        declared_pair_count: 1,
        assertion_provenance: "CALLER_DECLARATION_UNVERIFIED",
        native_binding_attested: false,
        material_approval_attested: false,
        texture_revision_attested: false,
        scene_coverage_attested: false,
        visual_verdict: "not_evaluated",
      });
      expect(result.sampled_declared_edge_count).toBe(2);
      expect(result.compared_pair_count).toBe(1);
      expect(result.review.high_contrast_count).toBe(1);
      expect(result.treatment_handoff.reference_observations).toHaveLength(1);
      expect(result.treatment_handoff.reference_observations[0].reference_id)
        .toBe("reference:front-cohort");
      expect(result.visual_verdict).toBe("not_evaluated");
    });
  });

  test("native THREE.Float32Array matrices permit physically declared continuity", () => {
    withMockNative(cubes => {
      cubes.left.mesh.matrixWorld.elements =
        new Float32Array(translation(0, 0, 0));
      cubes.right.mesh.matrixWorld.elements =
        new Float32Array(translation(2, 0, 0));
      const result = inspectTreatmentBoundNativeCrossCubeSeams(
        observedTreatmentWithCrossCubeSeam()
      );
      expect(result.compared_pair_count).toBe(1);
      expect(result.omitted_declared_edge_count).toBe(0);
      expect(result.treatment_handoff.state).toBe("review_required");
    });
  });

  test("an otherwise complete treatment plan without explicit seam pairs never invents them", () => {
    withMockNative(() => {
      const noPairs = observedTreatmentWithCrossCubeSeam();
      noPairs.seam_pairs = [];
      const result = inspectTreatmentBoundNativeCrossCubeSeams(noPairs);
      expect(result.treatment_handoff.state).toBe("not_evaluated");
      expect(result.sampled_declared_edge_count).toBe(0);
      expect(result.compared_pair_count).toBe(0);
      expect(result.visual_verdict).toBe("not_evaluated");
    });
  });

  test("incomplete treatment ownership refuses native reads rather than accepting assumed seams", () => {
    withMockNative(() => {
      const incomplete = planTextureTreatment({
        regions: [{
          region: "front-panel", evidence: "observed",
          surface_pattern: "painted_metal", render_profile: "opaque",
        }],
      });
      expect(() => inspectTreatmentBoundNativeCrossCubeSeams(incomplete))
        .toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");
    });
  });

  test("tampered ready plan is refused before resolving any native Cube texture", () => {
    withMockNative(cubes => {
      const plan = observedTreatmentWithCrossCubeSeam();
      plan.regions[0].evidence = "inferred";
      let reads = 0;
      const originalGetTexture = cubes.left.faces.north.getTexture;
      cubes.left.faces.north.getTexture = () => {
        reads += 1;
        return originalGetTexture();
      };
      expect(() => inspectTreatmentBoundNativeCrossCubeSeams(plan))
        .toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");
      expect(reads).toBe(0);
    });
  });

  test("a replaced seam reference cannot use the old technical-ready verdict", () => {
    withMockNative(() => {
      const plan = observedTreatmentWithCrossCubeSeam();
      plan.seam_pairs[0].reference_observation!.observed_edges[0].edge = "top";
      expect(() => inspectTreatmentBoundNativeCrossCubeSeams(plan))
        .toThrow("TEXTURE_SEAM_REFERENCE_SCOPE_MISMATCH");
    });
  });

  test("source treatment and native material mismatches remain unresolved even with a declared pair", () => {
    withMockNative(cubes => {
      cubes.right.faces.north.material_name = "emissive";
      expect(() => inspectTreatmentBoundNativeCrossCubeSeams(
        observedTreatmentWithCrossCubeSeam()
      )).toThrow("TEXTURE_SEAM_HANDOFF_NATIVE_MATERIAL_MISMATCH");
    });
  });

  test("read-window digest pins all referenced decoded RGBA without granting native/visual acceptance", async () => {
    await withMockNativeAsync(async cubes => {
      const expected = await pinnedRevisions(cubes);
      const result = await inspectRevisionPinnedNativeCrossCubeSeams(
        [left, right], expected
      );
      expect(result.compared_pair_count).toBe(1);
      expect(result.review.high_contrast_count).toBe(1);
      expect(result.bitmap_revision_evidence).toMatchObject({
        state: "matched_during_read",
        scope: "declared_edge_textures_only",
        observed_atlas_count: 2,
        source_bytes_matched_during_read: true,
        whole_scene_revision_attested: false,
      });
      expect(result.bitmap_revision_evidence.atlases).toEqual([
        { texture_uuid: "left-texture", decoded_rgba_revision: expected["left-texture"] },
        { texture_uuid: "right-texture", decoded_rgba_revision: expected["right-texture"] },
      ]);
      expect(result.texture_revision_attested).toBe(false);
      expect(result.native_sampling_attested).toBe(false);
      expect(result.visual_verdict).toBe("not_evaluated");
    });
  });

  test("same-UUID atlas repaint is stale even when dimensions and material remain unchanged", async () => {
    await withMockNativeAsync(async cubes => {
      const expected = await pinnedRevisions(cubes);
      cubes.right.faces.north.getTexture().setShade(10);
      await expect(inspectRevisionPinnedNativeCrossCubeSeams(
        [left, right], expected
      )).rejects.toThrow("CROSS_CUBE_REVISION_STALE");
    });
  });

  test("repaint triggered during bounded native seam pixel reads invalidates the entire read-window receipt", async () => {
    await withMockNativeAsync(async cubes => {
      const expected = await pinnedRevisions(cubes);
      const texture = cubes.right.faces.north.getTexture();
      const originalRead = texture.ctx.getImageData;
      let changed = false;
      texture.ctx.getImageData = (x, y, width, height) => {
        const data = originalRead(x, y, width, height);
        if (width === 1 && height === 1 && !changed) {
          changed = true;
          texture.setShade(77);
        }
        return data;
      };
      await expect(inspectRevisionPinnedNativeCrossCubeSeams(
        [left, right], expected
      )).rejects.toThrow("CROSS_CUBE_REVISION_SOURCE_CHANGED");
      expect(changed).toBe(true);
    });
  });

  test("UV changes triggered during a correctly hashed seam read fail final geometry freshness", async () => {
    await withMockNativeAsync(async cubes => {
      const expected = await pinnedRevisions(cubes);
      const face = cubes.right.faces.north;
      const texture = face.getTexture();
      const originalRead = texture.ctx.getImageData;
      let adjusted = false;
      texture.ctx.getImageData = (x, y, width, height) => {
        const result = originalRead(x, y, width, height);
        if (width === 1 && height === 1 && !adjusted) {
          adjusted = true;
          face.uv = [0, 0, 1, 2];
        }
        return result;
      };
      await expect(inspectRevisionPinnedNativeCrossCubeSeams(
        [left, right], expected
      )).rejects.toThrow("CROSS_CUBE_REVISION_SOURCE_CHANGED");
      expect(adjusted).toBe(true);
    });
  });

  test("revision scope rejects missing/extra/invalid hashes before reading native texture bytes", async () => {
    await withMockNativeAsync(async cubes => {
      const expected = await pinnedRevisions(cubes);
      for (const invalid of [
        {},
        { ...expected, "foreign-texture": expected["left-texture"] },
        { ...expected, "left-texture": "sha256:old" },
      ]) {
        await expect(inspectRevisionPinnedNativeCrossCubeSeams(
          [left, right], invalid
        )).rejects.toThrow();
      }
      await expect(inspectRevisionPinnedNativeCrossCubeSeams(
        [], { "left-texture": expected["left-texture"] }
      )).rejects.toThrow("CROSS_CUBE_REVISION_SCOPE_INVALID");
      const none = await inspectRevisionPinnedNativeCrossCubeSeams([], {});
      expect(none.bitmap_revision_evidence.state).toBe("not_evaluated");
      expect(none.bitmap_revision_evidence.source_bytes_matched_during_read).toBe(false);
    });
  });

  test("treatment-owned native seam reads pin exact edge bitmap revisions without approving the reference", async () => {
    await withMockNativeAsync(async cubes => {
      const expected = await pinnedRevisions(cubes);
      const result = await inspectRevisionPinnedTreatmentCrossCubeSeams(
        observedTreatmentWithCrossCubeSeam(), expected
      );
      expect(result.compared_pair_count).toBe(1);
      expect(result.bitmap_revision_evidence.state).toBe("matched_during_read");
      expect(result.treatment_handoff).toMatchObject({
        source: "texture_treatment_plan",
        state: "review_required",
        material_approval_attested: false,
        texture_revision_attested: false,
        visual_verdict: "not_evaluated",
      });
      expect(result.treatment_handoff.reference_observations).toHaveLength(1);
      expect(result.native_sampling_attested).toBe(false);
    });
  });

  test("revision-pinned treatment path blocks stale bitmap without mutating Cube UV ownership", async () => {
    await withMockNativeAsync(async cubes => {
      const before = [...cubes.right.faces.north.uv] as [number, number, number, number];
      const expected = await pinnedRevisions(cubes);
      cubes.right.faces.north.getTexture().setShade(40);
      await expect(inspectRevisionPinnedTreatmentCrossCubeSeams(
        observedTreatmentWithCrossCubeSeam(), expected
      )).rejects.toThrow("CROSS_CUBE_REVISION_STALE");
      expect(cubes.right.faces.north.uv).toEqual(before);
    });
  });

  test("post-ready treatment source tampering cannot enter revision digest or native seam read", async () => {
    await withMockNativeAsync(async cubes => {
      const expected = await pinnedRevisions(cubes);
      const plan = observedTreatmentWithCrossCubeSeam();
      plan.seam_pairs[0].reference_observation!.observed_edges[0].edge = "top";
      await expect(inspectRevisionPinnedTreatmentCrossCubeSeams(
        plan, expected
      )).rejects.toThrow("TEXTURE_SEAM_REFERENCE_SCOPE_MISMATCH");
    });
  });

  test("layered and animated textures reject full revision evidence before any edge sampling", async () => {
    await withMockNativeAsync(async cubes => {
      const expected = await pinnedRevisions(cubes);
      const texture = cubes.right.faces.north.getTexture();
      texture.layers_enabled = true;
      await expect(inspectRevisionPinnedNativeCrossCubeSeams(
        [left, right], expected
      )).rejects.toThrow("CROSS_CUBE_REVISION_BITMAP_UNSUPPORTED");
      texture.layers_enabled = false;
      texture.frameCount = 2;
      await expect(inspectRevisionPinnedNativeCrossCubeSeams(
        [left, right], expected
      )).rejects.toThrow("CROSS_CUBE_REVISION_BITMAP_UNSUPPORTED");
    });
  });

  test("production list_textures seam diagnostics enumerate missing Cube face slots instead of claiming all-model coverage", () => {
    withMockNative(() => {
      const result = seamContinuityRuntime();
      if (!("model_face_inventory" in result)) {
        throw Error("Expected model face inventory in native seam result.");
      }
      const inventory = result.model_face_inventory;
      expect(result.scan.scanned_faces).toBe(2);
      expect(inventory).toMatchObject({
        cube_count: 2,
        face_slot_count: 12,
        enabled_face_count: 2,
        missing_face_slot_count: 10,
        eligible_textured_face_count: 2,
        sampled_face_count: 2,
        unexamined_enabled_face_count: 0,
        unexamined_face_slot_count: 10,
        texture_inventory_state: "verified",
        inventory_state: "cube_face_slots_enumerated",
        coverage_state: "partial",
        whole_scene_visual_coverage_attested: false,
        visual_verdict: "not_evaluated",
        outliner: {
          state: "enumerated", element_count: 2,
          cube_entry_count: 2, non_cube_count: 0,
        },
      });
      expect(result.gate.reasons).toContain(
        "MODEL_FACE_OWNERSHIP_OR_SAMPLING_INCOMPLETE"
      );
      expect(result.gate.reasons).not.toContain("SEAM_SCAN_PARTIAL");
      expect(inventory.omission_examples).toHaveLength(10);
    });
  });

  test("foreign, untextured and throwing Cube faces are not silently absent from model coverage", () => {
    withMockNative(cubes => {
      const face = cubes.right.faces.north;
      const source = face.getTexture;
      face.getTexture = (() => null) as never;
      const untextured = seamContinuityRuntime();
      if (!("model_face_inventory" in untextured)) throw Error("No native model census");
      expect(untextured.model_face_inventory.untextured_enabled_face_count).toBe(1);
      expect(untextured.model_face_inventory.sampled_face_count).toBe(1);
      expect(untextured.model_face_inventory.unexamined_enabled_face_count).toBe(1);
      expect(untextured.model_face_inventory.unexamined_face_slot_count).toBe(11);

      face.getTexture = (() => fakeTexture("outside-project", 30)) as never;
      const foreign = seamContinuityRuntime();
      if (!("model_face_inventory" in foreign)) throw Error("No native model census");
      expect(foreign.model_face_inventory.foreign_texture_enabled_face_count).toBe(1);
      expect(foreign.model_face_inventory.texture_inventory_state).toBe("verified");

      face.getTexture = (() => { throw Error("native resolver refused"); }) as never;
      const unresolved = seamContinuityRuntime();
      if (!("model_face_inventory" in unresolved)) throw Error("No native model census");
      expect(unresolved.model_face_inventory.resolver_error_enabled_face_count).toBe(1);
      expect(unresolved.model_face_inventory.visual_verdict).toBe("not_evaluated");

      face.getTexture = source;
    });
  });

  test("non-Cube Outliner items and disabled faces never count as inspected model texture", () => {
    withMockNative(cubes => {
      const outliner = (
        globalThis as unknown as { Outliner: { elements: unknown[] } }
      ).Outliner;
      outliner.elements.push({ uuid: "mesh-element" });
      cubes.right.faces.north.enabled = false;
      const result = seamContinuityRuntime();
      if (!("model_face_inventory" in result)) throw Error("No native model census");
      expect(result.model_face_inventory).toMatchObject({
        disabled_face_count: 1,
        sampled_face_count: 1,
        inventory_state: "scene_scope_partial",
        non_cube_texture_coverage_attested: false,
        whole_scene_visual_coverage_attested: false,
        outliner: { non_cube_count: 1, element_count: 3 },
      });
      expect(result.gate.reasons).toContain("MODEL_SCENE_INVENTORY_UNVERIFIED");
      expect(result.model_face_inventory.limitations).toContain(
        "NON_CUBE_ELEMENT_COVERAGE_UNEVALUATED"
      );
    });
  });

  test("Texture.all vs Project.textures mismatch is never an attested model inventory", () => {
    withMockNative(() => {
      const project = (
        globalThis as unknown as { Project: { textures: unknown[] } }
      ).Project;
      project.textures = project.textures.slice(0, -1);
      const result = seamContinuityRuntime();
      if (!("model_face_inventory" in result)) throw Error("No native model census");
      expect(result.model_face_inventory.texture_inventory_state).toBe("partial");
      expect(result.model_face_inventory.foreign_texture_enabled_face_count).toBe(1);
      expect(result.model_face_inventory.eligible_textured_face_count).toBe(1);
      expect(result.model_face_inventory.inventory_state).toBe("scene_scope_partial");
      expect(result.model_face_inventory.limitations).toContain(
        "TEXTURE_INVENTORY_NOT_FULLY_ATTESTED"
      );
      expect(result.gate.reasons).toContain("MODEL_SCENE_INVENTORY_UNVERIFIED");
    });
  });

  test("missing native Outliner cannot be mistaken for complete scene coverage", () => {
    withMockNative(() => {
      Reflect.deleteProperty(globalThis, "Outliner");
      const result = seamContinuityRuntime();
      if (!("model_face_inventory" in result)) throw Error("No native model census");
      expect(result.model_face_inventory).toMatchObject({
        inventory_state: "outliner_unknown",
        coverage_state: "partial",
        outliner: { state: "unavailable", element_count: null },
        whole_scene_visual_coverage_attested: false,
      });
      expect(result.model_face_inventory.limitations).toContain(
        "OUTLINER_SCENE_SCOPE_UNKNOWN"
      );
    });
  });

  test("duplicate Cube UUIDs cannot be sampled into fictitious same-Cube seam pairs", () => {
    withMockNative(cubes => {
      cubes.right.uuid = cubes.left.uuid;
      const result = seamContinuityRuntime();
      if (!("model_face_inventory" in result)) throw Error("No native model census");
      expect(result.model_face_inventory.duplicate_cube_uuid_count).toBe(1);
      expect(result.model_face_inventory.eligible_textured_face_count).toBe(2);
      expect(result.model_face_inventory.sampled_face_count).toBe(0);
      expect(result.model_face_inventory.sample_skipped_face_count).toBe(2);
      expect(result.model_face_inventory.coverage_state).toBe("not_evaluated");
      expect(result.model_face_inventory.inventory_state).toBe("scene_scope_partial");
      expect(result.model_face_inventory.limitations).toContain(
        "MODEL_ELEMENT_IDENTITY_INCONSISTENT"
      );
      expect(result.scan.unexamined_face_count).toBe(2);
      expect(result.paired_seam_count).toBe(0);
    });
  });


  test("native comparison_state stays partial when sampled REQUIRED edges remain unpaired", () => {
    withMockNative(() => {
      const full = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(full.compared_pair_count).toBe(1);
      expect(full.comparison_state).toBe("advisory_only");

      // Two additional declared edges are physically outer boundaries:
      // both are marked REQUIRED but have no matching Cube edge. Comparing
      // the main pair does not authorize a false-complete summary.
      const partial = inspectDeclaredNativeCrossCubeSeams([
        left, right,
        { ...left, edge: "left" },
        { ...right, edge: "right" },
      ]);
      expect(partial.sampled_declared_edge_count).toBe(4);
      expect(partial.omitted_declared_edge_count).toBe(0);
      expect(partial.compared_pair_count).toBe(1);
      expect(partial.evidence_gaps.required_unpaired_edge_count).toBe(2);
      expect(partial.gate.reasons).toContain("CROSS_CUBE_REQUIRED_EDGE_UNPAIRED");
      expect(partial.comparison_state).toBe("partial");
      expect(partial.visual_verdict).toBe("not_evaluated");
      expect(partial.native_sampling_attested).toBe(false);

      // An explicitly intentional external border is not an unresolved
      // continuity obligation and must not mark the main pair partial.
      const intentional = inspectDeclaredNativeCrossCubeSeams([
        left, right,
        { ...left, edge: "left", continuity_intent: "INTENTIONAL_BOUNDARY" },
      ]);
      expect(intentional.compared_pair_count).toBe(1);
      expect(intentional.evidence_gaps.required_unpaired_edge_count).toBe(0);
      expect(intentional.comparison_state).toBe("advisory_only");
    });
  });

  test("native local coordinates must not pair if world rotations/translations separate them", () => {
    withMockNative(cubes => {
      cubes.right.mesh.matrixWorld.elements = translation(8, 0, 0);
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.sampled_declared_edge_count).toBe(2);
      expect(result.compared_pair_count).toBe(0);
      expect(result.unpaired_edge_count).toBe(2);
      expect(result.review.candidate_count).toBe(0);
      expect(result.native_sampling_attested).toBe(false);
    });
  });

  test("missing semantic declaration means no native scan and no false clean seam", () => {
    withMockNative(() => {
      const missing = inspectDeclaredNativeCrossCubeSeams([]);
      expect(missing.state).toBe("not_evaluated");
      expect(missing.declaration_state).toBe("missing");
      expect(missing.sampled_declared_edge_count).toBe(0);
      expect(missing.native_sampling_attested).toBe(false);

      const unknown = inspectDeclaredNativeCrossCubeSeams([
        { ...left, continuity_intent: "UNSPECIFIED", surface_id: null, material_id: null },
        right,
      ]);
      expect(unknown.compared_pair_count).toBe(0);
      expect(unknown.exclusions.CONTINUITY_UNDECLARED).toBe(1);
      const otherMaterial = inspectDeclaredNativeCrossCubeSeams([
        left, { ...right, material_id: "wood" },
      ]);
      expect(otherMaterial.compared_pair_count).toBe(0);
      expect(otherMaterial.exclusions.SURFACE_OR_MATERIAL_MISMATCH).toBe(1);
    });
  });

  test("world transform and missing pixel/face evidence remain explicit omissions", () => {
    withMockNative(cubes => {
      // Reflection can be significant to authored textures, but the native
      // world-normal parity is not certified for it here.
      cubes.right.mesh.matrixWorld.elements = [
        -1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        2, 0, 0, 1,
      ];
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.sampled_declared_edge_count).toBe(1);
      expect(result.omitted_declared_edge_count).toBe(1);
      expect(result.omission_examples[0].reason)
        .toBe("native_world_or_pixel_evidence_unverified");
      expect(result.gate.reasons).toContain("CROSS_CUBE_NATIVE_EVIDENCE_PARTIAL");
      expect(result.compared_pair_count).toBe(0);
    });
  });

  test("a face below two physical pixels is not certified as a cross-Cube seam", () => {
    withMockNative(cubes => {
      cubes.right.faces.north.uv = [0, 0, 1, 1];
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.omitted_declared_edge_count).toBe(1);
      expect(result.omission_examples[0].reason)
        .toBe("insufficient_exact_texel_samples");
      expect(result.compared_pair_count).toBe(0);
    });
  });

  test("stale resolved Texture UUID is a bounded omission, never a compared seam", () => {
    withMockNative(() => {
      const result = inspectDeclaredNativeCrossCubeSeams([
        left, { ...right, expected_texture_uuid: "older-atlas" },
      ]);
      expect(result.sampled_declared_edge_count).toBe(1);
      expect(result.omitted_declared_edge_count).toBe(1);
      expect(result.binding_mismatch_count).toBe(1);
      expect(result.omission_examples[0].reason)
        .toBe("native_texture_binding_changed");
      expect(result.gate.reasons).toContain("CROSS_CUBE_NATIVE_BINDING_STALE");
      expect(result.comparison_state).toBe("not_evaluated");
      expect(result.compared_pair_count).toBe(0);
    });
  });

  test("a foreign Texture object with a matching UUID is not accepted as native ownership", () => {
    withMockNative(cubes => {
      const face = cubes.right.faces.north;
      face.getTexture = () => fakeTexture("right-texture", 245);
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.omitted_declared_edge_count).toBe(1);
      expect(result.binding_mismatch_count).toBe(1);
      expect(result.omission_examples[0].reason)
        .toBe("native_texture_inventory_unverified");
      expect(result.comparison_state).toBe("not_evaluated");
      expect(result.gate.reasons).toContain("CROSS_CUBE_NATIVE_BINDING_STALE");
    });
  });

  test("native material reassignment invalidates the old seam declaration", () => {
    withMockNative(cubes => {
      cubes.right.faces.north.material_name = "custom_metal";
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.omission_examples[0].reason)
        .toBe("native_material_binding_changed");
      expect(result.binding_mismatch_count).toBe(1);
      expect(result.review.candidate_count).toBe(0);
    });
  });

  test("a face binding changed during sampling cannot be laundered by earlier RGBA samples", () => {
    withMockNative(cubes => {
      const face = cubes.right.faces.north;
      const original = face.getTexture;
      let reads = 0;
      face.getTexture = () => {
        reads += 1;
        return reads === 1 ? original() : fakeTexture("replacement", 20);
      };
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.omission_examples[0].reason)
        .toBe("native_binding_changed_during_sampling");
      expect(result.binding_mismatch_count).toBe(1);
      expect(result.compared_pair_count).toBe(0);
      expect(result.visual_verdict).toBe("not_evaluated");
    });
  });

  test("face UV changing while the diagnostic reads texels does not produce a clean comparison", () => {
    withMockNative(cubes => {
      const face = cubes.right.faces.north;
      const atlas = face.getTexture();
      const originalRead = atlas.ctx.getImageData;
      let altered = false;
      atlas.ctx.getImageData = (x, y, width, height) => {
        if (!altered) {
          altered = true;
          face.uv = [0, 0, 1, 2];
        }
        return originalRead(x, y, width, height);
      };
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.binding_mismatch_count).toBe(1);
      expect(result.omission_examples[0].reason)
        .toBe("native_binding_changed_during_sampling");
      expect(result.compared_pair_count).toBe(0);
    });
  });

  test("native getTexture failures become omissions rather than a false PASS", () => {
    withMockNative(cubes => {
      cubes.right.faces.north.getTexture = () => {
        throw new Error("native texture not readable");
      };
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.sampled_declared_edge_count).toBe(1);
      expect(result.omitted_declared_edge_count).toBe(1);
      expect(result.omission_examples[0].reason).toBe("texture_unavailable");
      expect(result.comparison_state).toBe("not_evaluated");
      expect(result.gate.reasons).toContain("CROSS_CUBE_NATIVE_EVIDENCE_PARTIAL");
    });
  });

  test("single-texture and group overrides use getTexture rather than raw face.texture", () => {
    withMockNative(cubes => {
      cubes.right.faces.north.texture = "authored-different-source";
      const result = inspectDeclaredNativeCrossCubeSeams([left, right]);
      expect(result.compared_pair_count).toBe(1);
      expect(result.binding_mismatch_count).toBe(0);
      expect(result.comparison_state).toBe("advisory_only");
    });
  });

  test("malformed, duplicated and over-budget declarations fail before native pixel reads", () => {
    const repeated = [left, left];
    expect(() => inspectDeclaredNativeCrossCubeSeams(repeated))
      .toThrow("CROSS_CUBE_DECLARATION_INVALID");
    expect(() => inspectDeclaredNativeCrossCubeSeams([
      { ...left, surface_id: null },
    ])).toThrow("CROSS_CUBE_DECLARATION_INVALID");
    expect(() => inspectDeclaredNativeCrossCubeSeams([
      { ...left, continuity_intent: "INFERRED" as never },
    ])).toThrow("CROSS_CUBE_DECLARATION_INVALID");
    expect(() => inspectDeclaredNativeCrossCubeSeams([
      { ...left, expected_texture_uuid: "" },
    ])).toThrow("CROSS_CUBE_DECLARATION_INVALID");
    expect(() => inspectDeclaredNativeCrossCubeSeams([
      { ...left, expected_native_material_name: null as never },
    ])).toThrow("CROSS_CUBE_DECLARATION_INVALID");
    expect(() => inspectDeclaredNativeCrossCubeSeams(
      Array.from({ length: 65 }, () => left)
    )).toThrow("CROSS_CUBE_DECLARATION_INVALID");
  });

  test("source-only cross-Cube sampler is not silently wired to list_textures", async () => {
    const authoring = await Bun.file(
      "server/runtime/extensions/texture/authoring.ts"
    ).text();
    expect(authoring).toContain("export function inspectDeclaredNativeCrossCubeSeams");
    expect(authoring).toContain("projectNativeCubeSeamEdgeToWorld");
    expect(authoring).toContain("native_sampling_attested: false");
    // The existing list_textures continues to report intra-Cube only.
    const readOwner = authoring.slice(authoring.indexOf("function wireTextureReads()"));
    expect(readOwner).toContain("seamContinuityRuntime(invocationContext)");
    expect(readOwner).not.toContain("inspectDeclaredNativeCrossCubeSeams(");
  });
});

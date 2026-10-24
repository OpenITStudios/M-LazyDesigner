import { describe, expect, test } from "bun:test";
import {
  inspectDeclaredNativeCrossCubeSeams,
  type DeclaredNativeCrossCubeSeamEdge,
} from "@/server/runtime/extensions/texture/authoring";

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
  return {
    uuid,
    name: uuid,
    width: 2,
    height: 2,
    display_height: 2,
    getUVWidth: () => 2,
    getUVHeight: () => 2,
    ctx: {
      getImageData(_x: number, _y: number, width: number, height: number) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
          data.set([shade, shade, shade, 255], i);
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
    matrixWorld: { elements: translation(offsetX, 0, 0) },
    updateWorldMatrix(_parents: boolean, _children: boolean) {
      return;
    },
  };
  return { uuid, name, faces: { north: face }, mesh };
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
  const keys = ["Cube", "Texture", "Project"] as const;
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
    return invoke(cubes);
  } finally {
    keys.forEach((key, i) => {
      if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

describe("explicit cross-Cube native seam samples (unregistered)", () => {
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

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  PUBLICATION_UNITS_PER_MINECRAFT_BLOCK,
  PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT,
  expectedPublicationBlenderBounds,
  expectedPublicationGltfUvSha256,
  derivePublicationPrimitiveBindings,
  requireSupportedPublicationFaceMaterial,
} from "@/lib/publication/sourceManifest";

describe("MCP Cube source-to-GLB fidelity invariants", () => {
  test("16 authored Blockbench units = one glTF unit with Y-up to Blender Z-up", () => {
    expect(PUBLICATION_UNITS_PER_MINECRAFT_BLOCK).toBe(16);
    expect(PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT).toBe(1 / 16);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(expectedPublicationBlenderBounds(
      [0, 0, 0, 16, 16, 16], identity,
    )).toEqual({ min: [0, -1, 0], max: [1, 0, 1] });
    const translated = [...identity];
    translated[12] = 16;
    translated[14] = 32;
    expect(expectedPublicationBlenderBounds(
      [0, 0, 0, 16, 0, 0], translated,
    )).toEqual({ min: [1, -2, 0], max: [2, -2, 0] });
  });

  test("V-flipped Float32 glTF UV SHA is not the raw Blockbench preview UV", () => {
    const nativeUv = [0, 0, 1, 0, 1, 1, 0, 1];
    const binary = Buffer.alloc(nativeUv.length * 4);
    const exported = [0, 1, 1, 1, 1, 0, 0, 0];
    exported.forEach((value, index) => binary.writeFloatLE(value, index * 4));
    expect(expectedPublicationGltfUvSha256(nativeUv))
      .toBe(createHash("sha256").update(binary).digest("hex"));
    expect(() => expectedPublicationGltfUvSha256([0, Infinity])).toThrow("UV_FINGERPRINT_INVALID");
  });

  test("consecutive matching faces form one GLB primitive; nonconsecutive atlas forms another", () => {
    const faces = [
      { face_key: "north", texture_uuid: "atlas-A", material_name: "" },
      { face_key: "south", texture_uuid: "atlas-A", material_name: null },
      { face_key: "east", texture_uuid: "atlas-B", material_name: undefined },
    ];
    const groupings = [
      { start: 0, count: 12, materialIndex: 0 },
      { start: 12, count: 6, materialIndex: 2 },
    ];
    expect(derivePublicationPrimitiveBindings("cube-1", faces, groupings, 18))
      .toEqual([
        {
          face_keys: ["north", "south"],
          texture_uuid: "atlas-A",
          material_name: "ld_color_atlas-A",
        },
        {
          face_keys: ["east"],
          texture_uuid: "atlas-B",
          material_name: "ld_color_atlas-B",
        },
      ]);
    expect(() => derivePublicationPrimitiveBindings("cube-1", faces, [
      { start: 0, count: 18, materialIndex: 0 },
    ], 18)).toThrow("MERGED_DIFFERENT_TEXTURES");
    expect(() => derivePublicationPrimitiveBindings("cube-1", faces, [
      { start: 0, count: 12, materialIndex: 1 },
      { start: 12, count: 6, materialIndex: 2 },
    ], 18)).toThrow("FACE_GROUP_BINDING_INVALID");
  });

  test("an authored per-face material slot never silently becomes generic albedo", () => {
    expect(() => requireSupportedPublicationFaceMaterial("", "cube", "north")).not.toThrow();
    expect(() => requireSupportedPublicationFaceMaterial(null, "cube", "north")).not.toThrow();
    for (const material of ["glass", "entity", "entity_alphatest", "lamp"]) {
      expect(() => requireSupportedPublicationFaceMaterial(
        material, "cube", "north",
      )).toThrow("PUBLICATION_UNSUPPORTED_FACE_MATERIAL");
    }
  });
});

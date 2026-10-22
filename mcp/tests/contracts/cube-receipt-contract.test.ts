import { describe, expect, test } from "bun:test";
import {
  cubeChangedFieldsFromResult,
  cubeGeometryEffect,
  cubeGeometryEffectSchema,
  cubeCreationReceiptSchema,
  isCubeCreationReceipt,
  cubeSemanticScopesFromChangedFields,
  isCubeNoChangeReceipt,
  cubeVisualScope,
  cubeVisualScopeFromResult,
} from "@/lib/receipts/cubeMutation";

describe("shared Cube mutation receipt contract", () => {
  test("accepts complete geometry effect and visual scope receipts", () => {
    const effect = cubeGeometryEffect({
      changed_fields: ["rotation"],
      center_delta: [0, 0, 0],
      size_delta: [0, 0, 0],
      origin_delta: [0, 0, 0],
      rotation_delta: [0, 45, 0],
      inflate_delta: 0,
      uv_offset_delta: [0, 0],
      mirror_uv_changed: false,
      autouv_changed: false,
      visibility_changed: false,
      faces_changed: false,
    });
    const scope = cubeVisualScope({
      cube_uuids: ["cube-a"],
      framing: {
        min: [-1, 0, -1],
        max: [1, 2, 1],
      },
    });

    expect(cubeGeometryEffectSchema.safeParse(effect).success).toBe(true);
    expect(cubeChangedFieldsFromResult({ geometry_effect: effect })).toEqual([
      "rotation",
    ]);
    expect(cubeVisualScopeFromResult({ visual_scope: scope })).toEqual(scope);
  });

  test("bounded Cube visual scope uses one parse and one source-property read", () => {
    let reads = 0;
    const scope = {
      cube_uuids: ["cube-a", "cube-b"],
      framing: {
        min: [-2, 0, -2],
        max: [2, 8, 2],
      },
    };
    const result = {
      get visual_scope() {
        reads++;
        if (reads > 1) throw new Error("Visual receipt was read twice");
        return scope;
      },
    };
    expect(cubeVisualScopeFromResult(result)).toEqual(scope);
    expect(reads).toBe(1);
  });

  test("malformed visual scope never claims bounded acceptance evidence", () => {
    const valid = {
      cube_uuids: ["cube-a"],
      framing: { min: [-1, 0, -1], max: [1, 3, 1] },
    };
    for (const invalid of [
      null,
      { ...valid, cube_uuids: [] },
      { ...valid, framing: { min: [0, 0, 0], max: [Infinity, 1, 1] } },
      { ...valid, framing: { min: [0, 0], max: [1, 1, 1] } },
    ]) {
      expect(cubeVisualScopeFromResult({ visual_scope: invalid })).toBeNull();
    }
    expect(cubeVisualScopeFromResult({})).toBeNull();
  });

  test("rejects malformed geometry vectors and empty visual target identity", () => {
    expect(
      cubeGeometryEffectSchema.safeParse({
        changed_fields: ["rotation"],
        center_delta: [0, 0],
        size_delta: [0, 0, 0],
        origin_delta: [0, 0, 0],
        rotation_delta: [0, 45, 0],
        inflate_delta: 0,
        uv_offset_delta: [0, 0],
        mirror_uv_changed: false,
        autouv_changed: false,
        visibility_changed: false,
        faces_changed: false,
      }).success
    ).toBe(false);

    expect(() =>
      cubeVisualScope({
        cube_uuids: [],
        framing: {
          min: [0, 0, 0],
          max: [1, 1, 1],
        },
      })
    ).toThrow();
  });

  test("created-Cube evidence needs exact count, identities and finite geometry", () => {
    const one = {
      uuid: "cube-a", name: "body",
      from: [0, 0, 0], to: [2, 2, 2],
    };
    expect(isCubeCreationReceipt({
      execution: "applied", added: 1, cubes: [one],
      visual_scope: null,
    })).toBe(true);
    expect(isCubeCreationReceipt({
      execution: "applied", added: 2, cubes: [one],
    })).toBe(false);
    expect(isCubeCreationReceipt({
      execution: "applied", added: 2, cubes: [one, one],
    })).toBe(false);
    expect(isCubeCreationReceipt({
      execution: "applied", added: 1, cubes: [{...one, to: [Infinity, 2, 2]}],
    })).toBe(false);
    expect(cubeCreationReceiptSchema.safeParse({execution:"applied"}).success)
      .toBe(false);
  });

  test("shared Cube no-op receipt refuses contradictory authored effects", () => {
    expect(isCubeNoChangeReceipt({execution:"planned",updates:[]})).toBe(true);
    expect(isCubeNoChangeReceipt({execution:"unchanged",updates:[]})).toBe(true);
    expect(isCubeNoChangeReceipt({execution:"applied",updates:[]})).toBe(false);
    expect(isCubeNoChangeReceipt({execution:"planned"})).toBe(false);
    expect(isCubeNoChangeReceipt({execution:"unchanged",updates:[{id:"cube-a"}]})).toBe(false);
    expect(isCubeNoChangeReceipt({execution:"planned",updates:[{}]})).toBe(false);
    expect(isCubeNoChangeReceipt({
      execution:"unchanged",geometry_effect:{changed_fields:["rotation"]},
    })).toBe(false);
  });

  test("unrecognized Cube effects fail closed instead of preserving downstream UV/Animation", () => {
    const base = {
      changed_fields: ["rotation"],
      center_delta: [0, 0, 0], size_delta: [0, 0, 0],
      origin_delta: [0, 0, 0], rotation_delta: [0, 45, 0],
      inflate_delta: 0, uv_offset_delta: [0, 0],
      mirror_uv_changed: false, autouv_changed: false,
      visibility_changed: false, faces_changed: false,
    };
    const unknown = { ...base, changed_fields: ["new_editor_field"] };
    expect(cubeGeometryEffectSchema.safeParse(unknown).success).toBe(false);
    expect(cubeChangedFieldsFromResult({
      effects: [{ geometry_effect: base }, { geometry_effect: unknown }],
    })).toEqual([]);
    expect(cubeChangedFieldsFromResult({
      effects: [{ geometry_effect: base }, { geometry_effect: null }],
    })).toEqual([]);
    expect(cubeSemanticScopesFromChangedFields(["rotation", "new_editor_field"])).toEqual([
      "GEOMETRY_STRUCTURE", "UV_MAPPING", "TEXTURE_APPEARANCE", "ANIMATION_MOTION",
    ]);
  });

  test("changed fields map to bounded semantic scopes", () => {
    expect(cubeSemanticScopesFromChangedFields(["visibility"])).toEqual([
      "GEOMETRY_STRUCTURE",
    ]);
    expect(cubeSemanticScopesFromChangedFields(["rotation"])).toEqual([
      "GEOMETRY_STRUCTURE",
      "ANIMATION_MOTION",
    ]);
    expect(cubeSemanticScopesFromChangedFields(["uv_offset"]).sort()).toEqual([
      "GEOMETRY_STRUCTURE",
      "TEXTURE_APPEARANCE",
      "UV_MAPPING",
    ]);
    expect(cubeSemanticScopesFromChangedFields(["from"]).sort()).toEqual([
      "ANIMATION_MOTION",
      "GEOMETRY_STRUCTURE",
      "TEXTURE_APPEARANCE",
      "UV_MAPPING",
    ]);
  });

  test("Cube producer and Control consume the shared receipt owner", async () => {
    const producer = await Bun.file("server/tools/geometry/cubes.ts").text();
    const freshness = await Bun.file("gateway/control/delta/freshness.ts").text();
    const verification = await Bun.file("gateway/control/delta/verification.ts").text();

    expect(producer).toContain(
      'cubeGeometryEffect as validatedCubeGeometryEffect'
    );
    expect(producer).toContain(
      'cubeVisualScope as validatedCubeVisualScope'
    );
    expect(freshness).toContain("cubeChangedFieldsFromResult");
    expect(verification).toContain("cubeVisualScopeFromResult");
  });
});
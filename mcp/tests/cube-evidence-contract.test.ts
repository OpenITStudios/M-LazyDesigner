import { describe, expect, test } from "bun:test";
import {
  cubeChangedFieldsFromResult,
  cubeGeometryEffect,
  cubeVisualScope,
  cubeVisualScopeFromResult,
  cubeReceiptBoundVisualScopeFromResult,
  cubeSemanticScopesFromChangedFields,
} from "@/lib/receipts/cubeMutation";

describe("shared Cube mutation evidence contract", () => {
  test("accepts geometry effect and bounded visual framing evidence", () => {
    const effect = cubeGeometryEffect({
      changed_fields: ["rotation", "faces"],
      center_delta: [0, 0, 0],
      size_delta: [0, 0, 0],
      origin_delta: [0, 0, 0],
      rotation_delta: [0, 45, 0],
      inflate_delta: 0,
      uv_offset_delta: [0, 0],
      mirror_uv_changed: false,
      autouv_changed: false,
      visibility_changed: false,
      faces_changed: true,
    });
    expect(effect.changed_fields).toEqual(["rotation", "faces"]);

    const scope = cubeVisualScope({
      cube_uuids: ["cube-a"],
      framing: {
        min: [-1, 0, -1],
        max: [1, 2, 1],
      },
    });
    expect(cubeVisualScopeFromResult({ visual_scope: scope })).toEqual(scope);
  });

  test("focused Cube scope must match the actually applied native target inventory", () => {
    const effect = cubeGeometryEffect({
      changed_fields: ["from"], center_delta: [1, 0, 0],
      size_delta: [0, 0, 0], origin_delta: [0, 0, 0],
      rotation_delta: [0, 0, 0], inflate_delta: 0,
      uv_offset_delta: [0, 0], mirror_uv_changed: false,
      autouv_changed: false, visibility_changed: false,
      faces_changed: false,
    });
    const framing = { min: [0, 0, 0], max: [8, 8, 8] };
    const singleScope = { cube_uuids: ["cube-a"], framing };
    const batchScope = { cube_uuids: ["cube-a", "cube-b"], framing };
    const beforeAfter = (uuid: string) => ({
      before: { uuid }, after: { uuid }, geometry_effect: effect,
    });
    const update = {
      execution: "applied", modified: 1, id: "cube-a",
      ...beforeAfter("cube-a"), visual_scope: singleScope,
    };
    expect(cubeReceiptBoundVisualScopeFromResult(update))
      .toEqual(singleScope);

    const create = {
      execution: "applied", added: 2,
      cubes: [
        { uuid: "cube-a", name: "body", from: [0, 0, 0], to: [4, 4, 4] },
        { uuid: "cube-b", name: "back", from: [4, 0, 0], to: [8, 4, 4] },
      ],
      visual_scope: batchScope,
    };
    expect(cubeReceiptBoundVisualScopeFromResult(create))
      .toEqual(batchScope);
    const batch = {
      execution: "applied", modified: 2,
      effects: [beforeAfter("cube-a"), beforeAfter("cube-b")],
      visual_scope: batchScope,
    };
    expect(cubeReceiptBoundVisualScopeFromResult(batch))
      .toEqual(batchScope);

    const invalid = [
      { ...update, visual_scope: { ...singleScope, cube_uuids: ["cube-b"] } },
      { ...update, visual_scope: { ...singleScope,
        framing: { min: [8, 0, 0], max: [0, 8, 8] } } },
      { ...update, execution: "planned" },
      { ...update, before: { uuid: "cube-b" } },
      { ...update, geometry_effect: { ...effect, changed_fields: [] } },
      { ...create, visual_scope: singleScope },
      { ...create, visual_scope: { ...batchScope,
        cube_uuids: ["cube-a", "cube-a"] } },
      { ...batch, visual_scope: singleScope },
      { ...batch, effects: [beforeAfter("cube-a"),
        { ...beforeAfter("cube-b"), after: { uuid: "cube-c" } }] },
      { ...batch, modified: 1 },
    ];
    for (const receipt of invalid) {
      expect(cubeReceiptBoundVisualScopeFromResult(receipt)).toBeNull();
    }
    // Existing parser is a shape validator only. Control uses the stronger
    // receipt-bound helper; a plausible but unrelated label is not proof.
    expect(cubeVisualScopeFromResult(invalid[0])).toEqual(
      invalid[0]!.visual_scope
    );
  });

  test("extracts changed fields from single and batch Cube receipts", () => {
    const effect = {
      changed_fields: ["from"],
      center_delta: [1, 0, 0],
      size_delta: [2, 0, 0],
      origin_delta: [0, 0, 0],
      rotation_delta: [0, 0, 0],
      inflate_delta: 0,
      uv_offset_delta: [0, 0],
      mirror_uv_changed: false,
      autouv_changed: false,
      visibility_changed: false,
      faces_changed: false,
    };

    expect(
      cubeChangedFieldsFromResult({ geometry_effect: effect })
    ).toEqual(["from"]);

    expect(
      cubeChangedFieldsFromResult({
        effects: [
          { geometry_effect: effect },
          {
            geometry_effect: {
              ...effect,
              changed_fields: ["faces"],
              faces_changed: true,
            },
          },
        ],
      }).sort()
    ).toEqual(["faces", "from"]);
  });

  test("derives one canonical semantic scope set from Cube changed fields", () => {
    expect(
      cubeSemanticScopesFromChangedFields(["rotation", "visibility"])
    ).toEqual(["GEOMETRY_STRUCTURE", "ANIMATION_MOTION"]);

    expect(
      cubeSemanticScopesFromChangedFields(["faces"])
    ).toEqual([
      "GEOMETRY_STRUCTURE",
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
    ]);

    expect(
      cubeSemanticScopesFromChangedFields(["from"])
    ).toEqual([
      "GEOMETRY_STRUCTURE",
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
      "ANIMATION_MOTION",
    ]);

    expect(cubeSemanticScopesFromChangedFields([])).toEqual([
      "GEOMETRY_STRUCTURE",
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
      "ANIMATION_MOTION",
    ]);
  });

  test("rejects malformed effect and over-broad visual scope", () => {
    expect(
      cubeChangedFieldsFromResult({
        geometry_effect: {
          changed_fields: ["from"],
        },
      })
    ).toEqual([]);

    expect(
      cubeVisualScopeFromResult({
        visual_scope: {
          cube_uuids: Array.from({ length: 33 }, (_, i) => `cube-${i}`),
          framing: { min: [0, 0, 0], max: [1, 1, 1] },
        },
      })
    ).toBeNull();
  });

  test("Runtime and Control share Cube evidence owners", async () => {
    const producer = await Bun.file("server/tools/geometry/cubes.ts").text();
    const freshness = await Bun.file("gateway/control/delta/freshness.ts").text();
    const verification = await Bun.file("gateway/control/delta/verification.ts").text();

    expect(producer).toContain('from "@/lib/receipts/cubeMutation"');
    expect(freshness).toContain("cubeChangedFieldsFromResult");
    expect(verification).toContain("cubeReceiptBoundVisualScopeFromResult");
  });
});

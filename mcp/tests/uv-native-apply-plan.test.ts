import { describe, expect, test } from "bun:test";
import { compileNativeUvApplyPlan } from "@/lib/uv/nativeApplyPlan";

describe("native UV apply plan", () => {
  const oneToOne = {
    bitmap_width: 32, bitmap_height: 32,
    logical_width: 32, logical_height: 32,
  } as const;

  test("preserves native signed UV corners through all quarter-turn rotations", () => {
    for (const currentRotation of [0, 90, 180, 270] as const) {
      for (const rotated of [false, true]) {
        for (const [original, expected] of [
          [[4, 6, 8, 10], [3, 5, 9, 7]],
          [[8, 10, 4, 6], [9, 7, 3, 5]],
          [[8, 6, 4, 10], [9, 5, 3, 7]],
          [[4, 10, 8, 6], [3, 7, 9, 5]],
        ] as const) {
          const result = compileNativeUvApplyPlan([
            { id: "face", source_id: "face", x: 3, y: 5,
              width: 6, height: 2, rotated, cohort: "body", locked: false },
          ], [
            { island_id: "face", cube_uuid: "body", face: "north",
              current_uv: original, current_rotation: currentRotation },
          ], oneToOne);
          expect(result.complete).toBe(true);
          expect(result.operations).toHaveLength(1);
          expect(result.operations[0].uv).toEqual([...expected]);
          expect(Number(result.operations[0].rotation)).toBe(
            (currentRotation + (rotated ? 90 : 0)) % 360
          );
        }
      }
    }
  });

  test("rejects collapsed and non-finite native face orientation before producing an apply plan", () => {
    const placement = {
      id: "face", source_id: "face", x: 2, y: 3,
      width: 4, height: 6, rotated: false, cohort: "body", locked: false,
    };
    for (const uv of [
      [0, 0, 0, 4], [0, 0, 4, 0], [0, 0, Number.NaN, 4],
    ] as Array<[number, number, number, number]>) {
      expect(() => compileNativeUvApplyPlan([placement], [
        { island_id: "face", cube_uuid: "body", face: "north",
          current_uv: uv, current_rotation: 270 },
      ], oneToOne)).toThrow("UV_FACE_ORIENTATION_UNRESOLVED");
    }
    expect(() => compileNativeUvApplyPlan([placement], [
      { island_id: "face", cube_uuid: "body", face: "north",
        current_uv: [0, 0, 4, 6], current_rotation: 45 },
    ], oneToOne)).toThrow("unsupported face rotation");
  });


  test("compiles physical semantic atlas pixels into rectangular native logical UV", () => {
    const result = compileNativeUvApplyPlan([
      { id: "arm", source_id: "arm", x: 4, y: 8,
        width: 8, height: 12, rotated: false, cohort: "cloth", locked: false },
    ], [
      { island_id: "arm", cube_uuid: "arm-cube", face: "north",
        current_uv: [8, 8, 4, 4], current_rotation: 270 },
    ], {
      bitmap_width: 256, bitmap_height: 512,
      logical_width: 128, logical_height: 128,
    });
    expect(result.complete).toBe(true);
    // 256/128 = 2 pixels/U, 512/128 = 4 pixels/V.
    expect(result.operations[0].uv).toEqual([6, 5, 2, 2]);
    expect(result.operations[0].rotation).toBe(270);
  });

  test("cannot silently treat physical placements as logical coordinates", () => {
    const physicalPlacement = {
      id: "arm", source_id: "arm", x: 1, y: 1,
      width: 4, height: 4, rotated: false, cohort: "cloth", locked: false,
    };
    const targets = [{
      island_id: "arm", cube_uuid: "cube", face: "north" as const,
      current_uv: [0, 0, 4, 4] as [number, number, number, number],
      current_rotation: 0,
    }];
    expect(() => compileNativeUvApplyPlan(
      [physicalPlacement], targets, undefined as never
    )).toThrow("UV_NATIVE_ATLAS_MAPPING_REQUIRED");
    expect(() => compileNativeUvApplyPlan(
      [{ ...physicalPlacement, x: 1.5 }], targets, oneToOne
    )).toThrow("UV_NATIVE_PLACEMENT_INVALID");
    expect(() => compileNativeUvApplyPlan(
      [physicalPlacement], targets, {
        bitmap_width: 0, bitmap_height: 32, logical_width: 32, logical_height: 32,
      }
    )).toThrow("UV_NATIVE_ATLAS_MAPPING_REQUIRED");
  });

  test("compiles semantic placements without mutating Blockbench", () => {
    const result = compileNativeUvApplyPlan([
      { id: "cube:north", source_id: "cube:north", x: 2, y: 3, width: 4, height: 6, rotated: false, cohort: "base", locked: false },
    ], [
      { island_id: "cube:north", cube_uuid: "cube-uuid", face: "north", current_uv: [0,0,1,1], current_rotation: 0 },
    ], oneToOne);
    expect(result.complete).toBe(true);
    expect(result.operations[0]).toEqual({
      island_id: "cube:north",
      cube_uuid: "cube-uuid",
      face: "north",
      uv: [2,3,6,9],
      rotation: 0,
      shared_with: undefined,
    });
  });
});

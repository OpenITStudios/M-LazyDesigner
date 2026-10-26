import { describe, expect, test } from "bun:test";
import {
  isMaterialInstanceMutationReceipt,
  materialInstanceMutationReceipt,
} from "@/lib/receipts/materialInstances";

describe("shared material-instance receipt contract", () => {
  test("accepts exact final cube/face assignment changes", () => {
    const receipt = {
      operation: "set" as const,
      cube_count: 1,
      face_count: 1,
      cubes: [{ uuid: "cube-a", name: "body" }],
      material_name: "metal",
      changes: [
        {
          cube_uuid: "cube-a",
          cube_name: "body",
          face: "north",
          material_name: "metal",
        },
      ],
    };

    expect(materialInstanceMutationReceipt(receipt)).toBe(receipt);
    expect(isMaterialInstanceMutationReceipt(receipt)).toBe(true);
  });

  test("rejects count drift and missing target identity", () => {
    expect(
      isMaterialInstanceMutationReceipt({
        operation: "bulk_set",
        cube_count: 2,
        face_count: 1,
        cubes: [{ uuid: "cube-a", name: "body" }],
        changes: [
          {
            cube_uuid: "cube-a",
            cube_name: "body",
            face: "north",
            material_name: "metal",
          },
        ],
      })
    ).toBe(false);

    expect(
      isMaterialInstanceMutationReceipt({
        operation: "clear",
        cube_count: 1,
        face_count: 1,
        cubes: [{ uuid: "", name: "body" }],
        changes: [
          {
            cube_uuid: "",
            cube_name: "body",
            face: "north",
            material_name: "",
          },
        ],
      })
    ).toBe(false);
  });

  test("Runtime funnel and Control use the same receipt owner", async () => {
    const producer = await Bun.file("server/tools/texture/materialInstances.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain(
      'from "@/lib/receipts/materialInstances"'
    );
    expect(producer).toContain("materialInstanceMutationReceipt(result);");
    expect(control).toContain(
      'from "../../../lib/receipts/materialInstances"'
    );
    expect(control).toContain("receiptMatches(value, isMaterialInstanceMutationReceipt)");
  });
});
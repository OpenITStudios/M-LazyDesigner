import { describe, expect, test } from "bun:test";
import {
  isTextureGroupReceipt,
  textureGroupReceipt,
} from "@/lib/receipts/textureGroup";

describe("shared texture-group receipt contract", () => {
  test("accepts exact created group and assigned texture identities", () => {
    const receipt = textureGroupReceipt({
      operation: "create_group",
      texture_group: {
        uuid: "group-a",
        name: "painted",
        is_material: true,
      },
      textures: [
        {
          uuid: "texture-a",
          id: "texture-a",
          name: "base.png",
          group: "group-a",
          pbr_channel: "color",
        },
      ],
    });

    expect(isTextureGroupReceipt(receipt)).toBe(true);
  });

  test("rejects textures that claim a different group", () => {
    expect(
      isTextureGroupReceipt({
        operation: "create_group",
        texture_group: {
          uuid: "group-a",
          name: "painted",
          is_material: true,
        },
        textures: [
          {
            uuid: "texture-a",
            id: "texture-a",
            name: "base.png",
            group: "group-b",
            pbr_channel: "color",
          },
        ],
      })
    ).toBe(false);
  });

  test("Runtime and Control share the texture-group receipt owner", async () => {
    const producer = await Bun.file("server/tools/texture/assignment.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain('from "@/lib/receipts/textureGroup"');
    expect(producer).toContain("const result = textureGroupReceipt({");
    expect(control).toContain(
      'from "../../../lib/receipts/textureGroup"'
    );
    expect(control).toContain("receiptMatches(value, isTextureGroupReceipt)");
  });
});
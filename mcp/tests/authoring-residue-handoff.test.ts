import { describe, expect, test } from "bun:test";
import { focusedGetTextureParameters } from "@/lib/textureEvidence";
import { paintTransactionParameters } from "@/lib/paintTransaction";
import { createTextureVariantParameters } from "@/lib/textureVariantPlan";
import { PAINT_TEXTURE_TRANSACTION_TOOL_NAME } from "@/lib/paintTransactionPolicy";

describe("REMOTE_GITHUB authoring handoff contracts", () => {
  test("prepared schemas remain strict enough for minor local wiring", () => {
    expect(
      focusedGetTextureParameters.safeParse({
        texture: "base",
        region: { x: 0, y: 0, width: 8, height: 8 },
        expected_revision: `sha256:16x16:${"a".repeat(64)}`,
      }).success
    ).toBe(true);
    expect(
      focusedGetTextureParameters.safeParse({
        region: { x: -1, y: 0, width: 8, height: 8 },
      }).success
    ).toBe(false);

    expect(
      paintTransactionParameters.safeParse({
        expected_revision: `sha256:16x16:${"b".repeat(64)}`,
        operations: [
          {
            operation: "fill_rect",
            color: "#FFFFFFFF",
            rect: { x: 0, y: 0, width: 4, height: 4 },
          },
        ],
      }).success
    ).toBe(true);
    expect(
      paintTransactionParameters.safeParse({
        expected_revision: `sha256:16x16:${"b".repeat(64)}`,
        operations: [],
      }).success
    ).toBe(false);
    expect(
      paintTransactionParameters.safeParse({
        operations: [
          {
            operation: "fill_rect",
            color: "#FFFFFFFF",
            rect: { x: 0, y: 0, width: 4, height: 4 },
          },
        ],
      }).success
    ).toBe(false);

    expect(
      createTextureVariantParameters.safeParse({
        type: "variant",
        name: "alternate",
        source_texture_id: "base",
        group: "variants",
      }).success
    ).toBe(true);
    expect(
      createTextureVariantParameters.safeParse({
        type: "variant",
        name: "alternate",
        source_texture_id: "base",
      }).success
    ).toBe(false);
    expect(PAINT_TEXTURE_TRANSACTION_TOOL_NAME).toBe(
      "paint_texture_transaction"
    );
  });

  test("continuation stays compact and routes only current synchronization residue", async () => {
    const continuation = await Bun.file("../docs/05-operations/next-action.md").text();
    expect(continuation.length).toBeLessThan(8_000);
    for (const marker of [
      "REMOTE_GITHUB",
      "docs:check",
      "verify:full",
      "NOT_EXECUTED",
      "Windows",
      "LIVE_BLOCKBENCH",
      "No second engine, router",
    ]) {
      expect(continuation.toLowerCase()).toContain(marker.toLowerCase());
    }
    for (const retired of [
      "SOURCE_READY / PREWIRED",
      "textureEvidence.ts",
      "textureEvidenceDelivery.ts",
      "paintTransaction.ts",
      "textureVariantPlan.ts",
      "bedrockProjectIdentity.ts",
      "bedrockExportIntegrity.ts",
      "DIRECT | 3D_ASSISTED",
    ]) {
      expect(continuation).not.toContain(retired);
    }
    expect(continuation).toContain("The persistent Gateway owns client stability and Runtime");
    expect(continuation).toMatch(/Native\s+and visual checks remain NOT_EXECUTED until actually observed/);
  });
});

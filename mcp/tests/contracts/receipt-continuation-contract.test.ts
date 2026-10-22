import { describe, expect, test } from "bun:test";
import { CAPABILITY_CORE_MANIFEST } from "@/lib/capabilities/manifest";
import {
  CONTINUATION_RECEIPT_CAPABILITIES,
  receiptSupportsContinuation,
  resultCandidates,
  cubeStateNeutral,
  boneRiggingDeletionReceiptComplete,
  boneRiggingStateReceiptComplete,
  nativeIkControllerReceiptComplete,
} from "@/gateway/control/delta/receipts";

describe("continuation receipt registry", () => {
  test("MCP wrapper has one authoritative structuredContent candidate", () => {
    const contradictory = {
      execution: "unchanged",
      structuredContent: { execution: "applied", name: "new-model" },
    };
    expect(resultCandidates(contradictory)).toEqual([
      { execution: "applied", name: "new-model" },
    ]);
    expect(cubeStateNeutral(contradictory)).toBe(false);
    expect(resultCandidates({
      execution: "applied",
      structuredContent: { execution: "unchanged" },
    })).toEqual([{ execution: "unchanged" }]);
    expect(cubeStateNeutral({
      execution: "applied", structuredContent: { execution: "unchanged", updates: [] },
    })).toBe(true);
    expect(resultCandidates({ execution: "unchanged", structuredContent: null }))
      .toEqual([]);
    expect(cubeStateNeutral({ execution: "unchanged", structuredContent: null }))
      .toBe(false);
    expect(resultCandidates({ execution: "unchanged" }))
      .toEqual([{ execution: "unchanged" }]);
  });

  test("registry capabilities are canonical and verification-relevant", () => {
    expect(CONTINUATION_RECEIPT_CAPABILITIES.length).toBeGreaterThan(0);

    for (const capability of CONTINUATION_RECEIPT_CAPABILITIES) {
      const entry = CAPABILITY_CORE_MANIFEST.get(capability);
      expect(entry, capability).toBeDefined();
      expect(entry?.stage, capability).toBeDefined();
      expect(entry?.verificationClass, capability).not.toBe("not_applicable");
    }
  });

  test("Bone Rigging one-candidate validator matches independent native/state/delete guards", () => {
    const cases: unknown[] = [
      {
        action: "set_ik", bone: {
          uuid: "bone-a", name: "leg", parent: "root",
          origin: [0, 8, 0], rotation: [0, 0, 0],
          ik_enabled: true, ik_target: "target-a",
        },
      },
      {
        action: "delete",
        removed_root: { uuid: "bone-a", name: "leg", parent: "root" },
        removed_counts: { groups: 2, elements: 1, total_nodes: 3 },
        affected_animations: 1,
      },
      {
        action: "set_ik_controller", controller: {
          uuid: "null-a", name: "leg_ik", ik_target: "foot",
          ik_source: "upper_leg", ik_pole: "knee",
          lock_ik_target_rotation: false,
        },
      },
      { action: "set_ik", bone: { uuid: "bone-a", name: "leg" } },
      { action: "delete", removed_counts: { groups: 2, elements: 1, total_nodes: 99 } },
      { action: "set_ik_controller", controller: { uuid: "null-a", name: "leg_ik" } },
      null,
      { structuredContent: null, action: "set_ik_controller" },
    ];
    for (const value of cases) {
      const previous =
        nativeIkControllerReceiptComplete(value) ||
        boneRiggingStateReceiptComplete(value) ||
        boneRiggingDeletionReceiptComplete(value);
      expect(receiptSupportsContinuation("bone_rigging", value)).toBe(previous);
    }
    for (const valid of cases.slice(0, 3)) {
      expect(receiptSupportsContinuation("bone_rigging", {
        structuredContent: valid, action: "delete",
        removed_counts: { groups: 1, elements: 999 },
      })).toBe(true);
    }
    expect(receiptSupportsContinuation("bone_rigging", {
      structuredContent: null, ...(cases[0] as Record<string, unknown>),
    })).toBe(false);
  });

  test("unknown capabilities fail closed instead of inheriting a receipt validator", () => {
    expect(
      receiptSupportsContinuation("future_unknown_tool", {
        execution: "applied",
      })
    ).toBe(false);
  });

  test("representative shared contracts are discoverable through one registry", () => {
    expect(CONTINUATION_RECEIPT_CAPABILITIES).toEqual(
      expect.arrayContaining([
        "create_project",
        "manage_material",
        "manage_animation_controller",
        "manage_particle",
        "manage_render_profile",
        "remove_element",
        "bone_rigging",
      ])
    );
  });

  test("registry declaration replaces capability switch routing", async () => {
    const source = await Bun.file("gateway/control/delta/receipts.ts").text();
    const receiptSection = source.slice(
      source.indexOf("const CONTINUATION_RECEIPT_VALIDATORS")
    );

    expect(receiptSection).not.toContain("switch (capability)");
    expect(receiptSection).toContain(
      "CONTINUATION_RECEIPT_VALIDATORS[capability]"
    );
  });
});
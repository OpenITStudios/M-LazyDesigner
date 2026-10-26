import { describe, expect, test } from "bun:test";
import {
  isLocatorMutationReceipt,
  locatorMutationReceipt,
} from "@/lib/receipts/locatorMutation";

describe("shared locator mutation receipt contract", () => {
  test("accepts locator and null-object final state", () => {
    expect(
      isLocatorMutationReceipt({
        execution: "applied",
        action: "update",
        id: "locator-a",
        name: "hand",
        type: "locator",
        parent: { uuid: "bone-a", name: "arm" },
        changed_fields: ["position"],
        state: {
          uuid: "locator-a",
          name: "hand",
          type: "locator",
          parent: { uuid: "bone-a", name: "arm" },
          position: [1, 2, 3],
          rotation: [0, 90, 0],
          ignore_inherited_scale: false,
          visibility: true,
        },
      })
    ).toBe(true);

    expect(
      isLocatorMutationReceipt({
        execution: "applied",
        action: "create",
        id: "null-a",
        name: "ik_target",
        type: "null_object",
        parent: { uuid: "bone-a", name: "arm" },
        changed_fields: ["name", "parent", "position"],
        state: {
          uuid: "null-a",
          name: "ik_target",
          type: "null_object",
          parent: { uuid: "bone-a", name: "arm" },
          position: [0, 0, 0],
          ik_target: null,
          ik_source: null,
          ik_pole: null,
          lock_ik_target_rotation: false,
          visibility: true,
        },
      })
    ).toBe(true);
  });

  test("rejects mismatched identity and incomplete locator state", () => {
    expect(
      isLocatorMutationReceipt({
        execution: "applied",
        action: "update",
        id: "locator-a",
        name: "hand",
        type: "locator",
        parent: null,
        changed_fields: [],
        state: {
          uuid: "locator-b",
          name: "hand",
          type: "locator",
          parent: null,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          ignore_inherited_scale: false,
          visibility: true,
        },
      })
    ).toBe(false);
  });

  test("producer helper and Control use the same receipt owner", async () => {
    const receipt = locatorMutationReceipt({
      execution: "applied",
      action: "create",
      id: "locator-a",
      name: "hand",
      type: "locator",
      parent: null,
      changed_fields: ["name"],
      state: {
        uuid: "locator-a",
        name: "hand",
        type: "locator",
        parent: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        ignore_inherited_scale: false,
        visibility: true,
      },
    });
    expect(isLocatorMutationReceipt(receipt)).toBe(true);

    const producer = await Bun.file("server/tools/geometry/locators.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();
    expect(producer).toContain('from "@/lib/receipts/locatorMutation"');
    expect(producer).toContain("const summary = locatorMutationReceipt({");
    expect(control).toContain(
      'from "../../../lib/receipts/locatorMutation"'
    );
    expect(control).toContain("receiptMatches(value, isLocatorMutationReceipt)");
  });
});
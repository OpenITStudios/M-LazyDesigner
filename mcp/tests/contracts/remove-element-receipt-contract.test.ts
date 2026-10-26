import { describe, expect, test } from "bun:test";
import {
  isRemoveElementReceipt,
  removeElementReceipt,
} from "@/lib/receipts/removeElement";

describe("shared remove-element receipt contract", () => {
  test("accepts exact root identity and coherent deletion counts", () => {
    const receipt = removeElementReceipt({
      removed_root: {
        uuid: "group-a",
        name: "arm",
        type: "group",
        parent: "root",
      },
      removed_counts: {
        groups: 2,
        elements: 3,
        total_nodes: 5,
      },
      affected_animations: 1,
    });

    expect(isRemoveElementReceipt(receipt)).toBe(true);
  });

  test("rejects malformed identities and inconsistent totals", () => {
    expect(
      isRemoveElementReceipt({
        removed_root: {
          uuid: "",
          name: "arm",
          type: "group",
          parent: "root",
        },
        removed_counts: {
          groups: 1,
          elements: 0,
          total_nodes: 1,
        },
        affected_animations: 0,
      })
    ).toBe(false);

    expect(
      isRemoveElementReceipt({
        removed_root: {
          uuid: "group-a",
          name: "arm",
          type: "group",
          parent: "root",
        },
        removed_counts: {
          groups: 1,
          elements: 2,
          total_nodes: 2,
        },
        affected_animations: 0,
      })
    ).toBe(false);
  });

  test("Runtime and Control share the remove-element receipt owner", async () => {
    const producer = await Bun.file("server/tools/element/mutation.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain('from "@/lib/receipts/removeElement"');
    expect(producer).toContain("const result = removeElementReceipt({");
    expect(control).toContain(
      'from "../../../lib/receipts/removeElement"'
    );
    expect(control).toContain("receiptMatches(value, isRemoveElementReceipt)");
  });
});
import { describe, expect, test } from "bun:test";
import {
  isAppliedRenameElementReceipt,
  renameElementReceipt,
  renameElementReceiptSchema,
} from "@/lib/receipts/renameElement";

describe("shared rename-element receipt contract", () => {
  test("accepts applied single and batch final receipts", () => {
    expect(
      isAppliedRenameElementReceipt(
        renameElementReceipt({
          execution: "applied",
          element: {
            uuid: "cube-a",
            name: "body_new",
            type: "cube",
            parent: "root",
          },
        })
      )
    ).toBe(true);

    expect(
      isAppliedRenameElementReceipt(
        renameElementReceipt({
          execution: "applied",
          changes: [
            { id: "group-a", old_name: "arm", new_name: "arm_new" },
          ],
          affected_animations: 1,
        })
      )
    ).toBe(true);
  });

  test("Group rename with final element also retains batch animation impact", () => {
    const producerReceipt = renameElementReceipt({
      execution: "applied",
      element: {
        uuid: "group-a",
        name: "arm_new",
        type: "group",
        parent: "root",
      },
      changes: [
        { id: "group-a", old_name: "arm", new_name: "arm_new" },
      ],
      affected_animations: 0,
    });
    const parsed = renameElementReceiptSchema.parse(producerReceipt);
    expect("changes" in parsed).toBe(true);
    if (!("changes" in parsed)) throw new Error("Expected complete batch receipt");
    expect(parsed.affected_animations).toBe(0);
    expect(parsed.changes).toHaveLength(1);
  });

  test("planned and unchanged receipts are valid but not mutation-complete receipts", () => {
    const planned = renameElementReceipt({
      execution: "planned",
      changes: [{ id: "group-a", old_name: "arm", new_name: "arm_new" }],
      affected_animations: 1,
    });
    expect(isAppliedRenameElementReceipt(planned)).toBe(false);
  });

  test("malformed Group batch cannot be laundered into a single-element receipt", () => {
    const element = {
      uuid: "group-a", name: "after", type: "group", parent: "root",
    };
    expect(isAppliedRenameElementReceipt({
      execution: "applied",
      element,
      changes: [{id:"group-a",old_name:"before",new_name:"after"}],
      affected_animations: -1,
    })).toBe(false);
    expect(renameElementReceiptSchema.safeParse({
      execution: "planned",
      changes: [], affected_animations: 0,
      unknown_mutation_evidence: true,
    }).success).toBe(false);
  });

  test("rejects malformed applied identities and empty applied batches", () => {
    expect(
      isAppliedRenameElementReceipt({
        execution: "applied",
        element: { uuid: "", name: "broken", type: "cube", parent: "root" },
      })
    ).toBe(false);
    expect(
      isAppliedRenameElementReceipt({
        execution: "applied",
        changes: [],
        affected_animations: 0,
      })
    ).toBe(false);
  });

  test("Runtime and Control share the rename receipt owner", async () => {
    const producer = await Bun.file("server/tools/element/mutation.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain('from "@/lib/receipts/renameElement"');
    expect(producer).toContain("renameElementReceipt({");
    expect(control).toContain(
      'from "../../../lib/receipts/renameElement"'
    );
    expect(control).toContain("receiptMatches(value, isAppliedRenameElementReceipt)");
  });
});
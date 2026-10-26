import { describe, expect, test } from "bun:test";
import {
  boneRiggingReceipt,
  isBoneRiggingDeletionReceipt,
  isBoneRiggingStateReceipt,
  isNativeIkControllerReceipt,
} from "@/lib/receipts/boneRigging";

describe("shared bone-rigging receipt contract", () => {
  test("accepts final bone, deletion and native IK controller receipts", () => {
    expect(
      isBoneRiggingStateReceipt(
        boneRiggingReceipt({
          action: "set_pivot",
          bone: {
            uuid: "bone-a",
            name: "arm",
            parent: "root",
            origin: [0, 12, 0],
            rotation: [0, 0, 0],
            ik_enabled: false,
            ik_target: null,
          },
        })
      )
    ).toBe(true);

    expect(
      isBoneRiggingDeletionReceipt(
        boneRiggingReceipt({
          action: "delete",
          removed_root: {
            uuid: "bone-a",
            name: "arm",
            parent: "root",
          },
          removed_counts: {
            groups: 1,
            elements: 2,
            total_nodes: 3,
          },
          affected_animations: 1,
        })
      )
    ).toBe(true);

    expect(
      isNativeIkControllerReceipt(
        boneRiggingReceipt({
          action: "set_ik_controller",
          controller: {
            uuid: "null-a",
            name: "ik_controller",
            ik_target: "target-a",
            ik_source: "root-a",
            ik_pole: null,
            lock_ik_target_rotation: false,
          },
        })
      )
    ).toBe(true);
  });

  test("rejects incoherent deletion counts and incomplete final bone state", () => {
    expect(
      isBoneRiggingDeletionReceipt({
        action: "delete",
        removed_root: {
          uuid: "bone-a",
          name: "arm",
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

    expect(
      isBoneRiggingStateReceipt({
        action: "set_ik",
        bone: {
          uuid: "bone-a",
          name: "arm",
          parent: "root",
          origin: [0, 0, 0],
        },
      })
    ).toBe(false);
  });

  test("Runtime and Control share the bone-rigging receipt owner", async () => {
    const producer = await Bun.file("server/tools/animation/rigging.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain('from "@/lib/receipts/boneRigging"');
    expect(
      producer.match(/boneRiggingReceipt\(\{/g)?.length ?? 0
    ).toBe(3);
    expect(control).toContain(
      'from "../../../lib/receipts/boneRigging"'
    );
    expect(control).toContain("receiptMatches(value, isBoneRiggingStateReceipt)");
    expect(control).toContain("receiptMatches(value, isBoneRiggingDeletionReceipt)");
    expect(control).toContain("receiptMatches(value, isNativeIkControllerReceipt)");
  });
});
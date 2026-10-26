import { describe, expect, test } from "bun:test";
import {
  animationEffectsReceipt,
  isAnimationEffectsReceipt,
} from "@/lib/receipts/animationEffects";

describe("shared animation effects receipt contract", () => {
  test("accepts final particle, sound, timeline and removal states", () => {
    const receipt = animationEffectsReceipt({
      animation: { uuid: "anim-a", name: "walk" },
      operation_count: 4,
      results: [
        {
          channel: "particle",
          keyframe_uuid: "kf-p",
          time: 0.25,
          data_point_index: 0,
          effect: "minecraft:spark",
          locator: null,
          bind_to_actor: null,
          pre_effect_script: null,
        },
        {
          channel: "sound",
          keyframe_uuid: "kf-s",
          time: 0.5,
          data_point_index: 0,
          effect: "step",
          locator: "foot",
        },
        {
          channel: "timeline",
          keyframe_uuid: "kf-t",
          time: 0.75,
          data_point_index: null,
          script: "variable.ready = 1;",
        },
        {
          channel: "sound",
          removed: {
            keyframe_uuid: "kf-r",
            data_point_index: 0,
            remaining: [],
          },
        },
      ],
    });

    expect(isAnimationEffectsReceipt(receipt)).toBe(true);
  });

  test("rejects truncated results and incomplete point removals", () => {
    expect(
      isAnimationEffectsReceipt({
        animation: { uuid: "anim-a", name: "walk" },
        operation_count: 2,
        results: [
          {
            channel: "timeline",
            keyframe_uuid: "kf-a",
            time: 0.5,
            data_point_index: null,
            script: "",
          },
        ],
      })
    ).toBe(false);

    expect(
      isAnimationEffectsReceipt({
        animation: { uuid: "anim-a", name: "walk" },
        operation_count: 1,
        results: [
          {
            channel: "particle",
            removed: {
              keyframe_uuid: "kf-a",
              data_point_index: 0,
            },
          },
        ],
      })
    ).toBe(false);
  });

  test("Runtime and Control share the same Animation Effects receipt owner", async () => {
    const producer = await Bun.file("server/tools/animation/effects.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain(
      'from "@/lib/receipts/animationEffects"'
    );
    expect(producer).toContain("animationEffectsReceipt({");
    expect(control).toContain(
      'from "../../../lib/receipts/animationEffects"'
    );
    expect(control).toContain("receiptMatches(value, isAnimationEffectsReceipt)");
  });
});
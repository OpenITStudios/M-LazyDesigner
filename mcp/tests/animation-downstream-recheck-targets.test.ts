import { describe, expect, test } from "bun:test";
import { buildControlDelta } from "@/gateway/control";

describe("animation downstream recheck targets", () => {
  test("keyframe edits carry animation bone channel and time range", () => {
    const delta = buildControlDelta({
      capability: "manage_keyframes",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "edit",
        animation: { uuid: "anim-a", name: "walk" },
        bone: { uuid: "bone-a", name: "arm" },
        channel: "rotation",
        affected_keyframes: [
          { uuid: "kf-1", time: 0.25, interpolation: "linear" },
          { uuid: "kf-2", time: 0.75, interpolation: "linear" },
        ],
      },
    });

    const motion = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "ANIMATION_MOTION"
    );
    expect(motion?.target).toEqual({
      animation_uuid: "anim-a",
      bone_ids: ["bone-a"],
      channel: "rotation",
      time_range: [0.25, 0.75],
    });
  });

  test("graph edit uses the same bounded motion target", () => {
    const delta = buildControlDelta({
      capability: "animation_graph_editor",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "bezier",
        animation: { uuid: "anim-a", name: "walk" },
        bone: { uuid: "bone-a", name: "arm" },
        channel: "position",
        affected_keyframes: [
          { uuid: "kf-1", time: 1, interpolation: "bezier" },
        ],
      },
    });
    const motion = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "ANIMATION_MOTION"
    );
    expect(motion?.target).toEqual({
      animation_uuid: "anim-a",
      bone_ids: ["bone-a"],
      channel: "position",
      time_range: [1, 1],
    });
  });

  test("animation properties target the clip without inventing bone or range", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_timeline",
      branch: { field: "operation", value: "properties" },
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "properties",
        animation: { uuid: "anim-a", name: "walk" },
        changed_fields: ["loop_mode"],
      },
    });
    const motion = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "ANIMATION_MOTION"
    );
    expect(motion?.target).toEqual({ animation_uuid: "anim-a" });
  });

  test("legacy batch receipt without identity remains conservatively unbounded", () => {
    const delta = buildControlDelta({
      capability: "batch_keyframe_operations",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: { operation: "scale", source_keyframes: 4 },
    });
    const motion = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "ANIMATION_MOTION"
    );
    expect(motion?.target).toBeUndefined();
  });
  test("mixed invalid keyframe times refuse partial downstream motion ranges", () => {
    for (const time of [null, undefined, "query.anim_time", -0.5, NaN, Infinity]) {
      const delta = buildControlDelta({
        capability: "manage_keyframes",
        phaseBefore: "animation",
        phaseAfter: "animation",
        projectUuid: "project-a",
        succeeded: true,
        result: {
          action: "edit",
          animation: { uuid: "anim-a" },
          bone: { uuid: "bone-a" },
          channel: "rotation",
          affected_keyframes: [
            { uuid: "kf-1", time: 0.25 },
            { uuid: "kf-unknown", time },
            { uuid: "kf-3", time: 0.75 },
          ],
        },
      });
      const motion = delta.downstream_recheck.required.find(
        (entry) => entry.scope === "ANIMATION_MOTION"
      );
      expect(delta.freshness.stale).toContain("ANIMATION_MOTION");
      expect(motion?.action).toBe("REVERIFY_ANIMATION_MOTION");
      expect(motion?.target).toBeUndefined();
      expect(delta.verification_scope).toBeNull();
    }
  });

  test("blank clip or bone identity cannot enable narrow motion review", () => {
    for (const pair of [
      { animation: { uuid: "" }, bone: { uuid: "bone-a" } },
      { animation: { uuid: "anim-a" }, bone: { uuid: " " } },
    ]) {
      const delta = buildControlDelta({
        capability: "manage_keyframes",
        phaseBefore: "animation", phaseAfter: "animation",
        projectUuid: "project-a", succeeded: true,
        result: {
          ...pair, action: "edit", channel: "position",
          affected_keyframes: [{ time: 0.5 }],
        },
      });
      expect(delta.downstream_recheck.required.find(
        (entry) => entry.scope === "ANIMATION_MOTION"
      )?.target).toBeUndefined();
    }
  });

});

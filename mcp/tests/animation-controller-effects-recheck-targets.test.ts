import { describe, expect, test } from "bun:test";
import { buildControlDelta } from "@/gateway/control";

describe("animation controller and effects recheck targets", () => {
  test("controller receipt carries controller and affected state identities", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_controller",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        action: "updated",
        operation_count: 2,
        controller: {
          uuid: "controller-a",
          name: "controller.animation.test",
          initial_state: { uuid: "state-a", name: "default" },
          state_count: 2,
        },
        affected_states: [
          {
            uuid: "state-a",
            name: "default",
            on_entry: null,
            on_exit: null,
            blend_transition: 0,
            blend_transition_curve: null,
            blend_via_shortest_path: false,
            animations: [], transitions: [], sounds: [], particles: [],
          },
        ],
        created: {
          states: [{ uuid: "state-b", name: "run" }],
          transitions: [], animation_links: [], sounds: [], particles: [],
        },
        removed: {
          states: [], transitions: [], animation_links: [], sounds: [], particles: [],
        },
      },
    });
    const controller = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "ANIMATION_CONTROLLER"
    );
    expect(controller?.target).toEqual({
      controller_uuid: "controller-a",
      state_ids: ["state-a", "state-b"],
    });
  });

  test("effect receipt carries animation channel and bounded time range", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_effects",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        animation: { uuid: "anim-a", name: "walk" },
        operation_count: 2,
        results: [
          {
            channel: "sound",
            keyframe_uuid: "kf-s",
            time: 0.5,
            data_point_index: 0,
            effect: "step",
            locator: null,
          },
          {
            channel: "particle",
            keyframe_uuid: "kf-p",
            time: 1.25,
            data_point_index: 0,
            effect: "dust",
            locator: null,
            bind_to_actor: null,
            pre_effect_script: null,
          },
        ],
      },
    });
    const effects = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "ANIMATION_EFFECTS"
    );
    expect(effects?.target).toEqual({
      animation_uuid: "anim-a",
      channels: ["sound", "particle"],
      time_range: [0.5, 1.25],
    });
  });

  test("effect removal without time does not invent a range", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_effects",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        animation: { uuid: "anim-a", name: "walk" },
        operation_count: 1,
        results: [
          {
            channel: "timeline",
            removed: { keyframe_uuid: "kf-t", data_point_index: null },
          },
        ],
      },
    });
    const effects = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "ANIMATION_EFFECTS"
    );
    expect(effects?.target).toEqual({
      animation_uuid: "anim-a",
      channels: ["timeline"],
    });
  });
  test("partial effects receipts never claim a complete channel/time target", () => {
    const valid = {
      animation: { uuid: "anim-a" },
      operation_count: 2,
      results: [
        { channel: "sound", time: 0.25 },
        { channel: "particle", time: 0.75 },
      ],
    };
    for (const invalid of [
      { results: [valid.results[0], null] },
      { results: [valid.results[0], { channel: "unknown", time: 0.75 }] },
      { results: [valid.results[0]] },
      { operation_count: 3 },
    ]) {
      const delta = buildControlDelta({
        capability: "manage_animation_effects",
        phaseBefore: "animation",
        phaseAfter: "animation",
        projectUuid: "project-a",
        succeeded: true,
        result: { ...valid, ...invalid },
      });
      const effects = delta.downstream_recheck.required.find(
        entry => entry.scope === "ANIMATION_EFFECTS"
      );
      expect(effects?.action).toBe("REVERIFY_ANIMATION_EFFECTS");
      expect(effects?.target, JSON.stringify(invalid)).toBeUndefined();
    }
  });

  test("mixed timed and untimed effects retain channel identity without invented range", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_effects",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        animation: { uuid: "anim-a" },
        operation_count: 2,
        results: [
          { channel: "sound", time: 0.25, keyframe_uuid: "s" },
          { channel: "particle", removed: { keyframe_uuid: "p" } },
        ],
      },
    });
    const effects = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "ANIMATION_EFFECTS"
    );
    expect(effects?.target).toEqual({
      animation_uuid: "anim-a",
      channels: ["sound", "particle"],
    });
  });

});

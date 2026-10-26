import { describe, expect, test } from "bun:test";
import {
  animationControllerReceipt,
  isAnimationControllerReceipt,
  isAnimationControllerCompileOnlyResourceReceipt,
} from "@/lib/receipts/animationController";

const emptyLifecycle = {
  states: [],
  transitions: [],
  animation_links: [],
  sounds: [],
  particles: [],
};

describe("shared animation controller receipt contract", () => {
  test("accepts final affected controller state and lifecycle identities", () => {
    const receipt = animationControllerReceipt({
      execution: "applied",
      action: "updated",
      operation_count: 1,
      controller: {
        uuid: "controller-a",
        name: "controller.animation.test",
        initial_state: { uuid: "state-a", name: "idle" },
        state_count: 1,
      },
      affected_states: [
        {
          uuid: "state-a",
          name: "idle",
          on_entry: null,
          on_exit: null,
          blend_transition: 0,
          blend_transition_curve: null,
          blend_via_shortest_path: false,
          animations: [],
          transitions: [],
          sounds: [],
          particles: [],
        },
      ],
      created: emptyLifecycle,
      removed: emptyLifecycle,
    });

    expect(isAnimationControllerReceipt(receipt)).toBe(true);
  });

  test("rejects malformed lifecycle identities and incomplete affected states", () => {
    expect(
      isAnimationControllerReceipt({
        execution: "applied",
        action: "updated",
        operation_count: 1,
        controller: {
          uuid: "controller-a",
          name: "controller.animation.test",
          initial_state: null,
          state_count: 1,
        },
        affected_states: [],
        created: {
          ...emptyLifecycle,
          states: [{ uuid: "", name: "broken" }],
        },
        removed: emptyLifecycle,
      })
    ).toBe(false);

    expect(
      isAnimationControllerReceipt({
        execution: "applied",
        action: "updated",
        operation_count: 1,
        controller: {
          uuid: "controller-a",
          name: "controller.animation.test",
          initial_state: null,
          state_count: 1,
        },
        affected_states: [{ uuid: "state-a", name: "idle" }],
        created: emptyLifecycle,
        removed: emptyLifecycle,
      })
    ).toBe(false);
  });

  test("compile-only resource receipt needs inline source and no persisted write", () => {
    const valid = {
      execution: "applied", action: "runtime_resource",
      resource_kind: "client_entity",
      source_path: null, write: null, content: "{}", truncated: false,
    };
    expect(isAnimationControllerCompileOnlyResourceReceipt(valid)).toBe(true);
    for (const result of [
      {...valid,source_path:"/tmp/client_entity.json"},
      {...valid,write:{path:"/tmp/output.json",byte_length:8}},
      {...valid,resource_kind:"unknown"},
      {...valid,execution:"read"},
      {...valid,action:"updated"},
      {action:"runtime_resource",write:null},
    ]) expect(isAnimationControllerCompileOnlyResourceReceipt(result)).toBe(false);
  });

  test("Runtime and Control share the same Animation Controller receipt owner", async () => {
    const producer = await Bun.file("server/tools/animation/controller.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain(
      'from "@/lib/receipts/animationController"'
    );
    expect(producer).toContain("animationControllerReceipt({");
    expect(control).toContain(
      'from "../../../lib/receipts/animationController"'
    );
    expect(control).toContain("receiptMatches(value, isAnimationControllerReceipt)");
  });
});
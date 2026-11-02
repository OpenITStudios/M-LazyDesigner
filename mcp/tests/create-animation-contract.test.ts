import { describe, expect, test } from "bun:test";
import {
  createAnimationParameters,
  normalizeBedrockAnimationName,
} from "@/server/tools/animation";
import { describeAuthoredAnimationCreationTiming } from "@/server/tools/animation/create";

describe("create_animation contract", () => {
  test("rejects near-native same-channel key collisions but permits independent channels", () => {
    const frame = (time: number, channel: "rotation" | "position") =>
      ({ time, [channel]: [0, 0, 0] });
    const near = createAnimationParameters.safeParse({
      name: "unsafe_frames", bones: { arm: [
        frame(0.5, "rotation"), frame(0.50005, "rotation"),
      ] },
    });
    expect(near.success).toBe(false);
    if (!near.success) {
      expect(near.error.issues.some((issue) =>
        issue.message.includes("replacement tolerance")
      )).toBe(true);
    }
    const independent = createAnimationParameters.safeParse({
      name: "independent_channels", bones: { arm: [
        frame(0.5, "rotation"), frame(0.50005, "position"),
      ] },
    });
    expect(independent.success).toBe(true);
  });

  test("accepts explicit zero animation length", () => {
    const result = createAnimationParameters.parse({
      name: "idle",
      animation_length: 0,
      bones: {},
    });
    expect(result.animation_length).toBe(0);
  });

  test("Bedrock animation prefix is applied exactly once", async () => {
    expect(normalizeBedrockAnimationName("walk")).toBe("animation.walk");
    expect(normalizeBedrockAnimationName("animation.walk")).toBe("animation.walk");

    const source = await Bun.file(new URL("../server/tools/animation/create.ts", import.meta.url)).text();
    expect(source).toContain("normalizeBedrockAnimationName(name)");
    expect(source).not.toContain("const requestedAnimationName = `animation.${name}`");
  });

  test("serializer preserves accepted zero instead of treating it as omitted", async () => {
    const source = await Bun.file(new URL("../server/tools/animation/create.ts", import.meta.url)).text();
    expect(source).toContain("animation_length !== undefined && { animation_length }");
    expect(source).not.toContain("animation_length && { animation_length }");
  });

  test("accepts bounded Bedrock sound effect maps without a new tool", async () => {
    expect(createAnimationParameters.safeParse({
      name: "sound_test",
      bones: {},
      sound_effects: {
        "0": { effect: "start" },
        "0.5": [{ effect: "loop" }, { effect: "accent", locator: "mouth" }],
      },
    }).success).toBe(true);
    expect(createAnimationParameters.safeParse({
      name: "bad_sound",
      bones: {},
      sound_effects: { "0": { effect: "" } },
    }).success).toBe(false);
    expect(createAnimationParameters.safeParse({
      name: "bad_time",
      bones: {},
      sound_effects: { "0": { effect: "a" }, "0.0": { effect: "b" } },
    }).success).toBe(false);

    const source = await Bun.file("server/tools/animation/create.ts").text();
    expect(source).toContain("...(sound_effects && { sound_effects })");
    expect(source).toContain("requested_sound_effect_count");
    expect(source).not.toContain("manage_sound_keyframes");
  });

  test("real create_animation serializer consumes compacted linear keys before native codec load", async () => {
    const source = await Bun.file("server/tools/animation/create.ts").text();
    const plan = source.indexOf("const compactedBoneEntries =");
    const write = source.indexOf("compactedBoneEntries.map(({ group, compaction })");
    const undo = source.indexOf("Undo.initEdit({ animations: [] })");
    expect(plan).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(plan);
    expect(undo).toBeGreaterThan(write);
    expect(source).toContain("protectedEventTimes");
    expect(source).toContain("linear_key_compaction");
  });

  test("selects the created animation before completing the Undo edit", async () => {
    const source = await Bun.file(new URL("../server/tools/animation/create.ts", import.meta.url)).text();
    expect(source).toContain("createdAnimation.select()");
    expect(source).toContain("AnimationItem.selected !== createdAnimation");
    expect(source.indexOf("createdAnimation.select()")).toBeLessThan(
      source.indexOf('Undo.finishEdit("Create animation"')
    );
  });
});


describe("create_animation source timeline coverage receipt", () => {
  test("flags authored transforms and effects after a declared clip duration without claiming playback", () => {
    const coverage = describeAuthoredAnimationCreationTiming({
      animation_length: 1,
      bones: {
        arm: [
          { time: 0, rotation: [0, 0, 0] },
          { time: 1.25, rotation: [10, 0, 0] },
        ],
      },
      effect_times: [0, 1.5],
    });
    expect(coverage).toMatchObject({
      state: "REVIEW_SOURCE_TIMES_AFTER_DECLARED_DURATION",
      declared_duration_seconds: 1,
      latest_transform_time_seconds: 1.25,
      latest_effect_time_seconds: 1.5,
      after_duration_transform_frame_count: 1,
      after_duration_effect_timestamp_count: 1,
      source_only: true,
      native_timeline_sampling_performed: false,
      visual_verdict: "not_evaluated",
    });
  });

  test("distinguishes absent explicit duration from an authored zero duration", () => {
    const input = {
      bones: { arm: [{ time: 0.2, rotation: [0, 0, 0] }] },
      effect_times: [] as number[],
    };
    expect(describeAuthoredAnimationCreationTiming(input).state)
      .toBe("NO_EXPLICIT_DURATION");
    expect(describeAuthoredAnimationCreationTiming({
      ...input, animation_length: 0,
    })).toMatchObject({
      state: "REVIEW_SOURCE_TIMES_AFTER_DECLARED_DURATION",
      declared_duration_seconds: 0,
      after_duration_transform_frame_count: 1,
    });
    expect(describeAuthoredAnimationCreationTiming({
      ...input, animation_length: 0.2,
    })).toMatchObject({
      state: "WITHIN_DECLARED_DURATION",
      after_duration_transform_frame_count: 0,
    });
  });

  test("does not treat empty authored transform records as active keys", () => {
    const input = {
      animation_length: 1,
      bones: { arm: [
        { time: 3 }, { time: 0.25, position: [0, 0, 0] },
      ] },
      effect_times: [0.75],
    };
    expect(describeAuthoredAnimationCreationTiming(input)).toMatchObject({
      state: "WITHIN_DECLARED_DURATION",
      latest_transform_time_seconds: 0.25,
      authored_transform_frame_count: 1,
    });
  });

  test("rejects invalid helper input, retains nonmutating native create receipt wiring", async () => {
    const invalid = {
      animation_length: Number.POSITIVE_INFINITY,
      bones: {},
      effect_times: [] as number[],
    };
    expect(() => describeAuthoredAnimationCreationTiming(invalid))
      .toThrow("Invalid source duration");
    const source = await Bun.file("server/tools/animation/create.ts").text();
    const observation = source.indexOf("const sourceTiming = describeAuthoredAnimationCreationTiming");
    const mutation = source.indexOf("Undo.initEdit({ animations: [] })");
    expect(observation).toBeGreaterThan(0);
    expect(mutation).toBeGreaterThan(observation);
    expect(source).toContain("source_timing: sourceTiming");
  });
});

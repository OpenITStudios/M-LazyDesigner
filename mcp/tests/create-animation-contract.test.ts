import { describe, expect, test } from "bun:test";
import {
  createAnimationParameters,
  normalizeBedrockAnimationName,
} from "@/server/tools/animation";
import {
  describeAuthoredAnimationCreationTiming,
  settleFailedAnimationCreation,
} from "@/server/tools/animation/create";

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


describe("native create_animation codec timing gate", () => {
  test("compares actual imported tracks and native timecodes before completing Undo", async () => {
    const source = await Bun.file("server/tools/animation/create.ts").text();
    const load = source.indexOf("const codecCreatedAnimations = codec.loadFile(");
    const timing = source.indexOf("requireNativeCreationTimingIntegrity(nativeTimingTracks)");
    const select = source.indexOf("createdAnimation.select()");
    const finish = source.indexOf('Undo.finishEdit("Create animation"');
    expect(load).toBeGreaterThan(0);
    expect(timing).toBeGreaterThan(load);
    expect(select).toBeGreaterThan(timing);
    expect(finish).toBeGreaterThan(select);
    expect(source).toContain("getTimecodeString()");
    expect(source).toContain("native_timing: nativeTiming");
    expect(source).toContain("Undo.cancelEdit(true)");
    expect(source).toContain("animation.remove(false, false)");
  });

  test("native creation retains the same public schema and exactly one codec mutation", async () => {
    const source = await Bun.file("server/tools/animation/create.ts").text();
    expect(createAnimationParameters.shape).toHaveProperty("bones");
    expect(createAnimationParameters.shape).not.toHaveProperty("semantic_motion");
    expect(source.match(/codec\.loadFile\(/g)?.length).toBe(1);
    expect(source).not.toContain("risky_eval");
    expect(source).not.toContain("Animator.preview()");
    expect(source).not.toContain("sampleIK()");
  });
});

describe("native create_animation outcome-aware rollback", () => {
  const cause = new Error("native import failed");
  const recovery = (overrides: Partial<Parameters<typeof settleFailedAnimationCreation>[1]> = {}) => {
    const called: string[] = [];
    return {
      called,
      scope: {
        finish_attempted: false,
        commit_completed: false,
        undo_edit_started: true,
        collect_created_removals: () => [
          () => called.push("remove:a"),
          () => called.push("remove:b"),
        ],
        cancel_undo_edit: () => { called.push("cancel"); },
        ...overrides,
      },
    };
  };

  test("a pre-commit failure removes all new clips, cancels Undo and preserves the original cause", () => {
    const f = recovery();
    let caught: unknown;
    try { settleFailedAnimationCreation(cause, f.scope); }
    catch (error) { caught = error; }
    expect(caught).toBe(cause);
    expect(f.called).toEqual(["remove:a", "remove:b", "cancel"]);
  });

  test("a failed clip removal does not suppress sibling cleanup or Undo cancellation", () => {
    const f = recovery({
      collect_created_removals: () => [
        () => { f.called.push("remove:a"); throw new Error("cannot remove a"); },
        () => { f.called.push("remove:b"); },
      ],
      cancel_undo_edit: () => { f.called.push("cancel"); },
    });
    let caught: unknown;
    try { settleFailedAnimationCreation(cause, f.scope); }
    catch (error) { caught = error; }
    expect(f.called).toEqual(["remove:a", "remove:b", "cancel"]);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).message).toContain("ROLLBACK_OUTCOME_UNKNOWN");
    expect((caught as AggregateError).errors[0]).toBe(cause);
    expect((caught as AggregateError).errors).toHaveLength(2);
  });

  test("an inventory read failure still attempts Undo cancellation", () => {
    const f = recovery({
      collect_created_removals: () => { throw new Error("animation inventory unavailable"); },
    });
    expect(() => settleFailedAnimationCreation(cause, f.scope))
      .toThrow("ROLLBACK_OUTCOME_UNKNOWN");
    expect(f.called).toEqual(["cancel"]);
  });

  test("both cleanup phases failing are surfaced, not mistaken for a clean rollback", () => {
    const f = recovery({
      collect_created_removals: () => [
        () => { throw new Error("remove failed"); },
      ],
      cancel_undo_edit: () => { throw new Error("undo cancel failed"); },
    });
    let caught: unknown;
    try { settleFailedAnimationCreation(cause, f.scope); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(3);
  });

  test("a committed animation is never deleted because a receipt/history step failed", () => {
    const f = recovery({ finish_attempted: true, commit_completed: true });
    let caught: unknown;
    try { settleFailedAnimationCreation(cause, f.scope); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("POST_COMMIT_REPORTING_FAILURE");
    expect((caught as Error).cause).toBe(cause);
    expect(f.called).toEqual([]);
  });

  test("a native finishEdit exception remains OUTCOME_UNKNOWN and blocks blind deletion/retry", () => {
    const f = recovery({ finish_attempted: true, commit_completed: false });
    let caught: unknown;
    try { settleFailedAnimationCreation(cause, f.scope); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("COMMIT_OUTCOME_UNKNOWN");
    expect((caught as Error).cause).toBe(cause);
    expect(f.called).toEqual([]);
  });

  test("does not attempt Undo cancellation if the native edit was never opened", () => {
    const f = recovery({ undo_edit_started: false });
    expect(() => settleFailedAnimationCreation(cause, f.scope)).toThrow(cause);
    expect(f.called).toEqual(["remove:a", "remove:b"]);
  });

  test("the native caller tracks finishEdit and commit completion in the correct order", async () => {
    const src = await Bun.file("server/tools/animation/create.ts").text();
    const preflight = src.indexOf("requireNativeCreationTimingIntegrity(nativeTimingTracks)");
    const finishing = src.indexOf("finishAttempted = true;");
    const commit = src.indexOf('Undo.finishEdit("Create animation"');
    const completed = src.indexOf("editCommitted = true;");
    const history = src.indexOf('recordCurrentCapabilitySemanticHistoryEffect("create_animation")');
    expect(preflight).toBeGreaterThan(0);
    expect(finishing).toBeGreaterThan(preflight);
    expect(commit).toBeGreaterThan(finishing);
    expect(completed).toBeGreaterThan(commit);
    expect(history).toBeGreaterThan(completed);
    expect(src).toContain("return settleFailedAnimationCreation(error, {");
  });
});


describe("native new-clip snapping integration", () => {
  test("selects source-preserving snapping after native import but before timecode readback and Undo", async () => {
    const source = await Bun.file("server/tools/animation/create.ts").text();
    const sourcePlan = source.indexOf("const snappingSourceTracks:");
    const undoStart = source.indexOf("Undo.initEdit({ animations: [] })");
    const codecLoad = source.indexOf("const codecCreatedAnimations = codec.loadFile(");
    const resolution = source.indexOf("const snappingResolution = planNativeCreationSnapping(");
    const adjust = source.indexOf("createdAnimation.snapping = snappingResolution.applied_snapping_fps;");
    const nativeReadback = source.indexOf("const nativeTimingTracks:");
    const finish = source.indexOf('Undo.finishEdit("Create animation"');
    expect(sourcePlan).toBeGreaterThan(0);
    expect(sourcePlan).toBeLessThan(undoStart);
    expect(codecLoad).toBeGreaterThan(undoStart);
    expect(resolution).toBeGreaterThan(codecLoad);
    expect(adjust).toBeGreaterThan(resolution);
    expect(nativeReadback).toBeGreaterThan(adjust);
    expect(finish).toBeGreaterThan(nativeReadback);
    expect(source).toContain("snapping_resolution: snappingResolution");
    expect(source).toContain("ANIMATION_NATIVE_SNAPPING_UPDATE_NOT_PERSISTED");
    expect(source).toContain("requireNativeCreationTimingIntegrity(nativeTimingTracks)");
  });

  test("does not alter global timeline, other clips or public animation input fields", async () => {
    const source = await Bun.file("server/tools/animation/create.ts").text();
    expect(createAnimationParameters.shape).not.toHaveProperty("snapping");
    expect(createAnimationParameters.shape).not.toHaveProperty("semantic_motion");
    expect(source).not.toContain("Timeline.setTime(");
    expect(source).not.toContain("Animator.preview(");
    expect(source).not.toContain("sampleIK(");
    expect(source).toContain('state === "ADJUST_NEW_CLIP"');
    expect(source).toContain("createdAnimation.snapping = snappingResolution.applied_snapping_fps;");
    expect(source).not.toContain("Project.animations.forEach(");
  });
});

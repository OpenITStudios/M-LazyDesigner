import { describe, expect, test } from "bun:test";
import {
  requireValidPlannedBatchTrackTimes,
  requireNativeCreationTimingIntegrity,
  planNativeCreationSnapping,
  planBatchScaleOverwriteTargets,
  selectBatchKeyframes,
} from "../lib/animation/batchPlanning";

describe("track-aware keyframe batch scale preflight", () => {
  test("different bones may share a snapped keyframe time", () => {
    const a = {}, b = {};
    expect(() => requireValidPlannedBatchTrackTimes(
      [{ animator: a, channel: "rotation" }, { animator: b, channel: "rotation" }],
      [1, 1], "scale"
    )).not.toThrow();
  });
  test("one animator's different channels may share a snapped time", () => {
    const a = {};
    expect(() => requireValidPlannedBatchTrackTimes(
      [{ animator: a, channel: "position" }, { animator: a, channel: "rotation" }],
      [1, 1], "scale"
    )).not.toThrow();
  });
  test("same animator/channel collapsing at the snapped time still refuses", () => {
    const a = {};
    expect(() => requireValidPlannedBatchTrackTimes(
      [{ animator: a, channel: "rotation" }, { animator: a, channel: "rotation" }],
      [1, 1], "scale"
    )).toThrow("collapse multiple selected keyframes");
  });
  test("native near-collisions on one track are rejected before Undo", () => {
    const animator = {};
    const selected = [
      { animator, channel: "rotation" },
      { animator, channel: "rotation" },
    ];
    expect(() => requireValidPlannedBatchTrackTimes(selected, [1, 1.00005], "scale"))
      .toThrow("collapse multiple selected keyframes");
    expect(() => requireValidPlannedBatchTrackTimes(selected, [1, 1.00011], "scale"))
      .not.toThrow();
  });

  test("preflight predicts only unselected casualties on the same track", () => {
    const a = {}, b = {};
    const moving = { animator: a, channel: "rotation", time: 1 };
    const selectedOther = { animator: a, channel: "rotation", time: 2 };
    const victim = { animator: a, channel: "rotation", time: 1.50005 };
    const differentChannel = { animator: a, channel: "position", time: 1.5 };
    const differentBone = { animator: b, channel: "rotation", time: 1.5 };
    expect(planBatchScaleOverwriteTargets(
      [moving, selectedOther],
      [moving, selectedOther, victim, differentChannel, differentBone],
      [1.5, 3]
    )).toEqual([victim]);
  });

  test("overwrite scan reads unrelated animator tracks only once and preserves victim order", () => {
    const animatorA = {}, animatorB = {};
    const selected = Array.from({ length: 10 }, (_, index) => ({
      animator: animatorA, channel: "rotation", time: index / 10,
    }));
    let unrelatedTrackReads = 0;
    const unrelated = Array.from({ length: 250 }, (_, index) => ({
      get animator() {
        unrelatedTrackReads += 1;
        return animatorB;
      },
      channel: "rotation",
      time: index / 10,
    }));
    const first = { animator: animatorA, channel: "rotation", time: 1.50005 };
    const second = { animator: animatorA, channel: "rotation", time: 2.50005 };
    const otherChannel = { animator: animatorA, channel: "position", time: 1.5 };
    const times = selected.map((_, index) =>
      index === 0 ? 1.5 : index === 1 ? 2.5 : 100 + index
    );

    expect(planBatchScaleOverwriteTargets(
      selected, [second, ...unrelated, first, otherChannel, ...selected], times
    )).toEqual([first, second]);
    // The same 250 unrelated keys are not checked separately for each
    // selected keyframe. This is a deterministic read-count bound, not latency.
    expect(unrelatedTrackReads).toBe(250);
  });

  test("invalid and mismatched planned times fail before native edit", () => {
    const keyframes = [{ animator: {}, channel: "rotation" }];
    expect(() => requireValidPlannedBatchTrackTimes(keyframes, [-1], "scale")).toThrow("0..10000");
    expect(() => requireValidPlannedBatchTrackTimes(keyframes, [10001], "scale")).toThrow("0..10000");
    expect(() => requireValidPlannedBatchTrackTimes(keyframes, [1, 2], "scale")).toThrow("mismatched");
  });
  test("unknown animator/channel is never silently grouped", () => {
    expect(() => requireValidPlannedBatchTrackTimes(
      [{ animator: null, channel: "rotation" }], [1], "scale"
    )).toThrow("known animator and channel");
    expect(() => requireValidPlannedBatchTrackTimes(
      [{ animator: {}, channel: "" }], [1], "scale"
    )).toThrow("known animator and channel");
  });
  test("pattern selection includes exact decimal multiples affected by floating-point remainder", () => {
    const keyframes = [0.1, 0.2, 0.3, 0.6, 0.35].map((time) => ({ time }));
    const selected = selectBatchKeyframes(keyframes, [], "pattern", {
      pattern: { interval: 0.1, offset: 0 },
      tolerance: 1e-9,
    });
    expect(selected.map((item) => item.time)).toEqual([0.1, 0.2, 0.3, 0.6]);
  });

  test("pattern tolerance is symmetric at both sides of a repetition boundary", () => {
    const keyframes = [1.9995, 2.0005, -0.9995, 1.5].map((time) => ({ time }));
    const selected = selectBatchKeyframes(keyframes, [], "pattern", {
      pattern: { interval: 1, offset: 0 },
      tolerance: 0.001,
    });
    expect(selected.map((item) => item.time)).toEqual([1.9995, 2.0005, -0.9995]);

    expect(selectBatchKeyframes([{ time: 0.3 }], [], "pattern", {
      pattern: { interval: 0.2, offset: 0.1 },
      tolerance: 1e-9,
    })).toEqual([{ time: 0.3 }]);
  });

  test("preflight occurs before native Undo and rollback is retained", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const start = source.indexOf('if (operation === "scale")');
    const end = source.indexOf('if (operation === "reverse")', start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(block.indexOf("requireValidPlannedBatchTrackTimes(")).toBeGreaterThan(0);
    expect(block.indexOf("requireValidPlannedBatchTrackTimes(")).toBeLessThan(block.indexOf("Undo.initEdit("));
    expect(block).toContain("keyframe.replaceOthers(replacedKeyframes);");
    expect(block).toContain("expectedOverwrites.some(keyframe => !actualOverwrites.has(keyframe))");
    expect(block).toContain("animations: [animation]");
    expect(block).not.toContain("Undo.addKeyframeCasualties(replacedKeyframes)");
    expect(block).toContain("Undo.cancelEdit(true);");
  });
});


describe("native Bedrock AnimationCodec timing integrity", () => {
  const track = (
    source_times: number[],
    imported_times: number[],
    exported_times: number[],
    channel: "rotation" | "position" | "scale" | "sound" | "particle" = "rotation"
  ) => ({
    bone_id: channel === "sound" ? "effects" : "body",
    channel, source_times, imported_times, exported_times,
  });

  test("accepts independent channel tracks and bounded formatted frame fractions", () => {
    const result = requireNativeCreationTimingIntegrity([
      track([0, 1 / 30, 1], [0, 1 / 30, 1], [0, 0.0333, 1]),
      track([0, 1], [0, 1], [0, 1], "position"),
      track([0.5], [0.5], [0.5], "sound"),
    ]);
    expect(result).toMatchObject({
      state: "CODEC_TIMES_MATCHED",
      checked_track_count: 3,
      checked_keyframe_count: 6,
      native_timing_readback_required: true,
      native_export_timecodes_required: true,
      native_playback_attested: false,
      visual_verdict: "not_evaluated",
    });
  });

  test("rejects the importer dropping a requested native key", () => {
    expect(() => requireNativeCreationTimingIntegrity([
      track([0, 0.5, 1], [0, 1], [0, 1]),
    ])).toThrow("ANIMATION_NATIVE_TIMING_KEY_LOSS");
  });

  test("rejects an imported time that differs from original authored time", () => {
    expect(() => requireNativeCreationTimingIntegrity([
      track([0, 0.5], [0, 0.45], [0, 0.45]),
    ])).toThrow("ANIMATION_NATIVE_TIMING_IMPORT_DRIFT");
  });

  test("rejects silent time-grid rounding before native Bedrock export", () => {
    expect(() => requireNativeCreationTimingIntegrity([
      track([0, 0.37, 1], [0, 0.37, 1], [0, 0.35, 1]),
    ])).toThrow("ANIMATION_NATIVE_TIMING_EXPORT_SNAP");
  });

  test("prioritizes same-track export collision over ordinary rounding drift", () => {
    expect(() => requireNativeCreationTimingIntegrity([
      track([0, 0.05], [0, 0.05], [0, 0]),
    ])).toThrow("ANIMATION_NATIVE_TIMING_EXPORT_COLLISION");
  });

  test("checks an effect track independently and rejects invalid evidence", () => {
    expect(() => requireNativeCreationTimingIntegrity([
      track([0.15], [0.15], [0.1], "sound"),
    ])).toThrow("ANIMATION_NATIVE_TIMING_EXPORT_SNAP");
    expect(() => requireNativeCreationTimingIntegrity([
      track([0], [Number.NaN], [0], "particle"),
    ])).toThrow("ANIMATION_NATIVE_TIMING_NONFINITE");
    expect(() => requireNativeCreationTimingIntegrity([
      track([0.25], [0.25], [-1], "scale"),
    ])).toThrow("ANIMATION_NATIVE_TIMING_NONFINITE");
  });

  test("allows empty independent transform channels but no fabricated native proof", () => {
    const result = requireNativeCreationTimingIntegrity([
      track([], [], [], "position"),
    ]);
    expect(result.checked_keyframe_count).toBe(0);
    expect(result.native_playback_attested).toBe(false);
  });
});


describe("new-clip native export snapping negotiation", () => {
  const track = (
    channel: "position" | "rotation" | "scale" | "sound" | "particle",
    source_times: number[],
    bone_id = "body"
  ) => ({ bone_id, channel, source_times });

  test("preserves an already compatible native snapping setting", () => {
    const input = [
      track("rotation", [0, 0.05, 0.5, 1]),
      track("sound", [0, 0.5], "effects"),
    ];
    const source = JSON.stringify(input);
    expect(planNativeCreationSnapping(input, 20)).toMatchObject({
      state: "KEEP_NATIVE",
      baseline_snapping_fps: 20,
      applied_snapping_fps: 20,
      effective_export_fps: 20,
      source_key_count: 6,
      scope: "NEW_NATIVE_CLIP_ONLY",
      native_playback_attested: false,
      visual_verdict: "not_evaluated",
    });
    expect(JSON.stringify(input)).toBe(source);
  });

  test("negotiates a new-clip FPS that preserves 1/30-second keys instead of dropping them", () => {
    expect(planNativeCreationSnapping([
      track("position", [0, 1 / 30, 1]),
    ], 20)).toMatchObject({
      state: "ADJUST_NEW_CLIP",
      baseline_snapping_fps: 20,
      applied_snapping_fps: 30,
      effective_export_fps: 30,
      source_key_count: 3,
    });
  });

  test("finds an allowed rate for eighth-second contact boundaries", () => {
    const resolution = planNativeCreationSnapping([
      track("position", [0, 0.125, 0.875, 1]),
    ], 20);
    expect(resolution.state).toBe("ADJUST_NEW_CLIP");
    expect(resolution.applied_snapping_fps).toBe(16);
  });

  test("treats a legacy 500 FPS setting as effective 120 for native export", () => {
    const resolution = planNativeCreationSnapping([
      track("rotation", [0, 1 / 120, 1]),
    ], 500);
    expect(resolution).toMatchObject({
      state: "KEEP_NATIVE",
      baseline_snapping_fps: 500,
      applied_snapping_fps: 500,
      effective_export_fps: 120,
    });
  });

  test("refuses an unrepresentable time rather than silently snapping it", () => {
    expect(() => planNativeCreationSnapping([
      track("position", [0, 0.002345, 1]),
    ], 20)).toThrow("ANIMATION_NATIVE_SNAPPING_UNREPRESENTABLE");
  });

  test("allows equal timestamps across different bones/channels but not one track collision", () => {
    expect(() => planNativeCreationSnapping([
      track("position", [0, 0.5]),
      track("rotation", [0, 0.5]),
      track("position", [0, 0.5], "arm"),
    ], 20)).not.toThrow();
    expect(() => planNativeCreationSnapping([
      track("position", [0.5, 0.50005]),
    ], 20)).toThrow("ANIMATION_NATIVE_SNAPPING_SOURCE_COLLISION");
  });

  test("refuses invalid baseline FPS, source timestamps and malformed tracks", () => {
    for (const fps of [0, 9, 501, Number.NaN, 20.5]) {
      expect(() => planNativeCreationSnapping([], fps))
        .toThrow("ANIMATION_NATIVE_SNAPPING_BASELINE_INVALID");
    }
    expect(() => planNativeCreationSnapping([
      track("rotation", [Number.NaN]),
    ], 20)).toThrow("ANIMATION_NATIVE_SNAPPING_SOURCE_TIME_INVALID");
    expect(() => planNativeCreationSnapping([
      track("rotation", [-1]),
    ], 20)).toThrow("ANIMATION_NATIVE_SNAPPING_SOURCE_TIME_INVALID");
    expect(() => planNativeCreationSnapping([
      track("rotation", [10001]),
    ], 20)).toThrow("ANIMATION_NATIVE_SNAPPING_SOURCE_TIME_INVALID");
  });

  test("keeps empty source tracks but never implies playback has been observed", () => {
    expect(planNativeCreationSnapping([], 20)).toMatchObject({
      state: "KEEP_NATIVE",
      source_key_count: 0,
      native_playback_attested: false,
    });
    expect(planNativeCreationSnapping([
      track("particle", [], "effects"),
    ], 20).source_key_count).toBe(0);
  });
});

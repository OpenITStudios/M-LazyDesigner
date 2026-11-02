import { describe, expect, test } from "bun:test";
import {
  isAnimationCreationReceipt,
  animationCreationReceiptSchema,
} from "@/lib/receipts/animationCreation";

describe("create_animation native creation evidence", () => {
  const native = {
    animation: {
      uuid: "clip-a", name: "animation.model.walk",
      loop: "loop", length: 2, snapping: 20,
    },
    requested_name: "animation.model.walk",
    requested_bone_count: 2,
    requested_particle_effect_count: 0,
    requested_sound_effect_count: 0,
  };

  test("accepts reported native codec identity without claiming playback fidelity", () => {
    expect(isAnimationCreationReceipt(native)).toBe(true);
    expect(animationCreationReceiptSchema.parse(native).animation.uuid)
      .toBe("clip-a");
  });

  test("refuses a status label, missing UUID or unverified input counts", () => {
    for (const value of [
      undefined,
      { success: true },
      { animation: { name: "walk" } },
      { ...native, animation: { name: "walk", uuid: "" } },
      { ...native, requested_name: "" },
      { ...native, requested_bone_count: -1 },
      { ...native, requested_sound_effect_count: NaN },
    ]) {
      expect(isAnimationCreationReceipt(value)).toBe(false);
    }
  });

  test("optional source-only timing evidence cannot impersonate playback acceptance", () => {
    const timing = {
      state: "REVIEW_SOURCE_TIMES_AFTER_DECLARED_DURATION",
      declared_duration_seconds: 1,
      latest_transform_time_seconds: 1.25,
      latest_effect_time_seconds: 0,
      authored_transform_frame_count: 2,
      after_duration_transform_frame_count: 1,
      after_duration_effect_timestamp_count: 0,
      source_only: true,
      native_timeline_sampling_performed: false,
      visual_verdict: "not_evaluated",
    };
    expect(isAnimationCreationReceipt({ ...native, source_timing: timing })).toBe(true);
    for (const unsafe of [
      { ...timing, native_timeline_sampling_performed: true },
      { ...timing, visual_verdict: "PASS" },
      { ...timing, source_only: false },
      { ...timing, state: "WITHIN_DECLARED_DURATION" },
      { ...timing, declared_duration_seconds: null },
      { ...timing, after_duration_transform_frame_count: -1 },
    ]) {
      expect(isAnimationCreationReceipt({
        ...native, source_timing: unsafe,
      })).toBe(false);
    }
    // Historical receipts remain valid while runtime deployment catches up.
    expect(isAnimationCreationReceipt(native)).toBe(true);
  });

  test("validates native codec timecode evidence without claiming playback", () => {
    const nativeTiming = {
      state: "CODEC_TIMES_MATCHED",
      checked_track_count: 5,
      checked_keyframe_count: 8,
      tolerance_seconds: 0.0001,
      native_timing_readback_required: true,
      native_export_timecodes_required: true,
      native_playback_attested: false,
      visual_verdict: "not_evaluated",
    };
    expect(isAnimationCreationReceipt({ ...native, native_timing: nativeTiming })).toBe(true);
    expect(isAnimationCreationReceipt(native)).toBe(true);
    for (const changed of [
      { native_playback_attested: true },
      { native_timing_readback_required: false },
      { state: "VISUAL_PASS" },
      { visual_verdict: "PASS" },
      { tolerance_seconds: 1 },
      { checked_keyframe_count: -1 },
    ]) {
      expect(isAnimationCreationReceipt({
        ...native, native_timing: { ...nativeTiming, ...changed },
      })).toBe(false);
    }
  });

  test("producer gets an AnimationCodec instance before building final state", async () => {
    const source = await Bun.file("server/tools/animation/create.ts").text();
    expect(source).toContain("createdAnimation.uuid");
    expect(source).toContain("requested_bone_count");
    expect(source).toContain("structuredContent: result");
  });
});

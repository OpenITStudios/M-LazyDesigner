import { z } from "zod";

/**
 * Source-shaped result from create_animation's Bedrock AnimationCodec.
 * Authored name/UUID and requested counts establish a reported new native
 * clip, but never prove motion fidelity, playback, or persisted export.
 */
export const animationCreationReceiptSchema = z.object({
  animation: z.object({
    uuid: z.string().min(1),
    name: z.string().min(1),
  }),
  requested_name: z.string().min(1),
  requested_bone_count: z.number().int().nonnegative(),
  requested_particle_effect_count: z.number().int().nonnegative(),
  requested_sound_effect_count: z.number().int().nonnegative(),
  // Optional for compatibility with already-installed pre-hardening plugins.
  // Only successful native import + exact native timecode readback produces it.
  native_timing: z.object({
    state: z.literal("CODEC_TIMES_MATCHED"),
    checked_track_count: z.number().int().nonnegative(),
    checked_keyframe_count: z.number().int().nonnegative(),
    tolerance_seconds: z.literal(0.0001),
    native_timing_readback_required: z.literal(true),
    native_export_timecodes_required: z.literal(true),
    native_playback_attested: z.literal(false),
    visual_verdict: z.literal("not_evaluated"),
    // Older native timing receipts have no snapping_resolution; preserve them.
    snapping_resolution: z.object({
      state: z.enum(["KEEP_NATIVE", "ADJUST_NEW_CLIP"]),
      baseline_snapping_fps: z.number().int().min(10).max(500),
      applied_snapping_fps: z.number().int().min(10).max(500),
      effective_export_fps: z.number().int().min(10).max(120),
      source_key_count: z.number().int().nonnegative(),
      scope: z.literal("NEW_NATIVE_CLIP_ONLY"),
      native_playback_attested: z.literal(false),
      visual_verdict: z.literal("not_evaluated"),
    }).strict().superRefine((resolution, ctx) => {
      const changed = resolution.baseline_snapping_fps !== resolution.applied_snapping_fps;
      if ((resolution.state === "ADJUST_NEW_CLIP") !== changed ||
          resolution.effective_export_fps !==
            Math.min(resolution.applied_snapping_fps, 120) ||
          (changed && resolution.applied_snapping_fps > 120)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Native snapping receipt contradicts the applied new-clip export grid.",
        });
      }
    }).optional(),
  }).strict().superRefine((timing, ctx) => {
    if (timing.snapping_resolution &&
        timing.snapping_resolution.source_key_count !== timing.checked_keyframe_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Native snapping key count contradicts independently checked timecode keys.",
      });
    }
  }).optional(),
  // Backwards compatible: older native creation receipts omit this field.
  // Source timing is never evidence of played frames, physics, or visual PASS.
  source_timing: z.object({
    state: z.enum([
      "NO_EXPLICIT_DURATION",
      "REVIEW_SOURCE_TIMES_AFTER_DECLARED_DURATION",
      "WITHIN_DECLARED_DURATION",
    ]),
    declared_duration_seconds: z.number().finite().nonnegative().nullable(),
    latest_transform_time_seconds: z.number().finite().nonnegative(),
    latest_effect_time_seconds: z.number().finite().nonnegative(),
    authored_transform_frame_count: z.number().int().nonnegative(),
    after_duration_transform_frame_count: z.number().int().nonnegative(),
    after_duration_effect_timestamp_count: z.number().int().nonnegative(),
    source_only: z.literal(true),
    native_timeline_sampling_performed: z.literal(false),
    visual_verdict: z.literal("not_evaluated"),
  }).superRefine((evidence, ctx) => {
    const hasLength = evidence.declared_duration_seconds !== null;
    const afterLength = evidence.after_duration_transform_frame_count +
      evidence.after_duration_effect_timestamp_count;
    if ((evidence.state === "NO_EXPLICIT_DURATION") !== !hasLength ||
        (hasLength && (evidence.state === "REVIEW_SOURCE_TIMES_AFTER_DECLARED_DURATION") !==
          (afterLength > 0))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source timing status contradicts declared duration or authored frame counts.",
      });
    }
  }).optional(),
});

export function isAnimationCreationReceipt(value: unknown): boolean {
  return animationCreationReceiptSchema.safeParse(value).success;
}

/**
 * Animation evidence boundary, not a renderer or a second QA engine.
 * Authored data, still PNG poses and playback commands do not prove
 * continuously observed motion. No automatic temporal visual approval.
 */
export type AnimationEvidenceOrigin =
  | "NATIVE_CLIP_INSPECTION"
  | "NATIVE_CONTROLLER_INSPECTION"
  | "STATIC_POSE_PNG"
  | "PLAYBACK_COMMAND";

const ORIGIN_SCOPES = {
  NATIVE_CLIP_INSPECTION: {
    authored_data_available: true,
    static_pose_pixels_available: false,
    playback_command_executed: false,
  },
  NATIVE_CONTROLLER_INSPECTION: {
    authored_data_available: true,
    static_pose_pixels_available: false,
    playback_command_executed: false,
  },
  STATIC_POSE_PNG: {
    authored_data_available: false,
    static_pose_pixels_available: true,
    playback_command_executed: false,
  },
  PLAYBACK_COMMAND: {
    authored_data_available: false,
    static_pose_pixels_available: false,
    playback_command_executed: true,
  },
} as const;

/** A source-scoped receipt, never an inferred visual or temporal PASS. */
export function describeAnimationEvidenceBoundary(origin: AnimationEvidenceOrigin) {
  return {
    contract: "LAZYDESIGNER_ANIMATION_MEDIA_V1" as const,
    source: origin,
    ...ORIGIN_SCOPES[origin],
    static_pose_visual_pass_claim: false as const,
    authored_motion_technical_pass_claim: false as const,
    temporal_motion: {
      state: "UNVERIFIED" as const,
      reason: "CONTINUOUS_MOTION_REVIEW_NOT_ATTESTED" as const,
      continuous_motion_reviewed: false as const,
      motion_pass_authorized: false as const,
      still_images_can_satisfy_motion: false as const,
      playback_command_can_satisfy_motion: false as const,
    },
  };
}

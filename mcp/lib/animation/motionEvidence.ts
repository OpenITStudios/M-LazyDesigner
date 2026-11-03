/**
 * Animation evidence MEDIA contract — not a second QA engine or renderer.
 * Current sources provide authored data, static PNG poses and playback
 * commands. None proves temporal visual motion. The future MP4 recorder and
 * AI bridge must bind evidence to this boundary through their own verified
 * runtime receipts before any acceptance can become possible.
 */
export const MOTION_VIDEO_MIME = "video/mp4" as const;
export const MOTION_VIDEO_CODEC = "h264" as const;

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

/**
 * This is an explicit LIMITATION receipt, not a review verdict. Pose pixels
 * may support pose-fidelity questions after paired inspection; they never
 * become temporal-motion evidence by adding more timestamps.
 */
export function describeAnimationEvidenceBoundary(origin: AnimationEvidenceOrigin) {
  return {
    contract: "LAZYDESIGNER_ANIMATION_MEDIA_V1" as const,
    source: origin,
    ...ORIGIN_SCOPES[origin],
    static_pose_visual_pass_claim: false as const,
    authored_motion_technical_pass_claim: false as const,
    temporal_motion: {
      state: "UNVERIFIED" as const,
      reason: "MP4_RECORDING_AND_AI_CONSUMPTION_NOT_ATTESTED" as const,
      required_visual_media: MOTION_VIDEO_MIME,
      codec_policy: MOTION_VIDEO_CODEC,
      mp4_recorder_registered: false as const,
      mp4_bytes_verified: false as const,
      ai_video_consumption_attested: false as const,
      continuous_motion_reviewed: false as const,
      motion_pass_authorized: false as const,
      still_images_can_satisfy_motion: false as const,
      playback_command_can_satisfy_motion: false as const,
      no_user_preview_required: true as const,
      gif_artifact_required: false as const,
    },
  };
}

export type DeclaredMp4Evidence = Readonly<{
  mime_type: "video/mp4";
  video_codec: "h264";
  project_uuid: string;
  animation_uuid: string;
  revision_sha256: string;
  mp4_sha256: string;
  byte_length: number;
  frame_count: number;
  duration_ms: number;
  camera_sha256: string;
}>;

const DIGEST = /^[a-f0-9]{64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validIdentity = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 &&
  value.trim() === value && value.length <= 160;

/**
 * Checks an UNTRUSTED descriptor's self-consistency and claimed owner.
 * It DOES NOT read an MP4, certify its bytes or claim the model watched it.
 * A matching manifest is only a preparation input for the future trust bridge.
 */
export function assessDeclaredMp4Evidence(
  evidence: unknown,
  expected: Readonly<{
    project_uuid: string;
    animation_uuid: string;
    revision_sha256: string;
  }>
) {
  const blocked = (reason: string) => ({
    manifest: "REJECTED" as const,
    reason,
    media: MOTION_VIDEO_MIME,
    media_bytes_attested: false as const,
    ai_consumption_attested: false as const,
    temporal_motion_verdict: "UNVERIFIED" as const,
    visual_pass_authorized: false as const,
  });
  if (!isRecord(evidence) ||
      !validIdentity(expected.project_uuid) ||
      !validIdentity(expected.animation_uuid) ||
      !DIGEST.test(expected.revision_sha256)) {
    return blocked("MP4_EVIDENCE_INPUT_INVALID");
  }
  const exactKeys = [
    "mime_type", "video_codec", "project_uuid", "animation_uuid",
    "revision_sha256", "mp4_sha256", "byte_length",
    "frame_count", "duration_ms", "camera_sha256",
  ];
  if(Object.keys(evidence).length!==exactKeys.length ||
     exactKeys.some(key=>!Object.hasOwn(evidence,key))) {
    return blocked("MP4_EVIDENCE_MANIFEST_SHAPE_INVALID");
  }
  if (evidence.mime_type !== MOTION_VIDEO_MIME ||
      evidence.video_codec !== MOTION_VIDEO_CODEC ||
      !validIdentity(evidence.project_uuid) ||
      !validIdentity(evidence.animation_uuid) ||
      !DIGEST.test(String(evidence.revision_sha256)) ||
      !DIGEST.test(String(evidence.mp4_sha256)) ||
      !DIGEST.test(String(evidence.camera_sha256)) ||
      !["byte_length","frame_count","duration_ms"].every(key =>
        typeof evidence[key] === "number" &&
        Number.isSafeInteger(evidence[key]) && (evidence[key] as number) > 0)) {
    return blocked("MP4_EVIDENCE_MANIFEST_VALUES_INVALID");
  }
  if (evidence.project_uuid !== expected.project_uuid ||
      evidence.animation_uuid !== expected.animation_uuid ||
      evidence.revision_sha256 !== expected.revision_sha256) {
    return blocked("MP4_EVIDENCE_OWNER_OR_REVISION_MISMATCH");
  }
  return {
    ...blocked("MP4_BYTES_AND_AI_CONSUMPTION_UNVERIFIED"),
    manifest: "CONSISTENT_DECLARATION_ONLY" as const,
  };
}

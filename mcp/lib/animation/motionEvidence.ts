/**
 * Animation evidence MEDIA contract — not a second QA engine or renderer.
 * Current sources provide authored data, static PNG poses and playback
 * commands. None proves temporal visual motion. The future MP4 recorder and
 * AI bridge must bind evidence to this boundary through their own verified
 * runtime receipts before any acceptance can become possible.
 */
import { createHash } from "node:crypto";

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

/**
 * Binary MP4 resource transport (only). Neither a container marker nor
 * matching SHA-256 verifies H.264 decoding or AI temporal perception.
 */
export const MOTION_MP4_RESOURCE_MAX_BYTES = 12 * 1024 * 1024;
export const MOTION_MP4_RESOURCE_TTL_MS = 120_000;
export const MOTION_MP4_RESOURCE_URI_TEMPLATE =
  "motion-evidence://{id}/{revision}/{sha256}" as const;

export function parseMotionMp4ResourceUri(uri: unknown) {
  if (typeof uri !== "string") throw new Error("MOTION_MP4_RESOURCE_URI_INVALID");
  const match = /^motion-evidence:\/\/([a-f0-9]{32})\/([a-f0-9]{64})\/([a-f0-9]{64})$/.exec(uri);
  if (!match) throw new Error("MOTION_MP4_RESOURCE_URI_INVALID");
  return { id: match[1], revision_sha256: match[2], mp4_sha256: match[3] };
}

/** Recognizes complete bounded top-level ISO BMFF boxes, NOT video codec. */
export function checkMotionMp4Envelope(data: Uint8Array) {
  if (!(data instanceof Uint8Array) || data.byteLength < 24 ||
      data.byteLength > MOTION_MP4_RESOURCE_MAX_BYTES) {
    throw new Error("MOTION_MP4_BINARY_SIZE_INVALID");
  }
  const buf=Buffer.from(data.buffer,data.byteOffset,data.byteLength);
  const boxes=new Set<string>();
  let offset=0,first=true;
  while (offset<buf.length) {
    if (offset+8>buf.length) throw new Error("MOTION_MP4_BOX_TRUNCATED");
    const type=buf.toString("ascii",offset+4,offset+8);
    let length=buf.readUInt32BE(offset),header=8;
    if(length===1) {
      if(offset+16>buf.length)throw new Error("MOTION_MP4_BOX_TRUNCATED");
      const size=buf.readBigUInt64BE(offset+8);
      if(size>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("MOTION_MP4_BOX_TOO_LARGE");
      length=Number(size);header=16;
    } else if(length===0) length=buf.length-offset;
    if(first && type!=="ftyp")throw new Error("MOTION_MP4_FTYP_REQUIRED");
    if(length<header || length>buf.length-offset)throw new Error("MOTION_MP4_BOX_LENGTH_INVALID");
    if(type==="ftyp" && length<header+8)throw new Error("MOTION_MP4_FTYP_INVALID");
    boxes.add(type);offset+=length;first=false;
  }
  if(!boxes.has("ftyp")||!boxes.has("moov")||!boxes.has("mdat"))
    throw new Error("MOTION_MP4_REQUIRED_BOXES_MISSING");
  return {
    top_level_boxes_recognized:true as const,
    video_codec_decoded:false as const,
    temporal_visual_reviewed:false as const,
  };
}

/** Independently validates MCP video resource delivery and resource hash. */
export function validateMotionMp4ResourceRead(uri:string, response:unknown) {
  const identity=parseMotionMp4ResourceUri(uri);
  if(!isRecord(response)||!Array.isArray(response.contents)||
     response.contents.length!==1 || !isRecord(response.contents[0]))
    throw new Error("MOTION_MP4_RESOURCE_RESPONSE_INVALID");
  const item=response.contents[0];
  if(item.uri!==uri || item.mimeType!==MOTION_VIDEO_MIME ||
     typeof item.blob!=="string" ||
     item.blob.length>Math.ceil(MOTION_MP4_RESOURCE_MAX_BYTES/3)*4+4 ||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(item.blob))
    throw new Error("MOTION_MP4_RESOURCE_CONTENT_INVALID");
  const data=Buffer.from(item.blob,"base64");
  if(data.toString("base64")!==item.blob)
    throw new Error("MOTION_MP4_BASE64_NONCANONICAL");
  checkMotionMp4Envelope(data);
  const sha=createHash("sha256").update(data).digest("hex");
  if(sha!==identity.mp4_sha256)throw new Error("MOTION_MP4_RESOURCE_HASH_MISMATCH");
  return {
    uri,mimeType:MOTION_VIDEO_MIME,blob:item.blob,
    sha256:sha,byte_length:data.byteLength,
    ai_video_consumption_attested:false as const,
    motion_pass_authorized:false as const,
  };
}

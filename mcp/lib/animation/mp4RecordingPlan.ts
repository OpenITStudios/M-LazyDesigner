/**
 * Bounded, AI-only MP4 recording request. Frame-rate is the requested video
 * transport cadence, NOT proof of exact native Timeline evaluation or recorded
 * frame count. The caller must choose an actual motion-relevant segment.
 */
export const MOTION_RECORDING_MAX_DURATION_MS=12_000;
export const MOTION_RECORDING_MAX_FRAME_REQUESTS=720;

export type MotionMp4RecordingRequest = Readonly<{
  project_uuid:string;
  animation_uuid:string;
  revision_sha256:string;
  camera_sha256:string;
  width:number;
  height:number;
  capture_fps:number;
  duration_ms:number;
  video_bitrate_bps:number;
}>;

export type PlannedMotionMp4Recording = MotionMp4RecordingRequest & Readonly<{
  expected_capture_opportunities:number;
  actual_recorded_frames_attested:false;
  native_playback_attested:false;
  output:"video/mp4";
  no_gif:true;
  no_user_preview:true;
}>;

const VALID_DIGEST=/^[a-f0-9]{64}$/;
const validId=(s:unknown):s is string=>
  typeof s==="string" && s.trim()===s &&
  s.length>0 && s.length<=160;

export function planMotionMp4Recording(
  input:MotionMp4RecordingRequest
):PlannedMotionMp4Recording {
  if(!input || !validId(input.project_uuid) ||
     !validId(input.animation_uuid) ||
     !VALID_DIGEST.test(input.revision_sha256) ||
     !VALID_DIGEST.test(input.camera_sha256)) {
    throw new Error("MOTION_MP4_RECORDING_IDENTITY_INVALID");
  }
  const evenSize=(n:number)=>Number.isSafeInteger(n) && n>=128 &&
    n<=1024 && n%2===0;
  if(!evenSize(input.width)||!evenSize(input.height)||
     !Number.isSafeInteger(input.capture_fps)||
     input.capture_fps<12||input.capture_fps>60||
     !Number.isSafeInteger(input.duration_ms)||
     input.duration_ms<200||
     input.duration_ms>MOTION_RECORDING_MAX_DURATION_MS ||
     !Number.isSafeInteger(input.video_bitrate_bps)||
     input.video_bitrate_bps<300_000||
     input.video_bitrate_bps>8_000_000) {
    throw new Error("MOTION_MP4_RECORDING_LIMIT_INVALID");
  }
  const expected=Math.ceil(input.duration_ms*input.capture_fps/1000);
  if(expected>MOTION_RECORDING_MAX_FRAME_REQUESTS)
    throw new Error("MOTION_MP4_CAPTURE_BUDGET_EXCEEDED");
  return {
    ...input,
    expected_capture_opportunities:expected,
    actual_recorded_frames_attested:false,
    native_playback_attested:false,
    output:"video/mp4",no_gif:true,no_user_preview:true,
  };
}

/**
 * MediaRecorder is real-time and device-dependent. Only explicit H.264 MP4
 * MIME strings are allowed. No WebM/GIF, video/mp4 without a codec claim,
 * magic FFmpeg fallback, or fake WebCodecs muxer.
 */
export const MOTION_MP4_H264_MIMES=[
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1.4D001F",
] as const;

export function selectSupportedMotionMp4Mime(
  supports:(mime:string)=>boolean
):string|null {
  for(const mime of MOTION_MP4_H264_MIMES) {
    try {if(supports(mime))return mime;} catch { /* unavailable */ }
  }
  return null;
}

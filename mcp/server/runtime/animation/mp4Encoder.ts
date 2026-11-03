/// <reference types="blockbench-types" />

import {
  planMotionMp4Recording,
  selectSupportedMotionMp4Mime,
  type MotionMp4RecordingRequest,
} from "@/lib/animation/mp4RecordingPlan";
import {
  checkMotionMp4Envelope,
  MOTION_MP4_RESOURCE_MAX_BYTES,
} from "@/lib/animation/motionEvidence";

/**
 * This transport encoder does not evaluate Animation, call Timeline, setTime,
 * mutate Blockbench state or publish an MCP resource. A future native-isolated
 * evaluator owns the actual continuous playback and full restoration proof.
 * MediaRecorder captures REAL-TIME canvas updates: FPS and segment duration
 * are requested limits, not exact authored-time sample certificates.
 */
export type OffscreenNativeMotionWindow = Readonly<{
  canvas: HTMLCanvasElement;
  playAndRenderWindow: (signal: AbortSignal) => Promise<void>;
}>;

export type EncodedMotionMp4Window = Readonly<{
  bytes: Uint8Array;
  mime_type: "video/mp4";
  encoder: "NATIVE_MEDIARECORDER_H264";
  chosen_mime: string;
  recording_elapsed_ms: number;
  first_video_frame_decode_probe: "LOADED_DATA_ONLY";
  capture_fps_requested: number;
  capture_opportunities_planned: number;
  encoded_frame_count_attested: false;
  authored_timeline_timestamps_attested: false;
  native_preview_restoration_attested: false;
  ai_video_consumption_attested: false;
  motion_quality_verdict: "UNVERIFIED";
  visual_pass_authorized: false;
}>;

export function inspectMotionMp4EncoderAvailability() {
  const ctor = typeof MediaRecorder === "function" ? MediaRecorder : null;
  if (!ctor || typeof ctor.isTypeSupported !== "function") {
    return {
      state: "ENCODER_UNAVAILABLE" as const,
      reason: "MEDIARECORDER_MISSING" as const,
      selected_mime: null,
    };
  }
  const selected = selectSupportedMotionMp4Mime(
    mime => ctor.isTypeSupported(mime)
  );
  return selected
    ? {
        state: "SUPPORTED_BY_MIME_QUERY_ONLY" as const,
        reason: null,
        selected_mime: selected,
      }
    : {
        state: "ENCODER_UNAVAILABLE" as const,
        reason: "EXPLICIT_H264_MP4_NOT_SUPPORTED" as const,
        selected_mime: null,
      };
}

function requireCanonicalOffscreenCanvas(canvas: HTMLCanvasElement): void {
  // Desktop user-facing editor preview must never be used as an internal
  // video recording surface. This is not a complete native-state seal.
  if (typeof Screencam === "undefined" ||
      !Screencam.NoAAPreview ||
      canvas !== Screencam.NoAAPreview.canvas ||
      (typeof Preview !== "undefined" && canvas === Preview.selected?.canvas)) {
    throw new Error("MOTION_MP4_CANONICAL_OFFSCREEN_CANVAS_REQUIRED");
  }
  if (!canvas || canvas.width === 0 || canvas.height === 0 ||
      typeof canvas.captureStream !== "function") {
    throw new Error("MOTION_MP4_CANVAS_CAPTURE_UNAVAILABLE");
  }
}


/**
 * Decode-probe one frame using a DETACHED media element. Not a preview
 * visible to the user, full-frame quality proof, H.264 bitstream audit,
 * exact FPS measurement, or authorization to publish the clip.
 */
async function requireFirstDecodedMp4Frame(
  bytes:Uint8Array,
  expectedWidth:number,
  expectedHeight:number
):Promise<void> {
  if(typeof document==="undefined" || typeof URL==="undefined" ||
     typeof URL.createObjectURL!=="function"){
    throw new Error("MOTION_MP4_VIDEO_DECODER_UNAVAILABLE");
  }
  const video=document.createElement("video");
  video.preload="auto";
  video.muted=true;
  video.playsInline=true;
  const copied=new Uint8Array(bytes);
  const blob=new Blob([copied.buffer as ArrayBuffer],{type:"video/mp4"});
  const url=URL.createObjectURL(blob);
  let clock:ReturnType<typeof setTimeout>|null=null;
  try{
    const decoded=new Promise<void>((resolve,reject)=>{
      video.onloadeddata=()=>resolve();
      video.onerror=()=>reject(new Error("MOTION_MP4_FIRST_FRAME_NOT_DECODABLE"));
    });
    video.src=url;
    video.load();
    await Promise.race([
      decoded,
      new Promise<never>((_resolve,reject)=>{
        clock=setTimeout(()=>reject(
          new Error("MOTION_MP4_FIRST_FRAME_DECODE_TIMEOUT")
        ),4000);
      }),
    ]);
    if(video.readyState<2 || video.videoWidth!==expectedWidth ||
       video.videoHeight!==expectedHeight){
      throw new Error("MOTION_MP4_FIRST_FRAME_DIMENSIONS_INVALID");
    }
  }finally{
    if(clock!==null)clearTimeout(clock);
    video.onloadeddata=null;
    video.onerror=null;
    video.removeAttribute("src");
    try{video.load();}catch{/* best-effort detach */}
    URL.revokeObjectURL(url);
  }
}

/**
 * Encode a bounded real-time native *offscreen* motion window as MP4/H.264.
 * No WebM/GIF fallback. The callback is intentionally not implemented here:
 * only a future verified native preview evaluator can supply it safely.
 * The returned bytes are NOT published until owner/revision/full-state
 * restoration and frame integrity have been independently verified.
 */
export async function encodeNativeOffscreenMotionMp4(
  request: MotionMp4RecordingRequest,
  source: OffscreenNativeMotionWindow
): Promise<EncodedMotionMp4Window> {
  const plan = planMotionMp4Recording(request);
  const capability = inspectMotionMp4EncoderAvailability();
  if (capability.state !== "SUPPORTED_BY_MIME_QUERY_ONLY" ||
      !capability.selected_mime) {
    throw new Error("MOTION_MP4_H264_ENCODER_UNAVAILABLE");
  }
  requireCanonicalOffscreenCanvas(source?.canvas);
  if (source.canvas.width !== plan.width ||
      source.canvas.height !== plan.height ||
      typeof source.playAndRenderWindow !== "function") {
    throw new Error("MOTION_MP4_OFFSCREEN_SOURCE_INVALID");
  }

  // captureStream receives actual rendered frames, without generating PNG
  // images, retaining raw screencaps, or showing a human-facing preview.
  const stream = source.canvas.captureStream(plan.capture_fps);
  const videoTracks=stream.getVideoTracks();
  const allTracks=stream.getTracks();
  if (videoTracks.length !== 1 || allTracks.length !== 1) {
    allTracks.forEach(track=>track.stop());
    throw new Error("MOTION_MP4_VIDEO_ONLY_TRACK_REQUIRED");
  }

  const timeoutMs = Math.max(4_000, plan.duration_ms * 2 + 4_000);
  const aborter = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let recorder: MediaRecorder | null = null;
  let error:Error|null=null;
  let encodedBytes=0;
  const chunks:Blob[]=[];
  let startedAt=0;
  try {
    const ctor=MediaRecorder;
    recorder=new ctor(stream,{
      mimeType:capability.selected_mime,
      videoBitsPerSecond:plan.video_bitrate_bps,
    });
    const actualMime=recorder.mimeType.toLowerCase().replace(/\s+/g,"");
    if(!actualMime.startsWith("video/mp4;") ||
       !actualMime.includes("avc1.")) {
      throw new Error("MOTION_MP4_ENCODER_MIME_DRIFT");
    }
    let resolveStart!:()=>void;
    let rejectStart!:(reason:Error)=>void;
    const start=new Promise<void>((resolve,reject)=>{
      resolveStart=resolve;rejectStart=reject;
    });
    let resolveDone!:(value:Uint8Array)=>void;
    let rejectDone!:(reason:Error)=>void;
    const stopped=new Promise<Uint8Array>((resolve,reject)=>{
      resolveDone=resolve;rejectDone=reject;
    });
    // Suppress unobserved Promise rejection when startup fails before await.
    void start.catch(()=>{});
    void stopped.catch(()=>{});
    recorder.onstart=()=>resolveStart();
    recorder.onerror=()=>{
      error=new Error("MOTION_MP4_MEDIARECORDER_ENCODE_FAILURE");
      aborter.abort();
      rejectStart(error);
      rejectDone(error);
    };
    recorder.ondataavailable=event=>{
      if(error || !event.data || event.data.size===0)return;
      encodedBytes+=event.data.size;
      if(encodedBytes>MOTION_MP4_RESOURCE_MAX_BYTES){
        error=new Error("MOTION_MP4_ENCODED_SIZE_LIMIT_EXCEEDED");
        aborter.abort();
        rejectDone(error);
      }else{
        chunks.push(event.data);
      }
    };
    recorder.onstop=()=>{
      if(error){rejectDone(error);return;}
      if(!chunks.length){rejectDone(new Error("MOTION_MP4_NO_ENCODED_DATA"));return;}
      void new Blob(chunks,{type:"video/mp4"}).arrayBuffer()
        .then(buffer=>resolveDone(new Uint8Array(buffer)))
        .catch(()=>rejectDone(new Error("MOTION_MP4_BLOB_READ_FAILURE")));
    };
    const canceled=new Promise<never>((_resolve,reject)=>{
      aborter.signal.addEventListener("abort",()=>{
        reject(new Error("MOTION_MP4_WINDOW_TIMEOUT_OR_CANCELED"));
      },{once:true});
    });
    void canceled.catch(()=>{});
    timeout=setTimeout(()=>aborter.abort(),timeoutMs);
    startedAt=Date.now();
    recorder.start();
    await Promise.race([start,canceled]);

    // Native playback source must keep the canonical offscreen scene
    // rendering at its own actual Timeline time. This code never drives
    // keyframe samples or interferes with user selection.
    await Promise.race([source.playAndRenderWindow(aborter.signal),canceled]);
    if(aborter.signal.aborted)throw new Error("MOTION_MP4_WINDOW_ABORTED");
    const elapsed=Date.now()-startedAt;
    // MediaRecorder has real-time timestamps, not synthetic keyframe times.
    // Reject a callback that finishes instantly or exceeds the intended
    // window. This is a coarse liveness check, not frame-time attestation.
    if(elapsed<plan.duration_ms*0.85 || elapsed>plan.duration_ms*1.5+500){
      throw new Error("MOTION_MP4_NATIVE_WINDOW_DURATION_MISMATCH");
    }
    if(recorder.state!=="recording")
      throw new Error("MOTION_MP4_RECORDER_STOPPED_EARLY");
    recorder.stop();
    const bytes=await Promise.race([stopped,canceled]);
    checkMotionMp4Envelope(bytes);
    await requireFirstDecodedMp4Frame(bytes,plan.width,plan.height);
    return {
      bytes,
      mime_type:"video/mp4",
      encoder:"NATIVE_MEDIARECORDER_H264",
      chosen_mime:capability.selected_mime,
      recording_elapsed_ms:Date.now()-startedAt,
      first_video_frame_decode_probe:"LOADED_DATA_ONLY",
      capture_fps_requested:plan.capture_fps,
      capture_opportunities_planned:plan.expected_capture_opportunities,
      encoded_frame_count_attested:false,
      authored_timeline_timestamps_attested:false,
      native_preview_restoration_attested:false,
      ai_video_consumption_attested:false,
      motion_quality_verdict:"UNVERIFIED",
      visual_pass_authorized:false,
    };
  }finally{
    if(timeout!==null)clearTimeout(timeout);
    if(recorder && recorder.state!=="inactive"){
      try{recorder.stop();}catch{ /* original error is authoritative */ }
    }
    allTracks.forEach(track=>{try{track.stop();}catch{/* idempotent cleanup */}});
  }
}

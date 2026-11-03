import { describe,expect,test } from "bun:test";
import {
  planMotionMp4Recording,
  selectSupportedMotionMp4Mime,
  MOTION_MP4_H264_MIMES,
  MOTION_RECORDING_MAX_DURATION_MS,
} from "@/lib/animation/mp4RecordingPlan";
import { inspectMotionMp4EncoderAvailability } from "@/server/runtime/animation/mp4Encoder";

const input={
  project_uuid:"project-1",
  animation_uuid:"walk-1",
  revision_sha256:"a".repeat(64),
  camera_sha256:"b".repeat(64),
  width:512,
  height:512,
  capture_fps:30,
  duration_ms:2000,
  video_bitrate_bps:1_500_000,
};

describe("AI-only MP4 recording plan and encoder boundary",()=>{
  test("bounded MP4-only request never infers captured frames or native playback",()=>{
    expect(planMotionMp4Recording(input)).toMatchObject({
      expected_capture_opportunities:60,
      actual_recorded_frames_attested:false,
      native_playback_attested:false,
      output:"video/mp4",no_gif:true,no_user_preview:true,
    });
    expect(planMotionMp4Recording({...input,capture_fps:24,duration_ms:1000})
      .expected_capture_opportunities).toBe(24);
  });

  test("rejects unsafe dimensions, durations, hashes, frame and bitrate budgets",()=>{
    for(const candidate of [
      {...input,width:513},
      {...input,height:0},
      {...input,width:2048},
      {...input,duration_ms:MOTION_RECORDING_MAX_DURATION_MS+1},
      {...input,duration_ms:10},
      {...input,capture_fps:0},
      {...input,capture_fps:120},
      {...input,video_bitrate_bps:9_000_000},
      {...input,revision_sha256:"unverified"},
      {...input,camera_sha256:"bad"},
      {...input,animation_uuid:""},
    ]){
      expect(()=>planMotionMp4Recording(candidate)).toThrow();
    }
  });

  test("only explicit MP4/H264 MIME is selected; other codecs never become fallback",()=>{
    const supported=selectSupportedMotionMp4Mime(mime=>
      mime==="video/mp4;codecs=avc1.42E01E");
    expect(supported).toBe("video/mp4;codecs=avc1.42E01E");
    expect(selectSupportedMotionMp4Mime(()=>false)).toBeNull();
    expect(selectSupportedMotionMp4Mime(mime=>
      mime==="video/webm;codecs=vp9")).toBeNull();
    expect(MOTION_MP4_H264_MIMES.every(value=>value.startsWith("video/mp4;codecs=avc1."))).toBe(true);
  });

  test("codec probing does not imply recorder, playback or AI video review",async()=>{
    const probe=inspectMotionMp4EncoderAvailability();
    expect(["ENCODER_UNAVAILABLE","SUPPORTED_BY_MIME_QUERY_ONLY"])
      .toContain(probe.state);
    const source=await Bun.file("server/runtime/animation/mp4Encoder.ts").text();
    const runtime=await Bun.file("server/runtime/contracts/animation.ts").text();
    expect(source).toContain("MOTION_MP4_CANONICAL_OFFSCREEN_CANVAS_REQUIRED");
    expect(source).toContain("source.playAndRenderWindow(aborter.signal)");
    expect(source).toContain("MOTION_MP4_NATIVE_WINDOW_DURATION_MISMATCH");
    expect(source).toContain("requireFirstDecodedMp4Frame(");
    expect(source).toContain('document.createElement("video")');
    expect(source).toContain("URL.revokeObjectURL(url)");
    expect(source).toContain("MOTION_MP4_RESOURCE_MAX_BYTES");
    expect(source).toContain("recorder.stop();");
    expect(source).not.toContain("Timeline.setTime(");
    expect(source).not.toContain("Animator.preview(");
    expect(source).not.toContain("image/png");
    expect(source).not.toContain("image/gif");
    expect(source).toContain("ai_video_consumption_attested:false");
    expect(source).toContain("native_preview_restoration_attested:false");
    expect(runtime).toContain("motion_mp4_encoder_probe: inspectMotionMp4EncoderAvailability()");
  });
});

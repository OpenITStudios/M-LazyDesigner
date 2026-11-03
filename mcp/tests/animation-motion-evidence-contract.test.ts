import { describe,expect,test } from "bun:test";
import {
  MOTION_VIDEO_MIME,MOTION_VIDEO_CODEC,
  describeAnimationEvidenceBoundary,
  assessDeclaredMp4Evidence,
} from "@/lib/animation/motionEvidence";

const digest = (character: string) => character.repeat(64);
const owner = {
  project_uuid:"project-123",
  animation_uuid:"walk-123",
  revision_sha256:digest("a"),
};
const declared = {
  mime_type:"video/mp4" as const,
  video_codec:"h264" as const,
  ...owner,
  mp4_sha256:digest("b"),
  byte_length:4096,
  frame_count:60,
  duration_ms:2000,
  camera_sha256:digest("c"),
};

describe("Animation motion medium is explicit and fail-closed",()=>{
  test("authored keys, static poses and successful playback cannot certify continuous motion",()=>{
    const routes=[
      "NATIVE_CLIP_INSPECTION",
      "NATIVE_CONTROLLER_INSPECTION",
      "STATIC_POSE_PNG",
      "PLAYBACK_COMMAND",
    ] as const;
    for(const source of routes){
      const boundary=describeAnimationEvidenceBoundary(source);
      expect(boundary).toMatchObject({
        contract:"LAZYDESIGNER_ANIMATION_MEDIA_V1",source,
        static_pose_visual_pass_claim:false,
        authored_motion_technical_pass_claim:false,
        temporal_motion:{
          state:"UNVERIFIED",
          required_visual_media:"video/mp4",
          codec_policy:"h264",
          mp4_recorder_registered:false,
          mp4_bytes_verified:false,
          ai_video_consumption_attested:false,
          continuous_motion_reviewed:false,
          motion_pass_authorized:false,
          still_images_can_satisfy_motion:false,
          playback_command_can_satisfy_motion:false,
          no_user_preview_required:true,
          gif_artifact_required:false,
        },
      });
    }
    expect(describeAnimationEvidenceBoundary("STATIC_POSE_PNG").static_pose_pixels_available).toBe(true);
    expect(describeAnimationEvidenceBoundary("PLAYBACK_COMMAND").playback_command_executed).toBe(true);
    expect(describeAnimationEvidenceBoundary("NATIVE_CLIP_INSPECTION").authored_data_available).toBe(true);
    expect(describeAnimationEvidenceBoundary("NATIVE_CONTROLLER_INSPECTION").authored_data_available).toBe(true);
    expect(MOTION_VIDEO_MIME).toBe("video/mp4");
    expect(MOTION_VIDEO_CODEC).toBe("h264");
  });

  test("matching untrusted MP4 manifest does not assert file bytes or AI consumption",()=>{
    expect(assessDeclaredMp4Evidence(declared,owner)).toMatchObject({
      manifest:"CONSISTENT_DECLARATION_ONLY",
      reason:"MP4_BYTES_AND_AI_CONSUMPTION_UNVERIFIED",
      media_bytes_attested:false,ai_consumption_attested:false,
      temporal_motion_verdict:"UNVERIFIED",visual_pass_authorized:false,
    });
  });

  test("rejects stale, foreign, unsupported or fabricated media metadata",()=>{
    for(const candidate of [
      { ...declared,project_uuid:"different-project" },
      { ...declared,animation_uuid:"other-animation" },
      { ...declared,revision_sha256:digest("d") },
      { ...declared,mp4_sha256:"not-sha256" },
      { ...declared,mime_type:"image/gif" },
      { ...declared,video_codec:"vp9" },
      { ...declared,byte_length:-1 },
      { ...declared,frame_count:0 },
      { ...declared,duration_ms:0 },
      { ...declared,uri:"file:///tmp/forged.mp4" },
    ]){
      const result=assessDeclaredMp4Evidence(candidate,owner);
      expect(result.manifest).toBe("REJECTED");
      expect(result.temporal_motion_verdict).toBe("UNVERIFIED");
      expect(result.visual_pass_authorized).toBe(false);
    }
    expect(assessDeclaredMp4Evidence(declared,{
      ...owner,revision_sha256:"invalid",
    }).manifest).toBe("REJECTED");
  });

  test("active Runtime and Control emit the same non-approving motion contract",async()=>{
    const runtime=await Bun.file("server/runtime/contracts/animation.ts").text();
    const control=await Bun.file("gateway/control/orchestration.ts").text();
    expect(runtime).toContain('"NATIVE_CLIP_INSPECTION"');
    expect(runtime).toContain('"NATIVE_CONTROLLER_INSPECTION"');
    expect(runtime).toContain('describeAnimationEvidenceBoundary("STATIC_POSE_PNG")');
    expect(runtime).toContain('describeAnimationEvidenceBoundary("PLAYBACK_COMMAND")');
    expect(control).toContain("Temporal motion stays UNVERIFIED");
    expect(control).toContain("MP4");
    expect(runtime).toContain("return captureAnimationSamples(originalCaptureDefinition, request, context)");
  });
});

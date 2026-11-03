import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  checkMotionMp4Envelope,
  parseMotionMp4ResourceUri,
  validateMotionMp4ResourceRead,
  MOTION_MP4_RESOURCE_MAX_BYTES,
} from "@/lib/animation/motionEvidence";
import { MotionMp4EvidenceSlot } from "@/server/resources/motionMp4";

function box(type:string, payload:Buffer) {
  const output=Buffer.alloc(8+payload.byteLength);
  output.writeUInt32BE(output.byteLength,0);
  output.write(type,4,"ascii");
  payload.copy(output,8);
  return output;
}
// ISO top-level-box test fixture; NOT a decodable H.264 sample.
const media=Buffer.concat([
  box("ftyp",Buffer.from("isom\0\0\0\0isom","binary")),
  box("moov",Buffer.from([0,1,2,3,4])),
  box("mdat",Buffer.from([1,2,3,4,5,6,7,8])),
]);
const hash=createHash("sha256").update(media).digest("hex");
const revision="a".repeat(64);
const manifest={
  mime_type:"video/mp4" as const,video_codec:"h264" as const,
  project_uuid:"test-project",animation_uuid:"test-walk",
  revision_sha256:revision,mp4_sha256:hash,
  byte_length:media.byteLength,frame_count:10,duration_ms:500,
  camera_sha256:"b".repeat(64),
};
function fixture(){
  let now=1000,project:string|null="test-project",rev:string|null=revision;
  let available=true;
  const slot=new MotionMp4EvidenceSlot({
    projectUuid:()=>project,
    animationExists:()=>available,
    readClock:()=>now,
    newId:()=>"c".repeat(32),
  });
  return {
    slot,revisionNow:()=>rev,
    advance:(time:number)=>{now+=time;},
    changeProject:(id:string|null)=>{project=id;},
    changeRevision:(id:string|null)=>{rev=id;},
    removeAnimation:()=>{available=false;},
  };
}

describe("AI-only MCP MP4 resource transport",()=>{
  test("recognizes complete bounded container boxes, never codec or motion",()=>{
    expect(checkMotionMp4Envelope(media)).toEqual({
      top_level_boxes_recognized:true,
      video_codec_decoded:false,
      temporal_visual_reviewed:false,
    });
    expect(()=>checkMotionMp4Envelope(Buffer.alloc(24))).toThrow();
    expect(()=>checkMotionMp4Envelope(Buffer.alloc(MOTION_MP4_RESOURCE_MAX_BYTES+1))).toThrow();
  });

  test("one ephemeral binary slot returns a hash-bound MCP blob",()=>{
    const state=fixture();
    const receipt=state.slot.publishFromNativeRecorder({
      data:media,manifest,nativeRevisionNow:state.revisionNow,
    });
    expect(receipt).toMatchObject({
      mime_type:"video/mp4",
      sha256:hash,
      binary_hash_verified:true,
      h264_decode_attested:false,
      ai_video_consumption_attested:false,
      temporal_motion_verdict:"UNVERIFIED",
      motion_pass_authorized:false,
    });
    expect(parseMotionMp4ResourceUri(receipt.uri)).toEqual({
      id:"c".repeat(32),revision_sha256:revision,mp4_sha256:hash,
    });
    const binary=state.slot.read(receipt.uri);
    const checked=validateMotionMp4ResourceRead(receipt.uri,binary);
    expect(checked).toMatchObject({
      mimeType:"video/mp4",sha256:hash,
      byte_length:media.byteLength,
      ai_video_consumption_attested:false,
      motion_pass_authorized:false,
    });
    expect(Buffer.from(checked.blob,"base64").equals(media)).toBe(true);
    expect(()=>state.slot.read("motion-evidence://"+"d".repeat(32)+"/"+revision+"/"+hash))
      .toThrow("MOTION_MP4_RESOURCE_IDENTITY_MISMATCH");
    state.changeRevision("f".repeat(64));
    expect(()=>state.slot.read(receipt.uri)).toThrow("MOTION_MP4_NATIVE_REVISION_CHANGED");
    state.changeRevision(revision);
    expect(()=>state.slot.read(receipt.uri)).toThrow("MOTION_MP4_NOT_RECORDED_OR_EXPIRED");
  });

  test("project changes and expired resources invalidate binary access",()=>{
    const state=fixture();
    const receipt=state.slot.publishFromNativeRecorder({
      data:media,manifest,nativeRevisionNow:state.revisionNow,
    });
    state.changeProject("other-project");
    expect(()=>state.slot.read(receipt.uri)).toThrow("MOTION_MP4_NATIVE_REVISION_CHANGED");
    state.changeProject("test-project");
    const fresh=state.slot.publishFromNativeRecorder({
      data:media,manifest,nativeRevisionNow:state.revisionNow,
    });
    state.advance(120001);
    expect(()=>state.slot.read(fresh.uri)).toThrow("MOTION_MP4_NOT_RECORDED_OR_EXPIRED");
  });

  test("rejects altered bytes, fake codecs and wrong MCP media types",()=>{
    const state=fixture();
    expect(()=>state.slot.publishFromNativeRecorder({
      data:media.subarray(0,media.length-1),
      manifest,nativeRevisionNow:state.revisionNow,
    })).toThrow();
    expect(()=>state.slot.publishFromNativeRecorder({
      data:media,manifest:{...manifest,video_codec:"vp9" as never},
      nativeRevisionNow:state.revisionNow,
    })).toThrow("MOTION_MP4_NATIVE_SOURCE_UNVERIFIED");
    const uri="motion-evidence://"+"c".repeat(32)+"/"+revision+"/"+hash;
    expect(()=>validateMotionMp4ResourceRead(uri,{
      contents:[{uri,blob:media.toString("base64"),mimeType:"image/gif"}],
    })).toThrow("MOTION_MP4_RESOURCE_CONTENT_INVALID");
    expect(()=>validateMotionMp4ResourceRead(uri,{
      contents:[{uri,blob:Buffer.from("not-video").toString("base64"),mimeType:"video/mp4"}],
    })).toThrow();
    expect(()=>parseMotionMp4ResourceUri("file:///private/unsafe.mp4")).toThrow();
  });

  test("registered through existing Animation family, without a new tool",async()=>{
    const registration=await Bun.file("server/runtime/registration.ts").text();
    const resource=await Bun.file("server/resources/motionMp4.ts").text();
    expect(registration).toContain("registerMotionMp4EvidenceResource();");
    expect(resource).toContain('createResource("motion_mp4_evidence",{');
    expect(resource).not.toContain("createTool(");
  });
});

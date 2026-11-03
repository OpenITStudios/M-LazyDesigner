/// <reference types="blockbench-types" />
import { createHash, randomBytes } from "node:crypto";
import { createResource } from "@/lib/factories";
import {
  assessDeclaredMp4Evidence, checkMotionMp4Envelope,
  validateMotionMp4ResourceRead,
  MOTION_MP4_RESOURCE_TTL_MS, MOTION_MP4_RESOURCE_URI_TEMPLATE,
  type DeclaredMp4Evidence,
} from "@/lib/animation/motionEvidence";

type NativeBridgeContext = {
  projectUuid: () => string | null;
  animationExists: (uuid: string) => boolean;
  readClock: () => number;
  newId: () => string;
};
type MotionMp4Artifact = {
  id: string;
  manifest: DeclaredMp4Evidence;
  data: Buffer;
  expiresAt: number;
  nativeRevisionNow: () => string | null;
};

/**
 * One ephemeral MP4 slot, internal to Runtime. This is a BYTE TRANSPORT,
 * not a native recorder, file cache, visual validator, or preview UI.
 * No user-input path, arbitrary disk file or URL may populate this slot.
 */
export class MotionMp4EvidenceSlot {
  private artifact: MotionMp4Artifact | null = null;
  constructor(private readonly context: NativeBridgeContext) {}

  /** Future trusted in-process encoder integration point. Not an MCP tool. */
  publishFromNativeRecorder(input: {
    data: Uint8Array;
    manifest: DeclaredMp4Evidence;
    nativeRevisionNow: () => string | null;
  }) {
    const {data,manifest,nativeRevisionNow}=input;
    if(!manifest || typeof nativeRevisionNow!=="function") {
      throw new Error("MOTION_MP4_NATIVE_RECORDER_CONTEXT_REQUIRED");
    }
    const declared=assessDeclaredMp4Evidence(manifest,{
      project_uuid:manifest.project_uuid,
      animation_uuid:manifest.animation_uuid,
      revision_sha256:manifest.revision_sha256,
    });
    if(declared.manifest!=="CONSISTENT_DECLARATION_ONLY" ||
       this.context.projectUuid()!==manifest.project_uuid ||
       !this.context.animationExists(manifest.animation_uuid) ||
       nativeRevisionNow()!==manifest.revision_sha256) {
      throw new Error("MOTION_MP4_NATIVE_SOURCE_UNVERIFIED");
    }
    checkMotionMp4Envelope(data);
    const copied=Buffer.from(data);
    const sha=createHash("sha256").update(copied).digest("hex");
    if(sha!==manifest.mp4_sha256 ||
       copied.byteLength!==manifest.byte_length) {
      throw new Error("MOTION_MP4_ENCODED_BYTES_MISMATCH");
    }
    const id=this.context.newId();
    if(!/^[a-f0-9]{32}$/.test(id))throw new Error("MOTION_MP4_INTERNAL_ID_INVALID");
    const expiresAt=this.context.readClock()+MOTION_MP4_RESOURCE_TTL_MS;
    if(!Number.isSafeInteger(expiresAt))throw new Error("MOTION_MP4_EXPIRES_INVALID");
    this.artifact={id,manifest,data:copied,expiresAt,nativeRevisionNow};
    const uri=`motion-evidence://${id}/${manifest.revision_sha256}/${sha}`;
    return {
      uri,mime_type:"video/mp4" as const,
      sha256:sha,byte_length:copied.byteLength,expires_at_ms:expiresAt,
      owner_revision:manifest.revision_sha256,
      binary_hash_verified:true as const,
      h264_decode_attested:false as const,
      ai_video_consumption_attested:false as const,
      temporal_motion_verdict:"UNVERIFIED" as const,
      motion_pass_authorized:false as const,
    };
  }

  read(uri: string) {
    const row=this.artifact;
    if(!row || this.context.readClock()>row.expiresAt) {
      this.artifact=null;
      throw new Error("MOTION_MP4_NOT_RECORDED_OR_EXPIRED");
    }
    const expected=`motion-evidence://${row.id}/${row.manifest.revision_sha256}/${row.manifest.mp4_sha256}`;
    if(uri!==expected)throw new Error("MOTION_MP4_RESOURCE_IDENTITY_MISMATCH");
    if(this.context.projectUuid()!==row.manifest.project_uuid ||
       !this.context.animationExists(row.manifest.animation_uuid) ||
       row.nativeRevisionNow()!==row.manifest.revision_sha256) {
      this.artifact=null;
      throw new Error("MOTION_MP4_NATIVE_REVISION_CHANGED");
    }
    if(createHash("sha256").update(row.data).digest("hex")!==
       row.manifest.mp4_sha256) {
      this.artifact=null;
      throw new Error("MOTION_MP4_STORED_BINARY_CHANGED");
    }
    const result={contents:[{
      uri,blob:row.data.toString("base64"),mimeType:"video/mp4" as const,
    }]};
    // Same media validation is applied after the Gateway reads it.
    validateMotionMp4ResourceRead(uri,result);
    return result;
  }
  clear() {this.artifact=null;}
}

/** Runtime-local, cleared on plugin generation reset; no persistent file. */
export const nativeMotionMp4EvidenceSlot=new MotionMp4EvidenceSlot({
  projectUuid:()=>typeof Project!=="undefined" ? Project?.uuid??null:null,
  animationExists:(id)=>typeof AnimationItem!=="undefined" &&
    (AnimationItem.all??[]).some(item=>item.uuid===id),
  readClock:()=>Date.now(),
  newId:()=>randomBytes(16).toString("hex"),
});

/** Registered through the existing Animation family; not listed in UI. */
export function registerMotionMp4EvidenceResource():void {
  createResource("motion_mp4_evidence",{
    uriTemplate:MOTION_MP4_RESOURCE_URI_TEMPLATE,
    description:"Internal AI-only MP4 binary evidence. No preview, GIF, or video approval. Only available after a trusted native recorder provides a revision-bound clip.",
    async readCallback(uri){
      return nativeMotionMp4EvidenceSlot.read(uri.href);
    },
  });
}

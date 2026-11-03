import { createHash, randomBytes } from "node:crypto";
import { imageContent } from "./imageContent";

/** Explicit one-shot pixel-ingestion test, NEVER a model image or QA PASS. */
export const VISUAL_PROBE_DOMAIN = "LAZYDESIGNER_MCP_IMAGE_PROBE_V1";
const COLORS = [
  { letter:"R", fill:"#e74a40" },
  { letter:"G", fill:"#289d54" },
  { letter:"B", fill:"#376bdd" },
  { letter:"Y", fill:"#f2cd3d" },
  { letter:"C", fill:"#18bace" },
  { letter:"M", fill:"#c058cb" },
] as const;
const hashed=(nonce:string,answer:string)=>createHash("sha256")
  .update([VISUAL_PROBE_DOMAIN,nonce,answer].join("\n")).digest("hex");

/** The 12-letter answer must never be included in any MCP response metadata. */
export function prepareVisualIngestionProbe(entropy:Uint8Array) {
  if(!(entropy instanceof Uint8Array)||entropy.byteLength<28)
    throw new Error("IMAGE_PROBE_ENTROPY_INVALID");
  const tiles=Array.from(entropy.subarray(0,12),v=>COLORS[v%COLORS.length]!);
  const nonce=Buffer.from(entropy.subarray(12,28)).toString("hex");
  const answer=tiles.map(t=>t.letter).join("");
  return {tiles,nonce,answer,expected_answer_sha256:hashed(nonce,answer)};
}

/** Use independently after the model has supplied its pixel-only answer. */
export function verifyVisualIngestionProbeResponse(
  nonce:string,expectedSha256:string,reported:string
):boolean {
  if(typeof nonce!=="string"||!/^[0-9a-f]{32}$/.test(nonce)||
     typeof expectedSha256!=="string"||!/^[0-9a-f]{64}$/.test(expectedSha256)||
     typeof reported!=="string")return false;
  const answer=reported.trim().toUpperCase().replace(/\s+/g,"");
  return /^[RGBYCM]{12}$/.test(answer)&&hashed(nonce,answer)===expectedSha256;
}

/** Detached raster, no model/camera/editor/timeline mutation. Opt-in only. */
export function createNativeVisualIngestionProbe(){
  if(typeof document==="undefined")throw new Error("IMAGE_PROBE_CANVAS_UNAVAILABLE");
  const challenge=prepareVisualIngestionProbe(randomBytes(28));
  const canvas=document.createElement("canvas");
  canvas.width=512;canvas.height=384;
  const ctx=canvas.getContext("2d",{alpha:false});
  if(!ctx)throw new Error("IMAGE_PROBE_2D_CONTEXT_UNAVAILABLE");
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,512,384);
  challenge.tiles.forEach((tile,i)=>{
    ctx.fillStyle=tile.fill;
    ctx.fillRect((i%4)*128+12,Math.floor(i/4)*128+12,104,104);
  });
  const image=imageContent(canvas.toDataURL("image/png")).content[0];
  const bytes=Buffer.from(image.data,"base64");
  return {image,receipt:{
    purpose:"AI_PIXEL_INGESTION_DIAGNOSTIC_ONLY" as const,
    role:"SYNTHETIC_NOT_MODEL_EVIDENCE" as const,
    grid:"4_columns_x_3_rows" as const,
    palette:"R red; G green; B blue; Y yellow; C cyan; M magenta",
    nonce:challenge.nonce,
    expected_answer_sha256:challenge.expected_answer_sha256,
    image_sha256:createHash("sha256").update(bytes).digest("hex"),
    png_bytes:bytes.byteLength,
    delivery:"MCP_CONTENT_IMAGE" as const,
    ai_pixel_perception_attested:false as const,
    visual_pass_authorized:false as const,
    note:"Ask AI for 12 color letters in reading order; independently verify. This receipt does not prove ingestion.",
  }};
}

import { createHash } from "node:crypto";

/**
 * Validate that the actual PNG image payload accompanying a native paint
 * transaction matches its claimed affected rectangle, revision and bytes.
 * Transport/provenance proof ONLY: it does not prove AI pixel consumption,
 * appearance, reference fidelity, UV mapping or Minecraft rendering.
 */
type Rec = Record<string, unknown>;
const asRecord = (value:unknown): Rec | null =>
  value!==null && typeof value==="object" && !Array.isArray(value)
    ? value as Rec : null;
const PNG_MAGIC = Buffer.from([137,80,78,71,13,10,26,10]);
const PNG_END = Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]);
export const INLINE_PAINT_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
type Assessment =
  | {state:"MATCHED"; image_sha256:string; png_bytes:number}
  | {state:"UNVERIFIED"; reason:string};

/** One image per actual paint response; neither side may be inferred from prose. */
export function assessInlinePaintImageEvidence(
  receipt: unknown,
  content: unknown
): Assessment {
  const no = (reason:string):Assessment => ({state:"UNVERIFIED",reason});
  const source=asRecord(receipt);
  const evidence=asRecord(source?.visual_evidence);
  const revision=asRecord(source?.revision);
  const rect=source?.affected_rect;
  if (!evidence || evidence.kind!=="affected_region_png" ||
      typeof revision?.after!=="string" || !revision.after ||
      evidence.revision!==revision.after ||
      !Array.isArray(rect) || rect.length!==4 ||
      !rect.every(n=>Number.isSafeInteger(n)) ||
      rect[0]<0 || rect[1]<0 || rect[2]<=rect[0] || rect[3]<=rect[1] ||
      !Array.isArray(evidence.affected_rect) ||
      evidence.affected_rect.length!==4 ||
      evidence.affected_rect.some((n,i)=>n!==rect[i]) ||
      evidence.width!==rect[2]-rect[0] ||
      evidence.height!==rect[3]-rect[1] ||
      typeof evidence.image_sha256!=="string" ||
      !/^[a-f0-9]{64}$/.test(evidence.image_sha256) ||
      typeof evidence.png_bytes!=="number" ||
      !Number.isSafeInteger(evidence.png_bytes) ||
      (evidence.png_bytes as number)<45 ||
      (evidence.png_bytes as number)>INLINE_PAINT_IMAGE_MAX_BYTES) {
    return no("INLINE_PAINT_RECEIPT_INCOMPLETE");
  }
  if(!Array.isArray(content))return no("INLINE_PAINT_IMAGE_NOT_DELIVERED");
  const images=content.filter(item=>asRecord(item)?.type==="image");
  if(images.length!==1)return no("INLINE_PAINT_IMAGE_COUNT_MISMATCH");
  const image=asRecord(images[0]);
  const base64=image?.data;
  if(image?.mimeType!=="image/png" || typeof base64!=="string" ||
      !base64.length || base64.length%4!==0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return no("INLINE_PAINT_IMAGE_ENCODING_INVALID");
  }
  const bytes=Buffer.from(base64,"base64");
  if(bytes.length!==evidence.png_bytes ||
     bytes.length<45 ||
     bytes.length>INLINE_PAINT_IMAGE_MAX_BYTES ||
     bytes.toString("base64")!==base64 ||
     !bytes.subarray(0,8).equals(PNG_MAGIC) ||
     bytes.readUInt32BE(8)!==13 ||
     bytes.toString("ascii",12,16)!=="IHDR" ||
     bytes.readUInt32BE(16)!==evidence.width ||
     bytes.readUInt32BE(20)!==evidence.height ||
     !bytes.subarray(-12).equals(PNG_END)) {
    return no("INLINE_PAINT_PNG_BYTES_INVALID");
  }
  const digest=createHash("sha256").update(bytes).digest("hex");
  if(digest!==evidence.image_sha256) {
    return no("INLINE_PAINT_PNG_DIGEST_MISMATCH");
  }
  return {state:"MATCHED",image_sha256:digest,png_bytes:bytes.length};
}

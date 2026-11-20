/** Bounded semantic-material proposal input. This has no pixel renderer,
 * image authorizer, reviewer or Rust mutation capability.
 * SOURCE_AUTHORED_NOT_RUN.
 */
import {PLAN_LIMIT,SHA256} from './sdk-inputs.mjs';

/** Transport validation only. Rust owns surface geometry, source pixels,
 * region synthesis, correction safety and the disposable preflight.
 * This request intentionally has no pixel rows, strokes or freehand UV.
 */
export function serializeSemanticMaterialIntent(intent) {
  const fields=['expected_revision','reference_png_sha256','cube_uuid',
    'texture_uuid','face','material','light_corner','contrast',
    'source_base_rgba','shadow_rgb','highlight_rgb',
    'protected_regions','expected_before_pixels'];
  const invalid=()=>{throw new TypeError('CODE_MODE_SEMANTIC_MATERIAL_INPUT_INVALID');};
  if (!intent || typeof intent!=='object' || Array.isArray(intent) ||
      Object.keys(intent).some(key=>!fields.includes(key)) ||
      intent.expected_revision!==0 ||
      typeof intent.reference_png_sha256!=='string' ||
      !SHA256.test(intent.reference_png_sha256) ||
      !['north','east','south','west','up','down'].includes(intent.face) ||
      intent.material!=='painted_metal' ||
      !['upper_left','upper_right'].includes(intent.light_corner) ||
      !['subtle','balanced'].includes(intent.contrast))invalid();
  for(const name of ['cube_uuid','texture_uuid']) {
    const id=intent[name];
    if(typeof id!=='string' || id.length<1 || id.length>128 ||
       /[\s\x00-\x1f\x7f]/.test(id))invalid();
  }
  const rgba=(v,n)=>Array.isArray(v)&&v.length===n &&
    v.every(x=>Number.isInteger(x)&&x>=0&&x<=255);
  if(!rgba(intent.source_base_rgba,4) || intent.source_base_rgba[3]!==255 ||
     !rgba(intent.shadow_rgb,3) || !rgba(intent.highlight_rgb,3))invalid();
  const rect=r=>r && typeof r==='object' && !Array.isArray(r) &&
    Object.keys(r).length===2 &&
    Object.keys(r).every(k=>['from','to'].includes(k)) &&
    [r.from,r.to].every(pt=>Array.isArray(pt) && pt.length===2 &&
      pt.every(v=>Number.isInteger(v)&&v>=0&&v<=256)) &&
    r.from.every((v,i)=>v<r.to[i]);
  const protectedRegions=intent.protected_regions??[];
  const expectedPixels=intent.expected_before_pixels??[];
  if(!Array.isArray(protectedRegions) || protectedRegions.length>16 ||
     !protectedRegions.every(rect) ||
     !Array.isArray(expectedPixels) || expectedPixels.length>64 ||
     !expectedPixels.every(v=>v && typeof v==='object' &&
       !Array.isArray(v) && Object.keys(v).length===2 &&
       Object.keys(v).every(k=>['at','rgba'].includes(k)) &&
       Array.isArray(v.at) && v.at.length===2 &&
       v.at.every(n=>Number.isInteger(n)&&n>=0&&n<256) &&
       rgba(v.rgba,4)))invalid();
  const payload=JSON.stringify(intent);
  if(Buffer.byteLength(payload,'utf8')>PLAN_LIMIT)invalid();
  return payload;
}

/** Bounded Texture correction contract, not an authorizer or bitmap engine.
 * Keeps source-color/alpha scope, reviewer diagnosis and matching Rust
 * receipt checks together. No filesystem or CLI launch access.
 * SOURCE_AUTHORED_NOT_RUN.
 */
import {PLAN_LIMIT,SHA256,nonempty,wholeNumber} from './sdk-inputs.mjs';

// Exact source-pixel bounds, not artistic reference or user approval.
export function normalizedCorrectionScope(scope) {
  if (scope === undefined) return undefined;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) ||
      Object.keys(scope).some(key =>
        !['textureUuid', 'allowedRegions', 'preserveAlpha',
          'protectedRegions','expectedBeforePixels','editableBeforeRgba'].includes(key))) {
    throw new TypeError('CORRECTION_SCOPE_INVALID');
  }
  const textureUuid = nonempty(scope.textureUuid, 'textureUuid');
  if (Buffer.byteLength(textureUuid, 'utf8') > 128 || /\s/.test(textureUuid) ||
      !Array.isArray(scope.allowedRegions) ||
      scope.allowedRegions.length < 1 || scope.allowedRegions.length > 16 ||
      (scope.preserveAlpha !== undefined && typeof scope.preserveAlpha !== 'boolean')) {
    throw new TypeError('CORRECTION_SCOPE_INVALID');
  }
  const point = (value,max) => {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    return value.map(n => Number(wholeNumber(n, 'coordinate', 0, max)));
  };
  const rectangle = rect => {
    if (!rect || typeof rect !== 'object' || Array.isArray(rect) ||
        Object.keys(rect).some(key => !['from','to'].includes(key))) {
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    const from = point(rect.from,256),to = point(rect.to,256);
    if(from[0]>=to[0]||from[1]>=to[1]){
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    return {from,to};
  };
  const rectangles=scope.allowedRegions.map(rectangle);
  let protectedRegions;
  if(scope.protectedRegions!==undefined){
    if(!Array.isArray(scope.protectedRegions) ||
       scope.protectedRegions.length>16){
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    protectedRegions=scope.protectedRegions.map(rectangle);
  }
  let expectedBeforePixels;
  if(scope.expectedBeforePixels!==undefined){
    if(!Array.isArray(scope.expectedBeforePixels) ||
       scope.expectedBeforePixels.length>64){
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    const seen=new Set();
    expectedBeforePixels=scope.expectedBeforePixels.map(entry=>{
      if(!entry || typeof entry!=='object' || Array.isArray(entry) ||
         Object.keys(entry).some(key=>!['at','rgba'].includes(key)) ||
         !Array.isArray(entry.rgba) || entry.rgba.length!==4){
        throw new TypeError('CORRECTION_SCOPE_INVALID');
      }
      const at=point(entry.at,255);
      if(!entry.rgba.every(n=>Number.isInteger(n)&&n>=0&&n<=255)){
        throw new TypeError('CORRECTION_SCOPE_INVALID');
      }
      const key=at.join(',');
      if(seen.has(key))throw new TypeError('CORRECTION_SCOPE_INVALID');
      seen.add(key);
      return {at,rgba:[...entry.rgba]};
    });
  }
  let editableBeforeRgba;
  if(scope.editableBeforeRgba!==undefined){
    if(!Array.isArray(scope.editableBeforeRgba) ||
       scope.editableBeforeRgba.length<1 ||
       scope.editableBeforeRgba.length>256*256 ||
       Buffer.byteLength(JSON.stringify(scope.editableBeforeRgba),'utf8')>PLAN_LIMIT){
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    const seen=new Set();
    editableBeforeRgba=scope.editableBeforeRgba.map(rgba=>{
      if(!Array.isArray(rgba)||rgba.length!==4 ||
         !rgba.every(v=>Number.isInteger(v)&&v>=0&&v<=255)){
        throw new TypeError('CORRECTION_SCOPE_INVALID');
      }
      const key=rgba.join(',');
      if(seen.has(key))throw new TypeError('CORRECTION_SCOPE_INVALID');
      seen.add(key);
      return [...rgba];
    });
  }
  return {texture_uuid:textureUuid, allowed_regions:rectangles,
    preserve_alpha:scope.preserveAlpha ?? false,
    ...(protectedRegions===undefined?{}:{protected_regions:protectedRegions}),
    ...(expectedBeforePixels===undefined?{}:{expected_before_pixels:expectedBeforePixels}),
    ...(editableBeforeRgba===undefined?{}:{editable_before_rgba:editableBeforeRgba})};
}
// Descriptive diagnosis only. No self-certifying visual quality claim.
const CORRECTION_MATERIALS = new Set([
  'metal','wood','stone','cloth','skin','glass','other',
]);
const CORRECTION_TREATMENTS = new Set([
  'form_value_masses','contact_shadows','hand_painted_clusters',
  'palette_roles','alpha_silhouette','artwork_footprint',
]);
export function normalizedMaterialCorrectionIntent(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => ![
        'issueId','approachId','partId','material','cause','treatment',
        'expectedChange',
      ].includes(key))) {
    throw new TypeError('MATERIAL_CORRECTION_INTENT_INVALID');
  }
  const token = input => typeof input === 'string' &&
    /^[a-z][a-z0-9_-]{0,63}$/.test(input);
  const statement = input => typeof input === 'string' &&
    input.length >= 16 && input.length <= 240 &&
    input.trim() === input && !/[\x00-\x1f\x7f]/.test(input);
  if (!token(value.issueId) || !token(value.approachId) ||
      !token(value.partId) ||
      !CORRECTION_MATERIALS.has(value.material) ||
      !CORRECTION_TREATMENTS.has(value.treatment) ||
      !statement(value.cause) || !statement(value.expectedChange)) {
    throw new TypeError('MATERIAL_CORRECTION_INTENT_INVALID');
  }
  return Object.freeze({
    issueId:value.issueId, approachId:value.approachId,
    partId:value.partId, material:value.material,
    cause:value.cause, treatment:value.treatment,
    expectedChange:value.expectedChange,
  });
}

// Require a native *matched* correction receipt before any scoped Paint
// call can be reported as successful to Code Mode. Rust may already have
// published its no-overwrite sibling when a malformed success is observed:
// do NOT auto-retry, remove that file or pretend its provenance is known.
export function checkedScopedApplyReceipt(receipt,scope,expectedSourceSha,operationCount) {
  if (!scope) return receipt;
  const verified=receipt?.correction_scope;
  const count=(field,values)=>verified?.[field] === (values?.length??0);
  if (receipt?.source_sha256!==expectedSourceSha.toLowerCase() ||
      receipt?.mutation?.operation_count!==operationCount ||
      !Number.isSafeInteger(receipt?.mutation?.revision) ||
      receipt.mutation.revision<1 ||
      receipt?.summary?.revision!==receipt.mutation.revision ||
      typeof receipt?.output_sha256!=='string' ||
      !SHA256.test(receipt.output_sha256) ||
      verified?.status!=='enforced' ||
      verified.texture_uuid!==scope.texture_uuid ||
      verified.visual_verdict!=='UNVERIFIED' ||
      !count('protected_regions',scope.protected_regions) ||
      !count('expected_before_pixels',scope.expected_before_pixels) ||
      !count('editable_before_rgba',scope.editable_before_rgba)) {
    throw new Error('CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED');
  }
  return receipt;
}

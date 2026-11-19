/**
 * Rust-first Code Mode SDK for a trusted local agent code runner.
 * Model-written JavaScript is executed by the host, NOT by this module.
 * Only first-party, bounded CLI operations cross into the Rust authoring core.
 * Source-authored; local/native execution NOT_EXECUTED.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {normalizedMaterialWorkPacket,materialWorkPacketDigest} from './material-work-packet.mjs';
import {validGeometryImpact} from './geometry-impact.mjs';
import {normalizedGeometryVoidZones,validGeometryVoidEvidence} from './geometry-void.mjs';

const execFileAsync = promisify(execFile);
const PLAN_LIMIT = 64 * 1024;
const OUTPUT_LIMIT = 128 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;
const WRITE_COMMANDS = new Set([
  'new', 'apply', 'import-png', 'export-png', 'export-geometry', 'export-animation',
]);

function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('--') || value.includes('\0')) {
    throw new TypeError(name + ' must be a nonempty string without option prefixes or NUL');
  }
  return value;
}
function absolute(value, name) {
  nonempty(value, name);
  if (!isAbsolute(value)) throw new TypeError(name + ' must be an absolute path');
  return value;
}
function wholeNumber(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(name + ' must be an integer from ' + min + ' to ' + max);
  }
  return String(value);
}
function hash(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError('expectedSha256 must be a 64-character hex digest');
  }
  return value;
}
function optionArgs(command, options) {
  const args = [command];
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    args.push('--' + key, nonempty(value, key));
  }
  return args;
}
function parseResponse(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > OUTPUT_LIMIT) {
    throw new Error('CODE_MODE_RESULT_INVALID_OR_OVERSIZE');
  }
  let response;
  try { response = JSON.parse(raw); } catch { throw new Error('CODE_MODE_RESULT_NOT_JSON'); }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('CODE_MODE_RESULT_NOT_OBJECT');
  }
  if (response.status !== 'OK') {
    throw new Error(typeof response.code === 'string' ? response.code : 'CODE_MODE_CLI_FAILURE');
  }
  return response;
}
async function runBinary(binary, args) {
  // Parse success outside the process-transport catch. Malformed or oversized
  // successful responses must not be misreported as an unavailable executable.
  let stdout;
  try {
    ({ stdout } = await execFileAsync(binary, args, {
      shell: false, timeout: 45000, maxBuffer: OUTPUT_LIMIT,
      windowsHide: true, encoding: 'utf8',
    }));
  } catch (error) {
    // A timeout, signal, or truncated stdout leaves the effect uncertain.
    // Never retry mutations automatically.
    if (error?.killed || error?.signal ||
        error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error('CODE_MODE_CLI_OUTCOME_UNKNOWN', { cause: error });
    }
    if (typeof error?.stdout === 'string' && error.stdout.trim()) {
      let result;
      try { result = JSON.parse(error.stdout); } catch {}
      if (result?.status === 'ERROR' && typeof result.code === 'string') {
        throw new Error(result.code, { cause: error });
      }
      throw new Error('CODE_MODE_CLI_OUTCOME_UNKNOWN', { cause: error });
    }
    throw new Error('CODE_MODE_CLI_UNAVAILABLE', { cause: error });
  }
  return parseResponse(stdout);
}
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

function serializePlan(operations, normalizedScope) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 128) {
    throw new TypeError('operations must contain 1 through 128 typed Rust operations');
  }
  // The SDK caller already normalized the scope once; serialize exactly
  // those admitted bytes. Rust independently validates the edit plan.
  const payload = JSON.stringify({ expected_revision: 0, operations,
    ...(normalizedScope ? {correction_scope:normalizedScope} : {}),
  }, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Nonfinite operation value');
    }
    return value;
  });
  if (!payload || Buffer.byteLength(payload, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('EDIT_PLAN_SIZE_INVALID');
  }
  return payload;
}

/** Geometry identity only, never a second JS voxel or frame compiler.
 * Keep Rust's versioned per-method UUID namespace and formatting. */
function generatedBlockoutCubeUuid(namespace, seed, index) {
  const digest=createHash('sha256')
    .update('lazydesigner:'+namespace+'\0'+seed+'\0'+index)
    .digest('hex');
  return digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+
    digest.slice(13,16)+'-8'+digest.slice(17,20)+'-'+digest.slice(20,32);
}
function generatedSweepCubeUuid(seed, index) {
  return generatedBlockoutCubeUuid('geometry-sweep-v1',seed,index);
}
function generatedProfileCubeUuid(seed, index) {
  return generatedBlockoutCubeUuid('geometry-profile-v1',seed,index);
}

/** Bounded transport only. Rust validates every Bone/Cube/parent and
 * performs authoritative disposable preflight. No JS geometry compiler. */
function serializeGeometryAssembly(assembly) {
  if (!assembly || typeof assembly !== 'object' ||
      Array.isArray(assembly) || assembly.expected_revision !== 0 ||
      !Array.isArray(assembly.parts) || assembly.parts.length < 1 ||
      assembly.parts.length > 128) {
    throw new TypeError('CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_INVALID');
  }
  // Void-zone evidence is an optional read-only Rust CLI argument, not
  // an unknown field added to the canonical G1 AssemblyRequest wire.
  const {void_zones: _zones, ...canonicalAssembly} = assembly;
  const payload = JSON.stringify(canonicalAssembly, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_INVALID');
    }
    return value;
  });
  if (!payload || Buffer.byteLength(payload, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_TOO_LARGE');
  }
  return payload;
}

/** Transport validation only. Rust owns surface geometry, source pixels,
 * region synthesis, correction safety and the disposable preflight.
 * This request intentionally has no pixel rows, strokes or freehand UV.
 */
function serializeSemanticMaterialIntent(intent) {
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

/** G2 transport only: Rust owns every geometric validity decision. */
function serializeGeometryAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object' ||
      Array.isArray(attachment) || attachment.expected_revision !== 0) {
    throw new TypeError('CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_INVALID');
  }
  const payload = JSON.stringify(attachment, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_INVALID');
    }
    return value;
  });
  if (!payload || Buffer.byteLength(payload, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_TOO_LARGE');
  }
  return payload;
}

/** Transport-only gate. Rust validates every semantic and numeric constraint. */
function serializeGeometryPropagation(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      request.expected_revision !== 0 ||
      !Array.isArray(request.links) || request.links.length < 1 ||
      request.links.length > 32) {
    throw new TypeError('CODE_MODE_GEOMETRY_PROPAGATION_INPUT_INVALID');
  }
  const payload = JSON.stringify(request, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('CODE_MODE_GEOMETRY_PROPAGATION_INPUT_INVALID');
    }
    return value;
  });
  if (!payload || Buffer.byteLength(payload, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('CODE_MODE_GEOMETRY_PROPAGATION_INPUT_TOO_LARGE');
  }
  return payload;
}

// Static OBB evidence is advisory and only compares source-affected Cubes
// with supported rotated direct siblings in one Bone-local rigid frame.
function validRotatedNeighborObbReview(review, changed) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return false;
  const count = v => Number.isSafeInteger(v) && v >= 0;
  const fields = new Set([
    'scope','checked_pair_count','introduced_intersection_count',
    'preexisting_intersection_count','resolved_intersection_count',
    'introduced_touching_count','unsupported_neighbor_count',
    'introduced_samples','samples_truncated','whole_model_collision_verdict',
  ]);
  if (Object.keys(review).some(key => !fields.has(key)) ||
      review.scope !== 'affected_vs_rotated_direct_same_bone_cube_obb' ||
      review.whole_model_collision_verdict !== 'UNVERIFIED' ||
      !['checked_pair_count','introduced_intersection_count',
        'preexisting_intersection_count','resolved_intersection_count',
        'introduced_touching_count','unsupported_neighbor_count'
      ].every(key => count(review[key])) ||
      review.introduced_intersection_count +
        review.preexisting_intersection_count +
        review.resolved_intersection_count > review.checked_pair_count ||
      review.introduced_touching_count > review.checked_pair_count ||
      !Array.isArray(review.introduced_samples) ||
      review.introduced_samples.length !==
        Math.min(16,review.introduced_intersection_count) ||
      review.samples_truncated !== (review.introduced_intersection_count > 16)) {
    return false;
  }
  const pairs = new Set();
  for(const sample of review.introduced_samples) {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample) ||
        Object.keys(sample).some(key=>!['cube_uuids','penetration_depth'].includes(key)) ||
        !Array.isArray(sample.cube_uuids) || sample.cube_uuids.length !== 2 ||
        !sample.cube_uuids.every(v => typeof v === 'string' &&
          v.length > 0 && v.length <= 128) ||
        sample.cube_uuids[0] >= sample.cube_uuids[1] ||
        !sample.cube_uuids.some(v=>changed.has(v)) ||
        !Number.isFinite(sample.penetration_depth) ||
        sample.penetration_depth <= 0 || sample.penetration_depth > 200000) {
      return false;
    }
    const pair = JSON.stringify(sample.cube_uuids);
    if (pairs.has(pair)) return false;
    pairs.add(pair);
  }
  return true;
}

// Advisory AABB screen is bounded to changed and same-Bone axis-aligned
// Cube pairs. It is not a whole-model collision/visual certification.
function validAxisAlignedOverlapReview(screen, changed) {
  if (!screen || typeof screen !== 'object' || Array.isArray(screen)) return false;
  const fields = new Set([
    'scope','affected_cube_count','checked_pair_count',
    'introduced_overlap_count','preexisting_overlap_count',
    'resolved_overlap_count','unsupported_neighbor_count',
    'introduced_samples','samples_truncated','whole_model_collision_verdict',
    'rotated_neighbor_obb',
  ]);
  const count = n => Number.isSafeInteger(n) && n >= 0;
  if (Object.keys(screen).some(key => !fields.has(key)) ||
      screen.scope !== 'affected_vs_same_bone_axis_aligned_cube_aabb' ||
      screen.whole_model_collision_verdict !== 'UNVERIFIED' ||
      !validRotatedNeighborObbReview(screen.rotated_neighbor_obb,changed) ||
      !count(screen.affected_cube_count) ||
      screen.affected_cube_count !== changed.size ||
      !count(screen.checked_pair_count) ||
      !count(screen.introduced_overlap_count) ||
      !count(screen.preexisting_overlap_count) ||
      !count(screen.resolved_overlap_count) ||
      !count(screen.unsupported_neighbor_count) ||
      screen.introduced_overlap_count +
        screen.preexisting_overlap_count +
        screen.resolved_overlap_count > screen.checked_pair_count ||
      !Array.isArray(screen.introduced_samples) ||
      screen.introduced_samples.length !==
        Math.min(16, screen.introduced_overlap_count) ||
      screen.samples_truncated !== (screen.introduced_overlap_count > 16)) {
    return false;
  }
  const pairs = new Set();
  for (const sample of screen.introduced_samples) {
    const uuids = sample?.cube_uuids, overlap = sample?.overlap;
    if (!sample || typeof sample !== 'object' || Array.isArray(sample) ||
        Object.keys(sample).some(key=>!['cube_uuids','overlap'].includes(key)) ||
        !Array.isArray(uuids) || uuids.length !== 2 ||
        !uuids.every(v=>typeof v==='string' && v.length > 0 && v.length <= 128) ||
        uuids[0] >= uuids[1] ||
        !uuids.some(id=>changed.has(id)) ||
        !Array.isArray(overlap) || overlap.length !== 3 ||
        !overlap.every(v=>Number.isFinite(v) && v > 0 && v <= 200000)) {
      return false;
    }
    const pair = JSON.stringify(uuids);
    if (pairs.has(pair)) return false;
    pairs.add(pair);
  }
  return true;
}

// Require a native *matched* correction receipt before any scoped Paint
// call can be reported as successful to Code Mode. Rust may already have
// published its no-overwrite sibling when a malformed success is observed:
// do NOT auto-retry, remove that file or pretend its provenance is known.
function checkedScopedApplyReceipt(receipt,scope,expectedSourceSha,operationCount) {
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

// Multiple focused read selectors, using one Rust document load. The program
// host still owns filesystem permissions; this is not an OS sandbox.
const INSPECTION_QUERY_FIELDS = Object.freeze({
  authoring_target: ['domain', 'category', 'name'],
  cube: ['uuid'],
  cube_surfaces: ['uuid'],
  cube_face_alpha: ['uuid'],
  cube_uv_sharing: ['uuid', 'texture_uuid'],
  geometry_impact: ['cube_uuid','change'],
  asset_handoff: ['texture_uuid', 'offset', 'limit'],
  model_texture_coverage: ['offset', 'limit', 'attention_only'],
  material_pair: ['reference_uuid', 'candidate_uuid', 'reference_region', 'candidate_region'],
  material_face_patch: ['texture_uuid','cube_uuid','face','region','face_spans'],
  texture_styling: ['texture_uuid','region'],
  texture_source_colors: ['texture_uuid','region','offset','limit'],
  texture_styling_face: ['texture_uuid','cube_uuid','face'],
  catalog: ['category', 'offset', 'limit'],
  texture: ['index'],
  texture_alpha: ['uuid'],
  animation: ['uuid'],
  animation_track: ['animation_uuid', 'bone_uuid', 'offset', 'limit'],
  animation_transform_track: ['animation_uuid', 'bone_uuid', 'channel', 'offset', 'limit'],
  animation_effect_events: ['animation_uuid', 'offset', 'limit'],
  animation_timeline_markers: ['animation_uuid', 'offset', 'limit'],
  audit: [],
});

// Exact cropped atlas evidence. Identical physical dimensions are enforced in Rust.
// Region limits match the existing owned 256x256 RGBA8 Paint decoder.
function materialPatchRegion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['from', 'to'].includes(key))) {
    throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
  }
  const point = xy => {
    if (!Array.isArray(xy) || xy.length !== 2) {
      throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
    }
    return xy.map(n => Number(wholeNumber(n, 'material coordinate', 0, 256)));
  };
  const from = point(value.from), to = point(value.to);
  if (from[0] >= to[0] || from[1] >= to[1]) {
    throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
  }
  if ((to[0]-from[0])*(to[1]-from[1]) > 4096) {
    throw new TypeError('MATERIAL_PAIR_REGION_TOO_LARGE');
  }
  return {from, to};
}
function serializeInspectionQueries(requests) {
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 8) {
    throw new TypeError('Inspection batch must contain 1 through 8 selectors');
  }
  const selected = requests.map((query) => {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new TypeError('Inspection selector must be an object');
    }
    const kind = nonempty(query.kind, 'kind');
    const allowed = Object.hasOwn(INSPECTION_QUERY_FIELDS, kind)
      ? INSPECTION_QUERY_FIELDS[kind] : null;
    if (!allowed || Object.keys(query).some((key) =>
      key !== 'kind' && !allowed.includes(key))) {
      throw new TypeError('Unknown inspection selector or field');
    }
    const output = { kind };
    for (const field of allowed) {
      if (query[field] === undefined) continue;
      const value = query[field];
      if (field === 'offset' || field === 'limit' || field === 'index') {
        output[field] = Number(wholeNumber(
          value, field, field === 'limit' ? 1 : 0,
          field === 'limit' ? (kind === 'model_texture_coverage' ? 8 :
            kind === 'animation_effect_events' ? 16 :
            kind === 'animation_timeline_markers' || kind === 'asset_handoff' ? 32 : 64) :
            (field === 'offset' && kind === 'asset_handoff' ? 393216 :
              field === 'offset' && kind === 'texture_source_colors' ? 4096 : 65536),
        ));
      } else if (field === 'face_spans') {
        // Exact face-local row spans; only Rust maps them through rotated UV.
        if(kind!=='material_face_patch' || !Array.isArray(value) ||
           value.length<1 || value.length>64) {
          throw new TypeError('MATERIAL_FACE_SPANS_INVALID');
        }
        output.face_spans=value.map(span=>{
          if(!span || typeof span!=='object' || Array.isArray(span) ||
             Object.keys(span).some(key=>!['y','x0','x1'].includes(key)) ||
             !['y','x0','x1'].every(key=>Number.isInteger(span[key])) ||
             span.y<0 || span.y>=256 || span.x0<0 || span.x0>=span.x1 ||
             span.x1>256) {
            throw new TypeError('MATERIAL_FACE_SPANS_INVALID');
          }
          return {y:span.y,x0:span.x0,x1:span.x1};
        });
      } else if (field === 'attention_only') {
        if (typeof value !== 'boolean') {
          throw new TypeError('Inspection attention_only must be a boolean');
        }
        output.attention_only = value;
      } else if (field === 'change') {
        if (kind !== 'geometry_impact' ||
            !['reshape','translate','texture','pose'].includes(value)) {
          throw new TypeError('GEOMETRY_IMPACT_CHANGE_INVALID');
        }
        output.change = value;
      } else if (field === 'channel') {
        if (!['rotation', 'position', 'scale'].includes(value)) {
          throw new TypeError('Unsupported transform channel');
        }
        output.channel = value;
      } else if (field === 'domain') {
        if (!['geometry','uv','texturing','animation'].includes(value)) {
          throw new TypeError('Unknown authoring domain');
        }
        output.domain = value;
      } else if (field === 'name' && kind === 'authoring_target') {
        if (typeof value !== 'string' || value !== value.trim() ||
            !value.length || [...value].length > 128 ||
            /[\x00-\x1f\x7f]/.test(value)) {
          throw new TypeError('AUTHORING_TARGET_NAME_INVALID');
        }
        output.name = value;
      } else if (field === 'category') {
        if (!['cubes', 'bones', 'textures', 'animations'].includes(value)) {
          throw new TypeError('Unknown catalog category');
        }
        output.category = value;
      } else if (field === 'reference_region' || field === 'candidate_region' ||
                 field === 'region') {
        output[field] = materialPatchRegion(value);
      } else if (field === 'face') {
        if (!['north','east','south','west','up','down'].includes(value)) {
          throw new TypeError('MATERIAL_FACE_SIDE_UNKNOWN');
        }
        output.face = value;
      } else {
        output[field] = nonempty(value, field);
        if (Buffer.byteLength(output[field], 'utf8') > 128) {
          throw new TypeError('Inspection UUID is too long');
        }
        if (['material_face_patch','texture_styling_face',
             'texture_source_colors'].includes(kind) &&
            (field === 'texture_uuid' || field === 'cube_uuid') &&
            /[\s\x00-\x1f\x7f]/.test(output[field])) {
          throw new TypeError('MATERIAL_FACE_UUID_INVALID');
        }
      }
    }
    if (kind === 'authoring_target' &&
        !({geometry:['cubes','bones'],uv:['cubes'],
           texturing:['cubes','textures'],animation:['bones','animations']}[
           output.domain] ?? []).includes(output.category)) {
      throw new TypeError('AUTHORING_TARGET_DOMAIN_MISMATCH');
    }
    for (const field of allowed) {
      if (!['offset', 'limit', 'attention_only', 'face_spans'].includes(field) && output[field] === undefined) {
        throw new TypeError('Missing required inspection selector field: ' + field);
      }
    }
    return output;
  });
  const encoded = JSON.stringify({ requests: selected });
  if (Buffer.byteLength(encoded, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('INSPECT_BATCH_SIZE_INVALID');
  }
  return { payload: encoded, normalized: selected };
}

/**
 * A programmatic API intended to be imported into an agent host's code sandbox.
 * This module NEVER evals model-generated code or starts a listening server.
 * Native mutation/persistence permission is owned by the agent host and Rust.
 *
 * `runner` and `authorizeMutation` MUST be supplied only by trusted host code.
 * This is defense in depth, NOT a sandbox: a model-controlled unrestricted
 * Node process could instantiate a client with a dishonest callback or call
 * the binary directly. The host must isolate the code and supply a fixed SDK.
 */
export function createRustCodeModeClient({
  binary, runner, authorizeMutation, permitWriteLaunch, onNativeCall,
} = {}) {
  absolute(binary, 'binary');
  if (runner !== undefined && typeof runner !== 'function') {
    throw new TypeError('runner must be a function supplied by a trusted host');
  }
  if (authorizeMutation !== undefined && typeof authorizeMutation !== 'function') {
    throw new TypeError('authorizeMutation must be a trusted-host function');
  }
  if (permitWriteLaunch !== undefined && typeof permitWriteLaunch !== 'function') {
    throw new TypeError('permitWriteLaunch must be a synchronous trusted-host function');
  }
  if (onNativeCall !== undefined && typeof onNativeCall !== 'function') {
    throw new TypeError('onNativeCall must be a trusted-host function');
  }
  const invoke = runner ?? ((args) => runBinary(binary, args));
  async function requestWrite(operation, details) {
    if (typeof authorizeMutation !== 'function') {
      throw new Error('CODE_MODE_MUTATION_AUTHORITY_REQUIRED');
    }
    const descriptor = Object.freeze({ operation, ...details });
    if (await authorizeMutation(descriptor) !== true) {
      throw new Error('CODE_MODE_MUTATION_NOT_APPROVED');
    }
    return descriptor;
  }
  async function call(command, options, approval) {
    const args = optionArgs(command, options);
    if (WRITE_COMMANDS.has(command)) {
      if (!approval) {
        throw new Error('CODE_MODE_MUTATION_AUTHORITY_REQUIRED');
      }
      // Synchronous final lease check immediately before invoking Rust.
      // Apply performs async plan-file I/O AFTER operator approval; a guest
      // may have exited during that gap. Never launch from a stale session.
      if (permitWriteLaunch !== undefined &&
          permitWriteLaunch(approval) !== true) {
        throw new Error('CODE_MODE_MUTATION_SESSION_STALE');
      }
    }
    // Measure only the admitted first-party Rust transport call; plan-file
    // preparation, approval, inspection processing and UI wait are separate.
    // Never pass arguments, paths, model bytes or approval descriptors to
    // the metric observer. A broken observer cannot change actual behavior.
    const began = performance.now();
    let ok = false;
    try {
      const result = await invoke(args);
      // The default process runner validates JSON on success and on error.
      // Trusted test runners return objects directly.
      if (!result || result.status !== 'OK') {
        throw new Error(typeof result?.code === 'string' ? result.code : 'CODE_MODE_CLI_FAILURE');
      }
      ok = true;
      return result;
    } finally {
      if (onNativeCall) {
        try {
          onNativeCall(Object.freeze({
            command,
            duration_ms: Math.max(0, Math.round(performance.now() - began)),
            success: ok,
          }));
        } catch {
          // Telemetry is strictly non-authoritative and best-effort.
        }
      }
    }
  }
  return Object.freeze({
    async newModel({ output, name, modelIdentifier }) {
      const options = {
        output: absolute(output, 'output'), name: nonempty(name, 'name'),
        'model-identifier': nonempty(modelIdentifier, 'modelIdentifier'),
      };
      const approval = await requestWrite('newModel', {
        output: options.output, name: options.name,
        modelIdentifier: options['model-identifier'],
      });
      return call('new', options, approval);
    },
    async inspect({ input, uuid, expectedSha256 } = {}) {
      return call('inspect', {
        input: absolute(input, 'input'),
        ...(uuid === undefined ? {} : { uuid: nonempty(uuid, 'uuid') }),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectCubeSurfaces({ input, cubeUuid, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'surface-uuid': nonempty(cubeUuid, 'cubeUuid'),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectCubeFaceAlpha({ input, cubeUuid, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'face-alpha-uuid': nonempty(cubeUuid, 'cubeUuid'),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectBatch({ input, expectedSha256, requests }) {
      const source = absolute(input, 'input');
      const digest = hash(expectedSha256);
      const { payload, normalized } = serializeInspectionQueries(requests);
      // A SHA-bound Rust inspect-batch is one immutable model read. Repeated
      // byte-identical normalized selectors within THAT batch need only one
      // calculation. Never cache across calls: native Rust must verify the
      // current disk/source SHA for every new inspection.
      const positions = [];
      const unique = [];
      const seen = new Map();
      for (const query of normalized) {
        const key = JSON.stringify(query);
        if (!seen.has(key)) {
          seen.set(key, unique.length);
          unique.push(query);
        }
        positions.push(seen.get(key));
      }
      const duplicates = unique.length !== normalized.length;
      const forwarded = duplicates ? JSON.stringify({ requests: unique }) : payload;
      // Query-only data, not an edit plan. Temporary file is private and is
      // cleaned even if the Rust process reports a refusal or fails.
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-read-batch-'));
      const file = join(directory, 'queries.json');
      try {
        await writeFile(file, forwarded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const receipt = await call('inspect-batch', {
          input: source, queries: file, 'expected-sha256': digest,
        });
        // Every batch needs the same Rust source/selector receipt checks.
        // Previously the non-duplicate path returned early, bypassing them.
        // A successful CLI status alone is not evidence for a requested read.
        if (typeof receipt?.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest.toLowerCase() ||
            !Array.isArray(receipt.results) ||
            receipt.results.length !== unique.length ||
            receipt.results.some((item, i) => !item ||
              typeof item !== 'object' || Array.isArray(item) ||
              item.kind !== unique[i].kind)) {
          throw new Error('CODE_MODE_INSPECT_BATCH_RECEIPT_INVALID');
        }
        // Source relationships are advisory only. An untrusted/forged
        // answer must never promote itself into a write or visual verdict.
        for (let i = 0; i < unique.length; i++) {
          if (unique[i].kind === 'geometry_impact' &&
              !validGeometryImpact(receipt.results[i]?.impact, unique[i])) {
            throw new Error('CODE_MODE_GEOMETRY_IMPACT_RECEIPT_INVALID');
          }
        }
        // Only repeated selectors need independent JSON copies. Always
        // enforce the existing 96 KiB native result-array budget, including
        // when all selectors are unique and the runner is injected by a host.
        let results;
        let serialized;
        try {
          results = duplicates ? positions.map(index =>
            JSON.parse(JSON.stringify(receipt.results[index]))) : receipt.results;
          serialized = JSON.stringify(results);
        } catch {
          throw new Error('CODE_MODE_INSPECT_BATCH_RECEIPT_INVALID');
        }
        if (Buffer.byteLength(serialized, 'utf8') > 96 * 1024) {
          throw new Error('CODE_MODE_INSPECT_BATCH_RESULT_TOO_LARGE');
        }
        return duplicates ? { ...receipt, results } : receipt;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async semanticMap({ input, expectedSha256, category, offset = 0, limit = 16 }) {
      const allowed = ['cubes', 'bones', 'textures', 'animations'];
      if (!allowed.includes(category) ||
          !Number.isSafeInteger(offset) || offset < 0 || offset > 65536 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 24) {
        throw new TypeError('CODE_MODE_SEMANTIC_MAP_QUERY_INVALID');
      }
      const digest = hash(expectedSha256).toLowerCase();
      const receipt = await call('semantic-map', {
        input: absolute(input, 'input'), 'expected-sha256': digest,
        category, offset: wholeNumber(offset, 'offset', 0, 65536),
        limit: wholeNumber(limit, 'limit', 1, 24),
      });
      const map = receipt.map;
      const expectedKind = category.slice(0, -1);
      if (typeof receipt.sha256 !== 'string' ||
          receipt.sha256.toLowerCase() !== digest ||
          receipt.summary?.revision !== 0 ||
          map?.scope !== 'validated_rust_semantic_identity_map' ||
          map?.revision !== 0 || map?.category !== category ||
          map?.offset !== offset ||
          !Number.isSafeInteger(map?.total) || map.total < 0 ||
          !Array.isArray(map?.entries) || map.entries.length > limit ||
          map?.visual_verdict !== 'UNVERIFIED' ||
          map?.write_authority !== 'NOT_GRANTED' ||
          map.entries.some((entry, i) => !entry ||
            entry.kind !== expectedKind || entry.index !== offset + i ||
            !(typeof entry.uuid === 'string' || entry.uuid === null) ||
            !(typeof entry.name === 'string' || entry.name === null)) ||
          (map.next_offset !== null &&
            (!Number.isSafeInteger(map.next_offset) ||
             map.next_offset !== offset + map.entries.length ||
             map.next_offset >= map.total)) ||
          (offset < map.total &&
            map.entries.length !== Math.min(limit, map.total - offset))) {
        throw new Error('CODE_MODE_SEMANTIC_MAP_RECEIPT_INVALID');
      }
      return receipt;
    },
    async planGeometryResizePropagation({ input, expectedSha256, propagation }) {
      const digest = hash(expectedSha256).toLowerCase();
      const source = absolute(input, 'input');
      const payload = serializeGeometryPropagation(propagation);
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-propagation-'));
      const file = join(directory, 'propagation.json');
      try {
        await writeFile(file, payload, { encoding:'utf8', mode:0o600, flag:'wx' });
        const receipt = await call('plan-geometry-resize-propagation', {
          input:source, 'expected-sha256':digest, propagation:file,
        });
        const plan = receipt.plan, preview = receipt.preflight;
        const diagnostic = receipt.diagnostic;
        const first = plan?.operations?.[0];
        const remainder = Array.isArray(plan?.operations) ?
          plan.operations.slice(1) : [];
        const targets = new Set(propagation.links.map(link=>link.moving_cube_uuid));
        const declaredParents = new Map(propagation.links.map(link=>[
          link.moving_cube_uuid, link.anchor_cube_uuid,
        ]));
        const rows = diagnostic?.ordered_links;
        const rowTargets = Array.isArray(rows) ?
          new Set(rows.map(row=>row?.moving_cube_uuid)) : new Set();
        const changedRows = Array.isArray(rows) ?
          rows.filter(row=>row?.status === 'translation_planned') : [];
        if (typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest ||
            receipt.summary?.revision !== 0 ||
            !plan || plan.expected_revision !== 0 ||
            plan.correction_scope !== null ||
            !Array.isArray(plan.operations) ||
            plan.operations.length < 1 || plan.operations.length > 33 ||
            first?.op !== 'reframe_cube' ||
            first.uuid !== propagation.resize_cube_uuid ||
            first.uv_policy !== propagation.uv_policy ||
            !Array.isArray(first.from) || !Array.isArray(first.to) ||
            first.from.length !== 3 || first.to.length !== 3 ||
            !first.from.every((v,i)=>v === propagation.from?.[i]) ||
            !first.to.every((v,i)=>v === propagation.to?.[i]) ||
            remainder.some(op=>op?.op !== 'translate_cube' ||
              !targets.has(op.uuid) ||
              !Array.isArray(op.delta) || op.delta.length !== 3 ||
              !op.delta.every(Number.isFinite)) ||
            new Set(remainder.map(op=>op.uuid)).size !== remainder.length ||
            preview?.status !== 'VALIDATED_NOT_APPLIED' ||
            preview.base_revision !== 0 ||
            preview.mutation?.revision !== 1 ||
            preview.mutation.operation_count !== plan.operations.length ||
            !Array.isArray(preview.mutation.changed_uuids) ||
            preview.mutation.changed_uuids.length !== plan.operations.length ||
            preview.mutation.changed_uuids.some((uuid,i)=>
              uuid !== plan.operations[i].uuid) ||
            preview.candidate_summary?.revision !== 1 ||
            typeof preview.candidate_sha256 !== 'string' ||
            !SHA256.test(preview.candidate_sha256) ||
            preview.write_authority !== 'NOT_GRANTED' ||
            preview.visual_verdict !== 'UNVERIFIED' ||
            diagnostic?.scope !== 'one_shot_same_bone_resize_propagation' ||
            diagnostic.resize_cube_uuid !== propagation.resize_cube_uuid ||
            typeof diagnostic.parent_bone_uuid !== 'string' ||
            diagnostic.dependency_count !== propagation.links.length ||
            diagnostic.translated_count !== remainder.length ||
            diagnostic.unchanged_count !== propagation.links.length - remainder.length ||
            !Array.isArray(rows) || rows.length !== propagation.links.length ||
            rowTargets.size !== targets.size ||
            [...rowTargets].some(uuid=>!targets.has(uuid)) ||
            rows.some(row=>!row ||
              declaredParents.get(row.moving_cube_uuid) !== row.anchor_cube_uuid ||
              !Array.isArray(row.delta) || row.delta.length !== 3 ||
              !row.delta.every(Number.isFinite) ||
              !['translation_planned','already_aligned'].includes(row.status) ||
              (row.status === 'already_aligned' &&
                row.delta.some(v=>v !== 0))) ||
            changedRows.length !== remainder.length ||
            changedRows.some((row,i)=>row.moving_cube_uuid !== remainder[i].uuid ||
              row.delta.some((value,j)=>value !== remainder[i].delta[j])) ||
            diagnostic.persistent_constraints !== false ||
            diagnostic.collision_verdict !== 'NOT_EVALUATED' ||
            !validAxisAlignedOverlapReview(diagnostic.aabb_overlap_review,
              new Set([propagation.resize_cube_uuid,...remainder.map(op=>op.uuid)])) ||
            diagnostic.visual_verdict !== 'UNVERIFIED' ||
            receipt.write_authority !== 'NOT_GRANTED' ||
            receipt.visual_verdict !== 'UNVERIFIED') {
          throw new Error('CODE_MODE_GEOMETRY_PROPAGATION_RECEIPT_INVALID');
        }
        return receipt;
      } finally {
        await rm(directory, { recursive:true, force:true });
      }
    },
    async planGeometryAttachment({ input, expectedSha256, attachment }) {
      const digest = hash(expectedSha256).toLowerCase();
      const source = absolute(input, 'input');
      const payload = serializeGeometryAttachment(attachment);
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-face-attachment-'));
      const file = join(directory, 'attachment.json');
      try {
        await writeFile(file, payload, { encoding:'utf8', mode:0o600, flag:'wx' });
        const receipt = await call('plan-geometry-attachment', {
          input:source, 'expected-sha256':digest, attachment:file,
        });
        const plan = receipt.plan, preview = receipt.preflight;
        const op = plan?.operations?.[0], diagnostic = receipt.diagnostic;
        if (typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest ||
            receipt.summary?.revision !== 0 ||
            !plan || plan.expected_revision !== 0 ||
            plan.correction_scope !== null ||
            !Array.isArray(plan.operations) || plan.operations.length !== 1 ||
            op?.op !== 'translate_cube' ||
            op.uuid !== attachment.moving_cube_uuid ||
            !Array.isArray(op.delta) || op.delta.length !== 3 ||
            !op.delta.every(Number.isFinite) ||
            preview?.status !== 'VALIDATED_NOT_APPLIED' ||
            preview.base_revision !== 0 || preview.mutation?.revision !== 1 ||
            preview.mutation.operation_count !== 1 ||
            !Array.isArray(preview.mutation.changed_uuids) ||
            !preview.mutation.changed_uuids.includes(attachment.moving_cube_uuid) ||
            preview.candidate_summary?.revision !== 1 ||
            typeof preview.candidate_sha256 !== 'string' ||
            !SHA256.test(preview.candidate_sha256) ||
            preview.write_authority !== 'NOT_GRANTED' ||
            preview.visual_verdict !== 'UNVERIFIED' ||
            diagnostic?.scope !== 'same_bone_axis_aligned_face_attachment' ||
            diagnostic.anchor_cube_uuid !== attachment.anchor_cube_uuid ||
            diagnostic.moving_cube_uuid !== attachment.moving_cube_uuid ||
            typeof diagnostic.parent_bone_uuid !== 'string' ||
            diagnostic.anchor_face !== attachment.anchor_face ||
            diagnostic.moving_face !== attachment.moving_face ||
            diagnostic.clearance !== attachment.clearance ||
            !Array.isArray(diagnostic.tangent_offset) ||
            diagnostic.tangent_offset.length !== 2 ||
            !diagnostic.tangent_offset.every((n,i) =>
              n === attachment.tangent_offset?.[i]) ||
            !Array.isArray(diagnostic.delta) ||
            diagnostic.delta.length !== 3 ||
            !diagnostic.delta.every((n,i) => n === op.delta[i]) ||
            diagnostic.collision_verdict !== 'NOT_EVALUATED' ||
            !validAxisAlignedOverlapReview(diagnostic.aabb_overlap_review,
              new Set([attachment.moving_cube_uuid])) ||
            diagnostic.visual_verdict !== 'UNVERIFIED' ||
            receipt.write_authority !== 'NOT_GRANTED' ||
            receipt.visual_verdict !== 'UNVERIFIED') {
          throw new Error('CODE_MODE_GEOMETRY_ATTACHMENT_RECEIPT_INVALID');
        }
        return receipt;
      } finally {
        await rm(directory, { recursive:true, force:true });
      }
    },
    async planGeometryAssembly({ input, expectedSha256, assembly }) {
      const digest = hash(expectedSha256).toLowerCase();
      const source = absolute(input, 'input');
      const zones=normalizedGeometryVoidZones(assembly);
      const payload = serializeGeometryAssembly(assembly);
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-geometry-plan-'));
      const file = join(directory, 'assembly.json');
      try {
        await writeFile(file, payload, { encoding:'utf8', mode:0o600, flag:'wx' });
        // Read-only Rust compiler and opt-in saved-local negative-space
        // checks. No new writer, geometry engine or image-derived bounds.
        const args={input:source,'expected-sha256':digest,assembly:file};
        if (zones!==null) {
          const zoneFile=join(directory,'void-zones.json');
          await writeFile(zoneFile,JSON.stringify(zones),
            {encoding:'utf8',mode:0o600,flag:'wx'});
          args['void-zones']=zoneFile;
        }
        const receipt = await call('plan-geometry-assembly',args);
        const plan = receipt.plan, preview = receipt.preflight;
        // Bind each returned UUID to one declared Bone, Cube or G3 blockout
        // panel. All shape calculation remains in the canonical Rust owner.
        const declared = new Map();
        const proposedOperations = Array.isArray(plan?.operations)
          ? plan.operations : [];
        let declarationValid = true;
        for (const part of assembly.parts) {
          if (!part || typeof part !== 'object' || !part.bone ||
              !Array.isArray(part.cubes) ||
              (part.frames !== undefined && !Array.isArray(part.frames)) ||
              (part.hollow_boxes !== undefined &&
                !Array.isArray(part.hollow_boxes)) ||
              (part.arches !== undefined &&
                !Array.isArray(part.arches)) ||
              (part.sweeps !== undefined &&
                !Array.isArray(part.sweeps)) ||
              (part.profile_sweeps !== undefined &&
                !Array.isArray(part.profile_sweeps)) ||
              (part.lofts !== undefined && !Array.isArray(part.lofts)) ||
              (part.revolves !== undefined && !Array.isArray(part.revolves))) {
            declarationValid = false;
            break;
          }
          const declare = (uuid, op, parent, name, blockout = false) => {
            if (typeof uuid !== 'string' || !uuid.length || declared.has(uuid)) {
              declarationValid = false;
            } else { declared.set(uuid, {op,parent,name,blockout}); }
          };
          declare(part.bone.uuid, 'add_bone', part.parent_uuid, part.bone.name);
          for (const cube of part.cubes) {
            declare(cube?.uuid, 'add_cube', part.bone.uuid, cube?.name);
          }
          for (const frame of part.frames ?? []) {
            if (!frame || !Array.isArray(frame.cube_uuids) ||
                frame.cube_uuids.length !== 4 || typeof frame.name !== 'string') {
              declarationValid = false;
              break;
            }
            ['left','right','bottom','top'].forEach((side,i) =>
              declare(frame.cube_uuids[i], 'add_cube', part.bone.uuid,
                frame.name+'_'+side,true));
          }
          for (const hollow of part.hollow_boxes ?? []) {
            if (!hollow || !Array.isArray(hollow.cube_uuids) ||
                hollow.cube_uuids.length !== 5 ||
                typeof hollow.name !== 'string') {
              declarationValid = false;
              break;
            }
            ['wall_a_low','wall_a_high','wall_b_low','wall_b_high','back']
              .forEach((side,i) =>
                declare(hollow.cube_uuids[i], 'add_cube', part.bone.uuid,
                  hollow.name+'_'+side,true));
          }
          for (const arch of part.arches ?? []) {
            const ids = arch?.cube_uuids;
            // Only verify transport shape/identity. Rust alone owns
            // semicircle math, source-validated dimensions and topology.
            if (!Array.isArray(ids) || ids.length < 5 || ids.length > 17 ||
                ids.length % 2 !== 1 || typeof arch?.name !== 'string') {
              declarationValid = false;
              break;
            }
            declare(ids[0], 'add_cube', part.bone.uuid,
              arch.name+'_left_pier',true);
            declare(ids[1], 'add_cube', part.bone.uuid,
              arch.name+'_right_pier',true);
            ids.slice(2).forEach((uuid,i) =>
              declare(uuid, 'add_cube', part.bone.uuid,
                arch.name+'_curve_'+(i+1),true));
          }
          for (const sweep of part.sweeps ?? []) {
            const mode=sweep?.interpolation ?? 'LINEAR';
            const curved=mode === 'CENTRIPETAL_CATMULL_ROM';
            const tolerance=sweep?.max_chord_error;
            if (!sweep || typeof sweep.uuid_seed !== 'string' ||
                typeof sweep.name !== 'string' ||
                !Array.isArray(sweep.stations) ||
                sweep.stations.length < (curved ? 3 : 2) ||
                sweep.stations.length > 8 ||
                (mode !== 'LINEAR' && !curved) ||
                (curved ?
                  !Number.isFinite(tolerance) ||
                    tolerance < 0.25 || tolerance > 1 :
                  tolerance !== undefined)) {
              declarationValid = false;
              break;
            }
            // Number of raster Cubes is known only after canonical Rust
            // partition. Bind each observed index to its seed-derived UUID;
            // missing indices, unexpected outputs and foreign owners fail.
            let count=0;
            while (count < 64) {
              const uuid=generatedSweepCubeUuid(sweep.uuid_seed,count);
              if (!proposedOperations.some(op =>
                op?.op === 'add_cube' && op.cube?.uuid === uuid)) break;
              declare(uuid,'add_cube',part.bone.uuid,
                sweep.name+'_v_'+count,true);
              count++;
            }
            if (count === 0) declarationValid = false;
          }
          for (const profile of part.profile_sweeps ?? []) {
            if (!profile || typeof profile.uuid_seed !== 'string' ||
                typeof profile.name !== 'string' ||
                !['X','Y','Z'].includes(profile.up_axis) ||
                !['ELLIPSE','RECTANGLE'].includes(profile.cross_section) ||
                !Array.isArray(profile.stations) ||
                profile.stations.length < 2 || profile.stations.length > 8 ||
                profile.stations.some(station => !station ||
                  (station.twist_degrees !== undefined &&
                    (!Number.isFinite(station.twist_degrees) ||
                      Math.abs(station.twist_degrees) > 180)))) {
              declarationValid = false;
              break;
            }
            // Only the canonical Rust partition knows its output count.
            // Bind the contiguous UUID index namespace, Bone and name;
            // all actual geometry and bounded preflight remain Rust-owned.
            let count=0;
            while (count < 64) {
              const uuid=generatedProfileCubeUuid(profile.uuid_seed,count);
              if (!proposedOperations.some(op =>
                op?.op === 'add_cube' && op.cube?.uuid === uuid)) break;
              declare(uuid,'add_cube',part.bone.uuid,
                profile.name+'_v_'+count,true);
              count++;
            }
            if (count === 0) declarationValid = false;
          }
          // LOFT and REVOLVE reuse the canonical Rust voxel partition.
          // This checks transport limits and source UUID identities only.
          for (const [kind, shapes] of [
            ['loft',part.lofts ?? []], ['revolve',part.revolves ?? []],
          ]) {
            if (shapes.length > 4) { declarationValid=false; break; }
            for (const shape of shapes) {
              const valid = shape &&
                typeof shape.name === 'string' &&
                typeof shape.uuid_seed === 'string' &&
                ['X','Y','Z'].includes(shape.axis) &&
                Array.isArray(shape.origin) && shape.origin.length === 3 &&
                shape.origin.every(n => Number.isInteger(n) && Math.abs(n) <= 64) &&
                Array.isArray(shape.sections) &&
                shape.sections.length >= 2 && shape.sections.length <= 12 &&
                shape.sections.every(section =>
                  section && Number.isInteger(section.height) &&
                  section.height >= 0 && section.height <= 32 &&
                  (kind === 'loft' ?
                    Array.isArray(section.center) && section.center.length === 2 &&
                    section.center.every(n => Number.isFinite(n) && Math.abs(n) <= 16) &&
                    Array.isArray(section.size) && section.size.length === 2 &&
                    section.size.every(n => Number.isInteger(n) && n >= 1 && n <= 32) :
                    Number.isInteger(section.outer_radius) &&
                    section.outer_radius >= 1 && section.outer_radius <= 12 &&
                    Number.isInteger(section.inner_radius) &&
                    section.inner_radius >= 0 &&
                    section.inner_radius + 1 <= section.outer_radius));
              if (!valid) { declarationValid=false; break; }
              let count=0;
              while (count < 64) {
                const uuid=generatedBlockoutCubeUuid(
                  'geometry-'+kind+'-v1',shape.uuid_seed,count);
                if (!proposedOperations.some(op =>
                  op?.op === 'add_cube' && op.cube?.uuid === uuid)) break;
                declare(uuid,'add_cube',part.bone.uuid,
                  shape.name+'_v_'+count,true);
                count++;
              }
              if (count === 0) { declarationValid=false; break; }
            }
            if (!declarationValid) break;
          }
        }
        const used = new Set();
        const operationIdentityValid = Array.isArray(plan?.operations) &&
          plan.operations.every(op => {
            const uuid = op?.op === 'add_bone' ? op.bone?.uuid : op?.cube?.uuid;
            const claim = declared.get(uuid);
            if (!claim || claim.op !== op.op || used.has(uuid)) return false;
            used.add(uuid);
            return op.op === 'add_bone' ?
              op.parent_uuid === claim.parent && op.bone?.name === claim.name :
              op.bone_uuid === claim.parent && op.cube?.name === claim.name &&
                (!claim.blockout || op.cube?.box_uv === true);
          });
        const expected = declared.size;
        if (!declarationValid || expected < 1 || expected > 128 ||
            typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest ||
            receipt.summary?.revision !== 0 ||
            !plan || plan.expected_revision !== 0 ||
            plan.correction_scope !== null ||
            !Array.isArray(plan.operations) ||
            plan.operations.length < 1 || plan.operations.length !== expected ||
            plan.operations.length > 128 || !operationIdentityValid ||
            used.size !== expected ||
            plan.operations.some(op => !op ||
              !['add_bone','add_cube'].includes(op.op)) ||
            preview?.status !== 'VALIDATED_NOT_APPLIED' ||
            preview.base_revision !== 0 || preview.mutation?.revision !== 1 ||
            preview.mutation?.operation_count !== plan.operations.length ||
            !Array.isArray(preview.mutation?.changed_uuids) ||
            preview.mutation.changed_uuids.length !== plan.operations.length ||
            preview.mutation.changed_uuids.some((uuid,i) =>
              uuid !== (plan.operations[i].op === 'add_bone' ?
                plan.operations[i].bone.uuid : plan.operations[i].cube.uuid)) ||
            preview.candidate_summary?.revision !== 1 ||
            typeof preview.candidate_sha256 !== 'string' ||
            !SHA256.test(preview.candidate_sha256) ||
            preview.write_authority !== 'NOT_GRANTED' ||
            preview.visual_verdict !== 'UNVERIFIED' ||
            receipt.write_authority !== 'NOT_GRANTED' ||
            receipt.visual_verdict !== 'UNVERIFIED') {
          throw new Error('CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID');
        }
        if (!validGeometryVoidEvidence(receipt.void_evidence,zones)) {
          throw new Error('CODE_MODE_GEOMETRY_VOID_EVIDENCE_INVALID');
        }
        return receipt;
      } finally {
        await rm(directory, { recursive:true, force:true });
      }
    },
    async planSemanticMaterial({ input, expectedSha256, intent }) {
      const digest=hash(expectedSha256).toLowerCase();
      const payload=serializeSemanticMaterialIntent(intent);
      const folder=await mkdtemp(join(tmpdir(),'lazydesigner-material-plan-'));
      const file=join(folder,'semantic-intent.json');
      try {
        await writeFile(file,payload,{encoding:'utf8',mode:0o600,flag:'wx'});
        const receipt=await call('plan-semantic-material',{
          input:absolute(input,'input'),'expected-sha256':digest,intent:file,
        });
        const plan=receipt.plan,preview=receipt.preflight;
        const scope=plan?.correction_scope;
        const op=plan?.operations?.[0];
        const e=receipt.material_evidence;
        const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
        if(receipt.sha256?.toLowerCase()!==digest ||
           receipt.summary?.revision!==0 ||
           plan?.expected_revision!==0 ||
           !Array.isArray(plan.operations) || plan.operations.length!==1 ||
           op?.op!=='paint_cube_face_regions_guarded' ||
           op?.cube_uuid!==intent.cube_uuid ||
           op?.texture_uuid!==intent.texture_uuid ||
           !Array.isArray(op.regions) || op.regions.length<1 ||
           op.regions.length>64 ||
           op.regions.some(r=>r?.face!==intent.face ||
             r.erase!==false || !Array.isArray(r.rgba) ||
             ![[...intent.shadow_rgb,255],[...intent.highlight_rgb,255]]
               .some(color=>equal(color,r.rgba)) ||
             !Array.isArray(r.from) || !Array.isArray(r.to) ||
             r.from.length!==2 || r.to.length!==2 ||
             !r.from.every((v,i)=>Number.isInteger(v)&&v>=0&&v<r.to[i]&&
               Number.isInteger(r.to[i])&&r.to[i]<=256)) ||
           scope?.texture_uuid!==intent.texture_uuid ||
           scope.preserve_alpha!==true ||
           !equal(scope.editable_before_rgba,[intent.source_base_rgba]) ||
           !equal(scope.protected_regions,intent.protected_regions??[]) ||
           !equal(scope.expected_before_pixels,intent.expected_before_pixels??[]) ||
           !Array.isArray(scope.allowed_regions) ||
           scope.allowed_regions.length!==1 ||
           !scope.allowed_regions.every(rect=>
             rect && Array.isArray(rect.from) && Array.isArray(rect.to) &&
             rect.from.length===2 && rect.to.length===2 &&
             rect.from.every((v,i)=>Number.isInteger(v)&&v>=0&&
               Number.isInteger(rect.to[i])&&rect.to[i]>v&&rect.to[i]<=256)) ||
           preview?.status!=='VALIDATED_NOT_APPLIED' ||
           preview?.base_revision!==0 ||
           preview.mutation?.revision!==1 ||
           preview.mutation?.operation_count!==1 ||
           !Array.isArray(preview.mutation?.changed_uuids) ||
           preview.candidate_summary?.revision!==1 ||
           typeof preview.candidate_sha256!=='string' ||
           !SHA256.test(preview.candidate_sha256) ||
           preview.write_authority!=='NOT_GRANTED' ||
           preview.visual_verdict!=='UNVERIFIED' ||
           e?.scope!=='source_selected_face_semantic_metal_candidate' ||
           e?.material!=='painted_metal' ||
           e?.cube_uuid!==intent.cube_uuid ||
           e?.texture_uuid!==intent.texture_uuid ||
           e?.face!==intent.face ||
           e?.reference_png_sha256!==intent.reference_png_sha256 ||
           e?.reference_authority!=='NOT_VERIFIED_BY_RUST' ||
           e?.visual_verdict!=='UNVERIFIED' ||
           e?.style_quality!=='NOT_EVALUATED' ||
           e?.detail_boundary_guard!=='one_face_local_texel_around_non_base_rgba' ||
           !Number.isSafeInteger(e?.skipped_near_existing_detail_pixels) ||
           e.skipped_near_existing_detail_pixels<0 ||
           !Number.isSafeInteger(e?.candidate_pixels) ||
           !Number.isSafeInteger(e?.light_pixels) ||
           !Number.isSafeInteger(e?.shadow_pixels) ||
           e.light_pixels<1 || e.shadow_pixels<1 ||
           e.candidate_pixels!==e.light_pixels+e.shadow_pixels ||
           e?.write_authority!=='NOT_GRANTED' ||
           receipt.write_authority!=='NOT_GRANTED' ||
           receipt.visual_verdict!=='UNVERIFIED') {
          throw new Error('CODE_MODE_SEMANTIC_MATERIAL_RECEIPT_INVALID');
        }
        return receipt;
      } finally {
        await rm(folder,{recursive:true,force:true});
      }
    },
    async preflight({ input, expectedSha256, operations, correctionScope }) {
      const digest = hash(expectedSha256).toLowerCase();
      const payload = serializePlan(
        operations, normalizedCorrectionScope(correctionScope));
      // Temporary plan files are only a bounded transport to the existing
      // CLI reader. Preflight never requests approval or publishes a model.
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-preflight-'));
      const file = join(directory, 'edit.plan.json');
      try {
        await writeFile(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const receipt = await call('preflight', {
          input: absolute(input, 'input'), 'expected-sha256': digest,
          plan: file,
        });
        const result = receipt.preflight;
        if (typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest ||
            receipt.summary?.revision !== 0 ||
            result?.status !== 'VALIDATED_NOT_APPLIED' ||
            result?.base_revision !== 0 ||
            result?.mutation?.revision !== 1 ||
            result.mutation.operation_count !== operations.length ||
            !Array.isArray(result.mutation.changed_uuids) ||
            result?.candidate_summary?.revision !== 1 ||
            typeof result?.candidate_sha256 !== 'string' ||
            !SHA256.test(result.candidate_sha256) ||
            result?.visual_verdict !== 'UNVERIFIED' ||
            result?.write_authority !== 'NOT_GRANTED') {
          throw new Error('CODE_MODE_PREFLIGHT_RECEIPT_INVALID');
        }
        return receipt;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async catalog({ input, kind, offset = 0, limit = 32, expectedSha256 }) {
      if (!['cubes', 'bones', 'textures', 'animations'].includes(kind)) {
        throw new TypeError('Unknown catalog kind');
      }
      return call('inspect', {
        input: absolute(input, 'input'), list: kind,
        offset: wholeNumber(offset, 'offset', 0, 65536),
        limit: wholeNumber(limit, 'limit', 1, 64),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectTexture({ input, index, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'texture-index': wholeNumber(index, 'index', 0, 65536),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectTextureAlpha({ input, textureUuid, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'alpha-uuid': nonempty(textureUuid, 'textureUuid'),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectAnimation({ input, uuid, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'), 'animation-uuid': nonempty(uuid, 'uuid'),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectAnimationTrack({
      input, animationUuid, boneUuid, offset = 0, limit = 32, expectedSha256,
    }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'animation-uuid': nonempty(animationUuid, 'animationUuid'),
        'bone-uuid': nonempty(boneUuid, 'boneUuid'),
        'frame-offset': wholeNumber(offset, 'offset', 0, 65536),
        'frame-limit': wholeNumber(limit, 'limit', 1, 64),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectAnimationTransformTrack({
      input, animationUuid, boneUuid, channel, offset = 0, limit = 32, expectedSha256,
    }) {
      if (!['rotation', 'position', 'scale'].includes(channel)) {
        throw new TypeError('Unsupported transform channel');
      }
      return call('inspect', {
        input: absolute(input, 'input'),
        'animation-uuid': nonempty(animationUuid, 'animationUuid'),
        'bone-uuid': nonempty(boneUuid, 'boneUuid'),
        'track-channel': channel,
        'frame-offset': wholeNumber(offset, 'offset', 0, 65536),
        'frame-limit': wholeNumber(limit, 'limit', 1, 64),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async audit({ input, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'), audit: 'model',
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async apply({ input, output, expectedSha256, operations, correctionScope, correctionIntent, materialWorkPacket }) {
      const options = {
        input: absolute(input, 'input'),
        output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const scope = normalizedCorrectionScope(correctionScope);
      const payload = serializePlan(operations, scope);
      const intent = normalizedMaterialCorrectionIntent(correctionIntent);
      const workPacket=normalizedMaterialWorkPacket(materialWorkPacket);
      if(workPacket && (workPacket.sourceModelSha256!==options['expected-sha256'] ||
          workPacket.textureUuid!==scope?.texture_uuid)) {
        throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_SOURCE_MISMATCH');
      }
      const approval = await requestWrite('apply', {
        input: options.input, output: options.output,
        expectedSha256: options['expected-sha256'],
        operationCount: operations.length,
        operationKinds: Object.freeze(operations.map((op) => op?.op ?? null)),
        ...(scope ? { correctionScope: Object.freeze({
          textureUuid:scope.texture_uuid,
          allowedRegions:Object.freeze(scope.allowed_regions.map(rect => Object.freeze({
            from:Object.freeze([...rect.from]), to:Object.freeze([...rect.to]),
          }))),
          regionCount:scope.allowed_regions.length,
          preserveAlpha:scope.preserve_alpha,
          ...(scope.protected_regions?{
            protectedRegions:Object.freeze(scope.protected_regions.map(rect=>
              Object.freeze({from:Object.freeze([...rect.from]),
                to:Object.freeze([...rect.to])}))),
          }:{}),
          ...(scope.expected_before_pixels?{
            expectedBeforePixels:Object.freeze(scope.expected_before_pixels.map(pixel=>
              Object.freeze({at:Object.freeze([...pixel.at]),
                rgba:Object.freeze([...pixel.rgba])}))),
          }:{}),
          ...(scope.editable_before_rgba?{
            editableBeforeRgba:Object.freeze(scope.editable_before_rgba.map(rgba=>
              Object.freeze([...rgba]))),
          }:{}),
        }) } : {}),
        ...(intent ? {
          materialCorrectionIntent:intent,
          materialIntentSha256:createHash('sha256')
            .update(JSON.stringify(intent)).digest('hex'),
        } : {}),
        ...(workPacket?{
          materialWorkPacket:workPacket,
          materialWorkPacketSha256:materialWorkPacketDigest(workPacket),
        }:{}),
        planSha256: createHash('sha256').update(payload).digest('hex'),
      });
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-code-mode-'));
      const file = join(directory, 'edit.plan.json');
      try {
        await writeFile(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const receipt=await call('apply', { ...options, plan: file }, approval);
        return checkedScopedApplyReceipt(
          receipt,scope,options['expected-sha256'],operations.length);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    /** SHA-bound read-only external image comparison. Paths come only from
     * the trusted host, never from model-written JavaScript. */
    async inspectVisualPair({
      input, expectedSha256, referencePng, capturePng,
      referenceSha256, captureSha256,
    }) {
      return call('inspect-visual-pair', {
        input: absolute(input, 'input'),
        'expected-sha256': hash(expectedSha256),
        reference: absolute(referencePng, 'referencePng'),
        'reference-sha256': hash(referenceSha256),
        capture: absolute(capturePng, 'capturePng'),
        'capture-sha256': hash(captureSha256),
      });
    },
    async importPng({ input, output, png, uuid, name, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        png: absolute(png, 'png'), uuid: nonempty(uuid, 'uuid'),
        name: nonempty(name, 'name'), 'expected-sha256': hash(expectedSha256),
      };
      const approval = await requestWrite('importPng', {
        input: options.input, output: options.output, png: options.png,
        uuid: options.uuid, expectedSha256: options['expected-sha256'],
      });
      return call('import-png', options, approval);
    },
    async exportPng({ input, output, textureUuid, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'texture-uuid': nonempty(textureUuid, 'textureUuid'),
        'expected-sha256': hash(expectedSha256),
      };
      const approval = await requestWrite('exportPng', {
        input: options.input, output: options.output,
        textureUuid: options['texture-uuid'], expectedSha256: options['expected-sha256'],
      });
      return call('export-png', options, approval);
    },
    async exportGeometry({ input, output, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const approval = await requestWrite('exportGeometry', {
        input: options.input, output: options.output,
        expectedSha256: options['expected-sha256'],
      });
      return call('export-geometry', options, approval);
    },
    async exportAnimations({ input, output, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const approval = await requestWrite('exportAnimations', {
        input: options.input, output: options.output,
        expectedSha256: options['expected-sha256'],
      });
      return call('export-animation', options, approval);
    },
  });
}

/**
 * Bind a single immutable file/SHA snapshot. Each inspection re-reads the
 * actual file with the pinned SHA and fails closed on stale reads; each
 * mutation uses the same precondition. No mutable JS scene cache is created.
 */
export async function openRustCodeModeProject(client, input) {
  if (!client || typeof client.inspect !== 'function' ||
      typeof client.apply !== 'function') {
    throw new TypeError('A trusted Rust Code Mode client is required');
  }
  const path = absolute(input, 'input');
  const snapshot = await client.inspect({ input: path });
  const expectedSha256 = hash(snapshot.sha256);
  return Object.freeze({
    input: path,
    expectedSha256,
    summary: snapshot.summary,
    inspect: (uuid) => client.inspect({ input: path, uuid, expectedSha256 }),
    inspectCubeSurfaces: (cubeUuid) =>
      client.inspectCubeSurfaces({ input: path, cubeUuid, expectedSha256 }),
    inspectCubeFaceAlpha: (cubeUuid) =>
      client.inspectCubeFaceAlpha({ input: path, cubeUuid, expectedSha256 }),
    inspectBatch: (requests) =>
      client.inspectBatch({ input: path, expectedSha256, requests }),
    semanticMap: (category, { offset = 0, limit = 16 } = {}) =>
      client.semanticMap({ input: path, expectedSha256, category, offset, limit }),
    preflight: ({ operations, correctionScope }) =>
      client.preflight({ input: path, expectedSha256, operations, correctionScope }),
    planGeometryAssembly: (assembly) =>
      client.planGeometryAssembly({ input:path, expectedSha256, assembly }),
    planSemanticMaterial: (intent) =>
      client.planSemanticMaterial({ input:path, expectedSha256, intent }),
    planGeometryAttachment: (attachment) =>
      client.planGeometryAttachment({ input:path, expectedSha256, attachment }),
    planGeometryResizePropagation: (propagation) =>
      client.planGeometryResizePropagation({ input:path, expectedSha256, propagation }),
    catalog: (kind, { offset = 0, limit = 32 } = {}) =>
      client.catalog({ input: path, kind, offset, limit, expectedSha256 }),
    audit: () => client.audit({ input: path, expectedSha256 }),
    inspectTexture: (index) => client.inspectTexture({ input: path, index, expectedSha256 }),
    inspectTextureAlpha: (textureUuid) =>
      client.inspectTextureAlpha({ input: path, textureUuid, expectedSha256 }),
    inspectAnimation: (uuid) => client.inspectAnimation({ input: path, uuid, expectedSha256 }),
    inspectAnimationTrack: (animationUuid, boneUuid, { offset = 0, limit = 32 } = {}) =>
      client.inspectAnimationTrack({
        input: path, animationUuid, boneUuid, offset, limit, expectedSha256,
      }),
    inspectAnimationTransformTrack: (animationUuid, boneUuid, channel, { offset = 0, limit = 32 } = {}) =>
      client.inspectAnimationTransformTrack({
        input: path, animationUuid, boneUuid, channel, offset, limit, expectedSha256,
      }),
    apply: ({ output, operations, correctionScope, correctionIntent, materialWorkPacket }) =>
      client.apply({ input: path, output, expectedSha256, operations, correctionScope, correctionIntent, materialWorkPacket }),
    exportPng: ({ output, textureUuid }) =>
      client.exportPng({ input: path, output, textureUuid, expectedSha256 }),
    exportGeometry: ({ output }) =>
      client.exportGeometry({ input: path, output, expectedSha256 }),
    exportAnimations: ({ output }) =>
      client.exportAnimations({ input: path, output, expectedSha256 }),
  });
}

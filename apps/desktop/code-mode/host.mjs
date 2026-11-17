/**
 * Trusted host for Code Mode RPC. Model JavaScript runs in a separate Deno
 * permission-denied process, never in this Node process or in Tauri/Rust.
 * The host alone holds first-party Rust CLI credentials and file authority.
 * SOURCE_ONLY: no native runtime or sandbox proof has been executed.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { createRustCodeModeClient, openRustCodeModeProject, normalizedCorrectionScope, normalizedMaterialCorrectionIntent } from './client.mjs';
import {normalizedMaterialWorkPacket,validateMaterialWorkPacketOperations,
  materialWorkPacketDigest,compileMaterialClusterPaint} from './material-work-packet.mjs';

const WORKER = fileURLToPath(new URL('./sandbox-worker.mjs', import.meta.url));
const DENO_FLAGS = Object.freeze([
  'run', '--no-config', '--no-lock', '--no-npm', '--no-remote', '--no-prompt',
]);
const MAX_CODE_BYTES = 32 * 1024;
const MAX_RPC_BYTES = 128 * 1024;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_CALLS = 64;
const MAX_PROJECTS = 16;
const PIXEL_MUTATIONS = new Set([
  'paint_texture_pixel', 'paint_texture_stroke', 'paint_texture_brush',
  'paint_texture_rectangle', 'paint_texture_rectangles',
  'paint_cube_uv_faces', 'paint_cube_uv_faces_guarded',
  'paint_cube_face_regions_guarded', 'recolor_cube_faces_palette_guarded',
  'paint_texture_fill', 'isolate_cube_box_uv',
]);
const TIMEOUT_MS = 90000;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VISUAL_PNG_BYTES = 8 * 1024 * 1024;
const VISUAL_VIEWS = new Set([
  'front', 'back', 'left', 'right', 'top', 'bottom', 'three_quarter',
]);
const CARDINAL_VIEWS = Object.freeze(['front','back','left','right','top','bottom']);
const SHA256 = /^[a-f0-9]{64}$/i;

function requireAbsolute(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) ||
      value.includes('\0')) {
    throw new TypeError(label + ' must be an absolute path');
  }
  return value;
}
function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('CODE_MODE_RPC_ARGUMENT_INVALID');
  }
  return value;
}
function shortError(error) {
  const value = error?.message ?? String(error);
  return typeof value === 'string' ? value.slice(0, 160) : 'CODE_MODE_HOST_FAILURE';
}
async function regularFile(path, label) {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error(label + '_NOT_REGULAR_FILE');
  }
  return realpath(path);
}
async function pinnedVisualPng(path, label) {
  const selected = await regularFile(requireAbsolute(path, label), label);
  if (!selected.toLowerCase().endsWith('.png')) {
    throw new Error('CODE_MODE_VISUAL_PNG_EXTENSION_INVALID');
  }
  const stat = await lstat(selected);
  if (!stat.isFile() || stat.size < 8 || stat.size > MAX_VISUAL_PNG_BYTES) {
    throw new Error('CODE_MODE_VISUAL_PNG_SIZE_INVALID');
  }
  const bytes = await readFile(selected);
  if (bytes.length !== stat.size || bytes.length > MAX_VISUAL_PNG_BYTES ||
      !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('CODE_MODE_VISUAL_PNG_INVALID');
  }
  return Object.freeze({
    path:selected, sha256:createHash('sha256').update(bytes).digest('hex'),
  });
}
async function pinnedVisualPair(source, options, modelSha) {
  if (options === undefined) return null;
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => ![
        'referencePngPath','capturePngPath','captureModelSha256','viewId',
        'supportingViews','requireSixDirections',
      ].includes(key)) ||
      typeof options.captureModelSha256 !== 'string' ||
      !SHA256.test(options.captureModelSha256) ||
      !VISUAL_VIEWS.has(options.viewId) ||
      (options.requireSixDirections !== undefined &&
       typeof options.requireSixDirections !== 'boolean') ||
      source === null || modelSha !== options.captureModelSha256.toLowerCase()) {
    throw new Error('CODE_MODE_VISUAL_PAIR_BINDING_INVALID');
  }
  const extras = options.supportingViews ?? [];
  if (!Array.isArray(extras) || extras.length > 6 ||
      extras.some(entry => !entry || typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).some(key =>
          !['referencePngPath','capturePngPath','viewId'].includes(key)) ||
        !VISUAL_VIEWS.has(entry.viewId))) {
    throw new Error('CODE_MODE_VISUAL_VIEW_SET_INVALID');
  }
  const choices = [{viewId:options.viewId,
    referencePngPath:options.referencePngPath,
    capturePngPath:options.capturePngPath},...extras];
  const names = choices.map(v => v.viewId);
  if (new Set(names).size !== names.length ||
      (options.requireSixDirections === true &&
       CARDINAL_VIEWS.some(v => !names.includes(v)))) {
    throw new Error('CODE_MODE_VISUAL_VIEW_SET_INVALID');
  }
  // Only the trusted operator can select the still PNGs. Every view uses
  // this SAME source-model SHA; no guest-provided paths or camera identity.
  const views=await Promise.all(choices.map(async selected => {
    const [reference,capture]=await Promise.all([
      pinnedVisualPng(selected.referencePngPath,'visualReference'),
      pinnedVisualPng(selected.capturePngPath,'visualCapture'),
    ]);
    return Object.freeze({reference,capture,viewId:selected.viewId});
  }));
  // The same PNG file cannot be relabeled as different camera directions.
  // Different files with equal pixels are still NOT camera provenance;
  // independent human/renderer evidence is required for that distinction.
  if (new Set(views.map(v=>v.reference.path)).size!==views.length ||
      new Set(views.map(v=>v.capture.path)).size!==views.length) {
    throw new Error('CODE_MODE_VISUAL_VIEW_SET_INVALID');
  }
  const [primary,...additionalViews]=views;
  return Object.freeze({
    ...primary,modelSha,
    additionalViews:Object.freeze(additionalViews),
    requireSixDirections:options.requireSixDirections===true,
  });
}
// Operator review is input from a trusted host callback, not model-written code.
// The callback may show *actual* images in a separately authorized reviewer UI;
// the Code Mode guest receives bounded findings, never image bytes or paths.
const REVIEW_DECISIONS = new Set(['ACCEPTED','REJECTED','UNVERIFIED']);
const REVIEW_ISSUES = new Set([
  'FLAT_SHADING','MISSING_DETAIL','STYLE_MISMATCH',
  'ALPHA_MISMATCH','UV_SEAM','SILHOUETTE','OTHER',
]);
const MAX_REVIEW_ISSUES = 6;
function normalizedVisualReview(input, viewIds = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key =>
        !['decision','issues','correctionScope','rejectedApproaches','rejectedTreatments','materialCohort','viewReviews','reviewedFaces'].includes(key)) ||
      !REVIEW_DECISIONS.has(input.decision) ||
      !Array.isArray(input.issues) || input.issues.length > MAX_REVIEW_ISSUES) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
  }
  const issues = input.issues.map(issue => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue) ||
        Object.keys(issue).some(key => !['id','kind','observation','partId'].includes(key)) ||
        typeof issue.id !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(issue.id) ||
        !REVIEW_ISSUES.has(issue.kind) ||
        typeof issue.observation !== 'string' ||
        (issue.partId !== undefined &&
          (typeof issue.partId !== 'string' ||
           !/^[a-z][a-z0-9_-]{0,63}$/.test(issue.partId))) ||
        issue.observation.trim() !== issue.observation ||
        issue.observation.length < 3 || issue.observation.length > 240 ||
        /[\x00-\x1f\x7f]/.test(issue.observation)) {
      throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    }
    return Object.freeze({
      id:issue.id,kind:issue.kind,observation:issue.observation,
      ...(issue.partId ? {partId:issue.partId} : {}),
    });
  });
  if (new Set(issues.map(issue => issue.id)).size !== issues.length) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
  }
  // For multi-view audits the reviewer must account for EVERY selected
  // actual PNG pair. A single-view user stays backward compatible.
  const supplied = input.viewReviews;
  if ((viewIds.length > 1 && !Array.isArray(supplied)) ||
      (supplied !== undefined &&
       (!Array.isArray(supplied) || supplied.length !== viewIds.length))) {
    throw new Error('CODE_MODE_VISUAL_VIEW_REVIEW_INVALID');
  }
  const viewReviews=(supplied ?? []).map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(key =>
          !['viewId','decision','observation'].includes(key)) ||
        !viewIds.includes(item.viewId) ||
        !REVIEW_DECISIONS.has(item.decision) ||
        typeof item.observation !== 'string' ||
        item.observation.trim() !== item.observation ||
        item.observation.length < 4 || item.observation.length > 240 ||
        /[\x00-\x1f\x7f]/.test(item.observation)) {
      throw new Error('CODE_MODE_VISUAL_VIEW_REVIEW_INVALID');
    }
    return Object.freeze({viewId:item.viewId,
      decision:item.decision,observation:item.observation});
  });
  if (new Set(viewReviews.map(item=>item.viewId)).size !== viewReviews.length ||
      viewIds.some(id=>viewReviews.length>0 &&
        !viewReviews.some(item=>item.viewId===id)) ||
      (viewReviews.length>0 && input.decision==='ACCEPTED' &&
        viewReviews.some(item=>item.decision!=='ACCEPTED')) ||
      (viewReviews.length>0 && input.decision==='REJECTED' &&
        !viewReviews.some(item=>item.decision==='REJECTED'))) {
    throw new Error('CODE_MODE_VISUAL_VIEW_REVIEW_INVALID');
  }
  const boundedViewReviews=Object.freeze(viewReviews);
  // Accepted art remains an external reviewer declaration. Explicit saved
  // Cube face identities stop a six-camera screenshot from substituting for
  // material-specific source/UV evidence. No guest can add these records.
  const suppliedFaces=input.reviewedFaces??[];
  if (!Array.isArray(suppliedFaces) || suppliedFaces.length>256 ||
      (input.decision!=='ACCEPTED' && suppliedFaces.length>0)) {
    throw new Error('CODE_MODE_REVIEWED_MATERIAL_FACES_INVALID');
  }
  const reviewedFaces=suppliedFaces.map(item=>{
    if (!item || typeof item!=='object' || Array.isArray(item) ||
        Object.keys(item).some(key=>![
          'cubeUuid','textureUuid','face','style','observation',
        ].includes(key)) ||
        !['north','east','south','west','up','down'].includes(item.face) ||
        !['STYLED','INTENTIONAL_FLAT','INTENTIONAL_TRANSPARENT'].includes(item.style) ||
        ![item.cubeUuid,item.textureUuid].every(id=>
          typeof id==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) ||
        typeof item.observation!=='string' ||
        item.observation.trim()!==item.observation ||
        item.observation.length<20 || item.observation.length>240 ||
        /[\x00-\x1f\x7f]/.test(item.observation)) {
      throw new Error('CODE_MODE_REVIEWED_MATERIAL_FACES_INVALID');
    }
    return Object.freeze({...item});
  });
  if (new Set(reviewedFaces.map(x=>x.cubeUuid+':'+x.face)).size!==
      reviewedFaces.length) {
    throw new Error('CODE_MODE_REVIEWED_MATERIAL_FACES_INVALID');
  }
  const boundedFaces=Object.freeze(reviewedFaces);
  if (input.decision === 'REJECTED') {
    if (issues.length === 0 || input.correctionScope === undefined) {
      throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    }
    let scope;
    try { scope = normalizedCorrectionScope(input.correctionScope); }
    catch { throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID'); }
    if (!scope) throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    const prior = input.rejectedApproaches ?? [];
    if (!Array.isArray(prior) || prior.length > 12) {
      throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    }
    const rejectedApproaches = prior.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          Object.keys(item).some(key => !['issueId','approachId'].includes(key)) ||
          typeof item.issueId !== 'string' ||
          typeof item.approachId !== 'string' ||
          !/^[a-z][a-z0-9_-]{0,63}$/.test(item.issueId) ||
          !/^[a-z][a-z0-9_-]{0,63}$/.test(item.approachId) ||
          !issues.some(issue => issue.id === item.issueId)) {
        throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
      }
      return Object.freeze({issueId:item.issueId,approachId:item.approachId});
    });
    if (new Set(rejectedApproaches.map(item =>
      item.issueId+':'+item.approachId)).size !== rejectedApproaches.length) {
      throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    }
    // Rejected material families are carried by the trusted reviewer from
    // existing Workspace continuity. Two failed causal treatments cannot be
    // retried merely by changing the model-authored approach ID.
    const historical=input.rejectedTreatments??[];
    if (!Array.isArray(historical) || historical.length>12) {
      throw new Error('CODE_MODE_REJECTED_TREATMENT_HISTORY_INVALID');
    }
    const rejectedTreatments=historical.map(entry=>{
      if (!entry || typeof entry!=='object' || Array.isArray(entry) ||
          Object.keys(entry).some(key=>![
            'partId','material','treatment','failedAttempts','observation',
          ].includes(key)) ||
          ![entry.partId,entry.material,entry.treatment].every(v=>
            typeof v==='string' && /^[a-z][a-z0-9_-]{0,63}$/.test(v)) ||
          !Number.isSafeInteger(entry.failedAttempts) ||
          entry.failedAttempts<2 || entry.failedAttempts>20 ||
          typeof entry.observation!=='string' ||
          entry.observation.length<20 || entry.observation.length>240 ||
          entry.observation.trim()!==entry.observation ||
          /[\x00-\x1f\x7f]/.test(entry.observation)) {
        throw new Error('CODE_MODE_REJECTED_TREATMENT_HISTORY_INVALID');
      }
      return Object.freeze({...entry});
    });
    if (new Set(rejectedTreatments.map(x=>
      x.partId+':'+x.material+':'+x.treatment)).size!==
      rejectedTreatments.length) {
      throw new Error('CODE_MODE_REJECTED_TREATMENT_HISTORY_INVALID');
    }
    const materialCohort = normalizedReviewedMaterialCohort(
      input.materialCohort,scope,issues);
    const normalized = Object.freeze({
      textureUuid:scope.texture_uuid,
      allowedRegions:Object.freeze(scope.allowed_regions.map(region=>
        Object.freeze({
          from:Object.freeze([...region.from]),
          to:Object.freeze([...region.to]),
        })
      )),
      preserveAlpha:scope.preserve_alpha,
      ...(scope.protected_regions?{
        protectedRegions:Object.freeze(scope.protected_regions.map(region=>
          Object.freeze({
            from:Object.freeze([...region.from]),
            to:Object.freeze([...region.to]),
          }))),
      }:{}),
      ...(scope.expected_before_pixels?{
        expectedBeforePixels:Object.freeze(scope.expected_before_pixels.map(pixel=>
          Object.freeze({
            at:Object.freeze([...pixel.at]),
            rgba:Object.freeze([...pixel.rgba]),
          }))),
      }:{}),
    });
    return Object.freeze({
      status:'RECORDED',decision:'REJECTED',
      issues:Object.freeze(issues),correctionScope:normalized,
      rejectedApproaches:Object.freeze(rejectedApproaches),
      rejectedTreatments:Object.freeze(rejectedTreatments),
      materialCohort,
      face_source_evidence:null,
      viewReviews:boundedViewReviews,
      reviewedFaces:Object.freeze([]),
      source:'TRUSTED_HOST_DECLARATION',
      visual_verdict:'UNVERIFIED',
    });
  }
  if (issues.length !== 0 || input.correctionScope !== undefined ||
      input.rejectedApproaches !== undefined ||
      input.rejectedTreatments !== undefined ||
      input.materialCohort !== undefined) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
  }
  return Object.freeze({
    status:'RECORDED',decision:input.decision,
    issues:Object.freeze([]),correctionScope:null,
    rejectedApproaches:Object.freeze([]),rejectedTreatments:Object.freeze([]),
    materialCohort:null,
    face_source_evidence:null,
    viewReviews:boundedViewReviews,reviewedFaces:boundedFaces,
    source:'TRUSTED_HOST_DECLARATION',visual_verdict:'UNVERIFIED',
  });
}
// One representative surface patch is an ATLAS location, not a reference
// image box or a claim about the rendered Cube face. Trusted review must
// select matching UV ownership before calling the model-wide Paint endpoint.
function normalizedReviewedMaterialCohort(value, correctionScope, issues) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => ![
        'phase','issueId','partId','approachId','sampleRegion','sampleVerdict',
        'cubeUuid','face',
      ].includes(key)) ||
      !['sample','propagation'].includes(value.phase) ||
      typeof value.issueId !== 'string' ||
      typeof value.partId !== 'string' ||
      typeof value.approachId !== 'string' ||
      typeof value.cubeUuid !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(value.cubeUuid) ||
      !['north','east','south','west','up','down'].includes(value.face) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(value.issueId) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(value.partId) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(value.approachId) ||
      !issues.some(issue => issue.id === value.issueId &&
        (!issue.partId || issue.partId === value.partId))) {
    throw new Error('CODE_MODE_MATERIAL_COHORT_INVALID');
  }
  let region;
  try {
    const checked = normalizedCorrectionScope({
      textureUuid:correctionScope.texture_uuid,
      allowedRegions:[value.sampleRegion],preserveAlpha:true,
    });
    region = checked.allowed_regions[0];
  } catch {
    throw new Error('CODE_MODE_MATERIAL_COHORT_INVALID');
  }
  const size=(region.to[0]-region.from[0])*
    (region.to[1]-region.from[1]);
  if (size > 1024 ||
      (value.phase === 'sample' && value.sampleVerdict !== undefined) ||
      (value.phase === 'propagation' && value.sampleVerdict !== 'ACCEPTED') ||
      (value.phase === 'sample' && !correctionScope.allowed_regions.some(r =>
        region.from[0]>=r.from[0] && region.from[1]>=r.from[1] &&
        region.to[0]<=r.to[0] && region.to[1]<=r.to[1]))) {
    throw new Error('CODE_MODE_MATERIAL_COHORT_INVALID');
  }
  return Object.freeze({
    phase:value.phase,issueId:value.issueId,partId:value.partId,
    approachId:value.approachId,
    cubeUuid:value.cubeUuid,face:value.face,
    sampleRegion:Object.freeze({
      from:Object.freeze([...region.from]),to:Object.freeze([...region.to]),
    }),
    sampleVerdict:value.phase === 'propagation' ?
      'ACCEPTED' : 'UNVERIFIED',
    approval_source:value.phase === 'propagation' ?
      'TRUSTED_REVIEWER_DECLARATION' : 'NONE',
    visual_verdict:'UNVERIFIED',
  });
}
function overlapsRectangle(a,b) {
  return a.from[0] < b.to[0] && a.to[0] > b.from[0] &&
    a.from[1] < b.to[1] && a.to[1] > b.from[1];
}

// The SDK validates the requested scope again and Rust enforces its actual
// changed pixels. The host additionally binds it to the reviewer's allowed
// texture and pixel region, rather than trusting a model-declared rectangle.
function correctionFitsReview(requested, reviewed) {
  if (requested.texture_uuid !== reviewed.textureUuid ||
      (reviewed.preserveAlpha && !requested.preserve_alpha)) return false;
  return requested.allowed_regions.every(region=>
    reviewed.allowedRegions.some(allowed=>
      region.from[0]>=allowed.from[0] &&
      region.from[1]>=allowed.from[1] &&
      region.to[0]<=allowed.to[0] &&
      region.to[1]<=allowed.to[1]
    )
  );
}
// The independent reviewer may impose protected landmarks/old-RGBA
// conditions INSIDE the selected allowed region. A model-authored scope can
// add stricter guards but cannot subtract or replace those reviewer facts.
// All constraints are passed to the same canonical Rust correction scope,
// which checks the actual source bitmap and changed pixels atomically.
function mergeReviewedPixelGuards(requested,reviewed) {
  const rectangles=new Map();
  for(const r of [
    ...(reviewed.protectedRegions??[]),
    ...(requested.protected_regions??[]),
  ]){
    rectangles.set(JSON.stringify([r.from,r.to]),{
      from:[...r.from],to:[...r.to],
    });
  }
  const beforePixels=new Map();
  for(const entry of [
    ...(reviewed.expectedBeforePixels??[]),
    ...(requested.expected_before_pixels??[]),
  ]){
    const key=entry.at.join(',');
    const prior=beforePixels.get(key);
    if(prior && prior.rgba.some((v,i)=>v!==entry.rgba[i])){
      throw new Error('CODE_MODE_REVIEWED_BEFORE_PIXEL_CONFLICT');
    }
    beforePixels.set(key,{at:[...entry.at],rgba:[...entry.rgba]});
  }
  // Re-run the shared strict admission before invoking any write or sending
  // an approval request. Unknown/overbudget guard combinations fail closed.
  const combined={
    textureUuid:requested.texture_uuid,
    allowedRegions:requested.allowed_regions.map(r=>({
      from:[...r.from],to:[...r.to],
    })),
    preserveAlpha:requested.preserve_alpha,
    ...(rectangles.size?{protectedRegions:[...rectangles.values()]}:{}),
    ...(beforePixels.size?{expectedBeforePixels:[...beforePixels.values()]}:{}),
  };
  try{normalizedCorrectionScope(combined);}
  catch{throw new Error('CODE_MODE_REVIEWED_PIXEL_GUARD_INVALID');}
  return combined;
}
// Reopen and SHA-check at the review boundary: startup metadata is insufficient
// if an image was replaced while the guest was doing other work.
async function pinnedReviewBytes(selected) {
  const current = await regularFile(selected.path,'CODE_MODE_VISUAL_REVIEW_INPUT');
  if (current !== selected.path) throw new Error('CODE_MODE_VISUAL_REVIEW_INPUT_STALE');
  const bytes = await readFile(current);
  if (bytes.length < 8 || bytes.length > MAX_VISUAL_PNG_BYTES ||
      createHash('sha256').update(bytes).digest('hex') !== selected.sha256) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INPUT_STALE');
  }
  return bytes;
}

function outputName(name, suffix) {
  if (typeof name !== 'string' || !name || name.length > 128 ||
      name !== basename(name) || name.trim() !== name ||
      /[/\\:<>"|?*\x00-\x1f]/.test(name) ||
      name.startsWith('.') || name.includes('..') ||
      !name.toLowerCase().endsWith(suffix) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('CODE_MODE_OUTPUT_NAME_INVALID');
  }
  return name;
}
async function checkFreshSibling(path, folder) {
  if (await realpath(dirname(path)) !== folder) {
    throw new Error('CODE_MODE_OUTPUT_OUTSIDE_PROJECT');
  }
  try {
    await lstat(path);
    throw new Error('CODE_MODE_OUTPUT_ALREADY_EXISTS');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

/**
 * Create a host bound to either one existing .bbmodel OR an empty trusted
 * outputDirectory for a New-model bootstrap. The runner and spawnImpl are
 * trusted unit-test seams, not inputs for generated code.
 *
 * Every output is a fresh same-directory filename. An independently trusted
 * authorizeMutation callback is required for all writes; without it the
 * underlying SDK refuses mutations. No model-written code is accepted here
 * as a callback, filesystem path, command or sandbox configuration.
 */
// The trusted external image reviewer needs source-owned face IDs, not
// model-invented names. This focused read is optional for hosts whose reviewer
// can bind faces independently, and never certifies camera correspondence.
async function sourceFacesForImageReviewer(model) {
  const faces=[];
  let cursor=0, pages=0, totalCubes=null;
  while(pages<32) {
    const receipt=await model.inspectBatch([{
      kind:'model_texture_coverage',offset:cursor,limit:8,attention_only:false,
    }]);
    const item=receipt.results?.[0]?.coverage;
    if(receipt.sha256!==model.expectedSha256 ||
       receipt.results?.[0]?.kind!=='model_texture_coverage' ||
       item?.scope!=='saved_face_texture_coverage_page' ||
       item.offset!==cursor ||
       !Number.isSafeInteger(item.total_cubes) ||
       (totalCubes!==null && totalCubes!==item.total_cubes) ||
       !Number.isSafeInteger(item.reviewed_cubes) ||
       item.reviewed_cubes!==Math.min(8,Math.max(0,item.total_cubes-cursor)) ||
       !Array.isArray(item.cubes) ||
       item.cubes.length!==item.reviewed_cubes) {
      throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_INVALID');
    }
    totalCubes=item.total_cubes;
    for(const cube of item.cubes) {
      if(typeof cube?.cube_uuid!=='string' ||
         !Array.isArray(cube.faces) || cube.faces.length!==6 ||
         new Set(cube.faces.map(f=>f.side)).size!==6) {
        throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_INVALID');
      }
      for(const face of cube.faces) {
        if(!['north','east','south','west','up','down'].includes(face.side) ||
           typeof face.status!=='string') {
          throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_INVALID');
        }
        if(face.status==='absent_declared')continue;
        faces.push(Object.freeze({
          cube_uuid:cube.cube_uuid,face:face.side,
          texture_uuid:face.texture_uuid??null,
          source_status:face.status,
        }));
      }
    }
    pages++;
    if(faces.length>256) {
      return Object.freeze({
        scope:'trusted_saved_cube_face_inventory',
        source_model_sha256:model.expectedSha256,
        total_cubes:totalCubes,complete:false,
        reason:'REVIEW_INVENTORY_FACE_LIMIT',
        faces:Object.freeze(faces.slice(0,256)),
      });
    }
    if(item.next_offset===null) {
      if(cursor+item.reviewed_cubes!==totalCubes){
        throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_CURSOR_INVALID');
      }
      return Object.freeze({
        scope:'trusted_saved_cube_face_inventory',
        source_model_sha256:model.expectedSha256,
        total_cubes:totalCubes,complete:true,
        faces:Object.freeze(faces),
      });
    }
    if(!Number.isSafeInteger(item.next_offset) ||
       item.next_offset!==cursor+item.reviewed_cubes ||
       item.next_offset>totalCubes) {
      throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_CURSOR_INVALID');
    }
    cursor=item.next_offset;
  }
  return Object.freeze({
    scope:'trusted_saved_cube_face_inventory',
    source_model_sha256:model.expectedSha256,
    total_cubes:totalCubes,complete:false,
    reason:'REVIEW_INVENTORY_PAGE_LIMIT',
    faces:Object.freeze(faces),
  });
}

export async function createCodeModeHost({
  rustBinary, denoBinary, input, outputDirectory, authorizeMutation,
  preselectedPngPath, approvedMaterialReferenceUuid,
  preselectedVisualPair, reviewVisualPair, runner, spawnImpl,
} = {}) {
  requireAbsolute(rustBinary, 'rustBinary');
  requireAbsolute(denoBinary, 'denoBinary');
  if ((input === undefined) === (outputDirectory === undefined)) {
    throw new Error('CODE_MODE_SOURCE_OR_OUTPUT_DIRECTORY_REQUIRED');
  }
  if (input !== undefined) requireAbsolute(input, 'input');
  if (outputDirectory !== undefined) {
    requireAbsolute(outputDirectory, 'outputDirectory');
  }
  if (runner !== undefined && typeof runner !== 'function') {
    throw new TypeError('runner must be a trusted host function');
  }
  if (spawnImpl !== undefined && typeof spawnImpl !== 'function') {
    throw new TypeError('spawnImpl must be a trusted host function');
  }
  if (authorizeMutation !== undefined &&
      typeof authorizeMutation !== 'function') {
    throw new TypeError('authorizeMutation must be a trusted host function');
  }
  if (reviewVisualPair !== undefined &&
      (typeof reviewVisualPair !== 'function' ||
       preselectedVisualPair === undefined)) {
    throw new TypeError('CODE_MODE_VISUAL_REVIEW_HOST_INVALID');
  }
  const source = input === undefined ? null :
    await regularFile(input, 'CODE_MODE_SOURCE');
  if (source !== null && !source.toLowerCase().endsWith('.bbmodel')) {
    throw new Error('CODE_MODE_SOURCE_EXTENSION_INVALID');
  }
  let folder;
  if (source === null) {
    const dir = await lstat(outputDirectory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) {
      throw new Error('CODE_MODE_OUTPUT_DIRECTORY_INVALID');
    }
    folder = await realpath(outputDirectory);
  } else {
    folder = await realpath(dirname(source));
  }
  if (!runner) await regularFile(rustBinary, 'CODE_MODE_RUST_BINARY');
  if (!spawnImpl) {
    await regularFile(denoBinary, 'CODE_MODE_DENO_BINARY');
    await regularFile(WORKER, 'CODE_MODE_SANDBOX_ENTRY');
  }
  const png = preselectedPngPath === undefined ? undefined :
    await regularFile(requireAbsolute(preselectedPngPath, 'preselectedPngPath'),
      'CODE_MODE_PNG_INPUT');
  // Selected by the operator at host setup, never by model-authored JS.
  // A name/UUID alone is not a human visual approval receipt.
  if (approvedMaterialReferenceUuid !== undefined &&
      (typeof approvedMaterialReferenceUuid !== 'string' ||
       !approvedMaterialReferenceUuid ||
       approvedMaterialReferenceUuid.length > 128 ||
       /\s|[\x00-\x1f]/.test(approvedMaterialReferenceUuid))) {
    throw new Error('CODE_MODE_MATERIAL_REFERENCE_INVALID');
  }
  const referenceMaster = approvedMaterialReferenceUuid ?? null;

  // Only one code session may be active per host. Operator approval is
  // invalidated when that session exits or times out.
  let activeExecution = null;
  // Every approval descriptor is linked to the exact guest that received it.
  // This prevents an old approval from being consumed by a later guest when
  // Rust plan-file creation yields to the event loop before CLI launch.
  const approvedGuest = new WeakMap();
  const client = createRustCodeModeClient({
    binary: rustBinary,
    ...(runner ? { runner } : {}),
    authorizeMutation: async (request) => {
      const execution = activeExecution;
      if (!execution || execution.closed ||
          typeof request.output !== 'string') return false;
      try { await checkFreshSibling(request.output, folder); }
      catch { return false; }
      if (typeof authorizeMutation !== 'function' ||
          execution.closed || activeExecution !== execution) return false;
      execution.pause();
      let approved;
      try {
        approved = await authorizeMutation(Object.freeze({ ...request }));
      } finally {
        execution.resume();
      }
      // Prevent a delayed approval from reviving a timed-out guest.
      const valid = approved === true &&
        !execution.closed && activeExecution === execution;
      if (valid) approvedGuest.set(request, execution);
      return valid;
    },
    // Synchronous last lease check, directly before the SDK launches Rust.
    // No async work may occur between this check and the execFile request.
    permitWriteLaunch: (request) => {
      const owner = approvedGuest.get(request);
      approvedGuest.delete(request);
      return owner !== undefined && owner === activeExecution && !owner.closed;
    },
  });
  const projects = new Map();
  const initialProject = source === null ? null :
    await openRustCodeModeProject(client, source);
  if (initialProject) projects.set('p0', initialProject);
  let nextProject = initialProject ? 1 : 0;
  const visualPair = await pinnedVisualPair(
    source, preselectedVisualPair, initialProject?.expectedSha256 ?? null);
  const visualViews=Object.freeze(visualPair===null?[]:[
    visualPair,...visualPair.additionalViews,
  ]);
  // One ephemeral review state per exact model SHA, not a second asset store.
  const visualPreflights = new Map();
  // One coherent reviewed correction per source revision. Do not create
  // multiple variants from a stale, already-rejected capture.
  const completedReviewedCorrections = new Set();
  const initialRef = Object.freeze(initialProject ? {
    project: 'p0', sha256: initialProject.expectedSha256,
    summary: initialProject.summary,
  } : { project: null, sha256: null, summary: null });

  function selected(args) {
    const id = requireObject(args).project;
    if (typeof id !== 'string' || !projects.has(id)) {
      throw new Error('CODE_MODE_PROJECT_HANDLE_UNKNOWN');
    }
    return projects.get(id);
  }
  async function outputPath(name, suffix) {
    const path = join(folder, outputName(name, suffix));
    await checkFreshSibling(path, folder);
    return path;
  }
  async function register(path) {
    if (projects.size >= MAX_PROJECTS) {
      throw new Error('CODE_MODE_PROJECT_LIMIT_REACHED');
    }
    const project = await openRustCodeModeProject(client, path);
    const handle = 'p' + nextProject++;
    projects.set(handle, project);
    return { project: handle, sha256: project.expectedSha256,
      summary: project.summary };
  }
  // The fixed capability boundary is intentionally much smaller than shell,
  // filesystem or generic Rust CLI access. Only owned methods are dispatched.
  const actions = Object.freeze({
    projectInfo: async (args) => {
      const p = selected(args);
      return { project: args.project, sha256: p.expectedSha256,
        summary: p.summary };
    },
    inspect: async (args) => selected(args).inspect(args.uuid),
    catalog: async (args) => selected(args).catalog(args.kind, {
      offset: args.offset, limit: args.limit,
    }),
    inspectBatch: async (args) => {
      // Generic guest reads must never masquerade as the operator-selected
      // approved master. The trust-bound method below injects that identity.
      if (Array.isArray(args.requests) &&
          args.requests.some(query => query?.kind === 'material_pair')) {
        throw new Error('CODE_MODE_MATERIAL_REFERENCE_HOST_ONLY');
      }
      return selected(args).inspectBatch(args.requests);
    },
    inspectApprovedMaterial: async (args) => {
      const model = selected(args);
      if (referenceMaster === null) {
        throw new Error('CODE_MODE_MATERIAL_REFERENCE_UNBOUND');
      }
      const receipt = await model.inspectBatch([{
        kind:'material_pair',
        reference_uuid:referenceMaster,
        candidate_uuid:args.candidateTextureUuid,
        reference_region:args.referenceRegion,
        candidate_region:args.candidateRegion,
      }]);
      const measured = receipt.results?.[0]?.comparison;
      if (receipt.sha256 !== model.expectedSha256 ||
          measured?.reference_texture_uuid !== referenceMaster ||
          measured?.candidate_texture_uuid !== args.candidateTextureUuid ||
          measured?.scope !== 'saved_rgba8_material_patch_pair' ||
          measured?.source_state !== 'measured' ||
          measured?.visual_verdict !== 'UNVERIFIED') {
        throw new Error('CODE_MODE_MATERIAL_REFERENCE_RESULT_INVALID');
      }
      return {
        ...receipt,
        reference_binding:{
          kind:'operator_selected_model_texture',
          reference_texture_uuid:referenceMaster,
          source_model_sha256:model.expectedSha256,
          visual_verdict:'UNVERIFIED',
        },
      };
    },
    inspectSelectedVisualPair: async (args) => {
      const model = selected(args);
      if (Object.keys(args).some(key => key !== 'project')) {
        throw new Error('CODE_MODE_VISUAL_PAIR_ARGUMENT_UNSUPPORTED');
      }
      if (visualPair === null) {
        throw new Error('CODE_MODE_VISUAL_PAIR_UNBOUND');
      }
      if (model.expectedSha256 !== visualPair.modelSha) {
        throw new Error('CODE_MODE_VISUAL_CAPTURE_MODEL_STALE');
      }
      const measured=await Promise.all(visualViews.map(selected=>
        client.inspectVisualPair({
          input:model.input,expectedSha256:model.expectedSha256,
          referencePng:selected.reference.path,
          capturePng:selected.capture.path,
          referenceSha256:selected.reference.sha256,
          captureSha256:selected.capture.sha256,
        })
      ));
      for (let i=0;i<visualViews.length;i++){
        const evidence=measured[i], selected=visualViews[i];
        if(evidence?.source_model_sha256!==model.expectedSha256 ||
           evidence.reference_png_sha256!==selected.reference.sha256 ||
           evidence.capture_png_sha256!==selected.capture.sha256 ||
           evidence.comparison?.scope!=='operator_selected_saved_png_pair' ||
           evidence.comparison?.visual_verdict!=='UNVERIFIED' ||
           evidence.comparison?.reference_png_sha256!==selected.reference.sha256 ||
           evidence.comparison?.capture_png_sha256!==selected.capture.sha256) {
          throw new Error('CODE_MODE_VISUAL_PAIR_RESULT_INVALID');
        }
      }
      const evidence=measured[0];
      const view_evidence=Object.freeze(visualViews.map((view,index)=>Object.freeze({
        view_id:view.viewId,
        reference_png_sha256:view.reference.sha256,
        capture_png_sha256:view.capture.sha256,
        source_model_sha256:model.expectedSha256,
        visual_verdict:'UNVERIFIED',
        silhouette_status:measured[index].comparison?.silhouette?.status ?? 'UNVERIFIED',
      })));
      // Freeze the first reviewer decision for one source SHA/view. The
      // guest must not downgrade ACCEPTED with a repeated review request.
      const prior = visualPreflights.get(model.expectedSha256);
      let feedback = prior ?? Object.freeze({
        status:'NOT_RECORDED',decision:'UNVERIFIED',
        issues:Object.freeze([]),correctionScope:null,
        rejectedApproaches:Object.freeze([]),rejectedTreatments:Object.freeze([]),
        materialCohort:null,face_source_evidence:null,viewReviews:Object.freeze([]),
        reviewedFaces:Object.freeze([]),
        source:'NONE',visual_verdict:'UNVERIFIED',
      });
      if (typeof reviewVisualPair === 'function' && prior === undefined) {
        const execution = activeExecution;
        if (!execution || execution.closed) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        const selectedBytes=await Promise.all(visualViews.map(async selected=>{
          const [referenceBytes,captureBytes]=await Promise.all([
            pinnedReviewBytes(selected.reference),
            pinnedReviewBytes(selected.capture),
          ]);
          return {referenceBytes,captureBytes,viewId:selected.viewId,
            referenceSha:selected.reference.sha256,
            captureSha:selected.capture.sha256};
        }));
        const primaryBytes=selectedBytes[0];
        if (execution.closed || activeExecution !== execution) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        // Reviewer-visible identifiers come from the actual Rust source,
        // never from guest-authored JSON. Optional for existing callbacks.
        const faceInventory=reviewVisualPair.requiresSourceFaceInventory===true ?
          await sourceFacesForImageReviewer(model):null;
        // The host callback must present both actual buffers to its reviewer;
        // a text/SHAs-only response has no authority to claim the AI saw images.
        execution.pause();
        let returned;
        try {
          returned = await reviewVisualPair(Object.freeze({
            sourceModelSha256:model.expectedSha256,
            viewId:visualPair.viewId,
            reference:Object.freeze({
              sha256:primaryBytes.referenceSha,
              pngBytes:Buffer.from(primaryBytes.referenceBytes),
            }),
            capture:Object.freeze({
              sha256:primaryBytes.captureSha,
              pngBytes:Buffer.from(primaryBytes.captureBytes),
            }),
            supportingViews:Object.freeze(selectedBytes.slice(1).map(view=>
              Object.freeze({
                viewId:view.viewId,
                reference:Object.freeze({sha256:view.referenceSha,
                  pngBytes:Buffer.from(view.referenceBytes)}),
                capture:Object.freeze({sha256:view.captureSha,
                  pngBytes:Buffer.from(view.captureBytes)}),
              }))),
            requiredSixDirections:visualPair.requireSixDirections,
            sourceFaceInventory:faceInventory,
          }));
        } finally { execution.resume(); }
        if (execution.closed || activeExecution !== execution) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        feedback = normalizedVisualReview(returned,
          visualViews.map(view=>view.viewId));
        if (feedback.materialCohort) {
          const cohort=feedback.materialCohort;
          // Re-read the *actual* model through one pinned Rust inspection
          // batch. Reviewer/guest part names cannot independently prove UV
          // ownership, nor can an atlas rectangle define a rendered face.
          const faces=await model.inspectBatch([
            {kind:'material_face_patch',
              texture_uuid:feedback.correctionScope.textureUuid,
              cube_uuid:cohort.cubeUuid,face:cohort.face,
              region:cohort.sampleRegion},
            {kind:'cube_face_alpha',uuid:cohort.cubeUuid},
          ]);
          const binding=faces.results?.[0]?.binding;
          const six=faces.results?.[1]?.face_alpha;
          const matches=(x,y)=>Array.isArray(x)&&Array.isArray(y) &&
            x.length===2&&y.length===2&&x.every((n,i)=>n===y[i]);
          if (faces.sha256!==model.expectedSha256 ||
              faces.results?.[0]?.kind!=='material_face_patch' ||
              binding?.scope!=='source_explicit_cube_face_patch' ||
              binding?.status!=='bound_source_only' ||
              binding?.visual_verdict!=='UNVERIFIED' ||
              binding?.face_coverage_verdict!=='UNVERIFIED' ||
              binding?.view_correspondence!=='NOT_VERIFIED' ||
              binding?.texture_reference!=='explicit_saved_link' ||
              binding?.pixel_alias!=='no_detected_overlap_for_sample' ||
              binding?.texture_uuid!==feedback.correctionScope.textureUuid ||
              binding?.cube_uuid!==cohort.cubeUuid ||
              binding?.face!==cohort.face ||
              !matches(binding?.sample_region?.from,cohort.sampleRegion.from) ||
              !matches(binding?.sample_region?.to,cohort.sampleRegion.to) ||
              faces.results?.[1]?.kind!=='cube_face_alpha' ||
              six?.cube_uuid!==cohort.cubeUuid ||
              six?.visual_verdict!=='UNVERIFIED' ||
              six?.face_coverage_verdict!=='UNVERIFIED' ||
              six?.face_count!==6 || !Array.isArray(six?.faces) ||
              six.faces.length!==6 ||
              new Set(six.faces.map(item=>item.side)).size!==6 ||
              six.faces.some(item=>![
                'north','east','south','west','up','down',
              ].includes(item.side) || ![
                'measured','unsupported',
              ].includes(item.alpha?.status))) {
            throw new Error('CODE_MODE_MATERIAL_FACE_BINDING_UNVERIFIED');
          }
          // The exact target face must be backed by a readable source
          // bitmap region, rather than a missing/implicit/unsupported
          // texture link. This does not judge its artistic quality.
          const selectedFace=six.faces.find(face=>face.side===cohort.face);
          if (selectedFace?.texture_uuid!==feedback.correctionScope.textureUuid ||
              selectedFace?.alpha?.status!=='measured') {
            throw new Error('CODE_MODE_MATERIAL_FACE_ALPHA_UNVERIFIED');
          }
          feedback=Object.freeze({
            ...feedback,
            materialCohort:Object.freeze({
              ...cohort,
              faceBinding:Object.freeze(binding),
              source_model_sha256:model.expectedSha256,
              reference_png_sha256:visualPair.reference.sha256,
              capture_png_sha256:visualPair.capture.sha256,
              view_id:visualPair.viewId,
            }),
            face_source_evidence:Object.freeze({
              status:'six_saved_faces_inspected',
              cube_uuid:cohort.cubeUuid,
              face_count:6,
              visual_verdict:'UNVERIFIED',
              face_coverage_verdict:'UNVERIFIED',
              faces:Object.freeze(six.faces.map(item=>Object.freeze({
                side:item.side,
                reference_kind:item.saved_reference_kind,
                texture_uuid:item.texture_uuid,
                alpha_status:item.alpha.status,
                // No PNG bytes and no false source/visual PASS.
                transparent_pixels:item.alpha.status==='measured' ?
                  item.alpha.region?.transparent_pixels ?? null : null,
              }))),
            }),
          });
        }
      }
      if (prior === undefined) visualPreflights.set(model.expectedSha256,feedback);
      return {
        ...evidence,
        view_evidence,
        view_scope:visualPair.requireSixDirections ?
          'six_cardinal_source_pairs_selected' : 'selected_source_pairs_only',
        review_feedback:feedback,
        evidence_binding:{
          kind:'operator_selected_visual_pair',
          view_id:visualPair.viewId,
          source_model_sha256:visualPair.modelSha,
          reference_png_sha256:visualPair.reference.sha256,
          capture_png_sha256:visualPair.capture.sha256,
          visual_verdict:'UNVERIFIED',
          image_ingestion:'NOT_VERIFIED',
        },
      };
    },
    // Read-only terminal checkpoint. An accepted pixel transaction or empty
    // histogram is NEVER evidence that professional pixel-art Texturing ended.
    // This is a trusted-host source/view ledger, not a renderer, new approval
    // database, or guest-driven artistic PASS.
    texturingReadiness: async (args) => {
      const p=selected(args);
      if (Object.keys(args).some(key=>key!=='project')) {
        throw new Error('CODE_MODE_TEXTURING_READINESS_ARGUMENT_INVALID');
      }
      const blocked=[];
      if (visualPair===null || p.expectedSha256!==visualPair.modelSha) {
        blocked.push('CURRENT_REVISION_RENDERED_VIEW_SET_MISSING');
      }
      if (typeof reviewVisualPair!=='function') {
        blocked.push('INDEPENDENT_IMAGE_REVIEW_NOT_CONNECTED');
      }
      const feedback=visualPreflights.get(p.expectedSha256);
      if (!feedback || feedback.decision!=='ACCEPTED') {
        blocked.push('CURRENT_REVISION_NOT_ACCEPTED_BY_REVIEWER');
      }
      if (visualPair===null || !visualPair.requireSixDirections ||
          CARDINAL_VIEWS.some(name=>
            !visualViews.some(view=>view.viewId===name)) ||
          feedback?.viewReviews.length!==visualViews.length ||
          feedback?.viewReviews.some(view=>view.decision!=='ACCEPTED')) {
        blocked.push('SIX_DIRECTION_REVIEW_INCOMPLETE');
      }
      const base={
        scope:'saved_model_texture_workflow_review',
        source_model_sha256:p.expectedSha256,
        reviewer_declaration:feedback?.decision ?? 'UNVERIFIED',
        view_count:visualViews.length,
        visual_verdict:'UNVERIFIED',
        texture_completion_attested:false,
      };
      if (!Array.isArray(feedback?.reviewedFaces) ||
          feedback.reviewedFaces.length===0) {
        blocked.push('MATERIAL_FACE_REVIEW_SCOPE_MISSING');
      }
      if (blocked.length) return {...base,status:'BLOCKED',
        blockers:blocked,face_scan:null,material_faces:null,
        next:'Obtain actual approved/current matched views, reviewer-selected Cube faces and independent review.'};
      // Recheck image bytes AFTER review and BEFORE this read-only decision.
      // A renamed/replaced file cannot inherit accepted view evidence.
      await Promise.all(visualViews.flatMap(view=>[
        pinnedReviewBytes(view.reference),pinnedReviewBytes(view.capture),
      ]));
      let cursor=0, pages=0, totalCubes=null, inspectedCubes=0;
      let sourceCandidates=0, unresolvedFaces=0;
      // The full native six-face inventory, not a shortlist chosen by
      // the guest/reviewer and not just alpha warnings, defines coverage.
      const requiredFaces=new Map();
      const attentionFaces=new Map();
      let scanError=null;
      while (pages<32) {
        let receipt;
        try {
          receipt=await p.inspectBatch([{kind:'model_texture_coverage',
            offset:cursor,limit:8,attention_only:false}]);
        }catch{
          scanError='SOURCE_FACE_SCAN_UNAVAILABLE'; break;
        }
        const coverage=receipt.results?.[0]?.coverage;
        if (receipt.sha256!==p.expectedSha256 ||
            coverage?.scope!=='saved_face_texture_coverage_page' ||
            coverage.offset!==cursor ||
            !Number.isSafeInteger(coverage.total_cubes) ||
            coverage.total_cubes<0 ||
            (totalCubes!==null && totalCubes!==coverage.total_cubes) ||
            !Number.isSafeInteger(coverage.reviewed_cubes) ||
            coverage.reviewed_cubes!==Math.min(8,Math.max(0,
              coverage.total_cubes-cursor)) ||
            !Number.isSafeInteger(coverage.review_candidates) ||
            coverage.review_candidates<0 ||
            !Number.isSafeInteger(coverage.unresolved_reference_or_mapping_faces) ||
            coverage.unresolved_reference_or_mapping_faces<0 ||
            !Array.isArray(coverage.cubes)) {
          scanError='SOURCE_FACE_SCAN_RESULT_INVALID';break;
        }
        if (coverage.cubes.length!==coverage.reviewed_cubes) {
          scanError='SOURCE_FACE_SCAN_CUBE_COUNT_INVALID';break;
        }
        const pageRequired=new Map(),pageAttention=new Map();
        for (const cube of coverage.cubes) {
          if (typeof cube?.cube_uuid!=='string' ||
              !Array.isArray(cube.faces) || cube.faces.length!==6 ||
              new Set(cube.faces.map(face=>face.side)).size!==6) {
            scanError='SOURCE_FACE_SCAN_RESULT_INVALID';break;
          }
          let cubeAttention=0;
          for (const face of cube.faces) {
            const validStatus=[
              'absent_declared','no_explicit_texture',
              'implicit_texture_unresolved','mapping_unsupported',
              'fully_transparent_pixels','partially_transparent_pixels',
              'translucent_pixels','measured_nontransparent_pixels',
            ];
            if (!['north','east','south','west','up','down'].includes(face?.side) ||
                !validStatus.includes(face.status)) {
              scanError='SOURCE_FACE_SCAN_RESULT_INVALID';break;
            }
            const key=JSON.stringify([cube.cube_uuid,face.side]);
            if (pageRequired.has(key) || requiredFaces.has(key)) {
              scanError='SOURCE_FACE_SCAN_DUPLICATE_FACE';break;
            }
            const entry={status:face.status,textureUuid:face.texture_uuid??null};
            // This is an explicit no-texture face, not a missing stylistic
            // treatment; all other face slots require review/accounting.
            if (face.status!=='absent_declared') {
              pageRequired.set(key,entry);
              if (face.status!=='measured_nontransparent_pixels') {
                pageAttention.set(key,entry);
                cubeAttention++;
              }
            } else {
              // Retain the key to detect duplicate face source identities.
              pageRequired.set(key,null);
            }
          }
          if (scanError)break;
          if (cube.review_candidates!==cubeAttention) {
            scanError='SOURCE_FACE_SCAN_COUNT_MISMATCH';break;
          }
        }
        if (scanError)break;
        if (pageAttention.size!==coverage.review_candidates) {
          scanError='SOURCE_FACE_SCAN_COUNT_MISMATCH';break;
        }
        for (const [key,entry] of pageRequired)requiredFaces.set(key,entry);
        for (const [key,entry] of pageAttention)attentionFaces.set(key,entry);
        totalCubes=coverage.total_cubes;
        inspectedCubes+=coverage.reviewed_cubes;
        sourceCandidates+=coverage.review_candidates;
        unresolvedFaces+=coverage.unresolved_reference_or_mapping_faces;
        pages++;
        if(coverage.next_offset===null){
          if(cursor+coverage.reviewed_cubes!==totalCubes) {
            scanError='SOURCE_FACE_SCAN_CURSOR_INVALID';break;
          }
          cursor=null;break;
        }
        if(!Number.isSafeInteger(coverage.next_offset) ||
           coverage.next_offset!==cursor+coverage.reviewed_cubes ||
           coverage.next_offset>totalCubes) {
          scanError='SOURCE_FACE_SCAN_CURSOR_INVALID';break;
        }
        cursor=coverage.next_offset;
      }
      if (scanError) blocked.push(scanError);
      if (cursor!==null) blocked.push('SOURCE_FACE_SCAN_INCOMPLETE');
      if (totalCubes===0) blocked.push('NO_MODEL_SURFACES');
      if (unresolvedFaces>0) blocked.push('SOURCE_FACE_REFERENCES_NEED_REVIEW');
      const reviewerFaces=new Map(feedback.reviewedFaces.map(item=>[
        JSON.stringify([item.cubeUuid,item.face]),item,
      ]));
      let requiredUnreviewed=0, attentionUnreviewed=0;
      for (const [key,source] of requiredFaces) {
        if (source===null)continue;
        const reviewed=reviewerFaces.get(key);
        const acknowledged=!!reviewed &&
          source.textureUuid!==null &&
          source.textureUuid===reviewed.textureUuid &&
          (source.status!=='fully_transparent_pixels' ||
           reviewed.style==='INTENTIONAL_TRANSPARENT');
        if (!acknowledged) {
          requiredUnreviewed++;
          if (attentionFaces.has(key))attentionUnreviewed++;
        }
      }
      if (sourceCandidates!==attentionFaces.size) {
        blocked.push('SOURCE_FACE_SCAN_COUNT_MISMATCH');
      }
      if (requiredUnreviewed>0) {
        blocked.push('REQUIRED_SOURCE_FACES_UNREVIEWED');
      }
      if (attentionUnreviewed>0) {
        blocked.push('SOURCE_ATTENTION_FACES_UNREVIEWED');
      }
      if (feedback.reviewedFaces.some(item=>
        !requiredFaces.get(JSON.stringify([item.cubeUuid,item.face])) ||
        requiredFaces.get(JSON.stringify([item.cubeUuid,item.face]))
          .textureUuid!==item.textureUuid)) {
        blocked.push('REVIEWER_FACE_NOT_BOUND_TO_REQUIRED_SOURCE');
      }
      let inspectedFaces=0, flatExceptions=0, transparentExceptions=0, styleWarnings=0;
      // The reviewer selected these actual Cube face/material identities;
      // the model-written guest cannot cherry-pick only non-flat faces.
      // A uniform saved face cannot be declared STYLED without an explicit,
      // observed INTENTIONAL_FLAT exception. Statistical non-warnings are
      // likewise not visual PASS.
      const reviewFaces=feedback.reviewedFaces;
      for (let start=0;start<reviewFaces.length;start+=8) {
        const group=reviewFaces.slice(start,start+8);
        let measured;
        try {
          measured=await p.inspectBatch(group.map(item=>({
            kind:'texture_styling_face',texture_uuid:item.textureUuid,
            cube_uuid:item.cubeUuid,face:item.face,
          })));
        }catch{
          blocked.push('REVIEWED_FACE_SOURCE_INSPECTION_UNAVAILABLE');break;
        }
        if (measured.sha256!==p.expectedSha256 ||
            measured.results?.length!==group.length) {
          blocked.push('REVIEWED_FACE_SOURCE_INSPECTION_INVALID');break;
        }
        for (let i=0;i<group.length;i++) {
          const selected=group[i];
          const evidence=measured.results[i]?.styling;
          if (measured.results[i]?.kind!=='texture_styling_face' ||
              evidence?.scope!=='saved_cube_face_local_pixels' ||
              evidence.cube_uuid!==selected.cubeUuid ||
              evidence.texture_uuid!==selected.textureUuid ||
              evidence.face!==selected.face ||
              evidence.visual_verdict!=='UNVERIFIED' ||
              evidence.texture_completion_attested!==false ||
              !['BASE_ONLY_CANDIDATE','REVIEW_REQUIRED','NOT_EVALUATED']
                .includes(evidence.status)) {
            blocked.push('REVIEWED_FACE_SOURCE_INSPECTION_INVALID');break;
          }
          inspectedFaces++;
          if (evidence.reason!==undefined ||
              !Number.isSafeInteger(evidence.visible_pixels)) {
            blocked.push('REVIEWED_FACE_SOURCE_NOT_EVALUATED');
          } else if (evidence.visible_pixels===0 &&
                     selected.style!=='INTENTIONAL_TRANSPARENT') {
            blocked.push('INVISIBLE_FACE_CANNOT_CLAIM_STYLED');
          } else if (evidence.visible_pixels>0 &&
                     selected.style==='INTENTIONAL_TRANSPARENT') {
            blocked.push('VISIBLE_FACE_CANNOT_CLAIM_TRANSPARENT');
          } else if (evidence.status==='BASE_ONLY_CANDIDATE' &&
                     selected.style==='STYLED') {
            blocked.push('UNIFORM_FACE_CANNOT_CLAIM_STYLED');
          }
          if (selected.style==='INTENTIONAL_FLAT') flatExceptions++;
          if (selected.style==='INTENTIONAL_TRANSPARENT') transparentExceptions++;
          if (evidence.status==='REVIEW_REQUIRED') styleWarnings++;
        }
        if (blocked.some(code=>code.startsWith('REVIEWED_FACE_')))break;
      }
      return {...base,
        status:blocked.length?'BLOCKED':'REVIEWER_DECLARED_READY_FOR_USER_DECISION',
        blockers:blocked,
        face_scan:{scanned_cubes:inspectedCubes,total_cubes:totalCubes,
          source_review_candidates:sourceCandidates,
          required_source_faces:[...requiredFaces.values()].filter(Boolean).length,
          required_source_faces_reviewed:[...requiredFaces.values()].filter(Boolean).length-requiredUnreviewed,
          required_source_faces_unreviewed:requiredUnreviewed,
          source_attention_faces_reviewed:attentionFaces.size-attentionUnreviewed,
          source_attention_faces_unreviewed:attentionUnreviewed,
          unresolved_source_faces:unresolvedFaces,
          complete:cursor===null && !scanError},
        material_faces:{scope:'reviewer_selected_cube_faces_only',
          expected:reviewFaces.length,inspected:inspectedFaces,
          intentional_flat_exceptions:flatExceptions,
          intentional_transparent_exceptions:transparentExceptions,
          styling_warning_candidates:styleWarnings},
        next:blocked.length?
          'Resolve named source/review gaps, keeping intentional transparency and hidden faces explicit.':
          'Only user or authorized native visual acceptance can declare final artistic completion.',
      };
    },
    inspectCubeSurfaces: async (args) => selected(args).inspectCubeSurfaces(args.uuid),
    inspectCubeFaceAlpha: async (args) => selected(args).inspectCubeFaceAlpha(args.uuid),
    inspectTexture: async (args) => selected(args).inspectTexture(args.index),
    inspectTextureAlpha: async (args) => selected(args).inspectTextureAlpha(args.uuid),
    inspectAnimation: async (args) => selected(args).inspectAnimation(args.uuid),
    inspectAnimationTrack: async (args) => selected(args).inspectAnimationTrack(
      args.animationUuid, args.boneUuid, {
        offset: args.offset, limit: args.limit,
      }),
    inspectAnimationTransformTrack: async (args) =>
      selected(args).inspectAnimationTransformTrack(
        args.animationUuid, args.boneUuid, args.channel, {
          offset: args.offset, limit: args.limit,
        }),
    audit: async (args) => selected(args).audit(),
    newModel: async (args) => {
      requireObject(args);
      const output = await outputPath(args.output, '.bbmodel');
      const receipt = await client.newModel({
        output, name: args.name, modelIdentifier: args.modelIdentifier,
      });
      return { receipt, ...await register(output) };
    },
    apply: async (args) => {
      const p = selected(args);
      // The guest may propose a bounded artistic plan, but a work packet
      // outside a trusted material-review session is not approval evidence.
      if(args.materialWorkPacket!==undefined && (visualPair===null ||
          typeof reviewVisualPair!=='function')) {
        throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_REVIEW_REQUIRED');
      }
      const reviewedTextureSession = visualPair !== null &&
        typeof reviewVisualPair === 'function';
      // Only inside an independently reviewed material session, a FORM
      // packet may be compiled into the existing Rust guarded face paint.
      // Guest-supplied operations are not authoritative for this path.
      let activeOperations=args.operations;
      if(args.materialWorkPacket!==undefined) {
        let proposed;
        try {
          proposed=normalizedMaterialWorkPacket(args.materialWorkPacket);
        } catch {
          throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_INVALID');
        }
        if(proposed?.shadingIntent==='FORM_SHADING') {
          if(args.operations!==undefined) {
            throw new Error('CODE_MODE_MATERIAL_CLUSTER_HOST_OWNED');
          }
          activeOperations=compileMaterialClusterPaint(proposed);
        }
      }
      // When an operator binds a reviewed texture correction, an unrelated
      // structural/import operation must not bypass the sample scope by
      // making the existing pixelEdit predicate false.
      if (reviewedTextureSession && (!Array.isArray(activeOperations) ||
          activeOperations.some(op => !PIXEL_MUTATIONS.has(op?.op)))) {
        throw new Error('CODE_MODE_REVIEWED_CORRECTION_PAINT_ONLY');
      }
      const pixelEdit = Array.isArray(activeOperations) &&
        activeOperations.some(op => PIXEL_MUTATIONS.has(op?.op));
      if (referenceMaster !== null || visualPair !== null) {
        if (pixelEdit && args.correctionScope === undefined) {
          throw new Error('CODE_MODE_MATERIAL_CORRECTION_SCOPE_REQUIRED');
        }
        if (referenceMaster !== null &&
            args.correctionScope?.textureUuid === referenceMaster) {
          throw new Error('CODE_MODE_MATERIAL_MASTER_PROTECTED');
        }
      }
      if (visualPair !== null && pixelEdit &&
          !visualPreflights.has(p.expectedSha256)) {
        // The numeric image preflight alone does not certify art quality.
        throw new Error('CODE_MODE_VISUAL_PREFLIGHT_REQUIRED');
      }
      let materialIntent,workPacket;
      let effectiveCorrectionScope=args.correctionScope;
      if (visualPair !== null && pixelEdit &&
          typeof reviewVisualPair === 'function') {
        if (completedReviewedCorrections.has(p.expectedSha256)) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_FRESH_CAPTURE_REQUIRED');
        }
        const feedback = visualPreflights.get(p.expectedSha256);
        if (feedback?.decision === 'ACCEPTED') {
          throw new Error('CODE_MODE_VISUAL_REVIEW_ACCEPTED_PROTECTED');
        }
        if (feedback?.decision !== 'REJECTED') {
          throw new Error('CODE_MODE_VISUAL_REVIEW_REQUIRED');
        }
        let requested;
        try { requested = normalizedCorrectionScope(args.correctionScope); }
        catch { throw new Error('CODE_MODE_VISUAL_REVIEW_SCOPE_MISMATCH'); }
        if (!requested ||
            !correctionFitsReview(requested,feedback.correctionScope)) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SCOPE_MISMATCH');
        }
        effectiveCorrectionScope=mergeReviewedPixelGuards(
          requested,feedback.correctionScope);
        try {
          materialIntent = normalizedMaterialCorrectionIntent(args.correctionIntent);
        } catch {
          throw new Error('CODE_MODE_MATERIAL_INTENT_REQUIRED');
        }
        if (!materialIntent) throw new Error('CODE_MODE_MATERIAL_INTENT_REQUIRED');
        const issue = feedback.issues.find(entry =>
          entry.id === materialIntent.issueId);
        if (!issue) throw new Error('CODE_MODE_MATERIAL_ISSUE_NOT_REVIEWED');
        if (issue.partId && issue.partId !== materialIntent.partId) {
          throw new Error('CODE_MODE_MATERIAL_TARGET_MISMATCH');
        }
        if (feedback.rejectedApproaches.some(item =>
            item.issueId === materialIntent.issueId &&
            item.approachId === materialIntent.approachId)) {
          throw new Error('CODE_MODE_MATERIAL_APPROACH_PREVIOUSLY_REJECTED');
        }
        if (feedback.rejectedTreatments.some(item =>
            item.partId===materialIntent.partId &&
            item.material===materialIntent.material &&
            item.treatment===materialIntent.treatment &&
            item.failedAttempts>=2)) {
          throw new Error('CODE_MODE_MATERIAL_TREATMENT_FAMILY_REPEAT_BLOCKED');
        }
        // Reviewer-backed material work is sample-first. An explicitly
        // specified exact-RGBA edit outside this visual-review workflow
        // retains the existing SDK/Rust authorization contract.
        const cohort = feedback.materialCohort;
        if (!cohort) throw new Error('CODE_MODE_MATERIAL_SAMPLE_REQUIRED');
        if (cohort.issueId !== materialIntent.issueId ||
            cohort.partId !== materialIntent.partId ||
            cohort.approachId !== materialIntent.approachId) {
          throw new Error('CODE_MODE_MATERIAL_COHORT_IDENTITY_MISMATCH');
        }
        if (cohort.phase === 'sample') {
          if(args.materialWorkPacket!==undefined){
            throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_PROPAGATION_ONLY');
          }
          if (!correctionFitsReview(requested,{
            textureUuid:feedback.correctionScope.textureUuid,
            allowedRegions:[cohort.sampleRegion],
            preserveAlpha:feedback.correctionScope.preserveAlpha,
          })) throw new Error('CODE_MODE_MATERIAL_SAMPLE_REGION_REQUIRED');
        } else {
          // A single front view is sufficient for a small sample, never
          // enough authority for broad material propagation. All six
          // operator-selected rendered directions must have an explicit,
          // independent non-UNVERIFIED review first.
          if (!visualPair.requireSixDirections ||
              CARDINAL_VIEWS.some(name=>
                !visualViews.some(view=>view.viewId===name)) ||
              feedback.viewReviews.length!==visualViews.length ||
              feedback.viewReviews.some(view=>view.decision==='UNVERIFIED')) {
            throw new Error('CODE_MODE_VISUAL_VIEW_COVERAGE_UNVERIFIED');
          }
          if (cohort.sampleVerdict !== 'ACCEPTED' ||
              cohort.source_model_sha256 !== p.expectedSha256 ||
              cohort.capture_png_sha256 !== visualPair.capture.sha256 ||
              cohort.reference_png_sha256 !== visualPair.reference.sha256) {
            throw new Error('CODE_MODE_MATERIAL_SAMPLE_UNVERIFIED');
          }
          // Avoid repainting the representative material just accepted by
          // the reviewer while styling the remaining surfaces.
          if (requested.allowed_regions.some(rect =>
              overlapsRectangle(rect,cohort.sampleRegion))) {
            throw new Error('CODE_MODE_MATERIAL_ACCEPTED_SAMPLE_PROTECTED');
          }
          try {
            workPacket=normalizedMaterialWorkPacket(args.materialWorkPacket);
          } catch {
            throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_INVALID');
          }
          if(!workPacket){
            throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_REQUIRED');
          }
          if(workPacket.sourceModelSha256!==p.expectedSha256 ||
             workPacket.referencePngSha256!==visualPair.reference.sha256 ||
             workPacket.textureUuid!==requested.texture_uuid ||
             workPacket.issueId!==materialIntent.issueId ||
             workPacket.approachId!==materialIntent.approachId ||
             workPacket.partId!==materialIntent.partId ||
             workPacket.material!==materialIntent.material ||
             workPacket.reviewedIssueObservation!==issue.observation) {
            throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_BINDING_MISMATCH');
          }
          validateMaterialWorkPacketOperations(
            workPacket,requested,activeOperations);
          // The Rust source inspector (same pinned model and actual UV
          // owner as guarded Paint) validates EVERY planned atlas patch.
          // Text cannot certify a 3D form or prove cluster artistic quality.
          const bounded=await p.inspectBatch(workPacket.facePlans.map(face=>({
            kind:'material_face_patch',
            texture_uuid:workPacket.textureUuid,
            cube_uuid:face.cubeUuid,
            face:face.face,region:face.atlasRegion,
          })));
          if(bounded.sha256!==p.expectedSha256 ||
             bounded.results?.length!==workPacket.facePlans.length ||
             workPacket.facePlans.some((face,i)=>{
               const actual=bounded.results[i];
               const binding=actual?.binding;
               const exact=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
                 a.length===2&&b.length===2&&a.every((n,j)=>n===b[j]);
               return actual?.kind!=='material_face_patch' ||
                 binding?.scope!=='source_explicit_cube_face_patch' ||
                 binding?.status!=='bound_source_only' ||
                 binding?.texture_uuid!==workPacket.textureUuid ||
                 binding?.cube_uuid!==face.cubeUuid ||
                 binding?.face!==face.face ||
                 binding?.texture_reference!=='explicit_saved_link' ||
                 binding?.pixel_alias!=='no_detected_overlap_for_sample' ||
                 binding?.visual_verdict!=='UNVERIFIED' ||
                 binding?.face_coverage_verdict!=='UNVERIFIED' ||
                 binding?.view_correspondence!=='NOT_VERIFIED' ||
                 !exact(binding?.sample_region?.from,face.atlasRegion.from) ||
                 !exact(binding?.sample_region?.to,face.atlasRegion.to);
             })) {
            throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_FACE_SOURCE_UNVERIFIED');
          }
        }
      }
      if (visualPair !== null && pixelEdit) {
        // An image may change after preflight. Verify BOTH original PNGs
        // immediately before output/approval/native mutation.
        await Promise.all(visualViews.flatMap(view=>[
          pinnedReviewBytes(view.reference),
          pinnedReviewBytes(view.capture),
        ]));
      }
      const output = await outputPath(args.output, '.bbmodel');
      const receipt = await p.apply({ output, operations: activeOperations,
        correctionScope: effectiveCorrectionScope,
        ...(materialIntent ? {correctionIntent:materialIntent} : {}),
        ...(workPacket ? {materialWorkPacket:workPacket} : {}) });
      if (visualPair !== null && typeof reviewVisualPair === 'function' && pixelEdit) {
        // The CLI committed its no-overwrite result. Even if registering
        // its next handle fails, retrying the same snapshot is unsafe.
        completedReviewedCorrections.add(p.expectedSha256);
      }
      const next=await register(output);
      return { receipt, ...next,
        ...(pixelEdit?{texturing_workflow:{
          status:'PAINT_SAVED_NOT_VISUALLY_ACCEPTED',
          source_model_sha256:next.sha256,
          style_evidence:receipt.texture_styling_evidence??null,
          source_pixel_guards:{
            protected_regions:effectiveCorrectionScope?.protectedRegions?.length??0,
            expected_before_pixels:effectiveCorrectionScope?.expectedBeforePixels?.length??0,
            verified_by_rust_receipt:receipt.correction_scope?.status==='enforced' &&
              receipt.correction_scope.protected_regions===
                (effectiveCorrectionScope?.protectedRegions?.length??0) &&
              receipt.correction_scope.expected_before_pixels===
                (effectiveCorrectionScope?.expectedBeforePixels?.length??0),
          },
          ...(workPacket?{material_work_packet:{
            status:'SOURCE_BOUND_PLAN_NOT_ARTISTICALLY_VERIFIED',
            sha256:materialWorkPacketDigest(workPacket),
            planned_faces:workPacket.facePlans.length,
            source_model_sha256:workPacket.sourceModelSha256,
            reference_png_sha256:workPacket.referencePngSha256,
            visual_verdict:'UNVERIFIED',
          }}:{}),
          next:'Inspect face-local material styling and review fresh mapped views before declaring STYLED.',
          texture_completion_attested:false,
        }}:{})};
    },
    importPng: async (args) => {
      const p = selected(args);
      if (visualPair !== null && typeof reviewVisualPair === 'function') {
        // Even a host-preselected PNG import is a new full-texture write,
        // not a reviewer-bound bounded RGB correction. Require a separate
        // operator-authorized asset-import session, never a silent bypass.
        throw new Error('CODE_MODE_REVIEWED_TEXTURE_IMPORT_SEPARATE_HOST');
      }
      if (!png) throw new Error('CODE_MODE_PNG_NOT_PRESELECTED_BY_HOST');
      const output = await outputPath(args.output, '.bbmodel');
      const receipt = await client.importPng({
        input: p.input, output, png, uuid: args.uuid, name: args.name,
        expectedSha256: p.expectedSha256,
      });
      return { receipt, ...await register(output) };
    },
    exportPng: async (args) => {
      const p = selected(args);
      const output = await outputPath(args.output, '.png');
      return p.exportPng({ output, textureUuid: args.textureUuid });
    },
    exportGeometry: async (args) => {
      const p = selected(args);
      const output = await outputPath(args.output, '.geo.json');
      return p.exportGeometry({ output });
    },
    exportAnimations: async (args) => {
      const p = selected(args);
      const output = await outputPath(args.output, '.animation.json');
      return p.exportAnimations({ output });
    },
  });
  async function execute({ code } = {}) {
    if (typeof code !== 'string' || !code.trim() ||
        Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
      throw new TypeError('CODE_MODE_SCRIPT_INVALID_OR_OVERSIZE');
    }
    if (activeExecution) {
      throw new Error('CODE_MODE_HOST_BUSY');
    }
    const execution = { closed: false, pendingApproval: false, pause: () => {}, resume: () => {} };
    activeExecution = execution;
    try {
    const start = JSON.stringify({
      type: 'start', code,
      initial: initialRef,
    }) + '\n';
    if (Buffer.byteLength(start, 'utf8') > MAX_RPC_BYTES) {
      throw new Error('CODE_MODE_START_TOO_LARGE');
    }
    const createChild = spawnImpl ?? spawn;
    const child = createChild(denoBinary, [...DENO_FLAGS, WORKER], {
      // Guest never needs the user's model directory as its working path.
      cwd: tmpdir(), shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Never export an agent's credentials, HOME, PATH or system secrets.
      env: {
        DENO_NO_UPDATE_CHECK: '1', DENO_NO_PROMPT: '1', NO_COLOR: '1',
        ...(process.platform === 'win32'
          ? { SystemRoot: process.env.SystemRoot ?? '',
            WINDIR: process.env.WINDIR ?? '' } : {}),
      },
    });
    return await new Promise((resolve, reject) => {
      let closed = false;
      let concluded = null;
      let failure = null;
      let buffered = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let calls = 0;
      let pendingRpc = 0;
      let chain = Promise.resolve();
      const decoder = new StringDecoder('utf8');
      let remaining = TIMEOUT_MS;
      let timer = null;
      let approvalTimer = null;
      let tick = 0;
      function abortWith(code) {
        if (execution.closed) return;
        failure = new Error(code);
        execution.closed = true;
        child.kill();
      }
      function resumeClock() {
        clearTimeout(approvalTimer);
        approvalTimer = null;
        execution.pendingApproval = false;
        if (execution.closed) return;
        if (remaining <= 0) return abortWith('CODE_MODE_OUTCOME_UNKNOWN_TIMEOUT');
        tick = Date.now();
        timer = setTimeout(
          () => abortWith('CODE_MODE_OUTCOME_UNKNOWN_TIMEOUT'), remaining);
      }
      function pauseClock() {
        if (execution.closed) return;
        execution.pendingApproval = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
          remaining = Math.max(0, remaining - (Date.now() - tick));
        }
        approvalTimer = setTimeout(
          () => abortWith('CODE_MODE_OPERATOR_APPROVAL_TIMEOUT'),
          APPROVAL_TIMEOUT_MS,
        );
      }
      execution.pause = pauseClock;
      execution.resume = resumeClock;
      resumeClock();
      function send(response) {
        const data = JSON.stringify(response) + '\n';
        if (Buffer.byteLength(data, 'utf8') > MAX_RPC_BYTES) {
          throw new Error('CODE_MODE_RPC_RESPONSE_TOO_LARGE');
        }
        if (!closed && !child.stdin.destroyed) child.stdin.write(data);
      }
      async function processMessage(line) {
        if (!line || Buffer.byteLength(line, 'utf8') > MAX_RPC_BYTES) {
          throw new Error('CODE_MODE_RPC_MESSAGE_INVALID');
        }
        let message;
        try { message = JSON.parse(line); }
        catch { throw new Error('CODE_MODE_RPC_MESSAGE_INVALID'); }
        if (!message || typeof message !== 'object' ||
            Array.isArray(message)) {
          throw new Error('CODE_MODE_RPC_MESSAGE_INVALID');
        }
        if (message.type === 'done') {
          if (concluded !== null) throw new Error('CODE_MODE_DUPLICATE_RESULT');
          const resultBytes = Buffer.byteLength(
            JSON.stringify(message.value ?? null), 'utf8');
          const logs = message.logs;
          if (resultBytes > 32 * 1024 ||
              (logs !== undefined && (
                !Array.isArray(logs) || logs.length > 12 ||
                logs.some((log) => typeof log !== 'string') ||
                Buffer.byteLength(JSON.stringify(logs), 'utf8') > 4096))) {
            throw new Error('CODE_MODE_FINAL_RESULT_TOO_LARGE');
          }
          concluded = message;
          return;
        }
        // A queued final result is safe to consume after the child has
        // exited. A new RPC is not: no guest remains to receive its reply.
        if (execution.closed) {
          throw new Error('CODE_MODE_GUEST_SESSION_CLOSED');
        }
        if (message.type !== 'rpc' || concluded !== null ||
            !Number.isSafeInteger(message.id) || message.id < 1 ||
            typeof message.method !== 'string' ||
            !Object.hasOwn(actions, message.method) ||
            !Array.isArray(message.args) || message.args.length !== 1) {
          throw new Error('CODE_MODE_RPC_NOT_ALLOWED');
        }
        if (++calls > MAX_CALLS) {
          throw new Error('CODE_MODE_RPC_BUDGET_EXCEEDED');
        }
        pendingRpc++;
        try {
          try {
            const value = await actions[message.method](
              requireObject(message.args[0]));
            send({ type: 'rpc_result', id: message.id, ok: true, result: value });
          } catch (error) {
            send({ type: 'rpc_result', id: message.id, ok: false,
              code: shortError(error) });
          }
        } finally {
          pendingRpc--;
        }
      }
      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          failure = new Error('CODE_MODE_OUTPUT_LIMIT_REACHED');
          child.kill();
          return;
        }
        buffered += decoder.write(chunk);
        for (;;) {
          const at = buffered.indexOf('\n');
          if (at === -1) break;
          const line = buffered.slice(0, at);
          buffered = buffered.slice(at + 1);
          if (Buffer.byteLength(line, 'utf8') > MAX_RPC_BYTES) {
            failure = new Error('CODE_MODE_RPC_LINE_TOO_LARGE');
            child.kill();
            return;
          }
          chain = chain.then(() => processMessage(line)).catch((error) => {
            failure = error;
            child.kill();
          });
        }
        // A data event may coalesce many short frames; bound the remaining
        // partial line, not their concatenation before framing.
        if (Buffer.byteLength(buffered, 'utf8') > MAX_RPC_BYTES) {
          failure = new Error('CODE_MODE_RPC_LINE_TOO_LARGE');
          child.kill();
        }
      });
      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 4096) {
          failure = new Error('CODE_MODE_GUEST_STDERR_LIMIT');
          child.kill();
        }
      });
      child.stdin.on('error', () => {
        if (!failure) failure = new Error('CODE_MODE_OUTCOME_UNKNOWN_STDIN');
      });
      child.on('error', (error) => {
        failure = new Error('CODE_MODE_DENO_UNAVAILABLE', { cause: error });
      });
      child.on('close', (code, signal) => {
        closed = true;
        execution.closed = true;
        clearTimeout(timer);
        clearTimeout(approvalTimer);
        // A child that exits with any RPC still pending has an unknown
        // effect outcome. Never wait on an approval that might never return.
        // Late approvals are invalidated by the execution identity check.
        if (failure) return reject(failure);
        if (pendingRpc > 0) {
          return reject(new Error('CODE_MODE_OUTCOME_UNKNOWN_PENDING_RPC'));
        }
        void chain.then(() => {
          // A queued frame may fail after 'close' but before the promise
          // chain settles; never turn a rejected RPC into success.
          if (failure) return reject(failure);
          if (signal || code !== 0) {
            return reject(new Error(
              concluded?.error ?? 'CODE_MODE_OUTCOME_UNKNOWN_EXIT'));
          }
          if (concluded === null || Object.hasOwn(concluded, 'error')) {
            return reject(new Error(
              concluded?.error ?? 'CODE_MODE_NO_RESULT'));
          }
          resolve(Object.freeze({
            status: 'OK', value: concluded.value ?? null,
            logs: Array.isArray(concluded.logs) ?
              concluded.logs.slice(0, 12) : [],
            rpc_calls: calls,
          }));
        }).catch(reject);
      });
      child.stdin.write(start);
    });
    } finally {
      execution.closed = true;
      if (activeExecution === execution) activeExecution = null;
    }
  }
  return Object.freeze({
    execute,
    initial: initialRef,
  });
}


/**
 * Single model-visible entrypoint descriptor for an operator's agent host.
 * This does not register an MCP server, expose an extra public Gateway tool,
 * or create an independently privileged code runner.
 */
export function createCodeModeTool(host) {
  if (!host || typeof host.execute !== 'function') {
    throw new TypeError('A trusted Code Mode host is required');
  }
  return Object.freeze({
    name: 'lazydesigner_code_mode',
    description: 'Execute bounded JavaScript against the approved Rust model via the isolated Code Mode guest. Use codemode.initial, codemode.inspectBatch, codemode.apply and other typed APIs; writes require independent host approval. No filesystem/network/shell access in the guest. After Paint, use a fresh mapped-view review; invoke codemode.texturingReadiness only for end-of-Texturing readiness. Successful Paint and numeric styling hints never certify STYLED. Visual claims stay UNVERIFIED without real independent observation.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: { code: { type: 'string', minLength: 1, maxLength: 32768 } },
    }),
    execute: ({ code }) => host.execute({ code }),
  });
}

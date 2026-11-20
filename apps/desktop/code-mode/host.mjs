/**
 * Trusted host for Code Mode RPC. Model JavaScript runs in a separate Deno
 * permission-denied process, never in this Node process or in Tauri/Rust.
 * The host alone holds first-party Rust CLI credentials and file authority.
 * SOURCE_ONLY: no native runtime or sandbox proof has been executed.
 */
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createExecutionMetrics } from './execution-metrics.mjs';
import { fileURLToPath } from 'node:url';
import { createRustCodeModeClient, openRustCodeModeProject, normalizedCorrectionScope, normalizedMaterialCorrectionIntent } from './client.mjs';
import { createLiveReadClient } from './live-read-client.mjs';
import { compactTaskContext, preflightGuidance } from './task-context.mjs';
import {createWorkflowGate} from './workflow-gate.mjs';
import {normalizedMaterialWorkPacket,validateMaterialWorkPacketOperations,
  materialWorkPacketDigest,compileMaterialClusterPaint,materialFaceClusters,
  paintOperationsFingerprint} from './material-work-packet.mjs';
import {boundReviewCriteria,checkedCriterionReview,criterionPermitsPaint}
  from './review-criteria.mjs';
import {bindApprovedWorkspaceReference,assertApprovedWorkspaceReferenceFresh,
  referencePackageLeaseValid} from './approved-reference-package.mjs';
import {MAX_FACES_PER_REVIEW,MAX_PAGED_REVIEW_FACES,
  planPagedSourceFaceReview,requireAcceptedFaceReviewPage,
  sourceFaceStyleConsistent}
  from './paged-face-review.mjs';

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
// These patterns repeatedly passed numeric color-count checks in Local
// Pillager sessions while still failing the required material finish.
const STYLING_FINISH_VETO_HINTS = new Set([
  'UNIFORM_HORIZONTAL_BANDS_REVIEW',
  'UNIFORM_VERTICAL_BANDS_REVIEW',
  'FRAGMENTED_OR_NOISE_FIRST_REVIEW',
]);
const SOURCE_FACE_NORMALS=Object.freeze({
  north:[0,0,-1],east:[1,0,0],south:[0,0,1],
  west:[-1,0,0],up:[0,1,0],down:[0,-1,0],
});
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

// A successful CLI exit is not a sufficient mutation receipt. The native
// publisher may already have written a sibling even when this check refuses;
// never replay, delete, or silently accept that uncertain output.
function verifiedModelMutationSha(receipt, expectedSourceSha, operationCount) {
  if (typeof receipt?.source_sha256 !== 'string' ||
      receipt.source_sha256.toLowerCase() !== expectedSourceSha.toLowerCase() ||
      typeof receipt?.output_sha256 !== 'string' ||
      !SHA256.test(receipt.output_sha256) ||
      !Number.isSafeInteger(receipt?.mutation?.revision) ||
      receipt.mutation.revision < 1 ||
      receipt?.mutation?.operation_count !== operationCount ||
      receipt?.summary?.revision !== receipt.mutation.revision) {
    throw new Error('CODE_MODE_RUST_MUTATION_RECEIPT_UNVERIFIED');
  }
  return receipt.output_sha256.toLowerCase();
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
// Compact source-pixel localization from Rust's existing SHA-pinned PNG
// comparison. This is NOT a source Cube selector or camera-framing proof.
function compactMaskMismatch(comparison) {
  const empty = status => Object.freeze({
    status, missing_from_capture_pixels:null,
    excess_in_capture_pixels:null,
    reference_foreground_bounds:null,capture_foreground_bounds:null,
    missing_bounds:null,excess_bounds:null,
    priority_regions:Object.freeze([]),
  });
  const silhouette = comparison?.silhouette;
  const loc = silhouette?.localization;
  if (loc === undefined) return empty('UNAVAILABLE'); // older receipts
  const invalid = () => { throw new Error('CODE_MODE_VISUAL_MASK_LOCALIZATION_INVALID'); };
  if (!loc || typeof loc !== 'object' || Array.isArray(loc) ||
      !Array.isArray(loc.priority_regions)) invalid();
  if (loc.status === 'unassessed') {
    if (!['unassessed_no_alpha_channel','unassessed_empty_foreground',
          'unassessed_opaque_background'].includes(silhouette?.status) ||
        loc.missing_from_capture_pixels !== null ||
        loc.excess_in_capture_pixels !== null ||
        loc.reference_foreground_bounds !== null ||
        loc.capture_foreground_bounds !== null ||
        loc.missing_bounds !== null || loc.excess_bounds !== null ||
        loc.priority_regions.length !== 0) invalid();
    return empty('UNASSESSED');
  }
  const width = comparison?.width, height = comparison?.height;
  const count = n => Number.isSafeInteger(n) && n >= 0;
  if (loc.status !== 'pixel_mask_mismatch_measured' ||
      silhouette.status !== 'alpha_overlap_measured' ||
      !count(width) || !count(height) || width === 0 || height === 0 ||
      width > 2048 || height > 2048 || width * height > 2097152 ||
      !count(loc.missing_from_capture_pixels) ||
      !count(loc.excess_in_capture_pixels) ||
      !count(silhouette.reference_foreground_pixels) ||
      !count(silhouette.capture_foreground_pixels) ||
      !count(silhouette.intersection_pixels) ||
      !count(silhouette.union_pixels) ||
      silhouette.union_pixels > width * height ||
      silhouette.reference_foreground_pixels > width * height ||
      silhouette.capture_foreground_pixels > width * height ||
      silhouette.intersection_pixels > silhouette.reference_foreground_pixels ||
      silhouette.intersection_pixels > silhouette.capture_foreground_pixels ||
      loc.missing_from_capture_pixels !==
        silhouette.reference_foreground_pixels - silhouette.intersection_pixels ||
      loc.excess_in_capture_pixels !==
        silhouette.capture_foreground_pixels - silhouette.intersection_pixels ||
      loc.missing_from_capture_pixels + loc.excess_in_capture_pixels !==
        silhouette.union_pixels - silhouette.intersection_pixels ||
      loc.priority_regions.length > 4 ||
      ((loc.missing_from_capture_pixels + loc.excess_in_capture_pixels > 0) !==
        (loc.priority_regions.length > 0))) invalid();
  const bounds = region => Array.isArray(region) && region.length === 4 &&
    region.every(Number.isSafeInteger) &&
    region[0] >= 0 && region[1] >= 0 &&
    region[2] > region[0] && region[3] > region[1] &&
    region[2] <= width && region[3] <= height;
  const countBound = (rect, n) =>
    n === 0 ? rect === null : bounds(rect);
  if (!countBound(loc.missing_bounds,loc.missing_from_capture_pixels) ||
      !countBound(loc.excess_bounds,loc.excess_in_capture_pixels) ||
      !countBound(loc.reference_foreground_bounds,
        silhouette.reference_foreground_pixels) ||
      !countBound(loc.capture_foreground_bounds,
        silhouette.capture_foreground_pixels)) invalid();
  const totals = {missing:0,excess:0}, pairs = new Set();
  let prior = Number.POSITIVE_INFINITY;
  for (const region of loc.priority_regions) {
    if (!region || !['missing','excess'].includes(region.kind) ||
        !count(region.pixel_count) || region.pixel_count === 0 ||
        region.pixel_count > prior || !bounds(region.bounds)) invalid();
    prior = region.pixel_count;
    const key=region.kind+':'+region.bounds.join(',');
    if(pairs.has(key)) invalid();
    pairs.add(key);
    totals[region.kind] += region.pixel_count;
  }
  if(totals.missing > loc.missing_from_capture_pixels ||
     totals.excess > loc.excess_in_capture_pixels) invalid();
  return Object.freeze({
    status:'MEASURED',
    missing_from_capture_pixels:loc.missing_from_capture_pixels,
    excess_in_capture_pixels:loc.excess_in_capture_pixels,
    reference_foreground_bounds:loc.reference_foreground_bounds ?
      Object.freeze([...loc.reference_foreground_bounds]) : null,
    capture_foreground_bounds:loc.capture_foreground_bounds ?
      Object.freeze([...loc.capture_foreground_bounds]) : null,
    missing_bounds:loc.missing_bounds ?
      Object.freeze([...loc.missing_bounds]) : null,
    excess_bounds:loc.excess_bounds ?
      Object.freeze([...loc.excess_bounds]) : null,
    priority_regions:Object.freeze(loc.priority_regions.map(region=>
      Object.freeze({kind:region.kind,pixel_count:region.pixel_count,
        bounds:Object.freeze([...region.bounds])}))),
  });
}

// One operator-selected image-to-Cube hypothesis; never inferred from
// pixels, names or model-authored Deno code. Source UUID is verified later.
function boundGeometryLandmark(choice, views) {
  if (choice === undefined) return null;
  const allowed = new Set([
    'cubeUuid','viewId','mismatchKind','regionBounds','landmarkLabel',
  ]);
  const bounds=choice?.regionBounds;
  if (!choice || typeof choice!=='object' || Array.isArray(choice) ||
      Object.keys(choice).some(key=>!allowed.has(key)) ||
      typeof choice.cubeUuid!=='string' ||
      choice.cubeUuid.length<1 || choice.cubeUuid.length>128 ||
      typeof choice.landmarkLabel!=='string' ||
      choice.landmarkLabel.trim().length<1 ||
      choice.landmarkLabel.length>96 ||
      /[\x00-\x1f]/.test(choice.landmarkLabel) ||
      !views.some(view=>view.viewId===choice.viewId) ||
      !['missing','excess'].includes(choice.mismatchKind) ||
      !Array.isArray(bounds) || bounds.length!==4 ||
      bounds.some(n=>!Number.isSafeInteger(n) || n<0 || n>2048) ||
      bounds[2]<=bounds[0] || bounds[3]<=bounds[1]) {
    throw new Error('CODE_MODE_GEOMETRY_LANDMARK_BINDING_INVALID');
  }
  return Object.freeze({...choice,regionBounds:Object.freeze([...bounds])});
}
function confirmedGeometryCube(receipt, modelSha, cubeUuid) {
  const cube=receipt?.element;
  const point=vec=>Array.isArray(vec) && vec.length===3 &&
    vec.every(Number.isFinite);
  if (receipt?.status!=='OK' || receipt.sha256!==modelSha ||
      receipt.summary?.revision!==0 ||
      cube?.uuid!==cubeUuid || cube?.kind!=='cube' ||
      typeof cube.parent_uuid!=='string' || !cube.parent_uuid.length ||
      !point(cube.from) || !point(cube.to) ||
      cube.from.some((v,i)=>v>cube.to[i])) {
    throw new Error('CODE_MODE_GEOMETRY_LANDMARK_SOURCE_UNVERIFIED');
  }
  return Object.freeze({
    cube_uuid:cubeUuid,parent_bone_uuid:cube.parent_uuid,
    source_name:typeof cube.name==='string'?cube.name.slice(0,96):null,
    source_from:Object.freeze([...cube.from]),
    source_to:Object.freeze([...cube.to]),
  });
}
function regionMatchesFocus(region, focus) {
  return focus?.status==='MEASURED' &&
    focus.priority_regions.some(item=>
      item.kind===region.mismatchKind &&
      item.bounds.length===4 &&
      item.bounds.every((value,i)=>value===region.regionBounds[i]));
}

async function pinnedVisualPair(source, options, modelSha, approvedReferencePackagePath) {
  if (options === undefined) return null;
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => ![
        'referencePngPath','capturePngPath','captureModelSha256','viewId',
        'supportingViews','requireSixDirections','reviewCriteria',
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
  // Distinct filenames alone do not establish independent camera evidence:
  // a copied front PNG under "back.png" previously cleared path-only checks.
  // Do not count byte-identical captures/references under different view
  // labels as distinct observations. A one-view exact match remains valid.
  if (new Set(views.map(v=>v.reference.path)).size!==views.length ||
      new Set(views.map(v=>v.capture.path)).size!==views.length) {
    throw new Error('CODE_MODE_VISUAL_VIEW_SET_INVALID');
  }
  if (views.length>1 && (
      new Set(views.map(v=>v.reference.sha256)).size!==views.length ||
      new Set(views.map(v=>v.capture.sha256)).size!==views.length)) {
    throw new Error('CODE_MODE_VISUAL_VIEW_PIXEL_IDENTITY_REUSED');
  }
  const packageBinding=approvedReferencePackagePath===undefined?null:
    await bindApprovedWorkspaceReference(approvedReferencePackagePath,source,
      views,options.reviewCriteria);
  const [primary,...additionalViews]=views;
  return Object.freeze({
    ...primary,modelSha,
    additionalViews:Object.freeze(additionalViews),
    requireSixDirections:options.requireSixDirections===true,
    referencePackageBinding:packageBinding,
    reviewCriteria:boundReviewCriteria(
      packageBinding?.criteria??options.reviewCriteria,views),
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
        !['decision','issues','correctionScope','rejectedApproaches','rejectedTreatments','rejectedPaintPlans',
          'materialCohort','viewReviews','reviewedFaces','criteriaReviews'].includes(key)) ||
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
      (input.decision!=='ACCEPTED' && suppliedFaces.length>0) ||
      (suppliedFaces.length>0 && viewReviews.length!==viewIds.length)) {
    throw new Error('CODE_MODE_REVIEWED_MATERIAL_FACES_INVALID');
  }
  const reviewedFaces=suppliedFaces.map(item=>{
    if (!item || typeof item!=='object' || Array.isArray(item) ||
        Object.keys(item).some(key=>![
          'cubeUuid','textureUuid','face','style','observation','observedInViewId',
        ].includes(key)) ||
        !viewIds.includes(item.observedInViewId) ||
        !viewReviews.some(view=>view.viewId===item.observedInViewId &&
          view.decision==='ACCEPTED') ||
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
    // The trusted reviewer may carry source-backed rejected operation
    // fingerprints across revisions. Unlike a model-authored approach name,
    // these describe the concrete operations that were actually proposed.
    // No cross-session database is inferred or created by this host.
    const rejectedPaintPlans=(input.rejectedPaintPlans??[]);
    if(!Array.isArray(rejectedPaintPlans) ||
       rejectedPaintPlans.length>12) {
      throw new Error('CODE_MODE_REJECTED_PAINT_HISTORY_INVALID');
    }
    const boundedRejectedPlans=rejectedPaintPlans.map(entry=>{
      if(!entry || typeof entry!=='object' || Array.isArray(entry) ||
         Object.keys(entry).some(key=>![
           'partId','textureUuid','fingerprintSha256','observation',
         ].includes(key)) ||
         typeof entry.partId!=='string' ||
         !/^[a-z][a-z0-9_-]{0,63}$/.test(entry.partId) ||
         typeof entry.textureUuid!=='string' ||
         !/^[a-zA-Z0-9_-]{1,128}$/.test(entry.textureUuid) ||
         typeof entry.fingerprintSha256!=='string' ||
         !/^[a-f0-9]{64}$/.test(entry.fingerprintSha256) ||
         typeof entry.observation!=='string' ||
         entry.observation.length<20 || entry.observation.length>240 ||
         entry.observation.trim()!==entry.observation ||
         /[\x00-\x1f\x7f]/.test(entry.observation)) {
        throw new Error('CODE_MODE_REJECTED_PAINT_HISTORY_INVALID');
      }
      return Object.freeze({...entry});
    });
    if(new Set(boundedRejectedPlans.map(item=>
      JSON.stringify([item.partId,item.textureUuid,item.fingerprintSha256])))
        .size!==boundedRejectedPlans.length) {
      throw new Error('CODE_MODE_REJECTED_PAINT_HISTORY_INVALID');
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
      ...(scope.editable_before_rgba?{
        editableBeforeRgba:Object.freeze(scope.editable_before_rgba.map(rgba=>
          Object.freeze([...rgba]))),
      }:{}),
    });
    return Object.freeze({
      status:'RECORDED',decision:'REJECTED',
      issues:Object.freeze(issues),correctionScope:normalized,
      rejectedApproaches:Object.freeze(rejectedApproaches),
      rejectedTreatments:Object.freeze(rejectedTreatments),
      rejectedPaintPlans:Object.freeze(boundedRejectedPlans),
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
      input.rejectedPaintPlans !== undefined ||
      input.materialCohort !== undefined) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
  }
  return Object.freeze({
    status:'RECORDED',decision:input.decision,
    issues:Object.freeze([]),correctionScope:null,
    rejectedApproaches:Object.freeze([]),rejectedTreatments:Object.freeze([]),
    rejectedPaintPlans:Object.freeze([]),
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
  // If the reviewer allowed only original metal base RGBA, the guest may
  // narrow that set but cannot authorize overwriting previously approved
  // red/blue artwork simply by adding those colors to its own request.
  const reviewerColors=reviewed.editableBeforeRgba;
  const guestColors=requested.editable_before_rgba;
  let editableBeforeRgba;
  if(reviewerColors?.length){
    const reviewerSet=new Set(reviewerColors.map(rgb=>rgb.join(',')));
    // Never silently discard an unapproved color from a guest request:
    // doing so hides a material-plan error and makes correction analysis
    // harder. An explicitly narrower subset is allowed.
    if(guestColors!==undefined &&
       guestColors.some(rgb=>!reviewerSet.has(rgb.join(',')))){
      throw new Error('CODE_MODE_REVIEWED_SOURCE_COLOR_CONFLICT');
    }
    editableBeforeRgba=(guestColors??reviewerColors).map(rgb=>[...rgb]);
    if(editableBeforeRgba.length===0){
      throw new Error('CODE_MODE_REVIEWED_SOURCE_COLOR_CONFLICT');
    }
  }else if(guestColors!==undefined){
    editableBeforeRgba=guestColors.map(rgb=>[...rgb]);
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
    ...(editableBeforeRgba?{editableBeforeRgba}:{}),
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
// The operator may keep a write-approval prompt open while selected
// PNGs change. A synchronous final Rust launch lease must rehash both
// images for every bound view AFTER approval, immediately before spawn.
function pinnedReviewImageLeaseValid(selected) {
  try {
    const stat=lstatSync(selected.path);
    if(!stat.isFile() || stat.isSymbolicLink() ||
       stat.size<8 || stat.size>MAX_VISUAL_PNG_BYTES ||
       realpathSync(selected.path)!==selected.path) return false;
    const bytes=readFileSync(selected.path);
    return bytes.length===stat.size &&
      createHash('sha256').update(bytes).digest('hex')===selected.sha256;
  } catch { return false; }
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
// A high-detail model still gets source-only coverage beyond the former
// 32-page/256-Cube cap. Keep this bounded: no partial source or visual PASS.
const MAX_SOURCE_COVERAGE_PAGES = 128; // 1,024 Cubes maximum per scan
const COVERAGE_BATCH_THRESHOLD_CUBES = 256;

// Reuse ONE immutable Rust inspectBatch for two adjacent 8-Cube pages only
// when the first page has proved a larger source total. A pair is at most
// two native 32-KiB coverage results, below the existing 96-KiB read budget.
// Never persist the lookahead beyond this one SHA-pinned source scan.
function sourceCoverageReader(model) {
  let prefetched = null;
  return async (offset,totalCubes) => {
    if (prefetched !== null) {
      const page=prefetched;
      prefetched=null;
      if(page?.coverage?.offset!==offset) {
        throw new Error('CODE_MODE_COVERAGE_BATCH_CURSOR_INVALID');
      }
      return {sha256:model.expectedSha256,results:[page]};
    }
    const requests=[{kind:'model_texture_coverage',
      offset,limit:8,attention_only:false}];
    if (Number.isSafeInteger(totalCubes) &&
        totalCubes>COVERAGE_BATCH_THRESHOLD_CUBES &&
        offset+8<totalCubes &&
        offset+16<=MAX_SOURCE_COVERAGE_PAGES*8) {
      requests.push({kind:'model_texture_coverage',
        offset:offset+8,limit:8,attention_only:false});
    }
    const receipt=await model.inspectBatch(requests);
    if(receipt?.sha256!==model.expectedSha256 ||
       !Array.isArray(receipt.results) ||
       receipt.results.length!==requests.length ||
       receipt.results.some((entry,i)=>
         entry?.kind!=='model_texture_coverage' ||
         entry.coverage?.offset!==requests[i].offset)) {
      throw new Error('CODE_MODE_COVERAGE_BATCH_INVALID');
    }
    prefetched=receipt.results[1]??null;
    return {sha256:receipt.sha256,results:[receipt.results[0]]};
  };
}

// The trusted external image reviewer needs source-owned face IDs, not
// model-invented names. This focused read is optional for hosts whose reviewer
// can bind faces independently, and never certifies camera correspondence.
async function sourceFacesForImageReviewer(model) {
  const faces=[];
  let cursor=0, pages=0, totalCubes=null;
  const readCoverage=sourceCoverageReader(model);
  while(pages<MAX_SOURCE_COVERAGE_PAGES) {
    const receipt=await readCoverage(cursor,totalCubes);
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
    if(faces.length>MAX_PAGED_REVIEW_FACES) {
      return Object.freeze({
        scope:'trusted_saved_cube_face_inventory',
        source_model_sha256:model.expectedSha256,
        total_cubes:totalCubes,complete:false,
        reason:'REVIEW_INVENTORY_TOTAL_FACE_LIMIT',
        faces:Object.freeze(faces.slice(0,MAX_FACES_PER_REVIEW)),
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

// A host-selected style master must resolve to exactly one real saved
// texture identity in the pinned Rust model. Otherwise an arbitrary string
// would appear to protect an approved texture that never existed.
async function bindApprovedReference(project,uuid){
  if(!project) {
    throw new Error('CODE_MODE_MATERIAL_REFERENCE_REQUIRES_EXISTING_MODEL');
  }
  let offset=0,total=null,matches=0;
  for(let page=0;page<32;page++){
    let receipt;
    try {
      receipt=await project.catalog('textures',{offset,limit:32});
    } catch {
      throw new Error('CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED');
    }
    const list=receipt?.catalog;
    if(receipt?.sha256!==project.expectedSha256 ||
       list?.kind!=='textures' || list.offset!==offset ||
       !Number.isSafeInteger(list.total) || list.total<0 ||
       list.total>65536 || (total!==null && total!==list.total) ||
       !Array.isArray(list.entries) ||
       list.entries.length!==Math.min(32,Math.max(0,list.total-offset)) ||
       list.entries.some((entry,index)=>
         entry?.kind!=='texture' || entry.index!==offset+index ||
         (entry.uuid!==null && typeof entry.uuid!=='string'))) {
      throw new Error('CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED');
    }
    total=list.total;
    matches+=list.entries.filter(entry=>entry.uuid===uuid).length;
    if(list.next_offset===null){
      if(offset+list.entries.length!==total){
        throw new Error('CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED');
      }
      if(matches!==1) {
        throw new Error(matches===0 ?
          'CODE_MODE_MATERIAL_REFERENCE_NOT_FOUND':
          'CODE_MODE_MATERIAL_REFERENCE_AMBIGUOUS');
      }
      return;
    }
    if(!Number.isSafeInteger(list.next_offset) ||
       list.next_offset!==offset+list.entries.length ||
       list.next_offset>=total) {
      throw new Error('CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED');
    }
    offset=list.next_offset;
  }
  throw new Error('CODE_MODE_MATERIAL_REFERENCE_CATALOG_INCOMPLETE');
}

export async function createCodeModeHost({
  rustBinary, denoBinary, input, outputDirectory, authorizeMutation,
  preselectedPngPath, approvedMaterialReferenceUuid,
  preselectedVisualPair, preselectedGeometryLandmark,
  approvedReferencePackagePath,
  reviewVisualPair, runner, spawnImpl, liveReadPairing, liveReadClient,
  observeExecutionMetrics, workflowFile,
} = {}) {
  // A pure live read-only session has no disk model, no file publisher and
  // does not use the CLI. Requiring a separate Rust binary in that mode
  // would defeat the session bridge's purpose.
  const pureLiveRead = input === undefined && outputDirectory === undefined;
  if (pureLiveRead && [
    authorizeMutation, preselectedPngPath, approvedMaterialReferenceUuid,
    preselectedVisualPair, preselectedGeometryLandmark,
    approvedReferencePackagePath, reviewVisualPair, workflowFile,
  ].some(value => value !== undefined)) {
    // A live-only host cannot contain any disk-writer, texture-import or
    // reference-pair declaration. Those require an independent saved source
    // SHA and separate trusted operator authority.
    throw new Error('CODE_MODE_LIVE_READ_ONLY_CONFIG_INVALID');
  }
  if (!pureLiveRead || rustBinary !== undefined) {
    requireAbsolute(rustBinary, 'rustBinary');
  }
  requireAbsolute(denoBinary, 'denoBinary');
  if ((input !== undefined && outputDirectory !== undefined) ||
      (input === undefined && outputDirectory === undefined &&
       liveReadPairing === undefined && liveReadClient === undefined)) {
    throw new Error('CODE_MODE_SOURCE_OR_OUTPUT_DIRECTORY_REQUIRED');
  }
  if (liveReadPairing !== undefined && liveReadClient !== undefined) {
    throw new Error('LIVE_READ_DUPLICATE_PROVIDER');
  }
  // The paired Windows capability exists only in trusted Node memory. It
  // never appears in guest code, a tool schema, the initial project ref,
  // process arguments or an environment variable.
  const liveReader = liveReadPairing !== undefined ?
    createLiveReadClient(liveReadPairing) : liveReadClient ?? null;
  if (liveReader !== null &&
      (typeof liveReader.sessionInfo !== 'function' ||
       typeof liveReader.semanticMap !== 'function')) {
    throw new TypeError('LIVE_READ_TRUSTED_PROVIDER_INVALID');
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
  if (observeExecutionMetrics !== undefined &&
      typeof observeExecutionMetrics !== 'function') {
    throw new TypeError('observeExecutionMetrics must be a trusted-host function');
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
  if (approvedReferencePackagePath!==undefined &&
      (preselectedVisualPair===undefined || input===undefined)) {
    throw new Error('CODE_MODE_REFERENCE_REQUIRES_VISUAL_INPUT_MODEL');
  }
  const source = input === undefined ? null :
    await regularFile(input, 'CODE_MODE_SOURCE');
  if (source !== null && !source.toLowerCase().endsWith('.bbmodel')) {
    throw new Error('CODE_MODE_SOURCE_EXTENSION_INVALID');
  }
  let folder;
  if (source === null && outputDirectory !== undefined) {
    const dir = await lstat(outputDirectory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) {
      throw new Error('CODE_MODE_OUTPUT_DIRECTORY_INVALID');
    }
    folder = await realpath(outputDirectory);
  } else if (source !== null) {
    folder = await realpath(dirname(source));
  } else {
    // Pure live read pairing: no disk project, no output directory, no write.
    folder = null;
  }
  if (!pureLiveRead && !runner) {
    await regularFile(rustBinary, 'CODE_MODE_RUST_BINARY');
  }
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

  // External production host: canonical existing README, never guest input.
  // Injected runner is a trusted test seam; explicit workflowFile opts in.
  const workflowTarget=folder===null?null:join(folder,'README.md');
  if(workflowFile!==undefined &&
     requireAbsolute(workflowFile,'workflowFile')!==workflowTarget){
    throw new Error('CODE_MODE_WORKFLOW_PATH_INVALID');
  }
  const gateEnabled=folder!==null&&(runner===undefined||workflowFile!==undefined);
  let workflowGate=null;
  // Only one code session may be active per host. Operator approval is
  // invalidated when that session exits or times out.
  let activeExecution = null;
  // Native adapter calls can complete after their Deno guest has exited.
  // Scope each observation to the originating RPC rather than whichever
  // later guest currently occupies the host slot.
  const metricScope = new AsyncLocalStorage();
  // Every approval descriptor is linked to the exact guest that received it.
  // This prevents an old approval from being consumed by a later guest when
  // Rust plan-file creation yields to the event loop before CLI launch.
  const approvedGuest = new WeakMap();
  const client = pureLiveRead ? null : createRustCodeModeClient({
    binary: rustBinary,
    ...(runner ? { runner } : {}),
    onNativeCall: (sample) => {
      const run = metricScope.getStore();
      if (!run) return;
      run.metrics.recordNativeCall(sample);
    },
    authorizeMutation: async (request) => {
      const execution = activeExecution;
      if (!execution || execution.closed ||
          typeof request.output !== 'string') return false;
      try { await checkFreshSibling(request.output, folder); }
      catch { return false; }
      if (typeof authorizeMutation !== 'function' ||
          execution.closed || activeExecution !== execution) return false;
      const selectedModel=request.input===undefined?null:
        [...projects.values()].find(p=>p.input===request.input &&
          p.expectedSha256===request.expectedSha256);
      // Gate EVERY write before user approval; source SHA and native Rust
      // transaction checks still happen independently at Apply.
      const stageLease=workflowGate===null?null:
        await workflowGate.authorize(request,selectedModel?.summary);
      execution.pause();
      const approvalStarted = execution.metrics.mark();
      let approved;
      try {
        approved = await authorizeMutation(Object.freeze({
          ...request,
          ...(visualPair?.referencePackageBinding?{
            approvedReferencePackageSha256:
              visualPair.referencePackageBinding.fingerprintSha256,
            approvedReferenceCriterionCount:
              visualPair.reviewCriteria?.length??0,
          }:{}),
        }));
      } finally {
        execution.metrics.recordApprovalSince(approvalStarted);
        execution.resume();
      }
      // Prevent a delayed approval from reviving a timed-out guest.
      const valid = approved === true &&
        !execution.closed && activeExecution === execution;
      if (valid) approvedGuest.set(request,{execution,stageLease});
      return valid;
    },
    // Synchronous last lease check, directly before the SDK launches Rust.
    // No async work may occur between this check and the execFile request.
    permitWriteLaunch: (request) => {
      const approved = approvedGuest.get(request);
      approvedGuest.delete(request);
      return approved!==undefined &&
        approved.execution===activeExecution && !approved.execution.closed &&
        (workflowGate===null || workflowGate.leaseValid(approved.stageLease)) &&
        (!visualPair?.referencePackageBinding ||
          referencePackageLeaseValid(visualPair.referencePackageBinding)) &&
        (visualPair===null || visualViews.every(view=>
          pinnedReviewImageLeaseValid(view.reference) &&
          pinnedReviewImageLeaseValid(view.capture)));
    },
  });
  const projects = new Map();
  const initialProject = source === null ? null :
    await openRustCodeModeProject(client, source);
  if(gateEnabled)workflowGate=createWorkflowGate({
    folder,source,sourceSha:initialProject?.expectedSha256??null,
  });
  // Read existing README once at Start/Resume. Missing/stale declarations
  // are visible as BLOCKED, but do not prevent read-only inspection.
  const workflowOrientation=workflowGate===null?null:
    await workflowGate.orient();
  if (referenceMaster!==null) {
    await bindApprovedReference(initialProject,referenceMaster);
  }
  if (initialProject) projects.set('p0', initialProject);
  let nextProject = initialProject ? 1 : 0;
  const visualPair = await pinnedVisualPair(
    source, preselectedVisualPair, initialProject?.expectedSha256 ?? null,
    approvedReferencePackagePath);
  const visualViews=Object.freeze(visualPair===null?[]:[
    visualPair,...visualPair.additionalViews,
  ]);
  const geometryLandmark=boundGeometryLandmark(
    preselectedGeometryLandmark,visualViews);
  // One transient source/image link, invalid until an exact visual read.
  let verifiedGeometryLandmark=null;
  // One ephemeral review state per exact model SHA, not a second asset store.
  const visualPreflights = new Map();
  // Single immutable source/view selection per host. Repeated multi-view
  // reads do not need six Rust PNG decoders after a successful preflight,
  // provided Rust re-verifies the model SHA and Node re-hashes EVERY PNG.
  // Cache never grants review/paint approval or persists between hosts.
  let verifiedMultiViewRead = null;
  // Only trusted, same-session, SHA-bound reviewer outputs are accumulated.
  // The untrusted Deno guest sees a compact summary, never 1024 raw face
  // declarations or a second persistent approval/asset registry.
  let pagedFaceLedger = null;
  // One coherent reviewed correction per source revision. Do not create
  // multiple variants from a stale, already-rejected capture.
  const completedReviewedCorrections = new Set();
  const initialRef = Object.freeze(initialProject ? {
    project: 'p0', sha256: initialProject.expectedSha256,
    summary: initialProject.summary,
    ...(workflowOrientation!==null?{workflow:workflowOrientation}:{}),
    ...(liveReader ? { liveReadOnly: true } : {}),
  } : {
    project: null, sha256: null, summary: null,
    ...(workflowOrientation!==null?{workflow:workflowOrientation}:{}),
    ...(liveReader ? { liveReadOnly: true } : {}),
  });

  function selected(args) {
    const id = requireObject(args).project;
    if (typeof id !== 'string' || !projects.has(id)) {
      throw new Error('CODE_MODE_PROJECT_HANDLE_UNKNOWN');
    }
    return projects.get(id);
  }
  async function outputPath(name, suffix) {
    if (folder === null) throw new Error('CODE_MODE_DISK_OUTPUT_UNAVAILABLE');
    const path = join(folder, outputName(name, suffix));
    await checkFreshSibling(path, folder);
    return path;
  }
  async function register(path,expectedOutputSha) {
    if (projects.size >= MAX_PROJECTS) {
      throw new Error('CODE_MODE_PROJECT_LIMIT_REACHED');
    }
    const project = await openRustCodeModeProject(client, path);
    // Reopen the actual saved sibling before accepting the Rust publisher
    // receipt. A claimed output hash and a mismatching saved model must not
    // acquire a successful Code Mode handle, even with a valid PNG guard.
    if (expectedOutputSha!==undefined &&
        project.expectedSha256!==expectedOutputSha) {
      throw new Error('CODE_MODE_RUST_PUBLISHED_OUTPUT_SHA_MISMATCH');
    }
    const handle = 'p' + nextProject++;
    if(workflowGate!==null)workflowGate.register(path,project.expectedSha256);
    projects.set(handle, project);
    // Exact Rust-verified candidate filename for manual GUI selection.
    // Never a visual approval or an automatic replacement of the GUI model.
    return { project: handle, sha256: project.expectedSha256,
      summary: project.summary, candidateFile: basename(path) };
  }
  // The fixed capability boundary is intentionally much smaller than shell,
  // filesystem or generic Rust CLI access. Only owned methods are dispatched.
  const actions = Object.freeze({
    // New live-read functions are independent of disk project handles.
    // There is deliberately NO liveApply/liveImport/liveSave operation.
    liveSessionInfo: async () => {
      if (!liveReader) throw new Error('LIVE_READ_NOT_PAIRED');
      return liveReader.sessionInfo();
    },
    liveSemanticMap: async (args) => {
      if (!liveReader) throw new Error('LIVE_READ_NOT_PAIRED');
      return liveReader.semanticMap({
        expectedEpoch: args.expectedEpoch,
        expectedRevision: args.expectedRevision,
        category: args.category, offset: args.offset, limit: args.limit,
      });
    },
    projectInfo: async (args) => {
      const p = selected(args);
      return { project: args.project, sha256: p.expectedSha256,
        summary: p.summary };
    },
    inspect: async (args) => selected(args).inspect(args.uuid),
    catalog: async (args) => selected(args).catalog(args.kind, {
      offset: args.offset, limit: args.limit,
    }),
    semanticMap: async (args) => selected(args).semanticMap(args.category, {
      offset: args.offset, limit: args.limit,
    }),
    preflight: async (args) => selected(args).preflight({
      operations: args.operations, correctionScope: args.correctionScope,
    }),
    // P0 read-only semantic material plan: Rust decides pixel masks/UV;
    // the guest may not use this as visual acceptance or write authority.
    planSemanticMaterial: async (args) =>
      selected(args).planSemanticMaterial(args.intent),
    // A1 read-only Rust rotation sampler; Apply stays separately authorized.
    planPeriodicRotation: async (args) =>
      selected(args).planPeriodicRotation(args.intent),
    // Exact authored poses; Rust returns only preflight and review hints.
    planSemanticAnimation: async (args) =>
      selected(args).planSemanticAnimation(args.intent),
    // Existing clip review or explicit one-key change; no hidden native Apply.
    reviewExistingAnimation: async (args) =>
      selected(args).reviewExistingAnimation(args.intent),
    // Structure-first G1 composition is a SHA-pinned read-only Rust plan.
    // No trusted-host approval, output path, live write, or implicit Apply.
    planGeometryAssembly: async (args) =>
      selected(args).planGeometryAssembly(args.assembly),
    // G2 remains read-only: all file edits use independently approved Apply.
    planGeometryAttachment: async (args) =>
      selected(args).planGeometryAttachment(args.attachment),
    // One-shot G2.2 Rust planning; no saved graph or new writer.
    planGeometryResizePropagation: async (args) =>
      selected(args).planGeometryResizePropagation(args.propagation),
    // Only the trusted operator may bind a source Cube to a pinned
    // pixel-mask region. The guest declares numerical bounds, not identity.
    // Rust's existing ReframeCube preflight is the sole geometry authority.
    planReviewedGeometryReframe: async (args) => {
      const model=selected(args);
      if (Object.keys(args).some(key=>![
        'project','from','to','uvPolicy',
      ].includes(key))) {
        throw new Error('CODE_MODE_GEOMETRY_REFRAME_ARGUMENT_INVALID');
      }
      const evidence=verifiedGeometryLandmark;
      if (!evidence || evidence.source_model_sha256!==model.expectedSha256) {
        throw new Error('CODE_MODE_GEOMETRY_LANDMARK_EVIDENCE_REQUIRED');
      }
      const vector=v=>Array.isArray(v) && v.length===3 &&
        v.every(n=>typeof n==='number' && Number.isFinite(n));
      if (!vector(args.from) || !vector(args.to) ||
          args.from.some((v,i)=>v>args.to[i]) ||
          !['manual_preserve','box_repack'].includes(args.uvPolicy)) {
        throw new Error('CODE_MODE_GEOMETRY_REFRAME_ARGUMENT_INVALID');
      }
      if(args.from.every((v,i)=>v===evidence.source_from[i]) &&
         args.to.every((v,i)=>v===evidence.source_to[i])) {
        throw new Error('CODE_MODE_GEOMETRY_REFRAME_NO_CHANGE');
      }
      const operation={op:'reframe_cube',uuid:evidence.cube_uuid,
        from:[...args.from],to:[...args.to],uv_policy:args.uvPolicy};
      const planned=await model.preflight({operations:[operation]});
      if(planned.sha256!==model.expectedSha256 ||
         planned.summary?.revision!==0 ||
         planned.preflight?.write_authority!=='NOT_GRANTED' ||
         planned.preflight?.visual_verdict!=='UNVERIFIED' ||
         planned.preflight?.mutation?.operation_count!==1 ||
         planned.preflight?.mutation?.changed_uuids?.length!==1 ||
         planned.preflight.mutation.changed_uuids[0]!==evidence.cube_uuid) {
        throw new Error('CODE_MODE_GEOMETRY_REFRAME_PREFLIGHT_UNVERIFIED');
      }
      // The preflight and fresh focused read must use the same model SHA;
      // re-hash every bound image before returning a possible correction.
      const source=confirmedGeometryCube(
        await model.inspect(evidence.cube_uuid),
        model.expectedSha256,evidence.cube_uuid);
      if (source.parent_bone_uuid!==evidence.parent_bone_uuid ||
          !source.source_from.every((v,i)=>v===evidence.source_from[i]) ||
          !source.source_to.every((v,i)=>v===evidence.source_to[i])) {
        throw new Error('CODE_MODE_GEOMETRY_LANDMARK_SOURCE_CHANGED');
      }
      if(visualPair.referencePackageBinding){
        await assertApprovedWorkspaceReferenceFresh(
          visualPair.referencePackageBinding);
      }
      await Promise.all(visualViews.flatMap(view=>[
        pinnedReviewBytes(view.reference),pinnedReviewBytes(view.capture),
      ]));
      return Object.freeze({
        status:'OK',source_model_sha256:model.expectedSha256,
        geometry_landmark:evidence,
        plan:Object.freeze({expected_revision:0,
          operations:Object.freeze([Object.freeze(operation)]),
          correction_scope:null}),
        preflight:planned.preflight,
        write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
      });
    },
    // One existing native authoring_target query, then a small host-only
    // projection. No unbounded scene/PNG/opaque payload reaches Deno.
    taskContext: async (args) => {
      const p = selected(args);
      const response = await p.inspectBatch([{
        kind: 'authoring_target',
        domain: args.domain, category: args.category, name: args.name,
      }]);
      return compactTaskContext(response, {
        project: args.project, domain: args.domain, category: args.category,
        name: args.name, expectedSha256: p.expectedSha256,
      });
    },
    // Advisory for deciding whether to call native dry-run. Never changes
    // real Apply validation, host approval, reviewed Paint or publication.
    preflightGuidance: async (args) => {
      const p = selected(args);
      return Object.freeze({
        source_model_sha256: p.expectedSha256,
        source_revision: p.summary.revision,
        ...preflightGuidance({
          operations: args.operations, correctionScope: args.correctionScope,
        }),
      });
    },
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
      if(visualPair.referencePackageBinding){
        await assertApprovedWorkspaceReferenceFresh(
          visualPair.referencePackageBinding);
      }
      if (visualViews.length > 1 && verifiedMultiViewRead !== null) {
        // The first read already completed numeric comparisons and
        // independently bound review. Never reuse them on path metadata
        // alone; Rust must prove the current .bbmodel bytes still have
        // the exact inspected SHA, and all selected PNG bytes are rehashed.
        const checkedModel=await client.inspect({
          input:model.input,expectedSha256:model.expectedSha256,
        });
        if(checkedModel.sha256!==model.expectedSha256) {
          throw new Error('CODE_MODE_VISUAL_CAPTURE_MODEL_STALE');
        }
        await Promise.all(visualViews.flatMap(view=>[
          pinnedReviewBytes(view.reference),pinnedReviewBytes(view.capture),
        ]));
        return verifiedMultiViewRead;
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
        mask_mismatch:compactMaskMismatch(measured[index].comparison),
      })));
      // Freeze the first reviewer decision for one source SHA/view. The
      // guest must not downgrade ACCEPTED with a repeated review request.
      const prior = visualPreflights.get(model.expectedSha256);
      let feedback = prior ?? Object.freeze({
        status:'NOT_RECORDED',decision:'UNVERIFIED',
        issues:Object.freeze([]),correctionScope:null,
        rejectedApproaches:Object.freeze([]),rejectedTreatments:Object.freeze([]),
        rejectedPaintPlans:Object.freeze([]),
        materialCohort:null,face_source_evidence:null,viewReviews:Object.freeze([]),
        reviewedFaces:Object.freeze([]),
        review_criteria:visualPair.reviewCriteria??Object.freeze([]),
        criteria_review:null,
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
        // Keep one-view/local corrections available when a large model
        // contains unresolved/unsupported saved face mappings. Only a
        // six-view, explicitly paging-aware reviewer may attempt full-model
        // acceptance; failed page planning falls back to INCOMPLETE source
        // inventory, never an implicit PASS.
        let sourcePages=null,sourcePagingGap=null;
        if(faceInventory?.complete &&
           faceInventory.faces.length>MAX_FACES_PER_REVIEW &&
           visualPair.requireSixDirections &&
           reviewVisualPair.supportsPagedSourceFaceReview===true){
          try{sourcePages=planPagedSourceFaceReview(faceInventory);}
          catch(error){
            if(!['CODE_MODE_PAGED_FACE_SOURCE_INCOMPLETE',
                  'CODE_MODE_PAGED_FACE_SOURCE_UNRESOLVED']
              .includes(error?.message))throw error;
            // Preserve a precise source blocker while retaining a local
            // focused correction on the explicitly incomplete inventory.
            sourcePagingGap=error.message;
          }
        }
        const supportsPages=sourcePages!==null;
        // Legacy reviewer callbacks keep a bounded, explicitly INCOMPLETE
        // inventory and may still report a focused REJECTED correction.
        // They cannot claim full-face readiness for an oversized model.
        const legacyInventory=faceInventory?.faces.length>MAX_FACES_PER_REVIEW?
          Object.freeze({...faceInventory,complete:false,
            reason:sourcePagingGap??faceInventory.reason??
              'REVIEW_INVENTORY_FACE_LIMIT',
            faces:Object.freeze(faceInventory.faces.slice(0,MAX_FACES_PER_REVIEW))}):
          faceInventory;
        const basePair=Object.freeze({
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
          reviewCriteria:visualPair.reviewCriteria??Object.freeze([]),
        });
        execution.pause();
        let returned;
        let pendingFaceLedger=null;
        try {
          returned=await reviewVisualPair(Object.freeze({...basePair,
            sourceFaceInventory:supportsPages?sourcePages[0]:legacyInventory,
          }));
          // The first page may be REJECTED for a focused correction; do not
          // force whole-model review before such a bounded repair. Only a
          // globally ACCEPTED declaration starts paged all-face closure.
          if(supportsPages && returned?.decision==='ACCEPTED'){
            const ids=visualViews.map(view=>view.viewId);
            const examined=[];
            for(let i=0;i<sourcePages.length;i++){
              const raw=i===0?returned:await reviewVisualPair(Object.freeze({
                ...basePair,sourceFaceInventory:sourcePages[i],
              }));
              const normalized=normalizedVisualReview(raw,ids);
              const criteria=checkedCriterionReview(
                visualPair.reviewCriteria,raw.criteriaReviews,
                normalized.decision,normalized.issues,normalized.correctionScope);
              if(criteria?.status!=='ALL_MET'){
                throw new Error('CODE_MODE_PAGED_FACE_REVIEW_CRITERIA_INCOMPLETE');
              }
              examined.push(...requireAcceptedFaceReviewPage(
                sourcePages[i],normalized));
            }
            pendingFaceLedger=Object.freeze({
              sourceModelSha256:model.expectedSha256,
              faceCount:examined.length,pageCount:sourcePages.length,
              faces:Object.freeze(examined),
            });
            // Never expose or accidentally cache one page as an apparent
            // whole-model subset. The authoritative ledger stays host-only.
            returned={...returned,reviewedFaces:[]};
          }
        } finally { execution.resume(); }
        if (execution.closed || activeExecution !== execution) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        feedback = normalizedVisualReview(returned,
          visualViews.map(view=>view.viewId));
        // Every operator-frozen correction and preserve decision must be
        // independently accounted for. A reviewer's overall ACCEPTED string
        // cannot override a violated or unobserved approved requirement.
        const criteriaReview=checkedCriterionReview(
          visualPair.reviewCriteria,returned.criteriaReviews,
          feedback.decision,feedback.issues,feedback.correctionScope);
        feedback=Object.freeze({...feedback,
          review_criteria:visualPair.reviewCriteria??Object.freeze([]),
          criteria_review:criteriaReview,
          paged_face_review:pendingFaceLedger?Object.freeze({
            status:'ALL_SOURCE_PAGES_REVIEWER_DECLARED_ACCEPTED',
            source_model_sha256:model.expectedSha256,
            page_count:pendingFaceLedger.pageCount,
            reviewed_source_faces:pendingFaceLedger.faceCount,
            visual_verdict:'UNVERIFIED',
          }):null,
          reference_package_evidence:visualPair.referencePackageBinding?
            Object.freeze({
              source:'EXISTING_WORKSPACE_REFERENCE_JSON_DECLARATION',
              fingerprint_sha256:
                visualPair.referencePackageBinding.fingerprintSha256,
              matched_images:
                visualPair.referencePackageBinding.matchedImageCount,
              automatically_bound_reference:
                visualPair.referencePackageBinding.automaticallyBoundReferenceCount,
              visual_verdict:'UNVERIFIED',
            }):null,
        });
        if (feedback.reviewedFaces.length>0) {
          // A camera declaration cannot create actual Cube/UV ownership.
          // Bind it to the current SHA-checked Rust model BEFORE caching
          // accepted feedback, without pretending to verify face visibility.
          const inventory=faceInventory ??
            await sourceFacesForImageReviewer(model);
          const sourceFaces=new Map(inventory.faces.map(face=>[
            JSON.stringify([face.cube_uuid,face.face]),face,
          ]));
          if(inventory.source_model_sha256!==model.expectedSha256 ||
             feedback.reviewedFaces.some(face=>{
               const saved=sourceFaces.get(JSON.stringify([
                 face.cubeUuid,face.face,
               ]));
               return !saved || !saved.texture_uuid ||
                 saved.texture_uuid!==face.textureUuid ||
                 !sourceFaceStyleConsistent(saved.source_status,face.style);
             })) {
            throw new Error('CODE_MODE_REVIEWED_FACE_SOURCE_UNVERIFIED');
          }
          // An incomplete inventory is never whole-model evidence; the
          // separate final readiness scan must still account for all faces.
        }
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
        if(visualPair.referencePackageBinding){
          await assertApprovedWorkspaceReferenceFresh(
            visualPair.referencePackageBinding);
        }
        // The independent reviewer may take minutes. Source or PNGs can
        // change while it is inspecting images, even when all preflight
        // hashes were correct. Never cache a verdict against stale bytes.
        const fresh=await client.inspect({
          input:model.input,expectedSha256:model.expectedSha256,
        });
        if(fresh.sha256!==model.expectedSha256) {
          throw new Error('CODE_MODE_VISUAL_CAPTURE_MODEL_STALE');
        }
        await Promise.all(visualViews.flatMap(view=>[
          pinnedReviewBytes(view.reference),pinnedReviewBytes(view.capture),
        ]));
        if(execution.closed || activeExecution!==execution) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        // Only publish the transient full-face ledger after exact model and
        // every selected PNG are fresh again. Failed mid-page evidence is
        // never cached or promoted to a guest-visible readiness result.
        if(pendingFaceLedger) pagedFaceLedger=pendingFaceLedger;
      }
      // Match a trusted operator's exact pixel-focus declaration and the
      // real saved Cube UUID. This is an unverified visual correspondence,
      // not an automatic projection from PNG pixels into 3D coordinates.
      let landmarkEvidence=null;
      if (geometryLandmark!==null) {
        const view=visualViews.find(v=>v.viewId===geometryLandmark.viewId);
        const focus=view_evidence.find(v=>v.view_id===geometryLandmark.viewId)
          ?.mask_mismatch;
        if(!view || !regionMatchesFocus(geometryLandmark,focus)){
          throw new Error('CODE_MODE_GEOMETRY_LANDMARK_MASK_UNVERIFIED');
        }
        const source=confirmedGeometryCube(
          await model.inspect(geometryLandmark.cubeUuid),
          model.expectedSha256,geometryLandmark.cubeUuid);
        landmarkEvidence=Object.freeze({
          ...source,
          landmark_label:geometryLandmark.landmarkLabel,
          view_id:geometryLandmark.viewId,
          mismatch_kind:geometryLandmark.mismatchKind,
          region_bounds:geometryLandmark.regionBounds,
          source_model_sha256:model.expectedSha256,
          reference_png_sha256:view.reference.sha256,
          capture_png_sha256:view.capture.sha256,
          identity_status:'SOURCE_UUID_VERIFIED',
          image_correspondence:'OPERATOR_DECLARED_UNVERIFIED',
          write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
        });
      }
      if (prior === undefined) visualPreflights.set(model.expectedSha256,feedback);
      verifiedGeometryLandmark=landmarkEvidence;
      const readReceipt = {
        ...evidence,
        view_evidence,
        geometry_landmark:landmarkEvidence,
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
      if (visualViews.length > 1) {
        // Numeric comparison receipts contain no PNG buffers, paths or
        // new permission authority. The reviewer decision remains the
        // existing SHA-bound session declaration.
        verifiedMultiViewRead=Object.freeze(readReceipt);
      }
      return readReceipt;
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
      if(visualPair?.referencePackageBinding){
        await assertApprovedWorkspaceReferenceFresh(
          visualPair.referencePackageBinding);
      }
      const blocked=[];
      if (visualPair===null || p.expectedSha256!==visualPair.modelSha) {
        blocked.push('CURRENT_REVISION_RENDERED_VIEW_SET_MISSING');
      }
      if (typeof reviewVisualPair!=='function') {
        blocked.push('INDEPENDENT_IMAGE_REVIEW_NOT_CONNECTED');
      }
      if (visualPair?.reviewCriteria===null || visualPair===null) {
        blocked.push('APPROVED_REFERENCE_DECISIONS_NOT_BOUND');
      }
      const feedback=visualPreflights.get(p.expectedSha256);
      if(feedback?.criteria_review?.status!=='ALL_MET') {
        blocked.push('APPROVED_REFERENCE_DECISIONS_NOT_MET');
      }
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
      const reviewFaces=pagedFaceLedger?.sourceModelSha256===p.expectedSha256?
        pagedFaceLedger.faces:feedback?.reviewedFaces;
      if (!Array.isArray(reviewFaces) || reviewFaces.length===0) {
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
      const readCoverage=sourceCoverageReader(p);
      let sourceCandidates=0, unresolvedFaces=0;
      // The full native six-face inventory, not a shortlist chosen by
      // the guest/reviewer and not just alpha warnings, defines coverage.
      const requiredFaces=new Map();
      const attentionFaces=new Map();
      let scanError=null;
      while (pages<MAX_SOURCE_COVERAGE_PAGES) {
        let receipt;
        try {
          receipt=await readCoverage(cursor,totalCubes);
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
      const reviewerFaces=new Map(reviewFaces.map(item=>[
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
      if (reviewFaces.some(item=>
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
          if (!Array.isArray(evidence.review_hints) ||
              evidence.review_hints.length>8 ||
              evidence.review_hints.some(h=>
                typeof h!=='string' || h.length>96) ||
              (evidence.status==='REVIEW_REQUIRED' &&
               evidence.review_hints.length===0) ||
              (evidence.status==='NOT_EVALUATED' &&
               evidence.review_hints.length>0) ||
              (evidence.status==='BASE_ONLY_CANDIDATE' &&
               !evidence.review_hints.includes(
                 'UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE'))) {
            blocked.push('REVIEWED_FACE_SOURCE_INSPECTION_INVALID');
            break;
          }
          if (selected.style==='STYLED' &&
              evidence.review_hints.some(h=>STYLING_FINISH_VETO_HINTS.has(h))) {
            blocked.push('BAND_OR_NOISE_FACE_CANNOT_CLAIM_STYLED');
          }
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
      if (typeof receipt?.sha256 !== 'string' || !SHA256.test(receipt.sha256)) {
        throw new Error('CODE_MODE_RUST_NEW_RECEIPT_UNVERIFIED');
      }
      return { receipt, ...await register(output, receipt.sha256.toLowerCase()) };
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
      // Reviewer-backed FORM_SHADING samples and propagation use the
      // same deterministic cluster-to-Rust guarded face Paint compiler.
      // Guest-supplied operations are not authoritative for this path.
      let activeOperations=args.operations;
      let proposedPacket;
      if(args.materialWorkPacket!==undefined) {
        try {
          proposedPacket=normalizedMaterialWorkPacket(args.materialWorkPacket);
        } catch {
          throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_INVALID');
        }
        if(proposedPacket?.shadingIntent==='FORM_SHADING') {
          if(args.operations!==undefined) {
            throw new Error('CODE_MODE_MATERIAL_CLUSTER_HOST_OWNED');
          }
          activeOperations=compileMaterialClusterPaint(proposedPacket);
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
      if(pixelEdit && visualPair?.referencePackageBinding){
        await assertApprovedWorkspaceReferenceFresh(
          visualPair.referencePackageBinding);
      }
      // Domain-separated operation identity allows a real reviewer to
      // reject an exact replay despite renamed approach or treatment labels.
      // It is never itself a material/artistic verdict or permission.
      const paintPlanSha256=pixelEdit ?
        paintOperationsFingerprint(activeOperations):null;
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
        if(visualPair.reviewCriteria!==null){
          const evidence=feedback.criteria_review?.assessments?.find(
            item=>item.id===materialIntent.issueId &&
              item.verdict==='VIOLATED');
          if(!evidence || !criterionPermitsPaint(visualPair.reviewCriteria,
              materialIntent,requested)) {
            throw new Error('CODE_MODE_REVIEW_CRITERION_SCOPE_MISMATCH');
          }
        }
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
        if (feedback.rejectedPaintPlans.some(item=>
            item.partId===materialIntent.partId &&
            item.textureUuid===requested.texture_uuid &&
            item.fingerprintSha256===paintPlanSha256)) {
          throw new Error('CODE_MODE_MATERIAL_REJECTED_OPERATION_REPLAY');
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
          if (!correctionFitsReview(requested,{
            textureUuid:feedback.correctionScope.textureUuid,
            allowedRegions:[cohort.sampleRegion],
            preserveAlpha:feedback.correctionScope.preserveAlpha,
          })) throw new Error('CODE_MODE_MATERIAL_SAMPLE_REGION_REQUIRED');
          // A reviewed flat-material defect needs form-following clusters
          // even in the FIRST sample. Do not accept another generic base fill.
          // Small identity/detail corrections retain their direct pixel path.
          if (issue.kind==='FLAT_SHADING' && !proposedPacket) {
            throw new Error('CODE_MODE_MATERIAL_FORM_SAMPLE_PACKET_REQUIRED');
          }
          if (proposedPacket) {
            const facePlan=proposedPacket.facePlans[0];
            const exact=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
              a.length===2&&b.length===2&&a.every((n,i)=>n===b[i]);
            if (proposedPacket.shadingIntent!=='FORM_SHADING' ||
                proposedPacket.facePlans.length!==1 ||
                facePlan.cubeUuid!==cohort.cubeUuid ||
                facePlan.face!==cohort.face ||
                !requested.allowed_regions.some(region=>
                  exact(region.from,facePlan.atlasRegion.from) &&
                  exact(region.to,facePlan.atlasRegion.to))) {
              throw new Error('CODE_MODE_MATERIAL_SAMPLE_FORM_PLAN_MISMATCH');
            }
            workPacket=proposedPacket;
          }
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
          // This is exactly the packet already normalized at host admission.
          // Preserve the validated identity through preflight and approval.
          workPacket=proposedPacket;
          if(!workPacket){
            throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_REQUIRED');
          }
          if(!Array.isArray(feedback.correctionScope.editableBeforeRgba) ||
             feedback.correctionScope.editableBeforeRgba.length===0){
            throw new Error('CODE_MODE_REVIEWED_SOURCE_COLOR_GUARD_REQUIRED');
          }
        }
        if(workPacket) {
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
          // Rust validates every face-local cluster span after canonical
          // signed/rotated UV projection, not just the atlas patch outline.
          const bounded=await p.inspectBatch(workPacket.facePlans.map(face=>({
            kind:'material_face_patch',
            texture_uuid:workPacket.textureUuid,
            cube_uuid:face.cubeUuid,
            face:face.face,region:face.atlasRegion,
            ...(workPacket.shadingIntent==='FORM_SHADING'?{
              face_spans:materialFaceClusters(face,workPacket.palette).flatMap(cluster=>cluster.spans),
            }:{}),
          })));
          if(bounded.sha256!==p.expectedSha256 ||
             bounded.results?.length!==workPacket.facePlans.length ||
             workPacket.facePlans.some((face,i)=>{
               const actual=bounded.results[i];
               const binding=actual?.binding;
               const form=binding?.surface_form;
               const normal=SOURCE_FACE_NORMALS[face.face];
               const validSourceForm=form?.scope==='saved_cube_face_form_context' &&
                 form?.cube_uuid===face.cubeUuid && form?.face===face.face &&
                 Array.isArray(form?.normal_cube_local) &&
                 form.normal_cube_local.length===3 &&
                 form.normal_cube_local.every((n,j)=>n===normal[j]) &&
                 ['PARENT_LOCAL_STATIC_AXIS_ALIGNED_ONLY',
                  'UNVERIFIED_CUBE_TRANSFORM_OR_HIERARCHY'].includes(
                    form?.contact_analysis?.status) &&
                 form?.contact_analysis?.checked_scope===
                   'static_direct_parent_cube_siblings_only' &&
                 form?.lighting_verdict==='UNVERIFIED' &&
                 form?.world_visibility_verdict==='UNVERIFIED' &&
                 form?.form_shading_verdict==='UNVERIFIED' &&
                 form?.visual_verdict==='UNVERIFIED';
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
                 (workPacket.shadingIntent==='FORM_SHADING' && !validSourceForm) ||
                 (workPacket.shadingIntent==='FORM_SHADING' && (
                   binding?.cluster_footprint?.scope!=='saved_face_local_to_atlas' ||
                   binding?.cluster_footprint?.status!=='within_selected_patch' ||
                   binding?.cluster_footprint?.visual_verdict!=='UNVERIFIED' ||
                   binding?.cluster_footprint?.span_count!==materialFaceClusters(face,workPacket.palette).reduce(
                     (sum,cluster)=>sum+cluster.spans.length,0))) ||
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
      let receipt, publishedSha;
      try {
        receipt = await p.apply({ output, operations: activeOperations,
          correctionScope: effectiveCorrectionScope,
          ...(materialIntent ? {correctionIntent:materialIntent} : {}),
          ...(workPacket ? {materialWorkPacket:workPacket} : {}) });
        publishedSha = verifiedModelMutationSha(
          receipt, p.expectedSha256, activeOperations.length);
      } catch (error) {
        if (reviewedTextureSession && pixelEdit &&
            (error?.message==='CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED' ||
             error?.message==='CODE_MODE_RUST_MUTATION_RECEIPT_UNVERIFIED')) {
          // Rust may have published a sibling despite malformed output.
          // Freeze this reviewed source revision: a renamed retry would
          // conceal the unresolved native result from the operator.
          completedReviewedCorrections.add(p.expectedSha256);
        }
        throw error;
      }
      if (visualPair !== null && typeof reviewVisualPair === 'function' && pixelEdit) {
        // The CLI committed its no-overwrite result. Even if registering
        // its next handle fails, retrying the same snapshot is unsafe.
        completedReviewedCorrections.add(p.expectedSha256);
      }
      // Reopen through native Rust inspection and compare the actual saved
      // model SHA for every edit, not only scoped Paint corrections.
      const next=await register(output, publishedSha);
      return { receipt, ...next,
        ...(pixelEdit?{texturing_workflow:{
          status:'PAINT_SAVED_NOT_VISUALLY_ACCEPTED',
          source_model_sha256:next.sha256,
          operation_plan_fingerprint_sha256:paintPlanSha256,
          style_evidence:receipt.texture_styling_evidence??null,
          source_pixel_guards:{
            protected_regions:effectiveCorrectionScope?.protectedRegions?.length??0,
            expected_before_pixels:effectiveCorrectionScope?.expectedBeforePixels?.length??0,
            editable_before_rgba:effectiveCorrectionScope?.editableBeforeRgba?.length??0,
            verified_by_rust_receipt:receipt.correction_scope?.status==='enforced' &&
              receipt.correction_scope.protected_regions===
                (effectiveCorrectionScope?.protectedRegions?.length??0) &&
              receipt.correction_scope.expected_before_pixels===
                (effectiveCorrectionScope?.expectedBeforePixels?.length??0) &&
              receipt.correction_scope.editable_before_rgba===
                (effectiveCorrectionScope?.editableBeforeRgba?.length??0),
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
      const publishedSha = verifiedModelMutationSha(receipt, p.expectedSha256, 1);
      return { receipt, ...await register(output, publishedSha) };
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
    const execution = {
      closed: false, pendingApproval: false, pause: () => {}, resume: () => {},
      metrics: createExecutionMetrics(pureLiveRead ? 'NO_DISK_RUST' :
        (runner ? 'INJECTED_RUNNER' : 'CLI_EXECFILE')),
    };
    const metrics = () => execution.metrics.snapshot();
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
    let outcome = 'ERROR';
    try {
    const result = await new Promise((resolve, reject) => {
      let closed = false;
      let concluded = null;
      let failure = null;
      let buffered = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let calls = 0;
      let pendingRpc = 0;
      // Byte counts of admitted RPC frames vs the final guest-selected
      // value. This observes context projection, not tokens or elapsed time.
      let rpcResponseBytes = 0;
      let modelResultBytes = 0;
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
        if (!closed && !child.stdin.destroyed) {
          child.stdin.write(data);
          rpcResponseBytes += Buffer.byteLength(data, 'utf8');
        }
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
          modelResultBytes = resultBytes;
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
        const rpcStarted = execution.metrics.mark();
        try {
          try {
            const value = await metricScope.run(execution, () =>
              actions[message.method](requireObject(message.args[0])));
            send({ type: 'rpc_result', id: message.id, ok: true, result: value });
          } catch (error) {
            execution.metrics.recordRpcFailure();
            send({ type: 'rpc_result', id: message.id, ok: false,
              code: shortError(error) });
          }
        } finally {
          execution.metrics.recordRpcSince(rpcStarted);
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
          execution.metrics.recordFirstGuestFrame();
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
            rpc_response_bytes: rpcResponseBytes,
            model_result_bytes: modelResultBytes,
            performance: metrics(),
          }));
        }).catch(reject);
      });
      child.stdin.write(start);
    });
    outcome = 'OK';
    return result;
    } finally {
      // The optional trusted observer is the sole failure-sample outlet.
      // Never log model/source strings, guest scripts, selected names,
      // paths, PNGs, pairing tokens or raw errors. It cannot change the
      // tool's real execution result.
      if (observeExecutionMetrics) {
        try { observeExecutionMetrics(Object.freeze({
          outcome, performance: metrics(),
        })); } catch {}
      }
    }
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
    description: [
      'Use ONE isolated Code Mode script over the typed Rust SDK. Return only decision-relevant JSON, current source SHA and blockers, never entire native receipts. Rust owns document, UV/PNG, animation, Undo and file publication. At Start/Resume read codemode.initial.workflow once when supplied: SOURCE_BOUND means only file/stage declarations match, not artistic approval; BLOCKED means reconcile the existing asset README/source before any write. The host rechecks it before mutation.',
      'Choose the smallest source lookup ONCE: known UUID => focused inspect or direct typed edit; one unknown saved name => taskContext (one verified authoring_target read); several related facts => inspectBatch. Do not call taskContext AND inspectBatch for the same lookup. Never guess UUIDs from names or screenshots.',
      'Unknown-name example: const t=await codemode.taskContext({project:codemode.initial.project,domain:"texturing",category:"cubes",name:"Helmet"}); return {sha:t.source_model_sha256,status:t.status,uuid:t.target?.uuid??null,blockers:t.source_blockers,candidates:t.status==="EXACT_MATCH"?undefined:t.candidates};',
      'Geometry: one known Cube/Bone correction => bounded EditPlan; dependent structural cohort => planGeometryAssembly with explicit Bone pivots and UUIDs, including frames/hollow_boxes/arches/sweeps/profile_sweeps/lofts/revolves/rib_arrays as needed. Use planGeometryAttachment or planGeometryResizePropagation only for supported same-Bone relationships. Optional void_zones and geometry_impact are bounded advisories, not whole-model collision, motion, UV or visual proof.',
      'Texturing: known exact RGBA and UV => one guarded Paint/face cohort rather than a per-pixel tool loop. For a supported painted_metal reference-selected face, planSemanticMaterial may propose a candidate, not accepted artwork. Preserve source RGBA, alpha, UV ownership, existing details and approved areas. For broad styling, require the existing representative-sample and independent matched-view review before propagation; do not infer quality from color statistics.',
      'Animation: for an EXISTING saved numeric clip use reviewExistingAnimation once (exact animation_uuid), optionally with a caller-authorized source-preconditioned single-key correction; report source issues with Bone/channel/key IDs, never auto-fix ambiguous Euler/curves/contact. A returned correction preflight is NOT approval or native playback PASS. Group coherent exact Bone/clip/keyframe operations in one EditPlan; reuse editable clips with duplicate_animation_clip when valid. For a NEW authored action/gait with exact semantic poses, use planSemanticAnimation once; optional followers derive one-level delayed source-linear rotation/position deltas (explicit Bone UUIDs, lag_seconds, gain and rest_value), not IK, springs or inferred contact. Contact windows and temporal review times are hints, never native foot locking, world-space contact, or playback PASS. Optional probes use one source-model ZYX Bone hierarchy and bounded pivot-local marker positions; sampled displacement is advisory only, not continuous native motion, entity travel, physical contact, IK, or visual acceptance. For exact new semantic poses, optional per-transform interpolation can select native Step or Catmull-Rom, but not Bezier without explicit handles; this is authored-key timing, not sampled visual quality. Use native Step/Catmull-Rom/Bezier on other routes only when the intended motion calls for them. planPeriodicRotation is only for explicit periodic numeric Bone rotation with a bounded scalar error; not IK, contact, physics, continuous 3D pose accuracy or playback acceptance.',
      'Every first-party plan* response with a valid Rust preflight already dry-runs its exact plan. Do NOT call preflightGuidance or standalone preflight again when that same validated planner result, source SHA, operations and correction_scope are unchanged. If the plan was rewritten, unverified or lacks matching preflight, use source-bound preflight for nontrivial changes. Preflight is NOT write authority or visual approval; Apply independently revalidates SHA/revision, scoped pixels, permissions and output.',
      'Use semanticMap only for bounded identity inventories; taskContext only for a single unknown-name target. planReviewedGeometryReframe requires a separately trusted operator-bound landmark and matched view. All inferred geometry/UV/animation relationships remain UNVERIFIED until source and visual review.',
      ...(host.initial?.liveReadOnly ? [
        'A paired GUI live session supports liveSessionInfo and liveSemanticMap READ ONLY with exact epoch/revision; it is separate from saved-file Code Mode. Never attempt live writes.'
      ] : []),
      'Apply only after exact source selection and trusted-host mutation approval, preferably in the SAME Code Mode script after necessary inspection. Group related work without unrelated changes; no implicit saves, unreviewed texture propagation, blind retry of uncertain outcomes, shell, network or direct file access. After New/Apply/Import return one latest candidateFile and sha256 from a verified saved receipt for manual LazyDesigner review, never as artistic approval. Review affected consumers and fresh full visual views where quality acceptance requires them.'
    ].join(' '),
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: { code: { type: 'string', minLength: 1, maxLength: 32768 } },
    }),
    execute: ({ code }) => host.execute({ code }),
  });
}

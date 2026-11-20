/** Trusted, source-pinned still PNG inputs and geometry-image bindings.
 * No model-authored paths, visual-quality PASS or persistent image store.
 * SOURCE_AUTHORED_NOT_RUN.
 */
import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {boundReviewCriteria} from './review-criteria.mjs';
import {bindApprovedWorkspaceReference} from './approved-reference-package.mjs';
import {SHA256,requireAbsolute,regularFile} from './trusted-local-files.mjs';

const MAX_VISUAL_PNG_BYTES = 8 * 1024 * 1024;
const VISUAL_VIEWS = new Set([
  'front', 'back', 'left', 'right', 'top', 'bottom', 'three_quarter',
]);
const CARDINAL_VIEWS = Object.freeze(['front','back','left','right','top','bottom']);
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


export {CARDINAL_VIEWS,pinnedVisualPng,compactMaskMismatch,boundGeometryLandmark,
  confirmedGeometryCube,regionMatchesFocus,pinnedVisualPair,
  pinnedReviewBytes,pinnedReviewImageLeaseValid};

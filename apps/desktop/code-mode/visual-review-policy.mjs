/** Trusted-only reviewer admission and pixel correction policy.
 * No guest I/O, permission callback, state store or model publisher.
 * SOURCE_AUTHORED_NOT_RUN.
 */
import {normalizedCorrectionScope} from './client.mjs';

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
export {normalizedVisualReview,overlapsRectangle,correctionFitsReview,mergeReviewedPixelGuards};

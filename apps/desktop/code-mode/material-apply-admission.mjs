/**
 * Source-bound material Apply admission before the host can request
 * permission, publish a candidate, or call the Rust writer.
 *
 * Checks reviewed Texture scope, sampled material cohort, six-view
 * propagation, signed/rotated UV face evidence, and deterministic
 * form-shading input. Inspects SHA-pinned Rust source but never publishes.
 * Prepared operations do not grant artistic approval or mutation authority.
 * SOURCE_ONLY; TEST_AUTHORED_NOT_RUN.
 */
import {normalizedCorrectionScope,normalizedMaterialCorrectionIntent}
  from './texture-correction-contract.mjs';
import {correctionFitsReview,mergeReviewedPixelGuards,overlapsRectangle}
  from './visual-review-policy.mjs';
import {normalizedMaterialWorkPacket,compileMaterialClusterPaint,
  paintOperationsFingerprint,validateMaterialWorkPacketOperations,
  materialFaceClusters} from './material-work-packet.mjs';
import {criterionPermitsPaint} from './review-criteria.mjs';
import {CARDINAL_VIEWS,pinnedReviewBytes}
  from './visual-source-binding.mjs';
import {assertApprovedWorkspaceReferenceFresh}
  from './approved-reference-package.mjs';

const PIXEL_MUTATIONS = new Set([
  'paint_texture_pixel', 'paint_texture_stroke', 'paint_texture_brush',
  'paint_texture_rectangle', 'paint_texture_rectangles',
  'paint_cube_uv_faces', 'paint_cube_uv_faces_guarded',
  'paint_cube_face_regions_guarded', 'recolor_cube_faces_palette_guarded',
  'paint_texture_fill', 'isolate_cube_box_uv',
]);

const SOURCE_FACE_NORMALS=Object.freeze({
  north:[0,0,-1],east:[1,0,0],south:[0,0,1],
  west:[-1,0,0],up:[0,1,0],down:[0,-1,0],
});

/** Only validates requested source guards and returns an intent for host Apply. */
export async function prepareMaterialApplyAdmission({
  args, model:p, visualPair, reviewVisualPair, visualViews,
  visualPreflights, completedReviewedCorrections, referenceMaster,
}) {
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
      return {
        reviewedTextureSession, activeOperations, pixelEdit,
        paintPlanSha256, materialIntent, workPacket, effectiveCorrectionScope,
      };
}

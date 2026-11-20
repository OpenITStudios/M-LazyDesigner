/**
 * Read-only, source-SHA-bound inspection of one operator-selected visual pair
 * and its bounded reviewer/source-face evidence. This is not an image model,
 * renderer, authorizer, file publisher or independent approval store.
 *
 * The trusted host retains the only current review ledger, pause/resume
 * lifecycle and SHA-bound image leases. Getter/setter bridges intentionally
 * re-read live host state after awaits so stale reviews cannot be accepted.
 *
 * SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
 */
import {normalizedVisualReview} from './visual-review-policy.mjs';
import {compactMaskMismatch,confirmedGeometryCube,regionMatchesFocus,
  pinnedReviewBytes} from './visual-source-binding.mjs';
import {sourceFacesForImageReviewer} from './source-face-coverage.mjs';
import {checkedCriterionReview} from './review-criteria.mjs';
import {assertApprovedWorkspaceReferenceFresh}
  from './approved-reference-package.mjs';
import {MAX_FACES_PER_REVIEW,planPagedSourceFaceReview,
  requireAcceptedFaceReviewPage,sourceFaceStyleConsistent}
  from './paged-face-review.mjs';

export async function inspectSelectedVisualPair(args,state) {
  // The selected project callback is the trusted host's SHA-bound handle map.
  const {selected,client,visualPair,visualViews,reviewVisualPair,
    visualPreflights,geometryLandmark}=state;

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
      if (visualViews.length > 1 && state.verifiedMultiViewRead !== null) {
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
        return state.verifiedMultiViewRead;
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
        const execution = state.activeExecution;
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
        if (execution.closed || state.activeExecution !== execution) {
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
        if (execution.closed || state.activeExecution !== execution) {
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
        if(execution.closed || state.activeExecution!==execution) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        // Only publish the transient full-face ledger after exact model and
        // every selected PNG are fresh again. Failed mid-page evidence is
        // never cached or promoted to a guest-visible readiness result.
        if(pendingFaceLedger) state.pagedFaceLedger=pendingFaceLedger;
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
      state.verifiedGeometryLandmark=landmarkEvidence;
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
        state.verifiedMultiViewRead=Object.freeze(readReceipt);
      }
      return readReceipt;
}

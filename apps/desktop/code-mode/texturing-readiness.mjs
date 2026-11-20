/**
 * Source/visual Texture readiness review only. Never approves artwork or
 * authorizes Rust mutation; live host state remains accessible by getters.
 * SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
 */
import {CARDINAL_VIEWS,pinnedReviewBytes} from './visual-source-binding.mjs';
import {sourceCoverageReader,MAX_SOURCE_COVERAGE_PAGES}
  from './source-face-coverage.mjs';
import {assertApprovedWorkspaceReferenceFresh}
  from './approved-reference-package.mjs';

// These patterns repeatedly passed numeric color-count checks in Local
// Pillager sessions while still failing the required material finish.
const STYLING_FINISH_VETO_HINTS = new Set([
  'UNIFORM_HORIZONTAL_BANDS_REVIEW',
  'UNIFORM_VERTICAL_BANDS_REVIEW',
  'FRAGMENTED_OR_NOISE_FIRST_REVIEW',
]);

export async function inspectTexturingReadiness(args,state) {
      const p=state.selected(args);
      if (Object.keys(args).some(key=>key!=='project')) {
        throw new Error('CODE_MODE_TEXTURING_READINESS_ARGUMENT_INVALID');
      }
      if(state.visualPair?.referencePackageBinding){
        await assertApprovedWorkspaceReferenceFresh(
          state.visualPair.referencePackageBinding);
      }
      const blocked=[];
      if (state.visualPair===null || p.expectedSha256!==state.visualPair.modelSha) {
        blocked.push('CURRENT_REVISION_RENDERED_VIEW_SET_MISSING');
      }
      if (typeof state.reviewVisualPair!=='function') {
        blocked.push('INDEPENDENT_IMAGE_REVIEW_NOT_CONNECTED');
      }
      if (state.visualPair?.reviewCriteria===null || state.visualPair===null) {
        blocked.push('APPROVED_REFERENCE_DECISIONS_NOT_BOUND');
      }
      const feedback=state.visualPreflights.get(p.expectedSha256);
      if(feedback?.criteria_review?.status!=='ALL_MET') {
        blocked.push('APPROVED_REFERENCE_DECISIONS_NOT_MET');
      }
      if (!feedback || feedback.decision!=='ACCEPTED') {
        blocked.push('CURRENT_REVISION_NOT_ACCEPTED_BY_REVIEWER');
      }
      if (state.visualPair===null || !state.visualPair.requireSixDirections ||
          CARDINAL_VIEWS.some(name=>
            !state.visualViews.some(view=>view.viewId===name)) ||
          feedback?.viewReviews.length!==state.visualViews.length ||
          feedback?.viewReviews.some(view=>view.decision!=='ACCEPTED')) {
        blocked.push('SIX_DIRECTION_REVIEW_INCOMPLETE');
      }
      const base={
        scope:'saved_model_texture_workflow_review',
        source_model_sha256:p.expectedSha256,
        reviewer_declaration:feedback?.decision ?? 'UNVERIFIED',
        view_count:state.visualViews.length,
        visual_verdict:'UNVERIFIED',
        texture_completion_attested:false,
      };
      const reviewFaces=state.pagedFaceLedger?.sourceModelSha256===p.expectedSha256?
        state.pagedFaceLedger.faces:feedback?.reviewedFaces;
      if (!Array.isArray(reviewFaces) || reviewFaces.length===0) {
        blocked.push('MATERIAL_FACE_REVIEW_SCOPE_MISSING');
      }
      if (blocked.length) return {...base,status:'BLOCKED',
        blockers:blocked,face_scan:null,material_faces:null,
        next:'Obtain actual approved/current matched views, reviewer-selected Cube faces and independent review.'};
      // Recheck image bytes AFTER review and BEFORE this read-only decision.
      // A renamed/replaced file cannot inherit accepted view evidence.
      await Promise.all(state.visualViews.flatMap(view=>[
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

}

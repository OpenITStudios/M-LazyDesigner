/** First-party Rust Code Mode host and guest tool types.
 * SOURCE_ONLY: installed host/Deno/Rust execution NOT_EXECUTED. */
import type {MaterialWorkPacket} from './material-work-packet.mjs';
import type {
  ApplyReceipt, CatalogPage, DocumentSummary, EditOperation, Vec3,
  InspectBatchQuery, InspectBatchReceipt, InspectReceipt,
  MutationRequest, OutputReceipt, TextureCorrectionScope,
  MaterialPatchRegion, MaterialPairComparison, VisualPairReceipt,
  MaterialCorrectionIntent, MaterialFacePatchBinding, CubeFaceSurface, SemanticModelMap,
  GeometryAssemblyRequest, GeometryAssemblyReceipt,
  GeometryFaceAttachmentRequest, GeometryFaceAttachmentReceipt,
  GeometryResizePropagationRequest, GeometryResizePropagationReceipt,
  SemanticMaterialIntent, SemanticMaterialProposalReceipt,
  PeriodicRotationIntent, PeriodicRotationReceipt,
  SemanticAnimationIntent, SemanticAnimationReceipt,
} from './client.mjs';

export interface CodeModeProjectReference {
  project: string;
  sha256: string;
  summary: DocumentSummary;
}
export interface CodeModeInitialReference {
  project: string | null;
  sha256: string | null;
  summary: DocumentSummary | null;
  /** Indicates a trusted read-only local bridge, not a mutable project handle. */
  liveReadOnly?: true;
}
/** Observational counters from trusted host only. Millisecond measures
 * overlap: never sum wall, RPC, adapter or approval wait as independent
 * time. Model/code/pixel/secret content is never included. */
export interface CodeModePerformance {
  wall_ms: number;
  /** First complete Deno output frame, NOT isolated V8 startup time. */
  guest_first_frame_ms: number | null;
  host_rpc_ms: number;
  rust_adapter_ms: number;
  rust_adapter_calls: number;
  rust_adapter_failures: number;
  approval_wait_ms: number;
  rpc_failures: number;
  rust_adapter_kind: "NO_DISK_RUST" | "CLI_EXECFILE" | "INJECTED_RUNNER";
}
export interface CodeModeTaskContext {
  scope: "sha_bound_semantic_task_context";
  source_model_sha256: string; source_revision: number;
  project: string; domain: string; category: string; requested_name: string;
  status: "EXACT_MATCH"|"AMBIGUOUS_NAME"|"IDENTITY_MISSING"|"NO_EXACT_MATCH";
  candidate_count: number; candidates_truncated: boolean;
  candidates: Array<{uuid: string|null; name: string|null; index: number}>;
  target: null | {
    uuid: string; index: number; name: string;
    parent_uuid?: string|null;
    geometry?: {from: number[]|null; to: number[]|null; origin: number[]|null};
    uv?: {box_uv:boolean|null; auto_uv:number|null; per_texture_rules:boolean|null};
    face_links?: Array<{side:string; reference_kind:string;
      texture_uuid:string|null; uv_zero_span:boolean}>;
    asset_kind?: string; source_kind?: string|null;
  };
  candidate_operations: string[];
  source_blockers: string[];
  write_authority: "NOT_GRANTED";
  visual_verdict: "UNVERIFIED";
  next: string;
}
export interface PreflightGuidance {
  source_model_sha256: string; source_revision: number;
  scope: "advisory_typed_plan_preflight";
  recommendation: "OPTIONAL"|"RECOMMENDED";
  reasons: string[];
  operation_count: number; operation_kinds: string[];
  operation_kinds_truncated: boolean;
  validation_authority: "RUST_APPLY_ALWAYS_REQUIRED";
  write_authority: "NOT_GRANTED";
  visual_verdict: "UNVERIFIED";
}
export interface CodeModeRunReceipt {
  status: "OK";
  value: unknown;
  logs: string[];
  /** Count of guest-to-host RPC calls, not model-facing tool invocations. */
  rpc_calls: number;
  /** Total UTF-8 bytes in serialized RPC reply frames admitted to the guest,
   * including envelopes; NOT billed model tokens or file bytes. */
  rpc_response_bytes: number;
  /** UTF-8 JSON bytes in the final value returned for model consumption,
   * excluding tool envelope/logs. Not a quality/efficiency PASS claim. */
  model_result_bytes: number;
  /** Observed time and call counters, not an accepted quality result. */
  performance: CodeModePerformance;
}
export interface CodeModeTexturingReadinessReceipt {
  scope:"saved_model_texture_workflow_review";
  source_model_sha256:string;
  reviewer_declaration:"ACCEPTED"|"REJECTED"|"UNVERIFIED";
  view_count:number;visual_verdict:"UNVERIFIED";
  texture_completion_attested:false;
  status:"BLOCKED"|"REVIEWER_DECLARED_READY_FOR_USER_DECISION";
  blockers:string[];
  face_scan:{
    scanned_cubes:number;total_cubes:number|null;
    source_review_candidates:number;
    source_attention_faces_reviewed:number;
    source_attention_faces_unreviewed:number;
    unresolved_source_faces:number;
    complete:boolean;
  }|null;
  material_faces:{
    scope:"reviewer_selected_cube_faces_only";
    expected:number;inspected:number;
    intentional_flat_exceptions:number;intentional_transparent_exceptions:number;
    styling_warning_candidates:number;
  }|null;
  next:string;
}
export interface CodeModeGeometryLandmarkEvidence {
  cube_uuid:string; parent_bone_uuid:string;
  source_name:string|null; source_from:Vec3;source_to:Vec3;
  landmark_label:string;view_id:CodeModeVisualViewId;
  mismatch_kind:"missing"|"excess";
  region_bounds:Readonly<[number,number,number,number]>;
  source_model_sha256:string;
  reference_png_sha256:string;capture_png_sha256:string;
  identity_status:"SOURCE_UUID_VERIFIED";
  image_correspondence:"OPERATOR_DECLARED_UNVERIFIED";
  write_authority:"NOT_GRANTED";visual_verdict:"UNVERIFIED";
}
export interface CodeModeGuestAPI {
  /** Null project indicates a New-model bootstrap in a trusted directory. */
  initial: CodeModeInitialReference;
  liveSessionInfo(args: Record<string, never>): Promise<{
    status: "OK"; epoch: number; revision: number;
    summary: DocumentSummary; dirty: boolean;
    write_authority: "NOT_GRANTED"; visual_verdict: "UNVERIFIED";
  }>;
  liveSemanticMap(args: {
    expectedEpoch: number; expectedRevision: number;
    category: "cubes" | "bones" | "textures" | "animations";
    offset?: number; limit?: number;
  }): Promise<{
    status: "OK"; epoch: number; revision: number;
    summary: DocumentSummary; map: SemanticModelMap;
  }>;
  projectInfo(args: { project: string }): Promise<CodeModeProjectReference>;
  inspect(args: { project: string; uuid: string }): Promise<InspectReceipt>;
  catalog(args: { project: string; kind: CatalogPage["kind"]; offset?: number; limit?: number }): Promise<InspectReceipt>;
  inspectBatch(args: { project: string; requests: InspectBatchQuery[] }): Promise<InspectBatchReceipt>;
  /** Read-only G1 assembly proposal; a later Apply remains independently approved. */
  planGeometryAssembly(args: {
    project:string; assembly:GeometryAssemblyRequest;
  }): Promise<GeometryAssemblyReceipt>;
  /** Read-only semantic painted-metal proposal. Source/reference string
   * is NOT artistic approval. No material/texture mutation occurs here.
   */
  planSemanticMaterial(args:{
    project:string;intent:SemanticMaterialIntent;
  }):Promise<SemanticMaterialProposalReceipt>;
  /** A1 read-only existing Rust planner; no host write grant. */
  planPeriodicRotation(args:{
    project:string;intent:PeriodicRotationIntent;
  }):Promise<PeriodicRotationReceipt>;
  /** Read-only exact pose compiler; contacts require independent native proof. */
  planSemanticAnimation(args:{
    project:string;intent:SemanticAnimationIntent;
  }):Promise<SemanticAnimationReceipt>;
  /** G2 read-only same-Bone face alignment, never a persistent relation. */
  planGeometryAttachment(args: {
    project:string; attachment:GeometryFaceAttachmentRequest;
  }): Promise<GeometryFaceAttachmentReceipt>;
  /** Read-only one-shot resize propagation, not a persisted relation graph. */
  planGeometryResizePropagation(args: {
    project:string; propagation:GeometryResizePropagationRequest;
  }): Promise<GeometryResizePropagationReceipt>;
  /** One source-confirmed, operator-bound Cube. Only canonical Rust
   * ReframeCube preflight runs; no 3D inference or permission grant. */
  planReviewedGeometryReframe(args: {
    project:string;from:Vec3;to:Vec3;
    uvPolicy:"box_repack"|"manual_preserve";
  }): Promise<{
    status:"OK";source_model_sha256:string;
    geometry_landmark:CodeModeGeometryLandmarkEvidence;
    plan:{expected_revision:0;
      operations:Array<Extract<EditOperation,{op:"reframe_cube"}>>;
      correction_scope:null};
    preflight:PreflightReceipt["preflight"];
    write_authority:"NOT_GRANTED";visual_verdict:"UNVERIFIED";
  }>;
  /** One authoritative authoring_target inspection, compacted by trusted host. */
  taskContext(args: {
    project:string; domain:"geometry"|"uv"|"texturing"|"animation";
    category:"cubes"|"bones"|"textures"|"animations"; name:string;
  }): Promise<CodeModeTaskContext>;
  /** Advisory only; this does not execute native preflight or Apply. */
  preflightGuidance(args: {
    project:string; operations:EditOperation[];
    correctionScope?:TextureCorrectionScope;
  }): Promise<PreflightGuidance>;
  /** Host injects the operator-selected master UUID; the guest cannot supply it. */
  inspectApprovedMaterial(args: {
    project: string; candidateTextureUuid: string;
    referenceRegion: MaterialPatchRegion; candidateRegion: MaterialPatchRegion;
  }): Promise<InspectBatchReceipt & {
    results: Array<{kind:"material_pair"; comparison:MaterialPairComparison}>;
    reference_binding:{
      kind:"operator_selected_model_texture";
      reference_texture_uuid:string;
      source_model_sha256:string;
      visual_verdict:"UNVERIFIED";
    };
  }>;
  /** Source-grounded Cube ID; pixel correspondence is only operator-declared,
   * never camera-proven, and is not write authority. */
  inspectSelectedVisualPair(args: { project: string }): Promise<VisualPairReceipt & {
    geometry_landmark:CodeModeGeometryLandmarkEvidence|null;
    review_feedback:{
      status:"RECORDED"|"NOT_RECORDED";
      decision:"ACCEPTED"|"REJECTED"|"UNVERIFIED";
      issues:Array<CodeModeVisualReviewerFeedback["issues"][number]>;
      correctionScope?:TextureCorrectionScope | null;
      rejectedApproaches:Array<{issueId:string;approachId:string}>;
      rejectedTreatments:Array<{
        partId:string;material:string;treatment:string;
        failedAttempts:number;observation:string;
      }>;
      rejectedPaintPlans:Array<{
        partId:string;textureUuid:string;fingerprintSha256:string;
        observation:string;
      }>;
      review_criteria:ReadonlyArray<Readonly<CodeModeReviewCriterion>>;
      criteria_review:Readonly<{
        status:"ALL_MET"|"CORRECTIONS_REQUIRED"|"UNVERIFIED";
        assessments:ReadonlyArray<Readonly<CodeModeReviewCriterionAssessment>>;
        source:"OPERATOR_SELECTED_REFERENCE_AND_INDEPENDENT_REVIEW_DECLARATION";
        visual_verdict:"UNVERIFIED";
      }> | null;
      /** Compact host-only paged material review evidence; face entries
       * remain in the trusted host, never returned in a >128 KiB guest RPC.
       */
      paged_face_review?:Readonly<{
        status:"ALL_SOURCE_PAGES_REVIEWER_DECLARED_ACCEPTED";
        source_model_sha256:string;
        page_count:number;
        reviewed_source_faces:number;
        visual_verdict:"UNVERIFIED";
      }> | null;
      reference_package_evidence?:Readonly<{
        source:"EXISTING_WORKSPACE_REFERENCE_JSON_DECLARATION";
        fingerprint_sha256:string;
        matched_images:number;
        automatically_bound_reference:number;
        visual_verdict:"UNVERIFIED";
      }> | null;
      materialCohort:Readonly<CodeModeReviewedMaterialCohort> | null;
      /** Specific model Cube faces actually reviewed; separate from camera views. */
      reviewedFaces:ReadonlyArray<Readonly<CodeModeReviewedTextureFace>>;
      viewReviews:ReadonlyArray<Readonly<{
        viewId:CodeModeVisualViewId;
        decision:"ACCEPTED"|"REJECTED"|"UNVERIFIED";
        observation:string;
      }>>;
      face_source_evidence:Readonly<{
        status:"six_saved_faces_inspected";
        cube_uuid:string;face_count:6;
        visual_verdict:"UNVERIFIED";
        face_coverage_verdict:"UNVERIFIED";
        faces:ReadonlyArray<Readonly<{
          side:CubeFaceSurface["side"];
          reference_kind:CubeFaceSurface["reference_kind"];
          texture_uuid:string|null;
          alpha_status:"measured"|"unsupported";
          transparent_pixels:number|null;
        }>>;
      }> | null;
      source:"TRUSTED_HOST_DECLARATION"|"NONE";
      visual_verdict:"UNVERIFIED";
    };
    view_evidence:ReadonlyArray<Readonly<{
      view_id:CodeModeVisualViewId;
      reference_png_sha256:string;capture_png_sha256:string;
      source_model_sha256:string;visual_verdict:"UNVERIFIED";
      silhouette_status:string;
      mask_mismatch:Readonly<{
        status:"MEASURED"|"UNASSESSED"|"UNAVAILABLE";
        missing_from_capture_pixels:number|null;
        excess_in_capture_pixels:number|null;
        reference_foreground_bounds:Readonly<[number,number,number,number]>|null;
        capture_foreground_bounds:Readonly<[number,number,number,number]>|null;
        missing_bounds:Readonly<[number,number,number,number]>|null;
        excess_bounds:Readonly<[number,number,number,number]>|null;
        priority_regions:ReadonlyArray<Readonly<{
          kind:"missing"|"excess";
          pixel_count:number;
          bounds:Readonly<[number,number,number,number]>;
        }>>;
      }>;
    }>>;
    view_scope:"six_cardinal_source_pairs_selected"|"selected_source_pairs_only";
    evidence_binding:{
      kind:"operator_selected_visual_pair";
      view_id:"front"|"back"|"left"|"right"|"top"|"bottom"|"three_quarter";
      source_model_sha256:string;
      reference_png_sha256:string;
      capture_png_sha256:string;
      visual_verdict:"UNVERIFIED";
      image_ingestion:"NOT_VERIFIED";
    };
  }>;
  /** Read-only: explicit six-view reviewer declaration + saved face/atlas scan.
   * Never native/material artistic PASS or user approval.
   */
  texturingReadiness(args:{project:string}):Promise<CodeModeTexturingReadinessReceipt>;
  inspectCubeSurfaces(args: { project: string; uuid: string }): Promise<InspectReceipt>;
  inspectCubeFaceAlpha(args: { project: string; uuid: string }): Promise<InspectReceipt>;
  inspectTexture(args: { project: string; index: number }): Promise<InspectReceipt>;
  inspectTextureAlpha(args: { project: string; uuid: string }): Promise<InspectReceipt>;
  inspectAnimation(args: { project: string; uuid: string }): Promise<InspectReceipt>;
  inspectAnimationTrack(args: {
    project: string; animationUuid: string; boneUuid: string;
    offset?: number; limit?: number;
  }): Promise<InspectReceipt>;
  inspectAnimationTransformTrack(args: {
    project: string; animationUuid: string; boneUuid: string;
    channel: "rotation" | "position" | "scale"; offset?: number; limit?: number;
  }): Promise<InspectReceipt>;
  audit(args: { project: string }): Promise<InspectReceipt>;
  newModel(args: { output: string; name: string; modelIdentifier: string }):
    Promise<CodeModeProjectReference & { receipt: OutputReceipt }>;
  /** FORM_SHADING with a connected-cluster packet is compiled by the trusted
   * host: omit operations. Existing sample/direct edits still pass operations.
   */
  apply(args: { project: string; output: string; operations?: EditOperation[]; correctionScope?: TextureCorrectionScope; correctionIntent?: MaterialCorrectionIntent; materialWorkPacket?: MaterialWorkPacket }):
    Promise<CodeModeProjectReference & { receipt: ApplyReceipt;
      texturing_workflow?:{
        status:"PAINT_SAVED_NOT_VISUALLY_ACCEPTED";source_model_sha256:string;
        /** Same ordered operation plan across revisions, NOT visual quality. */
        operation_plan_fingerprint_sha256:string;
        style_evidence:ApplyReceipt["texture_styling_evidence"];
        source_pixel_guards:{
          protected_regions:number;
          expected_before_pixels:number;
          editable_before_rgba:number;
          /** Only matching Rust receipt counts attest enforcement; no
           * artistic/reference correctness is inferred. */
          verified_by_rust_receipt:boolean;
        };
        material_work_packet?:{
          status:"SOURCE_BOUND_PLAN_NOT_ARTISTICALLY_VERIFIED";
          sha256:string;planned_faces:number;
          source_model_sha256:string;reference_png_sha256:string;
          visual_verdict:"UNVERIFIED";
        };
        next:string;texture_completion_attested:false;
      };
    }>;
  /** PNG path is selected by the trusted host, never by guest code. */
  importPng(args: { project: string; output: string; uuid: string; name: string }):
    Promise<CodeModeProjectReference & { receipt: ApplyReceipt }>;
  exportPng(args: { project: string; output: string; textureUuid: string }): Promise<OutputReceipt>;
  exportGeometry(args: { project: string; output: string }): Promise<OutputReceipt>;
  exportAnimations(args: { project: string; output: string }): Promise<OutputReceipt>;
}
export interface CodeModeHost {
  initial: CodeModeInitialReference;
  execute(input: { code: string }): Promise<CodeModeRunReceipt>;
}
/** Host-declared review result. It must derive from actual image inspection
 * by the independent operator/reviewer; the guest cannot submit it.
 * Even ACCEPTED is not a native renderer PASS.
 */
/** Reviewed atlas sample, not the normalized source-image box or a visual PASS.
 * A propagation declaration must refer to a genuinely observed accepted
 * sample in the current captured model revision.
 */
export interface CodeModeReviewedMaterialCohort {
  phase:"sample"|"propagation";
  issueId:string; partId:string; approachId:string;
  /** Native Cube face selected by the reviewer, never a screen view. */
  cubeUuid:string;face:CubeFaceSurface["side"];
  sampleRegion:{from:[number,number];to:[number,number]};
  faceBinding?:MaterialFacePatchBinding;
  sampleVerdict?:"ACCEPTED"|"UNVERIFIED";
  approval_source?:"TRUSTED_REVIEWER_DECLARATION"|"NONE";
  visual_verdict?:"UNVERIFIED";
  source_model_sha256?:string;
  reference_png_sha256?:string;
  capture_png_sha256?:string;
  view_id?:string;
}
/** Selected at the trusted operator boundary from the existing approved
 * reference/workspace decisions; not an independent approval registry.
 */
export interface CodeModeReviewCriterion {
  id:string;partId:string;
  kind:"PRESERVE"|"CORRECT"|"MATCH_REFERENCE";
  requirement:string;
  viewId:CodeModeVisualViewId;
  referencePngSha256:string;
  /** Source-image normalized box, never a Rust atlas/UV paint region. */
  sourceRegion?:{id:string;boxUv:[number,number,number,number]};
  textureUuid?:string;
  allowedRegions?:Array<{from:[number,number];to:[number,number]}>;
  protectedRegions?:Array<{from:[number,number];to:[number,number]}>;
}
export interface CodeModeReviewCriterionAssessment {
  id:string;verdict:"MET"|"VIOLATED"|"UNVERIFIED";
  observation:string;
}
/** Host-selected from a REAL rendered view comparison. Never supplied by guest. */
export interface CodeModeReviewedTextureFace {
  cubeUuid:string;
  textureUuid:string;
  face:CubeFaceSurface["side"];
  style:"STYLED"|"INTENTIONAL_FLAT"|"INTENTIONAL_TRANSPARENT";
  /** Selected and accepted view claimed to show this exact face.
   * Reviewer assertion, NOT camera/occlusion/native render proof.
   */
  observedInViewId:CodeModeVisualViewId;
  /** Why this exact face is shaded or intentionally flat in the reference. */
  observation:string;
}
export type CodeModeVisualViewId="front"|"back"|"left"|"right"|
  "top"|"bottom"|"three_quarter";
export interface CodeModeVisualReviewerFeedback {
  decision:"ACCEPTED"|"REJECTED"|"UNVERIFIED";
  /** Each supported selected PNG view must be independently observed.
   * When 2+ views are bound this complete list is mandatory.
   */
  viewReviews?:Array<{
    viewId:CodeModeVisualViewId;
    decision:"ACCEPTED"|"REJECTED"|"UNVERIFIED";
    observation:string;
  }>;
  /** Mandatory complete independent responses when reviewCriteria are bound.
   * Must account for approved preserved and still-correctable art traits.
   */
  criteriaReviews?:CodeModeReviewCriterionAssessment[];
  /** Required by a texturingReadiness decision; arbitrary six-view labels
   * do not prove the selected material faces were examined. Each response
   * is capped at 256; bounded multi-page evidence remains host-only.
   */
  reviewedFaces?:CodeModeReviewedTextureFace[];
  issues:Array<{
    id:string;
    kind:"FLAT_SHADING"|"MISSING_DETAIL"|"STYLE_MISMATCH"|
      "ALPHA_MISMATCH"|"UV_SEAM"|"SILHOUETTE"|"OTHER";
    observation:string;
    /** Optional operator-observed semantic part identity; checked at Paint. */
    partId?:string;
  }>;
  correctionScope?: TextureCorrectionScope;
  /** Actual rejected strategy keys, carried by the authorized reviewer. */
  rejectedApproaches?:Array<{issueId:string;approachId:string}>;
  /** From authorized Workspace history: two or more rejected attempts of
   * the SAME part/material/treatment family; renaming approachId is not a
   * different remedy. This is externally supplied review history, not a DB.
   */
  rejectedTreatments?:Array<{
    partId:string;material:string;treatment:string;
    failedAttempts:number;observation:string;
  }>;
  /** Exact previously rejected ordered Paint plan, tied to the part and
   * physical atlas by a trusted reviewer. The digest comes from an actual
   * prior Code Mode receipt; it is NOT a source/visual acceptance label.
   */
  rejectedPaintPlans?:Array<{
    partId:string;textureUuid:string;fingerprintSha256:string;
    observation:string;
  }>;
  /** Stage sample restricts Paint to one bounded atlas patch. Stage
   * propagation requires reviewer-declared accepted sample from the
   * CURRENT SHA-bound captured model; the host protects that patch.
   */
  materialCohort?:{
    phase:"sample"|"propagation";
    issueId:string; partId:string; approachId:string;
    cubeUuid:string;face:CubeFaceSurface["side"];
    sampleRegion:{from:[number,number];to:[number,number]};
    sampleVerdict?:"ACCEPTED";
  };
}
export interface CodeModeHostOptions {
  /** Required for disk-source/headless operations; not needed when the
   * operator selects liveReadPairing/liveReadClient with no disk project.
   * The live-only host cannot accept mutation callbacks or saved inputs.
   */
  rustBinary?: string;
  denoBinary: string;
  /** Existing model. Exclusive with outputDirectory. Neither is required
   * for a separately paired read-only live session.
   */
  input?: string;
  /** Authorized, existing directory for New-model bootstrap. */
  outputDirectory?: string;
  /** Missing callback = all writes denied. Must be owned by the real host. */
  authorizeMutation?: (request: Readonly<MutationRequest>) => boolean | Promise<boolean>;
  /** Optional file chosen by the operator; guest never selects its path. */
  preselectedPngPath?: string;
  /** Exact existing master texture UUID independently selected by the operator
   * for comparisons within the same .bbmodel; not a visual approval detector.
   */
  approvedMaterialReferenceUuid?: string;
  /** Optional canonical REFERENCE.json in the same asset workspace as the
   * input .bbmodel. Trusted host binds selected approved source PNGs, imports
   * explicit SURFACE_DETAIL obligations and rechecks the package fingerprint.
   * It does NOT infer user approval, atlas coordinates or authoring permission.
   */
  approvedReferencePackagePath?:string;
  /** Image paths are explicitly operator-selected; model code cannot supply
   * them. The capture must correspond to the current model SHA according to
   * the operator; the decoder cannot authenticate a screenshot's origin.
   */
  preselectedVisualPair?: {
    referencePngPath:string;
    capturePngPath:string;
    captureModelSha256:string;
    viewId:CodeModeVisualViewId;
    /** Optional actual operator-selected view pairs, same model SHA.
     * The host rejects duplicates, unsupported labels and missing required
     * cardinal directions. No paths ever reach guest code.
     */
    supportingViews?:Array<{
      viewId:CodeModeVisualViewId;
      referencePngPath:string;capturePngPath:string;
    }>;
    requireSixDirections?:boolean;
    /** Optional operator-owned projection of approved Reference/Workspace
     * decisions. When present it is mandatory for reviewer findings and
     * Texturing readiness, and bounds reviewer-authorized Paint regions.
     */
    reviewCriteria?:CodeModeReviewCriterion[];
  };
  /** Optional trusted source hypothesis for ONE Cube landmark. The exact
   * image region must be a measured mask mismatch hotspot for a selected
   * view; Rust must confirm the Cube UUID before it becomes guest-visible.
   * This declaration is NOT proof of image-to-3D correspondence. */
  preselectedGeometryLandmark?:{
    cubeUuid:string;landmarkLabel:string;
    viewId:CodeModeVisualViewId;mismatchKind:"missing"|"excess";
    regionBounds:[number,number,number,number];
  };
  /** Operator-owned, independent visual review adapter. The callback receives
   * bounded original PNG bytes under trusted Node, not in the Deno guest.
   * It must not claim a review unless the selected images were actually seen.
   * If absent, results are numeric source evidence only.
   */
  reviewVisualPair?: ((pair:Readonly<{
    sourceModelSha256:string;
    viewId:CodeModeVisualViewId;
    reference:Readonly<{sha256:string;pngBytes:Buffer}>;
    capture:Readonly<{sha256:string;pngBytes:Buffer}>;
    supportingViews:ReadonlyArray<Readonly<{
      viewId:CodeModeVisualViewId;
      reference:Readonly<{sha256:string;pngBytes:Buffer}>;
      capture:Readonly<{sha256:string;pngBytes:Buffer}>;
    }>>;
    requiredSixDirections:boolean;
    reviewCriteria:ReadonlyArray<Readonly<CodeModeReviewCriterion>>;
    /** Native source scan, or one explicit <=256-face source page. */
    sourceFaceInventory?:Readonly<{
      scope:"trusted_saved_cube_face_inventory"|
        "trusted_saved_cube_face_inventory_page";
      source_model_sha256:string;
      total_cubes:number|null;
      complete:boolean;
      faces:ReadonlyArray<Readonly<{
        cube_uuid:string;face:CubeFaceSurface["side"];
        texture_uuid:string|null;source_status:string;
      }>>;
      total_faces?:number;page_index?:number;page_count?:number;
      face_offset?:number;reason?:string;
    }> | null;
  }>) => CodeModeVisualReviewerFeedback | Promise<CodeModeVisualReviewerFeedback>) &
    {requiresSourceFaceInventory?:true;supportsPagedSourceFaceReview?:true};
  /** Host-owned GUI pairing, never part of model-written Deno source.
   * Only on a deliberately paired experimental Windows build.
   */
  liveReadPairing?: { pipe: string; token: string };
  /** Trusted test/integration seam. It is NOT a user-supplied JSON payload. */
  liveReadClient?: {
    sessionInfo(): Promise<Record<string, unknown>>;
    semanticMap(input: {
      expectedEpoch: number; expectedRevision: number;
      category: string; offset?: number; limit?: number;
    }): Promise<Record<string, unknown>>;
  };
  /** Trusted fixture seams only; never pass untrusted model data as functions. */
  runner?: (args: string[]) => Promise<Readonly<Record<string, unknown>>>;
  spawnImpl?: (bin: string, args: string[], options: Record<string, unknown>) => any;
  /** Host-only, optional aggregate counters for success AND failure.
   * Never receives paths, script text, source buffers or error details.
   * Throwing cannot alter the actual execution result.
   */
  observeExecutionMetrics?: (observation: Readonly<{
    outcome: "OK"|"ERROR"; performance: CodeModePerformance;
  }>) => void;
}
export declare function createCodeModeHost(options: CodeModeHostOptions): Promise<CodeModeHost>;
export interface CodeModeToolDescriptor {
  name: "lazydesigner_code_mode";
  description: string;
  inputSchema: {
    type: "object";
    additionalProperties: false;
    required: ["code"];
    properties: { code: { type: "string"; minLength: 1; maxLength: 32768 } };
  };
  execute(input: {code: string}): Promise<CodeModeRunReceipt>;
}
/** Plain descriptor for a trusted agent-host tool registration, not an MCP mutation. */
export declare function createCodeModeTool(host: CodeModeHost): CodeModeToolDescriptor;

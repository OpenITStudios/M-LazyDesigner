/** First-party Rust Code Mode host and guest tool types.
 * SOURCE_ONLY: installed host/Deno/Rust execution NOT_EXECUTED. */
import type {MaterialWorkPacket} from './material-work-packet.mjs';
import type {
  ApplyReceipt, CatalogPage, DocumentSummary, EditOperation,
  InspectBatchQuery, InspectBatchReceipt, InspectReceipt,
  MutationRequest, OutputReceipt, TextureCorrectionScope,
  MaterialPatchRegion, MaterialPairComparison, VisualPairReceipt,
  MaterialCorrectionIntent, MaterialFacePatchBinding, CubeFaceSurface,
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
}
export interface CodeModeRunReceipt {
  status: "OK";
  value: unknown;
  logs: string[];
  rpc_calls: number;
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
export interface CodeModeGuestAPI {
  /** Null project indicates a New-model bootstrap in a trusted directory. */
  initial: CodeModeInitialReference;
  projectInfo(args: { project: string }): Promise<CodeModeProjectReference>;
  inspect(args: { project: string; uuid: string }): Promise<InspectReceipt>;
  catalog(args: { project: string; kind: CatalogPage["kind"]; offset?: number; limit?: number }): Promise<InspectReceipt>;
  inspectBatch(args: { project: string; requests: InspectBatchQuery[] }): Promise<InspectBatchReceipt>;
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
  /** Host-only reference and capture PNG paths, SHA and view ID.
   * Image content is not streamed to the guest. No native/artistic PASS.
   */
  inspectSelectedVisualPair(args: { project: string }): Promise<VisualPairReceipt & {
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
  apply(args: { project: string; output: string; operations: EditOperation[]; correctionScope?: TextureCorrectionScope; correctionIntent?: MaterialCorrectionIntent; materialWorkPacket?: MaterialWorkPacket }):
    Promise<CodeModeProjectReference & { receipt: ApplyReceipt;
      texturing_workflow?:{
        status:"PAINT_SAVED_NOT_VISUALLY_ACCEPTED";source_model_sha256:string;
        style_evidence:ApplyReceipt["texture_styling_evidence"];
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
/** Host-selected from a REAL rendered view comparison. Never supplied by guest. */
export interface CodeModeReviewedTextureFace {
  cubeUuid:string;
  textureUuid:string;
  face:CubeFaceSurface["side"];
  style:"STYLED"|"INTENTIONAL_FLAT"|"INTENTIONAL_TRANSPARENT";
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
  /** Required by a texturingReadiness decision; arbitrary six-view labels
   * do not prove the selected material faces were examined. Max 256,
   * with incomplete whole-model acceptance if required faces exceed budget.
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
  rustBinary: string;
  denoBinary: string;
  /** Existing model; supply exactly one of input or outputDirectory. */
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
  }>) => CodeModeVisualReviewerFeedback | Promise<CodeModeVisualReviewerFeedback>) &
    {requiresSourceFaceInventory?:true};
  /** Trusted fixture seams only; never pass untrusted model data as functions. */
  runner?: (args: string[]) => Promise<Readonly<Record<string, unknown>>>;
  spawnImpl?: (bin: string, args: string[], options: Record<string, unknown>) => any;
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

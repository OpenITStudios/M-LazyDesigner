/** First-party Rust Code Mode host and guest tool types.
 * SOURCE_ONLY: installed host/Deno/Rust execution NOT_EXECUTED. */
import type {
  ApplyReceipt, CatalogPage, DocumentSummary, EditOperation,
  InspectBatchQuery, InspectBatchReceipt, InspectReceipt,
  MutationRequest, OutputReceipt, TextureCorrectionScope,
  MaterialPatchRegion, MaterialPairComparison,
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
  apply(args: { project: string; output: string; operations: EditOperation[]; correctionScope?: TextureCorrectionScope }):
    Promise<CodeModeProjectReference & { receipt: ApplyReceipt }>;
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

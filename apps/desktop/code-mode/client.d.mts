/** Rust-first Code Mode SDK: declaration contract, not a code execution sandbox. */
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Vec2 = [number, number];
export interface Cube {
  uuid: string;
  type: "cube";
  name?: string;
  from: Vec3;
  to: Vec3;
  origin?: Vec3;
  uv_offset?: Vec2;
  faces: Record<string, unknown>;
  [key: string]: unknown;
}
export interface Bone {
  uuid: string;
  name: string;
  origin?: Vec3;
  [key: string]: unknown;
}
export type EditOperation =
  | { op: "add_bone"; bone: Bone; parent_uuid: string | null }
  | { op: "add_cube"; cube: Cube; bone_uuid: string }
  | { op: "duplicate_cube"; source_uuid: string; new_uuid: string }
  | { op: "reparent_node"; uuid: string; parent_uuid: string | null }
  | { op: "remove_cube"; uuid: string }
  | { op: "remove_empty_bone"; uuid: string }
  | { op: "create_animation"; uuid: string; name: string; length: number }
  | { op: "add_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; time: number; rotation: Vec3 }
  | { op: "update_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; time: number; rotation: Vec3 }
  | { op: "remove_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string }
  | { op: "translate_cube"; uuid: string; delta: Vec3 }
  | { op: "set_cube_bounds"; uuid: string; from: Vec3; to: Vec3 }
  | { op: "set_cube_rotation"; uuid: string; rotation: Vec3 }
  | { op: "scale_cube"; uuid: string; factors: Vec3 }
  | { op: "set_bone_rotation"; uuid: string; rotation: Vec3 }
  | { op: "set_node_visibility"; uuid: string; visible: boolean }
  | { op: "set_face_uv"; uuid: string; face: string; uv: Vec4 }
  | { op: "set_face_uv_rotation"; uuid: string; face: string; rotation: 0 | 90 | 180 | 270 }
  | { op: "set_box_uv_offset"; uuid: string; offset: Vec2 }
  | { op: "create_paint_texture"; uuid: string; name: string }
  | { op: "enable_imported_paint_texture"; texture_index: number }
  | { op: "import_paint_texture"; uuid: string; name: string; source: string }
  | { op: "set_empty_atlas_resolution"; width: number; height: number }
  | { op: "assign_cube_texture"; cube_uuid: string; texture_uuid: string }
  | { op: "paint_texture_pixel"; texture_index: number; x: number; y: number; rgba: [number, number, number, number] }
  | { op: "paint_texture_stroke"; texture_index: number; points: Vec2[]; rgba: [number, number, number, number] }
  | { op: "paint_texture_brush"; texture_index: number; points: Vec2[]; radius: number; rgba: [number, number, number, number]; erase: boolean }
  | { op: "paint_texture_rectangle"; texture_index: number; from: Vec2; to: Vec2; rgba: [number, number, number, number]; erase: boolean };
export interface DocumentSummary {
  revision: number;
  format_version: string;
  model_format: string;
  cubes: number;
  bones: number;
  textures: number;
  animations: number;
  supported_slice: string;
}
export interface FocusedElement {
  uuid: string;
  kind: "cube" | "bone";
  name: string | null;
  parent_uuid: string | null;
  from?: Vec3;
  to?: Vec3;
  origin?: Vec3 | null;
  uv_offset?: Vec2 | null;
  faces?: Record<string, { uv: Vec4 | null; texture: unknown; rotation: number | null }>;
  [key: string]: unknown;
}
export interface CatalogEntry {
  uuid: string | null;
  name: string | null;
  kind: "cube" | "bone" | "texture" | "animation";
  index: number;
}
export interface CatalogPage {
  kind: "cubes" | "bones" | "textures" | "animations";
  entries: CatalogEntry[];
  offset: number;
  total: number;
  next_offset: number | null;
}
export interface InspectAsset {
  kind: "texture" | "animation";
  index: number;
  uuid: string | null;
  name: string | null;
  source_kind?: "embedded_png" | "external_or_other" | "unavailable";
  [key: string]: unknown;
}
export interface StaticModelAudit {
  scope: "static_metadata_only";
  visual_verdict: "UNVERIFIED";
  faces: {
    total: number; null_or_absent: number; false_reference: number;
    numeric_reference: number; uuid_reference: number; other_or_unset_reference: number;
  };
  textures: {
    total: number; embedded_png_declared: number;
    external_relative_declared: number; unknown_or_other_source: number;
  };
  rig: { cubes: number; bones: number; root_bones: number };
  animation: { clips: number; declared_animator_tracks: number };
}
export interface InspectReceipt {
  status: "OK";
  sha256: string;
  summary: DocumentSummary;
  element?: FocusedElement;
  catalog?: CatalogPage;
  asset?: InspectAsset;
  audit?: StaticModelAudit;
}
export interface MutationReceipt {
  revision: number;
  operation_count: number;
  changed_uuids: string[];
}
export interface ApplyReceipt {
  status: "OK";
  source_sha256: string;
  output_sha256: string;
  summary: DocumentSummary;
  mutation: MutationReceipt;
}
export interface OutputReceipt {
  status: "OK";
  output_sha256: string;
  source_sha256?: string;
  sha256?: string;
  summary?: DocumentSummary;
}
export interface RustCodeModeClient {
  newModel(input: { output: string; name: string; modelIdentifier: string }): Promise<OutputReceipt>;
  inspect(input: { input: string; uuid?: string; expectedSha256?: string }): Promise<InspectReceipt>;
  catalog(input: { input: string; kind: CatalogPage["kind"]; offset?: number; limit?: number; expectedSha256?: string }): Promise<InspectReceipt & { catalog: CatalogPage }>;
  inspectTexture(input: { input: string; index: number; expectedSha256?: string }): Promise<InspectReceipt & { asset: InspectAsset }>;
  inspectAnimation(input: { input: string; uuid: string; expectedSha256?: string }): Promise<InspectReceipt & { asset: InspectAsset }>;
  audit(input: { input: string; expectedSha256?: string }): Promise<InspectReceipt & { audit: StaticModelAudit }>;
  apply(input: { input: string; output: string; expectedSha256: string; operations: EditOperation[] }): Promise<ApplyReceipt>;
  importPng(input: { input: string; output: string; png: string; uuid: string; name: string; expectedSha256: string }): Promise<ApplyReceipt>;
  exportPng(input: { input: string; output: string; textureUuid: string; expectedSha256: string }): Promise<OutputReceipt>;
  exportGeometry(input: { input: string; output: string; expectedSha256: string }): Promise<OutputReceipt>;
}
/** Exact requested write. The digest binds approval to the serialized Rust plan. */
export interface MutationRequest {
  operation: "newModel" | "apply" | "importPng" | "exportPng" | "exportGeometry";
  input?: string;
  output: string;
  name?: string;
  modelIdentifier?: string;
  expectedSha256?: string;
  png?: string;
  uuid?: string;
  textureUuid?: string;
  operationCount?: number;
  operationKinds?: readonly string[];
  planSha256?: string;
}
export declare function createRustCodeModeClient(options: {
  binary: string;
  /** Trusted host/testing seam. NOT an authorization or security boundary. */
  runner?: (args: string[]) => Promise<Readonly<Record<string, unknown>>>;
  /**
   * Default deny. Must be owned by an independent trusted agent host.
   * This callback alone does NOT sandbox a model-authored Node script.
   */
  authorizeMutation?: (request: Readonly<MutationRequest>) => boolean | Promise<boolean>;
}): RustCodeModeClient;
/** A path and SHA-bound read-only view plus guarded output operations. */
export interface RustCodeModeProject {
  input: string;
  expectedSha256: string;
  summary: DocumentSummary;
  inspect(uuid: string): Promise<InspectReceipt>;
  catalog(kind: CatalogPage["kind"], options?: {offset?: number; limit?: number}): Promise<InspectReceipt & {catalog: CatalogPage}>;
  audit(): Promise<InspectReceipt & {audit: StaticModelAudit}>;
  inspectTexture(index: number): Promise<InspectReceipt & {asset: InspectAsset}>;
  inspectAnimation(uuid: string): Promise<InspectReceipt & {asset: InspectAsset}>;
  apply(input: { output: string; operations: EditOperation[] }): Promise<ApplyReceipt>;
  exportPng(input: { output: string; textureUuid: string }): Promise<OutputReceipt>;
  exportGeometry(input: { output: string }): Promise<OutputReceipt>;
}
export declare function openRustCodeModeProject(
  client: RustCodeModeClient, input: string
): Promise<RustCodeModeProject>;


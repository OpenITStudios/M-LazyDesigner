/** Rust-first Code Mode SDK: declaration contract, not a code execution sandbox. */
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Vec2 = [number, number];
export interface PaintRectangleStep {
  from: Vec2;
  to: Vec2;
  rgba: [number, number, number, number];
  erase: boolean;
}
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
  | { op: "rename_node"; uuid: string; name: string }
  | { op: "remove_cube"; uuid: string }
  | { op: "remove_empty_bone"; uuid: string }
  | { op: "create_animation"; uuid: string; name: string; length: number }
  | { op: "set_animation_length"; animation_uuid: string; length: number }
  | { op: "scale_animation_timeline"; animation_uuid: string; factor: number }
  | { op: "add_bone_transform_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; channel: "rotation" | "position" | "scale"; time: number; value: Vec3 }
  | { op: "update_bone_transform_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; channel: "rotation" | "position" | "scale"; time: number; value: Vec3 }
  | { op: "remove_bone_transform_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; channel: "rotation" | "position" | "scale" }
  | { op: "add_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; time: number; rotation: Vec3 }
  | { op: "update_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; time: number; rotation: Vec3 }
  | { op: "remove_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string }
  | { op: "translate_cube"; uuid: string; delta: Vec3 }
  | { op: "set_cube_bounds"; uuid: string; from: Vec3; to: Vec3 }
  | { op: "reframe_cube"; uuid: string; from: Vec3; to: Vec3; uv_policy: "box_repack" | "manual_preserve" }
  | { op: "set_cube_rotation"; uuid: string; rotation: Vec3 }
  | { op: "scale_cube"; uuid: string; factors: Vec3 }
  | { op: "set_bone_rotation"; uuid: string; rotation: Vec3 }
  | { op: "set_bone_origin"; uuid: string; origin: Vec3 }
  | { op: "set_cube_origin"; uuid: string; origin: Vec3 }
  | { op: "set_cube_inflate"; uuid: string; inflate: number }
  | { op: "set_cube_stretch"; uuid: string; stretch: Vec3 }
  | { op: "set_cube_mirror_uv"; uuid: string; mirrored: boolean }
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
  | { op: "paint_texture_rectangle"; texture_index: number; from: Vec2; to: Vec2; rgba: [number, number, number, number]; erase: boolean }
  | { op: "paint_texture_rectangles"; texture_index: number; rectangles: PaintRectangleStep[] }
  | { op: "paint_texture_fill"; texture_index: number; at: Vec2; rgba: [number, number, number, number]; erase: boolean };
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
/** Saved link metadata, not confirmed material/texture pixels. */
export interface CubeFaceSurface {
  side: "north" | "east" | "south" | "west" | "up" | "down";
  uv: Vec4;
  uv_rotation: 0 | 90 | 180 | 270 | null;
  uv_rotation_supported: boolean;
  uv_zero_span: boolean;
  reference_kind: "unset" | "null" | "false" | "index" | "uuid";
  texture_index: number | null;
  texture_uuid: string | null;
  source_kind: "embedded_png_declared" | "relative_path_declared" | "other_or_unknown" | null;
}
export interface CubeSurfaceInspection {
  scope: "saved_geometry_and_face_references";
  cube_uuid: string;
  visual_verdict: "UNVERIFIED";
  effective_material: "UNVERIFIED";
  geometry: {
    from: Vec3;
    to: Vec3;
    size: Vec3;
    origin: Vec3 | null;
    rotation: Vec3 | null;
    inflate: number | null;
    stretch: Vec3 | null;
    projected_local_size: Vec3 | null;
    visibility_saved: boolean | null;
  };
  uv: {
    project_resolution: Vec2;
    box_uv: boolean;
    auto_uv: 0 | 1 | 2;
    per_texture_rules: boolean;
  };
  faces: CubeFaceSurface[];
}
/** Source decoded alpha counts only; NOT a painted-face coverage verdict. */
export interface SupportedTextureAlpha {
  scope: "decoded_embedded_rgba8_alpha";
  supported: true;
  visual_verdict: "UNVERIFIED";
  face_coverage_verdict: "UNVERIFIED";
  width: number;
  height: number;
  total_pixels: number;
  transparent_pixels: number;
  translucent_pixels: number;
  opaque_pixels: number;
  grid_size: [8, 8];
  tile_samples: number[][];
  tile_nonzero_alpha: number[][];
}
export interface UnsupportedTextureAlpha {
  scope: "unsupported_texture_alpha";
  supported: false;
  reason: "PER_TEXTURE_UV_RULES_UNSUPPORTED" | "UNSUPPORTED_FORMAT_OR_METADATA";
  visual_verdict: "UNVERIFIED";
  face_coverage_verdict: "UNVERIFIED";
}
export interface TextureAlphaInspection {
  kind: "texture_alpha";
  texture_uuid: string;
  texture_index: number;
  inspection: SupportedTextureAlpha | UnsupportedTextureAlpha;
}
/** Exact alpha histogram of a saved manual or reconstructed Box UV region.
 * Neither variant is evidence of face visibility, quality or material parity. */
export interface SavedUvPixelRegion {
  scope: "saved_manual_uv_alpha_pixels" | "derived_box_uv_alpha_pixels";
  sampled_pixels: number;
  transparent_pixels: number;
  translucent_pixels: number;
  opaque_pixels: number;
  pixel_rect: Vec4;
}
export interface CubeFaceAlphaEvidence {
  side: CubeFaceSurface["side"];
  saved_reference_kind: CubeFaceSurface["reference_kind"];
  texture_index: number | null;
  texture_uuid: string | null;
  uv: Vec4;
  saved_uv: Vec4;
  uv_source: "saved_manual" | "derived_box";
  alpha:
    | { status: "measured"; region: SavedUvPixelRegion }
    | { status: "unsupported"; reason: string };
}
export interface CubeFaceAlphaInspection {
  scope: "saved_manual_face_uv_alpha" | "derived_box_face_uv_alpha";
  cube_uuid: string;
  visual_verdict: "UNVERIFIED";
  effective_material: "UNVERIFIED";
  face_coverage_verdict: "UNVERIFIED";
  face_count: number;
  faces: CubeFaceAlphaEvidence[];
}
export interface RotationTrackInspection {
  scope: "linear_bone_rotation" | "unsupported_animation_track";
  recognized: boolean;
  visual_verdict: "UNVERIFIED";
  animation_uuid: string;
  bone_uuid: string;
  reason?: "OPAQUE_OR_UNSUPPORTED_KEYFRAMES";
  total_frames: number | null;
  offset?: number;
  next_offset: number | null;
  keyframes: Array<{ uuid: string; time: number; rotation: Vec3 }>;
}
export interface TransformTrackInspection {
  scope: "linear_bone_transform" | "unsupported_animation_track";
  recognized: boolean;
  visual_verdict: "UNVERIFIED";
  animation_uuid: string;
  bone_uuid: string;
  channel: "rotation" | "position" | "scale";
  reason?: "OPAQUE_OR_UNSUPPORTED_KEYFRAMES";
  total_frames: number | null;
  offset?: number;
  next_offset: number | null;
  keyframes: Array<{ uuid: string; time: number; value: Vec3 }>;
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
  surfaces?: CubeSurfaceInspection;
  face_alpha?: CubeFaceAlphaInspection;
  alpha?: TextureAlphaInspection;
  catalog?: CatalogPage;
  asset?: InspectAsset;
  audit?: StaticModelAudit;
  track?: RotationTrackInspection | TransformTrackInspection;
}
/** One host-authored read batch; unknown selectors fail closed in JS/Rust. */
export type InspectBatchQuery =
  | { kind: "cube"; uuid: string }
  | { kind: "cube_surfaces"; uuid: string }
  | { kind: "cube_face_alpha"; uuid: string }
  | { kind: "catalog"; category: CatalogPage["kind"]; offset?: number; limit?: number }
  | { kind: "texture"; index: number }
  | { kind: "texture_alpha"; uuid: string }
  | { kind: "animation"; uuid: string }
  | { kind: "animation_track"; animation_uuid: string; bone_uuid: string; offset?: number; limit?: number }
  | { kind: "animation_transform_track"; animation_uuid: string; bone_uuid: string; channel: TransformTrackInspection["channel"]; offset?: number; limit?: number }
  | { kind: "audit" };
export type InspectBatchResult =
  | { kind: "cube"; element: FocusedElement }
  | { kind: "cube_surfaces"; surfaces: CubeSurfaceInspection }
  | { kind: "cube_face_alpha"; face_alpha: CubeFaceAlphaInspection }
  | { kind: "catalog"; catalog: CatalogPage }
  | { kind: "texture"; asset: InspectAsset }
  | { kind: "texture_alpha"; alpha: TextureAlphaInspection }
  | { kind: "animation"; asset: InspectAsset }
  | { kind: "animation_track"; track: RotationTrackInspection }
  | { kind: "animation_transform_track"; track: TransformTrackInspection }
  | { kind: "audit"; audit: StaticModelAudit };
export interface InspectBatchReceipt {
  status: "OK";
  sha256: string;
  summary: DocumentSummary;
  /** 1–8 results; same order as requests; no mutations. */
  results: InspectBatchResult[];
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
  inspectCubeSurfaces(input: {
    input: string; cubeUuid: string; expectedSha256?: string;
  }): Promise<InspectReceipt & { surfaces: CubeSurfaceInspection }>;
  inspectCubeFaceAlpha(input: {
    input: string; cubeUuid: string; expectedSha256?: string;
  }): Promise<InspectReceipt & { face_alpha: CubeFaceAlphaInspection }>;
  inspectBatch(input: {
    input: string; expectedSha256: string; requests: InspectBatchQuery[];
  }): Promise<InspectBatchReceipt>;
  catalog(input: { input: string; kind: CatalogPage["kind"]; offset?: number; limit?: number; expectedSha256?: string }): Promise<InspectReceipt & { catalog: CatalogPage }>;
  inspectTexture(input: { input: string; index: number; expectedSha256?: string }): Promise<InspectReceipt & { asset: InspectAsset }>;
  inspectTextureAlpha(input: {
    input: string; textureUuid: string; expectedSha256?: string;
  }): Promise<InspectReceipt & { alpha: TextureAlphaInspection }>;
  inspectAnimation(input: { input: string; uuid: string; expectedSha256?: string }): Promise<InspectReceipt & { asset: InspectAsset }>;
  inspectAnimationTrack(input: {
    input: string; animationUuid: string; boneUuid: string;
    offset?: number; limit?: number; expectedSha256?: string;
  }): Promise<InspectReceipt & { track: RotationTrackInspection }>;
  inspectAnimationTransformTrack(input: {
    input: string; animationUuid: string; boneUuid: string; channel: TransformTrackInspection["channel"];
    offset?: number; limit?: number; expectedSha256?: string;
  }): Promise<InspectReceipt & { track: TransformTrackInspection }>;
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
  /**
   * Optional synchronous launch-time lease check for the trusted host.
   * Receives the EXACT approved request descriptor object; if false, Rust is
   * not invoked. Must not be model-authored or asynchronously resolved.
   */
  permitWriteLaunch?: (request: Readonly<MutationRequest>) => boolean;
}): RustCodeModeClient;
/** A path and SHA-bound read-only view plus guarded output operations. */
export interface RustCodeModeProject {
  input: string;
  expectedSha256: string;
  summary: DocumentSummary;
  inspect(uuid: string): Promise<InspectReceipt>;
  inspectCubeSurfaces(cubeUuid: string): Promise<InspectReceipt & {surfaces: CubeSurfaceInspection}>;
  inspectCubeFaceAlpha(cubeUuid: string): Promise<InspectReceipt & {face_alpha: CubeFaceAlphaInspection}>;
  inspectBatch(requests: InspectBatchQuery[]): Promise<InspectBatchReceipt>;
  catalog(kind: CatalogPage["kind"], options?: {offset?: number; limit?: number}): Promise<InspectReceipt & {catalog: CatalogPage}>;
  audit(): Promise<InspectReceipt & {audit: StaticModelAudit}>;
  inspectTexture(index: number): Promise<InspectReceipt & {asset: InspectAsset}>;
  inspectTextureAlpha(textureUuid: string): Promise<InspectReceipt & {alpha: TextureAlphaInspection}>;
  inspectAnimation(uuid: string): Promise<InspectReceipt & {asset: InspectAsset}>;
  inspectAnimationTrack(
    animationUuid: string, boneUuid: string, options?: {offset?: number; limit?: number}
  ): Promise<InspectReceipt & {track: RotationTrackInspection}>;
  inspectAnimationTransformTrack(
    animationUuid: string, boneUuid: string, channel: TransformTrackInspection["channel"],
    options?: {offset?: number; limit?: number}
  ): Promise<InspectReceipt & {track: TransformTrackInspection}>;
  apply(input: { output: string; operations: EditOperation[] }): Promise<ApplyReceipt>;
  exportPng(input: { output: string; textureUuid: string }): Promise<OutputReceipt>;
  exportGeometry(input: { output: string }): Promise<OutputReceipt>;
}
export declare function openRustCodeModeProject(
  client: RustCodeModeClient, input: string
): Promise<RustCodeModeProject>;


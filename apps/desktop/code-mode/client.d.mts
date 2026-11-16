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
export interface CubeFacePaintPatch {
  face: "north" | "east" | "south" | "west" | "up" | "down";
  rgba: [number, number, number, number];
  erase: boolean;
}
/** Explicit per-axis Blockbench 5.2.1 Bezier handles, not sampled poses. */
export interface BezierKeyframeHandles {
  linked: boolean;
  leftTime: Vec3;
  leftValue: Vec3;
  rightTime: Vec3;
  rightValue: Vec3;
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
/** Native .bbmodel sound/particle keyframe metadata. No local file, script or playback. */
export interface AnimationEffectPoint {
  effect: string;
  locator?: string;
  bind_to_actor?: boolean;
}
export type EditOperation =
  | { op: "add_bone"; bone: Bone; parent_uuid: string | null }
  | { op: "add_cube"; cube: Cube; bone_uuid: string }
  | { op: "duplicate_cube"; source_uuid: string; new_uuid: string }
  | { op: "duplicate_bone_subtree"; source_uuid: string; new_uuid: string; name_suffix: string }
  | { op: "reparent_node"; uuid: string; parent_uuid: string | null }
  | { op: "rename_node"; uuid: string; name: string }
  | { op: "remove_cube"; uuid: string }
  | { op: "remove_empty_bone"; uuid: string }
  | { op: "create_animation"; uuid: string; name: string; length: number }
  | { op: "duplicate_animation_clip"; source_uuid: string; new_uuid: string; new_name: string }
  | { op: "add_animation_timeline_marker"; animation_uuid: string; time: number; name: string; color: number }
  | { op: "update_animation_timeline_marker"; animation_uuid: string; target_time: number; time: number; name: string; color: number }
  | { op: "remove_animation_timeline_marker"; animation_uuid: string; time: number }
  | { op: "add_animation_effect_event"; animation_uuid: string; keyframe_uuid: string; channel: "sound" | "particle"; time: number; points: AnimationEffectPoint[] }
  | { op: "update_animation_effect_event"; animation_uuid: string; keyframe_uuid: string; channel: "sound" | "particle"; time: number; points: AnimationEffectPoint[] }
  | { op: "remove_animation_effect_event"; animation_uuid: string; keyframe_uuid: string; channel: "sound" | "particle" }
  | { op: "set_animation_length"; animation_uuid: string; length: number }
  | { op: "set_animation_loop_mode"; animation_uuid: string; mode: "once" | "loop" | "hold" }
  | { op: "scale_animation_timeline"; animation_uuid: string; factor: number }
  | { op: "set_bone_transform_keyframe_interpolation"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; channel: "rotation" | "position" | "scale"; interpolation: "linear" | "step" | "catmullrom" }
  | { op: "set_bone_transform_keyframe_bezier"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; channel: "rotation" | "position" | "scale"; handles: BezierKeyframeHandles }
  | { op: "add_bone_transform_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; channel: "rotation" | "position" | "scale"; time: number; value: Vec3 }
  | { op: "update_bone_transform_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; channel: "rotation" | "position" | "scale"; time: number; value: Vec3 }
  | { op: "remove_bone_transform_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; channel: "rotation" | "position" | "scale" }
  | { op: "add_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; time: number; rotation: Vec3 }
  | { op: "update_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; time: number; rotation: Vec3 }
  | { op: "remove_bone_rotation_keyframe"; animation_uuid: string; bone_uuid: string; keyframe_uuid: string }
  | { op: "translate_cube"; uuid: string; delta: Vec3 }
  | { op: "translate_bone_subtree"; uuid: string; delta: Vec3 }
  | { op: "reflect_bone_subtree"; uuid: string; axis: "x" | "y" | "z"; center: number; uv_policy: "preserve" | "mirror" }
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
  | { op: "paint_cube_uv_faces"; cube_uuid: string; texture_uuid: string; faces: CubeFacePaintPatch[] }
  | { op: "paint_cube_uv_faces_guarded"; cube_uuid: string; texture_uuid: string; faces: CubeFacePaintPatch[] }
  | { op: "paint_cube_face_regions_guarded"; cube_uuid: string; texture_uuid: string; regions: CubeFaceRegionPaintPatch[] }
  | { op: "recolor_cube_faces_palette_guarded"; texture_uuid: string; targets: CubePaletteTarget[]; palette: PaletteRgbSwap[] }
  | { op: "isolate_cube_box_uv"; cube_uuid: string; texture_uuid: string }
  | { op: "paint_texture_fill"; texture_index: number; at: Vec2; rgba: [number, number, number, number]; erase: boolean };
export interface PaletteRgbSwap {
  from: [number, number, number];
  to: [number, number, number];
}
export interface CubePaletteTarget {
  cube_uuid: string;
  faces: Array<CubeFacePaintPatch["face"]>;
}
export interface CubeFaceRegionPaintPatch {
  face: CubeFacePaintPatch["face"];
  /** Half-open face-local pixel bounds, not atlas pixel coordinates. */
  from: Vec2;
  to: Vec2;
  rgba: [number, number, number, number];
  erase: boolean;
}
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
/** Atlas UV rectangle intersection is saved-reference evidence only.
 * Results do NOT prove exclusive pixels or visual face coverage. */
export interface CubeUvOverlap {
  focus_face: CubeFaceSurface["side"];
  other_cube_uuid: string;
  other_face: CubeFaceSurface["side"];
  pixel_rect: Vec4;
  overlap_pixels: number;
}
export interface CubeUvSharingInspection {
  scope: "explicit_texture_uv_overlap";
  cube_uuid: string;
  texture_uuid: string;
  visual_verdict: "UNVERIFIED";
  face_coverage_verdict: "UNVERIFIED";
  reference_scope: "explicit_texture_links_only";
  focused_mapped_faces: number;
  declared_overlap_pairs: number;
  unresolved_explicit_faces: number;
  implicit_reference_faces: number;
  report_truncated: boolean;
  overlaps: CubeUvOverlap[];
}
/** Bounded source-only face review, not rendered face/texture acceptance. */
export interface TextureCoverageFace {
  side: CubeFaceSurface["side"];
  reference_kind: CubeFaceSurface["reference_kind"];
  texture_uuid: string | null;
  status:
    | "absent_declared" | "no_explicit_texture" | "implicit_texture_unresolved"
    | "mapping_unsupported" | "fully_transparent_pixels"
    | "partially_transparent_pixels" | "translucent_pixels"
    | "measured_nontransparent_pixels";
  reason: string | null;
  alpha_pixels: null | {
    sampled: number; transparent: number; translucent: number; opaque: number;
  };
}
export interface TextureCoverageCube {
  cube_uuid: string;
  review_candidates: number;
  faces: TextureCoverageFace[];
}
export interface ModelTextureCoveragePage {
  scope: "saved_face_texture_coverage_page";
  visual_verdict: "UNVERIFIED";
  face_coverage_verdict: "UNVERIFIED";
  total_cubes: number;
  offset: number;
  limit: number;
  reviewed_cubes: number;
  review_candidates: number;
  fully_transparent_faces: number;
  unresolved_reference_or_mapping_faces: number;
  next_offset: number | null;
  cubes: TextureCoverageCube[];
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
  /** Only present on admitted numeric linear clips; not live playback proof. */
  loop_mode?: "once" | "loop" | "hold";
  clip_length?: number;
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
  uv_sharing?: CubeUvSharingInspection;
  coverage?: ModelTextureCoveragePage;
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
  | { kind: "cube_uv_sharing"; uuid: string; texture_uuid: string }
  | { kind: "model_texture_coverage"; offset?: number; limit?: number }
  | { kind: "catalog"; category: CatalogPage["kind"]; offset?: number; limit?: number }
  | { kind: "texture"; index: number }
  | { kind: "texture_alpha"; uuid: string }
  | { kind: "animation"; uuid: string }
  | { kind: "animation_track"; animation_uuid: string; bone_uuid: string; offset?: number; limit?: number }
  | { kind: "animation_transform_track"; animation_uuid: string; bone_uuid: string; channel: TransformTrackInspection["channel"]; offset?: number; limit?: number }
  | { kind: "animation_effect_events"; animation_uuid: string; offset?: number; limit?: number }
  | { kind: "animation_timeline_markers"; animation_uuid: string; offset?: number; limit?: number }
  | { kind: "audit" };
export interface AnimationEffectInspection {
  scope: "saved_sound_particle_markers" | "unsupported_animation_effects";
  recognized: boolean;
  visual_verdict: "UNVERIFIED";
  playback_verdict: "NOT_EXECUTED";
  animation_uuid: string;
  clip_length?: number;
  total_events?: number;
  offset?: number;
  next_offset: number | null;
  events: Array<{
    uuid: string;
    channel: "sound" | "particle";
    time: number;
    data_points: AnimationEffectPoint[];
  }>;
  reason?: string;
}
export interface TimelineMarkerInspection {
  scope: "saved_timeline_markers" | "unsupported_timeline_markers";
  recognized: boolean;
  visual_verdict: "UNVERIFIED";
  playback_verdict: "NOT_EXECUTED";
  animation_uuid: string;
  clip_length?: number;
  total_markers: number | null;
  offset?: number;
  next_offset: number | null;
  markers: Array<{name: string; time: number; color: number}>;
  reason?: string;
}
export type InspectBatchResult =
  | { kind: "cube"; element: FocusedElement }
  | { kind: "cube_surfaces"; surfaces: CubeSurfaceInspection }
  | { kind: "cube_face_alpha"; face_alpha: CubeFaceAlphaInspection }
  | { kind: "cube_uv_sharing"; uv_sharing: CubeUvSharingInspection }
  | { kind: "model_texture_coverage"; coverage: ModelTextureCoveragePage }
  | { kind: "catalog"; catalog: CatalogPage }
  | { kind: "texture"; asset: InspectAsset }
  | { kind: "texture_alpha"; alpha: TextureAlphaInspection }
  | { kind: "animation"; asset: InspectAsset }
  | { kind: "animation_track"; track: RotationTrackInspection }
  | { kind: "animation_transform_track"; track: TransformTrackInspection }
  | { kind: "animation_effect_events"; effects: AnimationEffectInspection }
  | { kind: "animation_timeline_markers"; markers: TimelineMarkerInspection }
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
  exportAnimations(input: { input: string; output: string; expectedSha256: string }): Promise<OutputReceipt>;
}
/** Exact requested write. The digest binds approval to the serialized Rust plan. */
export interface MutationRequest {
  operation: "newModel" | "apply" | "importPng" | "exportPng" | "exportGeometry" | "exportAnimations";
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
  exportAnimations(input: { output: string }): Promise<OutputReceipt>;
}
export declare function openRustCodeModeProject(
  client: RustCodeModeClient, input: string
): Promise<RustCodeModeProject>;


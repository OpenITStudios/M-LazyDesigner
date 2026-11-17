/** Rust-first Code Mode SDK: declaration contract, not a code execution sandbox. */
import type {MaterialWorkPacket} from './material-work-packet.mjs';
export type {MaterialWorkPacket} from './material-work-packet.mjs';
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Vec2 = [number, number];
/** An ephemeral source-guard for a correction to an EXISTING texture.
 * All other .bbmodel data and all pixels outside the half-open rectangles
 * must remain unchanged. This does not judge the visual style.
 */
/** Exact source RGBA precondition at one physical atlas pixel.
 * A guest-declared old color is NOT approved reference evidence; Rust
 * independently compares it with the actual saved bitmap before Paint.
 */
export interface TextureExpectedBeforePixel {
  at: Vec2;
  rgba: [number,number,number,number];
}
export interface TextureCorrectionScope {
  textureUuid: string;
  allowedRegions: Array<{ from: Vec2; to: Vec2 }>;
  preserveAlpha?: boolean;
  /** Guard approved detail even WITHIN allowedRegions.
   * The trusted reviewer may impose stricter guards than the guest.
   */
  protectedRegions?: Array<{ from: Vec2; to: Vec2 }>;
  /** Bounded exact pixel preconditions on the ORIGINAL input .bbmodel. */
  expectedBeforePixels?: TextureExpectedBeforePixel[];
  /** Exact original RGBA values that MAY be overwritten. A present empty
   * list is invalid; omission preserves legacy unrestricted preimage edits.
   * Reviewer-authorized propagation requires an independently selected list.
   */
  editableBeforeRgba?:Array<[number,number,number,number]>;
}
/** Trusted-host reuse of the same correction admission used by the SDK.
 * This is not an additional model-facing guest capability.
 */
export declare function normalizedCorrectionScope(scope?: TextureCorrectionScope): {
  texture_uuid:string;
  allowed_regions:Array<{from:Vec2;to:Vec2}>;
  preserve_alpha:boolean;
  protected_regions?:Array<{from:Vec2;to:Vec2}>;
  expected_before_pixels?:Array<{at:Vec2;rgba:[number,number,number,number]}>;
  editable_before_rgba?:Array<[number,number,number,number]>;
} | undefined;
/** Structured guest-proposed diagnosis. The reviewer must still assess art. */
export interface MaterialCorrectionIntent {
  issueId:string;
  approachId:string;
  partId:string;
  material:"metal"|"wood"|"stone"|"cloth"|"skin"|"glass"|"other";
  treatment:"form_value_masses"|"contact_shadows"|"hand_painted_clusters"|
    "palette_roles"|"alpha_silhouette"|"artwork_footprint";
  cause:string;
  expectedChange:string;
}
/** One canonical shared strict schema, not a new model/paint engine. */
export declare function normalizedMaterialCorrectionIntent(
  value?:MaterialCorrectionIntent
):Readonly<MaterialCorrectionIntent> | undefined;
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
  | { op: "set_visible_box"; bounds: [number, number, number] }
  | { op: "assign_cube_texture"; cube_uuid: string; texture_uuid: string }
  | { op: "assign_cube_face_texture"; cube_uuid: string; face: CubeFacePaintPatch["face"]; texture_uuid: string }
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
  /** false retains the historical six-face report; true emits only review candidates. */
  attention_only: boolean;
  /** Scanned Cube count; independent of the number returned by filtering. */
  reviewed_cubes: number;
  returned_cubes: number;
  returned_faces: number;
  review_candidates: number;
  fully_transparent_faces: number;
  partially_transparent_faces: number;
  translucent_faces: number;
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
/** Cross-domain output assessment from canonical in-memory exporters.
 * source_consistent is NOT native/visual success. The inspect-batch receipt
 * pins the exact input SHA; no PNG bytes or untrusted paths are returned.
 */
export interface AssetHandoffInspection {
  scope: "bedrock_single_atlas_export_handoff";
  status: "source_consistent" | "blocked";
  visual_verdict: "UNVERIFIED";
  native_verdict: "NOT_EXECUTED";
  selected_texture_uuid: string;
  /** Stable face order: model Cube list, then north/east/south/west/up/down. */
  total_issues: number;
  issue_offset: number;
  next_issue_offset: number | null;
  issues: Array<{
    cube_uuid: string;
    face: "north" | "east" | "south" | "west" | "up" | "down";
    problem:
      | "false_reference" | "unset_reference" | "other_texture" | "unresolved_reference"
      | "uv_out_of_bounds" | "uv_zero_area" | "uv_projection_unsupported";
    reference_kind: "false" | "unset" | "index" | "uuid" | "unsupported";
    referenced_texture_uuid: string | null;
    /** Effective, potentially mirrored atlas UV; null for non-UV issues. */
    uv_rect: [number, number, number, number] | null;
    uv_source: "saved_manual" | "derived_box" | null;
  }>;
  faces: {
    total: number; selected_texture: number; other_texture: number;
    unresolved: number; unset: number; false_reference: number;
    explicitly_absent: number;
    uv_out_of_bounds: number; uv_zero_area: number;
    uv_projection_unsupported: number;
  };
  geometry: {
    status: "source_exportable" | "blocked";
    sha256: string | null; bytes: number | null; reason?: string;
    /** In blocks; from the actual in-memory Bedrock Geometry resource. */
    visible_bounds?: {
      width: number; height: number; offset: [number, number, number];
    };
    visible_bounds_source?: "computed_static" | "saved_visible_box_union";
    /** Read-only budget, not rendered pose or Minecraft culling proof. */
    translation_clearance?: {
      scope: "single_clip_numeric_translation_clearance";
      status: "no_numeric_translation" | "unassessed"
        | "conservative_margin_shortfall" | "source_budget_covered";
      reason?: string;
      numeric_clips?: number;
      position_tracks?: number;
      /** Exact numeric Bone rotations use a whole-model pivot sphere. */
      rotation_tracks?: number;
      /** Linear/step numeric Scale tracks; no controller blending is assessed. */
      scale_tracks?: number;
      /** Numeric Bezier Bone animator cohorts bounded from per-axis cubic control values. */
      bezier_bone_tracks?: number;
      /** Catmull-Rom admitted only for rigid numeric Rotation; no Position/Scale spline bound. */
      catmullrom_rotation_tracks?: number;
      /** Catmull Position/Scale cohorts conservatively bounded from neighbor controls. */
      catmullrom_numeric_tracks?: number;
      /** Largest product of per-Bone max axis scale (>=1) along one hierarchy path. */
      max_scale_chain_amplification?: number;
      coverage_mode?: "translation_only" | "pivot_rotation_envelope" | "scaled_pivot_envelope";
      /** Padded compiled pivot radius, model units; null for translation-only. */
      rotation_radius_model_units?: number | null;
      max_reach_model_units?: number;
      max_reach_blocks?: number;
      required_conservative_bounds?: {
        width: number; height: number; offset: [number, number, number];
      };
      shortfall_blocks?: {
        horizontal_width: number; below: number; above: number;
      };
      native_verdict: "NOT_EXECUTED";
      visual_verdict: "UNVERIFIED";
      controller_blends: "NOT_ASSESSED";
    };
  };
  texture: { status: "source_exportable" | "blocked"; sha256: string | null; bytes: number | null; reason?: string };
  animation: {
    status: "source_exportable" | "blocked" | "not_required";
    sha256: string | null; bytes: number | null; reason?: string;
    curve_fidelity?: "native" | "adaptive_bezier_approximation";
    /** Advisory saved keyframe axis endpoints only; never orientation or visual continuity PASS. */
    loop_seams?: {
      scope: "authored_numeric_loop_endpoint_review";
      status: "needs_review" | "unsupported" | "no_endpoint_candidates";
      visual_verdict: "UNVERIFIED";
      native_verdict: "NOT_EXECUTED";
      looping_clips: number;
      unsupported_looping_clips: number;
      reviewed_channels: number;
      constant_channels: number;
      review_candidates: number;
      returned_issues: number;
      truncated: boolean;
      issues: Array<{
        animation_uuid: string;
        bone_uuid: string;
        channel: "rotation" | "position" | "scale";
        problem: "boundary_not_explicit" | "endpoint_axis_difference";
        missing_boundaries?: Array<"start" | "end">;
        /** Absolute saved-axis delta; Euler pose equivalence beyond 360 wrapping not established. */
        axis_delta?: [number, number, number];
      }>;
    };
  };
  blockers: string[];
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
/** One explicit physical PNG crop, with an exclusive end coordinate. */
export interface MaterialPatchRegion { from: Vec2; to: Vec2; }
/** Numeric comparison only. Matched raw pixel sizes are mandatory. */
export interface MaterialPairComparison {
  scope: "saved_rgba8_material_patch_pair";
  reference_authority: "CALLER_DECLARED";
  source_state: "measured";
  visual_verdict: "UNVERIFIED";
  material_verdict: "NOT_EVALUATED";
  reference_texture_uuid: string;
  candidate_texture_uuid: string;
  reference_region: MaterialPatchRegion;
  candidate_region: MaterialPatchRegion;
  region_pixels: number;
  reference_pixels_sha256: string;
  candidate_pixels_sha256: string;
  reference: {
    sampled_pixels: number;
    visible_pixels: number;
    transparent_pixels: number;
    translucent_pixels: number;
    opaque_pixels: number;
    unique_visible_rgb: number;
    approx_luma_min: number | null;
    approx_luma_max: number | null;
    horizontal_rgb_transitions: number;
    vertical_rgb_transitions: number;
  };
  candidate: MaterialPairComparison["reference"];
  different_rgba_pixels: number;
  different_alpha_pixels: number;
  attention_candidates: string[];
}
/** Source-only native Cube-face/UV binding; never rendered material PASS. */
export interface MaterialFacePatchBinding {
  scope:"source_explicit_cube_face_patch";
  status:"bound_source_only";
  texture_uuid:string;cube_uuid:string;
  face:CubeFaceSurface["side"];
  sample_region:MaterialPatchRegion;
  face_uv_region:MaterialPatchRegion;
  uv_projection:"native_supported_box_or_manual";
  texture_reference:"explicit_saved_link";
  pixel_alias:"no_detected_overlap_for_sample";
  visual_verdict:"UNVERIFIED";
  effective_material:"UNVERIFIED";
  face_coverage_verdict:"UNVERIFIED";
  view_correspondence:"NOT_VERIFIED";
}
/** Native saved atlas statistics only. Never model appearance PASS. */
export interface TextureStylingEvidence {
  scope:"selected_saved_rgba8_atlas_region"|"first_allowed_region_only";
  status:"BASE_ONLY_CANDIDATE"|"REVIEW_REQUIRED"|"NOT_EVALUATED";
  visual_verdict:"UNVERIFIED";texture_completion_attested:false;
  texture_uuid?:string;region?:MaterialPatchRegion;
  region_pixels?:number;visible_pixels?:number;
  unique_visible_rgb?:number;approx_luma_span?:number|null;
  review_hints?:string[];reason?:string;note?:string;
}
/** Saved Cube face-local pixel candidates, never visual/artistic PASS. */
export interface TextureStylingFaceEvidence {
  scope:"saved_cube_face_local_pixels";
  status:"BASE_ONLY_CANDIDATE"|"REVIEW_REQUIRED"|"NOT_EVALUATED";
  texture_uuid:string;cube_uuid:string;face:CubeFaceSurface["side"];
  face_size:[number,number];uv_rotation?:number;
  uv_alias_exclusivity?:"NOT_ASSESSED";
  mapped_render_review?:"REQUIRED";
  visible_pixels?:number;unique_visible_rgb?:number;
  approx_luma_span?:number|null;
  review_hints:string[];reason?:string;
  visual_verdict:"UNVERIFIED";texture_completion_attested:false;
}
/** All declared correction rectangles are accounted for, including missing evidence. */
/** Measured patches expose statistics; skipped/unsupported ones keep
 * their index, rectangle and explicit reason without claiming image proof.
 */
export interface TextureStylingCorrectionRegionEvidence {
  index:number;region:MaterialPatchRegion;source_measured:boolean;
  status:"BASE_ONLY_CANDIDATE"|"REVIEW_REQUIRED"|"NOT_EVALUATED";
  reason?:string;review_hints:string[];
  scope?:TextureStylingEvidence["scope"];
  region_pixels?:number;visible_pixels?:number;
  unique_visible_rgb?:number;approx_luma_span?:number|null;
  visual_verdict?:"UNVERIFIED";texture_completion_attested?:false;
}
export interface TextureStylingCorrectionEvidence {
  scope:"all_declared_correction_regions";
  texture_uuid:string;region_count:number;
  source_measured_regions:number;source_unavailable_regions:number;
  warning_regions:number;coverage:"all_declared_regions_measured"|"partial";
  regions:TextureStylingCorrectionRegionEvidence[];
  visual_verdict:"UNVERIFIED";texture_completion_attested:false;
  next?:string;
}
/** Read-only original atlas RGBAs. A palette read is not the reviewer's
 * authorization to overwrite those colors, nor an artistic PASS.
 */
export interface TextureSourceColorsEvidence {
  scope:"saved_physical_atlas_original_rgba_colors";
  texture_uuid:string;region:MaterialPatchRegion;
  sampled_pixels:number;unique_rgba:number;
  colors:Array<{rgba:[number,number,number,number];pixels:number}>;
  complete:boolean;
  reason:null|"SOURCE_COLORS_MORE_THAN_16_UNIQUE";
  visual_verdict:"UNVERIFIED";texture_completion_attested:false;
  note:string;
}
export type InspectBatchQuery =
  | { kind: "cube"; uuid: string }
  | { kind: "cube_surfaces"; uuid: string }
  | { kind: "cube_face_alpha"; uuid: string }
  | { kind: "cube_uv_sharing"; uuid: string; texture_uuid: string }
  | { kind: "asset_handoff"; texture_uuid: string; offset?: number; limit?: number }
  | { kind: "model_texture_coverage"; offset?: number; limit?: number; attention_only?: boolean }
  | { kind: "material_pair"; reference_uuid: string; candidate_uuid: string; reference_region: MaterialPatchRegion; candidate_region: MaterialPatchRegion }
  | { kind: "material_face_patch"; texture_uuid: string; cube_uuid: string; face: CubeFaceSurface["side"]; region: MaterialPatchRegion }
  | { kind: "texture_styling"; texture_uuid: string; region: MaterialPatchRegion }
  | { kind: "texture_source_colors"; texture_uuid: string; region: MaterialPatchRegion }
  | { kind: "texture_styling_face"; texture_uuid: string; cube_uuid: string; face: CubeFaceSurface["side"] }
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
  | { kind: "asset_handoff"; handoff: AssetHandoffInspection }
  | { kind: "model_texture_coverage"; coverage: ModelTextureCoveragePage }
  | { kind: "material_pair"; comparison: MaterialPairComparison }
  | { kind: "material_face_patch"; binding: MaterialFacePatchBinding }
  | { kind: "texture_styling"; styling: TextureStylingEvidence }
  | { kind: "texture_source_colors"; colors: TextureSourceColorsEvidence }
  | { kind: "texture_styling_face"; styling: TextureStylingFaceEvidence }
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
  /** All declared rectangles, but never an artistic completion receipt. */
  texture_styling_evidence?:TextureStylingCorrectionEvidence|TextureStylingEvidence|null;
  /** Required at runtime for ANY scoped Paint; unscoped edits omit it.
   * SDK raises CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED on missing,
   * inconsistent or stale native success evidence. Rust publication
   * may already have occurred; no automatic retry or rollback is implied.
   */
  correction_scope?: {
    status: "enforced";
    texture_uuid: string;
    protected_regions:number;
    expected_before_pixels:number;
    editable_before_rgba:number;
    visual_verdict: "UNVERIFIED";
  } | null;
}
/** Raw PNG comparison. No pixels enter the guest; visual PASS is not inferred. */
export interface VisualPairReceipt {
  status: "OK";
  source_model_sha256: string;
  reference_png_sha256: string;
  capture_png_sha256: string;
  comparison: {
    scope: "operator_selected_saved_png_pair";
    reference_png_sha256: string;
    capture_png_sha256: string;
    width: number; height: number;
    reference_has_alpha: boolean;
    capture_has_alpha: boolean;
    different_rgba_pixels: number;
    different_rgb_pixels: number;
    silhouette: {
      status: "alpha_overlap_measured" | "unassessed_no_alpha_channel" |
        "unassessed_empty_foreground" | "unassessed_opaque_background";
      reference_foreground_pixels: number;
      capture_foreground_pixels: number;
      intersection_pixels: number;
      union_pixels: number;
      alpha_iou: number | null;
    };
    reference_approval: "NOT_VERIFIED_BY_INSPECTOR";
    capture_provenance: "CALLER_ASSERTED_NOT_NATIVE_VERIFIED";
    framing_correspondence: "NOT_VERIFIED_BY_INSPECTOR";
    visual_verdict: "UNVERIFIED";
    artistic_verdict: "NOT_EVALUATED";
  };
}
export interface OutputReceipt {
  status: "OK";
  /** Present for Bedrock animation output. Bezier baking is an approximation. */
  curve_fidelity?: "native" | "adaptive_bezier_approximation";
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
  apply(input: { input: string; output: string; expectedSha256: string; operations: EditOperation[]; correctionScope?: TextureCorrectionScope; correctionIntent?: MaterialCorrectionIntent; materialWorkPacket?: MaterialWorkPacket }): Promise<ApplyReceipt>;
  inspectVisualPair(input: {
    input: string; expectedSha256: string;
    referencePng: string; capturePng: string;
    referenceSha256: string; captureSha256: string;
  }): Promise<VisualPairReceipt>;
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
  correctionScope?: Readonly<{
    textureUuid:string;
    allowedRegions:ReadonlyArray<Readonly<{
      from:readonly [number,number];to:readonly [number,number]
    }>>;
    regionCount:number;preserveAlpha:boolean;
    protectedRegions?:ReadonlyArray<Readonly<{
      from:readonly [number,number];to:readonly [number,number]
    }>>;
    expectedBeforePixels?:ReadonlyArray<Readonly<{
      at:readonly [number,number];rgba:readonly [number,number,number,number]
    }>>;
    editableBeforeRgba?:ReadonlyArray<readonly [number,number,number,number]>;
  }>;
  /** Operator-visible declared material diagnosis, separate from Rust plan. */
  materialCorrectionIntent?:Readonly<MaterialCorrectionIntent>;
  materialIntentSha256?:string;
  /** Guest PROPOSAL bound to source/reviewer by the trusted host.
   * Not a Rust edit-plan payload or artistic PASS.
   */
  materialWorkPacket?:Readonly<MaterialWorkPacket>;
  materialWorkPacketSha256?:string;
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
  apply(input: { output: string; operations: EditOperation[]; correctionScope?: TextureCorrectionScope; correctionIntent?: MaterialCorrectionIntent; materialWorkPacket?: MaterialWorkPacket }): Promise<ApplyReceipt>;
  exportPng(input: { output: string; textureUuid: string }): Promise<OutputReceipt>;
  exportGeometry(input: { output: string }): Promise<OutputReceipt>;
  exportAnimations(input: { output: string }): Promise<OutputReceipt>;
}
export declare function openRustCodeModeProject(
  client: RustCodeModeClient, input: string
): Promise<RustCodeModeProject>;


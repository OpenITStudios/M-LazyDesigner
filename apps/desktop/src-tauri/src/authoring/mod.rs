//! Standalone Bedrock Entity authoring engine shared by CLI and future Tauri UI.
//! SOURCE_ONLY: no Cargo, CLI, Blockbench, or native acceptance executed.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::cell::{OnceCell, RefCell};
use std::collections::{HashMap, HashSet};
use std::ops::{Deref, DerefMut};
use std::sync::Arc;

mod bbmodel;
mod semantic_map;
mod geometry;
mod edit_operations;
use edit_operations::apply_operation;
// Internal document safety and transformation rules are separate semantic
// owners. They do not contain an EditorSession, history or file publisher.
mod document_validation;
use document_validation::*;
mod cube_uv_rules;
pub use cube_uv_rules::has_per_texture_uv_rules;
use cube_uv_rules::{optional_rotation, check_box_uv_repack_rules, box_uv_refusal_for, cube_auto_uv, cube_box_uv, face_uv, write_face_uv, clamp_uv_pair, refresh_auto_uv, refresh_box_uv, apply_box_resize_offset, validate_cube, validate_cube_with_texture_refs};
mod hierarchy_rules;
use hierarchy_rules::*;
mod animation_frame_rules;
use animation_frame_rules::*;
mod inspections;
pub use inspections::{
    inspect_cube_surfaces,inspect_rotation_track,inspect_transform_track,
    can_add_paint_texture,paint_texture_exportable,paint_texture_snapshot_flags,
    export_paint_png,inspect_paint_alpha,inspect_cube_uv_alpha,
    can_set_empty_atlas_resolution,ValidatedInspection,
};
#[cfg(test)]
use inspections::{
    indexed_texture_uuids,inspect_cube_uv_alpha_with_cache,
    inspect_cube_uv_alpha_validated,
};
mod geometry_assembly;
mod geometry_impact;
pub use geometry_impact::inspect_geometry_impact;
mod geometry_void;
pub use geometry_void::{GeometryVoidZone,check_geometry_void_zones};
mod geometry_sweep;
pub use geometry_sweep::{GeometrySphereSweep, GeometrySweepStation};
mod geometry_profile_sweep;
pub use geometry_profile_sweep::{GeometryProfileSweep, GeometryProfileStation};
mod geometry_axial;
mod geometry_rib_array;
pub use geometry_rib_array::GeometryRibArray;
pub use geometry_axial::{GeometryAxialLoft, GeometryLoftSection, GeometryAxialRevolve, GeometryRevolveSection};
pub use geometry_assembly::{GeometryAssemblyPart, GeometryAssemblyProposal, GeometryAssemblyRequest, GeometryRectangularFrame, GeometryHollowBox, GeometryArch};
mod geometry_attachment;
mod geometry_obb;
pub use geometry_attachment::{GeometryFaceAttachmentRequest, GeometryFaceAttachmentProposal};
mod geometry_propagation;
pub use geometry_propagation::{
    GeometryPropagationLink, GeometryResizePropagationRequest, GeometryResizePropagationProposal,
};
mod paint;
mod correction_scope;
pub use correction_scope::{TextureCorrectionScope, CorrectionRectangle, ExpectedBeforePixel};
mod material_pair;
pub use material_pair::{inspect_material_pair, MaterialPatchRegion};
mod material_styling;
pub use material_styling::{inspect_texture_styling_region, inspect_texture_styling_regions, inspect_texture_styling_face, inspect_texture_source_colors, inspect_texture_source_colors_page};
mod material_face;
mod material_form;
mod material_synthesis;
pub use material_synthesis::{SemanticMaterialIntent, SemanticMaterialProposal};
mod external_texture;
pub use external_texture::ExternalFaceTextureIntent;
mod surface_paint;
mod surface_selection;
mod surface_pattern;
mod surface_shade;
mod surface_seam;
pub use surface_paint::{SurfacePaintIntent,SurfacePaintSampleRequest,SurfaceSourceSample,SurfaceBrushTip};
pub use surface_selection::{SurfaceSelectionRequest,SurfaceSelectionReceipt,SelectionStep,SelectionMode};
pub use surface_pattern::{SurfacePattern,SurfacePatternKind};
pub use surface_shade::{SurfaceShadeInkIntent,ShadeInkDirection};
pub use surface_seam::SurfaceSeamPatch;
pub use material_face::{inspect_material_face_patch,inspect_material_face_patch_with_spans,FaceLocalRowSpan};
mod visual_pair;
pub use visual_pair::{inspect_visual_png_pair, MAX_VISUAL_PNG_BYTES};
mod uv_sharing;
mod texture_coverage;
mod subtree;
mod bezier;
mod animation_clip;
mod animation_periodic;
pub use animation_periodic::{PeriodicRotationIntent,PeriodicRotationProposal};
mod animation_semantic;
pub use animation_semantic::{SemanticAnimationIntent,SemanticAnimationProposal};
mod animation_trajectory;
mod animation_existing;
pub use animation_existing::{ExistingAnimationIntent,ExistingAnimationReview};
mod animation_export;
pub use animation_export::{export_bedrock_animations, bedrock_animation_curve_fidelity};
mod asset_handoff;
pub use asset_handoff::{inspect_bedrock_asset_handoff, inspect_bedrock_asset_handoff_page};
mod effects;
pub use effects::{inspect_animation_effect_events, AnimationEffectPoint};
mod timeline_markers;
pub use timeline_markers::{inspect_animation_timeline_markers, saved_timeline_markers, valid_saved_markers, SavedTimelineMarker};
mod face_regions;
pub use bezier::{parse_saved_bezier_handles, valid_track_segments, BezierKeyframeHandles};
mod palette;
pub use uv_sharing::inspect_cube_uv_sharing;
pub use texture_coverage::{inspect_model_texture_coverage, inspect_model_texture_coverage_filtered};
pub mod storage;
pub use geometry::export_bedrock_geometry;

/// The exact generated-texture gate shared by Rust edits and Tauri UI projection.
pub fn paint_texture_editable(texture: &Value) -> bool { paint::editable(texture) }

/// Metadata-only eligibility; the actual Paint adoption must fully decode PNG.
pub fn paint_texture_adoptable(texture: &Value, width: u32, height: u32) -> bool {
    paint::adoptable(texture, width, height)
}

pub const MAX_MODEL_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_PLAN_BYTES: usize = 64 * 1024;
/// Maximum native/import-png PNG file size before embedded base64 encoding.
pub const MAX_IMPORT_PNG_BYTES: usize = 80 * 1024 * 1024;
/// Match the existing .bbmodel project resolution range; 2K is a baseline,
/// not a separate Paint/brush quality or palette limit.
pub const MAX_PAINT_ATLAS_SIDE: u32 = 4096;
/// Shared bound for native Paint creation/import and the supported 3D preview.
pub const MAX_PAINT_TEXTURES: usize = 16;
// Bound decoded read-only inspection caches by both atlas count and bytes.
const MAX_INSPECTION_PNG_CACHE: usize = 8;
const MAX_INSPECTION_RGBA_CACHE_BYTES: usize = 32 * 1024 * 1024;
/// Maximum validated RGBA8 PNG source bytes emitted without re-encoding.
pub const MAX_EXPORT_PNG_BYTES: usize = 80 * 1024 * 1024;
// No second embedded-PNG aggregate cap or silent Undo eviction: project
// serialization remains guarded by MAX_MODEL_BYTES and existing history
// ownership. Avoid sacrificing artwork or Undo depth as a RAM shortcut.
const MAX_ELEMENTS: usize = 65_536;
const MAX_OPERATIONS: usize = 128;
const MAX_HISTORY: usize = 32;
const MAX_DEPTH: usize = 64;
const LIMIT: f64 = 100_000.0;
const FACE_NAMES: [&str; 6] = ["north", "east", "south", "west", "up", "down"];
type Result<T> = std::result::Result<T, String>;

fn fail(code: &str) -> String { code.to_owned() }
pub fn sha256(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub format_version: String,
    pub model_format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub box_uv: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextureResolution {
    pub width: u32,
    pub height: u32,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cube {
    pub uuid: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub from: [f64; 3],
    pub to: [f64; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uv_offset: Option<[f64; 2]>,
    pub faces: Map<String, Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bone {
    pub uuid: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<[f64; 3]>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OutlinerBone {
    pub uuid: String,
    pub children: Vec<OutlinerNode>,
    #[serde(rename = "isOpen", default, skip_serializing_if = "Option::is_none")]
    pub is_open: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OutlinerNode {
    Cube(String),
    Bone(OutlinerBone),
}

/// Large source-owned JSON collections (Texture/Animation) and opaque
/// project extensions share immutable allocations between Rust revisions.
/// Mutation uses Arc::make_mut on the affected collection, preserving the
/// previously admitted Undo, read-only viewport and provisional versions.
/// The on-disk .bbmodel schema remains ordinary JSON arrays and fields.
#[derive(Debug, Clone)]
pub struct SharedJson<T: Clone>(Arc<T>);
pub type SharedJsonAssets = SharedJson<Vec<Value>>;
pub type SharedJsonExtensions = SharedJson<Map<String, Value>>;

impl<T: Clone> From<T> for SharedJson<T> {
    fn from(value: T) -> Self { Self(Arc::new(value)) }
}
impl<T: Clone + PartialEq> PartialEq for SharedJson<T> {
    fn eq(&self, other: &Self) -> bool {
        // This path is important when EditorSession checks whether a
        // candidate is a no-op. Unchanged shared PNG/Animation/opaque data
        // should not be recursively compared after every Geometry edit.
        Arc::ptr_eq(&self.0, &other.0) ||
            self.0.as_ref() == other.0.as_ref()
    }
}
impl<T: Clone> Deref for SharedJson<T> {
    type Target = T;
    fn deref(&self) -> &Self::Target { self.0.as_ref() }
}
impl<T: Clone> DerefMut for SharedJson<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        Arc::make_mut(&mut self.0)
    }
}
impl<T: Clone> AsRef<T> for SharedJson<T> {
    fn as_ref(&self) -> &T { self.0.as_ref() }
}
impl<T: Clone> std::iter::FromIterator<T> for SharedJson<Vec<T>> {
    fn from_iter<I: IntoIterator<Item = T>>(items: I) -> Self {
        Self::from(items.into_iter().collect::<Vec<_>>())
    }
}
impl<'a, T: Clone> IntoIterator for &'a SharedJson<Vec<T>> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;
    fn into_iter(self) -> Self::IntoIter { self.iter() }
}
impl<'a, T: Clone> IntoIterator for &'a mut SharedJson<Vec<T>> {
    type Item = &'a mut T;
    type IntoIter = std::slice::IterMut<'a, T>;
    fn into_iter(self) -> Self::IntoIter {
        Arc::make_mut(&mut self.0).iter_mut()
    }
}
impl<T: Clone + Serialize> Serialize for SharedJson<T> {
    fn serialize<S: serde::Serializer>(&self, serializer: S)
        -> std::result::Result<S::Ok, S::Error> {
        self.0.as_ref().serialize(serializer)
    }
}
impl<'de, T: Clone + Deserialize<'de>> Deserialize<'de> for SharedJson<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D)
        -> std::result::Result<Self, D::Error> {
        T::deserialize(deserializer).map(Self::from)
    }
}

/// Authoritative typed Rust state. Opaque texture, animation and extension
/// payloads are retained without interpreting or editing those domains.
#[derive(Debug, Clone, PartialEq)]
pub struct AuthoringDocument {
    pub meta: ProjectMeta,
    pub resolution: TextureResolution,
    // Typed geometry and Outliner allocations stay shared for Paint/Animation
    // revisions; the first actual edit to each family detaches via Arc::make_mut.
    pub cubes: SharedJson<Vec<Cube>>,
    pub bones: SharedJson<Vec<Bone>>,
    pub hierarchy: SharedJson<Vec<OutlinerNode>>,
    pub texture_assets: SharedJsonAssets,
    pub animation_assets: SharedJsonAssets,
    pub extensions: SharedJsonExtensions,
}

/// An ordered, bounded rectangle instruction on one RGBA8 texture atlas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaintRectangleStep {
    pub from: [u32; 2],
    pub to: [u32; 2],
    pub rgba: [u8; 4],
    pub erase: bool,
}
/// Exact before/after RGBA patch; never quantize/dither or infer a ramp.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExactPixelPatch {
    pub at:[u32;2],
    pub before:[u8;4],
    pub after:[u8;4],
}

/// Selects one declared Cube face, not a screen-space paint coordinate.
/// Shared atlas UV islands can still affect other Cubes using those pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CubeFacePaintPatch {
    pub face: String,
    pub rgba: [u8; 4],
    pub erase: bool,
}

/// Half-open local face pixel region (not absolute atlas coordinates).
/// Multiple regions may target the same face and apply in caller order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CubeFaceRegionPaintPatch {
    pub face: String,
    pub from: [u32; 2],
    pub to: [u32; 2],
    pub rgba: [u8; 4],
    pub erase: bool,
}

/// Exact authored RGB replacement. Alpha is deliberately not a parameter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaletteRgbSwap {
    pub from: [u8; 3],
    pub to: [u8; 3],
}

/// Selected faces on one Cube. Cross-Cube atlas aliases must be resolved or
/// isolated explicitly before recoloring either counterpart.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CubePaletteTarget {
    pub cube_uuid: String,
    pub faces: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum EditOperation {
    AddBone { bone: Bone, parent_uuid: Option<String> },
    AddCube { cube: Cube, bone_uuid: String },
    DuplicateCube { source_uuid: String, new_uuid: String },
    DuplicateBoneSubtree { source_uuid: String, new_uuid: String, name_suffix: String },
    ReparentNode { uuid: String, parent_uuid: Option<String> },
    RenameNode { uuid: String, name: String },
    RemoveCube { uuid: String },
    RemoveEmptyBone { uuid: String },
    CreateAnimation { uuid: String, name: String, length: f64 },
    DuplicateAnimationClip { source_uuid: String, new_uuid: String, new_name: String },
    AddAnimationTimelineMarker { animation_uuid: String, time: f64, name: String, color: u8 },
    UpdateAnimationTimelineMarker { animation_uuid: String, target_time: f64, time: f64, name: String, color: u8 },
    RemoveAnimationTimelineMarker { animation_uuid: String, time: f64 },
    AddAnimationEffectEvent { animation_uuid: String, keyframe_uuid: String, channel: String, time: f64, points: Vec<AnimationEffectPoint> },
    UpdateAnimationEffectEvent { animation_uuid: String, keyframe_uuid: String, channel: String, time: f64, points: Vec<AnimationEffectPoint> },
    RemoveAnimationEffectEvent { animation_uuid: String, keyframe_uuid: String, channel: String },
    SetAnimationLength { animation_uuid: String, length: f64 },
    SetAnimationLoopMode { animation_uuid: String, mode: String },
    ScaleAnimationTimeline { animation_uuid: String, factor: f64 },
    AddBoneRotationKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        time: f64, rotation: [f64; 3],
    },
    UpdateBoneRotationKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        time: f64, rotation: [f64; 3],
    },
    RemoveBoneRotationKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
    },
    AddBoneTransformKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        channel: String, time: f64, value: [f64; 3],
    },
    UpdateBoneTransformKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        channel: String, time: f64, value: [f64; 3],
    },
    SetBoneTransformKeyframeInterpolation {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        channel: String, interpolation: String,
    },
    SetBoneTransformKeyframeBezier {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        channel: String, handles: BezierKeyframeHandles,
    },
    RemoveBoneTransformKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        channel: String,
    },
    TranslateCube { uuid: String, delta: [f64; 3] },
    TranslateBoneSubtree { uuid: String, delta: [f64; 3] },
    ReflectBoneSubtree { uuid: String, axis: String, center: f64, uv_policy: String },
    SetCubeBounds { uuid: String, from: [f64; 3], to: [f64; 3] },
    ReframeCube { uuid: String, from: [f64; 3], to: [f64; 3], uv_policy: String },
    SetCubeRotation { uuid: String, rotation: [f64; 3] },
    ScaleCube { uuid: String, factors: [f64; 3] },
    SetBoneRotation { uuid: String, rotation: [f64; 3] },
    SetBoneOrigin { uuid: String, origin: [f64; 3] },
    SetCubeOrigin { uuid: String, origin: [f64; 3] },
    SetCubeInflate { uuid: String, inflate: f64 },
    SetCubeStretch { uuid: String, stretch: [f64; 3] },
    SetCubeMirrorUv { uuid: String, mirrored: bool },
    SetNodeVisibility { uuid: String, visible: bool },
    SetFaceUv { uuid: String, face: String, uv: [f64; 4] },
    SetFaceUvRotation { uuid: String, face: String, rotation: u16 },
    SetBoxUvOffset { uuid: String, offset: [f64; 2] },
    CreatePaintTexture { uuid: String, name: String },
    EnableImportedPaintTexture { texture_index: usize },
    ImportPaintTexture { uuid: String, name: String, source: String },
    /// Bounded PNG candidate for one unique, explicit Cube face only.
    /// Even direct EditOperation callers cannot bypass face/source-color guards.
    ReplaceExistingFaceTextureGuarded {
        intent: ExternalFaceTextureIntent, candidate_png_source: String,
    },
    SetEmptyAtlasResolution { width: u32, height: u32 },
    // Blockbench Project.visible_box [width, height, offsetY] in model blocks.
    SetVisibleBox { bounds: [f64; 3] },
    AssignCubeTexture { cube_uuid: String, texture_uuid: String },
    AssignCubeFaceTexture { cube_uuid: String, face: String, texture_uuid: String },
    PaintTexturePixel { texture_index: usize, x: u32, y: u32, rgba: [u8; 4] },
    PaintTextureStroke { texture_index: usize, points: Vec<[u32; 2]>, rgba: [u8; 4] },
    PaintTextureExactPixels { texture_index:usize, pixels:Vec<ExactPixelPatch> },
    PaintTextureBrush { texture_index: usize, points: Vec<[u32; 2]>, radius: u8, rgba: [u8; 4], erase: bool },
    PaintTextureRectangle { texture_index: usize, from: [u32; 2], to: [u32; 2], rgba: [u8; 4], erase: bool },
    PaintTextureRectangles { texture_index: usize, rectangles: Vec<PaintRectangleStep> },
    PaintCubeUvFaces {
        cube_uuid: String, texture_uuid: String, faces: Vec<CubeFacePaintPatch>,
    },
    PaintCubeUvFacesGuarded {
        cube_uuid: String, texture_uuid: String, faces: Vec<CubeFacePaintPatch>,
    },
    PaintCubeFaceRegionsGuarded {
        cube_uuid: String, texture_uuid: String, regions: Vec<CubeFaceRegionPaintPatch>,
    },
    RecolorCubeFacesPaletteGuarded {
        texture_uuid: String, targets: Vec<CubePaletteTarget>, palette: Vec<PaletteRgbSwap>,
    },
    IsolateCubeBoxUv { cube_uuid: String, texture_uuid: String },
    PaintTextureFill { texture_index: usize, at: [u32; 2], rgba: [u8; 4], erase: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditPlan {
    pub expected_revision: u64,
    pub operations: Vec<EditOperation>,
    #[serde(default)]
    pub correction_scope: Option<TextureCorrectionScope>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentSummary {
    pub revision: u64,
    pub format_version: String,
    pub model_format: String,
    pub cubes: usize,
    pub bones: usize,
    pub textures: usize,
    pub animations: usize,
    pub supported_slice: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct MutationReceipt {
    pub revision: u64,
    pub operation_count: usize,
    pub changed_uuids: Vec<String>,
}

impl AuthoringDocument {
    pub fn new_bedrock(name: &str, identifier: &str) -> Result<Self> {
        if name.trim().is_empty() || name.chars().count() > 80 ||
           name.chars().any(char::is_control) ||
           identifier.is_empty() || identifier.len() > 128 ||
           !identifier.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-')) {
            return Err(fail("NEW_PROJECT_IDENTITY_INVALID"));
        }
        let mut extra = Map::new();
        extra.insert("name".into(), Value::String(name.into()));
        extra.insert("model_identifier".into(), Value::String(identifier.into()));
        let document = Self {
            meta: ProjectMeta {
                format_version: "5.0".into(), model_format: "bedrock".into(),
                box_uv: Some(true), extra: Map::new(),
            },
            resolution: TextureResolution { width: 128, height: 128, extra: Map::new() },
            cubes: Vec::new().into(), bones: Vec::new().into(), hierarchy: Vec::new().into(),
            texture_assets: Vec::new().into(), animation_assets: Vec::new().into(),
            extensions: extra.into(),
        };
        document.validate()?;
        Ok(document)
    }

    pub fn import_bbmodel(bytes: &[u8]) -> Result<Self> {
        bbmodel::decode(bytes)
    }

    pub fn validate(&self) -> Result<()> {
        if self.meta.format_version != "5.0" || self.meta.model_format != "bedrock" {
            return Err(fail("BBMODEL_VERSION_OR_FORMAT_UNSUPPORTED"));
        }
        if !(1..=4096).contains(&self.resolution.width) || !(1..=4096).contains(&self.resolution.height) {
            return Err(fail("BBMODEL_RESOLUTION_INVALID"));
        }
        if self.cubes.len() > MAX_ELEMENTS || self.bones.len() > MAX_ELEMENTS ||
           self.texture_assets.len() > MAX_ELEMENTS || self.animation_assets.len() > MAX_ELEMENTS {
            return Err(fail("BBMODEL_SIZE_LIMIT"));
        }
        let texture_refs: HashSet<&str> = self.texture_assets.iter()
            .filter_map(|texture| texture.get("uuid").and_then(Value::as_str)).collect();
        let mut all_ids: HashSet<&str> = HashSet::new();
        let mut cube_ids: HashSet<&str> = HashSet::new();
        let mut bone_ids: HashSet<&str> = HashSet::new();
        for cube in &self.cubes {
            validate_cube_with_texture_refs(cube, self.texture_assets.len(), &texture_refs)?;
            if !all_ids.insert(cube.uuid.as_str()) { return Err(fail("DUPLICATE_UUID")); }
            cube_ids.insert(cube.uuid.as_str());
        }
        for bone in &self.bones {
            if !valid_uuid(&bone.uuid) || bone.name.trim().is_empty() ||
               bone.name.chars().count() > 128 || bone.origin.is_some_and(|v| !valid_vec3(v)) {
                return Err(fail("BONE_INVALID"));
            }
            optional_rotation(&bone.extra)?;
            if bone.extra.get("children").is_some_and(|v| v.as_array().is_none_or(|children| !children.is_empty())) {
                return Err(fail("BONE_CHILDREN_MUST_USE_OUTLINER"));
            }
            if !all_ids.insert(bone.uuid.as_str()) { return Err(fail("DUPLICATE_UUID")); }
            bone_ids.insert(bone.uuid.as_str());
        }
        if self.extensions.contains_key("history") || self.extensions.contains_key("history_index") {
            return Err(fail("BBMODEL_EMBEDDED_HISTORY_UNSUPPORTED"));
        }
        if self.texture_assets.iter().any(|v| !v.is_object()) ||
           self.animation_assets.iter().any(|v| !v.is_object()) {
            return Err(fail("BBMODEL_ASSET_ENTRY_INVALID"));
        }
        // Blockbench stores per-face texture references by UUID. Ambiguous
        // duplicate asset UUIDs must not choose the first matching texture.
        let mut texture_ids = HashSet::new();
        for texture in &self.texture_assets {
            if let Some(uuid) = texture.get("uuid") {
                let id = uuid.as_str().ok_or_else(|| fail("TEXTURE_UUID_INVALID"))?;
                if !valid_uuid(id) { return Err(fail("TEXTURE_UUID_INVALID")); }
                if !texture_ids.insert(id) { return Err(fail("TEXTURE_UUID_DUPLICATE")); }
            }
        }
        let mut seen_cubes = HashSet::new();
        let mut seen_bones = HashSet::new();
        validate_outliner(&self.hierarchy, &cube_ids, &bone_ids,
            &mut seen_cubes, &mut seen_bones, 0)?;
        if seen_cubes.len() != cube_ids.len() || seen_bones.len() != bone_ids.len() {
            return Err(fail("OUTLINER_INCOMPLETE"));
        }
        Ok(())
    }

    pub fn export_bbmodel(&self) -> Result<Vec<u8>> {
        bbmodel::encode(self)
    }

    pub fn summary(&self, revision: u64) -> DocumentSummary {
        DocumentSummary {
            revision, format_version: self.meta.format_version.clone(),
            model_format: self.meta.model_format.clone(), cubes: self.cubes.len(),
            bones: self.bones.len(), textures: self.texture_assets.len(),
            animations: self.animation_assets.len(), supported_slice: "bedrock_cube_geometry_v5_0",
        }
    }
}

/// The only mutable authoring state. Each GUI/CLI caller must supply the
/// expected in-process revision; CLI also checks exact source SHA-256.
#[derive(Clone)]
pub struct EditorSession {
    // Immutable published versions are shared by Tauri read projections and
    // history. The transaction candidate remains an independent full copy.
    doc: Arc<AuthoringDocument>,
    revision: u64,
    undo: Vec<Arc<AuthoringDocument>>,
    redo: Vec<Arc<AuthoringDocument>>,
}

impl EditorSession {
    pub fn open(bytes: &[u8]) -> Result<Self> {
        // bbmodel::decode already validates all imported model data.
        let doc = AuthoringDocument::import_bbmodel(bytes)?;
        Ok(Self { doc: Arc::new(doc), revision: 0, undo: Vec::new(), redo: Vec::new() })
    }
    pub fn from_document(doc: AuthoringDocument) -> Result<Self> {
        // Direct constructors still admit caller-owned, potentially invalid state.
        doc.validate()?;
        Ok(Self { doc: Arc::new(doc), revision: 0, undo: Vec::new(), redo: Vec::new() })
    }
    pub fn document(&self) -> &AuthoringDocument { self.doc.as_ref() }
    /// A revision-fixed immutable view for read-only projection outside an
    /// editor store lock. Sharing never allows a GUI caller to mutate source.
    pub fn snapshot_document(&self) -> Arc<AuthoringDocument> {
        Arc::clone(&self.doc)
    }
    /// Read-only semantic projection from this admitted immutable revision.
    /// Tauri and headless CLI consume the same bounded Rust-owned map.
    pub fn semantic_map(&self, category: &str, offset: usize, limit: usize) -> Result<Value> {
        semantic_map::from_validated(&self.doc, self.revision, category, offset, limit)
    }

    /// Compile a source-bound G1 Geometry assembly and validate it on the
    /// existing disposable Rust preflight path. No state/Undo is mutated.
    pub fn plan_geometry_assembly(
        &self, request: &GeometryAssemblyRequest,
    ) -> Result<GeometryAssemblyProposal> {
        geometry_assembly::compile(self, request)
    }

    /// Source-only P0 material candidate, never a direct bitmap/approval API.
    pub fn plan_semantic_material(
        &self, intent: &SemanticMaterialIntent,
    ) -> Result<SemanticMaterialProposal> {
        material_synthesis::compile(self, intent)
    }
    /// A1 read-only, bounded phase/amplitude Bone rotation plan.
    pub fn plan_periodic_rotation(
        &self, intent: &PeriodicRotationIntent,
    ) -> Result<PeriodicRotationProposal> {
        animation_periodic::compile(self,intent)
    }

    /// Bounded read-only P0 semantic key-pose planner and temporal review hints.
    pub fn plan_semantic_animation(&self, intent: &SemanticAnimationIntent)
        -> Result<SemanticAnimationProposal> {
        animation_semantic::compile(self,intent)
    }

    /// Review a selected saved numeric animation; optionally propose exactly
    /// one source-preconditioned keyframe change using the SAME EditPlan.
    pub fn review_existing_animation(&self,intent:&ExistingAnimationIntent)
        -> Result<ExistingAnimationReview> {
        animation_existing::review(self,intent)
    }

    /// External editor pixels use the same immutable Rust transaction and
    /// correction scope as direct Paint. No file/editor process is owned here.
    pub fn apply_external_face_texture(
        &mut self, intent: &ExternalFaceTextureIntent, candidate_png_source: &str,
    ) -> Result<MutationReceipt> {
        external_texture::apply(self,intent,candidate_png_source)
    }

    /// Direct-user 3D stroke, compiled against immutable source Cube/UV and
    /// exact RGBA. The bitmap/Undo still belong to the canonical Paint owner.
    pub fn apply_surface_paint_stroke(
        &mut self, intent:&SurfacePaintIntent,
    )->Result<MutationReceipt>{
        surface_paint::apply(self,intent)
    }
    /// Read precisely one source-owned RGBA8 texel; no edit or Undo.
    pub fn sample_surface_source(
        &self,request:&SurfacePaintSampleRequest,
    )->Result<SurfaceSourceSample>{
        surface_paint::sample(self,request)
    }
    /// Read-only exact source connected island, never a mutation grant.
    pub fn select_surface_source(
        &self,request:&SurfaceSelectionRequest,
    )->Result<SurfaceSelectionReceipt>{
        surface_selection::read(self,request)
    }
    /// Exactly one artist-authored source ramp step per painted pixel/Undo.
    pub fn shade_surface_stroke(
        &mut self,intent:&SurfaceShadeInkIntent,
    )->Result<MutationReceipt>{
        surface_shade::apply(self,intent)
    }

    /// G2: propose an explicit same-Bone face alignment with UV-aware Rust
    /// translation, using the existing disposable transaction validator.
    pub fn plan_geometry_attachment(
        &self, request: &GeometryFaceAttachmentRequest,
    ) -> Result<GeometryFaceAttachmentProposal> {
        geometry_attachment::compile(self, request)
    }

    /// G2.2: one-shot root resize and explicit dependency propagation
    /// through the canonical Rust EditPlan. No persistent constraint graph.
    pub fn plan_geometry_resize_propagation(
        &self, request: &GeometryResizePropagationRequest,
    ) -> Result<GeometryResizePropagationProposal> {
        geometry_propagation::compile(self, request)
    }

    /// Dry-run exactly the canonical mutation path on a disposable COW clone.
    /// No model revision, history, dirty flag, file, or host approval changes.
    /// A valid preflight is not permission to write or evidence of visual quality.
    pub fn preflight(&self, plan: &EditPlan) -> Result<Value> {
        if serde_json::to_vec(plan)
            .map_err(|_| fail("PREFLIGHT_PLAN_INVALID"))?.len() > MAX_PLAN_BYTES {
            return Err(fail("PREFLIGHT_PLAN_TOO_LARGE"));
        }
        let mut candidate = self.clone();
        let mutation = candidate.apply_with_correction_scope(
            plan.expected_revision, &plan.operations, plan.correction_scope.as_ref(),
        )?;
        let candidate_sha256 = candidate.canonical_sha256()?;
        let result = json!({
            "status":"VALIDATED_NOT_APPLIED",
            "base_revision":self.revision,
            "mutation":mutation,
            "candidate_sha256":candidate_sha256,
            "candidate_summary":candidate.summary(),
            "write_authority":"NOT_GRANTED",
            "visual_verdict":"UNVERIFIED",
        });
        if serde_json::to_vec(&result)
            .map_err(|_| fail("PREFLIGHT_RESULT_INVALID"))?.len() > 32 * 1024 {
            return Err(fail("PREFLIGHT_RESULT_TOO_LARGE"));
        }
        Ok(result)
    }

    pub fn inspections(&self) -> ValidatedInspection<'_> {
        ValidatedInspection {
            doc: self.doc.as_ref(),
            texture_indices: OnceCell::new(),
            decoded_pngs: RefCell::new(Vec::new()),
            geometry_impact_index: OnceCell::new(),
        }
    }
    pub fn can_undo(&self) -> bool { !self.undo.is_empty() }
    pub fn can_redo(&self) -> bool { !self.redo.is_empty() }
    pub fn summary(&self) -> DocumentSummary { self.doc.summary(self.revision) }
    pub fn export(&self) -> Result<Vec<u8>> { self.doc.export_bbmodel() }
    /// Hash the exact canonical exported bytes without an output buffer or a
    /// redundant second full-document validation. EditorSession owns only
    /// validated documents: Open/FromDocument and each successful Apply have
    /// already checked them; Undo/Redo restore those validated versions.
    /// File export and direct document encoding retain independent validation.
    pub fn canonical_sha256(&self) -> Result<String> {
        bbmodel::canonical_sha256_validated(&self.doc)
    }

    pub fn apply(&mut self, expected_revision: u64, operations: &[EditOperation]) -> Result<MutationReceipt> {
        self.apply_with_correction_scope(expected_revision, operations, None)
    }
    /// Ephemeral caller correction bounds; do not save them to .bbmodel.
    pub fn apply_with_correction_scope(
        &mut self, expected_revision: u64, operations: &[EditOperation],
        scope: Option<&TextureCorrectionScope>,
    ) -> Result<MutationReceipt> {
        self.check_revision(expected_revision)?;
        let scope_index = scope.map(|item|
            correction_scope::validate_scope(&self.doc, item)
        ).transpose()?;
        if operations.is_empty() || operations.len() > MAX_OPERATIONS {
            return Err(fail("EDIT_BATCH_SIZE_INVALID"));
        }
        // A direct EditOperation must not bypass the intent's source revision
        // by using a different outer batch revision.
        if operations.iter().any(|operation|matches!(operation,
            EditOperation::ReplaceExistingFaceTextureGuarded{intent,..}
                if intent.expected_revision!=expected_revision)) {
            return Err(fail("EXTERNAL_TEXTURE_REVISION_STALE"));
        }
        let mut next = self.doc.as_ref().clone();
        let mut changed = Vec::new();
        let mut index = 0;
        while index < operations.len() {
            // Consecutive, same-atlas guarded face operations have immutable
            // Cube/UV ownership. Plan every operation in order, then apply
            // up to 64 physical rectangles through ONE PNG decode/encode.
            // Mixed operations, atlas changes and over-budget groups keep
            // their original sequential path and independent safety checks.
            if let EditOperation::PaintCubeFaceRegionsGuarded { texture_uuid, .. } = &operations[index] {
                let mut end = index;
                let mut count = 0;
                while let Some(EditOperation::PaintCubeFaceRegionsGuarded {
                    texture_uuid: candidate, regions, ..
                }) = operations.get(end) {
                    if candidate != texture_uuid ||
                        count + regions.len() > face_regions::MAX_FACE_REGIONS { break; }
                    count += regions.len();
                    end += 1;
                }
                if end > index + 1 {
                    let mut steps = Vec::with_capacity(count);
                    let mut target_index = None;
                    for operation in &operations[index..end] {
                        if let EditOperation::PaintCubeFaceRegionsGuarded {
                            cube_uuid, texture_uuid, regions,
                        } = operation {
                            let (texture_index, planned) =
                                face_regions::plan_cube_face_regions_guarded(
                                    &next, cube_uuid, texture_uuid, regions)?;
                            if target_index.is_some_and(|prior| prior != texture_index) {
                                return Err(fail("PAINT_TEXTURE_NOT_FOUND"));
                            }
                            target_index = Some(texture_index);
                            steps.extend(planned);
                        }
                    }
                    let texture = next.texture_assets.get_mut(target_index
                        .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?)
                        .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
                    paint::rectangles(texture, next.resolution.width,
                        next.resolution.height, &steps)?;
                    if !changed.contains(texture_uuid) { changed.push(texture_uuid.clone()); }
                    index = end;
                    continue;
                }
            }
            let id = apply_operation(&mut next, &operations[index])?;
            if !changed.contains(&id) { changed.push(id); }
            index += 1;
        }
        next.validate()?;
        if let (Some(item), Some(index)) = (scope, scope_index) {
            correction_scope::verify_after(&self.doc, &next, item, index)?;
        }
        if &next == self.doc.as_ref() { return Err(fail("EDIT_NO_OP")); }
        let prior = std::mem::replace(&mut self.doc, Arc::new(next));
        if self.undo.len() == MAX_HISTORY { self.undo.remove(0); }
        self.undo.push(prior);
        self.redo.clear();
        self.revision += 1;
        Ok(MutationReceipt { revision: self.revision, operation_count: operations.len(), changed_uuids: changed })
    }

    pub fn undo(&mut self, expected_revision: u64) -> Result<MutationReceipt> {
        self.check_revision(expected_revision)?;
        let prior = self.undo.pop().ok_or_else(|| fail("UNDO_EMPTY"))?;
        let current = std::mem::replace(&mut self.doc, prior);
        self.redo.push(current);
        self.revision += 1;
        Ok(MutationReceipt { revision: self.revision, operation_count: 1, changed_uuids: Vec::new() })
    }
    pub fn redo(&mut self, expected_revision: u64) -> Result<MutationReceipt> {
        self.check_revision(expected_revision)?;
        let next = self.redo.pop().ok_or_else(|| fail("REDO_EMPTY"))?;
        let prior = std::mem::replace(&mut self.doc, next);
        if self.undo.len() == MAX_HISTORY { self.undo.remove(0); }
        self.undo.push(prior);
        self.revision += 1;
        Ok(MutationReceipt { revision: self.revision, operation_count: 1, changed_uuids: Vec::new() })
    }
    fn check_revision(&self, revision: u64) -> Result<()> {
        if revision != self.revision { Err(fail("DOCUMENT_REVISION_STALE")) } else { Ok(()) }
    }
}

#[cfg(test)]
mod tests;

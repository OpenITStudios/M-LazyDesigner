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

fn valid_uuid(uuid: &str) -> bool {
    !uuid.is_empty() && uuid.len() <= 128 &&
        !uuid.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// User-authored element labels. Preserve imported names as stored; only new
/// rename requests must be bounded and must not contain control characters.
/// A separate Bedrock geometry exporter owns stricter bone export admission.
fn valid_node_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 128 &&
        !name.chars().any(char::is_control)
}
fn valid_vec3(v: [f64; 3]) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= LIMIT)
}
fn valid_bounds(from: [f64; 3], to: [f64; 3]) -> bool {
    valid_vec3(from) && valid_vec3(to) &&
        (0..3).all(|axis| from[axis] <= to[axis])
}
fn valid_uv(v: &[f64]) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= LIMIT)
}

// Blockbench's saved extra fields affect actual geometry and UV behavior.
// Refuse malformed values instead of preserving JSON that Blockbench would
// silently ignore on reopen.
fn optional_rotation(extra: &Map<String, Value>) -> Result<()> {
    if let Some(rotation) = extra.get("rotation") {
        let values = rotation.as_array().ok_or_else(|| fail("ROTATION_FORMAT_INVALID"))?;
        if values.len() != 3 || !values.iter().all(|value|
            value.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= LIMIT)) {
            return Err(fail("ROTATION_FORMAT_INVALID"));
        }
    }
    Ok(())
}

/// One Box UV recomputation admission used by every mutating consumer,
/// not only by the newer Reframe operation. An imported multi-file atlas or
/// float-sized net cannot safely use these integer project-atlas rectangles.
fn check_box_uv_repack_rules(doc: &AuthoringDocument, cube: &Cube) -> Result<()> {
    if has_per_texture_uv_rules(doc) {
        return Err(fail("CUBE_BOX_UV_RULESET_UNSUPPORTED"));
    }
    let unsupported_float_uv = [
        doc.meta.extra.get("box_uv_float_size"),
        doc.extensions.get("box_uv_float_size"),
        cube.extra.get("box_uv_float_size"),
    ].into_iter().flatten().any(|flag| flag != &Value::Bool(false));
    if unsupported_float_uv {
        return Err(fail("CUBE_BOX_UV_FLOAT_UNSUPPORTED"));
    }
    Ok(())
}

/// Preserve the public refusal codes of already-authored Reframe and
/// Mirror operations, while sharing a single source-level safety predicate.
fn box_uv_refusal_for(operation: &str, code: String) -> String {
    match (operation, code.as_str()) {
        ("reframe", "CUBE_BOX_UV_RULESET_UNSUPPORTED") =>
            fail("CUBE_REFRAME_UV_RULESET_UNSUPPORTED"),
        ("reframe", "CUBE_BOX_UV_FLOAT_UNSUPPORTED") =>
            fail("CUBE_REFRAME_BOX_UV_FLOAT_UNSUPPORTED"),
        ("mirror", "CUBE_BOX_UV_RULESET_UNSUPPORTED") =>
            fail("CUBE_MIRROR_UV_RULESET_UNSUPPORTED"),
        ("mirror", "CUBE_BOX_UV_FLOAT_UNSUPPORTED") =>
            fail("CUBE_MIRROR_UV_FLOAT_UNSUPPORTED"),
        _ => code,
    }
}

fn cube_auto_uv(cube: &Cube) -> Result<u8> {
    match cube.extra.get("autouv") {
        None => Ok(0),
        Some(value) if value.as_f64() == Some(0.0) => Ok(0),
        Some(value) if value.as_f64() == Some(1.0) => Ok(1),
        Some(value) if value.as_f64() == Some(2.0) => Ok(2),
        _ => Err(fail("CUBE_AUTO_UV_MODE_UNSUPPORTED")),
    }
}

fn cube_box_uv(cube: &Cube, default: bool) -> bool {
    cube.extra.get("box_uv").and_then(Value::as_bool).unwrap_or(default)
}


/// Whether project-wide UV remapping/preview is unsafe for imported rules.
/// Blockbench 5.2.1 derives per-texture UV sizing from the multi-file ruleset.
/// Explicit flags are retained opaquely; malformed flags must fail closed,
/// not silently become "false" on either the CLI/Tauri edit or preview path.
pub fn has_per_texture_uv_rules(doc: &AuthoringDocument) -> bool {
    for flag in [
        doc.meta.extra.get("per_texture_uv_size"),
        doc.extensions.get("per_texture_uv_size"),
    ] {
        if flag.is_some_and(|value| value != &Value::Bool(false)) {
            return true;
        }
    }
    // A non-empty multi-file ruleset requires per-texture UV resolution.
    // Unknown types cannot be interpreted as the empty ruleset.
    doc.extensions.get("multi_file_ruleset").is_some_and(|value| match value {
        Value::String(name) => !name.is_empty(),
        _ => true,
    })
}

fn face_uv(cube: &Cube, side: &str) -> Result<[f64; 4]> {
    cube.faces.get(side)
        .and_then(|face| face.get("uv"))
        .and_then(|uv| serde_json::from_value::<[f64; 4]>(uv.clone()).ok())
        .ok_or_else(|| fail("CUBE_FACE_UV_INVALID"))
}

fn write_face_uv(cube: &mut Cube, side: &str, uv: [f64; 4]) -> Result<()> {
    cube.faces.get_mut(side).and_then(Value::as_object_mut)
        .ok_or_else(|| fail("CUBE_FACE_INVALID"))?
        .insert("uv".into(), json!(uv));
    Ok(())
}

fn clamp_uv_pair(mut a: f64, mut b: f64, limit: f64) -> (f64, f64) {
    if a.max(b) > limit {
        let overshoot = a.max(b) - limit;
        a -= overshoot;
        b -= overshoot;
    }
    if a.min(b) < 0.0 {
        let undershoot = a.min(b);
        a = (a - undershoot).clamp(0.0, limit);
        b = (b - undershoot).clamp(0.0, limit);
    }
    (a, b)
}

/** Derived from the observable Bedrock Cube Auto UV 1/2 contract in Blockbench 5.2.1. */
fn refresh_auto_uv(
    cube: &mut Cube,
    mode: u8,
    resolution: [f64; 2],
    textures: &[Value],
    resized: Option<(usize, i8)>,
) -> Result<()> {
    if mode == 0 { return Ok(()); }
    let [width, height] = resolution;
    for side in FACE_NAMES {
        let old = face_uv(cube, side)?;
        let uv = if mode == 2 {
            // Bedrock's centered grid uses an 8-unit offset in world-relative UV.
            let f = cube.from;
            let t = cube.to;
            let coords = match side {
                "north" => [width - t[0] - 8.0, height - t[1], width - f[0] - 8.0, height - f[1]],
                "south" => [f[0] + 8.0, height - t[1], t[0] + 8.0, height - f[1]],
                "west" => [f[2] + 8.0, height - t[1], t[2] + 8.0, height - f[1]],
                "east" => [width - t[2] - 8.0, height - t[1], width - f[2] - 8.0, height - f[1]],
                "up" => [f[0] + 8.0, f[2] + 8.0, t[0] + 8.0, t[2] + 8.0],
                "down" => [f[0] + 8.0, height - t[2] - 8.0, t[0] + 8.0, height - f[2] - 8.0],
                _ => unreachable!(),
            };
            let (u0, u1) = clamp_uv_pair(coords[0], coords[2], width);
            let (v0, v1) = clamp_uv_pair(coords[1], coords[3], height);
            [u0, v0, u1, v1]
        } else {
            let (mut axes, mut directions): ([usize; 2], [i8; 2]) = match side {
                "north" | "south" => ([0, 1], [if side == "north" { 1 } else { -1 }, 1]),
                "east" | "west" => ([2, 1], [if side == "east" { 1 } else { -1 }, 1]),
                "up" => ([0, 2], [-1, -1]),
                "down" => ([0, 2], [-1, 1]),
                _ => unreachable!(),
            };
            let face = cube.faces.get(side).ok_or_else(|| fail("CUBE_FACE_INVALID"))?;
            let rotation = match face.get("rotation") {
                None => 0.0,
                Some(value) => value.as_f64().ok_or_else(|| fail("CUBE_AUTO_UV_FACE_ROTATION_UNSUPPORTED"))?,
            };
            if ![0.0, 90.0, 180.0, 270.0].contains(&rotation) {
                return Err(fail("CUBE_AUTO_UV_FACE_ROTATION_UNSUPPORTED"));
            }
            let texture = match face.get("texture") {
                Some(Value::Number(index)) => index.as_u64()
                    .and_then(|index| textures.get(index as usize)),
                Some(Value::String(uuid)) => textures.iter().find(|texture|
                    texture.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())),
                _ => None,
            };
            let wrap = match texture.and_then(|item| item.get("wrap_mode")) {
                None => "limited",
                Some(value) => value.as_str().ok_or_else(|| fail("CUBE_AUTO_UV_WRAP_MODE_UNSUPPORTED"))?,
            };
            if !["limited", "repeat", "clamp"].contains(&wrap) {
                return Err(fail("CUBE_AUTO_UV_WRAP_MODE_UNSUPPORTED"));
            }
            let limited = wrap == "limited";
            let mut size = [
                ((cube.to[axes[0]] - cube.from[axes[0]]).abs() * 100.0).round() / 100.0,
                ((cube.to[axes[1]] - cube.from[axes[1]]).abs() * 100.0).round() / 100.0,
            ];
            if rotation == 90.0 || rotation == 270.0 {
                size.swap(0, 1);
                axes.swap(0, 1);
                directions.swap(0, 1);
            }
            if rotation == 180.0 || rotation == 270.0 {
                for direction in &mut directions { *direction = -*direction; }
            }
            if rotation == 270.0 { directions[1] = -directions[1]; }
            if limited {
                size[0] = size[0].clamp(0.0, width);
                size[1] = size[1].clamp(0.0, height);
            }
            let prior_size = [old[2] - old[0], old[3] - old[1]];
            for index in 0..2 {
                if prior_size[index] < 0.0 { size[index] = -size[index]; }
            }
            let mut start = [old[0], old[1]];
            if let Some((axis, direction)) = resized {
                for index in 0..2 {
                    if axis == axes[index] {
                        if direction == directions[index] {
                            start[index] += prior_size[index] - size[index];
                        } else if direction == 0 {
                            start[index] += (prior_size[index] - size[index]) / 2.0;
                        }
                    }
                }
            }
            if limited {
                start[0] = start[0].max(0.0);
                start[1] = start[1].max(0.0);
            }
            let mut end = [start[0] + size[0], start[1] + size[1]];
            if limited {
                if end[0] > width { start[0] = width - size[0]; end[0] = width; }
                if end[1] > height { start[1] = height - size[1]; end[1] = height; }
            }
            [start[0], start[1], end[0], end[1]]
        };
        write_face_uv(cube, side, uv)?;
    }
    Ok(())
}

/** Box UV offsets and derived face rectangles use the pinned Bedrock layout. */
fn refresh_box_uv(cube: &mut Cube) -> Result<()> {
    let size = [0, 1, 2].map(|axis| (cube.to[axis] - cube.from[axis] + 0.0000001).floor());
    let [x, y, z] = size;
    let mut positions = [
        ([0.0, z], [z, y]),         // east
        ([z + x, z], [z, y]),       // west
        ([z + x, z], [-x, -z]),     // up
        ([z + 2.0 * x, 0.0], [-x, z]), // down
        ([2.0 * z + x, z], [x, y]), // south
        ([z, z], [x, y]),           // north
    ];
    if cube.extra.get("mirror_uv").and_then(Value::as_bool).unwrap_or(false) {
        for position in &mut positions {
            position.0[0] += position.1[0];
            position.1[0] = -position.1[0];
        }
        positions.swap(0, 1);
    }
    let offset = cube.uv_offset.unwrap_or([0.0, 0.0]);
    for (side, (start, extent)) in ["east", "west", "up", "down", "south", "north"].into_iter().zip(positions) {
        // Native Blockbench leaves deliberately untextured (null) face data alone.
        if cube.faces.get(side).and_then(|face| face.get("texture")).is_some_and(Value::is_null) {
            continue;
        }
        write_face_uv(cube, side, [
            start[0] + offset[0], start[1] + offset[1],
            start[0] + extent[0] + offset[0], start[1] + extent[1] + offset[1],
        ])?;
    }
    Ok(())
}

fn apply_box_resize_offset(cube: &mut Cube, axis: usize, direction: i8, old_size: f64) {
    let new_size = cube.to[axis] - cube.from[axis];
    let adjustment = (old_size - new_size).ceil(); // Bedrock box_uv_float_size defaults to false.
    let mut offset = cube.uv_offset.unwrap_or([0.0, 0.0]);
    if axis == 2 {
        offset[0] += adjustment;
        offset[1] += adjustment;
    } else if axis == 0 && direction == 1 {
        offset[0] += adjustment;
    }
    if cube.uv_offset.is_some() || offset != [0.0, 0.0] {
        cube.uv_offset = Some(offset);
    }
}

fn validate_cube(cube: &Cube, textures: &[Value]) -> Result<()> {
    // Focused Add/Duplicate operations still validate one Cube independently.
    let texture_uuids: HashSet<&str> = textures.iter()
        .filter_map(|texture| texture.get("uuid").and_then(Value::as_str)).collect();
    validate_cube_with_texture_refs(cube, textures.len(), &texture_uuids)
}

/// One shared membership index for the model-wide validation hot path.
/// Texture-shape, UUID-shape and duplicate-ID refusals remain in the
/// unchanged late validation gate so error precedence does not change.
fn validate_cube_with_texture_refs(
    cube: &Cube, texture_count: usize, texture_uuids: &HashSet<&str>,
) -> Result<()> {
    if cube.kind != "cube" { return Err(fail("ELEMENT_TYPE_UNSUPPORTED")); }
    optional_rotation(&cube.extra)?;
    // These saved geometry fields alter the 3D surface and must not be
    // silently discarded or coerced by the derived preview projection.
    if let Some(inflate) = cube.extra.get("inflate") {
        if !inflate.as_f64().is_some_and(|v| v.is_finite() && v.abs() <= LIMIT) {
            return Err(fail("CUBE_INFLATE_INVALID"));
        }
    }
    if let Some(stretch) = cube.extra.get("stretch") {
        if !stretch.as_array().is_some_and(|items|
            items.len() == 3 && items.iter().all(|v|
                v.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= LIMIT))) {
            return Err(fail("CUBE_STRETCH_INVALID"));
        }
    }
    cube_auto_uv(cube)?;
    // Pinned Blockbench Cube.render_order is an enum with three supported
    // render priorities. Refuse malformed known semantics on import/edit.
    if let Some(order) = cube.extra.get("render_order") {
        if !matches!(order.as_str(), Some("default" | "behind" | "in_front")) {
            return Err(fail("CUBE_RENDER_ORDER_INVALID"));
        }
    }
    if cube.extra.get("box_uv").is_some_and(|v| !v.is_boolean()) {
        return Err(fail("CUBE_BOX_UV_FLAG_INVALID"));
    }
    // UV mirroring is source-backed metadata: a malformed imported value
    // must never silently become false in the Box UV net.
    if cube.extra.get("mirror_uv").is_some_and(|v| !v.is_boolean()) {
        return Err(fail("CUBE_MIRROR_UV_FLAG_INVALID"));
    }
    if !valid_uuid(&cube.uuid) || !valid_bounds(cube.from, cube.to) {
        return Err(fail("CUBE_ID_OR_BOUNDS_INVALID"));
    }
    if cube.origin.is_some_and(|v| !valid_vec3(v)) ||
       cube.uv_offset.is_some_and(|v| !valid_uv(&v)) {
        return Err(fail("CUBE_TRANSFORM_INVALID"));
    }
    if cube.faces.len() != 6 { return Err(fail("CUBE_FACES_INCOMPLETE")); }
    for face_name in FACE_NAMES {
        let face = cube.faces.get(face_name).and_then(Value::as_object)
            .ok_or_else(|| fail("CUBE_FACE_INVALID"))?;
        let uv = face.get("uv").and_then(Value::as_array)
            .ok_or_else(|| fail("CUBE_FACE_UV_INVALID"))?;
        if uv.len() != 4 || !uv.iter().all(|v| v.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= LIMIT)) {
            return Err(fail("CUBE_FACE_UV_INVALID"));
        }
        if let Some(reference) = face.get("texture") {
            match reference {
                Value::Null | Value::Bool(false) => {},
                Value::Number(index) if index.as_u64().is_some_and(|v| v < texture_count as u64) => {},
                Value::String(uuid) if texture_uuids.contains(uuid.as_str()) => {},
                _ => return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED")),
            }
        }
    }
    Ok(())
}

// All UUIDs are owned by this immutable AuthoringDocument/Outliner. Repeated
// canonical serialization and Dirty hashing must not allocate new Strings
// merely to establish membership and detect duplicate references.
fn validate_outliner<'a>(
    nodes: &'a [OutlinerNode],
    cube_ids: &HashSet<&str>,
    bone_ids: &HashSet<&str>,
    seen_cubes: &mut HashSet<&'a str>,
    seen_bones: &mut HashSet<&'a str>,
    depth: usize,
) -> Result<()> {
    if depth > MAX_DEPTH { return Err(fail("OUTLINER_TOO_DEEP")); }
    for node in nodes {
        match node {
            OutlinerNode::Cube(id) => {
                if !cube_ids.contains(id.as_str()) || !seen_cubes.insert(id.as_str()) {
                    return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
                }
            }
            OutlinerNode::Bone(group) => {
                if !bone_ids.contains(group.uuid.as_str()) ||
                   !seen_bones.insert(group.uuid.as_str()) {
                    return Err(fail("OUTLINER_BONE_REFERENCE_INVALID"));
                }
                validate_outliner(&group.children, cube_ids, bone_ids, seen_cubes, seen_bones, depth + 1)?;
            }
        }
    }
    Ok(())
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

fn append_child(nodes: &mut [OutlinerNode], parent_uuid: &str, child: &OutlinerNode) -> bool {
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if group.uuid == parent_uuid {
                group.children.push(child.clone());
                return true;
            }
            if append_child(&mut group.children, parent_uuid, child) { return true; }
        }
    }
    false
}

// A duplicated Cube stays beside its source in the nested Outliner.
// The Rust document, rather than the Svelte Outliner, owns this ordering.
fn insert_cube_sibling_after(
    nodes: &mut Vec<OutlinerNode>, source_uuid: &str, new_uuid: &str,
) -> bool {
    for index in 0..nodes.len() {
        if matches!(nodes.get(index), Some(OutlinerNode::Cube(id)) if id == source_uuid) {
            nodes.insert(index + 1, OutlinerNode::Cube(new_uuid.to_owned()));
            return true;
        }
        if let Some(OutlinerNode::Bone(group)) = nodes.get_mut(index) {
            if insert_cube_sibling_after(&mut group.children, source_uuid, new_uuid) {
                return true;
            }
        }
    }
    false
}

// Return Some(None) for an Outliner root entry and Some(Some(id)) for
// a nested entry; None means that the requested node is not present.
fn outliner_parent_uuid(
    nodes: &[OutlinerNode], uuid: &str, parent: Option<&str>,
) -> Option<Option<String>> {
    for node in nodes {
        match node {
            OutlinerNode::Cube(id) if id == uuid => return Some(parent.map(str::to_owned)),
            OutlinerNode::Bone(group) => {
                if group.uuid == uuid { return Some(parent.map(str::to_owned)); }
                if let Some(found) = outliner_parent_uuid(
                    &group.children, uuid, Some(&group.uuid)
                ) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

// A moved Bone retains every descendant and all Outliner-local metadata.
fn take_outliner_node(nodes: &mut Vec<OutlinerNode>, uuid: &str) -> Option<OutlinerNode> {
    if let Some(index) = nodes.iter().position(|node| match node {
        OutlinerNode::Cube(id) => id == uuid,
        OutlinerNode::Bone(group) => group.uuid == uuid,
    }) {
        return Some(nodes.remove(index));
    }
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if let Some(found) = take_outliner_node(&mut group.children, uuid) {
                return Some(found);
            }
        }
    }
    None
}

// In pinned Blockbench 5.2.1 an Outliner group visibility toggle writes
// the group and all descendants; the Group preview is not an inherited mask.
fn find_visibility_group<'a>(nodes: &'a [OutlinerNode], uuid: &str) -> Option<&'a OutlinerBone> {
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if group.uuid == uuid { return Some(group); }
            if let Some(found) = find_visibility_group(&group.children, uuid) {
                return Some(found);
            }
        }
    }
    None
}

fn collect_visibility_targets(
    group: &OutlinerBone, cube_ids: &mut HashSet<String>, bone_ids: &mut HashSet<String>,
) {
    bone_ids.insert(group.uuid.clone());
    for child in &group.children {
        match child {
            OutlinerNode::Cube(uuid) => { cube_ids.insert(uuid.clone()); },
            OutlinerNode::Bone(nested) => collect_visibility_targets(nested, cube_ids, bone_ids),
        }
    }
}

fn set_visibility(extra: &mut Map<String, Value>, visible: bool) {
    if visible {
        // Blockbench omits the default visible Cube field on save.
        extra.remove("visibility");
    } else {
        extra.insert("visibility".into(), Value::Bool(false));
    }
}

// Remove one Outliner entry without flattening siblings or nested Bone data.
fn remove_outliner_entry(nodes: &mut Vec<OutlinerNode>, uuid: &str) -> bool {
    if let Some(position) = nodes.iter().position(|node| match node {
        OutlinerNode::Cube(id) => id == uuid,
        OutlinerNode::Bone(group) => group.uuid == uuid,
    }) {
        nodes.remove(position);
        return true;
    }
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if remove_outliner_entry(&mut group.children, uuid) { return true; }
        }
    }
    false
}

// Opaque extensions can address elements by UUID. Do not leave broken
// references behind when a user explicitly removes an element.
fn value_references_uuid(value: &Value, uuid: &str) -> bool {
    match value {
        Value::String(text) => text == uuid,
        Value::Array(items) => items.iter().any(|item| value_references_uuid(item, uuid)),
        Value::Object(values) => map_references_uuid(values, uuid),
        _ => false,
    }
}

fn map_references_uuid(values: &Map<String, Value>, uuid: &str) -> bool {
    values.iter().any(|(key, value)| key == uuid || value_references_uuid(value, uuid))
}

fn outliner_extra_references_uuid(nodes: &[OutlinerNode], uuid: &str) -> bool {
    nodes.iter().any(|node| match node {
        OutlinerNode::Cube(_) => false,
        OutlinerNode::Bone(group) => {
            (group.uuid != uuid && map_references_uuid(&group.extra, uuid)) ||
                outliner_extra_references_uuid(&group.children, uuid)
        }
    })
}

fn has_external_uuid_references(doc: &AuthoringDocument, uuid: &str) -> bool {
    map_references_uuid(&doc.extensions, uuid) ||
    map_references_uuid(&doc.meta.extra, uuid) ||
    map_references_uuid(&doc.resolution.extra, uuid) ||
    doc.texture_assets.iter().chain(&doc.animation_assets)
        .any(|value| value_references_uuid(value, uuid)) ||
    doc.cubes.iter().filter(|cube| cube.uuid != uuid)
        .any(|cube| map_references_uuid(&cube.extra, uuid) ||
            cube.faces.values().any(|face| value_references_uuid(face, uuid))) ||
    doc.bones.iter().filter(|bone| bone.uuid != uuid)
        .any(|bone| map_references_uuid(&bone.extra, uuid)) ||
    outliner_extra_references_uuid(&doc.hierarchy, uuid)
}

// Admit bounded numeric single-point Bezier handles only when their
// saved metadata is complete; imported unknown frames stay opaque.
/// Strict bounded numeric linear/step/Catmull-Rom/Bezier Bone subset from Blockbench v5.2.1
/// BoneAnimator: rotation offsets in degrees, position offsets in model
/// units, and multiplicative scales (identity [1,1,1]). This slice
/// deliberately refuses negative/excessive scales rather than pretending
/// to reproduce all mesh winding/material behavior in the 3D preview.
fn supported_transform_channel(channel: &str) -> bool {
    matches!(channel, "rotation" | "position" | "scale")
}
fn valid_animation_transform_value(channel: &str, value: [f64; 3]) -> bool {
    if !supported_transform_channel(channel) || !valid_vec3(value) {
        return false;
    }
    channel != "scale" ||
        value.iter().all(|axis| (0.0..=100.0).contains(axis))
}
fn transform_axis(value: Option<&Value>) -> Option<f64> {
    let numeric = match value? {
        Value::String(text) => text.parse::<f64>().ok(),
        Value::Number(number) => number.as_f64(),
        _ => None,
    };
    numeric.filter(|axis| axis.is_finite())
}
fn editable_transform_frame(frame: &Value) -> bool {
    let Some(fields) = frame.as_object() else { return false; };
    if !fields.keys().all(|key| matches!(key.as_str(),
        "uuid" | "channel" | "time" | "interpolation" | "data_points" |
        "bezier_linked" | "bezier_left_time" | "bezier_left_value" |
        "bezier_right_time" | "bezier_right_value")) ||
       !matches!(frame.get("interpolation").and_then(Value::as_str),
           Some("linear" | "step" | "catmullrom" | "bezier")) ||
       !frame.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) ||
       !frame.get("time").and_then(Value::as_f64)
           .is_some_and(|v| v.is_finite() && v >= 0.0) {
        return false;
    }
    let Some(channel) = frame.get("channel").and_then(Value::as_str) else {
        return false;
    };
    let Some(points) = frame.get("data_points").and_then(Value::as_array) else {
        return false;
    };
    if points.len() != 1 { return false; }
    let Some(values) = points[0].as_object() else { return false; };
    if !values.keys().all(|key| matches!(key.as_str(), "x" | "y" | "z")) {
        return false;
    }
    let [Some(x), Some(y), Some(z)] = [
        transform_axis(values.get("x")), transform_axis(values.get("y")),
        transform_axis(values.get("z")),
    ] else { return false; };
    if !valid_animation_transform_value(channel, [x, y, z]) { return false; }
    if frame.get("interpolation").and_then(Value::as_str) == Some("bezier") {
        bezier::parse_saved_bezier_handles(frame).is_some()
    } else {
        !bezier::has_metadata(frame)
    }
}
/// The exact saved Blockbench v5.2.1 animation loop variants.
fn saved_animation_loop(animation: &Value) -> Option<&str> {
    match animation.get("loop") {
        None => Some("once"),
        Some(Value::String(mode)) if matches!(mode.as_str(), "once" | "loop" | "hold") =>
            Some(mode.as_str()),
        _ => None,
    }
}

fn editable_transform_clip(animation: &Value, bones: &[Bone]) -> bool {
    if !animation.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) ||
       !animation.as_object().is_some_and(|obj| obj.keys().all(|key|
        matches!(key.as_str(), "uuid" | "name" | "loop" | "length" | "animators" | "markers"))) {
        return false;
    }
    let Some(loop_mode) = saved_animation_loop(animation) else {
        return false;
    };
    let Some(length) = animation.get("length").and_then(Value::as_f64)
        .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v)) else {
        return false;
    };
    if !timeline_markers::valid_saved_markers(animation,length) { return false; }
    // A looping or held clip with zero duration has no stable time mapping.
    if length == 0.0 && loop_mode != "once" {
        return false;
    }
    let Some(tracks) = animation.get("animators").and_then(Value::as_object) else {
        return false;
    };
    // Check each declared animator Bone through one clip-local lookup instead
    // of rescanning the whole rig for every saved track.
    let bone_by_uuid: HashMap<&str, &Bone> = bones.iter()
        .map(|bone| (bone.uuid.as_str(), bone)).collect();
    let mut all_ids = HashSet::new();
    let mut total = 0usize;
    for (bone_uuid, track) in tracks {
        // Blockbench effect animator is saved under the fixed "effects"
        // track key, not a Bone UUID. Admit only Sound/Particle markers.
        // No scripts, local files, raw controller payloads or playback.
        if bone_uuid == "effects" {
            let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
                return false;
            };
            total = total.saturating_add(frames.len());
            if total > 2048 || !effects::valid_effect_track(track,length) {
                return false;
            }
            for frame in frames {
                let Some(id) = frame.get("uuid").and_then(Value::as_str) else {
                    return false;
                };
                if !all_ids.insert(id) { return false; }
            }
            continue;
        }
        let Some(bone) = bone_by_uuid.get(bone_uuid.as_str()).copied() else {
            return false;
        };
        if !editable_rotation_track(track) || track.get("name")
            .is_some_and(|name| name.as_str() != Some(bone.name.as_str())) {
            return false;
        }
        let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
            return false;
        };
        total = total.saturating_add(frames.len());
        if total > 2048 { return false; }
        let mut times: HashMap<&str, Vec<f64>> = HashMap::new();
        for frame in frames {
            if !editable_transform_frame(frame) { return false; }
            let Some(time) = frame.get("time").and_then(Value::as_f64) else {
                return false;
            };
            if time > length { return false; }
            let Some(uuid) = frame.get("uuid").and_then(Value::as_str) else {
                return false;
            };
            if !all_ids.insert(uuid) { return false; }
            let Some(channel) = frame.get("channel").and_then(Value::as_str) else {
                return false;
            };
            times.entry(channel).or_default().push(time);
        }
        for values in times.values_mut() {
            values.sort_by(f64::total_cmp);
            if values.windows(2).any(|pair| pair[1] - pair[0] <= 1e-6) {
                return false;
            }
        }
        if !bezier::valid_track_segments(frames) { return false; }
    }
    true
}

fn editable_rotation_frame(frame: &Value) -> bool {
    frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
        editable_transform_frame(frame)
}

fn editable_rotation_track(track: &Value) -> bool {
    track.as_object().is_some_and(|values|
        values.keys().all(|key| matches!(key.as_str(), "name" | "type" | "keyframes"))) &&
    track.get("type").and_then(Value::as_str) == Some("bone") &&
    track.get("keyframes").and_then(Value::as_array).is_some()
}

/// Describe saved Cube geometry and six Face UV/texture links for Code Mode.
/// This is a bounded *source* diagnostic, not an evaluation of pixels, paint
/// coverage, current Blockbench material selection or visual correctness.
/// In particular Bedrock single-texture/multi-file rules can supersede stored
/// references; do not pretend a declared texture ID is the rendered material.
pub fn inspect_cube_surfaces(doc: &AuthoringDocument, cube_uuid: &str) -> Result<Value> {
    doc.validate()?;
    inspect_cube_surfaces_validated_uuid(doc, cube_uuid)
}

/// Internal fast path for an already-validated EditorSession. Standalone
/// callers must go through inspect_cube_surfaces() and its full validation.
fn inspect_cube_surfaces_validated_uuid(
    doc: &AuthoringDocument, cube_uuid: &str,
) -> Result<Value> {
    let cube = doc.cubes.iter().find(|cube| cube.uuid == cube_uuid)
        .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
    let texture_indices = indexed_texture_uuids(doc);
    inspect_cube_surfaces_validated(doc, cube, &texture_indices)
}

/// A single document-scoped UUID lookup table for standalone or paged reads.
/// Duplicate UUIDs are already rejected by doc.validate() at the call boundary.
fn indexed_texture_uuids(doc: &AuthoringDocument) -> HashMap<&str, usize> {
    doc.texture_assets.iter().enumerate().filter_map(|(index, texture)|
        texture.get("uuid").and_then(Value::as_str).map(|uuid| (uuid, index)))
        .collect()
}

/// Internal, prevalidated projection for six-face batch consumers. The
/// public entry above remains a full standalone validation boundary.
/// Only pass a Cube borrowed from this already validated document.
fn inspect_cube_surfaces_validated(
    doc: &AuthoringDocument, cube: &Cube,
    texture_indices: &HashMap<&str, usize>,
) -> Result<Value> {
    let per_texture_uv_rules = has_per_texture_uv_rules(doc);
    let mut faces = Vec::with_capacity(FACE_NAMES.len());
    for name in FACE_NAMES {
        let face = cube.faces.get(name).and_then(Value::as_object)
            .ok_or_else(|| fail("CUBE_FACE_INVALID"))?;
        let rect: [f64; 4] = serde_json::from_value(
            face.get("uv").cloned().ok_or_else(|| fail("CUBE_FACE_UV_INVALID"))?
        ).map_err(|_| fail("CUBE_FACE_UV_INVALID"))?;
        let (reference_kind, texture_index) = match face.get("texture") {
            None => ("unset", None),
            Some(Value::Null) => ("null", None),
            Some(Value::Bool(false)) => ("false", None),
            Some(Value::Number(number)) => {
                let index = number.as_u64()
                    .and_then(|value| usize::try_from(value).ok())
                    .ok_or_else(|| fail("CUBE_FACE_TEXTURE_UNSUPPORTED"))?;
                if index >= doc.texture_assets.len() {
                    return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED"));
                }
                ("index", Some(index))
            },
            Some(Value::String(id)) => {
                let index = texture_indices.get(id.as_str()).copied()
                    .ok_or_else(|| fail("CUBE_FACE_TEXTURE_UNSUPPORTED"))?;
                ("uuid", Some(index))
            },
            _ => return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED")),
        };
        let texture = texture_index.and_then(|index| doc.texture_assets.get(index));
        let source_kind = texture.map(|texture| {
            if texture.get("source").and_then(Value::as_str)
                .is_some_and(|source| source.starts_with("data:image/png;base64,")) {
                "embedded_png_declared"
            } else if texture.get("relative_path").and_then(Value::as_str).is_some() {
                "relative_path_declared"
            } else {
                "other_or_unknown"
            }
        });
        let rotation = match face.get("rotation") {
            None => Some(0_u16),
            Some(value) => value.as_f64()
                .filter(|value| [0.0, 90.0, 180.0, 270.0].contains(value))
                .map(|value| value as u16),
        };
        faces.push(json!({
            "side":name,
            "uv":rect,
            "uv_rotation":rotation,
            "uv_rotation_supported":rotation.is_some(),
            "uv_zero_span":rect[0] == rect[2] || rect[1] == rect[3],
            "reference_kind":reference_kind,
            "texture_index":texture_index,
            "texture_uuid":texture.and_then(|t| t.get("uuid")).and_then(Value::as_str),
            "source_kind":source_kind,
        }));
    }
    let size: [f64; 3] = std::array::from_fn(|axis| cube.to[axis] - cube.from[axis]);
    let result = json!({
        "scope":"saved_geometry_and_face_references",
        "cube_uuid":cube.uuid,
        "visual_verdict":"UNVERIFIED",
        "effective_material":"UNVERIFIED",
        "geometry":{
            "from":cube.from, "to":cube.to, "size":size,
            "origin":cube.origin,
            "rotation":cube.extra.get("rotation")
                .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok()),
            "inflate":cube.extra.get("inflate").and_then(Value::as_f64),
            "stretch":cube.extra.get("stretch"),
            "projected_local_size":{
                // Only a local, unrotated Cube surface envelope. A null
                // result is an unsupported projection, not a quality PASS.
                let inflate = cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0);
                let stretch = cube.extra.get("stretch").and_then(|value|
                    serde_json::from_value::<[f64; 3]>(value.clone()).ok())
                    .unwrap_or([1.0; 3]);
                let projected: [f64; 3] = std::array::from_fn(|axis|
                    (size[axis] + 2.0 * inflate) * stretch[axis]);
                if projected.iter().all(|value| value.is_finite() && *value > 0.0) {
                    Some(projected)
                } else { None }
            },
            "visibility_saved":cube.extra.get("visibility").and_then(Value::as_bool),
        },
        "uv":{
            "project_resolution":[doc.resolution.width, doc.resolution.height],
            "box_uv":cube_box_uv(cube, doc.meta.box_uv.unwrap_or(false)),
            "auto_uv":cube_auto_uv(cube)?,
            "per_texture_rules":per_texture_uv_rules
        },
        "faces":faces
    });
    if serde_json::to_vec(&result)
        .map_err(|_| fail("CUBE_INSPECT_SERIALIZE_FAILED"))?.len() > 16 * 1024 {
        return Err(fail("CUBE_INSPECT_TOO_LARGE"));
    }
    Ok(result)
}

/// Read-only Code Mode projection for one exact Bone rotation track.
/// Shares the existing Rust editable-frame admission instead of interpreting
/// imported Molang expressions, unknown channels or extended keyframe shapes.
/// "recognized" identifies only this bounded data representation: it is not
/// proof of native animation playback, visual fidelity or mutation permission.
pub fn inspect_rotation_track(
    doc: &AuthoringDocument,
    animation_uuid: &str,
    bone_uuid: &str,
    offset: usize,
    limit: usize,
) -> Result<Value> {
    if limit == 0 || limit > 64 || offset > MAX_ELEMENTS {
        return Err(fail("ANIMATION_INSPECT_PAGE_INVALID"));
    }
    if !doc.bones.iter().any(|bone| bone.uuid == bone_uuid) {
        return Err(fail("ANIMATION_BONE_NOT_FOUND"));
    }
    let animation = doc.animation_assets.iter()
        .find(|a| a.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
        .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
    let track = animation.get("animators").and_then(Value::as_object)
        .and_then(|items| items.get(bone_uuid))
        .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
    let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
        return Ok(json!({
            "scope":"unsupported_animation_track",
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "keyframes":[],
            "total_frames":null, "next_offset":null,
            "animation_uuid":animation_uuid, "bone_uuid":bone_uuid
        }));
    };
    let total = frames.len();
    let duration = animation.get("length").and_then(Value::as_f64)
        .filter(|n| n.is_finite() && (0.0..=3600.0).contains(n));
    let mut times = Vec::new();
    let mut ids = HashSet::new();
    let mut recognized = editable_rotation_track(track) &&
        duration.is_some() && total <= 4096;
    if recognized {
        for frame in frames {
            let time = frame.get("time").and_then(Value::as_f64);
            let id = frame.get("uuid").and_then(Value::as_str);
            if !editable_rotation_frame(frame) ||
               !time.is_some_and(|n| n <= duration.unwrap_or(0.0)) ||
               !id.is_some_and(|value| ids.insert(value.to_owned())) {
                recognized = false;
                break;
            }
            times.push(time.unwrap_or(0.0));
        }
        if recognized {
            times.sort_by(|a, b| a.total_cmp(b));
            recognized = !times.windows(2).any(|pair| (pair[1] - pair[0]).abs() <= 1e-6);
        }
    }
    if !recognized {
        return Ok(json!({
            "scope":"unsupported_animation_track",
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "keyframes":[],
            "total_frames":total, "next_offset":null,
            "animation_uuid":animation_uuid, "bone_uuid":bone_uuid
        }));
    }
    let mut keyframes = Vec::new();
    let end = offset.saturating_add(limit).min(total);
    for frame in frames.iter().skip(offset).take(limit) {
        let point = &frame["data_points"][0];
        let axis = |name: &str| -> Result<f64> {
            match point.get(name) {
                Some(Value::String(value)) => value.parse::<f64>().map_err(|_| fail("ANIMATION_INSPECT_AXIS_INVALID")),
                Some(Value::Number(value)) => value.as_f64().ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID")),
                _ => Err(fail("ANIMATION_INSPECT_AXIS_INVALID")),
            }
        };
        let mut detail = json!({
            "uuid":frame["uuid"],
            "time":frame["time"], "interpolation":frame["interpolation"],
            "rotation":[axis("x")?, axis("y")?, axis("z")?]
        });
        if let Some(handles) = bezier::parse_saved_bezier_handles(frame) {
            detail["bezier"] = json!(handles);
        }
        keyframes.push(detail);
    }
    Ok(json!({
        // Keep the legacy scope label for existing read clients; this
        // explicit field declares the now-admitted outgoing segment modes.
        "scope":"linear_bone_rotation", "interpolation_modes":["linear","step","catmullrom","bezier"],
        "recognized":true, "visual_verdict":"UNVERIFIED",
        "animation_uuid":animation_uuid, "bone_uuid":bone_uuid,
        "total_frames":total, "offset":offset,
        "next_offset":if end < total { Some(end) } else { None },
        "keyframes":keyframes
    }))
}

/// Bounded Code Mode read of an admitted numeric linear/step/Catmull-Rom Bone channel authored
/// by Rust. Unknown imported clips or expressions are never interpreted or
/// normalized, and no raw keyframe extensions are returned to the agent.
pub fn inspect_transform_track(
    doc: &AuthoringDocument, animation_uuid: &str, bone_uuid: &str,
    channel: &str, offset: usize, limit: usize,
) -> Result<Value> {
    if !supported_transform_channel(channel) {
        return Err(fail("ANIMATION_INSPECT_CHANNEL_INVALID"));
    }
    if limit == 0 || limit > 64 || offset > MAX_ELEMENTS {
        return Err(fail("ANIMATION_INSPECT_PAGE_INVALID"));
    }
    if !doc.bones.iter().any(|bone| bone.uuid == bone_uuid) {
        return Err(fail("ANIMATION_BONE_NOT_FOUND"));
    }
    let matches: Vec<_> = doc.animation_assets.iter().filter(|item|
        item.get("uuid").and_then(Value::as_str) == Some(animation_uuid)).collect();
    let animation = match matches.as_slice() {
        [] => return Err(fail("ANIMATION_NOT_FOUND")),
        [animation] => *animation,
        _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
    };
    let track = animation.get("animators").and_then(Value::as_object)
        .and_then(|tracks| tracks.get(bone_uuid))
        .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
    let Some(all_frames) = track.get("keyframes").and_then(Value::as_array) else {
        return Ok(json!({
            "scope":"unsupported_animation_track", "channel":channel,
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "animation_uuid":animation_uuid,
            "bone_uuid":bone_uuid, "total_frames":null,
            "next_offset":null, "keyframes":[]
        }));
    };
    if !editable_transform_clip(animation, &doc.bones) {
        return Ok(json!({
            "scope":"unsupported_animation_track", "channel":channel,
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "animation_uuid":animation_uuid,
            "bone_uuid":bone_uuid, "total_frames":null,
            "next_offset":null, "keyframes":[]
        }));
    }
    let frames: Vec<_> = all_frames.iter().filter(|frame|
        frame.get("channel").and_then(Value::as_str) == Some(channel)).collect();
    let total = frames.len();
    let end = offset.saturating_add(limit).min(total);
    let mut selected = Vec::with_capacity(end.saturating_sub(offset));
    for frame in frames.into_iter().skip(offset).take(limit) {
        let points = &frame["data_points"][0];
        let value = [
            transform_axis(points.get("x")).ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID"))?,
            transform_axis(points.get("y")).ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID"))?,
            transform_axis(points.get("z")).ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID"))?,
        ];
        let mut detail = json!({
            "uuid":frame["uuid"], "time":frame["time"], "value":value,
            "interpolation":frame["interpolation"],
        });
        if let Some(handles) = bezier::parse_saved_bezier_handles(frame) {
            detail["bezier"] = json!(handles);
        }
        selected.push(detail);
    }
    Ok(json!({
        // The legacy scope identifier is stable across read consumers.
        "scope":"linear_bone_transform", "recognized":true,
        "interpolation_modes":["linear","step","catmullrom","bezier"],
        "visual_verdict":"UNVERIFIED", "animation_uuid":animation_uuid,
        "bone_uuid":bone_uuid, "channel":channel,
        "loop_mode":saved_animation_loop(animation).unwrap_or("once"),
        "clip_length":animation["length"],
        "total_frames":total, "offset":offset,
        "next_offset":if end < total {Some(end)} else {None},
        "keyframes":selected
    }))
}

/// Changing atlas dimensions with authored Cubes or texture/animation data
/// would require native UV remapping. Keep this setting confined to a simple
/// empty Bedrock model with no imported opaque authoring metadata.
/// Shared admission for new generated/imported Paint assets. Never infer
/// that a project with per-texture UV rules fits the one-atlas Paint editor.
fn check_paint_texture_addition(doc: &AuthoringDocument) -> Result<()> {
    if has_per_texture_uv_rules(doc) {
        return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
    }
    if doc.texture_assets.len() >= MAX_PAINT_TEXTURES {
        return Err(fail("PAINT_TEXTURE_COUNT_LIMIT"));
    }
    if !(1..=MAX_PAINT_ATLAS_SIDE).contains(&doc.resolution.width) ||
       !(1..=MAX_PAINT_ATLAS_SIDE).contains(&doc.resolution.height) {
        return Err(fail("PAINT_DIMENSIONS_UNSUPPORTED"));
    }
    Ok(())
}

/// Read-only eligibility used by the Tauri UI. Mutations recheck this gate.
pub fn can_add_paint_texture(doc: &AuthoringDocument) -> bool {
    check_paint_texture_addition(doc).is_ok()
}

/// Metadata-only eligibility; expensive image decode happens on export.
pub fn paint_texture_exportable(doc: &AuthoringDocument, index: usize) -> bool {
    if has_per_texture_uv_rules(doc) { return false; }
    doc.texture_assets.get(index).is_some_and(|texture| {
        texture.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) &&
        paint::exportable(texture, doc.resolution.width, doc.resolution.height)
    })
}

/// Batch the three metadata-only Paint flags for one immutable Tauri
/// projection. The same Rust Paint predicates still guard actual edits and
/// exports; project-wide UV rules are checked once, never per texture.
pub fn paint_texture_snapshot_flags(
    doc: &AuthoringDocument,
) -> (Vec<bool>, Vec<bool>, Vec<bool>) {
    let mut editable = Vec::with_capacity(doc.texture_assets.len());
    let mut adoptable = Vec::with_capacity(doc.texture_assets.len());
    let mut exportable = Vec::with_capacity(doc.texture_assets.len());
    let per_texture_uv_rules = has_per_texture_uv_rules(doc);
    for texture in &doc.texture_assets {
        if per_texture_uv_rules {
            editable.push(paint::editable(texture));
            adoptable.push(false);
            exportable.push(false);
            continue;
        }
        let (owned, candidate, can_export) =
            paint::snapshot_eligibility(texture, doc.resolution.width, doc.resolution.height);
        editable.push(owned);
        adoptable.push(candidate);
        exportable.push(can_export &&
            texture.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid));
    }
    (editable, adoptable, exportable)
}

/// Read-only export of a UUID-addressed supported embedded PNG.
pub fn export_paint_png(doc: &AuthoringDocument, texture_uuid: &str) -> Result<Vec<u8>> {
    if has_per_texture_uv_rules(doc) {
        return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
    }
    let index = doc.texture_assets.iter().position(|texture|
        texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
        .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
    if !paint_texture_exportable(doc, index) {
        return Err(fail("PAINT_EXPORT_TEXTURE_UNSUPPORTED"));
    }
    paint::export_png(&doc.texture_assets[index], doc.resolution.width, doc.resolution.height)
}

/// Bounded, read-only Code Mode Paint inspection for one explicit Texture UUID.
/// The same Rust PNG codec used for Paint/edit/export owns pixel decoding.
/// Unknown formats and multi-file rules remain UNVERIFIED, not silently
/// interpreted or rewritten. Alpha statistics cannot prove face coverage.
pub fn inspect_paint_alpha(doc: &AuthoringDocument, texture_uuid: &str) -> Result<Value> {
    doc.validate()?;
    inspect_paint_alpha_validated(doc, texture_uuid)
}

/// Internal immutable read from a document admitted by EditorSession. The
/// PNG decoder and unsupported-format decisions are intentionally unchanged.
fn inspect_paint_alpha_validated(
    doc: &AuthoringDocument, texture_uuid: &str,
) -> Result<Value> {
    let index = doc.texture_assets.iter().position(|texture|
        texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
        .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
    let texture = &doc.texture_assets[index];
    let inspection = if has_per_texture_uv_rules(doc) {
        json!({
            "scope":"unsupported_texture_alpha",
            "supported":false,
            "reason":"PER_TEXTURE_UV_RULES_UNSUPPORTED",
            "visual_verdict":"UNVERIFIED",
            "face_coverage_verdict":"UNVERIFIED"
        })
    } else if !paint::exportable(texture, doc.resolution.width, doc.resolution.height) {
        json!({
            "scope":"unsupported_texture_alpha",
            "supported":false,
            "reason":"UNSUPPORTED_FORMAT_OR_METADATA",
            "visual_verdict":"UNVERIFIED",
            "face_coverage_verdict":"UNVERIFIED"
        })
    } else {
        // A purportedly supported image must survive the full decoder.
        // Malformed/corrupt RGBA8 is an explicit error, not zero coverage.
        paint::alpha_diagnostics(texture, doc.resolution.width, doc.resolution.height)?
    };
    Ok(json!({
        "kind":"texture_alpha",
        "texture_uuid":texture_uuid,
        "texture_index":index,
        "inspection":inspection
    }))
}

/// Inspect six Cube face UV regions against the Rust Paint PNG decoder,
/// once per unique referenced texture. For Box UV, recompute the face
/// rectangles from the authoritative bounds/net offset on a *copy* rather
/// than trusting possibly stale imported face rectangles. This is alpha
/// evidence for UV pixels, never a native visual or paint-quality verdict.
/// Unsafe UV rules refuse rather than fabricating observed coverage.
pub fn inspect_cube_uv_alpha(doc: &AuthoringDocument, cube_uuid: &str) -> Result<Value> {
    let mut decoded = Vec::new();
    inspect_cube_uv_alpha_with_cache(doc, cube_uuid, &mut decoded)
}

/// Reuse decoded read-only PNGs for multiple Cubes in a single bounded page.
/// The caller discards this scratch cache after the read; edits never see stale pixels.
fn inspect_cube_uv_alpha_with_cache(
    doc: &AuthoringDocument, cube_uuid: &str,
    decoded: &mut Vec<(usize, Vec<u8>)>,
) -> Result<Value> {
    doc.validate()?;
    let cube = doc.cubes.iter().find(|cube| cube.uuid == cube_uuid)
        .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
    let texture_indices = indexed_texture_uuids(doc);
    inspect_cube_uv_alpha_validated(doc, cube, decoded, &texture_indices)
}

/// Share a decoded atlas only inside one validated immutable inspection
/// batch. Reuse the existing bounded PNG scratch, never authored bitmap state.
fn cached_inspection_atlas<'a>(
    doc: &AuthoringDocument, texture_index: usize,
    decoded: &'a mut Vec<(usize, Vec<u8>)>,
) -> Result<&'a [u8]> {
    if !decoded.iter().any(|(i, _)| *i == texture_index) {
        let width = doc.resolution.width;
        let height = doc.resolution.height;
        let next_rgba_bytes = (width as usize).saturating_mul(height as usize).saturating_mul(4);
        let cached_bytes: usize = decoded.iter().map(|(_, rgba)| rgba.len()).sum();
        if decoded.len() >= MAX_INSPECTION_PNG_CACHE ||
           cached_bytes.saturating_add(next_rgba_bytes) > MAX_INSPECTION_RGBA_CACHE_BYTES {
            decoded.clear();
        }
        let texture = doc.texture_assets.get(texture_index)
            .ok_or_else(|| fail("PAINT_UV_CACHE_INCONSISTENT"))?;
        let png = paint::decode_for_uv_inspection(texture, width, height)?;
        decoded.push((texture_index, png));
    }
    decoded.iter().find(|(i, _)| *i == texture_index)
        .map(|(_, rgba)| rgba.as_slice())
        .ok_or_else(|| fail("PAINT_UV_CACHE_INCONSISTENT"))
}

/// An immutable page validates once before iterating its own Cubes. This
/// function must receive a Cube reference from that validated document and
/// never suppress an independently requested public validation.
fn inspect_cube_uv_alpha_validated(
    doc: &AuthoringDocument, cube: &Cube,
    decoded: &mut Vec<(usize, Vec<u8>)>,
    texture_indices: &HashMap<&str, usize>,
) -> Result<Value> {
    let surface = inspect_cube_surfaces_validated(doc, cube, texture_indices)?;
    let uv = &surface["uv"];
    let box_uv = uv["box_uv"].as_bool() == Some(true);
    // The current Box UV net uses integer dimension semantics. Imported
    // float-grid or malformed mirroring flags are not silently approximated.
    let unsafe_box_rules = [
        cube.extra.get("box_uv_float_size"),
        doc.meta.extra.get("box_uv_float_size"),
        doc.extensions.get("box_uv_float_size"),
    ].into_iter().flatten().any(|flag| flag != &Value::Bool(false)) ||
        cube.extra.get("mirror_uv").is_some_and(|v| !v.is_boolean());
    let derived_box = if box_uv && !unsafe_box_rules &&
        uv["per_texture_rules"].as_bool() != Some(true) {
        let mut copy = cube.clone();
        refresh_box_uv(&mut copy)?;
        Some(copy)
    } else {
        None
    };
    let global_reason = if uv["per_texture_rules"].as_bool() == Some(true) {
        Some("PER_TEXTURE_UV_RULES_UNSUPPORTED")
    } else if box_uv && derived_box.is_none() {
        Some("BOX_UV_RULES_UNSUPPORTED")
    } else if !box_uv && uv["auto_uv"].as_u64() != Some(0) {
        Some("AUTO_UV_UNSUPPORTED")
    } else {
        None
    };
    let faces = surface["faces"].as_array()
        .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
    let width = doc.resolution.width;
    let height = doc.resolution.height;
    // A one-Cube read uses a fresh scratch cache. The paged consumer reuses
    // it for up to eight Cubes without storing model/bitmap state.
    let mut projected = Vec::with_capacity(FACE_NAMES.len());
    for face in faces {
        let side = face["side"].as_str()
            .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let kind = face["reference_kind"].as_str()
            .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let index = face["texture_index"].as_u64()
            .and_then(|index| usize::try_from(index).ok());
        let mut reason = global_reason;
        if reason.is_none() && index.is_none() {
            reason = Some("NO_EXPLICIT_TEXTURE_REFERENCE");
        }
        let texture = index.and_then(|i| doc.texture_assets.get(i));
        if reason.is_none() && !texture.is_some_and(|t|
            paint::exportable(t, width, height)
        ) {
            reason = Some("UNSUPPORTED_TEXTURE_FORMAT_OR_METADATA");
        }
        let saved_rect: [f64; 4] = serde_json::from_value(face["uv"].clone())
            .map_err(|_| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let rect = if let Some(box_cube) = &derived_box {
            face_uv(box_cube, side)?
        } else {
            saved_rect
        };
        let stats = if let Some(message) = reason {
            json!({"status":"unsupported","reason":message})
        } else {
            let texture_index = index.ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
            let png = cached_inspection_atlas(doc, texture_index, decoded)?;
            match paint::uv_region_alpha_stats(png, width, height, rect) {
                Ok(mut region) => {
                    if derived_box.is_some() {
                        region["scope"] = json!("derived_box_uv_alpha_pixels");
                    }
                    json!({"status":"measured","region":region})
                },
                Err(code) if matches!(code.as_str(),
                    "PAINT_UV_RECT_NON_INTEGRAL" |
                    "PAINT_UV_RECT_OUT_OF_BOUNDS" |
                    "PAINT_UV_RECT_ZERO_AREA") => {
                    json!({"status":"unsupported","reason":code})
                }
                Err(code) => return Err(code),
            }
        };
        projected.push(json!({
            "side":side,
            "saved_reference_kind":kind,
            "texture_index":index,
            "texture_uuid":face["texture_uuid"],
            "uv":rect,
            "saved_uv":saved_rect,
            "uv_source":if derived_box.is_some() { "derived_box" } else { "saved_manual" },
            "alpha":stats
        }));
    }
    let report = json!({
        "scope":if derived_box.is_some() {
            "derived_box_face_uv_alpha"
        } else { "saved_manual_face_uv_alpha" },
        "cube_uuid":cube.uuid,
        "visual_verdict":"UNVERIFIED",
        "effective_material":"UNVERIFIED",
        "face_coverage_verdict":"UNVERIFIED",
        "face_count":projected.len(),
        "faces":projected
    });
    if serde_json::to_vec(&report)
        .map_err(|_| fail("CUBE_UV_ALPHA_SERIALIZE_FAILED"))?.len() > 24 * 1024 {
        return Err(fail("CUBE_UV_ALPHA_RESULT_TOO_LARGE"));
    }
    Ok(report)
}

pub fn can_set_empty_atlas_resolution(doc: &AuthoringDocument) -> bool {
    doc.cubes.is_empty() && doc.bones.is_empty() &&
    doc.texture_assets.is_empty() && doc.animation_assets.is_empty() &&
    doc.meta.extra.is_empty() && doc.resolution.extra.is_empty() &&
    doc.extensions.keys().all(|key|
        matches!(key.as_str(), "name" | "model_identifier" | "visible_box")) &&
    !has_per_texture_uv_rules(doc)
}

/// Read capability tied to one validated EditorSession lifetime. Private
/// fields prevent callers from constructing this for unvalidated documents.
pub struct ValidatedInspection<'a> {
    doc: &'a AuthoringDocument,
    // One lazily constructed UUID index and bounded decoder scratch for all
    // selectors in the existing SHA-pinned Rust CLI inspection batch. No
    // caches survive this borrowed validated EditorSession read.
    texture_indices: OnceCell<HashMap<&'a str, usize>>,
    decoded_pngs: RefCell<Vec<(usize, Vec<u8>)>>,
    geometry_impact_index: OnceCell<geometry_impact::GeometryImpactIndex>,
}

impl<'a> ValidatedInspection<'a> {
    fn texture_indices(&self) -> &HashMap<&'a str, usize> {
        self.texture_indices.get_or_init(|| indexed_texture_uuids(self.doc))
    }

    /// Only the repeated Geometry Impact path needs an atlas-user index;
    /// it is borrowed from this validated document and discarded afterwards.
    pub fn geometry_impact(&self, uuid: &str, change: &str) -> Result<Value> {
        let index = self.geometry_impact_index.get_or_init(||
            geometry_impact::GeometryImpactIndex::new(self.doc));
        geometry_impact::inspect_geometry_impact_indexed(self.doc, uuid, change, index)
    }

    pub fn cube_surfaces(&self, uuid: &str) -> Result<Value> {
        let cube = self.doc.cubes.iter().find(|cube| cube.uuid == uuid)
            .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
        inspect_cube_surfaces_validated(self.doc, cube, self.texture_indices())
    }

    pub fn cube_face_alpha(&self, uuid: &str) -> Result<Value> {
        let cube = self.doc.cubes.iter().find(|cube| cube.uuid == uuid)
            .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
        let mut decoded = self.decoded_pngs.borrow_mut();
        inspect_cube_uv_alpha_validated(
            self.doc, cube, &mut decoded, self.texture_indices(),
        )
    }

    pub fn texture_alpha(&self, uuid: &str) -> Result<Value> {
        inspect_paint_alpha_validated(self.doc, uuid)
    }

    /// Existing scratch for repeated same-atlas face-style reads; no
    /// persistent pixels or permission/visual authority.
    pub fn texture_styling_face(
        &self, texture_uuid: &str, cube_uuid: &str, side: &str,
    ) -> Result<Value> {
        let mut decoded = self.decoded_pngs.borrow_mut();
        material_styling::inspect_texture_styling_face_validated(
            self.doc, texture_uuid, cube_uuid, side, &mut decoded,
        )
    }

    pub fn model_texture_coverage(
        &self, offset: usize, limit: usize, attention_only: bool,
    ) -> Result<Value> {
        let mut decoded = self.decoded_pngs.borrow_mut();
        texture_coverage::inspect_model_texture_coverage_filtered_with_cache(
            self.doc, offset, limit, attention_only,
            self.texture_indices(), &mut decoded,
        )
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

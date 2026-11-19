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
            if !decoded.iter().any(|(i, _)| *i == texture_index) {
                // Reuse decoded pixels only inside one immutable inspection
                // view. Bound retained RGBA8 memory even for an eight-query
                // Code Mode batch with many distinct imported atlases.
                let next_rgba_bytes=(width as usize).saturating_mul(height as usize).saturating_mul(4);
                let cached_bytes:usize=decoded.iter().map(|(_,rgba)|rgba.len()).sum();
                if decoded.len() >= MAX_INSPECTION_PNG_CACHE ||
                   cached_bytes.saturating_add(next_rgba_bytes)>MAX_INSPECTION_RGBA_CACHE_BYTES {
                    decoded.clear();
                }
                let png = paint::decode_for_uv_inspection(
                    &doc.texture_assets[texture_index], width, height
                )?;
                decoded.push((texture_index, png));
            }
            let png = decoded.iter().find(|(i, _)| *i == texture_index)
                .ok_or_else(|| fail("PAINT_UV_CACHE_INCONSISTENT"))?;
            match paint::uv_region_alpha_stats(&png.1, width, height, rect) {
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

/// The single UV-aware Cube translation primitive for standalone moves and
/// subtree cohorts. Keeping it on a mutable Cube supports a linear scan of
/// large hierarchies instead of repeated UUID lookups for every descendant.
fn translate_cube_in_place(
    cube: &mut Cube, delta: [f64; 3],
    per_texture_uv_rules: bool, resolution: [f64; 2],
    textures: &[Value], project_box_uv: bool,
) -> Result<()> {
    if !valid_vec3(delta) { return Err(fail("CUBE_DELTA_INVALID")); }
    if delta.iter().all(|axis| *axis == 0.0) { return Ok(()); }
    let auto_uv = cube_auto_uv(cube)?;
    let box_uv = cube_box_uv(cube, project_box_uv);
    if !box_uv && auto_uv != 0 && per_texture_uv_rules {
        return Err(fail("CUBE_UV_TEXTURE_RULESET_UNSUPPORTED"));
    }
    for axis in 0..3 {
        cube.from[axis] += delta[axis];
        cube.to[axis] += delta[axis];
    }
    let origin = cube.origin.get_or_insert([0.0, 0.0, 0.0]);
    for axis in 0..3 { origin[axis] += delta[axis]; }
    if !box_uv {
        refresh_auto_uv(cube, auto_uv, resolution, textures, None)?;
    }
    Ok(())
}

fn apply_operation(doc: &mut AuthoringDocument, op: &EditOperation) -> Result<String> {
    match op {
        EditOperation::AddBone { bone, parent_uuid } => {
            if !valid_uuid(&bone.uuid) || bone.name.trim().is_empty() ||
               doc.cubes.iter().any(|c| c.uuid == bone.uuid) ||
               doc.bones.iter().any(|g| g.uuid == bone.uuid) {
                return Err(fail("BONE_CREATION_INVALID"));
            }
            let node = OutlinerNode::Bone(OutlinerBone {
                uuid: bone.uuid.clone(), children: Vec::new(), is_open: Some(true), extra: Map::new(),
            });
            if let Some(parent) = parent_uuid {
                if !append_child(&mut doc.hierarchy, parent, &node) {
                    return Err(fail("BONE_PARENT_NOT_FOUND"));
                }
            } else { doc.hierarchy.push(node); }
            doc.bones.push(bone.clone());
            Ok(bone.uuid.clone())
        }
        EditOperation::AddCube { cube, bone_uuid } => {
            if doc.cubes.iter().any(|c| c.uuid == cube.uuid) ||
               doc.bones.iter().any(|g| g.uuid == cube.uuid) {
                return Err(fail("CUBE_UUID_CONFLICT"));
            }
            let mut prepared = cube.clone();
            validate_cube(&prepared, &doc.texture_assets)?;
            // A newly added Box UV Cube must obey the same atlas safety gate
            // as subsequent Reframe, Scale, Resize, Mirror and UV Offset edits.
            if cube_box_uv(&prepared, doc.meta.box_uv.unwrap_or(false)) {
                check_box_uv_repack_rules(doc, &prepared)?;
                refresh_box_uv(&mut prepared)?;
            }
            if !append_child(&mut doc.hierarchy, bone_uuid, &OutlinerNode::Cube(cube.uuid.clone())) {
                return Err(fail("CUBE_BONE_NOT_FOUND"));
            }
            doc.cubes.push(prepared);
            Ok(cube.uuid.clone())
        }

        EditOperation::DuplicateCube { source_uuid, new_uuid } => {
            if !valid_uuid(new_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *new_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *new_uuid) ||
               doc.texture_assets.iter().chain(&doc.animation_assets)
                   .any(|value| value.get("uuid").and_then(Value::as_str) == Some(new_uuid.as_str())) {
                return Err(fail("CUBE_DUPLICATE_ID_INVALID"));
            }
            if doc.cubes.len() >= MAX_ELEMENTS {
                return Err(fail("CUBE_COUNT_LIMIT"));
            }
            let source = doc.cubes.iter().find(|cube| cube.uuid == *source_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            // An opaque source self-reference cannot be rewritten safely.
            // Refuse it rather than copy a stale reference to the source UUID.
            if map_references_uuid(&source.extra, source_uuid) ||
               source.faces.values().any(|face| value_references_uuid(face, source_uuid)) {
                return Err(fail("CUBE_DUPLICATE_SELF_REFERENCE_UNSUPPORTED"));
            }
            let mut duplicate = source.clone();
            duplicate.uuid = new_uuid.clone();
            validate_cube(&duplicate, &doc.texture_assets)?;
            if !insert_cube_sibling_after(&mut doc.hierarchy, source_uuid, new_uuid) {
                return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
            }
            doc.cubes.push(duplicate);
            Ok(new_uuid.clone())
        }
        EditOperation::DuplicateBoneSubtree { source_uuid, new_uuid, name_suffix } => {
            subtree::duplicate_bone_subtree(doc, source_uuid, new_uuid, name_suffix)?;
            Ok(new_uuid.clone())
        }
        EditOperation::ReparentNode { uuid, parent_uuid } => {
            let is_cube = doc.cubes.iter().any(|cube| cube.uuid == *uuid);
            let is_bone = doc.bones.iter().any(|bone| bone.uuid == *uuid);
            if !is_cube && !is_bone { return Err(fail("REPARENT_NODE_NOT_FOUND")); }
            if is_cube && parent_uuid.is_none() {
                // A Bedrock Cube may only be reparented to a Bone in this slice.
                return Err(fail("REPARENT_CUBE_REQUIRES_BONE"));
            }
            if let Some(target) = parent_uuid {
                if !doc.bones.iter().any(|bone| bone.uuid == *target) {
                    return Err(fail("REPARENT_PARENT_NOT_FOUND"));
                }
                // The destination must not lie within the source Bone subtree.
                if is_bone {
                    let source_group = find_visibility_group(&doc.hierarchy, uuid)
                        .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
                    if target == uuid ||
                        find_visibility_group(&source_group.children, target).is_some() {
                        return Err(fail("REPARENT_CYCLE"));
                    }
                }
            }
            let current_parent = outliner_parent_uuid(&doc.hierarchy, uuid, None)
                .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
            if current_parent.as_deref() == parent_uuid.as_deref() { return Ok(uuid.clone()); }
            let moved = take_outliner_node(&mut doc.hierarchy, uuid)
                .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
            if let Some(target) = parent_uuid {
                if !append_child(&mut doc.hierarchy, target, &moved) {
                    return Err(fail("REPARENT_PARENT_NOT_FOUND"));
                }
            } else {
                doc.hierarchy.push(moved);
            }
            // Blockbench's default Outliner move has adjust_position=false.
            // Keep saved local transforms/UUIDs untouched; the target Bone's
            // inherited rotation may change the resulting world-space pose.
            Ok(uuid.clone())
        }
        EditOperation::RenameNode { uuid, name } => {
            if !valid_node_name(name) { return Err(fail("NODE_NAME_INVALID")); }
            let desired = name.trim();
            // Find read-only first: iter_mut() would clone the entire Cube COW
            // allocation even when the UUID actually refers to a Bone.
            if let Some(index) = doc.cubes.iter().position(|cube| cube.uuid == *uuid) {
                doc.cubes[index].name = Some(desired.to_owned());
                return Ok(uuid.clone());
            }
            let bone_index = doc.bones.iter().position(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("RENAME_NODE_NOT_FOUND"))?;
            let original = doc.bones[bone_index].name.clone();
            // Bedrock JSON needs unambiguous Bone names for exported rigs.
            // Existing imported names are preserved, but a newly authored
            // rename cannot introduce another case-insensitive collision.
            if doc.bones.iter().enumerate().any(|(index, bone)|
                index != bone_index && bone.name.eq_ignore_ascii_case(desired)) {
                return Err(fail("BONE_NAME_CONFLICT"));
            }
            // A Blockbench Bone animator is indexed by Bone UUID, while
            // its optional display name mirrors the Bone name. Synchronize
            // only that known field, never rewrite opaque keyframes/Molang.
            // Imported inconsistent track names refuse rather than silently
            // leave a misleading Bone->Animation relationship behind.
            // Validate all named tracks before making the Animation COW
            // collection mutable. A Bone without any named animator never
            // needs to duplicate imported keyframes or opaque JSON payloads.
            let mut named_tracks = Vec::new();
            for (index, animation) in doc.animation_assets.iter().enumerate() {
                if let Some(track) = animation.get("animators")
                    .and_then(Value::as_object)
                    .and_then(|animators| animators.get(uuid))
                {
                    if let Some(label) = track.get("name") {
                        if label.as_str() != Some(original.as_str()) {
                            return Err(fail("BONE_ANIMATOR_NAME_UNSUPPORTED"));
                        }
                        if desired != original.as_str() { named_tracks.push(index); }
                    }
                }
            }
            for index in named_tracks {
                let track = doc.animation_assets[index].get_mut("animators")
                    .and_then(Value::as_object_mut)
                    .and_then(|animators| animators.get_mut(uuid))
                    .ok_or_else(|| fail("BONE_ANIMATOR_NAME_UNSUPPORTED"))?;
                track["name"] = json!(desired);
            }
            doc.bones[bone_index].name = desired.to_owned();
            Ok(uuid.clone())
        }
        EditOperation::RemoveCube { uuid } => {
            if !doc.cubes.iter().any(|cube| cube.uuid == *uuid) {
                return Err(fail("CUBE_NOT_FOUND"));
            }
            if has_external_uuid_references(doc, uuid) {
                return Err(fail("ELEMENT_OPAQUE_REFERENCES"));
            }
            if !remove_outliner_entry(&mut doc.hierarchy, uuid) {
                return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
            }
            doc.cubes.retain(|cube| cube.uuid != *uuid);
            Ok(uuid.clone())
        }
        EditOperation::RemoveEmptyBone { uuid } => {
            let group = find_visibility_group(&doc.hierarchy, uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            if !group.children.is_empty() {
                return Err(fail("BONE_NOT_EMPTY"));
            }
            if has_external_uuid_references(doc, uuid) {
                return Err(fail("ELEMENT_OPAQUE_REFERENCES"));
            }
            if !remove_outliner_entry(&mut doc.hierarchy, uuid) {
                return Err(fail("OUTLINER_BONE_REFERENCE_INVALID"));
            }
            doc.bones.retain(|bone| bone.uuid != *uuid);
            Ok(uuid.clone())
        }
        EditOperation::SetNodeVisibility { uuid, visible } => {
            if let Some(index) = doc.cubes.iter().position(|cube| cube.uuid == *uuid) {
                set_visibility(&mut doc.cubes[index].extra, *visible);
            } else {
                let group = find_visibility_group(&doc.hierarchy, uuid)
                    .ok_or_else(|| fail("VISIBILITY_TARGET_NOT_FOUND"))?;
                let mut cube_ids = HashSet::new();
                let mut bone_ids = HashSet::new();
                collect_visibility_targets(group, &mut cube_ids, &mut bone_ids);
                // An empty Bone subtree can change only its Bone metadata;
                // do not detach and copy unrelated Cube allocations.
                if !cube_ids.is_empty() {
                    for cube in &mut doc.cubes {
                        if cube_ids.contains(&cube.uuid) { set_visibility(&mut cube.extra, *visible); }
                    }
                }
                for bone in &mut doc.bones {
                    if bone_ids.contains(&bone.uuid) { set_visibility(&mut bone.extra, *visible); }
                }
            }
            Ok(uuid.clone())
        }
        EditOperation::TranslateCube { uuid, delta } => {
            let per_texture = has_per_texture_uv_rules(doc);
            let resolution = [doc.resolution.width as f64, doc.resolution.height as f64];
            let textures = &doc.texture_assets;
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            translate_cube_in_place(&mut doc.cubes[cube_index], *delta, per_texture,
                resolution, textures, project_box_uv)?;
            Ok(uuid.clone())
        }
        EditOperation::ReflectBoneSubtree { uuid, axis, center, uv_policy } => {
            subtree::reflect_bone_subtree(doc, uuid, axis, *center, uv_policy)?;
            Ok(uuid.clone())
        }
        EditOperation::TranslateBoneSubtree { uuid, delta } => {
            // Move an articulated Cube/Bone cohort as a unit, rather than
            // asking an agent to emit one operation per nested element.
            // Reuse exactly the existing per-Cube UV-aware move semantics.
            // Bone keyframes stay local to their targets; opaque assets
            // and saved texture pixels are never rewritten by this command.
            if !valid_vec3(*delta) {
                return Err(fail("BONE_SUBTREE_DELTA_INVALID"));
            }
            let group = find_visibility_group(&doc.hierarchy, uuid)
                .ok_or_else(|| fail("BONE_SUBTREE_NOT_FOUND"))?;
            if delta.iter().all(|v| *v == 0.0) {
                return Ok(uuid.clone());
            }
            let mut cube_ids = HashSet::new();
            let mut bone_ids = HashSet::new();
            collect_visibility_targets(group, &mut cube_ids, &mut bone_ids);
            // One pass across each source collection, with O(1) expected
            // subtree membership. All Cube UV behavior stays in the same
            // translate_cube_in_place owner as a standalone TranslateCube.
            let per_texture = has_per_texture_uv_rules(doc);
            let resolution = [doc.resolution.width as f64, doc.resolution.height as f64];
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            if !cube_ids.is_empty() {
                for cube in &mut doc.cubes {
                    if cube_ids.contains(&cube.uuid) {
                        translate_cube_in_place(cube, *delta, per_texture,
                            resolution, &doc.texture_assets, project_box_uv)?;
                    }
                }
            }
            for bone in &mut doc.bones {
                if bone_ids.contains(&bone.uuid) {
                    let origin = bone.origin.unwrap_or([0.0, 0.0, 0.0]);
                    let moved: [f64; 3] = std::array::from_fn(|axis|
                        origin[axis] + delta[axis]);
                    if !valid_vec3(moved) {
                        return Err(fail("BONE_ORIGIN_INVALID"));
                    }
                    bone.origin = Some(moved);
                }
            }
            // The parent EditorSession only commits after validate(),
            // so one bad UV rule or overflow cancels the whole subtree move.
            Ok(uuid.clone())
        }
        EditOperation::SetCubeBounds { uuid, from, to } => {
            if !valid_bounds(*from, *to) { return Err(fail("CUBE_BOUNDS_INVALID")); }
            let per_texture = has_per_texture_uv_rules(doc);
            let resolution = [doc.resolution.width as f64, doc.resolution.height as f64];
            let textures = &doc.texture_assets;
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let cube = &doc.cubes[cube_index];
            let auto_uv = cube_auto_uv(cube)?;
            let box_uv = cube_box_uv(cube, project_box_uv);
            let refusal = if box_uv { "CUBE_BOX_UV_RESIZE_UNSUPPORTED" }
                else { "CUBE_AUTO_UV_REMAP_REQUIRED" };
            // The current operation has no transform direction. For UV-sensitive
            // cubes, only a single moved edge has unambiguous native semantics.
            let mut changed: Option<(usize, i8)> = None;
            for axis in 0..3 {
                let from_changed = cube.from[axis] != from[axis];
                let to_changed = cube.to[axis] != to[axis];
                if from_changed || to_changed {
                    if (auto_uv != 0 || box_uv) &&
                        (changed.is_some() || (from_changed && to_changed)) {
                        return Err(fail(refusal));
                    }
                    changed = Some((axis, if from_changed { -1 } else { 1 }));
                }
            }
            if changed.is_none() { return Ok(uuid.clone()); }
            if auto_uv != 0 && !box_uv && per_texture {
                return Err(fail("CUBE_UV_TEXTURE_RULESET_UNSUPPORTED"));
            }
            if box_uv {
                check_box_uv_repack_rules(doc, cube)?;
            }
            let (axis, direction) = changed.expect("a bound changed");
            let cube = &mut doc.cubes[cube_index];
            let prior_size = cube.to[axis] - cube.from[axis];
            cube.from = *from;
            cube.to = *to;
            if box_uv {
                apply_box_resize_offset(cube, axis, direction, prior_size);
                refresh_box_uv(cube)?;
            } else {
                refresh_auto_uv(cube, auto_uv, resolution, textures, Some((axis, direction)))?;
            }
            Ok(uuid.clone())
        }
        EditOperation::ReframeCube { uuid, from, to, uv_policy } => {
            // Explicit, deterministic full-shape authoring rather than a
            // sequence of mouse-edge resizes. The caller picks UV intent:
            // regenerate the complete Box UV net, or retain manual Face UV.
            // Preserve pivot/orientation/texture references without guessing.
            if !valid_bounds(*from, *to) {
                return Err(fail("CUBE_REFRAME_BOUNDS_INVALID"));
            }
            let box_uv_default = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let box_uv = cube_box_uv(&doc.cubes[cube_index], box_uv_default);
            if (box_uv && uv_policy != "box_repack") ||
               (!box_uv && uv_policy != "manual_preserve") {
                return Err(fail("CUBE_REFRAME_UV_POLICY_MISMATCH"));
            }
            if box_uv {
                check_box_uv_repack_rules(doc, &doc.cubes[cube_index])
                    .map_err(|code| box_uv_refusal_for("reframe", code))?;
            } else if cube_auto_uv(&doc.cubes[cube_index])? != 0 {
                return Err(fail("CUBE_REFRAME_AUTO_UV_UNSUPPORTED"));
            }
            let cube = &mut doc.cubes[cube_index];
            cube.from = *from;
            cube.to = *to;
            if box_uv {
                // An explicit repack also repairs stale cached face UV
                // when dimensions happen to stay unchanged.
                refresh_box_uv(cube)?;
            }
            Ok(uuid.clone())
        }
        EditOperation::SetBoneRotation { uuid, rotation } => {
            if !valid_vec3(*rotation) { return Err(fail("BONE_ROTATION_INVALID")); }
            let bone = doc.bones.iter_mut().find(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            let current = bone.extra.get("rotation")
                .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok())
                .unwrap_or([0.0, 0.0, 0.0]);
            if current == *rotation { return Ok(uuid.clone()); }
            if rotation.iter().all(|value| *value == 0.0) {
                // A neutral Bone rotation is omitted by pinned Blockbench.
                bone.extra.remove("rotation");
            } else {
                bone.extra.insert("rotation".into(), json!(rotation));
            }
            Ok(uuid.clone())
        }
        EditOperation::SetBoneOrigin { uuid, origin } => {
            // Rig pivot edit: never silently move child Cubes, UVs, or animation data.
            if !valid_vec3(*origin) { return Err(fail("BONE_ORIGIN_INVALID")); }
            let bone = doc.bones.iter_mut().find(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            if bone.origin.unwrap_or([0.0, 0.0, 0.0]) == *origin {
                return Ok(uuid.clone());
            }
            bone.origin = Some(*origin);
            Ok(uuid.clone())
        }
        EditOperation::SetCubeOrigin { uuid, origin } => {
            // Keep the Cube's saved faces, bounds and parent Bone untouched.
            if !valid_vec3(*origin) { return Err(fail("CUBE_ORIGIN_INVALID")); }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube.origin.unwrap_or([0.0, 0.0, 0.0]) == *origin {
                return Ok(uuid.clone());
            }
            cube.origin = Some(*origin);
            Ok(uuid.clone())
        }
        EditOperation::SetCubeInflate { uuid, inflate } => {
            if !inflate.is_finite() || inflate.abs() > LIMIT {
                return Err(fail("CUBE_INFLATE_INVALID"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            // Never commit a collapsed or inverted rendered surface.
            if (0..3).any(|axis| cube.to[axis] - cube.from[axis] + 2.0 * inflate <= 0.0) {
                return Err(fail("CUBE_INFLATE_DEGENERATE"));
            }
            if cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0) == *inflate {
                return Ok(uuid.clone());
            }
            if *inflate == 0.0 {
                cube.extra.remove("inflate");
            } else {
                cube.extra.insert("inflate".into(), json!(inflate));
            }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeStretch { uuid, stretch } => {
            // Preserve Cube bounds, pivot, UV and source image. Author only
            // positive, bounded stretches that the Three.js preview can show.
            // Imported unusual stretch fields remain preserved separately;
            // they are not silently coerced by this edit.
            if !stretch.iter().all(|value|
                value.is_finite() && *value > 0.0 && *value <= 100.0) {
                return Err(fail("CUBE_STRETCH_INVALID"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let inflation = cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0);
            if (0..3).any(|axis|
                (cube.to[axis] - cube.from[axis] + 2.0 * inflation) * stretch[axis] <= 0.0) {
                return Err(fail("CUBE_STRETCH_DEGENERATE"));
            }
            let current = cube.extra.get("stretch")
                .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok())
                .unwrap_or([1.0; 3]);
            if current == *stretch { return Ok(uuid.clone()); }
            if *stretch == [1.0; 3] {
                cube.extra.remove("stretch");
            } else {
                cube.extra.insert("stretch".into(), json!(stretch));
            }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeMirrorUv { uuid, mirrored } => {
            // One semantic operation replaces six manual Box UV edits.
            // Never approximate advanced per-texture or float-sized nets.
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let cube = &doc.cubes[cube_index];
            if !cube_box_uv(cube, project_box_uv) {
                return Err(fail("CUBE_MIRROR_BOX_UV_REQUIRED"));
            }
            if cube.extra.get("mirror_uv").and_then(Value::as_bool).unwrap_or(false)
                == *mirrored {
                return Ok(uuid.clone());
            }
            check_box_uv_repack_rules(doc, cube)
                .map_err(|code| box_uv_refusal_for("mirror", code))?;
            let cube = &mut doc.cubes[cube_index];
            if *mirrored {
                cube.extra.insert("mirror_uv".into(), Value::Bool(true));
            } else {
                cube.extra.remove("mirror_uv");
            }
            refresh_box_uv(cube)?;
            Ok(uuid.clone())
        }
        EditOperation::ScaleCube { uuid, factors } => {
            // A bounded, positive per-axis extension of pinned Blockbench
            // ModelScaler.scaleElements about the selected Cube's own pivot.
            // Its original scalar may be axis-filtered; this supports the same
            // math independently on each selected axis.
            if !factors.iter().all(|f| f.is_finite() && *f > 0.0 && *f <= 4.0) {
                return Err(fail("CUBE_SCALE_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if factors.iter().all(|f| *f == 1.0) { return Ok(uuid.clone()); }
            if cube_box_uv(&doc.cubes[cube_index], project_box_uv) {
                check_box_uv_repack_rules(doc, &doc.cubes[cube_index])?;
            }
            let cube = &mut doc.cubes[cube_index];
            let inflate = cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0);
            let pivot = cube.origin.unwrap_or([0.0, 0.0, 0.0]);
            for axis in 0..3 {
                let from = cube.from[axis];
                let to = cube.to[axis];
                cube.from[axis] = (from - inflate - pivot[axis]) * factors[axis] +
                    inflate + pivot[axis];
                cube.to[axis] = (to + inflate - pivot[axis]) * factors[axis] -
                    inflate + pivot[axis];
            }
            // ModelScaler clears Auto UV on scale; leave manual face UV and
            // texture identity untouched, rather than falsely remapping it.
            if cube_auto_uv(cube)? != 0 {
                cube.extra.insert("autouv".into(), json!(0));
            }
            if cube_box_uv(cube, project_box_uv) {
                // Box UV extents derive from the new saved Cube dimensions.
                // Scaling does not change the atlas UV offset.
                refresh_box_uv(cube)?;
            }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeRotation { uuid, rotation } => {
            if !valid_vec3(*rotation) { return Err(fail("CUBE_ROTATION_INVALID")); }
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if rotation.iter().all(|value| *value == 0.0) {
                // Blockbench omits the neutral cube rotation when saving.
                cube.extra.remove("rotation");
            } else {
                cube.extra.insert("rotation".into(), json!(rotation));
            }
            Ok(uuid.clone())
        }
        EditOperation::DuplicateAnimationClip { source_uuid, new_uuid, new_name } => {
            animation_clip::duplicate_animation_clip(doc, source_uuid, new_uuid, new_name)?;
            Ok(new_uuid.clone())
        }
        EditOperation::AddAnimationTimelineMarker { animation_uuid, time, name, color } => {
            timeline_markers::add_marker(doc,animation_uuid,*time,name,*color)
        }
        EditOperation::UpdateAnimationTimelineMarker {
            animation_uuid, target_time, time, name, color,
        } => timeline_markers::update_marker(
            doc,animation_uuid,*target_time,*time,name,*color),
        EditOperation::RemoveAnimationTimelineMarker { animation_uuid, time } => {
            timeline_markers::remove_marker(doc,animation_uuid,*time)
        }
        EditOperation::AddAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel, time, points,
        } => effects::add_event(doc,animation_uuid,keyframe_uuid,channel,*time,points),
        EditOperation::UpdateAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel, time, points,
        } => effects::update_event(doc,animation_uuid,keyframe_uuid,channel,*time,points),
        EditOperation::RemoveAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel,
        } => effects::remove_event(doc,animation_uuid,keyframe_uuid,channel),
        EditOperation::CreateAnimation { uuid, name, length } => {
            if !valid_uuid(uuid) || name.trim().is_empty() || name.chars().count() > 128 ||
               name.chars().any(char::is_control) ||
               !length.is_finite() || !(0.0..=3600.0).contains(length) ||
               doc.animation_assets.len() >= MAX_ELEMENTS ||
               doc.animation_assets.iter().any(|a|
                   a.get("uuid").and_then(Value::as_str) == Some(uuid) ||
                   a.get("name").and_then(Value::as_str) == Some(name.trim())) ||
               doc.cubes.iter().any(|c| c.uuid == *uuid) ||
               doc.bones.iter().any(|b| b.uuid == *uuid) ||
               doc.texture_assets.iter().any(|t| t.get("uuid").and_then(Value::as_str) == Some(uuid)) {
                return Err(fail("ANIMATION_CREATION_INVALID"));
            }
            doc.animation_assets.push(json!({
                "uuid": uuid, "name": name.trim(),
                "loop": "once", "length": length, "animators": {}
            }));
            Ok(uuid.clone())
        }
        EditOperation::SetAnimationLoopMode { animation_uuid, mode } => {
            // Only admitted numeric linear/step/Catmull-Rom Bone clips without opaque fields can
            // change their playback policy. Source-backed Blockbench v5.2.1
            // stores exactly once, loop, hold in the .bbmodel clip.
            if !matches!(mode.as_str(), "once" | "loop" | "hold") {
                return Err(fail("ANIMATION_LOOP_MODE_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, item)| item.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str()))
                .map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            let clip = &doc.animation_assets[index];
            if !editable_transform_clip(clip, &doc.bones) {
                return Err(fail("ANIMATION_LOOP_EDIT_UNSUPPORTED"));
            }
            let duration = clip.get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LOOP_EDIT_UNSUPPORTED"))?;
            if duration == 0.0 && mode != "once" {
                return Err(fail("ANIMATION_LOOP_LENGTH_INVALID"));
            }
            if saved_animation_loop(clip) == Some(mode.as_str()) {
                return Ok(animation_uuid.clone());
            }
            doc.animation_assets[index]["loop"] = json!(mode);
            Ok(animation_uuid.clone())
        }
        EditOperation::SetAnimationLength { animation_uuid, length } => {
            if !length.is_finite() || !(0.0..=3600.0).contains(length) {
                return Err(fail("ANIMATION_LENGTH_INVALID"));
            }
            let mut matching = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid));
            let (index, animation) = matching.next()
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            if matching.next().is_some() {
                // An imported model can contain duplicate Animation UUIDs.
                // Never choose the first target silently.
                return Err(fail("ANIMATION_ID_AMBIGUOUS"));
            }
            // All admitted numeric linear/step/Catmull-Rom transform channels are kept
            // byte-for-byte. No keyframe may be discarded by shortening.
            if !editable_transform_clip(animation, &doc.bones) {
                return Err(fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"));
            }
            if *length == 0.0 && saved_animation_loop(animation) != Some("once") {
                return Err(fail("ANIMATION_LOOP_LENGTH_INVALID"));
            }
            let animators = animation.get("animators").and_then(Value::as_object)
                .ok_or_else(|| fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"))?;
            for track in animators.values() {
                let frames = track.get("keyframes").and_then(Value::as_array)
                    .ok_or_else(|| fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"))?;
                if frames.iter().any(|frame| frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|time| time > *length)) {
                    return Err(fail("ANIMATION_LENGTH_BEFORE_KEYFRAME"));
                }
            }
            if !timeline_markers::valid_saved_markers(animation,*length) {
                return Err(fail("ANIMATION_LENGTH_BEFORE_MARKER"));
            }
            doc.animation_assets[index]["length"] = json!(length);
            Ok(animation_uuid.clone())
        }
        EditOperation::ScaleAnimationTimeline { animation_uuid, factor } => {
            // Admitted numeric linear/step/Catmull-Rom/Bezier clips are retimed in a
            // single transaction. No keyframe payload, UUID, Bone identity,
            // channel or interpolation is rewritten or guessed.
            if !factor.is_finite() || !(0.1..=10.0).contains(factor) {
                return Err(fail("ANIMATION_TIMELINE_FACTOR_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str())).map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TIMELINE_UNSUPPORTED"));
            }
            let original_length = doc.animation_assets[index]["length"].as_f64()
                .ok_or_else(|| fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"))?;
            let new_length = original_length * factor;
            if original_length <= 0.0 ||
               !new_length.is_finite() || !(0.0..=3600.0).contains(&new_length) {
                return Err(fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"));
            }
            if *factor == 1.0 { return Ok(animation_uuid.clone()); }
            let tracks = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
            for track in tracks.values_mut() {
                let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                    .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
                for frame in frames {
                    let time = frame.get("time").and_then(Value::as_f64)
                        .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
                    let scaled = time * factor;
                    if !scaled.is_finite() || scaled > new_length {
                        return Err(fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"));
                    }
                    if frame.get("interpolation").and_then(Value::as_str) == Some("bezier") &&
                       !bezier::retime_handles(frame, *factor) {
                        return Err(fail("ANIMATION_BEZIER_RETIME_UNSUPPORTED"));
                    }
                    frame["time"] = json!(scaled);
                }
            }
            timeline_markers::scale_markers(
                &mut doc.animation_assets[index],*factor,new_length)?;
            doc.animation_assets[index]["length"] = json!(new_length);
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                // E.g. scale would collapse distinct same-channel keyframe
                // times below the strict admission threshold. The parent
                // EditorSession discards this entire draft on refusal.
                return Err(fail("ANIMATION_TIMELINE_AFTER_SCALE_UNSUPPORTED"));
            }
            Ok(animation_uuid.clone())
        }
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, time, rotation,
        } => {
            if !valid_uuid(keyframe_uuid) || !time.is_finite() || *time < 0.0 ||
               !valid_vec3(*rotation) ||
               doc.animation_assets.iter().any(|a| value_references_uuid(a, keyframe_uuid)) ||
               doc.cubes.iter().any(|c| c.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|b| b.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_INVALID"));
            }
            let bone_name = doc.bones.iter().find(|bone| bone.uuid == *bone_uuid)
                .map(|bone| bone.name.clone())
                .ok_or_else(|| fail("ANIMATION_BONE_NOT_FOUND"))?;
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let length = animation.get("length").and_then(Value::as_f64)
                .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let animators = animation.get_mut("animators").and_then(Value::as_object_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let track = animators.entry(bone_uuid.clone()).or_insert_with(|| json!({
                "name": bone_name, "type": "bone", "keyframes": []
            }));
            if track.get("type").is_some_and(|kind| kind.as_str() != Some("bone")) {
                return Err(fail("ANIMATION_TRACK_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            if frames.len() >= 4096 || frames.iter().any(|frame|
                frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
                frame.get("time").and_then(Value::as_f64).is_some_and(|t| (t - time).abs() <= 1e-6)
            ) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            // Blockbench KeyframeDataPoint's x/y/z fields are Molang strings.
            frames.push(json!({
                "uuid": keyframe_uuid, "channel": "rotation", "time": time,
                "interpolation": "linear",
                "data_points": [{
                    "x": rotation[0].to_string(),
                    "y": rotation[1].to_string(),
                    "z": rotation[2].to_string()
                }]
            }));
            Ok(keyframe_uuid.clone())
        }
        EditOperation::UpdateBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, time, rotation,
        } => {
            if !valid_vec3(*rotation) || !time.is_finite() || *time < 0.0 {
                return Err(fail("ANIMATION_KEYFRAME_INVALID"));
            }
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let length = animation.get("length").and_then(Value::as_f64)
                .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let track = animation.get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            if !editable_rotation_track(track) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let index = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if !editable_rotation_frame(&frames[index]) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            if frames.iter().enumerate().any(|(i, frame)| i != index &&
                frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames[index]["time"] = json!(time);
            frames[index]["data_points"][0] = json!({
                "x": rotation[0].to_string(), "y": rotation[1].to_string(),
                "z": rotation[2].to_string()
            });
            Ok(keyframe_uuid.clone())
        }
        EditOperation::RemoveBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid,
        } => {
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let track = animation.get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            if !editable_rotation_track(track) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let index = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if !editable_rotation_frame(&frames[index]) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            frames.remove(index);
            // The session owns a draft; a refusal here rolls back the removal.
            if has_external_uuid_references(doc, keyframe_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_REFERENCED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel, time, value,
        } => {
            if !valid_uuid(keyframe_uuid) || !valid_animation_transform_value(channel, *value) ||
               !time.is_finite() || *time < 0.0 ||
               doc.animation_assets.iter().any(|asset|
                   value_references_uuid(asset, keyframe_uuid)) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let bone_name = doc.bones.iter().find(|bone| bone.uuid == *bone_uuid)
                .map(|bone| bone.name.clone())
                .ok_or_else(|| fail("ANIMATION_BONE_NOT_FOUND"))?;
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            let animation = &doc.animation_assets[index];
            if !editable_transform_clip(animation, &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let length = animation.get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let animator = doc.animation_assets[index]["animators"].as_object_mut()
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let track = animator.entry(bone_uuid.clone()).or_insert_with(|| json!({
                "name":bone_name,"type":"bone","keyframes":[]
            }));
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            if frames.len() >= 2048 || frames.iter().any(|frame|
                frame.get("channel").and_then(Value::as_str) == Some(channel.as_str()) &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames.push(json!({
                "uuid":keyframe_uuid, "channel":channel, "time":time,
                "interpolation":"linear",
                "data_points":[{
                    "x":value[0].to_string(), "y":value[1].to_string(),
                    "z":value[2].to_string()
                }]
            }));
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel, time, value,
        } => {
            if !valid_animation_transform_value(channel, *value) ||
               !time.is_finite() || *time < 0.0 {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let length = doc.animation_assets[index].get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let frames = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let target = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            if frames.iter().enumerate().any(|(i, frame)| i != target &&
                frame.get("channel").and_then(Value::as_str) == Some(channel.as_str()) &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames[target]["time"] = json!(time);
            frames[target]["data_points"][0] = json!({
                "x":value[0].to_string(), "y":value[1].to_string(),
                "z":value[2].to_string()
            });
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid, bone_uuid, keyframe_uuid, channel, interpolation,
        } => {
            // Blockbench 5.2.1 stores each key's outgoing interpolation.
            // Bezier requires separate explicit handle authoring; a
            // change is therefore targeted at one exact key UUID/channel.
            if !supported_transform_channel(channel) ||
               !matches!(interpolation.as_str(), "linear" | "step" | "catmullrom") {
                return Err(fail("ANIMATION_INTERPOLATION_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, animation)| animation.get("uuid")
                    .and_then(Value::as_str) == Some(animation_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_INTERPOLATION_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index]
                .get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let matches: Vec<_> = frames.iter().enumerate()
                .filter(|(_, frame)| frame.get("uuid")
                    .and_then(Value::as_str) == Some(keyframe_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let target = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_KEYFRAME_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_KEYFRAME_ID_AMBIGUOUS")),
            };
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            if frames[target].get("interpolation").and_then(Value::as_str)
                == Some(interpolation.as_str()) {
                return Ok(keyframe_uuid.clone());
            }
            frames[target]["interpolation"] = json!(interpolation);
            // Blockbench's saved representation omits Bezier-specific
            // fields when a key is switched to another interpolation.
            bezier::clear_handles(&mut frames[target]);
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_INTERPOLATION_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid, bone_uuid, keyframe_uuid, channel, handles,
        } => {
            if !supported_transform_channel(channel) || !handles.valid() {
                return Err(fail("ANIMATION_BEZIER_HANDLES_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, item)| item.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str()))
                .map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_BEZIER_CLIP_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index]
                .get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let matching: Vec<_> = frames.iter().enumerate()
                .filter(|(_, frame)| frame.get("uuid").and_then(Value::as_str)
                    == Some(keyframe_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let target = match matching.as_slice() {
                [] => return Err(fail("ANIMATION_KEYFRAME_NOT_FOUND")),
                [i] => *i,
                _ => return Err(fail("ANIMATION_KEYFRAME_ID_AMBIGUOUS")),
            };
            if frames[target].get("channel").and_then(Value::as_str)
                != Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            bezier::write_handles(&mut frames[target], handles);
            // Existing EditorSession draft is never committed if any
            // operation fails. Recheck recognized saved keys now.
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_BEZIER_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::RemoveBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel,
        } => {
            if !supported_transform_channel(channel) {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let target = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            frames.remove(target);
            // Joining two adjacent segments may alter their Bezier time
            // handles. Fail atomically if the remaining track is ambiguous.
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            if has_external_uuid_references(doc, keyframe_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_REFERENCED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::EnableImportedPaintTexture { texture_index } => {
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
            }
            let (width, height) = (doc.resolution.width, doc.resolution.height);
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::adopt(texture, width, height)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::SetVisibleBox { bounds } => {
            if !geometry::valid_visible_box(*bounds) {
                return Err(fail("VISIBLE_BOX_INVALID"));
            }
            // Keep the authored animation envelope in the canonical
            // .bbmodel Project property. The Geometry exporter combines it
            // with computed static bounds; no Cube, PNG or Animation edits.
            doc.extensions.insert("visible_box".into(), json!(bounds));
            Ok("project-visible-box".into())
        }
        EditOperation::SetEmptyAtlasResolution { width, height } => {
            if !can_set_empty_atlas_resolution(doc) {
                return Err(fail("ATLAS_RESOLUTION_LOCKED"));
            }
            if *width == 0 || *height == 0 || *width > MAX_PAINT_ATLAS_SIDE ||
               *height > MAX_PAINT_ATLAS_SIDE {
                return Err(fail("ATLAS_RESOLUTION_UNSUPPORTED"));
            }
            doc.resolution.width = *width;
            doc.resolution.height = *height;
            Ok("project-resolution".into())
        }
        EditOperation::ReplaceExistingFaceTextureGuarded {
            intent, candidate_png_source,
        } => external_texture::apply_operation(doc,intent,candidate_png_source),
        EditOperation::ImportPaintTexture { uuid, name, source } => {
            // Existing imported project assets are never rewritten to admit
            // an unsupported Paint/UV configuration.
            check_paint_texture_addition(doc)?;
            if !valid_uuid(uuid) || doc.cubes.iter().any(|cube| cube.uuid == *uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *uuid) ||
               doc.texture_assets.iter().chain(doc.animation_assets.iter())
                 .any(|asset| asset.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_ID_INVALID"));
            }
            let texture = paint::import_png(
                uuid, name, source, doc.resolution.width, doc.resolution.height
            )?;
            doc.texture_assets.push(texture);
            Ok(uuid.clone())
        }
        EditOperation::AssignCubeTexture { cube_uuid, texture_uuid } => {
            // Bedrock multi-file rulesets select textures by element scope.
            // Do not claim global face-ID assignment changes the material.
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
            }
            if !doc.texture_assets.iter().any(|asset|
                asset.get("uuid").and_then(Value::as_str) == Some(texture_uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_NOT_FOUND"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            for face in cube.faces.values_mut() {
                // A null face is intentionally absent in Blockbench. Never
                // enable its geometry by assigning another texture.
                if face.get("texture").is_some_and(Value::is_null) { continue; }
                let fields = face.as_object_mut()
                    .ok_or_else(|| fail("CUBE_FACE_DATA_INVALID"))?;
                fields.insert("texture".into(), Value::String(texture_uuid.clone()));
            }
            Ok(cube_uuid.clone())
        }
        EditOperation::AssignCubeFaceTexture { cube_uuid, face, texture_uuid } => {
            // A single diagnosed face must never repaint/rebind other faces.
            // The caller chooses the intended atlas; the inspector supplies
            // evidence, not automatic mutation authority.
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
            }
            if !FACE_NAMES.contains(&face.as_str()) {
                return Err(fail("CUBE_FACE_INVALID"));
            }
            if !doc.texture_assets.iter().any(|asset|
                asset.get("uuid").and_then(Value::as_str) == Some(texture_uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_NOT_FOUND"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let target = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                .ok_or_else(|| fail("CUBE_FACE_DATA_INVALID"))?;
            // Blockbench null means the side is intentionally missing.
            // Refuse to turn it into geometry while correcting a texture.
            if target.get("texture").is_some_and(Value::is_null) {
                return Err(fail("CUBE_FACE_INTENTIONALLY_ABSENT"));
            }
            target.insert("texture".into(), Value::String(texture_uuid.clone()));
            Ok(cube_uuid.clone())
        }
        EditOperation::CreatePaintTexture { uuid, name } => {
            check_paint_texture_addition(doc)?;
            if !valid_uuid(uuid) || doc.cubes.iter().any(|cube| cube.uuid == *uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *uuid) ||
               doc.texture_assets.iter().chain(doc.animation_assets.iter())
                 .any(|asset| asset.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_ID_INVALID"));
            }
            // Bedrock project resolution is the atlas size for this initial
            // single-texture Paint subset. The codec owns all PNG bytes.
            let texture = paint::create(uuid, name, doc.resolution.width, doc.resolution.height)?;
            doc.texture_assets.push(texture);
            Ok(uuid.clone())
        }
        EditOperation::PaintTexturePixel { texture_index, x, y, rgba } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::pixel(texture, doc.resolution.width, doc.resolution.height, *x, *y, *rgba)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureStroke { texture_index, points, rgba } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::stroke(texture, doc.resolution.width, doc.resolution.height, points, *rgba)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureBrush { texture_index, points, radius, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::brush(texture, doc.resolution.width, doc.resolution.height,
                points, *radius, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureExactPixels {texture_index,pixels}=>{
            let texture=doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(||fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::exact_pixels(texture,doc.resolution.width,
                doc.resolution.height,pixels)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureRectangle { texture_index, from, to, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::rectangle(texture, doc.resolution.width, doc.resolution.height,
                *from, *to, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureRectangles { texture_index, rectangles } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::rectangles(texture, doc.resolution.width, doc.resolution.height,
                rectangles)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::IsolateCubeBoxUv { cube_uuid, texture_uuid } => {
            let plan = uv_sharing::plan_box_uv_isolation(doc,cube_uuid,texture_uuid)?;
            let (width,height) = (doc.resolution.width,doc.resolution.height);
            let texture = doc.texture_assets.get_mut(plan.texture_index)
                .ok_or_else(|| fail("UV_ATLAS_TEXTURE_NOT_FOUND"))?;
            paint::copy_uv_regions(texture,width,height,&plan.copies)?;
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("UV_ATLAS_CUBE_NOT_FOUND"))?;
            cube.uv_offset = Some(plan.next_offset);
            refresh_box_uv(cube)?;
            Ok(cube_uuid.clone())
        }
        EditOperation::RecolorCubeFacesPaletteGuarded { texture_uuid, targets, palette } => {
            palette::recolor_cube_faces_palette_guarded(doc, texture_uuid, targets, palette)
        }
        EditOperation::PaintCubeFaceRegionsGuarded { cube_uuid, texture_uuid, regions } => {
            face_regions::paint_cube_face_regions_guarded(doc, cube_uuid, texture_uuid, regions)
        }
        EditOperation::PaintCubeUvFacesGuarded { cube_uuid, texture_uuid, faces } => {
            // Opt-in shared-atlas protection: only requested faces are paint
            // targets, while all other faces remain possible UV consumers.
            if faces.is_empty() || faces.len() > FACE_NAMES.len() {
                return Err(fail("PAINT_CUBE_FACES_SIZE_INVALID"));
            }
            let mut seen = HashSet::new();
            for patch in faces {
                if !FACE_NAMES.contains(&patch.face.as_str()) ||
                   !seen.insert(patch.face.as_str()) {
                    return Err(fail("PAINT_CUBE_FACE_DUPLICATE_OR_UNKNOWN"));
                }
            }
            let names: Vec<&str> = faces.iter().map(|patch| patch.face.as_str()).collect();
            let report = uv_sharing::inspect_cube_uv_sharing_for_faces(
                doc, cube_uuid, texture_uuid, Some(&names))?;
            let count = |key| report[key].as_u64().unwrap_or(u64::MAX);
            if count("focused_mapped_faces") != faces.len() as u64 ||
               count("unresolved_explicit_faces") > 0 ||
               count("implicit_reference_faces") > 0 {
                return Err(fail("PAINT_CUBE_UV_GUARD_UNRESOLVED"));
            }
            if count("declared_overlap_pairs") > 0 {
                return Err(fail("PAINT_CUBE_UV_GUARD_SHARED"));
            }
            // Reuse exactly one existing PNG mutation/Undo source. This
            // guard is not proof of native material or face-coverage parity.
            apply_operation(doc, &EditOperation::PaintCubeUvFaces {
                cube_uuid: cube_uuid.clone(), texture_uuid: texture_uuid.clone(),
                faces: faces.clone(),
            })
        }
        EditOperation::PaintCubeUvFaces { cube_uuid, texture_uuid, faces } => {
            // Paint up to six explicit semantic Cube faces on one validated
            // atlas, in caller order and through one existing PNG transaction.
            // This does not claim exclusive face ownership of shared UV pixels.
            if faces.is_empty() || faces.len() > FACE_NAMES.len() {
                return Err(fail("PAINT_CUBE_FACES_SIZE_INVALID"));
            }
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_CUBE_UV_RULESET_UNSUPPORTED"));
            }
            let texture_index = doc.texture_assets.iter().position(|texture|
                texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            let original_cube = doc.cubes.iter().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let mut projected = original_cube.clone();
            if cube_box_uv(original_cube, doc.meta.box_uv.unwrap_or(false)) {
                if check_box_uv_repack_rules(doc, original_cube).is_err() {
                    return Err(fail("PAINT_CUBE_UV_RULESET_UNSUPPORTED"));
                }
                // Never trust stale cached rectangles from an imported Cube.
                // The derived Box net is local; this is not a geometry edit.
                refresh_box_uv(&mut projected)?;
            } else if cube_auto_uv(original_cube)? != 0 {
                return Err(fail("PAINT_CUBE_AUTO_UV_UNSUPPORTED"));
            }
            let mut seen = HashSet::new();
            let mut steps = Vec::with_capacity(faces.len());
            for patch in faces {
                if !FACE_NAMES.contains(&patch.face.as_str()) ||
                   !seen.insert(patch.face.as_str()) {
                    return Err(fail("PAINT_CUBE_FACE_DUPLICATE_OR_UNKNOWN"));
                }
                let surface = projected.faces.get(&patch.face)
                    .and_then(Value::as_object)
                    .ok_or_else(|| fail("PAINT_CUBE_FACE_INVALID"))?;
                if surface.get("enabled").is_some_and(|v| v != &Value::Bool(true)) {
                    return Err(fail("PAINT_CUBE_FACE_DISABLED"));
                }
                // Face-level null/false/unset means no explicit atlas target,
                // even if Bedrock's runtime chooses a default texture.
                let linked = match surface.get("texture") {
                    Some(Value::String(uuid)) => uuid == texture_uuid,
                    Some(Value::Number(number)) =>
                        number.as_u64() == Some(texture_index as u64),
                    _ => false,
                };
                if !linked { return Err(fail("PAINT_CUBE_FACE_TEXTURE_MISMATCH")); }
                let uv = face_uv(&projected, &patch.face)?;
                let (from, end) = paint::uv_pixel_rectangle(
                    doc.resolution.width, doc.resolution.height, uv)?;
                steps.push(PaintRectangleStep {
                    from, to: [end[0] - 1, end[1] - 1],
                    rgba: patch.rgba, erase: patch.erase,
                });
            }
            let bitmap = doc.texture_assets.get_mut(texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::rectangles(bitmap, doc.resolution.width,
                doc.resolution.height, &steps)?;
            Ok(texture_uuid.clone())
        }
        EditOperation::PaintTextureFill { texture_index, at, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::fill(texture, doc.resolution.width, doc.resolution.height,
                *at, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::SetBoxUvOffset { uuid, offset } => {
            // Blockbench's Box UV editor stores integer atlas offsets.
            if !valid_uv(offset) || !offset.iter().all(|value| value.fract() == 0.0) {
                return Err(fail("BOX_UV_OFFSET_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let cube = &doc.cubes[cube_index];
            if !cube_box_uv(cube, project_box_uv) {
                return Err(fail("BOX_UV_MODE_REQUIRED"));
            }
            if cube.uv_offset.unwrap_or([0.0, 0.0]) == *offset {
                return Ok(uuid.clone());
            }
            check_box_uv_repack_rules(doc, cube)?;
            let cube = &mut doc.cubes[cube_index];
            cube.uv_offset = if offset.iter().all(|value| *value == 0.0) {
                None
            } else {
                Some(*offset)
            };
            refresh_box_uv(cube)?;
            Ok(uuid.clone())
        }
        EditOperation::SetFaceUvRotation { uuid, face, rotation } => {
            if !FACE_NAMES.contains(&face.as_str()) ||
               !matches!(*rotation, 0 | 90 | 180 | 270) {
                return Err(fail("FACE_UV_ROTATION_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube_box_uv(cube, project_box_uv) {
                return Err(fail("FACE_UV_BOX_MODE_UNSUPPORTED"));
            }
            let auto_uv = cube_auto_uv(cube)?;
            let data = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                .ok_or_else(|| fail("FACE_NOT_FOUND"))?;
            // Blockbench CubeFace.rotation defaults to 0, and its save copy
            // omits default fields. Unsupported existing data is preserved
            // through refusal, not overwritten or silently normalized.
            let previous = match data.get("rotation") {
                None => 0,
                Some(value) => match value.as_f64() {
                    Some(n) if [0.0, 90.0, 180.0, 270.0].contains(&n) => n as u16,
                    _ => return Err(fail("FACE_UV_ROTATION_UNSUPPORTED")),
                },
            };
            if previous != *rotation {
                if *rotation == 0 {
                    data.remove("rotation");
                } else {
                    data.insert("rotation".into(), json!(rotation));
                }
                // Manual face rotation, like manual face coordinates, leaves
                // Auto UV mode without recalculating unrelated face mapping.
                if auto_uv != 0 {
                    cube.extra.insert("autouv".into(), json!(0));
                }
            }
            Ok(uuid.clone())
        }
        EditOperation::SetFaceUv { uuid, face, uv } => {
            if !FACE_NAMES.contains(&face.as_str()) || !valid_uv(uv) {
                return Err(fail("FACE_UV_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube_box_uv(cube, project_box_uv) {
                return Err(fail("FACE_UV_BOX_MODE_UNSUPPORTED"));
            }
            // Blockbench's manual face-UV editing disables Auto UV for the
            // edited Cube. Keep this transition in the same Rust transaction.
            let previous = face_uv(cube, face)?;
            if previous != *uv {
                let data = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                    .ok_or_else(|| fail("FACE_NOT_FOUND"))?;
                data.insert("uv".into(), json!(uv));
                if cube_auto_uv(cube)? != 0 {
                    cube.extra.insert("autouv".into(), json!(0));
                }
            }
            Ok(uuid.clone())
        }
    }
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
}

impl<'a> ValidatedInspection<'a> {
    fn texture_indices(&self) -> &HashMap<&'a str, usize> {
        self.texture_indices.get_or_init(|| indexed_texture_uuids(self.doc))
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

//! Standalone headless adapter to the canonical Rust authoring library.
//! SOURCE ONLY: Windows CLI, filesystem and Blockbench behavior NOT_EXECUTED.

use lazydesigner::authoring::{
    sha256, export_paint_png, export_bedrock_geometry, inspect_rotation_track, inspect_transform_track, inspect_cube_surfaces, inspect_paint_alpha, inspect_cube_uv_alpha, inspect_cube_uv_sharing, inspect_model_texture_coverage_filtered, inspect_animation_effect_events,
    inspect_animation_timeline_markers, export_bedrock_animations, bedrock_animation_curve_fidelity,
    inspect_bedrock_asset_handoff_page, paint_texture_editable, inspect_material_pair, inspect_material_face_patch_with_spans, FaceLocalRowSpan, inspect_texture_styling_region, inspect_texture_styling_regions, inspect_texture_styling_face, inspect_texture_source_colors_page, inspect_visual_png_pair, MAX_VISUAL_PNG_BYTES, MaterialPatchRegion, AuthoringDocument, OutlinerNode, EditOperation, EditPlan, EditorSession, ValidatedInspection,
    MAX_MODEL_BYTES, MAX_PLAN_BYTES, MAX_IMPORT_PNG_BYTES, MAX_EXPORT_PNG_BYTES,
    GeometryAssemblyRequest, GeometryFaceAttachmentRequest, inspect_geometry_impact,
    GeometryVoidZone, check_geometry_void_zones,
    GeometryResizePropagationRequest, SemanticMaterialIntent,
    PeriodicRotationIntent, SemanticAnimationIntent, ExistingAnimationIntent,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use lazydesigner::authoring::storage::{bbmodel, png, geometry_json, animation_json, publish_new, publish_new_png, publish_new_geometry, publish_new_animation, read_bounded, same_directory};
use rand::RngCore;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
#[cfg(test)]
use std::fs;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.into() }

fn arguments() -> Result<(String, BTreeMap<String, String>)> {
    let mut args = std::env::args().skip(1);
    let command = args.next().ok_or_else(|| fail("COMMAND_REQUIRED"))?;
    let mut options = BTreeMap::new();
    while let Some(key) = args.next() {
        if !key.starts_with("--") || key.len() < 3 { return Err(fail("OPTION_INVALID")); }
        let value = args.next().ok_or_else(|| fail("OPTION_VALUE_REQUIRED"))?;
        if value.starts_with("--") || options.insert(key, value).is_some() {
            return Err(fail("OPTION_DUPLICATE_OR_INVALID"));
        }
    }
    Ok((command, options))
}
fn option<'a>(options: &'a BTreeMap<String, String>, key: &str) -> Result<&'a str> {
    options.get(key).map(String::as_str).ok_or_else(|| fail("OPTION_REQUIRED"))
}
fn option_set(options: &BTreeMap<String, String>, allowed: &[&str]) -> Result<()> {
    let allowed: HashSet<&str> = allowed.iter().copied().collect();
    if options.keys().any(|k| !allowed.contains(k.as_str())) {
        Err(fail("OPTION_UNKNOWN"))
    } else { Ok(()) }
}

// Apply and import-png share one source-integrity gate. Both publish only
// a new sibling; neither overwrites or rewrites the selected source model.
fn ensure_source_sha(actual_sha: &str, expected_sha: &str) -> Result<()> {
    if expected_sha.len() != 64 ||
       !expected_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) ||
       !actual_sha.eq_ignore_ascii_case(expected_sha) {
        return Err(fail("SOURCE_SHA256_STALE"));
    }
    Ok(())
}

fn read_verified_source(path: &Path, expected_sha: &str) -> Result<(Vec<u8>, String)> {
    bbmodel(path)?;
    let bytes = read_bounded(path, MAX_MODEL_BYTES)?;
    let actual_sha = sha256(&bytes);
    ensure_source_sha(&actual_sha, expected_sha)?;
    Ok((bytes, actual_sha))
}

// Public CLI contract and native source SHA guard stay in this binary root.
mod focused_projections;
mod inspection_batch;
mod command_routes;
use focused_projections::*;
use inspection_batch::*;
use command_routes::execute;

fn main() {
    match execute() {
        Ok(report) => println!("{}", report),
        Err(code) => {
            println!("{}", json!({"status":"ERROR","code":code}));
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests;

//! Bounded source-only model Texture/UV alpha review.
//! A saved atlas alpha histogram is never proof that a visible face is painted.
use super::{AuthoringDocument, Result, inspect_cube_uv_alpha_validated};
use serde_json::{json, Value};

const MAX_PAGE: usize = 8;

/// Page through source Cube faces, reusing the canonical six-face/PNG
/// inspector. No raw PNG bytes are returned and no document is mutated.
/// Null faces are intentionally absent; false/unset links and alpha pixels
/// are reported as review candidates rather than silently claimed painted.
pub fn inspect_model_texture_coverage(
    doc: &AuthoringDocument, offset: usize, limit: usize,
) -> Result<Value> {
    inspect_model_texture_coverage_filtered(doc, offset, limit, false)
}

/// Return only source faces that require review. Pages are still indexed by
/// SCANNED Cube position, not emitted Cube count, so blank/healthy pages never
/// shift or repeat the next page. This is a read projection, not a new atlas
/// decoder or proof that transparent pixels are unintentional.
pub fn inspect_model_texture_coverage_filtered(
    doc: &AuthoringDocument, offset: usize, limit: usize, attention_only: bool,
) -> Result<Value> {
    if offset > 65_536 || limit == 0 || limit > MAX_PAGE {
        return Err("TEXTURE_COVERAGE_PAGE_INVALID".into());
    }
    // Arbitrary standalone document callers preserve the complete gate.
    doc.validate()?;
    inspect_model_texture_coverage_filtered_validated(
        doc, offset, limit, attention_only,
    )
}

/// Session-only projection: borrowed from a validated immutable document.
/// This is not a public unvalidated-document inspection entrypoint.
pub(super) fn inspect_model_texture_coverage_filtered_validated(
    doc: &AuthoringDocument, offset: usize, limit: usize, attention_only: bool,
) -> Result<Value> {
    if offset > 65_536 || limit == 0 || limit > MAX_PAGE {
        return Err("TEXTURE_COVERAGE_PAGE_INVALID".into());
    }
    let texture_indices = super::indexed_texture_uuids(doc);
    let total = doc.cubes.len();
    let mut cubes = Vec::new();
    let mut review_candidates = 0u64;
    let mut fully_transparent = 0u64;
    let mut partially_transparent = 0u64;
    let mut translucent = 0u64;
    let mut unresolved = 0u64;
    let mut reviewed_cubes = 0usize;
    let mut returned_faces = 0usize;
    // No persistent cache: the immutable page shares decoded PNGs only within
    // this read and discards them before any later model revision.
    let mut decoded = Vec::new();

    for cube in doc.cubes.iter().skip(offset).take(limit) {
        reviewed_cubes += 1;
        let inspected = inspect_cube_uv_alpha_validated(
            doc, cube, &mut decoded, &texture_indices)?;
        let faces = inspected["faces"].as_array()
            .ok_or_else(|| "TEXTURE_COVERAGE_FACES_INVALID".to_string())?;
        let mut compact_faces = Vec::with_capacity(faces.len());
        let mut cube_attention = 0u64;
        for face in faces {
            let reference = face["saved_reference_kind"].as_str()
                .ok_or_else(|| "TEXTURE_COVERAGE_FACE_INVALID".to_string())?;
            let alpha = &face["alpha"];
            let (status, reason, pixels): (&str, Value, Value) = match reference {
                "null" => ("absent_declared", Value::Null, Value::Null),
                "false" => ("no_explicit_texture", Value::Null, Value::Null),
                "unset" => ("implicit_texture_unresolved", Value::Null, Value::Null),
                "uuid" | "index" => {
                    if alpha["status"] != "measured" {
                        ("mapping_unsupported", alpha["reason"].clone(), Value::Null)
                    } else {
                        let region = &alpha["region"];
                        let read = |field: &str| -> Result<u64> {
                            region[field].as_u64()
                                .ok_or_else(|| "TEXTURE_COVERAGE_ALPHA_INVALID".to_string())
                        };
                        let total_pixels = read("sampled_pixels")?;
                        let transparent = read("transparent_pixels")?;
                        let translucent = read("translucent_pixels")?;
                        let opaque = read("opaque_pixels")?;
                        if total_pixels == 0 ||
                           transparent + translucent + opaque != total_pixels {
                            return Err("TEXTURE_COVERAGE_ALPHA_INVALID".into());
                        }
                        let status = if transparent == total_pixels {
                            "fully_transparent_pixels"
                        } else if transparent > 0 {
                            "partially_transparent_pixels"
                        } else if translucent > 0 {
                            "translucent_pixels"
                        } else {
                            "measured_nontransparent_pixels"
                        };
                        (status, Value::Null, json!({
                            "sampled":total_pixels,
                            "transparent":transparent,
                            "translucent":translucent,
                            "opaque":opaque
                        }))
                    }
                },
                _ => return Err("TEXTURE_COVERAGE_REFERENCE_INVALID".into()),
            };
            let needs_review = status != "absent_declared" &&
                status != "measured_nontransparent_pixels";
            if needs_review {
                cube_attention += 1;
                review_candidates += 1;
            }
            if status == "fully_transparent_pixels" { fully_transparent += 1; }
            if status == "partially_transparent_pixels" { partially_transparent += 1; }
            if status == "translucent_pixels" { translucent += 1; }
            if status == "implicit_texture_unresolved" ||
               status == "mapping_unsupported" || status == "no_explicit_texture" {
                unresolved += 1;
            }
            if !attention_only || needs_review {
                compact_faces.push(json!({
                    "side":face["side"],
                    "reference_kind":reference,
                    "texture_uuid":face["texture_uuid"],
                    "status":status,
                    "reason":reason,
                    "alpha_pixels":pixels,
                }));
                returned_faces += 1;
            }
        }
        if !attention_only || cube_attention > 0 {
            cubes.push(json!({
                "cube_uuid":cube.uuid,
                "review_candidates":cube_attention,
                "faces":compact_faces,
            }));
        }
    }
    // The scan cursor MUST NOT depend on the filtered result length.
    let end = offset.saturating_add(reviewed_cubes);
    let next_offset = (end < total).then_some(end);
    let report = json!({
        "scope":"saved_face_texture_coverage_page",
        "visual_verdict":"UNVERIFIED",
        "face_coverage_verdict":"UNVERIFIED",
        "total_cubes":total,
        "offset":offset,
        "limit":limit,
        "attention_only":attention_only,
        "reviewed_cubes":reviewed_cubes,
        "returned_cubes":cubes.len(),
        "returned_faces":returned_faces,
        "review_candidates":review_candidates,
        "fully_transparent_faces":fully_transparent,
        "partially_transparent_faces":partially_transparent,
        "translucent_faces":translucent,
        "unresolved_reference_or_mapping_faces":unresolved,
        "next_offset":next_offset,
        "cubes":cubes,
    });
    if serde_json::to_vec(&report)
        .map_err(|_| "TEXTURE_COVERAGE_SERIALIZE_FAILED".to_string())?.len() > 32 * 1024 {
        return Err("TEXTURE_COVERAGE_RESULT_TOO_LARGE".into());
    }
    Ok(report)
}

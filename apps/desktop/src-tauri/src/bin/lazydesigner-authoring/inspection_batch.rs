//! Bounded typed inspection query selectors and Rust-owned read-only batch.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

/// Read-only Code Mode query batch. A single model read and Rust parse answer
/// several focused questions. Unknown fields/shapes refuse, not auto-correct.
/// Each query reuses existing canonical source projections; no new authoring
/// state, mutation path, arbitrary JS execution or direct bitmap response.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct InspectBatchInput {
    pub(super) requests: Vec<InspectBatchQuery>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum InspectBatchQuery {
    AuthoringTarget { domain: String, category: String, name: String },
    Cube { uuid: String },
    CubeSurfaces { uuid: String },
    CubeFaceAlpha { uuid: String },
    CubeUvSharing { uuid: String, texture_uuid: String },
    GeometryImpact { cube_uuid: String, change: String },
    AssetHandoff { texture_uuid: String, offset: Option<usize>, limit: Option<usize> },
    ModelTextureCoverage { offset: Option<usize>, limit: Option<usize>, attention_only: Option<bool> },
    MaterialPair { reference_uuid: String, candidate_uuid: String,
        reference_region: MaterialPatchRegion, candidate_region: MaterialPatchRegion },
    MaterialFacePatch { texture_uuid: String, cube_uuid: String, face: String,
        region: MaterialPatchRegion, face_spans: Option<Vec<FaceLocalRowSpan>> },
    TextureStyling { texture_uuid: String, region: MaterialPatchRegion },
    TextureSourceColors { texture_uuid: String, region: MaterialPatchRegion,
        offset:Option<usize>,limit:Option<usize> },
    TextureStylingFace { texture_uuid: String, cube_uuid: String, face: String },
    Catalog { category: String, offset: Option<usize>, limit: Option<usize> },
    Texture { index: usize },
    TextureAlpha { uuid: String },
    Animation { uuid: String },
    AnimationTrack {
        animation_uuid: String, bone_uuid: String,
        offset: Option<usize>, limit: Option<usize>,
    },
    AnimationTransformTrack {
        animation_uuid: String, bone_uuid: String, channel: String,
        offset: Option<usize>, limit: Option<usize>,
    },
    AnimationEffectEvents {
        animation_uuid: String, offset: Option<usize>, limit: Option<usize>,
    },
    AnimationTimelineMarkers {
        animation_uuid: String, offset: Option<usize>, limit: Option<usize>,
    },
    Audit,
}

pub(super) const MAX_INSPECT_BATCH_QUERIES: usize = 8;
pub(super) const MAX_INSPECT_BATCH_RESULT_BYTES: usize = 96 * 1024;

pub(super) fn batch_id(value: &str) -> Result<&str> {
    if value.is_empty() || value.len() > 128 ||
       value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(fail("INSPECT_BATCH_ID_INVALID"));
    }
    Ok(value)
}

pub(super) fn inspect_batch(doc: &AuthoringDocument, requests: Vec<InspectBatchQuery>) -> Result<Vec<Value>> {
    // Arbitrary-document fixture and inspection paths retain their gates.
    inspect_batch_with_view(doc, None, requests)
}

pub(super) fn inspect_batch_session(
    session: &EditorSession, requests: Vec<InspectBatchQuery>,
) -> Result<Vec<Value>> {
    let validated = session.inspections();
    inspect_batch_with_view(session.document(), Some(&validated), requests)
}

pub(super) fn inspect_batch_with_view(
    doc: &AuthoringDocument, validated: Option<&ValidatedInspection<'_>>,
    requests: Vec<InspectBatchQuery>,
) -> Result<Vec<Value>> {
    if requests.is_empty() || requests.len() > MAX_INSPECT_BATCH_QUERIES {
        return Err(fail("INSPECT_BATCH_SIZE_INVALID"));
    }
    // Only repeated Geometry Impact questions justify an atlas-user index.
    // A single target still takes the original no-extra-allocation scanner.
    let repeated_impact = validated.is_some() &&
        requests.iter().filter(|query|
            matches!(query, &&InspectBatchQuery::GeometryImpact { .. }))
            .take(2).count() == 2;
    let mut results = Vec::with_capacity(requests.len());
    for query in requests {
        let entry = match query {
            InspectBatchQuery::AuthoringTarget { domain, category, name } => {
                let target = inspect_authoring_target_with_view(
                    doc, validated, &domain, &category, &name,
                )?;
                json!({"kind":"authoring_target", "target":target})
            },
            InspectBatchQuery::Cube { uuid } => {
                let element = focused_element(doc, batch_id(&uuid)?)?;
                json!({"kind":"cube","element":element})
            },
            InspectBatchQuery::CubeSurfaces { uuid } => {
                let uuid = batch_id(&uuid)?;
                let surfaces = match validated {
                    Some(view) => view.cube_surfaces(uuid)?,
                    None => inspect_cube_surfaces(doc, uuid)?,
                };
                json!({"kind":"cube_surfaces","surfaces":surfaces})
            },
            InspectBatchQuery::CubeFaceAlpha { uuid } => {
                let uuid = batch_id(&uuid)?;
                let face_alpha = match validated {
                    Some(view) => view.cube_face_alpha(uuid)?,
                    None => inspect_cube_uv_alpha(doc, uuid)?,
                };
                json!({"kind":"cube_face_alpha","face_alpha":face_alpha})
            },
            InspectBatchQuery::GeometryImpact { cube_uuid, change } => {
                let uuid = batch_id(&cube_uuid)?;
                let impact = match (repeated_impact, validated) {
                    (true, Some(view)) => view.geometry_impact(uuid, &change)?,
                    _ => inspect_geometry_impact(doc, uuid, &change)?,
                };
                json!({"kind":"geometry_impact","impact":impact})
            },
            InspectBatchQuery::CubeUvSharing { uuid, texture_uuid } => {
                let uv_sharing = inspect_cube_uv_sharing(
                    doc, batch_id(&uuid)?, batch_id(&texture_uuid)?)?;
                json!({"kind":"cube_uv_sharing","uv_sharing":uv_sharing})
            },
            InspectBatchQuery::AssetHandoff { texture_uuid, offset, limit } => {
                let handoff = inspect_bedrock_asset_handoff_page(
                    doc, batch_id(&texture_uuid)?,
                    offset.unwrap_or(0), limit.unwrap_or(16))?;
                json!({"kind":"asset_handoff","handoff":handoff})
            },
            InspectBatchQuery::ModelTextureCoverage { offset, limit, attention_only } => {
                let (offset, limit, only) = (
                    offset.unwrap_or(0), limit.unwrap_or(4),
                    attention_only.unwrap_or(false),
                );
                let coverage = match validated {
                    Some(view) => view.model_texture_coverage(offset, limit, only)?,
                    None => inspect_model_texture_coverage_filtered(doc, offset, limit, only)?,
                };
                json!({"kind":"model_texture_coverage","coverage":coverage})
            },
            InspectBatchQuery::MaterialPair {reference_uuid,candidate_uuid,
                reference_region,candidate_region} => {
                let comparison=inspect_material_pair(doc,
                    batch_id(&reference_uuid)?,batch_id(&candidate_uuid)?,
                    &reference_region,&candidate_region)?;
                json!({"kind":"material_pair","comparison":comparison})
            },
            InspectBatchQuery::MaterialFacePatch {texture_uuid,cube_uuid,
                face,region,face_spans} => {
                let binding=inspect_material_face_patch_with_spans(doc,
                    batch_id(&texture_uuid)?,batch_id(&cube_uuid)?,&face,
                    &region,face_spans.as_deref())?;
                json!({"kind":"material_face_patch","binding":binding})
            },
            InspectBatchQuery::TextureStyling {texture_uuid,region} => {
                let styling=inspect_texture_styling_region(
                    doc,batch_id(&texture_uuid)?,&region)?;
                json!({"kind":"texture_styling","styling":styling})
            },
            InspectBatchQuery::TextureSourceColors {texture_uuid,region,offset,limit} => {
                let colors=inspect_texture_source_colors_page(
                    doc,batch_id(&texture_uuid)?,&region,
                    offset.unwrap_or(0),limit.unwrap_or(16))?;
                json!({"kind":"texture_source_colors","colors":colors})
            },
            InspectBatchQuery::TextureStylingFace {texture_uuid,cube_uuid,face} => {
                let texture_uuid=batch_id(&texture_uuid)?;
                let cube_uuid=batch_id(&cube_uuid)?;
                let styling=match validated {
                    Some(view)=>view.texture_styling_face(texture_uuid,cube_uuid,&face)?,
                    None=>inspect_texture_styling_face(doc,texture_uuid,cube_uuid,&face)?,
                };
                json!({"kind":"texture_styling_face","styling":styling})
            },
            InspectBatchQuery::Catalog { category, offset, limit } => {
                let offset = offset.unwrap_or(0);
                let limit = limit.unwrap_or(32);
                if offset > 65_536 || limit == 0 || limit > 64 {
                    return Err(fail("INSPECT_BATCH_PAGE_INVALID"));
                }
                let catalog = inspect_catalog(doc, &category, offset, limit)?;
                json!({"kind":"catalog","catalog":catalog})
            },
            InspectBatchQuery::Texture { index } => {
                if index > 65_536 { return Err(fail("INSPECT_BATCH_INDEX_INVALID")); }
                let asset = inspect_asset(doc, "texture", &index.to_string())?;
                json!({"kind":"texture","asset":asset})
            },
            InspectBatchQuery::TextureAlpha { uuid } => {
                let uuid = batch_id(&uuid)?;
                let alpha = match validated {
                    Some(view) => view.texture_alpha(uuid)?,
                    None => inspect_paint_alpha(doc, uuid)?,
                };
                json!({"kind":"texture_alpha","alpha":alpha})
            },
            InspectBatchQuery::Animation { uuid } => {
                let asset = inspect_asset(doc, "animation", batch_id(&uuid)?)?;
                json!({"kind":"animation","asset":asset})
            },
            InspectBatchQuery::AnimationTrack {
                animation_uuid, bone_uuid, offset, limit,
            } => {
                let offset = offset.unwrap_or(0);
                let limit = limit.unwrap_or(32);
                if offset > 65_536 || limit == 0 || limit > 64 {
                    return Err(fail("INSPECT_BATCH_PAGE_INVALID"));
                }
                let track = inspect_rotation_track(
                    doc, batch_id(&animation_uuid)?, batch_id(&bone_uuid)?, offset, limit,
                )?;
                json!({"kind":"animation_track","track":track})
            },
            InspectBatchQuery::AnimationTransformTrack {
                animation_uuid, bone_uuid, channel, offset, limit,
            } => {
                let offset = offset.unwrap_or(0);
                let limit = limit.unwrap_or(32);
                if offset > 65_536 || limit == 0 || limit > 64 {
                    return Err(fail("INSPECT_BATCH_PAGE_INVALID"));
                }
                let track = inspect_transform_track(doc, batch_id(&animation_uuid)?,
                    batch_id(&bone_uuid)?, &channel, offset, limit)?;
                json!({"kind":"animation_transform_track","track":track})
            },
            InspectBatchQuery::AnimationEffectEvents {
                animation_uuid, offset, limit,
            } => {
                let effects=inspect_animation_effect_events(
                    doc,batch_id(&animation_uuid)?,offset.unwrap_or(0),limit.unwrap_or(16))?;
                json!({"kind":"animation_effect_events","effects":effects})
            },
            InspectBatchQuery::AnimationTimelineMarkers {
                animation_uuid, offset, limit,
            } => {
                let markers=inspect_animation_timeline_markers(
                    doc,batch_id(&animation_uuid)?,offset.unwrap_or(0),limit.unwrap_or(32))?;
                json!({"kind":"animation_timeline_markers","markers":markers})
            },
            InspectBatchQuery::Audit => {
                json!({"kind":"audit","audit":inspect_model_audit(doc)})
            },
        };
        results.push(entry);
    }
    if serde_json::to_vec(&results)
        .map_err(|_| fail("INSPECT_BATCH_SERIALIZE_FAILED"))?.len()
        > MAX_INSPECT_BATCH_RESULT_BYTES {
        return Err(fail("INSPECT_BATCH_RESULT_TOO_LARGE"));
    }
    Ok(results)
}

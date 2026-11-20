//! Immutable source-derived Desktop snapshot projection.
//! Only derives bounded WebView data and source keys from a frozen Rust session.
//! Tauri state, epoch/revision, write locks, history and publication remain
//! owned by desktop_authoring.rs. SOURCE_ONLY; TEST_AUTHORED_NOT_RUN.
use super::*;

// Read the same admitted numeric JSON vector directly; avoid allocating a
// temporary Value and deserializing every Cube/Bone on every GUI snapshot.
pub(super) fn borrowed_vec3(value: &Value) -> Option<[f64; 3]> {
    let elements = value.as_array()?;
    if elements.len() != 3 { return None; }
    let vec = [
        elements[0].as_f64()?, elements[1].as_f64()?, elements[2].as_f64()?,
    ];
    vec.iter().all(|axis| axis.is_finite()).then_some(vec)
}

pub(super) fn property_vec3(properties: &Map<String, Value>, key: &str) -> [f64; 3] {
    properties.get(key).and_then(borrowed_vec3).unwrap_or([0.0; 3])
}

pub(super) fn preview_source_key(epoch: u64, assets: &[Option<(&str, [u32; 2])>]) -> String {
    let mut digest = Sha256::new();
    digest.update(epoch.to_le_bytes());
    digest.update((assets.len() as u64).to_le_bytes());
    for asset in assets {
        match asset {
            None => digest.update([0u8]),
            Some((source, resolution)) => {
                digest.update([1u8]);
                digest.update((source.len() as u64).to_le_bytes());
                digest.update(source.as_bytes());
                digest.update(resolution[0].to_le_bytes());
                digest.update(resolution[1].to_le_bytes());
            }
        }
    }
    format!("{:x}", digest.finalize())
}

#[derive(Default, Clone, Copy)]
pub(super) struct ProjectionReuse<'a> {
    pub(super) preview: Option<&'a str>,
    pub(super) geometry: Option<&'a str>,
    pub(super) animation: Option<&'a str>,
}

// Serialize the exact read-only GUI projection into SHA-256 without another
// large JSON byte buffer. An unhashable projection is always sent in full.
struct ProjectionHashWriter<'a>(&'a mut Sha256);
impl Write for ProjectionHashWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}
pub(super) fn projection_source_key<T: Serialize>(epoch: u64, family: &[u8], item: &T) -> String {
    let mut hash = Sha256::new();
    hash.update(epoch.to_le_bytes());
    hash.update(family);
    if serde_json::to_writer(ProjectionHashWriter(&mut hash), item).is_err() {
        return String::new();
    }
    format!("{:x}", hash.finalize())
}

pub(super) fn freeze_projection(store: &EditorStore) -> Option<FrozenEditorProjection> {
    store.active.as_ref().map(|model| FrozenEditorProjection {
        document: model.session.snapshot_document(),
        epoch: store.epoch,
        revision: model.session.summary().revision,
        source_name: model.source_path.as_ref()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy().into_owned()),
        dirty: model.dirty,
        can_undo: model.session.can_undo(),
        can_redo: model.session.can_redo(),
    })
}

pub(super) fn project_frozen(
    model: &FrozenEditorProjection, reuse: ProjectionReuse<'_>,
) -> EditorSnapshot {
        let doc = model.document.as_ref();
        let default_box_uv = doc.meta.box_uv.unwrap_or(false);
        let uv_mode = preview_uv_mode(doc);
        let preview_assets = texture_preview_assets_in_mode(doc, uv_mode);
        let preview_source_key = preview_source_key(model.epoch, &preview_assets);
        let preview_sources_reused = reuse.preview == Some(preview_source_key.as_str());
        let (paint_editable_textures, paint_adoptable_textures,
             paint_exportable_textures) = paint_texture_snapshot_flags(doc);
        let scope_indices = (uv_mode == PreviewUvMode::ScopedAttachable)
            .then(|| texture_scope_indices(doc));
        let mut snapshot = EditorSnapshot {
            epoch: model.epoch,
            revision: model.revision,
            name: doc.extensions.get("name").and_then(Value::as_str)
                .unwrap_or("Untitled Model").to_owned(),
            source_name: model.source_name.clone(),
            dirty: model.dirty,
            can_undo: model.can_undo,
            can_redo: model.can_redo,
            cubes: doc.cubes.iter().map(|cube| CubeView {
                uuid: cube.uuid.clone(),
                name: cube.name.clone().unwrap_or_else(|| "cube".into()),
                from: cube.from,
                to: cube.to,
                origin: cube.origin.unwrap_or([0.0, 0.0, 0.0]),
                rotation: property_vec3(&cube.extra, "rotation"),
                inflate: cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0),
                stretch: cube.extra.get("stretch")
                    .and_then(borrowed_vec3).unwrap_or([1.0; 3]),
                visible: cube.extra.get("visibility").and_then(Value::as_bool).unwrap_or(true),
                // Blockbench's Cube preview controller maps behind/default/front to -1/0/1.
                render_order: match cube.extra.get("render_order").and_then(Value::as_str) {
                    Some("behind") => -1,
                    Some("in_front") => 1,
                    _ => 0,
                },
                box_uv: cube.extra.get("box_uv").and_then(Value::as_bool).unwrap_or(default_box_uv),
                uv_offset: cube.uv_offset.unwrap_or([0.0, 0.0]),
                // Validated as 0/1/2 by the single Rust authoring engine.
                auto_uv: cube.extra.get("autouv").and_then(Value::as_f64).unwrap_or(0.0) as u8,
                color: cube.extra.get("color").and_then(Value::as_u64).unwrap_or(0) as usize,
                faces: cube.faces.clone(),
                preview_texture_index: scoped_cube_texture_index(
                    scope_indices.as_ref(), cube, &preview_assets, uv_mode),
            }).collect(),
            bones: doc.bones.iter().map(|bone| BoneView {
                uuid: bone.uuid.clone(),
                name: bone.name.clone(),
                origin: bone.origin.unwrap_or([0.0, 0.0, 0.0]),
                rotation: property_vec3(&bone.extra, "rotation"),
                visible: bone.extra.get("visibility").and_then(Value::as_bool).unwrap_or(true),
            }).collect(),
            // Do not allocate the Outliner until the geometry reuse key is known.
            hierarchy: Vec::new(),
            geometry_source_key: String::new(),
            geometry_reused: false,
            texture_names: doc.texture_assets.iter().map(|texture| {
                texture.get("name").and_then(Value::as_str).unwrap_or("Unnamed texture").to_owned()
            }).collect(),
            texture_uuids: doc.texture_assets.iter().map(|texture|
                texture.get("uuid").and_then(Value::as_str).map(str::to_owned)
            ).collect(),
            texture_preview_sources: if preview_sources_reused { Vec::new() } else {
                preview_assets.iter().map(|asset|
                    asset.as_ref().map(|(source, _)| (*source).to_owned())).collect()
            },
            preview_source_key,
            preview_sources_reused,
            texture_preview_sides: doc.texture_assets.iter().map(texture_preview_side).collect(),
            texture_preview_resolutions: preview_assets.iter().map(|asset|
                asset.as_ref().map(|(_, resolution)| *resolution)).collect(),
            scoped_texture_preview: uv_mode == PreviewUvMode::ScopedAttachable,
            paint_editable_textures,
            paint_adoptable_textures,
            paint_exportable_textures,
            texture_resolution: [doc.resolution.width, doc.resolution.height],
            atlas_resolution_editable: can_set_empty_atlas_resolution(doc),
            paint_texture_addable: can_add_paint_texture(doc),
            animation_count: doc.animation_assets.len(),
            animations: animation_views(doc),
            animation_source_key: String::new(),
            animations_reused: false,
            preview_scope: "UNVERIFIED_EMBEDDED_PNG_SUBSET",
        };
        // These keys include all derived geometry/UV/scope and animation
        // data actually delivered to the WebView, not change hints.
        let geometry = projection_source_key(model.epoch, b"geometry",
            &(&snapshot.cubes, &snapshot.bones, doc.hierarchy.as_ref()));
        let animation = projection_source_key(model.epoch, b"animation",
            &(snapshot.animation_count, &snapshot.animations));
        snapshot.geometry_reused = !geometry.is_empty() &&
            reuse.geometry == Some(geometry.as_str());
        snapshot.animations_reused = !animation.is_empty() &&
            reuse.animation == Some(animation.as_str());
        snapshot.geometry_source_key = geometry;
        snapshot.animation_source_key = animation;
        if snapshot.geometry_reused {
            snapshot.cubes.clear();
            snapshot.bones.clear();
        } else {
            // Exact same serialized key as the previous wire projection, but
            // avoid cloning a potentially deep Outliner for omitted IPC data.
            snapshot.hierarchy = doc.hierarchy.as_ref().clone();
        }
        if snapshot.animations_reused { snapshot.animations.clear(); }
        snapshot
}

pub(super) fn project_with_preview_reuse(
    store: &EditorStore, known_preview_source_key: Option<&str>,
) -> Option<EditorSnapshot> {
    let frozen = freeze_projection(store)?;
    Some(project_frozen(&frozen, ProjectionReuse {
        preview: known_preview_source_key, ..ProjectionReuse::default()
    }))
}

#[cfg(test)]
pub(super) fn project(store: &EditorStore) -> Option<EditorSnapshot> {
    project_with_preview_reuse(store, None)
}

// Reads remain revision-consistent without retaining EditorStore's mutex
// while decoding/scanning embedded PNGs or projecting all geometry/animation.
pub(super) fn project_detached(
    guard: MutexGuard<'_, EditorStore>, reuse: ProjectionReuse<'_>,
) -> Option<EditorSnapshot> {
    let frozen = freeze_projection(&guard);
    drop(guard);
    frozen.as_ref().map(|source| project_frozen(source, reuse))
}

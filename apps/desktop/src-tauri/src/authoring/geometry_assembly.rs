//! G1: bounded, structure-first Rust Geometry assembly.
//! Converts explicitly named parts and exact Bone/Cube identities into the
//! existing EditPlan, without inferring dimensions, writing files or storing
//! a parallel model. SOURCE_ONLY; native/Blockbench tests NOT_EXECUTED.

use super::{
    fail, geometry, valid_bounds, valid_node_name, valid_uuid, Bone, Cube,
    EditOperation, EditPlan, EditorSession, Result, FACE_NAMES, MAX_OPERATIONS, MAX_PLAN_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use super::geometry_sweep::{self, GeometrySphereSweep};
use super::geometry_profile_sweep::{self, GeometryProfileSweep};
use super::geometry_axial::{self, GeometryAxialLoft, GeometryAxialRevolve};
use std::collections::HashSet;

/// The parent is an existing or simultaneously declared Bone UUID.
/// Bone pivots and Cube geometry are caller-authored source facts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryAssemblyPart {
    pub bone: Bone,
    pub parent_uuid: Option<String>,
    pub cubes: Vec<Cube>,
    /// Optional untextured blockout construction. Four disjoint panels per
    /// frame, compiled into the same AddCube operations as explicit parts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frames: Vec<GeometryRectangularFrame>,
    /// Optional five-panel untextured cavity; absent in prior G1/G3 requests.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hollow_boxes: Vec<GeometryHollowBox>,
    /// G3.2 structural arch blockouts; omitted by older G1/G3 callers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arches: Vec<GeometryArch>,
    /// Optional source-local, connected, variable-radius 3D voxel sweep.
    /// The transient derived UUIDs are not persisted as parametric metadata.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sweeps: Vec<GeometrySphereSweep>,
    /// G3.4b explicit profile and initial frame, native Cube voxel blockout.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub profile_sweeps: Vec<GeometryProfileSweep>,
    /// Bounded axis-aligned, source-authored loft and volume-of-revolution blockouts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lofts: Vec<GeometryAxialLoft>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub revolves: Vec<GeometryAxialRevolve>,
}

/// Source-authored through-opening. Axis is the normal to its opening;
/// left/right/bottom/top describe the two remaining axes in ascending order.
/// UUIDs are explicit: no hidden identity or persisted construction engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryRectangularFrame {
    pub name: String,
    pub center: [f64; 3],
    pub size: [u32; 3],
    pub normal_axis: String,
    pub border: u32,
    /// Stable panel UUIDs, in left/right/bottom/top order.
    pub cube_uuids: [String; 4],
}

/// True three-dimensional cavity with one open face. Five exact Cube IDs
/// correspond to wall_a_low, wall_a_high, wall_b_low, wall_b_high, back.
/// a and b are the remaining axes in ascending X/Y/Z order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryHollowBox {
    pub name: String,
    pub center: [f64; 3],
    pub size: [u32; 3],
    pub open_face: String,
    pub wall: u32,
    pub cube_uuids: [String; 5],
}

/// One vertical semicircular opening made from ordinary native Cubes.
/// The first two UUIDs own FULL-HEIGHT left/right piers; the remainder
/// own odd-count top segments, ordered along the horizontal span axis.
/// Explicit minimum 2-model-unit strips avoid per-voxel micro-steps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryArch {
    pub name: String,
    pub center: [f64; 3],
    pub size: [u32; 3],
    pub span_axis: String,
    pub wall: u32,
    pub rise: u32,
    pub cube_uuids: Vec<String>,
}

/// Conservative source-local stepped semicircle with real empty space.
/// Each curved strip starts at the HIGHEST underside point over its span:
/// the solid cannot intrude into the declared opening. This is not a mesh,
/// a spline engine, artist-approved smoothing or an inferred reference.
fn compile_arch(shape: &GeometryArch, bone_origin: [f64; 3]) -> Result<Vec<Cube>> {
    let span = match shape.span_axis.as_str() {
        "X" => 0, "Z" => 2,
        _ => return Err(fail("GEOMETRY_ARCH_AXIS_INVALID")),
    };
    if !valid_node_name(&shape.name) || shape.name.chars().count() > 110 {
        return Err(fail("GEOMETRY_ARCH_NAME_INVALID"));
    }
    if shape.size.iter().any(|n| !(1..=32).contains(n)) {
        return Err(fail("GEOMETRY_ARCH_SIZE_INVALID"));
    }
    if shape.wall == 0 || shape.wall > 16 || shape.rise == 0 ||
       shape.rise > 32 {
        return Err(fail("GEOMETRY_ARCH_DIMENSIONS_INVALID"));
    }
    let strips = shape.cube_uuids.len().checked_sub(2)
        .ok_or_else(|| fail("GEOMETRY_ARCH_COLUMNS_INVALID"))?;
    if strips < 3 || strips > 15 || strips % 2 == 0 {
        return Err(fail("GEOMETRY_ARCH_COLUMNS_INVALID"));
    }
    let size = shape.size.map(f64::from);
    let wall = f64::from(shape.wall);
    let rise = f64::from(shape.rise);
    let opening_width = size[span] - 2.0 * wall;
    // Source-first anti-overcube budget. Reject thin steps and too-small
    // springline/crown rather than inventing visually misleading Cubes.
    if opening_width <= 0.0 ||
       size[1] - wall - rise < 1.0 {
        return Err(fail("GEOMETRY_ARCH_OPENING_INVALID"));
    }
    if opening_width / strips as f64 < 2.0 {
        return Err(fail("GEOMETRY_ARCH_COLUMNS_TOO_NARROW"));
    }
    // The saved Bedrock Box UV net rounds face sizes to integer units.
    // Keep source column widths integral rather than silently distorting UV.
    if (shape.size[span] - 2 * shape.wall) % strips as u32 != 0 {
        return Err(fail("GEOMETRY_ARCH_COLUMNS_GRID_UNSUPPORTED"));
    }
    let low: [f64; 3] = std::array::from_fn(|i|
        shape.center[i] - size[i] / 2.0);
    let high: [f64; 3] = std::array::from_fn(|i|
        shape.center[i] + size[i] / 2.0);
    if !valid_bounds(low, high) {
        return Err(fail("GEOMETRY_ARCH_BOUNDS_INVALID"));
    }
    let inner_left = low[span] + wall;
    let inner_right = high[span] - wall;
    let half_opening = opening_width / 2.0;
    let springline = high[1] - wall - rise;
    let step = opening_width / strips as f64;
    let mut cubes = Vec::with_capacity(shape.cube_uuids.len());
    let (mut lowest_crown, mut highest_crown) =
        (f64::INFINITY, f64::NEG_INFINITY);
    for (index, (x0, x1, suffix)) in [
        (low[span], inner_left, "left_pier"),
        (inner_right, high[span], "right_pier"),
    ].into_iter().enumerate() {
        let mut from = low;
        let mut to = high;
        from[span] = x0;
        to[span] = x1;
        cubes.push(blockout_cube(&shape.cube_uuids[index],
            format!("{}_{}", shape.name, suffix), from, to, bone_origin));
    }
    for index in 0..strips {
        let x0 = inner_left + index as f64 * step;
        let x1 = if index + 1 == strips {
            inner_right
        } else {
            inner_left + (index + 1) as f64 * step
        };
        let center = shape.center[span];
        let closest = if x0 <= center && center <= x1 {
            0.0
        } else {
            (x0 - center).abs().min((x1 - center).abs())
        };
        let normalized = (closest / half_opening).clamp(0.0, 1.0);
        let sampled = springline + rise * (1.0 - normalized * normalized).sqrt();
        // Preserve a conservative opening while matching Bedrock's
        // integer-sized Box UV net. Quantize RELATIVE to the model bottom.
        let bottom = low[1] + (sampled - low[1]).ceil()
            .min(size[1] - wall);
        lowest_crown = lowest_crown.min(bottom);
        highest_crown = highest_crown.max(bottom);
        let mut from = low;
        let mut to = high;
        from[span] = x0;
        to[span] = x1;
        from[1] = bottom;
        cubes.push(blockout_cube(&shape.cube_uuids[index + 2],
            format!("{}_curve_{}", shape.name, index + 1),
            from, to, bone_origin));
    }
    if highest_crown - lowest_crown < 1.0 {
        return Err(fail("GEOMETRY_ARCH_CURVATURE_UNREPRESENTED"));
    }
    if cubes.iter().any(|cube| !valid_bounds(cube.from, cube.to) ||
        (0..3).any(|axis| cube.from[axis] >= cube.to[axis])) {
        return Err(fail("GEOMETRY_ARCH_PANEL_INVALID"));
    }
    Ok(cubes)
}

/// One ordinary, untextured Bedrock Cube source shape, shared by G3
/// primitives. Box UV is provisional; this does not allocate atlas space.
pub(super) fn blockout_cube(
    uuid: &str, name: String,
    from: [f64; 3], to: [f64; 3], bone_origin: [f64; 3],
) -> Cube {
    let mut faces = Map::new();
    for side in FACE_NAMES {
        faces.insert(side.into(), json!({"uv":[0,0,1,1]}));
    }
    let mut extra = Map::new();
    extra.insert("box_uv".into(), Value::Bool(true));
    Cube {
        uuid: uuid.to_owned(), kind: "cube".into(), name: Some(name),
        from, to, origin: Some(bone_origin), uv_offset: None, faces, extra,
    }
}

fn compile_hollow_box(
    shape: &GeometryHollowBox, bone_origin: [f64; 3],
) -> Result<[Cube; 5]> {
    let (normal, open_positive) = match shape.open_face.as_str() {
        "POS_X" => (0, true), "NEG_X" => (0, false),
        "POS_Y" => (1, true), "NEG_Y" => (1, false),
        "POS_Z" => (2, true), "NEG_Z" => (2, false),
        _ => return Err(fail("GEOMETRY_HOLLOW_FACE_INVALID")),
    };
    if !valid_node_name(&shape.name) || shape.name.chars().count() > 110 {
        return Err(fail("GEOMETRY_HOLLOW_NAME_INVALID"));
    }
    if shape.size.iter().any(|n| !(1..=32).contains(n)) {
        return Err(fail("GEOMETRY_HOLLOW_SIZE_INVALID"));
    }
    if !(1..=16).contains(&shape.wall) {
        return Err(fail("GEOMETRY_HOLLOW_WALL_INVALID"));
    }
    let [a, b] = match normal {
        0 => [1, 2], 1 => [0, 2], 2 => [0, 1], _ => unreachable!(),
    };
    let size = shape.size.map(f64::from);
    let wall = f64::from(shape.wall);
    if size[a] <= 2.0 * wall || size[b] <= 2.0 * wall ||
       size[normal] <= wall {
        return Err(fail("GEOMETRY_HOLLOW_CAVITY_REQUIRED"));
    }
    let low: [f64; 3] = std::array::from_fn(|i|
        shape.center[i] - size[i] / 2.0);
    let high: [f64; 3] = std::array::from_fn(|i|
        shape.center[i] + size[i] / 2.0);
    if !valid_bounds(low, high) {
        return Err(fail("GEOMETRY_HOLLOW_BOUNDS_INVALID"));
    }
    let (a_low, a_high) = (low[a] + wall, high[a] - wall);
    let (b_low, b_high) = (low[b] + wall, high[b] - wall);
    let make = |index: usize, suffix: &str,
                a_span: [f64; 2], b_span: [f64; 2],
                n_span: [f64; 2]| {
        let mut from = low;
        let mut to = high;
        from[a] = a_span[0]; to[a] = a_span[1];
        from[b] = b_span[0]; to[b] = b_span[1];
        from[normal] = n_span[0]; to[normal] = n_span[1];
        blockout_cube(&shape.cube_uuids[index],
            format!("{}_{}", shape.name, suffix), from, to, bone_origin)
    };
    let full_depth = [low[normal], high[normal]];
    let back = if open_positive {
        [low[normal], low[normal] + wall]
    } else {
        [high[normal] - wall, high[normal]]
    };
    let panels = [
        make(0, "wall_a_low", [low[a], a_low], [low[b], high[b]], full_depth),
        make(1, "wall_a_high", [a_high, high[a]], [low[b], high[b]], full_depth),
        make(2, "wall_b_low", [a_low, a_high], [low[b], b_low], full_depth),
        make(3, "wall_b_high", [a_low, a_high], [b_high, high[b]], full_depth),
        make(4, "back", [a_low, a_high], [b_low, b_high], back),
    ];
    if panels.iter().any(|cube| !valid_bounds(cube.from, cube.to) ||
        (0..3).any(|i| cube.to[i] <= cube.from[i])) {
        return Err(fail("GEOMETRY_HOLLOW_PANEL_INVALID"));
    }
    Ok(panels)
}

/// This geometry method is *untextured* blockout: Box UV metadata exists
/// for later explicit atlas layout, but no PNG, texture link or visual
/// evidence is created. A pre-existing textured project refuses the method.
fn compile_rectangular_frame(
    frame: &GeometryRectangularFrame, bone_origin: [f64; 3],
) -> Result<[Cube; 4]> {
    let normal = match frame.normal_axis.as_str() {
        "X" => 0, "Y" => 1, "Z" => 2,
        _ => return Err(fail("GEOMETRY_FRAME_AXIS_INVALID")),
    };
    let [a, b] = match normal {
        0 => [1, 2], 1 => [0, 2], 2 => [0, 1], _ => unreachable!(),
    };
    if !valid_node_name(&frame.name) || frame.name.chars().count() > 120 {
        return Err(fail("GEOMETRY_FRAME_NAME_INVALID"));
    }
    let size = frame.size.map(f64::from);
    let border = f64::from(frame.border);
    if frame.size.iter().any(|n| !(1..=32).contains(n)) ||
       !(1..=16).contains(&frame.border) ||
       size[a] <= 2.0 * border || size[b] <= 2.0 * border {
        return Err(fail("GEOMETRY_FRAME_OPENING_INVALID"));
    }
    let low = std::array::from_fn(|i| frame.center[i] - size[i] / 2.0);
    let high = std::array::from_fn(|i| frame.center[i] + size[i] / 2.0);
    if !valid_bounds(low, high) {
        return Err(fail("GEOMETRY_FRAME_BOUNDS_INVALID"));
    }
    let make_panel = |index: usize, name: &str,
                      along_a: [f64; 2], along_b: [f64; 2]| {
        let mut from = low;
        let mut to = high;
        from[a] = along_a[0]; to[a] = along_a[1];
        from[b] = along_b[0]; to[b] = along_b[1];
        blockout_cube(&frame.cube_uuids[index],
            format!("{}_{}", frame.name, name), from, to, bone_origin)
    };
    let result = [
        make_panel(0, "left", [low[a], low[a] + border], [low[b], high[b]]),
        make_panel(1, "right", [high[a] - border, high[a]], [low[b], high[b]]),
        make_panel(2, "bottom", [low[a] + border, high[a] - border], [low[b], low[b] + border]),
        make_panel(3, "top", [low[a] + border, high[a] - border], [high[b] - border, high[b]]),
    ];
    if result.iter().any(|cube| !valid_bounds(cube.from, cube.to) ||
       (0..3).any(|i| cube.from[i] >= cube.to[i])) {
        return Err(fail("GEOMETRY_FRAME_PANEL_INVALID"));
    }
    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryAssemblyRequest {
    pub expected_revision: u64,
    pub parts: Vec<GeometryAssemblyPart>,
}

/// A disposable Rust preflight, not permission, export or visual acceptance.
#[derive(Debug, Clone, Serialize)]
pub struct GeometryAssemblyProposal {
    pub plan: EditPlan,
    pub preflight: Value,
}

pub(super) fn compile(
    session: &EditorSession, request: &GeometryAssemblyRequest,
) -> Result<GeometryAssemblyProposal> {
    session.check_revision(request.expected_revision)?;
    if serde_json::to_vec(request)
        .map_err(|_| fail("GEOMETRY_ASSEMBLY_INPUT_INVALID"))?.len() > MAX_PLAN_BYTES {
        return Err(fail("GEOMETRY_ASSEMBLY_INPUT_TOO_LARGE"));
    }
    if request.parts.is_empty() || request.parts.len() > MAX_OPERATIONS {
        return Err(fail("GEOMETRY_ASSEMBLY_PART_COUNT_INVALID"));
    }

    let doc = session.document();
    let mut used_ids: HashSet<&str> = doc.cubes.iter()
        .map(|cube| cube.uuid.as_str())
        .chain(doc.bones.iter().map(|bone| bone.uuid.as_str()))
        .chain(doc.texture_assets.iter().chain(doc.animation_assets.iter())
            .filter_map(|asset| asset.get("uuid").and_then(Value::as_str)))
        .collect();
    let existing_bones: HashSet<&str> = doc.bones.iter()
        .map(|bone| bone.uuid.as_str()).collect();
    let mut new_bones: HashSet<&str> = HashSet::new();
    let mut used_names: HashSet<String> = doc.bones.iter()
        .map(|bone| bone.name.to_ascii_lowercase()).collect();
    let mut count = 0usize;
    // Only generated Sphere/Profile Sweep IDs need owned storage: explicit
    // IDs borrow from the admitted request/document. Check both ID sets.
    let mut generated_ids: HashSet<String> = HashSet::new();
    let mut generated: Vec<Vec<Cube>> = Vec::with_capacity(request.parts.len());
    for part in &request.parts {
        if !valid_uuid(&part.bone.uuid) ||
           generated_ids.contains(&part.bone.uuid) ||
           !used_ids.insert(part.bone.uuid.as_str()) {
            return Err(fail("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
        }
        if !geometry::valid_bone_name(&part.bone.name) ||
           !used_names.insert(part.bone.name.to_ascii_lowercase()) {
            return Err(fail("GEOMETRY_ASSEMBLY_BONE_NAME_INVALID"));
        }
        if part.bone.origin.is_none() {
            return Err(fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"));
        }
        new_bones.insert(part.bone.uuid.as_str());
        // Admit the entire bounded operation count *before* constructing
        // any panels. Never allocate a large transient shape on bad input.
        let additions = part.frames.len().checked_mul(4)
            .and_then(|frames| part.hollow_boxes.len().checked_mul(5)
                .and_then(|hollows| frames.checked_add(hollows)))
            .and_then(|panels| part.arches.iter()
                .try_fold(panels, |count, arch|
                    count.checked_add(arch.cube_uuids.len())))
            .and_then(|panels| panels.checked_add(part.sweeps.len()))
            .and_then(|panels| panels.checked_add(part.profile_sweeps.len()))
            .and_then(|panels| panels.checked_add(part.lofts.len()))
            .and_then(|panels| panels.checked_add(part.revolves.len()))
            .and_then(|panels| 1usize.checked_add(part.cubes.len())?
                .checked_add(panels))
            .ok_or_else(|| fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"))?;
        count = count.checked_add(additions)
            .ok_or_else(|| fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"))?;
        if count > MAX_OPERATIONS {
            return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
        }
        if !doc.texture_assets.is_empty() {
            if !part.frames.is_empty() {
                return Err(fail("GEOMETRY_FRAME_TEXTURED_PROJECT_UNSUPPORTED"));
            }
            if !part.hollow_boxes.is_empty() {
                return Err(fail("GEOMETRY_HOLLOW_TEXTURED_PROJECT_UNSUPPORTED"));
            }
            if !part.arches.is_empty() {
                return Err(fail("GEOMETRY_ARCH_TEXTURED_PROJECT_UNSUPPORTED"));
            }
            if !part.sweeps.is_empty() {
                return Err(fail("GEOMETRY_SWEEP_TEXTURED_PROJECT_UNSUPPORTED"));
            }
            if !part.profile_sweeps.is_empty() {
                return Err(fail("GEOMETRY_PROFILE_TEXTURED_PROJECT_UNSUPPORTED"));
            }
            if !part.lofts.is_empty() || !part.revolves.is_empty() {
                return Err(fail("GEOMETRY_AXIAL_TEXTURED_PROJECT_UNSUPPORTED"));
            }
        }
        let mut panels = Vec::with_capacity(additions - 1 - part.cubes.len());
        for frame in &part.frames {
            // The Bone pivot is caller supplied and validated above.
            panels.extend(compile_rectangular_frame(
                frame, part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?,
            )?);
        }
        for hollow in &part.hollow_boxes {
            panels.extend(compile_hollow_box(hollow,
                part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?)?);
        }
        for arch in &part.arches {
            panels.extend(compile_arch(arch,
                part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?)?);
        }
        let explicit_panels = panels.len();
        // The operation count above reserves one Cube per generated sweep.
        // Replace each reservation with the exact bounded partition count.
        if part.sweeps.len() > 4 {
            return Err(fail("GEOMETRY_SWEEP_COUNT_INVALID"));
        }
        for sweep in &part.sweeps {
            let remaining = MAX_OPERATIONS - count + 1;
            let cubes = geometry_sweep::compile(sweep,
                part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?,
                remaining)?;
            count = count.checked_add(cubes.len() - 1)
                .ok_or_else(|| fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"))?;
            if count > MAX_OPERATIONS {
                return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
            }
            panels.extend(cubes);
        }
        let profile_start = panels.len();
        if part.profile_sweeps.len() > 4 {
            return Err(fail("GEOMETRY_PROFILE_COUNT_INVALID"));
        }
        for profile in &part.profile_sweeps {
            // Reserve one Cube per profile above; grow only within the
            // already verified shared 128-operation G1 budget.
            let remaining = MAX_OPERATIONS - count + 1;
            let cubes = geometry_profile_sweep::compile(profile,
                part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?,
                remaining)?;
            count = count.checked_add(cubes.len() - 1)
                .ok_or_else(|| fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"))?;
            if count > MAX_OPERATIONS {
                return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
            }
            panels.extend(cubes);
        }
        let loft_start = panels.len();
        if part.lofts.len() > 4 || part.revolves.len() > 4 {
            return Err(fail("GEOMETRY_AXIAL_COUNT_INVALID"));
        }
        for loft in &part.lofts {
            let remaining = MAX_OPERATIONS - count + 1;
            let cubes = geometry_axial::compile_loft(loft,
                part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?, remaining)?;
            count = count.checked_add(cubes.len() - 1)
                .ok_or_else(|| fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"))?;
            if count > MAX_OPERATIONS {
                return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
            }
            panels.extend(cubes);
        }
        let revolve_start = panels.len();
        for revolve in &part.revolves {
            let remaining = MAX_OPERATIONS - count + 1;
            let cubes = geometry_axial::compile_revolve(revolve,
                part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?, remaining)?;
            count = count.checked_add(cubes.len() - 1)
                .ok_or_else(|| fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"))?;
            if count > MAX_OPERATIONS {
                return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
            }
            panels.extend(cubes);
        }
        // Bind UUID membership to the source request, not temporary Cubes.
        // These IDs outlive the generated operation buffer and preflight.
        for uuid in part.cubes.iter().map(|cube| cube.uuid.as_str())
            .chain(part.frames.iter().flat_map(|frame|
                frame.cube_uuids.iter().map(String::as_str)))
            .chain(part.hollow_boxes.iter().flat_map(|hollow|
                hollow.cube_uuids.iter().map(String::as_str)))
            .chain(part.arches.iter().flat_map(|arch|
                arch.cube_uuids.iter().map(String::as_str))) {
            if !valid_uuid(uuid) ||
               generated_ids.contains(uuid) || !used_ids.insert(uuid) {
                return Err(fail("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
            }
        }
        for cube in panels.iter().skip(explicit_panels) {
            if used_ids.contains(cube.uuid.as_str()) ||
               !generated_ids.insert(cube.uuid.clone()) {
                return Err(fail("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
            }
        }
        if part.cubes.iter().chain(panels.iter())
            .any(|cube| !cube.name.as_deref().is_some_and(valid_node_name)) {
            return Err(fail("GEOMETRY_ASSEMBLY_CUBE_NAME_REQUIRED"));
        }
        for (index, cube) in panels.iter().enumerate() {
            // Box UV is provisional. Refuse a shape whose individual Cube
            // net cannot fit even once; actual island packing is still
            // a separate explicit Texture/UV decision.
            let dims: [f64; 3] = std::array::from_fn(|i|
                cube.to[i] - cube.from[i]);
            if 2.0 * (dims[0] + dims[2]) > f64::from(doc.resolution.width) ||
               dims[1] + dims[2] > f64::from(doc.resolution.height) {
                let code = if index < part.frames.len() * 4 {
                    "GEOMETRY_FRAME_UV_ATLAS_TOO_SMALL"
                } else if index < part.frames.len() * 4 +
                    part.hollow_boxes.len() * 5 {
                    "GEOMETRY_HOLLOW_UV_ATLAS_TOO_SMALL"
                } else if index < explicit_panels {
                    "GEOMETRY_ARCH_UV_ATLAS_TOO_SMALL"
                } else if index < profile_start {
                    "GEOMETRY_SWEEP_UV_ATLAS_TOO_SMALL"
                } else if index < loft_start {
                    "GEOMETRY_PROFILE_UV_ATLAS_TOO_SMALL"
                } else if index < revolve_start {
                    "GEOMETRY_LOFT_UV_ATLAS_TOO_SMALL"
                } else { "GEOMETRY_REVOLVE_UV_ATLAS_TOO_SMALL" };
                return Err(fail(code));
            }
        }
        generated.push(panels);
    }
    for part in &request.parts {
        if let Some(parent) = &part.parent_uuid {
            if !valid_uuid(parent) ||
               (!existing_bones.contains(parent.as_str()) &&
                !new_bones.contains(parent.as_str())) {
                return Err(fail("GEOMETRY_ASSEMBLY_PARENT_UNKNOWN"));
            }
        }
    }

    // Dependency order is stable: the earliest currently eligible part
    // retains its input order. Never resolve an ambiguous label as a parent.
    let mut completed = existing_bones;
    let mut scheduled = vec![false; request.parts.len()];
    let mut operations = Vec::with_capacity(count);
    let mut remaining = request.parts.len();
    while remaining > 0 {
        let mut progress = false;
        for (index, part) in request.parts.iter().enumerate() {
            if scheduled[index] ||
               !part.parent_uuid.as_ref().is_none_or(|parent|
                   completed.contains(parent.as_str())) {
                continue;
            }
            operations.push(EditOperation::AddBone {
                bone: part.bone.clone(), parent_uuid: part.parent_uuid.clone(),
            });
            for cube in part.cubes.iter().chain(generated[index].iter()) {
                operations.push(EditOperation::AddCube {
                    cube: cube.clone(), bone_uuid: part.bone.uuid.clone(),
                });
            }
            completed.insert(part.bone.uuid.as_str());
            scheduled[index] = true;
            remaining -= 1;
            progress = true;
        }
        if !progress { return Err(fail("GEOMETRY_ASSEMBLY_PARENT_CYCLE")); }
    }
    let plan = EditPlan {
        expected_revision: request.expected_revision,
        operations,
        correction_scope: None,
    };
    if serde_json::to_vec(&plan)
        .map_err(|_| fail("GEOMETRY_ASSEMBLY_PLAN_INVALID"))?.len() > MAX_PLAN_BYTES {
        return Err(fail("GEOMETRY_ASSEMBLY_PLAN_TOO_LARGE"));
    }
    let preflight = session.preflight(&plan)?;
    Ok(GeometryAssemblyProposal { plan, preflight })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{sha256, AuthoringDocument};
    use serde_json::json;
    const SAMPLE: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const ROOT: &str = "00000000-0000-4000-8000-000000001101";
    const CHILD: &str = "00000000-0000-4000-8000-000000001102";
    const CUBE_A: &str = "00000000-0000-4000-8000-000000001103";
    const CUBE_B: &str = "00000000-0000-4000-8000-000000001104";

    fn part(bone_id: &str, name: &str, parent: Option<&str>, cube_id: &str) -> GeometryAssemblyPart {
        let bone: Bone = serde_json::from_value(json!({
            "uuid":bone_id,"name":name,"origin":[0.0,0.0,0.0]
        })).unwrap();
        let fixture: Value = serde_json::from_slice(SAMPLE).unwrap();
        let mut cube: Cube = serde_json::from_value(fixture["elements"][0].clone()).unwrap();
        cube.uuid = cube_id.into();
        cube.name = Some(format!("{name}_shape"));
        if bone_id == CHILD {
            cube.from = [4.0,0.0,0.0];
            cube.to = [8.0,4.0,4.0];
            cube.origin = Some([4.0,0.0,0.0]);
        }
        GeometryAssemblyPart {
            bone, parent_uuid: parent.map(str::to_owned), cubes: vec![cube],
            frames: Vec::new(), hollow_boxes: Vec::new(),
            arches: Vec::new(), sweeps: Vec::new(),
            profile_sweeps: Vec::new(), lofts: Vec::new(), revolves: Vec::new(),
        }
    }

    #[test]
    fn child_first_parts_become_one_parent_first_undoable_edit_plan() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("G1", "g1").unwrap()).unwrap();
        let before = session.document().clone();
        let input = GeometryAssemblyRequest {
            expected_revision:0,
            parts:vec![
                part(CHILD,"arm",Some(ROOT),CUBE_B),
                part(ROOT,"body",None,CUBE_A),
            ],
        };
        let proposal = compile(&session,&input).unwrap();
        let plan = proposal.plan;
        assert_eq!(plan.operations.len(),4);
        assert!(matches!(&plan.operations[0],EditOperation::AddBone{bone,..}
            if bone.uuid==ROOT));
        assert!(matches!(&plan.operations[1],EditOperation::AddCube{cube,bone_uuid}
            if cube.uuid==CUBE_A && bone_uuid==ROOT));
        assert!(matches!(&plan.operations[2],EditOperation::AddBone{bone,parent_uuid}
            if bone.uuid==CHILD && parent_uuid.as_deref()==Some(ROOT)));
        assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(proposal.preflight["visual_verdict"],"UNVERIFIED");
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());
        let receipt=session.apply(plan.expected_revision,&plan.operations).unwrap();
        assert_eq!(receipt.operation_count,4);
        assert_eq!(receipt.changed_uuids.len(),4);
        let after=session.document().clone();
        assert_eq!(after.bones.len(),2);
        assert_eq!(after.cubes.len(),2);
        let bbmodel=session.export().unwrap();
        assert_eq!(proposal.preflight["candidate_sha256"],sha256(&bbmodel));
        assert_eq!(EditorSession::open(&bbmodel).unwrap().document(),&after);
        assert!(super::super::geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(2).unwrap();
        assert_eq!(session.document(),&after);
    }

    #[test]
    fn existing_bone_parent_is_preserved_and_compilation_has_no_side_effect() {
        let session=EditorSession::open(SAMPLE).unwrap();
        let before=session.document().clone();
        let parent=before.bones[0].uuid.clone();
        let request=GeometryAssemblyRequest {
            expected_revision:0,
            parts:vec![part(CHILD,"attachment",Some(&parent),CUBE_B)],
        };
        let proposal=compile(&session,&request).unwrap();
        assert!(matches!(&proposal.plan.operations[0],
            EditOperation::AddBone{parent_uuid,..}
            if parent_uuid.as_deref()==Some(parent.as_str())));
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());
    }

    #[test]
    fn incorrect_parent_cycle_duplicate_and_stale_refuse_without_mutation() {
        let session=EditorSession::open(SAMPLE).unwrap();
        let before=session.document().clone();
        let invalid=[
            (GeometryAssemblyRequest {expected_revision:0,parts:vec![
                part(ROOT,"one",Some("missing-parent"),CUBE_A),
            ]},"GEOMETRY_ASSEMBLY_PARENT_UNKNOWN"),
            (GeometryAssemblyRequest {expected_revision:0,parts:vec![
                part(ROOT,"one",Some(CHILD),CUBE_A),
                part(CHILD,"two",Some(ROOT),CUBE_B),
            ]},"GEOMETRY_ASSEMBLY_PARENT_CYCLE"),
            (GeometryAssemblyRequest {expected_revision:0,parts:vec![
                part(ROOT,"one",None,CUBE_A),
                part(CHILD,"two",None,CUBE_A),
            ]},"GEOMETRY_ASSEMBLY_UUID_CONFLICT"),
            (GeometryAssemblyRequest {expected_revision:1,parts:vec![
                part(ROOT,"one",None,CUBE_A),
            ]},"DOCUMENT_REVISION_STALE"),
        ];
        for (req,error) in invalid {
            assert_eq!(compile(&session,&req).err().as_deref(),Some(error));
            assert_eq!(session.document(),&before);
            assert!(!session.can_undo());
        }
        let mut pivotless=part(ROOT,"one",None,CUBE_A);
        pivotless.bone.origin=None;
        assert_eq!(compile(&session,&GeometryAssemblyRequest {
            expected_revision:0,parts:vec![pivotless]
        }).err().as_deref(),Some("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"));
        let mut nameless=part(ROOT,"one",None,CUBE_A);
        nameless.cubes[0].name=None;
        assert_eq!(compile(&session,&GeometryAssemblyRequest {
            expected_revision:0,parts:vec![nameless]
        }).err().as_deref(),Some("GEOMETRY_ASSEMBLY_CUBE_NAME_REQUIRED"));
        let mut invalid_uv=part(ROOT,"one",None,CUBE_A);
        invalid_uv.cubes[0].faces.get_mut("north").unwrap()["uv"] =
            json!([-200_000.0,0,1,1]);
        assert_eq!(compile(&session,&GeometryAssemblyRequest {
            expected_revision:0,parts:vec![invalid_uv]
        }).err().as_deref(),Some("CUBE_FACE_UV_INVALID"));
        assert_eq!(session.document(),&before);
        assert!(serde_json::from_value::<GeometryAssemblyRequest>(json!({
            "expected_revision":0,"parts":[],"unknown_field":true
        })).is_err());
    }

    const FRAME_IDS: [&str; 4] = [
        "00000000-0000-4000-8000-000000001111",
        "00000000-0000-4000-8000-000000001112",
        "00000000-0000-4000-8000-000000001113",
        "00000000-0000-4000-8000-000000001114",
    ];

    fn frame_request() -> GeometryAssemblyRequest {
        let mut body = part(ROOT, "portal_bone", None, CUBE_A);
        body.cubes.clear();
        body.frames.push(GeometryRectangularFrame {
            name: "portal".into(),
            center: [0.0, 0.0, 0.0],
            size: [10, 8, 2],
            normal_axis: "Z".into(),
            border: 1,
            cube_uuids: FRAME_IDS.map(str::to_owned),
        });
        GeometryAssemblyRequest { expected_revision: 0, parts: vec![body] }
    }

    #[test]
    fn untextured_frame_builds_four_disjoint_panels_and_real_through_opening() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Frame", "frame").unwrap()
        ).unwrap();
        let before = session.document().clone();
        let request = frame_request();
        let plan = compile(&session, &request).unwrap();
        assert_eq!(plan.plan.operations.len(), 5);
        assert_eq!(plan.preflight["status"], "VALIDATED_NOT_APPLIED");
        assert_eq!(plan.preflight["write_authority"], "NOT_GRANTED");
        assert_eq!(session.document(), &before);
        assert!(!session.can_undo());

        let expected = [
            ([-5.0, -4.0, -1.0], [-4.0, 4.0, 1.0]),
            ([4.0, -4.0, -1.0], [5.0, 4.0, 1.0]),
            ([-4.0, -4.0, -1.0], [4.0, -3.0, 1.0]),
            ([-4.0, 3.0, -1.0], [4.0, 4.0, 1.0]),
        ];
        let mut volume = 0.0;
        for (index, &(from, to)) in expected.iter().enumerate() {
            match &plan.plan.operations[index + 1] {
                EditOperation::AddCube { cube, bone_uuid } => {
                    assert_eq!(bone_uuid, ROOT);
                    assert_eq!(cube.uuid, FRAME_IDS[index]);
                    assert_eq!((cube.from, cube.to), (from, to));
                    assert_eq!(cube.name.as_deref(), Some(
                        ["portal_left","portal_right","portal_bottom","portal_top"][index]
                    ));
                    assert_eq!(cube.extra.get("box_uv"), Some(&Value::Bool(true)));
                    assert!(cube.faces.values().all(|f| f.get("texture").is_none()));
                    volume += (to[0] - from[0]) * (to[1] - from[1]) *
                        (to[2] - from[2]);
                }
                _ => panic!("Expected generated AddCube"),
            }
        }
        assert_eq!(volume, 64.0); // outer volume 160 minus hole volume 96
        for i in 0..4 {
            for j in (i + 1)..4 {
                assert!((0..3).any(|axis|
                    expected[i].1[axis].min(expected[j].1[axis]) <=
                    expected[i].0[axis].max(expected[j].0[axis])
                ));
            }
        }
        // The entire axis-normal tunnel is genuinely empty, not painted.
        assert!(expected.iter().all(|(from, to)| !(0..3).all(|axis|
            from[axis] < 0.0 && 0.0 < to[axis]
        )));
        session.apply(0, &plan.plan.operations).unwrap();
        let after = session.document().clone();
        assert_eq!(after.cubes.len(), 4);
        let saved = session.export().unwrap();
        assert_eq!(plan.preflight["candidate_sha256"], sha256(&saved));
        assert_eq!(EditorSession::open(&saved).unwrap().document(), &after);
        assert!(geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(), &before);
        session.redo(2).unwrap();
        assert_eq!(session.document(), &after);
    }

    #[test]
    fn frame_through_opening_is_axis_agnostic_with_bone_pivot_retained() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Frame", "frame").unwrap()
        ).unwrap();
        for axis in ["X", "Y", "Z"] {
            let mut request = frame_request();
            let frame = &mut request.parts[0].frames[0];
            frame.normal_axis = axis.into();
            frame.size = [8, 8, 8];
            frame.center = [2.0, 3.0, 4.0];
            let normal = match axis { "X" => 0, "Y" => 1, _ => 2 };
            let plan = compile(&session, &request).unwrap();
            assert_eq!(plan.plan.operations.len(), 5);
            for operation in &plan.plan.operations[1..] {
                let EditOperation::AddCube { cube, .. } = operation
                    else { panic!("Expected one panel per Cube"); };
                assert_eq!(cube.origin, Some([0.0, 0.0, 0.0]));
                assert_eq!(cube.from[normal], frame.center[normal] - 4.0);
                assert_eq!(cube.to[normal], frame.center[normal] + 4.0);
                // At the tunnel center, every panel has at least one
                // tangential axis outside the point (the hole is open).
                assert!((0..3).any(|i|
                    i != normal && (frame.center[i] <= cube.from[i] ||
                        frame.center[i] >= cube.to[i])
                ));
            }
            assert_eq!(plan.preflight["write_authority"], "NOT_GRANTED");
        }
    }

    #[test]
    fn frame_refuses_bad_axis_opening_bounds_duplicate_and_unsafe_atlas() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Frame", "frame").unwrap()
        ).unwrap();
        let before = session.document().clone();
        for (change, code) in [
            (0, "GEOMETRY_FRAME_AXIS_INVALID"),
            (1, "GEOMETRY_FRAME_OPENING_INVALID"),
            (2, "GEOMETRY_FRAME_BOUNDS_INVALID"),
            (3, "GEOMETRY_ASSEMBLY_UUID_CONFLICT"),
        ] {
            let mut request = frame_request();
            let frame = &mut request.parts[0].frames[0];
            match change {
                0 => frame.normal_axis = "Q".into(),
                1 => frame.border = 4,
                2 => frame.center = [100_000.0, 0.0, 0.0],
                3 => frame.cube_uuids[1] = frame.cube_uuids[0].clone(),
                _ => unreachable!(),
            }
            assert_eq!(compile(&session, &request).err().as_deref(), Some(code));
        }
        assert_eq!(session.document(), &before);
        assert!(!session.can_undo());

        // An otherwise valid but oversized declaration must be refused
        // before allocating or compiling its 4 * 32 panel Cubes.
        let mut oversized = frame_request();
        let one_frame = oversized.parts[0].frames[0].clone();
        oversized.parts[0].frames = vec![one_frame; 32];
        assert_eq!(compile(&session, &oversized).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));

        let mut small_atlas = session.clone();
        small_atlas.apply(0, &[EditOperation::SetEmptyAtlasResolution {
            width: 4, height: 4,
        }]).unwrap();
        assert_eq!(compile(&small_atlas, &GeometryAssemblyRequest {
            expected_revision: 1, ..frame_request()
        }).err().as_deref(), Some("GEOMETRY_FRAME_UV_ATLAS_TOO_SMALL"));

        let mut textured = session.clone();
        textured.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: "00000000-0000-4000-8000-000000001115".into(),
            name: "atlas".into(),
        }]).unwrap();
        assert_eq!(compile(&textured, &GeometryAssemblyRequest {
            expected_revision: 1, ..frame_request()
        }).err().as_deref(), Some("GEOMETRY_FRAME_TEXTURED_PROJECT_UNSUPPORTED"));
        assert_eq!(compile(&session, &GeometryAssemblyRequest {
            expected_revision: 1, ..frame_request()
        }).err().as_deref(), Some("DOCUMENT_REVISION_STALE"));
        assert!(serde_json::from_value::<GeometryRectangularFrame>(json!({
            "name": "frame", "center": [0,0,0], "size": [10,8,2],
            "normal_axis": "Z", "border": 1,
            "cube_uuids": FRAME_IDS, "unknown": true
        })).is_err());
        let empty = part(ROOT,"body",None,CUBE_A);
        assert!(serde_json::to_value(empty).unwrap().get("frames").is_none());
    }


    const HOLLOW_IDS: [&str; 5] = [
        "00000000-0000-4000-8000-000000001121",
        "00000000-0000-4000-8000-000000001122",
        "00000000-0000-4000-8000-000000001123",
        "00000000-0000-4000-8000-000000001124",
        "00000000-0000-4000-8000-000000001125",
    ];

    fn hollow_request() -> GeometryAssemblyRequest {
        let mut part = part(ROOT, "container_bone", None, CUBE_A);
        part.cubes.clear();
        part.hollow_boxes.push(GeometryHollowBox {
            name: "container".into(), center: [0.0; 3],
            size: [10, 8, 6], open_face: "POS_Z".into(), wall: 1,
            cube_uuids: HOLLOW_IDS.map(str::to_owned),
        });
        GeometryAssemblyRequest { expected_revision: 0, parts: vec![part] }
    }

    #[test]
    fn hollow_box_generates_five_disjoint_panels_with_real_cavity_and_reversible_export() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Hollow", "hollow").unwrap()
        ).unwrap();
        let before = session.document().clone();
        let plan = compile(&session, &hollow_request()).unwrap();
        assert_eq!(plan.plan.operations.len(), 6);
        assert_eq!(plan.preflight["status"], "VALIDATED_NOT_APPLIED");
        assert_eq!(plan.preflight["write_authority"], "NOT_GRANTED");
        assert_eq!(session.document(), &before);
        assert!(!session.can_undo());

        // For POS_Z, X and Y retain full wall depth; only the final
        // interior-sized panel closes the -Z face.
        let expected = [
            ([-5.0,-4.0,-3.0],[-4.0,4.0,3.0]),
            ([4.0,-4.0,-3.0],[5.0,4.0,3.0]),
            ([-4.0,-4.0,-3.0],[4.0,-3.0,3.0]),
            ([-4.0,3.0,-3.0],[4.0,4.0,3.0]),
            ([-4.0,-3.0,-3.0],[4.0,3.0,-2.0]),
        ];
        let mut volume = 0.0;
        for (index, (from, to)) in expected.iter().enumerate() {
            let EditOperation::AddCube { cube, bone_uuid } =
                &plan.plan.operations[index + 1]
            else { panic!("Expected one AddCube per panel"); };
            assert_eq!(cube.uuid, HOLLOW_IDS[index]);
            assert_eq!(bone_uuid, ROOT);
            assert_eq!((&cube.from, &cube.to), (from, to));
            assert_eq!(cube.name.as_deref(), Some(
                ["container_wall_a_low", "container_wall_a_high",
                 "container_wall_b_low", "container_wall_b_high",
                 "container_back"][index]));
            assert_eq!(cube.extra.get("box_uv"), Some(&Value::Bool(true)));
            assert!(cube.faces.values().all(|face| face.get("texture").is_none()));
            assert_eq!(cube.origin, Some([0.0; 3]));
            volume += (0..3).map(|axis| to[axis] - from[axis]).product::<f64>();
            // Every panel misses a point in the open cavity.
            assert!(!(0..3).all(|axis|
                from[axis] <= [0.0, 0.0, 2.0][axis] &&
                [0.0, 0.0, 2.0][axis] < to[axis]));
        }
        assert_eq!(volume, 240.0); // 10*8*6 minus 8*6*5
        for i in 0..5 {
            for j in i+1..5 {
                assert!((0..3).any(|axis|
                    expected[i].1[axis].min(expected[j].1[axis]) <=
                    expected[i].0[axis].max(expected[j].0[axis])
                ));
            }
        }

        session.apply(0, &plan.plan.operations).unwrap();
        let after = session.document().clone();
        assert_eq!(after.cubes.len(), 5);
        let saved = session.export().unwrap();
        assert_eq!(plan.preflight["candidate_sha256"], sha256(&saved));
        assert_eq!(EditorSession::open(&saved).unwrap().document(), &after);
        assert!(geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(), &before);
        session.redo(2).unwrap();
        assert_eq!(session.document(), &after);
    }

    #[test]
    fn hollow_box_six_faces_keep_correct_back_and_open_cavity() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Hollow", "hollow").unwrap()
        ).unwrap();
        for (face, axis, positive) in [
            ("POS_X",0,true), ("NEG_X",0,false),
            ("POS_Y",1,true), ("NEG_Y",1,false),
            ("POS_Z",2,true), ("NEG_Z",2,false),
        ] {
            let mut req = hollow_request();
            req.parts[0].hollow_boxes[0].open_face = face.into();
            let proposal = compile(&session, &req).unwrap();
            assert_eq!(proposal.plan.operations.len(), 6);
            let panel = &proposal.plan.operations[5];
            let EditOperation::AddCube { cube: back, .. } = panel
            else { panic!("Expected back panel"); };
            let depth = f64::from(req.parts[0].hollow_boxes[0].size[axis]);
            assert_eq!(back.to[axis] - back.from[axis], 1.0);
            if positive {
                assert_eq!(back.from[axis], -depth / 2.0);
            } else {
                assert_eq!(back.to[axis], depth / 2.0);
            }
            let mut open_point = [0.0; 3];
            open_point[axis] = if positive {
                depth / 2.0 - 0.5
            } else {
                -depth / 2.0 + 0.5
            };
            for op in &proposal.plan.operations[1..] {
                let EditOperation::AddCube { cube, .. } = op
                else { panic!("Expected 5 Cubes"); };
                assert!(!(0..3).all(|i|
                    cube.from[i] <= open_point[i] &&
                    open_point[i] < cube.to[i]));
            }
            assert_eq!(proposal.preflight["write_authority"], "NOT_GRANTED");
        }
    }

    #[test]
    fn hollow_box_rejects_unsafe_inputs_before_applying_any_cube() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Hollow", "hollow").unwrap()
        ).unwrap();
        let before = session.document().clone();
        for (case, expected) in [
            (0,"GEOMETRY_HOLLOW_FACE_INVALID"),
            (1,"GEOMETRY_HOLLOW_SIZE_INVALID"),
            (2,"GEOMETRY_HOLLOW_WALL_INVALID"),
            (3,"GEOMETRY_HOLLOW_CAVITY_REQUIRED"),
            (4,"GEOMETRY_HOLLOW_BOUNDS_INVALID"),
            (5,"GEOMETRY_ASSEMBLY_UUID_CONFLICT"),
            (6,"GEOMETRY_HOLLOW_NAME_INVALID"),
        ] {
            let mut req = hollow_request();
            let hollow = &mut req.parts[0].hollow_boxes[0];
            match case {
                0 => hollow.open_face = "FRONT".into(),
                1 => hollow.size = [0,8,6],
                2 => hollow.wall = 0,
                3 => hollow.wall = 4,
                4 => hollow.center = [100_000.0,0.0,0.0],
                5 => hollow.cube_uuids[1] = hollow.cube_uuids[0].clone(),
                6 => hollow.name = "x".repeat(120),
                _ => unreachable!(),
            }
            assert_eq!(compile(&session, &req).err().as_deref(), Some(expected));
        }
        let mut cross = hollow_request();
        cross.parts[0].frames.push(GeometryRectangularFrame {
            name: "portal".into(), center: [0.0; 3], size: [10,8,2],
            normal_axis: "Z".into(), border: 1,
            cube_uuids: [HOLLOW_IDS[0], FRAME_IDS[1],
                FRAME_IDS[2], FRAME_IDS[3]].map(str::to_owned),
        });
        assert_eq!(compile(&session, &cross).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

        let mut oversized = hollow_request();
        let one = oversized.parts[0].hollow_boxes[0].clone();
        oversized.parts[0].hollow_boxes = vec![one; 26];
        assert_eq!(compile(&session, &oversized).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
        assert_eq!(session.document(), &before);
        assert!(!session.can_undo());

        let mut tiny = session.clone();
        tiny.apply(0, &[EditOperation::SetEmptyAtlasResolution {
            width: 4, height: 4,
        }]).unwrap();
        assert_eq!(compile(&tiny, &GeometryAssemblyRequest {
            expected_revision: 1, ..hollow_request()
        }).err().as_deref(), Some("GEOMETRY_HOLLOW_UV_ATLAS_TOO_SMALL"));

        let mut textured = session.clone();
        textured.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: "00000000-0000-4000-8000-000000001126".into(),
            name: "atlas".into(),
        }]).unwrap();
        assert_eq!(compile(&textured, &GeometryAssemblyRequest {
            expected_revision: 1, ..hollow_request()
        }).err().as_deref(), Some("GEOMETRY_HOLLOW_TEXTURED_PROJECT_UNSUPPORTED"));
        assert_eq!(compile(&session, &GeometryAssemblyRequest {
            expected_revision: 1, ..hollow_request()
        }).err().as_deref(), Some("DOCUMENT_REVISION_STALE"));
        let mut unknown = serde_json::to_value(
            &hollow_request().parts[0].hollow_boxes[0]).unwrap();
        unknown["unknown_field"] = json!(true);
        assert!(serde_json::from_value::<GeometryHollowBox>(unknown).is_err());
        let prior = part(ROOT, "legacy", None, CUBE_A);
        let json = serde_json::to_value(&prior).unwrap();
        assert!(json.get("frames").is_none());
        assert!(json.get("hollow_boxes").is_none());
    }


    const ARCH_IDS: [&str; 7] = [
        "00000000-0000-4000-8000-000000001131",
        "00000000-0000-4000-8000-000000001132",
        "00000000-0000-4000-8000-000000001133",
        "00000000-0000-4000-8000-000000001134",
        "00000000-0000-4000-8000-000000001135",
        "00000000-0000-4000-8000-000000001136",
        "00000000-0000-4000-8000-000000001137",
    ];

    fn arch_request() -> GeometryAssemblyRequest {
        let mut component = part(ROOT, "arch_bone", None, CUBE_A);
        component.cubes.clear();
        component.arches.push(GeometryArch {
            name: "doorway".into(),
            center: [0.0; 3],
            size: [19, 12, 4],
            span_axis: "X".into(),
            wall: 2,
            rise: 6,
            cube_uuids: ARCH_IDS.iter().map(|id| (*id).into()).collect(),
        });
        GeometryAssemblyRequest {
            expected_revision: 0, parts: vec![component],
        }
    }

    #[test]
    fn curved_arch_retains_grounded_piers_real_opening_and_one_reversible_edit_plan() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Curved", "curved").unwrap()
        ).unwrap();
        let before = session.document().clone();
        let plan = compile(&session, &arch_request()).unwrap();
        assert_eq!(plan.plan.operations.len(), 8);
        assert_eq!(plan.preflight["status"], "VALIDATED_NOT_APPLIED");
        assert_eq!(plan.preflight["write_authority"], "NOT_GRANTED");
        assert_eq!(plan.preflight["visual_verdict"], "UNVERIFIED");
        assert_eq!(session.document(), &before);
        assert!(!session.can_undo());

        let mut bounds = Vec::new();
        for (index, operation) in plan.plan.operations[1..].iter().enumerate() {
            let EditOperation::AddCube { cube, bone_uuid } = operation
                else { panic!("Expected an ordinary native Cube"); };
            assert_eq!(cube.uuid, ARCH_IDS[index]);
            assert_eq!(bone_uuid, ROOT);
            assert_eq!(cube.origin, Some([0.0; 3]));
            assert_eq!(cube.extra.get("box_uv"), Some(&Value::Bool(true)));
            assert!(cube.faces.values().all(|face|
                face.get("texture").is_none()));
            assert_eq!((cube.from[2],cube.to[2]),(-2.0,2.0));
            bounds.push((cube.from, cube.to));
        }
        // Full-height side piers are intentionally separate from arch strips.
        assert_eq!((bounds[0].0,bounds[0].1),
            ([-9.5,-6.0,-2.0],[-7.5,6.0,2.0]));
        assert_eq!((bounds[1].0,bounds[1].1),
            ([7.5,-6.0,-2.0],[9.5,6.0,2.0]));
        assert_eq!(bounds[4].0[0],-1.5);
        assert_eq!(bounds[4].1[0],1.5);
        assert_eq!(bounds[4].0[1],4.0); // center crown = top - wall
        assert!(bounds[2].0[1] < bounds[4].0[1]);
        assert!((bounds[2].0[1]-bounds[6].0[1]).abs()<1e-9);

        // Exactly disjoint volume, contiguous footprints, and an entirely
        // empty path through the opening below the underside center.
        for i in 0..bounds.len() {
            for j in i+1..bounds.len() {
                assert!((0..3).any(|axis|
                    bounds[i].1[axis].min(bounds[j].1[axis]) <=
                    bounds[i].0[axis].max(bounds[j].0[axis])));
            }
            assert!(!(0..3).all(|axis|
                bounds[i].0[axis] <= [0.0,3.0,0.0][axis] &&
                [0.0,3.0,0.0][axis] < bounds[i].1[axis]));
        }
        let receipt = session.apply(0, &plan.plan.operations).unwrap();
        assert_eq!(receipt.operation_count,8);
        let after = session.document().clone();
        assert_eq!(after.cubes.len(),7);
        let saved = session.export().unwrap();
        assert_eq!(plan.preflight["candidate_sha256"], sha256(&saved));
        assert_eq!(EditorSession::open(&saved).unwrap().document(), &after);
        assert!(geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(), &before);
        session.redo(2).unwrap();
        assert_eq!(session.document(), &after);
    }

    #[test]
    fn curved_arch_supports_x_and_z_spans_without_changing_bone_pivot() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Curved", "curved").unwrap()
        ).unwrap();
        for axis in ["X", "Z"] {
            let mut req = arch_request();
            let arch = &mut req.parts[0].arches[0];
            arch.span_axis = axis.into();
            arch.size = [19,12,19];
            arch.center = [1.0,2.0,3.0];
            let proposal = compile(&session,&req).unwrap();
            assert_eq!(proposal.plan.operations.len(),8);
            let span = if axis=="X" {0} else {2};
            let depth = if span==0 {2} else {0};
            for op in &proposal.plan.operations[1..] {
                let EditOperation::AddCube { cube, .. } = op
                    else { panic!("Expected Cube"); };
                assert_eq!(cube.from[depth],arch.center[depth]-9.0);
                assert_eq!(cube.to[depth],arch.center[depth]+9.0);
                assert_eq!(cube.origin,Some([0.0;3]));
            }
            assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
        }
    }

    #[test]
    fn curved_arch_refuses_micro_columns_invalid_openings_and_unsafe_sources() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Curved", "curved").unwrap()
        ).unwrap();
        let before = session.document().clone();
        for (case, code) in [
            (0,"GEOMETRY_ARCH_AXIS_INVALID"),
            (1,"GEOMETRY_ARCH_SIZE_INVALID"),
            (2,"GEOMETRY_ARCH_DIMENSIONS_INVALID"),
            (3,"GEOMETRY_ARCH_OPENING_INVALID"),
            (4,"GEOMETRY_ARCH_COLUMNS_INVALID"),
            (5,"GEOMETRY_ARCH_COLUMNS_TOO_NARROW"),
            (6,"GEOMETRY_ARCH_BOUNDS_INVALID"),
            (7,"GEOMETRY_ASSEMBLY_UUID_CONFLICT"),
            (8,"GEOMETRY_ARCH_NAME_INVALID"),
            (9,"GEOMETRY_ARCH_COLUMNS_GRID_UNSUPPORTED"),
            (10,"GEOMETRY_ARCH_CURVATURE_UNREPRESENTED"),
        ] {
            let mut req = arch_request();
            let arch=&mut req.parts[0].arches[0];
            match case {
                0 => arch.span_axis="Y".into(),
                1 => arch.size[0]=0,
                2 => arch.wall=0,
                3 => arch.rise=12,
                4 => { arch.cube_uuids.pop(); },
                5 => arch.size[0]=12,
                6 => arch.center=[100_000.0,0.0,0.0],
                7 => arch.cube_uuids[1]=arch.cube_uuids[0].clone(),
                8 => arch.name="x".repeat(120),
                9 => arch.size[0]=18,
                10 => arch.cube_uuids.truncate(5),
                _ => unreachable!(),
            }
            assert_eq!(compile(&session,&req).err().as_deref(),Some(code));
        }
        let mut cross = arch_request();
        cross.parts[0].hollow_boxes.push(GeometryHollowBox {
            name:"container".into(),center:[0.0;3],size:[10,8,6],
            open_face:"POS_Z".into(),wall:1,
            cube_uuids:[
                ARCH_IDS[0], HOLLOW_IDS[1], HOLLOW_IDS[2],
                HOLLOW_IDS[3], HOLLOW_IDS[4],
            ].map(str::to_owned),
        });
        assert_eq!(compile(&session,&cross).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

        let mut over_budget=arch_request();
        let one=over_budget.parts[0].arches[0].clone();
        over_budget.parts[0].arches=vec![one;19];
        assert_eq!(compile(&session,&over_budget).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());

        let mut tiny=session.clone();
        tiny.apply(0,&[EditOperation::SetEmptyAtlasResolution {
            width:4,height:4
        }]).unwrap();
        assert_eq!(compile(&tiny,&GeometryAssemblyRequest {
            expected_revision:1,..arch_request()
        }).err().as_deref(),Some("GEOMETRY_ARCH_UV_ATLAS_TOO_SMALL"));

        let mut textured=session.clone();
        textured.apply(0,&[EditOperation::CreatePaintTexture {
            uuid:"00000000-0000-4000-8000-000000001138".into(),
            name:"atlas".into(),
        }]).unwrap();
        assert_eq!(compile(&textured,&GeometryAssemblyRequest {
            expected_revision:1,..arch_request()
        }).err().as_deref(),Some("GEOMETRY_ARCH_TEXTURED_PROJECT_UNSUPPORTED"));
        assert_eq!(compile(&session,&GeometryAssemblyRequest {
            expected_revision:1,..arch_request()
        }).err().as_deref(),Some("DOCUMENT_REVISION_STALE"));

        let mut unknown=serde_json::to_value(
            &arch_request().parts[0].arches[0]).unwrap();
        unknown["unrecognized"]=json!(true);
        assert!(serde_json::from_value::<GeometryArch>(unknown).is_err());
        let existing=serde_json::to_value(part(ROOT,"legacy",None,CUBE_A)).unwrap();
        assert!(existing.get("frames").is_none());
        assert!(existing.get("hollow_boxes").is_none());
        assert!(existing.get("arches").is_none());
    }


    const SWEEP_SEED: &str = "00000000-0000-4000-8000-000000003501";
    fn sweep_request() -> GeometryAssemblyRequest {
        let mut part=part(ROOT,"sweep_bone",None,CUBE_A);
        part.cubes.clear();
        part.sweeps.push(GeometrySphereSweep {
            name:"branch".into(),
            uuid_seed:SWEEP_SEED.into(),
            stations:vec![
                super::super::geometry_sweep::GeometrySweepStation {
                    position:[-4,0,0],radius:2,
                },
                super::super::geometry_sweep::GeometrySweepStation {
                    position:[0,2,0],radius:3,
                },
                super::super::geometry_sweep::GeometrySweepStation {
                    position:[4,3,1],radius:2,
                },
            ],
            interpolation: None, max_chord_error: None,
        });
        GeometryAssemblyRequest{expected_revision:0,parts:vec![part]}
    }

    #[test]
    fn g33_sweep_uses_one_readonly_g1_plan_with_deterministic_cubes_and_reversible_export(){
        let mut session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Sweep","sweep").unwrap()
        ).unwrap();
        let before=session.document().clone();
        let proposed=compile(&session,&sweep_request()).unwrap();
        assert_eq!(proposed.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposed.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(proposed.preflight["visual_verdict"],"UNVERIFIED");
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());
        let count=proposed.plan.operations.len();
        assert!((3..=65).contains(&count)); // one Bone, bounded Cuboid partition
        for (i,op) in proposed.plan.operations[1..].iter().enumerate(){
            let EditOperation::AddCube {cube,bone_uuid}=op
                else {panic!("Sweep must produce only AddCube operations");};
            assert_eq!(bone_uuid,ROOT);
            assert_eq!(cube.uuid,super::super::geometry_sweep::cube_uuid(SWEEP_SEED,i));
            assert_eq!(cube.name.as_deref(),Some(format!("branch_v_{i}").as_str()));
            assert_eq!(cube.extra.get("box_uv"),Some(&Value::Bool(true)));
            assert!(cube.faces.values().all(|v|v.get("texture").is_none()));
            assert_eq!(cube.origin,Some([0.0;3]));
        }
        let committed=session.apply(0,&proposed.plan.operations).unwrap();
        assert_eq!(committed.operation_count,count);
        let after=session.document().clone();
        assert_eq!(after.cubes.len(),count-1);
        let bytes=session.export().unwrap();
        assert_eq!(proposed.preflight["candidate_sha256"],sha256(&bytes));
        assert_eq!(EditorSession::open(&bytes).unwrap().document(),&after);
        assert!(geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(2).unwrap();
        assert_eq!(session.document(),&after);
    }

    #[test]
    fn g33_sweep_refuses_existing_id_collisions_texture_and_atlas_without_mutation(){
        let session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Sweep","sweep").unwrap()
        ).unwrap();
        let baseline=session.document().clone();
        let generated_id=super::super::geometry_sweep::cube_uuid(SWEEP_SEED,0);
        let mut same_part=sweep_request();
        let mut explicit=part(CHILD,"newpart",None,CUBE_B);
        explicit.cubes[0].uuid=generated_id.clone();
        same_part.parts[0].cubes.push(explicit.cubes[0].clone());
        assert_eq!(compile(&session,&same_part).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

        let mut later_part=sweep_request();
        let mut other=part(CHILD,"later",None,CUBE_B);
        other.cubes[0].uuid=generated_id.clone();
        later_part.parts.push(other);
        assert_eq!(compile(&session,&later_part).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

        let mut repeated=sweep_request();
        repeated.parts[0].sweeps[0].stations=vec![
            super::super::geometry_sweep::GeometrySweepStation {
                position:[-2,0,0],radius:2,
            },
            super::super::geometry_sweep::GeometrySweepStation {
                position:[2,0,0],radius:2,
            },
        ];
        repeated.parts[0].sweeps.push(repeated.parts[0].sweeps[0].clone());
        assert_eq!(compile(&session,&repeated).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
        assert_eq!(session.document(),&baseline);
        assert!(!session.can_undo());

        let mut textured=session.clone();
        textured.apply(0,&[EditOperation::CreatePaintTexture {
            uuid:"00000000-0000-4000-8000-000000003502".into(),
            name:"atlas".into(),
        }]).unwrap();
        assert_eq!(compile(&textured,&GeometryAssemblyRequest {
            expected_revision:1,..sweep_request()
        }).err().as_deref(),Some("GEOMETRY_SWEEP_TEXTURED_PROJECT_UNSUPPORTED"));

        let mut tiny=session.clone();
        tiny.apply(0,&[EditOperation::SetEmptyAtlasResolution{
            width:4,height:4,
        }]).unwrap();
        assert_eq!(compile(&tiny,&GeometryAssemblyRequest {
            expected_revision:1,..sweep_request()
        }).err().as_deref(),Some("GEOMETRY_SWEEP_UV_ATLAS_TOO_SMALL"));

        let mut too_many=sweep_request();
        let first=too_many.parts[0].sweeps[0].clone();
        too_many.parts[0].sweeps=vec![first;5];
        assert_eq!(compile(&session,&too_many).err().as_deref(),
            Some("GEOMETRY_SWEEP_COUNT_INVALID"));
        assert_eq!(compile(&session,&GeometryAssemblyRequest{
            expected_revision:1,..sweep_request()
        }).err().as_deref(),Some("DOCUMENT_REVISION_STALE"));
        assert!(serde_json::from_value::<GeometrySphereSweep>(json!({
            "name":"branch","uuid_seed":SWEEP_SEED,"stations":[],
            "foreign":true
        })).is_err());
        let legacy=serde_json::to_value(part(CHILD,"legacy",None,CUBE_B)).unwrap();
        assert!(legacy.get("sweeps").is_none());
    }


    #[test]
    fn g34_adaptive_curved_sweep_keeps_g1_preflight_identity_export_and_undo(){
        let mut session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Curved Sweep","curved_sweep").unwrap()
        ).unwrap();
        let before=session.document().clone();
        let mut request=sweep_request();
        let sweep=&mut request.parts[0].sweeps[0];
        sweep.interpolation=Some("CENTRIPETAL_CATMULL_ROM".into());
        sweep.max_chord_error=Some(0.5);
        let planned=compile(&session,&request).unwrap();
        assert_eq!(planned.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(planned.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(planned.preflight["visual_verdict"],"UNVERIFIED");
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());
        let count=planned.plan.operations.len();
        assert!((3..=65).contains(&count));
        for (i,op) in planned.plan.operations[1..].iter().enumerate() {
            let EditOperation::AddCube{cube,bone_uuid}=op
                else{panic!("Curved Sweep must remain ordinary native Cubes");};
            assert_eq!(bone_uuid,ROOT);
            assert_eq!(cube.uuid,super::super::geometry_sweep::cube_uuid(SWEEP_SEED,i));
            assert_eq!(cube.extra.get("box_uv"),Some(&Value::Bool(true)));
            assert!(cube.faces.values().all(|f|f.get("texture").is_none()));
            assert_eq!(cube.origin,Some([0.0;3]));
        }
        session.apply(0,&planned.plan.operations).unwrap();
        let after=session.document().clone();
        let bytes=session.export().unwrap();
        assert_eq!(planned.preflight["candidate_sha256"],sha256(&bytes));
        assert_eq!(EditorSession::open(&bytes).unwrap().document(),&after);
        assert!(geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(2).unwrap();
        assert_eq!(session.document(),&after);
    }


    const PROFILE_SEED: &str = "00000000-0000-4000-8000-000000004501";

    fn profile_request() -> GeometryAssemblyRequest {
        let mut body=part(ROOT,"profile_bone",None,CUBE_A);
        body.cubes.clear();
        body.profile_sweeps.push(GeometryProfileSweep {
            name:"vent".into(), uuid_seed:PROFILE_SEED.into(),
            up_axis:"Y".into(), cross_section:"RECTANGLE".into(),
            stations:vec![
                super::super::geometry_profile_sweep::GeometryProfileStation {
                    position:[-5,0,0],half_width:2,half_height:2,
                    twist_degrees:0.0,
                },
                super::super::geometry_profile_sweep::GeometryProfileStation {
                    position:[0,0,0],half_width:3,half_height:2,
                    twist_degrees:0.0,
                },
                super::super::geometry_profile_sweep::GeometryProfileStation {
                    position:[0,0,5],half_width:3,half_height:2,
                    twist_degrees:0.0,
                },
            ],
        });
        GeometryAssemblyRequest{expected_revision:0,parts:vec![body]}
    }

    #[test]
    fn g34b_profile_sweep_creates_reversible_native_cubes_via_one_g1_preflight() {
        let mut session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Profile","profile").unwrap()
        ).unwrap();
        let before=session.document().clone();
        let proposal=compile(&session,&profile_request()).unwrap();
        assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(proposal.preflight["visual_verdict"],"UNVERIFIED");
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());
        let count=proposal.plan.operations.len();
        assert!((3..=65).contains(&count)); // Bone + bounded Cube partition
        for (i,op) in proposal.plan.operations[1..].iter().enumerate(){
            let EditOperation::AddCube {cube,bone_uuid}=op
                else {panic!("Profile must produce canonical AddCube operations");};
            assert_eq!(bone_uuid,ROOT);
            assert_eq!(cube.uuid,
                super::super::geometry_profile_sweep::cube_uuid(PROFILE_SEED,i));
            assert_eq!(cube.name.as_deref(),Some(format!("vent_v_{i}").as_str()));
            assert_eq!(cube.extra.get("box_uv"),Some(&Value::Bool(true)));
            assert!(cube.faces.values().all(|face|face.get("texture").is_none()));
            assert_eq!(cube.origin,Some([0.0;3]));
        }
        session.apply(0,&proposal.plan.operations).unwrap();
        let after=session.document().clone();
        assert_eq!(after.cubes.len(),count-1);
        let saved=session.export().unwrap();
        assert_eq!(proposal.preflight["candidate_sha256"],sha256(&saved));
        assert_eq!(EditorSession::open(&saved).unwrap().document(),&after);
        assert!(geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(2).unwrap();
        assert_eq!(session.document(),&after);
    }

    #[test]
    fn g34b_profile_is_fail_closed_for_uuids_texture_uv_and_stale_revision() {
        let session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Profile","profile").unwrap()
        ).unwrap();
        let before=session.document().clone();
        let generated=super::super::geometry_profile_sweep::cube_uuid(
            PROFILE_SEED,0);
        let mut explicit=profile_request();
        let mut existing=part(CHILD,"explicit",None,CUBE_B);
        existing.cubes[0].uuid=generated.clone();
        explicit.parts[0].cubes.push(existing.cubes[0].clone());
        assert_eq!(compile(&session,&explicit).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
        let mut later=profile_request();
        later.parts.push(existing);
        assert_eq!(compile(&session,&later).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

        let mut repeated=profile_request();
        let shared=repeated.parts[0].profile_sweeps[0].clone();
        repeated.parts[0].profile_sweeps.push(shared);
        assert_eq!(compile(&session,&repeated).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());

        let mut textured=session.clone();
        textured.apply(0,&[EditOperation::CreatePaintTexture {
            uuid:"00000000-0000-4000-8000-000000004502".into(),
            name:"atlas".into(),
        }]).unwrap();
        assert_eq!(compile(&textured,&GeometryAssemblyRequest {
            expected_revision:1,..profile_request()
        }).err().as_deref(),
            Some("GEOMETRY_PROFILE_TEXTURED_PROJECT_UNSUPPORTED"));

        let mut tiny=session.clone();
        tiny.apply(0,&[EditOperation::SetEmptyAtlasResolution {
            width:4,height:4,
        }]).unwrap();
        assert_eq!(compile(&tiny,&GeometryAssemblyRequest {
            expected_revision:1,..profile_request()
        }).err().as_deref(),
            Some("GEOMETRY_PROFILE_UV_ATLAS_TOO_SMALL"));

        let mut excess=profile_request();
        let one=excess.parts[0].profile_sweeps[0].clone();
        excess.parts[0].profile_sweeps=vec![one;5];
        assert_eq!(compile(&session,&excess).err().as_deref(),
            Some("GEOMETRY_PROFILE_COUNT_INVALID"));
        assert_eq!(compile(&session,&GeometryAssemblyRequest {
            expected_revision:1,..profile_request()
        }).err().as_deref(),Some("DOCUMENT_REVISION_STALE"));

        let invalid=serde_json::json!({
            "name":"vent","uuid_seed":PROFILE_SEED,"up_axis":"Y",
            "cross_section":"ELLIPSE","stations":[], "twist":45
        });
        assert!(serde_json::from_value::<GeometryProfileSweep>(invalid).is_err());
        let legacy=serde_json::to_value(part(CHILD,"legacy",None,CUBE_B)).unwrap();
        assert!(legacy.get("profile_sweeps").is_none());
    }

    #[test]
    fn axial_loft_and_revolve_share_one_undoable_source_bound_plan() {
        use super::super::geometry_axial::{
            GeometryAxialLoft, GeometryAxialRevolve,
            GeometryLoftSection, GeometryRevolveSection,
        };
        const SEED: &str = "00000000-0000-4000-8000-000000005501";
        let mut part = part(ROOT,"axial_bone",None,CUBE_A);
        part.cubes.clear();
        part.lofts.push(GeometryAxialLoft {
            name:"tower".into(),uuid_seed:SEED.into(),
            origin:[0,0,0],axis:"Y".into(),sections:vec![
                GeometryLoftSection{height:0,center:[0.0,0.0],size:[6,6]},
                GeometryLoftSection{height:8,center:[2.0,0.0],size:[4,4]},
            ],
        });
        part.revolves.push(GeometryAxialRevolve {
            name:"ring".into(),uuid_seed:SEED.into(),
            origin:[20,0,0],axis:"Y".into(),sections:vec![
                GeometryRevolveSection{height:0,outer_radius:6,inner_radius:2},
                GeometryRevolveSection{height:8,outer_radius:6,inner_radius:2},
            ],
        });
        let mut session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Axial","axial").unwrap()
        ).unwrap();
        let before=session.document().clone();
        let request=GeometryAssemblyRequest{expected_revision:0,parts:vec![part]};
        let proposed=compile(&session,&request).unwrap();
        assert_eq!(proposed.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposed.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(proposed.preflight["visual_verdict"],"UNVERIFIED");
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());
        assert!(proposed.plan.operations.len()>2);
        let mut loft_count=0;
        let mut revolve_count=0;
        for op in proposed.plan.operations.iter().skip(1) {
            let EditOperation::AddCube{cube,bone_uuid}=op else {
                panic!("Axial blockouts must use native AddCube");
            };
            assert_eq!(bone_uuid,ROOT);
            assert_eq!(cube.extra.get("box_uv"),Some(&Value::Bool(true)));
            assert!(cube.faces.values().all(|v|v.get("texture").is_none()));
            if cube.name.as_deref().is_some_and(|v|v.starts_with("tower_v_")) {
                assert_eq!(cube.uuid,geometry_axial::cube_uuid("loft",SEED,loft_count));
                loft_count+=1;
            } else {
                assert_eq!(cube.uuid,geometry_axial::cube_uuid("revolve",SEED,revolve_count));
                revolve_count+=1;
            }
        }
        assert!(loft_count>0 && revolve_count>0);
        session.apply(0,&proposed.plan.operations).unwrap();
        let after=session.document().clone();
        let saved=session.export().unwrap();
        assert_eq!(proposed.preflight["candidate_sha256"],sha256(&saved));
        assert_eq!(EditorSession::open(&saved).unwrap().document(),&after);
        assert!(geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(2).unwrap();
        assert_eq!(session.document(),&after);
    }
    #[test]
    fn axial_shapes_reject_uuid_collision_stale_and_unsafe_texture() {
        use super::super::geometry_axial::{GeometryAxialLoft,GeometryLoftSection};
        const SEED: &str = "00000000-0000-4000-8000-000000005501";
        let mut part=part(ROOT,"loft_bone",None,CUBE_A);
        part.cubes.clear();
        part.lofts.push(GeometryAxialLoft {
            name:"tower".into(),uuid_seed:SEED.into(),
            origin:[0,0,0],axis:"Y".into(),sections:vec![
                GeometryLoftSection{height:0,center:[0.0,0.0],size:[6,6]},
                GeometryLoftSection{height:8,center:[0.0,0.0],size:[4,4]},
            ],
        });
        let session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Axial","axial").unwrap()
        ).unwrap();
        let original=session.document().clone();
        let request=GeometryAssemblyRequest{expected_revision:0,parts:vec![part]};
        let mut duplicate=request.clone();
        duplicate.parts[0].lofts.push(duplicate.parts[0].lofts[0].clone());
        assert_eq!(compile(&session,&duplicate).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
        let mut explicit=request.clone();
        let mut cube=self::part(CHILD,"other",None,CUBE_B).cubes.remove(0);
        cube.uuid=geometry_axial::cube_uuid("loft",SEED,0);
        explicit.parts[0].cubes.push(cube);
        assert_eq!(compile(&session,&explicit).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
        let mut textured=session.clone();
        textured.apply(0,&[EditOperation::CreatePaintTexture {
            uuid:"00000000-0000-4000-8000-000000005502".into(),
            name:"atlas".into(),
        }]).unwrap();
        assert_eq!(compile(&textured,&GeometryAssemblyRequest{
            expected_revision:1,..request.clone()
        }).err().as_deref(),Some("GEOMETRY_AXIAL_TEXTURED_PROJECT_UNSUPPORTED"));
        assert_eq!(compile(&session,&GeometryAssemblyRequest{
            expected_revision:1,..request
        }).err().as_deref(),Some("DOCUMENT_REVISION_STALE"));
        assert_eq!(session.document(),&original);
    }

}

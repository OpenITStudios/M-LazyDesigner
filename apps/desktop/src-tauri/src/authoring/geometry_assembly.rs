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
use super::geometry_rib_array::{self, GeometryRibArray};
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
    /// G6 opt-in, exact integer-spaced ribs; native editable Cubes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rib_arrays: Vec<GeometryRibArray>,
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
            // Repeats have a known exact Cube count. Reserve it before
            // any allocation; the shared G1 EditPlan budget is authoritative.
            .and_then(|panels| part.rib_arrays.iter().try_fold(panels,
                |sum, rib| sum.checked_add(rib.count)))
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
            if !part.rib_arrays.is_empty() {
                return Err(fail("GEOMETRY_RIB_TEXTURED_PROJECT_UNSUPPORTED"));
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
        let rib_start = panels.len();
        for rib in &part.rib_arrays {
            let cubes = geometry_rib_array::compile(rib,
                part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?,
                MAX_OPERATIONS - count + rib.count)?;
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
                } else if index < rib_start {
                    "GEOMETRY_REVOLVE_UV_ATLAS_TOO_SMALL"
                } else { "GEOMETRY_RIB_UV_ATLAS_TOO_SMALL" };
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
mod tests;

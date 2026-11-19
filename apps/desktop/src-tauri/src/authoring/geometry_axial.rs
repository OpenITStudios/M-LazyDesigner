//! G3.5: source-local axial LOFT and REVOLVE blockouts.
//! One bounded voxel admission, one reused native-Cube partition, one G1 plan.
//! SOURCE ONLY / NOT EXECUTED; no mesh, saved recipe, UV packer or visual PASS.
use super::{fail, sha256, valid_node_name, valid_uuid, Cube, Result};
use super::geometry_assembly::blockout_cube;
use super::geometry_sweep::{partition, MAX_SWEEP_AXIS, MAX_SWEEP_CELLS, MAX_SWEEP_CUBES};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

const MAX_SECTIONS: usize = 12;
const EPS: f64 = 1.0e-10;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryLoftSection {
    pub height: u8,
    pub center: [f64; 2],
    pub size: [u8; 2],
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryAxialLoft {
    pub name: String,
    pub uuid_seed: String,
    pub origin: [i32; 3],
    pub axis: String,
    pub sections: Vec<GeometryLoftSection>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryRevolveSection {
    pub height: u8,
    pub outer_radius: u8,
    pub inner_radius: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryAxialRevolve {
    pub name: String,
    pub uuid_seed: String,
    pub origin: [i32; 3],
    pub axis: String,
    pub sections: Vec<GeometryRevolveSection>,
}

fn axis_frame(name: &str) -> Result<(usize, [usize; 2])> {
    let axis = match name {
        "X" => 0, "Y" => 1, "Z" => 2,
        _ => return Err(fail("GEOMETRY_AXIAL_AXIS_INVALID")),
    };
    Ok((axis, match axis { 0 => [1, 2], 1 => [0, 2], _ => [0, 1] }))
}
fn source(name: &str, seed: &str, origin: [i32; 3]) -> Result<()> {
    if !valid_node_name(name) || name.chars().count() > 110 {
        return Err(fail("GEOMETRY_AXIAL_NAME_INVALID"));
    }
    if !valid_uuid(seed) { return Err(fail("GEOMETRY_AXIAL_SEED_INVALID")); }
    if origin.iter().any(|n| !(-64..=64).contains(n)) {
        return Err(fail("GEOMETRY_AXIAL_ORIGIN_INVALID"));
    }
    Ok(())
}
fn heights(values: &[u8]) -> Result<usize> {
    if !(2..=MAX_SECTIONS).contains(&values.len()) || values[0] != 0 ||
        values.last().is_none_or(|v| !(1..=32).contains(v)) ||
        values.windows(2).any(|v| v[0] >= v[1]) {
        return Err(fail("GEOMETRY_AXIAL_SECTIONS_INVALID"));
    }
    Ok(*values.last().unwrap() as usize)
}
fn grid(origin: [i32; 3], axis: usize, lateral: [usize; 2],
    limits: [(i32, i32); 2], height: usize) -> Result<([i32; 3], [usize; 3])> {
    let mut low = origin;
    let mut size = [0usize; 3];
    size[axis] = height;
    for side in 0..2 {
        let (start, end) = limits[side];
        if end <= start { return Err(fail("GEOMETRY_AXIAL_GRID_BUDGET")); }
        low[lateral[side]] += start;
        size[lateral[side]] = usize::try_from(end - start)
            .map_err(|_| fail("GEOMETRY_AXIAL_GRID_BUDGET"))?;
    }
    if size.iter().any(|n| *n == 0 || *n > MAX_SWEEP_AXIS) ||
        size.iter().try_fold(1usize, |total, n| total.checked_mul(*n))
            .is_none_or(|total| total > MAX_SWEEP_CELLS) {
        return Err(fail("GEOMETRY_AXIAL_GRID_BUDGET"));
    }
    Ok((low, size))
}
fn idx(x: usize, y: usize, z: usize, size: [usize; 3]) -> usize {
    (y * size[2] + z) * size[0] + x
}
fn cubes(name: &str, seed: &str, kind: &str, origin: [f64; 3],
    occupied: &[bool], low: [i32; 3], size: [usize; 3],
    max_cubes: usize) -> Result<Vec<Cube>> {
    if max_cubes == 0 { return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT")); }
    let boxes = partition(occupied, size, low, max_cubes.min(MAX_SWEEP_CUBES))?;
    Ok(boxes.into_iter().enumerate().map(|(i, (from, to))|
        blockout_cube(&cube_uuid(kind, seed, i),
            format!("{name}_v_{i}"), from, to, origin)
    ).collect())
}
pub(super) fn cube_uuid(kind: &str, seed: &str, index: usize) -> String {
    let digest = sha256(format!(
        "lazydesigner:geometry-{kind}-v1\0{seed}\0{index}"
    ).as_bytes());
    format!("{}-{}-4{}-8{}-{}",
        &digest[..8], &digest[8..12], &digest[13..16],
        &digest[17..20], &digest[20..32])
}
fn section_pair<T>(sections: &[T], y: f64,
    height: impl Fn(&T) -> f64) -> (&T, &T, f64) {
    let mut i = 0usize;
    while i + 2 < sections.len() && height(&sections[i + 1]) < y { i += 1; }
    let a = &sections[i];
    let b = &sections[i + 1];
    (a, b, (y - height(a)) / (height(b) - height(a)))
}
fn lerp(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }

pub(super) fn compile_loft(shape: &GeometryAxialLoft,
    bone_origin: [f64; 3], max_cubes: usize) -> Result<Vec<Cube>> {
    source(&shape.name, &shape.uuid_seed, shape.origin)?;
    let (axis, radial) = axis_frame(&shape.axis)?;
    let heights_list: Vec<u8> = shape.sections.iter().map(|s| s.height).collect();
    let height = heights(&heights_list)?;
    if shape.sections.iter().any(|s| s.size.iter().any(|v| !(1..=32).contains(v)) ||
        s.center.iter().any(|v| !v.is_finite() || !(-16.0..=16.0).contains(v))) {
        return Err(fail("GEOMETRY_LOFT_SECTION_INVALID"));
    }
    // Piecewise linear profiles reach their extrema at declared stations.
    let limits = std::array::from_fn(|side| {
        let min = shape.sections.iter().map(|s| s.center[side] -
            f64::from(s.size[side]) / 2.0).fold(f64::INFINITY, f64::min);
        let max = shape.sections.iter().map(|s| s.center[side] +
            f64::from(s.size[side]) / 2.0).fold(f64::NEG_INFINITY, f64::max);
        (min.floor() as i32, max.ceil() as i32)
    });
    let (low, size) = grid(shape.origin, axis, radial, limits, height)?;
    // Interpolate only once per axial layer, not once per candidate voxel.
    let layers: Vec<([f64; 2], [f64; 2])> = (0..height).map(|layer| {
        let (a, b, t) = section_pair(&shape.sections, layer as f64 + 0.5,
            |s| f64::from(s.height));
        (std::array::from_fn(|i| lerp(a.center[i], b.center[i], t)),
         std::array::from_fn(|i| lerp(f64::from(a.size[i]),
             f64::from(b.size[i]), t)))
    }).collect();
    let mut occupied = vec![false; size.iter().product()];
    let mut covered = vec![false; height];
    for y in 0..size[1] { for z in 0..size[2] { for x in 0..size[0] {
        let coord = [x, y, z];
        let h = coord[axis];
        let (center, extent) = layers[h];
        let inside = (0..2).all(|side| {
            let relative = f64::from(low[radial[side]] - shape.origin[radial[side]]) +
                coord[radial[side]] as f64 + 0.5;
            let lower = center[side] - extent[side] / 2.0;
            let upper = center[side] + extent[side] / 2.0;
            relative >= lower - EPS && relative < upper - EPS
        });
        if inside {
            occupied[idx(x,y,z,size)] = true;
            covered[h] = true;
        }
    }}}
    if covered.iter().any(|seen| !seen) {
        return Err(fail("GEOMETRY_LOFT_LAYER_LOST"));
    }
    cubes(&shape.name, &shape.uuid_seed, "loft", bone_origin,
        &occupied, low, size, max_cubes)
}

// Small per-layer flood checks protect a real annular opening from diagonal
// leakage. They inspect the single raster, never create a second 3D model.
fn flood(mask: &[bool], width: usize, height: usize,
    seeds: impl IntoIterator<Item = usize>, diagonal: bool) -> Vec<bool> {
    let mut seen = vec![false; mask.len()];
    let mut queue = VecDeque::new();
    for seed in seeds {
        if mask[seed] && !seen[seed] {
            seen[seed] = true;
            queue.push_back(seed);
        }
    }
    while let Some(i) = queue.pop_front() {
        let x = (i % width) as isize;
        let y = (i / width) as isize;
        for dy in -1isize..=1 { for dx in -1isize..=1 {
            if dx == 0 && dy == 0 { continue; }
            if !diagonal && dx.abs() + dy.abs() != 1 { continue; }
            let nx = x + dx;
            let ny = y + dy;
            if nx < 0 || ny < 0 || nx >= width as isize || ny >= height as isize {
                continue;
            }
            let next = ny as usize * width + nx as usize;
            if mask[next] && !seen[next] {
                seen[next] = true;
                queue.push_back(next);
            }
        }}
    }
    seen
}
fn check_annulus(occupied: &[bool], size: [usize; 3], axis: usize,
    radial: [usize; 2], layer: usize, inner_radius: f64) -> Result<bool> {
    let width = size[radial[0]];
    let height = size[radial[1]];
    let mut solid = vec![false; width * height];
    let mut hole = vec![false; width * height];
    let mid = width as f64 / 2.0;
    for v in 0..height { for u in 0..width {
        let mut coord = [0usize; 3];
        coord[axis] = layer;
        coord[radial[0]] = u;
        coord[radial[1]] = v;
        let i = v*width+u;
        solid[i] = occupied[idx(coord[0], coord[1], coord[2], size)];
        let du = u as f64 + 0.5 - mid;
        let dv = v as f64 + 0.5 - height as f64 / 2.0;
        hole[i] = du*du+dv*dv < inner_radius*inner_radius - EPS;
    }}
    let first = solid.iter().position(|v| *v)
        .ok_or_else(|| fail("GEOMETRY_REVOLVE_EMPTY_RING"))?;
    let connected = flood(&solid, width, height, [first], false);
    if connected.iter().zip(&solid).any(|(a,b)| a != b) {
        return Err(fail("GEOMETRY_REVOLVE_DISCONNECTED_RING"));
    }
    let Some(first_hole) = hole.iter().position(|v| *v) else {
        return Ok(false); // Small transitional radii may be subvoxel.
    };
    let blank: Vec<bool> = solid.iter().map(|v| !v).collect();
    let exterior_seeds = (0..blank.len()).filter(|i| {
        let u = i % width;
        let v = i / width;
        u == 0 || v == 0 || u + 1 == width || v + 1 == height
    });
    let exterior = flood(&blank, width, height, exterior_seeds, true);
    let cavity = flood(&blank, width, height, [first_hole], true);
    if blank.iter().enumerate().any(|(i, blank)| {
        (hole[i] && (exterior[i] || !cavity[i])) ||
        (*blank && !exterior[i] && !cavity[i])
    }) {
        return Err(fail("GEOMETRY_REVOLVE_HOLE_LEAK"));
    }
    Ok(true)
}
pub(super) fn compile_revolve(shape: &GeometryAxialRevolve,
    bone_origin: [f64; 3], max_cubes: usize) -> Result<Vec<Cube>> {
    source(&shape.name, &shape.uuid_seed, shape.origin)?;
    let (axis, radial) = axis_frame(&shape.axis)?;
    let heights_list: Vec<u8> = shape.sections.iter().map(|s| s.height).collect();
    let height = heights(&heights_list)?;
    if shape.sections.iter().any(|s|
        !(1..=12).contains(&s.outer_radius) ||
        s.inner_radius >= s.outer_radius ||
        s.outer_radius - s.inner_radius < 1) {
        return Err(fail("GEOMETRY_REVOLVE_SECTION_INVALID"));
    }
    let radius = shape.sections.iter().map(|s| s.outer_radius)
        .max().unwrap() as i32;
    let (low, size) = grid(shape.origin, axis, radial,
        [(-radius,radius);2], height)?;
    let layers: Vec<(f64,f64)> = (0..height).map(|layer| {
        let (a,b,t) = section_pair(&shape.sections, layer as f64+0.5,
            |s| f64::from(s.height));
        (lerp(f64::from(a.outer_radius),f64::from(b.outer_radius),t),
         lerp(f64::from(a.inner_radius),f64::from(b.inner_radius),t))
    }).collect();
    let mut occupied = vec![false; size.iter().product()];
    for y in 0..size[1] { for z in 0..size[2] { for x in 0..size[0] {
        let coord = [x,y,z];
        let (outer,inner) = layers[coord[axis]];
        let u = f64::from(low[radial[0]] - shape.origin[radial[0]]) +
            coord[radial[0]] as f64 + 0.5;
        let v = f64::from(low[radial[1]] - shape.origin[radial[1]]) +
            coord[radial[1]] as f64 + 0.5;
        let distance = u*u + v*v;
        occupied[idx(x,y,z,size)] = distance <= outer*outer + EPS &&
            (inner == 0.0 || distance + EPS >= inner*inner);
    }}}
    let mut hollow = false;
    for (layer, (_,inner)) in layers.iter().enumerate() {
        if *inner > 0.0 {
            hollow |= check_annulus(&occupied, size, axis, radial, layer, *inner)?;
        }
    }
    if shape.sections.iter().any(|s| s.inner_radius > 0) && !hollow {
        return Err(fail("GEOMETRY_REVOLVE_HOLE_NOT_REPRESENTED"));
    }
    cubes(&shape.name, &shape.uuid_seed, "revolve", bone_origin,
        &occupied, low, size, max_cubes)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SEED: &str = "00000000-0000-4000-8000-000000005501";
    fn loft() -> GeometryAxialLoft {
        GeometryAxialLoft { name:"taper".into(), uuid_seed:SEED.into(),
            origin:[1,0,2], axis:"Y".into(), sections:vec![
                GeometryLoftSection{height:0,center:[0.0,0.0],size:[6,6]},
                GeometryLoftSection{height:8,center:[2.0,0.0],size:[4,4]},
            ]}
    }
    fn revolve() -> GeometryAxialRevolve {
        GeometryAxialRevolve { name:"ring".into(), uuid_seed:SEED.into(),
            origin:[0,0,0],axis:"Y".into(),sections:vec![
                GeometryRevolveSection{height:0,outer_radius:6,inner_radius:2},
                GeometryRevolveSection{height:8,outer_radius:6,inner_radius:2},
            ]}
    }
    #[test]
    fn loft_is_disjoint_deterministic_and_preserves_source() {
        let shape=loft();
        let before=serde_json::to_value(&shape).unwrap();
        let a=compile_loft(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap();
        assert!(!a.is_empty());
        assert!(a.len()<=64);
        assert_eq!(a,compile_loft(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap());
        assert_eq!(before,serde_json::to_value(&shape).unwrap());
        assert_eq!(a[0].uuid,cube_uuid("loft",SEED,0));
        let mut straight=shape.clone();
        straight.sections[1].center=[0.0,0.0];
        assert_ne!(a,compile_loft(&straight,[0.0;3],MAX_SWEEP_CUBES).unwrap());
    }
    #[test]
    fn revolving_ring_keeps_real_void_and_separate_identity() {
        let shape=revolve();
        let cubes=compile_revolve(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap();
        assert!(!cubes.is_empty());
        assert_eq!(cubes[0].uuid,cube_uuid("revolve",SEED,0));
        assert_ne!(cube_uuid("revolve",SEED,0),cube_uuid("loft",SEED,0));
        assert!(!cubes.iter().any(|cube|
            (0..3).all(|axis| cube.from[axis] <= [0.5,2.5,0.5][axis] &&
                [0.5,2.5,0.5][axis] < cube.to[axis])));
        assert_eq!(cubes,compile_revolve(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap());
    }
    #[test]
    fn bad_sections_and_unrepresentable_hole_refuse() {
        let mut shape=loft();
        shape.sections[1].height=0;
        assert_eq!(compile_loft(&shape,[0.0;3],64).err().as_deref(),
            Some("GEOMETRY_AXIAL_SECTIONS_INVALID"));
        let mut shape=loft();
        shape.sections[1].size=[0,4];
        assert_eq!(compile_loft(&shape,[0.0;3],64).err().as_deref(),
            Some("GEOMETRY_LOFT_SECTION_INVALID"));
        let mut shape=loft();
        shape.axis="INVALID".into();
        assert_eq!(compile_loft(&shape,[0.0;3],64).err().as_deref(),
            Some("GEOMETRY_AXIAL_AXIS_INVALID"));
        let mut shape=revolve();
        shape.sections[1].inner_radius=6;
        assert_eq!(compile_revolve(&shape,[0.0;3],64).err().as_deref(),
            Some("GEOMETRY_REVOLVE_SECTION_INVALID"));
        let mut shape=revolve();
        shape.sections[0].inner_radius=0;
        shape.sections[1].height=1;
        shape.sections[1].inner_radius=1;
        assert_eq!(compile_revolve(&shape,[0.0;3],64).err().as_deref(),
            Some("GEOMETRY_REVOLVE_HOLE_NOT_REPRESENTED"));
    }
    #[test]
    fn ring_topology_refuses_a_deliberately_leaking_slice() {
        let size=[10,1,10];
        let mut occupied=vec![false;100];
        for z in 0..10 {for x in 0..10 {
            let dx=x as f64-4.5;
            let dz=z as f64-4.5;
            let d=dx*dx+dz*dz;
            occupied[idx(x,0,z,size)]=d<=25.0 && d>=4.0;
        }}
        // A single axial tunnel from a protected cavity into the exterior.
        for x in 5..10 {occupied[idx(x,0,5,size)]=false;}
        assert!(check_annulus(&occupied,size,1,[0,2],0,2.0).is_err());
    }
}

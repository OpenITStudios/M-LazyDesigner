//! G3.3: bounded, explicit 3D variable-radius LINEAR sweep blockout.
//! One SOURCE-ONLY voxel raster plus deterministic disjoint-Cuboid partition.
//! No native mesh, renderer, hidden parameter store, visual quality verdict,
//! sampled Catmull-Rom, transport frame or unapproved UV/texture allocation.
use super::{fail, sha256, valid_node_name, valid_uuid, Cube, Result};
use super::geometry_assembly::blockout_cube;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

const MAX_SWEEP_STATIONS: usize = 8;
const MAX_SWEEP_CUBES: usize = 64;
const MAX_SWEEP_CELLS: usize = 32_768;
const MAX_SWEEP_AXIS: usize = 64;
const SURFACE_EPS: f64 = 1.0e-9;

/// Integer model-unit knot positions prevent hidden subpixel assumptions.
/// Linear radius is a positive *scalar* in all 3 axes; this is NOT the
/// anisotropic/twisted PROFILE_SWEEP method on the separate Local branch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometrySweepStation {
    pub position: [i32; 3],
    pub radius: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometrySphereSweep {
    pub name: String,
    pub uuid_seed: String,
    pub stations: Vec<GeometrySweepStation>,
}

/// One G1-dependent generated UUID per disjoint native Cube. This is stable
/// for the exact seed + raster enumeration; changed geometry can renumber
/// later Cubes, so the seed is NOT a persistent parametric object identity.
pub(super) fn cube_uuid(seed: &str, index: usize) -> String {
    let digest = sha256(format!(
        "lazydesigner:geometry-sweep-v1\0{seed}\0{index}"
    ).as_bytes());
    format!("{}-{}-4{}-8{}-{}",
        &digest[..8], &digest[8..12], &digest[13..16],
        &digest[17..20], &digest[20..32])
}

#[derive(Clone, Copy)]
struct Segment {
    start: [f64; 3],
    delta: [f64; 3],
    radius: f64,
    radius_delta: f64,
    quadratic_a: f64,
}

/// Exact union of linearly varying spheres swept along a straight chord.
/// The nearest-centerline method is incorrect when the radius varies.
fn contains(point: [f64; 3], segment: Segment) -> bool {
    let w: [f64; 3] = std::array::from_fn(|a| point[a] - segment.start[a]);
    let dot = (0..3).map(|a| w[a] * segment.delta[a]).sum::<f64>();
    let squared = w.iter().map(|v| v*v).sum::<f64>();
    let a = segment.quadratic_a;
    let b = -2.0 * (dot + segment.radius * segment.radius_delta);
    let c = squared - segment.radius * segment.radius;
    if c <= SURFACE_EPS || a+b+c <= SURFACE_EPS {
        return true;
    }
    if a <= 0.0 { return false; }
    let t = -b/(2.0*a);
    t > 0.0 && t < 1.0 && (a*t+b)*t+c <= SURFACE_EPS
}

fn validate(shape: &GeometrySphereSweep) -> Result<(Vec<Segment>, [i32; 3], [usize; 3])> {
    if !valid_node_name(&shape.name) || shape.name.chars().count() > 110 {
        return Err(fail("GEOMETRY_SWEEP_NAME_INVALID"));
    }
    if !valid_uuid(&shape.uuid_seed) {
        return Err(fail("GEOMETRY_SWEEP_SEED_INVALID"));
    }
    if !(2..=MAX_SWEEP_STATIONS).contains(&shape.stations.len()) {
        return Err(fail("GEOMETRY_SWEEP_STATIONS_INVALID"));
    }
    if shape.stations.iter().any(|p| p.radius < 2 || p.radius > 6 ||
        p.position.iter().any(|coord| !(-96..=96).contains(coord))) {
        return Err(fail("GEOMETRY_SWEEP_STATION_INVALID"));
    }

    let outer = shape.stations.iter().map(|k| i32::from(k.radius)).max()
        .ok_or_else(|| fail("GEOMETRY_SWEEP_STATIONS_INVALID"))?;
    let low: [i32; 3] = std::array::from_fn(|a|
        shape.stations.iter().map(|k| k.position[a]).min().unwrap_or(0) - outer);
    let high: [i32; 3] = std::array::from_fn(|a|
        shape.stations.iter().map(|k| k.position[a]).max().unwrap_or(0) + outer);
    let mut size = [0usize; 3];
    for a in 0..3 {
        let length = usize::try_from(high[a]-low[a])
            .map_err(|_| fail("GEOMETRY_SWEEP_GRID_BUDGET"))?;
        if length == 0 || length > MAX_SWEEP_AXIS {
            return Err(fail("GEOMETRY_SWEEP_GRID_BUDGET"));
        }
        size[a]=length;
    }
    let cells = size.iter().try_fold(1usize, |acc, n| acc.checked_mul(*n))
        .ok_or_else(|| fail("GEOMETRY_SWEEP_GRID_BUDGET"))?;
    if cells > MAX_SWEEP_CELLS {
        return Err(fail("GEOMETRY_SWEEP_GRID_BUDGET"));
    }

    let mut segments = Vec::with_capacity(shape.stations.len()-1);
    let mut last_delta: Option<[f64;3]> = None;
    for pair in shape.stations.windows(2) {
        let a = pair[0].position.map(f64::from);
        let b = pair[1].position.map(f64::from);
        let delta: [f64; 3] = std::array::from_fn(|axis| b[axis]-a[axis]);
        let distance_sq = delta.iter().map(|v| v*v).sum::<f64>();
        if distance_sq < 4.0 {
            return Err(fail("GEOMETRY_SWEEP_SEGMENT_TOO_SHORT"));
        }
        if let Some(previous) = last_delta {
            let dot = (0..3).map(|axis| previous[axis]*delta[axis]).sum::<f64>();
            let prior_sq = previous.iter().map(|v| v*v).sum::<f64>();
            if dot < -0.98*(prior_sq*distance_sq).sqrt() {
                return Err(fail("GEOMETRY_SWEEP_REVERSAL_UNSUPPORTED"));
            }
        }
        let radius = f64::from(pair[0].radius);
        let radius_delta = f64::from(pair[1].radius)-radius;
        segments.push(Segment {
            start: a, delta, radius, radius_delta,
            quadratic_a: distance_sq-radius_delta*radius_delta,
        });
        last_delta=Some(delta);
    }
    Ok((segments,low,size))
}

fn index(x: usize,y: usize,z: usize, size:[usize;3])->usize{
    (y*size[2]+z)*size[0]+x
}

/// Exact accepted occupancy in one source-local voxel grid. Reject disconnected
/// material before partitioning: face contact, not diagonal proximity.
fn partition(occupied: &[bool],size:[usize;3],low:[i32;3],limit:usize)
    -> Result<Vec<([f64;3],[f64;3])>> {
    let first=occupied.iter().position(|cell|*cell)
        .ok_or_else(||fail("GEOMETRY_SWEEP_EMPTY"))?;
    let mut visited=vec![false;occupied.len()];
    let mut queue=VecDeque::new();
    queue.push_back(first);
    visited[first]=true;
    let mut connected=0usize;
    while let Some(cell)=queue.pop_front(){
        connected+=1;
        let x=cell%size[0];
        let z=(cell/size[0])%size[2];
        let y=cell/(size[0]*size[2]);
        // Do not use eager then_some() with subtracting neighbours:
        // its argument is evaluated even when the coordinate is zero.
        let neighbours=[
            if x>0 {Some(cell-1)} else {None},
            if x+1<size[0] {Some(cell+1)} else {None},
            if z>0 {Some(cell-size[0])} else {None},
            if z+1<size[2] {Some(cell+size[0])} else {None},
            if y>0 {Some(cell-size[0]*size[2])} else {None},
            if y+1<size[1] {Some(cell+size[0]*size[2])} else {None},
        ];
        for next in neighbours.into_iter().flatten(){
            if occupied[next] && !visited[next] {
                visited[next]=true;
                queue.push_back(next);
            }
        }
    }
    if connected != occupied.iter().filter(|v|**v).count(){
        return Err(fail("GEOMETRY_SWEEP_DISCONNECTED"));
    }

    let mut taken=vec![false;occupied.len()];
    let available = |x,y,z,taken:&[bool]| {
        let i=index(x,y,z,size);
        occupied[i] && !taken[i]
    };
    let mut boxes=Vec::new();
    for y in 0..size[1]{
        for z in 0..size[2]{
            for x in 0..size[0]{
                if !available(x,y,z,&taken){continue;}
                let mut x1=x+1;
                while x1<size[0] && available(x1,y,z,&taken){x1+=1;}
                let mut z1=z+1;
                while z1<size[2] && (x..x1).all(|xx|available(xx,y,z1,&taken)){z1+=1;}
                let mut y1=y+1;
                while y1<size[1] && (z..z1).all(|zz|
                    (x..x1).all(|xx|available(xx,y1,zz,&taken))){y1+=1;}
                for yy in y..y1 {for zz in z..z1 {for xx in x..x1 {
                    taken[index(xx,yy,zz,size)]=true;
                }}}
                let from=[(low[0]+x as i32) as f64,
                    (low[1]+y as i32) as f64,(low[2]+z as i32) as f64];
                let to=[(low[0]+x1 as i32) as f64,
                    (low[1]+y1 as i32) as f64,(low[2]+z1 as i32) as f64];
                boxes.push((from,to));
                if boxes.len()>limit.min(MAX_SWEEP_CUBES){
                    return Err(fail("GEOMETRY_SWEEP_CUBE_BUDGET"));
                }
            }
        }
    }
    if occupied!=taken.as_slice() {
        return Err(fail("GEOMETRY_SWEEP_COVERAGE_NOT_CONSERVED"));
    }
    Ok(boxes)
}

pub(super) fn compile(
    shape:&GeometrySphereSweep,bone_origin:[f64;3],max_boxes:usize
)->Result<Vec<Cube>>{
    if max_boxes==0 {return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));}
    let (segments,low,size)=validate(shape)?;
    let total=size[0]*size[1]*size[2];
    let mut occupied=vec![false;total];
    let mut observed=vec![false;segments.len()];
    for y in 0..size[1] {for z in 0..size[2] {for x in 0..size[0]{
        let point=[low[0] as f64+x as f64+0.5,
            low[1] as f64+y as f64+0.5,
            low[2] as f64+z as f64+0.5];
        for (i,segment) in segments.iter().enumerate() {
            if contains(point,*segment){
                occupied[index(x,y,z,size)]=true;
                observed[i]=true;
            }
        }
    }}}
    if observed.iter().any(|found|!*found){
        return Err(fail("GEOMETRY_SWEEP_SEGMENT_LOST"));
    }
    let boxes=partition(&occupied,size,low,max_boxes)?;
    Ok(boxes.into_iter().enumerate().map(|(i,(from,to))|{
        blockout_cube(&cube_uuid(&shape.uuid_seed,i),
            format!("{}_v_{}",shape.name,i),from,to,bone_origin)
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED:&str="00000000-0000-4000-8000-000000003501";
    fn station(x:i32,y:i32,z:i32,radius:u8)->GeometrySweepStation{
        GeometrySweepStation{position:[x,y,z],radius}
    }
    fn curve()->GeometrySphereSweep{
        GeometrySphereSweep{name:"pipe".into(),uuid_seed:SEED.into(),
            stations:vec![station(-4,0,0,2),station(0,2,0,3),station(4,3,1,2)]}
    }
    #[test]
    fn variable_radius_3d_linear_sweep_has_stable_disjoint_coverage(){
        let shape=curve();
        let result=compile(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap();
        assert!(!result.is_empty());
        assert!(result.len()<=MAX_SWEEP_CUBES);
        for (i,cube) in result.iter().enumerate(){
            assert_eq!(cube.uuid,cube_uuid(SEED,i));
            assert_eq!(cube.name.as_deref(),Some(format!("pipe_v_{i}").as_str()));
            assert_eq!(cube.extra.get("box_uv"),Some(&serde_json::Value::Bool(true)));
            for other in result.iter().skip(i+1){
                assert!((0..3).any(|a|
                    cube.to[a].min(other.to[a])<=cube.from[a].max(other.from[a])));
            }
        }
        assert_eq!(result,compile(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap());
        let mut constant_radius=shape.clone();
        for knot in &mut constant_radius.stations { knot.radius=2; }
        // A radius change must affect the accepted voxelized shape, not
        // merely remain metadata in a receipt.
        assert_ne!(result,compile(&constant_radius,[0.0;3],MAX_SWEEP_CUBES).unwrap());
    }
    #[test]
    fn invalid_degenerate_reversal_and_grid_reject(){
        for (mut shape,error) in [
            (curve(),"GEOMETRY_SWEEP_STATIONS_INVALID"),
            (curve(),"GEOMETRY_SWEEP_STATION_INVALID"),
            (curve(),"GEOMETRY_SWEEP_SEGMENT_TOO_SHORT"),
            (curve(),"GEOMETRY_SWEEP_REVERSAL_UNSUPPORTED"),
            (curve(),"GEOMETRY_SWEEP_GRID_BUDGET"),
            (curve(),"GEOMETRY_SWEEP_SEED_INVALID"),
        ]{
            match error{
                "GEOMETRY_SWEEP_STATIONS_INVALID"=>shape.stations.truncate(1),
                "GEOMETRY_SWEEP_STATION_INVALID"=>shape.stations[0].radius=0,
                "GEOMETRY_SWEEP_SEGMENT_TOO_SHORT"=>
                    shape.stations[1].position=shape.stations[0].position,
                "GEOMETRY_SWEEP_REVERSAL_UNSUPPORTED"=>
                    shape.stations[2].position=[-7,0,0],
                "GEOMETRY_SWEEP_GRID_BUDGET"=>
                    shape.stations[2].position=[96,6,2],
                "GEOMETRY_SWEEP_SEED_INVALID"=>shape.uuid_seed="bad".into(),
                _=>unreachable!(),
            }
            assert_eq!(compile(&shape,[0.0;3],MAX_SWEEP_CUBES)
                .err().as_deref(),Some(error));
        }
    }
    #[test]
    fn source_uuid_is_namespace_stable_and_budget_does_not_downgrade(){
        assert_eq!(cube_uuid(SEED,0),cube_uuid(SEED,0));
        assert_ne!(cube_uuid(SEED,0),cube_uuid(SEED,1));
        assert!(compile(&curve(),[0.0;3],0).is_err());
        assert_eq!(compile(&curve(),[0.0;3],1)
            .err().as_deref(),Some("GEOMETRY_SWEEP_CUBE_BUDGET"));
    }
}

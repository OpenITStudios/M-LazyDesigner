//! G3.3/G3.4a: bounded 3D variable-radius swept-sphere blockout.
//! Default LINEAR centerline; opt-in adaptive centripetal Catmull–Rom.
//! One SOURCE-ONLY voxel raster plus deterministic disjoint-Cuboid partition.
//! No native mesh, renderer, hidden shape store, visual quality verdict,
//! anisotropic profile, transported frame, twist or Texture/UV allocation.
use super::{fail, sha256, valid_node_name, valid_uuid, Cube, Result};
use super::geometry_assembly::blockout_cube;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

const MAX_SWEEP_STATIONS: usize = 8;
pub(super) const MAX_SWEEP_CUBES: usize = 64;
pub(super) const MAX_SWEEP_CELLS: usize = 32_768;
pub(super) const MAX_SWEEP_AXIS: usize = 64;
const SURFACE_EPS: f64 = 1.0e-9;
const MAX_CURVE_SAMPLES: usize = 96;
const MAX_CURVE_DEPTH: u8 = 8;
const CURVE_POINT_EPS: f64 = 1.0e-5;

/// Integer model-unit knot positions prevent hidden subpixel assumptions.
/// Radius changes linearly across segments and remains isotropic even when
/// the centerline interpolates cubically. Anisotropic/twisted PROFILE_SWEEP
/// remains a separate, unsupported contract on this Rust branch.
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
    /// Absent means the original G3.3 LINEAR behavior and byte shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interpolation: Option<String>,
    /// Required only for CENTRIPETAL_CATMULL_ROM, 0.25..=1 model units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_chord_error: Option<f64>,
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
    source_segment: usize,
    low: [f64; 3],
    high: [f64; 3],
}

/// Exact union of linearly varying spheres swept along a straight chord.
/// The nearest-centerline method is incorrect when the radius varies.
fn contains(point: [f64; 3], segment: Segment) -> bool {
    if (0..3).any(|a| point[a] < segment.low[a] ||
        point[a] > segment.high[a]) { return false; }
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


#[derive(Clone, Copy, Debug)]
struct Sample {
    position: [f64; 3],
    radius: f64,
    // The owning interval in the caller's exact station list.
    // Subdivision cannot invent extra required material segments.
    source_segment: usize,
    /// Parametric position in this caller-authored source segment.
    t: f64,
}
fn span(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| (a[i] - b[i]).powi(2)).sum::<f64>().sqrt()
}
fn lerp(a: [f64; 3], b: [f64; 3], t: f64) -> [f64; 3] {
    std::array::from_fn(|i| a[i] * (1.0-t) + b[i] * t)
}
fn ghost(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| 2.0*a[i]-b[i])
}

/// Barry–Goldman centripetal α=1/2 Catmull–Rom centerline.
/// Endpoint ghosts are extrapolated, radius stays linearly interpolated;
/// neither a transported anisotropic frame nor a twist is inferred.
/// Adapted conceptually from this repository's Local geometryMathSweep.ts.
fn curve_position(nodes: &[Sample], segment: usize, fraction: f64)
    -> Result<[f64; 3]> {
    let p1 = nodes[segment].position;
    let p2 = nodes[segment + 1].position;
    let p0 = if segment == 0 { ghost(p1, p2) }
        else { nodes[segment - 1].position };
    let p3 = if segment + 2 == nodes.len() { ghost(p2, p1) }
        else { nodes[segment + 2].position };
    let t0 = 0.0;
    let t1 = t0 + span(p0, p1).sqrt();
    let t2 = t1 + span(p1, p2).sqrt();
    let t3 = t2 + span(p2, p3).sqrt();
    if [t1-t0,t2-t1,t3-t2].iter().any(|v| *v <= CURVE_POINT_EPS) {
        return Err(fail("GEOMETRY_SWEEP_CURVE_KNOT_UNSTABLE"));
    }
    let t = t1 + fraction * (t2-t1);
    let blend = |a, b, at, low, high| {
        lerp(a, b, (at-low)/(high-low))
    };
    let a1 = blend(p0,p1,t,t0,t1);
    let a2 = blend(p1,p2,t,t1,t2);
    let a3 = blend(p2,p3,t,t2,t3);
    let b1 = blend(a1,a2,t,t0,t2);
    let b2 = blend(a2,a3,t,t1,t3);
    let result = blend(b1,b2,t,t1,t2);
    if !result.iter().all(|v| v.is_finite()) {
        return Err(fail("GEOMETRY_SWEEP_CURVE_NONFINITE"));
    }
    Ok(result)
}
fn curve_sample(nodes: &[Sample], segment: usize, t: f64) -> Result<Sample> {
    Ok(Sample {
        position: curve_position(nodes, segment, t)?,
        radius: nodes[segment].radius +
            (nodes[segment+1].radius-nodes[segment].radius)*t,
        source_segment: segment,
        t,
    })
}
fn chord_distance_squared(point: [f64; 3], a: [f64; 3],
    b: [f64; 3]) -> f64 {
    let d: [f64; 3] = std::array::from_fn(|i| b[i]-a[i]);
    let w: [f64; 3] = std::array::from_fn(|i| point[i]-a[i]);
    let length_sq = d.iter().map(|v| v*v).sum::<f64>();
    let t = if length_sq < CURVE_POINT_EPS*CURVE_POINT_EPS {0.0}
        else {(0..3).map(|i| w[i]*d[i]).sum::<f64>()/length_sq}
            .clamp(0.0,1.0);
    (0..3).map(|i| (w[i]-t*d[i]).powi(2)).sum()
}
/// Recover the cubic Bézier controls at one and two thirds of the
/// local interval; convex-hull-to-chord distance bounds its deviation.
/// Quarter/midpoint point sampling alone is not a conservative bound.
fn curve_chord_bound(
    nodes: &[Sample], index: usize,
    from_t: f64, first: Sample, to_t: f64, last: Sample,
) -> Result<f64> {
    let third = (to_t-from_t)/3.0;
    let p1 = curve_position(nodes,index,from_t+third)?;
    let p2 = curve_position(nodes,index,from_t+2.0*third)?;
    let (a,d) = (first.position,last.position);
    let control1: [f64; 3] = std::array::from_fn(|i| {
        let x=27.0*p1[i]-8.0*a[i]-d[i];
        let y=27.0*p2[i]-a[i]-8.0*d[i];
        (2.0*x-y)/18.0
    });
    let control2: [f64; 3] = std::array::from_fn(|i| {
        let x=27.0*p1[i]-8.0*a[i]-d[i];
        let y=27.0*p2[i]-a[i]-8.0*d[i];
        (2.0*y-x)/18.0
    });
    let bound = chord_distance_squared(control1,a,d).sqrt()
        .max(chord_distance_squared(control2,a,d).sqrt());
    if !bound.is_finite() {
        return Err(fail("GEOMETRY_SWEEP_CURVE_NONFINITE"));
    }
    Ok(bound)
}
fn sample_curve_interval(
    nodes: &[Sample], interval: usize, from_t: f64, first: Sample,
    to_t: f64, last: Sample, depth: u8, tolerance: f64,
    result: &mut Vec<Sample>,
) -> Result<()> {
    let error=curve_chord_bound(nodes,interval,from_t,first,to_t,last)?;
    let too_long=span(first.position,last.position)>1.5;
    let radius_change=(first.radius-last.radius).abs()>0.75;
    if error>tolerance || too_long || radius_change {
        if depth>=MAX_CURVE_DEPTH {
            return Err(fail("GEOMETRY_SWEEP_CURVE_ADAPTIVE_LIMIT"));
        }
        let mid_t=(from_t+to_t)/2.0;
        let middle=curve_sample(nodes,interval,mid_t)?;
        sample_curve_interval(nodes,interval,from_t,first,
            mid_t,middle,depth+1,tolerance,result)?;
        sample_curve_interval(nodes,interval,mid_t,middle,
            to_t,last,depth+1,tolerance,result)?;
    } else {
        result.push(last);
        if result.len()>MAX_CURVE_SAMPLES {
            return Err(fail("GEOMETRY_SWEEP_CURVE_SAMPLE_BUDGET"));
        }
    }
    Ok(())
}
fn source_samples(shape: &GeometrySphereSweep,
    nodes: &[Sample]) -> Result<Vec<Sample>> {
    let mode = shape.interpolation.as_deref().unwrap_or("LINEAR");
    if mode=="LINEAR" {
        if shape.max_chord_error.is_some() {
            return Err(fail("GEOMETRY_SWEEP_CHORD_ERROR_UNEXPECTED"));
        }
        return Ok(nodes.to_vec());
    }
    if mode!="CENTRIPETAL_CATMULL_ROM" {
        return Err(fail("GEOMETRY_SWEEP_INTERPOLATION_UNSUPPORTED"));
    }
    if nodes.len()<3 {
        return Err(fail("GEOMETRY_SWEEP_CURVE_STATIONS_REQUIRED"));
    }
    let tolerance=shape.max_chord_error
        .filter(|v| v.is_finite() && (0.25..=1.0).contains(v))
        .ok_or_else(|| fail("GEOMETRY_SWEEP_CHORD_ERROR_INVALID"))?;
    let mut out=Vec::with_capacity(MAX_CURVE_SAMPLES);
    out.push(nodes[0]);
    for index in 0..nodes.len()-1 {
        let first=Sample {source_segment:index,t:0.0,..nodes[index]};
        let last=Sample {source_segment:index,t:1.0,..nodes[index+1]};
        sample_curve_interval(nodes,index,0.0,first,1.0,last,
            0,tolerance,&mut out)?;
    }
    Ok(out)
}

fn validate(shape: &GeometrySphereSweep) -> Result<(Vec<Segment>, [i32; 3], [usize; 3])> {
    if !valid_node_name(&shape.name) || shape.name.chars().count()>110 {
        return Err(fail("GEOMETRY_SWEEP_NAME_INVALID"));
    }
    if !valid_uuid(&shape.uuid_seed) {
        return Err(fail("GEOMETRY_SWEEP_SEED_INVALID"));
    }
    if !(2..=MAX_SWEEP_STATIONS).contains(&shape.stations.len()) {
        return Err(fail("GEOMETRY_SWEEP_STATIONS_INVALID"));
    }
    if shape.stations.iter().any(|p| p.radius<2 || p.radius>6 ||
        p.position.iter().any(|coord| !(-96..=96).contains(coord))) {
        return Err(fail("GEOMETRY_SWEEP_STATION_INVALID"));
    }
    let knots: Vec<Sample> = shape.stations.iter().enumerate()
        .map(|(i,station)| Sample {
            position: station.position.map(f64::from),
            radius: f64::from(station.radius),
            source_segment: i.saturating_sub(1),
            t: if i == 0 {0.0} else {1.0},
        }).collect();

    // Retain G3.3 original source-segment refusal precedence and semantics:
    // intermediate subdivisions are not extra independent authored parts.
    let mut previous: Option<[f64;3]>=None;
    for pair in knots.windows(2) {
        let delta: [f64;3] = std::array::from_fn(|a|
            pair[1].position[a]-pair[0].position[a]);
        let length_sq = delta.iter().map(|v| v*v).sum::<f64>();
        if length_sq<4.0 {
            return Err(fail("GEOMETRY_SWEEP_SEGMENT_TOO_SHORT"));
        }
        if let Some(prev)=previous {
            let dot=(0..3).map(|a|prev[a]*delta[a]).sum::<f64>();
            let prev_sq=prev.iter().map(|v|v*v).sum::<f64>();
            if dot < -0.98*(prev_sq*length_sq).sqrt() {
                return Err(fail("GEOMETRY_SWEEP_REVERSAL_UNSUPPORTED"));
            }
        }
        previous=Some(delta);
    }

    let samples=source_samples(shape,&knots)?;
    // Catmull-Rom can extend beyond its source knots. Bounds based on knots
    // silently clip the resulting curved volume: derive bounds from samples.
    // LINEAR remains byte-equivalent to the original integer-knot envelope.
    let outer=shape.stations.iter().map(|s|i32::from(s.radius)).max()
        .ok_or_else(||fail("GEOMETRY_SWEEP_STATIONS_INVALID"))?;
    let low: [i32;3] = std::array::from_fn(|a|
        samples.iter().map(|s|s.position[a])
            .fold(f64::INFINITY,f64::min).floor() as i32-outer);
    let high: [i32;3] = std::array::from_fn(|a|
        samples.iter().map(|s|s.position[a])
            .fold(f64::NEG_INFINITY,f64::max).ceil() as i32+outer);
    let mut size=[0usize;3];
    for a in 0..3 {
        let len=usize::try_from(high[a]-low[a])
            .map_err(|_|fail("GEOMETRY_SWEEP_GRID_BUDGET"))?;
        if len==0 || len>MAX_SWEEP_AXIS {
            return Err(fail("GEOMETRY_SWEEP_GRID_BUDGET"));
        }
        size[a]=len;
    }
    let cell_count=size.iter().try_fold(1usize,|acc,n|acc.checked_mul(*n))
        .ok_or_else(||fail("GEOMETRY_SWEEP_GRID_BUDGET"))?;
    if cell_count>MAX_SWEEP_CELLS {
        return Err(fail("GEOMETRY_SWEEP_GRID_BUDGET"));
    }

    let mut segments=Vec::with_capacity(samples.len()-1);
    for pair in samples.windows(2) {
        let delta: [f64;3] = std::array::from_fn(|a|
            pair[1].position[a]-pair[0].position[a]);
        let length_sq=delta.iter().map(|v|v*v).sum::<f64>();
        if length_sq<CURVE_POINT_EPS*CURVE_POINT_EPS {
            return Err(fail("GEOMETRY_SWEEP_CURVE_DEGENERATE_SAMPLE"));
        }
        let (radius,other)=(pair[0].radius,pair[1].radius);
        let extent=radius.max(other);
        segments.push(Segment {
            start:pair[0].position,
            delta,
            radius,
            radius_delta:other-radius,
            quadratic_a:length_sq-(other-radius)*(other-radius),
            source_segment:pair[1].source_segment,
            low:std::array::from_fn(|a|pair[0].position[a]
                .min(pair[1].position[a])-extent),
            high:std::array::from_fn(|a|pair[0].position[a]
                .max(pair[1].position[a])+extent),
        });
    }
    Ok((segments,low,size))
}

fn index(x: usize,y: usize,z: usize, size:[usize;3])->usize{
    (y*size[2]+z)*size[0]+x
}

/// Exact accepted occupancy in one source-local voxel grid. Reject disconnected
/// material before partitioning: face contact, not diagonal proximity.
pub(super) fn partition(occupied: &[bool],size:[usize;3],low:[i32;3],limit:usize)
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
    let mut observed=vec![false;shape.stations.len()-1];
    for y in 0..size[1] {for z in 0..size[2] {for x in 0..size[0]{
        let point=[low[0] as f64+x as f64+0.5,
            low[1] as f64+y as f64+0.5,
            low[2] as f64+z as f64+0.5];
        for segment in &segments {
            if contains(point,*segment){
                occupied[index(x,y,z,size)]=true;
                observed[segment.source_segment]=true;
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
            stations:vec![station(-4,0,0,2),station(0,2,0,3),station(4,3,1,2)],
            interpolation: None, max_chord_error: None,
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

    fn curved() -> GeometrySphereSweep {
        let mut shape=curve();
        shape.interpolation=Some("CENTRIPETAL_CATMULL_ROM".into());
        shape.max_chord_error=Some(0.5);
        shape
    }

    #[test]
    fn g34_centripetal_curve_samples_are_bounded_and_keep_exact_source_knots() {
        let shape=curved();
        let knots: Vec<Sample> = shape.stations.iter().enumerate()
            .map(|(i,k)|Sample {
                position:k.position.map(f64::from),
                radius:f64::from(k.radius),
                source_segment:i.saturating_sub(1),
                t:if i==0 {0.0} else {1.0},
            }).collect();
        let samples=source_samples(&shape,&knots).unwrap();
        assert!(samples.len()>knots.len());
        assert!(samples.len()<=MAX_CURVE_SAMPLES);
        assert_eq!(samples[0].position,knots[0].position);
        assert_eq!(samples.last().unwrap().position,knots.last().unwrap().position);
        assert_eq!(samples[0].radius,knots[0].radius);
        assert_eq!(samples.last().unwrap().radius,knots.last().unwrap().radius);

        let mut curvature_observed=false;
        for pair in samples.windows(2) {
            let source=pair[1].source_segment;
            let start_t=if pair[0].source_segment==source {pair[0].t} else {0.0};
            let start=Sample{source_segment:source,t:start_t,..pair[0]};
            let error=curve_chord_bound(
                &knots,source,start_t,start,pair[1].t,pair[1]).unwrap();
            assert!(error <= 0.5+1.0e-7);
            assert!(span(start.position,pair[1].position)<=1.5+1.0e-7);
            assert!((start.radius-pair[1].radius).abs()<=0.75+1.0e-7);
        }
        // The spline is not merely relabelled original LINEAR segments.
        for sample in &samples {
            let source=sample.source_segment;
            if sample.t<=0.0 || sample.t>=1.0 {continue;}
            let linear=lerp(knots[source].position,knots[source+1].position,sample.t);
            if span(linear,sample.position)>0.01 {curvature_observed=true;}
        }
        assert!(curvature_observed);
    }

    #[test]
    fn g34_curved_sweep_keeps_disjoint_bedrock_cubes_and_no_false_visual_approval() {
        let shape=curved();
        let cubes=compile(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap();
        assert!(!cubes.is_empty());
        assert!(cubes.len()<=MAX_SWEEP_CUBES);
        for (i,cube) in cubes.iter().enumerate() {
            assert_eq!(cube.uuid,cube_uuid(SEED,i));
            assert_eq!(cube.extra.get("box_uv"),
                Some(&serde_json::Value::Bool(true)));
            assert!(cube.faces.values().all(|face|face.get("texture").is_none()));
            for other in cubes.iter().skip(i+1){
                assert!((0..3).any(|axis|
                    cube.to[axis].min(other.to[axis]) <=
                    cube.from[axis].max(other.from[axis])));
            }
        }
        assert_eq!(cubes,compile(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap());
    }

    #[test]
    fn g34_refuses_unknown_modes_missing_error_and_unrepresentable_inputs() {
        let base=curved();
        for (variant,error) in [
            (0,"GEOMETRY_SWEEP_INTERPOLATION_UNSUPPORTED"),
            (1,"GEOMETRY_SWEEP_CHORD_ERROR_INVALID"),
            (2,"GEOMETRY_SWEEP_CHORD_ERROR_INVALID"),
            (3,"GEOMETRY_SWEEP_CURVE_STATIONS_REQUIRED"),
            (4,"GEOMETRY_SWEEP_CHORD_ERROR_UNEXPECTED"),
        ]{
            let mut shape=base.clone();
            match variant {
                0=>shape.interpolation=Some("CATMULL_ROM_UNBOUNDED".into()),
                1=>shape.max_chord_error=None,
                2=>shape.max_chord_error=Some(0.1),
                3=>shape.stations.truncate(2),
                4=>shape.interpolation=Some("LINEAR".into()),
                _=>unreachable!(),
            }
            assert_eq!(compile(&shape,[0.0;3],MAX_SWEEP_CUBES)
                .err().as_deref(),Some(error));
        }
        // Existing G3.3 request JSON remains identical when opt-in absent.
        let original=serde_json::to_value(curve()).unwrap();
        assert!(original.get("interpolation").is_none());
        assert!(original.get("max_chord_error").is_none());
        assert!(serde_json::from_value::<GeometrySphereSweep>(
            serde_json::json!({
                "name":"pipe","uuid_seed":SEED,
                "stations":[
                    {"position":[-4,0,0],"radius":2},
                    {"position":[0,2,0],"radius":3},
                    {"position":[4,3,1],"radius":2}
                ],"interpolation":"CENTRIPETAL_CATMULL_ROM",
                "max_chord_error":0.5,"unknown":1
            })
        ).is_err());
    }

}

//! G3.4b: one opt-in, source-local anisotropic profile sweep blockout.
//! A LINEAR polyline carries elliptical/rectangular cross sections through
//! parallel-transported minimum-rotation frames. It reuses the G3.3 voxel
//! partition and the ONE G1 AddBone/AddCube plan. SOURCE ONLY / NOT EXECUTED.
//! No interpolated spline, authored twist, mesh or UV/visual certification.
use super::{fail, sha256, valid_node_name, valid_uuid, Cube, Result};
use super::geometry_assembly::blockout_cube;
use super::geometry_sweep::{
    partition, MAX_SWEEP_AXIS, MAX_SWEEP_CELLS, MAX_SWEEP_CUBES,
};
use serde::{Deserialize, Serialize};

type Vec3 = [f64; 3];
const EPS: f64 = 1.0e-8;
const MIN_UP_SINE: f64 = 1.0e-4;
const MAX_STATIONS: usize = 8;
const MATERIAL_TAPER_DELTA: f64 = 1.0;
const MIN_OBSERVED_TAPER: f64 = 0.5;
const MATERIAL_TWIST_DEGREES: f64 = 45.0;
const MATERIAL_TWIST_ANISOTROPY: f64 = 1.0;
fn zero_twist(degrees: &f64) -> bool { *degrees == 0.0 }

/// Coordinates in native model units. No inferred dimensions or rotation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryProfileStation {
    pub position: [i32; 3],
    pub half_width: u8,
    pub half_height: u8,
    /// Optional authored roll about the transported tangent, in degrees.
    #[serde(default, skip_serializing_if = "zero_twist")]
    pub twist_degrees: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryProfileSweep {
    pub name: String,
    pub uuid_seed: String,
    pub stations: Vec<GeometryProfileStation>,
    /// The caller defines the initial roll through X, Y or Z.
    pub up_axis: String,
    /// ELLIPSE or RECTANGLE; fixed for the entire swept form.
    pub cross_section: String,
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum Section { Ellipse, Rectangle }
#[derive(Clone, Copy, Debug)]
struct Segment {
    from: Vec3, tangent: Vec3, normal: Vec3, binormal: Vec3,
    length: f64, half_width: [f64; 2], half_height: [f64; 2],
    twist: [f64; 2], low: Vec3, high: Vec3,
}
#[derive(Clone, Copy, Default)]
struct TaperBand {
    cells: usize,
    radial: [f64; 2],
}
#[derive(Clone, Copy, Default)]
struct TaperObservation {
    start: TaperBand,
    end: TaperBand,
}
fn dot(a: Vec3, b: Vec3) -> f64 {
    (0..3).map(|axis| a[axis] * b[axis]).sum()
}
fn sub(a: Vec3, b: Vec3) -> Vec3 {
    std::array::from_fn(|axis| a[axis] - b[axis])
}
fn add(a: Vec3, b: Vec3) -> Vec3 {
    std::array::from_fn(|axis| a[axis] + b[axis])
}
fn mul(a: Vec3, factor: f64) -> Vec3 {
    a.map(|value| value * factor)
}
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn magnitude(a: Vec3) -> f64 {
    dot(a, a).sqrt()
}
fn unit(a:Vec3)->Result<Vec3>{
    let length=magnitude(a);
    if !length.is_finite()||length<EPS{
        return Err(fail("GEOMETRY_PROFILE_FRAME_DEGENERATE"));
    }
    Ok(mul(a,1.0/length))
}
fn rotate(v:Vec3,axis:Vec3,theta:f64)->Vec3 {
    // Rodrigues rotation about a normalized axis, preserving handedness.
    let (sin,cos)=(theta.sin(),theta.cos());
    add(add(mul(v,cos),mul(cross(axis,v),sin)),
        mul(axis,dot(axis,v)*(1.0-cos)))
}
fn shape_uuid(seed:&str,index:usize)->String{
    let digest=sha256(format!(
        "lazydesigner:geometry-profile-v1\0{seed}\0{index}"
    ).as_bytes());
    format!("{}-{}-4{}-8{}-{}",
        &digest[..8],&digest[8..12],&digest[13..16],
        &digest[17..20],&digest[20..32])
}
pub(super) fn cube_uuid(seed:&str,index:usize)->String {
    shape_uuid(seed,index)
}

fn frames(shape:&GeometryProfileSweep)->Result<(Vec<Segment>,[i32;3],[usize;3],Section)>{
    if !valid_node_name(&shape.name)||shape.name.chars().count()>110{
        return Err(fail("GEOMETRY_PROFILE_NAME_INVALID"));
    }
    if !valid_uuid(&shape.uuid_seed){
        return Err(fail("GEOMETRY_PROFILE_SEED_INVALID"));
    }
    if !(2..=MAX_STATIONS).contains(&shape.stations.len()){
        return Err(fail("GEOMETRY_PROFILE_STATIONS_INVALID"));
    }
    if shape.stations.iter().any(|s|
        !(1..=6).contains(&s.half_width)||
        !(1..=6).contains(&s.half_height)||
        s.position.iter().any(|v|!(-96..=96).contains(v))){
        return Err(fail("GEOMETRY_PROFILE_STATION_INVALID"));
    }
    if shape.stations.iter().any(|s|
        !s.twist_degrees.is_finite() || s.twist_degrees.abs() > 180.0) {
        return Err(fail("GEOMETRY_PROFILE_TWIST_INVALID"));
    }
    let section=match shape.cross_section.as_str(){
        "ELLIPSE"=>Section::Ellipse,
        "RECTANGLE"=>Section::Rectangle,
        _=>return Err(fail("GEOMETRY_PROFILE_SECTION_UNSUPPORTED")),
    };
    let up=match shape.up_axis.as_str(){
        "X"=>[1.0,0.0,0.0],
        "Y"=>[0.0,1.0,0.0],
        "Z"=>[0.0,0.0,1.0],
        _=>return Err(fail("GEOMETRY_PROFILE_UP_AXIS_INVALID")),
    };
    let mut segments=Vec::with_capacity(shape.stations.len()-1);
    let mut prev: Option<(Vec3,Vec3)>=None;
    for pair in shape.stations.windows(2){
        let from=pair[0].position.map(f64::from);
        let to=pair[1].position.map(f64::from);
        let delta=sub(to,from);
        let length=magnitude(delta);
        if !length.is_finite()||length<2.0{
            return Err(fail("GEOMETRY_PROFILE_STATION_SEPARATION"));
        }
        let tangent=mul(delta,1.0/length);
        let normal=if let Some((old_tangent,old_normal))=prev {
            let cosine=dot(old_tangent,tangent).clamp(-1.0,1.0);
            if cosine< -1.0+EPS {
                return Err(fail("GEOMETRY_PROFILE_REVERSAL_UNSUPPORTED"));
            }
            let axis=cross(old_tangent,tangent);
            let sine=magnitude(axis);
            let transported=if sine<EPS {old_normal}
                else {rotate(old_normal,mul(axis,1.0/sine),
                    sine.atan2(cosine))};
            // Remove any floating-point drift without choosing a new roll.
            unit(sub(transported,mul(tangent,dot(transported,tangent))))?
        }else{
            let projected=sub(up,mul(tangent,dot(up,tangent)));
            let sine=magnitude(projected);
            if sine<EPS {
                return Err(fail("GEOMETRY_PROFILE_UP_AXIS_PARALLEL"));
            }
            if sine<MIN_UP_SINE {
                return Err(fail("GEOMETRY_PROFILE_UP_AXIS_UNSTABLE"));
            }
            mul(projected,1.0/sine)
        };
        let binormal=unit(cross(tangent,normal))?;
        let w=[f64::from(pair[0].half_width),f64::from(pair[1].half_width)];
        let h=[f64::from(pair[0].half_height),f64::from(pair[1].half_height)];
        let twist=[pair[0].twist_degrees,pair[1].twist_degrees];
        let outer=w.into_iter().zip(h).map(|(a,b)|a.hypot(b))
            .fold(0.0,f64::max);
        let low=std::array::from_fn(|i|from[i].min(to[i])-outer);
        let high=std::array::from_fn(|i|from[i].max(to[i])+outer);
        segments.push(Segment{
            from,tangent,normal,binormal,length,half_width:w,
            half_height:h,twist,low,high,
        });
        prev=Some((tangent,normal));
    }
    let low:[i32;3]=std::array::from_fn(|i|
        (segments.iter().map(|s|s.low[i]).fold(f64::INFINITY,f64::min)
            -0.5).floor() as i32);
    let high:[i32;3]=std::array::from_fn(|i|
        (segments.iter().map(|s|s.high[i]).fold(f64::NEG_INFINITY,f64::max)
            +0.5).ceil() as i32);
    let mut size=[0usize;3];
    for i in 0..3{
        let distance=usize::try_from(high[i]-low[i])
            .map_err(|_|fail("GEOMETRY_PROFILE_GRID_BUDGET"))?;
        if distance==0||distance>MAX_SWEEP_AXIS {
            return Err(fail("GEOMETRY_PROFILE_GRID_BUDGET"));
        }
        size[i]=distance;
    }
    let cells=size.iter().try_fold(1usize,|n,x|n.checked_mul(*x))
        .ok_or_else(||fail("GEOMETRY_PROFILE_GRID_BUDGET"))?;
    if cells>MAX_SWEEP_CELLS {
        return Err(fail("GEOMETRY_PROFILE_GRID_BUDGET"));
    }
    Ok((segments,low,size,section))
}

// Preserve the old zero-twist path without trigonometry on every voxel.
fn oriented_axes(segment: &Segment, degrees: f64) -> (Vec3, Vec3) {
    if degrees == 0.0 { return (segment.normal, segment.binormal); }
    let (sin, cos) = degrees.to_radians().sin_cos();
    (
        add(mul(segment.normal, cos), mul(segment.binormal, sin)),
        add(mul(segment.binormal, cos), mul(segment.normal, -sin)),
    )
}

/// Flat-ended generalized prism. Width, height and authored roll interpolate
/// linearly; the underlying parallel-transport frame is kept per segment.
fn contains(point:Vec3,segment:&Segment,section:Section,
    fixed_twist:Option<f64>)->bool{
    if (0..3).any(|i|point[i]<segment.low[i]-EPS ||
        point[i]>segment.high[i]+EPS){return false;}
    let relative=sub(point,segment.from);
    let axial=dot(relative,segment.tangent);
    if axial< -EPS||axial>segment.length+EPS {return false;}
    let t=(axial/segment.length).clamp(0.0,1.0);
    let centre=add(segment.from,mul(segment.tangent,t*segment.length));
    let w=segment.half_width[0]+
        (segment.half_width[1]-segment.half_width[0])*t;
    let h=segment.half_height[0]+
        (segment.half_height[1]-segment.half_height[0])*t;
    let offset=sub(point,centre);
    let twist=fixed_twist.unwrap_or(segment.twist[0]+
        (segment.twist[1]-segment.twist[0])*t);
    let (normal,binormal)=oriented_axes(segment,twist);
    let u=dot(offset,normal)/w;
    let v=dot(offset,binormal)/h;
    match section{
        Section::Rectangle=>u.abs()<=1.0+EPS&&v.abs()<=1.0+EPS,
        Section::Ellipse=>u*u+v*v<=1.0+EPS,
    }
}
fn needs_taper_review(segment: &Segment) -> bool {
    [segment.half_width, segment.half_height]
        .iter().any(|width| (width[1] - width[0]).abs() >= MATERIAL_TAPER_DELTA)
}

// Observe only occupied cells near each authored endpoint, in its local frame.
fn observe_taper(point: Vec3, segment: &Segment, observed: &mut TaperObservation) {
    let axial = dot(sub(point, segment.from), segment.tangent);
    let band = (segment.length / 3.0).min(1.0);
    let near_start = axial <= band + EPS;
    let near_end = segment.length - axial <= band + EPS;
    if !near_start && !near_end { return; }
    let center = add(segment.from, mul(segment.tangent, axial.clamp(0.0, segment.length)));
    let offset = sub(point, center);
    let t = (axial / segment.length).clamp(0.0, 1.0);
    let (normal, binormal) = oriented_axes(segment,
        segment.twist[0] + (segment.twist[1] - segment.twist[0]) * t);
    let radial = [dot(offset, normal).abs(), dot(offset, binormal).abs()];
    let record = |sample: &mut TaperBand| {
        sample.cells += 1;
        for (max_radius, radius) in sample.radial.iter_mut().zip(radial) {
            *max_radius = (*max_radius).max(radius);
        }
    };
    if near_start { record(&mut observed.start); }
    if near_end { record(&mut observed.end); }
}

fn require_taper_signal(segments: &[Segment], observed: &[TaperObservation]) -> Result<()> {
    for (segment, sample) in segments.iter().zip(observed) {
        if !needs_taper_review(segment) { continue; }
        if sample.start.cells == 0 || sample.end.cells == 0 {
            return Err(fail("GEOMETRY_PROFILE_TAPER_UNREPRESENTED"));
        }
        for (axis, width) in [segment.half_width, segment.half_height].iter().enumerate() {
            let authored = width[1] - width[0];
            if authored.abs() < MATERIAL_TAPER_DELTA { continue; }
            let represented = (sample.end.radial[axis] - sample.start.radial[axis])
                * authored.signum();
            if !represented.is_finite() || represented < MIN_OBSERVED_TAPER - EPS {
                return Err(fail("GEOMETRY_PROFILE_TAPER_UNREPRESENTED"));
            }
        }
    }
    Ok(())
}
fn needs_twist_review(segment: &Segment) -> bool {
    (segment.twist[1] - segment.twist[0]).abs() >= MATERIAL_TWIST_DEGREES &&
        segment.half_width.iter().zip(segment.half_height).any(|(w, h)|
            (*w - h).abs() >= MATERIAL_TWIST_ANISOTROPY)
}
fn require_twist_signal(segments: &[Segment],
    represented: &[bool; MAX_STATIONS - 1]) -> Result<()> {
    if segments.iter().enumerate().any(|(i, segment)|
        needs_twist_review(segment) && !represented[i]) {
        return Err(fail("GEOMETRY_PROFILE_TWIST_UNREPRESENTED"));
    }
    Ok(())
}
fn index(x:usize,y:usize,z:usize,size:[usize;3])->usize{
    (y*size[2]+z)*size[0]+x
}
fn near_joint(
    cell: usize, size: [usize; 3], low: [i32; 3],
    joint: Vec3, radius_squared: f64,
) -> bool {
    let x = cell % size[0];
    let z = (cell / size[0]) % size[2];
    let y = cell / (size[0] * size[2]);
    let point = [
        low[0] as f64 + x as f64 + 0.5,
        low[1] as f64 + y as f64 + 0.5,
        low[2] as f64 + z as f64 + 0.5,
    ];
    let delta = sub(point, joint);
    dot(delta, delta) <= radius_squared
}
/// Source segments must meet through occupied face-connected voxels
/// NEAR the declared shared station. Global connected mass alone could
/// hide a broken joint through a distant third-party segment.
fn require_joints(ownership:&[u8],size:[usize;3],low:[i32;3],
    stations:&[GeometryProfileStation])->Result<()> {
    for segment in 0..stations.len()-2 {
        let (a,b)=(1u8<<segment,1u8<<(segment+1));
        let joint = &stations[segment + 1];
        let joint_position = joint.position.map(f64::from);
        let radius = f64::from(joint.half_width)
            .hypot(f64::from(joint.half_height))
            + 3.0_f64.sqrt() / 2.0 + EPS;
        let radius_squared = radius * radius;
        let mut connected = false;
        for cell in 0..ownership.len() {
            if ownership[cell] & a == 0 ||
                !near_joint(cell, size, low, joint_position, radius_squared) {
                continue;
            }
            let x=cell%size[0];
            let z=(cell/size[0])%size[2];
            let y=cell/(size[0]*size[2]);
            let neigh=[
                Some(cell),
                if x>0 {Some(cell-1)} else {None},
                if x+1<size[0] {Some(cell+1)} else {None},
                if z>0 {Some(cell-size[0])} else {None},
                if z+1<size[2] {Some(cell+size[0])} else {None},
                if y>0 {Some(cell-size[0]*size[2])} else {None},
                if y+1<size[1] {Some(cell+size[0]*size[2])} else {None},
            ];
            if neigh.into_iter().flatten().any(|next|
                ownership[next] & b != 0 &&
                near_joint(next, size, low, joint_position, radius_squared)) {
                connected=true;
                break;
            }
        }
        if !connected {
            return Err(fail("GEOMETRY_PROFILE_JOINT_DISCONNECTED"));
        }
    }
    Ok(())
}

pub(super) fn compile(
    shape: &GeometryProfileSweep,
    bone_origin: [f64; 3],
    max_cubes: usize,
) -> Result<Vec<Cube>> {
    if max_cubes==0 {return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));}
    let (segments,low,size,section)=frames(shape)?;
    let count=size[0]*size[1]*size[2];
    let mut owned=vec![0u8;count];
    let mut occupied=vec![false;count];
    let mut review_taper = [false; MAX_STATIONS - 1];
    let mut taper = [TaperObservation::default(); MAX_STATIONS - 1];
    let mut review_twist = [false; MAX_STATIONS - 1];
    let mut represented_twist = [false; MAX_STATIONS - 1];
    for (index, segment) in segments.iter().enumerate() {
        review_taper[index] = needs_taper_review(segment);
        review_twist[index] = needs_twist_review(segment);
    }
    for y in 0..size[1]{for z in 0..size[2]{for x in 0..size[0]{
        let point=[low[0] as f64+x as f64+0.5,
            low[1] as f64+y as f64+0.5,low[2] as f64+z as f64+0.5];
        let offset=index(x,y,z,size);
        for (segment,frame) in segments.iter().enumerate(){
            let included=contains(point,frame,section,None);
            if review_twist[segment] && !represented_twist[segment] &&
                included != contains(point,frame,section,Some(frame.twist[0])) {
                represented_twist[segment]=true;
            }
            if included {
                owned[offset]|=1u8<<segment;
                occupied[offset]=true;
                if review_taper[segment] {
                    observe_taper(point, frame, &mut taper[segment]);
                }
            }
        }
    }}}
    for i in 0..segments.len(){
        if !owned.iter().any(|bits|bits&(1u8<<i)!=0){
            return Err(fail("GEOMETRY_PROFILE_SEGMENT_LOST"));
        }
    }
    require_joints(&owned,size,low,&shape.stations)?;
    require_taper_signal(&segments, &taper)?;
    require_twist_signal(&segments, &represented_twist)?;
    let cubes=partition(&occupied,size,low,max_cubes.min(MAX_SWEEP_CUBES))?;
    Ok(cubes.into_iter().enumerate().map(|(i,(from,to))|
        blockout_cube(&cube_uuid(&shape.uuid_seed,i),
            format!("{}_v_{}",shape.name,i),from,to,bone_origin)
    ).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    const SEED:&str="00000000-0000-4000-8000-000000004501";
    fn station(x:i32,y:i32,z:i32,w:u8,h:u8)->GeometryProfileStation{
        GeometryProfileStation{position:[x,y,z],half_width:w,half_height:h,twist_degrees:0.0}
    }
    fn sample()->GeometryProfileSweep{
        GeometryProfileSweep{
            name:"vent".into(),uuid_seed:SEED.into(),
            up_axis:"Y".into(),cross_section:"RECTANGLE".into(),
            stations:vec![
                station(-5,0,0,2,2),
                station(0,0,0,3,2),
                station(0,0,5,3,2),
            ],
        }
    }
    #[test]
    fn frame_parallel_transport_is_orthonormal_and_preserves_up_axis(){
        let mut shape=sample();
        shape.stations[2].position=[0,5,0];
        let (f,_,_,_)=frames(&shape).unwrap();
        assert_eq!(f.len(),2);
        assert!((dot(f[0].normal,[0.0,1.0,0.0])-1.0).abs()<1e-9);
        assert!((dot(f[1].normal,[-1.0,0.0,0.0])-1.0).abs()<1e-9);
        for seg in &f{
            assert!(dot(seg.tangent,seg.normal).abs()<1e-9);
            assert!(dot(seg.tangent,seg.binormal).abs()<1e-9);
            assert!(dot(seg.normal,seg.binormal).abs()<1e-9);
            assert!((magnitude(seg.normal)-1.0).abs()<1e-9);
        }
    }
    #[test]
    fn rectangle_and_ellipse_use_distinct_real_corners_and_flat_end_caps(){
        let shape=GeometryProfileSweep{
            name:"cross".into(),uuid_seed:SEED.into(),up_axis:"Y".into(),
            cross_section:"RECTANGLE".into(),
            stations:vec![station(-6,0,0,2,2),station(0,0,0,2,2)],
        };
        let (frames,_,_,_)=frames(&shape).unwrap();
        let corner=[-3.0,1.5,1.5];
        assert!(contains(corner,&frames[0],Section::Rectangle,None));
        assert!(!contains(corner,&frames[0],Section::Ellipse,None));
        assert!(!contains([1.0,0.0,0.0],&frames[0],Section::Rectangle,None));
    }
    #[test]
    fn mixed_profile_sweep_is_disjoint_deterministic_and_preserves_source(){
        let shape=sample();
        let before=serde_json::to_value(&shape).unwrap();
        let cubes=compile(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap();
        assert!(!cubes.is_empty());
        assert!(cubes.len()<=MAX_SWEEP_CUBES);
        for (i,cube) in cubes.iter().enumerate(){
            assert_eq!(cube.uuid,cube_uuid(SEED,i));
            assert_eq!(cube.name.as_deref(),Some(format!("vent_v_{i}").as_str()));
            assert_eq!(cube.extra.get("box_uv"),
                Some(&serde_json::Value::Bool(true)));
            assert!(cube.faces.values().all(|f|f.get("texture").is_none()));
            for other in cubes.iter().skip(i+1){
                assert!((0..3).any(|a|
                    cube.to[a].min(other.to[a])<=cube.from[a].max(other.from[a])));
            }
        }
        assert_eq!(cubes,compile(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap());
        assert_eq!(before,serde_json::to_value(&shape).unwrap());

        // A declared 1-unit width change must affect local membership:
        // the same radius offset is outside near start, inside near end.
        let (segments,_,_,_)=frames(&shape).unwrap();
        assert!(!contains([-4.5,2.5,0.0],&segments[0],Section::Rectangle,None));
        assert!(contains([-0.5,2.5,0.0],&segments[0],Section::Rectangle,None));
        let mut constant_width=shape.clone();
        for station in &mut constant_width.stations { station.half_width=2; }
        assert_ne!(cubes,compile(&constant_width,[0.0;3],MAX_SWEEP_CUBES).unwrap());
    }
    #[test]
    fn profile_invalid_inputs_and_budget_refuse_without_fallback(){
        for (variant,expected) in [
            (0,"GEOMETRY_PROFILE_UP_AXIS_INVALID"),
            (1,"GEOMETRY_PROFILE_UP_AXIS_PARALLEL"),
            (2,"GEOMETRY_PROFILE_SECTION_UNSUPPORTED"),
            (3,"GEOMETRY_PROFILE_SEED_INVALID"),
            (4,"GEOMETRY_PROFILE_STATION_INVALID"),
            (5,"GEOMETRY_PROFILE_STATIONS_INVALID"),
            (6,"GEOMETRY_PROFILE_STATION_SEPARATION"),
            (7,"GEOMETRY_PROFILE_REVERSAL_UNSUPPORTED"),
            (8,"GEOMETRY_PROFILE_GRID_BUDGET"),
        ]{
            let mut shape=sample();
            match variant{
                0=>shape.up_axis="Q".into(),
                1=>shape.stations[1].position=[-5,5,0],
                2=>shape.cross_section="MESH".into(),
                3=>shape.uuid_seed="bad".into(),
                4=>shape.stations[1].half_width=0,
                5=>shape.stations.truncate(1),
                6=>shape.stations[1].position=shape.stations[0].position,
                7=>shape.stations[2].position=[-5,0,0],
                8=>shape.stations[2].position=[96,0,5],
                _=>unreachable!(),
            }
            assert_eq!(compile(&shape,[0.0;3],MAX_SWEEP_CUBES)
                .err().as_deref(),Some(expected));
        }
        assert_eq!(compile(&sample(),[0.0;3],1)
            .err().as_deref(),Some("GEOMETRY_SWEEP_CUBE_BUDGET"));
        assert_eq!(cube_uuid(SEED,0),cube_uuid(SEED,0));
        assert_ne!(cube_uuid(SEED,0),cube_uuid(SEED,1));
    }
    #[test]
    fn material_taper_must_survive_one_unit_voxelization() {
        let mut shape = GeometryProfileSweep {
            name: "aliased".into(), uuid_seed: SEED.into(),
            up_axis: "Y".into(), cross_section: "ELLIPSE".into(),
            stations: vec![station(-2, 0, 0, 2, 1), station(2, 0, 0, 3, 1)],
        };
        // This narrow ellipse changes mathematically, but the voxel
        // centers in both endpoint bands have the same lateral extent.
        assert_eq!(compile(&shape, [0.0; 3], MAX_SWEEP_CUBES)
            .err().as_deref(), Some("GEOMETRY_PROFILE_TAPER_UNREPRESENTED"));
        // The identical taper on a rectangular section is visible.
        shape.cross_section = "RECTANGLE".into();
        assert!(!compile(&shape, [0.0; 3], MAX_SWEEP_CUBES)
            .unwrap().is_empty());
        // An untapered ellipse stays supported without an extra admission gate.
        shape.cross_section = "ELLIPSE".into();
        shape.stations[1].half_width = shape.stations[0].half_width;
        assert!(!compile(&shape, [0.0; 3], MAX_SWEEP_CUBES)
            .unwrap().is_empty());
    }
    #[test]
    fn missing_or_zero_twist_preserves_legacy_wire_and_voxels() {
        let old=sample();
        let old_json=serde_json::to_value(&old).unwrap();
        assert!(old_json["stations"][0].get("twist_degrees").is_none());
        let mut with_zero=old_json.clone();
        with_zero["stations"][0]["twist_degrees"]=serde_json::json!(0.0);
        let decoded:GeometryProfileSweep=serde_json::from_value(with_zero).unwrap();
        assert_eq!(serde_json::to_value(&decoded).unwrap(),old_json);
        assert_eq!(compile(&old,[0.0;3],MAX_SWEEP_CUBES).unwrap(),
            compile(&decoded,[0.0;3],MAX_SWEEP_CUBES).unwrap());
    }
    #[test]
    fn authored_twist_changes_section_membership_and_generated_cubes() {
        let mut shape=GeometryProfileSweep {
            name:"twisted".into(),uuid_seed:SEED.into(),
            up_axis:"Y".into(),cross_section:"RECTANGLE".into(),
            stations:vec![station(-2,0,0,3,1),station(2,0,0,3,1)],
        };
        shape.stations[1].twist_degrees=90.0;
        let (segments,_,_,_)=frames(&shape).unwrap();
        let sampled_point=[-0.5,1.5,1.5];
        assert!(contains(sampled_point,&segments[0],Section::Rectangle,None));
        assert!(!contains(sampled_point,&segments[0],Section::Rectangle,Some(0.0)));
        let json=serde_json::to_value(&shape).unwrap();
        let generated=compile(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap();
        assert!(!generated.is_empty());
        assert!(generated.len()<=MAX_SWEEP_CUBES);
        assert_eq!(serde_json::to_value(&shape).unwrap(),json);
        shape.stations[1].twist_degrees=0.0;
        assert_ne!(generated,compile(&shape,[0.0;3],MAX_SWEEP_CUBES).unwrap());
    }
    #[test]
    fn material_twist_guard_and_invalid_angles_refuse_without_fallback() {
        let mut shape=GeometryProfileSweep {
            name:"twist".into(),uuid_seed:SEED.into(),
            up_axis:"Y".into(),cross_section:"ELLIPSE".into(),
            stations:vec![station(-2,0,0,3,1),station(2,0,0,3,1)],
        };
        shape.stations[1].twist_degrees=90.0;
        let (segments,_,_,_)=frames(&shape).unwrap();
        assert!(needs_twist_review(&segments[0]));
        let mut seen=[false; MAX_STATIONS - 1];
        assert_eq!(require_twist_signal(&segments,&seen).err().as_deref(),
            Some("GEOMETRY_PROFILE_TWIST_UNREPRESENTED"));
        seen[0]=true;
        assert!(require_twist_signal(&segments,&seen).is_ok());
        // A symmetric section has no meaningful twist occupancy signal.
        shape.stations[0].half_height=3;
        shape.stations[1].half_height=3;
        let (symmetric,_,_,_)=frames(&shape).unwrap();
        assert!(!needs_twist_review(&symmetric[0]));
        assert!(require_twist_signal(&symmetric,&[false; MAX_STATIONS - 1]).is_ok());
        for angle in [-181.0,181.0,f64::NAN,f64::INFINITY] {
            shape.stations[0].twist_degrees=angle;
            assert_eq!(frames(&shape).err().as_deref(),
                Some("GEOMETRY_PROFILE_TWIST_INVALID"));
        }
        let mut invalid_json=serde_json::to_value(&sample()).unwrap();
        invalid_json["stations"][0]["twist_degrees"]=serde_json::json!("90");
        assert!(serde_json::from_value::<GeometryProfileSweep>(invalid_json).is_err());
    }
    #[test]
    fn joints_must_contact_near_station_not_through_distant_mass(){
        let grid=[4,1,1];
        let stations=[station(0,0,0,1,1),station(1,0,0,1,1),
            station(2,0,0,1,1)];
        assert_eq!(require_joints(&[1,0,0,2],grid,[0,0,0],&stations)
            .err().as_deref(),Some("GEOMETRY_PROFILE_JOINT_DISCONNECTED"));
        assert!(require_joints(&[1,3,2,0],grid,[0,0,0],&stations).is_ok());
    }
}

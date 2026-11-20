//! G6 deterministic, parameterized sequence of disjoint native Cube ribs.
//! Converts one explicit source-local span into ordinary editable Box-UV Cubes.
//! No random noise, source-image inference, atlas packing, persistent recipe,
//! material generation, additional renderer or write authorization.
use super::{fail, sha256, valid_bounds, valid_node_name, valid_uuid, Cube, Result};
use super::geometry_assembly::blockout_cube;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryRibArray {
    pub name: String,
    pub uuid_seed: String,
    pub from: [i32; 3],
    pub to: [i32; 3],
    /// Axis of repetition, not the Bone orientation or a world-space solver.
    pub axis: String,
    /// Each rib is a separate native Cube. The shared G1 operation budget
    /// is the limit; no separate arbitrary artistic Cube-count ceiling.
    pub count: usize,
    pub thickness: u32,
}

/// The indexed namespace is stable for a given explicit seed/index. It is not
/// a persistent parametric object: changing count/spacing can move a Cube
/// without changing its UUID. Callers must re-check source/visual identity.
fn cube_uuid(seed: &str, index: usize) -> String {
    let digest = sha256(format!(
        "lazydesigner:geometry-rib-array-v1\0{seed}\0{index}"
    ).as_bytes());
    format!("{}-{}-4{}-8{}-{}",
        &digest[..8], &digest[8..12], &digest[13..16],
        &digest[17..20], &digest[20..32])
}

/// Integer model-unit spacing preserves exact end caps, gaps and cuboid UV
/// dimensions. For fractional or variable-width designs use explicit Cubes
/// or the already supported G3 profile/loft methods.
pub(super) fn compile(shape: &GeometryRibArray, bone_origin: [f64; 3],
    max_cubes: usize) -> Result<Vec<Cube>>
{
    if !valid_node_name(&shape.name) ||
        !valid_node_name(&format!("{}_rib_{}", shape.name,
            shape.count.saturating_sub(1))) {
        return Err(fail("GEOMETRY_RIB_NAME_INVALID"));
    }
    if !valid_uuid(&shape.uuid_seed) {
        return Err(fail("GEOMETRY_RIB_SEED_INVALID"));
    }
    if shape.count < 2 || shape.thickness == 0 {
        return Err(fail("GEOMETRY_RIB_PARAMETER_INVALID"));
    }
    if shape.count > max_cubes {
        return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
    }
    let axis = match shape.axis.as_str() {
        "X" => 0, "Y" => 1, "Z" => 2,
        _ => return Err(fail("GEOMETRY_RIB_AXIS_INVALID")),
    };
    let from = shape.from.map(f64::from);
    let to = shape.to.map(f64::from);
    if !valid_bounds(from, to) ||
       (0..3).any(|i| shape.from[i] >= shape.to[i]) {
        return Err(fail("GEOMETRY_RIB_BOUNDS_INVALID"));
    }
    let span = i64::from(shape.to[axis]) - i64::from(shape.from[axis]);
    let filled = i64::try_from(shape.count)
        .ok().and_then(|n| n.checked_mul(i64::from(shape.thickness)))
        .ok_or_else(|| fail("GEOMETRY_RIB_PARAMETER_INVALID"))?;
    if filled >= span {
        return Err(fail("GEOMETRY_RIB_SPACING_INVALID"));
    }
    let gaps = i64::try_from(shape.count - 1)
        .map_err(|_| fail("GEOMETRY_RIB_PARAMETER_INVALID"))?;
    let remaining = span - filled;
    // Fail rather than silently round and change the user's rhythm/spacing.
    if remaining % gaps != 0 || remaining / gaps < 1 {
        return Err(fail("GEOMETRY_RIB_SPACING_INVALID"));
    }
    let step = i64::from(shape.thickness) + remaining / gaps;
    let mut result = Vec::with_capacity(shape.count);
    for i in 0..shape.count {
        let start = i64::from(shape.from[axis]) + i as i64 * step;
        let end = start + i64::from(shape.thickness);
        let mut lo = from; let mut hi = to;
        lo[axis] = start as f64; hi[axis] = end as f64;
        if !valid_bounds(lo, hi) ||
            (0..3).any(|side| lo[side] >= hi[side]) {
            return Err(fail("GEOMETRY_RIB_BOUNDS_INVALID"));
        }
        result.push(blockout_cube(&cube_uuid(&shape.uuid_seed, i),
            format!("{}_rib_{}", shape.name, i), lo, hi, bone_origin));
    }
    if result.first().is_none_or(|c| c.from[axis] != from[axis]) ||
        result.last().is_none_or(|c| c.to[axis] != to[axis]) {
        return Err(fail("GEOMETRY_RIB_SPACING_INVALID"));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ribs() -> GeometryRibArray {
        GeometryRibArray {
            name: "armor_rib".into(),
            uuid_seed: "00000000-0000-4000-8000-000000007901".into(),
            from: [0, 0, 0], to: [20, 4, 6],
            axis: "X".into(), count: 4, thickness: 2,
        }
    }
    #[test]
    fn identical_recipe_produces_stable_disjoint_editable_cube_identities() {
        let a=compile(&ribs(),[0.0,0.0,0.0],10).unwrap();
        let b=compile(&ribs(),[0.0,0.0,0.0],10).unwrap();
        assert_eq!(a,b);
        assert_eq!(a.len(),4);
        assert_eq!(a.iter().map(|c|(c.from[0],c.to[0]))
            .collect::<Vec<_>>(),vec![(0.0,2.0),(6.0,8.0),
            (12.0,14.0),(18.0,20.0)]);
        assert!(a.windows(2).all(|pair|
            pair[0].to[0] < pair[1].from[0]));
        assert!(a.iter().all(|c|
            c.extra.get("box_uv")==Some(&serde_json::Value::Bool(true)) &&
            c.origin==Some([0.0,0.0,0.0])));
        let mut changed=ribs(); changed.uuid_seed="different".into();
        let variant=compile(&changed,[0.0,0.0,0.0],10).unwrap();
        assert_ne!(a[0].uuid,variant[0].uuid);
        assert_eq!(a[0].from,variant[0].from);
    }
    #[test]
    fn rejects_invalid_intent_and_nonintegral_gaps_without_fallback() {
        for (bad,error) in [
            (GeometryRibArray{axis:"W".into(),..ribs()},"GEOMETRY_RIB_AXIS_INVALID"),
            (GeometryRibArray{count:1,..ribs()},"GEOMETRY_RIB_PARAMETER_INVALID"),
            (GeometryRibArray{thickness:0,..ribs()},"GEOMETRY_RIB_PARAMETER_INVALID"),
            (GeometryRibArray{to:[12,4,6],thickness:3,..ribs()},"GEOMETRY_RIB_SPACING_INVALID"),
            (GeometryRibArray{to:[21,4,6],..ribs()},"GEOMETRY_RIB_SPACING_INVALID"),
            (GeometryRibArray{to:[0,4,6],..ribs()},"GEOMETRY_RIB_BOUNDS_INVALID"),
            (GeometryRibArray{uuid_seed:"".into(),..ribs()},"GEOMETRY_RIB_SEED_INVALID"),
        ] {
            assert_eq!(compile(&bad,[0.0;3],100).unwrap_err(),error);
        }
        assert_eq!(compile(&ribs(),[0.0;3],3).unwrap_err(),
            "GEOMETRY_ASSEMBLY_OPERATION_LIMIT");
    }
}

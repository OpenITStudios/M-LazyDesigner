//! Document identity and Outliner validation. The canonical AuthoringDocument/EditorSession and
//! transaction, history, saved file and public document contract stay in mod.rs.
//! SOURCE_ONLY; native/Cargo and regression tests remain NOT_EXECUTED.
use super::*;

pub(super) fn valid_uuid(uuid: &str) -> bool {
    !uuid.is_empty() && uuid.len() <= 128 &&
        !uuid.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// User-authored element labels. Preserve imported names as stored; only new
/// rename requests must be bounded and must not contain control characters.
/// A separate Bedrock geometry exporter owns stricter bone export admission.
pub(super) fn valid_node_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 128 &&
        !name.chars().any(char::is_control)
}
pub(super) fn valid_vec3(v: [f64; 3]) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= LIMIT)
}
pub(super) fn valid_bounds(from: [f64; 3], to: [f64; 3]) -> bool {
    valid_vec3(from) && valid_vec3(to) &&
        (0..3).all(|axis| from[axis] <= to[axis])
}
pub(super) fn valid_uv(v: &[f64]) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= LIMIT)
}

// All UUIDs are owned by this immutable AuthoringDocument/Outliner. Repeated
// canonical serialization and Dirty hashing must not allocate new Strings
// merely to establish membership and detect duplicate references.
pub(super) fn validate_outliner<'a>(
    nodes: &'a [OutlinerNode],
    cube_ids: &HashSet<&str>,
    bone_ids: &HashSet<&str>,
    seen_cubes: &mut HashSet<&'a str>,
    seen_bones: &mut HashSet<&'a str>,
    depth: usize,
) -> Result<()> {
    if depth > MAX_DEPTH { return Err(fail("OUTLINER_TOO_DEEP")); }
    for node in nodes {
        match node {
            OutlinerNode::Cube(id) => {
                if !cube_ids.contains(id.as_str()) || !seen_cubes.insert(id.as_str()) {
                    return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
                }
            }
            OutlinerNode::Bone(group) => {
                if !bone_ids.contains(group.uuid.as_str()) ||
                   !seen_bones.insert(group.uuid.as_str()) {
                    return Err(fail("OUTLINER_BONE_REFERENCE_INVALID"));
                }
                validate_outliner(&group.children, cube_ids, bone_ids, seen_cubes, seen_bones, depth + 1)?;
            }
        }
    }
    Ok(())
}

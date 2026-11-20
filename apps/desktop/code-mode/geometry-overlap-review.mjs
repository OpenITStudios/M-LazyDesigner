/** Read-only source Geometry overlap evidence; never full-model collision proof. */
// Static OBB evidence is advisory and only compares source-affected Cubes
// with supported rotated direct siblings in one Bone-local rigid frame.
export function validRotatedNeighborObbReview(review, changed) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return false;
  const count = v => Number.isSafeInteger(v) && v >= 0;
  const fields = new Set([
    'scope','checked_pair_count','introduced_intersection_count',
    'preexisting_intersection_count','resolved_intersection_count',
    'introduced_touching_count','unsupported_neighbor_count',
    'introduced_samples','samples_truncated','whole_model_collision_verdict',
  ]);
  if (Object.keys(review).some(key => !fields.has(key)) ||
      review.scope !== 'affected_vs_rotated_direct_same_bone_cube_obb' ||
      review.whole_model_collision_verdict !== 'UNVERIFIED' ||
      !['checked_pair_count','introduced_intersection_count',
        'preexisting_intersection_count','resolved_intersection_count',
        'introduced_touching_count','unsupported_neighbor_count'
      ].every(key => count(review[key])) ||
      review.introduced_intersection_count +
        review.preexisting_intersection_count +
        review.resolved_intersection_count > review.checked_pair_count ||
      review.introduced_touching_count > review.checked_pair_count ||
      !Array.isArray(review.introduced_samples) ||
      review.introduced_samples.length !==
        Math.min(16,review.introduced_intersection_count) ||
      review.samples_truncated !== (review.introduced_intersection_count > 16)) {
    return false;
  }
  const pairs = new Set();
  for(const sample of review.introduced_samples) {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample) ||
        Object.keys(sample).some(key=>!['cube_uuids','penetration_depth'].includes(key)) ||
        !Array.isArray(sample.cube_uuids) || sample.cube_uuids.length !== 2 ||
        !sample.cube_uuids.every(v => typeof v === 'string' &&
          v.length > 0 && v.length <= 128) ||
        sample.cube_uuids[0] >= sample.cube_uuids[1] ||
        !sample.cube_uuids.some(v=>changed.has(v)) ||
        !Number.isFinite(sample.penetration_depth) ||
        sample.penetration_depth <= 0 || sample.penetration_depth > 200000) {
      return false;
    }
    const pair = JSON.stringify(sample.cube_uuids);
    if (pairs.has(pair)) return false;
    pairs.add(pair);
  }
  return true;
}

// Advisory AABB screen is bounded to changed and same-Bone axis-aligned
// Cube pairs. It is not a whole-model collision/visual certification.
export function validAxisAlignedOverlapReview(screen, changed) {
  if (!screen || typeof screen !== 'object' || Array.isArray(screen)) return false;
  const fields = new Set([
    'scope','affected_cube_count','checked_pair_count',
    'introduced_overlap_count','preexisting_overlap_count',
    'resolved_overlap_count','unsupported_neighbor_count',
    'introduced_samples','samples_truncated','whole_model_collision_verdict',
    'rotated_neighbor_obb',
  ]);
  const count = n => Number.isSafeInteger(n) && n >= 0;
  if (Object.keys(screen).some(key => !fields.has(key)) ||
      screen.scope !== 'affected_vs_same_bone_axis_aligned_cube_aabb' ||
      screen.whole_model_collision_verdict !== 'UNVERIFIED' ||
      !validRotatedNeighborObbReview(screen.rotated_neighbor_obb,changed) ||
      !count(screen.affected_cube_count) ||
      screen.affected_cube_count !== changed.size ||
      !count(screen.checked_pair_count) ||
      !count(screen.introduced_overlap_count) ||
      !count(screen.preexisting_overlap_count) ||
      !count(screen.resolved_overlap_count) ||
      !count(screen.unsupported_neighbor_count) ||
      screen.introduced_overlap_count +
        screen.preexisting_overlap_count +
        screen.resolved_overlap_count > screen.checked_pair_count ||
      !Array.isArray(screen.introduced_samples) ||
      screen.introduced_samples.length !==
        Math.min(16, screen.introduced_overlap_count) ||
      screen.samples_truncated !== (screen.introduced_overlap_count > 16)) {
    return false;
  }
  const pairs = new Set();
  for (const sample of screen.introduced_samples) {
    const uuids = sample?.cube_uuids, overlap = sample?.overlap;
    if (!sample || typeof sample !== 'object' || Array.isArray(sample) ||
        Object.keys(sample).some(key=>!['cube_uuids','overlap'].includes(key)) ||
        !Array.isArray(uuids) || uuids.length !== 2 ||
        !uuids.every(v=>typeof v==='string' && v.length > 0 && v.length <= 128) ||
        uuids[0] >= uuids[1] ||
        !uuids.some(id=>changed.has(id)) ||
        !Array.isArray(overlap) || overlap.length !== 3 ||
        !overlap.every(v=>Number.isFinite(v) && v > 0 && v <= 200000)) {
      return false;
    }
    const pair = JSON.stringify(uuids);
    if (pairs.has(pair)) return false;
    pairs.add(pair);
  }
  return true;
}


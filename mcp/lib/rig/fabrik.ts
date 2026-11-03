export type RigVec3 = readonly [number, number, number];

export type FabrikOptions = {
  tolerance?: number;
  max_iterations?: number;
};

function add(a: RigVec3, b: RigVec3): [number, number, number] { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: RigVec3, b: RigVec3): [number, number, number] { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: RigVec3, s: number): [number, number, number] { return [a[0] * s, a[1] * s, a[2] * s]; }
function length(a: RigVec3): number { return Math.hypot(a[0], a[1], a[2]); }
function distance(a: RigVec3, b: RigVec3): number { return length(sub(a, b)); }
function unit(from: RigVec3, to: RigVec3): [number, number, number] {
  const delta = sub(to, from);
  const magnitude = length(delta);
  if (magnitude === 0) throw new Error("FABRIK cannot normalize a zero-length direction.");
  return scale(delta, 1 / magnitude);
}

export function solveFabrikChain(points: readonly RigVec3[], target: RigVec3, options: FabrikOptions = {}) {
  if (points.length < 2) throw new Error("FABRIK requires at least two chain points.");
  if (![...target, ...points.flat()].every(Number.isFinite)) throw new Error("FABRIK inputs must be finite.");
  const tolerance = options.tolerance ?? 1e-3;
  const maxIterations = options.max_iterations ?? 24;
  if (!(tolerance > 0) || !Number.isInteger(maxIterations) || maxIterations <= 0) throw new Error("Invalid FABRIK solve options.");

  const originalRoot = [...points[0]] as [number, number, number];
  const solved = points.map((point) => [...point] as [number, number, number]);
  const lengths = points.slice(0, -1).map((point, index) => {
    const segmentLength = distance(point, points[index + 1]);
    if (!(segmentLength > 0)) throw new Error("FABRIK chain segments must have non-zero length.");
    return segmentLength;
  });
  const totalLength = lengths.reduce((sum, value) => sum + value, 0);
  const rootToTarget = distance(originalRoot, target);

  if (rootToTarget >= totalLength) {
    const direction = unit(originalRoot, target);
    solved[0] = originalRoot;
    for (let i = 0; i < lengths.length; i += 1) solved[i + 1] = add(solved[i], scale(direction, lengths[i]));
    return { points: solved, reached: Math.abs(rootToTarget - totalLength) <= tolerance, iterations: 1, residual: distance(solved.at(-1)!, target), stretched: true };
  }

  let iterations = 0;
  while (iterations < maxIterations && distance(solved.at(-1)!, target) > tolerance) {
    iterations += 1;
    solved[solved.length - 1] = [...target] as [number, number, number];
    for (let i = solved.length - 2; i >= 0; i -= 1) {
      const direction = unit(solved[i + 1], solved[i]);
      solved[i] = add(solved[i + 1], scale(direction, lengths[i]));
    }
    solved[0] = originalRoot;
    for (let i = 0; i < lengths.length; i += 1) {
      const direction = unit(solved[i], solved[i + 1]);
      solved[i + 1] = add(solved[i], scale(direction, lengths[i]));
    }
  }
  const residual = distance(solved.at(-1)!, target);
  return { points: solved, reached: residual <= tolerance, iterations, residual, stretched: false };
}


export type RigQuaternionXYZW = readonly [number, number, number, number];

/**
 * Source-only two-bone pole correction plus shortest-arc WORLD-space swings.
 *
 * The pole is a world POINT, not an inferred bone axis. FABRIK produces joint
 * positions; this routine chooses the non-flipped analytic knee position for
 * a 3-joint chain, then reports quaternion *hints* for the two outgoing
 * segments. They are neither Blockbench local Euler angles nor safe keyframes:
 * original world bone orientations, parent inverse transforms, pre-rotation,
 * twist and native codec conversion are still unobserved.
 */
export function planTwoBonePoleSwing(
  observed: readonly RigVec3[],
  solved: readonly RigVec3[],
  bendPoleWorld: RigVec3,
  options: { max_swing_degrees?: number } = {}
) {
  const unavailable = (reason: string) => ({
    state: "unavailable" as const, reason,
    native_rotation_authorized: false as const,
    local_euler_attested: false as const,
    visual_verdict: "not_evaluated" as const,
  });
  const finitePoint = (v: unknown): v is RigVec3 =>
    Array.isArray(v) && v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n));
  const maxSwing = options.max_swing_degrees ?? 120;
  if (!Array.isArray(observed) || !Array.isArray(solved) ||
      observed.length !== 3 || solved.length !== 3 ||
      [...observed, ...solved, bendPoleWorld].some((v) => !finitePoint(v)) ||
      !Number.isFinite(maxSwing) || maxSwing <= 0 || maxSwing > 170) {
    return unavailable("FABRIK_POLE_INPUT_INVALID");
  }
  const dot = (a: RigVec3, b: RigVec3) =>
    a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a: RigVec3, b: RigVec3): [number,number,number] =>
    [a[1]*b[2]-a[2]*b[1],
     a[2]*b[0]-a[0]*b[2],
     a[0]*b[1]-a[1]*b[0]];
  const finite = (a: RigVec3) => a.every(Number.isFinite);
  const normalized = (v: RigVec3): [number,number,number] | null => {
    const magnitude=length(v);
    return Number.isFinite(magnitude) && magnitude > 1e-8
      ? scale(v,1/magnitude) : null;
  };
  const originalLengths=[distance(observed[0],observed[1]),
    distance(observed[1],observed[2])];
  if (originalLengths.some((len) => !Number.isFinite(len) || len<=1e-6) ||
      distance(observed[0],solved[0])>1e-6 ||
      originalLengths.some((len,i) =>
        !Number.isFinite(distance(solved[i],solved[i+1])) ||
        Math.abs(len-distance(solved[i],solved[i+1]))>
          Math.max(1e-5,len*1e-4)
      )) return unavailable("FABRIK_POLE_CHAIN_LENGTH_OR_ROOT_CHANGED");
  const [firstLength,secondLength]=originalLengths;
  const hip=solved[0],ankle=solved[2];
  const hipToAnkle=sub(ankle,hip), span=length(hipToAnkle);
  if (!Number.isFinite(span) || span<=1e-6 ||
      span>=firstLength+secondLength-1e-6 ||
      span<=Math.abs(firstLength-secondLength)+1e-6) {
    return unavailable("FABRIK_POLE_TARGET_SINGULAR_OR_UNREACHABLE");
  }
  const line=normalized(hipToAnkle);
  const originalLine=normalized(sub(observed[2],observed[0]));
  if (!line || !originalLine) return unavailable("FABRIK_POLE_BEND_AXIS_UNDEFINED");
  const poleOffset=sub(bendPoleWorld,hip);
  const originalPole=sub(bendPoleWorld,observed[0]);
  const polePerp=sub(poleOffset,scale(line,dot(poleOffset,line)));
  const sourcePolePerp=sub(originalPole,scale(originalLine,dot(originalPole,originalLine)));
  const sourceKneeOffset=sub(observed[1],observed[0]);
  const sourceKneePerp=sub(sourceKneeOffset,
    scale(originalLine,dot(sourceKneeOffset,originalLine)));
  const poleUnit=normalized(polePerp);
  const sourcePoleUnit=normalized(sourcePolePerp);
  const sourceKneeUnit=normalized(sourceKneePerp);
  if (!poleUnit || !sourcePoleUnit || !sourceKneeUnit ||
      length(sourceKneePerp)<=firstLength*1e-4) {
    return unavailable("FABRIK_POLE_BEND_PLANE_AMBIGUOUS");
  }
  const alignment=dot(sourceKneeUnit,sourcePoleUnit);
  if (!Number.isFinite(alignment) || alignment<=0.1) {
    return unavailable("FABRIK_POLE_SOURCE_BEND_OPPOSITE_OR_AMBIGUOUS");
  }
  const along=(span*span+firstLength*firstLength-secondLength*secondLength)/(2*span);
  const heightSquared=firstLength*firstLength-along*along;
  if (!Number.isFinite(heightSquared) ||
      heightSquared<=1e-10*firstLength*firstLength) {
    return unavailable("FABRIK_POLE_TARGET_SINGULAR_OR_UNREACHABLE");
  }
  const knee=add(add(hip,scale(line,along)),scale(poleUnit,Math.sqrt(heightSquared)));
  const corrected: [RigVec3,RigVec3,RigVec3]=[
    [...hip] as [number,number,number],
    [...knee],
    [...ankle] as [number,number,number],
  ];
  if (!corrected.every(finite) ||
      Math.abs(distance(corrected[0],corrected[1])-firstLength)>1e-6 ||
      Math.abs(distance(corrected[1],corrected[2])-secondLength)>1e-6) {
    return unavailable("FABRIK_POLE_CORRECTION_NONFINITE_OR_STRETCHED");
  }
  const swings: Array<{
    segment_index: number;
    world_delta_quaternion_xyzw: RigQuaternionXYZW;
    angle_degrees: number;
  }> = [];
  for (let i=0;i<2;i++) {
    const sourceUnit=normalized(sub(observed[i+1],observed[i]));
    const targetUnit=normalized(sub(corrected[i+1],corrected[i]));
    if (!sourceUnit || !targetUnit) return unavailable("FABRIK_SWING_DIRECTION_UNDEFINED");
    const similarity=Math.max(-1,Math.min(1,dot(sourceUnit,targetUnit)));
    if (similarity<=-0.999999) {
      // 180-degree shortest arc has no unique axis without an observed
      // joint orientation; do not invent a native knee rotation.
      return unavailable("FABRIK_SWING_ANTIPARALLEL_AMBIGUOUS");
    }
    const directionCross=cross(sourceUnit,targetUnit);
    const raw=[...directionCross,1+similarity];
    const norm=Math.hypot(...raw);
    if (!Number.isFinite(norm) || norm<=1e-9) {
      return unavailable("FABRIK_SWING_NUMERIC_UNSTABLE");
    }
    const q=raw.map((n)=>n/norm) as [number,number,number,number];
    const degrees=2*Math.acos(Math.max(0,Math.min(1,q[3])))*180/Math.PI;
    if (!q.every(Number.isFinite) || !Number.isFinite(degrees)) {
      return unavailable("FABRIK_SWING_NUMERIC_UNSTABLE");
    }
    if (degrees>maxSwing+1e-7) {
      return unavailable("FABRIK_SWING_LIMIT_EXCEEDED");
    }
    swings.push({
      segment_index:i,
      world_delta_quaternion_xyzw:q,
      angle_degrees:degrees,
    });
  }
  return {
    state:"SOURCE_ONLY_POLE_SWING_HINT" as const,
    reason:null,
    corrected_points:corrected.map((point)=>[...point] as [number,number,number]),
    segment_swings:swings,
    source_bend_pole_alignment:alignment,
    bend_pole_world:[...bendPoleWorld] as [number,number,number],
    max_allowed_swing_degrees:maxSwing,
    quaternion_convention:"THREE_XYZW_WORLD_SHORTEST_ARC" as const,
    native_rotation_authorized:false as const,
    local_euler_attested:false as const,
    visual_verdict:"not_evaluated" as const,
  };
}


/**
 * Convert a WORLD-space swing into a mesh-parent-local quaternion change
 * using actual *provided* source and corrected parent world orientations.
 *
 * This is not Blockbench BoneAnimator Euler data. Parent rotation from an
 * upstream IK correction must be supplied: using the old parent quaternion
 * after rotating the thigh would silently corrupt the knee correction.
 */
export function planWorldSwingToParentLocal(input: {
  source_world_quaternion_xyzw: RigQuaternionXYZW;
  source_parent_world_quaternion_xyzw: RigQuaternionXYZW;
  corrected_parent_world_quaternion_xyzw: RigQuaternionXYZW;
  world_delta_quaternion_xyzw: RigQuaternionXYZW;
}) {
  const unavailable=(reason:string)=>({
    state:"unavailable" as const,reason,
    native_euler_authorized:false as const,
    native_keyframe_authorized:false as const,
    visual_verdict:"not_evaluated" as const,
  });
  const valid=(v: unknown):v is RigQuaternionXYZW =>
    Array.isArray(v) && v.length===4 &&
    v.every((x)=>typeof x==="number"&&Number.isFinite(x)) &&
    Math.abs(Math.hypot(...v)-1)<=1e-3;
  if (!input || !valid(input.source_world_quaternion_xyzw) ||
      !valid(input.source_parent_world_quaternion_xyzw) ||
      !valid(input.corrected_parent_world_quaternion_xyzw) ||
      !valid(input.world_delta_quaternion_xyzw)) {
    return unavailable("IK_LOCAL_QUATERNION_UNVERIFIED");
  }
  const normalized=(v:RigQuaternionXYZW):[number,number,number,number]=>{
    const len=Math.hypot(...v);
    return [v[0]/len,v[1]/len,v[2]/len,v[3]/len];
  };
  const multiply=(a:RigQuaternionXYZW,b:RigQuaternionXYZW):[number,number,number,number]=>{
    const [x,y,z,w]=a,[X,Y,Z,W]=b;
    return [
      w*X+x*W+y*Z-z*Y,
      w*Y-x*Z+y*W+z*X,
      w*Z+x*Y-y*X+z*W,
      w*W-x*X-y*Y-z*Z,
    ];
  };
  const inverse=(q:RigQuaternionXYZW):[number,number,number,number] =>
    [-q[0],-q[1],-q[2],q[3]];
  const srcWorld=normalized(input.source_world_quaternion_xyzw);
  const oldParent=normalized(input.source_parent_world_quaternion_xyzw);
  const newParent=normalized(input.corrected_parent_world_quaternion_xyzw);
  const delta=normalized(input.world_delta_quaternion_xyzw);
  const localBefore=normalized(multiply(inverse(oldParent),srcWorld));
  const worldAfter=normalized(multiply(delta,srcWorld));
  const localAfter=normalized(multiply(inverse(newParent),worldAfter));
  const rawDelta=normalized(multiply(localAfter,inverse(localBefore)));
  const localDelta=rawDelta[3]<0
    ? rawDelta.map((v)=>-v) as [number,number,number,number] : rawDelta;
  const angularMatch=(a:RigQuaternionXYZW,b:RigQuaternionXYZW)=>
    Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]);
  if (![...localBefore,...worldAfter,...localAfter,...localDelta].every(Number.isFinite) ||
      angularMatch(normalized(multiply(newParent,localAfter)),worldAfter)<1-1e-8 ||
      angularMatch(normalized(multiply(localDelta,localBefore)),localAfter)<1-1e-8) {
    return unavailable("IK_LOCAL_QUATERNION_REPROJECTION_FAILED");
  }
  return {
    state:"SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT" as const,
    reason:null,
    source_local_quaternion_xyzw:localBefore,
    corrected_world_quaternion_xyzw:worldAfter,
    proposed_local_quaternion_xyzw:localAfter,
    local_delta_quaternion_xyzw:localDelta,
    parent_change_accounted_for:true as const,
    native_euler_authorized:false as const,
    native_keyframe_authorized:false as const,
    visual_verdict:"not_evaluated" as const,
  };
}


/**
 * Assess only the additive Euler delta visible in a current preview frame.
 * Blockbench 5.2.2 BoneAnimator.displayRotation adds frame rotation to the
 * pre-animation local Euler. Global rotations, override, quaternion
 * interpolation, blend expressions and pre-stack modifications invalidate
 * this simple model. Native animated keyframes are NEVER inferred or written.
 */
export function inspectObservedAdditiveEulerPose(input: {
  mesh_rotation_radians: RigVec3;
  pre_animation_rotation_radians: RigVec3;
  fix_rotation_radians: RigVec3;
  format_euler_order: string;
  mesh_euler_order: string;
  pre_animation_euler_order: string;
  fix_euler_order: string;
  rotation_global: boolean;
  animation_override: boolean;
  quaternion_interpolation: boolean;
  single_clip_blend_literal_one: boolean;
}) {
  const unavailable=(reason:string)=>({
    state:"unavailable" as const,reason,
    native_euler_authorized:false as const,
    native_keyframe_authorized:false as const,
    visual_verdict:"not_evaluated" as const,
  });
  if (!input || typeof input!=="object") {
    return unavailable("IK_EULER_PREVIEW_CONTEXT_MISSING");
  }
  const accepted=["XYZ","XZY","YXZ","YZX","ZXY","ZYX"];
  const order=input.format_euler_order;
  if (typeof order!=="string" || !accepted.includes(order) ||
      input.mesh_euler_order!==order ||
      input.pre_animation_euler_order!==order ||
      input.fix_euler_order!==order) {
    return unavailable("IK_EULER_ORDER_UNVERIFIED");
  }
  const vectors=[input.mesh_rotation_radians,
    input.pre_animation_rotation_radians,input.fix_rotation_radians];
  if (vectors.some((v)=>!Array.isArray(v) || v.length!==3 ||
      !v.every((x)=>typeof x==="number"&&Number.isFinite(x)))) {
    return unavailable("IK_EULER_POSE_NONFINITE");
  }
  if (input.rotation_global!==false) {
    return unavailable("IK_EULER_ROTATION_GLOBAL_UNSUPPORTED");
  }
  if (input.animation_override!==false) {
    return unavailable("IK_EULER_ANIMATION_OVERRIDE_UNSUPPORTED");
  }
  if (input.quaternion_interpolation!==false) {
    return unavailable("IK_EULER_QUATERNION_INTERPOLATION_UNSUPPORTED");
  }
  if (input.single_clip_blend_literal_one!==true) {
    return unavailable("IK_EULER_BLEND_OR_EXPRESSION_UNVERIFIED");
  }
  const pre=input.pre_animation_rotation_radians;
  const fix=input.fix_rotation_radians;
  if (pre.some((x,i)=>Math.abs(x-fix[i])>1e-5)) {
    return unavailable("IK_EULER_PRE_ROTATION_NOT_BASELINE");
  }
  // The middle Euler axis is singular at +/-90 degrees for all six orders.
  // A close gimbal lock or a near-180 degree component wrap has no reliable
  // local authoring direction without a native per-frame comparison.
  const middleAxis="XYZ".indexOf(order[1]);
  if ([input.mesh_rotation_radians,pre].some((v)=>
    Math.abs(Math.cos(v[middleAxis]))<0.05
  )) return unavailable("IK_EULER_GIMBAL_SINGULARITY");
  const delta=input.mesh_rotation_radians.map((x,i)=>x-pre[i]);
  if (delta.some((x)=>!Number.isFinite(x) ||
      Math.abs(x)>170*Math.PI/180)) {
    return unavailable("IK_EULER_DELTA_WRAP_OR_EXTREME");
  }
  const degrees=delta.map((x)=>x*180/Math.PI) as [number,number,number];
  if (!degrees.every(Number.isFinite)) {
    return unavailable("IK_EULER_DELTA_NONFINITE");
  }
  return {
    state:"SOURCE_ONLY_OBSERVED_ADDITIVE_EULER_DELTA" as const,
    reason:null,
    euler_order:order,
    mesh_delta_euler_degrees:degrees,
    based_on_current_preview_only:true as const,
    native_euler_authorized:false as const,
    native_keyframe_authorized:false as const,
    visual_verdict:"not_evaluated" as const,
    note:"Observed Euler component delta from fix/pre baseline, not an "+
      "authored keyframe or verified Blockbench preview/export interpolation.",
  };
}

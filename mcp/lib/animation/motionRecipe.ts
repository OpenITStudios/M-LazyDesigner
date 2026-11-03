import { nativeKeyframeTimesCollide } from "@/lib/animation/batchPlanning";

export type MotionVec3 = [number, number, number];
export type MotionChannel = "position" | "rotation" | "scale";
export type MotionInterpolation = "linear" | "catmullrom" | "bezier" | "step";

export type MotionPose = {
  id: string;
  time: number;
  bones: Readonly<Record<string, {
    position?: MotionVec3;
    rotation?: MotionVec3;
    scale?: MotionVec3 | number;
    interpolation?: MotionInterpolation;
  }>>;
};

export type MotionRecipe = {
  name: string;
  loop?: boolean;
  duration?: number;
  poses: readonly MotionPose[];
};

export type CompiledMotionKeyframe = {
  time: number;
  position?: MotionVec3;
  rotation?: MotionVec3;
  scale?: MotionVec3 | number;
  interpolation?: MotionInterpolation;
};

export type CompiledMotionRecipe = {
  name: string;
  loop: boolean;
  duration: number;
  bones: Record<string, CompiledMotionKeyframe[]>;
};

function validateVec3(values: readonly number[], label: string): MotionVec3 {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(label + " must contain three finite values.");
  }
  return [values[0], values[1], values[2]];
}

export function compileMotionRecipe(recipe: MotionRecipe): CompiledMotionRecipe {
  if (!recipe.name.trim()) throw new Error("Motion recipe requires a non-empty name.");
  if (recipe.poses.length === 0) throw new Error("Motion recipe requires at least one pose.");
  const poseIds = new Set<string>();
  const times = new Set<number>();
  const sorted = [...recipe.poses].sort((a,b)=>a.time-b.time || a.id.localeCompare(b.id));
  for (const pose of sorted) {
    if (!pose.id || poseIds.has(pose.id)) throw new Error("Motion pose IDs must be non-empty and unique.");
    if (!Number.isFinite(pose.time) || pose.time < 0 || pose.time > 10000) throw new Error("Motion pose time must be within 0..10000.");
    if (times.has(pose.time)) throw new Error("Motion recipe requires one semantic pose per effective time.");
    poseIds.add(pose.id);
    times.add(pose.time);
  }
  const inferredDuration = sorted[sorted.length - 1].time;
  const duration = recipe.duration ?? inferredDuration;
  if (!Number.isFinite(duration) || duration < inferredDuration || duration > 10000) {
    throw new Error("Motion duration must be finite, >= final pose time, and <= 10000.");
  }
  const bones: Record<string, CompiledMotionKeyframe[]> = {};
  for (const pose of sorted) {
    for (const [bone, transform] of Object.entries(pose.bones)) {
      if (!bone.trim()) throw new Error("Motion pose contains an empty bone identity.");
      const frame: CompiledMotionKeyframe = { time: pose.time };
      if (transform.position) frame.position = validateVec3(transform.position, bone + " position");
      if (transform.rotation) frame.rotation = validateVec3(transform.rotation, bone + " rotation");
      if (transform.scale !== undefined) {
        if (typeof transform.scale === "number") {
          if (!Number.isFinite(transform.scale)) {
            throw new Error(bone + " scale must be finite.");
          }
          frame.scale = transform.scale;
        } else {
          frame.scale = validateVec3(transform.scale, bone + " scale");
        }
      }
      if (transform.interpolation) frame.interpolation = transform.interpolation;
      if (frame.position === undefined && frame.rotation === undefined && frame.scale === undefined) continue;
      (bones[bone] ??= []).push(frame);
    }
  }
  // Native replaceOthers() collides same-channel keys less than 0.0001s apart.
  // Distinct semantic pose timestamps are not enough to prevent data loss.
  for (const [bone, frames] of Object.entries(bones)) {
    for (const channel of ["position", "rotation", "scale"] as const) {
      const times = frames
        .filter((frame) => frame[channel] !== undefined)
        .map((frame) => frame.time)
        .sort((a, b) => a - b);
      for (let index = 1; index < times.length; index += 1) {
        if (nativeKeyframeTimesCollide(times[index - 1], times[index])) {
          throw new Error("Motion recipe " + bone + " " + channel +
            " keys would collide under native Blockbench replacement tolerance.");
        }
      }
    }
  }
  return { name: recipe.name, loop: recipe.loop ?? false, duration, bones };
}


/** An explicit bone/channel: never infer animation intent from a bone name. */
export type MotionPchipTarget = {
  bone: string;
  channel: "position" | "rotation";
};

export type MotionPchipOptions = {
  sample_fps: number;
  /** Preserve continuous flow, or explicitly bring the full track to rest. */
  boundary_tangent?: "shape_preserving" | "rest_endpoints";
  /**
   * Opt-in cap on peak FINITE-DIFFERENCE speed of the final native-LINEAR
   * approximation, relative to the original linear source on the SAME grid.
   * Must be 1..3. This may relax requested rest-endpoint easing; it does
   * not change pose anchors, clip length, or enable native IK/playback.
   */
  max_sampled_speed_ratio?: number;
  /** Opt-in 1..3x bounds on same-FPS discrete 2nd/3rd differences. */
  max_sampled_acceleration_ratio?: number;
  max_sampled_jerk_ratio?: number;
};

const MOTION_PCHIP_MAX_TARGETS = 12;
export const MOTION_PCHIP_MAX_ADDED_KEYS = 512;
const MOTION_PCHIP_GRID_TOLERANCE = 1e-8;
const MOTION_PCHIP_LINEAR_DIFFERENCE = 1e-6;

/**
 * Fritsch-Butland weighted harmonic tangents. A slope becomes zero when its
 * neighboring secants change sign or touch a hold, preventing local extrema
 * from being overshot. Each output channel uses independent numeric axes.
 */
function pchipAxisSlopes(times: readonly number[], values: readonly number[], stopEnds: boolean) {
  const h = times.slice(1).map((time,i)=>time-times[i]);
  const d = h.map((span,i)=>(values[i+1]-values[i])/span);
  if (h.some((span)=>!Number.isFinite(span)||span<=0) ||
      d.some((slope)=>!Number.isFinite(slope))) {
    throw new Error("MOTION_PCHIP_NUMERIC_SLOPE_INVALID");
  }
  const n=values.length;
  if (n===2) return stopEnds ? [0,0] : [d[0],d[0]];
  const slopes=new Array<number>(n).fill(0);
  const endpoint=(h0:number,h1:number,d0:number,d1:number) => {
    let slope=((2*h0+h1)*d0-h0*d1)/(h0+h1);
    if (d0===0 || slope*d0<=0) return 0;
    if (d0*d1<0 && Math.abs(slope)>3*Math.abs(d0)) slope=3*d0;
    return slope;
  };
  slopes[0]=stopEnds?0:endpoint(h[0],h[1],d[0],d[1]);
  slopes[n-1]=stopEnds?0:endpoint(h[n-2],h[n-3],d[n-2],d[n-3]);
  for(let i=1;i<n-1;i++){
    if (d[i-1]*d[i]<=0) continue;
    const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
    slopes[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);
  }
  if (slopes.some((s)=>!Number.isFinite(s))) {
    throw new Error("MOTION_PCHIP_NUMERIC_SLOPE_INVALID");
  }
  return slopes;
}


type PchipGeneratedPose = {
  id:string;time:number;
  bones:Record<string,{position?:MotionVec3;rotation?:MotionVec3}>;
};

/**
 * Keep the full sampled shape as a convex blend of the authored LINEAR
 * baseline and the unconstrained PCHIP bake. Both curves meet every authored
 * key, so ANY blend preserves source anchors and axiswise no-overshoot.
 *
 * Peak finite-difference speed is convex as a function of blend weight.
 * The feasible interval includes alpha=0 (the original linear baseline).
 * Bisection therefore finds the strongest usable PCHIP shape under an
 * explicit relative sampled-speed cap without changing clip duration.
 */
type PchipDerivativeCaps = {
  speed?: number;
  acceleration?: number;
  jerk?: number;
};

/**
 * Simultaneous convex derivative limits on the same retained LINEAR keys.
 * Each k-th finite difference is affine in the PCHIP blend alpha, and its
 * Euclidean norm is convex. With ratios >=1, alpha=0 is always feasible;
 * bisection finds the strongest safe alpha for ALL requested limits.
 */
function boundPchipTrackSampledDerivatives(
  compiled: CompiledMotionRecipe,
  additions: Map<number, PchipGeneratedPose>,
  target: MotionPchipTarget,
  fps: number,
  caps: PchipDerivativeCaps
) {
  type SampleKey = { time: number; value: MotionVec3 };
  const source = (compiled.bones[target.bone] ?? [])
    .filter((frame) => frame[target.channel] !== undefined)
    .map((frame): SampleKey => ({
      time: frame.time,
      value: frame[target.channel] as MotionVec3,
    }));
  const generated = [...additions.values()].filter(
    (pose) => pose.bones[target.bone]?.[target.channel] !== undefined
  );
  const collect = (): SampleKey[] => [
    ...source,
    ...generated.map((pose) => ({
      time: pose.time,
      value: pose.bones[target.bone][target.channel] as MotionVec3,
    })),
  ].sort((a, b) => a.time - b.time);
  const sample = (keys: readonly SampleKey[], time: number): MotionVec3 => {
    if (!keys.length || time < keys[0].time - 1e-8 ||
        time > keys[keys.length - 1].time + 1e-8) {
      throw new Error("MOTION_PCHIP_DERIVATIVE_SOURCE_CLOCK_INVALID");
    }
    let lo = 0, hi = keys.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid].time < time) lo = mid; else hi = mid;
    }
    if (Math.abs(keys[lo].time - time) <= 1e-8)
      return [...keys[lo].value] as MotionVec3;
    if (Math.abs(keys[hi].time - time) <= 1e-8)
      return [...keys[hi].value] as MotionVec3;
    const span = keys[hi].time - keys[lo].time;
    if (!(span > 0)) throw new Error("MOTION_PCHIP_DERIVATIVE_SOURCE_CLOCK_INVALID");
    const u = (time - keys[lo].time) / span;
    return [0,1,2].map((axis) =>
      keys[lo].value[axis] +
      u * (keys[hi].value[axis] - keys[lo].value[axis])
    ) as MotionVec3;
  };
  const start = Math.round(source[0].time * fps);
  const end = Math.round(source[source.length-1].time * fps);
  const count = end - start + 1;
  if (!Number.isSafeInteger(count) || count < 2 || count > 2048 ||
      (caps.acceleration !== undefined && count < 3) ||
      (caps.jerk !== undefined && count < 4)) {
    throw new Error("MOTION_PCHIP_DERIVATIVE_GRID_BUDGET_OR_COVERAGE_INVALID");
  }
  const rawKeys = collect();
  const linear: MotionVec3[] = [], cubic: MotionVec3[] = [];
  for (let tick = start; tick <= end; tick++) {
    const time = tick / fps;
    linear.push(sample(source,time));
    cubic.push(sample(rawKeys,time));
  }
  const peak = (blend: number, order: 1 | 2 | 3) => {
    let vectors: MotionVec3[] = linear.map((value,i) =>
      [0,1,2].map((axis) =>
        value[axis] + blend * (cubic[i][axis] - value[axis])
      ) as MotionVec3
    );
    for (let pass = 0; pass < order; pass++) {
      const next: MotionVec3[] = [];
      for (let i = 1; i < vectors.length; i++) {
        next.push([0,1,2].map((axis) =>
          (vectors[i][axis] - vectors[i-1][axis]) * fps
        ) as MotionVec3);
      }
      vectors = next;
    }
    return vectors.reduce((largest, value) =>
      Math.max(largest, Math.hypot(...value)), 0);
  };
  const sourcePeaks = [0,1,2,3].map((order) =>
    order === 0 ? 0 : peak(0, order as 1 | 2 | 3));
  const unboundedPeaks = [0,1,2,3].map((order) =>
    order === 0 ? 0 : peak(1, order as 1 | 2 | 3));
  const ratios = [null, caps.speed ?? null,
    caps.acceleration ?? null, caps.jerk ?? null];
  const allowed = ratios.map((ratio,order) =>
    ratio === null ? null : sourcePeaks[order] * ratio);
  const numeric = [...sourcePeaks,...unboundedPeaks,
    ...allowed.filter((value): value is number => value !== null)];
  if (numeric.some((value) => !Number.isFinite(value)) ||
      sourcePeaks[1] <= 1e-9) {
    throw new Error("MOTION_PCHIP_DERIVATIVE_REFERENCE_UNAVAILABLE");
  }
  const precision = (order: number) =>
    Math.max(1e-7, (allowed[order] ?? 0) * 1e-8);
  const feasible = (blend: number) => {
    for (const order of [1,2,3] as const) {
      const bound = allowed[order];
      if (bound !== null) {
        const measured = peak(blend,order);
        if (!Number.isFinite(measured) ||
            measured > bound + precision(order)) return false;
      }
    }
    return true;
  };
  let alpha = 1;
  if (!feasible(1)) {
    let lo = 0, hi = 1;
    for (let iteration = 0; iteration < 42; iteration++) {
      const mid = (lo + hi) / 2;
      if (feasible(mid)) lo = mid; else hi = mid;
    }
    alpha = lo;
  }
  const hadShape = cubic.some((value,i) => value.some((number,axis) =>
    Math.abs(number-linear[i][axis]) > MOTION_PCHIP_LINEAR_DIFFERENCE
  ));
  if (hadShape && alpha <= 1e-6) {
    throw new Error(caps.acceleration === undefined && caps.jerk === undefined
      ? "MOTION_PCHIP_SPEED_CAP_NO_EFFECTIVE_SMOOTHING"
      : "MOTION_PCHIP_DERIVATIVE_CAP_NO_EFFECTIVE_SMOOTHING");
  }
  if (alpha < 1) {
    for (const pose of generated) {
      const candidate = pose.bones[target.bone][target.channel] as MotionVec3;
      const original = sample(source,pose.time);
      pose.bones[target.bone][target.channel] = [0,1,2].map((axis) =>
        original[axis] + alpha * (candidate[axis] - original[axis])
      ) as MotionVec3;
    }
  }
  // Read back the actual generated keys, including any omitted source-pose
  // timestamps, rather than certifying the ideal analytic cubic.
  const finalKeys = collect();
  const actual: MotionVec3[] = [];
  for (let tick = start; tick <= end; tick++) {
    const value = sample(finalKeys,tick/fps);
    if (value.some((x) => !Number.isFinite(x))) {
      throw new Error("MOTION_PCHIP_DERIVATIVE_BAKE_NONFINITE");
    }
    actual.push(value);
  }
  const actualPeak = (order: 1 | 2 | 3) => {
    let current = actual;
    for (let pass = 0; pass < order; pass++) {
      const next: MotionVec3[] = [];
      for (let i = 1; i < current.length; i++) {
        next.push([0,1,2].map((axis) =>
          (current[i][axis] - current[i-1][axis]) * fps
        ) as MotionVec3);
      }
      current = next;
    }
    return current.reduce((largest, value) =>
      Math.max(largest,Math.hypot(...value)), 0);
  };
  const finalPeaks = [0, actualPeak(1), actualPeak(2), actualPeak(3)];
  for (const order of [1,2,3] as const) {
    if (!Number.isFinite(finalPeaks[order]) ||
        (allowed[order] !== null &&
          finalPeaks[order] > allowed[order]! + precision(order))) {
      throw new Error("MOTION_PCHIP_DERIVATIVE_CAP_NOT_PRESERVED");
    }
  }
  const round = (number: number) => Number(number.toFixed(6));
  return {
    bone: target.bone,
    channel: target.channel,
    units: target.channel === "rotation"
      ? "degrees_per_second" as const
      : "blockbench_model_units_per_second" as const,
    source_peak_sampled_speed: round(sourcePeaks[1]),
    uncapped_peak_sampled_speed: round(unboundedPeaks[1]),
    allowed_peak_sampled_speed: allowed[1] === null ? null : round(allowed[1]),
    final_peak_sampled_speed: round(finalPeaks[1]),
    source_peak_sampled_acceleration: round(sourcePeaks[2]),
    uncapped_peak_sampled_acceleration: round(unboundedPeaks[2]),
    allowed_peak_sampled_acceleration: allowed[2] === null ? null : round(allowed[2]),
    final_peak_sampled_acceleration: round(finalPeaks[2]),
    source_peak_sampled_jerk: round(sourcePeaks[3]),
    uncapped_peak_sampled_jerk: round(unboundedPeaks[3]),
    allowed_peak_sampled_jerk: allowed[3] === null ? null : round(allowed[3]),
    final_peak_sampled_jerk: round(finalPeaks[3]),
    pchip_shape_weight: round(alpha),
    cap_applied: alpha < 1 - 1e-6,
  };
}

/**
 * Opt-in shape-preserving PCHIP sampled as existing native-safe LINEAR keys.
 * The source curve is mathematically C1; the baked LINEAR approximation is
 * only piecewise-linear (no continuous native-velocity/visual claim).
 *
 * Original source poses/IDs/key values are not modified. New interpolated
 * keys are never added to an existing semantic pose, so authored contact/
 * phase anchors retain their explicit channel ownership. The existing
 * gateway compiler still owns native time-grid/identity/role validation.
 */
export function bakeShapePreservingMotionToLinearRecipe(
  recipe: MotionRecipe,
  targets: readonly MotionPchipTarget[],
  options: MotionPchipOptions
) {
  const compiled=compileMotionRecipe(recipe);
  if (recipe.loop===true) {
    throw new Error("MOTION_PCHIP_LOOP_REQUIRES_PERIODIC_TANGENTS");
  }
  const fps=options?.sample_fps;
  const policy=options?.boundary_tangent??"shape_preserving";
  if (!Number.isSafeInteger(fps)||fps<10||fps>120 ||
      (policy!=="shape_preserving" && policy!=="rest_endpoints")) {
    throw new Error("MOTION_PCHIP_SAMPLING_POLICY_INVALID");
  }
  const speedRatio=options?.max_sampled_speed_ratio;
  const accelerationRatio=options?.max_sampled_acceleration_ratio;
  const jerkRatio=options?.max_sampled_jerk_ratio;
  for (const [name,ratio] of [
    ["SPEED",speedRatio],["ACCELERATION",accelerationRatio],["JERK",jerkRatio],
  ] as const) {
    if (ratio !== undefined &&
        (!Number.isFinite(ratio) || ratio < 1 || ratio > 3)) {
      throw new Error("MOTION_PCHIP_"+name+"_RATIO_INVALID");
    }
  }
  if (!Array.isArray(targets)||targets.length===0 ||
      targets.length>MOTION_PCHIP_MAX_TARGETS) {
    throw new Error("MOTION_PCHIP_TARGET_SELECTION_INVALID");
  }
  if (recipe.poses.some((pose)=>
    Math.abs(pose.time-Math.round(pose.time*fps)/fps)>MOTION_PCHIP_GRID_TOLERANCE
  )) throw new Error("MOTION_PCHIP_AUTHORED_CLOCK_NOT_ON_GRID");
  if (recipe.poses.some((pose)=>Object.values(pose.bones).some((transform)=>
    transform.interpolation!==undefined && transform.interpolation!=="linear"
  ))) throw new Error("MOTION_PCHIP_NONLINEAR_SOURCE_UNSUPPORTED");

  const originalPoseIds=new Set(recipe.poses.map((pose)=>pose.id));
  const originalPoseTimes=recipe.poses.map((pose)=>pose.time);
  const additions=new Map<number,PchipGeneratedPose>();
  const claimed=new Set<string>();
  let newKeyCount=0, effectiveShapeChange=false;
  for (const target of targets) {
    if (!target || typeof target.bone!=="string" ||
        !target.bone.trim() || target.bone!==target.bone.trim() ||
        (target.channel!=="position"&&target.channel!=="rotation")) {
      throw new Error("MOTION_PCHIP_TARGET_SELECTION_INVALID");
    }
    const ownership=target.bone+"\u0000"+target.channel;
    if (claimed.has(ownership)) {
      throw new Error("MOTION_PCHIP_DUPLICATE_CHANNEL_OWNERSHIP");
    }
    claimed.add(ownership);
    const frames=(compiled.bones[target.bone]??[])
      .filter((frame)=>frame[target.channel]!==undefined);
    if (frames.length<2) {
      throw new Error("MOTION_PCHIP_TRACK_NEEDS_TWO_AUTHORED_KEYS: "+target.bone);
    }
    const times=frames.map((frame)=>frame.time);
    const values=frames.map((frame)=>frame[target.channel] as MotionVec3);
    if (target.channel==="rotation" &&
        values.some((value,i)=>i>0 &&
          value.some((axis,j)=>Math.abs(axis-values[i-1][j])>120))) {
      throw new Error("MOTION_PCHIP_EULER_ARC_AMBIGUOUS: explicit intermediate rotation keys required.");
    }
    const tangents=[0,1,2].map((axis)=>
      pchipAxisSlopes(times,values.map((value)=>value[axis]),
        policy==="rest_endpoints")
    );
    for(let segment=0;segment<frames.length-1;segment++){
      const start=Math.round(times[segment]*fps);
      const end=Math.round(times[segment+1]*fps);
      const span=times[segment+1]-times[segment];
      for(let tick=start+1;tick<end;tick++){
        const time=tick/fps;
        // Do not introduce new keys into a semantic pose that intentionally
        // omitted this bone/channel, nor generate near-colliding key times.
        if (originalPoseTimes.some((authored)=>
          Math.abs(authored-time)<MOTION_PCHIP_GRID_TOLERANCE)) continue;
        const u=(time-times[segment])/span;
        if (!(u>0&&u<1)) continue;
        const u2=u*u,u3=u2*u;
        const h00=2*u3-3*u2+1,h10=u3-2*u2+u;
        const h01=-2*u3+3*u2,h11=u3-u2;
        const result=[0,1,2].map((axis)=>{
          const a=values[segment][axis],b=values[segment+1][axis];
          const mapped=h00*a+h10*span*tangents[axis][segment]+
            h01*b+h11*span*tangents[axis][segment+1];
          const tolerance=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
          if (!Number.isFinite(mapped) ||
              mapped<Math.min(a,b)-tolerance ||
              mapped>Math.max(a,b)+tolerance) {
            throw new Error("MOTION_PCHIP_NONFINITE_OR_OVERSHOOT");
          }
          const clamped=Math.max(Math.min(a,b),Math.min(Math.max(a,b),mapped));
          const linear=a+(b-a)*u;
          if (Math.abs(clamped-linear)>MOTION_PCHIP_LINEAR_DIFFERENCE) {
            effectiveShapeChange=true;
          }
          return clamped;
        }) as MotionVec3;
        newKeyCount++;
        if(newKeyCount>MOTION_PCHIP_MAX_ADDED_KEYS) {
          throw new Error("MOTION_PCHIP_SOURCE_KEY_BUDGET_EXCEEDED");
        }
        let pose=additions.get(tick);
        if(!pose){
          const id="__ld_pchip_"+tick;
          if(originalPoseIds.has(id)) {
            throw new Error("MOTION_PCHIP_SYNTHETIC_POSE_ID_CONFLICT");
          }
          pose={id,time,bones:{}};
          additions.set(tick,pose);
        }
        if (pose.bones[target.bone]?.[target.channel]!==undefined) {
          throw new Error("MOTION_PCHIP_DUPLICATE_CHANNEL_OWNERSHIP");
        }
        const bone=pose.bones[target.bone]??(pose.bones[target.bone]={});
        bone[target.channel]=result;
      }
    }
  }
  if (!effectiveShapeChange) {
    throw new Error("MOTION_PCHIP_NO_EFFECTIVE_SHAPE_CHANGE");
  }
  const anyDerivativeRatio = speedRatio !== undefined ||
    accelerationRatio !== undefined || jerkRatio !== undefined;
  const sampledDerivativeReports = anyDerivativeRatio
    ? targets.map((target) =>
        boundPchipTrackSampledDerivatives(compiled,additions,target,fps,{
          speed:speedRatio,acceleration:accelerationRatio,jerk:jerkRatio,
        }))
    : [];
  if (anyDerivativeRatio && sampledDerivativeReports.every(
    (report) => report.pchip_shape_weight <= 1e-6
  )) {
    throw new Error("MOTION_PCHIP_DERIVATIVE_CAP_NO_EFFECTIVE_SMOOTHING");
  }

  const clone=recipe.poses.map((pose):MotionPose=>({
    id:pose.id,time:pose.time,
    bones:Object.fromEntries(Object.entries(pose.bones).map(([bone,value])=>[
      bone,{
        ...(value.position?{position:[...value.position] as MotionVec3}:{}),
        ...(value.rotation?{rotation:[...value.rotation] as MotionVec3}:{}),
        ...(value.scale!==undefined
          ? {scale:typeof value.scale==="number"
              ? value.scale:[...value.scale] as MotionVec3} : {}),
        ...(value.interpolation?{interpolation:value.interpolation}:{}),
      },
    ])),
  }));
  const baked:MotionRecipe={
    name:recipe.name,loop:recipe.loop,duration:recipe.duration,
    poses:[...clone,...additions.values()].sort((a,b)=>a.time-b.time),
  };
  // Reuse canonical per-channel native collision checks before returning
  // an executable Gateway candidate.
  compileMotionRecipe(baked);
  return {
    recipe:baked,
    evidence:{
      state:"SOURCE_ONLY_SHAPE_PRESERVING_LINEAR_BAKE" as const,
      source_pose_count:recipe.poses.length,
      generated_pose_count:additions.size,
      generated_channel_key_count:newKeyCount,
      selected_channel_count:targets.length,
      source_sample_fps:fps,
      tangent_policy:policy,
      ...(speedRatio!==undefined?{
        sampled_peak_speed_guard:{
          state:"SOURCE_ONLY_SAMPLED_SPEED_BOUNDED" as const,
          max_sampled_speed_ratio:speedRatio,
          tracks:sampledDerivativeReports,
          source_duration_preserved:true as const,
          rest_endpoint_tangent_may_be_relaxed:
            policy==="rest_endpoints"&&
            sampledDerivativeReports.some((r)=>r.cap_applied),
          native_playback_attested:false as const,
          native_export_speed_attested:false as const,
        },
      }:{}),
      ...(accelerationRatio!==undefined||jerkRatio!==undefined?{
        sampled_derivative_guard:{
          state:"SOURCE_ONLY_SAMPLED_DERIVATIVES_BOUNDED" as const,
          max_sampled_acceleration_ratio:accelerationRatio??null,
          max_sampled_jerk_ratio:jerkRatio??null,
          tracks:sampledDerivativeReports,
          source_duration_preserved:true as const,
          rest_endpoint_tangent_may_be_relaxed:
            policy==="rest_endpoints"&&
            sampledDerivativeReports.some((r)=>r.cap_applied),
          native_playback_attested:false as const,
          native_export_derivatives_attested:false as const,
        },
      }:{}),
      authored_pose_ids_preserved:true as const,
      axiswise_no_overshoot_preflight:true as const,
      native_linear_approximation_only:true as const,
      native_playback_attested:false as const,
      native_export_timecodes_verified:false as const,
      visual_verdict:"not_evaluated" as const,
    },
  };
}

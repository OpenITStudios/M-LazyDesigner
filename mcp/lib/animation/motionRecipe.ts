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
  const additions=new Map<number,{
    id:string;time:number;
    bones:Record<string,{position?:MotionVec3;rotation?:MotionVec3}>;
  }>();
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
      authored_pose_ids_preserved:true as const,
      axiswise_no_overshoot_preflight:true as const,
      native_linear_approximation_only:true as const,
      native_playback_attested:false as const,
      native_export_timecodes_verified:false as const,
      visual_verdict:"not_evaluated" as const,
    },
  };
}

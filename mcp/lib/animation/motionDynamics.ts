import type { CompiledMotionRecipe, MotionPchipTarget, MotionVec3 } from "@/lib/animation/motionRecipe";

export type AnimationMotionChannel = "position" | "rotation" | "scale";

export type AnimationMotionTrackInput = {
  group_uuid: string;
  group_name: string;
  channel: AnimationMotionChannel;
  // Multiple native data points may encode pre/post discontinuities.
  keyframes: Array<{ time: number; value: readonly unknown[]; data_point_count?: number }>;
};

const EPSILON = 1e-9;
const DEFAULT_EXAMPLE_LIMIT = 6;

type Vec3 = [number, number, number];

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function finiteVec3(value: readonly unknown[]): Vec3 | null {
  if (
    value.length < 3 ||
    !value.slice(0, 3).every(
      (entry) => typeof entry === "number" && Number.isFinite(entry)
    )
  ) {
    return null;
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function angularDelta(from: number, to: number): number {
  let delta = ((to - from + 180) % 360 + 360) % 360 - 180;
  if (Object.is(delta, -0)) delta = 0;
  return delta;
}

function delta(
  channel: AnimationMotionChannel,
  from: Vec3,
  to: Vec3
): Vec3 {
  return channel === "rotation"
    ? [
        angularDelta(from[0], to[0]),
        angularDelta(from[1], to[1]),
        angularDelta(from[2], to[2]),
      ]
    : [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  ];
}

function divide(value: Vec3, divisor: number): Vec3 {
  return [value[0] / divisor, value[1] / divisor, value[2] / divisor];
}

function magnitude(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function analyzeTrack(track: AnimationMotionTrackInput) {
  // getArray(0) alone cannot describe a native key with 0 or 2+ data points.
  // Refuse such numeric diagnostics rather than treating a step as smooth.
  if (track.keyframes.some((frame) =>
    frame.data_point_count !== undefined && frame.data_point_count !== 1
  )) {
    return {
      state: "unavailable" as const,
      reason: "non_single_native_data_point" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: 0,
    };
  }
  const unevaluatedKeyframes = track.keyframes.filter(
    (keyframe) => !Number.isFinite(keyframe.time) || keyframe.time < 0 ||
      finiteVec3(keyframe.value) === null
  ).length;
  if (unevaluatedKeyframes > 0) {
    return {
      state: "unavailable" as const,
      reason: "non_numeric_or_invalid_keyframes" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: track.keyframes.length - unevaluatedKeyframes,
    };
  }
  const sorted = track.keyframes
    .map((keyframe) => ({
      time: Number(keyframe.time),
      value: finiteVec3(keyframe.value),
    }))
    .filter(
      (entry): entry is { time: number; value: Vec3 } =>
        Number.isFinite(entry.time) && entry.time >= 0 && entry.value !== null
    )
    .sort((left, right) => left.time - right.time);

  // Equal timestamps may represent an ordered discontinuity, and choosing
  // the final entry silently fabricates an authored velocity/path.
  if (sorted.some((entry, index) =>
    index > 0 && entry.time === sorted[index - 1]!.time
  )) {
    return {
      state: "unavailable" as const,
      reason: "duplicate_keyframe_time" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: sorted.length,
    };
  }
  const samples = sorted;

  if (samples.length < 2) {
    return {
      state: "unavailable" as const,
      reason: "insufficient_distinct_numeric_times" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: samples.length,
    };
  }

  const segments: Array<{
    midpoint: number;
    velocity: Vec3;
    speed: number;
    distance: number;
  }> = [];
  let pathLength = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const dt = current.time - previous.time;
    if (dt <= 0) continue;
    const segmentDelta = delta(track.channel, previous.value, current.value);
    const distance = magnitude(segmentDelta);
    const velocity = divide(segmentDelta, dt);
    segments.push({
      midpoint: (previous.time + current.time) / 2,
      velocity,
      speed: magnitude(velocity),
      distance,
    });
    pathLength += distance;
  }

  if (segments.length === 0) {
    return {
      state: "unavailable" as const,
      reason: "insufficient_distinct_numeric_times" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: samples.length,
    };
  }

  const accelerations: Array<{
    midpoint: number;
    vector: Vec3;
    magnitude: number;
  }> = [];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const dt = current.midpoint - previous.midpoint;
    if (dt <= 0) continue;
    const vector = divide(subtract(current.velocity, previous.velocity), dt);
    accelerations.push({
      midpoint: (previous.midpoint + current.midpoint) / 2,
      vector,
      magnitude: magnitude(vector),
    });
  }

  const jerks: number[] = [];
  for (let index = 1; index < accelerations.length; index += 1) {
    const previous = accelerations[index - 1];
    const current = accelerations[index];
    const dt = current.midpoint - previous.midpoint;
    if (dt <= 0) continue;
    jerks.push(magnitude(divide(subtract(current.vector, previous.vector), dt)));
  }

  const displacement = magnitude(
    delta(track.channel, samples[0].value, samples[samples.length - 1].value)
  );
  const speeds = segments.map((segment) => segment.speed);
  const meanSpeed = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
  const speedVariance =
    speeds.reduce((sum, value) => sum + (value - meanSpeed) ** 2, 0) /
    speeds.length;
  const firstVelocity = segments[0].velocity;
  const lastVelocity = segments[segments.length - 1].velocity;

  return {
    state: "available" as const,
    group_uuid: track.group_uuid,
    group_name: track.group_name,
    channel: track.channel,
    numeric_keyframes: samples.length,
    segment_count: segments.length,
    path_length: round(pathLength),
    displacement: round(displacement),
    closed_path: displacement <= EPSILON && pathLength > EPSILON,
    path_to_displacement_ratio:
      displacement > EPSILON ? round(pathLength / displacement) : null,
    speed: {
      mean: round(meanSpeed),
      max: round(Math.max(...speeds)),
      coefficient_of_variation:
        meanSpeed > EPSILON ? round(Math.sqrt(speedVariance) / meanSpeed) : 0,
    },
    acceleration: {
      sample_count: accelerations.length,
      max: accelerations.length
        ? round(Math.max(...accelerations.map((entry) => entry.magnitude)))
        : 0,
    },
    jerk: {
      sample_count: jerks.length,
      max: jerks.length ? round(Math.max(...jerks)) : 0,
    },
    boundary_velocity_delta: round(
      magnitude(subtract(lastVelocity, firstVelocity))
    ),
  };
}

export function analyzeAnimationMotionDynamics(input: {
  loop_mode: string;
  tracks: readonly AnimationMotionTrackInput[];
  example_limit?: number;
}) {
  const exampleLimit = input.example_limit ?? DEFAULT_EXAMPLE_LIMIT;
  const analyzed = input.tracks.map(analyzeTrack);
  const available = analyzed.filter(
    (entry): entry is Extract<(typeof analyzed)[number], { state: "available" }> =>
      entry.state === "available"
  );
  const unevaluated = analyzed.filter((entry) => entry.state === "unavailable");
  const coverage = {
    unevaluated_track_count: unevaluated.length,
    unevaluated_examples: unevaluated.slice(0, exampleLimit),
    unevaluated_examples_truncated: unevaluated.length > exampleLimit,
  };

  if (available.length === 0) {
    return {
      state: "unavailable" as const,
      reason: "no_numeric_motion_tracks" as const,
      evaluated_tracks: input.tracks.length,
      ...coverage,
    };
  }

  const ranked = available
    .slice()
    .sort(
      (left, right) =>
        right.jerk.max - left.jerk.max ||
        right.acceleration.max - left.acceleration.max ||
        right.speed.max - left.speed.max ||
        left.group_name.localeCompare(right.group_name)
    );

  const boundary = input.loop_mode === "loop"
    ? available
        .filter((entry) => entry.segment_count >= 2)
        .slice()
        .sort(
          (left, right) =>
            right.boundary_velocity_delta - left.boundary_velocity_delta ||
            left.group_name.localeCompare(right.group_name)
        )
    : [];

  // Count each moving bone once per exact interior key time, across channels.
  // Shared timestamps are review evidence, not proof of rigid motion.
  const movingBones = new Set<string>();
  const bonesByTime = new Map<number, Set<string>>();
  for (let index = 0; index < analyzed.length; index += 1) {
    const analysis = analyzed[index];
    if (analysis.state !== "available" || analysis.path_length <= EPSILON) continue;
    const track = input.tracks[index];
    movingBones.add(track.group_uuid);
    const times = [...new Set(track.keyframes.map((keyframe) => keyframe.time))]
      .sort((left, right) => left - right);
    for (const time of times.slice(1, -1)) {
      const bones = bonesByTime.get(time) ?? new Set<string>();
      bones.add(track.group_uuid);
      bonesByTime.set(time, bones);
    }
  }
  const peak = [...bonesByTime.entries()].sort(
    (left, right) => right[1].size - left[1].size || left[0] - right[0]
  )[0];
  const peakRatio = movingBones.size ? (peak?.[1].size ?? 0) / movingBones.size : 0;

  return {
    state: "available" as const,
    evaluated_tracks: input.tracks.length,
    numeric_track_count: available.length,
    ...coverage,
    key_timing: {
      moving_bone_count: movingBones.size,
      peak_shared_interior_time: peak?.[0] ?? null,
      peak_shared_bone_count: peak?.[1].size ?? 0,
      peak_shared_bone_ratio: round(peakRatio),
      review_secondary_timing: movingBones.size >= 4 && peakRatio >= 0.8,
      note: "Exact interior authored key times per track, across fully numeric moving tracks only. Shared timing may be intentional for contact; review secondary motion before staggering. This does not measure pose synchrony or certify playback.",
    },
    examples: ranked.slice(0, exampleLimit),
    examples_truncated: ranked.length > exampleLimit,
    loop_boundary_velocity: {
      applicable: input.loop_mode === "loop",
      examples: boundary.slice(0, exampleLimit).map((entry) => ({
        group_uuid: entry.group_uuid,
        group_name: entry.group_name,
        channel: entry.channel,
        boundary_velocity_delta: entry.boundary_velocity_delta,
      })),
      examples_truncated: boundary.length > exampleLimit,
    },
    note:
      "Authored-key differences only, not interpolated playback. Tracks containing expressions or invalid keys are unevaluated, never bridged across missing values. Position uses Blockbench units, rotation uses shortest-angle degrees, and scale is unitless; no artistic PASS/FAIL is inferred.",
  };
}

/**
 * Same-clock, source-only QA for a native-LINEAR PCHIP bake.
 *
 * Existing numeric motion dynamics are reused on TWO equally sampled tracks:
 * (1) piecewise-linear authored source and (2) the sampled LINEAR bake.
 * Comparing their original sparse vs dense keyframe derivatives directly
 * would be invalid. This never alters either clip, evaluates native curves,
 * claims continuous baked velocity, or scores artistic motion quality.
 */
export const PCHIP_CONTINUITY_MAX_GRID_SAMPLES = 2048;
const PCHIP_CONTINUITY_MAX_KNOT_EXAMPLES = 12;
const PCHIP_CONTINUITY_CLOCK_EPSILON = 1e-8;

export function comparePchipLinearContinuityOnSharedGrid(input: {
  source: CompiledMotionRecipe;
  baked: CompiledMotionRecipe;
  targets: readonly MotionPchipTarget[];
  sample_fps: number;
}) {
  const unavailable=(reason:string)=>({
    state:"unavailable" as const,reason,
    evaluated_track_count:0,
    tracks:[] as Array<unknown>,
    native_playback_attested:false as const,
    native_export_timecodes_verified:false as const,
    visual_verdict:"not_evaluated" as const,
  });
  if (!input || !input.source || !input.baked ||
      input.source.name!==input.baked.name ||
      input.source.duration!==input.baked.duration ||
      input.source.loop!==false || input.baked.loop!==false ||
      !Number.isSafeInteger(input.sample_fps) ||
      input.sample_fps<10 || input.sample_fps>120 ||
      !Array.isArray(input.targets) || input.targets.length<1 ||
      input.targets.length>12) {
    return unavailable("PCHIP_CONTINUITY_INPUT_OR_CLOCK_INVALID");
  }
  const fps=input.sample_fps,seen=new Set<string>();
  const validVector=(value:unknown):value is MotionVec3=>
    Array.isArray(value)&&value.length===3&&value.every((v)=>
      typeof v==="number"&&Number.isFinite(v)
    );
  type Key={time:number;value:MotionVec3;interpolation?:string};
  const trackFor=(recipe:CompiledMotionRecipe,bone:string,
    channel:"position"|"rotation"):Key[]=>
    (recipe.bones[bone]??[]).filter((frame)=>
      frame[channel]!==undefined
    ).map((frame)=>({
      time:frame.time,
      value:frame[channel] as MotionVec3,
      interpolation:frame.interpolation,
    }));
  const interpolate=(track:readonly Key[],time:number):MotionVec3|null=>{
    if (!track.length || time<track[0].time-PCHIP_CONTINUITY_CLOCK_EPSILON ||
        time>track[track.length-1].time+PCHIP_CONTINUITY_CLOCK_EPSILON) {
      return null;
    }
    let low=0,high=track.length-1;
    while(low+1<high){
      const mid=(low+high)>>1;
      if(track[mid].time<time)low=mid;else high=mid;
    }
    if(Math.abs(track[low].time-time)<=PCHIP_CONTINUITY_CLOCK_EPSILON)
      return [...track[low].value] as MotionVec3;
    if(Math.abs(track[high].time-time)<=PCHIP_CONTINUITY_CLOCK_EPSILON)
      return [...track[high].value] as MotionVec3;
    const span=track[high].time-track[low].time;
    if(!(span>0))return null;
    const a=(time-track[low].time)/span;
    return [0,1,2].map((axis)=>
      track[low].value[axis]+a*(track[high].value[axis]-
        track[low].value[axis])
    ) as MotionVec3;
  };
  const velocityJump=(positions:readonly MotionVec3[],index:number)=>{
    const l=positions[index-1],m=positions[index],r=positions[index+1];
    return Math.hypot(...[0,1,2].map((axis)=>
      ((r[axis]-m[axis])-(m[axis]-l[axis]))*fps
    ));
  };
  const tracks:Array<{
    bone:string;
    channel:"position"|"rotation";
    units:"degrees"|"blockbench_model_units";
    grid_sample_count:number;
    authored_interior_knot_count:number;
    source_dynamics:{
      max_speed:number;max_acceleration:number;max_jerk:number;
      path_length:number;
    };
    baked_dynamics:{
      max_speed:number;max_acceleration:number;max_jerk:number;
      path_length:number;
    };
    knot_velocity_jump:{
      max_source:number;max_baked:number;
      decreased_count:number;increased_count:number;unchanged_count:number;
      examples:Array<{
        time:number;source_jump:number;baked_jump:number;
        change:"decreased"|"increased"|"unchanged";
      }>;
      examples_truncated:boolean;
    };
  }>=[];
  for(const target of input.targets){
    if(!target||typeof target.bone!=="string"||!target.bone.trim()||
        !["position","rotation"].includes(target.channel)) {
      return unavailable("PCHIP_CONTINUITY_TARGET_INVALID");
    }
    const identity=target.bone+"\u0000"+target.channel;
    if(seen.has(identity))return unavailable("PCHIP_CONTINUITY_TARGET_DUPLICATE");
    seen.add(identity);
    const source=trackFor(input.source,target.bone,target.channel);
    const baked=trackFor(input.baked,target.bone,target.channel);
    if(source.length<2||baked.length<2 ||
        source.some((key)=>!validVector(key.value)||
          (key.interpolation!==undefined&&key.interpolation!=="linear")) ||
        baked.some((key)=>!validVector(key.value)||
          (key.interpolation!==undefined&&key.interpolation!=="linear")) ||
        source.some((key,i)=>i>0 && key.time<=source[i-1].time)||
        baked.some((key,i)=>i>0 && key.time<=baked[i-1].time)) {
      return unavailable("PCHIP_CONTINUITY_CHANNEL_SOURCE_UNVERIFIED");
    }
    if(Math.abs(source[0].time-baked[0].time)>PCHIP_CONTINUITY_CLOCK_EPSILON||
        Math.abs(source[source.length-1].time-baked[baked.length-1].time)>
          PCHIP_CONTINUITY_CLOCK_EPSILON ||
        source.some((key)=>!Number.isFinite(key.time)||
          Math.abs(key.time-Math.round(key.time*fps)/fps)>
            PCHIP_CONTINUITY_CLOCK_EPSILON)) {
      return unavailable("PCHIP_CONTINUITY_SOURCE_CLOCK_OR_EXTENT_MISMATCH");
    }
    // A smooth curve must never move a user-authored primary pose/phase key.
    if(source.some((key)=>{
      const replay=interpolate(baked,key.time);
      return replay===null || key.value.some((v,i)=>
        !Number.isFinite(replay[i])||
        Math.abs(v-replay[i])>1e-7*Math.max(1,Math.abs(v))
      );
    }))return unavailable("PCHIP_CONTINUITY_AUTHORED_ANCHOR_CHANGED");
    const firstTick=Math.round(source[0].time*fps);
    const lastTick=Math.round(source[source.length-1].time*fps);
    const count=lastTick-firstTick+1;
    if(!Number.isSafeInteger(count)||count<2||
        count>PCHIP_CONTINUITY_MAX_GRID_SAMPLES) {
      return unavailable("PCHIP_CONTINUITY_GRID_SAMPLE_BUDGET_EXCEEDED");
    }
    const sourcePositions:MotionVec3[]=[],bakedPositions:MotionVec3[]=[];
    for(let tick=firstTick;tick<=lastTick;tick++){
      const time=tick/fps;
      const a=interpolate(source,time),b=interpolate(baked,time);
      if(!a||!b||!validVector(a)||!validVector(b)) {
        return unavailable("PCHIP_CONTINUITY_GRID_VALUES_UNAVAILABLE");
      }
      sourcePositions.push(a);
      bakedPositions.push(b);
    }
    const numeric=(positions:readonly MotionVec3[])=>{
      const out=analyzeAnimationMotionDynamics({
        loop_mode:"once",
        tracks:[{
          group_uuid:target.bone,
          group_name:target.bone,
          channel:target.channel,
          keyframes:positions.map((value,i)=>({
            time:(firstTick+i)/fps,value,data_point_count:1,
          })),
        }],
        example_limit:1,
      });
      if(out.state!=="available"||out.examples.length!==1)return null;
      const one=out.examples[0];
      const metrics={
        max_speed:one.speed.max,
        max_acceleration:one.acceleration.max,
        max_jerk:one.jerk.max,
        path_length:one.path_length,
      };
      return Object.values(metrics).every(Number.isFinite)?metrics:null;
    };
    const sourceMetrics=numeric(sourcePositions);
    const bakedMetrics=numeric(bakedPositions);
    if(!sourceMetrics||!bakedMetrics) {
      return unavailable("PCHIP_CONTINUITY_DYNAMICS_NONFINITE_OR_UNAVAILABLE");
    }
    let maxSource=0,maxBaked=0,decreased=0,increased=0,unchanged=0;
    const examples:Array<{
      time:number;source_jump:number;baked_jump:number;
      change:"decreased"|"increased"|"unchanged";
    }>=[];
    for(let i=1;i<source.length-1;i++){
      const key=source[i];
      const at=Math.round(key.time*fps)-firstTick;
      if(at<=0||at>=count-1){
        return unavailable("PCHIP_CONTINUITY_INTERIOR_KNOT_CLOCK_INVALID");
      }
      const before=velocityJump(sourcePositions,at);
      const after=velocityJump(bakedPositions,at);
      if(!Number.isFinite(before)||!Number.isFinite(after)){
        return unavailable("PCHIP_CONTINUITY_KNOT_METRIC_NONFINITE");
      }
      maxSource=Math.max(maxSource,before);
      maxBaked=Math.max(maxBaked,after);
      const comparisonTolerance=Math.max(1e-5,before*1e-4);
      const change=after<before-comparisonTolerance?"decreased":
        after>before+comparisonTolerance?"increased":"unchanged";
      if(change==="decreased")decreased++;
      else if(change==="increased")increased++;
      else unchanged++;
      if(examples.length<PCHIP_CONTINUITY_MAX_KNOT_EXAMPLES){
        examples.push({
          time:key.time,
          source_jump:round(before,6),
          baked_jump:round(after,6),
          change,
        });
      }
    }
    tracks.push({
      bone:target.bone,channel:target.channel,
      units:target.channel==="rotation"?"degrees":"blockbench_model_units",
      grid_sample_count:count,
      authored_interior_knot_count:source.length-2,
      source_dynamics:sourceMetrics,baked_dynamics:bakedMetrics,
      knot_velocity_jump:{
        max_source:round(maxSource,6),max_baked:round(maxBaked,6),
        decreased_count:decreased,increased_count:increased,
        unchanged_count:unchanged,examples,
        examples_truncated:source.length-2>examples.length,
      },
    });
  }
  return {
    state:"SOURCE_ONLY_SHARED_GRID_CONTINUITY_COMPARISON" as const,
    reason:null,
    sample_fps:fps,
    analyzed_track_count:tracks.length,
    evaluated_interior_knot_count:tracks.reduce(
      (sum,track)=>sum+track.authored_interior_knot_count,0
    ),
    tracks,
    comparison_basis:"SAME_GRID_LINEAR_SOURCE_VS_PCHIP_BAKE" as const,
    units_are_not_aggregated_across_channels:true as const,
    native_playback_attested:false as const,
    native_export_timecodes_verified:false as const,
    continuous_native_velocity_attested:false as const,
    visual_verdict:"not_evaluated" as const,
    note:"Compare equal-clock source-linear and PCHIP-linear samples only; "+
      "speed/acceleration/jerk are discrete finite differences. A lower "+
      "measured jump is neither native C1 continuity nor artistic approval.",
  };
}

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

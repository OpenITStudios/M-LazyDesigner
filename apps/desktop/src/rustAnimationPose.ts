// Read-only numeric linear/step/Catmull-Rom/Bezier Bone pose.
// Molang, effects and controllers are not evaluated. Bezier time handles
// use monotone cubic inversion rather than Blockbench's 200-point sampling.
// Position is an offset from the Bone bind origin; Scale multiplies bind pose.
// Pinned Blockbench v5.2.1 BoneAnimator.displayPosition/displayScale.
import type {
  AnimationView, BezierKeyframeHandles, BoneView, RotationKeyframeView,
  TransformChannel, TransformKeyframeView, Vec3,
} from './rustEditorTypes';

export type BoneTransformPose = {
  rotation: Vec3;
  position: Vec3;
  scale: Vec3;
};
const CHANNELS: readonly TransformChannel[] = ['rotation', 'position', 'scale'];
const DEFAULT_RIGHT_TIME = 0.1;
const DEFAULT_LEFT_TIME = -0.1;

/** Accept only fully typed and bounded saved Bezier handles. */
function validBezier(value: unknown): value is BezierKeyframeHandles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Partial<BezierKeyframeHandles>;
  if (typeof fields.linked !== 'boolean') return false;
  const vec = (candidate: unknown, lo: number, hi: number) =>
    Array.isArray(candidate) && candidate.length === 3 &&
    candidate.every(axis => typeof axis === 'number' &&
      Number.isFinite(axis) && axis >= lo && axis <= hi);
  if (!vec(fields.leftTime,-3600,0) || !vec(fields.rightTime,0,3600) ||
      !vec(fields.leftValue,-100000,100000) ||
      !vec(fields.rightValue,-100000,100000)) return false;
  if (!fields.linked) return true;
  return [0,1,2].every(i =>
    Math.abs(fields.leftTime![i] + fields.rightTime![i]) <= 1e-9 &&
    Math.abs(fields.leftValue![i] + fields.rightValue![i]) <= 1e-9);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

/** Exact time-axis inversion for admitted monotone Bezier handles.
 * Blockbench 5.2.1 samples 200 points for a rough inverse. We use a
 * fixed 30-step bisection, bounded per axis, then evaluate the cubic y.
 */
function bezierValue(
  before: TransformKeyframeView, after: TransformKeyframeView, time: number,
): Vec3 {
  const gap = after.time - before.time;
  return before.value.map((value, axis) => {
    const timeA = before.time + clamp(
      before.bezier?.rightTime[axis] ?? DEFAULT_RIGHT_TIME, 0, gap);
    const timeB = after.time + clamp(
      after.bezier?.leftTime[axis] ?? DEFAULT_LEFT_TIME, -gap, 0);
    const yA = value + (before.bezier?.rightValue[axis] ?? 0);
    const yB = after.value[axis] + (after.bezier?.leftValue[axis] ?? 0);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (cubic(before.time,timeA,timeB,after.time,mid) < time) lo = mid;
      else hi = mid;
    }
    return cubic(value,yA,yB,after.value[axis],(lo + hi) / 2);
  }) as Vec3;
}

/** Validated, sorted read-only projection of one Rust/Tauri animation snapshot. */
export type PreparedBoneTransformPose = {
  readonly length: number;
  readonly loopMode: 'once' | 'loop' | 'hold';
  readonly tracks: ReadonlyMap<string, ReadonlyMap<TransformChannel, readonly TransformKeyframeView[]>>;
};

function boundedFrames(animation: AnimationView): TransformKeyframeView[] | null {
  if (!animation.previewSupported || !Number.isFinite(animation.length) ||
      animation.length < 0 || animation.length > 3600) return null;
  // Legacy source/test fixtures contained only the rotation projection.
  // New Tauri snapshots supply all channel frames explicitly.
  if (Array.isArray(animation.transformKeyframes)) {
    return animation.transformKeyframes;
  }
  if (!Array.isArray(animation.rotationKeyframes)) return null;
  return animation.rotationKeyframes.map((frame: RotationKeyframeView) => ({
    uuid: frame.uuid, boneUuid: frame.boneUuid,
    channel: 'rotation' as const, time: frame.time,
    value: frame.rotation,
  }));
}

function grouped(
  animation: AnimationView | null | undefined,
): Map<string, Map<TransformChannel, TransformKeyframeView[]>> | null {
  if (!animation) return null;
  const frames = boundedFrames(animation);
  if (!frames || frames.length > 2048) return null;
  const bones = new Map<string, Map<TransformChannel, TransformKeyframeView[]>>();
  const ids = new Set<string>();
  for (const frame of frames) {
    if (!frame.boneUuid || !frame.uuid || ids.has(frame.uuid) ||
        !CHANNELS.includes(frame.channel) ||
        !Number.isFinite(frame.time) || frame.time < 0 ||
        frame.time > animation.length ||
        (frame.interpolation !== undefined &&
          frame.interpolation !== 'linear' && frame.interpolation !== 'step' &&
          frame.interpolation !== 'catmullrom' &&
          frame.interpolation !== 'bezier') ||
        (frame.interpolation === 'bezier'
          ? !validBezier(frame.bezier) : frame.bezier !== undefined) ||
        !Array.isArray(frame.value) || frame.value.length !== 3 ||
        !frame.value.every((axis) =>
          typeof axis === 'number' && Number.isFinite(axis) &&
          Math.abs(axis) <= 100_000) ||
        (frame.channel === 'scale' &&
          frame.value.some((axis) => axis < 0 || axis > 100))) return null;
    ids.add(frame.uuid);
    let channels = bones.get(frame.boneUuid);
    if (!channels) { channels = new Map(); bones.set(frame.boneUuid, channels); }
    const track = channels.get(frame.channel) ?? [];
    track.push(frame);
    channels.set(frame.channel, track);
  }
  for (const channels of bones.values()) {
    for (const [channel, frames] of channels) {
      const ordered = [...frames].sort((a, b) => a.time - b.time);
      if (ordered.some((frame, i) => i > 0 &&
          frame.time - ordered[i - 1].time <= 1e-6)) return null;
      // A cubic with crossing time handles cannot be inverted uniquely.
      // Reject those saved curves instead of depicting a fabricated pose.
      for (let i = 1; i < ordered.length; i++) {
        const previous = ordered[i - 1];
        const following = ordered[i];
        if (previous.interpolation === 'step' ||
            previous.interpolation === 'catmullrom' ||
            following.interpolation === 'catmullrom' ||
            (previous.interpolation !== 'bezier' &&
             following.interpolation !== 'bezier')) continue;
        const gap = following.time - previous.time;
        for (let axis = 0; axis < 3; axis++) {
          const right = clamp(previous.bezier?.rightTime[axis] ??
            DEFAULT_RIGHT_TIME, 0, gap);
          const left = clamp(following.bezier?.leftTime[axis] ??
            DEFAULT_LEFT_TIME, -gap, 0);
          if (right > gap + left + 1e-9) return null;
        }
      }
      channels.set(channel, ordered);
    }
  }
  return bones;
}

/** Prepare on animation snapshot changes, not on each playback frame. */
export function prepareBoneTransformPose(
  animation: AnimationView | null | undefined,
): PreparedBoneTransformPose | null {
  if (!animation) return null;
  // Legacy rotation-only test fixtures have no loop metadata. Actual Rust
  // snapshots always include a supported explicit once/loop/hold value.
  const loopMode = animation.loopMode ?? 'once';
  if (loopMode !== 'once' && loopMode !== 'loop' && loopMode !== 'hold') return null;
  const tracks = grouped(animation);
  return tracks ? { length: animation.length, loopMode, tracks } : null;
}

/** Three.js SplineCurve's uniform Catmull-Rom y interpolation on key values.
 * The original Blockbench evaluator uses the neighbouring keyframes by
 * *index*, not time-scaled tangents. It ignores the SplineCurve x coordinate
 * after setting the index-normalized parameter. Preserve that behavior.
 */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, alpha: number): Vec3 {
  const t2 = alpha * alpha;
  const t3 = t2 * alpha;
  return p1.map((value, i) => 0.5 * (
    2 * value + (-p0[i] + p2[i]) * alpha +
    (2 * p0[i] - 5 * value + 4 * p2[i] - p3[i]) * t2 +
    (-p0[i] + 3 * value - 3 * p2[i] + p3[i]) * t3
  )) as Vec3;
}

function interpolate(
  frames: readonly TransformKeyframeView[], time: number,
  loopMode: PreparedBoneTransformPose['loopMode'],
): Vec3 {
  if (time <= frames[0].time) return [...frames[0].value] as Vec3;
  if (time >= frames[frames.length - 1].time) {
    return [...frames[frames.length - 1].value] as Vec3;
  }
  // Per-channel frames were validated and sorted once at snapshot arrival.
  // Binary search avoids scanning the entire track at every preview frame.
  let low = 1;
  let high = frames.length - 1;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (frames[mid].time >= time) high = mid;
    else low = mid + 1;
  }
  const previous = frames[low - 1];
  const after = frames[low];
  // Blockbench's Step belongs to the earlier keyframe. At the next key's
  // exact time its own value takes effect, rather than holding the old pose.
  if (time === after.time) return [...after.value] as Vec3;
  // The outgoing Step of the earlier keyframe takes precedence.
  if (previous.interpolation === 'step') return [...previous.value] as Vec3;
  const alpha = (time - previous.time) / (after.time - previous.time);
  if (previous.interpolation === 'catmullrom' ||
      after.interpolation === 'catmullrom') {
    // Match pinned Blockbench BoneAnimator.interpolate: for a loop with
    // >= 3 keys, the absent first/last neighbour is the second-to-last/
    // second key. Sampling of the wrap seam itself remains separately gated.
    const prior = frames[low - 2] ??
      (loopMode === 'loop' && frames.length >= 3
        ? frames[frames.length - 2] : previous);
    const following = frames[low + 1] ??
      (loopMode === 'loop' && frames.length >= 3
        ? frames[1] : after);
    return catmullRom(prior.value, previous.value,
      after.value, following.value, alpha);
  }
  if (previous.interpolation === 'bezier' ||
      after.interpolation === 'bezier') {
    return bezierValue(previous, after, time);
  }
  // Legacy fixtures missing the field preserve their linear behavior.
  return previous.value.map((axis, index) =>
    axis + (after.value[index] - axis) * alpha) as Vec3;
}

export function samplePreparedBoneTransformPose(
  prepared: PreparedBoneTransformPose | null | undefined, time: number,
): Record<string, BoneTransformPose> | null {
  if (!prepared || !Number.isFinite(time) || time < 0 ||
      time > prepared.length) return null;
  const tracks = prepared.tracks;
  // A null prototype ensures user-provided UUIDs cannot alter object methods.
  const pose = Object.create(null) as Record<string, BoneTransformPose>;
  for (const [boneUuid, channels] of tracks) {
    const result: BoneTransformPose = {
      rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1],
    };
    for (const channel of CHANNELS) {
      const frames = channels.get(channel);
      if (frames?.length) result[channel] = interpolate(frames, time, prepared.loopMode);
    }
    // A valid key set can have a spline overshoot; never render a
    // nonfinite/out-of-domain derived pose as if it were authored.
    if (!Object.values(result).every((values) =>
        values.every((value) => Number.isFinite(value) &&
          Math.abs(value) <= 100_000)) ||
        result.scale.some((value) => value < 0 || value > 100)) return null;
    pose[boneUuid] = result;
  }
  return pose;
}

/** Preserve the direct single-call API for existing non-playback consumers. */
export function projectedBoneTransformPose(
  animation: AnimationView | null | undefined, time: number,
): Record<string, BoneTransformPose> | null {
  return samplePreparedBoneTransformPose(prepareBoneTransformPose(animation), time);
}

/** Compatibility view for existing rotation-only animation consumers. */
export function projectedBoneRotationPose(
  animation: AnimationView | null | undefined, time: number,
): Record<string, Vec3> | null {
  const transform = projectedBoneTransformPose(animation, time);
  if (!transform) return null;
  const rotations = Object.create(null) as Record<string, Vec3>;
  for (const [uuid, pose] of Object.entries(transform)) {
    rotations[uuid] = pose.rotation;
  }
  return rotations;
}

export type TransformTimelineRow = {
  boneUuid: string;
  boneName: string;
  channel: TransformChannel;
  frames: TransformKeyframeView[];
};

/** Derived timeline rows use Rust-authoritative Bone order and per-channel time. */
export function projectedTransformTimelineRows(
  animation: AnimationView | null | undefined,
  bones: readonly Pick<BoneView, 'uuid' | 'name'>[],
): TransformTimelineRow[] {
  const groupedFrames = grouped(animation);
  if (!groupedFrames) return [];
  const boneIds = new Set(bones.map((bone) => bone.uuid));
  if ([...groupedFrames.keys()].some((id) => !boneIds.has(id))) return [];
  return bones.flatMap((bone) => CHANNELS.flatMap((channel) => {
    const frames = groupedFrames.get(bone.uuid)?.get(channel);
    return frames?.length ? [{
      boneUuid: bone.uuid, boneName: bone.name, channel, frames,
    }] : [];
  }));
}

/** Preserve the previous rotation-only grouped timeline helper. */
export type RotationTimelineRow = {
  boneUuid: string;
  boneName: string;
  frames: RotationKeyframeView[];
};
export function projectedRotationTimelineRows(
  animation: AnimationView | null | undefined,
  bones: readonly Pick<BoneView, 'uuid' | 'name'>[],
): RotationTimelineRow[] {
  return projectedTransformTimelineRows(animation, bones)
    .filter((row) => row.channel === 'rotation')
    .map((row) => ({
      boneUuid: row.boneUuid, boneName: row.boneName,
      frames: row.frames.map((frame) => ({
        uuid: frame.uuid, boneUuid: frame.boneUuid,
        time: frame.time, rotation: [...frame.value] as Vec3,
      })),
    }));
}

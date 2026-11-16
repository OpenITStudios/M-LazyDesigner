// Read-only numeric linear/step Bone Animation pose for the Rust/Tauri subset.
// This does not evaluate Molang, effects, Bezier, Catmull-Rom or controllers.
// Position is an offset from the Bone bind origin; Scale multiplies bind pose.
// Pinned Blockbench v5.2.1 BoneAnimator.displayPosition/displayScale.
import type {
  AnimationView, BoneView, RotationKeyframeView, TransformChannel,
  TransformKeyframeView, Vec3,
} from './rustEditorTypes';

export type BoneTransformPose = {
  rotation: Vec3;
  position: Vec3;
  scale: Vec3;
};
const CHANNELS: readonly TransformChannel[] = ['rotation', 'position', 'scale'];

/** Validated, sorted read-only projection of one Rust/Tauri animation snapshot. */
export type PreparedBoneTransformPose = {
  readonly length: number;
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
          frame.interpolation !== 'linear' && frame.interpolation !== 'step') ||
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
  const tracks = grouped(animation);
  return tracks ? { length: animation.length, tracks } : null;
}

function interpolate(frames: readonly TransformKeyframeView[], time: number): Vec3 {
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
  // Compatibility for older rotation-only projections without a saved mode:
  // canonical Rust/Tauri frames always include linear or step explicitly.
  if (previous.interpolation === 'step') return [...previous.value] as Vec3;
  const alpha = (time - previous.time) / (after.time - previous.time);
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
      if (frames?.length) result[channel] = interpolate(frames, time);
    }
    if (!Object.values(result).every((values) =>
        values.every((value) => Number.isFinite(value)))) return null;
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

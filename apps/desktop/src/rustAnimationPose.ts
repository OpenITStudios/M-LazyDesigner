// Read-only static rotation pose for the bounded Rust Animate source subset.
// This does not evaluate Molang, effects, loops or quaternion interpolation.
import type { AnimationView, RotationKeyframeView, Vec3 } from './rustEditorTypes';

export function projectedBoneRotationPose(
  animation: AnimationView | null | undefined, time: number,
): Record<string, Vec3> | null {
  if (!animation?.previewSupported || !Number.isFinite(animation.length) ||
      animation.length < 0 || animation.length > 3600 ||
      !Number.isFinite(time) || time < 0 || time > animation.length ||
      animation.rotationKeyframes.length > 2048) return null;
  const tracks = new Map<string, RotationKeyframeView[]>();
  for (const frame of animation.rotationKeyframes) {
    if (!frame.boneUuid || !frame.uuid || !Number.isFinite(frame.time) ||
        frame.time < 0 || frame.time > animation.length ||
        frame.rotation.length !== 3 ||
        !frame.rotation.every((axis) => Number.isFinite(axis) && Math.abs(axis) <= 100_000)) {
      return null;
    }
    const track = tracks.get(frame.boneUuid) ?? [];
    track.push(frame);
    tracks.set(frame.boneUuid, track);
  }
  // A null-prototype map makes even unexpected UUID strings safe as keys.
  const pose = Object.create(null) as Record<string, Vec3>;
  for (const [boneId, frames] of tracks) {
    const sorted = [...frames].sort((a, b) => a.time - b.time);
    if (sorted.some((frame, i) => i > 0 && frame.time - sorted[i - 1].time <= 1e-6)) {
      return null;
    }
    const next = sorted.findIndex((frame) => frame.time >= time);
    if (next === 0) {
      pose[boneId] = [...sorted[0].rotation] as Vec3;
    } else if (next === -1) {
      pose[boneId] = [...sorted[sorted.length - 1].rotation] as Vec3;
    } else {
      const from = sorted[next - 1], to = sorted[next];
      const alpha = (time - from.time) / (to.time - from.time);
      const result = from.rotation.map((v, axis) =>
        v + (to.rotation[axis] - v) * alpha) as Vec3;
      if (!result.every(Number.isFinite)) return null;
      pose[boneId] = result;
    }
  }
  return pose;
}

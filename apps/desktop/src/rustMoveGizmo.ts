// Convert a Three.js object's local-space drag to a requested Rust edit.
// The geometry model, revision and validation remain exclusively Rust-owned.
// The pivot is a child of its Bone: world-space displacement is NOT the
// authored model delta when an ancestor Bone is rotated.
import type { EditOperation, Vec3 } from './rustEditorTypes';

export function planCubeLocalTranslation(
  uuid: string, start: readonly number[], end: readonly number[],
): Extract<EditOperation, { op: 'translate_cube' }> | null {
  if (!uuid || start.length !== 3 || end.length !== 3 ||
      !start.every(Number.isFinite) || !end.every(Number.isFinite)) return null;
  const delta: Vec3 = [
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ];
  // Reject huge or invalid gestures locally; Rust rechecks actual limits.
  if (!delta.every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000)) return null;
  if (delta.every((value) => Math.abs(value) <= 1e-6)) return null;
  return { op: 'translate_cube', uuid, delta };
}

// Convert a local Euler rotation gesture to the existing Rust rotation edit.
// Unchanged axes keep their exact authored values rather than GPU float noise.
export function planCubeLocalRotation(
  uuid: string, start: readonly number[], end: readonly number[],
): Extract<EditOperation, { op: 'set_cube_rotation' }> | null {
  if (!uuid || start.length !== 3 || end.length !== 3 ||
      !start.every(Number.isFinite) || !end.every(Number.isFinite) ||
      !end.every(v => Math.abs(v) <= 100_000)) return null;
  const rotation = end.map((v, i) => Math.abs(v - start[i]) <= 1e-5
    ? start[i] : Math.round(v * 10000) / 10000) as Vec3;
  if (!rotation.every(v => Number.isFinite(v) && Math.abs(v) <= 100_000) ||
      rotation.every((v, i) => Math.abs(v - start[i]) <= 1e-5)) return null;
  return { op: 'set_cube_rotation', uuid, rotation };
}

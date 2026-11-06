/**
 * Source-only safeguard for per-axis Euler rotations. Authored endpoints do
 * not prove native interpolation/winding; +/-180 degrees is itself ambiguous.
 * This is not a quaternion/rotation resolver and never changes a keyframe.
 */
export function eulerArcNeedsExplicitIntent(
  from: readonly number[], to: readonly number[],
): boolean {
  if (from.length !== 3 || to.length !== 3 ||
      !from.every(Number.isFinite) || !to.every(Number.isFinite)) return true;
  return from.some((value, axis) => Math.abs(to[axis] - value) >= 180);
}

// Derived, read-only Cube surface bounds. Blockbench v5.2.1's
// adjustFromAndToForInflateAndStretch() scales each half-extent around
// the saved from/to center. Rust still owns the original geometry.
import type { Vec3 } from './rustEditorTypes';

export function projectedCubeBounds(
  from: Vec3, to: Vec3, inflate: number, stretch: Vec3,
): { center: Vec3; size: Vec3 } | null {
  if (!Number.isFinite(inflate) ||
      !Array.isArray(from) || !Array.isArray(to) || !Array.isArray(stretch) ||
      from.length !== 3 || to.length !== 3 || stretch.length !== 3 ||
      ![...from, ...to, ...stretch].every(Number.isFinite)) return null;
  const center = from.map((v, i) => (v + to[i]) / 2) as Vec3;
  const size = from.map((v, i) => (to[i] - v + 2 * inflate) * stretch[i]) as Vec3;
  // Unsupported mirrored/degenerate surfaces are withheld instead of
  // changing face winding or pretending to render a different shape.
  if (!size.every(v => Number.isFinite(v) && v > 0) ||
      !center.every(Number.isFinite)) return null;
  return { center, size };
}

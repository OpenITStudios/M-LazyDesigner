// Transient pointer path only. Rust owns the committed pixel bitmap.
export type PaintPoint = [number, number];
export const MAX_STROKE_POINTS = 4096;

// Join sampled cursor positions so a fast drag does not leave holes.
export function extendPaintStroke(points: readonly PaintPoint[], next: PaintPoint,
  width: number, height: number): PaintPoint[] | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > 256 || height > 256 ||
      next.length !== 2 || !next.every(Number.isInteger) ||
      next[0] < 0 || next[1] < 0 || next[0] >= width || next[1] >= height ||
      points.length > MAX_STROKE_POINTS) return null;
  if (!points.length) return [next];
  const result = points.slice();
  const [x0, y0] = result[result.length - 1];
  if (x0 === next[0] && y0 === next[1]) return result;
  let x = x0, y = y0;
  const dx = Math.abs(next[0] - x0), dy = Math.abs(next[1] - y0);
  const sx = x0 < next[0] ? 1 : -1, sy = y0 < next[1] ? 1 : -1;
  let err = dx - dy;
  while (x !== next[0] || y !== next[1]) {
    const twice = 2 * err;
    if (twice > -dy) { err -= dy; x += sx; }
    if (twice < dx) { err += dx; y += sy; }
    if (result.length >= MAX_STROKE_POINTS) return null;
    result.push([x, y]);
  }
  return result;
}

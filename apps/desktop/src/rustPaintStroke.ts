// Transient pointer path only. Rust owns the committed pixel bitmap.
import {MAX_PAINT_ATLAS_SIDE} from './rustEditorTypes';
export type PaintPoint = [number, number];
export const MAX_STROKE_POINTS = 4096;

/** Mutable core for viewport gesture sampling. Adds no source/image bytes.
 * Pre-check the complete Bresenham segment so overflow never partially
 * extends a captured pointer path. O(new_pixels), not O(path_so_far).
 */
export function appendPaintStrokeInPlace(points: PaintPoint[], next: PaintPoint,
  width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > MAX_PAINT_ATLAS_SIDE || height > MAX_PAINT_ATLAS_SIDE ||
      next.length !== 2 || !next.every(Number.isInteger) ||
      next[0] < 0 || next[1] < 0 || next[0] >= width || next[1] >= height ||
      points.length > MAX_STROKE_POINTS) return false;
  if(!points.length){
    points.push([next[0],next[1]]);
    return true;
  }
  const [x0,y0]=points[points.length-1];
  if(x0===next[0]&&y0===next[1])return true;
  const dx=Math.abs(next[0]-x0),dy=Math.abs(next[1]-y0);
  if(points.length+Math.max(dx,dy)>MAX_STROKE_POINTS)return false;
  const sx=x0<next[0]?1:-1,sy=y0<next[1]?1:-1;
  let x=x0,y=y0,err=dx-dy;
  while(x!==next[0]||y!==next[1]){
    const twice=2*err;
    if(twice>-dy){err-=dy;x+=sx;}
    if(twice<dx){err+=dx;y+=sy;}
    points.push([x,y]);
  }
  return true;
}

// Existing 2D API retains non-mutating semantics and identical bounds.
export function extendPaintStroke(points: readonly PaintPoint[],next: PaintPoint,
  width: number,height: number): PaintPoint[] | null {
  const copy=points.map(p=>[p[0],p[1]] as PaintPoint);
  return appendPaintStrokeInPlace(copy,next,width,height)?copy:null;
}

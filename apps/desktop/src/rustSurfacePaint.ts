/** Read-only 3D ray-hit -> native Cube face-local texel conversion.
 * The saved UV, atlas pixels, approvals, and Paint/Undo remain Rust-owned.
 * 3D is a view and gesture surface, NEVER an atlas write authority.
 */
import type {CubeFace} from './rustEditorTypes';
import {supportedFaceUvRotation} from './rustTextureProjection';
export type SurfaceFace='east'|'west'|'up'|'down'|'south'|'north';
export const SURFACE_FACE_ORDER:readonly SurfaceFace[]=
  ['east','west','up','down','south','north'];
export type SurfaceHit={
  cubeUuid:string;face:SurfaceFace;textureIndex:number;
  texel:[number,number];size:[number,number];
  sourceUv:[number,number,number,number];sourceRotation:number;
};
export type SurfaceGesture=SurfaceHit&{
  epoch:number;revision:number;textureUuid:string;
  points:Array<[number,number]>;
  contextKey:string;
};
export type ProtectionRect={from:[number,number];to:[number,number]};
/** Exact affine inverse of the four Blockbench/Three UV vertex corners.
 * Box-UV inset, signed mirror and quarter-turns are already in corners.
 * Refuse unknown/non-integral face extents and ambiguous exact edge hits.
 */
export function hitFaceLocalTexel(
  face:CubeFace|undefined,renderedCorners:readonly number[],
  hitUv:readonly [number,number],
):{texel:[number,number];size:[number,number]}|null{
  if(!face || renderedCorners.length!==8 ||
     !renderedCorners.every(Number.isFinite) ||
     !Array.isArray(face.uv)||face.uv.length!==4||
     !face.uv.every(Number.isFinite) ||
     !hitUv.every(Number.isFinite))return null;
  const rotation=supportedFaceUvRotation(face);
  if(rotation===null)return null;
  const [u0,v0,u1,v1]=face.uv;
  const natural=[Math.abs(u1-u0),Math.abs(v1-v0)];
  if(!natural.every(x=>Number.isInteger(x)&&x>0&&x<=256))return null;
  const size:[number,number]=rotation===90||rotation===270?
    [natural[1],natural[0]]:[natural[0],natural[1]];
  const [u0,v0,u1,v1,u2,v2]=renderedCorners;
  const dx=u1-u0,dy=v1-v0,ex=u2-u0,ey=v2-v0;
  const det=dx*ey-dy*ex;
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
  const rx=hitUv[0]-u0,ry=hitUv[1]-v0;
  const s=(rx*ey-ry*ex)/det;
  const t=(dx*ry-dy*rx)/det;
  // Edge vertices may resolve to adjacent face texels; never guess ownership.
  if(!Number.isFinite(s)||!Number.isFinite(t)||
     s<0||s>=1||t<0||t>=1)return null;
  return {texel:[Math.floor(s*size[0]),Math.floor(t*size[1])],size};
}
export function sameSurface(a:SurfaceHit,b:SurfaceHit):boolean{
  return a.cubeUuid===b.cubeUuid&&a.face===b.face&&
    a.textureIndex===b.textureIndex&&
    a.sourceRotation===b.sourceRotation&&
    a.sourceUv.every((n,i)=>n===b.sourceUv[i])&&
    a.size[0]===b.size[0]&&a.size[1]===b.size[1];
}
/** Reviewer-only rectangle on the PHYSICAL atlas (half-open). */
export function protectedAtlasRectangle(
  a:readonly [number,number],b:readonly [number,number],
  dimensions:readonly [number,number],
):ProtectionRect|null{
  if(!dimensions.every(n=>Number.isInteger(n)&&n>0&&n<=256)||
     ![...a,...b].every(Number.isInteger))return null;
  if([a,b].some(point=>point[0]<0||point[1]<0||
      point[0]>=dimensions[0]||point[1]>=dimensions[1]))return null;
  return {from:[Math.min(a[0],b[0]),Math.min(a[1],b[1])],
    to:[Math.max(a[0],b[0])+1,Math.max(a[1],b[1])+1]};
}

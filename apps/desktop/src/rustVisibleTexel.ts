/** Read-only alpha visibility gate for the existing nearest-filter Three.js
 * texture preview. Alpha bytes are presentation evidence, never authoritative
 * source Paint pixels, document state or semantic selection permission.
 */
export const PREVIEW_ALPHA_THRESHOLD = 0.01;
/** Three.js UV origin is bottom-left; PNG raster rows are top-to-bottom.
 * Refuse exact boundary/invalid UV samples rather than guessing a texel.
 */
export function atlasAlphaIndex(
  uv:readonly [number,number],width:number,height:number,
):number|null{
  if(!Number.isInteger(width)||!Number.isInteger(height)||
     width<1||height<1||width>256||height>256||
     uv.length!==2||!uv.every(Number.isFinite)||
     uv[0]<=0||uv[0]>=1||uv[1]<=0||uv[1]>=1)return null;
  const x=Math.floor(uv[0]*width);
  const y=Math.floor((1-uv[1])*height);
  if(x<0||y<0||x>=width||y>=height)return null;
  return y*width+x;
}
/** Fail closed when alpha preview is not available. */
export function isVisibleAlphaTexel(
  alpha:Uint8Array,uv:readonly [number,number],
  width:number,height:number,threshold=PREVIEW_ALPHA_THRESHOLD,
):boolean{
  const index=atlasAlphaIndex(uv,width,height);
  return index!==null&&alpha.length===width*height&&
    alpha[index]/255>=threshold;
}
/** Extract alpha once from decoded preview image; never keep/mutate RGB. */
export function alphaFromImageData(
  rgba:Uint8ClampedArray,width:number,height:number,
):Uint8Array|null{
  if(!Number.isInteger(width)||!Number.isInteger(height)||
     width<1||height<1||width>256||height>256||
     rgba.length!==width*height*4)return null;
  const alpha=new Uint8Array(width*height);
  for(let i=0;i<alpha.length;i++)alpha[i]=rgba[4*i+3];
  return alpha;
}

import type { Rgba } from "@/lib/texture/proceduralOps";
import type { ScalarMask } from "@/lib/texture/masks";

export type MaskedColorOptions = {
  /** Preserve cutout/opacity/emissive channel during RGB-only styling. */
  preserveAlpha?: boolean;
  /** Leave unpainted atlas pixels completely unchanged. */
  skipTransparent?: boolean;
};

function clampByte(value:number){return Math.max(0,Math.min(255,Math.round(value)));}

function requireMaskDimensions(mask:ScalarMask,width:number,height:number):void{
  if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0){
    throw new Error("Masked operation dimensions must be positive integers.");
  }
  if(mask.width!==width||mask.height!==height||mask.values.length!==width*height){
    throw new Error("Mask dimensions do not match texture.");
  }
}

function requireFiniteColor(color:Rgba):void{
  if(color.length!==4 || !color.every(Number.isFinite)){
    throw new Error("Masked color channels must all be finite RGBA values.");
  }
}

export function applyMaskedColor(
  rgba:Uint8Array,
  width:number,
  height:number,
  mask:ScalarMask,
  color:Rgba,
  strength:number,
  options: MaskedColorOptions = {}
):Uint8Array{
  requireMaskDimensions(mask,width,height);
  if(rgba.length!==width*height*4) throw new Error("RGBA buffer length does not match masked operation dimensions.");
  if(!Number.isFinite(strength)||strength<0||strength>1) throw new Error("Masked color strength must be within 0..1.");
  requireFiniteColor(color);
  const out=new Uint8Array(rgba);
  for(let i=0;i<width*height;i+=1){
    // A NaN mask used to reach Uint8Array coercion as a black/transparent
    // pixel. Reject invalid source evidence rather than silently painting it.
    const weight=mask.values[i];
    if(!Number.isFinite(weight)){
      throw new Error(`Masked color requires finite mask weights (pixel ${i}).`);
    }
    const p=i*4;
    // Surface wear/cavity dirt is RGB styling, never a new cutout or
    // emissive mask. Explicit opt-in preserves old general RGBA behavior.
    if(options.skipTransparent && rgba[p+3]===0) continue;
    const t=Math.max(0,Math.min(1,weight*strength));
    for(let c=0;c<(options.preserveAlpha?3:4);c+=1){
      out[p+c]=clampByte(out[p+c]+(color[c]-out[p+c])*t);
    }
  }
  return out;
}

export function applyDirectionalWear(
  rgba:Uint8Array,
  width:number,
  height:number,
  mask:ScalarMask,
  wear:Rgba,
  axis:"x"|"y",
  strength:number,
  options: MaskedColorOptions = {}
):Uint8Array{
  requireMaskDimensions(mask,width,height);
  if(rgba.length!==width*height*4) throw new Error("RGBA buffer length does not match wear dimensions.");
  const directional=new Float32Array(width*height);
  for(let y=0;y<height;y+=1) for(let x=0;x<width;x+=1){
    const index=y*width+x;
    const weight=mask.values[index];
    if(!Number.isFinite(weight)){
      throw new Error(`Directional wear requires finite mask weights (pixel ${index}).`);
    }
    const t=axis==="x"?x/Math.max(1,width-1):y/Math.max(1,height-1);
    directional[index]=weight*(0.5+0.5*t);
  }
  return applyMaskedColor(rgba,width,height,{width,height,values:directional},wear,strength,options);
}

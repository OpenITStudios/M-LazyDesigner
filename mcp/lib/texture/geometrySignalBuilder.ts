import { edgeMask, type ScalarMask } from "@/lib/texture/masks";

export type TextureRect={x:number;y:number;width:number;height:number};
export type WeightedTextureRect=TextureRect&{weight:number};

export type GeometrySignalEvidence={
  width:number;
  height:number;
  edge_falloff?:number;
  cavity_regions?:readonly TextureRect[];
  contact_regions?:readonly TextureRect[];
  upward_regions?:readonly WeightedTextureRect[];
  world_normal?:readonly [number,number,number];
  lower_grime_power?:number;
};

function validateDimensions(width:number,height:number):void{
  if(!Number.isInteger(width)||width<=0||!Number.isInteger(height)||height<=0) throw new Error("Geometry signal dimensions must be positive integers.");
}
function rectMask(width:number,height:number,regions:readonly TextureRect[]):ScalarMask{
  const values=new Float32Array(width*height);
  for(const rect of regions){
    if(![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0) throw new Error("Geometry signal region must contain finite positive bounds.");
    const minX=Math.max(0,Math.floor(rect.x)),minY=Math.max(0,Math.floor(rect.y));
    const maxX=Math.min(width,Math.ceil(rect.x+rect.width)),maxY=Math.min(height,Math.ceil(rect.y+rect.height));
    for(let y=minY;y<maxY;y+=1) for(let x=minX;x<maxX;x+=1) values[y*width+x]=1;
  }
  return {width,height,values};
}
function weightedRectMask(width:number,height:number,regions:readonly WeightedTextureRect[]):ScalarMask{
  const values=new Float32Array(width*height);
  for(const rect of regions){
    if(!Number.isFinite(rect.weight)||rect.weight<0||rect.weight>1) {
      throw new Error("Geometry signal weighted region weight must be within 0..1.");
    }
    if(![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||
       rect.width<=0||rect.height<=0) {
      throw new Error("Geometry signal region must contain finite positive bounds.");
    }
    // Preserve rectMask's floor/ceil coverage but touch only this UV footprint.
    // The old path allocated and scanned a full-atlas mask for every face.
    const minX=Math.max(0,Math.floor(rect.x)),minY=Math.max(0,Math.floor(rect.y));
    const maxX=Math.min(width,Math.ceil(rect.x+rect.width));
    const maxY=Math.min(height,Math.ceil(rect.y+rect.height));
    for(let y=minY;y<maxY;y+=1) for(let x=minX;x<maxX;x+=1){
      const index=y*width+x;
      values[index]=Math.max(values[index],rect.weight);
    }
  }
  return {width,height,values};
}
function uniformMask(width:number,height:number,value:number):ScalarMask{
  const values=new Float32Array(width*height);values.fill(Math.max(0,Math.min(1,value)));return {width,height,values};
}
function lowerMask(width:number,height:number,power:number):ScalarMask{
  if(!Number.isFinite(power)||power<=0) throw new Error("Lower grime power must be finite and positive.");
  const values=new Float32Array(width*height);
  for(let y=0;y<height;y+=1){const t=height===1?1:y/(height-1);const value=Math.pow(t,power);for(let x=0;x<width;x+=1) values[y*width+x]=value;}
  return {width,height,values};
}

export function deriveGeometrySurfaceSignals(evidence:GeometrySignalEvidence){
  validateDimensions(evidence.width,evidence.height);
  const result:{edge?:ScalarMask;cavity?:ScalarMask;contact?:ScalarMask;upward_exposure?:ScalarMask;lower_exposure?:ScalarMask}={};
  if(evidence.edge_falloff!==undefined) result.edge=edgeMask(evidence.width,evidence.height,evidence.edge_falloff);
  if(evidence.cavity_regions?.length) result.cavity=rectMask(evidence.width,evidence.height,evidence.cavity_regions);
  if(evidence.contact_regions?.length) result.contact=rectMask(evidence.width,evidence.height,evidence.contact_regions);
  if(evidence.upward_regions?.length) result.upward_exposure=weightedRectMask(evidence.width,evidence.height,evidence.upward_regions);
  else if(evidence.world_normal){
    const [x,y,z]=evidence.world_normal;
    if(![x,y,z].every(Number.isFinite)) throw new Error("Geometry signal world normal must be finite.");
    const length=Math.hypot(x,y,z);
    if(length<=1e-9) throw new Error("Geometry signal world normal must be non-zero.");
    result.upward_exposure=uniformMask(evidence.width,evidence.height,Math.max(0,y/length));
  }
  if(evidence.lower_grime_power!==undefined) result.lower_exposure=lowerMask(evidence.width,evidence.height,evidence.lower_grime_power);
  return result;
}

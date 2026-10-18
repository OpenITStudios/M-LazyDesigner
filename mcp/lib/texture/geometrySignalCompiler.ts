import type { CompiledAuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { GeometrySignalEvidence, TextureRect, WeightedTextureRect } from "@/lib/texture/geometrySignalBuilder";

export type GeometrySignalFaceBinding={
  instance_id:string;
  atlas_rect:TextureRect;
  world_normal:[number,number,number];
  contact?:boolean;
  cavity?:boolean;
};
export type GeometrySignalCompileInput={
  compiled:CompiledAuthoringRecipe;
  width:number;
  height:number;
  faces:readonly GeometrySignalFaceBinding[];
  edge_falloff?:number;
  lower_grime_power?:number;
};

type FaceAtlasFootprint={
  instance_id:string;
  rect:TextureRect;
  left:number;top:number;right:number;bottom:number;
  upward:number;
  contact:boolean;cavity:boolean;
};

/**
 * One authored texel cannot represent two different geometry-driven color
 * signals. Exact compatible UV reuse is intentional and remains valid;
 * partial overlaps and incompatible reuse must be resolved by the UV owner.
 * Match the floor/ceil coverage of geometrySignalBuilder, not floating-point
 * rectangle overlap that could miss a shared rasterized texel.
 */
function requireCompatibleFaceCoverage(faces:readonly FaceAtlasFootprint[]):void{
  // Exact UV reuse is common for repeated geometry. Validate each shared
  // footprint once instead of comparing every repeated face pair.
  const unique=new Map<string,FaceAtlasFootprint>();
  for(const face of faces){
    const key=[face.left,face.top,face.right,face.bottom].join(":");
    const previous=unique.get(key);
    if(previous){
      const a=previous.rect,b=face.rect;
      if(a.x!==b.x||a.y!==b.y||a.width!==b.width||a.height!==b.height){
        throw new Error(
          "Geometry signal aliased raster texels with different UV mapping between "+
          previous.instance_id+" and "+face.instance_id+
          "; resolve the mapping before applying geometry-driven shading."
        );
      }
      if(previous.cavity!==face.cavity||previous.contact!==face.contact||
          Math.abs(previous.upward-face.upward)>1e-6){
        throw new Error(
          "Geometry signal conflicting shared UV treatment between "+previous.instance_id+
          " and "+face.instance_id+"; shared texels require compatible exposure/contact/cavity."
        );
      }
    }else{
      unique.set(key,face);
    }
  }

  // Compare distinct physical texel footprints only. Touching at an exclusive
  // integer boundary is fine; partial coverage is not safe for independent
  // geometry-driven shading until its UV ownership is resolved.
  const ordered=[...unique.values()].sort((a,b)=>a.left-b.left||a.top-b.top);
  for(let i=0;i<ordered.length;i+=1){
    const a=ordered[i];
    for(let j=i+1;j<ordered.length&&ordered[j].left<a.right;j+=1){
      const b=ordered[j];
      if(a.bottom<=b.top||b.bottom<=a.top)continue;
      throw new Error(
        "Geometry signal partial UV overlap between "+a.instance_id+" and "+
        b.instance_id+"; resolve UV ownership before applying shared-texel shading."
      );
    }
  }
}

export function compileGeometrySignalEvidence(input:GeometrySignalCompileInput):GeometrySignalEvidence{
  if(!Number.isInteger(input.width)||input.width<=0||!Number.isInteger(input.height)||input.height<=0) throw new Error("Geometry signal compiler dimensions must be positive integers.");
  const owned=new Set(input.compiled.placements.map((placement)=>placement.id));
  const cavity_regions:TextureRect[]=[];
  const contact_regions:TextureRect[]=[];
  const upward_regions:WeightedTextureRect[]=[];
  const coverage:FaceAtlasFootprint[]=[];
  for(const face of input.faces){
    if(!owned.has(face.instance_id)) throw new Error("Geometry signal face binding references unowned instance "+face.instance_id+".");
    const r=face.atlas_rect;
    if(![r.x,r.y,r.width,r.height,...face.world_normal].every(Number.isFinite)||r.width<=0||r.height<=0) throw new Error("Geometry signal face binding contains invalid rect or world normal.");
    if(r.x<0||r.y<0||r.x+r.width>input.width||r.y+r.height>input.height) throw new Error("Geometry signal face binding lies outside atlas bounds.");
    const nlen=Math.hypot(...face.world_normal);
    if(!Number.isFinite(nlen)||nlen<=1e-9) throw new Error("Geometry signal face binding world normal must be finite and non-zero.");
    const upward=Math.max(0,Math.min(1,face.world_normal[1]/nlen));
    coverage.push({
      instance_id:face.instance_id,rect:r,
      left:Math.max(0,Math.floor(r.x)),top:Math.max(0,Math.floor(r.y)),
      right:Math.min(input.width,Math.ceil(r.x+r.width)),
      bottom:Math.min(input.height,Math.ceil(r.y+r.height)),
      upward,contact:face.contact===true,cavity:face.cavity===true,
    });
    if(upward>0) upward_regions.push({...r,weight:upward});
    if(face.cavity) cavity_regions.push({...r});
    if(face.contact) contact_regions.push({...r});
  }
  requireCompatibleFaceCoverage(coverage);
  return {
    width:input.width,
    height:input.height,
    ...(input.edge_falloff!==undefined?{edge_falloff:input.edge_falloff}:{}),
    ...(cavity_regions.length?{cavity_regions}:{}),
    ...(contact_regions.length?{contact_regions}:{}),
    ...(upward_regions.length?{upward_regions}:{}),
    ...(input.lower_grime_power!==undefined?{lower_grime_power:input.lower_grime_power}:{}),
  };
}

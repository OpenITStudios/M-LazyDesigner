/** Canonical source-side entry for opt-in face-local cluster composition.
 * The return value is a proposed existing paint transaction, not an
 * auto-registered Gateway tool or permission to mutate native texture.
 */
export {
  compileReferencePixelClusterPaint,
} from "./clusterComposition";
export {
  nativeClusterAuthoringRequestSchema,
  materializeNativeClusterCompositionInput,
} from "./clusterAuthoringRequest";
export type {
  NativeClusterAuthoringRequest,
  ResolvedNativeClusterSource,
} from "./clusterAuthoringRequest";
export type {
  ClusterCompositionInput,
  ClusterNativeFace,
  ClusterFaceAuthoring,
  ReferencePixelCluster,
  ClusterPalette,
} from "./clusterComposition";

import type { MaterialRecipe } from "@/lib/texture/materialRecipe";
import { renderMaterialRecipe } from "@/lib/texture/materialRecipe";
import { edgeMask } from "@/lib/texture/masks";
import { applyDirectionalWear, applyMaskedColor } from "@/lib/texture/maskedOps";

// Surface wear is color styling, not a hidden render-alpha or UV-island edit.
// Alpha-changing patterns remain a separate, explicitly authored operation.
const SURFACE_COLOR_ONLY = { preserveAlpha: true, skipTransparent: true } as const;
import type { Rgba } from "@/lib/texture/proceduralOps";
import type { SurfacePattern } from "@/lib/texture/surfacePatterns";
import { renderSurfacePattern } from "@/lib/texture/surfacePatterns";

export type TextureSourceRecipe={
  material:MaterialRecipe;
  pattern?:SurfacePattern;
  pattern_opacity?:number;
  edge_treatment?:{color:Rgba;strength:number;falloff:number};
  directional_wear?:{color:Rgba;strength:number;falloff:number;axis:"x"|"y"};
};

function mixByte(a:number,b:number,t:number){return Math.max(0,Math.min(255,Math.round(a+(b-a)*t)));}

export function renderTextureSourceRecipe(recipe:TextureSourceRecipe):Uint8Array{
  let out=renderMaterialRecipe(recipe.material);
  if(recipe.pattern){
    const opacity=recipe.pattern_opacity ?? 1;
    if(!Number.isFinite(opacity)||opacity<0||opacity>1) throw new Error("Pattern opacity must be within 0..1.");
    const pattern=renderSurfacePattern(recipe.material.width,recipe.material.height,recipe.pattern);
    const mixed=new Uint8Array(out.length);
    for(let i=0;i<out.length;i+=4){
      for(let c=0;c<4;c+=1) mixed[i+c]=mixByte(out[i+c],pattern[i+c],opacity);
    }
    out=mixed;
  }
  if(recipe.edge_treatment){
    const mask=edgeMask(recipe.material.width,recipe.material.height,recipe.edge_treatment.falloff);
    out=applyMaskedColor(out,recipe.material.width,recipe.material.height,mask,recipe.edge_treatment.color,recipe.edge_treatment.strength,SURFACE_COLOR_ONLY);
  }
  if(recipe.directional_wear){
    const mask=edgeMask(recipe.material.width,recipe.material.height,recipe.directional_wear.falloff);
    out=applyDirectionalWear(
      out,recipe.material.width,recipe.material.height,mask,
      recipe.directional_wear.color,recipe.directional_wear.axis,recipe.directional_wear.strength,SURFACE_COLOR_ONLY
    );
  }
  return out;
}

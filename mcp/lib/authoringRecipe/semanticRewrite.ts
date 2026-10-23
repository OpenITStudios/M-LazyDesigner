import type { AuthoringRecipe, RecipeVec3 } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  compileSemanticGeometryEdit,
  type SemanticGeometryEditIntent,
} from "@/lib/authoringRecipe/semanticEdit";

const AXIS_INDEX={X:0,Y:1,Z:2} as const;

function nextScalar(current:number,mode:"SET"|"ADD"|"MULTIPLY",value:number,label:string){
  if(!Number.isFinite(value)) throw new Error(label+" value must be finite.");
  const next=mode==="SET"?value:mode==="ADD"?current+value:current*value;
  if(!Number.isFinite(next)) throw new Error(label+" result must be finite.");
  return next;
}

function addVec3(a:readonly number[],b:readonly number[]):RecipeVec3{
  const result:RecipeVec3=[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  if (result.some((v)=>!Number.isFinite(v))) {
    throw new Error("SEMANTIC_REWRITE_COORDINATE_NONFINITE: pattern translation overflowed.");
  }
  return result;
}

/** Ensures dependent constraints/symmetry compile safely before exposing a rewrite. */
function validatedRewrite(recipe:AuthoringRecipe):AuthoringRecipe{
  // Direct selected placements were already checked by semanticEdit.
  // Recompile only when a dependency can move an unselected Cube.
  if (recipe.constraints?.length || recipe.symmetry?.length) {
    compileAuthoringRecipe(recipe);
  }
  return recipe;
}

export function rewriteAuthoringRecipeForSemanticEdit(
  recipe:AuthoringRecipe,
  intent:SemanticGeometryEditIntent
):AuthoringRecipe{
  const compiled=compileAuthoringRecipe(recipe);
  const plan=compileSemanticGeometryEdit(compiled,intent);
  const affected=new Set(plan.affected_instance_ids);
  const affectedPlacements=compiled.placements.filter((placement)=>affected.has(placement.id));
  const next:AuthoringRecipe=structuredClone(recipe);

  if(intent.operation.kind==="TRANSLATE"){
    const patternIds=new Set(affectedPlacements.map((placement)=>placement.source_pattern_id));
    if([...patternIds].some((id)=>id.startsWith("symmetry:"))){
      throw new Error("SEMANTIC_REWRITE_UNSUPPORTED: translated symmetry-generated instances must be edited through their source relationship.");
    }
    for(const patternId of patternIds){
      const all=compiled.placements.filter((placement)=>placement.source_pattern_id===patternId);
      if(all.some((placement)=>!affected.has(placement.id))){
        throw new Error("SEMANTIC_REWRITE_UNSUPPORTED: translation requires whole-pattern ownership.");
      }
      const pattern=next.patterns.find((entry)=>entry.id===patternId);
      if(!pattern) throw new Error("SEMANTIC_REWRITE_PRECONDITION_FAILED: source pattern "+patternId+" is missing.");
      if(pattern.kind==="RADIAL") pattern.center=addVec3(pattern.center ?? [0,0,0],intent.operation.delta);
      else pattern.start=addVec3(pattern.start ?? [0,0,0],intent.operation.delta);
    }
    return validatedRewrite(next);
  }

  const prototypeIds=new Set(affectedPlacements.map((placement)=>placement.prototype_id));
  for(const prototypeId of prototypeIds){
    const all=compiled.placements.filter((placement)=>placement.prototype_id===prototypeId);
    if(all.some((placement)=>!affected.has(placement.id))){
      throw new Error("SEMANTIC_REWRITE_UNSUPPORTED: prototype edit requires all instances of that prototype.");
    }
    const prototype=next.prototypes.find((entry)=>entry.id===prototypeId);
    if(!prototype) throw new Error("SEMANTIC_REWRITE_PRECONDITION_FAILED: prototype "+prototypeId+" is missing.");

    if(intent.operation.kind==="RESIZE_AXIS"){
      if((intent.operation.anchor ?? "CENTER")!=="MIN"){
        throw new Error("SEMANTIC_REWRITE_UNSUPPORTED: recipe v1 can preserve resize ownership only for MIN anchor without per-instance offsets.");
      }
      const axis=AXIS_INDEX[intent.operation.axis];
      const size=[...prototype.size] as RecipeVec3;
      size[axis]=nextScalar(size[axis],intent.operation.mode,intent.operation.value,"Semantic resize");
      if(size[axis]<=0) throw new Error("Semantic resize must preserve positive prototype size.");
      prototype.size=size;
    }else if(intent.operation.kind==="ROTATE_AXIS"){
      if(!Number.isFinite(intent.operation.delta_degrees)) throw new Error("Semantic rotation delta must be finite.");
      const rotation=[...(prototype.rotation ?? [0,0,0])] as RecipeVec3;
      rotation[AXIS_INDEX[intent.operation.axis]]+=intent.operation.delta_degrees;
      if (!Number.isFinite(rotation[AXIS_INDEX[intent.operation.axis]])) {
        throw new Error("SEMANTIC_REWRITE_ROTATION_NONFINITE: prototype rotation overflowed.");
      }
      prototype.rotation=rotation;
    }else{
      prototype.inflate=nextScalar(prototype.inflate ?? 0,intent.operation.mode,intent.operation.value,"Semantic inflate");
    }
  }
  return validatedRewrite(next);
}

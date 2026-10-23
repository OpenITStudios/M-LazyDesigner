import type { AuthoringRecipe, CompiledCubePlacement, RecipeVec3 } from "@/lib/authoringRecipe/contracts";
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

/**
 * A valid compiled Recipe is not sufficient evidence that a requested edit
 * happened: constraints can overwrite a pattern translation. Compare the
 * selected Cubes with their semantic plan whenever relations are involved.
 * Independent resize also needs parity because it changes pattern anchors.
 */
function validatedRewrite(
  recipe: AuthoringRecipe,
  expectedPlacements?: readonly CompiledCubePlacement[]
): AuthoringRecipe {
  if (recipe.constraints?.length || recipe.symmetry?.length || expectedPlacements) {
    const compiled = compileAuthoringRecipe(recipe);
    if (expectedPlacements) {
      const byId = new Map(compiled.placements.map((item) => [item.id, item]));
      const same = (left: number, right: number) =>
        Number.isFinite(left) && Number.isFinite(right) &&
        Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
      for (const expected of expectedPlacements) {
        const actual = byId.get(expected.id);
        if (!actual) {
          throw new Error("SEMANTIC_REWRITE_RESULT_MISMATCH: missing " + expected.id);
        }
        for (const field of ["from", "to", "origin", "rotation"] as const) {
          if (actual[field].some((value, index) => !same(value, expected[field][index]))) {
            throw new Error("SEMANTIC_REWRITE_RESULT_MISMATCH: " +
              expected.id + " has unexpected " + field + " after rewrite.");
          }
        }
        if (!same(actual.inflate, expected.inflate)) {
          throw new Error("SEMANTIC_REWRITE_RESULT_MISMATCH: " +
            expected.id + " has unexpected inflate after rewrite.");
        }
      }
    }
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
  const hasRelations=Boolean(recipe.constraints?.length || recipe.symmetry?.length);

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
    return validatedRewrite(next, hasRelations ? plan.upserts : undefined);
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
      const axis=AXIS_INDEX[intent.operation.axis];
      const size=[...prototype.size] as RecipeVec3;
      const oldSize=size[axis];
      const newSize=nextScalar(oldSize,intent.operation.mode,intent.operation.value,"Semantic resize");
      if(newSize<=0) throw new Error("Semantic resize must preserve positive prototype size.");
      const anchor=intent.operation.anchor ?? "CENTER";
      const shift=anchor==="MIN" ? 0 :
        anchor==="CENTER" ? (oldSize-newSize)/2 : oldSize-newSize;
      if(!Number.isFinite(shift)) {
        throw new Error("SEMANTIC_REWRITE_COORDINATE_NONFINITE: resize anchor displacement overflowed.");
      }
      // Pattern translation owns the authored Cube minimum, not its prototype.
      // Preserve CENTER/MAX anchors without changing repeat spacing or constraints.
      if(shift!==0){
        const delta:RecipeVec3=[0,0,0];
        delta[axis]=shift;
        for(const pattern of next.patterns){
          if(pattern.prototype_id!==prototypeId) continue;
          if(pattern.kind==="RADIAL") pattern.center=addVec3(pattern.center ?? [0,0,0],delta);
          else pattern.start=addVec3(pattern.start ?? [0,0,0],delta);
        }
      }
      // A resize is not a pivot edit. Freeze the previous world pivot even
      // when the original prototype used implicit center-origin defaults.
      const origin:RecipeVec3=prototype.origin
        ? [...prototype.origin] as RecipeVec3
        : [size[0]/2,size[1]/2,size[2]/2];
      origin[axis]-=shift;
      if(!Number.isFinite(origin[axis])) {
        throw new Error("SEMANTIC_REWRITE_COORDINATE_NONFINITE: resize pivot overflowed.");
      }
      size[axis]=newSize;
      prototype.size=size;
      prototype.origin=origin;
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
  return validatedRewrite(
    next,
    hasRelations || intent.operation.kind === "RESIZE_AXIS" ? plan.upserts : undefined
  );
}

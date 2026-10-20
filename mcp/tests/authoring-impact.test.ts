import { describe, expect, test } from "bun:test";
import { planAuthoringImpact } from "@/lib/orchestration/authoringImpact";
import { compileMinimalVerificationPlan } from "@/lib/orchestration/verificationPlan";
import { compileAuthoringExecutionOrder } from "@/lib/orchestration/executionOrder";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";

function recipe(width:number,count=2):AuthoringRecipe{
  return {
    schema:1,compiler_version:1,id:"asset",name:"asset",
    prototypes:[{id:"panel",name:"panel",size:[width,4,1],semantic_group:"metal"}],
    patterns:[{kind:"LINEAR",id:"p",prototype_id:"panel",count,axis:"X",spacing:6,semantic_group:"metal"}],
  };
}

describe("cross-domain authoring impact",()=>{
  test("unchanged recipes do not request checks even when downstream ownership is unknown", () => {
    const current = recipe(4);
    for (const ownership of [{}, { rig_instance_ids: [], animation_instance_ids: [] }]) {
      const impact = planAuthoringImpact(current, current, ownership);
      expect(compileMinimalVerificationPlan(impact)).toEqual([]);
      expect(impact.rig.scope).toBe("UNCHANGED");
      expect(impact.animation.scope).toBe("UNCHANGED");
    }
  });

  test("known empty downstream ownership preserves unrelated rig and animation on resize", () => {
    const impact = planAuthoringImpact(recipe(4), recipe(5), {
      rig_instance_ids: [], animation_instance_ids: [],
    });
    expect(impact.uv.stale).toBe(true);
    expect(impact.texture.reason).toBe("UV_CHANGED");
    expect(impact.rig).toEqual({ stale: false, affected_instance_ids: [], scope: "UNCHANGED" });
    expect(impact.animation).toEqual({ stale: false, affected_instance_ids: [], scope: "UNCHANGED" });
  });

  test("semantic changes require full review without targets but preserve exact known targets and material precedence", () => {
    const previous = recipe(4);
    const next = recipe(4);
    next.prototypes[0].semantic_group = "painted_metal";
    next.patterns[0].semantic_group = "painted_metal";
    for (const ids of [[], ["p:0"]]) {
      const impact = planAuthoringImpact(previous, next, {
        rig_instance_ids: ids, animation_instance_ids: ids,
      });
      expect(impact.geometry.upsert_instance_ids).toEqual([]);
      expect(impact.uv.stale).toBe(true);
      expect(impact.texture.reason).toBe("SEMANTIC_MATERIAL_CHANGED");
      expect(impact.texture.scope).toBe("SEMANTIC_REVIEW");
      expect(impact.rig.scope).toBe(ids.length ? "AFFECTED_ONLY" : "FULL_SEMANTIC_REPLAN");
      expect(impact.animation.scope).toBe(ids.length ? "AFFECTED_ONLY" : "FULL_SEMANTIC_REVIEW");
      expect(impact.rig.affected_instance_ids).toEqual(ids);
      expect(impact.animation.affected_instance_ids).toEqual(ids);
    }
  });

  test("geometry change is affected-only only when downstream ownership is known",()=>{
    const impact=planAuthoringImpact(recipe(4),recipe(5),{
      rig_instance_ids:["p:0","p:1"],
      animation_instance_ids:["p:0"],
    });
    expect(impact.geometry.upsert_instance_ids).toHaveLength(2);
    expect(impact.uv.scope).toBe("AFFECTED_ONLY");
    expect(impact.rig.scope).toBe("AFFECTED_ONLY");
    expect(impact.animation.scope).toBe("AFFECTED_ONLY");
    expect(impact.animation.affected_instance_ids).toEqual(["p:0"]);
    expect(impact.texture.reason).toBe("UV_CHANGED");
    expect(compileAuthoringExecutionOrder(impact)).toEqual([
      "GEOMETRY","UV","RIG","TEXTURE","ANIMATION","VERIFY"
    ]);
    expect(compileMinimalVerificationPlan(impact).map(task=>task.domain)).toEqual([
      "GEOMETRY","UV","RIG","ANIMATION","TEXTURE"
    ]);
  });

  test("unknown downstream ownership falls back to semantic review instead of false precision",()=>{
    const impact=planAuthoringImpact(recipe(4),recipe(5));
    expect(impact.rig.scope).toBe("FULL_SEMANTIC_REPLAN");
    expect(impact.rig.affected_instance_ids).toEqual([]);
    expect(impact.animation.scope).toBe("FULL_SEMANTIC_REVIEW");
    expect(impact.animation.affected_instance_ids).toEqual([]);
  });

  test("removal-only change invalidates downstream semantic layout without inventing deleted face IDs",()=>{
    const previous=recipe(4,2);
    const next=recipe(4,1);
    const impact=planAuthoringImpact(previous,next,{
      rig_instance_ids:["p:0","p:1"],
      animation_instance_ids:["p:0","p:1"],
    });
    expect(impact.geometry.remove_instance_ids).toHaveLength(1);
    expect(impact.uv.scope).toBe("FULL_SEMANTIC_REPLAN");
    expect(impact.uv.affected_island_ids).toEqual([]);
    expect(impact.texture.reason).toBe("UV_CHANGED");
  });
});

import { describe, expect, test } from "bun:test";
import { compileNativeUvApplyPlan } from "@/lib/uv/nativeApplyPlan";

describe("semantic UV ownership contract",()=>{
  test("carries recipe ownership into native operations",()=>{
    const plan=compileNativeUvApplyPlan(
      [{id:"leg:north",source_id:"leg:north",x:0,y:0,width:4,height:4,rotated:false,cohort:"base",locked:false}],
      [{
        island_id:"leg:north",cube_uuid:"cube",face:"north",
        current_uv:[0,0,1,1],current_rotation:0,
        expected_recipe_id:"recipe",expected_instance_id:"leg",
      }],
      { bitmap_width: 32, bitmap_height: 32, logical_width: 32, logical_height: 32 }
    );
    expect(plan.operations[0].expected_recipe_id).toBe("recipe");
    expect(plan.operations[0].expected_instance_id).toBe("leg");
  });
});

import { describe, expect, test } from "bun:test";
import { compileNativeUvApplyPlan } from "@/lib/uv/nativeApplyPlan";

describe("semantic UV identity bridge",()=>{
  test("semantic instance-face identity maps independently from native cube UUID",()=>{
    const plan=compileNativeUvApplyPlan(
      [{id:"leg_left:north",source_id:"leg_left:north",x:1,y:2,width:4,height:6,rotated:false,cohort:"cloth",locked:false}],
      [{island_id:"leg_left:north",cube_uuid:"native-cube-uuid",face:"north",current_uv:[0,0,1,1],current_rotation:0}],
      {bitmap_width:16,bitmap_height:16,logical_width:16,logical_height:16}
    );
    expect(plan.complete).toBe(true);
    expect(plan.operations[0].cube_uuid).toBe("native-cube-uuid");
  });
});

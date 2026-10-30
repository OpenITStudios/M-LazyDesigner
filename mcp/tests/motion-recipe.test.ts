import { describe, expect, test } from "bun:test";
import { compileMotionRecipe } from "@/lib/animation/motionRecipe";
import { compileMotionToCreateAnimation, compileMotionToKeyframeRequests } from "@/lib/animation/toolCompiler";

describe("motion recipe compiler",()=>{
  test("compiles semantic poses into existing animation contracts",()=>{
    const compiled=compileMotionRecipe({
      name:"fisher_cast",loop:false,
      poses:[
        {id:"ready",time:0,bones:{arm:{rotation:[0,0,0]}}},
        {id:"cast",time:0.5,bones:{arm:{rotation:[-70,0,20]}}},
        {id:"settle",time:1,bones:{arm:{rotation:[-20,0,0]}}},
      ],
    });
    const create=compileMotionToCreateAnimation(compiled);
    expect(create.bones.arm).toHaveLength(3);
    expect(create.animation_length).toBe(1);
    const requests=compileMotionToKeyframeRequests(compiled,["arm"]);
    expect(requests).toHaveLength(1);
    expect(requests[0].channel).toBe("rotation");
  });
  test("rejects nonfinite scalar scale before any native create plan", () => {
    for (const scale of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => compileMotionRecipe({
        name: "invalid_scale",
        poses: [{ id: "initial", time: 0, bones: { body: { scale } } }],
      })).toThrow("body scale must be finite.");
    }
    for (const scale of [0, 0.75, -1]) {
      const compiled = compileMotionRecipe({
        name: "finite_scale",
        poses: [{ id: "initial", time: 0, bones: { body: { scale } } }],
      });
      expect(compileMotionToCreateAnimation(compiled).bones.body[0]?.scale).toBe(scale);
    }
  });
});

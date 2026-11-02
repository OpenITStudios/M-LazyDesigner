import { describe, expect, test } from "bun:test";
import { compileMotionRecipe } from "@/lib/animation/motionRecipe";
import { applyContactConstraints } from "@/lib/animation/contactConstraints";

describe("motion contact constraints",()=>{
  test("inserts exact hold boundaries and locks existing frames inside the range",()=>{
    const recipe=compileMotionRecipe({name:"step",duration:1,poses:[
      {id:"a",time:0,bones:{foot:{position:[0,0,0]}}},
      {id:"b",time:0.5,bones:{foot:{position:[1,0,0]}}},
      {id:"c",time:1,bones:{foot:{position:[2,0,0]}}},
    ]});
    const constrained=applyContactConstraints(recipe,[{
      bone:"foot",channel:"position",start:0.2,end:0.7,value:[0,0,0]
    }]);
    expect(constrained.bones.foot.map(f=>f.time)).toEqual([0,0.2,0.5,0.7,1]);
    expect(constrained.bones.foot.slice(1,4).map(f=>f.position)).toEqual([
      [0,0,0],[0,0,0],[0,0,0]
    ]);
  });
});


describe("local-only contact hardening", () => {
  const source = () => compileMotionRecipe({
    name: "contact",
    duration: 1,
    poses: [
      { id: "a", time: 0, bones: { foot: { position: [0, 0, 0] } } },
      { id: "b", time: 0.5, bones: { foot: { position: [2, 0, 0] } } },
      { id: "c", time: 1, bones: { foot: { position: [4, 0, 0] } } },
    ],
  });
  const contact = (start: number, end: number, x = 0) => ({
    bone: "foot", channel: "position" as const, start, end,
    value: [x, 0, 0] as [number, number, number],
  });

  test("rejects conflicting overlapping holds instead of silently using the last one", () => {
    const motion = source();
    const before = JSON.stringify(motion);
    expect(() => applyContactConstraints(motion, [
      contact(0.2, 0.6, 0), contact(0.5, 0.8, 3),
    ])).toThrow("Conflicting local contact targets");
    expect(JSON.stringify(motion)).toBe(before);
  });

  test("rejects boundary timestamps that would replace nearby native position keys", () => {
    expect(() => applyContactConstraints(source(), [
      contact(0.50005, 0.8),
    ])).toThrow("within 0.0001 seconds");
  });

  test("refuses nonlinear authored position tracks instead of misreporting a hold", () => {
    const motion = compileMotionRecipe({
      name: "curved",
      duration: 1,
      poses: [
        { id: "a", time: 0, bones: { foot: { position: [0, 0, 0], interpolation: "catmullrom" } } },
        { id: "b", time: 1, bones: { foot: { position: [1, 0, 0] } } },
      ],
    });
    expect(() => applyContactConstraints(motion, [contact(0.2, 0.8)]))
      .toThrow("nonlinear/step/Bezier");
  });

  test("rejects nonfinite contact values and nonexistent position tracks", () => {
    expect(() => applyContactConstraints(source(), [
      contact(0.2, 0.7, Number.NaN),
    ])).toThrow("three finite values");
    expect(() => applyContactConstraints(source(), [{
      bone: "arm", channel: "position", start: 0.2, end: 0.7,
      value: [0, 0, 0],
    }])).toThrow("existing authored position track");
  });

  test("retains independent intervals with the same source without mutating it", () => {
    const motion = source();
    const original = JSON.stringify(motion);
    const next = applyContactConstraints(motion, [
      contact(0.1, 0.2, 1), contact(0.7, 0.8, 2),
    ]);
    expect(next.bones.foot.map((frame) => frame.time))
      .toEqual([0, 0.1, 0.2, 0.5, 0.7, 0.8, 1]);
    expect(JSON.stringify(motion)).toBe(original);
  });
});

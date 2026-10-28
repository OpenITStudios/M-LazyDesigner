import { describe, expect, test } from "bun:test";
import {
  nativeIkFrameTimes,
  planNativeIkBakedKeyframes,
} from "@/lib/animation/ikBakeKeyframePlan";
import { prepareNativeIkBakeFromExistingSamples } from "@/server/tools/animation/ikBakeNativeSamples";

const nominal = () => ({
  animation_uuid:"walk",
  duration_seconds:1,
  snapping_fps:20,
  expected_group_uuids:["upper","lower"],
});

describe("native Blockbench IK sample normalization and keyframe planning",()=>{
  test("reproduces native additive clock rather than assuming 21 samples at 20 fps",()=>{
    const clock=nativeIkFrameTimes(1,20);
    expect(clock.length).toBe(20);
    expect(clock[0]).toBe(0);
    expect(clock[clock.length-1]).toBeCloseTo(.95,10);
  });

  test("preserves a constant nonzero solved bone when eliminating an IK controller",()=>{
    const n=nativeIkFrameTimes(1,20).length;
    const plan=planNativeIkBakedKeyframes({
      ...nominal(),
      tracks:[
        {group_uuid:"upper",rotations:Array.from({length:n},()=>[0,20,0])},
        {group_uuid:"lower",rotations:Array.from({length:n},(_,i)=>[i,0,0])},
      ],
    });
    expect(plan).toMatchObject({
      state:"PREPARED_SOURCE_ONLY",native_ik_baked:false,
      expected_bone_count:2,frame_count_per_bone:20,
      preserved_nonzero_static_tracks:1,
      planned_rotation_keyframe_count:21,
    });
    expect(plan.keyframes[0]).toEqual({
      bone_uuid:"upper",channel:"rotation",time:0,
      values:[0,20,0],interpolation:"linear",
    });
    expect(plan.keyframes.at(-1)?.time).toBeCloseTo(.95,10);
  });

  test("neutral solved bones generate no fake keys when other bones move",()=>{
    const n=nativeIkFrameTimes(1,20).length;
    const plan=planNativeIkBakedKeyframes({
      ...nominal(),
      tracks:[
        {group_uuid:"upper",rotations:Array.from({length:n},()=>[0,0,0])},
        {group_uuid:"lower",rotations:Array.from({length:n},(_,i)=>i%2?[5,0,0]:[0,0,0])},
      ],
    });
    expect(plan.keyframes.every((key)=>key.bone_uuid==="lower")).toBe(true);
  });

  test("partial native frame coverage and unexpected bones are rejected before Undo",()=>{
    const n=nativeIkFrameTimes(1,20).length;
    const frames=Array.from({length:n},()=>[0,10,0]);
    const base={...nominal(),expected_group_uuids:["upper"]};
    expect(()=>planNativeIkBakedKeyframes({...base,
      tracks:[{group_uuid:"upper",rotations:frames.slice(1)}],
    })).toThrow("IK_BAKE_SAMPLING_INCOMPLETE");
    expect(()=>planNativeIkBakedKeyframes({...base,
      tracks:[{group_uuid:"other",rotations:frames}],
    })).toThrow("IK_BAKE_TRACK_INVENTORY_MISMATCH");
    expect(()=>planNativeIkBakedKeyframes({...base,
      tracks:[{group_uuid:"upper",rotations:frames.map((f,i)=>i===3?[NaN,0,0]:f)}],
    })).toThrow("IK_BAKE_SAMPLE_NONFINITE");
  });

  test("zero output, duplicate bone identities and unbounded sampling fail closed",()=>{
    const n=nativeIkFrameTimes(1,20).length;
    expect(()=>planNativeIkBakedKeyframes({
      ...nominal(),expected_group_uuids:["upper"],
      tracks:[{group_uuid:"upper",rotations:Array.from({length:n},()=>[0,0,0])}],
    })).toThrow("IK_BAKE_ZERO_ROTATION_OUTPUT");
    expect(()=>planNativeIkBakedKeyframes({
      ...nominal(),expected_group_uuids:["upper","upper"],
      tracks:[{group_uuid:"upper",rotations:[]},{group_uuid:"upper",rotations:[]}],
    })).toThrow("IK_BAKE_TRACK_INVENTORY_MISMATCH");
    expect(()=>nativeIkFrameTimes(200,144)).toThrow("IK_BAKE_SAMPLE_BUDGET_EXCEEDED");
  });

  test("existing native solver frame decoder is read-only and refuses missing samples",()=>{
    const g=globalThis as any;
    const oldGroup=g.Group;
    g.Group={all:[{uuid:"upper",rotation:[0,0,0]},{uuid:"lower",rotation:[0,0,0]}]};
    const n=nativeIkFrameTimes(1,20).length;
    const sample=(x:number)=>({array:[x,0,0]});
    const frames=Array.from({length:n},(_,i)=>sample(i));
    const input={
      ...nominal(),
      samples:{upper:frames,lower:frames},
    };
    const before=JSON.stringify(input);
    try {
      const plan=prepareNativeIkBakeFromExistingSamples(input);
      expect(plan.planned_rotation_keyframe_count).toBe(40);
      expect(JSON.stringify(input)).toBe(before);
      expect(()=>prepareNativeIkBakeFromExistingSamples({
        ...input,samples:{upper:frames},
      })).toThrow("IK_BAKE_SAMPLING_INCOMPLETE");
    } finally {g.Group=oldGroup;}
  });
});

import { describe, expect, test } from "bun:test";
import {
  nativeIkFrameTimes,
  planNativeIkBakedKeyframes,
  requireNativeIkBakeMutationPreflight,
} from "@/lib/animation/ikBakeKeyframePlan";
import { analyzeNativeIkBakeReadiness } from "@/lib/animation/ikBakeReadiness";
import { writePreparedNativeIkBakeKeyframes } from "@/server/tools/animation/ikBakeNativeTransaction";
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
    expect(()=>nativeIkFrameTimes(0.1,1)).toThrow("IK_BAKE_INSUFFICIENT_NATIVE_FRAMES");
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
      // Fail before decoding any Eulers or touching the virtual scene.
      const extra = Array.from({length: n + 1},()=>sample(1));
      expect(()=>prepareNativeIkBakeFromExistingSamples({
        ...input,samples:{upper:frames,lower:extra},
      })).toThrow("IK_BAKE_SAMPLING_INCOMPLETE");
    } finally {g.Group=oldGroup;}
  });
});

/** A fully linked, explicit Bedrock IK chain with no existing bone rotation keys. */
function mutationFixture() {
  const ready = analyzeNativeIkBakeReadiness({
    blockbench_version: "5.2.2", format_id: "bedrock",
    animate_mode: true, selected_clip_uuid: "walk", animation_uuid: "walk",
    duration_seconds: 1, snapping_fps: 20, anim_time_update: "",
    blend_weight: "", unsupported_armature_count: 0,
    groups: [
      {uuid:"root",parent_uuid:null,rotation:[0,0,0],transform_available:true,native_fix_rotation_available:true},
      {uuid:"mid",parent_uuid:"root",rotation:[0,0,0],transform_available:true,native_fix_rotation_available:true},
      {uuid:"tip",parent_uuid:"mid",rotation:[0,0,0],transform_available:true,native_fix_rotation_available:true},
    ],
    locator_uuids: [],
    controllers: [{
      uuid: "ik", target_uuid: "tip", source_uuid: "root",
      parent_group_uuid: "root", pole_uuid: null,
      lock_target_rotation: false, position_keyframes: 2, total_keyframes: 2,
    }],
  });
  const frameCount=nativeIkFrameTimes(1,20).length;
  const plan=planNativeIkBakedKeyframes({
    animation_uuid:"walk",duration_seconds:1,snapping_fps:20,
    expected_group_uuids:["mid","root"],
    tracks:[
      {group_uuid:"mid",rotations:Array.from({length:frameCount},()=>[0,12,0])},
      {group_uuid:"root",rotations:Array.from({length:frameCount},(_,i)=>[i,0,0])},
    ],
  });
  const inventory = {
    animation_uuid:"walk",selected_animation_uuid:"walk",
    animation_length:1,snapping_fps:20,
    rotation_tracks:[
      {bone_uuid:"mid",existing_keyframe_count:0},
      {bone_uuid:"root",existing_keyframe_count:0},
    ],
    controller_tracks:[{controller_uuid:"ik",existing_keyframe_count:2}],
  };
  return {ready,plan,inventory};
}

describe("internal native IK write transaction preflight",()=>{
  test("checks complete keyframe and controller scope without any mutation",()=>{
    const {ready,plan,inventory}=mutationFixture();
    const before=JSON.stringify({ready,plan,inventory});
    const result=requireNativeIkBakeMutationPreflight({
      readiness:ready,plan,inventory,
    });
    expect(result).toMatchObject({
      state:"SOURCE_PREFLIGHT_ONLY",native_ik_baked:false,
      undo_executed:false,selected_bone_count:2,
      controller_keyframes_to_remove:2,
      planned_native_keyframe_count:21,
    });
    expect(JSON.stringify({ready,plan,inventory})).toBe(before);
  });

  test("pre-existing rotations, drifted controller keys, foreign clips and duplicated frame writes block",()=>{
    const {ready,plan,inventory}=mutationFixture();
    const preflight=(changes:Record<string,unknown>)=>
      requireNativeIkBakeMutationPreflight({readiness:ready,plan,
        inventory:{...inventory,...changes}});
    expect(()=>preflight({
      rotation_tracks:[{bone_uuid:"mid",existing_keyframe_count:1},
        {bone_uuid:"root",existing_keyframe_count:0}],
    })).toThrow("IK_BAKE_MUTATION_EXISTING_ROTATION_KEYS");
    expect(()=>preflight({
      controller_tracks:[{controller_uuid:"ik",existing_keyframe_count:1}],
    })).toThrow("IK_BAKE_MUTATION_CONTROLLER_KEY_COUNT_CHANGED");
    expect(()=>preflight({selected_animation_uuid:"other"}))
      .toThrow("IK_BAKE_MUTATION_CLIP_IDENTITY_MISMATCH");
    expect(()=>preflight({snapping_fps:30}))
      .toThrow("IK_BAKE_MUTATION_SAMPLE_MISMATCH");
    const duplicate={...plan,
      keyframes:[...plan.keyframes,plan.keyframes[0]],
      planned_rotation_keyframe_count:plan.planned_rotation_keyframe_count+1,
    };
    expect(()=>requireNativeIkBakeMutationPreflight({
      readiness:ready,plan:duplicate,inventory,
    })).toThrow("IK_BAKE_MUTATION_DUPLICATE_KEYFRAME");
  });
});

describe("unregistered native IK keyframe writer",()=>{
  function withNativeFixture(
    callback:(env:{clip:any,controllers:any,bones:any,undo:any,timeline:any})=>void
  ) {
    const g=globalThis as any;
    const names=["Group","BoneAnimator","NullObject","Blockbench","Format",
      "Modes","AnimationItem","Undo","Timeline"];
    const old=Object.fromEntries(names.map((name)=>[name,g[name]]));
    const fixture=mutationFixture();
    class FakeGroup {
      static all:any[]=[];
      constructor(public uuid:string) {}
    }
    class FakeBoneAnimator {
      readonly rotation:any[]=[];
      readonly keyframes:any[]=[];
      constructor(public animation:any) {}
      addKeyframe(payload:any) {
        const key={
          ...payload,uuid:"kf-"+Math.random(),animator:this,
          getArray(){const v=this.data_points[0];return [v.x,v.y,v.z];},
        };
        this.rotation.push(key);
        this.keyframes.push(key);
        return key;
      }
    }
    class FakeNullObject {
      static all:any[]=[];
      constructor(public uuid:string,public ik_target:string,public parent:unknown) {}
    }
    g.Group=FakeGroup;
    g.BoneAnimator=FakeBoneAnimator;
    g.NullObject=FakeNullObject;
    const root=new FakeGroup("root"),mid=new FakeGroup("mid");
    const tip=new FakeGroup("tip");
    FakeGroup.all=[root,mid,tip];
    const controller=new FakeNullObject("ik","tip",root);
    FakeNullObject.all=[controller];
    const clip:any={uuid:"walk",name:"walk",length:1,snapping:20,animators:{}};
    const a=new FakeBoneAnimator(clip),b=new FakeBoneAnimator(clip);
    const keys:any[]=[];
    for (let i=0;i<2;i++) {
      const key:any={uuid:"old-"+i,animator:null,
        remove(){const ix=keys.indexOf(key);if(ix>=0)keys.splice(ix,1);}};
      keys.push(key);
    }
    const ctrl:any={animation:clip,get keyframes(){return keys;}};
    for(const key of keys)key.animator=ctrl;
    clip.animators={root:a,mid:b,ik:ctrl};
    let opened=0,finished=0,canceled=0;
    const undo={initEdit(){opened++;},finishEdit(){finished++;},cancelEdit(){canceled++;},
      get opened(){return opened;},get finished(){return finished;},get canceled(){return canceled;}};
    g.Blockbench={version:"5.2.2"};
    g.Format={id:"bedrock"};
    g.Modes={animate:true};
    g.AnimationItem={selected:clip,all:[clip]};
    g.Undo=undo;
    g.Timeline={time:0.75};
    try {callback({clip,controllers:ctrl,bones:{root:a,mid:b},undo,timeline:g.Timeline});}
    finally {for(const name of names)g[name]=old[name];}
  }

  test("one full-animation Undo writes all prepared keys and removes only mapped IK controller keys",()=>{
    withNativeFixture(({clip,controllers,bones,undo,timeline})=>{
      const {ready,plan}=mutationFixture();
      const result=writePreparedNativeIkBakeKeyframes({animation:clip,readiness:ready,plan});
      expect(result).toMatchObject({
        state:"NATIVE_WRITE_COMPLETED",
        keyframes_created:21,controller_keyframes_removed:2,
        preview_restoration_verified:false,playback_or_export_verified:false,
      });
      expect(undo.opened).toBe(1);
      expect(undo.finished).toBe(1);
      expect(undo.canceled).toBe(0);
      expect(controllers.keyframes).toHaveLength(0);
      expect(bones.mid.rotation).toHaveLength(1);
      expect(bones.root.rotation).toHaveLength(20);
      expect(timeline.time).toBe(.75);
      // A repeated unobserved mutation is not idempotently re-applied.
      expect(()=>writePreparedNativeIkBakeKeyframes({
        animation:clip,readiness:ready,plan,
      })).toThrow("IK_BAKE_MUTATION_EXISTING_ROTATION_KEYS");
      expect(undo.opened).toBe(1);
    });
  });

  test("a wrong native keyframe channel triggers cancellation of the full animation Undo",()=>{
    withNativeFixture(({clip,bones,undo})=>{
      const {ready,plan}=mutationFixture();
      const original=bones.mid.addKeyframe;
      bones.mid.addKeyframe=function(payload:any) {
        const created=original.call(this,payload);
        created.channel="position";
        return created;
      };
      expect(()=>writePreparedNativeIkBakeKeyframes({
        animation:clip,readiness:ready,plan,
      })).toThrow("IK_BAKE_NATIVE_ROTATION_POSTCONDITION_FAILED");
      expect(undo.opened).toBe(1);
      expect(undo.finished).toBe(0);
      expect(undo.canceled).toBe(1);
    });
  });

  test("unknown native context refuses to open Undo",()=>{
    withNativeFixture(({clip,undo})=>{
      const {ready,plan}=mutationFixture();
      (globalThis as any).Blockbench.version="5.2.1";
      expect(()=>writePreparedNativeIkBakeKeyframes({
        animation:clip,readiness:ready,plan,
      })).toThrow("IK_BAKE_NATIVE_WRITE_CONTEXT_UNVERIFIED");
      expect(undo.opened).toBe(0);
    });
  });
});

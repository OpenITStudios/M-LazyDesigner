import {test, expect} from "bun:test";
import "@/server/tools";
import {getAllToolDefinitions} from "@/lib/factories";
import {registerAnimationTools} from "@/server/tools/animation";
import {requireBoundedNumericBakeSamplePlan} from "@/lib/animation/batchPlanning";

test("bake samples only the selected channel interval and restores timeline after invalid samples", async()=>{
  const g=globalThis as any;
  const names=["AnimationItem","Timeline","Animator","Undo","NullObject","settings","updateKeyframeSelection"];
  const previous=Object.fromEntries(names.map(name=>[name,g[name]]));
  const made:any[]=[];let edits=0, invalid=false;
  const animation:any={uuid:"audit",name:"audit",snapping:20,setLength(){}};
  const animator:any={animation,rotation:[],position:[],scale:[],interpolate(){return invalid?[NaN,2,3]:[1,2,3]},addKeyframe(k:any){const created={...k,animator:this};this[k.channel].push(created);this.keyframes.push(created);made.push(created);return created}};
  const key=(time:number,channel:string)=>({time,channel,animator,interpolation:"bezier",transform:true});
  animator.rotation=[key(0,"rotation"),key(1,"rotation"),key(3,"rotation")];
  animator.position=[key(0,"position"),key(2,"position")];
  animator.keyframes=[...animator.rotation,...animator.position];
  animation.animators={bone:animator};
  g.NullObject={all:[]};g.AnimationItem={all:[animation],selected:animation};
  g.Timeline={time:7,keyframes:[...animator.rotation,...animator.position],selected:animator.rotation.slice(0,2),snapTime:(t:number)=>t};
  g.Animator={preview(){}};g.Undo={initEdit(){edits++},finishEdit(){},cancelEdit(){}};
  g.settings={default_keyframe_interpolation:{value:"bezier"}};g.updateKeyframeSelection=()=>{};
  try{
    if(!getAllToolDefinitions().batch_keyframe_operations)registerAnimationTools();
    const tool=getAllToolDefinitions().batch_keyframe_operations;
    const args=await tool.parameterSchema.parseAsync({operation:"bake",selection:"selected",parameters:{bake_interval:.5}});
    const baked=await tool.execute(args);
    expect(baked.structuredContent).toMatchObject({
      bake_kind:"numeric_keyframe_interpolation",
      native_ik_baked:false,
      eligible_track_count:1,
    });
    expect(made.map(k=>[k.channel,k.time,k.interpolation])).toEqual([["rotation",.5,"linear"]]);
    expect(g.Timeline.time).toBe(7);expect(edits).toBe(1);
    invalid=true;
    const finer=await tool.parameterSchema.parseAsync({operation:"bake",selection:"selected",parameters:{bake_interval:.25}});
    await expect(tool.execute(finer)).rejects.toThrow("sample");
    expect(g.Timeline.time).toBe(7);expect(edits).toBe(1);
  }finally{Object.assign(g,previous);}
});

test("numeric bake preflight bounds all track samples before native work",()=>{
  const planned=requireBoundedNumericBakeSamplePlan(
    [{start:0,end:1},{start:0,end:1}],.5
  );
  expect(planned).toMatchObject({
    planned_sample_visits:6,eligible_track_count:2,native_ik_baked:false,
  });
  expect(()=>requireBoundedNumericBakeSamplePlan([{start:0,end:1}],1e-12))
    .toThrow("BAKE_SAMPLE_BUDGET_EXCEEDED");
  expect(()=>requireBoundedNumericBakeSamplePlan([{start:0,end:0}],.5))
    .toThrow("BAKE_TRACK_RANGE_INVALID");
  expect(()=>requireBoundedNumericBakeSamplePlan([],.5))
    .toThrow("BAKE_NO_ELIGIBLE_TRACKS");
});

test("active keyed native IK controller blocks numeric bake before sampling or Undo",async()=>{
  const g=globalThis as any;
  const keys=["AnimationItem","Timeline","Animator","Undo","NullObject","updateKeyframeSelection"];
  const old=Object.fromEntries(keys.map(k=>[k,g[k]]));
  let samples=0,edits=0;
  const animation:any={uuid:"clip",name:"clip",snapping:20,animators:{}};
  const bone:any={
    animation,uuid:"bone",rotation:[],position:[],scale:[],
    interpolate(){samples++;return [1,2,3]},
  };
  const key=(time:number)=>({time,channel:"rotation",animator:bone,transform:true});
  bone.rotation=[key(0),key(1)];bone.keyframes=[...bone.rotation];
  animation.animators={bone,ik_controller:{keyframes:[{time:0}]}};
  g.NullObject={all:[{uuid:"ik_controller",ik_target:"bone"}]};
  g.AnimationItem={selected:animation,all:[animation]};
  g.Timeline={time:4,selected:[...bone.rotation],keyframes:[...bone.rotation],snapTime:(t:number)=>t};
  g.Animator={preview(){}};
  g.Undo={initEdit(){edits++},finishEdit(){},cancelEdit(){}};
  g.updateKeyframeSelection=()=>{};
  try{
    if(!getAllToolDefinitions().batch_keyframe_operations)registerAnimationTools();
    const tool=getAllToolDefinitions().batch_keyframe_operations;
    const args=await tool.parameterSchema.parseAsync({
      operation:"bake",selection:"selected",parameters:{bake_interval:.5},
    });
    await expect(tool.execute(args)).rejects.toThrow("NATIVE_IK_BAKE_REQUIRED");
    expect(samples).toBe(0);expect(edits).toBe(0);expect(g.Timeline.time).toBe(4);
  }finally{Object.assign(g,old)}
});

test("numeric bake rejects unbounded clocks and preserves timeline before Undo",async()=>{
  const g=globalThis as any;
  const keys=["AnimationItem","Timeline","Animator","Undo","NullObject","updateKeyframeSelection"];
  const old=Object.fromEntries(keys.map(k=>[k,g[k]]));
  let sampled=0,edits=0;
  const animation:any={uuid:"clip",name:"clip",snapping:20,animators:{}};
  const bone:any={animation,uuid:"bone",rotation:[],position:[],scale:[],
    interpolate(){sampled++;return [1,2,3]}};
  const key=(time:number)=>({time,channel:"rotation",animator:bone,transform:true});
  bone.rotation=[key(0),key(1)];bone.keyframes=[...bone.rotation];
  animation.animators={bone};
  g.NullObject={all:[]};g.AnimationItem={selected:animation,all:[animation]};
  g.Timeline={time:9,selected:[...bone.rotation],keyframes:[...bone.rotation],snapTime:(t:number)=>t};
  g.Animator={preview(){}};
  g.Undo={initEdit(){edits++},finishEdit(){},cancelEdit(){}};
  g.updateKeyframeSelection=()=>{};
  try{
    if(!getAllToolDefinitions().batch_keyframe_operations)registerAnimationTools();
    const tool=getAllToolDefinitions().batch_keyframe_operations;
    const args=await tool.parameterSchema.parseAsync({
      operation:"bake",selection:"selected",parameters:{bake_interval:1e-12},
    });
    await expect(tool.execute(args)).rejects.toThrow("BAKE_SAMPLE_BUDGET_EXCEEDED");
    expect(sampled).toBe(0);expect(edits).toBe(0);expect(g.Timeline.time).toBe(9);
  }finally{Object.assign(g,old)}
});

test("wrong native bake keyframe channel cancels the entire animation Undo",async()=>{
  const g=globalThis as any;
  const keys=["AnimationItem","Timeline","Animator","Undo","NullObject","updateKeyframeSelection"];
  const old=Object.fromEntries(keys.map(k=>[k,g[k]]));
  let edits=0,cancels=0;
  const animation:any={uuid:"clip",name:"clip",snapping:20,animators:{},setLength(){}};
  const bone:any={animation,uuid:"bone",rotation:[],position:[],scale:[],
    interpolate(){return [1,2,3]},
    addKeyframe(k:any){const wrong={...k,channel:"position",animator:this};this.position.push(wrong);return wrong;}};
  const key=(time:number)=>({time,channel:"rotation",animator:bone,transform:true});
  bone.rotation=[key(0),key(1)];bone.keyframes=[...bone.rotation];
  animation.animators={bone};
  g.NullObject={all:[]};g.AnimationItem={selected:animation,all:[animation]};
  g.Timeline={time:5,selected:[...bone.rotation],keyframes:[...bone.rotation],snapTime:(t:number)=>t};
  g.Animator={preview(){}};
  g.Undo={initEdit(){edits++},finishEdit(){},cancelEdit(){cancels++}};
  g.updateKeyframeSelection=()=>{};
  try{
    if(!getAllToolDefinitions().batch_keyframe_operations)registerAnimationTools();
    const tool=getAllToolDefinitions().batch_keyframe_operations;
    const args=await tool.parameterSchema.parseAsync({
      operation:"bake",selection:"selected",parameters:{bake_interval:.5},
    });
    await expect(tool.execute(args)).rejects.toThrow("BAKE_NATIVE_POSTCONDITION_MISMATCH");
    expect(edits).toBe(1);expect(cancels).toBe(1);expect(g.Timeline.time).toBe(5);
  }finally{Object.assign(g,old)}
});

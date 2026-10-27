import {test,expect} from "bun:test";
import MolangParser from "molangjs";
import {
  animationEasingSchema,
  buildAnimationEasing,
  inspectAuthoredAnimationEasing,
} from "@/lib/animationEasing";
import {registerAnimationTools} from "@/server/tools/animation";
import {getAllToolDefinitions} from "@/lib/factories";

test("generated Molang evaluates curve endpoints, midpoint and loop overrun",()=>{
  for(const curve of ["sine","quad","cubic"] as const){
    for(const direction of ["in","out","in_out"] as const){
      const options=animationEasingSchema.parse({curve,direction});
      for(const [delta,expected] of [[0,0],[2,2]] as const){
        expect(new MolangParser().parse(buildAnimationEasing("a",2,"hold",options),{"query.anim_time":0,"query.delta_time":delta})).toBeCloseTo(expected,5);
      }
      const midpoint=new MolangParser().parse(buildAnimationEasing("a",2,"hold",options),{"query.anim_time":0,"query.delta_time":1});
      if(direction==="in_out")expect(midpoint).toBeCloseTo(1,5);
      else if(direction==="in")expect(midpoint).toBeLessThan(1);
      else expect(midpoint).toBeGreaterThan(1);
    }
  }
  const options=animationEasingSchema.parse({curve:"quad",direction:"in"});
  expect(new MolangParser().parse(buildAnimationEasing("a",2,"loop",options),{"query.anim_time":0,"query.delta_time":5})).toBeCloseTo(.5,5);
  expect(new MolangParser().parse(buildAnimationEasing("a",2,"once",options),{"query.anim_time":0,"query.delta_time":3})).toBeCloseTo(2.1,5);
  expect(()=>buildAnimationEasing("a",0,"loop",options)).toThrow();
});

test("easing targets explicit clip and protects authored time expressions before Undo",async()=>{
  const g=globalThis as any,previous={AnimationItem:g.AnimationItem,Undo:g.Undo,Animator:g.Animator,Format:g.Format};
  g.Format={id:"bedrock"};
  let edits=0;
  const clip={uuid:"target",name:"target",length:2,loop:"loop",anim_time_update:"q.anim_time+q.delta_time",extend(data:object){Object.assign(this,data);}};
  const other={...clip,uuid:"other"};g.AnimationItem={all:[clip,other],selected:other};
  g.Undo={initEdit(){edits++},finishEdit(){},cancelEdit(){}};g.Animator={preview(){}};
  try{
    if(!getAllToolDefinitions().animation_timeline)registerAnimationTools();
    const tool=getAllToolDefinitions().animation_timeline;
    const run=async(replace_existing:boolean)=>tool.execute(await tool.parameterSchema.parseAsync({animation_id:"target",action:"set_easing",easing:{curve:"sine",direction:"in_out",replace_existing}}));
    await expect(run(false)).rejects.toThrow("replace_existing");expect(edits).toBe(0);
    for(const id of ["free","java_block","bedrock_block"]){
      g.Format={id};
      await expect(run(true)).rejects.toThrow("Bedrock Entity");
      expect(edits).toBe(0);
      expect(clip.anim_time_update).toBe("q.anim_time+q.delta_time");
    }
    g.Format={id:"bedrock"};
    await run(true);expect(edits).toBe(1);expect(clip.anim_time_update).toContain("math.cos");
    expect(other.anim_time_update).toBe("q.anim_time+q.delta_time");expect(g.AnimationItem.selected).toBe(other);
  }finally{Object.assign(g,previous);}
});

test("generated easing ownership is exact and never inferred from partial Molang", () => {
  const options = animationEasingSchema.parse({
    curve: "cubic", direction: "out",
  });
  const generated = buildAnimationEasing("clipA", 2.5, "loop", options);
  expect(generated).toContain("v.lazydesigner_ease_");
  expect(generated).not.toContain("v.blockit_ease_");
  expect(inspectAuthoredAnimationEasing("clipA", generated)).toEqual({
    state: "owned", curve: "cubic", direction: "out",
    duration: 2.5, loop: "loop", source_namespace: "canonical",
  });

  const legacy = generated.replaceAll("lazydesigner", "blockit");
  expect(inspectAuthoredAnimationEasing("clipA", legacy)).toMatchObject({
    state: "owned", source_namespace: "legacy",
  });
  expect(inspectAuthoredAnimationEasing("clipB", legacy))
    .toEqual({ state: "modified_generated" });
  expect(inspectAuthoredAnimationEasing("clipA", generated + "q.life_time;"))
    .toEqual({ state: "modified_generated" });
  expect(inspectAuthoredAnimationEasing("clipA", "q.anim_time+q.delta_time"))
    .toEqual({ state: "external" });
});

test("managed easing follows duration and loop in one native Undo; custom Molang remains unchanged", async () => {
  const g = globalThis as any;
  const previous = {
    Format:g.Format, AnimationItem:g.AnimationItem, Undo:g.Undo,
    Animator:g.Animator, Timeline:g.Timeline,
  };
  const options=animationEasingSchema.parse({curve:"quad",direction:"in_out"});
  const clip={
    uuid:"owned_clip", name:"owned_clip", length:2, loop:"loop",
    anim_time_update:buildAnimationEasing("owned_clip",2,"loop",options),
    extend(props:object){Object.assign(this,props);},
    setLength(value:number){this.length=value;},
    setLoop(value:string){this.loop=value;},
  };
  const other={uuid:"other",name:"other"};
  let opened=0, finished=0, canceled=0;
  let before:any=null;
  g.Format={id:"bedrock"};
  g.AnimationItem={all:[clip,other],selected:other};
  g.Timeline={time:0};
  g.Animator={preview(){}};
  g.Undo={
    initEdit(){opened++;before={length:clip.length,loop:clip.loop,
      anim_time_update:clip.anim_time_update};},
    finishEdit(){finished++;},
    cancelEdit(){canceled++;Object.assign(clip,before);},
  };
  try {
    if(!getAllToolDefinitions().animation_timeline)registerAnimationTools();
    const tool=getAllToolDefinitions().animation_timeline;
    const run=async(args:Record<string,unknown>)=>
      tool.execute(await tool.parameterSchema.parseAsync({
        animation_id:"owned_clip",...args,
      }));
    const lengthResult=await run({action:"set_length",length:4});
    expect(clip.anim_time_update).toBe(
      buildAnimationEasing("owned_clip",4,"loop",options)
    );
    expect(lengthResult.structuredContent.managed_easing_refreshed).toBe(true);
    const loopResult=await run({action:"loop",loop_mode:"hold"});
    expect(clip.anim_time_update).toBe(
      buildAnimationEasing("owned_clip",4,"hold",options)
    );
    expect(loopResult.structuredContent.managed_easing_refreshed).toBe(true);
    expect(opened).toBe(2);
    expect(finished).toBe(2);
    expect(g.AnimationItem.selected).toBe(other);

    // Historical exact-generated BlockIT data is only read to migrate
    // directly to current LazyDesigner output, never executed as a fallback.
    clip.anim_time_update=buildAnimationEasing(
      "owned_clip",4,"hold",options
    ).replaceAll("lazydesigner","blockit");
    await run({action:"loop",loop_mode:"once"});
    expect(clip.anim_time_update).toBe(
      buildAnimationEasing("owned_clip",4,"once",options)
    );

    clip.anim_time_update="q.anim_time + q.delta_time";
    await run({action:"set_length",length:6});
    expect(clip.anim_time_update).toBe("q.anim_time + q.delta_time");
    expect(opened).toBe(4);

    clip.anim_time_update=buildAnimationEasing("owned_clip",6,"once",options) +
      ";q.life_time";
    const saved=clip.anim_time_update;
    await expect(run({action:"loop",loop_mode:"loop"}))
      .rejects.toThrow("EASING_TIME_UPDATE_REQUIRES_REVIEW");
    expect(clip.anim_time_update).toBe(saved);
    expect(clip.loop).toBe("once");
    expect(opened).toBe(4);

    clip.anim_time_update=buildAnimationEasing("owned_clip",6,"once",options);
    await expect(run({action:"set_length",length:0}))
      .rejects.toThrow("positive finite");
    expect(canceled).toBe(1);
    expect(clip.length).toBe(6);
    expect(clip.anim_time_update).toBe(
      buildAnimationEasing("owned_clip",6,"once",options)
    );
  } finally {
    Object.assign(g,previous);
  }
});

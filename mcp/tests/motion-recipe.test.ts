import { describe, expect, test } from "bun:test";
import { compileMotionRecipe, bakeShapePreservingMotionToLinearRecipe } from "@/lib/animation/motionRecipe";
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


describe("native keyframe timing integrity", () => {
  test("rejects near-colliding authored same-channel keys before create_animation", () => {
    expect(() => compileMotionRecipe({
      name: "unsafe_foot",
      poses: [
        { id: "a", time: 0.5, bones: { foot: { position: [0, 0, 0] } } },
        { id: "b", time: 0.50005, bones: { foot: { position: [1, 0, 0] } } },
      ],
    })).toThrow("native Blockbench replacement tolerance");
  });

  test("allows near-coincident times on different bone channels", () => {
    const motion = compileMotionRecipe({
      name: "separate_channels",
      poses: [
        { id: "a", time: 0.5, bones: { arm: { rotation: [0, 0, 0] } } },
        { id: "b", time: 0.50005, bones: { arm: { position: [0, 0, 0] } } },
      ],
    });
    expect(motion.bones.arm).toHaveLength(2);
  });
});


describe("opt-in axiswise shape-preserving linear motion bake",()=>{
  const action=()=>({
    name:"smooth_action",loop:false,duration:1,
    poses:[
      {id:"start",time:0,bones:{arm:{rotation:[0,0,0] as [number,number,number]},root:{scale:1}}},
      {id:"contact",time:0.5,bones:{arm:{rotation:[8,0,0] as [number,number,number]},root:{scale:1}}},
      {id:"recover",time:1,bones:{arm:{rotation:[0,0,0] as [number,number,number]},root:{scale:1}}},
    ],
  });

  test("preserves source identity/anchors, prevents axis overshoot and reduces velocity at turn",()=>{
    const src=action(),before=JSON.stringify(src);
    const result=bakeShapePreservingMotionToLinearRecipe(
      src,[{bone:"arm",channel:"rotation"}],
      {sample_fps:30,boundary_tangent:"rest_endpoints"}
    );
    const original=result.recipe.poses.filter(p=>["start","contact","recover"].includes(p.id));
    expect(original.map(p=>p.time)).toEqual([0,0.5,1]);
    expect(original.map(p=>p.id)).toEqual(["start","contact","recover"]);
    expect(original.map(p=>p.bones.arm?.rotation?.[0])).toEqual([0,8,0]);
    const added=result.recipe.poses.filter(p=>p.id.startsWith("__ld_pchip_"));
    expect(added.length).toBe(28);
    expect(added.every(p=>p.bones.arm?.rotation?.every(x=>x>=0&&x<=8))).toBe(true);
    expect(added.every(p=>p.bones.root===undefined)).toBe(true);
    const baked=compileMotionRecipe(result.recipe);
    const left=baked.bones.arm.find(p=>Math.abs(p.time-14/30)<1e-9)!;
    const right=baked.bones.arm.find(p=>Math.abs(p.time-16/30)<1e-9)!;
    const turnJump=Math.abs((8-left.rotation![0])/(.5-left.time)-
      (right.rotation![0]-8)/(right.time-.5));
    expect(turnJump).toBeLessThan(32);
    expect(result.evidence).toMatchObject({
      state:"SOURCE_ONLY_SHAPE_PRESERVING_LINEAR_BAKE",
      generated_channel_key_count:28,
      authored_pose_ids_preserved:true,
      native_playback_attested:false,
      native_export_timecodes_verified:false,
    });
    expect(JSON.stringify(src)).toBe(before);
    expect(bakeShapePreservingMotionToLinearRecipe(src,
      [{bone:"arm",channel:"rotation"}],
      {sample_fps:30,boundary_tangent:"rest_endpoints"})).toEqual(result);
  });

  test("monotone source never overshoots or flips extrema",()=>{
    const src=action();
    src.poses[1].bones.arm.rotation[0]=5;
    src.poses[2].bones.arm.rotation[0]=3;
    const result=bakeShapePreservingMotionToLinearRecipe(src,
      [{bone:"arm",channel:"rotation"}],{sample_fps:30});
    const values=result.recipe.poses.map(p=>p.bones.arm?.rotation?.[0])
      .filter((x):x is number=>x!==undefined);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(5);
    expect(result.evidence.tangent_policy).toBe("shape_preserving");
  });

  test("straight constant velocity has no invented smoothing benefit",()=>{
    const src=action();
    src.poses[1].bones.arm.rotation[0]=5;
    src.poses[2].bones.arm.rotation[0]=10;
    expect(()=>bakeShapePreservingMotionToLinearRecipe(src,
      [{bone:"arm",channel:"rotation"}],{sample_fps:30}))
      .toThrow("MOTION_PCHIP_NO_EFFECTIVE_SHAPE_CHANGE");
  });

  test("rejects off-grid source, loop seams, nonlinear metadata and ambiguous Euler arc",()=>{
    const src=action();
    expect(()=>bakeShapePreservingMotionToLinearRecipe(
      {...src,loop:true},[{bone:"arm",channel:"rotation"}],
      {sample_fps:30})).toThrow("MOTION_PCHIP_LOOP_REQUIRES_PERIODIC_TANGENTS");
    src.poses[1].time=.51;
    expect(()=>bakeShapePreservingMotionToLinearRecipe(src,
      [{bone:"arm",channel:"rotation"}],{sample_fps:30}))
      .toThrow("MOTION_PCHIP_AUTHORED_CLOCK_NOT_ON_GRID");
    src.poses[1].time=.5;
    Object.assign(src.poses[1].bones.arm,{interpolation:"bezier"});
    expect(()=>bakeShapePreservingMotionToLinearRecipe(src,
      [{bone:"arm",channel:"rotation"}],{sample_fps:30}))
      .toThrow("MOTION_PCHIP_NONLINEAR_SOURCE_UNSUPPORTED");
    delete (src.poses[1].bones.arm as {interpolation?:string}).interpolation;
    src.poses[1].bones.arm.rotation[0]=170;
    expect(()=>bakeShapePreservingMotionToLinearRecipe(src,
      [{bone:"arm",channel:"rotation"}],{sample_fps:30}))
      .toThrow("MOTION_PCHIP_EULER_ARC_AMBIGUOUS");
  });

  test("strict sampling budget and duplicate ownership are rejected before native creation",()=>{
    const src=action();
    const target=[{bone:"arm",channel:"rotation" as const}];
    expect(()=>bakeShapePreservingMotionToLinearRecipe(src,target,{sample_fps:121}))
      .toThrow("MOTION_PCHIP_SAMPLING_POLICY_INVALID");
    expect(()=>bakeShapePreservingMotionToLinearRecipe(src,[...target,...target],
      {sample_fps:30})).toThrow("MOTION_PCHIP_DUPLICATE_CHANNEL_OWNERSHIP");
    const long={...src,duration:30,poses:src.poses.map(p=>({
      ...p,time:p.time*30,
    }))};
    expect(()=>bakeShapePreservingMotionToLinearRecipe(long,target,
      {sample_fps:30,boundary_tangent:"rest_endpoints"}))
      .toThrow("MOTION_PCHIP_SOURCE_KEY_BUDGET_EXCEEDED");
  });
});


describe("explicit sampled speed cap on PCHIP linear baked motion",()=>{
  const action=()=>({
    name:"speed_bounded_attack",duration:1,loop:false,
    poses:[
      {id:"ready",time:0,bones:{arm:{rotation:[0,0,0] as [number,number,number]}}},
      {id:"contact",time:0.5,bones:{arm:{rotation:[8,0,0] as [number,number,number]}}},
      {id:"recover",time:1,bones:{arm:{rotation:[0,0,0] as [number,number,number]}}},
    ],
  });

  test("limits discrete peak speed without touching original times, values or duration",()=>{
    const source=action(),saved=JSON.stringify(source);
    const bounded=bakeShapePreservingMotionToLinearRecipe(
      source,[{bone:"arm",channel:"rotation"}],{
        sample_fps:30,boundary_tangent:"rest_endpoints",
        max_sampled_speed_ratio:1.15,
      }
    );
    const stats=bounded.evidence.sampled_peak_speed_guard;
    expect(stats?.state).toBe("SOURCE_ONLY_SAMPLED_SPEED_BOUNDED");
    expect(stats?.max_sampled_speed_ratio).toBe(1.15);
    expect(stats?.tracks).toHaveLength(1);
    const s=stats!.tracks[0];
    expect(s.source_peak_sampled_speed).toBeCloseTo(16,5);
    expect(s.uncapped_peak_sampled_speed).toBeGreaterThan(23);
    expect(s.allowed_peak_sampled_speed).toBeCloseTo(18.4,5);
    expect(s.final_peak_sampled_speed).toBeLessThanOrEqual(18.400001);
    expect(s.pchip_shape_weight).toBeGreaterThan(0.1);
    expect(s.pchip_shape_weight).toBeLessThan(1);
    expect(s.cap_applied).toBe(true);
    expect(stats?.rest_endpoint_tangent_may_be_relaxed).toBe(true);
    expect(stats?.native_playback_attested).toBe(false);
    expect(stats?.native_export_speed_attested).toBe(false);
    const authored=bounded.recipe.poses.filter((pose)=>
      ["ready","contact","recover"].includes(pose.id)
    );
    expect(authored.map((pose)=>pose.time)).toEqual([0,0.5,1]);
    expect(authored.map((pose)=>pose.bones.arm.rotation?.[0]))
      .toEqual([0,8,0]);
    expect(bounded.recipe.duration).toBe(1);
    expect(JSON.stringify(source)).toBe(saved);
    expect(bakeShapePreservingMotionToLinearRecipe(
      source,[{bone:"arm",channel:"rotation"}],{
        sample_fps:30,boundary_tangent:"rest_endpoints",
        max_sampled_speed_ratio:1.15,
      }
    )).toEqual(bounded);
  });

  test("strict 100% source speed cap rejects easing that would be numerically erased",()=>{
    expect(()=>bakeShapePreservingMotionToLinearRecipe(
      action(),[{bone:"arm",channel:"rotation"}],{
        sample_fps:30,boundary_tangent:"rest_endpoints",
        max_sampled_speed_ratio:1,
      }
    )).toThrow("MOTION_PCHIP_SPEED_CAP_NO_EFFECTIVE_SMOOTHING");
  });

  test("invalid sampled speed ratios cannot silently change the source",()=>{
    const recipe=action(),before=JSON.stringify(recipe);
    for(const ratio of [0.99,3.1,Number.NaN,Number.POSITIVE_INFINITY]){
      expect(()=>bakeShapePreservingMotionToLinearRecipe(
        recipe,[{bone:"arm",channel:"rotation"}],{
          sample_fps:30,max_sampled_speed_ratio:ratio,
        }
      )).toThrow("MOTION_PCHIP_SPEED_RATIO_INVALID");
    }
    expect(JSON.stringify(recipe)).toBe(before);
  });

  test("legacy PCHIP behavior and evidence remain unchanged without speed cap",()=>{
    const result=bakeShapePreservingMotionToLinearRecipe(
      action(),[{bone:"arm",channel:"rotation"}],{
        sample_fps:30,boundary_tangent:"rest_endpoints",
      }
    );
    expect(result.evidence).not.toHaveProperty("sampled_peak_speed_guard");
    expect(result.evidence.generated_channel_key_count).toBe(28);
  });
});

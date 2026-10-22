import {describe, expect, test} from "bun:test";
import {planGroupRename, applyGroupRename} from "@/lib/batchGroupRename";
import {registerElementTools} from "@/server/tools/element";
import {getAllToolDefinitions} from "@/lib/factories";
import {registerBoneRiggingTool} from "@/server/tools/animation/rigging";
describe("Group batch rename",()=>{
  test("registered executor previews without Undo and applies one atomic edit",async()=>{
    const g=globalThis as any;
    const keys=["Project","Group","AnimationItem","Undo","Canvas"];
    const previous=keys.map(key=>g[key]);
    const group={uuid:"bone",name:"before"}, animator={uuid:"bone",name:"before"};
    const animation={animators:{bone:animator},saved:true};
    const edits:any[]=[];let finished=0;
    g.Project={};g.Group={all:[group]};g.AnimationItem={all:[animation]};
    g.Canvas={updateAll(){}};
    g.Undo={initEdit(edit:any){edits.push(edit)},finishEdit(){finished++},cancelEdit(){throw new Error("unexpected rollback")}};
    try {
      if(!getAllToolDefinitions().rename_element)registerElementTools();
      const tool=getAllToolDefinitions().rename_element;
      const run=async(dry_run:boolean)=>tool.execute(await tool.parameterSchema.parseAsync({updates:[{id:"bone",new_name:"after"}],dry_run}));
      await expect(tool.execute(await tool.parameterSchema.parseAsync({updates:[{id:"missing",new_name:"after"}],dry_run:false}))).rejects.toThrow("not found");
      expect(edits).toHaveLength(0);
      await run(true);expect(edits).toHaveLength(0);expect(group.name).toBe("before");
      await run(false);expect(finished).toBe(1);expect(edits).toHaveLength(1);
      expect(edits[0].groups).toEqual([group]);expect(edits[0].animations).toEqual([animation]);
      expect(animator.name).toBe("after");expect(animation.animators.bone).toBe(animator);
    } finally {keys.forEach((key,index)=>g[key]=previous[index])}
  });

  test("compatibility bone_rigging rename preserves UUID and legacy Animation bindings in one Undo", async () => {
    const g = globalThis as Record<string, any>;
    const keys = ["Group", "AnimationItem", "Undo", "Canvas"];
    const previous = Object.fromEntries(keys.map(key => [key, g[key]]));

    class FakeGroup {
      static all: FakeGroup[] = [];
      parent = "root";
      origin: [number, number, number] = [0, 0, 0];
      rotation: [number, number, number] = [0, 0, 0];
      ik_enabled = false;
      constructor(public uuid: string, public name: string) {
        FakeGroup.all.push(this);
      }
    }
    const bone = new FakeGroup("bone-uuid", "old_bone");
    const uuidAnimator = { uuid: "bone-uuid", name: "old_bone" };
    const legacyAnimator = { name: "old_bone" };
    const uuidClip = { animators: { "bone-uuid": uuidAnimator }, saved: true };
    const legacyClip = {
      animators: { old_bone: legacyAnimator },
      groups: { old_bone: { tag: "legacy" } },
      saved: true,
    };
    const edits: Array<Record<string, unknown>> = [];
    let completed = 0;
    let cancelled = 0;
    g.Group = FakeGroup;
    g.AnimationItem = { all: [uuidClip, legacyClip] };
    g.Undo = {
      initEdit(edit: Record<string, unknown>) { edits.push(edit); },
      finishEdit() { completed += 1; },
      cancelEdit() { cancelled += 1; },
    };
    g.Canvas = { updateAll() {} };

    try {
      if (!getAllToolDefinitions().bone_rigging) registerBoneRiggingTool();
      const tool = getAllToolDefinitions().bone_rigging;
      const run = async () => tool.execute(
        await tool.parameterSchema.parseAsync({
          action: "rename",
          bone_data: { name: "bone-uuid", new_name: "new_bone" },
        })
      );

      const result = await run();
      expect(result.structuredContent).toMatchObject({
        action: "rename",
        bone: { uuid: "bone-uuid", name: "new_bone", parent: "root" },
      });
      expect(bone.name).toBe("new_bone");
      expect(uuidAnimator.name).toBe("new_bone");
      expect(uuidClip.animators["bone-uuid"]).toBe(uuidAnimator);
      expect(legacyClip.animators).toHaveProperty("new_bone", legacyAnimator);
      expect(legacyClip.animators).not.toHaveProperty("old_bone");
      expect(legacyClip.groups).toHaveProperty("new_bone");
      expect(legacyClip.groups).not.toHaveProperty("old_bone");
      expect(uuidClip.saved).toBe(false);
      expect(legacyClip.saved).toBe(false);
      expect(edits).toHaveLength(1);
      expect(edits[0].groups).toEqual([bone]);
      expect(edits[0].animations).toEqual([uuidClip, legacyClip]);
      expect(completed).toBe(1);
      expect(cancelled).toBe(0);

      // Reconstruct a legacy name-key collision. The canonical planner must
      // refuse this before native Undo or any Group/Animation write.
      bone.name = "old_bone";
      const oldTrack = { name: "old_bone" };
      const collidingClip = {
        animators: {
          old_bone: oldTrack,
          new_bone: { name: "foreign" },
        },
        saved: true,
      };
      g.AnimationItem.all = [collidingClip];
      await expect(run()).rejects.toThrow('Animation map collision at "new_bone"');
      expect(bone.name).toBe("old_bone");
      expect(collidingClip.animators.old_bone).toBe(oldTrack);
      expect(collidingClip.saved).toBe(true);
      expect(edits).toHaveLength(1);
      expect(completed).toBe(1);
      expect(cancelled).toBe(0);
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete g[key];
        else g[key] = previous[key];
      }
    }
  });
  test("preview is pure and application preserves UUID animation binding",()=>{
    const group={uuid:"u1",name:"leg"}, animator={uuid:"u1",name:"leg"};
    const animation={animators:{u1:animator},saved:true};
    const plan=planGroupRename([group],[{id:"u1",new_name:"front_leg"}],[animation]);
    expect(group.name).toBe("leg");expect(animator.name).toBe("leg");
    applyGroupRename(plan);
    expect(group.name).toBe("front_leg");expect(animation.animators.u1).toBe(animator);
    expect(animator.name).toBe("front_leg");expect(animation.saved).toBe(false);
  });
  test("simultaneous name swaps retain both legacy tracks and group maps",()=>{
    const groups=[{uuid:"a",name:"left"},{uuid:"b",name:"right"}];
    const left={name:"left"},right={name:"right"};
    const animation={animators:{left,right},groups:{left:1,right:2}};
    applyGroupRename(planGroupRename(groups,[{id:"a",new_name:"right"},{id:"b",new_name:"left"}],[animation]));
    expect(animation.animators.right).toBe(left);expect(animation.animators.left).toBe(right);
    expect(animation.groups).toEqual({right:1,left:2});
  });
  test("conflicts and missing targets fail before changes",()=>{
    const groups=[{uuid:"a",name:"left"},{uuid:"b",name:"right"}];
    for(const updates of [[{id:"a",new_name:"RIGHT"}],[{id:"x",new_name:"x"}],[{id:"a",new_name:"x"},{id:"a",new_name:"y"}]]){
      expect(()=>planGroupRename(groups,updates,[])).toThrow();
      expect(groups[0].name).toBe("left");
    }
  });
  test("unbound animation-map collision cannot destroy a track",()=>{
    const groups=[{uuid:"a",name:"old"}];
    expect(()=>planGroupRename(groups,[{id:"a",new_name:"new"}],[{animators:{old:{name:"old"},new:{name:"new"}}}])).toThrow("collision");
    expect(groups[0].name).toBe("old");
  });
});

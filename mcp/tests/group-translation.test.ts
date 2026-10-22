import {test,expect} from "bun:test";
import {registerElementTools,modifyGroupParameters} from "@/server/tools/element";
import {getAllToolDefinitions} from "@/lib/factories";
import {isDescendantOf} from "@/server/tools/element/shared";

test("Group translation includes descendant Undo, preserves UV and rejects overflow before mutation",async()=>{
  const g=globalThis as any,keys=["Project","Group","Cube","Locator","NullObject","Undo","Canvas"];
  const old=Object.fromEntries(keys.map(k=>[k,g[k]]));
  class Bone {static all:Bone[]=[];uuid="bone";name="bone";origin=[0,0,0];children:any[]=[];constructor(){Bone.all.push(this);}}
  class Box {from=[0,0,0];to=[1,2,3];origin=[0,1,0];uuid="cube";name="cube";faces={north:{uv:[0,0,1,2]}};}
  const root=new Bone(),cube=new Box();root.children=[cube];let edits:any[]=[];
  g.Project={};g.Group=Bone;g.Cube=Box;g.Locator=class {};g.NullObject=class {};
  g.Canvas={updateAll(){}};g.Undo={initEdit(e:any){edits.push(e)},finishEdit(){},cancelEdit(){}};
  try{
    if(!getAllToolDefinitions().modify_group)registerElementTools();
    const tool=getAllToolDefinitions().modify_group;
    const run=async(offset:number[])=>tool.execute(await tool.parameterSchema.parseAsync({id:"bone",offset}));
    const uv=JSON.stringify(cube.faces);
    await run([2,0,-1]);expect(cube.from).toEqual([2,0,-1]);expect(cube.to).toEqual([3,2,2]);
    expect(root.origin).toEqual([2,0,-1]);expect(cube.origin).toEqual([2,1,-1]);expect(JSON.stringify(cube.faces)).toBe(uv);
    expect(edits[0].groups).toEqual([root]);expect(edits[0].elements).toEqual([cube]);
    cube.to[0]=1e308;
    await expect(run([1e308,0,0])).rejects.toThrow();expect(edits).toHaveLength(1);expect(cube.from).toEqual([2,0,-1]);
    expect(modifyGroupParameters.safeParse({id:"bone",offset:[1,0,0],origin:[0,0,0]}).success).toBe(false);
  }finally{Object.assign(g,old);}
});

test("cyclic ancestry fails closed instead of hanging outliner inspection", () => {
  const target = { parent: "root" } as unknown as Group;
  const ancestor = { parent: target };
  expect(isDescendantOf({ parent: ancestor }, target)).toBe(true);
  expect(isDescendantOf({ parent: "root" }, target)).toBe(false);
  const first: { parent?: object } = {};
  const second: { parent?: object } = {};
  first.parent = second;
  second.parent = first;
  expect(() => isDescendantOf(first, target)).toThrow("cyclic parent chain");
});

test("reparent verifies native parent and outliner membership before Undo commit", async () => {
  const g = globalThis as Record<string, any>;
  const keys = ["Project", "Group", "Cube", "Locator", "NullObject", "Outliner", "Undo", "Canvas"];
  const previous = Object.fromEntries(keys.map(key => [key, g[key]]));
  let mode: "normal" | "ignored" | "wrong" | "missing_child" = "normal";
  let wrongParent: NativeGroup;
  class NativeGroup {
    static all: NativeGroup[] = [];
    parent: NativeGroup | "root" = "root";
    children: NativeGroup[] = [];
    constructor(public uuid: string, public name: string) {
      NativeGroup.all.push(this);
    }
    addTo(requested: NativeGroup | "root") {
      if (mode === "ignored") return this;
      const destination = mode === "wrong" ? wrongParent : requested;
      if (this.parent instanceof NativeGroup) {
        this.parent.children = this.parent.children.filter(child => child !== this);
      }
      this.parent = destination;
      if (destination instanceof NativeGroup && mode !== "missing_child") {
        destination.children.push(this);
      }
      return this;
    }
  }
  const prior = new NativeGroup("prior", "Prior");
  const target = new NativeGroup("target", "Target");
  wrongParent = new NativeGroup("wrong", "Wrong");
  const node = new NativeGroup("node", "Child");
  const reset = () => {
    mode = "normal";
    node.parent = prior;
    prior.children = [node];
    target.children = [];
    wrongParent.children = [];
    target.parent = "root";
    wrongParent.parent = "root";
  };
  reset();
  const undo = { started: 0, finished: 0, cancelled: 0 };
  g.Project = {};
  g.Group = NativeGroup;
  g.Cube = class {};
  g.Locator = class {};
  g.NullObject = class {};
  g.Outliner = { elements: [] };
  g.Canvas = { updateAll() {} };
  g.Undo = {
    initEdit() { undo.started += 1; },
    finishEdit() { undo.finished += 1; },
    cancelEdit() { undo.cancelled += 1; },
  };

  try {
    if (!getAllToolDefinitions().reparent_element) registerElementTools();
    const tool = getAllToolDefinitions().reparent_element;
    const run = async () =>
      tool.execute(await tool.parameterSchema.parseAsync({ id: "node", parent: "target" }));

    const success = await run();
    expect(success.structuredContent).toMatchObject({
      execution: "applied", id: "node", previous_parent: "prior",
      parent: "target", transform_policy: "preserve_local",
    });
    expect(node.parent).toBe(target);
    expect(target.children).toContain(node);
    expect(undo).toEqual({ started: 1, finished: 1, cancelled: 0 });

    reset();
    mode = "ignored";
    await expect(run()).rejects.toThrow("Reparent postcondition mismatch");
    expect(undo).toEqual({ started: 2, finished: 1, cancelled: 1 });

    reset();
    mode = "wrong";
    await expect(run()).rejects.toThrow("Reparent postcondition mismatch");
    expect(undo).toEqual({ started: 3, finished: 1, cancelled: 2 });

    reset();
    mode = "missing_child";
    await expect(run()).rejects.toThrow("Reparent postcondition mismatch");
    expect(undo).toEqual({ started: 4, finished: 1, cancelled: 3 });

    reset();
    target.parent = wrongParent;
    wrongParent.parent = target;
    await expect(run()).rejects.toThrow("cyclic parent chain");
    expect(undo).toEqual({ started: 4, finished: 1, cancelled: 3 });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete g[key];
      else g[key] = previous[key];
    }
  }
});

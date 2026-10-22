import {test,expect} from "bun:test";
import {registerElementTools,modifyGroupParameters} from "@/server/tools/element";
import {getAllToolDefinitions} from "@/lib/factories";
import {isDescendantOf} from "@/server/tools/element/shared";
import {registerBoneRiggingTool} from "@/server/tools/animation/rigging";

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

test("legacy bone parent and unparent reject no-op and invalid native hierarchy outcomes", async () => {
  const g = globalThis as Record<string, any>;
  const keys = ["Group", "Outliner", "Undo", "Canvas"];
  const previous = Object.fromEntries(keys.map(key => [key, g[key]]));
  let mode: "normal" | "ignored" | "wrong" | "missing_child" = "normal";
  let wrong: FakeBone;
  class FakeBone {
    static all: FakeBone[] = [];
    parent: FakeBone | "root" = "root";
    children: FakeBone[] = [];
    origin: [number, number, number] = [0, 0, 0];
    rotation: [number, number, number] = [0, 0, 0];
    ik_enabled = false;
    constructor(public uuid: string, public name: string) { FakeBone.all.push(this); }
    addTo(destination: FakeBone | "root") {
      if (mode === "ignored") return this;
      const next = mode === "wrong" ? wrong : destination;
      if (this.parent instanceof FakeBone) {
        this.parent.children = this.parent.children.filter(child => child !== this);
      }
      this.parent = next;
      if (next instanceof FakeBone && mode !== "missing_child") next.children.push(this);
      return this;
    }
  }
  const oldParent = new FakeBone("parent-old", "Old");
  const nextParent = new FakeBone("parent-next", "Next");
  wrong = new FakeBone("parent-wrong", "Wrong");
  const child = new FakeBone("bone", "Bone");
  const reset = () => {
    mode = "normal";
    child.parent = oldParent;
    oldParent.children = [child];
    nextParent.children = [];
    wrong.children = [];
    nextParent.parent = "root";
    wrong.parent = "root";
  };
  reset();
  const undo = { started: 0, finished: 0, cancelled: 0 };
  g.Group = FakeBone;
  g.Outliner = { elements: [] };
  g.Canvas = { updateAll() {} };
  g.Undo = {
    initEdit() { undo.started++; },
    finishEdit() { undo.finished++; },
    cancelEdit() { undo.cancelled++; },
  };
  try {
    if (!getAllToolDefinitions().bone_rigging) registerBoneRiggingTool();
    const tool = getAllToolDefinitions().bone_rigging;
    const run = async (action: "parent" | "unparent") =>
      tool.execute(await tool.parameterSchema.parseAsync({
        action,
        bone_data: { name: "bone", ...(action === "parent" ? { parent: "parent-next" } : {}) },
      }));

    expect((await run("parent")).structuredContent).toMatchObject({
      action: "parent", bone: { uuid: "bone", parent: "parent-next" },
    });
    expect(child.parent).toBe(nextParent);
    expect(nextParent.children).toContain(child);
    expect(oldParent.children).not.toContain(child);
    await expect(run("parent")).rejects.toThrow("no authored effect");
    expect(undo.started).toBe(1);

    expect((await run("unparent")).structuredContent).toMatchObject({
      action: "unparent", bone: { uuid: "bone", parent: "root" },
    });
    expect(nextParent.children).not.toContain(child);
    await expect(run("unparent")).rejects.toThrow("no authored effect");
    expect(undo).toEqual({ started: 2, finished: 2, cancelled: 0 });

    for (const failed of ["ignored", "wrong", "missing_child"] as const) {
      reset();
      mode = failed;
      await expect(run("parent")).rejects.toThrow(
        "Native bone parenting postcondition mismatch"
      );
    }
    expect(undo).toEqual({ started: 5, finished: 2, cancelled: 3 });

    reset();
    mode = "ignored";
    await expect(run("unparent")).rejects.toThrow(
      "Native bone parenting postcondition mismatch"
    );
    expect(undo).toEqual({ started: 6, finished: 2, cancelled: 4 });

    reset();
    nextParent.parent = child;
    await expect(run("parent")).rejects.toThrow("parent cycle");
    expect(undo.started).toBe(6);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete g[key];
      else g[key] = previous[key];
    }
  }
});

test("legacy bone set_pivot refuses meshless/no-op and verifies native origin", async () => {
  const g = globalThis as Record<string, any>;
  const keys = ["Group", "Undo", "Canvas"];
  const previous = Object.fromEntries(keys.map(key => [key, g[key]]));
  let mode: "normal" | "ignored" | "wrong" = "normal";
  class FakeBone {
    static all: FakeBone[] = [];
    parent = "root";
    origin: [number, number, number] = [0, 0, 0];
    rotation: [number, number, number] = [0, 0, 0];
    mesh: object | null = {};
    ik_enabled = false;
    constructor(public uuid: string, public name: string) { FakeBone.all.push(this); }
    transferOrigin(origin: [number, number, number]) {
      if (mode === "ignored") return;
      this.origin = mode === "wrong"
        ? [origin[0] + 1, origin[1], origin[2]]
        : [...origin];
    }
  }
  const bone = new FakeBone("bone-pivot", "Joint");
  const undo = { started: 0, finished: 0, cancelled: 0 };
  g.Group = FakeBone;
  g.Canvas = { updateAll() {} };
  g.Undo = {
    initEdit() { undo.started++; },
    finishEdit() { undo.finished++; },
    cancelEdit() { undo.cancelled++; },
  };
  try {
    if (!getAllToolDefinitions().bone_rigging) registerBoneRiggingTool();
    const tool = getAllToolDefinitions().bone_rigging;
    const run = async (origin: [number, number, number]) =>
      tool.execute(await tool.parameterSchema.parseAsync({
        action: "set_pivot", bone_data: { name: "bone-pivot", origin },
      }));

    await expect(run([0, 0, 0])).rejects.toThrow("no authored effect");
    bone.mesh = null;
    await expect(run([3, 4, 5])).rejects.toThrow("no preview mesh");
    expect(undo.started).toBe(0);

    bone.mesh = {};
    expect((await run([3, 4, 5])).structuredContent).toMatchObject({
      action: "set_pivot", bone: { uuid: "bone-pivot", origin: [3, 4, 5] },
    });
    expect(undo).toEqual({ started: 1, finished: 1, cancelled: 0 });
    await expect(run([3, 4, 5])).rejects.toThrow("no authored effect");
    expect(undo.started).toBe(1);

    bone.origin = [0, 0, 0];
    mode = "ignored";
    await expect(run([3, 4, 5])).rejects.toThrow(
      "Native bone pivot postcondition mismatch"
    );
    bone.origin = [0, 0, 0];
    mode = "wrong";
    await expect(run([3, 4, 5])).rejects.toThrow(
      "Native bone pivot postcondition mismatch"
    );
    expect(undo).toEqual({ started: 3, finished: 1, cancelled: 2 });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete g[key];
      else g[key] = previous[key];
    }
  }
});

test("legacy create-child path rejects duplicate UUIDs without starting Undo", async () => {
  const g = globalThis as Record<string, any>;
  const keys = ["Group", "Outliner", "Undo"];
  const previous = Object.fromEntries(keys.map(key => [key, g[key]]));
  class FakeGroup { static all: FakeGroup[] = []; }
  const a = { uuid: "duplicate", name: "CubeA" };
  const b = { uuid: "duplicate", name: "CubeB" };
  let edits = 0;
  g.Group = FakeGroup;
  g.Outliner = { elements: [a, b] };
  g.Undo = { initEdit() { edits++; } };
  try {
    if (!getAllToolDefinitions().bone_rigging) registerBoneRiggingTool();
    const tool = getAllToolDefinitions().bone_rigging;
    for (const child of ["duplicate", "CubeA"]) {
      await expect(tool.execute(await tool.parameterSchema.parseAsync({
        action: "create", bone_data: { name: "NewBone", children: [child] },
      }))).rejects.toThrow('Outliner element UUID "duplicate" is ambiguous');
    }
    expect(edits).toBe(0);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete g[key];
      else g[key] = previous[key];
    }
  }
});

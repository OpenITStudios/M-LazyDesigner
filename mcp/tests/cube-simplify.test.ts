import {describe, expect, test} from "bun:test";
import {cubeToolDocs, planCubeSimplification, simplifyCubesParameters, registerCubesTools} from "@/server/tools/cubes";
import {getAllToolDefinitions} from "@/lib/factories";
import {analyzeCubeSimplificationFidelity} from "@/lib/geometry/quality";

const cube: Pick<Cube,"uuid"|"name"|"from"|"to"|"rotation"|"inflate"> = {uuid:"a",name:"body",from:[0.01,0,0],to:[1.99,2,2],rotation:[0,0,0],inflate:0};
const request = (extra={}) => simplifyCubesParameters.parse({ids:["a"],increment:1,fields:["bounds"],...extra});
describe("bounded Cube simplification",()=>{
  test("registered executor dry-run leaves native state and Undo untouched",async()=>{
    const g=globalThis as any, previous={Project:g.Project,Cube:g.Cube,Undo:g.Undo};
    let edits=0;
    g.Project={};g.Cube={all:[cube]};g.Undo={initEdit(){edits++}};
    try {
      if(!getAllToolDefinitions().manage_cubes) registerCubesTools();
      const tool=getAllToolDefinitions().manage_cubes;
      const result:any=await tool.execute(await tool.parameterSchema.parseAsync({operation:"simplify",...request()}));
      expect(result.structuredContent.execution).toBe("planned");
      expect(result.structuredContent.updates).toHaveLength(1);
      expect(edits).toBe(0);
      expect(cube.from[0]).toBe(.01);
    } finally {Object.assign(g,previous)}
  });
  test("plans changed coordinates without touching source, UV or pivots",()=>{
    expect(planCubeSimplification([cube],request())).toEqual([{id:"a",from:[0,0,0],to:[2,2,2]}]);
    expect(cube.from).toEqual([0.01,0,0]);
    expect(request().dry_run).toBe(true);
  });
  test("rejects collapsing even one positive axis",()=>{
    expect(()=>planCubeSimplification([{...cube,to:[.1,2,2]}],request())).toThrow("collapse");
  });
  test("rejects distinct Cubes sharing a requested UUID before planning edits", () => {
    const collision = { ...cube, name: "another-body" };
    expect(() => planCubeSimplification([cube, collision], request()))
      .toThrow('Cube UUID "a" is ambiguous');
    // A repeated reference to one native object is not a second target.
    expect(planCubeSimplification([cube, cube], request()))
      .toEqual(planCubeSimplification([cube], request()));
  });

  test("preflights every UUID and rejects numeric overflow",()=>{
    expect(()=>planCubeSimplification([cube],request({ids:["a","missing"]}))).toThrow("not found");
    expect(()=>planCubeSimplification([cube],request({increment:Number.MIN_VALUE}))).toThrow("non-finite");
  });
  test("rotation is opt-in and unchanged targets need no mutation",()=>{
    expect(planCubeSimplification([cube],request({fields:["rotation"]}))).toEqual([]);
    expect(planCubeSimplification([{...cube,rotation:[12.1,0,0]}],request({fields:["rotation"]}))).toEqual([{id:"a",rotation:[12,0,0]}]);
  });
  test("public branch validates duplicate targets, fields and increment",()=>{
    const schema=cubeToolDocs[0].parameters;
    expect(schema.safeParse({operation:"simplify",...request()}).success).toBe(true);
    for(const extra of [{ids:["a","a"]},{fields:[]},{increment:0},{increment:Infinity}]) {
      expect(simplifyCubesParameters.safeParse({ids:["a"],increment:1,fields:["bounds"],...extra}).success).toBe(false);
    }
  });
});


test("simplification quantifies parent-local shape drift and painted UV risk",()=>{
  const cube={
    uuid:"s",name:"shoulder",from:[0.01,0,0],to:[1.99,2,2],
    rotation:[0,0,0],origin:[1,1,1],inflate:0,box_uv:false,
    uv_faces:[
      {face:"north" as const,texture:"atlas-texture"},
      {face:"south" as const,texture:false},
      {face:"east" as const,texture:false},
      {face:"west" as const,texture:false},
      {face:"up" as const,texture:false},
      {face:"down" as const,texture:false},
    ],
  };
  const before=JSON.stringify(cube);
  const updates=planCubeSimplification([cube],request({ids:["s"]}));
  const report=analyzeCubeSimplificationFidelity(updates.map(update=>({cube,update})));
  expect(report).toMatchObject({
    state:"geometry_change_requires_review",
    coordinate_scope:"parent_local_conservative_upper_bound",
    visual_verdict:"not_evaluated",
    animation_pose_sweep:"not_evaluated",
    cube_count:1,
    mapped_texture_stretch_risk_count:1,
    incomplete_face_inventory_count:0,
  });
  expect(report.max_corner_drift_upper_bound).toBeCloseTo(0.01,6);
  expect(report.max_physical_extent_scale_ratio).toBeCloseTo(2/1.98,6);
  expect(report.per_cube[0]).toMatchObject({
    mapped_face_count:1,
    pivot_field_preserved:true,
    uv_coordinate_fields_preserved:true,
  });
  expect(JSON.stringify(cube)).toBe(before);
});

test("same-span translation has no texture stretch, rotated pivot has bounded drift",()=>{
  const cube={
    uuid:"c",name:"body",from:[0,0,0],to:[2,2,2],
    rotation:[0,0,0],origin:[1,1,1],inflate:0,
    box_uv:true,uv_faces:[
      {face:"north" as const,texture:"atlas-texture"},
      {face:"south" as const,texture:false},
      {face:"east" as const,texture:false},
      {face:"west" as const,texture:false},
      {face:"up" as const,texture:false},
      {face:"down" as const,texture:false},
    ],
  };
  const moved=analyzeCubeSimplificationFidelity([{
    cube,update:{id:"c",from:[1,0,0],to:[3,2,2]},
  }]);
  expect(moved.max_corner_drift_upper_bound).toBe(1);
  expect(moved.max_physical_extent_scale_ratio).toBe(1);
  expect(moved.mapped_texture_stretch_risk_count).toBe(0);
  expect(moved.box_uv_template_review_count).toBe(0);
  const turned=analyzeCubeSimplificationFidelity([{
    cube,update:{id:"c",rotation:[0,5,0]},
  }]);
  expect(turned.per_cube[0].parent_local_rotation_movement_upper_bound).toBeGreaterThan(0);
  expect(turned.mapped_texture_stretch_risk_count).toBe(0);
  expect(()=>analyzeCubeSimplificationFidelity([{
    cube:{...cube,origin:undefined},update:{id:"c",rotation:[0,5,0]},
  }])).toThrow("SIMPLIFY_FIDELITY_INVALID_VECTOR");
});

test("textured simplify refuses altered physical span before Undo",async()=>{
  const g=globalThis as any;
  const previous={Project:g.Project,Cube:g.Cube,Undo:g.Undo};
  let opened=0;
  const cube={
    uuid:"painted",name:"painted",from:[.01,0,0],to:[1.99,2,2],
    rotation:[0,0,0],origin:[0,0,0],inflate:0,
    box_uv:false,faces:{
      north:{texture:"atlas"},
      south:{texture:false},
      east:{texture:false},
      west:{texture:false},
      up:{texture:false},
      down:{texture:false},
    },
  };
  g.Project={};g.Cube={all:[cube]};g.Undo={initEdit(){opened++}};
  try{
    if(!getAllToolDefinitions().manage_cubes)registerCubesTools();
    const tool=getAllToolDefinitions().manage_cubes;
    const payload={operation:"simplify",ids:["painted"],increment:1,fields:["bounds"]};
    const dry:any=await tool.execute(await tool.parameterSchema.parseAsync(payload));
    expect(dry.structuredContent.execution).toBe("planned");
    expect(dry.structuredContent.simplification_fidelity)
      .toMatchObject({mapped_texture_stretch_risk_count:1});
    const apply=await tool.parameterSchema.parseAsync({...payload,dry_run:false});
    await expect(tool.execute(apply)).rejects.toThrow("SIMPLIFY_TEXTURE_MAPPING_REVIEW_REQUIRED");
    expect(opened).toBe(0);
    expect(cube.from).toEqual([.01,0,0]);
    expect(cube.to).toEqual([1.99,2,2]);
  }finally{Object.assign(g,previous)}
});

test("missing native faces remain unverified, not implicitly untextured",()=>{
  const cube={
    uuid:"unknown",name:"uninspected",from:[.01,0,0],to:[1.99,2,2],
    rotation:[0,0,0],origin:[0,0,0],inflate:0,
  };
  const updates=planCubeSimplification([cube],request({ids:["unknown"]}));
  const report=analyzeCubeSimplificationFidelity(updates.map(update=>({cube,update})));
  expect(report.incomplete_face_inventory_count).toBe(1);
  expect(report.per_cube[0].mapped_face_count).toBeNull();
  expect(report.visual_verdict).toBe("not_evaluated");
});

test("simplify fidelity analysis and safety precede actual native batch Undo",async()=>{
  const source=await Bun.file("server/tools/geometry/cubes.ts").text();
  const start=source.lastIndexOf('if (request.operation === "simplify")');
  const end=source.indexOf("return executeBatchUpdateCubes(request)",start);
  const section=source.slice(start,end);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(section).toContain("analyzeCubeSimplificationFidelity(");
  expect(section).toContain("SIMPLIFY_TEXTURE_MAPPING_REVIEW_REQUIRED");
  expect(section).toContain("simplification_fidelity: fidelity");
  expect(section.indexOf("SIMPLIFY_TEXTURE_MAPPING_REVIEW_REQUIRED"))
    .toBeLessThan(section.indexOf("executeBatchUpdateCubes({ updates })"));
  expect(section).not.toContain("Undo.initEdit(");
});


test("mapped north face ignores Z-only thickness changes, but east face detects them",()=>{
  const cube={
    uuid:"side-detail",name:"side-detail",
    from:[0,0,0],to:[2,2,2],origin:[0,0,0],
    rotation:[0,0,0],inflate:0,box_uv:false,
    uv_faces:[
      {face:"north" as const,texture:"front"},
      {face:"south" as const,texture:false},
      {face:"east" as const,texture:false},
      {face:"west" as const,texture:false},
      {face:"up" as const,texture:false},
      {face:"down" as const,texture:false},
    ],
  };
  const update={id:"side-detail",to:[2,2,3]};
  const north=analyzeCubeSimplificationFidelity([{cube,update}]);
  expect(north.max_physical_extent_scale_ratio).toBe(1.5);
  expect(north.mapped_texture_stretch_risk_count).toBe(0);
  const east=analyzeCubeSimplificationFidelity([{
    cube:{...cube,uv_faces:cube.uv_faces.map((face) =>
      face.face==="north" ? {...face,texture:false} :
      face.face==="east" ? {...face,texture:"side"} : face
    )},
    update,
  }]);
  expect(east.mapped_texture_stretch_risk_count).toBe(1);
});

test("missing or duplicate UV face inventory cannot authorize implicit simplification",()=>{
  const cube={
    uuid:"a",name:"a",from:[0,0,0],to:[2,2,2],
    rotation:[0,0,0],origin:[0,0,0],inflate:0,
  };
  const update={id:"a",to:[3,2,2]};
  const duplicate=analyzeCubeSimplificationFidelity([{
    cube:{...cube,uv_faces:[
      {face:"north" as const,texture:false},
      {face:"north" as const,texture:false},
    ]},
    update,
  }]);
  expect(duplicate.incomplete_face_inventory_count).toBe(1);
  expect(duplicate.per_cube[0].mapped_face_count).toBeNull();
});

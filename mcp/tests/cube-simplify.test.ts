import {describe, expect, test} from "bun:test";
import {cubeToolDocs, planCubeSimplification, simplifyCubesParameters, registerCubesTools} from "@/server/tools/cubes";
import {getAllToolDefinitions} from "@/lib/factories";

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

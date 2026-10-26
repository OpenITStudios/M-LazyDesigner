import { describe, expect, test } from "bun:test";

// Isolate the mutable registration catalog. Only native state and the core
// receipt are fixtures; the production enrichment executors run unchanged.
function probe(source: string) {
  const run = Bun.spawnSync([process.execPath, "-e", source], { cwd: process.cwd() });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  return JSON.parse(run.stdout.toString());
}

describe("optional diagnostic execution", () => {
  test("animation diagnostics honor omitted/false/true without changing the target", () => {
    const results = probe(`
      import {getAllToolDefinitions} from "./lib/factories.ts";
      import {wireAuthoringQualityIntelligence} from "./server/tools/quality-intelligence.ts";
      let reads=0;
      class G {static all=[{uuid:"root",name:"root",parent:"root"}];}
      class B {uuid="root"; name="root";
        position=[{time:0,data_points:[{}],interpolation:"linear",getArray(){reads++;return [0,0,0];}},
          {time:1,data_points:[{}],interpolation:"linear",getArray(){reads++;return [1,0,0];}}]; rotation=[];scale=[];}
      globalThis.Group=G;globalThis.BoneAnimator=B;
      globalThis.AnimationItem={all:[{uuid:"target",loop:"loop",length:1,animators:{root:new B()}}],selected:{uuid:"other"}};
      const defs=getAllToolDefinitions();
      defs.inspect_animation={execute:async()=>({content:[],structuredContent:{authored_space:"blockbench_animation",animation:{uuid:"target"}}})};
      wireAuthoringQualityIntelligence();
      const out=[];
      for(const args of [{},{diagnostics:false},{diagnostics:true}]) {
        const before=reads; const result=await defs.inspect_animation.execute(args);
        out.push({reads:reads-before,bytes:Buffer.byteLength(JSON.stringify(result)),state:result.structuredContent});
      }
      console.log(JSON.stringify(out));
    `);
    for (const result of results.slice(0, 2)) {
      expect(result.reads).toBe(0);
      expect(result.state.animation.uuid).toBe("target");
      expect(result.state).not.toHaveProperty("root_motion");
      expect(result.state).not.toHaveProperty("animation_quality");
    }
    expect(results[2].reads).toBe(6);
    expect(results[2].state.animation_quality.state).toBe("available");
    expect(results[2].state.animation.uuid).toBe("target");
    expect(results[0].bytes).toBeLessThan(results[2].bytes);
    console.log("animation diagnostic cost", JSON.stringify(results.map(({reads, bytes}: {reads:number;bytes:number}) => ({reads,bytes}))));
  });

  test("texture inventory skips pixel enrichments and complete reads stay fresh", () => {
    const results = probe(`
      import {getAllToolDefinitions} from "./lib/factories.ts";
      import {listTexturesParameters} from "./server/tools/texture.ts";
      import {wireAuthoringQualityIntelligence} from "./server/tools/quality-intelligence.ts";
      import {wireTextureAuthoringRuntime} from "./server/tools/texture-authoring-runtime.ts";
      let reads=0, alpha=255;
      const texture={uuid:"atlas",name:"atlas",width:16,height:16,display_height:16,
        getUVWidth:()=>16,getUVHeight:()=>16,ctx:{canvas:{width:16,height:16},
          getImageData:(x,y,w,h)=>{reads++;const data=new Uint8ClampedArray(w*h*4);for(let i=3;i<data.length;i+=4)data[i]=alpha;return {data};}}};
      globalThis.Texture={all:[texture]};globalThis.TextureGroup={all:[]};
      globalThis.Cube={all:[{uuid:"cube",name:"cube",faces:{north:{uv:[0,0,4,4],rotation:0,getTexture:()=>texture}}}]};
      const defs=getAllToolDefinitions();
      defs.list_textures={
        execute:async(args)=>({
          content:[],
          structuredContent:{
            textures:[{uuid:"atlas"}],
            ...(args.diagnostics===true && ["uv","coverage","seam","full"].includes(args.diagnostic_scope ?? "full")
              ? {uv_audit:{state:"available",production_gate:{state:"ready"}}}
              : {})
          }
        })
      };
      for(const name of ["list_materials","get_material_info","manage_material"])
        defs[name]={execute:async()=>({content:[],structuredContent:{textures:[{uuid:"atlas"}]}})};
      wireAuthoringQualityIntelligence();wireTextureAuthoringRuntime();
      const out=[];
      for(const args of [
        {},
        {diagnostics:false},
        {diagnostics:true, diagnostic_scope:"uv"},
        {diagnostics:true, diagnostic_scope:"coverage"},
        {diagnostics:true, diagnostic_scope:"seam"},
        {diagnostics:true, diagnostic_scope:"pbr"},
        {diagnostics:true},
      ]) {
        if(args.diagnostics===true)alpha=0;
        const before=reads; const parsed=listTexturesParameters.parse(args);
        const result=await defs.list_textures.execute(parsed);
        out.push({reads:reads-before,bytes:Buffer.byteLength(JSON.stringify(result)),state:result.structuredContent});
      }
      console.log(JSON.stringify(out));
    `);
    expect(results[0].reads).toBe(0);
    expect(results[0].state.textures).toEqual([{ uuid: "atlas" }]);
    expect(results[0].state).not.toHaveProperty("uv_audit");
    expect(results[0].state).not.toHaveProperty("optimization_opportunities");
    expect(results[0].state).not.toHaveProperty("seam_continuity");
    expect(results[0].state.production_alignment?.pbr_content).toBeUndefined();

    expect(results[1].reads).toBe(0);
    expect(results[1].state).not.toHaveProperty("uv_audit");

    expect(results[2].reads).toBe(0);
    expect(results[2].state).toHaveProperty("uv_audit");
    expect(results[2].state).not.toHaveProperty("optimization_opportunities");
    expect(results[2].state).not.toHaveProperty("seam_continuity");
    expect(results[2].state.production_alignment?.pbr_content).toBeUndefined();

    expect(results[3].reads).toBeGreaterThan(0);
    expect(results[3].state).toHaveProperty("uv_audit");
    expect(results[3].state.optimization_opportunities.coverage.states.transparent).toBe(1);
    expect(results[3].state).not.toHaveProperty("seam_continuity");
    expect(results[3].state.production_alignment?.pbr_content).toBeUndefined();

    expect(results[4].state).toHaveProperty("uv_audit");
    expect(results[4].state).toHaveProperty("seam_continuity");
    expect(results[4].state).not.toHaveProperty("optimization_opportunities");
    expect(results[4].state.production_alignment?.pbr_content).toBeUndefined();

    expect(results[5].state).not.toHaveProperty("uv_audit");
    expect(results[5].state).not.toHaveProperty("optimization_opportunities");
    expect(results[5].state).not.toHaveProperty("seam_continuity");
    expect(results[5].state.production_alignment?.pbr_content).toBeDefined();

    expect(results[6].reads).toBeGreaterThan(0);
    expect(results[6].state).toHaveProperty("uv_audit");
    expect(results[6].state).toHaveProperty("optimization_opportunities");
    expect(results[6].state).toHaveProperty("seam_continuity");
    expect(results[6].state.production_alignment?.pbr_content).toBeDefined();

    expect(results[0].bytes).toBeLessThan(results[6].bytes);
    console.log("texture diagnostic cost", JSON.stringify(results.map(({reads, bytes}: {reads:number;bytes:number}) => ({reads,bytes}))));
  });

  test("registered metadata matches canonical generated ToolSpecs", () => {
    const mismatches = probe(`
      import "./server/server.ts";
      import {toolManifest} from "./scripts/generate/internal/docs-manifest.ts";
      import {getAllToolDefinitions} from "./lib/factories.ts";
      const defs=getAllToolDefinitions();
      console.log(JSON.stringify(toolManifest.flatMap(g=>g.tools).filter(s=>defs[s.name] &&
        (s.description!==defs[s.name].description || s.annotations?.title!==defs[s.name].annotations?.title)).map(s=>s.name)));
    `);
    expect(mismatches).toEqual([]);
  });

  test("registered texture inventory preserves identity without accessing UV geometry or pixels", () => {
    const result = probe(`
      import "./server/server.ts";
      import {getAllToolDefinitions} from "./lib/factories.ts";
      const texture={uuid:"atlas",id:"0",name:"atlas",width:16,height:16,display_height:16,
        getUVWidth:()=>16,getUVHeight:()=>16,get ctx(){throw Error("unexpected pixel access");}};
      globalThis.Project={textures:[texture],texture_width:16,texture_height:16};
      globalThis.Texture={all:[texture],getDefault:()=>texture,selected:texture};
      globalThis.TextureGroup={all:[]};
      globalThis.Cube={get all(){throw Error("unexpected geometry audit");}};
      const definition=getAllToolDefinitions().list_textures;
      const args=definition.parameterSchema.parse({diagnostics:false});
      if(args.diagnostics!==false)throw Error("diagnostics option stripped");
      console.log(JSON.stringify(await definition.execute(args)));
    `);
    expect(result.structuredContent.textures[0].uuid).toBe("atlas");
    expect(result.structuredContent.atlas_state.default_texture_uuid).toBe("atlas");
    expect(result.structuredContent.logical_uv).toEqual({ width: 16, height: 16 });
    expect(result.structuredContent).not.toHaveProperty("uv_audit");
    expect(result.structuredContent).not.toHaveProperty("optimization_opportunities");
    expect(result.structuredContent).not.toHaveProperty("seam_continuity");
  });
});

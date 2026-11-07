import { describe, expect, test } from "bun:test";
import {
  planBedrockEnvironmentVisual,
  type EnvironmentVisualInput,
} from "@/lib/bedrock/environmentVisualPlanning";

function fixture(change:Partial<EnvironmentVisualInput>={}):EnvironmentVisualInput {
  return {
    target_bedrock_version:"1.21.40",
    fog:{identifier:"demo:crystal_fog",file_path:"fogs/crystal_fog.json",
      distance:{
        air:{fog_color:"#3a1f5c",fog_start:0.2,fog_end:1,render_distance_type:"render"},
        water:{fog_color:"#4a2882",fog_start:0,fog_end:0.5,render_distance_type:"render"},
      },
    },
    client_biome:{
      identifier:"demo:crystal_caverns",
      file_path:"biomes_client/crystal_caverns.biome_client.json",
      fog_identifier:"demo:crystal_fog",sky_color:"#506fa7",
      water:{surface_color:"#4a2882",surface_opacity:0.65},
    },
    existing_fogs:[],existing_client_biomes:[],
    command_fog_override_possible:true,
    source_refs:["reference:crystal"],
    ...change,
  };
}
const plan=(input:EnvironmentVisualInput)=>planBedrockEnvironmentVisual(input);
describe("E1 Bedrock fog/client-biome source review",()=>{
  test("uses fog_settings and client_biome fog_appearance without writing files",()=>{
    const source=fixture(),before=structuredClone(source),r=plan(source);
    expect(r.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(r.candidate_fog["minecraft:fog_settings"]).toEqual({
      description:{identifier:"demo:crystal_fog"},
      distance:{
        air:{fog_color:"#3A1F5C",fog_start:0.2,fog_end:1,render_distance_type:"render"},
        water:{fog_color:"#4A2882",fog_start:0,fog_end:0.5,render_distance_type:"render"},
      },
    });
    const b=r.candidate_client_biome["minecraft:client_biome"];
    expect(b.components["minecraft:fog_appearance"]).toEqual({
      fog_identifier:"demo:crystal_fog",
    });
    expect(b.components["minecraft:sky_color"]?.sky_color).toBe("#506FA7");
    expect(b.components["minecraft:water_appearance"]).toMatchObject({
      surface_color:"#4A2882",surface_opacity:0.65,
    });
    expect(r.fog_json_hint).toBe("fogs/crystal_fog.json");
    expect(r.source_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(r.native_verified).toBe(false);
    expect(r.visual_verified).toBe(false);
    expect(r.minecraft_verified).toBe(false);
    expect(r.resource_pack_written).toBe(false);
    expect(r.behavior_pack_written).toBe(false);
    expect(source).toEqual(before);
  });
  test("1.21.40 client biome floor is numeric, never inferred as legacy support",()=>{
    expect(plan(fixture({target_bedrock_version:"1.21.39"})).issues)
      .toContain("CLIENT_BIOME_FORMAT_TOO_OLD");
    expect(plan(fixture({target_bedrock_version:"1.21.100"})).issues).toEqual([]);
    for(const s of ["latest","1.21","1.21.040","1.21.40-preview"]){
      expect(()=>plan(fixture({target_bedrock_version:s})))
        .toThrow("ENVIRONMENT_VERSION_INVALID");
    }
  });
  test("camera modes are explicit, their optional absence is inherited",()=>{
    const r=plan(fixture({fog:{...fixture().fog,distance:{
      weather:{fog_color:"#ffffff",fog_start:10,fog_end:64,
        render_distance_type:"fixed"},
    }}}));
    expect(r.declared_media).toEqual(["weather"]);
    expect(r.warnings).toContain("UNSPECIFIED_FOG_MEDIA_INHERIT_STACK");
    expect(r.candidate_fog["minecraft:fog_settings"].distance.weather)
      .toMatchObject({fog_color:"#FFFFFF",fog_end:64});
    expect(()=>plan(fixture({fog:{...fixture().fog,distance:{}}})))
      .toThrow("ENVIRONMENT_DISTANCE_EMPTY");
    expect(()=>plan(fixture({fog:{...fixture().fog,distance:{
      mist:fixture().fog.distance.air,
    } as unknown as EnvironmentVisualInput["fog"]["distance"]}})))
      .toThrow("ENVIRONMENT_DISTANCE_MEDIA_UNKNOWN");
  });
  test("fog order, finite values, colors, and fixed/render modes cannot be guessed",()=>{
    for(const patch of [
      {fog_start:10,fog_end:9},
      {fog_start:-1,fog_end:2},
      {fog_start:NaN,fog_end:2},
      {fog_start:0,fog_end:Infinity},
    ]){
      expect(()=>plan(fixture({fog:{...fixture().fog,distance:{
        air:{...fixture().fog.distance.air!,...patch},
      }}}))).toThrow();
    }
    expect(()=>plan(fixture({fog:{...fixture().fog,distance:{
      air:{...fixture().fog.distance.air!,fog_color:"white"},
    }}}))).toThrow("ENVIRONMENT_COLOR_INVALID");
    expect(()=>plan(fixture({fog:{...fixture().fog,distance:{
      air:{...fixture().fog.distance.air!,render_distance_type:"wrong" as "fixed"},
    }}}))).toThrow("ENVIRONMENT_DISTANCE_MODE_INVALID");
    expect(plan(fixture({fog:{...fixture().fog,distance:{
      air:{...fixture().fog.distance.air!,fog_start:1,fog_end:1},
    }}})).warnings).toContain("ABRUPT_FOG_TRANSITION_REVIEW");
  });
  test("biome-to-fog identity mismatches fail closed without auto-repair",()=>{
    const r=plan(fixture({client_biome:{...fixture().client_biome,
      fog_identifier:"demo:other_fog",
    }}));
    expect(r.state).toBe("BLOCKED_BY_DECLARED_SOURCE");
    expect(r.issues).toContain("FOG_REFERENCE_MISMATCH");
    expect(r.candidate_client_biome["minecraft:client_biome"]
      .components["minecraft:fog_appearance"].fog_identifier)
      .toBe("demo:other_fog");
  });
  test("existing identifiers/files reject overwrites and ambiguous registry",()=>{
    const r=plan(fixture({
      existing_fogs:[{identifier:"demo:crystal_fog",file_path:"fogs/old.json"}],
      existing_client_biomes:[
        {identifier:"demo:other",file_path:"biomes_client/crystal_caverns.biome_client.json"},
      ],
    }));
    expect(r.issues).toContain("FOG_IDENTIFIER_ALREADY_OWNED");
    expect(r.issues).toContain("BIOME_FILE_ALREADY_OWNED");
    expect(()=>plan(fixture({existing_fogs:[
      {identifier:"demo:old",file_path:"fogs/old.json"},
      {identifier:"demo:old",file_path:"fogs/new.json"},
    ]}))).toThrow("ENVIRONMENT_REGISTRY_AMBIGUOUS");
  });
  test("resource identity and relative path traversal cannot pass",()=>{
    for(const id of ["x","Demo:fog","demo:../fog","demo:a//b"]){
      expect(()=>plan(fixture({fog:{...fixture().fog,identifier:id}})))
        .toThrow("ENVIRONMENT_RESOURCE_ID_INVALID");
    }
    for(const p of ["../fogs/x.json","fogs/../x.json","fogs/x/y.json",
      "/fogs/x.json","fogs/X.json","fogs/name.png"]){
      expect(()=>plan(fixture({fog:{...fixture().fog,file_path:p}})))
        .toThrow("ENVIRONMENT_FILE_PATH_INVALID");
    }
  });
  test("sky/water colors and opacity stay explicit",()=>{
    expect(()=>plan(fixture({client_biome:{...fixture().client_biome,
      sky_color:"#FFF",
    }}))).toThrow("ENVIRONMENT_COLOR_INVALID");
    for(const opacity of [-0.1,1.1,NaN]){
      expect(()=>plan(fixture({client_biome:{...fixture().client_biome,
        water:{surface_color:"#FFFFFF",surface_opacity:opacity},
      }}))).toThrow("ENVIRONMENT_NUMBER_INVALID");
    }
    const r=plan(fixture({client_biome:{...fixture().client_biome,
      sky_color:undefined,water:undefined,
    }}));
    expect(r.candidate_client_biome["minecraft:client_biome"]
      .components["minecraft:sky_color"]).toBeUndefined();
  });
  test("fog stack uncertainty and no-gameplay guarantee remain visible",()=>{
    const r=plan(fixture());
    expect(r.warnings).toContain("PLAYER_COMMAND_OVERRIDE_NOT_NATIVE_VERIFIED");
    expect(r.warnings).toContain("BIOME_FOG_BLEND_NOT_NATIVE_VERIFIED");
    expect(r.warnings).toContain("RENDER_DISTANCE_SETTING_DEPENDENCY");
    expect(r.warnings).toContain("VIBRANT_VISUALS_AND_VOLUMETRIC_NOT_MODELED");
    const noCommand=plan(fixture({command_fog_override_possible:false}));
    expect(noCommand.warnings).not.toContain("PLAYER_COMMAND_OVERRIDE_NOT_NATIVE_VERIFIED");
    expect(noCommand.minecraft_verified).toBe(false);
    expect(()=>plan(fixture({command_fog_override_possible:undefined as unknown as boolean})))
      .toThrow("ENVIRONMENT_COMMAND_STATE_INVALID");
  });
  test("Vanilla biome identifier is not mistaken for new worldgen",()=>{
    const r=plan(fixture({client_biome:{...fixture().client_biome,identifier:"the_end"}}));
    expect(r.issues).toEqual([]);
    expect(r.warnings).toContain("UNNAMESPACED_BIOME_ID_REVIEW");
    const fog=plan(fixture({fog:{...fixture().fog,identifier:"minecraft:fog_default"}}));
    expect(fog.warnings).toContain("VANILLA_NAMESPACE_OVERRIDE_REVIEW");
    expect(fog.issues).toContain("FOG_REFERENCE_MISMATCH");
  });
  test("source fingerprint normalizes unordered registry, tracks colors/version",()=>{
    const a=fixture({source_refs:["approved:a","approved:b"],
      existing_fogs:[
        {identifier:"demo:one",file_path:"fogs/one.json"},
        {identifier:"demo:two",file_path:"fogs/two.json"},
      ]});
    const first=plan(a);
    const reversed=plan({...a,
      source_refs:[...a.source_refs].reverse(),
      existing_fogs:[...a.existing_fogs].reverse(),
      fog:{...a.fog,distance:{water:a.fog.distance.water,air:a.fog.distance.air}},
    });
    expect(reversed.source_fingerprint).toBe(first.source_fingerprint);
    expect(plan({...a,target_bedrock_version:"1.21.41"}).source_fingerprint)
      .not.toBe(first.source_fingerprint);
    expect(plan({...a,client_biome:{...a.client_biome,sky_color:"#000000"}})
      .source_fingerprint).not.toBe(first.source_fingerprint);
  });
  test("E1 module never creates pack files, audio, shader or Gateway tool",async()=>{
    const src=await Bun.file("lib/bedrock/environmentVisualPlanning.ts").text();
    expect(src).toContain('"minecraft:fog_settings"');
    expect(src).toContain('"minecraft:fog_appearance"');
    expect(src).toContain("resource_pack_written:false");
    expect(src).not.toContain("createTool(");
    expect(src).not.toContain("Undo.");
    expect(src).not.toContain("writeFile");
  });
});

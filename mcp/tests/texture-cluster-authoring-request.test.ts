import { describe, expect, test } from "bun:test";
import {
  materializeNativeClusterCompositionInput,
  nativeClusterAuthoringRequestSchema,
} from "@/lib/texture/clusterAuthoringRequest";
import { compileReferencePixelClusterPaint } from "@/lib/texture/clusterComposition";
import { computeTextureRevision } from "@/lib/texture/revision";
import { applyPaintTransactionRgba, paintTransactionParameters } from "@/lib/texture/paintTransaction";
import type { ClusterNativeFace } from "@/lib/texture/clusterComposition";

const SIDES = ["north", "south", "east", "west", "up", "down"] as const;
const atlas = new Uint8ClampedArray(8 * 8 * 4);
const revision = "sha256:8x8:" + "a".repeat(64);
const claim = {
  image_id: "FRONT",
  image_sha256: "b".repeat(64),
  image_region_id: "armor",
  part_id: "chest_plate",
  observation_id: "readable-front-shadows",
};
function userRequest() {
  return {
    texture_id: "current-base-atlas",
    expected_revision: revision,
    source_mode: "transparent_template" as const,
    palette: {
      base: "#956B50", shadow: "#452F26", highlight: "#E1B48C",
      identity: "#D6C13A",
    },
    faces: [{
      cube_uuid: "armorCube",
      face: "north" as const,
      source_claim: claim,
      clusters: [
        { cluster_id:"shadow",role:"shadow" as const,
          source_observation_id:claim.observation_id,
          shape:{kind:"rect" as const,x:0,y:0,width:2,height:2} },
        { cluster_id:"glint",role:"highlight" as const,
          source_observation_id:claim.observation_id,
          shape:{kind:"runs" as const,runs:[
            {x:2,y:2,width:2},{x:3,y:3,width:1},
          ]}},
      ],
      quiet_zones:[{kind:"rect" as const,x:0,y:3,width:2,height:1}],
    }],
  };
}
function nativeFaces(): ClusterNativeFace[] {
  return SIDES.map(face => ({
    cube_uuid:"armorCube", face,
    enabled:face==="north",texture_uuid:face==="north"?"real-uuid":null,
    native_material_name:face==="north"?"iron":"",
    rect:face==="north"?([0,0,4,4] as const):null,
    uv:face==="north"?[0,0,4,4]:null,
    rotation:face==="north"?0:null,
  }));
}
function resolved() {
  return {
    texture_uuid:"real-uuid",
    bitmap:atlas,
    bitmap_width:8,bitmap_height:8,
    logical_uv_width:8,logical_uv_height:8,
    native_faces:nativeFaces(),
  };
}

describe("compact, source-bounded native cluster authoring intent",()=>{
  test("removes raw bitmap/UV/native scene ownership from caller arguments",()=>{
    const authored=nativeClusterAuthoringRequestSchema.parse(userRequest());
    expect(Object.keys(authored).sort()).toEqual([
      "expected_revision","faces","palette","source_mode","texture_id",
    ]);
    const internal=materializeNativeClusterCompositionInput(authored,resolved());
    expect(internal.texture_uuid).toBe("real-uuid");
    expect(internal.bitmap).toBe(atlas);
    expect(internal.native_faces).toHaveLength(6);
    expect(internal.faces[0].clusters).toHaveLength(2);
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...userRequest(),bitmap:new Uint8ClampedArray(256),
    })).toThrow("Unrecognized key");
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...userRequest(),native_faces:nativeFaces(),
    })).toThrow("Unrecognized key");
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...userRequest(),logical_uv_width:8,
    })).toThrow("Unrecognized key");
  });

  test("compact source input is not secretly accepted by the public paint schema",()=>{
    // The owner-generated public ToolSpec remains unchanged until a real
    // generator-capable integration can update its schema and API docs.
    expect(paintTransactionParameters.safeParse(userRequest()).success).toBe(false);
    expect(nativeClusterAuthoringRequestSchema.safeParse(
      userRequest()).success).toBe(true);
  });

  test("source intent compiles to existing exact-pixel transaction without user-supplied native state",async()=>{
    const current=new Uint8ClampedArray(atlas);
    const expected=await computeTextureRevision(current,8,8);
    const raw={...userRequest(),expected_revision:expected};
    const input=materializeNativeClusterCompositionInput(raw,{
      ...resolved(),bitmap:current,
    });
    const compiled=await compileReferencePixelClusterPaint(input);
    expect(compiled.state).toBe("source_compiled_needs_native_revalidation");
    expect(compiled.transaction.texture_id).toBe("real-uuid");
    expect(compiled.transaction.expected_revision).toBe(expected);
    expect(compiled.transaction.operations.map(x=>x.operation)).toEqual([
      "fill_rect","set_pixels","set_pixels",
    ]);
    const preview=applyPaintTransactionRgba(current,8,8,compiled.transaction.operations);
    const rgba=(x:number,y:number)=>[...preview.pixels.slice(
      (y*8+x)*4,(y*8+x)*4+4)];
    expect(rgba(0,0)).toEqual([0x45,0x2f,0x26,255]);
    expect(rgba(2,2)).toEqual([0xe1,0xb4,0x8c,255]);
    expect(rgba(7,7)).toEqual([0,0,0,0]);
    expect(compiled.provenance.mutation_authorized).toBe(false);
    expect(compiled.provenance.visual_verdict).toBe("not_evaluated");
  });

  test("requires known per-pixel RGB preconditions on existing painted corrections",()=>{
    const request=userRequest();
    const patch={...request,source_mode:"existing_painted_patch"};
    expect(()=>nativeClusterAuthoringRequestSchema.parse(patch))
      .toThrow("CLUSTER_PATCH_EXPECTED_SOURCE_COLORS_REQUIRED");
    const patched={
      ...patch,
      faces:request.faces.map(face=>({...face,clusters:face.clusters.map(
        c=>({...c,expected_source_colors:["#956B50"]})
      )})),
    };
    expect(nativeClusterAuthoringRequestSchema.parse(patched)
      .source_mode).toBe("existing_painted_patch");
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...patched,faces:patched.faces.map(face=>({
        ...face,clusters:face.clusters.map(c=>({
          ...c,expected_source_colors:["#956b50","#956B50"],
        }))
      })),
    })).toThrow("CLUSTER_PATCH_EXPECTED_SOURCE_COLORS_REQUIRED");
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...request,faces:patched.faces,
    })).toThrow("CLUSTER_REQUEST_SOURCE_COLORS_NOT_FOR_TEMPLATE");
  });

  test("fails closed on duplicated targets, stale or incomplete observations and missing palette roles",()=>{
    const request=userRequest();
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...request,faces:[request.faces[0],request.faces[0]],
    })).toThrow("CLUSTER_REQUEST_DUPLICATE_FACE");
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...request,expected_revision:"stale",
    })).toThrow();
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...request,faces:[{...request.faces[0],clusters:[{
        ...request.faces[0].clusters[0],
        source_observation_id:"made_up",
      }]}],
    })).toThrow("CLUSTER_REQUEST_OBSERVATION_OR_ID_MISMATCH");
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...request,palette:{base:"#956B50"},
    })).toThrow("CLUSTER_REQUEST_ROLE_PALETTE_MISSING");
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...request,faces:[{...request.faces[0],
        clusters:[request.faces[0].clusters[0],
          {...request.faces[0].clusters[0]}],
      }],
    })).toThrow("CLUSTER_REQUEST_OBSERVATION_OR_ID_MISMATCH");
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...request,faces:[{...request.faces[0],clusters:[{
        ...request.faces[0].clusters[0],
        shape:{kind:"runs",runs:[]},
      }]}],
    })).toThrow();
  });

  test("rejects excessive clusters and untrusted or malformed native snapshots",()=>{
    const source=userRequest();
    const faces=Array.from({length:4},(_,i)=>({
      ...source.faces[0],cube_uuid:"cube"+i,
      clusters:Array.from({length:13},(_,j)=>({
        ...source.faces[0].clusters[0],cluster_id:"cluster"+j,
      })),
    }));
    expect(()=>nativeClusterAuthoringRequestSchema.parse({
      ...source,faces,
    })).toThrow("CLUSTER_REQUEST_TOTAL_CLUSTER_BUDGET");
    expect(()=>materializeNativeClusterCompositionInput(source,{
      ...resolved(),bitmap:new Uint8ClampedArray(15),
    })).toThrow("CLUSTER_REQUEST_NATIVE_SOURCE_UNAVAILABLE");
    expect(()=>materializeNativeClusterCompositionInput(source,{
      ...resolved(),native_faces:[],
    })).toThrow("CLUSTER_REQUEST_NATIVE_SOURCE_UNAVAILABLE");
    expect(()=>materializeNativeClusterCompositionInput(source,{
      ...resolved(),bitmap_width:2_000_000,
    })).toThrow("CLUSTER_REQUEST_NATIVE_SOURCE_UNAVAILABLE");
  });

  test("runtime bridge must materialize its own snapshot and reuse exactly one native executor",async()=>{
    const source=await Bun.file("server/tools/paint/textureTransaction.ts").text();
    expect(source).toContain("export async function executeNativeBoundClusterAuthoringRequest(");
    expect(source).toContain("nativeClusterAuthoringRequestSchema.parse(raw)");
    expect(source).toContain("const current = fullTextureRgba(texture)");
    expect(source).toContain("const scope = captureNativeFaceRecolorScope(");
    expect(source).toContain("materializeNativeClusterCompositionInput(request, {");
    expect(source).toContain("return executeNativeBoundClusterComposition(");
    expect((source.match(/createTool\(/g)??[]).length).toBe(1);
    expect(source).toContain("return executePaintTextureTransaction(args)");
  });
});

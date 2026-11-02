import { describe, expect, test } from "bun:test";
import type { ClusterCompositionInput, ClusterNativeFace } from "@/lib/texture/clusterComposition";
import { runWithMcpStageRequest } from "@/server/runtime/phaseControl";
import { requireCurrentClusterNativeBindings } from "@/lib/texture/clusterNativeBindings";
import {
  captureNativeFaceRecolorScope,
  executeNativeBoundClusterComposition,
  requireCurrentNativeClusterProject,
} from "@/server/tools/paint/textureTransaction";

const SIDES = ["north", "south", "east", "west", "up", "down"] as const;
const TEX = "atlas";

function declaredFaces(id = "armor"): ClusterNativeFace[] {
  return SIDES.map(face => ({
    cube_uuid: id, face,
    enabled: face === "north",
    texture_uuid: face === "north" ? TEX : null,
    native_material_name: face === "north" ? "metal" : "",
    uv: face === "north" ? [4, 0, 0, 4] : null,
    rotation: face === "north" ? 90 : null,
    rect: null,
  }));
}

function input(native_faces: ClusterNativeFace[] = declaredFaces()) {
  const plan = {
    cube_uuid: "armor", face: "north" as const,
    source_claim: {
      image_id: "front", image_sha256: "a".repeat(64),
      image_region_id: "chest", part_id: "armor",
      observation_id: "seen-1",
    },
    clusters: [],
  };
  return {
    texture_uuid: TEX, bitmap_width: 8, bitmap_height: 8,
    logical_uv_width: 8, logical_uv_height: 8,
    native_faces, faces: [plan],
  } satisfies Pick<ClusterCompositionInput,
    "texture_uuid" | "bitmap_width" | "bitmap_height" |
    "logical_uv_width" | "logical_uv_height" | "native_faces" | "faces">;
}

function current(
  native_faces: ClusterNativeFace[] = declaredFaces().map(face => face.enabled
    ? {...face, rect: [0,0,4,4] as const} : face)
) {
  return {
    texture_uuid: TEX, bitmap_width:8, bitmap_height:8,
    logical_uv_width:8, logical_uv_height:8, native_faces,
  };
}


/** Mock only the native project registry; no live texture mutation occurs. */
async function withBoundClusterProject<T>(run: (scope: {
  project: { uuid: string };
  replace: (next: { uuid: string }) => void;
  setOpen: (projects: readonly { uuid: string }[]) => void;
}) => Promise<T>): Promise<T> {
  const globals = globalThis as Record<string, unknown>;
  const keys = ["Project", "ModelProject"];
  const previous = new Map(keys.map(key =>
    [key, Object.getOwnPropertyDescriptor(globals, key)]
  ));
  const project = { uuid: "control-bound-project" };
  const registry = { all: [project] };
  Object.assign(globals, { Project: project, ModelProject: registry });
  try {
    return await runWithMcpStageRequest("texturing", true, () =>
      run({
        project,
        replace(next) {
          registry.all = [next];
          globals.Project = next;
        },
        setOpen(projects) { registry.all = [...projects]; },
      })
    );
  } finally {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else delete globals[key];
    }
  }
}

describe("source-declared clusters are bound to one current native Cube inventory", () => {
  test("complete identical native names/UVs/material/rotations pass as binding equality only", () => {
    const result=requireCurrentClusterNativeBindings(input(),current());
    expect(result).toMatchObject({
      state:"native_bindings_matched", target_face_count:1,
      total_face_slots:6, bitmap_revision_attested:false,
      reference_pixels_attested:false, visual_verdict:"not_evaluated",
    });
  });

  test("material, UV, rotation and texture identity drift all fail closed", () => {
    const base=current();
    const changed={
      material: (f:ClusterNativeFace)=>({...f,native_material_name:"fabric"}),
      uv: (f:ClusterNativeFace)=>({...f,uv:[3,0,0,4]}),
      rotation: (f:ClusterNativeFace)=>({...f,rotation:270}),
      atlas: (f:ClusterNativeFace)=>({...f,texture_uuid:"other"}),
    };
    for(const [reason,mutate] of Object.entries(changed)){
      const altered=base.native_faces.map(f=>f.face==="north"?mutate(f):f);
      expect(()=>requireCurrentClusterNativeBindings(input(),{
        ...base,native_faces:altered,
      }),reason).toThrow("CLUSTER_NATIVE_FACE_BINDING_CHANGED");
    }
    expect(()=>requireCurrentClusterNativeBindings(input(),{
      ...base,logical_uv_width:16,
    })).toThrow("CLUSTER_NATIVE_ATLAS_BINDING_CHANGED");
  });

  test("rejects missing/extra/duplicate face slots and ambiguous selected target", () => {
    const base=current();
    expect(()=>requireCurrentClusterNativeBindings(input(),{
      ...base,native_faces:base.native_faces.slice(0,5),
    })).toThrow("CLUSTER_NATIVE_BINDING_INVENTORY_INVALID");
    expect(()=>requireCurrentClusterNativeBindings(input(),{
      ...base,native_faces:[...base.native_faces,...declaredFaces("extra")],
    })).toThrow("CLUSTER_NATIVE_BINDING_INVENTORY_CHANGED");
    expect(()=>requireCurrentClusterNativeBindings(input(),{
      ...base,native_faces:[base.native_faces[0],base.native_faces[0],
        ...base.native_faces.slice(2)],
    })).toThrow("CLUSTER_NATIVE_BINDING_DUPLICATE");
    const disabled=base.native_faces.map(face=>
      face.face==="north"?{...face,enabled:false,texture_uuid:null,
        uv:null,rotation:null,rect:null}:face);
    expect(()=>requireCurrentClusterNativeBindings(input(disabled),{
      ...base,native_faces:disabled,
    })).toThrow("CLUSTER_NATIVE_TARGET_UNRESOLVED");
  });

  test("untrusted declared snapshots cannot silently omit another Cube face owner",()=>{
    const other=declaredFaces("other");
    expect(()=>requireCurrentClusterNativeBindings(input(),{
      ...current(),native_faces:[...current().native_faces,...other],
    })).toThrow("CLUSTER_NATIVE_BINDING_INVENTORY_CHANGED");
    expect(()=>requireCurrentClusterNativeBindings(
      input([...declaredFaces(),...declaredFaces("other")]),
      current()
    )).toThrow("CLUSTER_NATIVE_BINDING_INVENTORY_CHANGED");
  });

  test("reuses exact live face-scope snapshot and exposes native bound face data",()=>{
    const g=globalThis as Record<string,unknown>;
    const names=["Cube","Texture","Project","Format","Outliner"];
    const descriptors=new Map(names.map(name=>
      [name,Object.getOwnPropertyDescriptor(g,name)]));
    let cube:any;
    class NativeCube {
      static all:NativeCube[]=[];
      uuid="armor";name="Armor";box_uv=false;from=[0,0,0];to=[4,4,4];
      origin=[0,0,0];rotation=[0,0,0];inflate=0;
      mirror_uv=false;visibility=true;
      faces: Record<string,any>={};
      constructor(){
        this.faces=Object.fromEntries(SIDES.map(side=>[
          side,side==="north" ? {
            enabled:true,uv:[4,0,0,4],rotation:90,texture:"atlas",
            material_name:"metal",getTexture:()=>texture,
          }:{
            enabled:false,uv:[0,0,0,0],rotation:0,texture:null,
            material_name:"",getTexture:()=>null,
          }
        ]));
      }
    }
    const texture:any={
      uuid:TEX,width:8,height:8,display_height:8,
      frameCount:1,layers_enabled:false,pbr_channel:"color",
      getUVWidth:()=>8,getUVHeight:()=>8,
    };
    try{
      cube=new NativeCube();
      NativeCube.all=[cube];
      Object.assign(g,{Cube:NativeCube,Texture:{all:[texture]},
        Project:{textures:[texture],box_uv:false},
        Format:{id:"bedrock"},Outliner:{elements:[cube]}});
      const scope=captureNativeFaceRecolorScope(texture,8,8,
        [{cube_uuid:"armor",face:"north"}]);
      expect(scope.target_rect).toEqual({x:0,y:0,width:4,height:4});
      expect(scope.native_faces).toHaveLength(6);
      expect(scope.native_faces.find(f=>f.face==="north"))
        .toMatchObject({enabled:true,texture_uuid:TEX,
          native_material_name:"metal",uv:[4,0,0,4],rotation:90,
          rect:[0,0,4,4]});
      expect(requireCurrentClusterNativeBindings(input(),{
        ...current(),native_faces:scope.native_faces,
      }).state).toBe("native_bindings_matched");
      const fingerprint=scope.native_snapshot;
      cube.faces.north.uv=[0,0,4,4];
      const changed=captureNativeFaceRecolorScope(texture,8,8,
        [{cube_uuid:"armor",face:"north"}]);
      expect(changed.native_snapshot).not.toBe(fingerprint);
      expect(()=>requireCurrentClusterNativeBindings(input(),{
        ...current(),native_faces:changed.native_faces,
      })).toThrow("CLUSTER_NATIVE_FACE_BINDING_CHANGED");
      cube.faces.north.uv=[4,0,0,4];
      cube.faces.north.material_name="fabric";
      const wrongMaterial=captureNativeFaceRecolorScope(texture,8,8,
        [{cube_uuid:"armor",face:"north"}]);
      expect(()=>requireCurrentClusterNativeBindings(input(),{
        ...current(),native_faces:wrongMaterial.native_faces,
      })).toThrow("CLUSTER_NATIVE_FACE_BINDING_CHANGED");
    }finally{
      for (const name of names) {
        const d=descriptors.get(name);
        if(d)Object.defineProperty(g,name,d);
        else delete g[name];
      }
    }
  });

  test("native authoring refuses missing or rejected trusted Reference Package evidence",async()=>{
    await expect(executeNativeBoundClusterComposition(
      {faces:[]} as unknown as ClusterCompositionInput,
      undefined as unknown as (claims:readonly any[])=>Promise<void>,
      "control-bound-project"
    )).rejects.toThrow("CLUSTER_APPROVED_REFERENCE_VERIFIER_REQUIRED");
    await withBoundClusterProject(async () => {
      await expect(executeNativeBoundClusterComposition(
        {faces:[{source_claim:{image_id:"front"}}]} as unknown as ClusterCompositionInput,
        async()=>{throw new Error("REFERENCE_PACKAGE_NOT_APPROVED")},
        "control-bound-project"
      )).rejects.toThrow("REFERENCE_PACKAGE_NOT_APPROVED");
    });
  });

  test("requires bound Control UUID and the effective Texturing request Stage",async()=>{
    await withBoundClusterProject(async ({project}) => {
      expect(requireCurrentNativeClusterProject(project.uuid)).toBe(project);
      expect(()=>requireCurrentNativeClusterProject("foreign-project"))
        .toThrow("CLUSTER_NATIVE_PROJECT_AFFINITY_MISMATCH");
      expect(()=>requireCurrentNativeClusterProject(" "))
        .toThrow("CLUSTER_CONTROL_PROJECT_ID_REQUIRED");
      await runWithMcpStageRequest("geometry", true, async () => {
        expect(()=>requireCurrentNativeClusterProject(project.uuid))
          .toThrow("CLUSTER_NATIVE_TEXTURING_STAGE_REQUIRED");
      });
      expect(requireCurrentNativeClusterProject(project.uuid)).toBe(project);
    });
  });

  test("refuses duplicate same-UUID tabs and an orphan current project",async()=>{
    await withBoundClusterProject(async ({project,replace,setOpen}) => {
      setOpen([project,{uuid:project.uuid}]);
      expect(()=>requireCurrentNativeClusterProject(project.uuid))
        .toThrow("CLUSTER_NATIVE_PROJECT_AFFINITY_MISMATCH");
      setOpen([]);
      expect(()=>requireCurrentNativeClusterProject(project.uuid))
        .toThrow("CLUSTER_NATIVE_PROJECT_AFFINITY_MISMATCH");
      const replacement={uuid:project.uuid};
      replace(replacement);
      expect(requireCurrentNativeClusterProject(project.uuid)).toBe(replacement);
    });
  });

  test("same-UUID tab switch during reference read aborts before a texture mutation",async()=>{
    await withBoundClusterProject(async ({project,replace}) => {
      const claim={
        cube_uuid:"armor", face:"north", source_claim:{
          image_id:"front", image_sha256:"a".repeat(64),
          image_region_id:"chest", part_id:"armor",
          observation_id:"visible-shadow",
        },
      };
      let referenceCalls=0;
      await expect(executeNativeBoundClusterComposition(
        {faces:[claim]} as unknown as ClusterCompositionInput,
        async () => {
          referenceCalls++;
          replace({uuid:project.uuid}); // identical UUID, distinct tab object
        },
        project.uuid
      )).rejects.toThrow("CLUSTER_NATIVE_PROJECT_OBJECT_CHANGED");
      expect(referenceCalls).toBe(1);
    });
  });

  test("single executor retains native guards before/within/after the one-Undo edit",async()=>{
    const src=await Bun.file("server/tools/paint/textureTransaction.ts").text();
    expect(src).toContain("async function executePaintTextureTransaction(");
    expect(src).toContain("async execute(args) {");
    expect(src).toContain("return executePaintTextureTransaction(args);");
    expect(src).toContain("export async function executeNativeBoundClusterComposition(");
    expect(src).toContain("requireCurrentClusterNativeBindings(input, {");
    expect(src).toContain("CLUSTER_APPROVED_REFERENCE_VERIFIER_REQUIRED");
    expect(src).toContain("source_claim: { ...face.source_claim }");
    expect(src).toContain("cube_uuid: face.cube_uuid");
    expect(src).toContain("face: face.face");
    expect((src.match(/await verifyApprovedReference\(claims\)/g)??[]).length).toBe(2);
    expect(src).toContain("() => verifyApprovedReference(claims)");
    const referencePreCommit = src.indexOf("await referencePreCommitGuard?.();");
    const undoFinish = src.indexOf('Undo.finishEdit("Paint texture transaction")');
    expect(referencePreCommit).toBeGreaterThan(0);
    expect(undoFinish).toBeGreaterThan(referencePreCommit);
    expect((src.match(/nativeClusterGuard\?\.\(\)/g)??[]).length).toBe(4);
    expect(src).toContain("Undo.cancelEdit(true)");
    expect(src).not.toContain("registerPaintClusterTool");
  });
});

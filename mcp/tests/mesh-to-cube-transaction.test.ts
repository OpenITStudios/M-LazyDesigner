import {expect,test} from "bun:test";
import {planMeshToCubeTransaction, type MeshToCubeSource} from "@/lib/geometry/meshToCubeTransactionPlan";
import {captureNativeMeshToCubeSource, inspectNativeMeshToCubeTransaction, writePreparedMeshToCubeTransaction} from "@/server/tools/geometry/meshToCubeNativeTransaction";

function exactSource():MeshToCubeSource {
  const vertices={
    a:[0,0,0],b:[2,0,0],c:[2,2,0],d:[0,2,0],
    e:[0,0,2],f:[2,0,2],g:[2,2,2],h:[0,2,2],
  };
  const orders={
    north:["a","d","c","b"],south:["e","f","g","h"],
    west:["a","e","h","d"],east:["b","c","g","f"],
    down:["a","b","f","e"],up:["d","h","g","c"],
  };
  const faces=Object.fromEntries(Object.entries(orders).map(([id,keys])=>[
    id,{
      vertices:keys,
      uv:Object.fromEntries(keys.map((key,i)=>[key,
        [[0,0],[16,0],[16,16],[0,16]][i]])),
      texture:"atlas",material_name:"",
    },
  ]));
  return {
    uuid:"mesh-1",name:"limb",vertices,faces,
    origin:[0,0,0],rotation:[0,0,0],parent_id:"bone",
    shading:"flat",armature_attached:false,
    parent_lineage:[{uuid:"bone",origin:[0,0,0],rotation:[0,0,0],export:true}],
    parent_sibling_index:0,
    project_uuid:"project-alpha",
    project_logical_texture_size:[16,16],
    project_box_uv:false,
    default_texture_metrics:{
      uuid:"atlas",width:16,height:16,display_height:16,
      uv_width:16,uv_height:16,error:0,
    },
    raw_face_vertex_orders:orders,seams:{},
    source_visibility:true,source_export:true,source_locked:false,
    source_selected:false,source_mesh_subselection_active:false,
    source_color:1,source_render_order:null,
    armature_reference:null,animation_reference_count:0,
    format:{
      id:"bedrock",bone_rig:true,single_texture:true,
      uv_rotation:true,default_texture_uuid:"atlas",
    },
  };
}

test("exact Mesh yields six candidate Cube UV faces without executing any conversion",()=>{
  const input=exactSource(),before=JSON.stringify(input);
  const planned=planMeshToCubeTransaction(input);
  expect(planned.state).toBe("candidate_source_only");
  expect(planned.cube).toMatchObject({
    parent_id:"bone",sibling_index:0,
    from:[0,0,0],to:[2,2,2],origin:[0,0,0],
    box_uv:false,autouv:0,
  });
  expect(planned.cube?.faces).toHaveLength(6);
  expect(planned.blocked_reasons).toEqual([]);
  expect(planned.source_revision).toMatch(/^mesh-cube-drift-v1:/);
  expect(planned.mesh_replaced).toBe(false);
  expect(planned.native_export_verified).toBe(false);
  expect(JSON.stringify(input)).toBe(before);
});

test("Mesh local corners add the authored origin when generating native Cube bounds",()=>{
  const source=exactSource();
  const result=planMeshToCubeTransaction({...source,origin:[4,6,-2]});
  expect(result.state).toBe("candidate_source_only");
  expect(result.cube).toMatchObject({
    from:[4,6,-2],to:[6,8,0],origin:[4,6,-2],
  });
});

test("source revision tracks UV, geometry, material, parent bone and environment changes",()=>{
  const x=exactSource();
  const initial=planMeshToCubeTransaction(x).source_revision;
  const variants:MeshToCubeSource[]=[
    {...x,vertices:{...x.vertices,a:[0.1,0,0]}},
    {...x,faces:{...x.faces,north:{...x.faces.north,
      uv:{...x.faces.north.uv,a:[50,20]}}}},
    {...x,faces:{...x.faces,north:{...x.faces.north,material_name:"glass"}}},
    {...x,parent_lineage:[{uuid:"bone",origin:[3,0,0],rotation:[0,0,0],export:true}]},
    {...x,parent_sibling_index:1},
    {...x,format:{...x.format,default_texture_uuid:"other"}},
    {...x,project_uuid:"project-beta"},
    {...x,project_logical_texture_size:[32,16]},
    {...x,default_texture_metrics:{...x.default_texture_metrics!,width:32}},
    {...x,raw_face_vertex_orders:{...x.raw_face_vertex_orders,
      north:[...x.raw_face_vertex_orders.north].reverse()}},
  ];
  for(const variant of variants){
    expect(planMeshToCubeTransaction(variant).source_revision).not.toBe(initial);
  }
  expect(planMeshToCubeTransaction({
    ...x,vertices:Object.fromEntries(Object.entries(x.vertices).reverse()),
    faces:Object.fromEntries(Object.entries(x.faces).reverse()),
  }).source_revision).toBe(initial);
});

test("non-default atlas and unrepresented material/armature/animation are blocked",()=>{
  const x=exactSource();
  for(const candidate of [
    {...x,format:{...x.format,default_texture_uuid:"different"}},
    {...x,faces:{...x.faces,north:{...x.faces.north,material_name:"glass"}}},
    {...x,armature_attached:true},
    {...x,animation_reference_count:1},
    {...x,animation_reference_count:null},
    {...x,parent_lineage:null},
    {...x,source_locked:true},
    {...x,rotation:[15,0,0]},
    {...x,format:{...x.format,id:"generic"}},
  ]){
    const report=planMeshToCubeTransaction(candidate);
    expect(report.state).toBe("blocked");
    expect(report.cube).toBeNull();
  }
});

test("hidden faces map to null texture; no loaded default is not silently accepted",()=>{
  const src=exactSource();
  const noTexture={...src,faces:Object.fromEntries(
    Object.entries(src.faces).map(([id,face])=>[id,
      {...face,texture:id==="north"?null:false}])
  )};
  const planned=planMeshToCubeTransaction(noTexture);
  expect(planned.state).toBe("candidate_source_only");
  expect(planned.cube?.faces.find(f=>f.face==="north")?.texture).toBeNull();
  const missing=planMeshToCubeTransaction({
    ...noTexture,format:{...noTexture.format,default_texture_uuid:null},
  });
  expect(missing.state).toBe("blocked");
  expect(missing.blocked_reasons).toContain("MESH_CUBE_DEFAULT_TEXTURE_MISSING");
});

test("wedge and unsampled UV seam do not become native Cube conversion candidates",()=>{
  const src=exactSource();
  const wedge=planMeshToCubeTransaction({
    ...src,faces:{north:src.faces.north},
  });
  expect(wedge.state).toBe("blocked");
  expect(wedge.blocked_reasons).toContain("MESH_CUBE_EXACT_GEOMETRY_REQUIRED");
  const badUv=planMeshToCubeTransaction({
    ...src,faces:{...src.faces,north:{
      ...src.faces.north,
      uv:{...src.faces.north.uv,a:[15,5]},
    }},
  });
  expect(badUv.state).toBe("blocked");
  expect(badUv.blocked_reasons).toContain("MESH_CUBE_UV_TRANSFER_INCOMPLETE");
});

test("existing model inspection consumes the SAME preflight owner as internal writer",async()=>{
  const body=await Bun.file("server/tools/validation/qualityEvidenceRuntime.ts").text();
  expect(body).toContain("captureNativeMeshToCubeSource(mesh)");
  expect(body).toContain("conversion_transaction_preflight:inspectNativeMeshToCubeTransaction");
  expect(body).toContain('wire("inspect_model_bounds", "surface_integrity"');
  expect(body).not.toContain("writePreparedMeshToCubeTransaction(");
});

test("native writer is unregistered and refuses unsupported context before Undo",()=>{
  const g=globalThis as any;
  const prior={Blockbench:g.Blockbench};
  try{
    g.Blockbench={version:"5.2.1"};
    expect(()=>writePreparedMeshToCubeTransaction({
      mesh:{uuid:"mesh-1"} as any,
      prepared:planMeshToCubeTransaction(exactSource()),
    })).toThrow("MESH_CUBE_NATIVE_CONTEXT_UNVERIFIED");
  }finally{g.Blockbench=prior.Blockbench;}
});


test("oversized and incomplete Mesh sources do not defeat the bounded revision gate",()=>{
  const source=exactSource();
  const large=Object.fromEntries(Array.from({length:513},(_,i)=>[
    "oversize-"+i,[i,0,0],
  ]));
  const result=planMeshToCubeTransaction({...source,vertices:large});
  expect(result).toMatchObject({
    state:"blocked",
    source_revision:null,
    blocked_reasons:["MESH_CUBE_SOURCE_BUDGET_EXCEEDED"],
    cube:null,
  });
  const malformed=planMeshToCubeTransaction({
    ...source,faces:{bad:{vertices:["a","missing","b"]}},
  });
  expect(malformed.state).toBe("blocked");
  expect(malformed.source_revision).toBeNull();
});

test("unserializable native metadata is refused, never trusted as a revision",()=>{
  const source=exactSource();
  const cycle:Record<string,unknown>={};
  cycle.back=cycle;
  const revised=planMeshToCubeTransaction({
    ...source,faces:{...source.faces,north:{
      ...source.faces.north,
      texture:cycle,
    }},
  });
  expect(revised.state).toBe("blocked");
  expect(revised.source_revision).toBeNull();
  expect(revised.blocked_reasons).toContain(
    "MESH_CUBE_SOURCE_REVISION_UNAVAILABLE"
  );
});


test("root Outliner Cubes are not claimed exportable by the Bedrock bone serializer",()=>{
  const source=exactSource();
  const plan=planMeshToCubeTransaction({
    ...source,parent_id:"root",parent_lineage:[],
  });
  expect(plan.state).toBe("blocked");
  expect(plan.blocked_reasons).toContain("MESH_CUBE_EXPORTABLE_BONE_REQUIRED");
  expect(plan.cube).toBeNull();
  expect(plan.bedrock_uv_source_projection).toBeNull();
});

test("selected Mesh or unresolved sub-selection refuses native mutation planning",()=>{
  const source=exactSource();
  for(const changes of [
    {source_selected:true},
    {source_mesh_subselection_active:true},
    {source_mesh_subselection_active:null},
  ]){
    const plan=planMeshToCubeTransaction({...source,...changes});
    expect(plan.blocked_reasons).toContain(
      "MESH_CUBE_SELECTION_RECOVERY_NOT_ATTESTED"
    );
    expect(plan.cube).toBeNull();
  }
  const plan=planMeshToCubeTransaction({...source,source_selected:false});
  expect(plan.state).toBe("candidate_source_only");
});

test("source-only Bedrock UV projection matches the 5.2.2 up/down sign inversion",()=>{
  const source=exactSource();
  const planned=planMeshToCubeTransaction(source);
  expect(planned.state).toBe("candidate_source_only");
  const faces=planned.cube?.faces ?? [];
  const projection=planned.bedrock_uv_source_projection;
  expect(projection).toHaveLength(6);
  const north=faces.find(f=>f.face==="north")!;
  const up=faces.find(f=>f.face==="up")!;
  const projectedNorth=projection!.find(f=>f.face==="north")!;
  const projectedUp=projection!.find(f=>f.face==="up")!;
  expect(projectedNorth.uv).toEqual([north.uv[0],north.uv[1]]);
  expect(projectedNorth.uv_size).toEqual([
    north.uv[2]-north.uv[0],north.uv[3]-north.uv[1],
  ]);
  expect(projectedUp.uv).toEqual([up.uv[2],up.uv[3]]);
  expect(projectedUp.uv_size).toEqual([
    up.uv[0]-up.uv[2],up.uv[1]-up.uv[3],
  ]);
  expect(projection!.every(f=>f.material_instance===null)).toBe(true);
  expect(planned.native_export_verified).toBe(false);
});

test("hidden source face is excluded from projected Bedrock export",()=>{
  const source=exactSource();
  const planned=planMeshToCubeTransaction({
    ...source,faces:{...source.faces,north:{
      ...source.faces.north,texture:null,
    }},
  });
  expect(planned.state).toBe("candidate_source_only");
  expect(planned.cube?.faces.find(f=>f.face==="north")?.texture).toBeNull();
  expect(planned.bedrock_uv_source_projection).toHaveLength(5);
  expect(planned.bedrock_uv_source_projection?.some(f=>f.face==="north"))
    .toBe(false);
});

test("oversized authored Mesh-face UV payload never reaches source fingerprint",()=>{
  const source=exactSource();
  const huge=Object.fromEntries(Array.from({length:900},(_,i)=>[
    "unrelated"+i,[i,0],
  ]));
  const result=planMeshToCubeTransaction({
    ...source,faces:{...source.faces,north:{
      ...source.faces.north,uv:huge,
    }},
  });
  expect(result).toMatchObject({
    state:"blocked",source_revision:null,cube:null,
    blocked_reasons:["MESH_CUBE_SOURCE_BUDGET_EXCEEDED"],
  });
});


test("project UUID, logical UV space and loaded texture metadata are fail-closed",()=>{
  const source=exactSource();
  const cases:Array<{variant:MeshToCubeSource;reason:string}>=[
    {
      variant:{...source,project_uuid:null},
      reason:"MESH_CUBE_PROJECT_IDENTITY_UNVERIFIED",
    },
    {
      variant:{...source,project_logical_texture_size:null},
      reason:"MESH_CUBE_PROJECT_UV_CONTEXT_UNVERIFIED",
    },
    {
      variant:{...source,project_logical_texture_size:[0,16]},
      reason:"MESH_CUBE_PROJECT_UV_CONTEXT_UNVERIFIED",
    },
    {
      variant:{...source,project_box_uv:null},
      reason:"MESH_CUBE_PROJECT_UV_CONTEXT_UNVERIFIED",
    },
    {
      variant:{...source,default_texture_metrics:null},
      reason:"MESH_CUBE_TEXTURE_METRICS_OR_LOAD_UNVERIFIED",
    },
    {
      variant:{
        ...source,
        default_texture_metrics:{...source.default_texture_metrics!,width:0},
      },
      reason:"MESH_CUBE_TEXTURE_METRICS_OR_LOAD_UNVERIFIED",
    },
    {
      variant:{
        ...source,
        default_texture_metrics:{...source.default_texture_metrics!,error:2},
      },
      reason:"MESH_CUBE_TEXTURE_METRICS_OR_LOAD_UNVERIFIED",
    },
  ];
  for(const {variant,reason} of cases){
    const result=planMeshToCubeTransaction(variant);
    expect(result.state).toBe("blocked");
    expect(result.cube).toBeNull();
    expect(result.blocked_reasons).toContain(reason);
  }
  const initial=planMeshToCubeTransaction(source);
  const resized=planMeshToCubeTransaction({
    ...source,
    default_texture_metrics:{...source.default_texture_metrics!,uv_width:32},
  });
  expect(initial.state).toBe("candidate_source_only");
  expect(resized.state).toBe("candidate_source_only");
  expect(resized.source_revision).not.toBe(initial.source_revision);
});

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
    parent_sibling_index:0,raw_face_vertex_orders:orders,seams:{},
    source_visibility:true,source_export:true,source_locked:false,
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

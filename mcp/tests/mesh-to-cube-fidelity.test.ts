import { describe, expect, test } from "bun:test";
import {
  analyzeMeshToCubeFidelity,
  summarizeMeshToCubeFidelity,
  MESH_TO_CUBE_VERTEX_LIMIT,
} from "@/lib/geometry/meshToCubeFidelity";

function box() {
  const vertices={
    a:[0,0,0],b:[2,0,0],c:[2,2,0],d:[0,2,0],
    e:[0,0,2],f:[2,0,2],g:[2,2,2],h:[0,2,2],
  };
  const mapping={
    north:["a","d","c","b"],
    south:["e","f","g","h"],
    west:["a","e","h","d"],
    east:["b","c","g","f"],
    down:["a","b","f","e"],
    up:["d","h","g","c"],
  };
  const faces=Object.fromEntries(Object.entries(mapping).map(([key,points])=>[
    key,{
      vertices:points,
      uv:Object.fromEntries(points.map((id,index)=>[
        id,[[0,0],[16,0],[16,16],[0,16]][index]
      ])),
      texture:"atlas",
      material_name:"body",
    },
  ]));
  return {
    uuid:"box-mesh",name:"box-mesh",
    vertices,faces,
    origin:[0,0,0],rotation:[0,0,0],
    parent_id:"bone-body",shading:"flat",
    armature_attached:false,
  };
}

describe("read-only Mesh-to-Cube fidelity analyzer",()=>{
  test("six outward-facing rectangular quads are exact geometry candidates, not export proof",()=>{
    const mesh=box(),before=JSON.stringify(mesh);
    const result=analyzeMeshToCubeFidelity(mesh);
    expect(result).toMatchObject({
      shape_classification:"exact_geometry_candidate",
      geometry_surface_exact_candidate:true,
      vertex_count:8,face_count:6,
      surface_boundary_alignment_ratio:1,
      non_boundary_triangle_area_fraction:0,
      rectangular_uv_side_count:6,
      mapped_source_face_count:6,
      native_cube_ready:false,
      native_conversion_executed:false,
      native_cube_export_verified:false,
      visual_verdict:"not_evaluated",
      local_candidate_box:{
        from:[0,0,0],to:[2,2,2],parent_id:"bone-body",
        bounds_are_mesh_local_only:true,
      },
    });
    expect(result.estimated_volume_loss).toBeNull();
    expect(JSON.stringify(mesh)).toBe(before);
  });

  test("twelve triangles partitioning each box rectangle remain exact shape candidates",()=>{
    const mesh=box();
    const tris=Object.fromEntries(Object.entries(mesh.faces).flatMap(([key,face])=>{
      const v=face.vertices;
      return [
        [key+"_0",{...face,vertices:[v[0],v[1],v[2]]}],
        [key+"_1",{...face,vertices:[v[0],v[2],v[3]]}],
      ];
    }));
    const result=analyzeMeshToCubeFidelity({...mesh,faces:tris});
    expect(result.shape_classification).toBe("exact_geometry_candidate");
    expect(result.face_count).toBe(12);
    expect(result.rectangular_uv_side_count).toBe(6);
    expect(result.fragmented_material_side_count).toBe(0);
    expect(result.geometry_surface_exact_candidate).toBe(true);
  });

  test("wedge is an approximation with quantified non-boundary surface, not invented volume loss",()=>{
    const mesh=box();
    const wedge={
      ...mesh,
      vertices:{
        a:[0,0,0],b:[2,0,0],c:[0,2,0],d:[0,0,2],
      },
      faces:{
        base:{vertices:["a","c","b"],texture:false},
        side:{vertices:["a","b","d"],texture:false},
        back:{vertices:["a","d","c"],texture:false},
        diagonal:{vertices:["b","c","d"],texture:false},
      },
    };
    const r=analyzeMeshToCubeFidelity(wedge);
    expect(r).toMatchObject({
      shape_classification:"box_approximation_required",
      geometry_surface_exact_candidate:false,
      estimated_volume_loss:null,
      native_cube_ready:false,
    });
    expect(r.surface_boundary_alignment_ratio).toBeLessThan(1);
    expect(r.non_boundary_triangle_area_fraction).toBeGreaterThan(0);
    expect(r.non_boundary_triangle_area_fraction).toBeLessThan(1);
  });

  test("incorrect winding and smooth shading never silently certify native surface parity",()=>{
    const mesh=box();
    const reversed={...mesh.faces,
      north:{...mesh.faces.north,vertices:[...mesh.faces.north.vertices].reverse()},
    };
    const wrong=analyzeMeshToCubeFidelity({...mesh,faces:reversed,shading:"smooth"});
    expect(wrong.geometry_surface_exact_candidate).toBe(true);
    expect(wrong.shape_classification).toBe("exact_shape_requires_review");
    expect(wrong.reasons).toContain("MESH_FACE_WINDING_REQUIRES_REVIEW");
    expect(wrong.reasons).toContain("MESH_SHADING_NOT_CUBE_FLAT");
    expect(wrong.native_cube_ready).toBe(false);
  });

  test("triangulated side UV seams and differing material cannot be represented by one implicit Cube face",()=>{
    const mesh=box(),v=mesh.faces.north.vertices;
    const faces={...mesh.faces};
    delete (faces as Record<string,unknown>).north;
    const uv=mesh.faces.north.uv;
    (faces as Record<string,unknown>).tri1={
      vertices:[v[0],v[1],v[2]],
      uv,texture:"atlas-1",material_name:"front",
    };
    (faces as Record<string,unknown>).tri2={
      vertices:[v[0],v[2],v[3]],
      uv,texture:"atlas-2",material_name:"front",
    };
    const r=analyzeMeshToCubeFidelity({...mesh,faces});
    expect(r.geometry_surface_exact_candidate).toBe(true);
    expect(r.fragmented_material_side_count).toBe(1);
    expect(r.rectangular_uv_side_count).toBe(5);
    expect(r.reasons).toContain("MESH_TRIANGULATED_FACE_MATERIAL_SPLIT");
    expect(r.uv_fidelity).toBe("requires_native_face_mapping_review");
  });

  test("invalid face references, bad input and complex meshes fail closed",()=>{
    const mesh=box();
    expect(analyzeMeshToCubeFidelity({
      ...mesh,faces:{bad:{vertices:["a","bad","b"]}},
    }).state).toBe("unverified");
    expect(analyzeMeshToCubeFidelity({
      ...mesh,faces:{bad:{vertices:["a","b","c","d","e"]}},
    }).shape_classification).toBe("not_evaluable");
    expect(analyzeMeshToCubeFidelity({
      ...mesh,vertices:{...mesh.vertices,a:[NaN,0,0]},
    }).state).toBe("unverified");
    const excessive=Object.fromEntries(Array.from(
      {length:MESH_TO_CUBE_VERTEX_LIMIT+1},
      (_,i)=>["v"+i,[i,0,0]]
    ));
    expect(analyzeMeshToCubeFidelity({
      ...mesh,vertices:excessive,
    }).state).toBe("unverified");
  });

  test("rig and unknown parent require review, and source order does not alter shape conclusion",()=>{
    const mesh=box();
    const rigged=analyzeMeshToCubeFidelity({
      ...mesh,armature_attached:true,parent_id:null,
    });
    expect(rigged.reasons).toContain("MESH_RIG_TRANSFER_UNVERIFIED");
    expect(rigged.reasons).toContain("MESH_PARENT_TRANSFORM_UNRESOLVED");
    expect(rigged.native_cube_ready).toBe(false);
    const reordered=analyzeMeshToCubeFidelity({
      ...mesh,
      vertices:Object.fromEntries(Object.entries(mesh.vertices).reverse()),
      faces:Object.fromEntries(Object.entries(mesh.faces).reverse()),
    });
    expect(reordered.shape_classification)
      .toBe(analyzeMeshToCubeFidelity(mesh).shape_classification);
    expect(reordered.six_side_coverage)
      .toEqual(analyzeMeshToCubeFidelity(mesh).six_side_coverage);
  });

  test("bounded multi-mesh summary never silently asserts uninspected meshes are exact",()=>{
    const mesh=box(),report=summarizeMeshToCubeFidelity([mesh],{
      total_visible_mesh_count:3,
    });
    expect(report).toMatchObject({
      state:"partial",inspected_mesh_count:1,visible_mesh_count:3,
      uninspected_mesh_count:2,exact_shape_candidate_count:1,
      visual_verdict:"not_evaluated",
    });
    expect(()=>summarizeMeshToCubeFidelity([mesh],{
      total_visible_mesh_count:0,
    })).toThrow("MESH_TO_CUBE_MISSING_SOURCE_COUNT");
  });

  test("geometry diagnostics reuse existing bounds/surface pipeline without new public tools",async()=>{
    const source=await Bun.file("server/tools/validation/qualityEvidenceRuntime.ts").text();
    const begin=source.indexOf("function geometrySurfaceRuntime()");
    const end=source.indexOf("function uvPhysicalRuntime()",begin);
    const runtime=source.slice(begin,end);
    expect(runtime).toContain("mesh_to_cube_fidelity: nativeMeshToCubeFidelity()");
    expect(source).toContain('wire("inspect_model_bounds", "surface_integrity"');
    expect(runtime).not.toContain("Undo.initEdit");
    expect(runtime).not.toContain("Timeline.time =");
  });
});

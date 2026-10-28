/**
 * Read-only Minecraft Cube approximation evidence for a Blockbench Mesh.
 * Works entirely on authored local vertices/faces. It never mutates Mesh,
 * instantiates Cube, evaluates animation, samples pixels, or certifies export.
 */
import {
  planCubeFaceUvFromMeshCorners,
  type CubeSide,
  type CubeUvCorner,
} from "./meshToCubeUvPlan";

export const MESH_TO_CUBE_ANALYSIS_LIMIT = 16;
export const MESH_TO_CUBE_VERTEX_LIMIT = 512;
export const MESH_TO_CUBE_FACE_LIMIT = 512;
export const MESH_TO_CUBE_EXAMPLE_LIMIT = 8;
const GEOMETRY_EPSILON = 1e-7;
const AXIS_NAMES = ["x", "y", "z"] as const;
const SIDES = ["west", "east", "down", "up", "north", "south"] as const;
type Side = (typeof SIDES)[number];
type Vec3 = readonly [number, number, number];
type Vec2 = readonly [number, number];

export type MeshToCubeFace = Readonly<{
  vertices: readonly string[];
  uv?: Readonly<Record<string, readonly number[]>>;
  texture?: unknown;
  material_name?: string;
}>;

export type MeshToCubeInput = Readonly<{
  uuid: string;
  name: string;
  vertices: Readonly<Record<string, readonly number[]>>;
  faces: Readonly<Record<string, MeshToCubeFace>>;
  origin: readonly number[];
  rotation: readonly number[];
  parent_id: string | null;
  shading: string;
  armature_attached: boolean | null;
}>;

function finite3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part));
}
function finite2(value: unknown): value is Vec2 {
  return Array.isArray(value) && value.length === 2 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part));
}
function roughly(a: number, b: number): boolean {
  return Math.abs(a-b) <= GEOMETRY_EPSILON;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1]*b[2]-a[2]*b[1],
    a[2]*b[0]-a[0]*b[2],
    a[0]*b[1]-a[1]*b[0],
  ];
}
function minus(a: Vec3,b: Vec3): Vec3 {
  return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
}
function triangleArea(a:Vec3,b:Vec3,c:Vec3):number {
  return Math.hypot(...cross(minus(b,a),minus(c,a)))/2;
}
const SIDE_AXIS: Readonly<Record<Side,{axis:number;sign:-1|1}>> = {
  west:{axis:0,sign:-1},east:{axis:0,sign:1},
  down:{axis:1,sign:-1},up:{axis:1,sign:1},
  north:{axis:2,sign:-1},south:{axis:2,sign:1},
};
const FACE_DIRECTIONS: Readonly<Record<Side,readonly [number,number]>> = {
  west:[1,2],east:[1,2],down:[0,2],up:[0,2],
  north:[0,1],south:[0,1],
};

function boxCornerKey(
  point:Vec3,min:Vec3,max:Vec3
):string|null {
  const bits:number[]=[];
  for(let axis=0;axis<3;axis++){
    if(roughly(point[axis],min[axis]))bits.push(0);
    else if(roughly(point[axis],max[axis]))bits.push(1);
    else return null;
  }
  return bits.join("");
}

function sideForFace(points:readonly Vec3[],min:Vec3,max:Vec3):Side|null {
  const matching=SIDES.filter(side=>{
    const {axis,sign}=SIDE_AXIS[side];
    const value=sign===-1?min[axis]:max[axis];
    return points.every(p=>roughly(p[axis],value));
  });
  return matching.length===1?matching[0]:null;
}

type FaceMeasure = {
  key:string;
  keys:readonly string[];
  side:Side|null;
  area:number;
  normal_sign:number;
  uv:Readonly<Record<string,readonly number[]>>|undefined;
  texture:unknown;
  material_name:string|undefined;
};

function materialIdentity(face:FaceMeasure):string {
  const tex=typeof face.texture==="string"?"texture:"+face.texture:
    face.texture===false?"none":face.texture==null?"unresolved":"object_or_unknown";
  return tex+"|material:"+(face.material_name??"");
}

function rectangularFaceUvs(faces:readonly FaceMeasure[], keys:readonly string[]):boolean {
  const map=new Map<string,Vec2>();
  for(const face of faces){
    if(!face.uv) return false;
    for(const key of face.keys){
      const value=face.uv[key];
      if(!finite2(value))return false;
      const old=map.get(key);
      if(old && (!roughly(old[0],value[0]) || !roughly(old[1],value[1])))return false;
      map.set(key,value);
    }
  }
  if(map.size!==4 || keys.some(key=>!map.has(key)))return false;
  const arr=[...map.values()];
  const minU=Math.min(...arr.map(v=>v[0])),maxU=Math.max(...arr.map(v=>v[0]));
  const minV=Math.min(...arr.map(v=>v[1])),maxV=Math.max(...arr.map(v=>v[1]));
  if(maxU-minU<=GEOMETRY_EPSILON || maxV-minV<=GEOMETRY_EPSILON)return false;
  const used=new Set<string>();
  for(const v of arr){
    const u=roughly(v[0],minU)?0:roughly(v[0],maxU)?1:-1;
    const w=roughly(v[1],minV)?0:roughly(v[1],maxV)?1:-1;
    if(u<0 || w<0)return false;
    used.add(""+u+w);
  }
  return used.size===4;
}

function sideIsComplete(
  faces:readonly FaceMeasure[],side:Side,
  vertices:Readonly<Record<string,Vec3>>,min:Vec3,max:Vec3
):boolean {
  const coverage=new Set<string>();
  for(const face of faces){
    for(const key of face.keys){
      const corner=boxCornerKey(vertices[key],min,max);
      if(!corner)return false;
      coverage.add(corner);
    }
  }
  const {axis,sign}=SIDE_AXIS[side];
  const wanted=sign===-1?"0":"1";
  const correct=[...coverage].filter(code=>code[axis]===wanted);
  if(correct.length!==4 || coverage.size!==4)return false;
  if(faces.length===1)return faces[0].keys.length===4;
  if(faces.length!==2 || faces.some(face=>face.keys.length!==3))return false;
  const shared=faces[0].keys.filter(key=>faces[1].keys.includes(key));
  if(shared.length!==2)return false;
  // Each pair of triangles must use the RECTANGLE diagonal, not an edge.
  const [u,v]=FACE_DIRECTIONS[side];
  const a=boxCornerKey(vertices[shared[0]],min,max)!;
  const b=boxCornerKey(vertices[shared[1]],min,max)!;
  return a[u]!==b[u] && a[v]!==b[v];
}



/**
 * Derive all six *potential* native Cube-face UV/material assignments from
 * the already verified eight-corner/six-side Mesh geometry. No mutation and
 * no claim that current textures or Bedrock material instances are saved.
 */
function buildMeshCubeFaceTransfer(input: {
  sides:Readonly<Record<Side,readonly FaceMeasure[]>>;
  points:Readonly<Record<string,Vec3>>;
  from:Vec3;
  to:Vec3;
}) {
  const faces=SIDES.map(side=>{
    const parts=input.sides[side];
    const sourceKeys=parts.map(p=>p.key);
    const materialVariants=new Set(parts.map(materialIdentity));
    const materialSplit=materialVariants.size!==1;
    const sourceTexture=parts[0]?.texture;
    const textureBinding=parts.every(p=>p.texture===sourceTexture) ?
      sourceTexture===false?"single_texture_default" as const :
      sourceTexture===null?"hidden_face" as const :
      typeof sourceTexture==="string"?"explicit_texture_uuid" as const :
      "unresolved" as const : "split" as const;
    const materialName=parts[0]?.material_name ?? "";
    const corners=new Map<string,{position:Vec3;uv:readonly number[]}>();
    let uvConflict=false;
    for(const part of parts){
      for(const id of part.keys){
        const uv=part.uv?.[id];
        if(!uv){uvConflict=true;continue;}
        const prior=corners.get(id);
        if(prior && (uv.length!==2 || prior.uv.length!==2 ||
          uv.some((x,index)=>Math.abs(x-prior.uv[index])>GEOMETRY_EPSILON))){
          uvConflict=true;
        }else if(!prior){
          corners.set(id,{position:input.points[id],uv});
        }
      }
    }
    const prepared=uvConflict ? {
      state:"blocked" as const,reason:"MESH_TRIANGULATED_UV_SEAM" as const,
      native_export_verified:false as const,
    } : planCubeFaceUvFromMeshCorners({
      face:side,from:input.from,to:input.to,
      corners:[...corners.values()] as readonly CubeUvCorner[],
    });
    const reasons:string[]=[];
    if(materialSplit)reasons.push("MESH_FACE_MATERIAL_OR_TEXTURE_SPLIT");
    if(textureBinding==="unresolved")reasons.push("MESH_FACE_TEXTURE_BINDING_UNRESOLVED");
    if(textureBinding==="split")reasons.push("MESH_FACE_TEXTURE_BINDING_SPLIT");
    if(prepared.state==="blocked")reasons.push(prepared.reason);
    return {
      face:side,
      source_mesh_face_keys:sourceKeys,
      texture_binding:textureBinding,
      texture_uuid:typeof sourceTexture==="string"?sourceTexture:null,
      material_name:materialSplit?null:materialName,
      uv_rect:prepared.state==="representable"?prepared.uv:null,
      uv_rotation:prepared.state==="representable"?prepared.rotation:null,
      uv_mirrored_u:prepared.state==="representable"?prepared.uv_mirrored_u:null,
      uv_mirrored_v:prepared.state==="representable"?prepared.uv_mirrored_v:null,
      max_corner_uv_error:prepared.state==="representable"?
        prepared.max_corner_uv_error:null,
      state:reasons.length?"review_required" as const:"candidate_source_only" as const,
      reasons,
    };
  });
  return {
    state:faces.every(face=>face.state==="candidate_source_only")?
      "all_faces_candidate_source_only" as const:"review_required" as const,
    proposed_cube_uv_mode:"per_face" as const,
    face_count:6,
    representable_uv_face_count:faces.filter(face=>face.uv_rect!==null).length,
    reviewed_face_count:faces.filter(face=>face.state==="review_required").length,
    texture_binding_unresolved_count:faces.filter(face=>
      face.texture_binding==="unresolved" || face.texture_binding==="split"
    ).length,
    material_split_face_count:faces.filter(face=>
      face.reasons.includes("MESH_FACE_MATERIAL_OR_TEXTURE_SPLIT")
    ).length,
    faces,
    native_cube_ready:false as const,
    native_material_transfer_executed:false as const,
    native_texture_transfer_executed:false as const,
    note:"Six candidate Cube-face UV rectangles and rotation values are " +
      "mathematically matched to Mesh UV corners under the Blockbench " +
      "CubeFace convention. No texture assets, material instances, rig, " +
      "world pose, atlas pixels, normal direction or Bedrock export verified.",
  };
}

export function analyzeMeshToCubeFidelity(mesh:MeshToCubeInput) {
  const shared={
    mesh_uuid:mesh?.uuid??null,
    mesh_name:mesh?.name??null,
    coordinate_scope:"mesh_authored_local_only" as const,
    native_conversion_executed:false as const,
    native_cube_export_verified:false as const,
    visual_verdict:"not_evaluated" as const,
  };
  const unverified=(reason:string,vertexCount=0,faceCount=0)=>({
    ...shared,state:"unverified" as const,
    reasons:[reason],
    vertex_count:vertexCount,face_count:faceCount,
    shape_classification:"not_evaluable" as const,
    local_candidate_box:null,
    surface_boundary_alignment_ratio:null,
    non_boundary_triangle_area_fraction:null,
    native_cube_ready:false as const,
    cube_face_transfer:{
      state:"not_evaluable" as const,
      reason:"MESH_SOURCE_NOT_VERIFIED" as const,
      faces:[],
      native_cube_ready:false as const,
    },
    uv_fidelity:"not_verified" as const,
    note:"Malformed or over-budget Mesh cannot support a Cube fidelity claim. No model was changed.",
  });
  if(!mesh || typeof mesh.uuid!=="string" || !mesh.uuid.trim() ||
     !mesh.vertices || typeof mesh.vertices!=="object" ||
     Array.isArray(mesh.vertices) || !mesh.faces ||
     typeof mesh.faces!=="object" || Array.isArray(mesh.faces)){
    return unverified("MESH_NATIVE_INVENTORY_INVALID");
  }
  const vertexKeys=Object.keys(mesh.vertices).sort();
  const faceKeys=Object.keys(mesh.faces).sort();
  if(vertexKeys.length===0 || faceKeys.length===0 ||
    vertexKeys.length>MESH_TO_CUBE_VERTEX_LIMIT ||
    faceKeys.length>MESH_TO_CUBE_FACE_LIMIT){
    return unverified("MESH_TO_CUBE_COMPLEXITY_OR_EMPTY",
      vertexKeys.length,faceKeys.length);
  }
  if(!finite3(mesh.origin) || !finite3(mesh.rotation) ||
    vertexKeys.some(key=>!finite3(mesh.vertices[key]))){
    return unverified("MESH_TRANSFORM_OR_VERTEX_INVALID",
      vertexKeys.length,faceKeys.length);
  }
  const points=Object.fromEntries(vertexKeys.map(key=>[
    key,mesh.vertices[key] as Vec3
  ])) as Record<string,Vec3>;
  const min=[0,1,2].map(axis=>Math.min(...vertexKeys.map(key=>points[key][axis]))) as unknown as Vec3;
  const max=[0,1,2].map(axis=>Math.max(...vertexKeys.map(key=>points[key][axis]))) as unknown as Vec3;
  const sizes=[0,1,2].map(axis=>max[axis]-min[axis]);
  if(sizes.some(size=>!Number.isFinite(size) || size<=GEOMETRY_EPSILON)){
    return unverified("MESH_DEGENERATE_OR_NONFINITE_BOUNDS",
      vertexKeys.length,faceKeys.length);
  }
  const measured:FaceMeasure[]=[];
  let totalArea=0,alignedArea=0,normalMismatches=0;
  for(const faceKey of faceKeys){
    const face=mesh.faces[faceKey];
    if(!face || !Array.isArray(face.vertices) ||
      (face.vertices.length!==3 && face.vertices.length!==4) ||
      new Set(face.vertices).size!==face.vertices.length ||
      face.vertices.some(key=>typeof key!=="string" || !points[key])){
      return unverified("MESH_FACE_TOPOLOGY_UNSUPPORTED",
        vertexKeys.length,faceKeys.length);
    }
    const positions=face.vertices.map(key=>points[key]);
    let area=triangleArea(positions[0],positions[1],positions[2]);
    if(positions.length===4) area+=triangleArea(positions[0],positions[2],positions[3]);
    if(!Number.isFinite(area) || area<=GEOMETRY_EPSILON){
      return unverified("MESH_FACE_AREA_INVALID",vertexKeys.length,faceKeys.length);
    }
    totalArea+=area;
    const side=sideForFace(positions,min,max);
    let normalSign=0;
    if(side){
      alignedArea+=area;
      const normal=cross(minus(positions[1],positions[0]),
                         minus(positions[2],positions[0]));
      const {axis,sign}=SIDE_AXIS[side];
      normalSign=normal[axis]*sign;
      if(normalSign<=GEOMETRY_EPSILON)normalMismatches++;
    }
    measured.push({
      key:faceKey,keys:face.vertices,side,area,normal_sign:normalSign,
      uv:face.uv,texture:face.texture,material_name:face.material_name,
    });
  }
  if(!Number.isFinite(totalArea) || totalArea<=0){
    return unverified("MESH_FACE_TOTAL_AREA_INVALID",vertexKeys.length,faceKeys.length);
  }
  const sides=Object.fromEntries(SIDES.map(side=>[
    side,measured.filter(face=>face.side===side)
  ])) as Record<Side,FaceMeasure[]>;
  const sideCoverage=SIDES.map(side=>({
    side,
    source_face_count:sides[side].length,
    full_rectangle:sideIsComplete(sides[side],side,points,min,max),
  }));
  const corners=new Set(vertexKeys.map(key=>boxCornerKey(points[key],min,max)));
  const allCorners=vertexKeys.length===8 && corners.size===8 && !corners.has(null);
  const shapeExact=allCorners && measured.every(face=>face.side!==null) &&
    sideCoverage.every(face=>face.full_rectangle) &&
    measured.length>=6 && measured.length<=12;
  const mappedFaceCount=measured.filter(face=>typeof face.texture==="string").length;
  const unknownTextureFaceCount=measured.filter(face=>
    face.texture===undefined || face.texture===null ||
    (face.texture!==false && typeof face.texture!=="string")
  ).length;
  const uvSides=SIDES.map(side=>{
    const parts=sides[side];
    const keys=[...new Set(parts.flatMap(part=>part.keys))];
    const textures=new Set(parts.map(materialIdentity));
    const split=parts.length>1 && textures.size>1;
    return {
      side,
      source_face_count:parts.length,
      uv_rectangular_candidate:shapeExact &&
        !split && rectangularFaceUvs(parts,keys),
      material_or_texture_split:split,
    };
  });
  const uvRectSides=uvSides.filter(face=>face.uv_rectangular_candidate).length;
  const splitSides=uvSides.filter(face=>face.material_or_texture_split).length;
  const cubeFaceTransfer=shapeExact?buildMeshCubeFaceTransfer({
    sides,points,from:min,to:max,
  }):{
    state:"not_evaluable" as const,
    reason:"MESH_SHAPE_REQUIRES_APPROXIMATION" as const,
    faces:[],
    native_cube_ready:false as const,
  };
  const reasons:string[]=[];
  if(!shapeExact)reasons.push("BBOX_APPROXIMATION_CHANGES_SURFACE");
  if(shapeExact && normalMismatches>0)reasons.push("MESH_FACE_WINDING_REQUIRES_REVIEW");
  if(mesh.shading!=="flat")reasons.push("MESH_SHADING_NOT_CUBE_FLAT");
  if(mesh.armature_attached!==false)reasons.push("MESH_RIG_TRANSFER_UNVERIFIED");
  if(!mesh.parent_id)reasons.push("MESH_PARENT_TRANSFORM_UNRESOLVED");
  if(unknownTextureFaceCount>0)reasons.push("MESH_FACE_TEXTURE_IDENTITY_UNVERIFIED");
  if(mappedFaceCount>0 && uvRectSides!==6)reasons.push("MESH_FACE_UV_NOT_FULLY_RECTANGULAR");
  if(splitSides>0)reasons.push("MESH_TRIANGULATED_FACE_MATERIAL_SPLIT");
  if(shapeExact && cubeFaceTransfer.state==="review_required"){
    reasons.push("MESH_TO_CUBE_FACE_TRANSFER_REVIEW_REQUIRED");
  }
  const classification=shapeExact ?
    (reasons.some(reason=>reason!=="MESH_FACE_UV_NOT_FULLY_RECTANGULAR") ?
       "exact_shape_requires_review" as const : "exact_geometry_candidate" as const) :
    "box_approximation_required" as const;
  const alignment=Math.max(0,Math.min(1,alignedArea/totalArea));
  return {
    ...shared,
    state:reasons.length?"review_required" as const:"candidate_source_only" as const,
    shape_classification:classification,
    reasons,
    vertex_count:vertexKeys.length,
    face_count:faceKeys.length,
    local_candidate_box:{
      from:[...min],to:[...max],
      origin:[...mesh.origin],rotation:[...mesh.rotation],
      parent_id:mesh.parent_id,
      bounds_are_mesh_local_only:true as const,
    },
    geometry_surface_exact_candidate:shapeExact,
    six_side_coverage:sideCoverage,
    outward_winding_mismatch_face_count:normalMismatches,
    triangle_surface_area:Number(totalArea.toPrecision(9)),
    surface_boundary_alignment_ratio:Number(alignment.toFixed(6)),
    non_boundary_triangle_area_fraction:Number((1-alignment).toFixed(6)),
    estimated_volume_loss:null,
    mapped_source_face_count:mappedFaceCount,
    unresolved_texture_face_count:unknownTextureFaceCount,
    rectangular_uv_side_count:uvRectSides,
    fragmented_material_side_count:splitSides,
    uv_sides:uvSides,
    cube_face_transfer:cubeFaceTransfer,
    uv_fidelity:"requires_native_face_mapping_review" as const,
    shading:mesh.shading,
    armature_attached:mesh.armature_attached,
    native_cube_ready:false as const,
    note:
      "Geometric AABB/surface alignment is local-source evidence only; a " +
      "boundary-area fraction is not a volume-loss or silhouette error bound. " +
      "No native Cube created, no UV or material transferred, and no rig, " +
      "world transform, export, animation or visual equivalence proven.",
  };
}

export function summarizeMeshToCubeFidelity(
  meshes: readonly MeshToCubeInput[],
  options:{total_visible_mesh_count?:number}={}
) {
  if(!Array.isArray(meshes) || meshes.length>MESH_TO_CUBE_ANALYSIS_LIMIT){
    throw new Error("MESH_TO_CUBE_ANALYSIS_BUDGET: select at most 16 Meshes.");
  }
  const total=options.total_visible_mesh_count??meshes.length;
  if(!Number.isSafeInteger(total) || total<meshes.length){
    throw new Error("MESH_TO_CUBE_MISSING_SOURCE_COUNT: incomplete visible Mesh inventory.");
  }
  const items=meshes.map(analyzeMeshToCubeFidelity);
  const exact=items.filter(item=>item.shape_classification==="exact_geometry_candidate" ||
    item.shape_classification==="exact_shape_requires_review").length;
  return {
    state:total===meshes.length && items.every(item=>item.state!=="unverified") ?
      "available" as const:"partial" as const,
    scope:"authored_local_mesh_geometry_not_conversion" as const,
    visual_verdict:"not_evaluated" as const,
    visible_mesh_count:total,
    inspected_mesh_count:meshes.length,
    uninspected_mesh_count:total-meshes.length,
    exact_shape_candidate_count:exact,
    approximation_required_count:items.filter(item=>
      item.shape_classification==="box_approximation_required").length,
    unverified_count:items.filter(item=>item.state==="unverified").length,
    results:items.slice(0,MESH_TO_CUBE_EXAMPLE_LIMIT),
    examples_truncated:items.length>MESH_TO_CUBE_EXAMPLE_LIMIT ||
      total>meshes.length,
    note:"Read-only structural Mesh-to-Cube inspection. Exact local box topology " +
      "still requires native UV/rig/export and visual validation. Approximation " +
      "metrics are not a claim of Minecraft-ready output.",
  };
}

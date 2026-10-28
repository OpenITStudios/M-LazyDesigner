import {
  analyzeMeshToCubeFidelity,
  type MeshToCubeInput,
} from "./meshToCubeFidelity";
import { validateCubeGeometrySpan } from "./cubeSpan";

/**
 * Preflight is pure. A source revision is only a non-cryptographic local
 * conflict detector, never evidence of asset provenance or visual approval.
 * Mesh vertices are local to Mesh.origin in Blockbench 5.2.2. Cube from/to
 * must be expressed in model coordinates with that origin added back.
 */
export type MeshToCubeSource = MeshToCubeInput & {
  parent_lineage: readonly {
    uuid: string;
    origin: readonly number[];
    rotation: readonly number[];
    export: boolean;
  }[] | null;
  parent_sibling_index: number | null;
  raw_face_vertex_orders: Readonly<Record<string, readonly string[]>>;
  seams: Readonly<Record<string, string>>;
  source_visibility: boolean;
  source_export: boolean;
  source_locked: boolean;
  source_color: number;
  source_render_order: string | null;
  armature_reference: string | null;
  animation_reference_count: number | null;
  format: {
    id: string;
    bone_rig: boolean;
    single_texture: boolean;
    uv_rotation: boolean;
    default_texture_uuid: string | null;
  };
};

type PlannedCubeFace = Readonly<{
  face: "north" | "south" | "east" | "west" | "up" | "down";
  uv: readonly [number, number, number, number];
  rotation: 0 | 90 | 180 | 270;
  texture: string | null;
  material_name: string;
}>;

export type MeshToCubeTransactionPlan = Readonly<{
  kind: "mesh_to_cube_source_transaction";
  state: "candidate_source_only" | "blocked";
  mesh_uuid: string | null;
  source_revision: string | null;
  revision_proof: "NON_CRYPTOGRAPHIC_SOURCE_DRIFT_ONLY";
  blocked_reasons: readonly string[];
  cube: null | Readonly<{
    name: string;
    from: readonly [number, number, number];
    to: readonly [number, number, number];
    origin: readonly [number, number, number];
    rotation: readonly [number, number, number];
    color: number;
    parent_id: string;
    sibling_index: number;
    box_uv: false;
    autouv: 0;
    faces: readonly PlannedCubeFace[];
  }>;
  mesh_replaced: false;
  cube_created: false;
  undo_executed: false;
  native_export_verified: false;
  visual_verdict: "not_evaluated";
}>;

function finite3(values: readonly number[] | undefined): values is readonly [number,number,number] {
  return Array.isArray(values) && values.length === 3 &&
    values.every(value => typeof value === "number" && Number.isFinite(value));
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value === value.trim() && value.length <= 160;
}

/** Stable ordering across equivalent native object enumeration orders. */
function sourceSignature(source: MeshToCubeSource): string {
  const orderedVertices = Object.entries(source.vertices).sort(([a],[b])=>a.localeCompare(b));
  const orderedFaces = Object.entries(source.faces).sort(([a],[b])=>a.localeCompare(b))
    .map(([id,face])=>[
      id,
      face.vertices,
      Object.entries(face.uv ?? {}).sort(([a],[b])=>a.localeCompare(b)),
      face.texture ?? null,
      face.material_name ?? null,
      source.raw_face_vertex_orders[id] ?? null,
    ]);
  const value = JSON.stringify([
    source.uuid,source.name,source.origin,source.rotation,
    source.parent_id,source.parent_lineage,source.parent_sibling_index,
    source.shading,source.armature_attached,source.armature_reference,
    source.animation_reference_count,
    source.source_visibility,source.source_export,source.source_locked,
    source.source_color,source.source_render_order,
    source.format,orderedVertices,orderedFaces,
    Object.entries(source.seams).sort(([a],[b])=>a.localeCompare(b)),
  ]);
  // Uses two independent 32-bit diffusion paths only for short receipts;
  // not cryptographic and never a trusted evidence/provenance token.
  let a=2166136261,b=0x9e3779b9;
  for(let i=0;i<value.length;i++){
    const c=value.charCodeAt(i);
    a=Math.imul(a ^ c,16777619);
    b=Math.imul(b ^ (c + (i & 255)),2246822519);
  }
  return "mesh-cube-drift-v1:" + value.length + ":" +
    (a>>>0).toString(16).padStart(8,"0") + ":" +
    (b>>>0).toString(16).padStart(8,"0");
}

export function planMeshToCubeTransaction(source: MeshToCubeSource): MeshToCubeTransactionPlan {
  const blocked = new Set<string>();
  const flag=(reason:string)=>{blocked.add(reason);};
  const base={
    kind:"mesh_to_cube_source_transaction" as const,
    mesh_uuid:typeof source?.uuid==="string"?source.uuid:null,
    revision_proof:"NON_CRYPTOGRAPHIC_SOURCE_DRIFT_ONLY" as const,
    mesh_replaced:false as const,cube_created:false as const,
    undo_executed:false as const,native_export_verified:false as const,
    visual_verdict:"not_evaluated" as const,
  };
  if(!source || !nonempty(source.uuid) ||
     !source.format || !source.vertices || !source.faces ||
     !source.raw_face_vertex_orders || !source.seams){
    return {...base,state:"blocked",source_revision:null,
      blocked_reasons:["MESH_CUBE_SOURCE_INVENTORY_INVALID"],cube:null};
  }
  const fidelity=analyzeMeshToCubeFidelity(source);
  if(fidelity.state==="unverified" || !fidelity.geometry_surface_exact_candidate ||
     !fidelity.local_candidate_box){
    flag("MESH_CUBE_EXACT_GEOMETRY_REQUIRED");
  }
  if(fidelity.outward_winding_mismatch_face_count &&
     fidelity.outward_winding_mismatch_face_count>0){
    flag("MESH_CUBE_WINDING_UNVERIFIED");
  }
  if(fidelity.cube_face_transfer.state!=="all_faces_candidate_source_only"){
    flag("MESH_CUBE_UV_TRANSFER_INCOMPLETE");
  }
  if(source.shading!=="flat")flag("MESH_CUBE_FLAT_SHADING_REQUIRED");
  if(source.armature_attached!==false || (source.armature_reference && source.armature_reference.length>0)){
    flag("MESH_CUBE_ARMATURE_OR_WEIGHTS_UNVERIFIED");
  }
  if(source.animation_reference_count!==0)flag("MESH_CUBE_ANIMATION_REFERENCES_UNVERIFIED");
  if(!source.source_visibility || !source.source_export || source.source_locked){
    flag("MESH_CUBE_SOURCE_NOT_EDITABLE_VISIBLE_EXPORT");
  }
  if(!Number.isSafeInteger(source.source_color) || source.source_color<0 ||
      source.source_color>255){
    flag("MESH_CUBE_SOURCE_COLOR_UNVERIFIED");
  }
  if(source.source_render_order!==null && source.source_render_order!=="default"){
    flag("MESH_CUBE_RENDER_ORDER_UNVERIFIED");
  }
  if(!finite3(source.rotation) || !source.rotation.every(v=>v===0)){
    flag("MESH_CUBE_ROTATION_REQUIRES_NATIVE_REVIEW");
  }
  if(!finite3(source.origin))flag("MESH_CUBE_ORIGIN_UNVERIFIED");
  const validLineage = Array.isArray(source.parent_lineage) &&
    source.parent_lineage.length<=64 &&
    ((source.parent_id==="root" && source.parent_lineage.length===0) ||
      (source.parent_id!=="root" &&
       source.parent_lineage[0]?.uuid===source.parent_id &&
       source.parent_lineage.length>0)) &&
    source.parent_lineage.every(g=>nonempty(g.uuid) &&
      finite3(g.origin) && finite3(g.rotation) &&
      typeof g.export==="boolean") &&
    new Set(source.parent_lineage.map(g=>g.uuid)).size===source.parent_lineage.length;
  if(!validLineage || !Number.isSafeInteger(source.parent_sibling_index) ||
     source.parent_sibling_index===null || source.parent_sibling_index<0){
    flag("MESH_CUBE_PARENT_HIERARCHY_UNVERIFIED");
  }
  if(source.format.id!=="bedrock" || !source.format.bone_rig ||
     !source.format.single_texture || !source.format.uv_rotation){
    flag("MESH_CUBE_BEDROCK_CUBE_FORMAT_UNVERIFIED");
  }
  const defaultTexture=source.format.default_texture_uuid;
  const rawFaces=Object.keys(source.faces).sort();
  const authoredFaceOrders=Object.keys(source.raw_face_vertex_orders).sort();
  if(rawFaces.length!==authoredFaceOrders.length ||
     rawFaces.some((id,i)=>id!==authoredFaceOrders[i] ||
       !Array.isArray(source.raw_face_vertex_orders[id]) ||
       source.raw_face_vertex_orders[id].length!==source.faces[id]?.vertices.length)){
    flag("MESH_CUBE_NATIVE_FACE_INVENTORY_UNVERIFIED");
  }
  if(Object.values(source.seams).some(value=>
    value!=="auto" && value!=="divide" && value!=="join")){
    flag("MESH_CUBE_MESH_SEAMS_UNVERIFIED");
  }
  let cube:MeshToCubeTransactionPlan["cube"]=null;
  if(fidelity.local_candidate_box && finite3(source.origin) &&
     fidelity.cube_face_transfer.state==="all_faces_candidate_source_only") {
    const local=fidelity.local_candidate_box;
    const from=local.from.map((n,i)=>n+source.origin[i]) as [number,number,number];
    const to=local.to.map((n,i)=>n+source.origin[i]) as [number,number,number];
    if(!finite3(from) || !finite3(to)){
      flag("MESH_CUBE_PIVOT_TRANSLATION_NONFINITE");
    }else{
      try{
        validateCubeGeometrySpan(from,to,0,"Mesh-to-Cube source");
      }catch{
        flag("MESH_CUBE_CUBE_SPAN_UNREPRESENTABLE");
      }
      const faces:PlannedCubeFace[]=[];
      for(const face of fidelity.cube_face_transfer.faces){
        if(!face.uv_rect || face.uv_rotation===null ||
           face.material_name===null || face.state!=="candidate_source_only"){
          flag("MESH_CUBE_FACE_TRANSFER_NOT_EXACT");
          continue;
        }
        const texture = face.texture_binding==="hidden_face" ? null :
          (face.texture_binding==="single_texture_default" ||
           face.texture_binding==="explicit_texture_uuid")
            ? defaultTexture:null;
        if(face.texture_binding==="unresolved" || face.texture_binding==="split"){
          flag("MESH_CUBE_TEXTURE_BINDING_UNKNOWN");
        }
        if(texture===null && face.texture_binding!=="hidden_face"){
          flag("MESH_CUBE_DEFAULT_TEXTURE_MISSING");
        }
        if(face.texture_binding==="explicit_texture_uuid" &&
           face.texture_uuid!==defaultTexture){
          flag("MESH_CUBE_TEXTURE_NOT_DEFAULT_ATLAS");
        }
        // Bedrock CubeFace.material_name exports material_instance, but
        // MeshFace has no native material-instance equivalent in 5.2.2.
        // A non-empty source property needs separate native review.
        if(face.material_name!=="")flag("MESH_CUBE_MATERIAL_TRANSFER_UNVERIFIED");
        faces.push({
          face:face.face,
          uv:face.uv_rect as [number,number,number,number],
          rotation:face.uv_rotation as 0|90|180|270,
          texture,
          material_name:face.material_name,
        });
      }
      if(faces.length!==6)flag("MESH_CUBE_SIX_FACES_REQUIRED");
      if(finite3(from) && finite3(to) && faces.length===6){
        cube={
          name:source.name,
          from,to,
          origin:[...source.origin] as [number,number,number],
          rotation:[...source.rotation] as [number,number,number],
          color:source.source_color,
          parent_id:source.parent_id ?? "",
          sibling_index:source.parent_sibling_index ?? -1,
          box_uv:false,autouv:0,faces,
        };
      }
    }
  }
  const reasons=[...blocked].sort();
  return {
    ...base,
    state:reasons.length?"blocked":"candidate_source_only",
    source_revision:sourceSignature(source),
    blocked_reasons:reasons,
    cube:reasons.length?null:cube,
  };
}

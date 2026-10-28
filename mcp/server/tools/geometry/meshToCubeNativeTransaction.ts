/// <reference types="blockbench-types" />

import {
  planMeshToCubeTransaction,
  type MeshToCubeSource,
  type MeshToCubeTransactionPlan,
} from "@/lib/geometry/meshToCubeTransactionPlan";
import type { MeshToCubeInput } from "@/lib/geometry/meshToCubeFidelity";

/**
 * Shared native snapshot for model inspection and pre-Undo conflict checks.
 * It is read-only and does not invoke Mesh getSaveCopy/Undo or image sampling.
 */
export function captureNativeMeshToCubeSource(mesh: Mesh): MeshToCubeSource {
  const vertices=mesh.vertices ?? {};
  const nativeFaces=mesh.faces ?? {};
  const faceCount=Object.keys(nativeFaces).length;
  const vertexCount=Object.keys(vertices).length;
  const tooLarge=vertexCount>512 || faceCount>512;
  const faces:Record<string,MeshToCubeInput["faces"][string]>={};
  const rawFaceVertexOrders:Record<string,string[]>={};
  for(const [id,face] of Object.entries(tooLarge?{}:nativeFaces)){
    rawFaceVertexOrders[id]=Array.isArray(face.vertices)?[...face.vertices]:[];
    let ordered:readonly string[]=[];
    try{
      ordered=typeof face.getSortedVertices==="function"
        ?[...face.getSortedVertices()]:[];
    }catch{}
    faces[id]={
      vertices:ordered,uv:face.uv,
      texture:face.texture,
      material_name:(face as MeshFace & {material_name?:string}).material_name,
    };
  }
  const parentId=typeof Group!=="undefined" && mesh.parent instanceof Group
    ?mesh.parent.uuid:mesh.parent==="root"?"root":null;
  const parentLineage:Array<{
    uuid:string;
    origin:number[];
    rotation:number[];
    export:boolean;
  }>=[];
  let lineageKnown=mesh.parent==="root";
  if(typeof Group!=="undefined" && mesh.parent instanceof Group){
    lineageKnown=true;
    let current:Group|"root"|undefined=mesh.parent;
    const seen=new Set<string>();
    while(current instanceof Group){
      if(seen.has(current.uuid) || parentLineage.length>=64){
        lineageKnown=false;break;
      }
      seen.add(current.uuid);
      parentLineage.push({
        uuid:current.uuid,
        origin:Array.isArray(current.origin)?[...current.origin]:[],
        rotation:Array.isArray(current.rotation)?[...current.rotation]:[],
        export:current.export!==false,
      });
      current=current.parent as Group|"root"|undefined;
    }
    if(current!=="root")lineageKnown=false;
  }
  let armatureAttached:boolean|null=null;
  try{
    if(typeof mesh.getArmature==="function"){
      armatureAttached=Boolean(mesh.getArmature());
    }
  }catch{}
  const groupArray=typeof mesh.getParentArray==="function"
    ?mesh.getParentArray():null;
  const groupIndex=Array.isArray(groupArray)?groupArray.indexOf(mesh):-1;
  const animationRegistry=typeof AnimationItem!=="undefined" &&
    Array.isArray(AnimationItem.all)?AnimationItem.all:null;
  let animationReferences:number|null=null;
  if(animationRegistry){
    animationReferences=0;
    for(const item of animationRegistry){
      const animators=(item as BBAnimation & {animators?:Record<string,unknown>}).animators;
      if(animators && Object.prototype.hasOwnProperty.call(animators,mesh.uuid)){
        animationReferences++;
      }
    }
  }
  const defaultTexture=typeof Texture!=="undefined" &&
    typeof Texture.getDefault==="function"?Texture.getDefault():null;
  const f=typeof Format!=="undefined"?Format:null;
  return {
    uuid:mesh.uuid,name:mesh.name,
    vertices:tooLarge?vertices:vertices,
    faces:tooLarge?nativeFaces as unknown as MeshToCubeSource["faces"]:faces,
    origin:mesh.origin,rotation:mesh.rotation,
    parent_id:parentId,
    shading:mesh.shading,
    armature_attached:armatureAttached,
    parent_lineage:lineageKnown?parentLineage:null,
    parent_sibling_index:groupIndex<0?null:groupIndex,
    raw_face_vertex_orders:rawFaceVertexOrders,
    seams:mesh.seams??{},
    source_visibility:mesh.visibility!==false,
    source_export:mesh.export!==false,
    source_locked:mesh.locked===true,
    source_color:mesh.color as number,
    source_render_order:typeof (mesh as Mesh & {render_order?:unknown}).render_order==="string"
      ?(mesh as Mesh & {render_order:string}).render_order:null,
    armature_reference:typeof mesh.armature==="string"?mesh.armature:null,
    animation_reference_count:animationReferences,
    format:{
      id:f?.id??"",
      bone_rig:f?.bone_rig===true,
      single_texture:f?.single_texture===true,
      uv_rotation:f?.uv_rotation===true,
      default_texture_uuid:typeof defaultTexture?.uuid==="string"
        ?defaultTexture.uuid:null,
    },
  };
}

export function inspectNativeMeshToCubeTransaction(mesh:Mesh):MeshToCubeTransactionPlan {
  return planMeshToCubeTransaction(captureNativeMeshToCubeSource(mesh));
}

/**
 * UNREGISTERED native mutation adapter. No public MCP route invokes it.
 * Requires a fresh exact-source plan; all source/toolchain/native verification
 * is deferred. This is NOT an accepted live Blockbench conversion.
 */
export function writePreparedMeshToCubeTransaction(input:{
  mesh:Mesh;
  prepared:MeshToCubeTransactionPlan;
}) {
  const {mesh,prepared}=input;
  if(typeof Blockbench==="undefined" || Blockbench.version!=="5.2.2" ||
     typeof Mesh==="undefined" || typeof Cube==="undefined" ||
     typeof Group==="undefined" || typeof Project==="undefined" || !Project ||
     typeof Undo==="undefined" || typeof Outliner==="undefined" ||
     typeof Format==="undefined" || Format.id!=="bedrock" ||
     !Array.isArray(Mesh.all) || !Array.isArray(Cube.all) ||
     (Undo as typeof Undo & {current_save?:unknown}).current_save){
    throw new Error("MESH_CUBE_NATIVE_CONTEXT_UNVERIFIED: requires exact supported editor and no active Undo.");
  }
  if(Mesh.all.filter(candidate=>candidate.uuid===mesh?.uuid).length!==1 ||
     Mesh.all.find(candidate=>candidate.uuid===mesh?.uuid)!==mesh){
    throw new Error("MESH_CUBE_NATIVE_MESH_IDENTITY_CHANGED");
  }
  const current=inspectNativeMeshToCubeTransaction(mesh);
  if(!prepared || prepared.state!=="candidate_source_only" ||
     current.state!=="candidate_source_only" || !prepared.cube ||
     !current.cube || !current.source_revision ||
     current.source_revision!==prepared.source_revision ||
     !current.source_revision.startsWith("mesh-cube-drift-v1:") ||
     JSON.stringify(current.cube)!==JSON.stringify(prepared.cube)){
    throw new Error("MESH_CUBE_NATIVE_SOURCE_CHANGED: refresh Mesh inspection and plan.");
  }
  const parent=mesh.parent;
  if(parent!=="root" && !(parent instanceof Group)){
    throw new Error("MESH_CUBE_NATIVE_PARENT_UNSUPPORTED");
  }
  const siblings=mesh.getParentArray();
  if(!Array.isArray(siblings) ||
     siblings.indexOf(mesh)!==current.cube.sibling_index){
    throw new Error("MESH_CUBE_NATIVE_OUTLINER_INDEX_CHANGED");
  }

  const cubeFields=current.cube;
  const aspects={elements:[mesh] as Array<Mesh|Cube>,outliner:true,collections:[]};
  let open=false, created:Cube|null=null;
  try{
    const save=Undo.initEdit(aspects) as unknown as {
      aspects?:{elements?:Array<Mesh|Cube>};
    } | undefined;
    open=true;
    if(!save || save.aspects?.elements!==aspects.elements ||
       (Undo as typeof Undo & {current_save?:unknown}).current_save!==save){
      throw new Error("MESH_CUBE_NATIVE_UNDO_SNAPSHOT_UNVERIFIED");
    }
    // Recheck source after synchronous Undo init callbacks, before any
    // authored mutation. UI listeners can invalidate a preflight.
    if(inspectNativeMeshToCubeTransaction(mesh).source_revision!==prepared.source_revision){
      throw new Error("MESH_CUBE_NATIVE_SOURCE_CHANGED_DURING_UNDO_INIT");
    }
    created=new Cube({
      name:cubeFields.name,
      from:[...cubeFields.from] as ArrayVector3,
      to:[...cubeFields.to] as ArrayVector3,
      origin:[...cubeFields.origin] as ArrayVector3,
      rotation:[...cubeFields.rotation] as ArrayVector3,
      color:cubeFields.color,
      box_uv:false,autouv:0,visibility:true,shade:true,
    });
    // Undo.cancelEdit(true) must see the added Cube in its post snapshot;
    // original before-save elements still contains ONLY the source Mesh.
    aspects.elements.push(created);
    created.init();
    created.sortInBefore(mesh,0);
    if(created.parent!==parent || created.getParentArray().indexOf(created)!==
       cubeFields.sibling_index){
      throw new Error("MESH_CUBE_NATIVE_PARENT_OR_ORDER_CHANGED");
    }
    for(const mapping of cubeFields.faces){
      const face=created.faces[mapping.face];
      if(!face){
        throw new Error("MESH_CUBE_NATIVE_CUBE_FACE_MISSING");
      }
      face.extend({
        uv:[...mapping.uv] as [number,number,number,number],
        rotation:mapping.rotation,
        material_name:mapping.material_name,
        texture:mapping.texture,
      } as CubeFaceOptions);
    }
    const same=(a:readonly number[],b:readonly number[])=>
      a.length===b.length && a.every((v,i)=>v===b[i]);
    if(created.box_uv!==false || created.autouv!==0 ||
       created.name!==cubeFields.name ||
       !same(created.from,cubeFields.from) ||
       !same(created.to,cubeFields.to) ||
       !same(created.origin,cubeFields.origin) ||
       !same(created.rotation,cubeFields.rotation) ||
       created.color!==cubeFields.color){
      throw new Error("MESH_CUBE_NATIVE_CUBE_GEOMETRY_POSTCONDITION");
    }
    for(const mapping of cubeFields.faces){
      const face=created.faces[mapping.face];
      if(!same(face.uv,mapping.uv) ||
         face.rotation!==mapping.rotation ||
         face.material_name!==mapping.material_name ||
         face.texture!==mapping.texture){
        throw new Error("MESH_CUBE_NATIVE_CUBE_FACE_POSTCONDITION");
      }
    }
    if(Mesh.all.filter(node=>node===mesh).length!==1 ||
       Cube.all.filter(node=>node===created).length!==1){
      throw new Error("MESH_CUBE_NATIVE_ELEMENT_CREATION_POSTCONDITION");
    }
    mesh.remove();
    if(Mesh.all.some(node=>node.uuid===mesh.uuid) ||
       !Cube.all.includes(created) ||
       created.parent!==parent ||
       created.getParentArray().indexOf(created)!==cubeFields.sibling_index){
      throw new Error("MESH_CUBE_NATIVE_REPLACEMENT_POSTCONDITION");
    }
    Undo.finishEdit("Convert authored Mesh to Bedrock Cube",{
      elements:[created],outliner:true,collections:[],
    });
    open=false;
  }catch(error){
    if(open && (Undo as typeof Undo & {current_save?:unknown}).current_save){
      Undo.cancelEdit(true);
    }
    throw error;
  }
  return {
    state:"SOURCE_TRANSACTION_COMMITTED_NATIVE_NOT_ACCEPTED" as const,
    source_mesh_uuid:prepared.mesh_uuid,
    cube_uuid:created!.uuid,
    authored_mesh_replaced:true as const,
    undo_transaction_requested:true as const,
    native_undo_replay_verified:false as const,
    native_save_reopen_verified:false as const,
    visual_verdict:"not_evaluated" as const,
    note:"Internal source transaction path only; native Undo replay, Bedrock " +
      "export, texture pixels and rig/visual equivalence remain NOT EXECUTED.",
  };
}

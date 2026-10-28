import { describe, expect, test } from "bun:test";
import {
  inspectNativeMeshToCubeTransaction,
  writePreparedMeshToCubeTransaction,
} from "@/server/tools/geometry/meshToCubeNativeTransaction";

/**
 * Deterministic, lightweight fake native globals for one-Undo contract tests.
 * It models identities, snapshot ordering and callback failures; it does NOT
 * prove UndoSystem.loadSave, real preview restoration or Bedrock export.
 */
type FixtureHooks = {
  throwDuringInitEdit?: boolean;
  mutateMeshDuringInitEdit?: boolean;
  corruptNorthFace?: boolean;
  throwDuringFaceWrite?: boolean;
  throwAfterMeshRemoval?: boolean;
  throwAfterFinishCommit?: boolean;
  throwDuringCancel?: boolean;
};
function withNativeFixture(
  body:(ctx:{
    mesh:any;group:any;Cube:any;Mesh:any;undo:any;
    calls:{init:number;finish:number;cancel:number};
    project:any;root:any[];
  })=>void,
  hooks:FixtureHooks={}
) {
  const global=globalThis as any;
  const names=[
    "Mesh","Cube","Group","Project","Outliner",
    "Undo","Blockbench","Format","Texture","AnimationItem",
  ];
  const originals=names.map(name=>
    Object.getOwnPropertyDescriptor(globalThis,name)
  );
  const set=(name:string,value:unknown)=>Object.defineProperty(globalThis,name,{
    configurable:true,writable:true,value,
  });
  const root:any[]=[];
  class FakeGroup {
    static all:FakeGroup[]=[];
    uuid="bone";
    name="bone";
    origin=[0,0,0];
    rotation=[0,0,0];
    export=true;
    parent:"root"="root";
    children:any[]=[];
  }
  const group=new FakeGroup();
  FakeGroup.all=[group];
  const positions={
    a:[0,0,0],b:[2,0,0],c:[2,2,0],d:[0,2,0],
    e:[0,0,2],f:[2,0,2],g:[2,2,2],h:[0,2,2],
  };
  const order:Record<string,string[]>={
    north:["a","d","c","b"],
    south:["e","f","g","h"],
    west:["a","e","h","d"],
    east:["b","c","g","f"],
    down:["a","b","f","e"],
    up:["d","h","g","c"],
  };
  class FakeMesh {
    static all:FakeMesh[]=[];
    uuid="mesh-1";
    name="limb";
    vertices=Object.fromEntries(Object.entries(positions).map(([id,p])=>[
      id,[...p],
    ]));
    faces=Object.fromEntries(Object.entries(order).map(([id,ids])=>[
      id,{
        vertices:[...ids],
        uv:Object.fromEntries(ids.map((key,i)=>[
          key,[[0,0],[16,0],[16,16],[0,16]][i],
        ])),
        texture:"atlas",
        material_name:"",
        getSortedVertices(){return [...this.vertices];},
      },
    ]));
    seams={};
    origin=[4,6,-2];
    rotation=[0,0,0];
    parent:FakeGroup=group;
    shading="flat";
    armature="";
    visibility=true;
    export=true;
    locked=false;
    selected=false;
    color=1;
    render_order="default";
    getArmature(){return undefined;}
    getParentArray(){return group.children;}
    remove(){
      const index=FakeMesh.all.indexOf(this);
      if(index>=0)FakeMesh.all.splice(index,1);
      const siblingIndex=group.children.indexOf(this);
      if(siblingIndex>=0)group.children.splice(siblingIndex,1);
      if(hooks.throwAfterMeshRemoval)throw Error("NATIVE_MESH_REMOVE_CALLBACK");
    }
  }
  const mesh=new FakeMesh();
  FakeMesh.all=[mesh];
  group.children=[mesh];
  let cubeSerial=0;
  class FakeCube {
    static all:FakeCube[]=[];
    static instances:FakeCube[]=[];
    uuid="new-cube-"+(++cubeSerial);
    name:string;
    from:number[];
    to:number[];
    origin:number[];
    rotation:number[];
    color:number;
    autouv:number;
    box_uv:boolean;
    visibility:boolean;
    shade:boolean;
    parent:FakeGroup|"root"="root";
    faces:Record<string,any>;
    constructor(options:any){
      Object.assign(this,options);
      this.faces=Object.fromEntries(
        ["north","south","east","west","up","down"].map(id=>[
          id,{
            uv:[0,0,0,0],rotation:0,
            material_name:"",texture:"atlas",
            extend(data:any){
              if(hooks.throwDuringFaceWrite && id==="north"){
                throw Error("NATIVE_FACE_WRITE_CALLBACK");
              }
              Object.assign(this,data);
              if(hooks.corruptNorthFace && id==="north"){
                this.rotation=45;
              }
            },
          },
        ])
      );
      FakeCube.instances.push(this);
    }
    init(){
      FakeCube.all.push(this);
      root.push(this);
      return this;
    }
    getParentArray(){
      return this.parent==="root"?root:group.children;
    }
    sortInBefore(target:FakeMesh,offset:number){
      const existing=this.getParentArray();
      const old=existing.indexOf(this);
      if(old>=0)existing.splice(old,1);
      const dest=target.getParentArray();
      const at=dest.indexOf(target);
      dest.splice(at+offset,0,this);
      this.parent=target.parent;
      return this;
    }
  }
  const calls={init:0,finish:0,cancel:0};
  const undo:any={
    history:[] as any[],
    initEdit(aspects:any){
      calls.init++;
      const saved={
        aspects,
        elements:{[mesh.uuid]:{uuid:mesh.uuid,type:"mesh"}},
        outliner:[{uuid:mesh.uuid}],
      };
      this.current_save=saved;
      if(hooks.mutateMeshDuringInitEdit)mesh.vertices.a[0]=0.25;
      if(hooks.throwDuringInitEdit)throw Error("NATIVE_INIT_EDIT_CALLBACK");
      return saved;
    },
    finishEdit(message:string,aspects:any){
      calls.finish++;
      const entry={
        before:this.current_save,
        post:{
          elements:Object.fromEntries(aspects.elements.map((element:any)=>[
            element.uuid,{uuid:element.uuid,type:"cube"},
          ])),
          outliner:[...group.children].map(obj=>obj.uuid),
        },
        message,
      };
      delete this.current_save;
      this.history.push(entry);
      if(hooks.throwAfterFinishCommit)throw Error("NATIVE_FINISHED_EDIT_CALLBACK");
      return entry;
    },
    cancelEdit(revert:boolean){
      calls.cancel++;
      if(hooks.throwDuringCancel)throw Error("NATIVE_CANCEL_UNDO_CALLBACK");
      if(revert){
        FakeCube.all.length=0;
        root.length=0;
        group.children.length=0;
        group.children.push(mesh);
        if(!FakeMesh.all.includes(mesh))FakeMesh.all.push(mesh);
        mesh.vertices.a[0]=0;
      }
      delete this.current_save;
    },
  };
  const project={mesh_selection:{} as Record<string,unknown>};
  const bind={
    Mesh:FakeMesh,Cube:FakeCube,Group:FakeGroup,
    Project:project,Outliner:{root},Undo:undo,
    Blockbench:{version:"5.2.2"},
    Format:{id:"bedrock",bone_rig:true,single_texture:true,uv_rotation:true},
    Texture:{getDefault:()=>({uuid:"atlas"})},
    AnimationItem:{all:[]},
  };
  try {
    Object.entries(bind).forEach(([name,value])=>set(name,value));
    body({mesh,group,Cube:FakeCube,Mesh:FakeMesh,undo,calls,project,root});
  } finally {
    names.forEach((name,i)=>{
      const descriptor=originals[i];
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);
      else Reflect.deleteProperty(globalThis,name);
    });
  }
}

describe("unregistered Mesh-to-Cube native transaction source contract",()=>{
  test("records before Mesh and after Cube as one distinct Undo entry with parent/order preserved",()=>{
    withNativeFixture(({mesh,group,Cube,Mesh,undo,calls})=>{
      const prepared=inspectNativeMeshToCubeTransaction(mesh);
      expect(prepared.state).toBe("candidate_source_only");
      expect(prepared.cube).toMatchObject({
        from:[4,6,-2],to:[6,8,0],origin:[4,6,-2],
        parent_id:"bone",sibling_index:0,
      });
      const result=writePreparedMeshToCubeTransaction({mesh,prepared});
      expect(result).toMatchObject({
        state:"SOURCE_TRANSACTION_COMMITTED_NATIVE_NOT_ACCEPTED",
        authored_mesh_replaced:true,
        undo_transaction_requested:true,
        native_undo_replay_verified:false,
        native_save_reopen_verified:false,
        visual_verdict:"not_evaluated",
      });
      expect(calls).toEqual({init:1,finish:1,cancel:0});
      expect(Mesh.all).toHaveLength(0);
      expect(Cube.all).toHaveLength(1);
      expect(group.children).toEqual(Cube.all);
      const cube=Cube.all[0];
      expect(cube.parent).toBe(group);
      expect(cube.faces.north.texture).toBe("atlas");
      expect(Object.keys(undo.history[0].before.elements)).toEqual(["mesh-1"]);
      expect(Object.keys(undo.history[0].post.elements)).toEqual([cube.uuid]);
      expect(undo.history[0].post.outliner).toEqual([cube.uuid]);
      expect(undo.current_save).toBeUndefined();
    });
  });

  test("a native init_edit listener failure still cancels an opened snapshot",()=>{
    withNativeFixture(({mesh,Mesh,Cube,undo,calls})=>{
      const prepared=inspectNativeMeshToCubeTransaction(mesh);
      expect(()=>writePreparedMeshToCubeTransaction({mesh,prepared}))
        .toThrow("NATIVE_INIT_EDIT_CALLBACK");
      expect(calls).toEqual({init:1,finish:0,cancel:1});
      expect(undo.current_save).toBeUndefined();
      expect(Mesh.all).toEqual([mesh]);
      expect(Cube.all).toHaveLength(0);
    },{throwDuringInitEdit:true});
  });

  test("source drift caused by init_edit observers aborts before Cube construction",()=>{
    withNativeFixture(({mesh,Mesh,Cube,calls})=>{
      const prepared=inspectNativeMeshToCubeTransaction(mesh);
      expect(()=>writePreparedMeshToCubeTransaction({mesh,prepared}))
        .toThrow("MESH_CUBE_NATIVE_SOURCE_CHANGED_DURING_UNDO_INIT");
      expect(calls).toEqual({init:1,finish:0,cancel:1});
      expect(Mesh.all).toEqual([mesh]);
      expect(Cube.instances).toHaveLength(0);
    },{mutateMeshDuringInitEdit:true});
  });

  test("bad face authoring triggers one rollback before Mesh removal",()=>{
    withNativeFixture(({mesh,Mesh,Cube,calls})=>{
      const prepared=inspectNativeMeshToCubeTransaction(mesh);
      expect(()=>writePreparedMeshToCubeTransaction({mesh,prepared}))
        .toThrow("MESH_CUBE_NATIVE_CUBE_FACE_POSTCONDITION");
      expect(calls).toEqual({init:1,finish:0,cancel:1});
      expect(Mesh.all).toEqual([mesh]);
      expect(Cube.all).toHaveLength(0);
    },{corruptNorthFace:true});
  });

  test("callback failure after Mesh removal invokes rollback instead of claiming success",()=>{
    withNativeFixture(({mesh,Mesh,Cube,calls})=>{
      const prepared=inspectNativeMeshToCubeTransaction(mesh);
      expect(()=>writePreparedMeshToCubeTransaction({mesh,prepared}))
        .toThrow("NATIVE_MESH_REMOVE_CALLBACK");
      expect(calls).toEqual({init:1,finish:0,cancel:1});
      expect(Mesh.all).toEqual([mesh]);
      expect(Cube.all).toHaveLength(0);
    },{throwAfterMeshRemoval:true});
  });

  test("undo cancellation failure reports restoration uncertainty",()=>{
    withNativeFixture(({mesh,calls})=>{
      const prepared=inspectNativeMeshToCubeTransaction(mesh);
      expect(()=>writePreparedMeshToCubeTransaction({mesh,prepared}))
        .toThrow("MESH_CUBE_NATIVE_ROLLBACK_UNVERIFIED");
      expect(calls).toEqual({init:1,finish:0,cancel:1});
    },{throwDuringFaceWrite:true,throwDuringCancel:true});
  });

  test("post-commit native listener failure is OUTCOME_UNKNOWN and never auto-retried",()=>{
    withNativeFixture(({mesh,Mesh,Cube,undo,calls})=>{
      const prepared=inspectNativeMeshToCubeTransaction(mesh);
      expect(()=>writePreparedMeshToCubeTransaction({mesh,prepared}))
        .toThrow("MESH_CUBE_MUTATION_OUTCOME_UNKNOWN");
      expect(calls).toEqual({init:1,finish:1,cancel:0});
      expect(undo.history).toHaveLength(1);
      expect(Mesh.all).toHaveLength(0);
      expect(Cube.all).toHaveLength(1);
    },{throwAfterFinishCommit:true});
  });

  test("selected source and active Mesh vertex selection refuse conversion before Undo",()=>{
    withNativeFixture(({mesh,project,calls})=>{
      mesh.selected=true;
      const selected=inspectNativeMeshToCubeTransaction(mesh);
      expect(selected.state).toBe("blocked");
      expect(selected.blocked_reasons).toContain("MESH_CUBE_SELECTION_RECOVERY_NOT_ATTESTED");
      expect(()=>writePreparedMeshToCubeTransaction({mesh,prepared:selected}))
        .toThrow("MESH_CUBE_NATIVE_SOURCE_CHANGED");
      expect(calls.init).toBe(0);
      mesh.selected=false;
      project.mesh_selection[mesh.uuid]={
        vertices:["a"],edges:[],faces:[],
      };
      const faceSelection=inspectNativeMeshToCubeTransaction(mesh);
      expect(faceSelection.blocked_reasons)
        .toContain("MESH_CUBE_SELECTION_RECOVERY_NOT_ATTESTED");
      expect(calls.init).toBe(0);
    });
  });
});

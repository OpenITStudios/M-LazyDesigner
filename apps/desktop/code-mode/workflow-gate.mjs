// SOURCE ONLY. Trusted external agent host; never the Deno guest or GUI.
import {createHash} from 'node:crypto';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
const MAX=65536,SHA=/^[0-9a-f]{64}$/;
const digest=x=>createHash('sha256').update(x).digest('hex');
const refuse=x=>{throw new Error('CODE_MODE_WORKFLOW_'+x)};
const keys=new Set(['Current Stage','Geometry','UV Layout','Texturing',
  'Animation','Animation Required','Known blocker(s)','Current model file',
  'Workflow Model SHA256']);
const states=new Set(['NOT_STARTED','IN_PROGRESS','READY_FOR_USER_REVIEW',
  'APPROVED','INVALIDATED','BLOCKED']);
const groups={
  GEOMETRY:'add_bone add_cube duplicate_cube duplicate_bone_subtree reparent_node rename_node remove_cube remove_empty_bone translate_cube translate_bone_subtree reflect_bone_subtree set_cube_bounds reframe_cube set_cube_rotation scale_cube set_bone_rotation set_bone_origin set_cube_origin set_cube_inflate set_cube_stretch set_node_visibility set_empty_atlas_resolution set_visible_box',
  UV:'set_cube_mirror_uv set_face_uv set_face_uv_rotation set_box_uv_offset',
  TEXTURING:'create_paint_texture enable_imported_paint_texture import_paint_texture replace_existing_face_texture_guarded assign_cube_texture assign_cube_face_texture paint_texture_pixel paint_texture_stroke paint_texture_exact_pixels paint_texture_brush paint_texture_rectangle paint_texture_rectangles paint_cube_uv_faces paint_cube_uv_faces_guarded paint_cube_face_regions_guarded recolor_cube_faces_palette_guarded isolate_cube_box_uv paint_texture_fill',
  ANIMATION:'create_animation duplicate_animation_clip add_animation_timeline_marker update_animation_timeline_marker remove_animation_timeline_marker add_animation_effect_event update_animation_effect_event remove_animation_effect_event set_animation_length set_animation_loop_mode scale_animation_timeline add_bone_rotation_keyframe update_bone_rotation_keyframe remove_bone_rotation_keyframe add_bone_transform_keyframe update_bone_transform_keyframe set_bone_transform_keyframe_interpolation set_bone_transform_keyframe_bezier remove_bone_transform_keyframe',
};
const opGroup=new Map();
for(const [group,ops] of Object.entries(groups))for(const op of ops.split(' ')){
  if(opGroup.has(op))refuse('OP_DUPLICATED');
  opGroup.set(op,group);
}
export function parseWorkflow(source){
  if(typeof source!=='string'||Buffer.byteLength(source,'utf8')>MAX)refuse('README_INVALID');
  const entries=new Map(),tick=String.fromCharCode(96);
  for(const line of source.split(/\r?\n/)){
    const m=/^\s*(?:[-*]\s*)?([A-Za-z][A-Za-z0-9 ()]+):\s*(.*?)\s*$/.exec(line);
    if(!m||!keys.has(m[1]))continue;
    if(entries.has(m[1]))refuse('FIELD_DUPLICATED');
    let v=m[2].trim();
    if(v.startsWith(tick)&&v.endsWith(tick))v=v.slice(1,-1);
    entries.set(m[1],v);
  }
  const v=k=>entries.get(k),stage=v('Current Stage'),g=v('Geometry'),
    uv=v('UV Layout'),t=v('Texturing'),a=v('Animation'),
    required=v('Animation Required'),block=v('Known blocker(s)');
  if(!['INTAKE','GEOMETRY','TEXTURING','ANIMATION','FINALIZATION','COMPLETE'].includes(stage)||
     !states.has(g)||!states.has(t)||
     !['NOT_STARTED','IN_PROGRESS','PASS','INVALIDATED','BLOCKED'].includes(uv)||
     !(states.has(a)||a==='NOT_REQUIRED')||
     !['YES','NO'].includes(required)||!block?.trim()||
     (required==='NO'&&a!=='NOT_REQUIRED')||(required==='YES'&&a==='NOT_REQUIRED')){
    refuse('STATE_INVALID');
  }
  const model=v('Current model file'),raw=v('Workflow Model SHA256');
  if(model&&model!=='none'&&!/^[^/\\\x00-\x1f]+\.bbmodel$/i.test(model))refuse('MODEL_INVALID');
  if(raw&&raw!=='none'&&!/^sha256:[a-f0-9]{64}$/.test(raw))refuse('SHA_INVALID');
  return Object.freeze({stage,g,uv,t,a,required,blocked:block.trim().toLowerCase()!=='none',
    model:model&&model!=='none'?model:null,
    sha:raw&&raw!=='none'?raw.slice(7):null});
}
export function writeDomain(req){
  if(req?.operation==='newModel')return 'NEW';
  if(req?.operation==='importPng')return 'TEXTURING';
  if(['exportGeometry','exportPng','exportAnimations'].includes(req?.operation))return 'EXPORT';
  const ops=req?.operationKinds;
  // Mirror the native EditPlan batch ceiling (Rust Core MAX_OPERATIONS=128).
  // The typed SDK already enforces 128; this is the same independent host gate.
  if(req?.operation!=='apply'||!Array.isArray(ops)||!ops.length||ops.length>128)refuse('OP_UNKNOWN');
  const domains=new Set(ops.map(x=>opGroup.get(x)));
  if(domains.has(undefined))refuse('OP_UNKNOWN');
  if(domains.size!==1)refuse('MIXED_PLAN');
  return [...domains][0];
}
export function admits(w,domain,summary){
  if(domain==='NEW')return w.stage==='GEOMETRY'&&w.g==='IN_PROGRESS'&&
    !w.blocked&&!w.model&&!w.sha;
  if(domain==='EXPORT'){
    if(w.stage==='INTAKE')return false;
    if(!['FINALIZATION','COMPLETE'].includes(w.stage))return true; // QA export
    if(w.g!=='APPROVED'||w.uv!=='PASS'||w.t!=='APPROVED'||w.blocked)return false;
    return w.required==='YES'
      ?w.a==='APPROVED'&&Number.isInteger(summary?.animations)&&summary.animations>0
      :w.a==='NOT_REQUIRED'&&summary?.animations===0;
  }
  if(domain==='GEOMETRY')return w.stage==='GEOMETRY'&&w.g==='IN_PROGRESS';
  if(domain==='UV')return w.stage==='GEOMETRY'&&w.g==='APPROVED'&&
    w.uv==='IN_PROGRESS'&&!w.blocked;
  if(domain==='TEXTURING')return w.stage==='TEXTURING'&&
    w.g==='APPROVED'&&w.uv==='PASS'&&w.t==='IN_PROGRESS';
  if(domain==='ANIMATION')return w.stage==='ANIMATION'&&
    w.g==='APPROVED'&&w.uv==='PASS'&&w.t==='APPROVED'&&
    w.required==='YES'&&w.a==='IN_PROGRESS';
  return false;
}
export function createWorkflowGate({folder,source,sourceSha}){
  const file=join(folder,'README.md'),children=new Map();
  let pinned=null;
  async function read(){
    let stat;try{stat=await lstat(file)}catch{refuse('README_REQUIRED')}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX||
       await realpath(file)!==file)refuse('README_UNTRUSTED');
    const bytes=await readFile(file);
    if(bytes.length>MAX)refuse('README_INVALID');
    const key=digest(bytes);
    if(pinned!==null&&pinned!==key)refuse('README_CHANGED');
    return {key,w:parseWorkflow(bytes.toString('utf8'))};
  }
  async function authorize(req,summary){
    const {key,w}=await read(),domain=writeDomain(req);
    if(domain==='NEW'){
      if(source!==null)refuse('SOURCE_PRESENT');
    }else{
      if(typeof req.input!=='string'||dirname(req.input)!==folder||
         typeof req.expectedSha256!=='string'||!SHA.test(req.expectedSha256)){
        refuse('SOURCE_INVALID');
      }
      const initial=req.input===source&&req.expectedSha256===sourceSha&&
        w.model===basename(source)&&w.sha===sourceSha;
      const descendant=children.get(req.input)===req.expectedSha256;
      if(!initial&&!descendant)refuse('SOURCE_STALE');
    }
    if(!admits(w,domain,summary))refuse('STAGE_BLOCKED');
    pinned??=key;
    return Object.freeze({key});
  }
  function leaseValid(lease){
    if(!lease||lease.key!==pinned)return false;
    try{
      const st=lstatSync(file);
      return st.isFile()&&!st.isSymbolicLink()&&st.size<=MAX&&
        realpathSync(file)===file&&digest(readFileSync(file))===pinned;
    }catch{return false}
  }
  function register(filePath,sha){
    if(!pinned||dirname(filePath)!==folder||!SHA.test(sha))refuse('REGISTER_INVALID');
    children.set(filePath,sha);
  }
  return Object.freeze({authorize,leaseValid,register});
}

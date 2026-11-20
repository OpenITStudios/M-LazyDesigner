// Strict source-bound admission for the existing Rust Semantic Animation plan.
// This module serializes and verifies typed native proposals; it never edits
// .bbmodel or runs another motion/IK solver.
import {createHash} from 'node:crypto';

const sha=/^[a-f0-9]{64}$/i;
const id=/^[A-Za-z0-9_-]{1,128}$/;
const phases=new Set(['neutral','anticipation','action','impact','recovery',
  'stance','pass','lift','settle','contact']);
const channels=new Set(['rotation','position','scale']);
const clock=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=3600&&
  Math.abs(Number(v.toFixed(9))-v)<=1e-10;
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(x=>
  typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=100000);
const fields=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));

function inputPlan(intent) {
  if(!fields(intent,['expected_revision','animation_uuid','name',
    'length_seconds','loop_mode','poses','contacts'])||
    intent.expected_revision!==0||
    typeof intent.animation_uuid!=='string'||!id.test(intent.animation_uuid)||
    typeof intent.name!=='string'||intent.name!==intent.name.trim()||
    !intent.name||[...intent.name].length>128||
    /[\x00-\x1f\x7f]/.test(intent.name)||
    !clock(intent.length_seconds)||intent.length_seconds<=0||
    !['once','loop','hold'].includes(intent.loop_mode)||
    !Array.isArray(intent.poses)||intent.poses.length<2||
    intent.poses.length>32||!Array.isArray(intent.contacts)||
    intent.contacts.length>16){
    throw new TypeError('CODE_MODE_SEMANTIC_ANIMATION_INPUT_INVALID');
  }
  const operations=[{op:'create_animation',
    uuid:intent.animation_uuid,name:intent.name,length:intent.length_seconds}];
  const trackMap=new Map();
  let previous=-1;
  for(let index=0;index<intent.poses.length;index++){
    const p=intent.poses[index];
    if(!fields(p,['time','phase','transforms'])||
      !clock(p.time)||p.time>intent.length_seconds||p.time-previous<=1e-6||
      !phases.has(p.phase)||!Array.isArray(p.transforms)||
      p.transforms.length<1||p.transforms.length>64)
      throw new TypeError('CODE_MODE_SEMANTIC_ANIMATION_POSE_INVALID');
    previous=p.time;
    const touched=new Set();
    for(const t of p.transforms){
      if(!fields(t,['bone_uuid','channel','value'])||
        typeof t.bone_uuid!=='string'||!id.test(t.bone_uuid)||
        !channels.has(t.channel)||!vec(t.value)||
        (t.channel==='scale'&&t.value.some(v=>v<0||v>100))){
        throw new TypeError('CODE_MODE_SEMANTIC_ANIMATION_TRANSFORM_INVALID');
      }
      const k=t.bone_uuid+'\0'+t.channel;
      if(touched.has(k))
        throw new TypeError('CODE_MODE_SEMANTIC_ANIMATION_TRANSFORM_DUPLICATE');
      touched.add(k);
      const h=createHash('sha256').update(
        'lazydesigner:animation-semantic-poses-v1\0'+intent.animation_uuid+
        '\0'+t.bone_uuid+'\0'+t.channel+'\0'+index).digest('hex');
      const keyframe_uuid=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+
        h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
      operations.push({op:'add_bone_transform_keyframe',
        animation_uuid:intent.animation_uuid,bone_uuid:t.bone_uuid,
        keyframe_uuid,channel:t.channel,time:p.time,value:t.value});
      trackMap.set(k,(trackMap.get(k)??0)+1);
      if(operations.length>=128)
        throw new TypeError('CODE_MODE_SEMANTIC_ANIMATION_OPERATION_BUDGET');
    }
  }
  for(const c of intent.contacts){
    if(!fields(c,['bone_uuid','kind','start','end'])||
      typeof c.bone_uuid!=='string'||!id.test(c.bone_uuid)||
      !['planted','grip'].includes(c.kind)||
      !clock(c.start)||!clock(c.end)||c.start>=c.end||
      c.end>intent.length_seconds||
      ![...trackMap.keys()].some(k=>k.startsWith(c.bone_uuid+'\0')))
      throw new TypeError('CODE_MODE_SEMANTIC_ANIMATION_CONTACT_INVALID');
  }
  operations.push({op:'set_animation_loop_mode',
    animation_uuid:intent.animation_uuid,mode:intent.loop_mode});
  return {operations,trackMap};
}
export function serializeSemanticAnimation(intent){
  inputPlan(intent);
  const payload=JSON.stringify(intent);
  if(Buffer.byteLength(payload,'utf8')>65536)
    throw new TypeError('CODE_MODE_SEMANTIC_ANIMATION_INPUT_TOO_LARGE');
  return payload;
}
export function validSemanticAnimationReceipt(receipt,intent,expectedSha){
  try{
    const {operations,trackMap}=inputPlan(intent);
    const p=receipt?.plan,pre=receipt?.preflight,e=receipt?.motion_evidence;
    if(receipt?.status!=='OK'||typeof receipt.sha256!=='string'||
      !sha.test(receipt.sha256)||receipt.sha256.toLowerCase()!==expectedSha.toLowerCase()||
      receipt.summary?.revision!==0||p?.expected_revision!==0||
      p.correction_scope!==null||!Array.isArray(p.operations)||
      JSON.stringify(p.operations)!==JSON.stringify(operations)||
      pre?.status!=='VALIDATED_NOT_APPLIED'||pre.base_revision!==0||
      pre.mutation?.revision!==1||pre.mutation?.operation_count!==operations.length||
      !Array.isArray(pre.mutation?.changed_uuids)||
      !pre.mutation.changed_uuids.includes(intent.animation_uuid)||
      !sha.test(pre.candidate_sha256)||pre.candidate_summary?.revision!==1||
      pre.write_authority!=='NOT_GRANTED'||pre.visual_verdict!=='UNVERIFIED'||
      receipt.write_authority!=='NOT_GRANTED'||receipt.visual_verdict!=='UNVERIFIED'||
      e?.scope!=='source_bound_semantic_pose_candidate'||
      e.animation_uuid!==intent.animation_uuid||e.loop_mode!==intent.loop_mode||
      e.pose_count!==intent.poses.length||
      e.keyframe_count!==operations.length-2||e.track_count!==trackMap.size||
      e.numeric_motion_verdict!=='AUTHORED_LINEAR_SEGMENTS_ONLY'||
      e.world_contact_verdict!=='UNVERIFIED'||
      e.native_playback_verdict!=='NOT_EXECUTED'||
      e.visual_verdict!=='UNVERIFIED'||e.write_authority!=='NOT_GRANTED'||
      !Array.isArray(e.tracks)||e.tracks.length!==trackMap.size||
      !Array.isArray(e.contact_windows)||
      e.contact_windows.length!==intent.contacts.length||
      !Array.isArray(e.temporal_review_times)||
      e.temporal_review_times.length<2||e.temporal_review_times.length>8||
      e.temporal_review_times.some((t,i)=>!clock(t)||t>intent.length_seconds||
        (i>0&&t-e.temporal_review_times[i-1]<=1e-9))||
      !e.temporal_review_times.includes(0)||
      !e.temporal_review_times.includes(intent.length_seconds)
    )return false;
    const seen=new Set();
    for(const t of e.tracks){
      const k=t?.bone_uuid+'\0'+t?.channel;
      if(seen.has(k)||trackMap.get(k)!==t.key_count||
        typeof t.maximum_authored_segment_speed!=='number'||
        !Number.isFinite(t.maximum_authored_segment_speed)||
        t.maximum_authored_segment_speed<0||
        typeof t.has_large_euler_step!=='boolean'||
        !(t.loop_endpoint_equal===null||typeof t.loop_endpoint_equal==='boolean')||
        !(t.loop_endpoint_velocity_delta===null||
          (typeof t.loop_endpoint_velocity_delta==='number'&&
           Number.isFinite(t.loop_endpoint_velocity_delta)&&t.loop_endpoint_velocity_delta>=0)))
        return false;
      seen.add(k);
    }
    for(let i=0;i<intent.contacts.length;i++){
      const c=intent.contacts[i],v=e.contact_windows[i];
      if(v?.bone_uuid!==c.bone_uuid||v.kind!==c.kind||
        v.start!==c.start||v.end!==c.end||
        v.observed_world_samples!==0||
        v.contact_verdict!=='REQUIRES_NATIVE_WORLD_SPACE_OBSERVATION')
        return false;
    }
    return true;
  }catch{return false;}
}

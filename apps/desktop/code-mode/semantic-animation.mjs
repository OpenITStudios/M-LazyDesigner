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
  const followers=intent?.followers??[];
  if(Object.hasOwn(intent??{},'followers')&&!Array.isArray(intent.followers)){
    throw new TypeError('CODE_MODE_SEMANTIC_FOLLOWER_INPUT_INVALID');
  }
  const base=['expected_revision','animation_uuid','name',
    'length_seconds','loop_mode','poses','contacts'];
  if(!fields(intent,Object.hasOwn(intent??{},'followers')?
      [...base,'followers']:base)||
    intent.expected_revision!==0||
    typeof intent.animation_uuid!=='string'||!id.test(intent.animation_uuid)||
    typeof intent.name!=='string'||intent.name!==intent.name.trim()||
    !intent.name||[...intent.name].length>128||
    /[\x00-\x1f\x7f]/.test(intent.name)||
    !clock(intent.length_seconds)||intent.length_seconds<=0||
    !['once','loop','hold'].includes(intent.loop_mode)||
    !Array.isArray(intent.poses)||intent.poses.length<2||
    intent.poses.length>32||!Array.isArray(intent.contacts)||
    intent.contacts.length>16||
    !Array.isArray(followers)||followers.length>8){
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
  const assigned=new Set();
  for(const f of followers){
    if(!fields(f,['driver_bone_uuid','follower_bone_uuid',
      'channel','lag_seconds','gain','rest_value'])||
      typeof f.driver_bone_uuid!=='string'||!id.test(f.driver_bone_uuid)||
      typeof f.follower_bone_uuid!=='string'||!id.test(f.follower_bone_uuid)||
      f.driver_bone_uuid===f.follower_bone_uuid||
      !['rotation','position'].includes(f.channel)||
      !clock(f.lag_seconds)||f.lag_seconds<=1e-6||
      f.lag_seconds>intent.length_seconds*0.5||
      typeof f.gain!=='number'||!Number.isFinite(f.gain)||
      Math.abs(f.gain)<1e-9||Math.abs(f.gain)>2||!vec(f.rest_value)||
      !trackMap.has(f.driver_bone_uuid+'\0'+f.channel)||
      trackMap.has(f.follower_bone_uuid+'\0'+f.channel)||
      assigned.has(f.follower_bone_uuid+'\0'+f.channel)||
      intent.contacts.some(c=>c.bone_uuid===f.follower_bone_uuid)) {
      throw new TypeError('CODE_MODE_SEMANTIC_FOLLOWER_INPUT_INVALID');
    }
    assigned.add(f.follower_bone_uuid+'\0'+f.channel);
  }
  operations.push({op:'set_animation_loop_mode',
    animation_uuid:intent.animation_uuid,mode:intent.loop_mode});
  return {operations,trackMap,followers};
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
    const {operations,trackMap,followers}=inputPlan(intent);
    const p=receipt?.plan,pre=receipt?.preflight,e=receipt?.motion_evidence;
    const declared=operations.slice(0,-1);
    // Only the trusted Rust CLI produces the derived values. The SDK checks
    // exact authorized targets/IDs/time bounds without becoming a second
    // animation solver or treating a transport receipt as motion proof.
    const planned=p?.operations;
    const prefix=Array.isArray(planned)?
      planned.slice(0,declared.length):[];
    const end=Array.isArray(planned)?planned.at(-1):null;
    let secondary=[];
    const expectedTracks=new Map(trackMap);
    if(Array.isArray(planned)&&
       JSON.stringify(prefix)===JSON.stringify(declared)&&
       JSON.stringify(end)===JSON.stringify(operations.at(-1))&&
       planned.length<=128) {
      let index=declared.length;
      const endIndex=planned.length-1;
      for(const f of followers){
        const items=[];
        while(index<endIndex&&
          planned[index]?.bone_uuid===f.follower_bone_uuid&&
          planned[index]?.channel===f.channel){
          const op=planned[index++];
          const h=createHash('sha256').update(
            'lazydesigner:animation-semantic-poses-v1\0'+intent.animation_uuid+
            '\0'+f.follower_bone_uuid+'\0'+f.channel+'\0'+items.length).digest('hex');
          const uid=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
            '-8'+h.slice(17,20)+'-'+h.slice(20,32);
          if(!fields(op,['op','animation_uuid','bone_uuid','keyframe_uuid',
            'channel','time','value'])||
            op.op!=='add_bone_transform_keyframe'||
            op.animation_uuid!==intent.animation_uuid||
            op.keyframe_uuid!==uid||!clock(op.time)||
            op.time>intent.length_seconds||!vec(op.value)||
            (items.length>0&&op.time-items.at(-1).time<=1e-6)){
            index=endIndex+1;break;
          }
          items.push(op);
        }
        if(index>endIndex||items.length<3||
          items[0].time!==0||items.at(-1).time!==intent.length_seconds||
          items[0].value.some((v,a)=>
            Math.abs(v-items.at(-1).value[a])>1e-6)) {
          secondary=[];break;
        }
        // On one-shot or held motion, the source is required by Rust to
        // settle by length-lag; the follower must start/end at declared rest.
        if(intent.loop_mode!=='loop'&&
          items[0].value.some((v,a)=>Math.abs(v-f.rest_value[a])>1e-6)){
          secondary=[];break;
        }
        secondary.push(items);
        expectedTracks.set(f.follower_bone_uuid+'\0'+f.channel,items.length);
      }
      if(index!==endIndex)secondary=[];
    }
    const eligible=Array.isArray(planned)&&
      JSON.stringify(prefix)===JSON.stringify(declared)&&
      JSON.stringify(end)===JSON.stringify(operations.at(-1))&&
      (followers.length?secondary.length===followers.length:
        JSON.stringify(planned)===JSON.stringify(operations));
    const totalOperations=Array.isArray(planned)?planned.length:0;
    if(!eligible||receipt?.status!=='OK'||typeof receipt.sha256!=='string'||
      !sha.test(receipt.sha256)||receipt.sha256.toLowerCase()!==expectedSha.toLowerCase()||
      receipt.summary?.revision!==0||p?.expected_revision!==0||
      p.correction_scope!==null||!Array.isArray(p.operations)||
      pre?.status!=='VALIDATED_NOT_APPLIED'||pre.base_revision!==0||
      pre.mutation?.revision!==1||pre.mutation?.operation_count!==totalOperations||
      !Array.isArray(pre.mutation?.changed_uuids)||
      !pre.mutation.changed_uuids.includes(intent.animation_uuid)||
      !sha.test(pre.candidate_sha256)||pre.candidate_summary?.revision!==1||
      pre.write_authority!=='NOT_GRANTED'||pre.visual_verdict!=='UNVERIFIED'||
      receipt.write_authority!=='NOT_GRANTED'||receipt.visual_verdict!=='UNVERIFIED'||
      e?.scope!=='source_bound_semantic_pose_candidate'||
      e.animation_uuid!==intent.animation_uuid||e.loop_mode!==intent.loop_mode||
      e.pose_count!==intent.poses.length||
      e.keyframe_count!==totalOperations-2||e.track_count!==expectedTracks.size||
      e.numeric_motion_verdict!=='AUTHORED_LINEAR_SEGMENTS_ONLY'||
      e.world_contact_verdict!=='UNVERIFIED'||
      e.native_playback_verdict!=='NOT_EXECUTED'||
      e.visual_verdict!=='UNVERIFIED'||e.write_authority!=='NOT_GRANTED'||
      !Array.isArray(e.tracks)||e.tracks.length!==expectedTracks.size||
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
      if(seen.has(k)||expectedTracks.get(k)!==t.key_count||
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
    if(followers.length){
      if(e.secondary_verdict!=='SOURCE_LINEAR_LAG_ONLY'||
        !Array.isArray(e.secondary_followers)||
        e.secondary_followers.length!==followers.length)return false;
      for(let i=0;i<followers.length;i++){
        const f=followers[i],report=e.secondary_followers[i],keys=secondary[i];
        if(report?.driver_bone_uuid!==f.driver_bone_uuid||
          report.follower_bone_uuid!==f.follower_bone_uuid||
          report.channel!==f.channel||report.lag_seconds!==f.lag_seconds||
          report.gain!==f.gain||
          JSON.stringify(report.rest_value)!==JSON.stringify(f.rest_value)||
          report.driver_key_count!==trackMap.get(f.driver_bone_uuid+'\0'+f.channel)||
          report.derived_key_count!==keys.length||
          report.sampling_model!=='SOURCE_LINEAR_DELAYED_DELTA'||
          report.contact_verdict!=='UNVERIFIED'||
          report.loop_or_settle_endpoint_values_equal!==true)return false;
      }
    }else if(e.secondary_verdict!==undefined||
      e.secondary_followers!==undefined)return false;
    return true;
  }catch{return false;}
}

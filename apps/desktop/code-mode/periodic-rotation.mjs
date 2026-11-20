// A1 strict read-only periodic motion SDK admission. Rust alone generates
// the numeric motion and owns the canonical preflight/editable keyframes.
import {createHash} from 'node:crypto';
const sha=/^[0-9a-f]{64}$/i,id=/^[A-Za-z0-9_-]{1,128}$/;
const schema=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(x=>
  typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=100000);
export function serializePeriodicRotation(r){
  if(!schema(r,['expected_revision','animation_uuid','name','length_seconds',
     'max_error_degrees','tracks'])||r.expected_revision!==0||
     typeof r.animation_uuid!=='string'||!id.test(r.animation_uuid)||
     typeof r.name!=='string'||r.name!==r.name.trim()||
     !r.name||[...r.name].length>128||/[\x00-\x1f\x7f]/.test(r.name)||
     typeof r.length_seconds!=='number'||!Number.isFinite(r.length_seconds)||
     r.length_seconds<=0||r.length_seconds>3600||
     Math.abs(Number(r.length_seconds.toFixed(9))-r.length_seconds)>1e-10||
     typeof r.max_error_degrees!=='number'||!Number.isFinite(r.max_error_degrees)||
     r.max_error_degrees<=0||!Array.isArray(r.tracks)||
     r.tracks.length<1||r.tracks.length>25) {
    throw new TypeError('CODE_MODE_PERIODIC_ROTATION_INTENT_INVALID');
  }
  const seen=new Set();
  for(const t of r.tracks){
    if(!schema(t,['bone_uuid','base_rotation','amplitude','phase_degrees'])||
       typeof t.bone_uuid!=='string'||!id.test(t.bone_uuid)||
       seen.has(t.bone_uuid)||!vec(t.base_rotation)||!vec(t.amplitude)||
       t.amplitude.every(v=>v===0)||typeof t.phase_degrees!=='number'||
       !Number.isFinite(t.phase_degrees)||Math.abs(t.phase_degrees)>100000)
      throw new TypeError('CODE_MODE_PERIODIC_ROTATION_INTENT_INVALID');
    seen.add(t.bone_uuid);
  }
  const value=JSON.stringify(r);
  if(Buffer.byteLength(value,'utf8')>65536)
    throw new TypeError('CODE_MODE_PERIODIC_ROTATION_INTENT_TOO_LARGE');
  return value;
}
function key(clip,bone,tick){
  const h=createHash('sha256').update(
    'lazydesigner:animation-periodic-rotation-v1\0'+clip+'\0'+bone+'\0'+tick)
    .digest('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
    '-8'+h.slice(17,20)+'-'+h.slice(20,32);
}
export function validPeriodicRotationReceipt(r,intent,expectedSha){
  const ops=r?.plan?.operations,p=r?.preflight,e=r?.motion_evidence;
  if(r?.status!=='OK'||typeof r.sha256!=='string'||
     r.sha256.toLowerCase()!==expectedSha.toLowerCase()||
     r.summary?.revision!==0||r.plan?.expected_revision!==0||
     r.plan?.correction_scope!==null||
     !Array.isArray(ops)||ops.length<7||ops.length>128||
     p?.status!=='VALIDATED_NOT_APPLIED'||p.base_revision!==0||
     p.mutation?.revision!==1||p.mutation?.operation_count!==ops.length||
     p.candidate_summary?.revision!==1||
     typeof p.candidate_sha256!=='string'||!sha.test(p.candidate_sha256)||
     p.write_authority!=='NOT_GRANTED'||p.visual_verdict!=='UNVERIFIED'||
     r.write_authority!=='NOT_GRANTED'||r.visual_verdict!=='UNVERIFIED'||
     e?.scope!=='source_bound_periodic_bone_rotation_candidate'||
     e.animation_uuid!==intent.animation_uuid||
     e.sampling_strategy!=='conservative_scalar_linear_sine_chord'||
     e.max_error_degrees!==intent.max_error_degrees||
     e.loop_mode!=='loop'||e.track_count!==intent.tracks.length||
     !Array.isArray(e.tracks)||e.tracks.length!==intent.tracks.length||
     e.source_identity!=='EXACT_SAVED_BONE_UUIDS'||
     e.pose_contact_verdict!=='UNVERIFIED'||
     e.continuous_euler_motion_verdict!=='SCALAR_LINEAR_BOUND_ONLY'||
     e.native_playback_verdict!=='NOT_EXECUTED'||
     e.visual_verdict!=='UNVERIFIED'||e.write_authority!=='NOT_GRANTED'||
     !Number.isSafeInteger(e.keyframe_count)||
     !schema(ops[0],['op','uuid','name','length'])||
     ops[0].op!=='create_animation'||ops[0].uuid!==intent.animation_uuid||
     ops[0].name!==intent.name||ops[0].length!==intent.length_seconds||
     !schema(ops.at(-1),['op','animation_uuid','mode'])||
     ops.at(-1).op!=='set_animation_loop_mode'||
     ops.at(-1).animation_uuid!==intent.animation_uuid||
     ops.at(-1).mode!=='loop')return false;
  let cursor=1,total=0; const changed=[intent.animation_uuid];
  for(let i=0;i<intent.tracks.length;i++){
    const track=intent.tracks[i],entry=e.tracks[i],n=entry?.segments;
    if(!Number.isSafeInteger(n)||n<4||n>64||(n&(n-1))!==0||
       !schema(entry,['bone_uuid','segments','keyframe_count',
          'conservative_scalar_error_bound_degrees','seam_endpoint_values_identical'])||
       entry.bone_uuid!==track.bone_uuid||entry.keyframe_count!==n+1||
       entry.seam_endpoint_values_identical!==true||
       typeof entry.conservative_scalar_error_bound_degrees!=='number'||
       !Number.isFinite(entry.conservative_scalar_error_bound_degrees)||
       entry.conservative_scalar_error_bound_degrees<0||
       entry.conservative_scalar_error_bound_degrees>intent.max_error_degrees)
      return false;
    let first=null,last=null,previous=-1;
    for(let j=0;j<=n;j++){
      const op=ops[cursor++];
      if(!schema(op,['op','animation_uuid','bone_uuid','keyframe_uuid',
            'channel','time','value'])||
         op.op!=='add_bone_transform_keyframe'||
         op.animation_uuid!==intent.animation_uuid||
         op.bone_uuid!==track.bone_uuid||op.channel!=='rotation'||
         op.keyframe_uuid!==key(intent.animation_uuid,track.bone_uuid,
           j*(65536/n))||!vec(op.value)||typeof op.time!=='number'||
         !Number.isFinite(op.time)||
         Math.abs(op.time-intent.length_seconds*j/n)>1e-8||
         op.time<=previous)return false;
      previous=op.time;
      if(j===0)first=op.value;
      if(j===n)last=op.value;
      changed.push(op.keyframe_uuid);
    }
    if(!first.every((v,j)=>v===last[j]))return false;
    total+=n+1;
  }
  return cursor===ops.length-1&&total===e.keyframe_count&&
    Array.isArray(p.mutation.changed_uuids)&&
    JSON.stringify(changed)===JSON.stringify(p.mutation.changed_uuids);
}

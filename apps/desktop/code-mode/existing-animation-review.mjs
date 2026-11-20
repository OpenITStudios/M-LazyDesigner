// Strict transport admission for Rust's existing saved-Animation review.
// This does not compute motion, alter clips, call a renderer or grant writes.
// A correction is source-key bound and only Rust creates/preflights EditPlan.
const sha=/^[0-9a-f]{64}$/i;
const id=/^[A-Za-z0-9_-]{1,128}$/;
const channels=new Set(['rotation','position','scale']);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).length===keys.length&&
  Object.keys(value).every(k=>keys.includes(k));
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(n=>
  typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
const clock=v=>typeof v==='number'&&Number.isFinite(v)&&
  v>=0&&v<=3600;
const number=v=>typeof v==='number'&&Number.isFinite(v);
const identity=v=>typeof v==='string'&&id.test(v);
const allowedCorrection=(c)=>{
  if(c?.kind==='close_loop_endpoint'){
    return exact(c,['kind','bone_uuid','channel','start_keyframe_uuid',
      'end_keyframe_uuid','expected_start_value','expected_end_value',
      'max_axis_delta'])&&identity(c.bone_uuid)&&channels.has(c.channel)&&
      identity(c.start_keyframe_uuid)&&identity(c.end_keyframe_uuid)&&
      c.start_keyframe_uuid!==c.end_keyframe_uuid&&
      vec(c.expected_start_value)&&vec(c.expected_end_value)&&
      number(c.max_axis_delta)&&c.max_axis_delta>0&&c.max_axis_delta<=0.05;
  }
  if(c?.kind==='replace_exact_key'){
    return exact(c,['kind','bone_uuid','channel','keyframe_uuid',
      'expected_time','expected_value','replacement_value','max_axis_delta'])&&
      identity(c.bone_uuid)&&channels.has(c.channel)&&
      identity(c.keyframe_uuid)&&clock(c.expected_time)&&
      vec(c.expected_value)&&vec(c.replacement_value)&&
      (c.channel!=='scale'||c.replacement_value.every(x=>x>=0&&x<=100))&&
      number(c.max_axis_delta)&&c.max_axis_delta>0&&c.max_axis_delta<=100000;
  }
  return false;
};
export function serializeExistingAnimationIntent(intent){
  const has=Object.hasOwn(intent??{},'correction');
  if(!exact(intent,has?['expected_revision','animation_uuid','correction']:
      ['expected_revision','animation_uuid'])||
    intent.expected_revision!==0||!identity(intent.animation_uuid)||
    (has&&!allowedCorrection(intent.correction))){
    throw new TypeError('CODE_MODE_EXISTING_ANIMATION_INTENT_INVALID');
  }
  const data=JSON.stringify(intent);
  if(Buffer.byteLength(data,'utf8')>65536){
    throw new TypeError('CODE_MODE_EXISTING_ANIMATION_INTENT_TOO_LARGE');
  }
  return data;
}
const goodAnalysis=(a,intent)=>{
  if(a?.scope!=='source_bound_existing_numeric_animation_review'||
    a.animation_uuid!==intent.animation_uuid||
    a.visual_verdict!=='UNVERIFIED'||a.native_playback_verdict!=='NOT_EXECUTED'||
    a.write_authority!=='NOT_GRANTED'||a.truncated!==Boolean(a.truncated)||
    !Array.isArray(a.issues)||!Array.isArray(a.track_summaries)||
    a.issues.length>16||a.track_summaries.length>24){
    return false;
  }
  if(a.recognized===false){
    return a.status==='unsupported'&&a.reason==='OPAQUE_OR_UNSUPPORTED_CLIP'&&
      a.issues_total===null&&a.tracks_total===null&&a.keyframe_count===null&&
      a.issues.length===0&&a.track_summaries.length===0&&
      a.truncated===false;
  }
  if(a.recognized!==true||
    !['needs_review','no_source_candidates'].includes(a.status)||
    !['once','loop','hold'].includes(a.loop_mode)||
    !clock(a.length_seconds)||!Number.isSafeInteger(a.tracks_total)||
    a.tracks_total<0||!Number.isSafeInteger(a.keyframe_count)||
    a.keyframe_count<0||!Number.isSafeInteger(a.issues_total)||
    a.issues_total<a.issues.length||
    a.track_summaries.length> a.tracks_total||
    a.analysis_limit!=='NUMERIC_SAVED_KEYS_ONLY'||
    (a.issues_total===0&&a.status!=='no_source_candidates')||
    (a.issues_total>0&&a.status!=='needs_review')){
    return false;
  }
  for(const issue of a.issues){
    if(!['euler_winding_unresolved','loop_boundary_not_explicit',
      'loop_endpoint_value_difference'].includes(issue?.kind)||
      !identity(issue.bone_uuid)||!channels.has(issue.channel)||
      (issue.kind==='loop_endpoint_value_difference'&&
        (issue.native_continuity!=='UNVERIFIED'||
         !identity(issue.start_keyframe_uuid)||!identity(issue.end_keyframe_uuid)||
         !vec(issue.start_value)||!vec(issue.end_value)||
         !number(issue.max_abs_axis_delta)||
         typeof issue.bounded_close_candidate!=='boolean'))||
      (issue.kind!=='loop_endpoint_value_difference'&&
       issue.automatic_correction!=='NOT_SAFE'))return false;
  }
  for(const t of a.track_summaries){
    if(!identity(t?.bone_uuid)||!channels.has(t.channel)||
      !Number.isSafeInteger(t.key_count)||t.key_count<1||
      !clock(t.first_time)||!clock(t.last_time)||
      t.first_time>t.last_time||
      typeof t.contains_nonlinear_keys!=='boolean'||
      (t.contains_nonlinear_keys?
        t.max_authored_linear_segment_speed!==null:
        !number(t.max_authored_linear_segment_speed)))return false;
  }
  return true;
};
export function validExistingAnimationReviewReceipt(r,intent,digest){
  try{
    serializeExistingAnimationIntent(intent);
    const a=r?.analysis;
    if(r?.status!=='OK'||typeof r.sha256!=='string'||
      !sha.test(r.sha256)||r.sha256.toLowerCase()!==digest.toLowerCase()||
      r.summary?.revision!==0||r.visual_verdict!=='UNVERIFIED'||
      r.write_authority!=='NOT_GRANTED'||!goodAnalysis(a,intent)){
      return false;
    }
    if(intent.correction===undefined){
      return r.plan===null&&r.preflight===null&&r.correction_evidence===null;
    }
    if(a.recognized!==true||r.plan?.expected_revision!==0||
      r.plan.correction_scope!==null||!Array.isArray(r.plan.operations)||
      r.plan.operations.length!==1)return false;
    const op=r.plan.operations[0],pre=r.preflight,e=r.correction_evidence,
      c=intent.correction;
    const key=c.kind==='close_loop_endpoint'?c.end_keyframe_uuid:c.keyframe_uuid;
    const expectedBefore=c.kind==='close_loop_endpoint'?
      c.expected_end_value:c.expected_value;
    const expectedAfter=c.kind==='close_loop_endpoint'?
      c.expected_start_value:c.replacement_value;
    const targetTime=c.kind==='close_loop_endpoint'?a.length_seconds:c.expected_time;
    const maxDelta=Math.max(...expectedAfter.map((v,i)=>
      Math.abs(v-expectedBefore[i])));
    if(!exact(op,['op','animation_uuid','bone_uuid','keyframe_uuid',
        'channel','time','value'])||
      op.op!=='update_bone_transform_keyframe'||
      op.animation_uuid!==intent.animation_uuid||
      op.bone_uuid!==c.bone_uuid||op.channel!==c.channel||
      op.keyframe_uuid!==key||op.time!==targetTime||
      JSON.stringify(op.value)!==JSON.stringify(expectedAfter)||
      maxDelta<=1e-9||maxDelta>c.max_axis_delta||
      (c.kind==='close_loop_endpoint'&&
        (a.loop_mode!=='loop'||maxDelta>0.05))||
      pre?.status!=='VALIDATED_NOT_APPLIED'||pre.base_revision!==0||
      pre.mutation?.revision!==1||pre.mutation?.operation_count!==1||
      JSON.stringify(pre.mutation?.changed_uuids)!==JSON.stringify([key])||
      typeof pre.candidate_sha256!=='string'||!sha.test(pre.candidate_sha256)||
      pre.candidate_summary?.revision!==1||
      pre.visual_verdict!=='UNVERIFIED'||pre.write_authority!=='NOT_GRANTED'||
      e?.scope!=='source_bound_existing_animation_key_correction'||
      e.kind!==c.kind||e.animation_uuid!==intent.animation_uuid||
      e.bone_uuid!==c.bone_uuid||e.channel!==c.channel||
      e.keyframe_uuid!==key||e.time!==targetTime||
      JSON.stringify(e.source_before)!==JSON.stringify(expectedBefore)||
      JSON.stringify(e.replacement)!==JSON.stringify(expectedAfter)||
      e.max_axis_delta!==c.max_axis_delta||
      e.source_authority!=='EXACT_SAVED_NUMERIC_KEY'||
      e.native_playback_verdict!=='NOT_EXECUTED'||
      e.visual_verdict!=='UNVERIFIED'||e.write_authority!=='NOT_GRANTED'){
      return false;
    }
    return true;
  }catch{return false}
}

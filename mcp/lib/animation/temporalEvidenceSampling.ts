import type { AnimationMotionTrackInput } from "./motionDynamics";

/**
 * IMAGE-FREE candidate event times from authored numeric keyframe deltas.
 * This never evaluates interpolation, MoLang, controllers or native playback
 * and cannot authorize temporal or visual PASS.
 */
type Pick={time:number;score:number;id:string;segment:string};
type FocusWindow={start:number;end:number};
const round=(v:number)=>Number(v.toFixed(6));
const valid=(v:readonly unknown[])=>
  Array.isArray(v)&&v.length>=3&&v.slice(0,3).every(
    x=>typeof x==="number"&&Number.isFinite(x));
function distance(channel:AnimationMotionTrackInput["channel"],
  a:readonly unknown[],b:readonly unknown[]):number {
  return Math.hypot(...[0,1,2].map(i=>{
    const delta=(b[i] as number)-(a[i] as number);
    // Preserve full-turn authored motion. Without interpolation provenance
    // this is a prioritization heuristic, not a direction/arc certificate.
    return channel==="rotation"&&Math.abs(delta)<180
      ? ((delta+180)%360+360)%360-180:delta;
  }));
}
export function planTemporalImageEvidence(input:{
  duration_seconds:number;
  tracks:readonly AnimationMotionTrackInput[];
  max_frames?:number;
  focus_bone_uuid?:string;
  focus_time_range?:FocusWindow;
}){
  const unavailable=(reason:string)=>({
    state:"UNAVAILABLE" as const,reason,
    suggested_times_seconds:[] as number[],
    visual_pass_authorized:false as const,
    all_motion_observed:false as const,
  });
  const duration=input?.duration_seconds,budget=input?.max_frames??5;
  if(!Number.isFinite(duration)||duration<1e-6||duration>10000||
     !Number.isInteger(budget)||budget<2||budget>5||
     !Array.isArray(input?.tracks)||input.tracks.length>128)
    return unavailable("INVALID_TEMPORAL_SAMPLING_INPUT");
  const focus=input.focus_time_range;
  if(focus && (!Number.isFinite(focus.start)||!Number.isFinite(focus.end)||
      focus.start<0||focus.end>duration||focus.end-focus.start<1e-6))
    return unavailable("INVALID_FOCUSED_TEMPORAL_WINDOW");
  const start=focus?.start??0,end=focus?.end??duration;
  const startRounded=round(start),endRounded=round(end);
  if(!(startRounded<endRounded))
    return unavailable("FOCUSED_TEMPORAL_WINDOW_LOST_PRECISION");
  if(input.focus_bone_uuid!==undefined &&
     (!input.focus_bone_uuid.trim()||input.focus_bone_uuid.length>160))
    return unavailable("INVALID_FOCUSED_BONE_ID");
  if(input.tracks.reduce((n,t)=>n+
    (Array.isArray(t?.keyframes)?t.keyframes.length:4097),0)>4096)
    return unavailable("TEMPORAL_KEYFRAME_BUDGET_EXCEEDED");

  const tracks=input.focus_bone_uuid
    ? input.tracks.filter(t=>t.group_uuid===input.focus_bone_uuid)
    : input.tracks;
  if(tracks.length===0)return unavailable(
    input.focus_bone_uuid?"FOCUSED_BONE_HAS_NO_TRACKS":"NO_AUTHORED_MOTION_TRACKS"
  );

  const candidates:Pick[]=[];
  let unresolved_segments=0,numeric_segments=0;
  for(const track of tracks){
    if(!Array.isArray(track?.keyframes)||
       !["rotation","position","scale"].includes(track.channel)){
      unresolved_segments++;continue;
    }
    // Include keys bracketing the requested interval so the midpoint in
    // a focused region can be suggested even if neither key is inside it.
    const keys=track.keyframes.filter(k=>
      Number.isFinite(k.time)&&k.time>=0&&k.time<=duration)
      .slice().sort((a,b)=>a.time-b.time);
    for(let i=1;i<keys.length;i++){
      const a=keys[i-1]!,b=keys[i]!,dt=b.time-a.time;
      if(b.time<=start||a.time>=end)continue;
      if(dt<=0||a.data_point_count!==1||b.data_point_count!==1||
         !valid(a.value)||!valid(b.value)){
        unresolved_segments++;continue;
      }
      numeric_segments++;
      const delta=distance(track.channel,a.value,b.value);
      if(delta<=1e-8)continue;
      const segmentStart=Math.max(start,a.time),segmentEnd=Math.min(end,b.time);
      if(segmentEnd-segmentStart<1e-6)continue;
      // Relative ranking only. Degrees and model units are not equivalent.
      const scale=track.channel==="rotation"?45:
        track.channel==="scale"?0.5:1;
      const score=Math.min(1e6,delta/(scale*dt));
      const segment=[track.group_uuid,track.channel,a.time,b.time].join("|");
      const midpoint=round((segmentStart+segmentEnd)/2);
      const keyTime=round(b.time);
      if(midpoint>startRounded&&midpoint<endRounded)candidates.push({
        time:midpoint,score,id:track.group_uuid,segment,
      });
      if(keyTime>startRounded&&keyTime<endRounded)candidates.push({
        time:keyTime,score:score*0.55,id:track.group_uuid,segment,
      });
    }
  }
  if(numeric_segments===0)return unavailable("NO_NUMERIC_KEYFRAME_INTERVALS_IN_SCOPE");
  // No actual numeric delta: returning start/end as motion-review candidates
  // would encourage two redundant images without a grounded motion event.
  // This does not certify static motion (Bezier/Molang remain unknown).
  if(candidates.length===0)return unavailable("NO_DETECTABLE_NUMERIC_MOTION_EVENT");
  const byTime=new Map<number,Pick>();
  for(const c of candidates)if(!byTime.has(c.time)||
    byTime.get(c.time)!.score<c.score)byTime.set(c.time,c);
  const ranked=[...byTime.values()].sort((a,b)=>
    b.score-a.score||a.time-b.time||a.id.localeCompare(b.id));
  const times=[startRounded,endRounded];
  const selectedSegments=new Set<string>();
  // First choose distinct motion segments instead of paying for two close
  // frames from one interval while another risky interval is unobserved.
  for(const candidate of ranked){
    if(times.length>=budget)break;
    if(selectedSegments.has(candidate.segment)||times.includes(candidate.time))continue;
    times.push(candidate.time);
    selectedSegments.add(candidate.segment);
  }
  // Fill remaining slots only when additional events were actually authored.
  for(const candidate of ranked){
    if(times.length>=budget)break;
    if(!times.includes(candidate.time))times.push(candidate.time);
  }
  times.sort((a,b)=>a-b);
  return {
    state:"CANDIDATE_ONLY" as const,
    source:"AUTHORED_NUMERIC_KEYFRAME_DELTAS" as const,
    suggested_times_seconds:times,
    ...(focus?{focus_time_range:{start,end}}:{}),
    ...(input.focus_bone_uuid?{focus_bone_uuid:input.focus_bone_uuid}:{}),
    numeric_segments,unresolved_segments,budget_frames:budget,
    max_model_views_without_masks:Math.floor(8/times.length),
    image_budget_is_advisory:true as const,
    interpolated_pose_evaluated:false as const,
    all_motion_observed:false as const,
    ai_pixel_perception_attested:false as const,
    visual_pass_authorized:false as const,
    note:"Only candidate event times for the scoped bone/window. Use actual current-revision PNGs when needed, enforce native view x time x mask budget and do not infer continuous motion.",
  };
}

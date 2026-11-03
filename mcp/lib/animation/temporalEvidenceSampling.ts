import type { AnimationMotionTrackInput } from "./motionDynamics";

/**
 * Cheap IMAGE-FREE candidate timestamps from authored numeric keys.
 * Never certify interpolated poses, MoLang, controllers or motion quality.
 */
type Pick={time:number;score:number;id:string};
const round=(v:number)=>Number(v.toFixed(6));
const valid=(v:readonly unknown[])=>
  Array.isArray(v)&&v.length>=3&&v.slice(0,3).every(
    x=>typeof x==="number"&&Number.isFinite(x));
function distance(channel:AnimationMotionTrackInput["channel"],
  a:readonly unknown[],b:readonly unknown[]):number {
  return Math.hypot(...[0,1,2].map(i=>{
    const delta=(b[i] as number)-(a[i] as number);
    return channel==="rotation"?((delta+180)%360+360)%360-180:delta;
  }));
}
export function planTemporalImageEvidence(input:{
  duration_seconds:number;
  tracks:readonly AnimationMotionTrackInput[];
  max_frames?:number;
}){
  const unavailable=(reason:string)=>({
    state:"UNAVAILABLE" as const,reason,
    suggested_times_seconds:[] as number[],
    visual_pass_authorized:false as const,
    all_motion_observed:false as const,
  });
  const duration=input?.duration_seconds,budget=input?.max_frames??5;
  if(!Number.isFinite(duration)||duration<=0||duration>10000||
     !Number.isInteger(budget)||budget<2||budget>5||
     !Array.isArray(input?.tracks)||input.tracks.length>128)
    return unavailable("INVALID_TEMPORAL_SAMPLING_INPUT");
  if(input.tracks.reduce((n,t)=>n+
    (Array.isArray(t?.keyframes)?t.keyframes.length:4097),0)>4096)
    return unavailable("TEMPORAL_KEYFRAME_BUDGET_EXCEEDED");

  const candidates:Pick[]=[];
  let unresolved_segments=0,numeric_segments=0;
  for(const track of input.tracks){
    if(!Array.isArray(track?.keyframes)||
       !["rotation","position","scale"].includes(track.channel)){
      unresolved_segments++;continue;
    }
    const keys=track.keyframes.filter(k=>
      Number.isFinite(k.time)&&k.time>=0&&k.time<=duration)
      .slice().sort((a,b)=>a.time-b.time);
    for(let i=1;i<keys.length;i++){
      const a=keys[i-1]!,b=keys[i]!,dt=b.time-a.time;
      if(dt<=0||a.data_point_count!==1||b.data_point_count!==1||
         !valid(a.value)||!valid(b.value)){
        unresolved_segments++;continue;
      }
      numeric_segments++;
      const delta=distance(track.channel,a.value,b.value);
      if(delta<=1e-8)continue;
      // Relative heuristic, NOT a physics or velocity certificate.
      const scale=track.channel==="rotation"?45:
        track.channel==="scale"?0.5:1;
      const score=Math.min(1e6,delta/(scale*dt));
      const mid=round((a.time+b.time)/2),end=round(b.time);
      if(mid>0&&mid<duration)candidates.push({
        time:mid,score,id:track.group_uuid});
      if(end>0&&end<duration)candidates.push({
        time:end,score:score*0.55,id:track.group_uuid});
    }
  }
  const byTime=new Map<number,Pick>();
  for(const c of candidates)if(!byTime.has(c.time)||
    byTime.get(c.time)!.score<c.score)byTime.set(c.time,c);
  const ranked=[...byTime.values()].sort((a,b)=>
    b.score-a.score||a.time-b.time||a.id.localeCompare(b.id));
  const times=[0,round(duration)];
  for(const c of ranked){
    if(times.length>=budget)break;
    if(!times.includes(c.time))times.push(c.time);
  }
  times.sort((a,b)=>a-b);
  return {
    state:"CANDIDATE_ONLY" as const,
    source:"AUTHORED_NUMERIC_KEYFRAME_DELTAS" as const,
    suggested_times_seconds:times,
    numeric_segments,unresolved_segments,
    budget_frames:budget,
    interpolated_pose_evaluated:false as const,
    all_motion_observed:false as const,
    ai_pixel_perception_attested:false as const,
    visual_pass_authorized:false as const,
    note:"Candidates only; capture explicitly for a specific visual question. Enforce views x times x optional silhouette <=8. Unsampled motion remains UNVERIFIED.",
  };
}

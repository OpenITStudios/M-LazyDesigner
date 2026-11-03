/**
 * Pure image-free metadata contract. Runtime must actually observe Blockbench
 * at requested event times; this helper never evaluates poses or approves art.
 */
export type PoseBounds = Readonly<{min:readonly [number,number,number];max:readonly [number,number,number]}>;
export type PoseFrame = Readonly<{time:number;bounds:PoseBounds}>;
export type FixedFrame = Readonly<{mode:"explicit";min:[number,number,number];max:[number,number,number]}>;
const TOLERANCE=1e-6;
function validBounds(input:unknown):input is PoseBounds {
  if(!input || typeof input!=="object")return false;
  const row=input as Record<string,unknown>;
  const min=row.min,max=row.max;
  return Array.isArray(min)&&Array.isArray(max)&&min.length===3&&max.length===3&&
    min.every((x)=>typeof x==="number"&&Number.isFinite(x))&&
    max.every((x)=>typeof x==="number"&&Number.isFinite(x))&&
    min.every((x,i)=>x<=max[i]);
}
export function samePoseBounds(left:unknown,right:unknown):boolean {
  if(!validBounds(left)||!validBounds(right))return false;
  return left.min.every((v,i)=>Math.abs(v-right.min[i])<=TOLERANCE)&&
    left.max.every((v,i)=>Math.abs(v-right.max[i])<=TOLERANCE);
}
/** Caller frame must already contain every sampled pose; never auto-expand it. */
export function sharedPoseFraming(
  samples:readonly PoseFrame[], explicit?:FixedFrame
):{framing:FixedFrame;basis:"CALLER_EXPLICIT"|"SAMPLED_POSE_UNION";
   samples_checked:number;unsampled_motion_verified:false} {
  if(!samples.length||samples.length>5||
     samples.some(s=>!Number.isFinite(s.time)||s.time<0||!validBounds(s.bounds))||
     new Set(samples.map(s=>s.time)).size!==samples.length)
    throw new Error("ANIMATION_FRAMING_SAMPLES_INVALID");
  const min:[number,number,number]=[Infinity,Infinity,Infinity];
  const max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(const s of samples)for(let axis=0;axis<3;axis++){
    min[axis]=Math.min(min[axis],s.bounds.min[axis]);
    max[axis]=Math.max(max[axis],s.bounds.max[axis]);
  }
  if(explicit){
    if(!validBounds(explicit)||
       explicit.min.some((v,i)=>explicit.max[i]<=v||
         min[i]<v-TOLERANCE||max[i]>explicit.max[i]+TOLERANCE))
      throw new Error("ANIMATION_EXPLICIT_FRAME_EXCLUDES_POSE");
    return {framing:{mode:"explicit",min:[...explicit.min],max:[...explicit.max]},
      basis:"CALLER_EXPLICIT",samples_checked:samples.length,unsampled_motion_verified:false};
  }
  for(let axis=0;axis<3;axis++){
    if(min[axis]===max[axis]){min[axis]-=0.5;max[axis]+=0.5;}
    if(!Number.isFinite(max[axis]-min[axis])||max[axis]<=min[axis])
      throw new Error("ANIMATION_UNION_FRAME_INVALID");
  }
  return {framing:{mode:"explicit",min,max},basis:"SAMPLED_POSE_UNION",
    samples_checked:samples.length,unsampled_motion_verified:false};
}
export type PoseCameraReceipt=Readonly<{
  time:number;framing_bounds:PoseBounds;
  captures:readonly {view:string;camera_spec:unknown}[];
}>;
/** Planned camera matching only; NEVER an independent renderer calibration. */
export function comparePoseCameraReceipts(rows:readonly PoseCameraReceipt[]) {
  const unknown=(reason:string)=>({state:"UNVERIFIED" as const,reason,
    actual_native_renderer_attested:false as const,
    reference_camera_calibrated:false as const,
    visual_verdict:"NOT_EVALUATED" as const});
  if(rows.length<2)return unknown("ONLY_ONE_POSE");
  const first=rows[0],views=first.captures.map(c=>c.view);
  if(!validBounds(first.framing_bounds)||!views.length||
      views.some(v=>typeof v!=="string"||!v.trim())||
      new Set(views).size!==views.length)
    return unknown("CAMERA_RECEIPT_INCOMPLETE");
  const specs=first.captures.map(c=>JSON.stringify(c.camera_spec));
  if(specs.some(x=>!x||x==="null"))return unknown("CAMERA_RECEIPT_INCOMPLETE");
  for(const row of rows.slice(1)) {
    if(!samePoseBounds(first.framing_bounds,row.framing_bounds)||
       row.captures.length!==views.length||
       row.captures.some((c,i)=>c.view!==views[i]||
         JSON.stringify(c.camera_spec)!==specs[i]))
      return unknown("POSE_CAMERA_FRAMING_DRIFT");
  }
  return {state:"MATCHED_PLANNED_CAMERA" as const,reason:null,
    actual_native_renderer_attested:false as const,
    reference_camera_calibrated:false as const,
    visual_verdict:"NOT_EVALUATED" as const};
}

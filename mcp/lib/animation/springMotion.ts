import type { MotionPose, MotionRecipe, MotionVec3 } from "@/lib/animation/motionRecipe";

export type SpringMotionLink={
  parent_bone:string;
  child_bone:string;
  channel:"rotation"|"position";
  stiffness?:number;
  damping?:number;
  gain?:number;
  /** Legacy absolute follower is the default; parent_delta starts from neutral. */
  drive_mode?:"absolute"|"parent_delta";
  sample_rate?:number;
  max_duration?:number;
};

type Vec3=[number,number,number];
type ParentSample={time:number;value:Vec3};

function vec(v:readonly number[]|undefined):Vec3{return v?[v[0],v[1],v[2]]:[0,0,0];}
function add(a:Vec3,b:Vec3):Vec3{return[a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function scale(a:Vec3,s:number):Vec3{return[a[0]*s,a[1]*s,a[2]*s];}
function sub(a:Vec3,b:Vec3):Vec3{return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}

function buildParentSamples(recipe:MotionRecipe,bone:string,channel:"rotation"|"position"):ParentSample[]{
  return recipe.poses
    .filter((pose)=>pose.bones[bone]?.[channel]!==undefined)
    .map((pose)=>({time:pose.time,value:vec(pose.bones[bone]?.[channel] as MotionVec3)}))
    .sort((a,b)=>a.time-b.time);
}
function sampleParent(samples:readonly ParentSample[],time:number):Vec3{
  if(samples.length===0) return [0,0,0];
  if(time<=samples[0].time) return samples[0].value;
  if(time>=samples[samples.length-1].time) return samples[samples.length-1].value;
  let low=0,high=samples.length-1;
  while(low+1<high){
    const mid=(low+high)>>1;
    if(samples[mid].time<time) low=mid; else high=mid;
  }
  const a=samples[low],b=samples[high];
  const t=(time-a.time)/(b.time-a.time);
  return add(a.value,scale(sub(b.value,a.value),t));
}

export function compileSpringSecondaryMotion(recipe:MotionRecipe,links:readonly SpringMotionLink[]):MotionRecipe{
  if(links.length===0) return recipe;
  if(recipe.poses.length===0) throw new Error("Spring motion requires at least one source pose.");
  const duration=recipe.duration??Math.max(...recipe.poses.map((pose)=>pose.time));
  const base=recipe.poses.map((pose)=>({...pose,bones:{...pose.bones}}));
  const additions:MotionPose[]=[];
  const claimedChildren=new Set<string>();
  for(const link of links){
    if(!link.parent_bone.trim()||!link.child_bone.trim()) throw new Error("Spring motion requires parent and child bone names.");
    if(link.parent_bone===link.child_bone) throw new Error("Spring motion parent and child bone must differ.");
    const stiffness=link.stiffness??36;
    const damping=link.damping??10;
    const gain=link.gain??0.35;
    const driveMode=link.drive_mode??"absolute";
    if(driveMode!=="absolute"&&driveMode!=="parent_delta") throw new Error("SPRING_DRIVE_MODE_UNSUPPORTED");
    if(claimedChildren.has(link.child_bone)) throw new Error("SPRING_CHILD_OWNERSHIP_DUPLICATE");
    claimedChildren.add(link.child_bone);
    if(recipe.poses.some((pose)=>pose.bones[link.child_bone]?.[link.channel]!==undefined)){
      throw new Error("SPRING_CHILD_TRACK_ALREADY_AUTHORED: refuse to overwrite an existing child channel.");
    }
    const sampleRate=link.sample_rate??12;
    const maxDuration=Math.min(link.max_duration??duration,duration);
    if(![stiffness,damping,gain,sampleRate,maxDuration].every(Number.isFinite)||stiffness<=0||damping<0||gain<0||sampleRate<2||sampleRate>60||maxDuration<0){
      throw new Error("Spring motion parameters are outside bounded limits.");
    }
    const dt=1/sampleRate;
    const naturalFrequency=Math.sqrt(stiffness);
    if(dt*naturalFrequency>0.5||dt*damping>1){
      throw new Error("SPRING_STABILITY_GUARD: sample rate is too low for the requested stiffness/damping.");
    }
    const samples=buildParentSamples(recipe,link.parent_bone,link.channel);
    if(samples.length===0) throw new Error("Spring motion parent channel has no authored source samples.");
    if(samples.some((sample,index)=>
      !Number.isFinite(sample.time)||sample.time<0||
      !sample.value.every(Number.isFinite)||
      (index>0&&sample.time<=samples[index-1].time)
    )) throw new Error("SPRING_PARENT_SAMPLES_INVALID: expected strictly increasing finite samples.");
    // Euler turns over 180 degrees have no safe inferred rotation direction.
    // Require explicit intermediate source poses instead of a 358-degree jump.
    if(driveMode==="parent_delta"&&link.channel==="rotation"&&
      samples.some((sample,index)=>index>0&&sample.value.some((value,axis)=>
        Math.abs(value-samples[index-1].value[axis])>180
      ))) throw new Error("SPRING_ROTATION_WRAP_UNRESOLVED");
    const parentOrigin=samples[0].value;
    let x:Vec3=[0,0,0],v:Vec3=[0,0,0],previousTime=0;
    const steps=Math.ceil(maxDuration*sampleRate);
    if(steps+1>2400) throw new Error("Spring motion sample budget exceeded.");
    for(let step=0;step<=steps;step+=1){
      const time=Math.min(maxDuration,step/sampleRate);
      // Preserve the original absolute follower's first integration step.
      // Relative followers start exactly at zero displacement/velocity.
      const stepDt=step===0?(driveMode==="absolute"?dt:0):time-previousTime;
      const parentSample=sampleParent(samples,time);
      const driver=driveMode==="parent_delta"?sub(parentSample,parentOrigin):parentSample;
      const target=scale(driver,gain);
      const acceleration=sub(scale(sub(target,x),stiffness),scale(v,damping));
      v=add(v,scale(acceleration,stepDt));
      x=add(x,scale(v,stepDt));
      if(![...x,...v].every(Number.isFinite)) throw new Error("SPRING_NUMERIC_DIVERGENCE: non-finite spring state.");
      // The response is already numerically sampled. Native create_animation
      // authors linear tracks; nonlinear Bezier edits would require a second,
      // unverified Grid/Undo mutation and could change the baked trajectory.
      const transform=link.channel==="rotation"
        ? {rotation:[...x] as MotionVec3}
        : {position:[...x] as MotionVec3};
      additions.push({id:"spring:"+link.child_bone+":"+step,time,bones:{[link.child_bone]:transform}});
      previousTime=time;
    }
  }
  const byTime=new Map<number,MotionPose>();
  for(const pose of [...base,...additions].sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id))){
    const existing=byTime.get(pose.time);
    if(!existing){byTime.set(pose.time,pose);continue;}
    const overlap=Object.keys(pose.bones).filter((bone)=>existing.bones[bone]!==undefined);
    if(overlap.length) throw new Error("Spring motion conflicts with existing bone ownership at time "+pose.time+": "+overlap.join(", ")+".");
    byTime.set(pose.time,{...existing,id:existing.id+"+"+pose.id,bones:{...existing.bones,...pose.bones}});
  }
  return {...recipe,duration,poses:[...byTime.values()].sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id))};
}

/** Pure UI receipt validation. Rust bitmap authority is never in the WebView. */
import type {SurfaceSampleHit} from './rustSurfacePaint';
import {MAX_PAINT_ATLAS_SIDE} from './rustEditorTypes';
export type ShadeDirection='lighten'|'darken';
export type ShadeRamp=Array<[number,number,number,255]>;
export type SelectionRow={y:number;x0:number;x1:number};
export type SelectionMode='replace'|'add'|'subtract'|'intersect'|'invert';
export type SelectionStep={mode:SelectionMode;seed?:[number,number]};
export type SourceSelection={
  epoch:number;revision:number;cubeUuid:string;face:string;
  textureUuid:string;textureIndex:number;size:[number,number];
  sourceUv:[number,number,number,number];
  sourceRotation:number;seed:[number,number];rgba:[number,number,number,number];
  pixelCount:number;atlasRows:SelectionRow[];previewComplete:boolean;
  steps:SelectionStep[];
};
/** Ordered artist colors. There is no fixed artistic palette count. */
export function parseShadeRamp(input:string):ShadeRamp|null{
  if(typeof input!=='string'||input.length>12*1024)return null;
  const tokens=input.split(/[\s,;]+/).filter(Boolean);
  if(tokens.length<2)return null;
  const seen=new Set<string>();
  const result:ShadeRamp=[];
  for(const token of tokens){
    if(!/^#[0-9a-fA-F]{6}$/.test(token))return null;
    const key=token.toLowerCase();
    if(seen.has(key))return null;
    seen.add(key);
    result.push([
      parseInt(token.slice(1,3),16),
      parseInt(token.slice(3,5),16),
      parseInt(token.slice(5,7),16),255,
    ]);
  }
  return result;
}
export function validSelectionSteps(steps:unknown,size:readonly [number,number]):steps is SelectionStep[]{
  if(!Array.isArray(steps)||!steps.length)return false;
  return steps.every((step,i)=>{
    if(!step||typeof step!=='object'||
       !['replace','add','subtract','intersect','invert'].includes(step.mode))return false;
    if(i===0&&!['replace','invert'].includes(step.mode))return false;
    if(step.mode==='invert')return step.seed===undefined||step.seed===null;
    return Array.isArray(step.seed)&&step.seed.length===2&&
      step.seed.every((v,j)=>Number.isInteger(v)&&v>=0&&v<size[j]);
  });
}
function matches(selection:SourceSelection,hit:Pick<SurfaceSampleHit,
  'epoch'|'revision'|'cubeUuid'|'textureUuid'|'face'|'sourceUv'|'sourceRotation'>){
  return selection.epoch===hit.epoch&&selection.revision===hit.revision&&
    selection.cubeUuid===hit.cubeUuid&&selection.textureUuid===hit.textureUuid&&
    selection.face===hit.face&&selection.sourceRotation===hit.sourceRotation&&
    selection.sourceUv.every((value,i)=>value===hit.sourceUv[i]);
}
export function selectionStepsForStroke(selection:SourceSelection|null,hit:
  Pick<SurfaceSampleHit,'epoch'|'revision'|'cubeUuid'|'textureUuid'|'face'|'sourceUv'|'sourceRotation'>,
):SelectionStep[]|null{
  return selection&&matches(selection,hit)
    ?selection.steps.map(s=>({mode:s.mode,...(s.seed?{seed:[...s.seed] as [number,number]}:{})}))
    :null;
}
/** Legacy single-island helper refuses compound selections. */
export function selectionSeedForStroke(selection:SourceSelection|null,hit:
  Pick<SurfaceSampleHit,'epoch'|'revision'|'cubeUuid'|'textureUuid'|'face'|'sourceUv'|'sourceRotation'>,
):[number,number]|null{
  const steps=selectionStepsForStroke(selection,hit);
  return steps?.length===1&&steps[0].mode==='replace'&&steps[0].seed
    ?[...steps[0].seed]:null;
}
export function bindSourceSelection(
  hit:SurfaceSampleHit,
  response:{
    revision:number;cube_uuid:string;texture_uuid:string;
    face:string;seed:[number,number];source_rgba:[number,number,number,number];
    pixel_count:number;atlas_rows:SelectionRow[];
    preview_complete?:boolean;selection_steps?:SelectionStep[];
    source_authority:string;write_authority:string;
  },
  width:number,height:number,expectedSteps?:SelectionStep[],
):SourceSelection|null{
  if(!Number.isInteger(width)||!Number.isInteger(height)||
     width<1||height<1||width>MAX_PAINT_ATLAS_SIDE||height>MAX_PAINT_ATLAS_SIDE||
     response.revision!==hit.revision||
     response.cube_uuid!==hit.cubeUuid||
     response.texture_uuid!==hit.textureUuid||
     response.face!==hit.face||
     response.source_authority!=='RUST_SAVED_RGBA8'||
     response.write_authority!=='NOT_GRANTED'||
     !Array.isArray(response.seed)||response.seed.length!==2||
     response.seed.some((v,i)=>v!==hit.texel[i])||
     !Array.isArray(response.source_rgba)||response.source_rgba.length!==4||
     response.source_rgba.some(n=>!Number.isInteger(n)||n<0||n>255)||
     !Number.isInteger(response.pixel_count)||
     response.pixel_count<0||response.pixel_count>hit.size[0]*hit.size[1]||
     !Array.isArray(response.atlas_rows))return null;
  const steps=response.selection_steps??[{mode:'replace',seed:[...hit.texel]}];
  if(!validSelectionSteps(steps,hit.size)||
     (expectedSteps&&JSON.stringify(steps)!==JSON.stringify(expectedSteps)))return null;
  const complete=response.preview_complete??true;
  if(typeof complete!=='boolean'||response.atlas_rows.length>(complete?4096:0))return null;
  let count=0,previousY=-1,previousX1=0;
  for(const row of response.atlas_rows){
    if(!row||!Number.isInteger(row.x0)||!Number.isInteger(row.x1)||
       !Number.isInteger(row.y)||row.x0<0||row.x0>=row.x1||
       row.x1>width||row.y<0||row.y>=height||
       row.y<previousY||
       (row.y===previousY&&row.x0<=previousX1))return null;
    previousY=row.y;previousX1=row.x1;
    count+=row.x1-row.x0;
    if(count>response.pixel_count)return null;
  }
  if(complete&&count!==response.pixel_count)return null;
  return {
    epoch:hit.epoch,revision:hit.revision,
    cubeUuid:hit.cubeUuid,textureUuid:hit.textureUuid,
    textureIndex:hit.textureIndex,size:[...hit.size],face:hit.face,
    sourceUv:[...hit.sourceUv],sourceRotation:hit.sourceRotation,
    seed:[...response.seed],rgba:[...response.source_rgba],
    pixelCount:response.pixel_count,previewComplete:complete,
    atlasRows:response.atlas_rows.map(r=>({...r})),
    steps:steps.map(s=>({mode:s.mode,...(s.seed?{seed:[...s.seed] as [number,number]}:{})})),
  };
}

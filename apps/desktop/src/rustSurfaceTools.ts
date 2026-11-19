/** Pure, source-only UI planning for the existing Rust surface painter.
 * Does not sample images, mutate bitmaps, infer light or auto-author colors.
 */
import type {SurfaceSampleHit} from './rustSurfacePaint';
export type ShadeDirection='lighten'|'darken';
export type ShadeRamp=Array<[number,number,number,255]>;
export type SelectionRow={y:number;x0:number;x1:number};
export type SourceSelection={
  epoch:number;revision:number;cubeUuid:string;face:string;
  textureUuid:string;sourceUv:[number,number,number,number];
  sourceRotation:number;seed:[number,number];rgba:[number,number,number,number];
  pixelCount:number;atlasRows:SelectionRow[];
};
/** A ramp is artist-authored and arbitrarily rich up to the Rust plan's
 * serialized-byte budget; never convert the atlas into indexed color.
 */
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
export function bindSourceSelection(
  hit:SurfaceSampleHit,
  response:{
    revision:number;cube_uuid:string;texture_uuid:string;
    face:string;seed:[number,number];source_rgba:[number,number,number,number];
    pixel_count:number;atlas_rows:SelectionRow[];
    source_authority:string;write_authority:string;
  },
  width:number,height:number,
):SourceSelection|null{
  if(!Number.isInteger(width)||!Number.isInteger(height)||
     width<1||height<1||width>256||height>256||
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
     response.pixel_count<1||response.pixel_count>width*height||
     !Array.isArray(response.atlas_rows)||
     response.atlas_rows.length<1||response.atlas_rows.length>1024)return null;
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
  if(count!==response.pixel_count)return null;
  return {
    epoch:hit.epoch,revision:hit.revision,
    cubeUuid:hit.cubeUuid,textureUuid:hit.textureUuid,face:hit.face,
    sourceUv:[...hit.sourceUv],sourceRotation:hit.sourceRotation,
    seed:[...response.seed],rgba:[...response.source_rgba],
    pixelCount:response.pixel_count,
    atlasRows:response.atlas_rows.map(r=>({...r})),
  };
}
/** A stale selection must NEVER silently become an unrestricted stroke. */
export function selectionSeedForStroke(
  selection:SourceSelection|null,hit:{
    epoch:number;revision:number;cubeUuid:string;textureUuid:string;face:string;
    sourceUv:[number,number,number,number];sourceRotation:number;
  },
):[number,number]|null{
  return selection&&selection.epoch===hit.epoch&&
    selection.revision===hit.revision&&
    selection.cubeUuid===hit.cubeUuid&&
    selection.textureUuid===hit.textureUuid&&
    selection.face===hit.face&&
    selection.sourceRotation===hit.sourceRotation&&
    selection.sourceUv.every((value,i)=>value===hit.sourceUv[i])
    ? [...selection.seed] : null;
}

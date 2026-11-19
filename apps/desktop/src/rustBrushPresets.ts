/** Browser-local parameter presets; no source bitmap, UV, Paint permission,
 * revision, model identity, or original PNG is ever stored in a preset.
 */
import {parseShadeRamp} from './rustSurfaceTools';
export const BRUSH_PRESET_STORAGE_KEY='lazydesigner-rust-brush-presets-v1';
export type PatternMode='none'|'checker'|'dots'|'diagonal';
export type SurfacePatternSpec={kind:Exclude<PatternMode,'none'>;
  period:number;phase:[number,number]};
export type BrushSettings={
  radius:number;tip:'square'|'diamond';
  inkMode:'color'|'shade_ink';shadeRamp:string;
  shadeDirection:'lighten'|'darken';
  patternMode:PatternMode;patternPeriod:number;
  patternPhaseX:number;patternPhaseY:number;
};
export type BrushPreset={id:string;name:string;settings:BrushSettings};
const U32_MAX=4294967295;
/** Procedural pattern source parameters, never stored editable pixels. */
export function planSurfacePattern(mode:PatternMode,period:number,
  phaseX:number,phaseY:number):SurfacePatternSpec|null{
  if(mode==='none')return null;
  if(!['checker','dots','diagonal'].includes(mode)||
     ![period,phaseX,phaseY].every(Number.isInteger)||
     period<1||period>U32_MAX||
     phaseX<0||phaseX>U32_MAX||phaseY<0||phaseY>U32_MAX)return null;
  return {kind:mode,period,phase:[phaseX,phaseY]};
}
export function validBrushSettings(v:unknown):v is BrushSettings{
  if(!v||typeof v!=='object')return false;
  const o=v as Partial<BrushSettings>;
  return Number.isInteger(o.radius)&&o.radius!>=1&&o.radius!<=4&&
    (o.tip==='square'||o.tip==='diamond')&&
    (o.inkMode==='color'||o.inkMode==='shade_ink')&&
    typeof o.shadeRamp==='string'&&o.shadeRamp.length<=12*1024&&
    (o.inkMode!=='shade_ink'||!!parseShadeRamp(o.shadeRamp))&&
    (o.shadeDirection==='darken'||o.shadeDirection==='lighten')&&
    ['none','checker','dots','diagonal'].includes(o.patternMode??'')&&
    (o.patternMode==='none'||!!planSurfacePattern(o.patternMode!,
      o.patternPeriod!,o.patternPhaseX!,o.patternPhaseY!));
}
export function readBrushPresets(text:string|null):BrushPreset[]{
  if(!text)return [];
  try{
    const value=JSON.parse(text);
    if(value?.schemaVersion!==1||!Array.isArray(value.presets))return [];
    const seen=new Set<string>();
    const accepted:BrushPreset[]=[];
    for(const entry of value.presets){
      if(!entry||typeof entry.id!=='string'||!entry.id||
         typeof entry.name!=='string'||entry.name.trim()!==entry.name||
         !entry.name||entry.name.length>80||!validBrushSettings(entry.settings))continue;
      if(seen.has(entry.id))continue;
      seen.add(entry.id);
      accepted.push({id:entry.id,name:entry.name,
        settings:{...entry.settings}});
    }
    return accepted;
  }catch{return [];}
}
export function serializeBrushPresets(presets:BrushPreset[]):string{
  return JSON.stringify({schemaVersion:1,presets});
}
/** Same display name updates instead of accumulating accidental duplicates. */
export function upsertBrushPreset(presets:BrushPreset[],id:string,
  name:string,settings:BrushSettings):BrushPreset[]|null{
  const clean=name.trim();
  if(!clean||clean.length>80||!id||!validBrushSettings(settings))return null;
  const index=presets.findIndex(p=>p.name.toLocaleLowerCase()===clean.toLocaleLowerCase());
  if(index<0)return [...presets,{id,name:clean,settings:{...settings}}];
  return presets.map((p,i)=>i===index?
    {id:p.id,name:clean,settings:{...settings}}:p);
}

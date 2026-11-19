/** One manually requested atlas preview. The source string is read-only,
 * revision-bound presentation, never a second bitmap/Undo owner.
 */
import type {EditorSnapshot} from './rustEditorTypes';

export type SelectedTexturePreviewReceipt={
  epoch:number;revision:number;textureIndex:number;
  textureUuid:string;textureSource:string|null;
  sourceSha256:string;sourceReused:boolean;
  textureResolution:[number,number];
  sourceAuthority:'RUST_VALIDATED_EMBEDDED_PNG';
  writeAuthority:'NOT_GRANTED';
  previewScope:'SELECTED_PROJECT_ATLAS_ONLY';
};
export type SelectedTexturePreview=SelectedTexturePreviewReceipt&{
  textureSource:string;
};
export function matchingSelectedTexturePreview(
  snapshot:EditorSnapshot|null,receipt:SelectedTexturePreview|null,
  index:number,
):boolean {
  if(!snapshot||!receipt||snapshot.scopedTexturePreview||
     !Number.isInteger(index)||index<0||index>=snapshot.textureNames.length||
     snapshot.texturePreviewSources[index]||
     receipt.epoch!==snapshot.epoch||receipt.revision!==snapshot.revision||
     receipt.textureIndex!==index||
     receipt.textureUuid!==snapshot.textureUuids[index]||
     receipt.sourceAuthority!=='RUST_VALIDATED_EMBEDDED_PNG'||
     receipt.writeAuthority!=='NOT_GRANTED'||
     receipt.previewScope!=='SELECTED_PROJECT_ATLAS_ONLY'||
     typeof receipt.sourceSha256!=='string'||
     !/^[a-fA-F0-9]{64}$/.test(receipt.sourceSha256)||
     !Array.isArray(receipt.textureResolution)||
     receipt.textureResolution.length!==2||
     receipt.textureResolution.some((v,i)=>v!==snapshot.textureResolution[i])||
     typeof receipt.textureSource!=='string'||
     !receipt.textureSource.startsWith('data:image/png;base64,')||
     receipt.textureSource.length<=22)return false;
  return true;
}
export function bindSelectedTexturePreview(
  snapshot:EditorSnapshot|null,incoming:SelectedTexturePreviewReceipt,
  previous:SelectedTexturePreview|null,index:number,
):SelectedTexturePreview|null {
  if(!incoming||typeof incoming.sourceReused!=='boolean')return null;
  let actual:string;
  if(incoming.sourceReused){
    // A hash match from the current Rust source is required before reusing
    // old WebView bytes. A forged caller cannot grant bitmap permission.
    if(incoming.textureSource!==null||!previous||
       previous.sourceSha256!==incoming.sourceSha256||
       previous.epoch!==incoming.epoch||
       previous.textureUuid!==incoming.textureUuid||
       previous.textureIndex!==incoming.textureIndex)return null;
    actual=previous.textureSource;
  }else{
    if(typeof incoming.textureSource!=='string')return null;
    actual=incoming.textureSource;
  }
  const materialized={...incoming,textureSource:actual};
  return matchingSelectedTexturePreview(snapshot,materialized,index)
    ?materialized:null;
}
export function selectedTexturePreviewSources(
  snapshot:EditorSnapshot|null,receipt:SelectedTexturePreview|null,index:number,
):(string|null)[] {
  const sources=snapshot?.texturePreviewSources??[];
  if(!matchingSelectedTexturePreview(snapshot,receipt,index))return sources;
  const next=[...sources];
  next[index]=receipt!.textureSource;
  return next;
}

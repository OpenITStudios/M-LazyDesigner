/** Read-only one-atlas viewport transfer after the native aggregate preview
 * budget was exhausted. This never edits Rust bitmap, Undo, or UV ownership.
 */
import type {EditorSnapshot} from './rustEditorTypes';

export type SelectedTexturePreview={
  epoch:number;revision:number;textureIndex:number;
  textureUuid:string;textureSource:string;textureResolution:[number,number];
  sourceAuthority:'RUST_VALIDATED_EMBEDDED_PNG';
  writeAuthority:'NOT_GRANTED';
  previewScope:'SELECTED_PROJECT_ATLAS_ONLY';
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
     !Array.isArray(receipt.textureResolution)||
     receipt.textureResolution.length!==2||
     receipt.textureResolution.some((v,i)=>v!==snapshot.textureResolution[i])||
     typeof receipt.textureSource!=='string'||
     !receipt.textureSource.startsWith('data:image/png;base64,')||
     receipt.textureSource.length<=22)return false;
  return true;
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

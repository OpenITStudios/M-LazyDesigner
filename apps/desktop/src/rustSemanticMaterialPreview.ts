/** Ephemeral candidate presentation. The Rust EditorSession is the only
 * persistent model/bitmap/Undo owner; these helpers never mutate it.
 */
import type {EditorSnapshot} from './rustEditorTypes';
export type SemanticMaterialIntent={
  expected_revision:number;reference_png_sha256:string;
  cube_uuid:string;texture_uuid:string;
  face:'north'|'east'|'south'|'west'|'up'|'down';
  material:'painted_metal';
  light_corner:'upper_left'|'upper_right';
  contrast:'subtle'|'balanced';
  source_base_rgba:[number,number,number,255];
  shadow_rgb:[number,number,number];highlight_rgb:[number,number,number];
  protected_regions?:Array<{from:[number,number];to:[number,number]}>;
  expected_before_pixels?:Array<{at:[number,number];rgba:[number,number,number,number]}>;
};
export type SemanticMaterialReferenceReceipt={
  pngSha256:string;byteCount:number;
  /** Render-only local selected reference; never a semantic model source. */
  referencePngSource:string;
  referenceAuthority:'USER_SELECTED_NOT_ARTISTICALLY_VERIFIED';
};
export type SemanticMaterialPreviewReceipt={
  epoch:number;revision:number;sourceModelSha256:string;
  candidateSha256:string;referencePngSha256:string;
  cubeUuid:string;textureUuid:string;textureIndex:number;
  candidatePngSource:string;
  materialEvidence:Record<string,unknown>;
  previewScope:'RUST_THREEJS_EPHEMERAL_CANDIDATE';
  visualVerdict:'UNVERIFIED';writeAuthority:'NOT_GRANTED';
};
export type SemanticMaterialDraft=SemanticMaterialPreviewReceipt&{intent:SemanticMaterialIntent};
export function sourceRgb(hex:string):[number,number,number]|null{
  if(!/^#[0-9a-f]{6}$/i.test(hex))return null;
  return [Number.parseInt(hex.slice(1,3),16),
    Number.parseInt(hex.slice(3,5),16),Number.parseInt(hex.slice(5,7),16)];
}
export function matchingSemanticCandidate(
  snapshot:EditorSnapshot|null,candidate:SemanticMaterialDraft|null,
  cubeUuid:string|null,face:string,textureIndex:number,
  referenceSha:string|null,
):boolean {
  return Boolean(snapshot&&candidate &&
    candidate.epoch===snapshot.epoch &&
    candidate.revision===snapshot.revision &&
    candidate.cubeUuid===cubeUuid &&
    candidate.intent.cube_uuid===cubeUuid &&
    candidate.intent.texture_uuid===candidate.textureUuid &&
    candidate.intent.expected_revision===candidate.revision &&
    candidate.intent.face===face &&
    candidate.textureIndex===textureIndex &&
    candidate.textureUuid===snapshot.textureUuids[textureIndex] &&
    candidate.referencePngSha256===referenceSha &&
    candidate.intent.reference_png_sha256===referenceSha &&
    /^[a-f0-9]{64}$/i.test(candidate.sourceModelSha256) &&
    /^[a-f0-9]{64}$/i.test(candidate.candidateSha256) &&
    candidate.previewScope==='RUST_THREEJS_EPHEMERAL_CANDIDATE' &&
    candidate.writeAuthority==='NOT_GRANTED' &&
    candidate.visualVerdict==='UNVERIFIED' &&
    candidate.candidatePngSource.startsWith('data:image/png;base64,') &&
    Boolean(snapshot.texturePreviewSources[textureIndex]));
}
export function semanticViewportSources(
  snapshot:EditorSnapshot|null,candidate:SemanticMaterialDraft|null,
  displayCandidate:boolean,valid:boolean,
):(string|null)[] {
  if(!snapshot)return [];
  if(!displayCandidate||!valid||!candidate)return snapshot.texturePreviewSources;
  const sources=[...snapshot.texturePreviewSources];
  sources[candidate.textureIndex]=candidate.candidatePngSource;
  return sources;
}

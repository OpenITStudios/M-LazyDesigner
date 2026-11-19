/** A candidate-only presentation. Rust remains the document/Undo authority. */
import type {EditorSnapshot} from './rustEditorTypes';
export type ExternalFaceTextureIntent={
  expected_revision:number;cube_uuid:string;texture_uuid:string;
  face:'north'|'east'|'south'|'west'|'up'|'down';
  source_base_rgba:[number,number,number,255];
  protected_regions?:Array<{from:[number,number];to:[number,number]}>;
  expected_before_pixels?:Array<{at:[number,number];rgba:[number,number,number,number]}>;
};
export type ExternalFaceTextureReceipt={
  epoch:number;revision:number;sourceModelSha256:string;
  candidateSha256:string;selectedPngSha256:string;
  cubeUuid:string;textureUuid:string;textureIndex:number;
  face:string;candidatePngSource:string;
  previewScope:'RUST_THREEJS_EPHEMERAL_CANDIDATE';
  visualVerdict:'UNVERIFIED';writeAuthority:'NOT_GRANTED';
};
export type ExternalFaceTextureDraft=ExternalFaceTextureReceipt&{
  intent:ExternalFaceTextureIntent;
};
export function matchingExternalTextureCandidate(
  snapshot:EditorSnapshot|null,candidate:ExternalFaceTextureDraft|null,
  cubeUuid:string|null,face:string,textureIndex:number,
):boolean{
  return Boolean(snapshot&&candidate&&cubeUuid &&
    candidate.epoch===snapshot.epoch &&
    candidate.revision===snapshot.revision &&
    candidate.cubeUuid===cubeUuid &&
    candidate.intent.cube_uuid===cubeUuid &&
    candidate.intent.expected_revision===candidate.revision &&
    candidate.face===face && candidate.intent.face===face &&
    candidate.textureIndex===textureIndex &&
    candidate.textureUuid===candidate.intent.texture_uuid &&
    candidate.textureUuid===snapshot.textureUuids[textureIndex] &&
    candidate.previewScope==='RUST_THREEJS_EPHEMERAL_CANDIDATE' &&
    candidate.visualVerdict==='UNVERIFIED' &&
    candidate.writeAuthority==='NOT_GRANTED' &&
    [candidate.sourceModelSha256,candidate.candidateSha256,
      candidate.selectedPngSha256].every(s=>/^[0-9a-f]{64}$/i.test(s)) &&
    candidate.candidatePngSource.startsWith('data:image/png;base64,') &&
    Boolean(snapshot.texturePreviewSources[textureIndex]));
}
export function externalTextureViewportSources(
  snapshot:EditorSnapshot|null,candidate:ExternalFaceTextureDraft|null,
  displayCandidate:boolean,valid:boolean,baseSources:(string|null)[],
):(string|null)[]{
  if(!snapshot)return [];
  if(!displayCandidate||!valid||!candidate)return baseSources;
  const copy=[...baseSources];
  copy[candidate.textureIndex]=candidate.candidatePngSource;
  return copy;
}

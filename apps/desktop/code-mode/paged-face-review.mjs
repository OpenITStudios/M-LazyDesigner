/**
 * Transient host-only plan for a SHA-pinned large-model face review.
 * Every external reviewer invocation stays <=256 faces; no partial batch
 * is an independent whole-model artistic or native acceptance.
 * SOURCE_ONLY: tests and local review remain on hold.
 */
export const MAX_FACES_PER_REVIEW = 256;
export const MAX_PAGED_FACE_REVIEWS = 4;
export const MAX_PAGED_REVIEW_FACES =
  MAX_FACES_PER_REVIEW * MAX_PAGED_FACE_REVIEWS;

const AUDITABLE = new Set([
  'measured_nontransparent_pixels','fully_transparent_pixels',
  'partially_transparent_pixels','translucent_pixels',
]);
const FACES = new Set(['north','east','south','west','up','down']);
const SHA = /^[a-f0-9]{64}$/;

function fail(code) { throw new Error(code); }
function keyOf(item) { return JSON.stringify([item.cube_uuid,item.face]); }

/** Return null for the old single <=256-face callback. An incomplete source
 * or more than 4 pages remains fail-closed at whole-model readiness.
 */
export function planPagedSourceFaceReview(inventory) {
  if (!inventory || inventory.scope!=='trusted_saved_cube_face_inventory' ||
      !SHA.test(inventory.source_model_sha256??'') ||
      !Array.isArray(inventory.faces) ||
      !Number.isSafeInteger(inventory.total_cubes) ||
      inventory.total_cubes<0) {
    fail('CODE_MODE_PAGED_FACE_SOURCE_INVALID');
  }
  if (inventory.faces.length<=MAX_FACES_PER_REVIEW) return null;
  if (!inventory.complete || inventory.faces.length>MAX_PAGED_REVIEW_FACES) {
    fail('CODE_MODE_PAGED_FACE_SOURCE_INCOMPLETE');
  }
  const seen=new Set();
  for(const face of inventory.faces) {
    if(!face || typeof face!=='object' || Array.isArray(face)) {
      fail('CODE_MODE_PAGED_FACE_SOURCE_UNRESOLVED');
    }
    const key=keyOf(face);
    if(typeof face.cube_uuid!=='string' ||
       !/^[a-zA-Z0-9_-]{1,128}$/.test(face.cube_uuid) ||
       !FACES.has(face.face) ||
       typeof face.texture_uuid!=='string' ||
       !/^[a-zA-Z0-9_-]{1,128}$/.test(face.texture_uuid) ||
       !AUDITABLE.has(face.source_status) || seen.has(key)) {
      fail('CODE_MODE_PAGED_FACE_SOURCE_UNRESOLVED');
    }
    seen.add(key);
  }
  const pageCount=Math.ceil(inventory.faces.length/MAX_FACES_PER_REVIEW);
  return Object.freeze(Array.from({length:pageCount},(_,pageIndex)=>{
    const faceOffset=pageIndex*MAX_FACES_PER_REVIEW;
    return Object.freeze({
      scope:'trusted_saved_cube_face_inventory_page',
      source_model_sha256:inventory.source_model_sha256,
      // "complete" means the original native source scan reached its end.
      // This page alone is never the entire source model.
      complete:true,
      total_cubes:inventory.total_cubes,
      total_faces:inventory.faces.length,
      page_index:pageIndex,
      page_count:pageCount,
      face_offset:faceOffset,
      faces:Object.freeze(inventory.faces.slice(
        faceOffset,faceOffset+MAX_FACES_PER_REVIEW)),
    });
  }));
}

/** Called only after normalizedVisualReview validates view ID, style, and
 * reviewer schema. A page must independently account for *every* source
 * face, with exact saved UUID+direction+texture identity. No partial PASS.
 */
export function requireAcceptedFaceReviewPage(page,normalized) {
  if(page?.scope!=='trusted_saved_cube_face_inventory_page' ||
     normalized?.decision!=='ACCEPTED' ||
     normalized.issues?.length!==0 ||
     !Array.isArray(normalized.reviewedFaces) ||
     normalized.reviewedFaces.length!==page.faces.length) {
    fail('CODE_MODE_PAGED_FACE_REVIEW_INCOMPLETE');
  }
  const required=new Map(page.faces.map(face=>[keyOf(face),face]));
  const seen=new Set();
  for(const face of normalized.reviewedFaces) {
    const key=JSON.stringify([face.cubeUuid,face.face]);
    const source=required.get(key);
    if(!source || seen.has(key) ||
       face.textureUuid!==source.texture_uuid ||
       (source.source_status==='fully_transparent_pixels' &&
         face.style!=='INTENTIONAL_TRANSPARENT')) {
      fail('CODE_MODE_PAGED_FACE_REVIEW_SOURCE_MISMATCH');
    }
    seen.add(key);
  }
  if(seen.size!==required.size) {
    fail('CODE_MODE_PAGED_FACE_REVIEW_INCOMPLETE');
  }
  return Object.freeze([...normalized.reviewedFaces]);
}
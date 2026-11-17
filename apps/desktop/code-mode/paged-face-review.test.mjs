// SOURCE ONLY: authored regression, never executed on the held host.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_FACES_PER_REVIEW,MAX_PAGED_REVIEW_FACES,
  planPagedSourceFaceReview,requireAcceptedFaceReviewPage}
  from './paged-face-review.mjs';

const SOURCE='a'.repeat(64);
const directions=['north','east','south','west','up','down'];
function face(i) {
  return {cube_uuid:'cube-'+String(Math.floor(i/6)),
    face:directions[i%6],texture_uuid:'atlas-1',
    source_status:'measured_nontransparent_pixels'};
}
function inventory(count) {
  return {scope:'trusted_saved_cube_face_inventory',
    source_model_sha256:SOURCE,
    complete:true,total_cubes:Math.ceil(count/6),
    faces:Array.from({length:count},(_,i)=>face(i))};
}
function reviewerPage(page) {
  return {decision:'ACCEPTED',issues:[],
    reviewedFaces:page.faces.map(item=>({
      cubeUuid:item.cube_uuid,face:item.face,textureUuid:item.texture_uuid,
      style:'STYLED',observedInViewId:'front',
      observation:'Directional value shapes were observed on this mapped face.',
    }))};
}
test('legacy one-page source stays on the existing reviewer callback',()=>{
  assert.equal(planPagedSourceFaceReview(inventory(256)),null);
});
test('372 mapped faces are split into 256+116 source-bound pages without loss',()=>{
  const pages=planPagedSourceFaceReview(inventory(372));
  assert.equal(pages.length,2);
  assert.deepEqual(pages.map(p=>p.faces.length),[256,116]);
  assert.deepEqual(pages.map(p=>p.face_offset),[0,256]);
  assert.ok(pages.every(p=>p.complete&&p.page_count===2&&
    p.total_faces===372&&p.source_model_sha256===SOURCE));
  const checked=pages.flatMap(page=>requireAcceptedFaceReviewPage(
    page,reviewerPage(page)));
  assert.equal(checked.length,372);
  assert.equal(new Set(checked.map(x=>x.cubeUuid+':'+x.face)).size,372);
});
test('maximum bounded four-page scan is explicit, not silent truncation',()=>{
  const pages=planPagedSourceFaceReview(inventory(MAX_PAGED_REVIEW_FACES));
  assert.equal(pages.length,4);
  assert.ok(pages.every(p=>p.faces.length<=MAX_FACES_PER_REVIEW));
  assert.throws(()=>planPagedSourceFaceReview(inventory(
    MAX_PAGED_REVIEW_FACES+1)),/CODE_MODE_PAGED_FACE_SOURCE_INCOMPLETE/);
  assert.throws(()=>planPagedSourceFaceReview({
    ...inventory(372),complete:false,
  }),/CODE_MODE_PAGED_FACE_SOURCE_INCOMPLETE/);
});
test('unresolved or duplicate source faces cannot enter global paged acceptance',()=>{
  const original=inventory(260);
  for(const bad of [
    {...original,faces:[...original.faces.slice(0,259),original.faces[0]]},
    {...original,faces:original.faces.map((f,i)=>i===259?{
      ...f,texture_uuid:null}:f)},
    {...original,faces:original.faces.map((f,i)=>i===259?{
      ...f,source_status:'mapping_unsupported'}:f)},
  ]){
    assert.throws(()=>planPagedSourceFaceReview(bad),
      /CODE_MODE_PAGED_FACE_SOURCE_UNRESOLVED/);
  }
});
test('reviewer cannot omit, substitute, relabel or duplicate one face',()=>{
  const page=planPagedSourceFaceReview(inventory(260))[1];
  const accepted=reviewerPage(page);
  assert.equal(requireAcceptedFaceReviewPage(page,accepted).length,4);
  for(const changed of [
    {...accepted,reviewedFaces:accepted.reviewedFaces.slice(1)},
    {...accepted,reviewedFaces:accepted.reviewedFaces.map((f,i)=>i===0?
      {...f,textureUuid:'other-atlas'}:f)},
    {...accepted,reviewedFaces:accepted.reviewedFaces.map((f,i)=>i===0?
      {...f,cubeUuid:'invented-cube'}:f)},
    {...accepted,reviewedFaces:accepted.reviewedFaces.map((f,i)=>i===1?
      accepted.reviewedFaces[0]:f)},
    {...accepted,decision:'UNVERIFIED'},
  ]){
    assert.throws(()=>requireAcceptedFaceReviewPage(page,changed),
      /CODE_MODE_PAGED_FACE_REVIEW_/);
  }
});

test('source opacity and reviewer face style must agree before paged acceptance',()=>{
  const visible=planPagedSourceFaceReview(inventory(260))[1];
  const reviewedVisible=reviewerPage(visible);
  const mislabeledVisible={
    ...reviewedVisible,
    reviewedFaces:reviewedVisible.reviewedFaces.map((face,i)=>i===0?
      {...face,style:'INTENTIONAL_TRANSPARENT'}:face),
  };
  assert.throws(()=>requireAcceptedFaceReviewPage(visible,mislabeledVisible),
    /CODE_MODE_PAGED_FACE_REVIEW_SOURCE_MISMATCH/);

  const original=inventory(260);
  const withTransparent={...original,faces:original.faces.map((face,i)=>i===256?
    {...face,source_status:'fully_transparent_pixels'}:face)};
  const page=planPagedSourceFaceReview(withTransparent)[1];
  const reviewed=reviewerPage(page);
  for(const style of ['STYLED','INTENTIONAL_FLAT']){
    const wrong={...reviewed,reviewedFaces:reviewed.reviewedFaces.map((face,i)=>
      i===0?{...face,style}:face)};
    assert.throws(()=>requireAcceptedFaceReviewPage(page,wrong),
      /CODE_MODE_PAGED_FACE_REVIEW_SOURCE_MISMATCH/);
  }
  const intentional={...reviewed,reviewedFaces:reviewed.reviewedFaces.map((face,i)=>
    i===0?{...face,style:'INTENTIONAL_TRANSPARENT'}:face)};
  assert.equal(requireAcceptedFaceReviewPage(page,intentional).length,4);
});

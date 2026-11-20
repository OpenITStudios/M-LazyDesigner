// TEST_AUTHORED_NOT_RUN: bounded saved Texture identity checks, no native/CI run.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertUniqueSavedMaterialTextureUuid} from './material-reference-source-identity.mjs';

const sha='a'.repeat(64);
const createProject=(ids,sourceSha=sha)=>({
  expectedSha256:sha,
  async catalog(kind,{offset,limit}){
    assert.equal(kind,'textures');assert.equal(limit,32);
    const entries=ids.slice(offset,offset+limit)
      .map((uuid,i)=>({kind:'texture',index:offset+i,uuid}));
    return {sha256:sourceSha,catalog:{kind:'textures',offset,
      total:ids.length,entries,
      next_offset:offset+entries.length===ids.length?null:offset+entries.length}};
  },
});
test('unique Texture identity across SHA-bound pages is source evidence, not art approval',async()=>{
  const ids=Array.from({length:35},(_,i)=>'texture-'+i);
  await assert.doesNotReject(assertUniqueSavedMaterialTextureUuid(createProject(ids),'texture-34'));
  await assert.rejects(assertUniqueSavedMaterialTextureUuid(createProject(ids),'missing'),
    /CODE_MODE_MATERIAL_REFERENCE_NOT_FOUND/);
  await assert.rejects(assertUniqueSavedMaterialTextureUuid(createProject(
    ['master','master']),'master'),/CODE_MODE_MATERIAL_REFERENCE_AMBIGUOUS/);
});
test('missing source, forged digest and invalid pagination fail closed',async()=>{
  await assert.rejects(assertUniqueSavedMaterialTextureUuid(null,'master'),
    /CODE_MODE_MATERIAL_REFERENCE_REQUIRES_EXISTING_MODEL/);
  await assert.rejects(assertUniqueSavedMaterialTextureUuid(createProject(['master'],'b'.repeat(64)),'master'),
    /CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED/);
  const malformed={expectedSha256:sha,
    async catalog(){return {sha256:sha,catalog:{kind:'textures',offset:0,
      total:1,entries:[],next_offset:null}};}};
  await assert.rejects(assertUniqueSavedMaterialTextureUuid(malformed,'master'),
    /CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED/);
  const unavailable={expectedSha256:sha,async catalog(){throw Error('unavailable');}};
  await assert.rejects(assertUniqueSavedMaterialTextureUuid(unavailable,'master'),
    /CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED/);
});
test('host retains sole selection and authorization; identity module cannot write',async()=>{
  const [host,identity]=await Promise.all([
    readFile(new URL('./host.mjs',import.meta.url),'utf8'),
    readFile(new URL('./material-reference-source-identity.mjs',import.meta.url),'utf8'),
  ]);
  assert.match(host,/assertUniqueSavedMaterialTextureUuid\(initialProject,referenceMaster\)/);
  assert.match(host,/authorizeMutation: async \(request\) =>/);
  assert.match(host,/permitWriteLaunch: \(request\) =>/);
  assert.doesNotMatch(identity,/\bspawn\s*\(|\bexecFile\s*\(|\bpublish_new\w*\s*\(|\bauthorizeMutation\s*\(/);
  assert.match(identity,/receipt\?\.sha256!==project.expectedSha256/);
  assert.match(identity,/matches!==1/);
});

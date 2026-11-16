// SOURCE_AUTHORED_NOT_RUN: no local/CI/native execution.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';
const SHA='a'.repeat(64);
const CUBE='00000000-0000-4000-8000-000000000002';
const TEX='00000000-0000-4000-8000-000000000101';
const query={kind:'material_face_patch',texture_uuid:TEX,cube_uuid:CUBE,
  face:'north',region:{from:[2,3],to:[4,5]}};

test('face patch read serializes one SHA-pinned strict Rust inspector',async()=>{
  let calls=0;
  const client=createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',
    runner:async argv=>{
      calls++;
      assert.equal(argv[0],'inspect-batch');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
      const plan=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
      assert.deepEqual(plan,{requests:[query]});
      return {status:'OK',sha256:SHA,results:[{
        kind:'material_face_patch',binding:{
          scope:'source_explicit_cube_face_patch',
          status:'bound_source_only',face:'north',cube_uuid:CUBE,
          texture_uuid:TEX,visual_verdict:'UNVERIFIED',
          face_coverage_verdict:'UNVERIFIED',
          view_correspondence:'NOT_VERIFIED',
        },
      }]};
    },
  });
  const result=await client.inspectBatch({
    input:'/abs/model.bbmodel',expectedSha256:SHA,requests:[query],
  });
  assert.equal(result.results[0].binding.view_correspondence,'NOT_VERIFIED');
  assert.equal(calls,1);
});
test('unbounded/unknown face mappings never launch Rust',async()=>{
  let called=0;
  const client=createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',
    runner:async()=>{called++;throw Error('MUST_NOT_EXECUTE');},
  });
  for(const bad of [
    {...query,face:'front'},
    {...query,region:{from:[4,3],to:[4,5]}},
    {...query,region:{from:[1,1],to:[260,2]}},
    {...query,region:{from:[0,0],to:[128,65]}},
    {...query,region:{from:[0,0],to:[1,1],untrusted:true}},
    {...query,cube_uuid:'cube\nmalformed'},
    {...query,secret:'arbitrary'},
  ]){
    await assert.rejects(client.inspectBatch({
      input:'/abs/model.bbmodel',expectedSha256:SHA,requests:[bad],
    }));
  }
  assert.equal(called,0);
});

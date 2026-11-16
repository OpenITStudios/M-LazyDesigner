// SOURCE_ONLY, TEST_AUTHORED_NOT_RUN; no PC, Node or Cargo execution.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';
const SHA='a'.repeat(64);
const TEX='00000000-0000-4000-8000-000000007101';
const region={from:[0,0],to:[8,8]};
test('Rust texture styling query is one hash-bound source read, not visual PASS',async()=>{
  let calls=0;
  const client=createRustCodeModeClient({
    binary:'/abs/rust-cli',
    runner:async argv=>{
      calls++;
      assert.equal(argv[0],'inspect-batch');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
      const payload=JSON.parse(await readFile(
        argv[argv.indexOf('--queries')+1],'utf8'));
      assert.deepEqual(payload,{requests:[{
        kind:'texture_styling',texture_uuid:TEX,region,
      }]});
      return {status:'OK',sha256:SHA,results:[{
        kind:'texture_styling',styling:{
          scope:'selected_saved_rgba8_atlas_region',
          status:'BASE_ONLY_CANDIDATE',
          visual_verdict:'UNVERIFIED',
          texture_completion_attested:false,
          review_hints:['UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE'],
        },
      }]};
    },
  });
  const result=await client.inspectBatch({
    input:'/abs/model.bbmodel',expectedSha256:SHA,
    requests:[{kind:'texture_styling',texture_uuid:TEX,region}],
  });
  assert.equal(result.results[0].styling.status,'BASE_ONLY_CANDIDATE');
  assert.equal(result.results[0].styling.visual_verdict,'UNVERIFIED');
  assert.equal(calls,1);
});
test('out-of-bounds or forged styling crop refuses before CLI launch',async()=>{
  let writes=0;
  const client=createRustCodeModeClient({
    binary:'/abs/rust-cli',runner:async()=>{
      writes++;throw Error('NATIVE_CALL_UNEXPECTED');
    },
  });
  for(const invalid of [
    {from:[0,0],to:[0,4]},
    {from:[0,0],to:[128,64]},
    {from:[-1,0],to:[2,2]},
    {from:[0,0],to:[1,1],hidden:true},
  ]){
    await assert.rejects(client.inspectBatch({
      input:'/abs/model.bbmodel',expectedSha256:SHA,
      requests:[{kind:'texture_styling',texture_uuid:TEX,region:invalid}],
    }));
  }
  assert.equal(writes,0);
});

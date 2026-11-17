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

test('face-local styling inspection uses the pinned Rust source and never claims art PASS',async()=>{
  let launches=0;
  const cube='00000000-0000-4000-8000-000000007102';
  const client=createRustCodeModeClient({binary:'/abs/rust-cli',
    runner:async argv=>{
      launches++;
      assert.equal(argv[0],'inspect-batch');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
      const payload=JSON.parse(await readFile(
        argv[argv.indexOf('--queries')+1],'utf8'));
      assert.deepEqual(payload.requests,[{
        kind:'texture_styling_face',texture_uuid:TEX,cube_uuid:cube,face:'north',
      }]);
      return {status:'OK',sha256:SHA,results:[{
        kind:'texture_styling_face',styling:{
          scope:'saved_cube_face_local_pixels',face:'north',
          status:'REVIEW_REQUIRED',uv_rotation:90,
          review_hints:['UNIFORM_HORIZONTAL_BANDS_REVIEW'],
          visual_verdict:'UNVERIFIED',texture_completion_attested:false,
        },
      }]};
    },
  });
  const report=await client.inspectBatch({
    input:'/abs/model.bbmodel',expectedSha256:SHA,
    requests:[{kind:'texture_styling_face',texture_uuid:TEX,
      cube_uuid:cube,face:'north'}],
  });
  assert.equal(report.results[0].styling.uv_rotation,90);
  assert.equal(report.results[0].styling.visual_verdict,'UNVERIFIED');
  assert.equal(launches,1);
});
test('face-local styling rejects bad IDs, face names and surplus fields before Rust',async()=>{
  let launches=0;
  const client=createRustCodeModeClient({binary:'/abs/rust-cli',runner:async()=>{
    launches++;throw Error('NO_LAUNCH');
  }});
  for(const item of [
    {texture_uuid:TEX,cube_uuid:'part bad',face:'north'},
    {texture_uuid:TEX,cube_uuid:'part',face:'front'},
    {texture_uuid:TEX,cube_uuid:'part',face:'north',claim:'PASS'},
  ]){
    await assert.rejects(client.inspectBatch({
      input:'/abs/model.bbmodel',expectedSha256:SHA,
      requests:[{kind:'texture_styling_face',...item}],
    }));
  }
  assert.equal(launches,0);
});

test('source palette query returns SHA-bound original crop RGBAs without authorizing Paint',async()=>{
  const launches=[];
  const client=createRustCodeModeClient({binary:'/abs/rust-cli',
    runner:async argv=>{
      launches.push(argv);
      assert.equal(argv[0],'inspect-batch');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
      const query=JSON.parse(await readFile(
        argv[argv.indexOf('--queries')+1],'utf8'));
      assert.deepEqual(query.requests,[{
        kind:'texture_source_colors',texture_uuid:TEX,region,
      }]);
      return {status:'OK',sha256:SHA,results:[{
        kind:'texture_source_colors',colors:{
          scope:'saved_physical_atlas_original_rgba_colors',
          texture_uuid:TEX,region,sampled_pixels:64,unique_rgba:3,
          colors:[
            {rgba:[80,100,120,255],pixels:40},
            {rgba:[0,0,0,0],pixels:20},
            {rgba:[170,25,25,255],pixels:4},
          ],
          complete:true,reason:null,visual_verdict:'UNVERIFIED',
          texture_completion_attested:false,
          note:'Original source palette, not approval.',
        },
      }]};
    },
  });
  const report=await client.inspectBatch({
    input:'/abs/model.bbmodel',expectedSha256:SHA,
    requests:[{kind:'texture_source_colors',texture_uuid:TEX,region}],
  });
  const colors=report.results[0].colors;
  assert.equal(colors.unique_rgba,3);
  assert.deepEqual(colors.colors[2].rgba,[170,25,25,255]);
  assert.equal(colors.visual_verdict,'UNVERIFIED');
  assert.equal(colors.texture_completion_attested,false);
  assert.equal(launches.length,1);
});
test('source palette query refuses oversized and injected inputs before CLI launch',async()=>{
  let launches=0;
  const client=createRustCodeModeClient({binary:'/abs/rust-cli',
    runner:async()=>{launches++;throw Error('UNEXPECTED_READ');},
  });
  for(const query of [
    {kind:'texture_source_colors',texture_uuid:TEX,
      region:{from:[0,0],to:[100,100]}},
    {kind:'texture_source_colors',texture_uuid:TEX,
      region:{from:[0,0],to:[2,2]},claimed_approved:true},
    {kind:'texture_source_colors',texture_uuid:'not valid',
      region:{from:[0,0],to:[2,2]}},
  ]) {
    await assert.rejects(client.inspectBatch({
      input:'/abs/model.bbmodel',expectedSha256:SHA,requests:[query],
    }));
  }
  assert.equal(launches,0);
});

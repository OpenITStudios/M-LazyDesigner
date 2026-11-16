// SOURCE_AUTHORED_NOT_RUN: no PC, Deno, Cargo or Blockbench execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRustCodeModeClient,openRustCodeModeProject} from './client.mjs';

const SHA='a'.repeat(64);
const query={
  kind:'material_pair',
  reference_uuid:'tier-1-master',
  candidate_uuid:'tier-2',
  reference_region:{from:[0,0],to:[3,2]},
  candidate_region:{from:[8,4],to:[11,6]},
};

test('source-bound material pairs serialize one Rust-owned read', async () => {
  const calls=[];
  const client=createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',
    runner:async argv=>{
      calls.push(argv[0]);
      if(argv[0]==='inspect')return {status:'OK',sha256:SHA,summary:{revision:0}};
      assert.equal(argv[0],'inspect-batch');
      const document=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
      assert.deepEqual(document,{requests:[query]});
      return {status:'OK',sha256:SHA,results:[{kind:'material_pair',comparison:{
        scope:'saved_rgba8_material_patch_pair',source_state:'measured',
        reference_texture_uuid:'tier-1-master',candidate_texture_uuid:'tier-2',
        visual_verdict:'UNVERIFIED',material_verdict:'NOT_EVALUATED',
        reference:{unique_visible_rgb:5},candidate:{unique_visible_rgb:1},
        attention_candidates:['LOWER_COLOR_VARIATION_THAN_REFERENCE'],
      }}]};
    },
  });
  const project=await openRustCodeModeProject(client,'/abs/pillager.bbmodel');
  const report=await project.inspectBatch([query]);
  assert.equal(report.results[0].comparison.visual_verdict,'UNVERIFIED');
  assert.equal(report.results[0].comparison.candidate.unique_visible_rgb,1);
  assert.deepEqual(calls,['inspect','inspect-batch']);
});

test('SDK refuses unbounded material patches before calling native Rust',async()=>{
  let calls=0;
  const client=createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',
    runner:async()=>{calls++;throw Error('MUST_NOT_RUN');},
  });
  for(const invalid of [
    {...query,reference_region:{from:[0,0],to:[0,1]}},
    {...query,candidate_region:{from:[1,1],to:[257,2]}},
    {...query,reference_region:{from:[0,0],to:[128,64]}},
    {...query,candidate_region:{from:[0,0],to:[1,1],unexpected:true}},
    {...query,reference_region:'not-a-rectangle'},
    {...query,candidate_region:{from:[-1,0],to:[2,2]}},
  ]) {
    await assert.rejects(client.inspectBatch({
      input:'/abs/pillager.bbmodel',expectedSha256:SHA,requests:[invalid],
    }));
  }
  assert.equal(calls,0);
});

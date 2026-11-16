// SOURCE_AUTHORED_NOT_RUN: no CI/PC-local/native execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {normalizedMaterialCorrectionIntent,createRustCodeModeClient} from './client.mjs';

const SHA='a'.repeat(64);
const intent={
  issueId:'helmet-flat',approachId:'helmet-value-masses',
  partId:'tier2-helmet',material:'metal',
  cause:'The helmet currently has a single flat horizontal stripe.',
  treatment:'form_value_masses',
  expectedChange:'Rebuild distinct base, shadow and highlight masses around helmet curvature.',
};
test('material diagnosis is frozen and present in trusted approval, not silently written to bbmodel',async()=>{
  assert.ok(Object.isFrozen(normalizedMaterialCorrectionIntent(intent)));
  let approval;
  const client=createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',
    authorizeMutation:request=>{approval=request;return true;},
    runner:async argv=>{
      assert.equal(argv[0],'apply');
      const rust=JSON.parse(await readFile(argv[argv.indexOf('--plan')+1],'utf8'));
      assert.equal(rust.correctionIntent,undefined);
      assert.equal(rust.operations[0].op,'paint_texture_pixel');
      return {status:'OK',mutation:{revision:1,operation_count:1,changed_uuids:[]}};
    },
  });
  await client.apply({
    input:'/abs/pillager.bbmodel',output:'/abs/pillager-new.bbmodel',
    expectedSha256:SHA,correctionIntent:intent,
    operations:[{op:'paint_texture_pixel',texture_index:0,
      x:1,y:1,rgba:[70,90,120,255]}],
  });
  assert.equal(approval.materialCorrectionIntent.issueId,'helmet-flat');
  assert.equal(approval.materialCorrectionIntent.approachId,'helmet-value-masses');
  assert.match(approval.materialIntentSha256,/^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(approval.materialCorrectionIntent));
});
test('unsupported material recipe or unbounded reasoning cannot pass correction intent',()=>{
  for(const bad of [
    null,{}, {...intent,issueId:'invalid id'},
    {...intent,treatment:'generic_noise'},
    {...intent,material:'unknown-magical-metal'},
    {...intent,cause:'flat'},
    {...intent,expectedChange:''},
    {...intent,partId:'../escape'},
    {...intent,unreviewed:true},
  ]) assert.throws(()=>normalizedMaterialCorrectionIntent(bad));
  assert.equal(normalizedMaterialCorrectionIntent(undefined),undefined);
});

// Source-authored only; local/runtime tests remain on hold.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createRustCodeModeClient, openRustCodeModeProject} from './client.mjs';

const SHA = 'a'.repeat(64);
const operation = {op:'paint_texture_pixel',texture_index:0,
  x:1,y:2,rgba:[80,90,100,255]};
const correctionScope = {textureUuid:'approved-tier-2',
  allowedRegions:[{from:[1,1],to:[3,3]}],preserveAlpha:true};

test('approved correction scope is bound to the serialized Rust plan and approval', async () => {
  const approvals = [];
  let written;
  const client = createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',
    authorizeMutation: descriptor => {approvals.push(descriptor);return true;},
    runner: async args => {
      if (args[0] === 'inspect') {
        return {status:'OK',sha256:SHA,summary:{revision:0}};
      }
      assert.equal(args[0],'apply');
      written = JSON.parse(await readFile(args[args.indexOf('--plan')+1],'utf8'));
      return {status:'OK',source_sha256:SHA,
        output_sha256:'b'.repeat(64),summary:{revision:1},
        mutation:{revision:1,operation_count:1,
          changed_uuids:['approved-tier-2']},
        correction_scope:{status:'enforced',texture_uuid:'approved-tier-2',
          protected_regions:0,expected_before_pixels:0,
          editable_before_rgba:0,visual_verdict:'UNVERIFIED'}};
    },
  });
  const model = await openRustCodeModeProject(client,'/abs/pillager.bbmodel');
  const result = await model.apply({output:'/abs/pillager-repaired.bbmodel',
    operations:[operation],correctionScope});
  assert.deepEqual(written,{
    expected_revision:0,operations:[operation],
    correction_scope:{texture_uuid:'approved-tier-2',
      allowed_regions:[{from:[1,1],to:[3,3]}],preserve_alpha:true}
  });
  assert.deepEqual(approvals[0].correctionScope,{
    textureUuid:'approved-tier-2',
    allowedRegions:[{from:[1,1],to:[3,3]}],
    regionCount:1,preserveAlpha:true,
  });
  assert.ok(Object.isFrozen(approvals[0].correctionScope.allowedRegions));
  assert.ok(Object.isFrozen(approvals[0].correctionScope.allowedRegions[0].from));
  assert.match(approvals[0].planSha256,/^[a-f0-9]{64}$/);
  assert.equal(result.correction_scope.visual_verdict,'UNVERIFIED');
});

test('invalid scope refuses before trusted approval or CLI invocation', async () => {
  let called=0;
  const client = createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',
    authorizeMutation: () => {called++;return true;},
    runner: async () => {called++;throw new Error('unexpected run');},
  });
  const args={input:'/abs/pillager.bbmodel',output:'/abs/after.bbmodel',
    expectedSha256:SHA,operations:[operation]};
  for(const bad of [
    null,
    {...correctionScope,wrong:true},
    {...correctionScope,allowedRegions:[]},
    {...correctionScope,allowedRegions:[{from:[4,4],to:[4,5]}]},
    {...correctionScope,allowedRegions:[{from:[0,0],to:[257,2]}]},
    {...correctionScope,preserveAlpha:'true'},
  ]){
    await assert.rejects(client.apply({...args,correctionScope:bad}));
  }
  assert.equal(called,0);
});

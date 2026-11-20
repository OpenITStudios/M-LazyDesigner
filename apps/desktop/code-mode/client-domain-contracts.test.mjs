// TEST_AUTHORED_NOT_RUN: typed SDK consumers and refusal invariants.
// Future user-authorized local Node validation only; no CI/cloud substitute.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {normalizedCorrectionScope as sdkNormalizeScope,
  normalizedMaterialCorrectionIntent as sdkNormalizeIntent} from './client.mjs';
import {normalizedCorrectionScope,normalizedMaterialCorrectionIntent,
  checkedScopedApplyReceipt} from './texture-correction-contract.mjs';
import {serializeGeometryAssembly,serializeGeometryAttachment,
  serializeGeometryPropagation,generatedBlockoutCubeUuid,
  generatedSweepCubeUuid,generatedProfileCubeUuid} from './geometry-plan-input-transport.mjs';
import {serializeSemanticMaterialIntent} from './semantic-material-intent-transport.mjs';

test('existing SDK exports remain identical bindings to the canonical correction contract',()=>{
  assert.equal(sdkNormalizeScope,normalizedCorrectionScope);
  assert.equal(sdkNormalizeIntent,normalizedMaterialCorrectionIntent);
  assert.equal(normalizedCorrectionScope(undefined),undefined);
  assert.deepEqual(normalizedCorrectionScope({
    textureUuid:'source-texture',allowedRegions:[{from:[0,0],to:[2,2]}],
    preserveAlpha:true,
  }),{
    texture_uuid:'source-texture',allowed_regions:[{from:[0,0],to:[2,2]}],
    preserve_alpha:true,
  });
  assert.throws(()=>normalizedCorrectionScope({
    textureUuid:'source-texture',allowedRegions:[{from:[2,2],to:[1,1]}],
  }),/CORRECTION_SCOPE_INVALID/);
  assert.throws(()=>normalizedCorrectionScope({
    textureUuid:'source-texture',allowedRegions:[{from:[0,0],to:[1,1]}],
    expectedBeforePixels:[{at:[0,0],rgba:[1,2,3,255]},{at:[0,0],rgba:[1,2,3,255]}],
  }),/CORRECTION_SCOPE_INVALID/);
  assert.throws(()=>normalizedMaterialCorrectionIntent({
    issueId:'wrong id',approachId:'a',partId:'b',material:'wood',
    treatment:'palette_roles',cause:'Source values are inconsistent',
    expectedChange:'Align source palette to reference',
  }),/MATERIAL_CORRECTION_INTENT_INVALID/);
});
test('Rust correction receipt still requires exact source, revision and bounded pixel evidence',()=>{
  const scope=normalizedCorrectionScope({
    textureUuid:'source-texture',allowedRegions:[{from:[0,0],to:[1,1]}],
  });
  const source='a'.repeat(64);
  const valid={source_sha256:source,output_sha256:'b'.repeat(64),
    mutation:{revision:1,operation_count:1},summary:{revision:1},
    correction_scope:{status:'enforced',texture_uuid:'source-texture',
      visual_verdict:'UNVERIFIED',protected_regions:0,
      expected_before_pixels:0,editable_before_rgba:0}};
  assert.equal(checkedScopedApplyReceipt(valid,scope,source,1),valid);
  assert.throws(()=>checkedScopedApplyReceipt({
    ...valid,correction_scope:{...valid.correction_scope,visual_verdict:'PASS'}
  },scope,source,1),/CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED/);
  assert.throws(()=>checkedScopedApplyReceipt(valid,scope,'c'.repeat(64),1),
    /CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED/);
});
test('Geometry plan transport never infers edits or includes read-only void zones in native plan',()=>{
  assert.equal(serializeGeometryAssembly({
    expected_revision:0,parts:[{bone:{uuid:'bone',name:'shape'},cubes:[]}],
    void_zones:[{name:'read-only-evidence'}],
  }).includes('void_zones'),false);
  assert.throws(()=>serializeGeometryAssembly({expected_revision:1,parts:[{}]}),
    /CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_INVALID/);
  assert.throws(()=>serializeGeometryAttachment({expected_revision:1}),
    /CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_INVALID/);
  assert.throws(()=>serializeGeometryPropagation({expected_revision:0,links:[]}),
    /CODE_MODE_GEOMETRY_PROPAGATION_INPUT_INVALID/);
  for(const uuid of [
    generatedBlockoutCubeUuid('geometry-sweep-v1','seed',0),
    generatedSweepCubeUuid('seed',0),generatedProfileCubeUuid('seed',0),
  ])assert.match(uuid,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(generatedBlockoutCubeUuid('geometry-sweep-v1','seed',0),
    generatedSweepCubeUuid('seed',0));
});
test('Semantic material proposal remains bounded and cannot self-approve',()=>{
  const request={expected_revision:0,reference_png_sha256:'a'.repeat(64),
    cube_uuid:'cube',texture_uuid:'texture',face:'north',
    material:'painted_metal',light_corner:'upper_left',contrast:'subtle',
    source_base_rgba:[20,30,40,255],shadow_rgb:[10,20,30],
    highlight_rgb:[50,60,70],protected_regions:[],expected_before_pixels:[]};
  assert.equal(JSON.parse(serializeSemanticMaterialIntent(request)).cube_uuid,'cube');
  assert.throws(()=>serializeSemanticMaterialIntent({
    ...request,source_base_rgba:[20,30,40,0],
  }),/CODE_MODE_SEMANTIC_MATERIAL_INPUT_INVALID/);
  assert.throws(()=>serializeSemanticMaterialIntent({...request,approval:true}),
    /CODE_MODE_SEMANTIC_MATERIAL_INPUT_INVALID/);
});
test('all new module names identify one transport/validation owner without native calls',async()=>{
  const names=['texture-correction-contract.mjs','geometry-plan-input-transport.mjs',
    'semantic-material-intent-transport.mjs'];
  for(const name of names){
    const code=await readFile(new URL('./'+name,import.meta.url),'utf8');
    assert.doesNotMatch(code,/\bexecFile\s*\(|\bspawn\s*\(|\bauthorizeMutation\s*\(|\bpublish_new\w*\s*\(|\beval\s*\(/);
  }
});

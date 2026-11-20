// TEST_AUTHORED_NOT_RUN: Node SDK source/negative-control fixtures, not execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createGeometryProposalSdkMethods}
  from './geometry-proposal-sdk-methods.mjs';

test('Geometry planning uses the same parent CLI transport and only read-only verbs',async()=>{
  const client=await readFile(new URL('./client.mjs',import.meta.url),'utf8');
  const source=await readFile(new URL('./geometry-proposal-sdk-methods.mjs',import.meta.url),'utf8');
  assert.match(client,/\.\.\.createGeometryProposalSdkMethods\(\{call,absolute,hash\}\)/);
  assert.match(client,/async apply\(/);
  assert.match(client,/async preflight\(/);
  assert.match(client,/permitWriteLaunch\(approval\)/);
  for(const method of ['planGeometryResizePropagation','planGeometryAttachment','planGeometryAssembly']){
    assert.match(source,new RegExp('async '+method+'\\('));
    assert.doesNotMatch(client,new RegExp('async '+method+'\\('));
  }
  for(const verb of ['plan-geometry-resize-propagation','plan-geometry-attachment',
    'plan-geometry-assembly'])assert.ok(source.includes("call('"+verb+"'"));
  for(const expectedRefusal of ['CODE_MODE_GEOMETRY_PROPAGATION_RECEIPT_INVALID',
    'CODE_MODE_GEOMETRY_ATTACHMENT_RECEIPT_INVALID',
    'CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID',
    'CODE_MODE_GEOMETRY_VOID_EVIDENCE_INVALID'])assert.ok(source.includes(expectedRefusal));
  assert.doesNotMatch(source,/requestWrite\s*\(|permitWriteLaunch\s*\(|authorizeMutation\s*\(|\bexecFile\s*\(|\bspawn\s*\(/);
});
test('Invalid Geometry plans refuse before any native Rust invocation',async()=>{
  const calls=[];
  const methods=createGeometryProposalSdkMethods({
    hash:v=>v,absolute:v=>v,
    call:async(command)=>{calls.push(command);return {status:'OK'};},
  });
  const common={input:'/source.bbmodel',expectedSha256:'a'.repeat(64)};
  await assert.rejects(
    methods.planGeometryResizePropagation({...common,
      propagation:{expected_revision:1,links:[]}}),
    /CODE_MODE_GEOMETRY_PROPAGATION_INPUT_INVALID/);
  await assert.rejects(
    methods.planGeometryAttachment({...common,
      attachment:{expected_revision:1}}),
    /CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_INVALID/);
  await assert.rejects(
    methods.planGeometryAssembly({...common,
      assembly:{expected_revision:1,parts:[]}}),
    /CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_INVALID/);
  assert.deepEqual(calls,[]);
});

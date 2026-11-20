// SOURCE-AUTHORED_NOT_RUN; native/PC acceptance remains deferred.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseWorkflow,writeDomain,admits,createWorkflowGate} from './workflow-gate.mjs';
const A='a'.repeat(64),B='b'.repeat(64);
const note=(o={})=>{
  const v={stage:'GEOMETRY',g:'IN_PROGRESS',uv:'NOT_STARTED',t:'NOT_STARTED',
    a:'NOT_STARTED',required:'YES',block:'none',model:'source.bbmodel',sha:A,...o};
  return ['# asset','Current Stage: '+v.stage,'Geometry: '+v.g,'UV Layout: '+v.uv,
    'Texturing: '+v.t,'Animation: '+v.a,'Animation Required: '+v.required,
    'Known blocker(s): '+v.block,
    ...(v.model?['Current model file: '+v.model]:[]),
    ...(v.sha?['Workflow Model SHA256: sha256:'+v.sha]:[])].join('\n');
};
test('Stage sequence gates Geometry UV Texture Animation and Finalization',()=>{
  assert.equal(admits(parseWorkflow(note()),'GEOMETRY'),true);
  assert.equal(admits(parseWorkflow(note()),'TEXTURING'),false);
  assert.equal(admits(parseWorkflow(note({g:'APPROVED',uv:'IN_PROGRESS'})),'UV'),true);
  assert.equal(admits(parseWorkflow(note({stage:'TEXTURING',g:'APPROVED',
    uv:'PASS',t:'IN_PROGRESS'})),'TEXTURING'),true);
  assert.equal(admits(parseWorkflow(note({stage:'TEXTURING',g:'APPROVED',
    uv:'PASS',t:'IN_PROGRESS'})),'ANIMATION'),false);
  assert.equal(admits(parseWorkflow(note({stage:'ANIMATION',g:'APPROVED',
    uv:'PASS',t:'APPROVED',a:'IN_PROGRESS'})),'ANIMATION'),true);
  const final=parseWorkflow(note({stage:'FINALIZATION',g:'APPROVED',
    uv:'PASS',t:'APPROVED',a:'APPROVED'}));
  assert.equal(admits(final,'EXPORT',{animations:0}),false);
  assert.equal(admits(final,'EXPORT',{animations:2}),true);
  const still=parseWorkflow(note({stage:'FINALIZATION',g:'APPROVED',
    uv:'PASS',t:'APPROVED',a:'NOT_REQUIRED',required:'NO'}));
  assert.equal(admits(still,'EXPORT',{animations:0}),true);
  assert.equal(admits(still,'EXPORT',{animations:1}),false);
});
test('unknown/mixed edits and malformed or duplicate status refuse',()=>{
  assert.equal(writeDomain({operation:'apply',operationKinds:[
    'set_face_uv','set_box_uv_offset']}),'UV');
  assert.throws(()=>writeDomain({operation:'apply',operationKinds:[
    'translate_cube','paint_texture_pixel']}),/MIXED_PLAN/);
  assert.throws(()=>writeDomain({operation:'apply',operationKinds:[
    'unknown']}),/OP_UNKNOWN/);
  assert.throws(()=>parseWorkflow(note()+'\nGeometry: APPROVED'),/FIELD_DUPLICATED/);
  assert.throws(()=>parseWorkflow(note({a:'NOT_REQUIRED'})),/STATE_INVALID/);
  assert.throws(()=>parseWorkflow(note({model:'../escape.bbmodel'})),/MODEL_INVALID/);
  assert.equal(admits(parseWorkflow(note({block:'geometry correction'})),'GEOMETRY'),true);
});
test('same-session verified sibling allowed; changed README, stale model fail',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'ld-stage-'));
  try{
    const source=join(folder,'source.bbmodel'),next=join(folder,'next.bbmodel');
    await writeFile(source,'{}');await writeFile(join(folder,'README.md'),note());
    const gate=createWorkflowGate({folder,source,sourceSha:A});
    const request=(input,sha,op)=>({operation:'apply',input,
      expectedSha256:sha,operationKinds:[op]});
    const lease=await gate.authorize(request(source,A,'add_cube'));
    assert.equal(gate.leaseValid(lease),true);
    await assert.rejects(gate.authorize(request(source,A,'paint_texture_pixel')),
      /STAGE_BLOCKED/);
    gate.register(next,B);
    await gate.authorize(request(next,B,'add_bone'));
    await assert.rejects(gate.authorize(request(next,A,'add_bone')),/SOURCE_STALE/);
    await writeFile(join(folder,'README.md'),note({stage:'TEXTURING',g:'APPROVED',
      uv:'PASS',t:'IN_PROGRESS',model:'next.bbmodel',sha:B}));
    assert.equal(gate.leaseValid(lease),false);
    await assert.rejects(gate.authorize(request(next,B,'paint_texture_pixel')),
      /README_CHANGED/);
    const resumed=createWorkflowGate({folder,source:next,sourceSha:B});
    await resumed.authorize(request(next,B,'paint_texture_pixel'));
  }finally{await rm(folder,{recursive:true,force:true})}
});

test('saved SHA256 field is parsed, checked and not silently omitted',()=>{
  const parsed=parseWorkflow(note());
  assert.equal(parsed.model,'source.bbmodel');
  assert.equal(parsed.sha,A);
  assert.throws(()=>parseWorkflow(note()+'\nWorkflow Model SHA256: sha256:'+A),
    /FIELD_DUPLICATED/);
  assert.throws(()=>parseWorkflow(note({sha:'z'.repeat(64)})),/SHA_INVALID/);
  assert.equal(parseWorkflow(note({sha:null})).sha,null);
});


test('Workflow Gate operation kinds and limits match the canonical Rust EditOperation enum',async()=>{
  // Static source parity: future native operations must not silently bypass
  // the external-host stage inventory. Executed only in later PC-local phase.
  const source=await readFile(
    new URL('../src-tauri/src/authoring/mod.rs',import.meta.url),'utf8');
  const declared=source.match(/pub enum EditOperation \{([\s\S]*?)^\}/m);
  assert.ok(declared,'Rust EditOperation enum must be readable');
  const toSnake=name=>name.replace(/[A-Z]/g,
    (letter,index)=>(index?'_':'')+letter.toLowerCase());
  const kinds=[...declared[1].matchAll(/^    ([A-Z][A-Za-z0-9]+)\s*\{/gm)]
    .map(match=>toSnake(match[1]));
  assert.ok(kinds.length>=1);
  assert.equal(new Set(kinds).size,kinds.length);
  // All Rust operations are classified in the trusted host, rather
  // than quietly defaulting to Geometry when the compiler adds a variant.
  for(const kind of kinds){
    assert.doesNotThrow(()=>writeDomain({
      operation:'apply',operationKinds:[kind],
    }),kind+' needs an explicit production Stage');
  }
  const limit=Number(source.match(/const MAX_OPERATIONS: usize = (\d+);/)?.[1]);
  assert.equal(limit,128,'native transaction limit changed; reconcile the host');
  const allowed={operation:'apply',operationKinds:Array(limit).fill('add_cube')};
  assert.equal(writeDomain(allowed),'GEOMETRY');
  assert.throws(()=>writeDomain({operation:'apply',
    operationKinds:Array(limit+1).fill('add_cube'),
  }),/CODE_MODE_WORKFLOW_OP_UNKNOWN/);
});


test('read-only Start/Resume orientation binds exactly one saved asset',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'ld-orient-'));
  try{
    const source=join(folder,'source.bbmodel');
    const file=join(folder,'README.md');
    const gate=createWorkflowGate({folder,source,sourceSha:A});
    assert.deepEqual(await gate.orient(),{
      status:'BLOCKED',reason:'CODE_MODE_WORKFLOW_README_REQUIRED',
    });
    await writeFile(file,note());
    const bound=await gate.orient();
    assert.equal(bound.status,'SOURCE_BOUND');
    assert.equal(bound.currentStage,'GEOMETRY');
    assert.equal(bound.geometry,'IN_PROGRESS');
    assert.equal(bound.uvLayout,'NOT_STARTED');
    assert.equal(bound.animationRequired,'YES');
    assert.equal(bound.approvalEvidence,'NOT_ATTESTED');
    await writeFile(file,note({stage:'TEXTURING',g:'APPROVED',
      uv:'PASS',t:'IN_PROGRESS'}));
    assert.equal((await gate.orient()).currentStage,'TEXTURING');
    const stale=createWorkflowGate({folder,source,sourceSha:B});
    assert.deepEqual(await stale.orient(),{
      status:'BLOCKED',reason:'CODE_MODE_WORKFLOW_SOURCE_STALE',
    });
    await assert.rejects(stale.authorize({operation:'apply',
      input:source,expectedSha256:B,operationKinds:['paint_texture_pixel']}),
      /CODE_MODE_WORKFLOW_SOURCE_STALE/);
  }finally{await rm(folder,{recursive:true,force:true})}
});

test('new asset orientation requires no previously bound model or approval',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'ld-orient-new-'));
  try{
    const file=join(folder,'README.md');
    const gate=createWorkflowGate({folder,source:null,sourceSha:null});
    await writeFile(file,note({model:null,sha:null}));
    assert.equal((await gate.orient()).status,'SOURCE_BOUND');
    assert.equal((await gate.orient()).approvalEvidence,'NOT_ATTESTED');
    await writeFile(file,note());
    assert.equal((await gate.orient()).status,'BLOCKED');
  }finally{await rm(folder,{recursive:true,force:true})}
});

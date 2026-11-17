// Regression SOURCE ONLY. Repository localtest/CI remain on hold.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import { createCodeModeHost, createCodeModeTool } from './host.mjs';
import { paintOperationsFingerprint } from './material-work-packet.mjs';

const HASH = 'a'.repeat(64);
const SUMMARY = { revision: 0, cubes: 1, bones: 1, textures: 0, animations: 0 };
// Mock exactly the canonical Rust correction receipt; source-only fixture,
// never evidence that Cargo or a native .bbmodel transaction actually ran.
function scopedNativeReceipt(textureUuid,{
  protectedRegions=0,expectedBeforePixels=0,editableBeforeRgba=0,
}={}) {
  return {status:'enforced',texture_uuid:textureUuid,
    protected_regions:protectedRegions,
    expected_before_pixels:expectedBeforePixels,
    editable_before_rgba:editableBeforeRgba,
    visual_verdict:'UNVERIFIED'};
}

const REVIEW_CUBE='00000000-0000-4000-8000-000000000002';
const ALL_FACE_SIDES=Object.freeze(['north','east','south','west','up','down']);
async function mockedNativeFaceBinding(argv, sha) {
  assert.equal(argv[0],'inspect-batch');
  const plan=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
  if(plan.requests.length===1 &&
      plan.requests[0].kind==='material_face_patch'){
    const q=plan.requests[0];
    assert.equal(q.cube_uuid,REVIEW_CUBE);
    assert.equal(q.face,'north');
    assert.equal(q.texture_uuid,'tier2-atlas');
    return {status:'OK',sha256:sha,summary:SUMMARY,
      results:[{kind:'material_face_patch',binding:{
        scope:'source_explicit_cube_face_patch',status:'bound_source_only',
        texture_uuid:q.texture_uuid,cube_uuid:q.cube_uuid,
        face:q.face,sample_region:q.region,
        texture_reference:'explicit_saved_link',
        pixel_alias:'no_detected_overlap_for_sample',
        visual_verdict:'UNVERIFIED',face_coverage_verdict:'UNVERIFIED',
        view_correspondence:'NOT_VERIFIED',
        ...(q.face_spans?{cluster_footprint:{
          scope:'saved_face_local_to_atlas',
          status:'within_selected_patch',
          span_count:q.face_spans.length,visual_verdict:'UNVERIFIED',
        }}:{}),
      }}]};
  }
  assert.deepEqual(plan.requests.map(x=>x.kind),[
    'material_face_patch','cube_face_alpha',
  ]);
  const q=plan.requests[0];
  assert.equal(q.cube_uuid,REVIEW_CUBE);
  assert.equal(q.face,'north');
  assert.equal(q.texture_uuid,'tier2-atlas');
  assert.equal(plan.requests[1].uuid,REVIEW_CUBE);
  return {
    status:'OK',sha256:sha,summary:SUMMARY,
    results:[
      {kind:'material_face_patch',binding:{
        scope:'source_explicit_cube_face_patch',status:'bound_source_only',
        texture_uuid:q.texture_uuid,cube_uuid:q.cube_uuid,face:q.face,
        sample_region:q.region,
        texture_reference:'explicit_saved_link',
        pixel_alias:'no_detected_overlap_for_sample',
        visual_verdict:'UNVERIFIED',
        face_coverage_verdict:'UNVERIFIED',
        view_correspondence:'NOT_VERIFIED',
      }},
      {kind:'cube_face_alpha',face_alpha:{
        scope:'saved_manual_face_uv_alpha',cube_uuid:REVIEW_CUBE,
        visual_verdict:'UNVERIFIED',face_coverage_verdict:'UNVERIFIED',
        face_count:6,faces:ALL_FACE_SIDES.map(side=>({
          side,saved_reference_kind:side==='south'?'null':'index',
          texture_uuid:side==='south'?null:'tier2-atlas',
          alpha:side===q.face?
            {status:'measured',region:{transparent_pixels:0}}:
            {status:'unsupported',reason:'UNVERIFIED'},
        })),
      }},
    ],
  };
}


function fakeGuest(request, whenResponse, initialHandle = 'p0') {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let started = false;
  let stopped = false;
  function message(value) {
    child.stdout.write(JSON.stringify(value) + '\n');
  }
  function finish(result, exit = 0) {
    message(result);
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit('close', exit, null));
  }
  child.stdin = new Writable({
    write(chunk, _encoding, next) {
      try {
        const value = JSON.parse(chunk.toString('utf8'));
        if (!started) {
          assert.equal(value.type, 'start');
          assert.ok(typeof value.code === 'string' && value.code.length > 0);
          assert.equal(value.initial.project, initialHandle);
          started = true;
          setImmediate(() => message({
            type: 'rpc', id: 1, method: request.method, args: [request.args],
          }));
        } else {
          assert.equal(value.type, 'rpc_result');
          assert.equal(value.id, 1);
          setImmediate(() => finish({
            type: 'done', value: whenResponse(value), logs: [],
          }));
        }
        next();
      } catch (error) {
        next(error);
      }
    },
  });
  child.kill = () => {
    if (!stopped) {
      stopped = true;
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', null, 'SIGTERM'));
    }
    return true;
  };
  return child;
}
async function fixture(work) {
  const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-host-fixture-'));
  try {
    const input = join(directory, 'source.bbmodel');
    await writeFile(input, '{}', 'utf8');
    return await work(input);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test('Code Mode exposes a single host-side code tool, with read-only RPC', () =>
  fixture(async (input) => {
    const calls = [];
    let spawns = 0;
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
      runner: async (args) => {
        calls.push(args);
        if (args[0] === 'inspect-batch') {
          return { status: 'OK', sha256: HASH, summary: SUMMARY,
            results: [{ kind: 'catalog', catalog: { kind: 'cubes',
              entries: [], total: 1, offset: 0, next_offset: null } }] };
        }
        return { status: 'OK', sha256: HASH, summary: SUMMARY };
      },
      spawnImpl: (_bin, flags, options) => {
        spawns++;
        assert.equal(options.shell, false);
        assert.equal(options.env.CODEX_API_KEY, undefined);
        assert.ok(flags.includes('--no-prompt'));
        assert.ok(flags.includes('--no-remote'));
        assert.ok(flags.includes('--no-npm'));
        assert.ok(!flags.some((flag) => flag.startsWith('--allow-')));
        return fakeGuest({ method: 'inspectBatch', args: {
          project: 'p0',
          requests: [{ kind: 'catalog', category: 'cubes', limit: 1 }],
        } }, (response) => {
          assert.equal(response.ok, true);
          assert.equal(response.result.results[0].kind, 'catalog');
          return { observed: response.result.results.length };
        });
      },
    });
    const tool = createCodeModeTool(host);
    assert.equal(tool.name, 'lazydesigner_code_mode');
    assert.deepEqual(tool.inputSchema.required, ['code']);
    const result = await tool.execute({ code: "return { x: 1 };" });
    assert.equal(result.status, 'OK');
    assert.equal(result.value.observed, 1);
    assert.equal(result.rpc_calls, 1);
    assert.equal(spawns, 1);
    assert.deepEqual(calls.map((args) => args[0]), ['inspect', 'inspect-batch']);
  }));

test('Code Mode host denies writes without operator approval or a safe output name', () =>
  fixture(async (input) => {
    for (const requestedOutput of ['candidate.bbmodel', '../escape.bbmodel']) {
      const calls = [];
      const host = await createCodeModeHost({
        rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
        runner: async (args) => {
          calls.push(args);
          return { status: 'OK', sha256: HASH, summary: SUMMARY };
        },
        spawnImpl: () => fakeGuest({ method: 'apply', args: {
          project: 'p0', output: requestedOutput,
          operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }],
        } }, (response) => {
          assert.equal(response.ok, false);
          assert.match(response.code,
            /CODE_MODE_MUTATION_NOT_APPROVED|CODE_MODE_OUTPUT_NAME_INVALID/);
          return { refused: true };
        }),
      });
      const report = await host.execute({ code: "return await codemode.apply({});" });
      assert.equal(report.value.refused, true);
      assert.deepEqual(calls.map((args) => args[0]), ['inspect']);
    }
  }));

test('operator-approved Rust edit returns a newly pinned project handle', () =>
  fixture(async (input) => {
    const calls = [];
    const approvals = [];
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
      authorizeMutation: async (request) => {
        approvals.push(request);
        return request.operation === 'apply' &&
          request.expectedSha256 === HASH &&
          request.operationCount === 1 &&
          typeof request.planSha256 === 'string';
      },
      runner: async (argv) => {
        calls.push(argv[0]);
        if (argv[0] === 'apply') {
          return { status: 'OK', source_sha256: HASH,
            output_sha256: 'b'.repeat(64), summary: { ...SUMMARY, revision: 1 },
            mutation: { revision: 1, operation_count: 1,
              changed_uuids: ['cube-1'] } };
        }
        return { status: 'OK', sha256: calls.length > 2 ? 'b'.repeat(64) : HASH,
          summary: SUMMARY };
      },
      spawnImpl: () => fakeGuest({ method: 'apply', args: {
        project: 'p0', output: 'candidate.bbmodel',
        operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }],
      } }, (response) => {
        assert.equal(response.ok, true);
        assert.equal(response.result.project, 'p1');
        assert.equal(response.result.receipt.mutation.revision, 1);
        return { project: response.result.project,
          receiptSha: response.result.receipt.output_sha256 };
      }),
    });
    const reply = await host.execute({ code: "return await codemode.apply({});" });
    assert.equal(reply.value.project, 'p1');
    assert.equal(reply.value.receiptSha, 'b'.repeat(64));
    assert.deepEqual(calls, ['inspect', 'apply', 'inspect']);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].operation, 'apply');
    assert.equal(approvals[0].operationKinds[0], 'translate_cube');
    assert.match(approvals[0].planSha256, /^[a-f0-9]{64}$/);
  }));

test('host forwards correction scope through guest RPC and bound Rust plan', () =>
  fixture(async input => {
    const approvals = [];
    let scopeInRust;
    const declared = {textureUuid:'approved-tier-2',
      allowedRegions:[{from:[1,1],to:[2,2]}],preserveAlpha:true};
    const host = await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      authorizeMutation: request => {
        approvals.push(request);
        return request.operation === 'apply' &&
          request.correctionScope?.textureUuid === 'approved-tier-2' &&
          JSON.stringify(request.correctionScope.allowedRegions) ===
            JSON.stringify([{from:[1,1],to:[2,2]}]) &&
          request.correctionScope.regionCount === 1;
      },
      runner: async argv => {
        if(argv[0]==='apply'){
          scopeInRust = JSON.parse(
            await readFile(argv[argv.indexOf('--plan')+1],'utf8')
          ).correction_scope;
          return {status:'OK',source_sha256:HASH,output_sha256:'b'.repeat(64),
            summary:{...SUMMARY,revision:1},
            mutation:{revision:1,operation_count:1,changed_uuids:[]},
            correction_scope:scopedNativeReceipt('approved-tier-2')};
        }
        return {status:'OK',sha256:
          basename(argv[argv.indexOf('--input')+1])==='candidate.bbmodel'?
          'b'.repeat(64):HASH,summary:SUMMARY};
      },
      spawnImpl:()=>fakeGuest({method:'apply',args:{
        project:'p0',output:'candidate.bbmodel',
        operations:[{op:'paint_texture_pixel',texture_index:0,
          x:1,y:1,rgba:[70,80,90,255]}],
        correctionScope:declared,
      }}, response=>{
        assert.equal(response.ok,true);
        assert.deepEqual(response.result.receipt.correction_scope,
          scopedNativeReceipt('approved-tier-2'));
        assert.equal(response.result.texturing_workflow.source_pixel_guards
          .verified_by_rust_receipt,true);
        return {approved:response.ok};
      }),
    });
    const report = await host.execute({code:'return await codemode.apply({});'});
    assert.equal(report.value.approved,true);
    assert.deepEqual(scopeInRust,{
      texture_uuid:'approved-tier-2',
      allowed_regions:[{from:[1,1],to:[2,2]}],
      preserve_alpha:true,
    });
    assert.equal(approvals.length,1);
  }));

// AUTHORING-SOURCE regression: actual material master UUID must originate
// from the trusted operator, not the model-generated inspection selector.
test('trusted host binds a selected master to the real Rust material read', () =>
  fixture(async input => {
    const selections=[];
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      approvedMaterialReferenceUuid:'tier-1-master',
      runner:async argv=>{
        if(argv[0]==='inspect' && argv.includes('--list')) {
          return {status:'OK',sha256:HASH,
            catalog:{kind:'textures',offset:0,total:1,next_offset:null,
              entries:[{uuid:'tier-1-master',name:'Tier 1',
                kind:'texture',index:0}]}};
        }
        if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        assert.equal(argv[0],'inspect-batch');
        const args=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
        selections.push(args.requests[0]);
        return {status:'OK',sha256:HASH,summary:SUMMARY,results:[{
          kind:'material_pair',
          comparison:{
            scope:'saved_rgba8_material_patch_pair',
            source_state:'measured',visual_verdict:'UNVERIFIED',
            material_verdict:'NOT_EVALUATED',
            reference_texture_uuid:'tier-1-master',
            candidate_texture_uuid:'tier-2',
          },
        }]};
      },
      spawnImpl:()=>fakeGuest({method:'inspectApprovedMaterial',args:{
        project:'p0',candidateTextureUuid:'tier-2',
        referenceRegion:{from:[0,0],to:[2,2]},
        candidateRegion:{from:[8,4],to:[10,6]},
      }},response=>{
        assert.equal(response.ok,true);
        assert.equal(response.result.reference_binding.reference_texture_uuid,'tier-1-master');
        assert.equal(response.result.reference_binding.source_model_sha256,HASH);
        assert.equal(response.result.results[0].comparison.visual_verdict,'UNVERIFIED');
        return {selected:response.result.reference_binding.reference_texture_uuid};
      }),
    });
    const result=await host.execute({code:'return await codemode.inspectApprovedMaterial({});'});
    assert.equal(result.value.selected,'tier-1-master');
    assert.deepEqual(selections,[{
      kind:'material_pair',reference_uuid:'tier-1-master',candidate_uuid:'tier-2',
      reference_region:{from:[0,0],to:[2,2]},
      candidate_region:{from:[8,4],to:[10,6]},
    }]);
  }));

test('operator material reference must resolve exactly once against the pinned source', () =>
  fixture(async input=>{
    const cases=[
      {entries:[{uuid:'unrelated',name:'Other',kind:'texture',index:0}],
        error:'CODE_MODE_MATERIAL_REFERENCE_NOT_FOUND'},
      {entries:[{uuid:'tier-1-master',name:'Tier 1',kind:'texture',index:0}],
        sha:'b'.repeat(64),
        error:'CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED'},
      {entries:[
        {uuid:'tier-1-master',name:'First',kind:'texture',index:0},
        {uuid:'tier-1-master',name:'Duplicated',kind:'texture',index:1},
      ],error:'CODE_MODE_MATERIAL_REFERENCE_AMBIGUOUS'},
    ];
    for(const item of cases){
      await assert.rejects(createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        approvedMaterialReferenceUuid:'tier-1-master',
        runner:async argv=>{
          if(argv.includes('--list')) return {status:'OK',
            sha256:item.sha??HASH,
            catalog:{kind:'textures',offset:0,total:item.entries.length,
              next_offset:null,entries:item.entries}};
          return {status:'OK',sha256:HASH,summary:SUMMARY};
        },
        spawnImpl:()=>{throw new Error('GUEST_MUST_NOT_RUN');},
      }),new RegExp(item.error));
    }
  }));

test('material reference cannot be spoofed by guest generic read or altered during scoped paint', () =>
  fixture(async input => {
    for(const request of [
      {method:'inspectBatch',args:{project:'p0',requests:[{
        kind:'material_pair',reference_uuid:'forged',
        candidate_uuid:'tier-2',
        reference_region:{from:[0,0],to:[2,2]},
        candidate_region:{from:[0,0],to:[2,2]},
      }]}},
      {method:'apply',args:{project:'p0',output:'overwritten-master.bbmodel',
        operations:[{op:'paint_texture_pixel',texture_index:0,x:1,y:1,rgba:[1,2,3,255]}],
        correctionScope:{textureUuid:'tier-1-master',
          allowedRegions:[{from:[0,0],to:[2,2]}],preserveAlpha:true},
      }},
      {method:'apply',args:{project:'p0',output:'unscoped-paint.bbmodel',
        operations:[{op:'paint_texture_rectangle',texture_index:1,
          from:[0,0],to:[2,2],rgba:[1,2,3,255],erase:false}],
      }},
    ]) {
      const called=[];
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        approvedMaterialReferenceUuid:'tier-1-master',
        runner:async argv=>{
          called.push(argv[0]);
          if(argv.includes('--list'))return {status:'OK',sha256:HASH,
            catalog:{kind:'textures',offset:0,total:1,next_offset:null,
              entries:[{uuid:'tier-1-master',name:'Tier 1',
                kind:'texture',index:0}]}};
          return {status:'OK',sha256:HASH,summary:SUMMARY};
        },
        spawnImpl:()=>fakeGuest(request,response=>{
          assert.equal(response.ok,false);
          assert.match(response.code,/CODE_MODE_MATERIAL_REFERENCE_HOST_ONLY|CODE_MODE_MATERIAL_MASTER_PROTECTED|CODE_MODE_MATERIAL_CORRECTION_SCOPE_REQUIRED/);
          return {refused:true};
        }),
      });
      const result=await host.execute({code:'return await codemode.inspectBatch({});'});
      assert.equal(result.value.refused,true);
      assert.deepEqual(called,['inspect','inspect']);
    }
  }));

test('missing operator-selected material master refuses comparative claims', () =>
  fixture(async input => {
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      runner:async()=>({status:'OK',sha256:HASH,summary:SUMMARY}),
      spawnImpl:()=>fakeGuest({method:'inspectApprovedMaterial',args:{
        project:'p0',candidateTextureUuid:'tier-2',
        referenceRegion:{from:[0,0],to:[2,2]},
        candidateRegion:{from:[0,0],to:[2,2]},
      }},response=>{
        assert.equal(response.ok,false);
        assert.equal(response.code,'CODE_MODE_MATERIAL_REFERENCE_UNBOUND');
        return {unbound:true};
      }),
    });
    const result=await host.execute({code:'return await codemode.inspectApprovedMaterial({});'});
    assert.equal(result.value.unbound,true);
  }));

// SOURCE_AUTHORED_NOT_RUN: pinned source/image evidence and fail-closed claims.
test('operator-bound visual pair is a read-only preflight, never visual PASS', () =>
  fixture(async input=>{
    const folder=dirname(input);
    const ref=join(folder,'approved-view.png');
    const capture=join(folder,'current-capture.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,png);
    await writeFile(capture,png);
    const digest=createHash('sha256').update(png).digest('hex');
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:ref,capturePngPath:capture,
        captureModelSha256:HASH,viewId:'front',
      },
      runner:async argv=>{
        if(argv[0]==='inspect'){
          return {status:'OK',sha256:HASH,summary:SUMMARY};
        }
        assert.equal(argv[0],'inspect-visual-pair');
        assert.equal(argv[argv.indexOf('--reference')+1],ref);
        assert.equal(argv[argv.indexOf('--capture')+1],capture);
        assert.equal(argv[argv.indexOf('--reference-sha256')+1],digest);
        assert.equal(argv[argv.indexOf('--capture-sha256')+1],digest);
        assert.equal(argv[argv.indexOf('--expected-sha256')+1],HASH);
        return {status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest,capture_png_sha256:digest,
          comparison:{scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest,capture_png_sha256:digest,
            visual_verdict:'UNVERIFIED',artistic_verdict:'NOT_EVALUATED'}};
      },
      spawnImpl:()=>fakeGuest({method:'inspectSelectedVisualPair',args:{
        project:'p0',
      }},response=>{
        assert.equal(response.ok,true);
        const report=response.result;
        assert.equal(report.evidence_binding.view_id,'front');
        assert.equal(report.evidence_binding.source_model_sha256,HASH);
        assert.equal(report.evidence_binding.image_ingestion,'NOT_VERIFIED');
        assert.equal(report.comparison.visual_verdict,'UNVERIFIED');
        assert.equal(JSON.stringify(report).includes(folder),false);
        return {evidence:report.evidence_binding.kind};
      }),
    });
    const result=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
    assert.equal(result.value.evidence,'operator_selected_visual_pair');
  }));

test('selected view refuses stale model, forged paths and unreviewed paint', () =>
  fixture(async input=>{
    const folder=dirname(input);
    const ref=join(folder,'approved.png');
    const cap=join(folder,'candidate.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,png);await writeFile(cap,png);
    const config={
      referencePngPath:ref,capturePngPath:cap,
      captureModelSha256:HASH,viewId:'front'
    };
    await assert.rejects(createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{...config,captureModelSha256:'b'.repeat(64)},
      runner:async()=>({status:'OK',sha256:HASH,summary:SUMMARY}),
      spawnImpl:()=>{throw Error('must not spawn');}
    }),/CODE_MODE_VISUAL_PAIR_BINDING_INVALID/);
    const requests=[
      {method:'inspectSelectedVisualPair',args:{
        project:'p0',referencePngPath:'/forged.png',
      },expected:'CODE_MODE_VISUAL_PAIR_ARGUMENT_UNSUPPORTED'},
      {method:'apply',args:{
        project:'p0',output:'new.bbmodel',
        operations:[{op:'paint_texture_pixel',texture_index:0,
          x:1,y:1,rgba:[1,2,3,255]}],
        correctionScope:{textureUuid:'tier-2',
          allowedRegions:[{from:[1,1],to:[2,2]}],preserveAlpha:true},
      },expected:'CODE_MODE_VISUAL_PREFLIGHT_REQUIRED'},
    ];
    for (const request of requests){
      const calls=[];
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:config,
        authorizeMutation:()=>{throw Error('must not ask approval');},
        runner:async argv=>{
          calls.push(argv[0]);return {status:'OK',sha256:HASH,summary:SUMMARY};
        },
        spawnImpl:()=>fakeGuest({method:request.method,args:request.args},
          response=>{
            assert.equal(response.ok,false);
            assert.equal(response.code,request.expected);
            return {refused:response.code};
          }),
      });
      const observed=await host.execute({code:'return 1;'});
      assert.equal(observed.value.refused,request.expected);
      assert.deepEqual(calls,['inspect']);
    }
  }));

test('a verified reference pair permits scoped Paint once, then rejects a stale new model', () =>
  fixture(async input => {
    const folder=dirname(input);
    const reference=join(folder,'selected-front.png');
    const capture=join(folder,'captured-front.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(reference,png);
    await writeFile(capture,png);
    const imageSha=createHash('sha256').update(png).digest('hex');
    let launches=0;
    let approvals=0;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:reference,capturePngPath:capture,
        captureModelSha256:HASH,viewId:'front',
      },
      authorizeMutation: request=>{
        approvals++;
        assert.equal(request.operation,'apply');
        assert.deepEqual(request.correctionScope.allowedRegions,[
          {from:[0,0],to:[2,2]},
        ]);
        return true;
      },
      runner:async args=>{
        if(args[0]==='inspect'){
          const newer=basename(args[args.indexOf('--input')+1])==='corrected.bbmodel';
          return {status:'OK',sha256:newer?'b'.repeat(64):HASH,summary:SUMMARY};
        }
        if(args[0]==='inspect-visual-pair'){
          return {status:'OK',source_model_sha256:HASH,
            reference_png_sha256:imageSha,capture_png_sha256:imageSha,
            comparison:{
              scope:'operator_selected_saved_png_pair',
              reference_png_sha256:imageSha,capture_png_sha256:imageSha,
              visual_verdict:'UNVERIFIED',
            }};
        }
        if(args[0]==='apply'){
          return {status:'OK',source_sha256:HASH,output_sha256:'b'.repeat(64),
            summary:{...SUMMARY,revision:1},mutation:{
              revision:1,operation_count:1,changed_uuids:[],
            },correction_scope:scopedNativeReceipt('tier2')};
        }
        throw Error('unexpected command');
      },
      spawnImpl:()=>{
        const index=++launches;
        if(index===1)return fakeGuest({
          method:'inspectSelectedVisualPair',args:{project:'p0'},
        },response=>{
          assert.equal(response.ok,true);
          return {preflight:response.result.evidence_binding.visual_verdict};
        });
        if(index===2)return fakeGuest({method:'apply',args:{
          project:'p0',output:'corrected.bbmodel',
          operations:[{op:'paint_texture_pixel',texture_index:0,x:1,y:1,
            rgba:[80,90,100,255]}],
          correctionScope:{textureUuid:'tier2',allowedRegions:[
            {from:[0,0],to:[2,2]},
          ],preserveAlpha:true},
        }},response=>{
          assert.equal(response.ok,true);
          assert.equal(response.result.project,'p1');
          return {created:response.result.project};
        });
        return fakeGuest({method:'inspectSelectedVisualPair',args:{
          project:'p1',
        }},response=>{
          assert.equal(response.ok,false);
          assert.equal(response.code,'CODE_MODE_VISUAL_CAPTURE_MODEL_STALE');
          return {stale:true};
        });
      },
    });
    const inspected=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
    assert.equal(inspected.value.preflight,'UNVERIFIED');
    const edited=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(edited.value.created,'p1');
    const stale=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p1"});'});
    assert.equal(stale.value.stale,true);
    assert.equal(approvals,1);
    assert.equal(launches,3);
  }));

// Source-authored Golden controls. Buffers below intentionally exercise only
// transport/authority; they are not actual image/artist quality observations.
test('rejected Pillager-style image review permits only reviewer-scoped correction', () =>
  fixture(async input => {
    const folder=dirname(input);
    const ref=join(folder,'tier1-reference.png');
    const capture=join(folder,'tier2-current.png');
    const bytes=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,bytes);await writeFile(capture,bytes);
    const digest=createHash('sha256').update(bytes).digest('hex');
    const calls=[], approvals=[], received=[];
    let step=0;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:ref,capturePngPath:capture,
        captureModelSha256:HASH,viewId:'front',
      },
      reviewVisualPair:async selection=>{
        received.push(selection);
        assert.equal(selection.sourceModelSha256,HASH);
        assert.equal(selection.viewId,'front');
        assert.ok(Buffer.isBuffer(selection.reference.pngBytes));
        assert.deepEqual(selection.reference.pngBytes,bytes);
        assert.deepEqual(selection.capture.pngBytes,bytes);
        assert.equal(selection.reference.sha256,digest);
        return {
          decision:'REJECTED',
          issues:[{id:'helmet-flat',kind:'MISSING_DETAIL',
            observation:'Helmet needs one bounded identity detail correction.',
            partId:'tier2-helmet'}],
          correctionScope:{
            textureUuid:'tier2-atlas',
            allowedRegions:[{from:[1,1],to:[5,5]}],
            preserveAlpha:true,
            protectedRegions:[{from:[1,1],to:[2,2]}],
            expectedBeforePixels:[{at:[2,2],rgba:[70,90,100,255]}],
            editableBeforeRgba:[[70,90,100,255]],
          },
          materialCohort:{phase:'sample',issueId:'helmet-flat',
            cubeUuid:REVIEW_CUBE,face:'north',
            partId:'tier2-helmet',approachId:'helmet-value-masses',
            sampleRegion:{from:[1,1],to:[5,5]}},
        };
      },
      authorizeMutation:request=>{
        approvals.push(request);
        return request.operation==='apply';
      },
      runner:async args=>{
        calls.push(args[0]);
        if(args[0]==='inspect'){
          const newAsset=basename(args[args.indexOf('--input')+1])==='good.bbmodel';
          return {status:'OK',sha256:newAsset?'b'.repeat(64):HASH,
            summary:SUMMARY};
        }
        if(args[0]==='inspect-visual-pair'){
          return {
            status:'OK',source_model_sha256:HASH,
            reference_png_sha256:digest,capture_png_sha256:digest,
            comparison:{
              scope:'operator_selected_saved_png_pair',
              reference_png_sha256:digest,capture_png_sha256:digest,
              visual_verdict:'UNVERIFIED',artistic_verdict:'NOT_EVALUATED',
            },
          };
        }
        if(args[0]==='inspect-batch')return mockedNativeFaceBinding(args,HASH);
        if(args[0]==='apply'){
          const plan=JSON.parse(await readFile(
            args[args.indexOf('--plan')+1],'utf8'));
          assert.deepEqual(plan.correction_scope.protected_regions,[
            {from:[1,1],to:[2,2]},
          ]);
          assert.deepEqual(plan.correction_scope.expected_before_pixels,[
            {at:[2,2],rgba:[70,90,100,255]},
          ]);
          // The guest supplied no source-color guard at this step.
          // Reviewer restriction was automatically merged into Rust scope.
          assert.deepEqual(plan.correction_scope.editable_before_rgba,[
            [70,90,100,255],
          ]);
          return {status:'OK',source_sha256:HASH,
            output_sha256:'b'.repeat(64),summary:{...SUMMARY,revision:1},
            mutation:{revision:1,operation_count:1,changed_uuids:[]},
            correction_scope:{
              status:'enforced',texture_uuid:'tier2-atlas',
              protected_regions:1,expected_before_pixels:1,
              editable_before_rgba:1,
              visual_verdict:'UNVERIFIED',
            }};
        }
        throw Error('unexpected CLI command');
      },
      spawnImpl:()=>{
        step++;
        if(step===1)return fakeGuest({
          method:'inspectSelectedVisualPair',args:{project:'p0'},
        },response=>{
          assert.equal(response.ok,true);
          assert.equal(response.result.review_feedback.decision,'REJECTED');
          assert.equal(response.result.review_feedback.issues[0].id,'helmet-flat');
          assert.equal(response.result.review_feedback.visual_verdict,'UNVERIFIED');
          assert.equal(response.result.review_feedback.materialCohort.phase,'sample');
          assert.equal(response.result.review_feedback.materialCohort.source_model_sha256,HASH);
          assert.equal(response.result.review_feedback.materialCohort.faceBinding.face,'north');
          assert.equal(response.result.review_feedback.face_source_evidence.face_count,6);
          assert.equal(response.result.review_feedback.face_source_evidence.visual_verdict,'UNVERIFIED');
          assert.equal(response.result.evidence_binding.image_ingestion,'NOT_VERIFIED');
          assert.equal(JSON.stringify(response.result).includes('pngBytes'),false);
          return {reviewed:true};
        });
        const target=step===2?{from:[10,10],to:[12,12]}:
          {from:[2,2],to:[4,4]};
        return fakeGuest({method:'apply',args:{
          project:'p0',output:step===2?'bad.bbmodel':
            step===3?'weakened-alpha.bbmodel':
            step===4?'conflicting-before.bbmodel':
            step===5?'conflicting-color.bbmodel':
            step===6?'extra-source-color.bbmodel':
            step===7?'good.bbmodel':'repeat.bbmodel',
          operations:[{op:'paint_texture_pixel',texture_index:1,
            x:target.from[0],y:target.from[1],rgba:[80,100,120,255]}],
          correctionScope:{
            textureUuid:'tier2-atlas',allowedRegions:[target],
            preserveAlpha:step!==3,
            ...(step===4?{expectedBeforePixels:[{
              at:[2,2],rgba:[20,25,30,255],
            }]}:{}),
            ...(step===5?{editableBeforeRgba:[[170,25,25,255]]}:{}),
            ...(step===6?{editableBeforeRgba:[
              [70,90,100,255],[170,25,25,255],
            ]}:{}),
          },
          correctionIntent:{"issueId":"helmet-flat","approachId":"helmet-value-masses","partId":"tier2-helmet","material":"metal","cause":"Helmet shadows and highlights form one generic horizontal band.","treatment":"form_value_masses","expectedChange":"Separate the base, shadow and highlights following the helmet curvature."},
        }},response=>{
          if(step===2 || step===3){
            assert.equal(response.ok,false);
            assert.equal(response.code,'CODE_MODE_VISUAL_REVIEW_SCOPE_MISMATCH');
            return {refused:true};
          }
          if(step===4){
            assert.equal(response.ok,false);
            assert.equal(response.code,'CODE_MODE_REVIEWED_BEFORE_PIXEL_CONFLICT');
            return {sourceConflictBlocked:true};
          }
          if(step===5 || step===6){
            assert.equal(response.ok,false);
            assert.equal(response.code,'CODE_MODE_REVIEWED_SOURCE_COLOR_CONFLICT');
            return {sourceColorConflict:true};
          }
          if(step===8){
            assert.equal(response.ok,false);
            assert.equal(response.code,'CODE_MODE_VISUAL_REVIEW_FRESH_CAPTURE_REQUIRED');
            return {freshCaptureRequired:true};
          }
          assert.equal(response.ok,true);
          assert.equal(response.result.project,'p1');
          assert.equal(response.result.texturing_workflow.source_pixel_guards
            .verified_by_rust_receipt,true);
          return {edited:true};
        });
      },
    });
    const first=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
    assert.equal(first.value.reviewed,true);
    const rejected=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(rejected.value.refused,true);
    const alphaWeakened=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(alphaWeakened.value.refused,true);
    const conflict=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(conflict.value.sourceConflictBlocked,true);
    const colors=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(colors.value.sourceColorConflict,true);
    const mixed=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(mixed.value.sourceColorConflict,true);
    const permitted=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(permitted.value.edited,true);
    const repeated=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(repeated.value.freshCaptureRequired,true);
    assert.equal(received.length,1);
    assert.equal(approvals.length,1);
    assert.equal(approvals[0].correctionScope.textureUuid,'tier2-atlas');
    assert.deepEqual(approvals[0].correctionScope.protectedRegions,[
      {from:[1,1],to:[2,2]},
    ]);
    assert.deepEqual(approvals[0].correctionScope.expectedBeforePixels,[
      {at:[2,2],rgba:[70,90,100,255]},
    ]);
    assert.deepEqual(approvals[0].correctionScope.editableBeforeRgba,[
      [70,90,100,255],
    ]);
    assert.equal(approvals[0].materialCorrectionIntent.issueId,'helmet-flat');
    assert.equal(approvals[0].materialCorrectionIntent.approachId,'helmet-value-masses');
    assert.match(approvals[0].materialIntentSha256,/^[a-f0-9]{64}$/);
    assert.deepEqual(calls,['inspect','inspect-visual-pair','inspect-batch','apply','inspect']);
  }));

test('accepted or unverified visual feedback cannot authorize another pixel correction', () =>
  fixture(async input => {
    const folder=dirname(input);
    const ref=join(folder,'review-reference.png');
    const capture=join(folder,'review-candidate.png');
    const bytes=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,bytes);await writeFile(capture,bytes);
    const digest=createHash('sha256').update(bytes).digest('hex');
    for(const [decision,expected] of [
      ['ACCEPTED','CODE_MODE_VISUAL_REVIEW_ACCEPTED_PROTECTED'],
      ['UNVERIFIED','CODE_MODE_VISUAL_REVIEW_REQUIRED'],
    ]){
      let calls=0, guestStep=0;
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:{
          referencePngPath:ref,capturePngPath:capture,
          captureModelSha256:HASH,viewId:'front',
        },
        reviewVisualPair:async()=>({decision,issues:[]}),
        authorizeMutation:()=>{throw Error('unexpected approval');},
        runner:async args=>{
          calls++;
          if(args[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
          if(args[0]==='inspect-visual-pair')return {
            status:'OK',source_model_sha256:HASH,
            reference_png_sha256:digest,capture_png_sha256:digest,
            comparison:{scope:'operator_selected_saved_png_pair',
              reference_png_sha256:digest,capture_png_sha256:digest,
              visual_verdict:'UNVERIFIED'},
          };
          throw Error('unexpected native mutation');
        },
        spawnImpl:()=>{
          guestStep++;
          if(guestStep===1)return fakeGuest({
            method:'inspectSelectedVisualPair',args:{project:'p0'},
          },response=>{
            assert.equal(response.ok,true);
            assert.equal(response.result.review_feedback.decision,decision);
            return {decision};
          });
          return fakeGuest({method:'apply',args:{
            project:'p0',output:'forbidden.bbmodel',
            operations:[{op:'paint_texture_pixel',texture_index:0,
              x:1,y:1,rgba:[1,2,3,255]}],
            correctionScope:{textureUuid:'tier2',
              allowedRegions:[{from:[0,0],to:[2,2]}],preserveAlpha:true},
          }},response=>{
            assert.equal(response.ok,false);
            assert.equal(response.code,expected);
            return {blocked:true};
          });
        },
      });
      const reviewed=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
      assert.equal(reviewed.value.decision,decision);
      const edit=await host.execute({code:'return codemode.apply({project:"p0"});'});
      assert.equal(edit.value.blocked,true);
      assert.equal(calls,2);
    }
  }));

test('invalid or stale reviewer evidence fails before it can permit Paint', () =>
  fixture(async input => {
    const folder=dirname(input);
    const ref=join(folder,'reference.png');
    const capture=join(folder,'candidate.png');
    const bytes=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,bytes);await writeFile(capture,bytes);
    const digest=createHash('sha256').update(bytes).digest('hex');
    for(const [reviewResult,expected] of [
      [{decision:'REJECTED',issues:[]},'CODE_MODE_VISUAL_REVIEW_INVALID'],
      [{decision:'REJECTED',issues:[
        {id:'duplicate',kind:'FLAT_SHADING',observation:'Flat helmet.'},
        {id:'duplicate',kind:'MISSING_DETAIL',observation:'Missing detail.'},
      ],correctionScope:{textureUuid:'tier2',
        allowedRegions:[{from:[1,1],to:[2,2]}]}},
      'CODE_MODE_VISUAL_REVIEW_INVALID'],
      [{decision:'REJECTED',
        issues:[{id:'helmet',kind:'FLAT_SHADING',
          observation:'Flat metal helmet remains.'}],
        correctionScope:{textureUuid:'tier2',
          allowedRegions:[{from:[1,1],to:[2,2]}]},
        rejectedPaintPlans:[{partId:'tier2-helmet',textureUuid:'tier2',
          fingerprintSha256:'wrong',observation:'This exact paint plan already failed the review.'}],
      },'CODE_MODE_REJECTED_PAINT_HISTORY_INVALID'],
      [{decision:'ACCEPTED',issues:[],
        rejectedPaintPlans:[{partId:'tier2-helmet',textureUuid:'tier2',
          fingerprintSha256:'a'.repeat(64),
          observation:'Reviewer claimed old failure on accepted image.'}],
      },'CODE_MODE_VISUAL_REVIEW_INVALID'],
      [{decision:'ACCEPTED',issues:[],
        viewReviews:[{viewId:'front',decision:'ACCEPTED',
          observation:'Reviewed the actual front image pair.'}],
        reviewedFaces:[{cubeUuid:REVIEW_CUBE,textureUuid:'tier2',
          face:'north',style:'STYLED',observedInViewId:'back',
          observation:'Reviewer falsely linked a back view in a front-only selection.'}],
      },'CODE_MODE_REVIEWED_MATERIAL_FACES_INVALID'],
      [{decision:'ACCEPTED',issues:[],
        reviewedFaces:[{cubeUuid:REVIEW_CUBE,textureUuid:'tier2',
          face:'north',style:'STYLED',
          observation:'The specific camera evidence was omitted altogether.'}],
      },'CODE_MODE_REVIEWED_MATERIAL_FACES_INVALID'],
    ]){
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:{
          referencePngPath:ref,capturePngPath:capture,
          captureModelSha256:HASH,viewId:'front',
        },
        reviewVisualPair:()=>reviewResult,
        runner:async args=>args[0]==='inspect'?
          {status:'OK',sha256:HASH,summary:SUMMARY}:
          {status:'OK',source_model_sha256:HASH,
            reference_png_sha256:digest,capture_png_sha256:digest,
            comparison:{scope:'operator_selected_saved_png_pair',
              reference_png_sha256:digest,capture_png_sha256:digest,
              visual_verdict:'UNVERIFIED'}},
        spawnImpl:()=>fakeGuest({
          method:'inspectSelectedVisualPair',args:{project:'p0'},
        },response=>{
          assert.equal(response.ok,false);
          assert.equal(response.code,expected);
          return {rejected:true};
        }),
      });
      const result=await host.execute({code:'return 1;'});
      assert.equal(result.value.rejected,true);
    }
    let callbackInvoked=0;
    const stale=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:ref,capturePngPath:capture,
        captureModelSha256:HASH,viewId:'front',
      },
      reviewVisualPair:()=>{callbackInvoked++;return {decision:'UNVERIFIED',issues:[]};},
      runner:async args=>args[0]==='inspect'?
        {status:'OK',sha256:HASH,summary:SUMMARY}:
        {status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest,capture_png_sha256:digest,
          comparison:{scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest,capture_png_sha256:digest,
            visual_verdict:'UNVERIFIED'}},
      spawnImpl:()=>fakeGuest({
        method:'inspectSelectedVisualPair',args:{project:'p0'},
      },response=>{
        assert.equal(response.ok,false);
        assert.equal(response.code,'CODE_MODE_VISUAL_REVIEW_INPUT_STALE');
        return {stale:true};
      }),
    });
    await writeFile(capture,Buffer.concat([bytes,Buffer.from([1])]));
    const report=await stale.execute({code:'return 1;'});
    assert.equal(report.value.stale,true);
    assert.equal(callbackInvoked,0);
  }));

// Synthetic header-only PNG fixtures test host authority, NOT artistic image quality.
test('repeat visual review cannot downgrade accepted Pillager snapshot', () =>
  fixture(async input=>{
    const folder=dirname(input), ref=join(folder,'accepted-front.png');
    const cap=join(folder,'candidate-front.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,png);await writeFile(cap,png);
    const digest=createHash('sha256').update(png).digest('hex');
    let reviewerCalls=0, phase=0, approvals=0;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:ref,capturePngPath:cap,
        captureModelSha256:HASH,viewId:'front',
      },
      reviewVisualPair:async()=>{
        reviewerCalls++;
        if(reviewerCalls===1)return {decision:'ACCEPTED',issues:[]};
        return {
          decision:'REJECTED',
          issues:[{id:'fake-rejection',kind:'FLAT_SHADING',
            observation:'Second review not authorized.'}],
          correctionScope:{textureUuid:'tier2',
            allowedRegions:[{from:[1,1],to:[3,3]}],preserveAlpha:true},
        };
      },
      authorizeMutation:()=>{approvals++;throw Error('write never approved');},
      runner:async argv=>{
        if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        assert.equal(argv[0],'inspect-visual-pair');
        return {status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest,capture_png_sha256:digest,
          comparison:{scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest,capture_png_sha256:digest,
            visual_verdict:'UNVERIFIED'}};
      },
      spawnImpl:()=>{
        phase++;
        if(phase<=2)return fakeGuest({
          method:'inspectSelectedVisualPair',args:{project:'p0'},
        },result=>{
          assert.equal(result.ok,true);
          assert.equal(result.result.review_feedback.decision,'ACCEPTED');
          return {decision:result.result.review_feedback.decision};
        });
        return fakeGuest({method:'apply',args:{
          project:'p0',output:'should-not-exist.bbmodel',
          operations:[{op:'paint_texture_pixel',texture_index:0,x:1,y:1,
            rgba:[80,90,100,255]}],
          correctionScope:{textureUuid:'tier2',
            allowedRegions:[{from:[1,1],to:[3,3]}],preserveAlpha:true},
        }},result=>{
          assert.equal(result.ok,false);
          assert.equal(result.code,'CODE_MODE_VISUAL_REVIEW_ACCEPTED_PROTECTED');
          return {blocked:true};
        });
      },
    });
    for(let i=0;i<2;i++){
      const result=await host.execute({code:'return await codemode.inspectSelectedVisualPair({project:"p0"});'});
      assert.equal(result.value.decision,'ACCEPTED');
    }
    const edit=await host.execute({code:'return await codemode.apply({project:"p0"});'});
    assert.equal(edit.value.blocked,true);
    assert.equal(reviewerCalls,1);
    assert.equal(approvals,0);
  }));

test('changed reference OR capture PNG after rejected review refuses Paint', () =>
  fixture(async input=>{
    const folder=dirname(input);
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    const digest=createHash('sha256').update(png).digest('hex');
    for(const target of ['reference','capture']){
      const ref=join(folder,target+'-reference.png');
      const cap=join(folder,target+'-capture.png');
      await writeFile(ref,png);await writeFile(cap,png);
      let phase=0, approvals=0, nativeWrites=0;
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:{
          referencePngPath:ref,capturePngPath:cap,
          captureModelSha256:HASH,viewId:'front',
        },
        reviewVisualPair:()=>({
          decision:'REJECTED',
          issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
            observation:'Helmet paint remains flat.'}],
          correctionScope:{textureUuid:'tier2',
            allowedRegions:[{from:[1,1],to:[5,5]}],preserveAlpha:true},
        }),
        authorizeMutation:()=>{approvals++;throw Error('should not approve');},
        runner:async argv=>{
          if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
          if(argv[0]==='inspect-visual-pair')return {
            status:'OK',source_model_sha256:HASH,
            reference_png_sha256:digest,capture_png_sha256:digest,
            comparison:{scope:'operator_selected_saved_png_pair',
              reference_png_sha256:digest,capture_png_sha256:digest,
              visual_verdict:'UNVERIFIED'},
          };
          nativeWrites++;
          throw Error('should not launch Rust apply');
        },
        spawnImpl:()=>{
          phase++;
          if(phase===1)return fakeGuest({
            method:'inspectSelectedVisualPair',args:{project:'p0'},
          },result=>{
            assert.equal(result.ok,true);
            return {reviewed:true};
          });
          return fakeGuest({method:'apply',args:{
            project:'p0',output:target+'-altered.bbmodel',
            operations:[{op:'paint_texture_pixel',texture_index:0,
              x:2,y:2,rgba:[40,70,100,255]}],
            correctionScope:{textureUuid:'tier2',
              allowedRegions:[{from:[2,2],to:[4,4]}],preserveAlpha:true},
          }},result=>{
            assert.equal(result.ok,false);
            assert.equal(result.code,'CODE_MODE_VISUAL_REVIEW_INPUT_STALE');
            return {refused:true};
          });
        },
      });
      const before=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
      assert.equal(before.value.reviewed,true);
      await writeFile(target==='reference'?ref:cap,Buffer.concat([png,Buffer.from([1])]));
      const attempted=await host.execute({code:'return codemode.apply({project:"p0"});'});
      assert.equal(attempted.value.refused,true);
      assert.equal(approvals,0);
      assert.equal(nativeWrites,0);
    }
  }));

// The host must refuse repeated causal approaches and ungrounded/other-part
// corrections without asking for write permission or launching native Paint.
test('reviewed material correction blocks missing, unrelated and previously rejected plans', () =>
  fixture(async input=>{
    const folder=dirname(input);
    const ref=join(folder,'approved-helmet.png');
    const cap=join(folder,'candidate-helmet.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,png);await writeFile(cap,png);
    const digest=createHash('sha256').update(png).digest('hex');
    let phase=0, approvals=0, nativeWrites=0;
    const baseIntent={
      issueId:'helmet-flat',approachId:'helmet-flat-stripe',
      partId:'tier2-helmet',material:'metal',
      cause:'The helmet currently renders as one flat horizontal stripe.',
      treatment:'form_value_masses',
      expectedChange:'Build form-following base, highlight and shadow masses on the helmet.',
    };
    const repeatedPaint={op:'paint_texture_pixel',texture_index:1,
      x:2,y:2,rgba:[80,90,120,255]};
    const cases=[
      {intent:undefined,expected:'CODE_MODE_MATERIAL_INTENT_REQUIRED'},
      {intent:{...baseIntent,issueId:'unreviewed-shield'},
        expected:'CODE_MODE_MATERIAL_ISSUE_NOT_REVIEWED'},
      {intent:{...baseIntent,partId:'tier1-shield'},
        expected:'CODE_MODE_MATERIAL_TARGET_MISMATCH'},
      {intent:baseIntent,expected:'CODE_MODE_MATERIAL_APPROACH_PREVIOUSLY_REJECTED'},
      {intent:{...baseIntent,approachId:'new-form-study'},
        expected:'CODE_MODE_MATERIAL_TREATMENT_FAMILY_REPEAT_BLOCKED'},
      {intent:{...baseIntent,approachId:'new-contact',
        treatment:'contact_shadows'},
        expected:'CODE_MODE_MATERIAL_REJECTED_OPERATION_REPLAY'},
      {intent:{...baseIntent,approachId:'new-contact-different',
        treatment:'contact_shadows'},
        operations:[{...repeatedPaint,rgba:[81,90,120,255]}],
        expected:'CODE_MODE_MATERIAL_SAMPLE_REQUIRED'},
    ];
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:ref,capturePngPath:cap,
        captureModelSha256:HASH,viewId:'front',
      },
      reviewVisualPair:async()=>({
        decision:'REJECTED',
        issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
          observation:'The metal helmet remains visually flat.',
          partId:'tier2-helmet'}],
        correctionScope:{textureUuid:'tier2-atlas',
          allowedRegions:[{from:[1,1],to:[5,5]}],
          preserveAlpha:true},
        rejectedApproaches:[{issueId:'helmet-flat',
          approachId:'helmet-flat-stripe'}],
        rejectedTreatments:[{
          partId:'tier2-helmet',material:'metal',
          treatment:'form_value_masses',failedAttempts:2,
          observation:'Two independent reference reviews rejected repeating horizontal-value stripes.',
        }],
        rejectedPaintPlans:[{
          partId:'tier2-helmet',textureUuid:'tier2-atlas',
          fingerprintSha256:paintOperationsFingerprint([repeatedPaint]),
          observation:'This exact native Paint operation was visually rejected despite a new label.',
        }],
      }),
      authorizeMutation:()=>{approvals++;return true;},
      runner:async args=>{
        if(args[0]==='inspect')
          return {status:'OK',sha256:HASH,summary:SUMMARY};
        if(args[0]==='inspect-visual-pair')
          return {status:'OK',source_model_sha256:HASH,
            reference_png_sha256:digest,capture_png_sha256:digest,
            comparison:{scope:'operator_selected_saved_png_pair',
              reference_png_sha256:digest,capture_png_sha256:digest,
              visual_verdict:'UNVERIFIED'}};
        nativeWrites++;
        throw Error('unexpected Paint');
      },
      spawnImpl:()=>{
        const current=phase++;
        if(current===0)return fakeGuest({method:'inspectSelectedVisualPair',args:{
          project:'p0',
        }},response=>{
          assert.equal(response.ok,true);
          assert.deepEqual(response.result.review_feedback.rejectedApproaches,
            [{issueId:'helmet-flat',approachId:'helmet-flat-stripe'}]);
          assert.equal(response.result.review_feedback.rejectedTreatments[0].failedAttempts,2);
          assert.equal(response.result.review_feedback.rejectedPaintPlans[0].fingerprintSha256,
            paintOperationsFingerprint([repeatedPaint]));
          return {reviewed:true};
        });
        const item=cases[current-1];
        return fakeGuest({method:'apply',args:{
          project:'p0',output:'negative-'+current+'.bbmodel',
          operations:item.operations??[repeatedPaint],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[2,2],to:[4,4]}],
            preserveAlpha:true},
          ...(item.intent?{correctionIntent:item.intent}:{}),
        }},response=>{
          assert.equal(response.ok,false);
          assert.equal(response.code,item.expected);
          return {refused:response.code};
        });
      },
    });
    const inspected=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
    assert.equal(inspected.value.reviewed,true);
    for(const item of cases){
      const result=await host.execute({code:'return codemode.apply({project:"p0"});'});
      assert.equal(result.value.refused,item.expected);
    }
    assert.equal(approvals,0);
    assert.equal(nativeWrites,0);
  }));

// Header-only PNGs and mocked native CLI below exercise host admission only,
// not real texture/image quality or native user acceptance.
test('representative material is constrained; propagation requires fresh accepted sample and protects it', () =>
  fixture(async input=>{
    const folder=dirname(input);
    const reference=join(folder,'selected-reference.png');
    const before=join(folder,'source-front.png');
    const after=join(folder,'sample-front.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(reference,png);await writeFile(before,png);
    const afterBytes=Buffer.concat([png,Buffer.from([1])]);
    await writeFile(after,afterBytes);
    const digest=createHash('sha256').update(png).digest('hex');
    const sampleDigest=createHash('sha256').update(afterBytes).digest('hex');
    const modifiedSha='b'.repeat(64), widenedSha='c'.repeat(64);
    const intent={
      issueId:'helmet-flat',partId:'tier2-helmet',
      approachId:'form-following-metal',material:'metal',
      cause:'Helmet detail still forms an unsupported flat horizontal stripe.',
      treatment:'form_value_masses',
      expectedChange:'Introduce form-following base and shadow clusters around the helmet.',
    };
    const workPacket={
      sourceModelSha256:modifiedSha,referencePngSha256:digest,
      issueId:intent.issueId,approachId:intent.approachId,
      partId:intent.partId,textureUuid:'tier2-atlas',
      material:'metal',shadingIntent:'FORM_SHADING',
      reviewedIssueObservation:'Sample is acceptable; other metal faces still need styling.',
      styleIntent:'Preserve the approved angular metal style and distinguish its material planes.',
      lightDirection:'Upper-facing bevels use the approved upper-left light direction.',
      lightRationale:'The top light is used for coherent hard edge transitions on metal armor.',
      palette:[
        {role:'shadow',rgb:[60,70,80],
          purpose:'Deepen metal contact and side-plane recesses.'},
        {role:'base',rgb:[80,100,120],
          purpose:'Retain the accepted midtone family on armor.'},
        {role:'highlight',rgb:[130,150,170],
          purpose:'Accent selected armor edges facing the light.'},
      ],
      facePlans:[{
        cubeUuid:REVIEW_CUBE,face:'east',
        atlasRegion:{from:[8,8],to:[12,12]},
        formCue:'Side helmet face forms a plane against the raised helmet rim.',
        shadowPlacement:'Place the darker cluster toward the recessed joining edge.',
        highlightPlacement:'Keep a small high-value cluster on the light-facing metal bevel.',
        clusterPlan:'Use connected stepped pixels and a quiet resting field without stripes.',
        clusters:[
          {id:'side-shadow',role:'shadow',
            formReason:'The recessed side seam needs one coherent shadow mass.',
            spans:[{y:0,x0:0,x1:2},{y:1,x0:0,x1:3}]},
          {id:'rim-light',role:'highlight',
            formReason:'The upper bevel needs a separate connected light mass.',
            spans:[{y:2,x0:2,x1:4},{y:3,x0:3,x1:4}]},
        ],
      }],
    };
    const samplePacket={
      ...workPacket,sourceModelSha256:HASH,
      reviewedIssueObservation:'Metal helmet needs one representative sample.',
      facePlans:[{
        ...workPacket.facePlans[0],face:'north',
        atlasRegion:{from:[1,1],to:[5,5]},
        formCue:'The front helmet rim turns from upper bevel into the face plane.',
        shadowPlacement:'Build a bounded contact shadow beneath the actual metal rim.',
        highlightPlacement:'Keep the upper lit bevel distinct from its darker joint.',
      }],
    };
    let firstStep=0, secondStep=0, approvals=0;
    const actualApprovals=[];
    const sampleHost=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:reference,capturePngPath:before,
        captureModelSha256:HASH,viewId:'front',
      },
      reviewVisualPair:()=>({
        decision:'REJECTED',
        issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
          partId:'tier2-helmet',
          observation:'Metal helmet needs one representative sample.'}],
        correctionScope:{textureUuid:'tier2-atlas',
          allowedRegions:[{from:[0,0],to:[16,16]}],preserveAlpha:true},
        materialCohort:{phase:'sample',issueId:'helmet-flat',
            cubeUuid:REVIEW_CUBE,face:'north',
          partId:'tier2-helmet',approachId:'form-following-metal',
          sampleRegion:{from:[1,1],to:[5,5]}},
      }),
      authorizeMutation:()=>{approvals++;return true;},
      runner:async argv=>{
        if(argv[0]==='inspect'){
          const name=basename(argv[argv.indexOf('--input')+1]);
          return {status:'OK',sha256:name==='representative.bbmodel'?
            modifiedSha:HASH,summary:SUMMARY};
        }
        if(argv[0]==='inspect-visual-pair')return {
          status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest,capture_png_sha256:digest,
          comparison:{scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest,capture_png_sha256:digest,
            visual_verdict:'UNVERIFIED'},
        };
        if(argv[0]==='inspect-batch')return mockedNativeFaceBinding(argv,HASH);
        assert.equal(argv[0],'apply');
        await writeFile(argv[argv.indexOf('--output')+1],'{}');
        return {status:'OK',source_sha256:HASH,output_sha256:modifiedSha,
          summary:{...SUMMARY,revision:1},
          mutation:{revision:1,operation_count:1,changed_uuids:[]},
          correction_scope:scopedNativeReceipt('tier2-atlas')};
      },
      spawnImpl:()=>{
        const step=++firstStep;
        if(step===1)return fakeGuest({method:'inspectSelectedVisualPair',args:{
          project:'p0',
        }},value=>{
          assert.equal(value.ok,true);
          assert.equal(value.result.review_feedback.materialCohort.phase,'sample');
          assert.equal(value.result.review_feedback.materialCohort.sampleVerdict,'UNVERIFIED');
          return {reviewed:true};
        });
        const broad=step===2,missingPacket=step===3;
        const wrongReference=step===4,wrongFace=step===5;
        return fakeGuest({method:'apply',args:{
          project:'p0',output:broad?'too-broad.bbmodel':
            missingPacket?'missing-sample-plan.bbmodel':
            wrongReference?'wrong-sample-source.bbmodel':
            wrongFace?'wrong-sample-face.bbmodel':'representative.bbmodel',
          ...(broad||missingPacket?{operations:[{
            op:'paint_texture_pixel',texture_index:0,
            x:broad?10:2,y:broad?10:2,rgba:[30,40,50,255],
          }]}:{}),
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:broad?[{from:[8,8],to:[12,12]}]:
              [{from:[1,1],to:[5,5]}],preserveAlpha:true},
          correctionIntent:intent,
          ...(!broad&&!missingPacket?{materialWorkPacket:
            wrongReference?{...samplePacket,sourceModelSha256:'d'.repeat(64)}:
              wrongFace?{...samplePacket,facePlans:[{
                ...samplePacket.facePlans[0],face:'east'}]}:samplePacket}:{})
        }},value=>{
          if(broad){
            assert.equal(value.ok,false);
            assert.equal(value.code,'CODE_MODE_MATERIAL_SAMPLE_REGION_REQUIRED');
            return {blocked:true};
          }
          if(missingPacket||wrongReference||wrongFace){
            assert.equal(value.ok,false);
            assert.equal(value.code,missingPacket?
              'CODE_MODE_MATERIAL_FORM_SAMPLE_PACKET_REQUIRED':
              wrongReference?'CODE_MODE_MATERIAL_WORK_PACKET_BINDING_MISMATCH':
                'CODE_MODE_MATERIAL_SAMPLE_FORM_PLAN_MISMATCH');
            return {blocked:true};
          }
          assert.equal(value.ok,true);
          assert.equal(value.result.project,'p1');
          assert.equal(value.result.texturing_workflow.material_work_packet.planned_faces,1);
          assert.equal(value.result.texturing_workflow.material_work_packet.visual_verdict,'UNVERIFIED');
          return {sampleSaved:true};
        });
      },
    });
    assert.equal((await sampleHost.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'})).value.reviewed,true);
    assert.equal((await sampleHost.execute({code:'return codemode.apply({project:"p0"});'})).value.blocked,true);
    for(let i=0;i<3;i++){
      assert.equal((await sampleHost.execute({
        code:'return codemode.apply({project:"p0"});',
      })).value.blocked,true);
    }
    assert.equal((await sampleHost.execute({
      code:'return codemode.apply({project:"p0"});',
    })).value.sampleSaved,true);
    assert.equal(approvals,1);

    // A NEW selected .bbmodel source and new model capture are required.
    const candidate=join(folder,'representative.bbmodel');
    const reviewedDirections=[];
    for(const viewId of ['back','left','right','top','bottom']){
      const referencePngPath=join(folder,'approved-propagation-'+viewId+'.png');
      const capturePngPath=join(folder,'current-propagation-'+viewId+'.png');
      await writeFile(referencePngPath,png);
      await writeFile(capturePngPath,afterBytes);
      reviewedDirections.push({viewId,referencePngPath,capturePngPath});
    }
    const propagationHost=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input:candidate,
      preselectedVisualPair:{
        referencePngPath:reference,capturePngPath:after,
        captureModelSha256:modifiedSha,viewId:'front',
        supportingViews:reviewedDirections,requireSixDirections:true,
      },
      reviewVisualPair:()=>({
        decision:'REJECTED',
        viewReviews:['front','back','left','right','top','bottom'].map(viewId=>({
          viewId,decision:viewId==='front'?'REJECTED':'ACCEPTED',
          observation:'The selected material view was reviewed with the current image.',
        })),
        issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
          partId:'tier2-helmet',
          observation:'Sample is acceptable; other metal faces still need styling.'}],
        correctionScope:{textureUuid:'tier2-atlas',
          allowedRegions:[{from:[0,0],to:[16,16]}],preserveAlpha:true,
          editableBeforeRgba:[[80,100,120,255]]},
        materialCohort:{phase:'propagation',
          cubeUuid:REVIEW_CUBE,face:'north',
          issueId:'helmet-flat',partId:'tier2-helmet',
          approachId:'form-following-metal',
          sampleRegion:{from:[1,1],to:[5,5]},
          sampleVerdict:'ACCEPTED'},
      }),
      authorizeMutation:request=>{
        approvals++;
        actualApprovals.push(request);
        return true;
      },
      runner:async argv=>{
        if(argv[0]==='inspect'){
          const name=basename(argv[argv.indexOf('--input')+1]);
          return {status:'OK',sha256:name==='extended.bbmodel'?
            widenedSha:modifiedSha,summary:SUMMARY};
        }
        if(argv[0]==='inspect-visual-pair')return {
          status:'OK',source_model_sha256:modifiedSha,
          reference_png_sha256:digest,capture_png_sha256:sampleDigest,
          comparison:{scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest,capture_png_sha256:sampleDigest,
            visual_verdict:'UNVERIFIED'},
        };
        if(argv[0]==='inspect-batch'){
          const queries=JSON.parse(await readFile(
            argv[argv.indexOf('--queries')+1],'utf8'));
          if(queries.requests.length===1 &&
             queries.requests[0].kind==='material_face_patch'){
            const q=queries.requests[0];
            assert.equal(q.cube_uuid,REVIEW_CUBE);
            assert.equal(q.face,'east');
            assert.deepEqual(q.region,{from:[8,8],to:[12,12]});
            return {status:'OK',sha256:modifiedSha,summary:SUMMARY,
              results:[{kind:'material_face_patch',binding:{
                scope:'source_explicit_cube_face_patch',
                status:'bound_source_only',
                texture_uuid:q.texture_uuid,cube_uuid:q.cube_uuid,
                face:q.face,sample_region:q.region,
                texture_reference:'explicit_saved_link',
                pixel_alias:secondStep===6?
                  'overlap_detected':'no_detected_overlap_for_sample',
                visual_verdict:'UNVERIFIED',
                face_coverage_verdict:'UNVERIFIED',
                view_correspondence:'NOT_VERIFIED',
                ...(q.face_spans && secondStep!==7?{cluster_footprint:{
                  scope:'saved_face_local_to_atlas',status:'within_selected_patch',
                  span_count:q.face_spans.length,visual_verdict:'UNVERIFIED',
                }}:{}),
              }}]};
          }
          return mockedNativeFaceBinding(argv,modifiedSha);
        }
        assert.equal(argv[0],'apply');
        const nativePlan=JSON.parse(await readFile(
          argv[argv.indexOf('--plan')+1],'utf8'));
        assert.equal(nativePlan.operations.length,1);
        assert.deepEqual(nativePlan.correction_scope.editable_before_rgba,[
          [80,100,120,255],
        ]);
        assert.equal(nativePlan.operations[0].op,'paint_cube_face_regions_guarded');
        assert.equal(nativePlan.operations[0].regions.length,4);
        assert.deepEqual(nativePlan.operations[0].regions[0],{
          face:'east',from:[0,0],to:[2,1],
          rgba:[60,70,80,255],erase:false,
        });
        await writeFile(argv[argv.indexOf('--output')+1],'{}');
        return {status:'OK',source_sha256:modifiedSha,output_sha256:widenedSha,
          summary:{...SUMMARY,revision:1},
          mutation:{revision:1,operation_count:1,changed_uuids:[]},
          correction_scope:scopedNativeReceipt('tier2-atlas',{
            editableBeforeRgba:1,
          })};
      },
      spawnImpl:()=>{
        const step=++secondStep;
        if(step===1)return fakeGuest({method:'inspectSelectedVisualPair',args:{
          project:'p0',
        }},value=>{
          assert.equal(value.ok,true);
          const cohort=value.result.review_feedback.materialCohort;
          assert.equal(cohort.phase,'propagation');
          assert.equal(cohort.sampleVerdict,'ACCEPTED');
          assert.equal(cohort.source_model_sha256,modifiedSha);
          assert.equal(cohort.capture_png_sha256,sampleDigest);
          assert.equal(cohort.visual_verdict,'UNVERIFIED');
          return {acceptedSampleDeclared:true};
        });
        const overlap=step===2;
        const missingPacket=step===3;
        const wrongReference=step===4;
        const manualOverride=step===5;
        const invalidSource=step===6,missingFootprint=step===7;
        return fakeGuest({method:'apply',args:{
          project:'p0',output:overlap?'overlap.bbmodel':
            missingPacket?'missing-packet.bbmodel':
            wrongReference?'wrong-reference.bbmodel':
            manualOverride?'manual-override.bbmodel':
            invalidSource?'invalid-face.bbmodel':
            missingFootprint?'missing-footprint.bbmodel':'extended.bbmodel',
          ...(overlap || missingPacket || manualOverride?{operations:
            overlap?[{op:'paint_texture_pixel',texture_index:0,
              x:2,y:2,rgba:[60,70,80,255]}]:
            [{op:'paint_cube_face_regions_guarded',cube_uuid:REVIEW_CUBE,
              texture_uuid:'tier2-atlas',
              regions:[{face:'east',from:[0,0],to:[1,1],
                rgba:[80,100,120,255],erase:false}]}]}:{}),
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:overlap?[{from:[2,2],to:[4,4]}]:
              [{from:[8,8],to:[12,12]}],preserveAlpha:true},
          correctionIntent:intent,
          ...(!overlap&&!missingPacket?{materialWorkPacket:wrongReference?
            {...workPacket,referencePngSha256:'d'.repeat(64)}:workPacket}:{}),
        }},value=>{
          if(overlap){
            assert.equal(value.ok,false);
            assert.equal(value.code,'CODE_MODE_MATERIAL_ACCEPTED_SAMPLE_PROTECTED');
            return {blocked:true};
          }
          if(missingPacket || wrongReference || manualOverride ||
             invalidSource || missingFootprint){
            assert.equal(value.ok,false);
            assert.equal(value.code,missingPacket?
              'CODE_MODE_MATERIAL_WORK_PACKET_REQUIRED':
              wrongReference?
              'CODE_MODE_MATERIAL_WORK_PACKET_BINDING_MISMATCH':
              manualOverride?'CODE_MODE_MATERIAL_CLUSTER_HOST_OWNED':
              'CODE_MODE_MATERIAL_WORK_PACKET_FACE_SOURCE_UNVERIFIED');
            return {negative:value.code};
          }
          assert.equal(value.ok,true);
          assert.equal(value.result.project,'p1');
          assert.equal(value.result.texturing_workflow.material_work_packet.planned_faces,1);
          assert.equal(value.result.texturing_workflow.source_pixel_guards
            .verified_by_rust_receipt,true);
          assert.equal(value.result.texturing_workflow.material_work_packet.visual_verdict,'UNVERIFIED');
          return {propagated:true};
        });
      },
    });
    assert.equal((await propagationHost.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'})).value.acceptedSampleDeclared,true);
    assert.equal((await propagationHost.execute({code:'return codemode.apply({project:"p0"});'})).value.blocked,true);
    assert.equal((await propagationHost.execute({code:'return codemode.apply({project:"p0"});'})).value.negative,'CODE_MODE_MATERIAL_WORK_PACKET_REQUIRED');
    assert.equal((await propagationHost.execute({code:'return codemode.apply({project:"p0"});'})).value.negative,'CODE_MODE_MATERIAL_WORK_PACKET_BINDING_MISMATCH');
    assert.equal((await propagationHost.execute({code:'return codemode.apply({project:"p0"});'})).value.negative,'CODE_MODE_MATERIAL_CLUSTER_HOST_OWNED');
    assert.equal((await propagationHost.execute({code:'return codemode.apply({project:"p0"});'})).value.negative,'CODE_MODE_MATERIAL_WORK_PACKET_FACE_SOURCE_UNVERIFIED');
    assert.equal((await propagationHost.execute({code:'return codemode.apply({project:"p0"});'})).value.negative,'CODE_MODE_MATERIAL_WORK_PACKET_FACE_SOURCE_UNVERIFIED');
    assert.equal((await propagationHost.execute({code:'return codemode.apply({project:"p0"});'})).value.propagated,true);
    assert.equal(approvals,2);
    assert.match(actualApprovals[0].materialWorkPacketSha256,/^[0-9a-f]{64}$/);
    assert.equal(actualApprovals[0].materialWorkPacket.facePlans[0].face,'east');
    assert.equal(actualApprovals[0].materialWorkPacket.facePlans[0].clusters.length,2);
    assert.deepEqual(actualApprovals[0].operationKinds,
      ['paint_cube_face_regions_guarded']);
    assert.deepEqual(actualApprovals[0].correctionScope.editableBeforeRgba,
      [[80,100,120,255]]);
  }));

test('invalid source-only sample review declarations fail before Paint', () =>
  fixture(async input=>{
    const folder=dirname(input), image=join(folder,'review.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(image,png);
    const sha=createHash('sha256').update(png).digest('hex');
    const invalid=[
      {phase:'propagation',issueId:'helmet-flat',partId:'tier2-helmet',
        approachId:'form-following-metal',cubeUuid:REVIEW_CUBE,
        face:'north',sampleRegion:{from:[1,1],to:[5,5]}},
      {phase:'sample',issueId:'helmet-flat',partId:'tier2-helmet',
        approachId:'form-following-metal',cubeUuid:REVIEW_CUBE,
        face:'north',sampleRegion:{from:[0,0],to:[40,40]}},
      {phase:'sample',issueId:'other-issue',partId:'tier2-helmet',
        approachId:'form-following-metal',cubeUuid:REVIEW_CUBE,
        face:'north',sampleRegion:{from:[1,1],to:[5,5]}},
      {phase:'sample',issueId:'helmet-flat',partId:'tier2-helmet',
        approachId:'form-following-metal',cubeUuid:REVIEW_CUBE,
        face:'north',sampleRegion:{from:[1,1],to:[5,5]},
        sampleVerdict:'ACCEPTED'},
    ];
    for(const materialCohort of invalid){
      let writes=0;
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:{
          referencePngPath:image,capturePngPath:image,
          captureModelSha256:HASH,viewId:'front',
        },
        reviewVisualPair:()=>({
          decision:'REJECTED',
          issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
            observation:'Metal helmet still needs styling.',
            partId:'tier2-helmet'}],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[0,0],to:[32,32]}],preserveAlpha:true},
          materialCohort,
        }),
        authorizeMutation:()=>{writes++;return true;},
        runner:async argv=>{
          if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
          assert.equal(argv[0],'inspect-visual-pair');
          return {status:'OK',source_model_sha256:HASH,
            reference_png_sha256:sha,capture_png_sha256:sha,
            comparison:{scope:'operator_selected_saved_png_pair',
              reference_png_sha256:sha,capture_png_sha256:sha,
              visual_verdict:'UNVERIFIED'}};
        },
        spawnImpl:()=>fakeGuest({method:'inspectSelectedVisualPair',args:{
          project:'p0',
        }},response=>{
          assert.equal(response.ok,false);
          assert.equal(response.code,'CODE_MODE_MATERIAL_COHORT_INVALID');
          return {rejected:true};
        }),
      });
      const result=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
      assert.equal(result.value.rejected,true);
      assert.equal(writes,0);
    }
  }));

test('reviewed texture host rejects non-paint apply and imported PNG bypasses', () =>
  fixture(async input=>{
    const dir=dirname(input);
    const ref=join(dir,'reference.png'),cap=join(dir,'capture.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,png);await writeFile(cap,png);
    const digest=createHash('sha256').update(png).digest('hex');
    let step=0, writes=0, approvals=0;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedPngPath:ref,
      preselectedVisualPair:{
        referencePngPath:ref,capturePngPath:cap,
        captureModelSha256:HASH,viewId:'front',
      },
      reviewVisualPair:()=>({
        decision:'REJECTED',
        issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
          partId:'tier2-helmet',observation:'Helmet material is too flat.'}],
        correctionScope:{textureUuid:'tier2-atlas',
          allowedRegions:[{from:[1,1],to:[5,5]}],preserveAlpha:true},
        materialCohort:{phase:'sample',issueId:'helmet-flat',
            cubeUuid:REVIEW_CUBE,face:'north',
          partId:'tier2-helmet',approachId:'form-following-metal',
          sampleRegion:{from:[1,1],to:[5,5]}},
      }),
      authorizeMutation:()=>{approvals++;return true;},
      runner:async args=>{
        if(args[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        if(args[0]==='inspect-visual-pair')return {
          status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest,capture_png_sha256:digest,
          comparison:{scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest,capture_png_sha256:digest,
            visual_verdict:'UNVERIFIED'},
        };
        if(args[0]==='inspect-batch')return mockedNativeFaceBinding(args,HASH);
        writes++;
        throw Error('unreviewed texture or structure mutation attempted');
      },
      spawnImpl:()=>{
        step++;
        if(step===1)return fakeGuest({
          method:'inspectSelectedVisualPair',args:{project:'p0'},
        },response=>{
          assert.equal(response.ok,true);
          return {reviewed:true};
        });
        if(step===2)return fakeGuest({method:'apply',args:{
          project:'p0',output:'structural.bbmodel',
          operations:[{op:'translate_cube',uuid:'cube-1',delta:[1,0,0]}],
        }},response=>{
          assert.equal(response.ok,false);
          assert.equal(response.code,'CODE_MODE_REVIEWED_CORRECTION_PAINT_ONLY');
          return {denied:true};
        });
        return fakeGuest({method:'importPng',args:{
          project:'p0',output:'replacement.bbmodel',name:'replacement',
          uuid:'new-texture-uuid',
        }},response=>{
          assert.equal(response.ok,false);
          assert.equal(response.code,'CODE_MODE_REVIEWED_TEXTURE_IMPORT_SEPARATE_HOST');
          return {denied:true};
        });
      },
    });
    assert.equal((await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'})).value.reviewed,true);
    assert.equal((await host.execute({code:'return codemode.apply({project:"p0"});'})).value.denied,true);
    assert.equal((await host.execute({code:'return codemode.importPng({project:"p0"});'})).value.denied,true);
    assert.equal(writes,0);
    assert.equal(approvals,0);
  }));

test('spoofed face ownership or incomplete six-face source read cannot authorize sample', () =>
  fixture(async input=>{
    const folder=dirname(input), ref=join(folder,'reference.png');
    const cap=join(folder,'capture.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,png);await writeFile(cap,png);
    const sha=createHash('sha256').update(png).digest('hex');
    for(const tamper of ['wrong_face','partial_faces','unknown_alpha']){
      let nativeWrites=0;
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:{
          referencePngPath:ref,capturePngPath:cap,
          captureModelSha256:HASH,viewId:'front',
        },
        reviewVisualPair:()=>({
          decision:'REJECTED',
          issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
            partId:'tier2-helmet',observation:'Helmet shading is still flat.'}],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[1,1],to:[5,5]}],preserveAlpha:true},
          materialCohort:{phase:'sample',issueId:'helmet-flat',
            cubeUuid:REVIEW_CUBE,face:'north',
            partId:'tier2-helmet',approachId:'form-following-metal',
            sampleRegion:{from:[1,1],to:[4,4]}},
        }),
        runner:async argv=>{
          if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
          if(argv[0]==='inspect-visual-pair')return {
            status:'OK',source_model_sha256:HASH,
            reference_png_sha256:sha,capture_png_sha256:sha,
            comparison:{scope:'operator_selected_saved_png_pair',
              reference_png_sha256:sha,capture_png_sha256:sha,
              visual_verdict:'UNVERIFIED'},
          };
          if(argv[0]==='inspect-batch'){
            const report=await mockedNativeFaceBinding(argv,HASH);
            if(tamper==='wrong_face')report.results[0].binding.face='south';
            else if(tamper==='partial_faces')report.results[1].face_alpha.faces.pop();
            else report.results[1].face_alpha.faces[0].alpha={status:'unsupported',reason:'not_decodable'};
            return report;
          }
          nativeWrites++;
          throw Error('unverified native model mutation');
        },
        spawnImpl:()=>fakeGuest({method:'inspectSelectedVisualPair',args:{
          project:'p0',
        }},response=>{
          assert.equal(response.ok,false);
          assert.equal(response.code,tamper==='unknown_alpha'?
            'CODE_MODE_MATERIAL_FACE_ALPHA_UNVERIFIED':
            'CODE_MODE_MATERIAL_FACE_BINDING_UNVERIFIED');
          return {blocked:true};
        }),
      });
      const observed=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
      assert.equal(observed.value.blocked,true);
      assert.equal(nativeWrites,0);
    }
  }));

// Source-only six-direction review fixtures: mocked PNG headers and native
// receipt routing. These do not render models or prove any artistic PASS.
const CAMERA_DIRECTIONS=['front','back','left','right','top','bottom'];
async function chooseVisualDirections(folder) {
  const png=Buffer.from('89504e470d0a1a0a00000000','hex');
  const sha=createHash('sha256').update(png).digest('hex');
  const views=[];
  for(const viewId of CAMERA_DIRECTIONS) {
    const referencePngPath=join(folder,'approved-'+viewId+'.png');
    const capturePngPath=join(folder,'rendered-'+viewId+'.png');
    await writeFile(referencePngPath,png);
    await writeFile(capturePngPath,png);
    views.push({viewId,referencePngPath,capturePngPath});
  }
  const [primary,...supportingViews]=views;
  return {png,sha,views,options:{
    ...primary,captureModelSha256:HASH,
    supportingViews,requireSixDirections:true,
  }};
}
function reviewedCameras(withUnknown = false) {
  return CAMERA_DIRECTIONS.map(viewId=>({
    viewId,
    decision: viewId==='front'?'REJECTED':
      withUnknown && viewId==='bottom'?'UNVERIFIED':'ACCEPTED',
    observation: viewId==='front'?
      'Flat helmet shading in this rendered front view.' :
      'The currently selected shaded view was independently inspected.',
  }));
}
async function mockedSixViews(argv,sha) {
  if(argv[0]==='inspect')return {status:'OK',sha256:sha,summary:SUMMARY};
  if(argv[0]==='inspect-batch')return mockedNativeFaceBinding(argv,sha);
  assert.equal(argv[0],'inspect-visual-pair');
  const hash=createHash('sha256').update(
    Buffer.from('89504e470d0a1a0a00000000','hex')).digest('hex');
  assert.equal(argv[argv.indexOf('--expected-sha256')+1],sha);
  assert.equal(argv[argv.indexOf('--reference-sha256')+1],hash);
  assert.equal(argv[argv.indexOf('--capture-sha256')+1],hash);
  return {status:'OK',source_model_sha256:sha,
    reference_png_sha256:hash,capture_png_sha256:hash,
    comparison:{scope:'operator_selected_saved_png_pair',
      reference_png_sha256:hash,capture_png_sha256:hash,
      visual_verdict:'UNVERIFIED'}};
}

test('operator-selected six model camera directions are distinct from six saved Cube alpha faces', () =>
  fixture(async input=>{
    const chosen=await chooseVisualDirections(dirname(input));
    let reviewerCalls=0, nativeReads=0;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:chosen.options,
      reviewVisualPair:selection=>{
        reviewerCalls++;
        assert.equal(selection.sourceModelSha256,HASH);
        assert.equal(selection.viewId,'front');
        assert.equal(selection.requiredSixDirections,true);
        assert.equal(selection.supportingViews.length,5);
        assert.deepEqual(selection.supportingViews.map(x=>x.viewId),
          CAMERA_DIRECTIONS.slice(1));
        for(const chosenView of [selection,...selection.supportingViews]){
          assert.ok(Buffer.isBuffer(chosenView.reference.pngBytes));
          assert.ok(Buffer.isBuffer(chosenView.capture.pngBytes));
          assert.equal(chosenView.reference.sha256,chosen.sha);
          assert.equal(chosenView.capture.sha256,chosen.sha);
        }
        return {
          decision:'REJECTED',
          viewReviews:reviewedCameras(),
          issues:[{id:'helmet-flat',partId:'tier2-helmet',
            kind:'FLAT_SHADING',observation:'Helmet currently looks flat.'}],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[1,1],to:[5,5]}],preserveAlpha:true},
          materialCohort:{phase:'sample',issueId:'helmet-flat',
            cubeUuid:REVIEW_CUBE,face:'north',
            partId:'tier2-helmet',approachId:'form-following-metal',
            sampleRegion:{from:[1,1],to:[4,4]}},
        };
      },
      runner:async argv=>{
        nativeReads++;
        return mockedSixViews(argv,HASH);
      },
      spawnImpl:()=>fakeGuest({
        method:'inspectSelectedVisualPair',args:{project:'p0'},
      },result=>{
        assert.equal(result.ok,true);
        const info=result.result;
        assert.equal(info.view_scope,'six_cardinal_source_pairs_selected');
        assert.deepEqual(info.view_evidence.map(x=>x.view_id),CAMERA_DIRECTIONS);
        assert.equal(info.review_feedback.viewReviews.length,6);
        assert.equal(info.review_feedback.viewReviews[0].decision,'REJECTED');
        assert.equal(info.review_feedback.face_source_evidence.face_count,6);
        assert.equal(info.view_evidence[5].visual_verdict,'UNVERIFIED');
        assert.equal(info.review_feedback.visual_verdict,'UNVERIFIED');
        assert.equal(JSON.stringify(info).includes('pngBytes'),false);
        assert.equal(JSON.stringify(info).includes(dirname(input)),false);
        return {viewCount:info.view_evidence.length};
      }),
    });
    const result=await host.execute({
      code:'return codemode.inspectSelectedVisualPair({project:"p0"});',
    });
    assert.equal(result.value.viewCount,6);
    assert.equal(reviewerCalls,1);
    assert.equal(nativeReads,8); // 1 source inspect + 6 PNG comparisons + 1 face batch
    const repeated=await host.execute({
      code:'return codemode.inspectSelectedVisualPair({project:"p0"});',
    });
    assert.equal(repeated.value.viewCount,6);
    assert.equal(reviewerCalls,1); // original reviewer finding remains authoritative
    assert.equal(nativeReads,9); // second read needs only one pinned Rust model check
  }));

// Repeated multi-view preflight reuses only source-bound numeric receipts.
// It MUST recheck both current .bbmodel and every selected image before reuse.
test('multi-view preflight cache refuses replaced model and supporting PNG without repeated pair decoders', () =>
  fixture(async input=>{
    const chosen=await chooseVisualDirections(dirname(input));
    let compares=0,inspects=0,visualCallbacks=0,staleModel=false,step=0;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:chosen.options,
      reviewVisualPair:()=>{
        visualCallbacks++;
        return {decision:'UNVERIFIED',issues:[],viewReviews:
          CAMERA_DIRECTIONS.map(viewId=>({
            viewId,decision:'UNVERIFIED',
            observation:'No independent acceptance was determined for this camera.',
          }))};
      },
      runner:async argv=>{
        if(argv[0]==='inspect'){
          inspects++;
          if(argv.includes('--expected-sha256')){
            assert.equal(argv[argv.indexOf('--expected-sha256')+1],HASH);
          }
          return {status:'OK',sha256:staleModel?'b'.repeat(64):HASH,
            summary:SUMMARY};
        }
        assert.equal(argv[0],'inspect-visual-pair');
        compares++;
        return mockedSixViews(argv,HASH);
      },
      spawnImpl:()=>fakeGuest({
        method:'inspectSelectedVisualPair',args:{project:'p0'},
      },response=>{
        const turn=++step;
        if(turn===1){
          assert.equal(response.ok,true);
          assert.equal(response.result.review_feedback.decision,'UNVERIFIED');
          return {first:true};
        }
        assert.equal(response.ok,false);
        assert.equal(response.code,turn===2?
          'CODE_MODE_VISUAL_CAPTURE_MODEL_STALE':
          'CODE_MODE_VISUAL_REVIEW_INPUT_STALE');
        return {blocked:true};
      }),
    });
    assert.equal((await host.execute({
      code:'return codemode.inspectSelectedVisualPair({project:"p0"});',
    })).value.first,true);
    assert.equal(inspects,1);
    assert.equal(compares,6);
    assert.equal(visualCallbacks,1);
    staleModel=true;
    assert.equal((await host.execute({
      code:'return codemode.inspectSelectedVisualPair({project:"p0"});',
    })).value.blocked,true);
    staleModel=false;
    await writeFile(chosen.views[5].capturePngPath,
      Buffer.concat([chosen.png,Buffer.from([1])]));
    assert.equal((await host.execute({
      code:'return codemode.inspectSelectedVisualPair({project:"p0"});',
    })).value.blocked,true);
    assert.equal(inspects,3); // each attempted reuse explicitly checks Rust source
    assert.equal(compares,6); // stale input never returns old pair comparison as fresh
    assert.equal(visualCallbacks,1); // no replacement reviewer declaration
  }));

test('missing/duplicate/unsupported camera directions cannot create a six-view host', () =>
  fixture(async input=>{
    const chosen=await chooseVisualDirections(dirname(input));
    const variants=[
      {...chosen.options,supportingViews:chosen.options.supportingViews.slice(1)},
      {...chosen.options,supportingViews:[
        ...chosen.options.supportingViews.slice(0,4),
        {...chosen.options.supportingViews[0]},
      ]},
      {...chosen.options,supportingViews:chosen.options.supportingViews.map((v,i)=>
        i===0?{...v,viewId:'diagonal'}:v)},
      {...chosen.options,supportingViews:chosen.options.supportingViews.map((v,i)=>
        i===0?{...v,untrustedPath:'/tmp/evil.png'}:v)},
      {...chosen.options,requireSixDirections:'yes'},
      {...chosen.options,supportingViews:[
        {...chosen.options.supportingViews[0],
          capturePngPath:chosen.options.capturePngPath},
        ...chosen.options.supportingViews.slice(1),
      ]},
    ];
    for(const options of variants){
      let spawns=0,cliCalls=0;
      await assert.rejects(createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:options,
        runner:async args=>{cliCalls++;return {status:'OK',
          sha256:HASH,summary:SUMMARY};},
        spawnImpl:()=>{spawns++;throw Error('unexpected guest');},
      }),/CODE_MODE_VISUAL_VIEW_SET_INVALID|CODE_MODE_VISUAL_PAIR_BINDING_INVALID/);
      assert.equal(spawns,0);
      assert.equal(cliCalls,1); // initial project SHA before trusted pair validation
    }
  }));

test('multi-view reviewer must report each chosen view and cannot falsely accept hidden defects', () =>
  fixture(async input=>{
    const chosen=await chooseVisualDirections(dirname(input));
    const expectedCases=[
      {review:null,expected:'CODE_MODE_VISUAL_VIEW_REVIEW_INVALID'},
      {review:reviewedCameras().slice(1),expected:'CODE_MODE_VISUAL_VIEW_REVIEW_INVALID'},
      {review:reviewedCameras().map((v,i)=>i===5?{...v,viewId:'front'}:v),
        expected:'CODE_MODE_VISUAL_VIEW_REVIEW_INVALID'},
      {review:reviewedCameras(),decision:'ACCEPTED',
        expected:'CODE_MODE_VISUAL_VIEW_REVIEW_INVALID'},
    ];
    for(const testCase of expectedCases){
      let approvals=0,writes=0;
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:chosen.options,
        reviewVisualPair:()=>({
          decision:testCase.decision??'REJECTED',
          ...(testCase.review===null?{}:{viewReviews:testCase.review}),
          ...(testCase.decision==='ACCEPTED'?{
            issues:[],
          }:{
            issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
              observation:'The helmet needs better material shading.'}],
            correctionScope:{textureUuid:'tier2-atlas',
              allowedRegions:[{from:[1,1],to:[5,5]}],preserveAlpha:true},
          }),
        }),
        authorizeMutation:()=>{approvals++;return true;},
        runner:async args=>{
          if(!['inspect','inspect-visual-pair'].includes(args[0]))writes++;
          return mockedSixViews(args,HASH);
        },
        spawnImpl:()=>fakeGuest({method:'inspectSelectedVisualPair',args:{
          project:'p0',
        }},res=>{
          assert.equal(res.ok,false);
          assert.equal(res.code,testCase.expected);
          return {rejected:true};
        }),
      });
      const response=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
      assert.equal(response.value.rejected,true);
      assert.equal(approvals,0);
      assert.equal(writes,0);
    }
  }));

test('additional unverified view prevents broad Paint and changed side capture blocks sample Paint', () =>
  fixture(async input=>{
    const chosen=await chooseVisualDirections(dirname(input));
    const intent={
      issueId:'helmet-flat',approachId:'form-following-metal',
      partId:'tier2-helmet',material:'metal',
      cause:'Helmet currently has a flat stripe rather than shaped shadow clusters.',
      treatment:'form_value_masses',
      expectedChange:'Build distinct form-following contact and highlight regions.',
    };
    for(const phase of ['propagation','sample']){
      const next=await chooseVisualDirections(dirname(input));
      let i=0,approvals=0,writes=0;
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        preselectedVisualPair:next.options,
        reviewVisualPair:()=>({
          decision:'REJECTED',
          viewReviews:reviewedCameras(true),
          issues:[{id:'helmet-flat',partId:'tier2-helmet',
            kind:'FLAT_SHADING',observation:'Helmet face needs a sample.'}],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[1,1],to:[5,5]}],preserveAlpha:true},
          materialCohort:{
            phase,issueId:'helmet-flat',partId:'tier2-helmet',
            cubeUuid:REVIEW_CUBE,face:'north',
            approachId:'form-following-metal',
            sampleRegion:{from:[1,1],to:[4,4]},
            ...(phase==='propagation'?{sampleVerdict:'ACCEPTED'}:{}),
          },
        }),
        authorizeMutation:()=>{approvals++;throw Error('unexpected approval');},
        runner:async args=>{
          if(!['inspect','inspect-visual-pair','inspect-batch'].includes(args[0]))writes++;
          return mockedSixViews(args,HASH);
        },
        spawnImpl:()=>{
          i++;
          if(i===1)return fakeGuest({method:'inspectSelectedVisualPair',args:{
            project:'p0',
          }},res=>{
            assert.equal(res.ok,true);
            return {reviewed:true};
          });
          return fakeGuest({method:'apply',args:{
            project:'p0',output:phase+'-forbidden.bbmodel',
            operations:[{op:'paint_texture_pixel',texture_index:0,
              x:2,y:2,rgba:[50,60,70,255]}],
            correctionScope:{textureUuid:'tier2-atlas',
              allowedRegions:[{from:[2,2],to:[3,3]}],preserveAlpha:true},
            correctionIntent:intent,
          }},res=>{
            assert.equal(res.ok,false);
            assert.equal(res.code,phase==='propagation'?
              'CODE_MODE_VISUAL_VIEW_COVERAGE_UNVERIFIED':
              'CODE_MODE_VISUAL_REVIEW_INPUT_STALE');
            return {blocked:true};
          });
        },
      });
      const first=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
      assert.equal(first.value.reviewed,true);
      if(phase==='sample'){
        const other=next.views.find(v=>v.viewId==='back');
        await writeFile(other.capturePngPath,
          Buffer.concat([next.png,Buffer.from([1])]));
      }
      const blocked=await host.execute({code:'return codemode.apply({project:"p0"});'});
      assert.equal(blocked.value.blocked,true);
      assert.equal(approvals,0);
      assert.equal(writes,0);
    }
    assert.equal(chosen.views.length,6);
  }));

test('single front-camera sample acceptance cannot authorize all-surface material propagation', () =>
  fixture(async input=>{
    const folder=dirname(input);
    const reference=join(folder,'reference-front.png');
    const capture=join(folder,'candidate-front.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(reference,png);await writeFile(capture,png);
    const digest=createHash('sha256').update(png).digest('hex');
    const intent={
      issueId:'helmet-flat',partId:'tier2-helmet',
      approachId:'form-following-metal',material:'metal',
      cause:'The helmet has a flat horizontal band with missing form shadow.',
      treatment:'form_value_masses',
      expectedChange:'Rebuild form-following base and shadow clusters on metal.',
    };
    let approvals=0,writes=0,phase=0;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:reference,capturePngPath:capture,
        captureModelSha256:HASH,viewId:'front',
      },
      reviewVisualPair:()=>({
        decision:'REJECTED',
        issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
          partId:'tier2-helmet',
          observation:'The helmet material still needs treatment.'}],
        correctionScope:{textureUuid:'tier2-atlas',
          allowedRegions:[{from:[0,0],to:[16,16]}],preserveAlpha:true},
        materialCohort:{
          phase:'propagation',issueId:'helmet-flat',
          partId:'tier2-helmet',approachId:'form-following-metal',
          cubeUuid:REVIEW_CUBE,face:'north',
          sampleRegion:{from:[1,1],to:[5,5]},sampleVerdict:'ACCEPTED',
        },
      }),
      authorizeMutation:()=>{approvals++;throw Error('must not authorize');},
      runner:async argv=>{
        if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        if(argv[0]==='inspect-visual-pair')return {
          status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest,capture_png_sha256:digest,
          comparison:{scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest,capture_png_sha256:digest,
            visual_verdict:'UNVERIFIED'},
        };
        if(argv[0]==='inspect-batch')return mockedNativeFaceBinding(argv,HASH);
        writes++;
        throw Error('must not call native Paint');
      },
      spawnImpl:()=>{
        phase++;
        if(phase===1)return fakeGuest({
          method:'inspectSelectedVisualPair',args:{project:'p0'},
        },res=>{
          assert.equal(res.ok,true);
          assert.equal(res.result.review_feedback.materialCohort.sampleVerdict,'ACCEPTED');
          assert.equal(res.result.view_evidence.length,1);
          return {preflight:true};
        });
        return fakeGuest({method:'apply',args:{
          project:'p0',output:'invalid-propagation.bbmodel',
          operations:[{op:'paint_texture_pixel',texture_index:0,
            x:9,y:9,rgba:[30,60,90,255]}],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[8,8],to:[10,10]}],preserveAlpha:true},
          correctionIntent:intent,
        }},res=>{
          assert.equal(res.ok,false);
          assert.equal(res.code,'CODE_MODE_VISUAL_VIEW_COVERAGE_UNVERIFIED');
          return {blocked:true};
        });
      },
    });
    const first=await host.execute({
      code:'return codemode.inspectSelectedVisualPair({project:"p0"});',
    });
    assert.equal(first.value.preflight,true);
    const result=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(result.value.blocked,true);
    assert.equal(approvals,0);
    assert.equal(writes,0);
  }));

test('Code Mode can bootstrap New from an approved empty output directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-new-host-'));
  try {
    const calls = [];
    const approvals = [];
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno',
      outputDirectory: directory,
      authorizeMutation: async (request) => {
        approvals.push(request.operation);
        return request.operation === 'newModel';
      },
      runner: async (argv) => {
        calls.push(argv[0]);
        if (argv[0] === 'new') {
          return { status: 'OK', sha256: HASH, summary: SUMMARY };
        }
        return { status: 'OK', sha256: HASH, summary: SUMMARY };
      },
      spawnImpl: () => fakeGuest({ method: 'newModel', args: {
        output: 'bootstrap.bbmodel', name: 'New Entity',
        modelIdentifier: 'geometry.new_entity',
      } }, (response) => {
        assert.equal(response.ok, true);
        assert.equal(response.result.project, 'p0');
        assert.equal(response.result.sha256, HASH);
        return { project: response.result.project };
      }, null),
    });
    assert.equal(host.initial.project, null);
    const result = await host.execute({
      code: "return await codemode.newModel({output:'bootstrap.bbmodel'});",
    });
    assert.equal(result.value.project, 'p0');
    assert.deepEqual(calls, ['new', 'inspect']);
    assert.deepEqual(approvals, ['newModel']);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('Code Mode host runs only one guest at a time', () =>
  fixture(async (input) => {
    let spawned = 0;
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
      runner: async () => ({ status: 'OK', sha256: HASH, summary: SUMMARY }),
      spawnImpl: () => {
        spawned++;
        return fakeGuest({ method: 'audit', args: { project: 'p0' } },
          (reply) => {
            assert.equal(reply.ok, true);
            return { auditReady: true };
          });
      },
    });
    const first = host.execute({ code: 'return await codemode.audit({project:"p0"});' });
    await assert.rejects(
      host.execute({ code: 'return "overlapping";' }),
      /CODE_MODE_HOST_BUSY/,
    );
    const result = await first;
    assert.equal(result.value.auditReady, true);
    assert.equal(spawned, 1);
  }));

test('Code Mode host exposes Position/Rotation/Scale inspect through the guest allowlist', () =>
  fixture(async (input) => {
    const calls = [];
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
      runner: async (args) => {
        calls.push(args);
        if (args.includes('--track-channel')) {
          return { status: 'OK', sha256: HASH, summary: SUMMARY,
            track: { scope: 'linear_bone_transform', recognized: true,
              channel: 'position', total_frames: 0, keyframes: [] } };
        }
        return { status: 'OK', sha256: HASH, summary: SUMMARY };
      },
      spawnImpl: () => fakeGuest({
        method: 'inspectAnimationTransformTrack',
        args: { project: 'p0', animationUuid: 'clip', boneUuid: 'bone',
          channel: 'position', offset: 0, limit: 2 },
      }, (result) => {
        assert.equal(result.ok, true);
        assert.equal(result.result.track.channel, 'position');
        return { inspected: result.result.track.recognized };
      }),
    });
    const result = await host.execute({ code:
      "return await codemode.inspectAnimationTransformTrack({project:'p0',animationUuid:'clip',boneUuid:'bone',channel:'position'});" });
    assert.equal(result.value.inspected, true);
    assert.equal(result.rpc_calls, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], [
      'inspect', '--input', input,
      '--animation-uuid', 'clip', '--bone-uuid', 'bone',
      '--track-channel', 'position', '--frame-offset', '0', '--frame-limit', '2',
      '--expected-sha256', HASH,
    ]);
  }));

test('Code Mode host rejects exited guest with pending approval and denies late approval', () =>
  fixture(async (input) => {
    const calls = [];
    let child;
    let entered;
    let approveLate;
    const enteredApproval = new Promise((resolve) => { entered = resolve; });
    const approvalResult = new Promise((resolve) => { approveLate = resolve; });
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
      authorizeMutation: async () => {
        entered();
        return approvalResult;
      },
      runner: async (args) => {
        calls.push(args[0]);
        return { status: 'OK', sha256: HASH, summary: SUMMARY };
      },
      spawnImpl: () => {
        child = fakeGuest({ method: 'apply', args: {
          project: 'p0', output: 'after-timeout.bbmodel',
          operations: [{ op: 'remove_cube', uuid: 'cube-1' }],
        } }, () => { throw new Error('Unexpected approved effect'); });
        return child;
      },
    });
    const inFlight = host.execute({
      code: 'return await codemode.apply({project:"p0"});',
    });
    await enteredApproval;
    child.kill(); // Simulates lost/terminated guest while approval is open.
    await assert.rejects(inFlight,
      /CODE_MODE_OUTCOME_UNKNOWN_PENDING_RPC/);
    approveLate(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['inspect']); // No Rust apply after guest exits.
  }));

test('Code Mode rejects unknown guest methods rather than invoking host commands', () =>
  fixture(async (input) => {
    const calls = [];
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
      runner: async (args) => {
        calls.push(args);
        return { status: 'OK', sha256: HASH, summary: SUMMARY };
      },
      spawnImpl: () => fakeGuest({
        method: 'executeShell', args: { command: 'do-not-run' },
      }, () => {
        throw new Error('Unexpected RPC approval');
      }),
    });
    await assert.rejects(host.execute({ code: "return 1;" }),
      /CODE_MODE_RPC_NOT_ALLOWED/);
    assert.deepEqual(calls.map((args) => args[0]), ['inspect']);
  }));

test('Code Mode rejects oversize or empty script before sandbox spawn', () =>
  fixture(async (input) => {
    let spawns = 0;
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
      runner: async () => ({ status: 'OK', sha256: HASH, summary: SUMMARY }),
      spawnImpl: () => {
        spawns++;
        throw new Error('Should not create Deno guest for invalid code');
      },
    });
    await assert.rejects(host.execute({ code: '' }),
      /CODE_MODE_SCRIPT_INVALID_OR_OVERSIZE/);
    await assert.rejects(host.execute({ code: 'x'.repeat(32769) }),
      /CODE_MODE_SCRIPT_INVALID_OR_OVERSIZE/);
    assert.equal(spawns, 0);
  }));


test('Bedrock animation export guest routes to approved exact sibling without model write', () =>
  fixture(async (input) => {
    const calls = [];
    const approvals = [];
    const host = await createCodeModeHost({
      rustBinary: '/trusted/rust', denoBinary: '/trusted/deno', input,
      authorizeMutation: async (request) => { approvals.push(request); return true; },
      runner: async (args) => {
        calls.push(args);
        if (args[0] === 'export-animation') {
          return { status: 'OK', source_sha256: HASH, output_sha256: HASH, bytes: 100,
            curve_fidelity: 'adaptive_bezier_approximation' };
        }
        return { status: 'OK', sha256: HASH, summary: SUMMARY };
      },
      spawnImpl: () => fakeGuest({
        method: 'exportAnimations', args: { project: 'p0', output: 'walk.animation.json' },
      }, (response) => {
        assert.equal(response.ok, true);
        assert.equal(response.result.bytes, 100);
        assert.equal(response.result.curve_fidelity, 'adaptive_bezier_approximation');
        return { emitted: true };
      }),
    });
    const result = await host.execute({ code: 'return await codemode.exportAnimations({ project: codemode.initial.project, output: "walk.animation.json" });' });
    assert.equal(result.status, 'OK');
    assert.equal(result.value.emitted, true);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].operation, 'exportAnimations');
    assert.equal(calls.filter((args) => args[0] === 'export-animation').length, 1);
    assert.ok(calls.find((args) => args[0] === 'export-animation').includes('--expected-sha256'));
  }));

test('Texturing readiness is BLOCKED without matched images and reviewer even if model loads',()=>
  fixture(async input=>{
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      runner:async argv=>{
        assert.equal(argv[0],'inspect');
        return {status:'OK',sha256:HASH,summary:SUMMARY};
      },
      spawnImpl:()=>fakeGuest({method:'texturingReadiness',args:{project:'p0'}},
        response=>{
          assert.equal(response.ok,true);
          assert.equal(response.result.status,'BLOCKED');
          assert.equal(response.result.texture_completion_attested,false);
          assert.ok(response.result.blockers.includes('INDEPENDENT_IMAGE_REVIEW_NOT_CONNECTED'));
          return {state:response.result.status};
        }),
    });
    const result=await host.execute({code:'return codemode.texturingReadiness({project:"p0"});'});
    assert.equal(result.value.state,'BLOCKED');
  }));
test('Texturing readiness reads all saved Cube coverage only after independently reviewed six PNG pairs',()=>
  fixture(async input=>{
    const folder=dirname(input);
    const views=['front','back','left','right','top','bottom'];
    const chosen=[];
    for(const viewId of views){
      const referencePngPath=join(folder,'reference-'+viewId+'.png');
      const capturePngPath=join(folder,'capture-'+viewId+'.png');
      await writeFile(referencePngPath,Buffer.concat([
        Buffer.from('89504e470d0a1a0a','hex'),Buffer.from(viewId)]));
      await writeFile(capturePngPath,Buffer.concat([
        Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('candidate-'+viewId)]));
      chosen.push({viewId,referencePngPath,capturePngPath});
    }
    let step=0, inspectedPages=0, reviewerCalls=0, forceFlatWarning=false;
    let forcedStyleHint=null, omitStyleHints=false;
    let extraAttention=false, extraOpaque=false;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        ...chosen[0],captureModelSha256:HASH,
        supportingViews:chosen.slice(1),requireSixDirections:true,
      },
      reviewVisualPair:()=>{
        reviewerCalls++;
        return {decision:'ACCEPTED',issues:[],viewReviews:views.map(viewId=>({
          viewId,decision:'ACCEPTED',observation:'Material form is coherent in this matched view.',
        })),reviewedFaces:[{cubeUuid:REVIEW_CUBE,
          textureUuid:'tier2-atlas',face:'north',style:'STYLED',
          observedInViewId:'front',
          observation:'The saved helmet face has deliberate form-based shading and controlled edge highlights.',
        }]};
      },
      runner:async argv=>{
        if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        if(argv[0]==='inspect-visual-pair'){
          const r=argv[argv.indexOf('--reference-sha256')+1];
          const c=argv[argv.indexOf('--capture-sha256')+1];
          return {status:'OK',source_model_sha256:HASH,
            reference_png_sha256:r,capture_png_sha256:c,
            comparison:{scope:'operator_selected_saved_png_pair',
              reference_png_sha256:r,capture_png_sha256:c,
              visual_verdict:'UNVERIFIED',silhouette:{status:'unassessed_opaque_background'}}};
        }
        assert.equal(argv[0],'inspect-batch');
        const plan=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
        if(plan.requests[0]?.kind==='texture_styling_face'){
          assert.deepEqual(plan.requests,[{
            kind:'texture_styling_face',texture_uuid:'tier2-atlas',
            cube_uuid:REVIEW_CUBE,face:'north',
          }]);
          return {status:'OK',sha256:HASH,summary:SUMMARY,results:[{
            kind:'texture_styling_face',styling:{
              scope:'saved_cube_face_local_pixels',
              texture_uuid:'tier2-atlas',cube_uuid:REVIEW_CUBE,
              face:'north',status:forceFlatWarning?'BASE_ONLY_CANDIDATE':
                forcedStyleHint?'REVIEW_REQUIRED':'NOT_EVALUATED',
              visible_pixels:16,
              ...(omitStyleHints?{}:{review_hints:forceFlatWarning?
                ['UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE']:
                forcedStyleHint?[forcedStyleHint]:[]}),
              visual_verdict:'UNVERIFIED',texture_completion_attested:false,
            },
          }]};
        }
        assert.deepEqual(plan.requests,[{
          kind:'model_texture_coverage',offset:0,limit:8,attention_only:false,
        }]);
        inspectedPages++;
        return {status:'OK',sha256:HASH,summary:SUMMARY,results:[{
          kind:'model_texture_coverage',coverage:{
            scope:'saved_face_texture_coverage_page',offset:0,total_cubes:1,
            reviewed_cubes:1,review_candidates:extraAttention?1:0,
            unresolved_reference_or_mapping_faces:0,next_offset:null,
            cubes:[{cube_uuid:REVIEW_CUBE,review_candidates:extraAttention?1:0,
              faces:ALL_FACE_SIDES.map(side=>({
                side,texture_uuid:(side==='north' ||
                    (extraAttention && side==='down') ||
                    (extraOpaque && side==='south'))?'tier2-atlas':null,
                status:side==='north'?'measured_nontransparent_pixels':
                  extraAttention && side==='down'?'fully_transparent_pixels':
                  extraOpaque && side==='south'?'measured_nontransparent_pixels':
                  'absent_declared',
              })),
            }],
          },
        }]};
      },
      spawnImpl:()=>fakeGuest({
        method:step++===0?'inspectSelectedVisualPair':'texturingReadiness',
        args:{project:'p0'},
      },response=>{
        assert.equal(response.ok,true);
        if(response.result.review_feedback){
          assert.equal(response.result.review_feedback.decision,'ACCEPTED');
          return {reviewed:true};
        }
        if (response.result.status==='BLOCKED'){
          const blocked=response.result.blockers;
          if(blocked.includes('UNIFORM_FACE_CANNOT_CLAIM_STYLED')){
            return {sourceOnlyReady:false,flatRejected:true};
          }
          if(blocked.includes('BAND_OR_NOISE_FACE_CANNOT_CLAIM_STYLED')){
            return {sourceOnlyReady:false,patternRejected:true};
          }
          if(blocked.includes('REVIEWED_FACE_SOURCE_INSPECTION_INVALID')){
            return {sourceOnlyReady:false,invalidEvidence:true};
          }
          if(blocked.includes('SOURCE_ATTENTION_FACES_UNREVIEWED')){
            assert.equal(response.result.face_scan.source_attention_faces_unreviewed,1);
            return {sourceOnlyReady:false,reason:'SOURCE_ATTENTION_FACES_UNREVIEWED'};
          }
          assert.ok(blocked.includes('REQUIRED_SOURCE_FACES_UNREVIEWED'));
          assert.equal(response.result.face_scan.required_source_faces_unreviewed,1);
          return {sourceOnlyReady:false,reason:'REQUIRED_SOURCE_FACES_UNREVIEWED'};
        }
        assert.equal(response.result.status,'REVIEWER_DECLARED_READY_FOR_USER_DECISION');
        assert.equal(response.result.texture_completion_attested,false);
        assert.equal(response.result.visual_verdict,'UNVERIFIED');
        assert.equal(response.result.face_scan.complete,true);
        assert.equal(response.result.face_scan.required_source_faces,1);
        assert.equal(response.result.face_scan.required_source_faces_unreviewed,0);
        assert.equal(response.result.material_faces.expected,1);
        assert.equal(response.result.material_faces.inspected,1);
        return {sourceOnlyReady:true,
          styleWarnings:response.result.material_faces.styling_warning_candidates};
      }),
    });
    assert.equal((await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'}))
      .value.reviewed,true);
    assert.equal((await host.execute({code:'return codemode.texturingReadiness({project:"p0"});'}))
      .value.sourceOnlyReady,true);
    forceFlatWarning=true;
    const flat=await host.execute({code:'return codemode.texturingReadiness({project:"p0"});'});
    assert.equal(flat.value.flatRejected,true);
    forceFlatWarning=false;
    for(const hint of ['UNIFORM_HORIZONTAL_BANDS_REVIEW',
      'UNIFORM_VERTICAL_BANDS_REVIEW','FRAGMENTED_OR_NOISE_FIRST_REVIEW']){
      forcedStyleHint=hint;
      const rejected=await host.execute({
        code:'return codemode.texturingReadiness({project:"p0"});'});
      assert.equal(rejected.value.patternRejected,true);
    }
    // Subtle value variation is advisory: actual image review still owns it.
    forcedStyleHint='LOW_FORM_VALUE_VARIATION_CANDIDATE';
    const subtle=await host.execute({
      code:'return codemode.texturingReadiness({project:"p0"});'});
    assert.equal(subtle.value.sourceOnlyReady,true);
    assert.equal(subtle.value.styleWarnings,1);
    forcedStyleHint=null;
    omitStyleHints=true;
    const malformed=await host.execute({
      code:'return codemode.texturingReadiness({project:"p0"});'});
    assert.equal(malformed.value.invalidEvidence,true);
    omitStyleHints=false;
    extraAttention=true;
    const missing=await host.execute({code:'return codemode.texturingReadiness({project:"p0"});'});
    assert.equal(missing.value.sourceOnlyReady,false);
    assert.ok(missing.value.flatRejected===undefined);
    assert.equal(missing.value.reason,'SOURCE_ATTENTION_FACES_UNREVIEWED');
    extraAttention=false;
    extraOpaque=true;
    const opaque=await host.execute({code:'return codemode.texturingReadiness({project:"p0"});'});
    assert.equal(opaque.value.reason,'REQUIRED_SOURCE_FACES_UNREVIEWED');
    assert.equal(reviewerCalls,1);
    assert.equal(inspectedPages,10); // One early source-face binding plus nine terminal scans.
  }));

test('accepted material face cannot invent saved Cube/texture ownership',()=>
  fixture(async input=>{
    const folder=dirname(input);
    const ref=join(folder,'approved-face.png'),capture=join(folder,'current-face.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(ref,png);await writeFile(capture,png);
    const digest=createHash('sha256').update(png).digest('hex');
    let nativeFaceReads=0;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{referencePngPath:ref,capturePngPath:capture,
        captureModelSha256:HASH,viewId:'front'},
      reviewVisualPair:()=>({
        decision:'ACCEPTED',issues:[],
        viewReviews:[{viewId:'front',decision:'ACCEPTED',
          observation:'Reviewed the selected front image pair.'}],
        reviewedFaces:[{cubeUuid:'invented-cube',textureUuid:'tier2-atlas',
          face:'north',style:'STYLED',observedInViewId:'front',
          observation:'This supposed face was claimed without actual Cube ownership.'}],
      }),
      runner:async argv=>{
        if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        if(argv[0]==='inspect-visual-pair')return {
          status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest,capture_png_sha256:digest,
          comparison:{scope:'operator_selected_saved_png_pair',
            visual_verdict:'UNVERIFIED'},
        };
        assert.equal(argv[0],'inspect-batch');
        nativeFaceReads++;
        return {status:'OK',sha256:HASH,summary:SUMMARY,
          results:[{kind:'model_texture_coverage',coverage:{
            scope:'saved_face_texture_coverage_page',offset:0,
            total_cubes:1,reviewed_cubes:1,next_offset:null,
            cubes:[{cube_uuid:REVIEW_CUBE,faces:ALL_FACE_SIDES.map(side=>({
              side,status:side==='north'?'measured_nontransparent_pixels':'absent_declared',
              texture_uuid:side==='north'?'tier2-atlas':null,
            }))}],
          }}]};
      },
      spawnImpl:()=>fakeGuest({
        method:'inspectSelectedVisualPair',args:{project:'p0'},
      },response=>{
        assert.equal(response.ok,false);
        assert.equal(response.code,'CODE_MODE_REVIEWED_FACE_SOURCE_UNVERIFIED');
        return {refused:true};
      }),
    });
    const result=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
    assert.equal(result.value.refused,true);
    assert.equal(nativeFaceReads,1);
  }));

test('operator-owned visual adapter receives Rust face inventory with exact PNG bytes', ()=>
  fixture(async input=>{
    const folder=dirname(input);
    const ref=join(folder,'reference-front.png');
    const current=join(folder,'current-front.png');
    const reference=Buffer.from('89504e470d0a1a0a726566','hex');
    const capture=Buffer.from('89504e470d0a1a0a6d6f64656c','hex');
    await writeFile(ref,reference);
    await writeFile(current,capture);
    const digest=b=>createHash('sha256').update(b).digest('hex');
    let reviewerCalls=0,inventoryCalls=0;
    const reviewVisualPair=async pair=>{
      reviewerCalls++;
      assert.equal(pair.sourceModelSha256,HASH);
      assert.equal(digest(pair.reference.pngBytes),digest(reference));
      assert.equal(digest(pair.capture.pngBytes),digest(capture));
      assert.equal(pair.sourceFaceInventory.complete,true);
      assert.equal(pair.sourceFaceInventory.faces.length,1);
      assert.deepEqual(pair.sourceFaceInventory.faces[0],{
        cube_uuid:REVIEW_CUBE,face:'north',
        texture_uuid:'tier2-atlas',
        source_status:'measured_nontransparent_pixels',
      });
      return {decision:'UNVERIFIED',issues:[]};
    };
    reviewVisualPair.requiresSourceFaceInventory=true;
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        viewId:'front',referencePngPath:ref,capturePngPath:current,
        captureModelSha256:HASH,
      },
      reviewVisualPair,
      runner:async argv=>{
        if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        if(argv[0]==='inspect-visual-pair')return {
          status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest(reference),
          capture_png_sha256:digest(capture),
          comparison:{
            scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest(reference),
            capture_png_sha256:digest(capture),
            visual_verdict:'UNVERIFIED',
          },
        };
        assert.equal(argv[0],'inspect-batch');
        const plan=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
        assert.deepEqual(plan.requests,[{
          kind:'model_texture_coverage',offset:0,limit:8,attention_only:false,
        }]);
        inventoryCalls++;
        return {status:'OK',sha256:HASH,summary:SUMMARY,results:[{
          kind:'model_texture_coverage',
          coverage:{scope:'saved_face_texture_coverage_page',
            total_cubes:1,offset:0,reviewed_cubes:1,next_offset:null,
            cubes:[{cube_uuid:REVIEW_CUBE,faces:ALL_FACE_SIDES.map(side=>({
              side,texture_uuid:side==='north'?'tier2-atlas':null,
              status:side==='north'?'measured_nontransparent_pixels':'absent_declared',
            }))}],
          },
        }]};
      },
      spawnImpl:()=>fakeGuest({
        method:'inspectSelectedVisualPair',args:{project:'p0'},
      },response=>{
        assert.equal(response.ok,true);
        assert.equal(response.result.review_feedback.decision,'UNVERIFIED');
        return {reviewed:true};
      }),
    });
    const result=await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'});
    assert.equal(result.value.reviewed,true);
    assert.equal(reviewerCalls,1);
    assert.equal(inventoryCalls,1);
  }));

test('reviewed broad propagation cannot infer original overwrite colors from guest plan',()=>
  fixture(async input=>{
    const folder=dirname(input);
    const directions=['front','back','left','right','top','bottom'];
    const selected=[];
    for(const viewId of directions){
      const referencePngPath=join(folder,'base-'+viewId+'.png');
      const capturePngPath=join(folder,'candidate-'+viewId+'.png');
      await writeFile(referencePngPath,Buffer.concat([
        Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('base-'+viewId)]));
      await writeFile(capturePngPath,Buffer.concat([
        Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('candidate-'+viewId)]));
      selected.push({viewId,referencePngPath,capturePngPath});
    }
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
    const referenceSha=sha(await readFile(selected[0].referencePngPath));
    let changes=0,steps=0;
    const observation='The metal helmet side has a missing approved edge marking.';
    const intent={issueId:'missing-edge',approachId:'restore-edge',
      partId:'helmet-side',material:'metal',treatment:'hand_painted_clusters',
      cause:'The originally approved metal edge marking is missing from the current face.',
      expectedChange:'Restore one bounded colored highlight without disturbing the rest.'};
    const packet={
      sourceModelSha256:HASH,referencePngSha256:referenceSha,
      issueId:intent.issueId,approachId:intent.approachId,partId:intent.partId,
      textureUuid:'tier2-atlas',material:'metal',
      shadingIntent:'SURFACE_DETAIL',
      reviewedIssueObservation:observation,
      styleIntent:'Restore only the approved helmet side identity edge detail.',
      lightDirection:'Light direction is unchanged from the approved reference image.',
      lightRationale:'This correction changes only the observed missing edge accent.',
      palette:[{role:'detail',rgb:[120,130,150],
        purpose:'Restore an approved rim detail pixel.'}],
      facePlans:[{cubeUuid:REVIEW_CUBE,face:'east',
        atlasRegion:{from:[8,8],to:[12,12]},
        formCue:'The side plane contains an edge marking on its outer rim.',
        clusterPlan:'Place only the selected approved edge pixel, not random noise.'}],
    };
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        ...selected[0],supportingViews:selected.slice(1),
        captureModelSha256:HASH,requireSixDirections:true,
      },
      reviewVisualPair:()=>({
        decision:'REJECTED',
        viewReviews:directions.map(viewId=>({
          viewId,decision:viewId==='front'?'REJECTED':'ACCEPTED',
          observation:'The selected material was viewed with the matched frame.',
        })),
        issues:[{id:intent.issueId,kind:'MISSING_DETAIL',
          partId:intent.partId,observation}],
        correctionScope:{textureUuid:'tier2-atlas',
          allowedRegions:[{from:[0,0],to:[16,16]}],preserveAlpha:true},
        materialCohort:{phase:'propagation',issueId:intent.issueId,
          partId:intent.partId,approachId:intent.approachId,
          cubeUuid:REVIEW_CUBE,face:'north',
          sampleRegion:{from:[1,1],to:[4,4]},sampleVerdict:'ACCEPTED'},
      }),
      authorizeMutation:()=>{changes++;return true;},
      runner:async args=>{
        if(args[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        if(args[0]==='inspect-visual-pair'){
          const refSha=args[args.indexOf('--reference-sha256')+1];
          const capSha=args[args.indexOf('--capture-sha256')+1];
          return {status:'OK',source_model_sha256:HASH,
            reference_png_sha256:refSha,capture_png_sha256:capSha,
            comparison:{scope:'operator_selected_saved_png_pair',
              reference_png_sha256:refSha,capture_png_sha256:capSha,
              visual_verdict:'UNVERIFIED'}};
        }
        if(args[0]==='inspect-batch')return mockedNativeFaceBinding(args,HASH);
        throw Error('native write must not be invoked');
      },
      spawnImpl:()=>fakeGuest({
        method:steps++===0?'inspectSelectedVisualPair':'apply',
        args:steps===1?{project:'p0'}:{
          project:'p0',output:'blocked.bbmodel',
          operations:[{op:'paint_cube_face_regions_guarded',
            cube_uuid:REVIEW_CUBE,texture_uuid:'tier2-atlas',
            regions:[{face:'east',from:[0,0],to:[1,1],
              rgba:[120,130,150,255],erase:false}]}],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[8,8],to:[12,12]}],
            preserveAlpha:true,
            editableBeforeRgba:[[80,90,100,255]]},
          correctionIntent:intent,materialWorkPacket:packet,
        },
      },response=>{
        if(response.ok && response.result.review_feedback){
          return {reviewed:true};
        }
        assert.equal(response.ok,false);
        assert.equal(response.code,
          'CODE_MODE_REVIEWED_SOURCE_COLOR_GUARD_REQUIRED');
        return {blocked:true};
      }),
    });
    assert.equal((await host.execute({code:'return codemode.inspectSelectedVisualPair({project:"p0"});'})).value.reviewed,true);
    assert.equal((await host.execute({code:'return codemode.apply({project:"p0"});'})).value.blocked,true);
    assert.equal(changes,0);
  }));

test('scoped Paint refuses unverified Rust correction receipts and saved-output SHA mismatch',()=>
  fixture(async input=>{
    for(const caseId of ['missing-source-guard','mismatched-saved-sha']){
      let approvals=0,mutations=0,sourceChecks=0,registerReads=0;
      const claimed='b'.repeat(64);
      const host=await createCodeModeHost({
        rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
        authorizeMutation:()=>{approvals++;return true;},
        runner:async argv=>{
          if(argv[0]==='inspect'){
            sourceChecks++;
            const output=basename(argv[argv.indexOf('--input')+1])==='candidate.bbmodel';
            if(output)registerReads++;
            return {status:'OK',sha256:output?'c'.repeat(64):HASH,
              summary:SUMMARY};
          }
          assert.equal(argv[0],'apply');
          mutations++;
          const plan=JSON.parse(await readFile(
            argv[argv.indexOf('--plan')+1],'utf8'));
          assert.equal(plan.correction_scope.texture_uuid,'tier2-atlas');
          return {status:'OK',source_sha256:HASH,output_sha256:claimed,
            summary:{...SUMMARY,revision:1},
            mutation:{revision:1,operation_count:1,changed_uuids:[]},
            ...(caseId==='missing-source-guard'?{
              correction_scope:scopedNativeReceipt('tier2-atlas',{
                editableBeforeRgba:0,
              }),
            }:{
              correction_scope:scopedNativeReceipt('tier2-atlas',{
                editableBeforeRgba:1,
              }),
            })};
        },
        spawnImpl:()=>fakeGuest({method:'apply',args:{
          project:'p0',output:'candidate.bbmodel',
          operations:[{op:'paint_texture_pixel',
            texture_index:0,x:1,y:1,rgba:[120,130,145,255]}],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[1,1],to:[2,2]}],preserveAlpha:true,
            editableBeforeRgba:[[80,100,120,255]]},
        }},response=>{
          assert.equal(response.ok,false);
          assert.equal(response.code,caseId==='missing-source-guard'?
            'CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED':
            'CODE_MODE_RUST_PUBLISHED_OUTPUT_SHA_MISMATCH');
          return {blocked:true};
        }),
      });
      const result=await host.execute({code:'return codemode.apply({project:"p0"});'});
      assert.equal(result.value.blocked,true);
      assert.equal(mutations,1); // possible saved sibling: never auto-retry
      assert.equal(approvals,1);
      assert.equal(registerReads,caseId==='missing-source-guard'?0:1);
      assert.equal(sourceChecks,caseId==='missing-source-guard'?1:2);
    }
  }));

test('reviewed sample freezes its source after a potentially published but unverified Rust receipt',()=>
  fixture(async input=>{
    const folder=dirname(input),reference=join(folder,'approved.png');
    const capture=join(folder,'current.png');
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');
    await writeFile(reference,png);await writeFile(capture,png);
    const digest=createHash('sha256').update(png).digest('hex');
    let phase=0,approvals=0,applies=0;
    const intent={issueId:'helmet-flat',approachId:'connected-bevel',
      partId:'tier2-helmet',material:'metal',treatment:'form_value_masses',
      cause:'The helmet highlights do not follow the actual stepped bevel.',
      expectedChange:'Use one connected light-facing bevel mass on the helmet.'};
    const host=await createCodeModeHost({
      rustBinary:'/trusted/rust',denoBinary:'/trusted/deno',input,
      preselectedVisualPair:{
        referencePngPath:reference,capturePngPath:capture,
        captureModelSha256:HASH,viewId:'front',
      },
      reviewVisualPair:()=>({
        decision:'REJECTED',issues:[{id:'helmet-flat',kind:'MISSING_DETAIL',
          partId:'tier2-helmet',observation:'A reviewed helmet edge mark is missing.'}],
        correctionScope:{textureUuid:'tier2-atlas',
          allowedRegions:[{from:[1,1],to:[5,5]}],preserveAlpha:true},
        materialCohort:{phase:'sample',issueId:'helmet-flat',
          partId:'tier2-helmet',approachId:'connected-bevel',
          cubeUuid:REVIEW_CUBE,face:'north',
          sampleRegion:{from:[1,1],to:[4,4]}},
      }),
      authorizeMutation:()=>{approvals++;return true;},
      runner:async argv=>{
        if(argv[0]==='inspect')return {status:'OK',sha256:HASH,summary:SUMMARY};
        if(argv[0]==='inspect-visual-pair')return {
          status:'OK',source_model_sha256:HASH,
          reference_png_sha256:digest,capture_png_sha256:digest,
          comparison:{scope:'operator_selected_saved_png_pair',
            reference_png_sha256:digest,capture_png_sha256:digest,
            visual_verdict:'UNVERIFIED'},
        };
        if(argv[0]==='inspect-batch')return mockedNativeFaceBinding(argv,HASH);
        assert.equal(argv[0],'apply');
        applies++;
        return {status:'OK',source_sha256:HASH,output_sha256:'b'.repeat(64),
          summary:{...SUMMARY,revision:1},
          mutation:{revision:1,operation_count:1,changed_uuids:[]},
          // The native publication could have happened; counts are false.
          correction_scope:scopedNativeReceipt('tier2-atlas',{
            editableBeforeRgba:1,
          })};
      },
      spawnImpl:()=>fakeGuest({
        method:phase++===0?'inspectSelectedVisualPair':'apply',
        args:phase===1?{project:'p0'}:{
          project:'p0',output:phase===2?'candidate.bbmodel':'retry.bbmodel',
          operations:[{op:'paint_texture_pixel',texture_index:0,
            x:2,y:2,rgba:[80,100,120,255]}],
          correctionScope:{textureUuid:'tier2-atlas',
            allowedRegions:[{from:[2,2],to:[4,4]}],preserveAlpha:true},
          correctionIntent:intent,
        },
      },response=>{
        if(response.ok)return {reviewed:true};
        assert.equal(response.code,phase===2?
          'CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED':
          'CODE_MODE_VISUAL_REVIEW_FRESH_CAPTURE_REQUIRED');
        return {blocked:true};
      }),
    });
    assert.equal((await host.execute({
      code:'return codemode.inspectSelectedVisualPair({project:"p0"});',
    })).value.reviewed,true);
    assert.equal((await host.execute({
      code:'return codemode.apply({project:"p0"});',
    })).value.blocked,true);
    assert.equal((await host.execute({
      code:'return codemode.apply({project:"p0"});',
    })).value.blocked,true);
    assert.equal(applies,1);
    assert.equal(approvals,1);
  }));

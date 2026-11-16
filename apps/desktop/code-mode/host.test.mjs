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

const HASH = 'a'.repeat(64);
const SUMMARY = { revision: 0, cubes: 1, bones: 1, textures: 0, animations: 0 };

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
            mutation:{revision:1,operation_count:1,changed_uuids:[]}};
        }
        return {status:'OK',sha256:HASH,summary:SUMMARY};
      },
      spawnImpl:()=>fakeGuest({method:'apply',args:{
        project:'p0',output:'candidate.bbmodel',
        operations:[{op:'paint_texture_pixel',texture_index:0,
          x:1,y:1,rgba:[70,80,90,255]}],
        correctionScope:declared,
      }}, response=>{
        assert.equal(response.ok,true);
        assert.equal(response.result.receipt.correction_scope,undefined);
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
      assert.deepEqual(called,['inspect']);
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
            }};
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
          issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
            observation:'Helmet needs reviewed material shading.'}],
          correctionScope:{
            textureUuid:'tier2-atlas',
            allowedRegions:[{from:[1,1],to:[5,5]}],
            preserveAlpha:true,
          },
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
        if(args[0]==='apply'){
          return {status:'OK',source_sha256:HASH,
            output_sha256:'b'.repeat(64),summary:{...SUMMARY,revision:1},
            mutation:{revision:1,operation_count:1,changed_uuids:[]}};
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
          assert.equal(response.result.evidence_binding.image_ingestion,'NOT_VERIFIED');
          assert.equal(JSON.stringify(response.result).includes('pngBytes'),false);
          return {reviewed:true};
        });
        const target=step===2?{from:[10,10],to:[12,12]}:
          {from:[2,2],to:[4,4]};
        return fakeGuest({method:'apply',args:{
          project:'p0',output:step===2?'bad.bbmodel':
            step===3?'weakened-alpha.bbmodel':
            step===4?'good.bbmodel':'repeat.bbmodel',
          operations:[{op:'paint_texture_pixel',texture_index:1,
            x:target.from[0],y:target.from[1],rgba:[80,100,120,255]}],
          correctionScope:{
            textureUuid:'tier2-atlas',allowedRegions:[target],
            preserveAlpha:step!==3,
          },
        }},response=>{
          if(step===2 || step===3){
            assert.equal(response.ok,false);
            assert.equal(response.code,'CODE_MODE_VISUAL_REVIEW_SCOPE_MISMATCH');
            return {refused:true};
          }
          if(step===5){
            assert.equal(response.ok,false);
            assert.equal(response.code,'CODE_MODE_VISUAL_REVIEW_FRESH_CAPTURE_REQUIRED');
            return {freshCaptureRequired:true};
          }
          assert.equal(response.ok,true);
          assert.equal(response.result.project,'p1');
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
    const permitted=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(permitted.value.edited,true);
    const repeated=await host.execute({code:'return codemode.apply({project:"p0"});'});
    assert.equal(repeated.value.freshCaptureRequired,true);
    assert.equal(received.length,1);
    assert.equal(approvals.length,1);
    assert.equal(approvals[0].correctionScope.textureUuid,'tier2-atlas');
    assert.deepEqual(calls,['inspect','inspect-visual-pair','apply','inspect']);
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

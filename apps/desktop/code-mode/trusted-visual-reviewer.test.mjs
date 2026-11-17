// SOURCE ONLY: authored regressions; CI/local/native tests remain on hold.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {PassThrough,Writable} from 'node:stream';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {readOperatorVisualManifest,createTrustedProgramReviewer}
  from './trusted-visual-reviewer.mjs';

function image(value) {
  const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),
    Buffer.from(value,'utf8')]);
  return {sha256:createHash('sha256').update(png).digest('hex'),pngBytes:png};
}
function selectedPair(){
  const views=['front','back','left','right','top','bottom'];
  const entries=views.map(viewId=>({viewId,
    reference:image('approved-'+viewId),
    capture:image('capture-'+viewId),
  }));
  return {sourceModelSha256:'a'.repeat(64),
    sourceFaceInventory:{
      scope:'trusted_saved_cube_face_inventory',
      source_model_sha256:'a'.repeat(64),total_cubes:1,complete:true,
      faces:[{cube_uuid:'cube-1',face:'north',
        texture_uuid:'atlas-1',source_status:'measured_nontransparent_pixels'}],
    },
    viewId:entries[0].viewId,
    reference:entries[0].reference,capture:entries[0].capture,
    supportingViews:entries.slice(1),
    requiredSixDirections:true};
}
async function fixture(work){
  const directory=await mkdtemp(join(tmpdir(),'ld-visual-review-source-'));
  try{
    const executable=join(directory,'trusted-reviewer.exe');
    await writeFile(executable,'operator controlled source test fixture\n');
    return await work(directory,executable);
  }finally{await rm(directory,{recursive:true,force:true});}
}
function stubReviewProcess(response){
  const child=new EventEmitter();
  child.stdout=new PassThrough();
  child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,_enc,done){
    try{
      const payload=JSON.parse(chunk.toString('utf8'));
      assert.equal(payload.schema_version,1);
      assert.equal(payload.required_six_directions,true);
      assert.equal(payload.views.length,6);
      assert.equal(payload.source_face_inventory.scope,
        'trusted_saved_cube_face_inventory');
      assert.equal(payload.source_face_inventory.faces[0].cube_uuid,'cube-1');
      for(const pair of payload.views){
        assert.equal(Buffer.from(pair.reference_png_base64,'base64')
          .subarray(0,8).toString('hex'),'89504e470d0a1a0a');
        assert.equal(Buffer.from(pair.capture_png_base64,'base64')
          .subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      }
      queueMicrotask(()=>{
        child.stdout.write(JSON.stringify(response(payload)));
        child.emit('close',0);
      });
      done();
    }catch(e){done(e);}
  }});
  child.kill=()=>true;
  return child;
}
test('operator-selected real bytes are carried via no-shell reviewer IPC with exact hash echo',()=>
  fixture(async (_dir,executable)=>{
    let invoked=0;
    const reviewer=await createTrustedProgramReviewer(executable,{
      timeoutMs:2000,
      spawnImpl:(path,args,options)=>{
        invoked++;
        assert.ok(path.endsWith('trusted-reviewer.exe'));
        assert.deepEqual(args,[]);
        assert.equal(options.shell,false);
        assert.deepEqual(options.stdio,['pipe','pipe','pipe']);
        assert.equal(options.env.OPENAI_API_KEY,undefined);
        return stubReviewProcess(input=>({
          schema_version:1,
          source_model_sha256:input.source_model_sha256,
          view_bindings:input.views.map(v=>({
            view_id:v.view_id,
            reference_sha256:v.reference_sha256,
            capture_sha256:v.capture_sha256,
          })),
          review:{
            decision:'ACCEPTED',issues:[],
            viewReviews:input.views.map(v=>({
              viewId:v.view_id,decision:'ACCEPTED',
              observation:'Observed pixel clusters and material forms in this actual image pair.',
            })),
          },
        }));
      },
    });
    assert.equal(reviewer.requiresSourceFaceInventory,true);
    const result=await reviewer(selectedPair());
    assert.equal(result.decision,'ACCEPTED');
    assert.equal(result.viewReviews.length,6);
    assert.equal(invoked,1);
  }));
test('wrong image receipt or forged model SHA is rejected, never accepted from text alone',()=>
  fixture(async (_dir,executable)=>{
    const reviewer=await createTrustedProgramReviewer(executable,{
      timeoutMs:2000,spawnImpl:()=>stubReviewProcess(input=>({
        schema_version:1,
        source_model_sha256:'b'.repeat(64),
        view_bindings:input.views.map(v=>({
          view_id:v.view_id,reference_sha256:v.reference_sha256,
          capture_sha256:v.capture_sha256,
        })),
        review:{decision:'ACCEPTED',issues:[]},
      })),
    });
    await assert.rejects(reviewer(selectedPair()),
      /VISUAL_REVIEWER_RESULT_BINDING_INVALID/);
  }));
test('tampered pre-bound image bytes refuse before reviewer launch',()=>
  fixture(async (_dir,executable)=>{
    let invoked=0;
    const reviewer=await createTrustedProgramReviewer(executable,{
      spawnImpl:()=>{invoked++;throw new Error('must not launch');},
    });
    const pair=selectedPair();
    pair.reference={sha256:'b'.repeat(64),pngBytes:pair.reference.pngBytes};
    await assert.rejects(reviewer(pair),/VISUAL_REVIEWER_IMAGE_SHA_MISMATCH/);
    assert.equal(invoked,0);
  }));
test('operator manifest requires a regular, bounded JSON file with approved fields',()=>
  fixture(async (directory,_executable)=>{
    const file=join(directory,'views.json');
    await writeFile(file,JSON.stringify({
      viewId:'front',captureModelSha256:'a'.repeat(64),
      referencePngPath:'/trusted/ref.png',capturePngPath:'/trusted/capture.png',
      requireSixDirections:false,
    }));
    const manifest=await readOperatorVisualManifest(file);
    assert.equal(manifest.viewId,'front');
    await writeFile(file,JSON.stringify({...manifest,guestCommand:'accept'}));
    await assert.rejects(readOperatorVisualManifest(file),
      /VISUAL_MANIFEST_FIELD_INVALID/);
  }));

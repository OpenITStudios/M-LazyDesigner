/**
 * Explicit operator-owned image reviewer bridge for the Rust Code Mode CLI.
 *
 * SOURCE_ONLY. This is a transport to a separately installed, trusted,
 * image-capable local reviewer. It is NOT a vision model or a claim that
 * the program correctly interpreted pixels. Never launch this from the
 * untrusted Deno guest, infer the executable from a project file, or
 * automatically upload images to a remote service.
 */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, readFile, realpath} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {MAX_FACES_PER_REVIEW,MAX_PAGED_FACE_REVIEWS}
  from './paged-face-review.mjs';

const MAX_MANIFEST_BYTES=12*1024;
const MAX_IMAGE_INPUT_BYTES=24*1024*1024;
const MAX_RESPONSE_BYTES=128*1024;
const TIMEOUT_MS=120000;
const SHA=/^[a-f0-9]{64}$/;

function absolute(path) {
  return typeof path==='string' && isAbsolute(path) && !path.includes('\0');
}
async function trustedRegular(path,label) {
  if (!absolute(path))throw new Error(label+'_ABSOLUTE_PATH_REQUIRED');
  const info=await lstat(path);
  if(!info.isFile() || info.isSymbolicLink()) {
    throw new Error(label+'_REGULAR_FILE_REQUIRED');
  }
  return realpath(path);
}

/** The host validates the manifest's file paths, PNGs and source SHA again.
 * No model-authored JavaScript or repository content can choose this path.
 */
export async function readOperatorVisualManifest(path) {
  const file=await trustedRegular(path,'VISUAL_MANIFEST');
  const info=await lstat(file);
  if(info.size<2 || info.size>MAX_MANIFEST_BYTES) {
    throw new Error('VISUAL_MANIFEST_SIZE_INVALID');
  }
  let content;
  try{content=JSON.parse(await readFile(file,'utf8'));}
  catch{throw new Error('VISUAL_MANIFEST_JSON_INVALID');}
  if(!content || typeof content!=='object' || Array.isArray(content)) {
    throw new Error('VISUAL_MANIFEST_SHAPE_INVALID');
  }
  const keys=['referencePngPath','capturePngPath','captureModelSha256',
    'viewId','supportingViews','requireSixDirections','reviewCriteria'];
  if(Object.keys(content).some(key=>!keys.includes(key))) {
    throw new Error('VISUAL_MANIFEST_FIELD_INVALID');
  }
  // All remaining image/source validation belongs to the existing
  // createCodeModeHost.preselectedVisualPair admission.
  return content;
}

/** Create one standalone no-shell reviewer subprocess per host review.
 * IPC: stdin JSON with actual PNG bytes encoded as base64. Stdout must
 * contain only a compact JSON response; stderr is never sent to the guest.
 * The operating-system identity of this command has broad local authority:
 * selecting and trusting the binary is explicitly the PC operator's job.
 */
export async function createTrustedProgramReviewer(executable, {
  spawnImpl=spawn, timeoutMs=TIMEOUT_MS,
}={}) {
  const program=await trustedRegular(executable,'VISUAL_REVIEWER');
  if(typeof spawnImpl!=='function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs<1000 ||
      timeoutMs>TIMEOUT_MS) {
    throw new Error('VISUAL_REVIEWER_ADAPTER_INVALID');
  }
  const reviewer=async function reviewVisualPair(pair) {
    const source=pair.sourceFaceInventory;
    const paged=source?.scope==='trusted_saved_cube_face_inventory_page';
    if(!source || ![
        'trusted_saved_cube_face_inventory',
        'trusted_saved_cube_face_inventory_page',
      ].includes(source.scope) ||
       source.source_model_sha256!==pair.sourceModelSha256 ||
       typeof source.complete!=='boolean' ||
       !Array.isArray(source.faces) ||
       source.faces.length>MAX_FACES_PER_REVIEW ||
       (paged && (!source.complete ||
         !Number.isSafeInteger(source.page_index) ||
         !Number.isSafeInteger(source.page_count) ||
         source.page_index<0 || source.page_count<2 ||
         source.page_count>MAX_PAGED_FACE_REVIEWS ||
         source.page_index>=source.page_count ||
         !Number.isSafeInteger(source.total_faces) ||
         source.total_faces<=MAX_FACES_PER_REVIEW ||
         source.total_faces>MAX_FACES_PER_REVIEW*MAX_PAGED_FACE_REVIEWS ||
         Math.ceil(source.total_faces/MAX_FACES_PER_REVIEW)!==source.page_count ||
         source.face_offset!==source.page_index*MAX_FACES_PER_REVIEW ||
         source.faces.length!==Math.min(MAX_FACES_PER_REVIEW,
           source.total_faces-source.face_offset)))) {
      throw new Error('VISUAL_REVIEWER_FACE_INVENTORY_MISSING');
    }
    const pageBinding=paged?Object.freeze({
      page_index:source.page_index,
      page_count:source.page_count,
      face_offset:source.face_offset,
      total_faces:source.total_faces,
      page_faces_sha256:createHash('sha256').update(
        JSON.stringify(source.faces)).digest('hex'),
    }):null;
    const views=[{viewId:pair.viewId,
      reference:pair.reference,capture:pair.capture},
      ...pair.supportingViews];
    if(views.length<1 || views.length>7 || !SHA.test(pair.sourceModelSha256) ||
        new Set(views.map(v=>v.viewId)).size!==views.length) {
      throw new Error('VISUAL_REVIEWER_PAIR_INVALID');
    }
    let bytes=0;
    const payload=views.map(view=>{
      if(!['front','back','left','right','top','bottom','three_quarter']
        .includes(view.viewId) ||
          ![view.reference,view.capture].every(entry=>
            entry && SHA.test(entry.sha256) &&
            Buffer.isBuffer(entry.pngBytes) &&
            entry.pngBytes.length>=8 &&
            entry.pngBytes.subarray(0,8).equals(
              Buffer.from('89504e470d0a1a0a','hex')))) {
        throw new Error('VISUAL_REVIEWER_IMAGE_INVALID');
      }
      if ([view.reference,view.capture].some(entry=>
        createHash('sha256').update(entry.pngBytes).digest('hex')!==entry.sha256)) {
        throw new Error('VISUAL_REVIEWER_IMAGE_SHA_MISMATCH');
      }
      bytes+=view.reference.pngBytes.length+view.capture.pngBytes.length;
      // Reject before creating potentially huge base64 strings.
      if(bytes>MAX_IMAGE_INPUT_BYTES){
        throw new Error('VISUAL_REVIEWER_IMAGE_BUDGET_EXCEEDED');
      }
      return {
        view_id:view.viewId,
        reference_sha256:view.reference.sha256,
        capture_sha256:view.capture.sha256,
        reference_png_base64:view.reference.pngBytes.toString('base64'),
        capture_png_base64:view.capture.pngBytes.toString('base64'),
      };
    });
    if(bytes>MAX_IMAGE_INPUT_BYTES) {
      throw new Error('VISUAL_REVIEWER_IMAGE_BUDGET_EXCEEDED');
    }
    const request=JSON.stringify({
      schema_version:1,source_model_sha256:pair.sourceModelSha256,
      required_six_directions:pair.requiredSixDirections===true,
      source_face_inventory:source,
      ...(pageBinding?{face_page_binding:pageBinding}:{}),
      // Canonical operator-selected decisions, never inferred from the
      // model prompt or reviewer text. The image reviewer must answer them
      // individually; the trusted host validates every result.
      review_criteria:pair.reviewCriteria??[],
      views:payload,
    });
    const response=await new Promise((resolve,reject)=>{
      let settled=false;
      const output=[];
      let outputBytes=0;
      const fail=code=>{
        if(settled)return;
        settled=true;
        clearTimeout(timeout);
        try{child.kill();}catch{}
        reject(new Error(code));
      };
      const safeEnv={};
      if(typeof process.env.PATH==='string')safeEnv.PATH=process.env.PATH;
      if(typeof process.env.SystemRoot==='string'){
        safeEnv.SystemRoot=process.env.SystemRoot;
      }
      let child;
      try{
        child=spawnImpl(program,[],{
          shell:false,windowsHide:true,
          stdio:['pipe','pipe','pipe'],env:safeEnv,
        });
      }catch{
        reject(new Error('VISUAL_REVIEWER_SPAWN_FAILED'));
        return;
      }
      const timeout=setTimeout(()=>fail('VISUAL_REVIEWER_TIMEOUT'),timeoutMs);
      child.on('error',()=>fail('VISUAL_REVIEWER_SPAWN_FAILED'));
      child.stdout.on('data',chunk=>{
        const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        outputBytes+=bytes.length;
        if(outputBytes>MAX_RESPONSE_BYTES){
          fail('VISUAL_REVIEWER_OUTPUT_TOO_LARGE');
          return;
        }
        output.push(bytes);
      });
      child.stderr?.on('data',()=>{}); // Do not leak image/private prompts.
      child.stdin.on('error',()=>{}); // EPIPE when reviewer exits early.
      child.on('close',code=>{
        if(settled)return;
        settled=true;clearTimeout(timeout);
        if(code!==0){
          reject(new Error('VISUAL_REVIEWER_PROCESS_FAILED'));return;
        }
        try{resolve(JSON.parse(Buffer.concat(output).toString('utf8')));}
        catch{reject(new Error('VISUAL_REVIEWER_RESULT_INVALID'));}
      });
      child.stdin.end(request+'\n','utf8');
    });
    if(!response || typeof response!=='object' ||
        Array.isArray(response) ||
        Object.keys(response).some(key=>![
          'schema_version','source_model_sha256','view_bindings','review',
          'face_page_binding',
        ].includes(key)) ||
        response.schema_version!==1 ||
        response.source_model_sha256!==pair.sourceModelSha256 ||
        !Array.isArray(response.view_bindings) ||
        response.view_bindings.length!==views.length ||
        !response.review ||
        typeof response.review!=='object' ||
        Array.isArray(response.review)) {
      throw new Error('VISUAL_REVIEWER_RESULT_BINDING_INVALID');
    }
    if(pageBinding){
      const echo=response.face_page_binding;
      if(!echo || typeof echo!=='object' || Array.isArray(echo) ||
         Object.keys(echo).length!==Object.keys(pageBinding).length ||
         Object.entries(pageBinding).some(([key,value])=>echo[key]!==value)){
        throw new Error('VISUAL_REVIEWER_FACE_PAGE_BINDING_INVALID');
      }
    } else if(response.face_page_binding!==undefined){
      throw new Error('VISUAL_REVIEWER_FACE_PAGE_BINDING_INVALID');
    }
    for(const selected of payload) {
      const matches=response.view_bindings.filter(item=>
        item?.view_id===selected.view_id &&
        item.reference_sha256===selected.reference_sha256 &&
        item.capture_sha256===selected.capture_sha256);
      if(matches.length!==1) {
        throw new Error('VISUAL_REVIEWER_RESULT_BINDING_INVALID');
      }
    }
    // Receipt hashes are source-identity checks, not pixel-ingestion proof.
    // Existing host.normalizedVisualReview owns the verdict schema.
    return response.review;
  };
  // Only the trusted host can choose this callback; the untrusted guest
  // cannot request access to the model face inventory or raw images.
  Object.defineProperty(reviewer,'requiresSourceFaceInventory',{value:true});
  // The trusted host, not the guest, chooses when to submit a sequence of
  // independently reviewed, hash-bound <=256-face pages. An executable that
  // does not echo the page binding fails closed on oversized models.
  Object.defineProperty(reviewer,'supportsPagedSourceFaceReview',{value:true});
  return reviewer;
}

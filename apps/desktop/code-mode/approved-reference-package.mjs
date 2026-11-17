/**
 * Read-only bridge from the canonical Reference/Workspace source into
 * operator-selected Rust Code Mode image review. No new approval registry,
 * automatic image interpretation, or invented Cube/atlas correspondence.
 * SOURCE_ONLY: Node, native, and visual tests remain on hold.
 */
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {lstatSync,readFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';

const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const MAX_REFERENCE_BYTES=1024*1024;
const MAX_IMAGES=32;
const MAX_PARTS=256;
const VIEWS=new Set(['front','back','left','right','top','bottom']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error(code);};
const plain=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;
const goodText=value=>typeof value==='string' && value.trim()===value &&
  value.length>=20 && value.length<=240 && !/[\x00-\x1f\x7f]/.test(value);
const validBox=value=>Array.isArray(value) && value.length===4 &&
  value.every(n=>typeof n==='number' && Number.isFinite(n) &&
    n>=0 && n<=1) && value[0]<value[2] && value[1]<value[3];

async function canonicalReference(path){
  if(typeof path!=='string' || !isAbsolute(path) ||
     basename(path).toLowerCase()!=='reference.json' ||
     path.includes('\0'))fail('CODE_MODE_REFERENCE_PATH_INVALID');
  const entry=await lstat(path).catch(()=>null);
  if(!entry?.isFile() || entry.isSymbolicLink() ||
     entry.size<2 || entry.size>MAX_REFERENCE_BYTES) {
    fail('CODE_MODE_REFERENCE_FILE_INVALID');
  }
  const file=await realpath(path);
  const bytes=await readFile(file);
  if(bytes.length<2 || bytes.length>MAX_REFERENCE_BYTES ||
     bytes.length!==entry.size)fail('CODE_MODE_REFERENCE_FILE_INVALID');
  return {path:file,bytes,sha256:hash(bytes)};
}
async function packageImagePath(root,file){
  if(typeof file!=='string' || file.includes('\0') ||
     file.includes('\\') || file.includes('?') || file.includes('#') ||
     isAbsolute(file) || /^[A-Za-z]:/.test(file)) {
    fail('CODE_MODE_REFERENCE_IMAGE_PATH_INVALID');
  }
  const pieces=file.split('/');
  if(pieces.some(part=>!part || part==='.' || part==='..')){
    fail('CODE_MODE_REFERENCE_IMAGE_PATH_INVALID');
  }
  let path=root;
  for(const part of pieces){
    path=join(path,part);
    const stat=await lstat(path).catch(()=>null);
    if(!stat || stat.isSymbolicLink()) {
      fail('CODE_MODE_REFERENCE_IMAGE_PATH_INVALID');
    }
  }
  const resolved=resolve(root,...pieces);
  const delta=relative(root,resolved);
  if(!delta || delta==='..' || delta.startsWith('../') ||
     delta.startsWith('..\\')){
    fail('CODE_MODE_REFERENCE_IMAGE_PATH_INVALID');
  }
  const stat=await lstat(resolved);
  if(!stat.isFile()) fail('CODE_MODE_REFERENCE_IMAGE_PATH_INVALID');
  return realpath(resolved);
}

/** Only the two canonical source locations are considered, never a search
 * through unrelated projects or arbitrary source-controlled directories.
 * Explicit operator --reference-package may override this selection.
 */
export async function discoverWorkspaceReferencePackage(modelPath){
  if(modelPath===undefined)return null;
  if(typeof modelPath!=='string' || !isAbsolute(modelPath)) {
    fail('CODE_MODE_REFERENCE_MODEL_PATH_INVALID');
  }
  const root=dirname(await realpath(modelPath));
  const found=[];
  for(const path of [
    join(root,'reference','REFERENCE.json'),
    join(root,'references','REFERENCE.json'),
    join(root,'REFERENCE.json'),
  ]){
    const stat=await lstat(path).catch(error=>{
      if(error?.code==='ENOENT')return null;
      throw error;
    });
    if(!stat)continue;
    if(!stat.isFile() || stat.isSymbolicLink()){
      fail('CODE_MODE_REFERENCE_FILE_INVALID');
    }
    found.push(path);
  }
  if(found.length>1)fail('CODE_MODE_REFERENCE_AMBIGUOUS');
  return found[0]??null;
}

/**
 * Source-only approval claim is *declared* by REFERENCE.json, not by the
 * reviewer or model. Only approved, TEXTURE-relevant, explicitly oriented
 * source images already selected in the operator visual manifest can bind.
 * Image source boxes are NEVER physical texture atlas rectangles.
 */
export async function bindApprovedWorkspaceReference(
  referencePath,modelPath,selectedViews,manualCriteria,
){
  const source=await canonicalReference(referencePath);
  const root=dirname(source.path);
  const workspaceRoot=['reference','references'].includes(
    basename(root).toLowerCase())?dirname(root):root;
  if(dirname(await realpath(modelPath))!==workspaceRoot){
    fail('CODE_MODE_REFERENCE_WORKSPACE_MODEL_MISMATCH');
  }
  let data;
  try{data=JSON.parse(source.bytes.toString('utf8'));}
  catch{fail('CODE_MODE_REFERENCE_JSON_INVALID');}
  if(!plain(data) || data.schema!=='lazydesigner-reference-v1' ||
     !plain(data.asset) ||
     (data.asset.kind!==undefined && data.asset.kind!=='MODEL') ||
     data.approval?.visual_authority!=='APPROVED' ||
     !Array.isArray(data.images) || data.images.length<1 ||
     data.images.length>MAX_IMAGES || !Array.isArray(data.parts) ||
     data.parts.length>MAX_PARTS ||
     (data.unknowns?.blocking!==undefined &&
       (!Array.isArray(data.unknowns.blocking) ||
        data.unknowns.blocking.length>0))) {
    fail('CODE_MODE_REFERENCE_NOT_APPROVED_OR_INVALID');
  }
  const partIds=new Set();
  const parts=new Map();
  for(const part of data.parts){
    if(!plain(part) || typeof part.id!=='string' ||
       partIds.has(part.id))fail('CODE_MODE_REFERENCE_PARTS_INVALID');
    partIds.add(part.id);parts.set(part.id,part);
  }
  if(!Array.isArray(selectedViews) || selectedViews.length<1 ||
     selectedViews.length>7 ||
     (manualCriteria!==undefined && !Array.isArray(manualCriteria))) {
    fail('CODE_MODE_REFERENCE_REVIEW_SELECTION_INVALID');
  }
  const candidates=[];
  const imageIds=new Set();
  for(const image of data.images){
    if(!plain(image) || typeof image.id!=='string' ||
       typeof image.file!=='string' || imageIds.has(image.id)) {
      fail('CODE_MODE_REFERENCE_IMAGE_INVALID');
    }
    imageIds.add(image.id);
    const file=await packageImagePath(root,image.file);
    candidates.push({...image,resolved:file});
  }
  const matched=[];
  for(const view of selectedViews){
    if(!VIEWS.has(view.viewId) && view.viewId!=='three_quarter'){
      fail('CODE_MODE_REFERENCE_VIEW_INVALID');
    }
    const matches=candidates.filter(img=>img.resolved===view.reference.path);
    if(matches.length!==1 || matches[0].status!=='APPROVED' ||
       !Array.isArray(matches[0].used_by) ||
       !matches[0].used_by.includes('TEXTURE') ||
       matches[0].view!==view.viewId ||
       !SHA.test(view.reference.sha256)){
      fail('CODE_MODE_REFERENCE_IMAGE_BINDING_INVALID');
    }
    matched.push({...matches[0],viewId:view.viewId,
      sha256:view.reference.sha256});
  }
  if(manualCriteria?.some(item=>!plain(item) || !parts.has(item.partId) ||
     !matched.some(image=>image.viewId===item.viewId) ||
     (item.sourceRegion!==undefined &&
      (!plain(item.sourceRegion) || !matched.some(image=>
       image.viewId===item.viewId &&
       image.regions?.some(region=>region.id===item.sourceRegion.id &&
         region.part_id===item.partId &&
         Array.isArray(region.box_uv) &&
         region.box_uv.length===4 &&
         region.box_uv.every((n,i)=>n===item.sourceRegion.boxUv?.[i]))
     ))))) {
    fail('CODE_MODE_REFERENCE_CRITERION_PART_UNDECLARED');
  }
  const explicit=manualCriteria??[];
  const auto=[];
  const existing=new Set(explicit.map(item=>item.id));
  const explicitPreserves=new Set(explicit.filter(item=>item.kind==='PRESERVE')
    .map(item=>JSON.stringify([item.partId,item.viewId])));
  const correctingParts=new Set(explicit.filter(item=>item.kind==='CORRECT')
    .map(item=>JSON.stringify([item.partId,item.viewId])));
  for(const image of matched){
    const regions=image.regions??[];
    if(!Array.isArray(regions) || regions.length>16) {
      fail('CODE_MODE_REFERENCE_REGIONS_INVALID');
    }
    for(const region of regions){
      if(!plain(region))fail('CODE_MODE_REFERENCE_REGIONS_INVALID');
      if(region.evidence_role!=='SURFACE_DETAIL' ||
         region.visibility!=='DIRECT')continue;
      const part=parts.get(region.part_id);
      if(!part || !ID.test(region.part_id) ||
         !validBox(region.box_uv) ||
         !['SUPPORTED'].includes(part.evidence) ||
         !goodText(part.description)) {
        fail('CODE_MODE_REFERENCE_REGION_UNSUPPORTED');
      }
      // A currently rejected target must be CORRECTED to the approved
      // reference, not falsely declared already-preserved. Preserve only
      // other approved surface details during that correction.
      const partView=JSON.stringify([region.part_id,image.viewId]);
      if(explicitPreserves.has(partView) || correctingParts.has(partView))
        continue;
      const id='preserve-'+String(region.id).toLowerCase();
      if(!ID.test(id) || existing.has(id)){
        fail('CODE_MODE_REFERENCE_REGION_ID_COLLISION');
      }
      existing.add(id);
      auto.push({
        id,partId:region.part_id,kind:'PRESERVE',
        requirement:part.description,viewId:image.viewId,
        referencePngSha256:image.sha256,
        sourceRegion:{id:region.id,boxUv:[...region.box_uv]},
      });
    }
  }
  const combined=[...explicit,...auto];
  if(combined.length<1 || combined.length>12){
    fail('CODE_MODE_REFERENCE_DECISIONS_MISSING_OR_EXCEED_LIMIT');
  }
  return Object.freeze({
    sourcePath:source.path,
    fingerprintSha256:source.sha256,
    workspaceModelBound:true,
    matchedImageCount:matched.length,
    automaticallyBoundPreserveCount:auto.length,
    criteria:Object.freeze(combined),
    source:'EXISTING_WORKSPACE_REFERENCE_JSON_DECLARATION',
    visual_verdict:'UNVERIFIED',
  });
}

/** Synchronous final lease check immediately before the Rust process
 * launch, including the operator-approval gap. No async/guest I/O grant.
 */
export function referencePackageLeaseValid(binding){
  try{
    const stat=lstatSync(binding.sourcePath);
    if(!stat.isFile() || stat.isSymbolicLink() ||
       stat.size<2 || stat.size>MAX_REFERENCE_BYTES)return false;
    const content=readFileSync(binding.sourcePath);
    return content.length===stat.size &&
      hash(content)===binding.fingerprintSha256;
  }catch{return false;}
}

export async function assertApprovedWorkspaceReferenceFresh(binding){
  const current=await canonicalReference(binding.sourcePath);
  if(current.path!==binding.sourcePath ||
     current.sha256!==binding.fingerprintSha256){
    fail('CODE_MODE_REFERENCE_PACKAGE_CHANGED');
  }
}

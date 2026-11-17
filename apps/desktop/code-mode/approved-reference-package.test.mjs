// SOURCE ONLY: tests authored but not executed while native/localtest holds.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {bindApprovedWorkspaceReference,assertApprovedWorkspaceReferenceFresh,
  discoverWorkspaceReferencePackage,referencePackageLeaseValid}
  from './approved-reference-package.mjs';
import {boundReviewCriteria} from './review-criteria.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceImage=Buffer.from('89504e470d0a1a0a00000000','hex');
async function fixture(work){
  const root=await mkdtemp(join(tmpdir(),'ld-reference-binding-'));
  try{
    const model=join(root,'source.bbmodel');
    const folder=join(root,'reference');
    await mkdir(folder);
    await writeFile(model,'{}');
    const image=join(folder,'approved-front.png');
    await writeFile(image,sourceImage);
    const imageSha=digest(sourceImage);
    const packagePath=join(folder,'REFERENCE.json');
    const pack={
      schema:'lazydesigner-reference-v1',
      asset:{name:'Pillager',kind:'MODEL'},
      approval:{visual_authority:'APPROVED'},
      unknowns:{blocking:[]},
      parts:[
        {id:'tier1-shield',evidence:'SUPPORTED',
          description:'Keep the approved Tier 1 shield outline and neutral metal accents.'},
        {id:'tier2-helmet',evidence:'SUPPORTED',
          description:'The Tier 2 helmet uses deliberate metal bevel and shadow masses.'},
      ],
      images:[{id:'front',file:'approved-front.png',view:'front',
        used_by:['GEOMETRY','TEXTURE'],status:'APPROVED',
        regions:[
          {id:'shield_marks',part_id:'tier1-shield',evidence_role:'SURFACE_DETAIL',
            visibility:'DIRECT',box_uv:[0.1,0.1,0.3,0.4]},
          {id:'helmet_face',part_id:'tier2-helmet',evidence_role:'SURFACE_DETAIL',
            visibility:'DIRECT',box_uv:[0.4,0.1,0.7,0.5]},
        ]}],
    };
    await writeFile(packagePath,JSON.stringify(pack));
    const views=[{viewId:'front',
      reference:{path:image,sha256:imageSha}}];
    const correction=[{id:'fix-helmet',partId:'tier2-helmet',
      kind:'CORRECT',viewId:'front',
      requirement:'Replace the flat helmet band with form-following metal shading.',
      referencePngSha256:imageSha,textureUuid:'tier2-atlas',
      allowedRegions:[{from:[4,4],to:[8,8]}]}];
    return await work({root,model,folder,image,packagePath,pack,
      views,correction});
  }finally{await rm(root,{recursive:true,force:true});}
}

test('workspace discovery is limited to the active model and refuses ambiguity',()=>
  fixture(async ({root,model,packagePath})=>{
    assert.equal(await discoverWorkspaceReferencePackage(model),packagePath);
    await writeFile(join(root,'REFERENCE.json'),'{}');
    await assert.rejects(discoverWorkspaceReferencePackage(model),
      /CODE_MODE_REFERENCE_AMBIGUOUS/);
  }));

test('source-approved texture regions automatically bind preserved parts without atlas inference',()=>
  fixture(async ({packagePath,model,views,correction})=>{
    const binding=await bindApprovedWorkspaceReference(
      packagePath,model,views,correction);
    assert.equal(binding.matchedImageCount,1);
    assert.equal(binding.automaticallyBoundPreserveCount,1);
    assert.equal(binding.criteria.length,2);
    const shield=binding.criteria.find(x=>x.partId==='tier1-shield');
    assert.equal(shield.kind,'PRESERVE');
    assert.equal(shield.sourceRegion.id,'shield_marks');
    assert.deepEqual(shield.sourceRegion.boxUv,[0.1,0.1,0.3,0.4]);
    assert.equal(shield.textureUuid,undefined); // NOT a native atlas mapping
    assert.equal(binding.criteria.find(x=>x.kind==='CORRECT').id,'fix-helmet');
    assert.ok(boundReviewCriteria(binding.criteria,views));
    await assertApprovedWorkspaceReferenceFresh(binding);
    assert.equal(referencePackageLeaseValid(binding),true);
  }));

test('an already-approved reference can require a PRESERVE-only visual review without authorizing Paint',()=>
  fixture(async ({packagePath,model,views})=>{
    const binding=await bindApprovedWorkspaceReference(packagePath,model,views);
    assert.equal(binding.automaticallyBoundPreserveCount,2);
    assert.ok(binding.criteria.every(x=>x.kind==='PRESERVE'));
    assert.equal(boundReviewCriteria(binding.criteria,views).length,2);
  }));

test('changed approved package invalidates reviewer and cannot reuse prior image claims',()=>
  fixture(async ({packagePath,model,views,correction})=>{
    const binding=await bindApprovedWorkspaceReference(
      packagePath,model,views,correction);
    const text=await readFile(packagePath,'utf8');
    await writeFile(packagePath,text.replace('Tier 1 shield','Tier 1 barrier'));
    await assert.rejects(assertApprovedWorkspaceReferenceFresh(binding),
      /CODE_MODE_REFERENCE_PACKAGE_CHANGED/);
    // Synchronous approval-to-Rust launch lease also refuses the change.
    assert.equal(referencePackageLeaseValid(binding),false);
  }));

test('unapproved, wrong-view and unbound model packages fail before reviewer',()=>
  fixture(async ({root,packagePath,pack,model,views,correction})=>{
    for(const change of [
      p=>{p.approval.visual_authority='PENDING';},
      p=>{p.images[0].status='DRAFT';},
      p=>{p.images[0].used_by=['GEOMETRY'];},
      p=>{p.images[0].view='back';},
      p=>{p.images[0].file='../outside.png';},
    ]){
      const revised=structuredClone(pack);
      change(revised);
      await writeFile(packagePath,JSON.stringify(revised));
      await assert.rejects(bindApprovedWorkspaceReference(
        packagePath,model,views,correction),
        /CODE_MODE_REFERENCE_/);
    }
    await writeFile(packagePath,JSON.stringify(pack));
    const other=join(root,'elsewhere');
    await mkdir(other);
    const alternate=join(other,'other.bbmodel');
    await writeFile(alternate,'{}');
    await assert.rejects(bindApprovedWorkspaceReference(
      packagePath,alternate,views,correction),
      /CODE_MODE_REFERENCE_WORKSPACE_MODEL_MISMATCH/);
  }));

test('operator may not invent a source-region box or change the declared part',()=>
  fixture(async ({packagePath,model,views,correction})=>{
    for(const bogus of [
      {...correction[0],partId:'unknown-part'},
      {...correction[0],sourceRegion:{id:'helmet_face',
        boxUv:[0.1,0.1,0.3,0.4]}},
    ]){
      await assert.rejects(bindApprovedWorkspaceReference(
        packagePath,model,views,[bogus]),
        /CODE_MODE_REFERENCE_CRITERION_PART_UNDECLARED/);
    }
  }));

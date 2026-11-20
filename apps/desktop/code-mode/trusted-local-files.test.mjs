// SOURCE_AUTHORED_NOT_RUN: local file boundary negative/positive cases.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SHA256,requireAbsolute,regularFile,outputName,checkFreshSibling}
  from './trusted-local-files.mjs';

test('trusted file admission forbids unsafe output names and relative input',()=>{
  assert.equal(SHA256.test('a'.repeat(64)),true);
  assert.equal(outputName('candidate.bbmodel','.bbmodel'),'candidate.bbmodel');
  for(const filename of ['../escape.bbmodel','CON.bbmodel',
      '.hidden.bbmodel','double..bbmodel','candidate.png']){
    assert.throws(()=>outputName(filename,'.bbmodel'),
      /CODE_MODE_OUTPUT_NAME_INVALID/);
  }
  assert.throws(()=>requireAbsolute('relative.bbmodel','source'),
    /source must be an absolute path/);
});
test('fresh output admission refuses overwrite without changing the original',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'ld-output-'));
  try{
    const source=join(folder,'source.bbmodel');
    const target=join(folder,'next.bbmodel');
    await writeFile(source,'unchanged');
    assert.equal(await regularFile(source,'source'),source);
    await checkFreshSibling(target,folder);
    await writeFile(target,'already exists');
    await assert.rejects(checkFreshSibling(target,folder),
      /CODE_MODE_OUTPUT_ALREADY_EXISTS/);
  }finally{await rm(folder,{recursive:true,force:true})}
});

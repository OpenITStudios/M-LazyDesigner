// TEST_AUTHORED_NOT_RUN: checks one exhaustive semantic owner per Rust operation.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
const root='../src-tauri/src/authoring/';
const groups=['hierarchy_edits','geometry_edits','animation_edits','texture_edits','uv_edits'];
test('every Rust EditOperation has exactly one typed module and one parent route',async()=>{
  const [types,dispatcher,...domains]=await Promise.all([
    read(root+'mod.rs'),read(root+'edit_operations.rs'),
    ...groups.map(p=>read(root+'edit_operations/'+p+'.rs')),
  ]);
  const enumSource=types.split('pub enum EditOperation {')[1]?.split('\n}')[0];
  assert.ok(enumSource,'canonical enum exists');
  const variants=[...enumSource.matchAll(/^ {4}([A-Z]\w+) \{/gm)].map(x=>x[1]);
  const branches=domains.flatMap(source=>[...source.matchAll(/^ {8}EditOperation::(\w+)/gm)].map(x=>x[1]));
  const routes=[...dispatcher.matchAll(/EditOperation::(\w+) \{ \.\. \}/g)].map(x=>x[1]);
  assert.equal(variants.length,64);
  assert.deepEqual([...routes].sort(),[...variants].sort());
  assert.deepEqual([...branches].sort(),[...variants].sort());
  assert.equal(new Set(branches).size,variants.length);
  assert.equal(new Set(routes).size,variants.length);
  assert.match(dispatcher,/fn translate_cube_in_place/);
  assert.match(dispatcher,/=> animation_edits::apply\(doc, op\)/);
  assert.match(dispatcher,/=> texture_edits::apply\(doc, op\)/);
  for(const source of domains){
    assert.match(source,/EDIT_OPERATION_DOMAIN_MISMATCH/);
    assert.doesNotMatch(source,/pub struct EditorSession|fn undo\(|fn redo\(|fn export_bbmodel/);
  }
});

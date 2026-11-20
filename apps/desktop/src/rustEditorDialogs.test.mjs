// SOURCE_AUTHORED_NOT_RUN: static UI ownership guard, not visual PASS.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
test('dialog presentation retains parent-native restore and pairing authority',async()=>{
  const [page,recovery,pair]=await Promise.all([
    read('./RustEditorPage.svelte'),read('./RustRecoveryDialog.svelte'),
    read('./RustLiveReadPairingDialog.svelte'),
  ]);
  assert.match(page,/bind:selectedId=\{recoverySelectedId\}/);
  assert.match(page,/bind:discardApproved=\{recoveryDiscardApproved\}/);
  assert.match(page,/bind:revealSecret=\{showLiveSecret\}/);
  assert.match(page,/function restoreRecovery\(/);
  assert.match(page,/function stopLiveRead\(/);
  // Keep the original focus/modal DOM sequence after component extraction.
  const order=['{#if newDialog}','{#if confirmDiscard}',
    '{#if recoveryDialog}','{#if livePairingDialog && livePairing}'];
  assert.ok(order.every((key,i)=>i===0 ||
    page.indexOf(order[i-1]) < page.indexOf(key)));
  assert.match(recovery,/Recover as unsaved/);
  assert.match(pair,/Read-only Code Mode pairing/);
  // Parent controls mount/unmount. Child components must never import
  // missing parent state or leave a dangling Svelte conditional.
  assert.doesNotMatch(recovery,/{#if recoveryDialog}/);
  assert.doesNotMatch(pair,/{#if livePairingDialog/);
  assert.match(recovery,/aria-labelledby="recovery-title"/);
  assert.match(pair,/aria-labelledby="live-read-title"/);
  for(const view of [recovery,pair]){
    assert.doesNotMatch(view,/\binvoke\s*\(/);
    assert.doesNotMatch(view,/createCodeModeHost|rust_editor_apply/);
  }
});

// SOURCE-ONLY regression. Do not run while the repository test hold applies.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const cli=fileURLToPath(new URL('./run.mjs',import.meta.url));
test('operator material master selection cannot bind to an empty new-model output',()=>{
  // Argument validation must fail before script-file, Deno, Rust or TTY access.
  const result=spawnSync(process.execPath,[cli,
    '--rust','/trusted/rust','--deno','/trusted/deno',
    '--code','/unavailable/code.mjs','--output-dir','/unavailable/directory',
    '--approved-material-reference-uuid','tier-1-master',
  ],{encoding:'utf8'});
  assert.equal(result.status,2);
  assert.match(result.stderr,
    /CODE_MODE_MATERIAL_REFERENCE_REQUIRES_EXISTING_MODEL/);
});

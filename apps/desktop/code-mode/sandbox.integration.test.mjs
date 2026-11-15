// HELD: real Deno isolation regression source. DO NOT execute in
// ChatGPT/GitHub or through hosted CI. Requires an explicitly authorized
// later PC-local validation phase and an authentic Deno binary path.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { test } from 'node:test';
import { createCodeModeHost } from './host.mjs';

const deno = process.env.LAZYDESIGNER_DENO_BINARY;

test('Deno Code Mode guest stays permission-denied and cannot forge authorizer', {
  skip: !deno || !isAbsolute(deno)
    ? 'Requires verified PC-local Deno path and released test hold'
    : false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-sandbox-proof-'));
  try {
    const input = join(directory, 'source.bbmodel');
    await writeFile(input, '{}', 'utf8');
    const fakeSha = 'a'.repeat(64);
    const calls = [];
    const host = await createCodeModeHost({
      rustBinary: join(directory, 'only-a-mocked-rust-cli'),
      denoBinary: deno,
      input,
      runner: async (argv) => {
        calls.push(argv[0]);
        return { status: 'OK', sha256: fakeSha, summary: {
          revision: 0, cubes: 0, bones: 0, textures: 0, animations: 0,
        } };
      },
      // No approve callback: even a Deno sandbox JS program may not mutate.
    });
    const report = await host.execute({ code: [
      'const kinds = ["read","write","net","env","run","ffi"];',
      'const permissions = {};',
      'for (const kind of kinds) permissions[kind] =',
      '  (await Deno.permissions.query({name:kind})).state;',
      'let readDenial = "UNKNOWN";',
      'try { await Deno.readTextFile("blocked.txt");',
      '  readDenial = "UNEXPECTED_ALLOWED";',
      '} catch (error) { readDenial = error.name; }',
      'let mutation = "UNKNOWN";',
      'try { await codemode.apply({project:"p0",output:"changed.bbmodel",',
      '  operations:[{op:"remove_cube",uuid:"c"}]});',
      '  mutation = "UNEXPECTED_ALLOWED";',
      '} catch (error) { mutation = String(error.message); }',
      'return {permissions,readDenial,mutation};',
    ].join('\n') });
    assert.equal(report.status, 'OK');
    assert.equal(report.value.mutation, 'CODE_MODE_MUTATION_NOT_APPROVED');
    for (const state of Object.values(report.value.permissions)) {
      assert.notEqual(state, 'granted');
    }
    assert.notEqual(report.value.readDenial, 'UNEXPECTED_ALLOWED');
    assert.deepEqual(calls, ['inspect']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

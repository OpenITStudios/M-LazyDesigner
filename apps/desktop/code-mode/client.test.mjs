// Source-authored only. Repository tests remain ON_HOLD / NOT_EXECUTED.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createRustCodeModeClient, openRustCodeModeProject } from './client.mjs';

const BIN = '/abs/lazydesigner-authoring';
const SHA = 'a'.repeat(64);

test('Code Mode routes focused read directly without model echo', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      return { status: 'OK', sha256: SHA, summary: { revision: 0 }, element: { uuid: 'cube-1', kind: 'cube' } };
    },
  });
  const result = await client.inspect({ input: '/abs/model.bbmodel', uuid: 'cube-1' });
  assert.deepEqual(calls, [['inspect', '--input', '/abs/model.bbmodel', '--uuid', 'cube-1']]);
  assert.equal(result.element.kind, 'cube');
});

test('Code Mode delegates a single bounded atomic Rust transaction', async () => {
  let plan = null;
  const approvals = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: async (request) => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async (argv) => {
      assert.equal(argv[0], 'apply');
      assert.equal(argv[argv.indexOf('--expected-sha256') + 1], SHA);
      plan = JSON.parse(await readFile(argv[argv.indexOf('--plan') + 1], 'utf8'));
      return { status: 'OK', mutation: { revision: 1, operation_count: 1, changed_uuids: ['cube-1'] } };
    },
  });
  const receipt = await client.apply({
    input: '/abs/model.bbmodel', output: '/abs/model-next.bbmodel', expectedSha256: SHA,
    operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }],
  });
  assert.deepEqual(plan, { expected_revision: 0, operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }] });
  assert.equal(receipt.mutation.revision, 1);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].operationCount, 1);
  assert.deepEqual(approvals[0].operationKinds, ['translate_cube']);
  assert.match(approvals[0].planSha256, /^[a-f0-9]{64}$/);
});

test('Code Mode catalog and metadata inspection remain read-only and bounded', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      return { status: 'OK', sha256: SHA, summary: { revision: 0 }, catalog: { entries: [], next_offset: null }, asset: { source_kind: 'embedded_png' } };
    },
  });
  await client.catalog({ input: '/abs/model.bbmodel', kind: 'cubes', limit: 2, offset: 1 });
  await client.inspectTexture({ input: '/abs/model.bbmodel', index: 0 });
  await client.inspectAnimation({ input: '/abs/model.bbmodel', uuid: 'an-existing-animation-id' });
  assert.deepEqual(calls[0], ['inspect', '--input', '/abs/model.bbmodel', '--list', 'cubes', '--offset', '1', '--limit', '2']);
  assert.deepEqual(calls[1], ['inspect', '--input', '/abs/model.bbmodel', '--texture-index', '0']);
  assert.deepEqual(calls[2], ['inspect', '--input', '/abs/model.bbmodel', '--animation-uuid', 'an-existing-animation-id']);
  await assert.rejects(client.catalog({ input: '/abs/model.bbmodel', kind: 'textures', limit: 65 }));
  assert.equal(calls.length, 3);
});

test('invalid SHA, nonfinite fields and unbounded batches fail before invoking CLI', async () => {
  let count = 0;
  const client = createRustCodeModeClient({ binary: BIN, runner: async () => {
    count++;
    return { status: 'OK' };
  } });
  const base = { input: '/abs/model.bbmodel', output: '/abs/next.bbmodel' };
  await assert.rejects(client.apply({ ...base, expectedSha256: 'bad', operations: [{ op: 'remove_cube', uuid: 'cube-1' }] }));
  await assert.rejects(client.apply({ ...base, expectedSha256: SHA, operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [Infinity, 0, 0] }] }));
  await assert.rejects(client.apply({ ...base, expectedSha256: SHA, operations: Array.from({ length: 129 }, () => ({ op: 'remove_cube', uuid: 'cube-1' })) }));
  assert.equal(count, 0);
});

test('CLI failures are not reported as successful model mutations', async () => {
  const client = createRustCodeModeClient({
    binary: BIN, authorizeMutation: async () => true,
    runner: async () => ({ status: 'ERROR', code: 'SOURCE_SHA256_STALE' }),
  });
  await assert.rejects(client.exportGeometry({
    input: '/abs/model.bbmodel', output: '/abs/model.geo.json', expectedSha256: SHA,
  }), /SOURCE_SHA256_STALE/);
});

test('Code Mode denies mutations without trusted host authorization', async () => {
  let invoked = 0;
  const client = createRustCodeModeClient({
    binary: BIN, runner: async () => { invoked++; return { status: 'OK' }; },
  });
  const input = '/abs/model.bbmodel';
  const output = '/abs/model-next.bbmodel';
  await assert.rejects(client.apply({
    input, output, expectedSha256: SHA,
    operations: [{ op: 'remove_cube', uuid: 'cube-1' }],
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  await assert.rejects(client.newModel({
    output, name: 'New Model', modelIdentifier: 'model',
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  await assert.rejects(client.importPng({
    input, output, png: '/abs/p.png', uuid: 'texture-uuid', name: 'p.png',
    expectedSha256: SHA,
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  await assert.rejects(client.exportPng({
    input, output: '/abs/result.png', textureUuid: 'texture-uuid', expectedSha256: SHA,
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  await assert.rejects(client.exportGeometry({
    input, output: '/abs/result.geo.json', expectedSha256: SHA,
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  assert.equal(invoked, 0);
});

test('denied trusted-host approval cannot invoke Rust or create a plan', async () => {
  let invoked = 0;
  const client = createRustCodeModeClient({
    binary: BIN, authorizeMutation: async () => false,
    runner: async () => { invoked++; return { status: 'OK' }; },
  });
  await assert.rejects(client.apply({
    input: '/abs/model.bbmodel', output: '/abs/next.bbmodel', expectedSha256: SHA,
    operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }],
  }), /CODE_MODE_MUTATION_NOT_APPROVED/);
  assert.equal(invoked, 0);
});

test('client can request a SHA-pinned read without changing legacy unpinned reads', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN, runner: async (args) => {
      calls.push(args);
      return { status: 'OK', sha256: SHA, summary: { revision: 0 } };
    },
  });
  await client.inspect({ input: '/abs/model.bbmodel', uuid: 'cube-1', expectedSha256: SHA });
  assert.deepEqual(calls[0], [
    'inspect', '--input', '/abs/model.bbmodel', '--uuid', 'cube-1',
    '--expected-sha256', SHA,
  ]);
  await assert.rejects(client.inspect({
    input: '/abs/model.bbmodel', expectedSha256: 'bad-hash',
  }));
  assert.equal(calls.length, 1);
});

test('Code Mode static model audit is read-only and explicit about unverified visuals', async () => {
  const client = createRustCodeModeClient({
    binary: BIN, runner: async (argv) => {
      assert.deepEqual(argv, ['inspect', '--input', '/abs/model.bbmodel', '--audit', 'model']);
      return { status: 'OK', sha256: SHA,
        audit: { scope: 'static_metadata_only', visual_verdict: 'UNVERIFIED',
          faces: { total: 6, null_or_absent: 1 } } };
    },
  });
  const result = await client.audit({ input: '/abs/model.bbmodel' });
  assert.equal(result.audit.visual_verdict, 'UNVERIFIED');
});

test('path/SHA bound project reuses its identity without automatic mutation', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN, authorizeMutation: async (request) =>
      request.operation === 'apply' && request.expectedSha256 === SHA,
    runner: async (argv) => {
      calls.push(argv);
      if (argv[0] === 'inspect') {
        return { status: 'OK', sha256: SHA, summary: { revision: 0 },
          catalog: { kind: 'cubes', total: 1, entries: [], offset: 0, next_offset: null } };
      }
      return { status: 'OK', source_sha256: SHA, output_sha256: 'b'.repeat(64),
        summary: { revision: 1 },
        mutation: { revision: 1, operation_count: 1, changed_uuids: ['cube-1'] } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  assert.equal(project.expectedSha256, SHA);
  await project.catalog('cubes', { limit: 1 });
  const receipt = await project.apply({
    output: '/abs/model-next.bbmodel',
    operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [2, 0, 0] }],
  });
  assert.equal(receipt.source_sha256, project.expectedSha256);
  assert.equal(calls.filter((argv) => argv[0] === 'apply').length, 1);
  const readCalls = calls.filter((argv) => argv[0] === 'inspect');
  assert.equal(readCalls.length, 2);
  assert.equal(readCalls[0].includes('--expected-sha256'), false);
  assert.equal(readCalls[1][readCalls[1].indexOf('--expected-sha256') + 1], SHA);
});

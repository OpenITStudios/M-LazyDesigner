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

test('Code Mode reports six saved manual UV alpha regions without inventing face quality', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      if (argv.includes('--face-alpha-uuid')) {
        return {
          status: 'OK', sha256: SHA, summary: { revision: 0 },
          face_alpha: {
            scope: 'saved_manual_face_uv_alpha', cube_uuid: 'cube-1',
            visual_verdict: 'UNVERIFIED', face_coverage_verdict: 'UNVERIFIED',
            effective_material: 'UNVERIFIED', face_count: 6,
            faces: [
              { side: 'north', saved_reference_kind: 'index',
                alpha: { status: 'measured', region: {
                  scope: 'saved_manual_uv_alpha_pixels', sampled_pixels: 16,
                  transparent_pixels: 14, translucent_pixels: 1, opaque_pixels: 1,
                  pixel_rect: [0, 0, 4, 4],
                } } },
              { side: 'south', saved_reference_kind: 'null',
                alpha: { status: 'unsupported', reason: 'NO_EXPLICIT_TEXTURE_REFERENCE' } },
            ],
          },
        };
      }
      return { status: 'OK', sha256: SHA, summary: { revision: 0 } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const inspection = await project.inspectCubeFaceAlpha('cube-1');
  assert.deepEqual(calls[1], [
    'inspect', '--input', '/abs/model.bbmodel',
    '--face-alpha-uuid', 'cube-1', '--expected-sha256', SHA,
  ]);
  assert.equal(inspection.face_alpha.faces[0].alpha.region.transparent_pixels, 14);
  assert.equal(inspection.face_alpha.faces[1].alpha.status, 'unsupported');
  assert.equal(inspection.face_alpha.face_coverage_verdict, 'UNVERIFIED');
  await assert.rejects(client.inspectCubeFaceAlpha({
    input: '/abs/model.bbmodel', cubeUuid: '',
  }));
  await assert.rejects(client.inspectCubeFaceAlpha({
    input: '/abs/model.bbmodel', cubeUuid: 'cube-1', expectedSha256: 'invalid',
  }));
  assert.equal(calls.length, 2);
});

test('Code Mode reads bounded decoded atlas alpha evidence using a pinned source SHA', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      if (argv.includes('--alpha-uuid')) {
        return {
          status: 'OK', sha256: SHA, summary: { revision: 0 },
          alpha: {
            kind: 'texture_alpha', texture_uuid: 'texture-1', texture_index: 0,
            inspection: {
              scope: 'decoded_embedded_rgba8_alpha', supported: true,
              visual_verdict: 'UNVERIFIED', face_coverage_verdict: 'UNVERIFIED',
              width: 16, height: 16, total_pixels: 256,
              transparent_pixels: 254, translucent_pixels: 1, opaque_pixels: 1,
              grid_size: [8, 8],
            },
          },
        };
      }
      return { status: 'OK', sha256: SHA, summary: { revision: 0 } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const result = await project.inspectTextureAlpha('texture-1');
  assert.deepEqual(calls[1], [
    'inspect', '--input', '/abs/model.bbmodel',
    '--alpha-uuid', 'texture-1', '--expected-sha256', SHA,
  ]);
  assert.equal(result.alpha.inspection.transparent_pixels, 254);
  assert.equal(result.alpha.inspection.visual_verdict, 'UNVERIFIED');
  assert.equal(result.alpha.inspection.face_coverage_verdict, 'UNVERIFIED');
  await assert.rejects(client.inspectTextureAlpha({
    input: '/abs/model.bbmodel', textureUuid: '',
  }));
  await assert.rejects(client.inspectTextureAlpha({
    input: '/abs/model.bbmodel', textureUuid: 'texture-1',
    expectedSha256: 'stale-or-malformed',
  }));
  assert.equal(calls.length, 2);
});

test('Code Mode reads six authored Cube face links using an exact SHA without inferring texture coverage', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      if (argv.includes('--surface-uuid')) {
        return {
          status: 'OK', sha256: SHA, summary: { revision: 0 },
          surfaces: {
            scope: 'saved_geometry_and_face_references',
            cube_uuid: 'cube-1', visual_verdict: 'UNVERIFIED',
            effective_material: 'UNVERIFIED',
            faces: [
              { side: 'north', reference_kind: 'index', texture_index: 0,
                texture_uuid: 'texture-1', source_kind: 'embedded_png_declared' },
              { side: 'south', reference_kind: 'null', texture_index: null,
                texture_uuid: null, source_kind: null },
            ],
          },
        };
      }
      return { status: 'OK', sha256: SHA, summary: { revision: 0 } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const result = await project.inspectCubeSurfaces('cube-1');
  assert.deepEqual(calls[1], [
    'inspect', '--input', '/abs/model.bbmodel',
    '--surface-uuid', 'cube-1', '--expected-sha256', SHA,
  ]);
  assert.equal(result.surfaces.visual_verdict, 'UNVERIFIED');
  assert.equal(result.surfaces.effective_material, 'UNVERIFIED');
  assert.equal(result.surfaces.faces[0].reference_kind, 'index');
  assert.equal(result.surfaces.faces[1].reference_kind, 'null');
  await assert.rejects(client.inspectCubeSurfaces({
    input: '/abs/model.bbmodel', cubeUuid: '',
  }));
  assert.equal(calls.length, 2);
});

test('Code Mode inspects bounded numeric Bone rotation frames without exposing opaque tracks', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      return {
        status: 'OK', sha256: SHA, summary: { revision: 0 },
        track: { scope: 'linear_bone_rotation', recognized: true,
          visual_verdict: 'UNVERIFIED', total_frames: 1, next_offset: null,
          animation_uuid: 'animation-1', bone_uuid: 'bone-1',
          keyframes: [{ uuid: 'key-1', time: 1, rotation: [0, 25, 0] }] },
      };
    },
  });
  const result = await client.inspectAnimationTrack({
    input: '/abs/model.bbmodel', animationUuid: 'animation-1',
    boneUuid: 'bone-1', offset: 0, limit: 16, expectedSha256: SHA,
  });
  assert.deepEqual(calls[0], [
    'inspect', '--input', '/abs/model.bbmodel',
    '--animation-uuid', 'animation-1', '--bone-uuid', 'bone-1',
    '--frame-offset', '0', '--frame-limit', '16', '--expected-sha256', SHA,
  ]);
  assert.deepEqual(result.track.keyframes[0].rotation, [0, 25, 0]);
  assert.equal(result.track.visual_verdict, 'UNVERIFIED');
  await assert.rejects(client.inspectAnimationTrack({
    input: '/abs/model.bbmodel', animationUuid: 'animation-1',
    boneUuid: 'bone-1', limit: 65,
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
  await project.inspectAnimationTrack('animation-1', 'bone-1', { limit: 4 });
  const receipt = await project.apply({
    output: '/abs/model-next.bbmodel',
    operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [2, 0, 0] }],
  });
  assert.equal(receipt.source_sha256, project.expectedSha256);
  assert.equal(calls.filter((argv) => argv[0] === 'apply').length, 1);
  const readCalls = calls.filter((argv) => argv[0] === 'inspect');
  assert.equal(readCalls.length, 3);
  assert.equal(readCalls[0].includes('--expected-sha256'), false);
  assert.equal(readCalls[1][readCalls[1].indexOf('--expected-sha256') + 1], SHA);
  assert.equal(readCalls[2][readCalls[2].indexOf('--expected-sha256') + 1], SHA);
  assert.equal(readCalls[2][readCalls[2].indexOf('--frame-limit') + 1], '4');
});

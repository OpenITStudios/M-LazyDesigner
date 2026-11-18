// SOURCE ONLY: tests not executed while Rust/Windows/localtest hold is active.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createLiveReadClient } from './live-read-client.mjs';

const pipe = String.raw`\\.\pipe\LazyDesigner-read-${'a'.repeat(32)}`;
const token = 'b'.repeat(64);
const summary = { revision: 9, cubes: 1, bones: 1, textures: 0, animations: 0 };
const identity = {
  status: 'OK', epoch: 5, revision: 9, summary, dirty: true,
  write_authority: 'NOT_GRANTED', visual_verdict: 'UNVERIFIED',
};
const map = {
  scope: 'validated_rust_semantic_identity_map',
  revision: 9, category: 'cubes', offset: 0, total: 1,
  next_offset: null,
  counts: { cubes: 1, bones: 1, textures: 0, animations: 0 },
  entries: [{ kind: 'cube', index: 0, uuid: 'cube-1',
    name: 'Helmet', parent_uuid: null }],
  write_authority: 'NOT_GRANTED', visual_verdict: 'UNVERIFIED',
  effective_material: 'UNVERIFIED',
};

function fakePipe(reply, requests) {
  return () => {
    const socket = new EventEmitter();
    socket.destroy = () => { socket.destroyed = true; };
    socket.setTimeout = () => {};
    socket.write = bytes => {
      requests.push(JSON.parse(bytes));
      queueMicrotask(() => socket.emit('data', Buffer.from(
        JSON.stringify(reply) + '\n', 'utf8')));
      return true;
    };
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };
}

test('live read client binds private pipe token to read-only status and map', async () => {
  const requests = [];
  const reader = createLiveReadClient({
    pipe, token,
    connectImpl: name => fakePipe(
      requests.length === 0 ? identity : { ...identity, map },
      requests)(),
  });
  const status = await reader.sessionInfo();
  assert.equal(status.revision, 9);
  const next = await reader.semanticMap({
    expectedEpoch: 5, expectedRevision: 9, category: 'cubes',
  });
  assert.equal(next.map.entries[0].name, 'Helmet');
  assert.deepEqual(requests.map(r => r.operation), [
    'status', 'semantic_map',
  ]);
  assert.equal(requests[0].token, token);
  assert.deepEqual(requests[1], {
    protocol: 1, token, operation: 'semantic_map',
    expected_epoch: 5, expected_revision: 9,
    category: 'cubes', offset: 0, limit: 16,
  });
  assert.equal(JSON.stringify(status).includes(token), false);
  assert.equal(JSON.stringify(next).includes(token), false);
});

test('live read rejects invalid pairing, overbroad queries and false receipts', async () => {
  assert.throws(() => createLiveReadClient({
    pipe: 'localhost:9000', token,
  }), /LIVE_READ_PAIRING_INVALID/);
  assert.throws(() => createLiveReadClient({
    pipe, token: 'short',
  }), /LIVE_READ_PAIRING_INVALID/);
  let calls = 0;
  const reader = createLiveReadClient({
    pipe, token,
    connectImpl: () => {
      calls++;
      return fakePipe(identity, [])();
    },
  });
  await assert.rejects(reader.semanticMap({
    expectedEpoch: 5, expectedRevision: 9, category: 'unsupported',
  }), /LIVE_READ_CATEGORY_INVALID/);
  await assert.rejects(reader.semanticMap({
    expectedEpoch: 5, expectedRevision: 9, category: 'cubes', limit: 25,
  }), /LIVE_READ_LIMIT_INVALID/);
  assert.equal(calls, 0);
  const bogus = createLiveReadClient({
    pipe, token, connectImpl: fakePipe({
      ...identity, map: {...map, write_authority: 'GRANTED'},
    }, []),
  });
  await assert.rejects(bogus.semanticMap({
    expectedEpoch: 5, expectedRevision: 9, category: 'cubes',
  }), /LIVE_READ_SEMANTIC_MAP_RECEIPT_INVALID/);
  const stale = createLiveReadClient({
    pipe, token, connectImpl: fakePipe({
      ...identity, revision: 8,
    }, []),
  });
  await assert.rejects(stale.sessionInfo(),
    /LIVE_READ_IDENTITY_RECEIPT_INVALID/);
});

test('remote code cannot request write through the live reader API', async () => {
  const reader = createLiveReadClient({
    pipe, token, connectImpl: fakePipe(identity, []),
  });
  assert.deepEqual(Object.keys(reader).sort(), [
    'semanticMap', 'sessionInfo',
  ]);
  assert.equal(reader.apply, undefined);
  assert.equal(reader.preflight, undefined);
});

test('unexpected socket close refuses instead of leaving a pending host RPC', async () => {
  const reader = createLiveReadClient({
    pipe, token,
    connectImpl: () => {
      const socket = new EventEmitter();
      socket.destroy = () => {};
      socket.setTimeout = () => {};
      socket.write = () => {
        queueMicrotask(() => socket.emit('close', true));
        return true;
      };
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
  });
  await assert.rejects(reader.sessionInfo(), /LIVE_READ_REPLY_INCOMPLETE/);
});

test('a synchronous pipe write failure is returned as a bounded refusal', async () => {
  const reader = createLiveReadClient({
    pipe, token,
    connectImpl: () => {
      const socket = new EventEmitter();
      socket.destroy = () => {};
      socket.setTimeout = () => {};
      socket.write = () => {
        throw new Error('closed before write');
      };
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
  });
  await assert.rejects(reader.sessionInfo(), /LIVE_READ_PIPE_WRITE_FAILED/);
});

test('UTF-8 split between pipe chunks preserves source identity bytes', async () => {
  const requests = [];
  const response = {
    ...identity, map: {
      ...map, entries: [{...map.entries[0], name: 'Hélm'}],
    },
  };
  const reader = createLiveReadClient({
    pipe, token,
    connectImpl: () => {
      const socket = new EventEmitter();
      socket.destroy = () => {};
      socket.setTimeout = () => {};
      socket.write = bytes => {
        requests.push(JSON.parse(bytes));
        const frame = Buffer.from(JSON.stringify(response) + '\n');
        const e = frame.indexOf(Buffer.from('é'));
        queueMicrotask(() => {
          socket.emit('data', frame.subarray(0, e + 1));
          socket.emit('data', frame.subarray(e + 1));
        });
        return true;
      };
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
  });
  const result = await reader.semanticMap({
    expectedEpoch: 5, expectedRevision: 9, category: 'cubes',
  });
  assert.equal(result.map.entries[0].name, 'Hélm');
  assert.equal(requests[0].operation, 'semantic_map');
});

// Trusted Node-only, explicitly paired, read-only Windows Rust session client.
// Never import into the Deno guest or pass the pairing capability in RPC.
import { connect as netConnect } from 'node:net';
import { StringDecoder } from 'node:string_decoder';

const PIPE = /^\\\\\.\\pipe\\LazyDesigner-read-[0-9a-f]{32}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const MAX_REQUEST = 4096;
const MAX_REPLY = 32 * 1024;
const TIMEOUT_MS = 4000;
const CATEGORIES = new Set(['cubes', 'bones', 'textures', 'animations']);

function checkNumber(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError('LIVE_READ_' + label + '_INVALID');
  }
  return value;
}
function requiredIdentity(reply) {
  if (!reply || reply.status !== 'OK' ||
      !Number.isSafeInteger(reply.epoch) || reply.epoch < 1 ||
      !Number.isSafeInteger(reply.revision) || reply.revision < 0 ||
      reply.summary?.revision !== reply.revision ||
      reply.write_authority !== 'NOT_GRANTED' ||
      reply.visual_verdict !== 'UNVERIFIED') {
    throw new Error('LIVE_READ_IDENTITY_RECEIPT_INVALID');
  }
  return reply;
}

export function createLiveReadClient({
  pipe, token, connectImpl = netConnect,
} = {}) {
  if (typeof pipe !== 'string' || !PIPE.test(pipe) ||
      typeof token !== 'string' || !TOKEN.test(token) ||
      typeof connectImpl !== 'function') {
    throw new TypeError('LIVE_READ_PAIRING_INVALID');
  }
  async function exchange(request) {
    const bytes = JSON.stringify({ protocol: 1, token, ...request }) + '\n';
    if (Buffer.byteLength(bytes, 'utf8') > MAX_REQUEST) {
      throw new TypeError('LIVE_READ_REQUEST_TOO_LARGE');
    }
    return new Promise((resolve, reject) => {
      const stream = connectImpl(pipe);
      let complete = false, length = 0, data = '';
      const decoder = new StringDecoder('utf8');
      function finish(error, result) {
        if (complete) return;
        complete = true;
        stream.destroy();
        if (error) reject(error);
        else resolve(result);
      }
      stream.setTimeout(TIMEOUT_MS, () => finish(
        new Error('LIVE_READ_OUTCOME_UNKNOWN_TIMEOUT')));
      stream.once('error', () => finish(new Error('LIVE_READ_PIPE_UNAVAILABLE')));
      stream.once('connect', () => {
        if (!stream.write(bytes, 'utf8')) {
          // Backpressure is handled internally by net.Socket.
        }
      });
      stream.on('data', chunk => {
        length += chunk.length;
        if (length > MAX_REPLY) return finish(
          new Error('LIVE_READ_REPLY_TOO_LARGE'));
        data += decoder.write(chunk);
        const at = data.indexOf('\n');
        if (at === -1) return;
        if (at !== data.length - 1) return finish(
          new Error('LIVE_READ_REPLY_INVALID'));
        let response;
        try { response = JSON.parse(data.slice(0, -1)); }
        catch { return finish(new Error('LIVE_READ_REPLY_INVALID')); }
        if (!response || typeof response !== 'object' ||
            Array.isArray(response)) {
          return finish(new Error('LIVE_READ_REPLY_INVALID'));
        }
        if (response.status === 'ERROR') {
          const code = response.code;
          if (typeof code !== 'string' ||
              !/^[A-Z][A-Z0-9_]{2,80}$/.test(code)) {
            return finish(new Error('LIVE_READ_REPLY_INVALID'));
          }
          return finish(new Error(code));
        }
        if (response.status !== 'OK') return finish(
          new Error('LIVE_READ_REPLY_INVALID'));
        finish(null, response);
      });
      stream.once('end', () => finish(
        new Error('LIVE_READ_REPLY_INCOMPLETE')));
    });
  }
  return Object.freeze({
    async sessionInfo() {
      return requiredIdentity(await exchange({ operation: 'status' }));
    },
    async semanticMap({
      expectedEpoch, expectedRevision, category, offset = 0, limit = 16,
    }) {
      checkNumber(expectedEpoch, 1, Number.MAX_SAFE_INTEGER, 'EPOCH');
      checkNumber(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'REVISION');
      checkNumber(offset, 0, 65536, 'OFFSET');
      checkNumber(limit, 1, 24, 'LIMIT');
      if (!CATEGORIES.has(category)) {
        throw new TypeError('LIVE_READ_CATEGORY_INVALID');
      }
      const receipt = await exchange({
        operation: 'semantic_map', expected_epoch: expectedEpoch,
        expected_revision: expectedRevision, category, offset, limit,
      });
      const map = receipt.map;
      const kind = category.slice(0, -1);
      if (receipt.epoch !== expectedEpoch ||
          receipt.revision !== expectedRevision ||
          receipt.summary?.revision !== expectedRevision ||
          map?.scope !== 'validated_rust_semantic_identity_map' ||
          map?.revision !== expectedRevision ||
          map?.category !== category || map?.offset !== offset ||
          !Number.isSafeInteger(map?.total) || map.total < 0 ||
          !Array.isArray(map?.entries) || map.entries.length > limit ||
          map?.write_authority !== 'NOT_GRANTED' ||
          map?.visual_verdict !== 'UNVERIFIED' ||
          map.entries.some((entry, i) => !entry ||
            entry.kind !== kind || entry.index !== offset + i ||
            !(typeof entry.uuid === 'string' || entry.uuid === null) ||
            !(typeof entry.name === 'string' || entry.name === null)) ||
          (map.next_offset !== null &&
            (!Number.isSafeInteger(map.next_offset) ||
             map.next_offset !== offset + map.entries.length ||
             map.next_offset >= map.total)) ||
          (offset < map.total &&
            map.entries.length !== Math.min(limit, map.total - offset))) {
        throw new Error('LIVE_READ_SEMANTIC_MAP_RECEIPT_INVALID');
      }
      return receipt;
    },
  });
}

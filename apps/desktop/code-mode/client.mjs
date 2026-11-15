/**
 * Rust-first Code Mode SDK for a trusted local agent code runner.
 * Model-written JavaScript is executed by the host, NOT by this module.
 * Only first-party, bounded CLI operations cross into the Rust authoring core.
 * Source-authored; local/native execution NOT_EXECUTED.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const execFileAsync = promisify(execFile);
const PLAN_LIMIT = 64 * 1024;
const OUTPUT_LIMIT = 128 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;

function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('--') || value.includes('\0')) {
    throw new TypeError(name + ' must be a nonempty string without option prefixes or NUL');
  }
  return value;
}
function absolute(value, name) {
  nonempty(value, name);
  if (!isAbsolute(value)) throw new TypeError(name + ' must be an absolute path');
  return value;
}
function wholeNumber(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(name + ' must be an integer from ' + min + ' to ' + max);
  }
  return String(value);
}
function hash(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError('expectedSha256 must be a 64-character hex digest');
  }
  return value;
}
function optionArgs(command, options) {
  const args = [command];
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    args.push('--' + key, nonempty(value, key));
  }
  return args;
}
function parseResponse(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > OUTPUT_LIMIT) {
    throw new Error('CODE_MODE_RESULT_INVALID_OR_OVERSIZE');
  }
  let response;
  try { response = JSON.parse(raw); } catch { throw new Error('CODE_MODE_RESULT_NOT_JSON'); }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('CODE_MODE_RESULT_NOT_OBJECT');
  }
  if (response.status !== 'OK') {
    throw new Error(typeof response.code === 'string' ? response.code : 'CODE_MODE_CLI_FAILURE');
  }
  return response;
}
async function runBinary(binary, args) {
  // Parse success outside the process-transport catch. Malformed or oversized
  // successful responses must not be misreported as an unavailable executable.
  let stdout;
  try {
    ({ stdout } = await execFileAsync(binary, args, {
      shell: false, timeout: 45000, maxBuffer: OUTPUT_LIMIT,
      windowsHide: true, encoding: 'utf8',
    }));
  } catch (error) {
    // A timeout, signal, or truncated stdout leaves the effect uncertain.
    // Never retry mutations automatically.
    if (error?.killed || error?.signal ||
        error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error('CODE_MODE_CLI_OUTCOME_UNKNOWN', { cause: error });
    }
    if (typeof error?.stdout === 'string' && error.stdout.trim()) {
      let result;
      try { result = JSON.parse(error.stdout); } catch {}
      if (result?.status === 'ERROR' && typeof result.code === 'string') {
        throw new Error(result.code, { cause: error });
      }
      throw new Error('CODE_MODE_CLI_OUTCOME_UNKNOWN', { cause: error });
    }
    throw new Error('CODE_MODE_CLI_UNAVAILABLE', { cause: error });
  }
  return parseResponse(stdout);
}
function serializePlan(operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 128) {
    throw new TypeError('operations must contain 1 through 128 typed Rust operations');
  }
  const payload = JSON.stringify({ expected_revision: 0, operations }, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Nonfinite operation value');
    }
    return value;
  });
  if (!payload || Buffer.byteLength(payload, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('EDIT_PLAN_SIZE_INVALID');
  }
  return payload;
}

/**
 * A programmatic API intended to be imported into an agent host's code sandbox.
 * This module NEVER evals model-generated code or starts a listening server.
 * Native mutation/persistence permission is owned by the agent host and Rust.
 *
 * `runner` and `authorizeMutation` MUST be supplied only by trusted host code.
 * This is defense in depth, NOT a sandbox: a model-controlled unrestricted
 * Node process could instantiate a client with a dishonest callback or call
 * the binary directly. The host must isolate the code and supply a fixed SDK.
 */
export function createRustCodeModeClient({ binary, runner, authorizeMutation } = {}) {
  absolute(binary, 'binary');
  if (runner !== undefined && typeof runner !== 'function') {
    throw new TypeError('runner must be a function supplied by a trusted host');
  }
  if (authorizeMutation !== undefined && typeof authorizeMutation !== 'function') {
    throw new TypeError('authorizeMutation must be a trusted-host function');
  }
  const invoke = runner ?? ((args) => runBinary(binary, args));
  async function requestWrite(operation, details) {
    if (typeof authorizeMutation !== 'function') {
      throw new Error('CODE_MODE_MUTATION_AUTHORITY_REQUIRED');
    }
    const descriptor = Object.freeze({ operation, ...details });
    if (await authorizeMutation(descriptor) !== true) {
      throw new Error('CODE_MODE_MUTATION_NOT_APPROVED');
    }
  }
  async function call(command, options) {
    const args = optionArgs(command, options);
    const result = await invoke(args);
    // The default process runner validates JSON on success and on error.
    // Trusted test runners return objects directly.
    if (!result || result.status !== 'OK') {
      throw new Error(typeof result?.code === 'string' ? result.code : 'CODE_MODE_CLI_FAILURE');
    }
    return result;
  }
  return Object.freeze({
    async newModel({ output, name, modelIdentifier }) {
      const options = {
        output: absolute(output, 'output'), name: nonempty(name, 'name'),
        'model-identifier': nonempty(modelIdentifier, 'modelIdentifier'),
      };
      await requestWrite('newModel', {
        output: options.output, name: options.name,
        modelIdentifier: options['model-identifier'],
      });
      return call('new', options);
    },
    async inspect({ input, uuid, expectedSha256 } = {}) {
      return call('inspect', {
        input: absolute(input, 'input'),
        ...(uuid === undefined ? {} : { uuid: nonempty(uuid, 'uuid') }),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectCubeSurfaces({ input, cubeUuid, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'surface-uuid': nonempty(cubeUuid, 'cubeUuid'),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectCubeFaceAlpha({ input, cubeUuid, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'face-alpha-uuid': nonempty(cubeUuid, 'cubeUuid'),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async catalog({ input, kind, offset = 0, limit = 32, expectedSha256 }) {
      if (!['cubes', 'bones', 'textures', 'animations'].includes(kind)) {
        throw new TypeError('Unknown catalog kind');
      }
      return call('inspect', {
        input: absolute(input, 'input'), list: kind,
        offset: wholeNumber(offset, 'offset', 0, 65536),
        limit: wholeNumber(limit, 'limit', 1, 64),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectTexture({ input, index, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'texture-index': wholeNumber(index, 'index', 0, 65536),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectTextureAlpha({ input, textureUuid, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'alpha-uuid': nonempty(textureUuid, 'textureUuid'),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectAnimation({ input, uuid, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'), 'animation-uuid': nonempty(uuid, 'uuid'),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async inspectAnimationTrack({
      input, animationUuid, boneUuid, offset = 0, limit = 32, expectedSha256,
    }) {
      return call('inspect', {
        input: absolute(input, 'input'),
        'animation-uuid': nonempty(animationUuid, 'animationUuid'),
        'bone-uuid': nonempty(boneUuid, 'boneUuid'),
        'frame-offset': wholeNumber(offset, 'offset', 0, 65536),
        'frame-limit': wholeNumber(limit, 'limit', 1, 64),
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async audit({ input, expectedSha256 }) {
      return call('inspect', {
        input: absolute(input, 'input'), audit: 'model',
        ...(expectedSha256 === undefined ? {} : { 'expected-sha256': hash(expectedSha256) }),
      });
    },
    async apply({ input, output, expectedSha256, operations }) {
      const options = {
        input: absolute(input, 'input'),
        output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const payload = serializePlan(operations);
      await requestWrite('apply', {
        input: options.input, output: options.output,
        expectedSha256: options['expected-sha256'],
        operationCount: operations.length,
        operationKinds: Object.freeze(operations.map((op) => op?.op ?? null)),
        planSha256: createHash('sha256').update(payload).digest('hex'),
      });
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-code-mode-'));
      const file = join(directory, 'edit.plan.json');
      try {
        await writeFile(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return await call('apply', { ...options, plan: file });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async importPng({ input, output, png, uuid, name, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        png: absolute(png, 'png'), uuid: nonempty(uuid, 'uuid'),
        name: nonempty(name, 'name'), 'expected-sha256': hash(expectedSha256),
      };
      await requestWrite('importPng', {
        input: options.input, output: options.output, png: options.png,
        uuid: options.uuid, expectedSha256: options['expected-sha256'],
      });
      return call('import-png', options);
    },
    async exportPng({ input, output, textureUuid, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'texture-uuid': nonempty(textureUuid, 'textureUuid'),
        'expected-sha256': hash(expectedSha256),
      };
      await requestWrite('exportPng', {
        input: options.input, output: options.output,
        textureUuid: options['texture-uuid'], expectedSha256: options['expected-sha256'],
      });
      return call('export-png', options);
    },
    async exportGeometry({ input, output, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      await requestWrite('exportGeometry', {
        input: options.input, output: options.output,
        expectedSha256: options['expected-sha256'],
      });
      return call('export-geometry', options);
    },
  });
}

/**
 * Bind a single immutable file/SHA snapshot. Each inspection re-reads the
 * actual file with the pinned SHA and fails closed on stale reads; each
 * mutation uses the same precondition. No mutable JS scene cache is created.
 */
export async function openRustCodeModeProject(client, input) {
  if (!client || typeof client.inspect !== 'function' ||
      typeof client.apply !== 'function') {
    throw new TypeError('A trusted Rust Code Mode client is required');
  }
  const path = absolute(input, 'input');
  const snapshot = await client.inspect({ input: path });
  const expectedSha256 = hash(snapshot.sha256);
  return Object.freeze({
    input: path,
    expectedSha256,
    summary: snapshot.summary,
    inspect: (uuid) => client.inspect({ input: path, uuid, expectedSha256 }),
    inspectCubeSurfaces: (cubeUuid) =>
      client.inspectCubeSurfaces({ input: path, cubeUuid, expectedSha256 }),
    inspectCubeFaceAlpha: (cubeUuid) =>
      client.inspectCubeFaceAlpha({ input: path, cubeUuid, expectedSha256 }),
    catalog: (kind, { offset = 0, limit = 32 } = {}) =>
      client.catalog({ input: path, kind, offset, limit, expectedSha256 }),
    audit: () => client.audit({ input: path, expectedSha256 }),
    inspectTexture: (index) => client.inspectTexture({ input: path, index, expectedSha256 }),
    inspectTextureAlpha: (textureUuid) =>
      client.inspectTextureAlpha({ input: path, textureUuid, expectedSha256 }),
    inspectAnimation: (uuid) => client.inspectAnimation({ input: path, uuid, expectedSha256 }),
    inspectAnimationTrack: (animationUuid, boneUuid, { offset = 0, limit = 32 } = {}) =>
      client.inspectAnimationTrack({
        input: path, animationUuid, boneUuid, offset, limit, expectedSha256,
      }),
    apply: ({ output, operations }) =>
      client.apply({ input: path, output, expectedSha256, operations }),
    exportPng: ({ output, textureUuid }) =>
      client.exportPng({ input: path, output, textureUuid, expectedSha256 }),
    exportGeometry: ({ output }) =>
      client.exportGeometry({ input: path, output, expectedSha256 }),
  });
}

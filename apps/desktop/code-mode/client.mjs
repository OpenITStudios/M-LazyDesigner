/**
 * Rust-first Code Mode SDK for a trusted local agent code runner.
 * Model-written JavaScript is executed by the host, NOT by this module.
 * Only first-party, bounded CLI operations cross into the Rust authoring core.
 * Source-authored; local/native execution NOT_EXECUTED.
 */
import { execFile } from 'node:child_process';
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
  try {
    const { stdout } = await execFileAsync(binary, args, {
      shell: false, timeout: 45000, maxBuffer: OUTPUT_LIMIT,
      windowsHide: true, encoding: 'utf8',
    });
    return parseResponse(stdout);
  } catch (error) {
    // A timeout or nonzero exit is never a successful mutation, even if the
    // process emitted a partial/early OK. Do not auto-retry uncertain effects.
    if (error?.killed || error?.signal) {
      throw new Error('CODE_MODE_CLI_OUTCOME_UNKNOWN', { cause: error });
    }
    if (typeof error?.stdout === 'string' && error.stdout.trim()) {
      try {
        const response = JSON.parse(error.stdout);
        if (response?.status === 'ERROR' && typeof response.code === 'string') {
          throw new Error(response.code, { cause: error });
        }
      } catch (nested) {
        if (nested instanceof Error && nested.cause === error) throw nested;
      }
      throw new Error('CODE_MODE_CLI_OUTCOME_UNKNOWN', { cause: error });
    }
    throw new Error('CODE_MODE_CLI_UNAVAILABLE', { cause: error });
  }
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
 * `runner` is only a trusted-host dependency-injection seam for source regressions.
 */
export function createRustCodeModeClient({ binary, runner } = {}) {
  absolute(binary, 'binary');
  if (runner !== undefined && typeof runner !== 'function') {
    throw new TypeError('runner must be a function supplied by a trusted host');
  }
  const invoke = runner ?? ((args) => runBinary(binary, args));
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
      return call('new', {
        output: absolute(output, 'output'), name: nonempty(name, 'name'),
        'model-identifier': nonempty(modelIdentifier, 'modelIdentifier'),
      });
    },
    async inspect({ input, uuid } = {}) {
      return call('inspect', {
        input: absolute(input, 'input'),
        ...(uuid === undefined ? {} : { uuid: nonempty(uuid, 'uuid') }),
      });
    },
    async apply({ input, output, expectedSha256, operations }) {
      const options = {
        input: absolute(input, 'input'),
        output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const payload = serializePlan(operations);
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
      return call('import-png', {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        png: absolute(png, 'png'), uuid: nonempty(uuid, 'uuid'),
        name: nonempty(name, 'name'), 'expected-sha256': hash(expectedSha256),
      });
    },
    async exportPng({ input, output, textureUuid, expectedSha256 }) {
      return call('export-png', {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'texture-uuid': nonempty(textureUuid, 'textureUuid'),
        'expected-sha256': hash(expectedSha256),
      });
    },
    async exportGeometry({ input, output, expectedSha256 }) {
      return call('export-geometry', {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      });
    },
  });
}

/**
 * Trusted host for Code Mode RPC. Model JavaScript runs in a separate Deno
 * permission-denied process, never in this Node process or in Tauri/Rust.
 * The host alone holds first-party Rust CLI credentials and file authority.
 * SOURCE_ONLY: no native runtime or sandbox proof has been executed.
 */
import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { createRustCodeModeClient, openRustCodeModeProject } from './client.mjs';

const WORKER = fileURLToPath(new URL('./sandbox-worker.mjs', import.meta.url));
const DENO_FLAGS = Object.freeze([
  'run', '--no-config', '--no-lock', '--no-npm', '--no-remote', '--no-prompt',
]);
const MAX_CODE_BYTES = 32 * 1024;
const MAX_RPC_BYTES = 128 * 1024;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_CALLS = 64;
const MAX_PROJECTS = 16;
const TIMEOUT_MS = 90000;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

function requireAbsolute(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) ||
      value.includes('\0')) {
    throw new TypeError(label + ' must be an absolute path');
  }
  return value;
}
function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('CODE_MODE_RPC_ARGUMENT_INVALID');
  }
  return value;
}
function shortError(error) {
  const value = error?.message ?? String(error);
  return typeof value === 'string' ? value.slice(0, 160) : 'CODE_MODE_HOST_FAILURE';
}
async function regularFile(path, label) {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error(label + '_NOT_REGULAR_FILE');
  }
  return realpath(path);
}
function outputName(name, suffix) {
  if (typeof name !== 'string' || !name || name.length > 128 ||
      name !== basename(name) || name.trim() !== name ||
      /[/\\:<>"|?*\x00-\x1f]/.test(name) ||
      name.startsWith('.') || name.includes('..') ||
      !name.toLowerCase().endsWith(suffix) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('CODE_MODE_OUTPUT_NAME_INVALID');
  }
  return name;
}
async function checkFreshSibling(path, folder) {
  if (await realpath(dirname(path)) !== folder) {
    throw new Error('CODE_MODE_OUTPUT_OUTSIDE_PROJECT');
  }
  try {
    await lstat(path);
    throw new Error('CODE_MODE_OUTPUT_ALREADY_EXISTS');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

/**
 * Create a host bound to either one existing .bbmodel OR an empty trusted
 * outputDirectory for a New-model bootstrap. The runner and spawnImpl are
 * trusted unit-test seams, not inputs for generated code.
 *
 * Every output is a fresh same-directory filename. An independently trusted
 * authorizeMutation callback is required for all writes; without it the
 * underlying SDK refuses mutations. No model-written code is accepted here
 * as a callback, filesystem path, command or sandbox configuration.
 */
export async function createCodeModeHost({
  rustBinary, denoBinary, input, outputDirectory, authorizeMutation,
  preselectedPngPath, runner, spawnImpl,
} = {}) {
  requireAbsolute(rustBinary, 'rustBinary');
  requireAbsolute(denoBinary, 'denoBinary');
  if ((input === undefined) === (outputDirectory === undefined)) {
    throw new Error('CODE_MODE_SOURCE_OR_OUTPUT_DIRECTORY_REQUIRED');
  }
  if (input !== undefined) requireAbsolute(input, 'input');
  if (outputDirectory !== undefined) {
    requireAbsolute(outputDirectory, 'outputDirectory');
  }
  if (runner !== undefined && typeof runner !== 'function') {
    throw new TypeError('runner must be a trusted host function');
  }
  if (spawnImpl !== undefined && typeof spawnImpl !== 'function') {
    throw new TypeError('spawnImpl must be a trusted host function');
  }
  if (authorizeMutation !== undefined &&
      typeof authorizeMutation !== 'function') {
    throw new TypeError('authorizeMutation must be a trusted host function');
  }
  const source = input === undefined ? null :
    await regularFile(input, 'CODE_MODE_SOURCE');
  if (source !== null && !source.toLowerCase().endsWith('.bbmodel')) {
    throw new Error('CODE_MODE_SOURCE_EXTENSION_INVALID');
  }
  let folder;
  if (source === null) {
    const dir = await lstat(outputDirectory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) {
      throw new Error('CODE_MODE_OUTPUT_DIRECTORY_INVALID');
    }
    folder = await realpath(outputDirectory);
  } else {
    folder = await realpath(dirname(source));
  }
  if (!runner) await regularFile(rustBinary, 'CODE_MODE_RUST_BINARY');
  if (!spawnImpl) {
    await regularFile(denoBinary, 'CODE_MODE_DENO_BINARY');
    await regularFile(WORKER, 'CODE_MODE_SANDBOX_ENTRY');
  }
  const png = preselectedPngPath === undefined ? undefined :
    await regularFile(requireAbsolute(preselectedPngPath, 'preselectedPngPath'),
      'CODE_MODE_PNG_INPUT');

  // Only one code session may be active per host. Operator approval is
  // invalidated when that session exits or times out.
  let activeExecution = null;
  const client = createRustCodeModeClient({
    binary: rustBinary,
    ...(runner ? { runner } : {}),
    authorizeMutation: async (request) => {
      const execution = activeExecution;
      if (!execution || execution.closed ||
          typeof request.output !== 'string') return false;
      try { await checkFreshSibling(request.output, folder); }
      catch { return false; }
      if (typeof authorizeMutation !== 'function' ||
          execution.closed || activeExecution !== execution) return false;
      execution.pause();
      let approved;
      try {
        approved = await authorizeMutation(Object.freeze({ ...request }));
      } finally {
        execution.resume();
      }
      // Prevent a delayed approval from reviving a timed-out guest.
      return approved === true &&
        !execution.closed && activeExecution === execution;
    },
  });
  const projects = new Map();
  const initialProject = source === null ? null :
    await openRustCodeModeProject(client, source);
  if (initialProject) projects.set('p0', initialProject);
  let nextProject = initialProject ? 1 : 0;
  const initialRef = Object.freeze(initialProject ? {
    project: 'p0', sha256: initialProject.expectedSha256,
    summary: initialProject.summary,
  } : { project: null, sha256: null, summary: null });

  function selected(args) {
    const id = requireObject(args).project;
    if (typeof id !== 'string' || !projects.has(id)) {
      throw new Error('CODE_MODE_PROJECT_HANDLE_UNKNOWN');
    }
    return projects.get(id);
  }
  async function outputPath(name, suffix) {
    const path = join(folder, outputName(name, suffix));
    await checkFreshSibling(path, folder);
    return path;
  }
  async function register(path) {
    if (projects.size >= MAX_PROJECTS) {
      throw new Error('CODE_MODE_PROJECT_LIMIT_REACHED');
    }
    const project = await openRustCodeModeProject(client, path);
    const handle = 'p' + nextProject++;
    projects.set(handle, project);
    return { project: handle, sha256: project.expectedSha256,
      summary: project.summary };
  }
  // The fixed capability boundary is intentionally much smaller than shell,
  // filesystem or generic Rust CLI access. Only owned methods are dispatched.
  const actions = Object.freeze({
    projectInfo: async (args) => {
      const p = selected(args);
      return { project: args.project, sha256: p.expectedSha256,
        summary: p.summary };
    },
    inspect: async (args) => selected(args).inspect(args.uuid),
    catalog: async (args) => selected(args).catalog(args.kind, {
      offset: args.offset, limit: args.limit,
    }),
    inspectBatch: async (args) => selected(args).inspectBatch(args.requests),
    inspectCubeSurfaces: async (args) => selected(args).inspectCubeSurfaces(args.uuid),
    inspectCubeFaceAlpha: async (args) => selected(args).inspectCubeFaceAlpha(args.uuid),
    inspectTexture: async (args) => selected(args).inspectTexture(args.index),
    inspectTextureAlpha: async (args) => selected(args).inspectTextureAlpha(args.uuid),
    inspectAnimation: async (args) => selected(args).inspectAnimation(args.uuid),
    inspectAnimationTrack: async (args) => selected(args).inspectAnimationTrack(
      args.animationUuid, args.boneUuid, {
        offset: args.offset, limit: args.limit,
      }),
    audit: async (args) => selected(args).audit(),
    newModel: async (args) => {
      requireObject(args);
      const output = await outputPath(args.output, '.bbmodel');
      const receipt = await client.newModel({
        output, name: args.name, modelIdentifier: args.modelIdentifier,
      });
      return { receipt, ...await register(output) };
    },
    apply: async (args) => {
      const p = selected(args);
      const output = await outputPath(args.output, '.bbmodel');
      const receipt = await p.apply({ output, operations: args.operations });
      return { receipt, ...await register(output) };
    },
    importPng: async (args) => {
      const p = selected(args);
      if (!png) throw new Error('CODE_MODE_PNG_NOT_PRESELECTED_BY_HOST');
      const output = await outputPath(args.output, '.bbmodel');
      const receipt = await client.importPng({
        input: p.input, output, png, uuid: args.uuid, name: args.name,
        expectedSha256: p.expectedSha256,
      });
      return { receipt, ...await register(output) };
    },
    exportPng: async (args) => {
      const p = selected(args);
      const output = await outputPath(args.output, '.png');
      return p.exportPng({ output, textureUuid: args.textureUuid });
    },
    exportGeometry: async (args) => {
      const p = selected(args);
      const output = await outputPath(args.output, '.geo.json');
      return p.exportGeometry({ output });
    },
  });
  async function execute({ code } = {}) {
    if (typeof code !== 'string' || !code.trim() ||
        Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
      throw new TypeError('CODE_MODE_SCRIPT_INVALID_OR_OVERSIZE');
    }
    if (activeExecution) {
      throw new Error('CODE_MODE_HOST_BUSY');
    }
    const execution = { closed: false, pendingApproval: false, pause: () => {}, resume: () => {} };
    activeExecution = execution;
    try {
    const start = JSON.stringify({
      type: 'start', code,
      initial: initialRef,
    }) + '\n';
    if (Buffer.byteLength(start, 'utf8') > MAX_RPC_BYTES) {
      throw new Error('CODE_MODE_START_TOO_LARGE');
    }
    const createChild = spawnImpl ?? spawn;
    const child = createChild(denoBinary, [...DENO_FLAGS, WORKER], {
      // Guest never needs the user's model directory as its working path.
      cwd: tmpdir(), shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Never export an agent's credentials, HOME, PATH or system secrets.
      env: {
        DENO_NO_UPDATE_CHECK: '1', DENO_NO_PROMPT: '1', NO_COLOR: '1',
        ...(process.platform === 'win32'
          ? { SystemRoot: process.env.SystemRoot ?? '',
            WINDIR: process.env.WINDIR ?? '' } : {}),
      },
    });
    return await new Promise((resolve, reject) => {
      let closed = false;
      let concluded = null;
      let failure = null;
      let buffered = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let calls = 0;
      let pendingRpc = 0;
      let chain = Promise.resolve();
      const decoder = new StringDecoder('utf8');
      let remaining = TIMEOUT_MS;
      let timer = null;
      let approvalTimer = null;
      let tick = 0;
      function abortWith(code) {
        if (execution.closed) return;
        failure = new Error(code);
        execution.closed = true;
        child.kill();
      }
      function resumeClock() {
        clearTimeout(approvalTimer);
        approvalTimer = null;
        execution.pendingApproval = false;
        if (execution.closed) return;
        if (remaining <= 0) return abortWith('CODE_MODE_OUTCOME_UNKNOWN_TIMEOUT');
        tick = Date.now();
        timer = setTimeout(
          () => abortWith('CODE_MODE_OUTCOME_UNKNOWN_TIMEOUT'), remaining);
      }
      function pauseClock() {
        if (execution.closed) return;
        execution.pendingApproval = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
          remaining = Math.max(0, remaining - (Date.now() - tick));
        }
        approvalTimer = setTimeout(
          () => abortWith('CODE_MODE_OPERATOR_APPROVAL_TIMEOUT'),
          APPROVAL_TIMEOUT_MS,
        );
      }
      execution.pause = pauseClock;
      execution.resume = resumeClock;
      resumeClock();
      function send(response) {
        const data = JSON.stringify(response) + '\n';
        if (Buffer.byteLength(data, 'utf8') > MAX_RPC_BYTES) {
          throw new Error('CODE_MODE_RPC_RESPONSE_TOO_LARGE');
        }
        if (!closed && !child.stdin.destroyed) child.stdin.write(data);
      }
      async function processMessage(line) {
        if (!line || Buffer.byteLength(line, 'utf8') > MAX_RPC_BYTES) {
          throw new Error('CODE_MODE_RPC_MESSAGE_INVALID');
        }
        let message;
        try { message = JSON.parse(line); }
        catch { throw new Error('CODE_MODE_RPC_MESSAGE_INVALID'); }
        if (!message || typeof message !== 'object' ||
            Array.isArray(message)) {
          throw new Error('CODE_MODE_RPC_MESSAGE_INVALID');
        }
        if (message.type === 'done') {
          if (concluded !== null) throw new Error('CODE_MODE_DUPLICATE_RESULT');
          const resultBytes = Buffer.byteLength(
            JSON.stringify(message.value ?? null), 'utf8');
          const logs = message.logs;
          if (resultBytes > 32 * 1024 ||
              (logs !== undefined && (
                !Array.isArray(logs) || logs.length > 12 ||
                logs.some((log) => typeof log !== 'string') ||
                Buffer.byteLength(JSON.stringify(logs), 'utf8') > 4096))) {
            throw new Error('CODE_MODE_FINAL_RESULT_TOO_LARGE');
          }
          concluded = message;
          return;
        }
        // A queued final result is safe to consume after the child has
        // exited. A new RPC is not: no guest remains to receive its reply.
        if (execution.closed) {
          throw new Error('CODE_MODE_GUEST_SESSION_CLOSED');
        }
        if (message.type !== 'rpc' || concluded !== null ||
            !Number.isSafeInteger(message.id) || message.id < 1 ||
            typeof message.method !== 'string' ||
            !Object.hasOwn(actions, message.method) ||
            !Array.isArray(message.args) || message.args.length !== 1) {
          throw new Error('CODE_MODE_RPC_NOT_ALLOWED');
        }
        if (++calls > MAX_CALLS) {
          throw new Error('CODE_MODE_RPC_BUDGET_EXCEEDED');
        }
        pendingRpc++;
        try {
          try {
            const value = await actions[message.method](
              requireObject(message.args[0]));
            send({ type: 'rpc_result', id: message.id, ok: true, result: value });
          } catch (error) {
            send({ type: 'rpc_result', id: message.id, ok: false,
              code: shortError(error) });
          }
        } finally {
          pendingRpc--;
        }
      }
      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          failure = new Error('CODE_MODE_OUTPUT_LIMIT_REACHED');
          child.kill();
          return;
        }
        buffered += decoder.write(chunk);
        for (;;) {
          const at = buffered.indexOf('\n');
          if (at === -1) break;
          const line = buffered.slice(0, at);
          buffered = buffered.slice(at + 1);
          if (Buffer.byteLength(line, 'utf8') > MAX_RPC_BYTES) {
            failure = new Error('CODE_MODE_RPC_LINE_TOO_LARGE');
            child.kill();
            return;
          }
          chain = chain.then(() => processMessage(line)).catch((error) => {
            failure = error;
            child.kill();
          });
        }
        // A data event may coalesce many short frames; bound the remaining
        // partial line, not their concatenation before framing.
        if (Buffer.byteLength(buffered, 'utf8') > MAX_RPC_BYTES) {
          failure = new Error('CODE_MODE_RPC_LINE_TOO_LARGE');
          child.kill();
        }
      });
      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 4096) {
          failure = new Error('CODE_MODE_GUEST_STDERR_LIMIT');
          child.kill();
        }
      });
      child.stdin.on('error', () => {
        if (!failure) failure = new Error('CODE_MODE_OUTCOME_UNKNOWN_STDIN');
      });
      child.on('error', (error) => {
        failure = new Error('CODE_MODE_DENO_UNAVAILABLE', { cause: error });
      });
      child.on('close', (code, signal) => {
        closed = true;
        execution.closed = true;
        clearTimeout(timer);
        clearTimeout(approvalTimer);
        // A child that exits with any RPC still pending has an unknown
        // effect outcome. Never wait on an approval that might never return.
        // Late approvals are invalidated by the execution identity check.
        if (failure) return reject(failure);
        if (pendingRpc > 0) {
          return reject(new Error('CODE_MODE_OUTCOME_UNKNOWN_PENDING_RPC'));
        }
        void chain.then(() => {
          // A queued frame may fail after 'close' but before the promise
          // chain settles; never turn a rejected RPC into success.
          if (failure) return reject(failure);
          if (signal || code !== 0) {
            return reject(new Error(
              concluded?.error ?? 'CODE_MODE_OUTCOME_UNKNOWN_EXIT'));
          }
          if (concluded === null || Object.hasOwn(concluded, 'error')) {
            return reject(new Error(
              concluded?.error ?? 'CODE_MODE_NO_RESULT'));
          }
          resolve(Object.freeze({
            status: 'OK', value: concluded.value ?? null,
            logs: Array.isArray(concluded.logs) ?
              concluded.logs.slice(0, 12) : [],
            rpc_calls: calls,
          }));
        }).catch(reject);
      });
      child.stdin.write(start);
    });
    } finally {
      execution.closed = true;
      if (activeExecution === execution) activeExecution = null;
    }
  }
  return Object.freeze({
    execute,
    initial: initialRef,
  });
}


/**
 * Single model-visible entrypoint descriptor for an operator's agent host.
 * This does not register an MCP server, expose an extra public Gateway tool,
 * or create an independently privileged code runner.
 */
export function createCodeModeTool(host) {
  if (!host || typeof host.execute !== 'function') {
    throw new TypeError('A trusted Code Mode host is required');
  }
  return Object.freeze({
    name: 'lazydesigner_code_mode',
    description: 'Execute bounded JavaScript against the approved Rust model via the isolated Code Mode guest. Use codemode.initial, codemode.inspectBatch, codemode.apply and other typed APIs; writes require independent host approval. No filesystem/network/shell access in the guest. Always report native visual results as UNVERIFIED without observation.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: { code: { type: 'string', minLength: 1, maxLength: 32768 } },
    }),
    execute: ({ code }) => host.execute({ code }),
  });
}

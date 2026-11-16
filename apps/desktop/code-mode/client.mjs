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
const WRITE_COMMANDS = new Set([
  'new', 'apply', 'import-png', 'export-png', 'export-geometry', 'export-animation',
]);

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
// Exact source-pixel bounds, not artistic reference or user approval.
function normalizedCorrectionScope(scope) {
  if (scope === undefined) return undefined;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) ||
      Object.keys(scope).some(key =>
        !['textureUuid', 'allowedRegions', 'preserveAlpha'].includes(key))) {
    throw new TypeError('CORRECTION_SCOPE_INVALID');
  }
  const textureUuid = nonempty(scope.textureUuid, 'textureUuid');
  if (Buffer.byteLength(textureUuid, 'utf8') > 128 || /\s/.test(textureUuid) ||
      !Array.isArray(scope.allowedRegions) ||
      scope.allowedRegions.length < 1 || scope.allowedRegions.length > 16 ||
      (scope.preserveAlpha !== undefined && typeof scope.preserveAlpha !== 'boolean')) {
    throw new TypeError('CORRECTION_SCOPE_INVALID');
  }
  const rectangles = scope.allowedRegions.map(rect => {
    if (!rect || typeof rect !== 'object' || Array.isArray(rect) ||
        Object.keys(rect).some(key => !['from', 'to'].includes(key))) {
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    const point = value => {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new TypeError('CORRECTION_SCOPE_INVALID');
      }
      return value.map(n => Number(wholeNumber(n, 'coordinate', 0, 256)));
    };
    const from = point(rect.from), to = point(rect.to);
    if (from[0] >= to[0] || from[1] >= to[1]) {
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    return {from, to};
  });
  return {texture_uuid:textureUuid, allowed_regions:rectangles,
    preserve_alpha:scope.preserveAlpha ?? false};
}
function serializePlan(operations, correctionScope) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 128) {
    throw new TypeError('operations must contain 1 through 128 typed Rust operations');
  }
  const scope = normalizedCorrectionScope(correctionScope);
  const payload = JSON.stringify({ expected_revision: 0, operations,
    ...(scope ? {correction_scope:scope} : {}),
  }, (_key, value) => {
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

// Multiple focused read selectors, using one Rust document load. The program
// host still owns filesystem permissions; this is not an OS sandbox.
const INSPECTION_QUERY_FIELDS = Object.freeze({
  cube: ['uuid'],
  cube_surfaces: ['uuid'],
  cube_face_alpha: ['uuid'],
  cube_uv_sharing: ['uuid', 'texture_uuid'],
  asset_handoff: ['texture_uuid', 'offset', 'limit'],
  model_texture_coverage: ['offset', 'limit', 'attention_only'],
  material_pair: ['reference_uuid', 'candidate_uuid', 'reference_region', 'candidate_region'],
  catalog: ['category', 'offset', 'limit'],
  texture: ['index'],
  texture_alpha: ['uuid'],
  animation: ['uuid'],
  animation_track: ['animation_uuid', 'bone_uuid', 'offset', 'limit'],
  animation_transform_track: ['animation_uuid', 'bone_uuid', 'channel', 'offset', 'limit'],
  animation_effect_events: ['animation_uuid', 'offset', 'limit'],
  animation_timeline_markers: ['animation_uuid', 'offset', 'limit'],
  audit: [],
});

// Exact cropped atlas evidence. Identical physical dimensions are enforced in Rust.
// Region limits match the existing owned 256x256 RGBA8 Paint decoder.
function materialPatchRegion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['from', 'to'].includes(key))) {
    throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
  }
  const point = xy => {
    if (!Array.isArray(xy) || xy.length !== 2) {
      throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
    }
    return xy.map(n => Number(wholeNumber(n, 'material coordinate', 0, 256)));
  };
  const from = point(value.from), to = point(value.to);
  if (from[0] >= to[0] || from[1] >= to[1]) {
    throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
  }
  if ((to[0]-from[0])*(to[1]-from[1]) > 4096) {
    throw new TypeError('MATERIAL_PAIR_REGION_TOO_LARGE');
  }
  return {from, to};
}
function serializeInspectionQueries(requests) {
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 8) {
    throw new TypeError('Inspection batch must contain 1 through 8 selectors');
  }
  const selected = requests.map((query) => {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new TypeError('Inspection selector must be an object');
    }
    const kind = nonempty(query.kind, 'kind');
    const allowed = Object.hasOwn(INSPECTION_QUERY_FIELDS, kind)
      ? INSPECTION_QUERY_FIELDS[kind] : null;
    if (!allowed || Object.keys(query).some((key) =>
      key !== 'kind' && !allowed.includes(key))) {
      throw new TypeError('Unknown inspection selector or field');
    }
    const output = { kind };
    for (const field of allowed) {
      if (query[field] === undefined) continue;
      const value = query[field];
      if (field === 'offset' || field === 'limit' || field === 'index') {
        output[field] = Number(wholeNumber(
          value, field, field === 'limit' ? 1 : 0,
          field === 'limit' ? (kind === 'model_texture_coverage' ? 8 :
            kind === 'animation_effect_events' ? 16 :
            kind === 'animation_timeline_markers' || kind === 'asset_handoff' ? 32 : 64) :
            (field === 'offset' && kind === 'asset_handoff' ? 393216 : 65536),
        ));
      } else if (field === 'attention_only') {
        if (typeof value !== 'boolean') {
          throw new TypeError('Inspection attention_only must be a boolean');
        }
        output.attention_only = value;
      } else if (field === 'channel') {
        if (!['rotation', 'position', 'scale'].includes(value)) {
          throw new TypeError('Unsupported transform channel');
        }
        output.channel = value;
      } else if (field === 'category') {
        if (!['cubes', 'bones', 'textures', 'animations'].includes(value)) {
          throw new TypeError('Unknown catalog category');
        }
        output.category = value;
      } else if (field === 'reference_region' || field === 'candidate_region') {
        output[field] = materialPatchRegion(value);
      } else {
        output[field] = nonempty(value, field);
        if (Buffer.byteLength(output[field], 'utf8') > 128) {
          throw new TypeError('Inspection UUID is too long');
        }
      }
    }
    for (const field of allowed) {
      if (!['offset', 'limit', 'attention_only'].includes(field) && output[field] === undefined) {
        throw new TypeError('Missing required inspection selector field: ' + field);
      }
    }
    return output;
  });
  const encoded = JSON.stringify({ requests: selected });
  if (Buffer.byteLength(encoded, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('INSPECT_BATCH_SIZE_INVALID');
  }
  return encoded;
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
export function createRustCodeModeClient({
  binary, runner, authorizeMutation, permitWriteLaunch,
} = {}) {
  absolute(binary, 'binary');
  if (runner !== undefined && typeof runner !== 'function') {
    throw new TypeError('runner must be a function supplied by a trusted host');
  }
  if (authorizeMutation !== undefined && typeof authorizeMutation !== 'function') {
    throw new TypeError('authorizeMutation must be a trusted-host function');
  }
  if (permitWriteLaunch !== undefined && typeof permitWriteLaunch !== 'function') {
    throw new TypeError('permitWriteLaunch must be a synchronous trusted-host function');
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
    return descriptor;
  }
  async function call(command, options, approval) {
    const args = optionArgs(command, options);
    if (WRITE_COMMANDS.has(command)) {
      if (!approval) {
        throw new Error('CODE_MODE_MUTATION_AUTHORITY_REQUIRED');
      }
      // Synchronous final lease check immediately before invoking Rust.
      // Apply performs async plan-file I/O AFTER operator approval; a guest
      // may have exited during that gap. Never launch from a stale session.
      if (permitWriteLaunch !== undefined &&
          permitWriteLaunch(approval) !== true) {
        throw new Error('CODE_MODE_MUTATION_SESSION_STALE');
      }
    }
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
      const approval = await requestWrite('newModel', {
        output: options.output, name: options.name,
        modelIdentifier: options['model-identifier'],
      });
      return call('new', options, approval);
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
    async inspectBatch({ input, expectedSha256, requests }) {
      const source = absolute(input, 'input');
      const digest = hash(expectedSha256);
      const payload = serializeInspectionQueries(requests);
      // Query-only data, not an edit plan. Temporary file is private and is
      // cleaned even if the Rust process reports a refusal or fails.
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-read-batch-'));
      const file = join(directory, 'queries.json');
      try {
        await writeFile(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return await call('inspect-batch', {
          input: source, queries: file, 'expected-sha256': digest,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
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
    async inspectAnimationTransformTrack({
      input, animationUuid, boneUuid, channel, offset = 0, limit = 32, expectedSha256,
    }) {
      if (!['rotation', 'position', 'scale'].includes(channel)) {
        throw new TypeError('Unsupported transform channel');
      }
      return call('inspect', {
        input: absolute(input, 'input'),
        'animation-uuid': nonempty(animationUuid, 'animationUuid'),
        'bone-uuid': nonempty(boneUuid, 'boneUuid'),
        'track-channel': channel,
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
    async apply({ input, output, expectedSha256, operations, correctionScope }) {
      const options = {
        input: absolute(input, 'input'),
        output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const payload = serializePlan(operations, correctionScope);
      const scope = normalizedCorrectionScope(correctionScope);
      const approval = await requestWrite('apply', {
        input: options.input, output: options.output,
        expectedSha256: options['expected-sha256'],
        operationCount: operations.length,
        operationKinds: Object.freeze(operations.map((op) => op?.op ?? null)),
        ...(scope ? { correctionScope: Object.freeze({
          textureUuid:scope.texture_uuid,
          allowedRegions:Object.freeze(scope.allowed_regions.map(rect => Object.freeze({
            from:Object.freeze([...rect.from]), to:Object.freeze([...rect.to]),
          }))),
          regionCount:scope.allowed_regions.length,
          preserveAlpha:scope.preserve_alpha,
        }) } : {}),
        planSha256: createHash('sha256').update(payload).digest('hex'),
      });
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-code-mode-'));
      const file = join(directory, 'edit.plan.json');
      try {
        await writeFile(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return await call('apply', { ...options, plan: file }, approval);
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
      const approval = await requestWrite('importPng', {
        input: options.input, output: options.output, png: options.png,
        uuid: options.uuid, expectedSha256: options['expected-sha256'],
      });
      return call('import-png', options, approval);
    },
    async exportPng({ input, output, textureUuid, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'texture-uuid': nonempty(textureUuid, 'textureUuid'),
        'expected-sha256': hash(expectedSha256),
      };
      const approval = await requestWrite('exportPng', {
        input: options.input, output: options.output,
        textureUuid: options['texture-uuid'], expectedSha256: options['expected-sha256'],
      });
      return call('export-png', options, approval);
    },
    async exportGeometry({ input, output, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const approval = await requestWrite('exportGeometry', {
        input: options.input, output: options.output,
        expectedSha256: options['expected-sha256'],
      });
      return call('export-geometry', options, approval);
    },
    async exportAnimations({ input, output, expectedSha256 }) {
      const options = {
        input: absolute(input, 'input'), output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const approval = await requestWrite('exportAnimations', {
        input: options.input, output: options.output,
        expectedSha256: options['expected-sha256'],
      });
      return call('export-animation', options, approval);
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
    inspectBatch: (requests) =>
      client.inspectBatch({ input: path, expectedSha256, requests }),
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
    inspectAnimationTransformTrack: (animationUuid, boneUuid, channel, { offset = 0, limit = 32 } = {}) =>
      client.inspectAnimationTransformTrack({
        input: path, animationUuid, boneUuid, channel, offset, limit, expectedSha256,
      }),
    apply: ({ output, operations, correctionScope }) =>
      client.apply({ input: path, output, expectedSha256, operations, correctionScope }),
    exportPng: ({ output, textureUuid }) =>
      client.exportPng({ input: path, output, textureUuid, expectedSha256 }),
    exportGeometry: ({ output }) =>
      client.exportGeometry({ input: path, output, expectedSha256 }),
    exportAnimations: ({ output }) =>
      client.exportAnimations({ input: path, output, expectedSha256 }),
  });
}

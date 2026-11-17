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
import {normalizedMaterialWorkPacket,materialWorkPacketDigest} from './material-work-packet.mjs';

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
export function normalizedCorrectionScope(scope) {
  if (scope === undefined) return undefined;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) ||
      Object.keys(scope).some(key =>
        !['textureUuid', 'allowedRegions', 'preserveAlpha',
          'protectedRegions','expectedBeforePixels','editableBeforeRgba'].includes(key))) {
    throw new TypeError('CORRECTION_SCOPE_INVALID');
  }
  const textureUuid = nonempty(scope.textureUuid, 'textureUuid');
  if (Buffer.byteLength(textureUuid, 'utf8') > 128 || /\s/.test(textureUuid) ||
      !Array.isArray(scope.allowedRegions) ||
      scope.allowedRegions.length < 1 || scope.allowedRegions.length > 16 ||
      (scope.preserveAlpha !== undefined && typeof scope.preserveAlpha !== 'boolean')) {
    throw new TypeError('CORRECTION_SCOPE_INVALID');
  }
  const point = (value,max) => {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    return value.map(n => Number(wholeNumber(n, 'coordinate', 0, max)));
  };
  const rectangle = rect => {
    if (!rect || typeof rect !== 'object' || Array.isArray(rect) ||
        Object.keys(rect).some(key => !['from','to'].includes(key))) {
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    const from = point(rect.from,256),to = point(rect.to,256);
    if(from[0]>=to[0]||from[1]>=to[1]){
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    return {from,to};
  };
  const rectangles=scope.allowedRegions.map(rectangle);
  let protectedRegions;
  if(scope.protectedRegions!==undefined){
    if(!Array.isArray(scope.protectedRegions) ||
       scope.protectedRegions.length>16){
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    protectedRegions=scope.protectedRegions.map(rectangle);
  }
  let expectedBeforePixels;
  if(scope.expectedBeforePixels!==undefined){
    if(!Array.isArray(scope.expectedBeforePixels) ||
       scope.expectedBeforePixels.length>64){
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    const seen=new Set();
    expectedBeforePixels=scope.expectedBeforePixels.map(entry=>{
      if(!entry || typeof entry!=='object' || Array.isArray(entry) ||
         Object.keys(entry).some(key=>!['at','rgba'].includes(key)) ||
         !Array.isArray(entry.rgba) || entry.rgba.length!==4){
        throw new TypeError('CORRECTION_SCOPE_INVALID');
      }
      const at=point(entry.at,255);
      if(!entry.rgba.every(n=>Number.isInteger(n)&&n>=0&&n<=255)){
        throw new TypeError('CORRECTION_SCOPE_INVALID');
      }
      const key=at.join(',');
      if(seen.has(key))throw new TypeError('CORRECTION_SCOPE_INVALID');
      seen.add(key);
      return {at,rgba:[...entry.rgba]};
    });
  }
  let editableBeforeRgba;
  if(scope.editableBeforeRgba!==undefined){
    if(!Array.isArray(scope.editableBeforeRgba) ||
       scope.editableBeforeRgba.length<1 ||
       scope.editableBeforeRgba.length>16){
      throw new TypeError('CORRECTION_SCOPE_INVALID');
    }
    const seen=new Set();
    editableBeforeRgba=scope.editableBeforeRgba.map(rgba=>{
      if(!Array.isArray(rgba)||rgba.length!==4 ||
         !rgba.every(v=>Number.isInteger(v)&&v>=0&&v<=255)){
        throw new TypeError('CORRECTION_SCOPE_INVALID');
      }
      const key=rgba.join(',');
      if(seen.has(key))throw new TypeError('CORRECTION_SCOPE_INVALID');
      seen.add(key);
      return [...rgba];
    });
  }
  return {texture_uuid:textureUuid, allowed_regions:rectangles,
    preserve_alpha:scope.preserveAlpha ?? false,
    ...(protectedRegions===undefined?{}:{protected_regions:protectedRegions}),
    ...(expectedBeforePixels===undefined?{}:{expected_before_pixels:expectedBeforePixels}),
    ...(editableBeforeRgba===undefined?{}:{editable_before_rgba:editableBeforeRgba})};
}
// Descriptive diagnosis only. No self-certifying visual quality claim.
const CORRECTION_MATERIALS = new Set([
  'metal','wood','stone','cloth','skin','glass','other',
]);
const CORRECTION_TREATMENTS = new Set([
  'form_value_masses','contact_shadows','hand_painted_clusters',
  'palette_roles','alpha_silhouette','artwork_footprint',
]);
export function normalizedMaterialCorrectionIntent(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => ![
        'issueId','approachId','partId','material','cause','treatment',
        'expectedChange',
      ].includes(key))) {
    throw new TypeError('MATERIAL_CORRECTION_INTENT_INVALID');
  }
  const token = input => typeof input === 'string' &&
    /^[a-z][a-z0-9_-]{0,63}$/.test(input);
  const statement = input => typeof input === 'string' &&
    input.length >= 16 && input.length <= 240 &&
    input.trim() === input && !/[\x00-\x1f\x7f]/.test(input);
  if (!token(value.issueId) || !token(value.approachId) ||
      !token(value.partId) ||
      !CORRECTION_MATERIALS.has(value.material) ||
      !CORRECTION_TREATMENTS.has(value.treatment) ||
      !statement(value.cause) || !statement(value.expectedChange)) {
    throw new TypeError('MATERIAL_CORRECTION_INTENT_INVALID');
  }
  return Object.freeze({
    issueId:value.issueId, approachId:value.approachId,
    partId:value.partId, material:value.material,
    cause:value.cause, treatment:value.treatment,
    expectedChange:value.expectedChange,
  });
}

function serializePlan(operations, normalizedScope) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 128) {
    throw new TypeError('operations must contain 1 through 128 typed Rust operations');
  }
  // The SDK caller already normalized the scope once; serialize exactly
  // those admitted bytes. Rust independently validates the edit plan.
  const payload = JSON.stringify({ expected_revision: 0, operations,
    ...(normalizedScope ? {correction_scope:normalizedScope} : {}),
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

// Require a native *matched* correction receipt before any scoped Paint
// call can be reported as successful to Code Mode. Rust may already have
// published its no-overwrite sibling when a malformed success is observed:
// do NOT auto-retry, remove that file or pretend its provenance is known.
function checkedScopedApplyReceipt(receipt,scope,expectedSourceSha,operationCount) {
  if (!scope) return receipt;
  const verified=receipt?.correction_scope;
  const count=(field,values)=>verified?.[field] === (values?.length??0);
  if (receipt?.source_sha256!==expectedSourceSha.toLowerCase() ||
      receipt?.mutation?.operation_count!==operationCount ||
      !Number.isSafeInteger(receipt?.mutation?.revision) ||
      receipt.mutation.revision<1 ||
      receipt?.summary?.revision!==receipt.mutation.revision ||
      typeof receipt?.output_sha256!=='string' ||
      !SHA256.test(receipt.output_sha256) ||
      verified?.status!=='enforced' ||
      verified.texture_uuid!==scope.texture_uuid ||
      verified.visual_verdict!=='UNVERIFIED' ||
      !count('protected_regions',scope.protected_regions) ||
      !count('expected_before_pixels',scope.expected_before_pixels) ||
      !count('editable_before_rgba',scope.editable_before_rgba)) {
    throw new Error('CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED');
  }
  return receipt;
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
  material_face_patch: ['texture_uuid','cube_uuid','face','region','face_spans'],
  texture_styling: ['texture_uuid','region'],
  texture_source_colors: ['texture_uuid','region'],
  texture_styling_face: ['texture_uuid','cube_uuid','face'],
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
      } else if (field === 'face_spans') {
        // Exact face-local row spans; only Rust maps them through rotated UV.
        if(kind!=='material_face_patch' || !Array.isArray(value) ||
           value.length<1 || value.length>64) {
          throw new TypeError('MATERIAL_FACE_SPANS_INVALID');
        }
        output.face_spans=value.map(span=>{
          if(!span || typeof span!=='object' || Array.isArray(span) ||
             Object.keys(span).some(key=>!['y','x0','x1'].includes(key)) ||
             !['y','x0','x1'].every(key=>Number.isInteger(span[key])) ||
             span.y<0 || span.y>=256 || span.x0<0 || span.x0>=span.x1 ||
             span.x1>256) {
            throw new TypeError('MATERIAL_FACE_SPANS_INVALID');
          }
          return {y:span.y,x0:span.x0,x1:span.x1};
        });
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
      } else if (field === 'reference_region' || field === 'candidate_region' ||
                 field === 'region') {
        output[field] = materialPatchRegion(value);
      } else if (field === 'face') {
        if (!['north','east','south','west','up','down'].includes(value)) {
          throw new TypeError('MATERIAL_FACE_SIDE_UNKNOWN');
        }
        output.face = value;
      } else {
        output[field] = nonempty(value, field);
        if (Buffer.byteLength(output[field], 'utf8') > 128) {
          throw new TypeError('Inspection UUID is too long');
        }
        if (['material_face_patch','texture_styling_face',
             'texture_source_colors'].includes(kind) &&
            (field === 'texture_uuid' || field === 'cube_uuid') &&
            /[\s\x00-\x1f\x7f]/.test(output[field])) {
          throw new TypeError('MATERIAL_FACE_UUID_INVALID');
        }
      }
    }
    for (const field of allowed) {
      if (!['offset', 'limit', 'attention_only', 'face_spans'].includes(field) && output[field] === undefined) {
        throw new TypeError('Missing required inspection selector field: ' + field);
      }
    }
    return output;
  });
  const encoded = JSON.stringify({ requests: selected });
  if (Buffer.byteLength(encoded, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('INSPECT_BATCH_SIZE_INVALID');
  }
  return { payload: encoded, normalized: selected };
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
      const { payload, normalized } = serializeInspectionQueries(requests);
      // A SHA-bound Rust inspect-batch is one immutable model read. Repeated
      // byte-identical normalized selectors within THAT batch need only one
      // calculation. Never cache across calls: native Rust must verify the
      // current disk/source SHA for every new inspection.
      const positions = [];
      const unique = [];
      const seen = new Map();
      for (const query of normalized) {
        const key = JSON.stringify(query);
        if (!seen.has(key)) {
          seen.set(key, unique.length);
          unique.push(query);
        }
        positions.push(seen.get(key));
      }
      const duplicates = unique.length !== normalized.length;
      const forwarded = duplicates ? JSON.stringify({ requests: unique }) : payload;
      // Query-only data, not an edit plan. Temporary file is private and is
      // cleaned even if the Rust process reports a refusal or fails.
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-read-batch-'));
      const file = join(directory, 'queries.json');
      try {
        await writeFile(file, forwarded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const receipt = await call('inspect-batch', {
          input: source, queries: file, 'expected-sha256': digest,
        });
        if (!duplicates) return receipt;
        // A trusted-Rust receipt must have the same pinned model identity
        // and one result for every unique selector, in the original order.
        // Never turn a malformed/truncated receipt into synthetic evidence.
        if (typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest.toLowerCase() ||
            !Array.isArray(receipt.results) ||
            receipt.results.length !== unique.length ||
            receipt.results.some((item, i) => !item ||
              typeof item !== 'object' || Array.isArray(item) ||
              item.kind !== unique[i].kind)) {
          throw new Error('CODE_MODE_INSPECT_BATCH_RECEIPT_INVALID');
        }
        // Independent JSON values prevent a guest mutation of one repeated
        // entry from silently modifying the other. Preserve the native 96 KiB
        // result-array budget after positional re-expansion, not just before.
        let expanded;
        try {
          expanded = positions.map(index =>
            JSON.parse(JSON.stringify(receipt.results[index])));
        } catch {
          throw new Error('CODE_MODE_INSPECT_BATCH_RECEIPT_INVALID');
        }
        if (Buffer.byteLength(JSON.stringify(expanded), 'utf8') > 96 * 1024) {
          throw new Error('CODE_MODE_INSPECT_BATCH_RESULT_TOO_LARGE');
        }
        return { ...receipt, results: expanded };
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
    async apply({ input, output, expectedSha256, operations, correctionScope, correctionIntent, materialWorkPacket }) {
      const options = {
        input: absolute(input, 'input'),
        output: absolute(output, 'output'),
        'expected-sha256': hash(expectedSha256),
      };
      const scope = normalizedCorrectionScope(correctionScope);
      const payload = serializePlan(operations, scope);
      const intent = normalizedMaterialCorrectionIntent(correctionIntent);
      const workPacket=normalizedMaterialWorkPacket(materialWorkPacket);
      if(workPacket && (workPacket.sourceModelSha256!==options['expected-sha256'] ||
          workPacket.textureUuid!==scope?.texture_uuid)) {
        throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_SOURCE_MISMATCH');
      }
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
          ...(scope.protected_regions?{
            protectedRegions:Object.freeze(scope.protected_regions.map(rect=>
              Object.freeze({from:Object.freeze([...rect.from]),
                to:Object.freeze([...rect.to])}))),
          }:{}),
          ...(scope.expected_before_pixels?{
            expectedBeforePixels:Object.freeze(scope.expected_before_pixels.map(pixel=>
              Object.freeze({at:Object.freeze([...pixel.at]),
                rgba:Object.freeze([...pixel.rgba])}))),
          }:{}),
          ...(scope.editable_before_rgba?{
            editableBeforeRgba:Object.freeze(scope.editable_before_rgba.map(rgba=>
              Object.freeze([...rgba]))),
          }:{}),
        }) } : {}),
        ...(intent ? {
          materialCorrectionIntent:intent,
          materialIntentSha256:createHash('sha256')
            .update(JSON.stringify(intent)).digest('hex'),
        } : {}),
        ...(workPacket?{
          materialWorkPacket:workPacket,
          materialWorkPacketSha256:materialWorkPacketDigest(workPacket),
        }:{}),
        planSha256: createHash('sha256').update(payload).digest('hex'),
      });
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-code-mode-'));
      const file = join(directory, 'edit.plan.json');
      try {
        await writeFile(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const receipt=await call('apply', { ...options, plan: file }, approval);
        return checkedScopedApplyReceipt(
          receipt,scope,options['expected-sha256'],operations.length);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    /** SHA-bound read-only external image comparison. Paths come only from
     * the trusted host, never from model-written JavaScript. */
    async inspectVisualPair({
      input, expectedSha256, referencePng, capturePng,
      referenceSha256, captureSha256,
    }) {
      return call('inspect-visual-pair', {
        input: absolute(input, 'input'),
        'expected-sha256': hash(expectedSha256),
        reference: absolute(referencePng, 'referencePng'),
        'reference-sha256': hash(referenceSha256),
        capture: absolute(capturePng, 'capturePng'),
        'capture-sha256': hash(captureSha256),
      });
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
    apply: ({ output, operations, correctionScope, correctionIntent, materialWorkPacket }) =>
      client.apply({ input: path, output, expectedSha256, operations, correctionScope, correctionIntent, materialWorkPacket }),
    exportPng: ({ output, textureUuid }) =>
      client.exportPng({ input: path, output, textureUuid, expectedSha256 }),
    exportGeometry: ({ output }) =>
      client.exportGeometry({ input: path, output, expectedSha256 }),
    exportAnimations: ({ output }) =>
      client.exportAnimations({ input: path, output, expectedSha256 }),
  });
}

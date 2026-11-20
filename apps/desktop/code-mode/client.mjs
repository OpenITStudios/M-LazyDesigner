/**
 * Rust-first Code Mode SDK for a trusted local agent code runner.
 * Model-written JavaScript is executed by the host, NOT by this module.
 * Only first-party, bounded CLI operations cross into the Rust authoring core.
 * Source-authored; local/native execution NOT_EXECUTED.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {normalizedMaterialWorkPacket,materialWorkPacketDigest} from './material-work-packet.mjs';
import {validGeometryImpact} from './geometry-impact.mjs';
import {PLAN_LIMIT,SHA256,nonempty,wholeNumber} from './sdk-inputs.mjs';
import {
  normalizedCorrectionScope, normalizedMaterialCorrectionIntent, checkedScopedApplyReceipt,
} from './texture-correction-contract.mjs';
import {createGeometryProposalSdkMethods} from './geometry-proposal-sdk-methods.mjs';
import {serializeSemanticMaterialIntent} from './semantic-material-intent-transport.mjs';

// Preserve the exact public SDK imports used by external trusted hosts.
export {normalizedCorrectionScope, normalizedMaterialCorrectionIntent};
import {serializeInspectionQueries} from './inspection-selectors.mjs';
import {serializePeriodicRotation,validPeriodicRotationReceipt} from './periodic-rotation.mjs';
import {serializeSemanticAnimation,validSemanticAnimationReceipt} from './semantic-animation.mjs';
import {serializeExistingAnimationIntent,validExistingAnimationReviewReceipt} from './existing-animation-review.mjs';

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 128 * 1024;
const WRITE_COMMANDS = new Set([
  'new', 'apply', 'import-png', 'export-png', 'export-geometry', 'export-animation',
]);

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
  binary, runner, authorizeMutation, permitWriteLaunch, onNativeCall,
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
  if (onNativeCall !== undefined && typeof onNativeCall !== 'function') {
    throw new TypeError('onNativeCall must be a trusted-host function');
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
    // Measure only the admitted first-party Rust transport call; plan-file
    // preparation, approval, inspection processing and UI wait are separate.
    // Never pass arguments, paths, model bytes or approval descriptors to
    // the metric observer. A broken observer cannot change actual behavior.
    const began = performance.now();
    let ok = false;
    try {
      const result = await invoke(args);
      // The default process runner validates JSON on success and on error.
      // Trusted test runners return objects directly.
      if (!result || result.status !== 'OK') {
        throw new Error(typeof result?.code === 'string' ? result.code : 'CODE_MODE_CLI_FAILURE');
      }
      ok = true;
      return result;
    } finally {
      if (onNativeCall) {
        try {
          onNativeCall(Object.freeze({
            command,
            duration_ms: Math.max(0, Math.round(performance.now() - began)),
            success: ok,
          }));
        } catch {
          // Telemetry is strictly non-authoritative and best-effort.
        }
      }
    }
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
        // Every batch needs the same Rust source/selector receipt checks.
        // Previously the non-duplicate path returned early, bypassing them.
        // A successful CLI status alone is not evidence for a requested read.
        if (typeof receipt?.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest.toLowerCase() ||
            !Array.isArray(receipt.results) ||
            receipt.results.length !== unique.length ||
            receipt.results.some((item, i) => !item ||
              typeof item !== 'object' || Array.isArray(item) ||
              item.kind !== unique[i].kind)) {
          throw new Error('CODE_MODE_INSPECT_BATCH_RECEIPT_INVALID');
        }
        // Source relationships are advisory only. An untrusted/forged
        // answer must never promote itself into a write or visual verdict.
        for (let i = 0; i < unique.length; i++) {
          if (unique[i].kind === 'geometry_impact' &&
              !validGeometryImpact(receipt.results[i]?.impact, unique[i])) {
            throw new Error('CODE_MODE_GEOMETRY_IMPACT_RECEIPT_INVALID');
          }
        }
        // Only repeated selectors need independent JSON copies. Always
        // enforce the existing 96 KiB native result-array budget, including
        // when all selectors are unique and the runner is injected by a host.
        let results;
        let serialized;
        try {
          results = duplicates ? positions.map(index =>
            JSON.parse(JSON.stringify(receipt.results[index]))) : receipt.results;
          serialized = JSON.stringify(results);
        } catch {
          throw new Error('CODE_MODE_INSPECT_BATCH_RECEIPT_INVALID');
        }
        if (Buffer.byteLength(serialized, 'utf8') > 96 * 1024) {
          throw new Error('CODE_MODE_INSPECT_BATCH_RESULT_TOO_LARGE');
        }
        return duplicates ? { ...receipt, results } : receipt;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async semanticMap({ input, expectedSha256, category, offset = 0, limit = 16 }) {
      const allowed = ['cubes', 'bones', 'textures', 'animations'];
      if (!allowed.includes(category) ||
          !Number.isSafeInteger(offset) || offset < 0 || offset > 65536 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 24) {
        throw new TypeError('CODE_MODE_SEMANTIC_MAP_QUERY_INVALID');
      }
      const digest = hash(expectedSha256).toLowerCase();
      const receipt = await call('semantic-map', {
        input: absolute(input, 'input'), 'expected-sha256': digest,
        category, offset: wholeNumber(offset, 'offset', 0, 65536),
        limit: wholeNumber(limit, 'limit', 1, 24),
      });
      const map = receipt.map;
      const expectedKind = category.slice(0, -1);
      if (typeof receipt.sha256 !== 'string' ||
          receipt.sha256.toLowerCase() !== digest ||
          receipt.summary?.revision !== 0 ||
          map?.scope !== 'validated_rust_semantic_identity_map' ||
          map?.revision !== 0 || map?.category !== category ||
          map?.offset !== offset ||
          !Number.isSafeInteger(map?.total) || map.total < 0 ||
          !Array.isArray(map?.entries) || map.entries.length > limit ||
          map?.visual_verdict !== 'UNVERIFIED' ||
          map?.write_authority !== 'NOT_GRANTED' ||
          map.entries.some((entry, i) => !entry ||
            entry.kind !== expectedKind || entry.index !== offset + i ||
            !(typeof entry.uuid === 'string' || entry.uuid === null) ||
            !(typeof entry.name === 'string' || entry.name === null)) ||
          (map.next_offset !== null &&
            (!Number.isSafeInteger(map.next_offset) ||
             map.next_offset !== offset + map.entries.length ||
             map.next_offset >= map.total)) ||
          (offset < map.total &&
            map.entries.length !== Math.min(limit, map.total - offset))) {
        throw new Error('CODE_MODE_SEMANTIC_MAP_RECEIPT_INVALID');
      }
      return receipt;
    },
    ...createGeometryProposalSdkMethods({call,absolute,hash}),
    async planPeriodicRotation({input,expectedSha256,intent}) {
      const digest=hash(expectedSha256).toLowerCase();
      const payload=serializePeriodicRotation(intent);
      const directory=await mkdtemp(join(tmpdir(),'lazydesigner-periodic-'));
      try {
        const file=join(directory,'periodic-intent.json');
        await writeFile(file,payload,{encoding:'utf8',mode:0o600,flag:'wx'});
        const receipt=await call('plan-periodic-rotation',{
          input:absolute(input,'input'),'expected-sha256':digest,intent:file,
        });
        if(!validPeriodicRotationReceipt(receipt,intent,digest)){
          throw new Error('CODE_MODE_PERIODIC_ROTATION_RECEIPT_INVALID');
        }
        return receipt;
      } finally {await rm(directory,{recursive:true,force:true});}
    },
    async planSemanticAnimation({input,expectedSha256,intent}) {
      const digest=hash(expectedSha256).toLowerCase();
      const payload=serializeSemanticAnimation(intent);
      const directory=await mkdtemp(join(tmpdir(),'lazydesigner-semantic-motion-'));
      try{
        const file=join(directory,'semantic-motion.json');
        await writeFile(file,payload,{encoding:'utf8',mode:0o600,flag:'wx'});
        const receipt=await call('plan-semantic-animation',{
          input:absolute(input,'input'),'expected-sha256':digest,intent:file,
        });
        if(!validSemanticAnimationReceipt(receipt,intent,digest)){
          throw new Error('CODE_MODE_SEMANTIC_ANIMATION_RECEIPT_INVALID');
        }
        return receipt;
      }finally{await rm(directory,{recursive:true,force:true});}
    },
    async reviewExistingAnimation({input,expectedSha256,intent}) {
      const digest=hash(expectedSha256).toLowerCase();
      const payload=serializeExistingAnimationIntent(intent);
      const directory=await mkdtemp(join(tmpdir(),'lazydesigner-existing-motion-'));
      try {
        const file=join(directory,'existing-motion.json');
        await writeFile(file,payload,{encoding:'utf8',mode:0o600,flag:'wx'});
        const receipt=await call('review-existing-animation',{
          input:absolute(input,'input'),'expected-sha256':digest,intent:file,
        });
        if(!validExistingAnimationReviewReceipt(receipt,intent,digest)){
          throw new Error('CODE_MODE_EXISTING_ANIMATION_RECEIPT_INVALID');
        }
        return receipt;
      }finally{await rm(directory,{recursive:true,force:true});}
    },
    async planSemanticMaterial({ input, expectedSha256, intent }) {
      const digest=hash(expectedSha256).toLowerCase();
      const payload=serializeSemanticMaterialIntent(intent);
      const folder=await mkdtemp(join(tmpdir(),'lazydesigner-material-plan-'));
      const file=join(folder,'semantic-intent.json');
      try {
        await writeFile(file,payload,{encoding:'utf8',mode:0o600,flag:'wx'});
        const receipt=await call('plan-semantic-material',{
          input:absolute(input,'input'),'expected-sha256':digest,intent:file,
        });
        const plan=receipt.plan,preview=receipt.preflight;
        const scope=plan?.correction_scope;
        const op=plan?.operations?.[0];
        const e=receipt.material_evidence;
        const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
        if(receipt.sha256?.toLowerCase()!==digest ||
           receipt.summary?.revision!==0 ||
           plan?.expected_revision!==0 ||
           !Array.isArray(plan.operations) || plan.operations.length!==1 ||
           op?.op!=='paint_cube_face_regions_guarded' ||
           op?.cube_uuid!==intent.cube_uuid ||
           op?.texture_uuid!==intent.texture_uuid ||
           !Array.isArray(op.regions) || op.regions.length<1 ||
           op.regions.length>64 ||
           op.regions.some(r=>r?.face!==intent.face ||
             r.erase!==false || !Array.isArray(r.rgba) ||
             ![[...intent.shadow_rgb,255],[...intent.highlight_rgb,255]]
               .some(color=>equal(color,r.rgba)) ||
             !Array.isArray(r.from) || !Array.isArray(r.to) ||
             r.from.length!==2 || r.to.length!==2 ||
             !r.from.every((v,i)=>Number.isInteger(v)&&v>=0&&v<r.to[i]&&
               Number.isInteger(r.to[i])&&r.to[i]<=256)) ||
           scope?.texture_uuid!==intent.texture_uuid ||
           scope.preserve_alpha!==true ||
           !equal(scope.editable_before_rgba,[intent.source_base_rgba]) ||
           !equal(scope.protected_regions,intent.protected_regions??[]) ||
           !equal(scope.expected_before_pixels,intent.expected_before_pixels??[]) ||
           !Array.isArray(scope.allowed_regions) ||
           scope.allowed_regions.length!==1 ||
           !scope.allowed_regions.every(rect=>
             rect && Array.isArray(rect.from) && Array.isArray(rect.to) &&
             rect.from.length===2 && rect.to.length===2 &&
             rect.from.every((v,i)=>Number.isInteger(v)&&v>=0&&
               Number.isInteger(rect.to[i])&&rect.to[i]>v&&rect.to[i]<=256)) ||
           preview?.status!=='VALIDATED_NOT_APPLIED' ||
           preview?.base_revision!==0 ||
           preview.mutation?.revision!==1 ||
           preview.mutation?.operation_count!==1 ||
           !Array.isArray(preview.mutation?.changed_uuids) ||
           preview.candidate_summary?.revision!==1 ||
           typeof preview.candidate_sha256!=='string' ||
           !SHA256.test(preview.candidate_sha256) ||
           preview.write_authority!=='NOT_GRANTED' ||
           preview.visual_verdict!=='UNVERIFIED' ||
           e?.scope!=='source_selected_face_semantic_metal_candidate' ||
           e?.material!=='painted_metal' ||
           e?.cube_uuid!==intent.cube_uuid ||
           e?.texture_uuid!==intent.texture_uuid ||
           e?.face!==intent.face ||
           e?.reference_png_sha256!==intent.reference_png_sha256 ||
           e?.reference_authority!=='NOT_VERIFIED_BY_RUST' ||
           e?.visual_verdict!=='UNVERIFIED' ||
           e?.style_quality!=='NOT_EVALUATED' ||
           e?.detail_boundary_guard!=='one_face_local_texel_around_non_base_rgba' ||
           !Number.isSafeInteger(e?.skipped_near_existing_detail_pixels) ||
           e.skipped_near_existing_detail_pixels<0 ||
           !Number.isSafeInteger(e?.candidate_pixels) ||
           !Number.isSafeInteger(e?.light_pixels) ||
           !Number.isSafeInteger(e?.shadow_pixels) ||
           e.light_pixels<1 || e.shadow_pixels<1 ||
           e.candidate_pixels!==e.light_pixels+e.shadow_pixels ||
           e?.write_authority!=='NOT_GRANTED' ||
           receipt.write_authority!=='NOT_GRANTED' ||
           receipt.visual_verdict!=='UNVERIFIED') {
          throw new Error('CODE_MODE_SEMANTIC_MATERIAL_RECEIPT_INVALID');
        }
        return receipt;
      } finally {
        await rm(folder,{recursive:true,force:true});
      }
    },
    async preflight({ input, expectedSha256, operations, correctionScope }) {
      const digest = hash(expectedSha256).toLowerCase();
      const payload = serializePlan(
        operations, normalizedCorrectionScope(correctionScope));
      // Temporary plan files are only a bounded transport to the existing
      // CLI reader. Preflight never requests approval or publishes a model.
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-preflight-'));
      const file = join(directory, 'edit.plan.json');
      try {
        await writeFile(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const receipt = await call('preflight', {
          input: absolute(input, 'input'), 'expected-sha256': digest,
          plan: file,
        });
        const result = receipt.preflight;
        if (typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest ||
            receipt.summary?.revision !== 0 ||
            result?.status !== 'VALIDATED_NOT_APPLIED' ||
            result?.base_revision !== 0 ||
            result?.mutation?.revision !== 1 ||
            result.mutation.operation_count !== operations.length ||
            !Array.isArray(result.mutation.changed_uuids) ||
            result?.candidate_summary?.revision !== 1 ||
            typeof result?.candidate_sha256 !== 'string' ||
            !SHA256.test(result.candidate_sha256) ||
            result?.visual_verdict !== 'UNVERIFIED' ||
            result?.write_authority !== 'NOT_GRANTED') {
          throw new Error('CODE_MODE_PREFLIGHT_RECEIPT_INVALID');
        }
        return receipt;
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
    semanticMap: (category, { offset = 0, limit = 16 } = {}) =>
      client.semanticMap({ input: path, expectedSha256, category, offset, limit }),
    preflight: ({ operations, correctionScope }) =>
      client.preflight({ input: path, expectedSha256, operations, correctionScope }),
    planGeometryAssembly: (assembly) =>
      client.planGeometryAssembly({ input:path, expectedSha256, assembly }),
    planSemanticMaterial: (intent) =>
      client.planSemanticMaterial({ input:path, expectedSha256, intent }),
    planPeriodicRotation: (intent) =>
      client.planPeriodicRotation({input:path,expectedSha256,intent}),
    planSemanticAnimation: (intent) =>
      client.planSemanticAnimation({input:path,expectedSha256,intent}),
    reviewExistingAnimation: (intent) =>
      client.reviewExistingAnimation({input:path,expectedSha256,intent}),
    planGeometryAttachment: (attachment) =>
      client.planGeometryAttachment({ input:path, expectedSha256, attachment }),
    planGeometryResizePropagation: (propagation) =>
      client.planGeometryResizePropagation({ input:path, expectedSha256, propagation }),
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

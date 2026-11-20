/** Geometry proposal input transport: deterministic source IDs and
 * bounded Rust CLI payloads. Rust owns all geometry decisions and preflight.
 * This is not a JavaScript voxel compiler or write-authority shortcut.
 * SOURCE_AUTHORED_NOT_RUN.
 */
import {createHash} from 'node:crypto';
import {PLAN_LIMIT} from './sdk-inputs.mjs';

/** Geometry identity only, never a second JS voxel or frame compiler.
 * Keep Rust's versioned per-method UUID namespace and formatting. */
export function generatedBlockoutCubeUuid(namespace, seed, index) {
  const digest=createHash('sha256')
    .update('lazydesigner:'+namespace+'\0'+seed+'\0'+index)
    .digest('hex');
  return digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+
    digest.slice(13,16)+'-8'+digest.slice(17,20)+'-'+digest.slice(20,32);
}
export function generatedSweepCubeUuid(seed, index) {
  return generatedBlockoutCubeUuid('geometry-sweep-v1',seed,index);
}
export function generatedProfileCubeUuid(seed, index) {
  return generatedBlockoutCubeUuid('geometry-profile-v1',seed,index);
}

/** Bounded transport only. Rust validates every Bone/Cube/parent and
 * performs authoritative disposable preflight. No JS geometry compiler. */
export function serializeGeometryAssembly(assembly) {
  if (!assembly || typeof assembly !== 'object' ||
      Array.isArray(assembly) || assembly.expected_revision !== 0 ||
      !Array.isArray(assembly.parts) || assembly.parts.length < 1 ||
      assembly.parts.length > 128) {
    throw new TypeError('CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_INVALID');
  }
  // Void-zone evidence is an optional read-only Rust CLI argument, not
  // an unknown field added to the canonical G1 AssemblyRequest wire.
  const {void_zones: _zones, ...canonicalAssembly} = assembly;
  const payload = JSON.stringify(canonicalAssembly, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_INVALID');
    }
    return value;
  });
  if (!payload || Buffer.byteLength(payload, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_TOO_LARGE');
  }
  return payload;
}

/** G2 transport only: Rust owns every geometric validity decision. */
export function serializeGeometryAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object' ||
      Array.isArray(attachment) || attachment.expected_revision !== 0) {
    throw new TypeError('CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_INVALID');
  }
  const payload = JSON.stringify(attachment, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_INVALID');
    }
    return value;
  });
  if (!payload || Buffer.byteLength(payload, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_TOO_LARGE');
  }
  return payload;
}

/** Transport-only gate. Rust validates every semantic and numeric constraint. */
export function serializeGeometryPropagation(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      request.expected_revision !== 0 ||
      !Array.isArray(request.links) || request.links.length < 1 ||
      request.links.length > 32) {
    throw new TypeError('CODE_MODE_GEOMETRY_PROPAGATION_INPUT_INVALID');
  }
  const payload = JSON.stringify(request, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('CODE_MODE_GEOMETRY_PROPAGATION_INPUT_INVALID');
    }
    return value;
  });
  if (!payload || Buffer.byteLength(payload, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('CODE_MODE_GEOMETRY_PROPAGATION_INPUT_TOO_LARGE');
  }
  return payload;
}

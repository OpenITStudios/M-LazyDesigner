// Strictly read-only presentation of the existing SHA-bound Rust
// authoring_target inspector. No new scene owner, lookup engine, aesthetic
// scoring, caching, or write permission is introduced here.
const MAX_CONTEXT_BYTES = 8 * 1024;
const MATCH_STATES = new Set([
  'EXACT_MATCH', 'AMBIGUOUS_NAME', 'IDENTITY_MISSING', 'NO_EXACT_MATCH',
]);
const DOMAINS = Object.freeze({
  geometry: new Set(['cubes','bones']),
  uv: new Set(['cubes']),
  texturing: new Set(['cubes','textures']),
  animation: new Set(['bones','animations']),
});

function text(value, max = 128) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}
function safeOp(value) {
  return text(value, 80) && /^[a-z][a-z0-9_]*$/.test(value);
}
function safeBlocker(value) {
  return text(value, 96) && /^[A-Z][A-Z0-9_]*$/.test(value);
}
function safeUuid(value) {
  return text(value) && !/\s/.test(value);
}

export function compactTaskContext(receipt, {
  project, domain, category, name, expectedSha256,
}) {
  if (!text(project, 64) || !DOMAINS[domain]?.has(category) ||
      !text(name) || name !== name.trim()) {
    throw new TypeError('CODE_MODE_TASK_CONTEXT_QUERY_INVALID');
  }
  if (!Array.isArray(receipt?.results) || receipt.results.length !== 1 ||
      receipt.results[0]?.kind !== 'authoring_target' ||
      receipt.sha256 !== expectedSha256 ||
      !Number.isSafeInteger(receipt.summary?.revision) ||
      receipt.summary.revision < 0) {
    throw new Error('CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID');
  }
  const target = receipt.results[0].target;
  if (target?.scope !== 'saved_model_named_target_orientation' ||
      target.domain !== domain || target.category !== category ||
      target.requested_name !== name || !MATCH_STATES.has(target.status) ||
      target.write_authority !== 'NOT_GRANTED' ||
      target.visual_verdict !== 'UNVERIFIED' ||
      !Array.isArray(target.candidates) || target.candidates.length > 8 ||
      !Number.isSafeInteger(target.candidate_count) ||
      target.candidate_count < 0 ||
      !Array.isArray(target.candidate_operations) ||
      target.candidate_operations.length > 12 ||
      !target.candidate_operations.every(safeOp) ||
      !Array.isArray(target.source_blockers) ||
      target.source_blockers.length > 12 ||
      !target.source_blockers.every(safeBlocker)) {
    throw new Error('CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID');
  }
  const exact = target.status === 'EXACT_MATCH';
  const chosen = target.selected;
  const identity = chosen?.identity;
  if ((exact && (!safeUuid(identity?.uuid) ||
       identity?.name !== name ||
       !Number.isSafeInteger(identity?.index) || identity.index < 0)) ||
      (!exact && chosen !== null)) {
    throw new Error('CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID');
  }
  const element = exact ? chosen.source?.element : null;
  const surfaces = exact ? chosen.source?.surfaces : null;
  const asset = exact ? chosen.source?.asset : null;
  if (exact && (target.candidate_count !== 1 ||
      (['cubes','bones'].includes(category) && !element) ||
      (['textures','animations'].includes(category) && !asset))) {
    throw new Error('CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID');
  }
  if (element && (element.uuid !== identity.uuid ||
      !['cube','bone'].includes(element.kind)) ||
      surfaces && (surfaces.cube_uuid !== identity.uuid ||
      surfaces.visual_verdict !== 'UNVERIFIED' ||
      surfaces.effective_material !== 'UNVERIFIED' ||
      !Array.isArray(surfaces.faces) || surfaces.faces.length !== 6)) {
    throw new Error('CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID');
  }
  const candidates = target.candidates.slice(0, 4).map(item => {
    if (!item || !Number.isSafeInteger(item.index) || item.index < 0 ||
        !(item.uuid === null || safeUuid(item.uuid)) ||
        !(item.name === null || typeof item.name === 'string')) {
      throw new Error('CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID');
    }
    return {
      uuid: item.uuid,
      name: item.name === null ? null :
        item.name.slice(0, 96).replace(/[\x00-\x1f\x7f]/g, ' '),
      index: item.index,
    };
  });
  const context = {
    scope: 'sha_bound_semantic_task_context',
    source_model_sha256: expectedSha256,
    source_revision: receipt.summary.revision,
    project,
    domain, category, requested_name: name,
    status: target.status,
    candidate_count: target.candidate_count,
    candidates_truncated: target.candidates_truncated === true ||
      target.candidate_count > candidates.length,
    candidates,
    target: exact ? {
      uuid: identity.uuid, index: identity.index, name: identity.name,
      ...(element ? {
        parent_uuid: element.parent_uuid ?? null,
        ...(element.kind === 'cube' ? {
          geometry: {
            from: element.from ?? null, to: element.to ?? null,
            origin: element.origin ?? null,
          },
        } : {}),
      } : {}),
      ...(surfaces ? {
        uv: {
          box_uv: surfaces.uv?.box_uv ?? null,
          auto_uv: surfaces.uv?.auto_uv ?? null,
          per_texture_rules: surfaces.uv?.per_texture_rules ?? null,
        },
        face_links: surfaces.faces.map(face => ({
          side: face.side,
          reference_kind: face.reference_kind,
          texture_uuid: face.texture_uuid,
          uv_zero_span: face.uv_zero_span,
        })),
      } : {}),
      ...(asset ? {
        asset_kind: asset.kind,
        source_kind: asset.source_kind ?? null,
      } : {}),
    } : null,
    candidate_operations: target.candidate_operations,
    source_blockers: target.source_blockers,
    write_authority: 'NOT_GRANTED',
    visual_verdict: 'UNVERIFIED',
    next: exact ?
      'Use only this exact saved UUID. For sensitive changes, preflight the typed plan; actual Apply still needs separate permission and fresh SHA.' :
      'Resolve the exact, unique saved target identity before any edit.',
  };
  const encoded = JSON.stringify(context);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_CONTEXT_BYTES) {
    throw new Error('CODE_MODE_TASK_CONTEXT_TOO_LARGE');
  }
  return context;
}

// Advisory only. This is not an admission gate, a visual reviewer, a
// substitute for Rust validation, or permission to avoid real approvals.
// Only a fully shaped, single label change may skip the optional extra
// dry-run. Everything else is RECOMMENDED; real Rust Apply always validates.
function simpleRename(op) {
  return op && typeof op === 'object' && !Array.isArray(op) &&
    op.op === 'rename_node' && safeUuid(op.uuid) &&
    text(op.name) && op.name.trim() === op.name &&
    Object.keys(op).length === 3;
}
const STRUCTURAL_OR_VISUAL = /(?:bone|cube|uv|texture|paint|animation|keyframe|face|palette|stretch|inflate|reframe|reflect|import)/;
export function preflightGuidance({ operations, correctionScope } = {}) {
  if (!Array.isArray(operations) || operations.length < 1 ||
      operations.length > 128) {
    throw new TypeError('CODE_MODE_PREFLIGHT_GUIDANCE_PLAN_INVALID');
  }
  const kinds = operations.map(item => item?.op);
  const valid = kinds.every(safeOp);
  const simple = valid && operations.length === 1 &&
    simpleRename(operations[0]) && correctionScope === undefined;
  const reasons = [];
  if (!valid) reasons.push('UNKNOWN_OR_MALFORMED_OPERATION');
  if (operations.length > 1) reasons.push('MULTI_OPERATION_PLAN');
  if (correctionScope !== undefined) reasons.push('TEXTURE_CORRECTION_SCOPE');
  if (kinds.some(kind => typeof kind === 'string' &&
      STRUCTURAL_OR_VISUAL.test(kind))) {
    reasons.push('GEOMETRY_TEXTURE_OR_ANIMATION_EFFECT');
  }
  if (!simple && reasons.length === 0) reasons.push('NONTRIVIAL_OPERATION');
  return Object.freeze({
    scope: 'advisory_typed_plan_preflight',
    recommendation: simple ? 'OPTIONAL' : 'RECOMMENDED',
    reasons,
    operation_count: operations.length,
    // A preflight may reject input but can never grant mutation permission.
    operation_kinds: valid ? [...new Set(kinds)].slice(0, 12) : [],
    operation_kinds_truncated: valid && new Set(kinds).size > 12,
    validation_authority: 'RUST_APPLY_ALWAYS_REQUIRED',
    write_authority: 'NOT_GRANTED',
    visual_verdict: 'UNVERIFIED',
  });
}

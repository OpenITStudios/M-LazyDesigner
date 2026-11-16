/**
 * Trusted host for Code Mode RPC. Model JavaScript runs in a separate Deno
 * permission-denied process, never in this Node process or in Tauri/Rust.
 * The host alone holds first-party Rust CLI credentials and file authority.
 * SOURCE_ONLY: no native runtime or sandbox proof has been executed.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { createRustCodeModeClient, openRustCodeModeProject, normalizedCorrectionScope, normalizedMaterialCorrectionIntent } from './client.mjs';

const WORKER = fileURLToPath(new URL('./sandbox-worker.mjs', import.meta.url));
const DENO_FLAGS = Object.freeze([
  'run', '--no-config', '--no-lock', '--no-npm', '--no-remote', '--no-prompt',
]);
const MAX_CODE_BYTES = 32 * 1024;
const MAX_RPC_BYTES = 128 * 1024;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_CALLS = 64;
const MAX_PROJECTS = 16;
const PIXEL_MUTATIONS = new Set([
  'paint_texture_pixel', 'paint_texture_stroke', 'paint_texture_brush',
  'paint_texture_rectangle', 'paint_texture_rectangles',
  'paint_cube_uv_faces', 'paint_cube_uv_faces_guarded',
  'paint_cube_face_regions_guarded', 'recolor_cube_faces_palette_guarded',
  'paint_texture_fill', 'isolate_cube_box_uv',
]);
const TIMEOUT_MS = 90000;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VISUAL_PNG_BYTES = 8 * 1024 * 1024;
const VISUAL_VIEWS = new Set([
  'front', 'back', 'left', 'right', 'top', 'bottom', 'three_quarter',
]);
const SHA256 = /^[a-f0-9]{64}$/i;

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
async function pinnedVisualPng(path, label) {
  const selected = await regularFile(requireAbsolute(path, label), label);
  if (!selected.toLowerCase().endsWith('.png')) {
    throw new Error('CODE_MODE_VISUAL_PNG_EXTENSION_INVALID');
  }
  const stat = await lstat(selected);
  if (!stat.isFile() || stat.size < 8 || stat.size > MAX_VISUAL_PNG_BYTES) {
    throw new Error('CODE_MODE_VISUAL_PNG_SIZE_INVALID');
  }
  const bytes = await readFile(selected);
  if (bytes.length !== stat.size || bytes.length > MAX_VISUAL_PNG_BYTES ||
      !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('CODE_MODE_VISUAL_PNG_INVALID');
  }
  return Object.freeze({
    path:selected, sha256:createHash('sha256').update(bytes).digest('hex'),
  });
}
async function pinnedVisualPair(source, options, modelSha) {
  if (options === undefined) return null;
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => ![
        'referencePngPath','capturePngPath','captureModelSha256','viewId',
      ].includes(key)) ||
      typeof options.captureModelSha256 !== 'string' ||
      !SHA256.test(options.captureModelSha256) ||
      !VISUAL_VIEWS.has(options.viewId) ||
      source === null || modelSha !== options.captureModelSha256.toLowerCase()) {
    throw new Error('CODE_MODE_VISUAL_PAIR_BINDING_INVALID');
  }
  // The selected images are operator-owned snapshots and cannot be replaced
  // by a guest-provided path, view or source SHA during an RPC.
  const [reference,capture] = await Promise.all([
    pinnedVisualPng(options.referencePngPath,'visualReference'),
    pinnedVisualPng(options.capturePngPath,'visualCapture'),
  ]);
  return Object.freeze({
    reference,capture,viewId:options.viewId,modelSha,
  });
}
// Operator review is input from a trusted host callback, not model-written code.
// The callback may show *actual* images in a separately authorized reviewer UI;
// the Code Mode guest receives bounded findings, never image bytes or paths.
const REVIEW_DECISIONS = new Set(['ACCEPTED','REJECTED','UNVERIFIED']);
const REVIEW_ISSUES = new Set([
  'FLAT_SHADING','MISSING_DETAIL','STYLE_MISMATCH',
  'ALPHA_MISMATCH','UV_SEAM','SILHOUETTE','OTHER',
]);
const MAX_REVIEW_ISSUES = 6;
function normalizedVisualReview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key =>
        !['decision','issues','correctionScope','rejectedApproaches','materialCohort'].includes(key)) ||
      !REVIEW_DECISIONS.has(input.decision) ||
      !Array.isArray(input.issues) || input.issues.length > MAX_REVIEW_ISSUES) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
  }
  const issues = input.issues.map(issue => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue) ||
        Object.keys(issue).some(key => !['id','kind','observation','partId'].includes(key)) ||
        typeof issue.id !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(issue.id) ||
        !REVIEW_ISSUES.has(issue.kind) ||
        typeof issue.observation !== 'string' ||
        (issue.partId !== undefined &&
          (typeof issue.partId !== 'string' ||
           !/^[a-z][a-z0-9_-]{0,63}$/.test(issue.partId))) ||
        issue.observation.trim() !== issue.observation ||
        issue.observation.length < 3 || issue.observation.length > 240 ||
        /[\x00-\x1f\x7f]/.test(issue.observation)) {
      throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    }
    return Object.freeze({
      id:issue.id,kind:issue.kind,observation:issue.observation,
      ...(issue.partId ? {partId:issue.partId} : {}),
    });
  });
  if (new Set(issues.map(issue => issue.id)).size !== issues.length) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
  }
  if (input.decision === 'REJECTED') {
    if (issues.length === 0 || input.correctionScope === undefined) {
      throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    }
    let scope;
    try { scope = normalizedCorrectionScope(input.correctionScope); }
    catch { throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID'); }
    if (!scope) throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    const prior = input.rejectedApproaches ?? [];
    if (!Array.isArray(prior) || prior.length > 12) {
      throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    }
    const rejectedApproaches = prior.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          Object.keys(item).some(key => !['issueId','approachId'].includes(key)) ||
          typeof item.issueId !== 'string' ||
          typeof item.approachId !== 'string' ||
          !/^[a-z][a-z0-9_-]{0,63}$/.test(item.issueId) ||
          !/^[a-z][a-z0-9_-]{0,63}$/.test(item.approachId) ||
          !issues.some(issue => issue.id === item.issueId)) {
        throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
      }
      return Object.freeze({issueId:item.issueId,approachId:item.approachId});
    });
    if (new Set(rejectedApproaches.map(item =>
      item.issueId+':'+item.approachId)).size !== rejectedApproaches.length) {
      throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
    }
    const materialCohort = normalizedReviewedMaterialCohort(
      input.materialCohort,scope,issues);
    const normalized = Object.freeze({
      textureUuid:scope.texture_uuid,
      allowedRegions:Object.freeze(scope.allowed_regions.map(region=>
        Object.freeze({
          from:Object.freeze([...region.from]),
          to:Object.freeze([...region.to]),
        })
      )),
      preserveAlpha:scope.preserve_alpha,
    });
    return Object.freeze({
      status:'RECORDED',decision:'REJECTED',
      issues:Object.freeze(issues),correctionScope:normalized,
      rejectedApproaches:Object.freeze(rejectedApproaches),
      materialCohort,
      source:'TRUSTED_HOST_DECLARATION',
      visual_verdict:'UNVERIFIED',
    });
  }
  if (issues.length !== 0 || input.correctionScope !== undefined ||
      input.rejectedApproaches !== undefined ||
      input.materialCohort !== undefined) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INVALID');
  }
  return Object.freeze({
    status:'RECORDED',decision:input.decision,
    issues:Object.freeze([]),correctionScope:null,
    rejectedApproaches:Object.freeze([]),materialCohort:null,
    source:'TRUSTED_HOST_DECLARATION',visual_verdict:'UNVERIFIED',
  });
}
// One representative surface patch is an ATLAS location, not a reference
// image box or a claim about the rendered Cube face. Trusted review must
// select matching UV ownership before calling the model-wide Paint endpoint.
function normalizedReviewedMaterialCohort(value, correctionScope, issues) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => ![
        'phase','issueId','partId','approachId','sampleRegion','sampleVerdict',
      ].includes(key)) ||
      !['sample','propagation'].includes(value.phase) ||
      typeof value.issueId !== 'string' ||
      typeof value.partId !== 'string' ||
      typeof value.approachId !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(value.issueId) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(value.partId) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(value.approachId) ||
      !issues.some(issue => issue.id === value.issueId &&
        (!issue.partId || issue.partId === value.partId))) {
    throw new Error('CODE_MODE_MATERIAL_COHORT_INVALID');
  }
  let region;
  try {
    const checked = normalizedCorrectionScope({
      textureUuid:correctionScope.texture_uuid,
      allowedRegions:[value.sampleRegion],preserveAlpha:true,
    });
    region = checked.allowed_regions[0];
  } catch {
    throw new Error('CODE_MODE_MATERIAL_COHORT_INVALID');
  }
  const size=(region.to[0]-region.from[0])*
    (region.to[1]-region.from[1]);
  if (size > 1024 ||
      (value.phase === 'sample' && value.sampleVerdict !== undefined) ||
      (value.phase === 'propagation' && value.sampleVerdict !== 'ACCEPTED') ||
      (value.phase === 'sample' && !correctionScope.allowed_regions.some(r =>
        region.from[0]>=r.from[0] && region.from[1]>=r.from[1] &&
        region.to[0]<=r.to[0] && region.to[1]<=r.to[1]))) {
    throw new Error('CODE_MODE_MATERIAL_COHORT_INVALID');
  }
  return Object.freeze({
    phase:value.phase,issueId:value.issueId,partId:value.partId,
    approachId:value.approachId,
    sampleRegion:Object.freeze({
      from:Object.freeze([...region.from]),to:Object.freeze([...region.to]),
    }),
    sampleVerdict:value.phase === 'propagation' ?
      'ACCEPTED' : 'UNVERIFIED',
    approval_source:value.phase === 'propagation' ?
      'TRUSTED_REVIEWER_DECLARATION' : 'NONE',
    visual_verdict:'UNVERIFIED',
  });
}
function overlapsRectangle(a,b) {
  return a.from[0] < b.to[0] && a.to[0] > b.from[0] &&
    a.from[1] < b.to[1] && a.to[1] > b.from[1];
}

// The SDK validates the requested scope again and Rust enforces its actual
// changed pixels. The host additionally binds it to the reviewer's allowed
// texture and pixel region, rather than trusting a model-declared rectangle.
function correctionFitsReview(requested, reviewed) {
  if (requested.texture_uuid !== reviewed.textureUuid ||
      (reviewed.preserveAlpha && !requested.preserve_alpha)) return false;
  return requested.allowed_regions.every(region=>
    reviewed.allowedRegions.some(allowed=>
      region.from[0]>=allowed.from[0] &&
      region.from[1]>=allowed.from[1] &&
      region.to[0]<=allowed.to[0] &&
      region.to[1]<=allowed.to[1]
    )
  );
}
// Reopen and SHA-check at the review boundary: startup metadata is insufficient
// if an image was replaced while the guest was doing other work.
async function pinnedReviewBytes(selected) {
  const current = await regularFile(selected.path,'CODE_MODE_VISUAL_REVIEW_INPUT');
  if (current !== selected.path) throw new Error('CODE_MODE_VISUAL_REVIEW_INPUT_STALE');
  const bytes = await readFile(current);
  if (bytes.length < 8 || bytes.length > MAX_VISUAL_PNG_BYTES ||
      createHash('sha256').update(bytes).digest('hex') !== selected.sha256) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_INPUT_STALE');
  }
  return bytes;
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
  preselectedPngPath, approvedMaterialReferenceUuid,
  preselectedVisualPair, reviewVisualPair, runner, spawnImpl,
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
  if (reviewVisualPair !== undefined &&
      (typeof reviewVisualPair !== 'function' ||
       preselectedVisualPair === undefined)) {
    throw new TypeError('CODE_MODE_VISUAL_REVIEW_HOST_INVALID');
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
  // Selected by the operator at host setup, never by model-authored JS.
  // A name/UUID alone is not a human visual approval receipt.
  if (approvedMaterialReferenceUuid !== undefined &&
      (typeof approvedMaterialReferenceUuid !== 'string' ||
       !approvedMaterialReferenceUuid ||
       approvedMaterialReferenceUuid.length > 128 ||
       /\s|[\x00-\x1f]/.test(approvedMaterialReferenceUuid))) {
    throw new Error('CODE_MODE_MATERIAL_REFERENCE_INVALID');
  }
  const referenceMaster = approvedMaterialReferenceUuid ?? null;

  // Only one code session may be active per host. Operator approval is
  // invalidated when that session exits or times out.
  let activeExecution = null;
  // Every approval descriptor is linked to the exact guest that received it.
  // This prevents an old approval from being consumed by a later guest when
  // Rust plan-file creation yields to the event loop before CLI launch.
  const approvedGuest = new WeakMap();
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
      const valid = approved === true &&
        !execution.closed && activeExecution === execution;
      if (valid) approvedGuest.set(request, execution);
      return valid;
    },
    // Synchronous last lease check, directly before the SDK launches Rust.
    // No async work may occur between this check and the execFile request.
    permitWriteLaunch: (request) => {
      const owner = approvedGuest.get(request);
      approvedGuest.delete(request);
      return owner !== undefined && owner === activeExecution && !owner.closed;
    },
  });
  const projects = new Map();
  const initialProject = source === null ? null :
    await openRustCodeModeProject(client, source);
  if (initialProject) projects.set('p0', initialProject);
  let nextProject = initialProject ? 1 : 0;
  const visualPair = await pinnedVisualPair(
    source, preselectedVisualPair, initialProject?.expectedSha256 ?? null);
  // One ephemeral review state per exact model SHA, not a second asset store.
  const visualPreflights = new Map();
  // One coherent reviewed correction per source revision. Do not create
  // multiple variants from a stale, already-rejected capture.
  const completedReviewedCorrections = new Set();
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
    inspectBatch: async (args) => {
      // Generic guest reads must never masquerade as the operator-selected
      // approved master. The trust-bound method below injects that identity.
      if (Array.isArray(args.requests) &&
          args.requests.some(query => query?.kind === 'material_pair')) {
        throw new Error('CODE_MODE_MATERIAL_REFERENCE_HOST_ONLY');
      }
      return selected(args).inspectBatch(args.requests);
    },
    inspectApprovedMaterial: async (args) => {
      const model = selected(args);
      if (referenceMaster === null) {
        throw new Error('CODE_MODE_MATERIAL_REFERENCE_UNBOUND');
      }
      const receipt = await model.inspectBatch([{
        kind:'material_pair',
        reference_uuid:referenceMaster,
        candidate_uuid:args.candidateTextureUuid,
        reference_region:args.referenceRegion,
        candidate_region:args.candidateRegion,
      }]);
      const measured = receipt.results?.[0]?.comparison;
      if (receipt.sha256 !== model.expectedSha256 ||
          measured?.reference_texture_uuid !== referenceMaster ||
          measured?.candidate_texture_uuid !== args.candidateTextureUuid ||
          measured?.scope !== 'saved_rgba8_material_patch_pair' ||
          measured?.source_state !== 'measured' ||
          measured?.visual_verdict !== 'UNVERIFIED') {
        throw new Error('CODE_MODE_MATERIAL_REFERENCE_RESULT_INVALID');
      }
      return {
        ...receipt,
        reference_binding:{
          kind:'operator_selected_model_texture',
          reference_texture_uuid:referenceMaster,
          source_model_sha256:model.expectedSha256,
          visual_verdict:'UNVERIFIED',
        },
      };
    },
    inspectSelectedVisualPair: async (args) => {
      const model = selected(args);
      if (Object.keys(args).some(key => key !== 'project')) {
        throw new Error('CODE_MODE_VISUAL_PAIR_ARGUMENT_UNSUPPORTED');
      }
      if (visualPair === null) {
        throw new Error('CODE_MODE_VISUAL_PAIR_UNBOUND');
      }
      if (model.expectedSha256 !== visualPair.modelSha) {
        throw new Error('CODE_MODE_VISUAL_CAPTURE_MODEL_STALE');
      }
      const evidence = await client.inspectVisualPair({
        input:model.input, expectedSha256:model.expectedSha256,
        referencePng:visualPair.reference.path,
        capturePng:visualPair.capture.path,
        referenceSha256:visualPair.reference.sha256,
        captureSha256:visualPair.capture.sha256,
      });
      if (evidence.source_model_sha256 !== model.expectedSha256 ||
          evidence.reference_png_sha256 !== visualPair.reference.sha256 ||
          evidence.capture_png_sha256 !== visualPair.capture.sha256 ||
          evidence.comparison?.scope !== 'operator_selected_saved_png_pair' ||
          evidence.comparison?.visual_verdict !== 'UNVERIFIED' ||
          evidence.comparison?.reference_png_sha256 !== visualPair.reference.sha256 ||
          evidence.comparison?.capture_png_sha256 !== visualPair.capture.sha256) {
        throw new Error('CODE_MODE_VISUAL_PAIR_RESULT_INVALID');
      }
      // Freeze the first reviewer decision for one source SHA/view. The
      // guest must not downgrade ACCEPTED with a repeated review request.
      const prior = visualPreflights.get(model.expectedSha256);
      let feedback = prior ?? Object.freeze({
        status:'NOT_RECORDED',decision:'UNVERIFIED',
        issues:Object.freeze([]),correctionScope:null,
        rejectedApproaches:Object.freeze([]),materialCohort:null,
        source:'NONE',visual_verdict:'UNVERIFIED',
      });
      if (typeof reviewVisualPair === 'function' && prior === undefined) {
        const execution = activeExecution;
        if (!execution || execution.closed) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        const [referenceBytes,captureBytes] = await Promise.all([
          pinnedReviewBytes(visualPair.reference),
          pinnedReviewBytes(visualPair.capture),
        ]);
        if (execution.closed || activeExecution !== execution) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        // The host callback must present both actual buffers to its reviewer;
        // a text/SHAs-only response has no authority to claim the AI saw images.
        execution.pause();
        let returned;
        try {
          returned = await reviewVisualPair(Object.freeze({
            sourceModelSha256:model.expectedSha256,
            viewId:visualPair.viewId,
            reference:Object.freeze({
              sha256:visualPair.reference.sha256,
              pngBytes:Buffer.from(referenceBytes),
            }),
            capture:Object.freeze({
              sha256:visualPair.capture.sha256,
              pngBytes:Buffer.from(captureBytes),
            }),
          }));
        } finally { execution.resume(); }
        if (execution.closed || activeExecution !== execution) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SESSION_STALE');
        }
        feedback = normalizedVisualReview(returned);
        if (feedback.materialCohort) {
          feedback = Object.freeze({
            ...feedback,
            materialCohort:Object.freeze({
              ...feedback.materialCohort,
              source_model_sha256:model.expectedSha256,
              reference_png_sha256:visualPair.reference.sha256,
              capture_png_sha256:visualPair.capture.sha256,
              view_id:visualPair.viewId,
            }),
          });
        }
      }
      if (prior === undefined) visualPreflights.set(model.expectedSha256,feedback);
      return {
        ...evidence,
        review_feedback:feedback,
        evidence_binding:{
          kind:'operator_selected_visual_pair',
          view_id:visualPair.viewId,
          source_model_sha256:visualPair.modelSha,
          reference_png_sha256:visualPair.reference.sha256,
          capture_png_sha256:visualPair.capture.sha256,
          visual_verdict:'UNVERIFIED',
          image_ingestion:'NOT_VERIFIED',
        },
      };
    },
    inspectCubeSurfaces: async (args) => selected(args).inspectCubeSurfaces(args.uuid),
    inspectCubeFaceAlpha: async (args) => selected(args).inspectCubeFaceAlpha(args.uuid),
    inspectTexture: async (args) => selected(args).inspectTexture(args.index),
    inspectTextureAlpha: async (args) => selected(args).inspectTextureAlpha(args.uuid),
    inspectAnimation: async (args) => selected(args).inspectAnimation(args.uuid),
    inspectAnimationTrack: async (args) => selected(args).inspectAnimationTrack(
      args.animationUuid, args.boneUuid, {
        offset: args.offset, limit: args.limit,
      }),
    inspectAnimationTransformTrack: async (args) =>
      selected(args).inspectAnimationTransformTrack(
        args.animationUuid, args.boneUuid, args.channel, {
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
      const pixelEdit = Array.isArray(args.operations) &&
        args.operations.some(op => PIXEL_MUTATIONS.has(op?.op));
      if (referenceMaster !== null || visualPair !== null) {
        if (pixelEdit && args.correctionScope === undefined) {
          throw new Error('CODE_MODE_MATERIAL_CORRECTION_SCOPE_REQUIRED');
        }
        if (referenceMaster !== null &&
            args.correctionScope?.textureUuid === referenceMaster) {
          throw new Error('CODE_MODE_MATERIAL_MASTER_PROTECTED');
        }
      }
      if (visualPair !== null && pixelEdit &&
          !visualPreflights.has(p.expectedSha256)) {
        // The numeric image preflight alone does not certify art quality.
        throw new Error('CODE_MODE_VISUAL_PREFLIGHT_REQUIRED');
      }
      let materialIntent;
      if (visualPair !== null && pixelEdit &&
          typeof reviewVisualPair === 'function') {
        if (completedReviewedCorrections.has(p.expectedSha256)) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_FRESH_CAPTURE_REQUIRED');
        }
        const feedback = visualPreflights.get(p.expectedSha256);
        if (feedback?.decision === 'ACCEPTED') {
          throw new Error('CODE_MODE_VISUAL_REVIEW_ACCEPTED_PROTECTED');
        }
        if (feedback?.decision !== 'REJECTED') {
          throw new Error('CODE_MODE_VISUAL_REVIEW_REQUIRED');
        }
        let requested;
        try { requested = normalizedCorrectionScope(args.correctionScope); }
        catch { throw new Error('CODE_MODE_VISUAL_REVIEW_SCOPE_MISMATCH'); }
        if (!requested ||
            !correctionFitsReview(requested,feedback.correctionScope)) {
          throw new Error('CODE_MODE_VISUAL_REVIEW_SCOPE_MISMATCH');
        }
        try {
          materialIntent = normalizedMaterialCorrectionIntent(args.correctionIntent);
        } catch {
          throw new Error('CODE_MODE_MATERIAL_INTENT_REQUIRED');
        }
        if (!materialIntent) throw new Error('CODE_MODE_MATERIAL_INTENT_REQUIRED');
        const issue = feedback.issues.find(entry =>
          entry.id === materialIntent.issueId);
        if (!issue) throw new Error('CODE_MODE_MATERIAL_ISSUE_NOT_REVIEWED');
        if (issue.partId && issue.partId !== materialIntent.partId) {
          throw new Error('CODE_MODE_MATERIAL_TARGET_MISMATCH');
        }
        if (feedback.rejectedApproaches.some(item =>
            item.issueId === materialIntent.issueId &&
            item.approachId === materialIntent.approachId)) {
          throw new Error('CODE_MODE_MATERIAL_APPROACH_PREVIOUSLY_REJECTED');
        }
        // Reviewer-backed material work is sample-first. An explicitly
        // specified exact-RGBA edit outside this visual-review workflow
        // retains the existing SDK/Rust authorization contract.
        const cohort = feedback.materialCohort;
        if (!cohort) throw new Error('CODE_MODE_MATERIAL_SAMPLE_REQUIRED');
        if (cohort.issueId !== materialIntent.issueId ||
            cohort.partId !== materialIntent.partId ||
            cohort.approachId !== materialIntent.approachId) {
          throw new Error('CODE_MODE_MATERIAL_COHORT_IDENTITY_MISMATCH');
        }
        if (cohort.phase === 'sample') {
          if (!correctionFitsReview(requested,{
            textureUuid:feedback.correctionScope.textureUuid,
            allowedRegions:[cohort.sampleRegion],
            preserveAlpha:feedback.correctionScope.preserveAlpha,
          })) throw new Error('CODE_MODE_MATERIAL_SAMPLE_REGION_REQUIRED');
        } else {
          if (cohort.sampleVerdict !== 'ACCEPTED' ||
              cohort.source_model_sha256 !== p.expectedSha256 ||
              cohort.capture_png_sha256 !== visualPair.capture.sha256 ||
              cohort.reference_png_sha256 !== visualPair.reference.sha256) {
            throw new Error('CODE_MODE_MATERIAL_SAMPLE_UNVERIFIED');
          }
          // Avoid repainting the representative material just accepted by
          // the reviewer while styling the remaining surfaces.
          if (requested.allowed_regions.some(rect =>
              overlapsRectangle(rect,cohort.sampleRegion))) {
            throw new Error('CODE_MODE_MATERIAL_ACCEPTED_SAMPLE_PROTECTED');
          }
        }
      }
      if (visualPair !== null && pixelEdit) {
        // An image may change after preflight. Verify BOTH original PNGs
        // immediately before output/approval/native mutation.
        await Promise.all([
          pinnedReviewBytes(visualPair.reference),
          pinnedReviewBytes(visualPair.capture),
        ]);
      }
      const output = await outputPath(args.output, '.bbmodel');
      const receipt = await p.apply({ output, operations: args.operations,
        correctionScope: args.correctionScope,
        ...(materialIntent ? {correctionIntent:materialIntent} : {}) });
      if (visualPair !== null && typeof reviewVisualPair === 'function' && pixelEdit) {
        // The CLI committed its no-overwrite result. Even if registering
        // its next handle fails, retrying the same snapshot is unsafe.
        completedReviewedCorrections.add(p.expectedSha256);
      }
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
    exportAnimations: async (args) => {
      const p = selected(args);
      const output = await outputPath(args.output, '.animation.json');
      return p.exportAnimations({ output });
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

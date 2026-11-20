/**
 * Trusted host for Code Mode RPC. Model JavaScript runs in a separate Deno
 * permission-denied process, never in this Node process or in Tauri/Rust.
 * The host alone holds first-party Rust CLI credentials and file authority.
 * SOURCE_ONLY: no native runtime or sandbox proof has been executed.
 */
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createExecutionMetrics } from './execution-metrics.mjs';
import { fileURLToPath } from 'node:url';
import { createRustCodeModeClient, openRustCodeModeProject } from './client.mjs';
import { createLiveReadClient } from './live-read-client.mjs';
import { compactTaskContext, preflightGuidance } from './task-context.mjs';
import {createWorkflowGate} from './workflow-gate.mjs';
import {inspectTexturingReadiness} from './texturing-readiness.mjs';
import {inspectSelectedVisualPair} from './selected-visual-pair-inspection.mjs';
import {prepareMaterialApplyAdmission} from './material-apply-admission.mjs';
import {assertUniqueSavedMaterialTextureUuid} from './material-reference-source-identity.mjs';
import {SHA256,requireAbsolute,regularFile,outputName,checkFreshSibling}
  from './trusted-local-files.mjs';
import {boundGeometryLandmark,confirmedGeometryCube,
  pinnedVisualPair,pinnedReviewBytes,pinnedReviewImageLeaseValid}
  from './visual-source-binding.mjs';
import {materialWorkPacketDigest} from './material-work-packet.mjs';
import {assertApprovedWorkspaceReferenceFresh,
  referencePackageLeaseValid} from './approved-reference-package.mjs';

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

// A successful CLI exit is not a sufficient mutation receipt. The native
// publisher may already have written a sibling even when this check refuses;
// never replay, delete, or silently accept that uncertain output.
function verifiedModelMutationSha(receipt, expectedSourceSha, operationCount) {
  if (typeof receipt?.source_sha256 !== 'string' ||
      receipt.source_sha256.toLowerCase() !== expectedSourceSha.toLowerCase() ||
      typeof receipt?.output_sha256 !== 'string' ||
      !SHA256.test(receipt.output_sha256) ||
      !Number.isSafeInteger(receipt?.mutation?.revision) ||
      receipt.mutation.revision < 1 ||
      receipt?.mutation?.operation_count !== operationCount ||
      receipt?.summary?.revision !== receipt.mutation.revision) {
    throw new Error('CODE_MODE_RUST_MUTATION_RECEIPT_UNVERIFIED');
  }
  return receipt.output_sha256.toLowerCase();
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
  preselectedVisualPair, preselectedGeometryLandmark,
  approvedReferencePackagePath,
  reviewVisualPair, runner, spawnImpl, liveReadPairing, liveReadClient,
  observeExecutionMetrics, workflowFile,
} = {}) {
  // A pure live read-only session has no disk model, no file publisher and
  // does not use the CLI. Requiring a separate Rust binary in that mode
  // would defeat the session bridge's purpose.
  const pureLiveRead = input === undefined && outputDirectory === undefined;
  if (pureLiveRead && [
    authorizeMutation, preselectedPngPath, approvedMaterialReferenceUuid,
    preselectedVisualPair, preselectedGeometryLandmark,
    approvedReferencePackagePath, reviewVisualPair, workflowFile,
  ].some(value => value !== undefined)) {
    // A live-only host cannot contain any disk-writer, texture-import or
    // reference-pair declaration. Those require an independent saved source
    // SHA and separate trusted operator authority.
    throw new Error('CODE_MODE_LIVE_READ_ONLY_CONFIG_INVALID');
  }
  if (!pureLiveRead || rustBinary !== undefined) {
    requireAbsolute(rustBinary, 'rustBinary');
  }
  requireAbsolute(denoBinary, 'denoBinary');
  if ((input !== undefined && outputDirectory !== undefined) ||
      (input === undefined && outputDirectory === undefined &&
       liveReadPairing === undefined && liveReadClient === undefined)) {
    throw new Error('CODE_MODE_SOURCE_OR_OUTPUT_DIRECTORY_REQUIRED');
  }
  if (liveReadPairing !== undefined && liveReadClient !== undefined) {
    throw new Error('LIVE_READ_DUPLICATE_PROVIDER');
  }
  // The paired Windows capability exists only in trusted Node memory. It
  // never appears in guest code, a tool schema, the initial project ref,
  // process arguments or an environment variable.
  const liveReader = liveReadPairing !== undefined ?
    createLiveReadClient(liveReadPairing) : liveReadClient ?? null;
  if (liveReader !== null &&
      (typeof liveReader.sessionInfo !== 'function' ||
       typeof liveReader.semanticMap !== 'function')) {
    throw new TypeError('LIVE_READ_TRUSTED_PROVIDER_INVALID');
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
  if (observeExecutionMetrics !== undefined &&
      typeof observeExecutionMetrics !== 'function') {
    throw new TypeError('observeExecutionMetrics must be a trusted-host function');
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
  if (approvedReferencePackagePath!==undefined &&
      (preselectedVisualPair===undefined || input===undefined)) {
    throw new Error('CODE_MODE_REFERENCE_REQUIRES_VISUAL_INPUT_MODEL');
  }
  const source = input === undefined ? null :
    await regularFile(input, 'CODE_MODE_SOURCE');
  if (source !== null && !source.toLowerCase().endsWith('.bbmodel')) {
    throw new Error('CODE_MODE_SOURCE_EXTENSION_INVALID');
  }
  let folder;
  if (source === null && outputDirectory !== undefined) {
    const dir = await lstat(outputDirectory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) {
      throw new Error('CODE_MODE_OUTPUT_DIRECTORY_INVALID');
    }
    folder = await realpath(outputDirectory);
  } else if (source !== null) {
    folder = await realpath(dirname(source));
  } else {
    // Pure live read pairing: no disk project, no output directory, no write.
    folder = null;
  }
  if (!pureLiveRead && !runner) {
    await regularFile(rustBinary, 'CODE_MODE_RUST_BINARY');
  }
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

  // External production host: canonical existing README, never guest input.
  // Injected runner is a trusted test seam; explicit workflowFile opts in.
  const workflowTarget=folder===null?null:join(folder,'README.md');
  if(workflowFile!==undefined &&
     requireAbsolute(workflowFile,'workflowFile')!==workflowTarget){
    throw new Error('CODE_MODE_WORKFLOW_PATH_INVALID');
  }
  const gateEnabled=folder!==null&&(runner===undefined||workflowFile!==undefined);
  let workflowGate=null;
  // Only one code session may be active per host. Operator approval is
  // invalidated when that session exits or times out.
  let activeExecution = null;
  // Native adapter calls can complete after their Deno guest has exited.
  // Scope each observation to the originating RPC rather than whichever
  // later guest currently occupies the host slot.
  const metricScope = new AsyncLocalStorage();
  // Every approval descriptor is linked to the exact guest that received it.
  // This prevents an old approval from being consumed by a later guest when
  // Rust plan-file creation yields to the event loop before CLI launch.
  const approvedGuest = new WeakMap();
  const client = pureLiveRead ? null : createRustCodeModeClient({
    binary: rustBinary,
    ...(runner ? { runner } : {}),
    onNativeCall: (sample) => {
      const run = metricScope.getStore();
      if (!run) return;
      run.metrics.recordNativeCall(sample);
    },
    authorizeMutation: async (request) => {
      const execution = activeExecution;
      if (!execution || execution.closed ||
          typeof request.output !== 'string') return false;
      try { await checkFreshSibling(request.output, folder); }
      catch { return false; }
      if (typeof authorizeMutation !== 'function' ||
          execution.closed || activeExecution !== execution) return false;
      const selectedModel=request.input===undefined?null:
        [...projects.values()].find(p=>p.input===request.input &&
          p.expectedSha256===request.expectedSha256);
      // Gate EVERY write before user approval; source SHA and native Rust
      // transaction checks still happen independently at Apply.
      const stageLease=workflowGate===null?null:
        await workflowGate.authorize(request,selectedModel?.summary);
      execution.pause();
      const approvalStarted = execution.metrics.mark();
      let approved;
      try {
        approved = await authorizeMutation(Object.freeze({
          ...request,
          ...(visualPair?.referencePackageBinding?{
            approvedReferencePackageSha256:
              visualPair.referencePackageBinding.fingerprintSha256,
            approvedReferenceCriterionCount:
              visualPair.reviewCriteria?.length??0,
          }:{}),
        }));
      } finally {
        execution.metrics.recordApprovalSince(approvalStarted);
        execution.resume();
      }
      // Prevent a delayed approval from reviving a timed-out guest.
      const valid = approved === true &&
        !execution.closed && activeExecution === execution;
      if (valid) approvedGuest.set(request,{execution,stageLease});
      return valid;
    },
    // Synchronous last lease check, directly before the SDK launches Rust.
    // No async work may occur between this check and the execFile request.
    permitWriteLaunch: (request) => {
      const approved = approvedGuest.get(request);
      approvedGuest.delete(request);
      return approved!==undefined &&
        approved.execution===activeExecution && !approved.execution.closed &&
        (workflowGate===null || workflowGate.leaseValid(approved.stageLease)) &&
        (!visualPair?.referencePackageBinding ||
          referencePackageLeaseValid(visualPair.referencePackageBinding)) &&
        (visualPair===null || visualViews.every(view=>
          pinnedReviewImageLeaseValid(view.reference) &&
          pinnedReviewImageLeaseValid(view.capture)));
    },
  });
  const projects = new Map();
  const initialProject = source === null ? null :
    await openRustCodeModeProject(client, source);
  if(gateEnabled)workflowGate=createWorkflowGate({
    folder,source,sourceSha:initialProject?.expectedSha256??null,
  });
  // Read existing README once at Start/Resume. Missing/stale declarations
  // are visible as BLOCKED, but do not prevent read-only inspection.
  const workflowOrientation=workflowGate===null?null:
    await workflowGate.orient();
  if (referenceMaster!==null) {
    await assertUniqueSavedMaterialTextureUuid(initialProject,referenceMaster);
  }
  if (initialProject) projects.set('p0', initialProject);
  let nextProject = initialProject ? 1 : 0;
  const visualPair = await pinnedVisualPair(
    source, preselectedVisualPair, initialProject?.expectedSha256 ?? null,
    approvedReferencePackagePath);
  const visualViews=Object.freeze(visualPair===null?[]:[
    visualPair,...visualPair.additionalViews,
  ]);
  const geometryLandmark=boundGeometryLandmark(
    preselectedGeometryLandmark,visualViews);
  // One transient source/image link, invalid until an exact visual read.
  let verifiedGeometryLandmark=null;
  // One ephemeral review state per exact model SHA, not a second asset store.
  const visualPreflights = new Map();
  // Single immutable source/view selection per host. Repeated multi-view
  // reads do not need six Rust PNG decoders after a successful preflight,
  // provided Rust re-verifies the model SHA and Node re-hashes EVERY PNG.
  // Cache never grants review/paint approval or persists between hosts.
  let verifiedMultiViewRead = null;
  // Only trusted, same-session, SHA-bound reviewer outputs are accumulated.
  // The untrusted Deno guest sees a compact summary, never 1024 raw face
  // declarations or a second persistent approval/asset registry.
  let pagedFaceLedger = null;
  // One coherent reviewed correction per source revision. Do not create
  // multiple variants from a stale, already-rejected capture.
  const completedReviewedCorrections = new Set();
  const initialRef = Object.freeze(initialProject ? {
    project: 'p0', sha256: initialProject.expectedSha256,
    summary: initialProject.summary,
    ...(workflowOrientation!==null?{workflow:workflowOrientation}:{}),
    ...(liveReader ? { liveReadOnly: true } : {}),
  } : {
    project: null, sha256: null, summary: null,
    ...(workflowOrientation!==null?{workflow:workflowOrientation}:{}),
    ...(liveReader ? { liveReadOnly: true } : {}),
  });

  function selected(args) {
    const id = requireObject(args).project;
    if (typeof id !== 'string' || !projects.has(id)) {
      throw new Error('CODE_MODE_PROJECT_HANDLE_UNKNOWN');
    }
    return projects.get(id);
  }
  async function outputPath(name, suffix) {
    if (folder === null) throw new Error('CODE_MODE_DISK_OUTPUT_UNAVAILABLE');
    const path = join(folder, outputName(name, suffix));
    await checkFreshSibling(path, folder);
    return path;
  }
  async function register(path,expectedOutputSha) {
    if (projects.size >= MAX_PROJECTS) {
      throw new Error('CODE_MODE_PROJECT_LIMIT_REACHED');
    }
    const project = await openRustCodeModeProject(client, path);
    // Reopen the actual saved sibling before accepting the Rust publisher
    // receipt. A claimed output hash and a mismatching saved model must not
    // acquire a successful Code Mode handle, even with a valid PNG guard.
    if (expectedOutputSha!==undefined &&
        project.expectedSha256!==expectedOutputSha) {
      throw new Error('CODE_MODE_RUST_PUBLISHED_OUTPUT_SHA_MISMATCH');
    }
    const handle = 'p' + nextProject++;
    if(workflowGate!==null)workflowGate.register(path,project.expectedSha256);
    projects.set(handle, project);
    // A host-visible final candidate does not depend on the guest choosing
    // to echo the file in its return JSON. Never reuse a previous script's
    // candidate or report an unverified/uncertain native publication.
    if(activeExecution && !activeExecution.closed) {
      activeExecution.latestCandidate=Object.freeze({
        project:handle,candidateFile:basename(path),
        sha256:project.expectedSha256,visual_verdict:'UNVERIFIED',
      });
    }
    // Exact Rust-verified candidate filename for manual GUI selection.
    // Never a visual approval or an automatic replacement of the GUI model.
    return { project: handle, sha256: project.expectedSha256,
      summary: project.summary, candidateFile: basename(path) };
  }
  // The fixed capability boundary is intentionally much smaller than shell,
  // filesystem or generic Rust CLI access. Only owned methods are dispatched.
  const actions = Object.freeze({
    // New live-read functions are independent of disk project handles.
    // There is deliberately NO liveApply/liveImport/liveSave operation.
    liveSessionInfo: async () => {
      if (!liveReader) throw new Error('LIVE_READ_NOT_PAIRED');
      return liveReader.sessionInfo();
    },
    liveSemanticMap: async (args) => {
      if (!liveReader) throw new Error('LIVE_READ_NOT_PAIRED');
      return liveReader.semanticMap({
        expectedEpoch: args.expectedEpoch,
        expectedRevision: args.expectedRevision,
        category: args.category, offset: args.offset, limit: args.limit,
      });
    },
    projectInfo: async (args) => {
      const p = selected(args);
      return { project: args.project, sha256: p.expectedSha256,
        summary: p.summary };
    },
    inspect: async (args) => selected(args).inspect(args.uuid),
    catalog: async (args) => selected(args).catalog(args.kind, {
      offset: args.offset, limit: args.limit,
    }),
    semanticMap: async (args) => selected(args).semanticMap(args.category, {
      offset: args.offset, limit: args.limit,
    }),
    preflight: async (args) => selected(args).preflight({
      operations: args.operations, correctionScope: args.correctionScope,
    }),
    // P0 read-only semantic material plan: Rust decides pixel masks/UV;
    // the guest may not use this as visual acceptance or write authority.
    planSemanticMaterial: async (args) =>
      selected(args).planSemanticMaterial(args.intent),
    // A1 read-only Rust rotation sampler; Apply stays separately authorized.
    planPeriodicRotation: async (args) =>
      selected(args).planPeriodicRotation(args.intent),
    // Exact authored poses; Rust returns only preflight and review hints.
    planSemanticAnimation: async (args) =>
      selected(args).planSemanticAnimation(args.intent),
    // Existing clip review or explicit one-key change; no hidden native Apply.
    reviewExistingAnimation: async (args) =>
      selected(args).reviewExistingAnimation(args.intent),
    // Structure-first G1 composition is a SHA-pinned read-only Rust plan.
    // No trusted-host approval, output path, live write, or implicit Apply.
    planGeometryAssembly: async (args) =>
      selected(args).planGeometryAssembly(args.assembly),
    // G2 remains read-only: all file edits use independently approved Apply.
    planGeometryAttachment: async (args) =>
      selected(args).planGeometryAttachment(args.attachment),
    // One-shot G2.2 Rust planning; no saved graph or new writer.
    planGeometryResizePropagation: async (args) =>
      selected(args).planGeometryResizePropagation(args.propagation),
    // Only the trusted operator may bind a source Cube to a pinned
    // pixel-mask region. The guest declares numerical bounds, not identity.
    // Rust's existing ReframeCube preflight is the sole geometry authority.
    planReviewedGeometryReframe: async (args) => {
      const model=selected(args);
      if (Object.keys(args).some(key=>![
        'project','from','to','uvPolicy',
      ].includes(key))) {
        throw new Error('CODE_MODE_GEOMETRY_REFRAME_ARGUMENT_INVALID');
      }
      const evidence=verifiedGeometryLandmark;
      if (!evidence || evidence.source_model_sha256!==model.expectedSha256) {
        throw new Error('CODE_MODE_GEOMETRY_LANDMARK_EVIDENCE_REQUIRED');
      }
      const vector=v=>Array.isArray(v) && v.length===3 &&
        v.every(n=>typeof n==='number' && Number.isFinite(n));
      if (!vector(args.from) || !vector(args.to) ||
          args.from.some((v,i)=>v>args.to[i]) ||
          !['manual_preserve','box_repack'].includes(args.uvPolicy)) {
        throw new Error('CODE_MODE_GEOMETRY_REFRAME_ARGUMENT_INVALID');
      }
      if(args.from.every((v,i)=>v===evidence.source_from[i]) &&
         args.to.every((v,i)=>v===evidence.source_to[i])) {
        throw new Error('CODE_MODE_GEOMETRY_REFRAME_NO_CHANGE');
      }
      const operation={op:'reframe_cube',uuid:evidence.cube_uuid,
        from:[...args.from],to:[...args.to],uv_policy:args.uvPolicy};
      const planned=await model.preflight({operations:[operation]});
      if(planned.sha256!==model.expectedSha256 ||
         planned.summary?.revision!==0 ||
         planned.preflight?.write_authority!=='NOT_GRANTED' ||
         planned.preflight?.visual_verdict!=='UNVERIFIED' ||
         planned.preflight?.mutation?.operation_count!==1 ||
         planned.preflight?.mutation?.changed_uuids?.length!==1 ||
         planned.preflight.mutation.changed_uuids[0]!==evidence.cube_uuid) {
        throw new Error('CODE_MODE_GEOMETRY_REFRAME_PREFLIGHT_UNVERIFIED');
      }
      // The preflight and fresh focused read must use the same model SHA;
      // re-hash every bound image before returning a possible correction.
      const source=confirmedGeometryCube(
        await model.inspect(evidence.cube_uuid),
        model.expectedSha256,evidence.cube_uuid);
      if (source.parent_bone_uuid!==evidence.parent_bone_uuid ||
          !source.source_from.every((v,i)=>v===evidence.source_from[i]) ||
          !source.source_to.every((v,i)=>v===evidence.source_to[i])) {
        throw new Error('CODE_MODE_GEOMETRY_LANDMARK_SOURCE_CHANGED');
      }
      if(visualPair.referencePackageBinding){
        await assertApprovedWorkspaceReferenceFresh(
          visualPair.referencePackageBinding);
      }
      await Promise.all(visualViews.flatMap(view=>[
        pinnedReviewBytes(view.reference),pinnedReviewBytes(view.capture),
      ]));
      return Object.freeze({
        status:'OK',source_model_sha256:model.expectedSha256,
        geometry_landmark:evidence,
        plan:Object.freeze({expected_revision:0,
          operations:Object.freeze([Object.freeze(operation)]),
          correction_scope:null}),
        preflight:planned.preflight,
        write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
      });
    },
    // One existing native authoring_target query, then a small host-only
    // projection. No unbounded scene/PNG/opaque payload reaches Deno.
    taskContext: async (args) => {
      const p = selected(args);
      const response = await p.inspectBatch([{
        kind: 'authoring_target',
        domain: args.domain, category: args.category, name: args.name,
      }]);
      return compactTaskContext(response, {
        project: args.project, domain: args.domain, category: args.category,
        name: args.name, expectedSha256: p.expectedSha256,
      });
    },
    // Advisory for deciding whether to call native dry-run. Never changes
    // real Apply validation, host approval, reviewed Paint or publication.
    preflightGuidance: async (args) => {
      const p = selected(args);
      return Object.freeze({
        source_model_sha256: p.expectedSha256,
        source_revision: p.summary.revision,
        ...preflightGuidance({
          operations: args.operations, correctionScope: args.correctionScope,
        }),
      });
    },
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
    inspectSelectedVisualPair: (args) => inspectSelectedVisualPair(args, {
      selected, client, visualPair, visualViews, reviewVisualPair,
      visualPreflights, geometryLandmark,
      get activeExecution() { return activeExecution; },
      get verifiedMultiViewRead() { return verifiedMultiViewRead; },
      set verifiedMultiViewRead(value) { verifiedMultiViewRead=value; },
      set pagedFaceLedger(value) { pagedFaceLedger=value; },
      set verifiedGeometryLandmark(value) { verifiedGeometryLandmark=value; },
    }),
    // Read-only terminal checkpoint. An accepted pixel transaction or empty
    // histogram is NEVER evidence that professional pixel-art Texturing ended.
    // This is a trusted-host source/view ledger, not a renderer, new approval
    // database, or guest-driven artistic PASS.
    texturingReadiness: (args) => inspectTexturingReadiness(args, {
      selected,
      get visualPair() { return visualPair; },
      get visualViews() { return visualViews; },
      get reviewVisualPair() { return reviewVisualPair; },
      get visualPreflights() { return visualPreflights; },
      get pagedFaceLedger() { return pagedFaceLedger; },
    }),
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
      if (typeof receipt?.sha256 !== 'string' || !SHA256.test(receipt.sha256)) {
        throw new Error('CODE_MODE_RUST_NEW_RECEIPT_UNVERIFIED');
      }
      return { receipt, ...await register(output, receipt.sha256.toLowerCase()) };
    },
    apply: async (args) => {
      const p = selected(args);
      const {
        reviewedTextureSession, activeOperations, pixelEdit,
        paintPlanSha256, materialIntent, workPacket, effectiveCorrectionScope,
      } = await prepareMaterialApplyAdmission({
        args, model:p, visualPair, reviewVisualPair, visualViews,
        visualPreflights, completedReviewedCorrections, referenceMaster,
      });
      const output = await outputPath(args.output, '.bbmodel');
      let receipt, publishedSha;
      try {
        receipt = await p.apply({ output, operations: activeOperations,
          correctionScope: effectiveCorrectionScope,
          ...(materialIntent ? {correctionIntent:materialIntent} : {}),
          ...(workPacket ? {materialWorkPacket:workPacket} : {}) });
        publishedSha = verifiedModelMutationSha(
          receipt, p.expectedSha256, activeOperations.length);
      } catch (error) {
        if (reviewedTextureSession && pixelEdit &&
            (error?.message==='CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED' ||
             error?.message==='CODE_MODE_RUST_MUTATION_RECEIPT_UNVERIFIED')) {
          // Rust may have published a sibling despite malformed output.
          // Freeze this reviewed source revision: a renamed retry would
          // conceal the unresolved native result from the operator.
          completedReviewedCorrections.add(p.expectedSha256);
        }
        throw error;
      }
      if (visualPair !== null && typeof reviewVisualPair === 'function' && pixelEdit) {
        // The CLI committed its no-overwrite result. Even if registering
        // its next handle fails, retrying the same snapshot is unsafe.
        completedReviewedCorrections.add(p.expectedSha256);
      }
      // Reopen through native Rust inspection and compare the actual saved
      // model SHA for every edit, not only scoped Paint corrections.
      const next=await register(output, publishedSha);
      return { receipt, ...next,
        ...(pixelEdit?{texturing_workflow:{
          status:'PAINT_SAVED_NOT_VISUALLY_ACCEPTED',
          source_model_sha256:next.sha256,
          operation_plan_fingerprint_sha256:paintPlanSha256,
          style_evidence:receipt.texture_styling_evidence??null,
          source_pixel_guards:{
            protected_regions:effectiveCorrectionScope?.protectedRegions?.length??0,
            expected_before_pixels:effectiveCorrectionScope?.expectedBeforePixels?.length??0,
            editable_before_rgba:effectiveCorrectionScope?.editableBeforeRgba?.length??0,
            verified_by_rust_receipt:receipt.correction_scope?.status==='enforced' &&
              receipt.correction_scope.protected_regions===
                (effectiveCorrectionScope?.protectedRegions?.length??0) &&
              receipt.correction_scope.expected_before_pixels===
                (effectiveCorrectionScope?.expectedBeforePixels?.length??0) &&
              receipt.correction_scope.editable_before_rgba===
                (effectiveCorrectionScope?.editableBeforeRgba?.length??0),
          },
          ...(workPacket?{material_work_packet:{
            status:'SOURCE_BOUND_PLAN_NOT_ARTISTICALLY_VERIFIED',
            sha256:materialWorkPacketDigest(workPacket),
            planned_faces:workPacket.facePlans.length,
            source_model_sha256:workPacket.sourceModelSha256,
            reference_png_sha256:workPacket.referencePngSha256,
            visual_verdict:'UNVERIFIED',
          }}:{}),
          next:'Inspect face-local material styling and review fresh mapped views before declaring STYLED.',
          texture_completion_attested:false,
        }}:{})};
    },
    importPng: async (args) => {
      const p = selected(args);
      if (visualPair !== null && typeof reviewVisualPair === 'function') {
        // Even a host-preselected PNG import is a new full-texture write,
        // not a reviewer-bound bounded RGB correction. Require a separate
        // operator-authorized asset-import session, never a silent bypass.
        throw new Error('CODE_MODE_REVIEWED_TEXTURE_IMPORT_SEPARATE_HOST');
      }
      if (!png) throw new Error('CODE_MODE_PNG_NOT_PRESELECTED_BY_HOST');
      const output = await outputPath(args.output, '.bbmodel');
      const receipt = await client.importPng({
        input: p.input, output, png, uuid: args.uuid, name: args.name,
        expectedSha256: p.expectedSha256,
      });
      const publishedSha = verifiedModelMutationSha(receipt, p.expectedSha256, 1);
      return { receipt, ...await register(output, publishedSha) };
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
    const execution = {
      closed: false, pendingApproval: false, pause: () => {}, resume: () => {},
      latestCandidate:null,
      metrics: createExecutionMetrics(pureLiveRead ? 'NO_DISK_RUST' :
        (runner ? 'INJECTED_RUNNER' : 'CLI_EXECFILE')),
    };
    const metrics = () => execution.metrics.snapshot();
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
    let outcome = 'ERROR';
    try {
    const result = await new Promise((resolve, reject) => {
      let closed = false;
      let concluded = null;
      let failure = null;
      let buffered = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let calls = 0;
      let pendingRpc = 0;
      // Byte counts of admitted RPC frames vs the final guest-selected
      // value. This observes context projection, not tokens or elapsed time.
      let rpcResponseBytes = 0;
      let modelResultBytes = 0;
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
        if (!closed && !child.stdin.destroyed) {
          child.stdin.write(data);
          rpcResponseBytes += Buffer.byteLength(data, 'utf8');
        }
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
          modelResultBytes = resultBytes;
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
        const rpcStarted = execution.metrics.mark();
        try {
          try {
            const value = await metricScope.run(execution, () =>
              actions[message.method](requireObject(message.args[0])));
            send({ type: 'rpc_result', id: message.id, ok: true, result: value });
          } catch (error) {
            execution.metrics.recordRpcFailure();
            send({ type: 'rpc_result', id: message.id, ok: false,
              code: shortError(error) });
          }
        } finally {
          execution.metrics.recordRpcSince(rpcStarted);
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
          execution.metrics.recordFirstGuestFrame();
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
            ...(execution.latestCandidate?{
              latestCandidate:execution.latestCandidate,
            }:{}),
            logs: Array.isArray(concluded.logs) ?
              concluded.logs.slice(0, 12) : [],
            rpc_calls: calls,
            rpc_response_bytes: rpcResponseBytes,
            model_result_bytes: modelResultBytes,
            performance: metrics(),
          }));
        }).catch(reject);
      });
      child.stdin.write(start);
    });
    outcome = 'OK';
    return result;
    } finally {
      // The optional trusted observer is the sole failure-sample outlet.
      // Never log model/source strings, guest scripts, selected names,
      // paths, PNGs, pairing tokens or raw errors. It cannot change the
      // tool's real execution result.
      if (observeExecutionMetrics) {
        try { observeExecutionMetrics(Object.freeze({
          outcome, performance: metrics(),
        })); } catch {}
      }
    }
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
    description: [
      'Use ONE isolated Code Mode script over the typed Rust SDK. Return only decision-relevant JSON, current source SHA and blockers, never entire native receipts. Rust owns document, UV/PNG, animation, Undo and file publication. At Start/Resume use codemode.initial.project, sha256, summary and workflow; do not request projectInfo for unchanged initial facts. SOURCE_BOUND means only file/stage declarations match, not artistic approval; BLOCKED means reconcile the existing asset README/source before any write. The host rechecks it before mutation.',
      'Choose the smallest source lookup ONCE: known UUID => focused inspect or direct typed edit; one unknown saved name => taskContext (one verified authoring_target read); several related facts => inspectBatch. Do not call taskContext AND inspectBatch for the same lookup. Never guess UUIDs from names or screenshots.',
      'Unknown-name example: const t=await codemode.taskContext({project:codemode.initial.project,domain:"texturing",category:"cubes",name:"Helmet"}); return {sha:t.source_model_sha256,status:t.status,uuid:t.target?.uuid??null,blockers:t.source_blockers,candidates:t.status==="EXACT_MATCH"?undefined:t.candidates};',
      'Geometry: one known Cube/Bone correction => bounded EditPlan; dependent structural cohort => planGeometryAssembly with explicit Bone pivots and UUIDs, including frames/hollow_boxes/arches/sweeps/profile_sweeps/lofts/revolves/rib_arrays as needed. Use planGeometryAttachment or planGeometryResizePropagation only for supported same-Bone relationships. Optional void_zones and geometry_impact are bounded advisories, not whole-model collision, motion, UV or visual proof.',
      'Texturing: known exact RGBA and UV => one guarded Paint/face cohort rather than a per-pixel tool loop. For a supported painted_metal reference-selected face, planSemanticMaterial may propose a candidate, not accepted artwork. Preserve source RGBA, alpha, UV ownership, existing details and approved areas. For broad styling, require the existing representative-sample and independent matched-view review before propagation; do not infer quality from color statistics.',
      'Animation: for an EXISTING saved numeric clip use reviewExistingAnimation once (exact animation_uuid), optionally with a caller-authorized source-preconditioned single-key correction; report source issues with Bone/channel/key IDs, never auto-fix ambiguous Euler/curves/contact. A returned correction preflight is NOT approval or native playback PASS. Group coherent exact Bone/clip/keyframe operations in one EditPlan; reuse editable clips with duplicate_animation_clip when valid. For a NEW authored action/gait with exact semantic poses, use planSemanticAnimation once; optional followers derive one-level delayed source-linear rotation/position deltas (explicit Bone UUIDs, lag_seconds, gain and rest_value), not IK, springs or inferred contact. Contact windows and temporal review times are hints, never native foot locking, world-space contact, or playback PASS. Optional probes use one source-model ZYX Bone hierarchy and bounded pivot-local marker positions; sampled displacement is advisory only, not continuous native motion, entity travel, physical contact, IK, or visual acceptance. For exact new semantic poses, optional per-transform interpolation can select native Step or Catmull-Rom, but not Bezier without explicit handles; this is authored-key timing, not sampled visual quality. Use native Step/Catmull-Rom/Bezier on other routes only when the intended motion calls for them. planPeriodicRotation is only for explicit periodic numeric Bone rotation with a bounded scalar error; not IK, contact, physics, continuous 3D pose accuracy or playback acceptance.',
      'Every first-party plan* response with a valid Rust preflight already dry-runs its exact plan. Do NOT call preflightGuidance or standalone preflight again when that same validated planner result, source SHA, operations and correction_scope are unchanged. If the plan was rewritten, unverified or lacks matching preflight, use source-bound preflight for nontrivial changes. Preflight is NOT write authority or visual approval; Apply independently revalidates SHA/revision, scoped pixels, permissions and output.',
      'Use semanticMap only for bounded identity inventories; taskContext only for a single unknown-name target. planReviewedGeometryReframe requires a separately trusted operator-bound landmark and matched view. All inferred geometry/UV/animation relationships remain UNVERIFIED until source and visual review.',
      ...(host.initial?.liveReadOnly ? [
        'A paired GUI live session supports liveSessionInfo and liveSemanticMap READ ONLY with exact epoch/revision; it is separate from saved-file Code Mode. Never attempt live writes.'
      ] : []),
      'Apply only after exact source selection and trusted-host mutation approval, preferably in the SAME Code Mode script after necessary inspection. Group related work without unrelated changes; no implicit saves, unreviewed texture propagation, blind retry of uncertain outcomes, shell, network or direct file access. After New/Apply/Import the host-level latestCandidate identifies one verified saved sibling even when the script omits its filename; it is not approval or a GUI live handoff. Review affected consumers and fresh full visual views where quality acceptance requires them.'
    ].join(' '),
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: { code: { type: 'string', minLength: 1, maxLength: 32768 } },
    }),
    execute: ({ code }) => host.execute({ code }),
  });
}

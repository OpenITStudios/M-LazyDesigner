import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ProjectObservationSnapshotStore } from "./projectObservationStore";

/**
 * L0 project observation: fixed-size aggregate summaries, never response
 * serialization, prompt/image persistence, AI calls or extra Runtime requests.
 * Detailed per-call evidence stays in the existing opt-in benchmark recorder.
 */
export type ProjectObservationTool =
  | "status" | "search_capabilities" | "describe_capability" | "invoke_capability";

export type ObservedPhase = "GEOMETRY" | "TEXTURING" | "ANIMATION";
export type ObservedDomain = ObservedPhase | "CORE";
type PhaseObservationSource = "VERIFIED_STATUS" | "VERIFIED_PHASE_RECEIPT";
type ObservationCounts = {
  calls: number;
  failures: number;
  duration_sum_ms: number;
  max_duration_ms: number;
  by_tool: Record<ProjectObservationTool, number>;
  capabilities: Record<string, number>;
  error_codes: Record<string, number>;
  verification_required: number;
  acceptance_gate_invalidations: number;
  downstream_recheck_requests: number;
  user_delta_status_observations: number;
};
type DomainCounts = {
  calls: number;
  failures: number;
  duration_sum_ms: number;
  verification_required: number;
};
type BuildCallCounts = {
  calls: number;
  failures: number;
  duration_sum_ms: number;
};

export type ProjectObservationSummary = {
  /** SHA-256 of the verified native UUID, not its plaintext. */
  project_key: string;
  identity_scope: "VERIFIED_NATIVE_UUID_ONLY";
  first_seen_ms: number;
  last_seen_ms: number;
  counters: ObservationCounts;
  by_domain: Partial<Record<ObservedDomain, DomainCounts>>;
  observed_phase: ObservedPhase | null;
  phase_observations: Array<{
    at_ms: number;
    phase: ObservedPhase;
    source: PhaseObservationSource;
    observation: "FIRST_SEEN" | "CHANGED_BETWEEN_OBSERVATIONS";
  }>;
  observed_distinct_task_contexts: number;
  task_contexts_capped: boolean;
  /** Observed via authenticated/bound Gateway status, not a source Git SHA. */
  runtime_build_keys?: string[];
  runtime_build_keys_capped?: boolean;
  /** Exact saved project content at an existing FINALIZATION native match only. */
  matched_checkpoint_sha256_refs?: string[];
  checkpoint_refs_capped?: boolean;
  /** Only calls with existing bound Runtime evidence are build-attributed. */
  observed_runtime_build_calls?: Record<string, BuildCallCounts>;
  runtime_build_unattributed_calls?: number;
  runtime_build_call_counts_capped?: boolean;
  /** Source-correlatable Control handle digests; not raw task IDs or approval. */
  observed_task_context_hashes?: string[];
  task_context_hashes_capped?: boolean;
};

export type ProjectObservationSnapshot = {
  schema: "lazydesigner-project-observation-v1";
  session_id: string;
  /** OPEN can indicate an active session or an unexpected shutdown. */
  state: "OPEN" | "CLOSED";
  capture_scope: "RECENT_BOUNDED_GATEWAY_L0";
  recorded_at_ms: number;
  first_seen_ms: number | null;
  last_seen_ms: number | null;
  observed_calls: number;
  unbound: ObservationCounts;
  projects: ProjectObservationSummary[];
  dropped_project_observations: number;
  capture_failures: number;
  persist_failures: number;
  retention: {
    max_session_files: 16;
    max_snapshot_bytes: 131072;
    max_projects_per_session: 12;
    checkpoint_every_calls: 64;
  };
};

const MAX_PROJECTS = 12;
const MAX_CAPABILITIES = 24;
const MAX_ERROR_CODES = 12;
const MAX_PHASE_OBSERVATIONS = 24;
const MAX_CONTEXTS = 64;
const MAX_BUILD_CALL_KEYS = 8;
const MAX_CONTEXT_HASHES = 32;
const MAX_SNAPSHOT_BYTES = 128 * 1024;
const MAX_SESSION_FILES = 16;
const CHECKPOINT_EVERY = 64;
const CHECKPOINT_INTERVAL_MS = 60_000;

function counts(): ObservationCounts {
  return {
    calls: 0,
    failures: 0,
    duration_sum_ms: 0,
    max_duration_ms: 0,
    by_tool: {
      status: 0, search_capabilities: 0,
      describe_capability: 0, invoke_capability: 0,
    },
    capabilities: Object.create(null) as Record<string, number>,
    error_codes: Object.create(null) as Record<string, number>,
    verification_required: 0,
    acceptance_gate_invalidations: 0,
    downstream_recheck_requests: 0,
    user_delta_status_observations: 0,
  };
}

function recordBucket(target: Record<string, number>, label: string, limit: number) {
  const name = Object.hasOwn(target, label) || Object.keys(target).length < limit
    ? label : "OTHER";
  target[name] = (target[name] ?? 0) + 1;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function phase(value: unknown): ObservedPhase | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return upper === "GEOMETRY" || upper === "TEXTURING" || upper === "ANIMATION"
    ? upper : null;
}

function domain(value: unknown): ObservedDomain | null {
  return value === "CORE" ? "CORE" : phase(value);
}

function safeCapability(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,96}$/.test(value)
    ? value : "UNKNOWN_CAPABILITY";
}

function safeError(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value)
    ? value : null;
}

function projectKey(uuid: string): string {
  return createHash("sha256").update("lazydesigner-native-project:" + uuid).digest("hex");
}

function baseDirectory(env: Record<string, string | undefined>): string | null {
  if (env.LAZYDESIGNER_PROJECT_OBSERVABILITY === "0") return null;
  if (process.platform === "win32") {
    return env.LOCALAPPDATA && isAbsolute(env.LOCALAPPDATA)
      ? join(env.LOCALAPPDATA, "LazyDesigner", "analytics") : null;
  }
  return env.XDG_STATE_HOME && isAbsolute(env.XDG_STATE_HOME)
    ? join(env.XDG_STATE_HOME, "LazyDesigner", "analytics")
    : join(homedir(), ".local", "state", "LazyDesigner", "analytics");
}

type ObservedCall = {
  tool: ProjectObservationTool;
  args: unknown;
  result: unknown;
  durationMs: number;
  /** Only the canonical executor may mark its already-verified native identity. */
  nativeIdentityVerified?: boolean;
  nativeProjectUuid?: string | null;
  nativePhaseAfter?: string | null;
  nativeDomain?: string | null;
  nativeVerificationClass?: string | null;
  /** Captured from existing verified native preflight, no extra health probe. */
  nativeRuntimeBuildIdentity?: string | null;
  /** Used only to construct deterministic tests. */
  observedAtMs?: number;
};

export class ProjectObservationRecorder {
  private readonly sessionId = randomBytes(8).toString("hex");
  private readonly fileName = "session-" + Date.now() + "-" + this.sessionId + ".json";
  private readonly projects = new Map<string, ProjectObservationSummary>();
  private readonly contexts = new Map<string, Set<string>>();
  private readonly unbound = counts();
  private readonly enabled: boolean;
  private readonly store: ProjectObservationSnapshotStore | null;
  private observedCalls = 0;
  private firstSeen: number | null = null;
  private lastSeen: number | null = null;
  private droppedProjects = 0;
  private captureFailures = 0;
  private sinceCheckpoint = 0;
  private lastCheckpoint = Date.now();
  private closed = false;

  constructor(directory: string | null) {
    this.enabled = directory !== null;
    this.store = directory === null ? null
      : new ProjectObservationSnapshotStore(directory, this.fileName);
  }

  static fromEnvironment(
    env: Record<string, string | undefined> = process.env
  ): ProjectObservationRecorder {
    return new ProjectObservationRecorder(baseDirectory(env));
  }

  get active(): boolean { return this.enabled; }

  record(input: ObservedCall): void {
    if (!this.enabled || this.closed) return;
    try {
      const now = input.observedAtMs ?? Date.now();
      const duration = Number.isFinite(input.durationMs) && input.durationMs >= 0
        ? Math.round(Math.min(input.durationMs, 24 * 60 * 60 * 1000)) : 0;
      const response = recordValue(input.result);
      const structured = recordValue(response?.structuredContent);
      const failed = response === null || response.isError === true;
      const gatewayStatus = input.tool === "status" ? structured : null;
      const runtime = recordValue(gatewayStatus?.runtime);
      const affinity = recordValue(gatewayStatus?.affinity);
      const controlProject = recordValue(
        recordValue(gatewayStatus?.control)?.project);
      const statusBound = !failed && gatewayStatus !== null &&
        runtime?.mcp_client_ready === true &&
        controlProject?.binding === "BOUND";
      const delta = input.tool === "invoke_capability" &&
        input.nativeIdentityVerified === true && !failed
        ? recordValue(structured?.control_delta) : null;

      // Never attribute an unverified/error result to a previously known tab.
      // Only canonical bound status or the executor's verified native
      // preflight may attribute an operation to a project. A Control Delta
      // appearing in arbitrary response metadata is not identity proof.
      const uuid = input.tool === "invoke_capability"
        ? (!failed && input.nativeIdentityVerified === true
          ? input.nativeProjectUuid : null)
        : statusBound ? affinity?.project_uuid : null;
      const verifiedUuid = typeof uuid === "string" && uuid.length <= 160 &&
        uuid.trim().length > 0 ? uuid : null;
      const observedPhase = verifiedUuid === null ? null
        : input.nativeIdentityVerified === true
          ? phase(input.nativePhaseAfter)
          : gatewayStatus !== null ? phase(affinity?.authoring_phase)
          : phase(delta?.phase_after);
      const phaseSource: PhaseObservationSource = gatewayStatus !== null
        ? "VERIFIED_STATUS" : "VERIFIED_PHASE_RECEIPT";
      const observedDomain = input.nativeIdentityVerified === true
        ? domain(input.nativeDomain)
        : domain(delta?.authoring_domain);
      const args = recordValue(input.args);
      const invalidates = recordValue(delta?.invalidates);
      const downstream = recordValue(delta?.downstream_recheck);
      const acceptanceGateInvalidated = invalidates?.acceptance_gates === true;
      const requiredRechecks = Array.isArray(downstream?.required)
        ? downstream.required.length : 0;
      const userDeltaPresent = input.tool === "status" && !failed &&
        typeof args?.current_user_delta === "string" &&
        args.current_user_delta.trim().length > 0;
      const capability = input.tool === "invoke_capability"
        ? safeCapability(args?.capability) : input.tool;
      const verificationClass = input.nativeIdentityVerified === true
        ? input.nativeVerificationClass : delta?.verification_class;
      const verificationRequired = verificationClass === "visual" ||
        verificationClass === "focused_read";
      const code = failed ? safeError(structured?.code) : null;
      const build = input.tool === "invoke_capability"
        ? (input.nativeIdentityVerified === true
          ? input.nativeRuntimeBuildIdentity : null)
        : statusBound ? recordValue(runtime?.identity)?.build_identity : null;
      const buildKey = typeof build === "string" && build.length > 0 &&
        build.length <= 256
        ? createHash("sha256").update(
          "lazydesigner-observed-runtime-build:" + build).digest("hex")
        : null;

      let summary: ProjectObservationSummary | null = null;
      if (verifiedUuid !== null) {
        const key = projectKey(verifiedUuid);
        summary = this.projects.get(key) ?? null;
        if (!summary && this.projects.size < MAX_PROJECTS) {
          summary = {
            project_key: key,
            identity_scope: "VERIFIED_NATIVE_UUID_ONLY",
            first_seen_ms: now,
            last_seen_ms: now,
            counters: counts(),
            by_domain: Object.create(null) as Partial<Record<ObservedDomain, DomainCounts>>,
            observed_phase: null,
            phase_observations: [],
            observed_distinct_task_contexts: 0,
            task_contexts_capped: false,
            runtime_build_keys: [],
            runtime_build_keys_capped: false,
            matched_checkpoint_sha256_refs: [],
            checkpoint_refs_capped: false,
            observed_runtime_build_calls:
              Object.create(null) as Record<string, BuildCallCounts>,
            runtime_build_unattributed_calls: 0,
            runtime_build_call_counts_capped: false,
            observed_task_context_hashes: [],
            task_context_hashes_capped: false,
          };
          this.projects.set(key, summary);
        } else if (!summary) {
          this.droppedProjects++;
        }
      }
      const bucket = summary?.counters ?? this.unbound;
      bucket.calls++;
      if (failed) bucket.failures++;
      bucket.duration_sum_ms += duration;
      bucket.max_duration_ms = Math.max(bucket.max_duration_ms, duration);
      bucket.by_tool[input.tool]++;
      if (input.tool === "invoke_capability") {
        recordBucket(bucket.capabilities, capability, MAX_CAPABILITIES);
      }
      if (code !== null) recordBucket(bucket.error_codes, code, MAX_ERROR_CODES);
      if (verificationRequired) bucket.verification_required++;
      if (acceptanceGateInvalidated) bucket.acceptance_gate_invalidations++;
      bucket.downstream_recheck_requests += requiredRechecks;
      if (userDeltaPresent) bucket.user_delta_status_observations++;

      if (summary) {
        // Build evidence must be captured at the operation's actual preflight,
        // not inherited from another request's most recent status.
        if (buildKey !== null) {
          const observed = summary.runtime_build_keys ?? [];
          if (!observed.includes(buildKey)) {
            if (observed.length < MAX_BUILD_CALL_KEYS) observed.push(buildKey);
            else summary.runtime_build_keys_capped = true;
          }
          summary.runtime_build_keys = observed;
          const perBuild = summary.observed_runtime_build_calls ??
            (Object.create(null) as Record<string, BuildCallCounts>);
          const known = Object.hasOwn(perBuild, buildKey);
          const distinct = Object.keys(perBuild).filter(key => key !== "OTHER").length;
          const bucketKey = known || distinct < MAX_BUILD_CALL_KEYS
            ? buildKey : "OTHER";
          if (bucketKey === "OTHER") summary.runtime_build_call_counts_capped = true;
          const metric = perBuild[bucketKey] ?? {
            calls: 0, failures: 0, duration_sum_ms: 0,
          };
          metric.calls++;
          if (failed) metric.failures++;
          metric.duration_sum_ms += duration;
          perBuild[bucketKey] = metric;
          summary.observed_runtime_build_calls = perBuild;
        } else {
          summary.runtime_build_unattributed_calls =
            (summary.runtime_build_unattributed_calls ?? 0) + 1;
        }
        if (statusBound) {
          const controlWorkspace = recordValue(
            recordValue(gatewayStatus?.control)?.workspace);
          const final = recordValue(controlWorkspace?.finalization_native_revision);
          const accepted = final?.accepted_sha256;
          if (final?.state === "MATCHED" &&
              typeof accepted === "string" &&
              /^sha256:[a-f0-9]{64}$/.test(accepted) &&
              accepted === final.observed_sha256) {
            const refs = summary.matched_checkpoint_sha256_refs ?? [];
            if (!refs.includes(accepted)) {
              if (refs.length < 8) refs.push(accepted);
              else summary.checkpoint_refs_capped = true;
            }
            summary.matched_checkpoint_sha256_refs = refs;
          }
        }
        summary.last_seen_ms = Math.max(summary.last_seen_ms, now);
        summary.first_seen_ms = Math.min(summary.first_seen_ms, now);
        if (observedDomain !== null) {
          const item = summary.by_domain[observedDomain] ?? {
            calls: 0, failures: 0, duration_sum_ms: 0,
            verification_required: 0,
          };
          item.calls++;
          if (failed) item.failures++;
          item.duration_sum_ms += duration;
          if (verificationRequired) item.verification_required++;
          summary.by_domain[observedDomain] = item;
        }
        if (observedPhase !== null && summary.observed_phase !== observedPhase) {
          const observation = summary.observed_phase === null
            ? "FIRST_SEEN" : "CHANGED_BETWEEN_OBSERVATIONS";
          summary.observed_phase = observedPhase;
          if (summary.phase_observations.length === MAX_PHASE_OBSERVATIONS) {
            summary.phase_observations.shift();
          }
          summary.phase_observations.push({
            at_ms: now, phase: observedPhase,
            source: phaseSource, observation,
          });
        }
        const contextId = statusBound
          ? recordValue(gatewayStatus?.control)?.task_context_id
          : input.nativeIdentityVerified === true ? args?.task_context_id : null;
        if (typeof contextId === "string" &&
            /^task:[a-f0-9]{20}$/.test(contextId)) {
          let seen = this.contexts.get(summary.project_key);
          if (!seen) {
            seen = new Set<string>();
            this.contexts.set(summary.project_key, seen);
          }
          if (!seen.has(contextId)) {
            if (seen.size < MAX_CONTEXTS) {
              seen.add(contextId);
              summary.observed_distinct_task_contexts = seen.size;
              const digest = createHash("sha256").update(
                "lazydesigner-task-context:" + contextId).digest("hex");
              const keys = summary.observed_task_context_hashes ?? [];
              if (!keys.includes(digest)) {
                if (keys.length < MAX_CONTEXT_HASHES) keys.push(digest);
                else summary.task_context_hashes_capped = true;
              }
              summary.observed_task_context_hashes = keys;
            } else {
              summary.task_contexts_capped = true;
            }
          }
        }
      }

      this.observedCalls++;
      this.firstSeen = this.firstSeen === null ? now : Math.min(this.firstSeen, now);
      this.lastSeen = this.lastSeen === null ? now : Math.max(this.lastSeen, now);
      this.sinceCheckpoint++;
      if (this.sinceCheckpoint >= CHECKPOINT_EVERY ||
          now - this.lastCheckpoint >= CHECKPOINT_INTERVAL_MS) {
        this.scheduleSnapshot(false);
      }
    } catch {
      this.captureFailures++;
      // No diagnostic failure may change the Gateway tool result or Undo.
    }
  }

  snapshot(): ProjectObservationSnapshot {
    return {
      schema: "lazydesigner-project-observation-v1",
      session_id: this.sessionId,
      state: this.closed ? "CLOSED" : "OPEN",
      capture_scope: "RECENT_BOUNDED_GATEWAY_L0",
      recorded_at_ms: Date.now(),
      first_seen_ms: this.firstSeen,
      last_seen_ms: this.lastSeen,
      observed_calls: this.observedCalls,
      unbound: this.unbound,
      projects: [...this.projects.values()],
      dropped_project_observations: this.droppedProjects,
      capture_failures: this.captureFailures,
      persist_failures: this.store?.persistFailures ?? 0,
      retention: {
        max_session_files: MAX_SESSION_FILES,
        max_snapshot_bytes: MAX_SNAPSHOT_BYTES,
        max_projects_per_session: MAX_PROJECTS,
        checkpoint_every_calls: CHECKPOINT_EVERY,
      },
    };
  }

  private scheduleSnapshot(closing: boolean): void {
    if (!this.enabled || !this.store) return;
    if (closing) this.closed = true;
    this.sinceCheckpoint = 0;
    this.lastCheckpoint = Date.now();
    // Serialize a bounded aggregate at a checkpoint, never an MCP response.
    this.store.submit(JSON.stringify(this.snapshot()));
  }

  async flush(close = false): Promise<void> {
    if (this.enabled && (this.observedCalls > 0 ||
        this.captureFailures > 0 ||
        (this.store?.persistFailures ?? 0) > 0)) {
      this.scheduleSnapshot(close);
    }
    await this.store?.flush();
  }

}

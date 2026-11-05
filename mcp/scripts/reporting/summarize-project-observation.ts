import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { renderProjectObservationHtml } from "./render-project-observation";
import {
  validateAcceptedGoldenSessionReport,
  type FinalGoldenSessionReport,
} from "./compare-golden-sessions";
import type {
  ProjectObservationSnapshot,
  ProjectObservationSummary,
  ProjectObservationTool,
  ObservedDomain,
} from "../../gateway/execution/projectObservation";

const OWNED_SESSION_FILE = /^session-[0-9]{13}-[a-f0-9]{16}\.json$/;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_SESSIONS = 16;

function number(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(name + " must be a non-negative safe integer.");
  }
  return value;
}

function counters(value: unknown, name: string): asserts value is ProjectObservationSummary["counters"] {
  if (!value || typeof value !== "object") throw new Error(name + " must be an object.");
  const item = value as ProjectObservationSummary["counters"];
  for (const key of ["calls", "failures", "duration_sum_ms", "max_duration_ms",
    "verification_required", "acceptance_gate_invalidations",
    "downstream_recheck_requests", "user_delta_status_observations"] as const) {
    number(item[key], name + "." + key);
  }
  if (item.failures > item.calls ||
      item.verification_required > item.calls ||
      item.acceptance_gate_invalidations > item.calls ||
      item.user_delta_status_observations > item.calls) {
    throw new Error(name + " contains inconsistent count totals.");
  }
  if (!item.by_tool || typeof item.by_tool !== "object") {
    throw new Error(name + ".by_tool missing.");
  }
  let toolSum = 0;
  for (const tool of [
    "status", "search_capabilities", "describe_capability", "invoke_capability",
  ] as ProjectObservationTool[]) {
    toolSum += number(item.by_tool[tool], name + ".by_tool." + tool);
  }
  if (toolSum !== item.calls) {
    throw new Error(name + " has inconsistent tool count.");
  }
  let capabilityCount = 0;
  let namedFailureCount = 0;
  for (const [category, map] of [
    ["capabilities", item.capabilities], ["error_codes", item.error_codes],
  ] as const) {
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      throw new Error(name + "." + category + " must be an object.");
    }
    if (Object.keys(map).length > (category === "capabilities" ? 25 : 13)) {
      throw new Error(name + "." + category + " exceeds cardinality limit.");
    }
    for (const [key, value] of Object.entries(map)) {
      if (category === "capabilities"
        ? !/^[A-Za-z0-9_.:-]{1,96}$/.test(key)
        : !/^[A-Z][A-Z0-9_]{0,79}$/.test(key)) {
        throw new Error(name + " has invalid category key.");
      }
      const observed = number(value, name + "." + category + "." + key);
      if (category === "capabilities") capabilityCount += observed;
      else namedFailureCount += observed;
    }
  }
  // Each invoke contributes exactly one capability label (including OTHER
  // or UNKNOWN_CAPABILITY); only failed calls contribute named error codes.
  // L0 is bounded observation, not an arbitrary narrative claim. Refuse
  // inflated per-label numbers instead of emitting fictitious hotspots.
  if (capabilityCount !== item.by_tool.invoke_capability) {
    throw new Error(name + " capability counts do not match invoke calls.");
  }
  if (namedFailureCount > item.failures) {
    throw new Error(name + " named error counts exceed observed failures.");
  }
}

function validate(snapshot: unknown): asserts snapshot is ProjectObservationSnapshot {
  if (!snapshot || typeof snapshot !== "object") throw new Error("Invalid snapshot.");
  const data = snapshot as ProjectObservationSnapshot;
  if (data.schema !== "lazydesigner-project-observation-v1" ||
      !/^[0-9a-f]{16}$/.test(data.session_id) ||
      (data.state !== "OPEN" && data.state !== "CLOSED") ||
      data.capture_scope !== "RECENT_BOUNDED_GATEWAY_L0" ||
      !Array.isArray(data.projects) || data.projects.length > 12) {
    throw new Error("Project observation schema/identity is invalid.");
  }
  number(data.observed_calls, "observed_calls");
  number(data.recorded_at_ms, "recorded_at_ms");
  number(data.dropped_project_observations, "dropped_project_observations");
  number(data.capture_failures, "capture_failures");
  number(data.persist_failures, "persist_failures");
  for (const field of ["first_seen_ms", "last_seen_ms"] as const) {
    if (data[field] !== null) number(data[field], field);
  }
  if (!data.retention ||
      data.retention.max_session_files !== 16 ||
      data.retention.max_snapshot_bytes !== MAX_FILE_BYTES ||
      data.retention.max_projects_per_session !== 12 ||
      data.retention.checkpoint_every_calls !== 64) {
    throw new Error("Project observation retention contract is invalid.");
  }
  counters(data.unbound, "unbound");
  let attributed = data.unbound.calls;
  const uniqueProjects = new Set<string>();
  for (const p of data.projects) {
    if (!p || !/^[a-f0-9]{64}$/.test(p.project_key) ||
        p.identity_scope !== "VERIFIED_NATIVE_UUID_ONLY" ||
        uniqueProjects.has(p.project_key)) {
      throw new Error("Invalid, repeated, or unverified native project key.");
    }
    uniqueProjects.add(p.project_key);
    number(p.first_seen_ms, "project.first_seen_ms");
    number(p.last_seen_ms, "project.last_seen_ms");
    if (p.last_seen_ms < p.first_seen_ms) {
      throw new Error("Project observation time order is invalid.");
    }
    counters(p.counters, "project.counters");
    attributed += p.counters.calls;
    if (!p.by_domain || typeof p.by_domain !== "object") {
      throw new Error("Project domain breakdown missing.");
    }
    let domainCalls = 0;
    let domainFailures = 0;
    let domainDuration = 0;
    let domainVerification = 0;
    for (const [name, metrics] of Object.entries(p.by_domain)) {
      if (!["CORE", "GEOMETRY", "TEXTURING", "ANIMATION"].includes(name) ||
          !metrics || typeof metrics !== "object") {
        throw new Error("Invalid domain observation.");
      }
      for (const field of [
        "calls", "failures", "duration_sum_ms", "verification_required",
      ] as const) {
        number(metrics[field], "by_domain." + name + "." + field);
      }
      if (metrics.failures > metrics.calls ||
          metrics.verification_required > metrics.calls) {
        throw new Error("Invalid domain failures or verification counts.");
      }
      domainCalls += metrics.calls;
      domainFailures += metrics.failures;
      domainDuration += metrics.duration_sum_ms;
      domainVerification += metrics.verification_required;
    }
    // Domain classification is optional per call, so sums may be smaller,
    // never larger, than the corresponding project-wide observations.
    if (domainCalls > p.counters.calls ||
        domainFailures > p.counters.failures ||
        domainDuration > p.counters.duration_sum_ms ||
        domainVerification > p.counters.verification_required) {
      throw new Error("Project domain counts exceed observed totals.");
    }
    if (!Array.isArray(p.phase_observations) || p.phase_observations.length > 24 ||
        (p.observed_phase !== null &&
         !["GEOMETRY","TEXTURING","ANIMATION"].includes(p.observed_phase))) {
      throw new Error("Invalid observed phase.");
    }
    for (const item of p.phase_observations) {
      if (!item || !["GEOMETRY","TEXTURING","ANIMATION"].includes(item.phase) ||
          !["VERIFIED_STATUS","VERIFIED_PHASE_RECEIPT"].includes(item.source) ||
          !["FIRST_SEEN","CHANGED_BETWEEN_OBSERVATIONS"].includes(item.observation)) {
        throw new Error("Invalid phase observation.");
      }
      number(item.at_ms, "phase_observation.at_ms");
    }
    if (p.runtime_build_keys !== undefined) {
      if (!Array.isArray(p.runtime_build_keys) ||
          p.runtime_build_keys.length > 8 ||
          new Set(p.runtime_build_keys).size !== p.runtime_build_keys.length ||
          p.runtime_build_keys.some(key => !/^[a-f0-9]{64}$/.test(key)) ||
          typeof p.runtime_build_keys_capped !== "boolean") {
        throw new Error("Invalid observed Runtime build keys.");
      }
    }
    if (p.matched_checkpoint_sha256_refs !== undefined) {
      if (!Array.isArray(p.matched_checkpoint_sha256_refs) ||
          p.matched_checkpoint_sha256_refs.length > 8 ||
          new Set(p.matched_checkpoint_sha256_refs).size !==
            p.matched_checkpoint_sha256_refs.length ||
          p.matched_checkpoint_sha256_refs.some(ref =>
            !/^sha256:[a-f0-9]{64}$/.test(ref)) ||
          typeof p.checkpoint_refs_capped !== "boolean") {
        throw new Error("Invalid finalization checkpoint references.");
      }
    }
    if (p.observed_runtime_build_calls !== undefined) {
      const mapped = p.observed_runtime_build_calls;
      if (!mapped || typeof mapped !== "object" || Array.isArray(mapped) ||
          Object.keys(mapped).length > 9 ||
          typeof p.runtime_build_call_counts_capped !== "boolean") {
        throw new Error("Invalid bounded per-build operation counts.");
      }
      const unknown = number(
        p.runtime_build_unattributed_calls, "runtime_build_unattributed_calls");
      let attributed = 0, attributedDuration = 0;
      for (const [key, bucket] of Object.entries(mapped)) {
        if ((key !== "OTHER" && !/^[0-9a-f]{64}$/.test(key)) ||
            !bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
          throw new Error("Invalid per-build observation key.");
        }
        number(bucket.calls, "build.calls");
        number(bucket.failures, "build.failures");
        number(bucket.duration_sum_ms, "build.duration_sum_ms");
        if (bucket.failures > bucket.calls) {
          throw new Error("Invalid per-build failure counts.");
        }
        attributed += bucket.calls;
        attributedDuration += bucket.duration_sum_ms;
      }
      if (attributed + unknown !== p.counters.calls ||
          attributedDuration > p.counters.duration_sum_ms) {
        throw new Error("Per-build observations do not reconcile to project calls.");
      }
    }
    if (p.observed_task_context_hashes !== undefined) {
      if (!Array.isArray(p.observed_task_context_hashes) ||
          p.observed_task_context_hashes.length > 32 ||
          new Set(p.observed_task_context_hashes).size !== p.observed_task_context_hashes.length ||
          p.observed_task_context_hashes.some(key => !/^[a-f0-9]{64}$/.test(key)) ||
          typeof p.task_context_hashes_capped !== "boolean" ||
          p.observed_task_context_hashes.length > p.observed_distinct_task_contexts) {
        throw new Error("Invalid bounded task context provenance.");
      }
    }
    number(p.observed_distinct_task_contexts, "observed_distinct_task_contexts");
    if (p.observed_distinct_task_contexts > 64 ||
        typeof p.task_contexts_capped !== "boolean") {
      throw new Error("Invalid bounded task-context observation.");
    }
  }
  if (data.observed_calls !== attributed) {
    throw new Error("Project totals must match recorded observations.");
  }
}

type ProjectReport = {
  project_key: string;
  identity_scope: "VERIFIED_NATIVE_UUID_ONLY";
  session_count: number;
  closed_sessions: number;
  open_sessions: number;
  first_observed_ms: number;
  last_observed_ms: number;
  observed_calls: number;
  failures: number;
  observed_call_duration_sum_ms: number;
  verification_obligations_observed: number;
  acceptance_gate_invalidations: number;
  downstream_recheck_requests: number;
  user_delta_status_observations: number;
  by_tool: Record<ProjectObservationTool, number>;
  by_domain: Partial<Record<ObservedDomain, {
    calls: number;
    failures: number;
    duration_sum_ms: number;
    verification_required: number;
  }>>;
  capabilities: Record<string, number>;
  error_codes: Record<string, number>;
  task_context_count_per_session_sum: number;
  phase_changes_observed: number;
  phase_history_truncated: boolean;
  observed_runtime_build_keys?: string[];
  runtime_build_keys_capped?: boolean;
  source_sha?: null;
  runtime_build_provenance?: "OBSERVED_BOUND_STATUS_NOT_GIT_SOURCE_PROOF";
  matched_checkpoint_sha256_refs?: string[];
  checkpoint_refs_capped?: boolean;
  checkpoint_identity_scope?: "MATCHED_NATIVE_FINALIZATION_CONTENT_NOT_PROJECT_ID";
  observed_runtime_build_calls?: Record<string, {
    calls: number; failures: number; duration_sum_ms: number;
  }>;
  runtime_build_unattributed_calls?: number;
  runtime_build_call_counts_capped?: boolean;
  runtime_build_measured_sessions?: number;
  observed_task_context_hashes?: string[];
  task_context_hashes_capped?: boolean;
};

function emptyProject(key: string): ProjectReport {
  return {
    project_key: key,
    identity_scope: "VERIFIED_NATIVE_UUID_ONLY",
    session_count: 0,
    closed_sessions: 0,
    open_sessions: 0,
    first_observed_ms: Number.MAX_SAFE_INTEGER,
    last_observed_ms: 0,
    observed_calls: 0,
    failures: 0,
    observed_call_duration_sum_ms: 0,
    verification_obligations_observed: 0,
    acceptance_gate_invalidations: 0,
    downstream_recheck_requests: 0,
    user_delta_status_observations: 0,
    by_tool: {
      status: 0, search_capabilities: 0,
      describe_capability: 0, invoke_capability: 0,
    },
    by_domain: Object.create(null) as ProjectReport["by_domain"],
    capabilities: Object.create(null) as Record<string, number>,
    error_codes: Object.create(null) as Record<string, number>,
    task_context_count_per_session_sum: 0,
    phase_changes_observed: 0,
    phase_history_truncated: false,
  };
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

/**
 * Aggregates bounded snapshots without attributing unknown calls to a project
 * or claiming full project wall time, visual acceptance or AI token usage.
 */
export function summarizeProjectObservation(snapshots: readonly unknown[]) {
  if (snapshots.length === 0 || snapshots.length > MAX_SESSIONS) {
    throw new Error("Requires 1-16 bounded project observation snapshots.");
  }
  snapshots.forEach(validate);
  const verified = snapshots as ProjectObservationSnapshot[];
  const usedSessionIds = new Set<string>();
  const projects = new Map<string, ProjectReport>();
  let unboundCalls = 0, droppedProjects = 0, persistFailures = 0;
  let captureFailures = 0;
  let openSessions = 0, totalCalls = 0;
  for (const session of verified) {
    if (usedSessionIds.has(session.session_id)) {
      throw new Error("Duplicate session snapshot: refusing double-count.");
    }
    usedSessionIds.add(session.session_id);
    totalCalls += session.observed_calls;
    unboundCalls += session.unbound.calls;
    droppedProjects += session.dropped_project_observations;
    captureFailures += session.capture_failures;
    persistFailures += session.persist_failures;
    if (session.state === "OPEN") openSessions++;
    for (const p of session.projects) {
      const target = projects.get(p.project_key) ?? emptyProject(p.project_key);
      target.session_count++;
      if (session.state === "CLOSED") target.closed_sessions++;
      else target.open_sessions++;
      target.first_observed_ms = Math.min(target.first_observed_ms, p.first_seen_ms);
      target.last_observed_ms = Math.max(target.last_observed_ms, p.last_seen_ms);
      target.observed_calls += p.counters.calls;
      target.failures += p.counters.failures;
      target.observed_call_duration_sum_ms += p.counters.duration_sum_ms;
      target.verification_obligations_observed += p.counters.verification_required;
      target.acceptance_gate_invalidations += p.counters.acceptance_gate_invalidations;
      target.downstream_recheck_requests += p.counters.downstream_recheck_requests;
      target.user_delta_status_observations += p.counters.user_delta_status_observations;
      target.task_context_count_per_session_sum += p.observed_distinct_task_contexts;
      target.phase_changes_observed += p.phase_observations.filter(
        event => event.observation === "CHANGED_BETWEEN_OBSERVATIONS").length;
      if (p.phase_observations.length === 24) target.phase_history_truncated = true;
      // Historical v1 archives must retain byte-identical summary serialization.
      // New source fields are inserted only when they existed in the snapshot.
      if (p.runtime_build_keys !== undefined) {
        target.observed_runtime_build_keys ??= [];
        target.runtime_build_keys_capped ??= false;
        target.source_sha = null;
        target.runtime_build_provenance =
          "OBSERVED_BOUND_STATUS_NOT_GIT_SOURCE_PROOF";
        for (const build of p.runtime_build_keys) {
          if (!target.observed_runtime_build_keys.includes(build)) {
            if (target.observed_runtime_build_keys.length < 16) {
              target.observed_runtime_build_keys.push(build);
            } else {
              target.runtime_build_keys_capped = true;
            }
          }
        }
        if (p.runtime_build_keys_capped) target.runtime_build_keys_capped = true;
      }
      if (p.matched_checkpoint_sha256_refs !== undefined) {
        target.matched_checkpoint_sha256_refs ??= [];
        target.checkpoint_refs_capped ??= false;
        target.checkpoint_identity_scope =
          "MATCHED_NATIVE_FINALIZATION_CONTENT_NOT_PROJECT_ID";
        for (const checkpoint of p.matched_checkpoint_sha256_refs) {
          if (!target.matched_checkpoint_sha256_refs.includes(checkpoint)) {
            if (target.matched_checkpoint_sha256_refs.length < 16) {
              target.matched_checkpoint_sha256_refs.push(checkpoint);
            } else {
              target.checkpoint_refs_capped = true;
            }
          }
        }
        if (p.checkpoint_refs_capped) target.checkpoint_refs_capped = true;
      }
      // Only count sessions that actually provide per-call build attribution.
      // Older snapshots are retained without retroactively assigning their calls.
      if (p.observed_runtime_build_calls !== undefined) {
        target.observed_runtime_build_calls ??=
          Object.create(null) as NonNullable<ProjectReport["observed_runtime_build_calls"]>;
        target.runtime_build_unattributed_calls ??= 0;
        target.runtime_build_call_counts_capped ??= false;
        target.runtime_build_measured_sessions ??= 0;
        target.runtime_build_measured_sessions++;
        target.runtime_build_unattributed_calls +=
          p.runtime_build_unattributed_calls ?? 0;
        const byBuild = target.observed_runtime_build_calls;
        for (const [key, bucket] of Object.entries(p.observed_runtime_build_calls)) {
          const existing = Object.hasOwn(byBuild, key);
          const count = Object.keys(byBuild).filter(item => item !== "OTHER").length;
          const targetKey = key === "OTHER" || existing || count >= 16
            ? (key === "OTHER" || !existing ? "OTHER" : key) : key;
          if (targetKey === "OTHER" && key !== "OTHER") {
            target.runtime_build_call_counts_capped = true;
          }
          const row = byBuild[targetKey] ?? {
            calls: 0, failures: 0, duration_sum_ms: 0,
          };
          row.calls += bucket.calls;
          row.failures += bucket.failures;
          row.duration_sum_ms += bucket.duration_sum_ms;
          byBuild[targetKey] = row;
        }
        if (p.runtime_build_call_counts_capped) {
          target.runtime_build_call_counts_capped = true;
        }
      }
      if (p.observed_task_context_hashes !== undefined) {
        target.observed_task_context_hashes ??= [];
        target.task_context_hashes_capped ??= false;
        for (const value of p.observed_task_context_hashes) {
          if (!target.observed_task_context_hashes.includes(value)) {
            if (target.observed_task_context_hashes.length < 64) {
              target.observed_task_context_hashes.push(value);
            } else target.task_context_hashes_capped = true;
          }
        }
        if (p.task_context_hashes_capped) target.task_context_hashes_capped = true;
      }
      for (const [tool, count] of Object.entries(p.counters.by_tool)) {
        target.by_tool[tool as ProjectObservationTool] += count;
      }
      for (const [name, count] of Object.entries(p.by_domain)) {
        const domain = name as ObservedDomain;
        const row = target.by_domain[domain] ?? {
          calls: 0, failures: 0, duration_sum_ms: 0, verification_required: 0,
        };
        row.calls += count.calls;
        row.failures += count.failures;
        row.duration_sum_ms += count.duration_sum_ms;
        row.verification_required += count.verification_required;
        target.by_domain[domain] = row;
      }
      mergeCounts(target.capabilities, p.counters.capabilities);
      mergeCounts(target.error_codes, p.counters.error_codes);
      projects.set(p.project_key, target);
    }
  }
  return {
    schema: 1,
    report: "project-observation-summary",
    source: "GATEWAY_L0_BOUNDED_SNAPSHOT",
    coverage: {
      retained_session_snapshots: verified.length,
      open_or_unclean_sessions: openSessions,
      unbound_gateway_calls: unboundCalls,
      overflow_project_observations: droppedProjects,
      capture_failures: captureFailures,
      persist_failures: persistFailures,
      retrospective_scope: "RECENT_FILES_ONLY_NOT_FULL_PROJECT_HISTORY",
      project_completion: "UNVERIFIED",
      accepted_quality: "UNVERIFIED",
      project_wall_time_ms: null,
      provider_tokens: null,
      no_additional_ai_or_mcp_calls_required: true,
    },
    observed_calls: totalCalls,
    projects: [...projects.values()].sort((a, b) =>
      b.observed_calls - a.observed_calls || a.project_key.localeCompare(b.project_key)),
  };
}

/**
 * Correlate an independently accepted LIVE Golden receipt to one L0 session.
 * Four identities must co-occur inside the *same* bounded project snapshot;
 * unioning project identities across sessions would create false acceptance.
 * Even a match is NOT evidence that all L0 calls belong to that Golden task.
 */
export function linkAcceptedGoldenSession(
  snapshots: readonly unknown[],
  golden: FinalGoldenSessionReport
) {
  summarizeProjectObservation(snapshots); // Reuse existing schema and dedup gate.
  validateAcceptedGoldenSessionReport(golden);
  const digest = (domain: string, value: string) => createHash("sha256")
    .update(domain + value).digest("hex");
  const project = digest("lazydesigner-native-project:",
    golden.pipeline_provenance.input_project_uuid!);
  const build = digest("lazydesigner-observed-runtime-build:",
    golden.pipeline_provenance.runtime_build_identity!);
  const task = digest("lazydesigner-task-context:",
    golden.pipeline_provenance.control_task_context_id!);
  const checkpoint = golden.pipeline_provenance.artifact_revision!;
  const sessionMatches: string[] = [];
  for (const session of snapshots as ProjectObservationSnapshot[]) {
    for (const item of session.projects) {
      if (item.project_key === project &&
          item.runtime_build_keys?.includes(build) &&
          item.observed_task_context_hashes?.includes(task) &&
          item.matched_checkpoint_sha256_refs?.includes(checkpoint)) {
        sessionMatches.push(session.session_id);
      }
    }
  }
  const state = sessionMatches.length === 1
    ? "ACCEPTED_ARTIFACT_CORRELATED" as const
    : sessionMatches.length > 1
      ? "AMBIGUOUS_MULTIPLE_MATCHED_SESSIONS" as const
      : "NO_SAME_SESSION_EVIDENCE" as const;
  return {
    schema: 1,
    report: "project-accepted-evidence-link",
    state,
    golden: {
      task_id: golden.task_id,
      source_sha: golden.source_sha,
      proof_scope: golden.proof_scope,
      quality_verdict: golden.quality_verdict,
      accepted_result: true as const,
      artifact_revision: checkpoint,
      golden_metrics: golden.metrics,
    },
    l0: {
      project_key: project,
      matching_session_ids: sessionMatches,
      project_identity: "GOLDEN_INPUT_NATIVE_UUID_HASH_MATCH_ONLY",
      build_identity: "OBSERVED_SAME_SESSION_RUNTIME_BUILD_HASH",
      context_identity: "OBSERVED_SAME_SESSION_CONTROL_CONTEXT_HASH",
      checkpoint_identity: "MATCHED_SAVED_CONTENT_DIGEST",
      operation_scope: "L0_PROJECT_TOTALS_NOT_GOLDEN_TASK_CALL_COUNTS",
      source_sha: null,
    },
    interpretation: state === "ACCEPTED_ARTIFACT_CORRELATED"
      ? "Independent Golden PASS and same-session L0 project/build/context/checkpoint evidence agree. L0 call counts and durations are NOT attributed to this Golden task."
      : "Do not join Golden quality or time/token metrics to L0 project calls. The supplied session evidence is missing or ambiguous.",
  };
}

/** Read-only access to the canonical bounded L0 cache window.
 * Retain exact bytes so explicit research archives can fingerprint the source
 * without round-tripping JSON or copying native/private model files.
 */
export async function readProjectObservationSnapshotFiles(directory: string) {
  const names = (await readdir(directory))
    .filter(name => OWNED_SESSION_FILE.test(name)).sort();
  const selected = names.slice(-MAX_SESSIONS);
  const files: Array<{ name: string; bytes: Buffer; snapshot: unknown }> = [];
  for (const name of selected) {
    const file = join(directory, name);
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) {
      throw new Error("Refusing untrusted, oversized or non-file observation snapshot.");
    }
    const bytes = await readFile(file);
    if (bytes.length > MAX_FILE_BYTES) {
      throw new Error("Observation snapshot grew beyond the byte ceiling while reading.");
    }
    files.push({ name, bytes, snapshot: JSON.parse(bytes.toString("utf8")) as unknown });
  }
  return {
    total_matching_files: names.length,
    omitted_files: names.length - selected.length,
    files,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = args[1] ?? null;
  const html = option === "--html";
  const acceptedPath = typeof option === "string" &&
    option.startsWith("--golden-final=")
    ? option.slice("--golden-final=".length) : null;
  if (!args[0] || args.length > 2 ||
      (option !== null && !html && !acceptedPath)) {
    throw new Error("Usage: bun run report:project-analytics -- <local-analytics-directory> [--html|--golden-final=<accepted-final.json>]");
  }
  const capture = await readProjectObservationSnapshotFiles(args[0]);
  const snapshots = capture.files.map(file => file.snapshot);
  const report = summarizeProjectObservation(snapshots);
  if (acceptedPath !== null) {
    const golden = await Bun.file(acceptedPath).json() as FinalGoldenSessionReport;
    console.log(JSON.stringify({
      ...report,
      accepted_evidence: linkAcceptedGoldenSession(snapshots, golden),
    }, null, 2));
    return;
  }
  console.log(html ? renderProjectObservationHtml(report) : JSON.stringify(report, null, 2));
}
if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

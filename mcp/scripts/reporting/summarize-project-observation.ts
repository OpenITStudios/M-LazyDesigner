import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { renderProjectObservationHtml } from "./render-project-observation";
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
      number(value, name + "." + category + "." + key);
    }
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
      if (metrics.failures > metrics.calls) throw new Error("Invalid domain failures.");
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const html = args.length === 2 && args[1] === "--html";
  if (args.length !== 1 && !html) {
    throw new Error("Usage: bun run report:project-analytics -- <local-analytics-directory> [--html]");
  }
  const directory = args[0]!;
  const names = (await readdir(directory))
    .filter(name => OWNED_SESSION_FILE.test(name)).sort().slice(-MAX_SESSIONS);
  const snapshots: unknown[] = [];
  for (const name of names) {
    const file = join(directory, name);
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) {
      throw new Error("Refusing untrusted, oversized or non-file observation snapshot.");
    }
    snapshots.push(JSON.parse(await readFile(file, "utf8")) as unknown);
  }
  const report = summarizeProjectObservation(snapshots);
  console.log(html ? renderProjectObservationHtml(report) : JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

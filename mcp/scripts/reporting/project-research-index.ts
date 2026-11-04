import {
  listResearchManifests,
  type ProjectResearchArchiveManifest,
} from "./project-research-archive";

export type ResearchIndexQuery = {
  project_key?: string;
  /** Observed Runtime build fingerprint, not a Git source SHA. */
  runtime_build_key?: string;
  label?: string;
  since?: string;
};

const HEX_SHA = /^[a-f0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireQuery(query: ResearchIndexQuery): number | null {
  if (query.runtime_build_key !== undefined && !HEX_SHA.test(query.runtime_build_key)) {
    throw new Error("Research build filter requires a lowercase SHA-256 observation key.");
  }
  if (query.project_key !== undefined && !HEX_SHA.test(query.project_key)) {
    throw new Error("Research project filter requires a lowercase 64-character SHA-256 key.");
  }
  if (query.label !== undefined &&
      (query.label.length < 1 || query.label.length > 80 ||
       /[\x00-\x1f\x7f]/.test(query.label))) {
    throw new Error("Research label filter must be bounded and contain no control characters.");
  }
  if (query.since !== undefined) {
    if (!ISO_DATE.test(query.since)) throw new Error("Research since filter must use YYYY-MM-DD.");
    const millis = Date.parse(query.since + "T00:00:00.000Z");
    if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== query.since) {
      throw new Error("Research since filter must be a real UTC calendar date.");
    }
    return millis;
  }
  return null;
}

/**
 * Ephemeral index of explicitly selected archives. Never combine rows from
 * overlapping captures into a purported lifetime project total.
 */
export function indexProjectResearch(
  manifests: readonly ProjectResearchArchiveManifest[],
  query: ResearchIndexQuery = {}
) {
  const after = requireQuery(query);
  const matched = manifests.filter(manifest => {
    if (query.label &&
        !manifest.label.toLocaleLowerCase("en-US").includes(
          query.label.toLocaleLowerCase("en-US"))) return false;
    if (after !== null && Date.parse(manifest.created_at) < after) return false;
    if (query.project_key &&
        !manifest.summary.projects.some(project =>
          project.project_key === query.project_key)) return false;
    if (query.runtime_build_key &&
        !manifest.summary.projects.some(project =>
          (project.observed_runtime_build_keys ?? []).includes(query.runtime_build_key!)))
      return false;
    return true;
  });
  const archives = new Set<string>();
  const sessionOwners = new Map<string, Set<string>>();
  const rows: Array<{
    archive_id: string;
    label: string;
    archived_at: string;
    project_key: string | null;
    observed_calls: number;
    failed_calls: number | null;
    recorded_sessions: number;
    open_or_unclean_sessions: number;
    acceptance_gate_invalidations: number;
    recheck_requests: number;
    unbound_gateway_calls_in_archive: number;
    capture_failures_in_archive: number;
    persist_failures_in_archive: number;
    build_source_sha: null;
    observed_runtime_build_keys: string[];
    matched_checkpoint_content_refs: string[];
    accepted_quality: "UNVERIFIED";
    content_integrity: "NOT_RECHECKED";
  }> = [];
  for (const manifest of matched) {
    if (archives.has(manifest.archive_id)) {
      throw new Error("Duplicate research archive identity: refusing index ambiguity.");
    }
    archives.add(manifest.archive_id);
    for (const snapshot of manifest.snapshots) {
      const owners = sessionOwners.get(snapshot.session_id) ?? new Set<string>();
      owners.add(manifest.archive_id);
      sessionOwners.set(snapshot.session_id, owners);
    }
    const selected = manifest.summary.projects.filter(project =>
      (query.project_key === undefined || project.project_key === query.project_key) &&
      (query.runtime_build_key === undefined ||
       (project.observed_runtime_build_keys ?? []).includes(query.runtime_build_key))
    );
    for (const project of selected) {
      rows.push({
        archive_id: manifest.archive_id,
        label: manifest.label,
        archived_at: manifest.created_at,
        project_key: project.project_key,
        observed_calls: project.observed_calls,
        failed_calls: project.failures,
        recorded_sessions: project.session_count,
        open_or_unclean_sessions: project.open_sessions,
        acceptance_gate_invalidations: project.acceptance_gate_invalidations,
        recheck_requests: project.downstream_recheck_requests,
        unbound_gateway_calls_in_archive: manifest.summary.coverage.unbound_gateway_calls,
        capture_failures_in_archive: manifest.summary.coverage.capture_failures,
        persist_failures_in_archive: manifest.summary.coverage.persist_failures,
        build_source_sha: null,
        observed_runtime_build_keys: project.observed_runtime_build_keys ?? [],
        matched_checkpoint_content_refs: project.matched_checkpoint_sha256_refs ?? [],
        accepted_quality: "UNVERIFIED",
        content_integrity: "NOT_RECHECKED",
      });
    }
    // Unknown project binding is still research-relevant; retain it explicitly.
    if (!query.project_key && !query.runtime_build_key &&
        manifest.summary.projects.length === 0) {
      rows.push({
        archive_id: manifest.archive_id,
        label: manifest.label,
        archived_at: manifest.created_at,
        project_key: null,
        observed_calls: manifest.summary.coverage.unbound_gateway_calls,
        failed_calls: null, // Derived L0 report does not expose unbound failures.
        recorded_sessions: manifest.snapshots.length,
        open_or_unclean_sessions: manifest.summary.coverage.open_or_unclean_sessions,
        acceptance_gate_invalidations: 0,
        recheck_requests: 0,
        unbound_gateway_calls_in_archive: manifest.summary.coverage.unbound_gateway_calls,
        capture_failures_in_archive: manifest.summary.coverage.capture_failures,
        persist_failures_in_archive: manifest.summary.coverage.persist_failures,
        build_source_sha: null,
        observed_runtime_build_keys: [],
        matched_checkpoint_content_refs: [],
        accepted_quality: "UNVERIFIED",
        content_integrity: "NOT_RECHECKED",
      });
    }
  }
  const overlappingSessions = [...sessionOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([session_id, owners]) => ({
      session_id, archive_ids: [...owners].sort(),
    })).sort((a, b) => a.session_id.localeCompare(b.session_id));
  rows.sort((a, b) =>
    b.archived_at.localeCompare(a.archived_at) ||
    a.archive_id.localeCompare(b.archive_id) ||
    (a.project_key ?? "").localeCompare(b.project_key ?? ""));
  return {
    schema: 1,
    report: "project-research-index",
    scope: "EXPLICIT_ARCHIVE_MANIFESTS_ONLY",
    integrity_scope: "METADATA_CHECKS_ONLY_USE_RESEARCH_VERIFY_FOR_FILE_HASHES",
    join_policy: "NO_CROSS_ARCHIVE_SUMS_OR_AUTO_NATIVE_IDENTITY_MERGE",
    build_filter_scope: "OBSERVED_PROJECT_BUILD_MEMBERSHIP_ONLY_NOT_PER_BUILD_CALLS",
    filters: { ...query },
    archive_count: matched.length,
    rows,
    duplicate_session_warnings: overlappingSessions,
    unverified: {
      project_source_commit: true,
      project_workspace_binding: true,
      accepted_quality: true,
      provider_usage: true,
      full_project_lifetime: true,
    },
    note: "Each row is a project within one archive; archive-wide coverage fields may repeat. Never sum rows across overlapping archive captures.",
  };
}

type ResearchIndexReport = ReturnType<typeof indexProjectResearch>;

const COLUMN_NAMES = [
  "archive_id", "label", "archived_at", "project_key",
  "observed_calls", "failed_calls", "recorded_sessions", "open_or_unclean_sessions",
  "acceptance_gate_invalidations", "recheck_requests",
  "unbound_gateway_calls_in_archive", "capture_failures_in_archive",
  "persist_failures_in_archive", "build_source_sha",
  "observed_runtime_build_keys", "matched_checkpoint_content_refs",
  "accepted_quality", "content_integrity",
] as const;

function csvCell(value: string | number | null): string {
  let contents = String(value ?? "");
  // RFC4180 quoting is not sufficient for spreadsheet formula injection.
  if (/^\s*[=+\-@\t\r]/.test(contents)) contents = "'" + contents;
  return '"' + contents.replace(/"/g, '""') + '"';
}

export function renderProjectResearchCsv(report: ResearchIndexReport): string {
  const header = COLUMN_NAMES.map(csvCell).join(",");
  const rows = report.rows.map(row =>
    COLUMN_NAMES.map(column => {
      const cell = row[column];
      return csvCell(Array.isArray(cell) ? cell.join(";") : cell);
    }).join(","));
  // CSV is a flat per-archive view, not a claim of verified project lifetime.
  return [header, ...rows].join("\r\n") + "\r\n";
}

async function main(): Promise<void> {
  const [root, ...args] = process.argv.slice(2);
  if (!root) throw new Error(
    "Usage: bun run research:index -- <archive-root> [--format=csv|json] [--project-key=<sha256>] [--runtime-build-key=<sha256>] [--label=<text>] [--since=YYYY-MM-DD]"
  );
  const options: ResearchIndexQuery = {};
  let format: "csv" | "json" = "json";
  const seen = new Set<string>();
  for (const argument of args) {
    const splitAt = argument.indexOf("=");
    if (!argument.startsWith("--") || splitAt < 0) {
      throw new Error("Invalid Research Index option.");
    }
    const name = argument.slice(2, splitAt);
    const val = argument.slice(splitAt + 1);
    if (seen.has(name)) throw new Error("Duplicate Research Index option: " + name);
    seen.add(name);
    if (name === "format") {
      if (val !== "json" && val !== "csv") throw new Error("Unsupported Research Index format.");
      format = val;
    } else if (name === "project-key") options.project_key = val;
    else if (name === "runtime-build-key") options.runtime_build_key = val;
    else if (name === "label") options.label = val;
    else if (name === "since") options.since = val;
    else throw new Error("Unsupported Research Index option: " + name);
  }
  const report = indexProjectResearch(await listResearchManifests(root), options);
  console.log(format === "csv"
    ? renderProjectResearchCsv(report).trimEnd()
    : JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

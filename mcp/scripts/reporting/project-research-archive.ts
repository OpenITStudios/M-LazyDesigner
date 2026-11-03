import { createHash, randomBytes } from "node:crypto";
import {
  lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  readProjectObservationSnapshotFiles,
  summarizeProjectObservation,
} from "./summarize-project-observation";
import type { ProjectObservationSnapshot } from "../../gateway/execution/projectObservation";

const SNAPSHOT_NAME = /^session-[0-9]{13}-[a-f0-9]{16}\.json$/;
const ARCHIVE_ID = /^research-[0-9]{13}-[a-f0-9]{16}$/;
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,79}$/;
const HEX_SHA = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ARCHIVE_SNAPSHOTS = 16;
const MAX_ARCHIVES_TO_INDEX = 256;

type ResearchSummary = ReturnType<typeof summarizeProjectObservation>;
type ArchiveSnapshotRef = {
  name: string;
  session_id: string;
  state: "OPEN" | "CLOSED";
  bytes: number;
  sha256: string;
};

export type ProjectResearchArchiveManifest = {
  schema: "lazydesigner-project-research-archive-v1";
  archive_id: string;
  label: string;
  created_at: string;
  capture: "EXPLICIT_OFFLINE_L0_SNAPSHOT_ARCHIVE";
  provenance: {
    source_sha: null;
    runtime_build_identity: null;
    workspace_project_binding: "NOT_ESTABLISHED";
    source_revision: "NOT_CAPTURED_BY_L0";
    quality_acceptance: "UNVERIFIED";
    provider_usage: "NOT_CAPTURED";
    hash_authenticity: "LOCAL_CHECKSUM_NOT_SIGNATURE";
  };
  snapshots: ArchiveSnapshotRef[];
  summary_sha256: string;
  summary: ResearchSummary;
};

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value: unknown, max: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 0 && value <= max;
}

function within(candidate: string, root: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path));
}

async function assertPlainDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory()) {
    throw new Error("Research archive location must be a real directory, not a symlink or file.");
  }
}

function archiveManifest(value: unknown): ProjectResearchArchiveManifest {
  if (!isRecord(value) ||
      value.schema !== "lazydesigner-project-research-archive-v1" ||
      typeof value.archive_id !== "string" || !ARCHIVE_ID.test(value.archive_id) ||
      typeof value.label !== "string" || !LABEL.test(value.label) ||
      typeof value.created_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.created_at) ||
      !Number.isFinite(Date.parse(value.created_at)) ||
      value.capture !== "EXPLICIT_OFFLINE_L0_SNAPSHOT_ARCHIVE" ||
      !Array.isArray(value.snapshots) ||
      value.snapshots.length < 1 || value.snapshots.length > MAX_ARCHIVE_SNAPSHOTS ||
      !isRecord(value.provenance)) {
    throw new Error("Invalid research archive manifest envelope.");
  }
  const provenance = value.provenance;
  if (provenance.source_sha !== null ||
      provenance.runtime_build_identity !== null ||
      provenance.workspace_project_binding !== "NOT_ESTABLISHED" ||
      provenance.source_revision !== "NOT_CAPTURED_BY_L0" ||
      provenance.quality_acceptance !== "UNVERIFIED" ||
      provenance.provider_usage !== "NOT_CAPTURED" ||
      provenance.hash_authenticity !== "LOCAL_CHECKSUM_NOT_SIGNATURE") {
    throw new Error("Research archive cannot upgrade L0 evidence or invent source provenance.");
  }
  const names = new Set<string>();
  const sessions = new Set<string>();
  for (const item of value.snapshots) {
    if (!isRecord(item) || typeof item.name !== "string" ||
        !SNAPSHOT_NAME.test(item.name) ||
        typeof item.session_id !== "string" ||
        !/^[a-f0-9]{16}$/.test(item.session_id) ||
        (item.state !== "OPEN" && item.state !== "CLOSED") ||
        !safeInteger(item.bytes, MAX_SOURCE_BYTES) || item.bytes === 0 ||
        typeof item.sha256 !== "string" || !HEX_SHA.test(item.sha256) ||
        names.has(item.name) || sessions.has(item.session_id)) {
      throw new Error("Invalid, duplicated or unsafe research snapshot reference.");
    }
    names.add(item.name);
    sessions.add(item.session_id);
  }
  if (typeof value.summary_sha256 !== "string" ||
      !HEX_SHA.test(value.summary_sha256) || !isRecord(value.summary) ||
      value.summary.report !== "project-observation-summary" ||
      value.summary.schema !== 1 ||
      !safeInteger(value.summary.observed_calls, Number.MAX_SAFE_INTEGER) ||
      !Array.isArray(value.summary.projects) ||
      !isRecord(value.summary.coverage) ||
      value.summary.coverage.retained_session_snapshots !== value.snapshots.length ||
      value.summary.coverage.accepted_quality !== "UNVERIFIED" ||
      value.summary.coverage.project_completion !== "UNVERIFIED" ||
      value.summary.coverage.provider_tokens !== null ||
      value.summary.coverage.project_wall_time_ms !== null ||
      value.summary_sha256 !== sha256(JSON.stringify(value.summary))) {
    throw new Error("Research summary has invalid shape, coverage or checksum.");
  }
  for (const project of value.summary.projects) {
    if (!isRecord(project) || typeof project.project_key !== "string" ||
        !HEX_SHA.test(project.project_key) ||
        !safeInteger(project.observed_calls, Number.MAX_SAFE_INTEGER) ||
        !safeInteger(project.failures, Number.MAX_SAFE_INTEGER) ||
        project.failures > project.observed_calls ||
        !safeInteger(project.session_count, MAX_ARCHIVE_SNAPSHOTS)) {
      throw new Error("Research project index contains an invalid identity or count.");
    }
    if (project.observed_runtime_build_keys !== undefined) {
      if (!Array.isArray(project.observed_runtime_build_keys) ||
          project.observed_runtime_build_keys.length > 16 ||
          new Set(project.observed_runtime_build_keys).size !==
            project.observed_runtime_build_keys.length ||
          project.observed_runtime_build_keys.some(key =>
            typeof key !== "string" || !HEX_SHA.test(key)) ||
          typeof project.runtime_build_keys_capped !== "boolean" ||
          project.source_sha !== null ||
          project.runtime_build_provenance !==
            "OBSERVED_BOUND_STATUS_NOT_GIT_SOURCE_PROOF") {
        throw new Error("Research build observation is invalid or claims false source proof.");
      }
    }
    if (project.matched_checkpoint_sha256_refs !== undefined) {
      if (!Array.isArray(project.matched_checkpoint_sha256_refs) ||
          project.matched_checkpoint_sha256_refs.length > 16 ||
          new Set(project.matched_checkpoint_sha256_refs).size !==
            project.matched_checkpoint_sha256_refs.length ||
          project.matched_checkpoint_sha256_refs.some(ref =>
            typeof ref !== "string" || !/^sha256:[a-f0-9]{64}$/.test(ref)) ||
          typeof project.checkpoint_refs_capped !== "boolean" ||
          project.checkpoint_identity_scope !==
            "MATCHED_NATIVE_FINALIZATION_CONTENT_NOT_PROJECT_ID") {
        throw new Error("Research checkpoint content evidence is invalid.");
      }
    }
  }
  return value as unknown as ProjectResearchArchiveManifest;
}

/** Metadata-only indexing does not authenticate underlying snapshot content. */
export async function readResearchManifest(directory: string): Promise<ProjectResearchArchiveManifest> {
  await assertPlainDirectory(directory);
  const path = join(directory, "manifest.json");
  const info = await lstat(path);
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) {
    throw new Error("Research manifest must be a regular bounded file.");
  }
  const bytes = await readFile(path);
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("Research manifest grew beyond limit.");
  const manifest = archiveManifest(JSON.parse(bytes.toString("utf8")) as unknown);
  if (basename(resolve(directory)) !== manifest.archive_id) {
    throw new Error("Research archive directory and manifest identity disagree.");
  }
  return manifest;
}

/** Explicit archival action, never executed during normal Gateway traffic. */
export async function archiveProjectObservation(
  cacheDirectory: string,
  archiveRoot: string,
  label: string
): Promise<{ archive_id: string; archive_path: string; sessions: number; observed_calls: number }> {
  if (!LABEL.test(label)) {
    throw new Error("Research label must be 1–80 safe characters and start with a letter or number.");
  }
  await assertPlainDirectory(cacheDirectory);
  // Reject nesting before any mkdir can create archive files in the hot L0 cache.
  const proposedArchive = resolve(archiveRoot);
  const proposedCache = resolve(cacheDirectory);
  if (within(proposedArchive, proposedCache) ||
      within(proposedCache, proposedArchive)) {
    throw new Error("Research archive root must be separate from the rolling L0 cache.");
  }
  const capture = await readProjectObservationSnapshotFiles(cacheDirectory);
  if (capture.omitted_files !== 0) {
    throw new Error("Refusing archival capture with more than sixteen source snapshots.");
  }
  const report = summarizeProjectObservation(capture.files.map(file => file.snapshot));
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  await assertPlainDirectory(archiveRoot);
  const [sourceReal, archiveReal] = await Promise.all([
    realpath(cacheDirectory), realpath(archiveRoot),
  ]);
  if (within(sourceReal, archiveReal) || within(archiveReal, sourceReal)) {
    throw new Error("Research archive root must be separate from the rolling L0 cache.");
  }
  const archiveId = "research-" + Date.now() + "-" + randomBytes(8).toString("hex");
  const manifest: ProjectResearchArchiveManifest = {
    schema: "lazydesigner-project-research-archive-v1",
    archive_id: archiveId,
    label,
    created_at: new Date().toISOString(),
    capture: "EXPLICIT_OFFLINE_L0_SNAPSHOT_ARCHIVE",
    provenance: {
      source_sha: null,
      runtime_build_identity: null,
      workspace_project_binding: "NOT_ESTABLISHED",
      source_revision: "NOT_CAPTURED_BY_L0",
      quality_acceptance: "UNVERIFIED",
      provider_usage: "NOT_CAPTURED",
      hash_authenticity: "LOCAL_CHECKSUM_NOT_SIGNATURE",
    },
    snapshots: capture.files.map(file => {
      const snapshot = file.snapshot as { session_id: string; state: "OPEN" | "CLOSED" };
      return {
        name: file.name,
        session_id: snapshot.session_id,
        state: snapshot.state,
        bytes: file.bytes.length,
        sha256: sha256(file.bytes),
      };
    }),
    summary_sha256: sha256(JSON.stringify(report)),
    summary: report,
  };
  archiveManifest(manifest);
  const serialized = JSON.stringify(manifest, null, 2);
  if (Buffer.byteLength(serialized) > MAX_MANIFEST_BYTES) {
    throw new Error("Research manifest exceeds 256 KiB.");
  }
  const stage = await mkdtemp(join(archiveRoot, ".research-pending-"));
  const finalPath = join(archiveRoot, archiveId);
  try {
    await mkdir(join(stage, "snapshots"), { mode: 0o700 });
    await Promise.all(capture.files.map(file =>
      writeFile(join(stage, "snapshots", file.name), file.bytes,
        { flag: "wx", mode: 0o600 })));
    await writeFile(join(stage, "manifest.json"), serialized,
      { flag: "wx", mode: 0o600 });
    // Unique random final name. Never overwrite a research archive.
    try {
      await lstat(finalPath);
      throw new Error("Research archive identity already exists; refusing overwrite.");
    } catch (error) {
      if (!(error instanceof Error && "code" in error &&
            (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
    }
    await rename(stage, finalPath);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return {
    archive_id: archiveId, archive_path: finalPath,
    sessions: manifest.snapshots.length, observed_calls: report.observed_calls,
  };
}

/** Verify one selected archived L0 snapshot for AI drill-down, without scanning
 * unrelated sessions or treating a local SHA-256 as source attestation.
 */
export async function readResearchArchiveSnapshot(
  directory: string, sessionId: string
) {
  if (!/^[a-f0-9]{16}$/.test(sessionId)) {
    throw new Error("Research session ID must be a 16-character lowercase hex value.");
  }
  const manifest = await readResearchManifest(directory);
  const reference = manifest.snapshots.find(row => row.session_id === sessionId);
  if (!reference) throw new Error("Requested research session is not in this archive.");
  const sourceDir = join(directory, "snapshots");
  await assertPlainDirectory(sourceDir);
  const path = join(sourceDir, reference.name);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size !== reference.bytes ||
      metadata.size > MAX_SOURCE_BYTES) {
    throw new Error("Selected research snapshot size or file type changed.");
  }
  const bytes = await readFile(path);
  if (bytes.length !== reference.bytes || sha256(bytes) !== reference.sha256) {
    throw new Error("Selected research snapshot SHA-256 mismatch.");
  }
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(parsed) || parsed.session_id !== reference.session_id ||
      parsed.state !== reference.state) {
    throw new Error("Selected research snapshot session identity changed.");
  }
  // The canonical aggregator enforces the L0 schema and internal counter invariants.
  summarizeProjectObservation([parsed]);
  return {
    reference,
    snapshot: parsed as ProjectObservationSnapshot,
    integrity: "SNAPSHOT_BYTES_MATCH_ARCHIVE_MANIFEST" as const,
    source_authenticity: "NOT_ATTESTED" as const,
  };
}

/** Expensive integrity verification is explicit and offline, not a polling job. */
export async function verifyResearchArchive(directory: string) {
  const manifest = await readResearchManifest(directory);
  const snapshotDir = join(directory, "snapshots");
  await assertPlainDirectory(snapshotDir);
  const actual = (await readdir(snapshotDir)).sort();
  const expected = manifest.snapshots.map(file => file.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Research archive files differ from the manifest inventory.");
  }
  const snapshots: unknown[] = [];
  for (const reference of manifest.snapshots) {
    const path = join(snapshotDir, reference.name);
    const details = await lstat(path);
    if (!details.isFile() || details.size !== reference.bytes ||
        details.size > MAX_SOURCE_BYTES) {
      throw new Error("Research snapshot size or file type changed.");
    }
    const bytes = await readFile(path);
    if (bytes.length !== reference.bytes || sha256(bytes) !== reference.sha256) {
      throw new Error("Research snapshot SHA-256 mismatch.");
    }
    const snapshot = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!isRecord(snapshot) ||
        snapshot.session_id !== reference.session_id ||
        snapshot.state !== reference.state) {
      throw new Error("Research snapshot session metadata mismatch.");
    }
    snapshots.push(snapshot);
  }
  const recomputed = summarizeProjectObservation(snapshots);
  if (sha256(JSON.stringify(recomputed)) !== manifest.summary_sha256 ||
      JSON.stringify(recomputed) !== JSON.stringify(manifest.summary)) {
    throw new Error("Research archive derived summary disagrees with source snapshots.");
  }
  return {
    archive_id: manifest.archive_id,
    verification: "LOCAL_SOURCE_CHECKSUMS_MATCH",
    source_authenticity: "NOT_ATTESTED",
    snapshot_files: manifest.snapshots.length,
    observed_calls: recomputed.observed_calls,
    quality_acceptance: "UNVERIFIED",
  };
}

export async function listResearchManifests(root: string): Promise<ProjectResearchArchiveManifest[]> {
  await assertPlainDirectory(root);
  const names = (await readdir(root)).filter(name => ARCHIVE_ID.test(name)).sort();
  if (names.length > MAX_ARCHIVES_TO_INDEX) {
    throw new Error("Research index exceeds the 256-archive read ceiling; narrow the archive root.");
  }
  // Offline index needs no unbounded parallel file reads or background indexing.
  const result: ProjectResearchArchiveManifest[] = [];
  for (const name of names) result.push(await readResearchManifest(join(root, name)));
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "capture" && args.length === 4) {
    console.log(JSON.stringify(await archiveProjectObservation(args[1]!, args[2]!, args[3]!), null, 2));
    return;
  }
  if (args[0] === "verify" && args.length === 2) {
    console.log(JSON.stringify(await verifyResearchArchive(args[1]!), null, 2));
    return;
  }
  throw new Error("Usage: bun run research:archive -- capture <cache-dir> <archive-root> <label> | verify <archive-dir>");
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

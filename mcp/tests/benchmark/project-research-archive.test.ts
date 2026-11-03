import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectObservationRecorder } from "../../gateway/execution/projectObservation";
import {
  archiveProjectObservation,
  listResearchManifests,
  readResearchManifest,
  verifyResearchArchive,
} from "../../scripts/reporting/project-research-archive";
import {
  indexProjectResearch,
  renderProjectResearchCsv,
} from "../../scripts/reporting/project-research-index";

const tempDirs: string[] = [];

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "lazydesigner-research-"));
  tempDirs.push(root);
  const cache = join(root, "cache");
  const archiveRoot = join(root, "research");
  await mkdir(cache);
  return { root, cache, archiveRoot };
}

function status(uuid: string | null, ready = true) {
  return {
    structuredContent: {
      runtime: {
        mcp_client_ready: ready,
        identity: { build_identity: "test-runtime-build" },
      },
      affinity: { project_uuid: uuid, authoring_phase: "geometry" },
      control: { project: { binding: ready ? "BOUND" : "UNKNOWN" } },
    },
  };
}

async function addSession(cache: string, uuid: string | null, ready = true) {
  const observer = new ProjectObservationRecorder(cache);
  observer.record({
    tool: "status",
    args: { current_user_delta: "sensitive instruction about private assets" },
    result: status(uuid, ready),
    durationMs: 5,
  });
  await observer.flush(true);
  return observer.snapshot();
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(root =>
    rm(root, { recursive: true, force: true })));
});

describe("explicit L0 research archive and ephemeral index", () => {
  test("archives bounded L0 snapshots and verifies stored SHA-256 without user payloads", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "native-secret-project");
    await addSession(cache, "native-secret-project");
    const before = (await readdir(cache)).sort();
    const saved = await archiveProjectObservation(cache, archiveRoot, "Geometry Experiment 01");
    expect(saved.sessions).toBe(2);
    expect(saved.observed_calls).toBe(2);
    expect(saved.archive_id).toMatch(/^research-[0-9]{13}-[a-f0-9]{16}$/);
    const after = (await readdir(cache)).sort();
    expect(after).toEqual(before);

    const manifest = await readResearchManifest(saved.archive_path);
    expect(manifest.label).toBe("Geometry Experiment 01");
    expect(manifest.provenance).toMatchObject({
      source_sha: null,
      runtime_build_identity: null,
      workspace_project_binding: "NOT_ESTABLISHED",
      quality_acceptance: "UNVERIFIED",
      provider_usage: "NOT_CAPTURED",
    });
    expect(manifest.snapshots).toHaveLength(2);
    expect(manifest.summary.projects).toHaveLength(1);
    expect(manifest.summary.projects[0]!.observed_calls).toBe(2);
    expect(manifest.summary.coverage.project_wall_time_ms).toBeNull();
    const verified = await verifyResearchArchive(saved.archive_path);
    expect(verified).toMatchObject({
      verification: "LOCAL_SOURCE_CHECKSUMS_MATCH",
      source_authenticity: "NOT_ATTESTED",
      snapshot_files: 2,
      quality_acceptance: "UNVERIFIED",
    });

    const bytes = (await Promise.all([
      readFile(join(saved.archive_path, "manifest.json"), "utf8"),
      ...manifest.snapshots.map(s =>
        readFile(join(saved.archive_path, "snapshots", s.name), "utf8")),
    ])).join("\n");
    expect(bytes).not.toContain("native-secret-project");
    expect(bytes).not.toContain("sensitive instruction");
    expect(bytes).not.toContain("current_user_delta");
  });

  test("index filters by label and exact project key and exports spreadsheet-safe CSV", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "native-project-a");
    const saved = await archiveProjectObservation(cache, archiveRoot, "Geometry Trial 1");
    const manifests = await listResearchManifests(archiveRoot);
    const key = manifests[0]!.summary.projects[0]!.project_key;
    const report = indexProjectResearch(manifests, {
      label: "GEOMETRY", project_key: key,
    });
    expect(report).toMatchObject({
      report: "project-research-index",
      archive_count: 1,
      integrity_scope: "METADATA_CHECKS_ONLY_USE_RESEARCH_VERIFY_FOR_FILE_HASHES",
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      archive_id: saved.archive_id,
      project_key: key,
      observed_calls: 1,
      recorded_sessions: 1,
      build_source_sha: null,
      accepted_quality: "UNVERIFIED",
      content_integrity: "NOT_RECHECKED",
    });
    expect(indexProjectResearch(manifests, { project_key: "f".repeat(64) }).rows)
      .toHaveLength(0);
    expect(indexProjectResearch(manifests, { since: "2999-01-01" }).rows)
      .toHaveLength(0);
    const csv = renderProjectResearchCsv(report);
    expect(csv).toContain('"archive_id","label","archived_at","project_key"');
    expect(csv).toContain('"Geometry Trial 1"');
    expect(csv).toContain('"' + key + '"');
    expect(csv).toContain("\r\n");
    report.rows[0]!.label = '=HYPERLINK("https://bad.example", "click")';
    expect(renderProjectResearchCsv(report)).toContain(
      "\"'=HYPERLINK(\"\"https://bad.example\"\", \"\"click\"\")\"");
  });

  test("reused session snapshots across separate experiments are warned, not summed", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "same-native");
    const baseline = await archiveProjectObservation(cache, archiveRoot, "Baseline");
    const candidate = await archiveProjectObservation(cache, archiveRoot, "Candidate");
    const summary = indexProjectResearch(await listResearchManifests(archiveRoot));
    expect(summary.archive_count).toBe(2);
    expect(summary.rows).toHaveLength(2);
    expect(summary.rows.every(row => row.observed_calls === 1)).toBe(true);
    expect(summary).not.toHaveProperty("aggregate_project_calls");
    expect(summary.duplicate_session_warnings).toHaveLength(1);
    expect(summary.duplicate_session_warnings[0]!.archive_ids)
      .toEqual([baseline.archive_id, candidate.archive_id].sort());
    expect(summary.join_policy).toContain("NO_CROSS_ARCHIVE_SUMS");
  });

  test("keeps unbound-only research observations visible without inventing failure counts", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "untrusted-uuid", false);
    const saved = await archiveProjectObservation(cache, archiveRoot, "No Binding");
    const manifest = await readResearchManifest(saved.archive_path);
    expect(manifest.summary.projects).toHaveLength(0);
    const rows = indexProjectResearch([manifest]).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      project_key: null, observed_calls: 1,
      failed_calls: null, accepted_quality: "UNVERIFIED",
    });
  });

  test("tampering with a copied snapshot fails explicit integrity verification", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "native");
    const saved = await archiveProjectObservation(cache, archiveRoot, "Tamper Check");
    const manifest = await readResearchManifest(saved.archive_path);
    const first = join(saved.archive_path, "snapshots", manifest.snapshots[0]!.name);
    await writeFile(first, "{\"modified\":\"bytes\"}", "utf8");
    await expect(verifyResearchArchive(saved.archive_path))
      .rejects.toThrow(/size|SHA-256/i);
    // A manifest-only index must not silently claim content revalidation.
    expect(indexProjectResearch(await listResearchManifests(archiveRoot)).rows[0]!
      .content_integrity).toBe("NOT_RECHECKED");
  });

  test("invalid, forged or inconsistent provenance is rejected", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "native");
    const saved = await archiveProjectObservation(cache, archiveRoot, "Provenance Check");
    const path = join(saved.archive_path, "manifest.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    original.provenance.quality_acceptance = "PASS";
    await writeFile(path, JSON.stringify(original), "utf8");
    await expect(readResearchManifest(saved.archive_path))
      .rejects.toThrow("cannot upgrade L0 evidence");
    original.provenance.quality_acceptance = "UNVERIFIED";
    original.summary.observed_calls = 12;
    await writeFile(path, JSON.stringify(original), "utf8");
    await expect(readResearchManifest(saved.archive_path))
      .rejects.toThrow("invalid shape, coverage or checksum");
  });

  test("refuses bad label, archive/cache overlap and non-directory destinations", async () => {
    const { root, cache, archiveRoot } = await workspace();
    await addSession(cache, "native");
    await expect(archiveProjectObservation(cache, join(cache, "nested"), "Safe"))
      .rejects.toThrow("separate from the rolling L0 cache");
    expect((await readdir(cache)).some(name => name === "nested")).toBe(false);
    await expect(archiveProjectObservation(cache, archiveRoot, "=SUM(A1)"))
      .rejects.toThrow("Research label");
    const file = join(root, "not-a-directory");
    await writeFile(file, "unrelated");
    await expect(archiveProjectObservation(cache, file, "Safe"))
      .rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("unrelated");
  });

  test("rejects duplicate archive identity and invalid filters", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "native");
    const archive = await archiveProjectObservation(cache, archiveRoot, "Filter Test");
    const manifest = await readResearchManifest(archive.archive_path);
    expect(() => indexProjectResearch([manifest, manifest])).toThrow("Duplicate");
    expect(() => indexProjectResearch([manifest], { project_key: "invalid" }))
      .toThrow("project filter");
    expect(() => indexProjectResearch([manifest], { since: "2026-02-31" }))
      .toThrow("real UTC calendar date");
    expect(() => indexProjectResearch([manifest], { label: "\n" }))
      .toThrow("label filter");
  });

  test("historical L0 snapshots remain byte-compatible with new optional provenance fields", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "native-legacy-project");
    const files = (await readdir(cache)).filter(file => file.startsWith("session-"));
    expect(files).toHaveLength(1);
    const file = join(cache, files[0]!);
    const legacy = JSON.parse(await readFile(file, "utf8"));
    for (const project of legacy.projects) {
      delete project.runtime_build_keys;
      delete project.runtime_build_keys_capped;
      delete project.matched_checkpoint_sha256_refs;
      delete project.checkpoint_refs_capped;
    }
    await writeFile(file, JSON.stringify(legacy), "utf8");
    const archived = await archiveProjectObservation(cache, archiveRoot, "Legacy Schema 1");
    const manifest = await readResearchManifest(archived.archive_path);
    const project = manifest.summary.projects[0]!;
    expect("observed_runtime_build_keys" in project).toBe(false);
    expect("matched_checkpoint_sha256_refs" in project).toBe(false);
    await expect(verifyResearchArchive(archived.archive_path)).resolves.toMatchObject({
      verification: "LOCAL_SOURCE_CHECKSUMS_MATCH",
    });
  });

  test("rejects unexpected files inside an archive during verification", async () => {
    const { cache, archiveRoot } = await workspace();
    await addSession(cache, "native");
    const archive = await archiveProjectObservation(cache, archiveRoot, "Extra File");
    await writeFile(join(archive.archive_path, "snapshots", "unexpected.json"), "{}");
    await expect(verifyResearchArchive(archive.archive_path))
      .rejects.toThrow("files differ");
  });
});

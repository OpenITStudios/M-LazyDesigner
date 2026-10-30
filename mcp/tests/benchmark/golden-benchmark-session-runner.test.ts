import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import goldenCorpus from "../fixtures/golden-task-cases.json";
import {
  buildGoldenRunDraft,
  fingerprintGoldenInputModel,
  fingerprintGoldenSavedOutputModel,
  verifyGoldenStartingLiveProject,
  goldenSessionPaths,
  assertGoldenDisposablePath,
  assertGoldenOutputLocation,
  validateGoldenSeedContent,
  assertCanonicalGoldenSeed,
  requireGoldenReferenceReady,
} from "../../scripts/reporting/run-golden-benchmark-session";

const task = goldenCorpus.tasks.find(
  (entry) => entry.id === "golden-full-asset-authoring"
)!;

describe("golden benchmark session runner", () => {
  test("creates isolated session artifact paths", () => {
    const paths = goldenSessionPaths(
      task.id,
      ".cache/test-golden",
      new Date("2026-10-30T00:00:00.000Z")
    );
    expect(paths.directory).toContain(
      "golden-full-asset-authoring-2026-10-30T00-00-00-000Z"
    );
    expect(paths.trace.endsWith("trace.ndjson")).toBe(true);
    expect(paths.trace_report.endsWith("trace-report.json")).toBe(true);
    expect(paths.golden_run_draft.endsWith("golden-run-draft.json")).toBe(true);
  });

  test("output location rejects Workspace, immutable fixtures and symlink aliases before mkdir", async () => {
    const active = fileURLToPath(new URL("../../../workspace/active/", import.meta.url));
    const fixture = fileURLToPath(new URL("../fixtures/golden/full-asset/", import.meta.url));
    expect(() => goldenSessionPaths(task.id, active)).toThrow("refuses repository workspace assets");
    expect(() => goldenSessionPaths(task.id, fixture)).toThrow("refuses immutable Golden fixture output paths");
    const dir = await mkdtemp(join(tmpdir(), "golden-output-safety-"));
    const workspace = join(dir, "workspace");
    const alias = join(dir, "workspace-alias");
    try {
      await mkdir(workspace);
      await symlink(workspace, alias, process.platform === "win32" ? "junction" : "dir");
      await expect(assertGoldenOutputLocation(join(alias, "session"), workspace))
        .rejects.toThrow("refuses repository workspace assets");
      await expect(assertGoldenOutputLocation(join(dir, "safe", "session"), workspace))
        .resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("one complete Golden fixture rejects production paths, stale seed bytes and unapproved references", async () => {
    const root = join(tmpdir(), "golden-test-root");
    const workspace = join(root, "workspace");
    for (const branch of ["active", "saved"]) {
      expect(() => assertGoldenDisposablePath(join(workspace, branch, "historical.bbmodel"), workspace))
        .toThrow("refuses repository workspace assets");
    }
    const seed = await Bun.file(task.fixture.seed_path).json();
    expect(() => validateGoldenSeedContent(task, seed)).not.toThrow();
    expect(() => validateGoldenSeedContent(task, { ...seed, elements: [{}] }))
      .toThrow("seed must be blank");
    expect(() => validateGoldenSeedContent(task, { ...seed, textures: [{}] }))
      .toThrow("seed must be blank");
    expect(() => validateGoldenSeedContent(task, { ...seed, meta: { model_format: "free" } }))
      .toThrow("Bedrock .bbmodel metadata");
    const dir = await mkdtemp(join(tmpdir(), "golden-fresh-seed-"));
    const copy = join(dir, "input.bbmodel");
    try {
      await writeFile(copy, await Bun.file(task.fixture.seed_path).text());
      await expect(assertCanonicalGoldenSeed(task, copy)).resolves.toBeUndefined();
      await writeFile(copy, JSON.stringify({ ...seed, name: "other-blank-model" }));
      await expect(assertCanonicalGoldenSeed(task, copy))
        .rejects.toThrow("canonical fresh fixture seed bytes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // A generated concept is not an approved reference. No native attempt.
    await expect(requireGoldenReferenceReady(task))
      .rejects.toThrow("explicit visual approval");
  });

  test("pins the unchanged starting .bbmodel once with SHA-256", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-golden-input-"));
    const seed = join(dir, "input.bbmodel");
    try {
      const bytes = '{"meta":{"format_version":"4.10"}}';
      await writeFile(seed, bytes);
      const sha = await fingerprintGoldenInputModel(seed);
      expect(sha).toBe(createHash("sha256").update(bytes).digest("hex"));
      const draft = buildGoldenRunDraft({
        task, sourceSha: "1".repeat(40), wallTimeMs: 25,
        traceEvents: [], inputAssetSha256: sha,
      });
      expect(draft.runs[0]!.pipeline_provenance.input_asset_sha256).toBe(sha);
      expect(draft.runs[0]!.accepted_result).toBeNull();
      await writeFile(seed, "");
      await expect(fingerprintGoldenInputModel(seed)).rejects.toThrow("must not be empty");
      await expect(fingerprintGoldenInputModel(join(dir, "input.json")))
        .rejects.toThrow("requires an absolute starting input .bbmodel");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("binds a saved live Blockbench project to an identical disposable working copy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-live-correction-"));
    const seed = join(dir, "seed.bbmodel");
    const copy = join(dir, "working.bbmodel");
    const original = '{"meta":{"format_version":"4.10"},"elements":[{"name":"synthetic-part-a"}]}';
    const snapshot = (savePath: string, saved = true, format = "bedrock") => ({
      project: { uuid: "asset-project-1", saved, save_path: savePath },
      format: { id: format },
    });
    try {
      await writeFile(seed, original);
      await writeFile(copy, original);
      const result = await verifyGoldenStartingLiveProject(seed, snapshot(copy));
      expect(result).toEqual({
        inputAssetSha256: createHash("sha256").update(original).digest("hex"),
        projectUuid: "asset-project-1",
      });
      await expect(verifyGoldenStartingLiveProject(seed, snapshot(seed)))
        .rejects.toThrow("separate working copy");
      await expect(verifyGoldenStartingLiveProject(seed, snapshot(copy, false)))
        .rejects.toThrow("saved, active Bedrock");
      await expect(verifyGoldenStartingLiveProject(seed, snapshot(copy, true, "java_block")))
        .rejects.toThrow("saved, active Bedrock");
      await writeFile(copy, original.replace("synthetic-part-a", "synthetic-part-b"));
      await expect(verifyGoldenStartingLiveProject(seed, snapshot(copy)))
        .rejects.toThrow("differs from the starting seed bytes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("captures persisted changes and refuses invalid output or modified seed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-output-proof-"));
    const seed = join(dir, "seed.bbmodel");
    const saved = join(dir, "working.bbmodel");
    const original = '{"meta":{"format_version":"4.10"},"elements":[{"name":"synthetic-part-a"}]}';
    try {
      await writeFile(seed, original);
      await writeFile(saved, original);
      const input = await fingerprintGoldenInputModel(seed);
      expect(await fingerprintGoldenSavedOutputModel(seed, saved, input)).toBe(input);
      await writeFile(saved, original.replace("synthetic-part-a", "synthetic-part-b"));
      const output = await fingerprintGoldenSavedOutputModel(seed, saved, input);
      expect(output).not.toBe(input);
      const draft = buildGoldenRunDraft({
        task, sourceSha: "a".repeat(40), traceEvents: [], wallTimeMs: 5,
        inputAssetSha256: input, outputAssetSha256: output,
      });
      expect(draft.runs[0]!.pipeline_provenance.output_asset_sha256).toBe(output);
      expect(draft.runs[0]!.quality_verdict).toBe("UNVERIFIED");
      await writeFile(saved, "broken JSON");
      await expect(fingerprintGoldenSavedOutputModel(seed, saved, input))
        .rejects.toThrow("not valid JSON");
      await writeFile(saved, '{"meta":{}}');
      await expect(fingerprintGoldenSavedOutputModel(seed, saved, input))
        .rejects.toThrow("lacks Blockbench document metadata");
      await writeFile(seed, original.replace("synthetic-part-a", "synthetic-part-b"));
      await expect(fingerprintGoldenSavedOutputModel(seed, saved, input))
        .rejects.toThrow("immutable seed was modified");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("draft retains a verified Reference fingerprint without claiming approval", () => {
    const fingerprint = "d".repeat(64);
    const draft = buildGoldenRunDraft({
      task, sourceSha: "a".repeat(40), traceEvents: [], wallTimeMs: 100,
      referencePackageFingerprint: fingerprint,
    });
    expect(draft.runs[0]!.pipeline_provenance.reference_package_fingerprint)
      .toBe(fingerprint);
    expect(draft.runs[0]!.quality_verdict).toBe("UNVERIFIED");
    expect(draft.runs[0]!.accepted_result).toBeNull();
    expect(() => buildGoldenRunDraft({
      task, sourceSha: "a".repeat(40), traceEvents: [], wallTimeMs: 100,
      referencePackageFingerprint: "invalid",
    })).toThrow("referencePackageFingerprint must be a lowercase SHA-256 fingerprint");
  });

  test("run draft retains native preflight identity without upgrading quality", () => {
    const draft = buildGoldenRunDraft({
      task, sourceSha: "a".repeat(40), traceEvents: [], wallTimeMs: 100,
      inputAssetSha256: "b".repeat(64),
      inputProjectUuid: "native-project-1",
      runtimeBuildIdentity: "sha256:" + "c".repeat(64),
    });
    expect(draft.runs[0]!.pipeline_provenance).toMatchObject({
      input_project_uuid: "native-project-1",
      input_asset_sha256: "b".repeat(64),
      runtime_build_identity: "sha256:" + "c".repeat(64),
    });
    expect(draft.runs[0]!.quality_verdict).toBe("UNVERIFIED");
    expect(draft.runs[0]!.accepted_result).toBeNull();
  });

  test("the full Golden task retains its starting model fingerprint", () => {
    const other = goldenCorpus.tasks.find((item) => item.id === "golden-full-asset-authoring")!;
    const draft = buildGoldenRunDraft({
      task: other, sourceSha: "f".repeat(40), traceEvents: [], wallTimeMs: 120,
      inputAssetSha256: "b".repeat(64), inputProjectUuid: "saved-disposable-project",
      runtimeBuildIdentity: "sha256:" + "c".repeat(64),
    });
    expect(draft.runs[0]!.pipeline_provenance).toMatchObject({
      input_asset_sha256: "b".repeat(64), input_project_uuid: "saved-disposable-project",
    });
    expect(draft.runs[0]!.accepted_result).toBeNull();
  });

  test("does not allow a run to borrow a different task or source SHA", () => {
    const event = {
      schema: "lazydesigner-gateway-benchmark-trace-v1" as const,
      sequence: 0, task_id: task.id,
      source_sha: "1234567890abcdef1234567890abcdef12345678",
      timestamp: "2026-10-30T00:00:00.000Z",
      kind: "mutate" as const, capability: "manage_cubes",
      success: true, latency_ms: 10, result_bytes: 100,
      read_only: false, verification_class: "visual",
    };
    for (const wrong of [
      { ...event, source_sha: "a".repeat(40) },
      { ...event, task_id: "golden-retired-case" },
    ]) {
      expect(() => buildGoldenRunDraft({
        task, sourceSha: event.source_sha,
        traceEvents: [wrong], wallTimeMs: 100,
      })).toThrow("does not match the selected task_id and source SHA");
    }
  });

  test("draft never claims quality or decision necessity automatically", () => {
    const draft = buildGoldenRunDraft({
      task,
      sourceSha: "1234567890abcdef1234567890abcdef12345678",
      wallTimeMs: 1500,
      traceEvents: [
        {
          schema: "lazydesigner-gateway-benchmark-trace-v1",
          sequence: 0,
          task_id: task.id,
          source_sha: "1234567890abcdef1234567890abcdef12345678",
          timestamp: "2026-10-30T00:00:00.000Z",
          kind: "inspect",
          capability: "inspect_elements",
          success: true,
          latency_ms: 20,
          result_bytes: 200,
          read_only: true,
          verification_class: "focused_read",
        },
      ],
    });

    const run = draft.runs[0]!;
    expect(run.quality_verdict).toBe("UNVERIFIED");
    expect(run.accepted_result).toBeNull();
    expect(run.trace[0]?.required_for_decision).toBeNull();
    expect(run.trace[0]?.success).toBe(true);
    expect(run.acceptance_evidence.find(entry => entry.criterion === "human_acceptance"))
      .toEqual({ criterion: "human_acceptance", verdict: "UNVERIFIED", evidence_ref: null });
    expect(run.acceptance_evidence.every(
      (entry) => entry.verdict === "UNVERIFIED" && entry.evidence_ref === null
    )).toBe(true);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectObservationRecorder } from "./projectObservation";
import { summarizeProjectObservation } from "../../scripts/reporting/summarize-project-observation";
import { renderProjectObservationHtml } from "../../scripts/reporting/render-project-observation";

const temporaryDirectories: string[] = [];

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "lazydesigner-observation-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path =>
    rm(path, { recursive: true, force: true })));
});

const TASK = "task:" + "a".repeat(20);
function status(uuid: string | null, phase: string = "geometry", live = true) {
  return {
    structuredContent: {
      runtime: {
        mcp_client_ready: live,
        identity: { build_identity: "runtime-build-A" },
      },
      affinity: { project_uuid: uuid, authoring_phase: phase },
      control: { project: { binding: live ? "BOUND" : "UNKNOWN" } },
    },
    content: [{ type: "text", text: "private-text-do-not-persist" }],
  };
}

function invocation(
  uuid: string | null, domain = "GEOMETRY", phaseAfter?: string
) {
  return {
    structuredContent: {
      control_delta: {
        project_uuid: uuid,
        authoring_domain: domain,
        verification_class: "visual",
        invalidates: { acceptance_gates: true },
        downstream_recheck: { required: [{ scope: "MAPPED_TEXTURE" }] },
        ...(phaseAfter ? { phase_after: phaseAfter } : {}),
      },
    },
    content: [{ type: "text", text: "secret-MCP-result" }],
  };
}

describe("bounded always-on project observation", () => {
  test("does not change the Gateway response and persists only bounded metadata", async () => {
    const dir = await directory();
    const observer = new ProjectObservationRecorder(dir);
    const request = {
      tool: "status" as const, args: {
        workspace_path: "C:/private/model",
        current_user_delta: "please change the shape (private instruction)",
      },
      result: status("native-project-A"), durationMs: 12,
    };
    const responseBefore = JSON.stringify(request.result);
    observer.record(request);
    observer.record({
      tool: "invoke_capability",
      args: {
        capability: "manage_cubes", task_context_id: TASK,
        arguments: { token: "SECRET", project_path: "C:/private/asset" },
      },
      result: invocation("native-project-A", "TEXTURING", "texturing"),
      nativeIdentityVerified: true,
      nativeProjectUuid: "native-project-A",
      nativePhaseAfter: "texturing",
      nativeDomain: "TEXTURING",
      nativeVerificationClass: "visual",
      durationMs: 19,
    });
    await observer.flush(true);
    expect(JSON.stringify(request.result)).toBe(responseBefore);

    const names = await readdir(dir);
    expect(names).toHaveLength(1);
    const raw = await readFile(join(dir, names[0]!), "utf8");
    for (const secret of [
      "native-project-A", "private", "SECRET", "secret-MCP-result",
      "workspace_path", "project_path", TASK, "please change the shape",
    ]) expect(raw).not.toContain(secret);
    const report = JSON.parse(raw);
    expect(report.state).toBe("CLOSED");
    expect(report.projects).toHaveLength(1);
    expect(report.projects[0].project_key).toMatch(/^[a-f0-9]{64}$/);
    expect(report.projects[0].counters).toMatchObject({
      calls: 2, failures: 0, duration_sum_ms: 31, verification_required: 1,
      acceptance_gate_invalidations: 1,
      downstream_recheck_requests: 1,
      user_delta_status_observations: 1,
      by_tool: { status: 1, invoke_capability: 1 },
      capabilities: { manage_cubes: 1 },
    });
    expect(report.projects[0].by_domain.TEXTURING).toMatchObject({ calls: 1 });
    expect(report.projects[0].observed_distinct_task_contexts).toBe(1);
    expect(report.projects[0].phase_observations).toMatchObject([
      { phase: "GEOMETRY", source: "VERIFIED_STATUS", observation: "FIRST_SEEN" },
      { phase: "TEXTURING", source: "VERIFIED_PHASE_RECEIPT",
        observation: "CHANGED_BETWEEN_OBSERVATIONS" },
    ]);
    expect(report.retention.max_session_files).toBe(16);
  });

  test("captures observed build keys and finalization content only with bound proof", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    const matched = status("native-final");
    Object.assign(matched.structuredContent.control, {
      workspace: {
        finalization_native_revision: {
          state: "MATCHED",
          accepted_sha256: "sha256:" + "a".repeat(64),
          observed_sha256: "sha256:" + "a".repeat(64),
        },
      },
    });
    obs.record({ tool: "status", args: {}, result: matched, durationMs: 2 });
    const row = obs.snapshot().projects[0]!;
    expect(row.runtime_build_keys).toHaveLength(1);
    expect(row.runtime_build_keys![0]).toMatch(/^[a-f0-9]{64}$/);
    expect(row.matched_checkpoint_sha256_refs).toEqual(["sha256:" + "a".repeat(64)]);

    const stale = status("native-final");
    Object.assign(stale.structuredContent.control, {
      workspace: { finalization_native_revision: {
        state: "MATCHED",
        accepted_sha256: "sha256:" + "b".repeat(64),
        observed_sha256: "sha256:" + "c".repeat(64),
      }},
    });
    obs.record({ tool: "status", args: {}, result: stale, durationMs: 2 });
    expect(obs.snapshot().projects[0]!.matched_checkpoint_sha256_refs)
      .toHaveLength(1);
    expect(obs.snapshot().projects[0]!.runtime_build_keys).toHaveLength(1);

    // Missing canonical Control BOUND evidence must not attribute native UUID.
    const unbound = status("unverified-project");
    Object.assign(unbound.structuredContent.control, { project: { binding: "UNKNOWN" } });
    obs.record({ tool: "status", args: {}, result: unbound, durationMs: 2 });
    expect(obs.snapshot().unbound.calls).toBe(1);
    expect(obs.snapshot().projects).toHaveLength(1);
  });

  test("attributes native read-only operations from the executor's verified binding", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    obs.record({
      tool: "invoke_capability",
      args: { capability: "inspect_elements", arguments: { secret: "PRIVATE" } },
      result: {
        content: [{ type: "text", text: "read-only response without Control Delta" }],
      },
      durationMs: 4,
      nativeIdentityVerified: true,
      nativeProjectUuid: "native-verified-project",
      nativeDomain: "GEOMETRY",
      nativeVerificationClass: "visual",
    });
    obs.record({
      tool: "invoke_capability",
      args: { capability: "inspect_elements" },
      result: { isError: true, structuredContent: { code: "OUTCOME_UNKNOWN" } },
      durationMs: 4,
      nativeIdentityVerified: true,
      nativeProjectUuid: null,
    });
    expect(obs.snapshot().projects).toHaveLength(1);
    expect(obs.snapshot().projects[0]!.counters).toMatchObject({
      calls: 1, failures: 0, verification_required: 1,
      capabilities: { inspect_elements: 1 },
    });
    expect(obs.snapshot().projects[0]!.by_domain.GEOMETRY).toMatchObject({
      calls: 1, failures: 0,
    });
    expect(obs.snapshot().unbound.calls).toBe(1);
  });

  test("rejects failed status and unverified delta as project evidence", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    const invalidStatus = { ...status("spoof-status"), isError: true };
    obs.record({
      tool: "status", args: {}, result: invalidStatus, durationMs: 1,
    });
    obs.record({
      tool: "invoke_capability",
      args: { capability: "manage_cubes" },
      result: invocation("spoof-delta"),
      durationMs: 2,
    });
    const observed = obs.snapshot();
    expect(observed.projects).toHaveLength(0);
    expect(observed.unbound).toMatchObject({
      calls: 2, failures: 1,
      verification_required: 0,
      acceptance_gate_invalidations: 0,
      downstream_recheck_requests: 0,
    });
    expect(observed.observed_calls).toBe(2);

    obs.record({
      tool: "invoke_capability",
      args: { capability: "manage_cubes" },
      result: {
        isError: true,
        structuredContent: { code: "OUTCOME_UNKNOWN",
          control_delta: { project_uuid: "spoofed-native" } },
      },
      nativeIdentityVerified: true,
      nativeProjectUuid: "spoofed-native",
      nativeRuntimeBuildIdentity: "spoofed-build",
      durationMs: 1,
    });
    expect(obs.snapshot().projects).toHaveLength(0);
    expect(obs.snapshot().unbound).toMatchObject({ calls: 3, failures: 2 });

    obs.record({
      tool: "invoke_capability",
      args: { capability: "manage_cubes" },
      result: invocation("verified-native"),
      nativeIdentityVerified: true,
      nativeProjectUuid: "verified-native",
      nativeDomain: "GEOMETRY",
      nativeVerificationClass: "visual",
      durationMs: 3,
    });
    expect(obs.snapshot().projects).toHaveLength(1);
    expect(obs.snapshot().projects[0]!.counters).toMatchObject({
      calls: 1,
      verification_required: 1,
      acceptance_gate_invalidations: 1,
      downstream_recheck_requests: 1,
    });
  });

  test("counts exact observed Runtime builds separately without misattributing missing preflight evidence", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    obs.record({
      tool: "status", args: {}, result: status("same-project"), durationMs: 2,
    });
    obs.record({
      tool: "invoke_capability", args: { capability: "manage_cubes" },
      result: invocation("same-project"),
      nativeIdentityVerified: true,
      nativeProjectUuid: "same-project",
      nativeRuntimeBuildIdentity: "runtime-build-B",
      nativeDomain: "GEOMETRY",
      durationMs: 5,
    });
    obs.record({
      tool: "invoke_capability", args: { capability: "manage_cubes" },
      result: invocation("same-project"),
      nativeIdentityVerified: true,
      nativeProjectUuid: "same-project",
      nativeRuntimeBuildIdentity: "runtime-build-B",
      nativeDomain: "GEOMETRY",
      durationMs: 7,
    });
    obs.record({
      tool: "invoke_capability", args: { capability: "inspect_elements" },
      result: invocation("same-project"),
      nativeIdentityVerified: true,
      nativeProjectUuid: "same-project",
      nativeDomain: "GEOMETRY",
      durationMs: 3,
    });
    const key = (value: string) => createHash("sha256")
      .update("lazydesigner-observed-runtime-build:" + value).digest("hex");
    const row = obs.snapshot().projects[0]!;
    expect(row.observed_runtime_build_calls).toMatchObject({
      [key("runtime-build-A")]: { calls: 1, failures: 0, duration_sum_ms: 2 },
      [key("runtime-build-B")]: { calls: 2, failures: 0, duration_sum_ms: 12 },
    });
    expect(row.runtime_build_unattributed_calls).toBe(1);
    expect(row.counters.calls).toBe(4);
    const report = summarizeProjectObservation([obs.snapshot()]);
    expect(report.projects[0]!.observed_runtime_build_calls).toMatchObject({
      [key("runtime-build-B")]: { calls: 2, failures: 0, duration_sum_ms: 12 },
    });
    expect(report.projects[0]!.runtime_build_measured_sessions).toBe(1);
    expect(report.projects[0]!.runtime_build_unattributed_calls).toBe(1);
    expect(report.coverage.accepted_quality).toBe("UNVERIFIED");
  });

  test("preserves task-context correlation hashes without storing raw IDs", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    const item = status("native-context");
    Object.assign(item.structuredContent.control, { task_context_id: TASK });
    obs.record({ tool: "status", args: {}, result: item, durationMs: 1 });
    obs.record({
      tool: "invoke_capability",
      args: { capability: "manage_cubes", task_context_id: TASK },
      result: invocation("native-context"),
      nativeIdentityVerified: true,
      nativeProjectUuid: "native-context",
      durationMs: 1,
    });
    const expected = createHash("sha256").update(
      "lazydesigner-task-context:" + TASK).digest("hex");
    const row = obs.snapshot().projects[0]!;
    expect(row.observed_task_context_hashes).toEqual([expected]);
    expect(row.observed_distinct_task_contexts).toBe(1);
    expect(JSON.stringify(obs.snapshot())).not.toContain(TASK);
  });

  test("does not assign stale status or failed operations to another project", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    obs.record({
      tool: "status", args: {},
      result: status("stale-native-project", "geometry", false),
      durationMs: 1,
    });
    obs.record({
      tool: "invoke_capability", args: { capability: "manage_cubes" },
      result: {
        isError: true,
        structuredContent: {
          code: "OUTCOME_UNKNOWN",
          control_delta: { project_uuid: "unverified-stale", authoring_domain: "GEOMETRY" },
        },
      },
      durationMs: 2,
    });
    const s = obs.snapshot();
    expect(s.projects).toHaveLength(0);
    expect(s.unbound).toMatchObject({
      calls: 2, failures: 1, error_codes: { OUTCOME_UNKNOWN: 1 },
    });
    expect(s.observed_calls).toBe(2);
  });

  test("keeps capability, project and task-context cardinality strictly bounded", async () => {
    const obs = new ProjectObservationRecorder(await directory());
    for (let i = 0; i < 80; i++) {
      obs.record({
        tool: "invoke_capability",
        args: {
          capability: "capability_" + i,
          task_context_id: "task:" + i.toString(16).padStart(20, "0"),
        },
        result: invocation("native-one"),
        nativeIdentityVerified: true,
        nativeProjectUuid: "native-one",
        nativeDomain: "GEOMETRY",
        durationMs: 1,
      });
    }
    for (let i = 0; i < 14; i++) {
      obs.record({
        tool: "status", args: {},
        result: status("native-" + i),
        durationMs: 1,
      });
    }
    const result = obs.snapshot();
    expect(result.projects).toHaveLength(12);
    expect(result.dropped_project_observations).toBeGreaterThanOrEqual(2);
    const one = result.projects.find(p => p.counters.calls === 80)!;
    expect(one).toBeDefined();
    expect(Object.keys(one.counters.capabilities).length).toBeLessThanOrEqual(25);
    expect(one.counters.capabilities.OTHER).toBeGreaterThan(0);
    expect(one.observed_distinct_task_contexts).toBe(64);
    expect(one.task_contexts_capped).toBe(true);
    expect(result.unbound.calls).toBe(result.dropped_project_observations);
    await obs.flush(true);
  });

  test("collector exceptions remain advisory and are counted as incomplete coverage", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    const malformedArgs = {
      get capability(): string { throw new Error("private faulty getter"); },
    };
    expect(() => obs.record({
      tool: "invoke_capability", args: malformedArgs,
      result: invocation("native"), durationMs: 2,
    })).not.toThrow();
    const report = obs.snapshot();
    expect(report.capture_failures).toBe(1);
    expect(report.observed_calls).toBe(0);
    expect(report.projects).toHaveLength(0);
  });

  test("legacy sessions remain visibly partial in per-build aggregation", () => {
    const old = new ProjectObservationRecorder("/disposable-test-root");
    const current = new ProjectObservationRecorder("/disposable-test-root");
    old.record({
      tool: "status", args: {}, result: status("same-native"), durationMs: 1,
    });
    current.record({
      tool: "status", args: {}, result: status("same-native"), durationMs: 2,
    });
    const legacy = structuredClone(old.snapshot());
    for (const project of legacy.projects) {
      delete project.observed_runtime_build_calls;
      delete project.runtime_build_unattributed_calls;
      delete project.runtime_build_call_counts_capped;
      delete project.observed_task_context_hashes;
      delete project.task_context_hashes_capped;
    }
    const report = summarizeProjectObservation([legacy, current.snapshot()]);
    expect(report.projects[0]).toMatchObject({
      session_count: 2,
      observed_calls: 2,
      runtime_build_measured_sessions: 1,
      runtime_build_unattributed_calls: 0,
    });
    expect(Object.values(report.projects[0]!.observed_runtime_build_calls!)
      .reduce((sum, row) => sum + row.calls, 0)).toBe(1);
  });

  test("disabled L0 never creates a filesystem requirement", async () => {
    const obs = new ProjectObservationRecorder(null);
    obs.record({ tool: "status", args: {}, result: status("uuid"), durationMs: 3 });
    await obs.flush(true);
    expect(obs.snapshot().observed_calls).toBe(0);
    expect(obs.active).toBe(false);
  });

  test("periodic snapshots coalesce into one bounded session file", async () => {
    const dir = await directory();
    const obs = new ProjectObservationRecorder(dir);
    for (let index = 0; index < 150; index++) {
      obs.record({
        tool: "invoke_capability",
        args: { capability: "inspect_elements" },
        result: invocation("native-active"),
        durationMs: index % 3,
      });
    }
    await obs.flush(true);
    const names = await readdir(dir);
    expect(names).toHaveLength(1);
    const stored = JSON.parse(await readFile(join(dir, names[0]!), "utf8"));
    expect(stored.observed_calls).toBe(150);
    expect(stored.state).toBe("CLOSED");
    expect(stored.persist_failures).toBe(0);
  });

  test("failed disk writes never reject the authoring path", async () => {
    const dir = await directory();
    const occupied = join(dir, "not-a-directory");
    await writeFile(occupied, "existing");
    const obs = new ProjectObservationRecorder(occupied);
    obs.record({ tool: "status", args: {}, result: status("native"), durationMs: 1 });
    await expect(obs.flush(true)).resolves.toBeUndefined();
    expect(obs.snapshot().persist_failures).toBeGreaterThan(0);
    expect(obs.snapshot().projects).toHaveLength(1);
  });

  test("retains only sixteen generated session snapshots", async () => {
    const dir = await directory();
    for (let index = 0; index < 19; index++) {
      const recorder = new ProjectObservationRecorder(dir);
      recorder.record({
        tool: "status", args: {},
        result: status("project-retained"),
        durationMs: 1,
      });
      await recorder.flush(true);
    }
    const files = await readdir(dir);
    expect(files.filter(name => name.startsWith("session-"))).toHaveLength(16);
    expect(files.every(name => /^session-[0-9]{13}-[a-f0-9]{16}\.json$/.test(name)))
      .toBe(true);
  });

  test("reports cross-session native identity only, never invents accepted quality", () => {
    const first = new ProjectObservationRecorder("/disposable-test-root");
    const second = new ProjectObservationRecorder("/disposable-test-root");
    first.record({
      tool: "status", args: {},
      result: status("same-native-project"), durationMs: 10,
    });
    second.record({
      tool: "invoke_capability",
      args: { capability: "manage_cubes" },
      result: invocation("same-native-project"),
      nativeIdentityVerified: true,
      nativeProjectUuid: "same-native-project",
      nativeDomain: "GEOMETRY",
      nativeVerificationClass: "visual",
      durationMs: 20,
    });
    second.record({
      tool: "status", args: {},
      result: status("different-native-project"),
      durationMs: 1,
    });
    const summary = summarizeProjectObservation([
      first.snapshot(), second.snapshot(),
    ]);
    expect(summary.observed_calls).toBe(3);
    expect(summary.projects).toHaveLength(2);
    expect(summary.projects[0]).toMatchObject({
      session_count: 2, observed_calls: 2,
      observed_call_duration_sum_ms: 30,
      verification_obligations_observed: 1,
    });
    expect(summary.coverage).toMatchObject({
      retained_session_snapshots: 2,
      project_completion: "UNVERIFIED",
      accepted_quality: "UNVERIFIED",
      project_wall_time_ms: null,
      provider_tokens: null,
      open_or_unclean_sessions: 2,
    });
  });

  test("renders a strict offline HTML report with no raw project identity or script", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    obs.record({
      tool: "status", args: { workspace_path: "C:/private" },
      result: status("secret-native-project"), durationMs: 1,
    });
    const report = summarizeProjectObservation([obs.snapshot()]);
    const html = renderProjectObservationHtml(report);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("Project Observation");
    expect(html).toContain("Unbound calls");
    expect(html).toContain("accepted result");
    expect(html).not.toContain("secret-native-project");
    expect(html).not.toContain("C:/private");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
  });

  test("rejects duplicate or malformed snapshot summaries", () => {
    const obs = new ProjectObservationRecorder("/disposable-test-root");
    obs.record({
      tool: "status", args: {}, result: status("native"), durationMs: 1,
    });
    const first = obs.snapshot();
    expect(() => summarizeProjectObservation([first, first]))
      .toThrow("Duplicate session");
    const malformed = structuredClone(first);
    malformed.unbound.by_tool.status += 10;
    expect(() => summarizeProjectObservation([malformed]))
      .toThrow("inconsistent tool count");
    const falseNative = structuredClone(first);
    falseNative.projects[0]!.project_key = "C:/PRIVATE/KEY";
    expect(() => summarizeProjectObservation([falseNative]))
      .toThrow("unverified native project key");
  });
});

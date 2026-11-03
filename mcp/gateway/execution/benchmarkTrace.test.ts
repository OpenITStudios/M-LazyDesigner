import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { BenchmarkTraceRecorder, measureMcpImageDelivery } from "./benchmarkTrace";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("Gateway benchmark trace recorder", () => {
  test("counts actual MCP image items; rejects malformed base64 without persisting pixels", () => {
    const png = Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
    const other = Buffer.from([0,1,2,3,4]);
    const payload = {
      content: [
        {type:"text",text:"PRIVATE/PATH"},
        {type:"image",mimeType:"image/png",data:png.toString("base64")},
        {type:"image",mimeType:"image/webp",data:other.toString("base64")},
      ],
    };
    expect(measureMcpImageDelivery(payload)).toEqual({
      delivered_count:2,delivered_bytes:17,png_count:1,png_bytes:12,
    });
    expect(measureMcpImageDelivery({content:[{type:"text",text:"fine"}]}))
      .toEqual({delivered_count:0,delivered_bytes:0,png_count:0,png_bytes:0});
    expect(measureMcpImageDelivery({content:[{
      type:"image",mimeType:"image/png",data:"INVALID!!",
    }]})).toBeNull();
    expect(measureMcpImageDelivery({structuredContent:{claimed_images:5}}))
      .toBeNull();
  });
  test("is a zero-write no-op unless explicitly enabled", async () => {
    const recorder = BenchmarkTraceRecorder.fromEnvironment({});
    expect(recorder.enabled).toBe(false);

    recorder.record({
      startedAt: recorder.startedAt(),
      kind: "search",
      success: true,
      result: { secret: "must-not-write" },
    });
    await recorder.flush();
  });

  test("fails closed when an enabled trace lacks task or exact source identity", () => {
    expect(() =>
      BenchmarkTraceRecorder.fromEnvironment({
        LAZYDESIGNER_BENCHMARK_TRACE_PATH: "/tmp/trace.ndjson",
      })
    ).toThrow("LAZYDESIGNER_BENCHMARK_TASK_ID");

    expect(() =>
      BenchmarkTraceRecorder.fromEnvironment({
        LAZYDESIGNER_BENCHMARK_TRACE_PATH: "/tmp/trace.ndjson",
        LAZYDESIGNER_BENCHMARK_TASK_ID: "golden-prop-chair",
        LAZYDESIGNER_BENCHMARK_SOURCE_SHA: "not-a-sha",
      })
    ).toThrow("exact 40-character Git SHA");
  });

  test("captures only returned PNG byte digests and rejects mismatched view labels", async () => {
    const dir = await mkdtemp(join(tmpdir(), "golden-capture-trace-"));
    temporaryDirectories.push(dir);
    const path = join(dir, "trace.ndjson");
    const fingerprint = "a".repeat(64);
    const recorder = BenchmarkTraceRecorder.fromEnvironment({
      LAZYDESIGNER_BENCHMARK_TRACE_PATH: path,
      LAZYDESIGNER_BENCHMARK_TASK_ID: "golden-full-asset-authoring",
      LAZYDESIGNER_BENCHMARK_SOURCE_SHA: "b".repeat(40),
      LAZYDESIGNER_BENCHMARK_REFERENCE_FINGERPRINT: fingerprint,
    });
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const payload = png.toString("base64");
    const good = {
      content: [
        { type: "text", text: "VIEW front" },
        { type: "image", mimeType: "image/png", data: payload },
      ],
      structuredContent: {
        project: { uuid: "disposable-golden" },
        front_direction: "-z",
        render_evidence: {
          shading: true, diagnostic_missing_texture_highlight: false,
        },
        captures: [{ view: "front", png_bytes: png.length }],
      },
      secret: "PRIVATE/PATH/reference.png",
    };
    recorder.record({
      startedAt: recorder.startedAt(), kind: "verify",
      capability: "capture_model_views", success: true, result: good,
    });
    recorder.record({
      startedAt: recorder.startedAt(), kind: "verify",
      capability: "capture_model_views", success: true,
      result: { ...good, content: [
        { type: "text", text: "VIEW back" }, good.content[1],
      ] },
    });
    await recorder.flush();
    const text = await readFile(path, "utf8");
    expect(text).not.toContain("PRIVATE/PATH");
    expect(text).not.toContain(payload);
    const events = text.trim().split("\n").map(row => JSON.parse(row));
    expect(events).toHaveLength(2);
    expect(events[0].mcp_images).toEqual({
      delivered_count:1,delivered_bytes:png.length,png_count:1,png_bytes:png.length,
    });
    expect(events[1].mcp_images).toEqual({
      delivered_count:1,delivered_bytes:png.length,png_count:1,png_bytes:png.length,
    });
    expect(events[0].capture_evidence).toMatchObject({
      reference_package_fingerprint: fingerprint,
      project_uuid: "disposable-golden",
      front_direction: "-z", shading: true,
      views: [{
        view: "front",
        png_sha256: createHash("sha256").update(png).digest("hex"),
      }],
    });
    expect(events[0].capture_evidence.evidence_ref)
      .toMatch(/^golden-capture:v1:[a-f0-9]{64}$/);
    expect(events[1].capture_evidence).toBeUndefined();
  });

  test("native project export receipt is bound to readback-matched bytes without leaking local paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "golden-project-export-trace-"));
    temporaryDirectories.push(dir);
    const path = join(dir, "trace.ndjson");
    const recorder = BenchmarkTraceRecorder.fromEnvironment({
      LAZYDESIGNER_BENCHMARK_TRACE_PATH: path,
      LAZYDESIGNER_BENCHMARK_TASK_ID: "golden-full-asset-authoring",
      LAZYDESIGNER_BENCHMARK_SOURCE_SHA: "b".repeat(40),
      LAZYDESIGNER_BENCHMARK_REFERENCE_FINGERPRINT: "a".repeat(64),
    });
    const savePath = "C:/private/golden-disposable.bbmodel";
    const digest = "sha256:" + "c".repeat(64);
    const result = {
      structuredContent: {
        codec: { id: "project" },
        save_behavior: "NATIVE_PROJECT_SAVE",
        file_integrity_state: "READBACK_MATCHED",
        compiled_payload_sha256: digest,
        written_file_sha256: digest,
        wrote_to_path: savePath,
        project: { uuid: "live-golden-project", saved: true, save_path: savePath },
      },
      content: [{ type: "text", text: savePath }],
    };
    for (const payload of [
      result,
      { ...result, structuredContent: {
        ...result.structuredContent, file_integrity_state: "SIZE_ONLY",
      } },
      { ...result, structuredContent: {
        ...result.structuredContent, written_file_sha256: "sha256:" + "d".repeat(64),
      } },
      { ...result, structuredContent: {
        ...result.structuredContent, project: {
          ...result.structuredContent.project, save_path: "C:/private/other.bbmodel",
        },
      } },
    ]) {
      recorder.record({
        startedAt: recorder.startedAt(), kind: "mutate",
        capability: "export_model", success: true, result: payload,
      });
    }
    await recorder.flush();
    const text = await readFile(path, "utf8");
    expect(text).not.toContain(savePath);
    expect(text).not.toContain("private/golden");
    const events = text.trim().split("\n").map(line => JSON.parse(line));
    expect(events).toHaveLength(4);
    expect(events[0].artifact_evidence).toMatchObject({
      project_uuid: "live-golden-project",
      codec_id: "project",
      file_integrity_state: "READBACK_MATCHED",
      compiled_payload_sha256: digest, written_file_sha256: digest,
    });
    expect(events[0].artifact_evidence.evidence_ref)
      .toMatch(/^golden-artifact:v1:[a-f0-9]{64}$/);
    for (const event of events.slice(1)) {
      expect(event.artifact_evidence).toBeUndefined();
    }
  });

  test("writes ordered metadata only and never persists result contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-trace-"));
    temporaryDirectories.push(dir);
    const path = join(dir, "trace.ndjson");
    const recorder = BenchmarkTraceRecorder.fromEnvironment({
      LAZYDESIGNER_BENCHMARK_TRACE_PATH: path,
      LAZYDESIGNER_BENCHMARK_TASK_ID: "golden-existing-model-correction",
      LAZYDESIGNER_BENCHMARK_SOURCE_SHA:
        "1234567890abcdef1234567890abcdef12345678",
    });

    recorder.record({
      startedAt: recorder.startedAt(),
      kind: "inspect",
      capability: "inspect_elements",
      success: true,
      result: {
        secret_reference_path: "C:/private/reference.png",
        structuredContent: { sensitive: "do-not-persist" },
      },
      readOnly: true,
      verificationClass: "focused_read",
      traceparent: "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01",
      taskContextId: "C:/private/control-context",
      cohortBoundary: "CONTINUE",
      queueTiming: { queue_wait_ms: 3, operation_duration_ms: 7 },
    });
    recorder.record({
      startedAt: recorder.startedAt(),
      kind: "mutate",
      capability: "manage_cubes",
      success: true,
      result: { execution: "applied" },
      readOnly: false,
      verificationClass: "visual",
      traceparent: "forged-or-invalid-parent",
    });
    recorder.record({
      startedAt: recorder.startedAt(),
      kind: "recovery",
      capability: "manage_cubes",
      success: false,
      result: {
        content: [{ type: "text", text: "private/sensitive-result" }],
        structuredContent: {
          code: "OUTCOME_UNKNOWN",
          message: "private/sensitive-result",
        },
      },
    });
    await recorder.flush();

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("private/reference.png");
    expect(raw).not.toContain("do-not-persist");
    expect(raw).not.toContain("private/sensitive-result");
    expect(raw).not.toContain("private/control-context");
    expect(raw).not.toContain("forged-or-invalid-parent");

    const events = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(events[2].error_code).toBe("OUTCOME_UNKNOWN");
    expect(events[0].error_code).toBeNull();
    expect(events[0]).toMatchObject({
      schema: "lazydesigner-gateway-benchmark-trace-v1",
      task_id: "golden-existing-model-correction",
      source_sha: "1234567890abcdef1234567890abcdef12345678",
      kind: "inspect",
      capability: "inspect_elements",
      success: true,
      read_only: true,
      verification_class: "focused_read",
    });
    expect(events[0].result_bytes).toBeGreaterThan(0);
    expect(events[0].started_at).toMatch(/^\d{4}-/);
    expect(events[0].queue_timing).toEqual({
      queue_wait_ms: 3, operation_duration_ms: 7,
    });
    expect(events[0].correlation).toMatchObject({
      trace_id: "a".repeat(32),
      parent_span_id: "b".repeat(16),
      origin: "CLIENT_TRACEPARENT",
      task_context_ref: createHash("sha256")
        .update("C:/private/control-context").digest("hex"),
      cohort_boundary: "CONTINUE",
    });
    expect(events[0].correlation.span_id).toMatch(/^[a-f0-9]{16}$/);
    expect(events[1].correlation).toMatchObject({
      origin: "GATEWAY_LOCAL", parent_span_id: null,
      task_context_ref: null,
    });
    expect(events[1].correlation.trace_id).toBe(events[2].correlation.trace_id);
    expect(new Set(events.map((event) => event.correlation.span_id)).size)
      .toBe(3);
  });
});

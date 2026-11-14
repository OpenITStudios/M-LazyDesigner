import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareGeometryTriageReport,
  runGeometryTriageCli,
  MAX_GEOMETRY_TRIAGE_INPUT_BYTES,
} from "../scripts/authoring/analyze-geometry";

const bounds = () => ({ min: [0, 0, 0], max: [16, 16, 16] });
const root = () => ({
  uuid: "root", name: "body", origin: [8, 8, 8],
  parent_uuid: null, rotation: [0, 0, 0],
});

describe("read-only Geometry CLI triage", () => {
  test("matching numeric envelope is never visual silhouette PASS", () => {
    const input = {
      model_bounds: bounds(),
      reference_bounds: bounds(),
      rig_groups: [root()],
      surface_warnings: [],
    };
    const clone = structuredClone(input);
    const report = prepareGeometryTriageReport(input, "a".repeat(64));
    expect(report.envelope).toMatchObject({
      state: "available",
      metric_basis: "axis_aligned_projected_envelopes",
      silhouette_fidelity: false,
      visual_verdict: "not_evaluated",
    });
    expect(report.envelope?.state === "available" &&
      report.envelope.average_iou).toBe(1);
    expect(report.rig?.state).toBe("valid_graph");
    expect(report.surface?.state).toBe("no_bounded_risk_reported");
    expect(report.native_mutation).toBe(false);
    expect(report.native_verified).toBe(false);
    expect(report.visual_verdict).toBe("UNVERIFIED");
    expect(report.execution).toBe("INSPECTION_NOT_MUTATION");
    expect(input).toEqual(clone);
  });

  test("unknown reference bounds remain unavailable rather than PASS", () => {
    const report = prepareGeometryTriageReport({
      model_bounds: bounds(), reference_bounds: null,
    });
    expect(report.envelope?.state).toBe("unavailable");
    expect(report.visual_verdict).toBe("UNVERIFIED");
    expect(report.next_action).toBe("OBTAIN_MISSING_NATIVE_AND_REFERENCE_EVIDENCE");
  });

  test("broken rig ancestry and bounded surface warnings require review", () => {
    const invalid = prepareGeometryTriageReport({
      rig_groups: [
        { ...root(), parent_uuid: "child" },
        { uuid: "child", name: "arm", origin: [8, 12, 8], parent_uuid: "root" },
      ],
      surface_warnings: ["Possible z-fighting: face A / face B"],
    });
    expect(invalid.rig?.state).toBe("invalid_graph");
    expect(invalid.surface).toMatchObject({
      state: "review_required", categorized_risk_count: 1,
    });
    expect(invalid.next_action).toBe("RESOLVE_DECLARED_RIG_GRAPH_CONFLICTS");
    expect(invalid.visual_verdict).toBe("UNVERIFIED");
    const truncated = prepareGeometryTriageReport({
      surface_warnings: ["Surface-quality diagnostics unavailable"],
    });
    expect(truncated.surface?.state).toBe("incomplete");
    expect(truncated.visual_verdict).toBe("UNVERIFIED");
  });

  test("rejects empty and unbounded declarations before analysis", () => {
    expect(() => prepareGeometryTriageReport({}))
      .toThrow("GEOMETRY_TRIAGE_INPUT_EMPTY");
    expect(() => prepareGeometryTriageReport({ rig_groups: [null] }))
      .toThrow("GEOMETRY_TRIAGE_RIG_INPUT_INVALID");
    expect(() => prepareGeometryTriageReport({
      rig_groups: Array.from({ length: 513 }, (_, i) => ({
        ...root(), uuid: String(i),
      })),
    })).toThrow("GEOMETRY_TRIAGE_RIG_INPUT_INVALID");
    expect(() => prepareGeometryTriageReport({
      surface_warnings: [7],
    })).toThrow("GEOMETRY_TRIAGE_SURFACE_INPUT_INVALID");
  });

  test("CLI JSON output is bounded, read-only, and source-compatible", async () => {
    const dir = await mkdtemp(join(tmpdir(), "geometry-triage-"));
    const file = join(dir, "geometry.json");
    try {
      const original = JSON.stringify({
        model_bounds: bounds(), reference_bounds: bounds(), rig_groups: [root()],
      });
      await writeFile(file, original);
      const result = await runGeometryTriageCli(["--input", file, "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schema: "lazydesigner-geometry-triage-cli-v1",
        execution: "INSPECTION_NOT_MUTATION",
        visual_verdict: "UNVERIFIED",
      });
      expect(await readFile(file, "utf8")).toBe(original);
      await writeFile(file, "x".repeat(MAX_GEOMETRY_TRIAGE_INPUT_BYTES + 1));
      const tooLarge = await runGeometryTriageCli(["--input", file]);
      expect(tooLarge.exitCode).toBe(2);
      expect(tooLarge.stderr).toContain("GEOMETRY_TRIAGE_INPUT_FILE_INVALID");
      expect((await runGeometryTriageCli(["--help"])).stdout).toContain("--json");
      expect((await runGeometryTriageCli(["--input", file, "--apply"])).exitCode)
        .toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("existing managed CLI exposes exactly the same local owner", async () => {
    const [manager, packageSource] = await Promise.all([
      Bun.file("../distribution/cli.ts").text(),
      Bun.file("../distribution/package.ts").text(),
    ]);
    expect(manager).toContain('command === "analyze-geometry"');
    expect(manager).toContain("runGeometryTriageCli(raw)");
    expect(packageSource).toContain("Compiled manager read-only Geometry triage smoke failed.");
    // This only proves source wiring; no actual executable was run.
  });
});

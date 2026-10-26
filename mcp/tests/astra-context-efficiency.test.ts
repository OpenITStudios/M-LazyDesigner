import { describe, expect, test } from "bun:test";
import {
  measureAstraContextPayloads,
  payloadMeasurement,
} from "@/scripts/measure/measure-astra-context";

describe("Astra context efficiency measurement", () => {
  test("reports deterministic serialized payload reduction without claiming token counts", () => {
    const measurements = measureAstraContextPayloads();
    const byName = new Map(
      measurements.map((entry) => [entry.name, entry] as const)
    );
    const delta = byName.get("control_delta_continuation");
    const search = byName.get("capability_search_projection");
    const searchEnvelope = byName.get("capability_search_envelope");
    const describeEnvelope = byName.get("capability_describe_envelope");
    const cubeText = byName.get("manage_cubes_text_summary");
    const cubes = byName.get("manage_cubes_continuation");
    const inspect = byName.get("inspect_elements_detail_schema");

    for (const measurement of [delta, search, searchEnvelope, describeEnvelope, cubes, inspect]) {
      expect(measurement).toBeDefined();
      expect(measurement!.saved_bytes).toBeGreaterThan(0);
      expect(measurement!.after_bytes).toBeLessThan(measurement!.before_bytes);
    }

    expect(delta!.reduction_percent).toBeGreaterThan(15);
    expect(search!.reduction_percent).toBeGreaterThan(5);
    expect(searchEnvelope!.reduction_percent).toBeGreaterThan(0);
    expect(describeEnvelope!.reduction_percent).toBeGreaterThan(5);
    // The visual-approval disclaimer is unique evidence and must survive compaction.
    expect(cubeText).toBeDefined();
    expect(cubeText!.saved_bytes).toBe(0);
    expect(cubeText!.after_bytes).toBe(cubeText!.before_bytes);
    expect(cubes!.reduction_percent).toBeGreaterThan(35);
    expect(inspect!.reduction_percent).toBeGreaterThan(60);

    const totalSaved = measurements.reduce(
      (sum, entry) => sum + entry.saved_bytes,
      0
    );
    expect(totalSaved).toBeGreaterThan(500);
  });

  test("measurement never fabricates savings when payload grows", () => {
    expect(payloadMeasurement("growth", { a: 1 }, { a: 1, b: 2 })).toMatchObject({
      saved_bytes: 0,
      reduction_percent: 0,
    });
  });
});

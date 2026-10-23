import { describe, expect, test } from "bun:test";
import { summarizeFiniteBounds, surfaceSweepIntervalForOrientedBox } from "@/lib/renderedModelBounds";

describe("rendered model bounds numeric safety", () => {
  test("derives a finite midpoint without summing large same-sign endpoints", () => {
    const { center, size } = summarizeFiniteBounds(
      [1e308, 0, 0],
      [1.5e308, 16, 8]
    );
    expect(Number.isFinite(size[0])).toBe(true);
    expect(Number.isFinite(center[0])).toBe(true);
    expect(center[0]).toBe(1.25e308);
  });

  test("rejects finite endpoints whose derived span overflows", () => {
    expect(() =>
      summarizeFiniteBounds([-1e308, 0, 0], [1e308, 16, 8])
    ).toThrow("Rendered model bounds span is non-finite");
  });
  test("world OBB sweep retains nearby candidates but prunes distant ones", () => {
    const box = {
      center: [0, 0, 0] as [number, number, number],
      halfSizes: [1, 1, 1] as [number, number, number],
      axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as
        [[number, number, number], [number, number, number], [number, number, number]],
    };
    const first = surfaceSweepIntervalForOrientedBox(box);
    expect(surfaceSweepIntervalForOrientedBox({
      ...box, center: [4, 0, 0],
    }).minX).toBeLessThanOrEqual(first.maxX);
    expect(surfaceSweepIntervalForOrientedBox({
      ...box, center: [40, 0, 0],
    }).minX).toBeGreaterThan(first.maxX);
  });

  test("world-space interval overflow expands rather than dropping evidence", () => {
    const extreme = surfaceSweepIntervalForOrientedBox({
      center: [1e308, 0, 0],
      halfSizes: [1e308, 1e308, 1e308],
      axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    });
    expect(extreme.maxX).toBe(Number.POSITIVE_INFINITY);
    expect(extreme.minX).toBeLessThan(1e308);
  });

});

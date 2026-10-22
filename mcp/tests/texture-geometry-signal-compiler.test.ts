import { describe, expect, test } from "bun:test";
import { compileGeometrySignalEvidence, type GeometrySignalFaceBinding } from "@/lib/texture/geometrySignalCompiler";
import { deriveGeometrySurfaceSignals } from "@/lib/texture/geometrySignalBuilder";
import type { CompiledAuthoringRecipe } from "@/lib/authoringRecipe/contracts";

// Only placement IDs matter to this pure signal compiler. No native model
// mutation or synthetic visual approval is implied by these fixtures.
const compiled = {
  placements: [{ id: "left" }, { id: "right" }, { id: "third" }],
} as unknown as CompiledAuthoringRecipe;

function face(
  instance_id: string,
  overrides: Partial<GeometrySignalFaceBinding> = {}
): GeometrySignalFaceBinding {
  return {
    instance_id,
    atlas_rect: { x: 0, y: 0, width: 4, height: 4 },
    world_normal: [0, 1, 0],
    ...overrides,
  };
}

function compile(faces: GeometrySignalFaceBinding[]) {
  return compileGeometrySignalEvidence({ compiled, width: 8, height: 8, faces });
}

describe("geometry-aware texture UV sharing safety", () => {
  test("exact reused island with compatible exposure/contact/cavity is supported", () => {
    const evidence = compile([
      face("left", { contact: true, cavity: true }),
      face("right", { contact: true, cavity: true }),
    ]);
    const signals = deriveGeometrySurfaceSignals(evidence);
    expect(signals.upward_exposure?.values[0]).toBe(1);
    expect(signals.upward_exposure?.values[3 + 3 * 8]).toBe(1);
    expect(signals.upward_exposure?.values[4]).toBe(0);
    expect(signals.contact?.values[0]).toBe(1);
    expect(signals.cavity?.values[0]).toBe(1);
  });

  test("shared texels cannot demand different exposure or contact/cavity treatment", () => {
    const conflicts: GeometrySignalFaceBinding[] = [
      face("right", { world_normal: [0, -1, 0] }),
      face("right", { contact: true }),
      face("right", { cavity: true }),
    ];
    for (const right of conflicts) {
      expect(() => compile([face("left"), right]))
        .toThrow("conflicting shared UV treatment");
    }
  });

  test("partial UV overlap is rejected even when treatment flags match", () => {
    expect(() => compile([
      face("left"),
      face("right", { atlas_rect: { x: 2, y: 0, width: 4, height: 4 } }),
    ])).toThrow("partial UV overlap");
  });

  test("logical rectangles sharing one rasterized texel cannot evade overlap validation", () => {
    expect(() => compile([
      face("left", { atlas_rect: { x: 0.1, y: 0, width: 0.8, height: 1 } }),
      face("right", { atlas_rect: { x: 0.9, y: 0, width: 0.8, height: 1 } }),
    ])).toThrow("partial UV overlap");
  });

  test("identical raster footprint is not permission to alias different logical UV mapping", () => {
    expect(() => compile([
      face("left", { atlas_rect: { x: 0.1, y: 0, width: 0.6, height: 1 } }),
      face("right", { atlas_rect: { x: 0.2, y: 0, width: 0.6, height: 1 } }),
    ])).toThrow("aliased raster texels with different UV mapping");
  });

  test("separate islands or merely edge-touching regions remain valid", () => {
    const evidence = compile([
      face("left", { atlas_rect: { x: 0, y: 0, width: 4, height: 4 } }),
      face("right", { atlas_rect: { x: 4, y: 0, width: 4, height: 4 },
        world_normal: [0, -1, 0], contact: true }),
    ]);
    const signals = deriveGeometrySurfaceSignals(evidence);
    expect(signals.upward_exposure?.values[0]).toBe(1);
    expect(signals.upward_exposure?.values[4]).toBe(0);
    expect(signals.contact?.values[4]).toBe(1);
  });

  test("weighted UV masks clip fractional face footprints and retain maximum exposure", () => {
    const footprints = [
      { x: 0.5, y: 0.5, width: 2.1, height: 1.5, weight: 0.25 },
      { x: 1, y: 1, width: 3, height: 2, weight: 0.75 },
      { x: -2, y: 3, width: 3, height: 2, weight: 0.5 },
      { x: 6, y: 1, width: 1, height: 1, weight: 1 },
    ];
    const snapshot = structuredClone(footprints);
    const mask = deriveGeometrySurfaceSignals({
      width: 6, height: 4, upward_regions: footprints,
    }).upward_exposure;
    if (!mask) throw new Error("weighted mask absent");
    const pixel = (x: number, y: number) => mask.values[y * 6 + x];
    expect(pixel(0, 0)).toBe(0.25);
    expect(pixel(1, 1)).toBe(0.75);
    expect(pixel(3, 1)).toBe(0.75);
    expect(pixel(3, 2)).toBe(0.75);
    expect(pixel(0, 3)).toBe(0.5);
    expect(pixel(5, 1)).toBe(0);
    expect(pixel(5, 3)).toBe(0);
    expect(footprints).toEqual(snapshot);

    expect(() => deriveGeometrySurfaceSignals({
      width: 6, height: 4,
      upward_regions: [{ x: 0, y: 0, width: 2, height: 1, weight: 1.1 }],
    })).toThrow("weighted region weight");
    expect(() => deriveGeometrySurfaceSignals({
      width: 6, height: 4,
      upward_regions: [{ x: 0, y: 0, width: 0, height: 1, weight: 0.2 }],
    })).toThrow("finite positive bounds");
  });

  test("repeated UV exposure footprints avoid per-face whole-atlas masks", async () => {
    const repeated = Array.from({ length: 512 }, (_, index) => ({
      x: index % 2 === 0 ? 8 : 8.5,
      y: 6, width: 4, height: 2,
      weight: index % 2 === 0 ? 0.5 : 0.75,
    }));
    const signals = deriveGeometrySurfaceSignals({
      width: 64, height: 64, upward_regions: repeated,
    });
    expect(signals.upward_exposure?.values[6 * 64 + 8]).toBe(0.75);
    expect(signals.upward_exposure?.values[7 * 64 + 12]).toBe(0.75);
    expect(signals.upward_exposure?.values[7 * 64 + 13]).toBe(0);
    const src = await Bun.file("lib/texture/geometrySignalBuilder.ts").text();
    const start = src.indexOf("function weightedRectMask(");
    const end = src.indexOf("function uniformMask(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toContain("rectMask(width,height,[rect])");
  });

  test("repeated identical UV sharing remains supported without quadratic pair comparisons", () => {
    const many = Array.from({ length: 512 }, (_, index) =>
      face(index % 2 === 0 ? "left" : "right", { contact: true })
    );
    const result = compile(many);
    expect(deriveGeometrySurfaceSignals(result).contact?.values[0]).toBe(1);
    // A distinct overlapping footprint must still be diagnosed even after
    // compatible exact UV aliases have been collapsed.
    expect(() => compile([
      ...many,
      face("third", { atlas_rect: { x: 2, y: 0, width: 4, height: 4 } }),
    ])).toThrow("partial UV overlap");
  });

  test("world-normal normalization rejects overflow rather than fabricating zero exposure", () => {
    expect(() => compile([face("left", {
      world_normal: [1.7e308, 1.7e308, 1.7e308],
    })])).toThrow("finite and non-zero");
  });

  test("invalid ownership still fails rather than authorizing a shading mask", () => {
    expect(() => compile([face("unowned")])).toThrow("unowned instance");
  });
});

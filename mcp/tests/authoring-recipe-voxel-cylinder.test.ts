import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { AdvancedGeometryFeature } from "@/lib/authoringRecipe/geometrySchema";
import { buildGeometryShapePieces } from "@/lib/authoringRecipe/geometryShapeBuilders";
import { buildAdvancedGeometryRecipeCandidate } from "@/lib/authoringRecipe/geometryComposition";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";

type Tube = Extract<AdvancedGeometryFeature, { kind: "voxel_cylinder" }>;

function tube(radius: number, innerRadius: number): Tube {
  return {
    kind: "voxel_cylinder",
    id: "cavity",
    label: "generic hollow form",
    evidence_refs: ["reference:front", "reference:side"],
    geometry_reasons: ["SILHOUETTE", "NEGATIVE_SPACE"],
    center: [0, 0, 0],
    axis: "Y",
    radius,
    inner_radius: innerRadius,
    length: 4,
  };
}

const blankRecipe = (): AuthoringRecipe => ({
  schema: 1, compiler_version: 1,
  id: "shape-topology-contract", name: "generic shape",
  prototypes: [], patterns: [],
});

describe("voxel cylinder negative-space topology (source-only construction)", () => {
  test("rejects a corner-leaking hole that a four-neighbour blank flood mislabels enclosed", () => {
    // Radius 2/inner radius 1 has four central empty cells. Each central
    // corner meets a blank exterior corner diagonally across a voxel vertex.
    // Its annular material remains 4-connected, but its cavity is NOT
    // 8-disconnected from the exterior and must not be called sealed.
    const shape = tube(2, 1);
    const unchanged = structuredClone(shape);
    expect(() => buildGeometryShapePieces(shape))
      .toThrow("ADVANCED_GEOMETRY_VOXEL_CYLINDER_HOLE_NOT_ENCLOSED");
    expect(() => buildAdvancedGeometryRecipeCandidate(blankRecipe(), [shape]))
      .toThrow("ADVANCED_GEOMETRY_VOXEL_CYLINDER_HOLE_NOT_ENCLOSED");
    expect(shape).toEqual(unchanged);
  });

  test("retains valid face-connected solids and well-protected hollow cross-sections", () => {
    const solid = buildGeometryShapePieces(tube(2, 0));
    expect(solid.prototypes.length).toBeGreaterThan(0);
    expect(solid.prototypes.length).toBe(solid.patterns.length);

    const hollowInput = tube(3, 1);
    const original = structuredClone(hollowInput);
    const hollow = buildGeometryShapePieces(hollowInput);
    expect(hollow.patterns.length).toBeGreaterThan(0);
    expect(hollow.patterns.length).toBeLessThanOrEqual(64);
    // Every generated panel is an ordinary native Cuboid in one Recipe,
    // not a mesh or a special-purpose modeling executor.
    const planned = buildAdvancedGeometryRecipeCandidate(
      blankRecipe(), [hollowInput]
    );
    const compiled = compileAuthoringRecipe(planned.next_recipe);
    expect(compiled.placements).toHaveLength(hollow.patterns.length);
    expect(planned.next_recipe.prototypes).toHaveLength(hollow.prototypes.length);

    // A cross-section cell in the explicitly declared central opening must
    // remain unoccupied. The blank void is actual geometry, not an invisible
    // "inner Cube" or a deletion planned after mutation.
    const cavityPoint = [0.5, 0, 0.5];
    expect(compiled.placements.some(cube =>
      cavityPoint.every((coordinate, axis) =>
        coordinate >= cube.from[axis]! &&
        coordinate < cube.to[axis]!
      )
    )).toBe(false);
    expect(hollowInput).toEqual(original);
  });

  test("same input produces the same bounded disjoint Cuboid source without auto-smoothing", () => {
    const source = tube(4, 2);
    const first = buildGeometryShapePieces(source);
    const second = buildGeometryShapePieces(structuredClone(source));
    expect(second).toEqual(first);
    const shapes = first.patterns.map(pattern => {
      expect(pattern.kind).toBe("LINEAR");
      const instance = pattern as Extract<typeof pattern, { kind: "LINEAR" }>;
      const prototype = first.prototypes.find(p => p.id === instance.prototype_id)!;
      return { from: instance.start!, size: prototype.size };
    });
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i]!, b = shapes[j]!;
        const overlaps = [0, 1, 2].map(axis =>
          Math.min(a.from[axis]! + a.size[axis]!, b.from[axis]! + b.size[axis]!) -
          Math.max(a.from[axis]!, b.from[axis]!)
        );
        expect(overlaps.every(span => span > 0)).toBe(false);
      }
    }
  });
});

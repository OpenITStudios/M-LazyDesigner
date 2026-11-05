import { describe, expect, test } from "bun:test";
import type { AdvancedGeometryFeature } from "@/lib/authoringRecipe/geometrySchema";
import {
  geometryMathProfileSweepPartSchema,
  geometryMathProgramSchema,
  type GeometryMathProfileSweepPart,
} from "@/lib/authoringRecipe/geometryMathLanguage";
import {
  requireProfileSweepSequentialContact,
  sweepMathProfileVolume,
} from "@/lib/authoringRecipe/geometryMathProfileSweep";
import {
  buildAdvancedGeometryRecipeCandidate,
  reviewStoredAdvancedGeometrySource,
} from "@/lib/authoringRecipe/geometryComposition";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { projectRecipeFormSignatures } from "@/lib/authoringRecipe/formSignature";

const station = (
  position: [number, number, number],
  half_width = 2, half_height = 1, twist_degrees = 0
) => ({ position, half_width, half_height, twist_degrees });

function profile(
  overrides: Partial<GeometryMathProfileSweepPart> = {}
): GeometryMathProfileSweepPart {
  return {
    id: "horn", at: [0, 0, 0], method: "PROFILE_SWEEP",
    cross_section: "RECTANGLE", up_axis: "Y",
    stations: [
      station([0, 0, 0]), station([8, 0, 0]),
    ],
    ...overrides,
  };
}

const rawProgram = (part: GeometryMathProfileSweepPart) => ({
  version: 13 as const,
  scale_context: { model_units_per_block: 16 as const },
  parts: [part],
});

function candidate(part: GeometryMathProfileSweepPart) {
  const feature: AdvancedGeometryFeature = {
    kind: "program", id: "horn-feature", label: "horn morphology",
    evidence_refs: ["reference:side"],
    geometry_reasons: ["SILHOUETTE"],
    program: rawProgram(part),
  };
  const seed = {
    schema: 1 as const, compiler_version: 1 as const,
    id: "profile-sweep-case", name: "source morph",
    prototypes: [], patterns: [],
  };
  return buildAdvancedGeometryRecipeCandidate(seed, [feature]).next_recipe;
}

function unionVolume(boxes: ReturnType<typeof sweepMathProfileVolume>) {
  return boxes.reduce((sum, box) => sum +
    (box.to[0] - box.from[0]) *
    (box.to[1] - box.from[1]) *
    (box.to[2] - box.from[2]), 0);
}

describe("R3z v13 morphology with no shape presets", () => {
  test("straight rectangular profile is one exact native-compatible Cuboid", () => {
    const input = profile();
    const before = structuredClone(input);
    const boxes = sweepMathProfileVolume(input);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({
      from: [0, -2, -1],
      to: [8, 2, 1],
    });
    expect(unionVolume(boxes)).toBe(64);
    expect(sweepMathProfileVolume(input)).toEqual(boxes);
    expect(input).toEqual(before);
  });

  test("independent half-extents produce a visible taper without randomness", () => {
    const boxes = sweepMathProfileVolume(profile({
      stations: [station([0, 0, 0], 3, 2), station([8, 0, 0], 1, 1)],
    }));
    const crossArea = (x: number) => {
      let count = 0;
      for (let y = -5; y < 5; y++) {
        for (let z = -5; z < 5; z++) {
          if (boxes.some(box =>
            x + 0.5 >= box.from[0] && x + 0.5 < box.to[0] &&
            y + 0.5 >= box.from[1] && y + 0.5 < box.to[1] &&
            z + 0.5 >= box.from[2] && z + 0.5 < box.to[2]
          )) count++;
        }
      }
      return count;
    };
    expect(crossArea(1)).toBeGreaterThan(crossArea(7));
    expect(unionVolume(boxes)).toBeGreaterThan(0);
  });

  test("transported frames follow a bend; anisotropic twist is explicit", () => {
    const bent = profile({
      cross_section: "ELLIPSE",
      stations: [
        station([0, 0, 0], 2, 2),
        station([6, 0, 0], 2, 2),
        station([6, 0, 6], 2, 2),
      ],
    });
    const result = sweepMathProfileVolume(bent);
    expect(result.length).toBeGreaterThan(0);
    expect(Math.max(...result.map(box => box.to[2]))).toBeGreaterThan(5);
    const noTwist = sweepMathProfileVolume(profile({
      stations: [station([0, 0, 0], 3, 1), station([8, 0, 0], 3, 1)],
    }));
    const twisted = sweepMathProfileVolume(profile({
      stations: [station([0, 0, 0], 3, 1, 0),
        station([8, 0, 0], 3, 1, 90)],
    }));
    expect(twisted).not.toEqual(noTwist);
    expect(sweepMathProfileVolume(bent)).toEqual(result);
  });

  test("rejects unrepresentable frames, reversals and unsafe resolution", () => {
    expect(() => sweepMathProfileVolume(profile({up_axis: "X"})))
      .toThrow("GEOMETRY_MATH_PROFILE_SWEEP_UP_AXIS_PARALLEL");
    expect(() => sweepMathProfileVolume(profile({
      stations: [
        station([0, 0, 0]), station([4, 0, 0]), station([0, 0, 0]),
      ],
    }))).toThrow("GEOMETRY_MATH_PROFILE_SWEEP_REVERSAL_UNSUPPORTED");
    expect(() => sweepMathProfileVolume(profile({
      stations: [station([0, 0, 0]), station([64, 0, 0])],
    }))).toThrow("GEOMETRY_MATH_VOXEL_GRID_BUDGET");
    expect(() => geometryMathProfileSweepPartSchema.parse(profile({
      stations: [station([0, 0, 0]), station([0, 0, 0])],
    }))).toThrow();
    expect(() => geometryMathProfileSweepPartSchema.parse(profile({
      stations: [station([0, 0, 0], 0.5), station([8, 0, 0])],
    }))).toThrow();
  });

  test("consecutive segment contact rejects hidden disconnections behind a globally connected mass", () => {
    // Each voxel is occupied and the overall 4-cell line is 6-connected,
    // but the authored segment order is A -> B -> C while material follows
    // A -> C -> B. A and B do not even share a voxel or a full face.
    const globallyConnected = new Uint8Array([
      0b001, 0b100, 0b100, 0b010,
    ]);
    expect(() => requireProfileSweepSequentialContact(
      globallyConnected, [4, 1, 1], 3
    )).toThrow("GEOMETRY_MATH_PROFILE_SWEEP_JOINT_DISCONNECTED: 0 -> 1");
  });

  test("accepts shared or face-contact stations but not diagonal-only contact", () => {
    expect(() => requireProfileSweepSequentialContact(
      new Uint8Array([0b001, 0b010]), [2, 1, 1], 2
    )).not.toThrow();
    expect(() => requireProfileSweepSequentialContact(
      new Uint8Array([0b011]), [1, 1, 1], 2
    )).not.toThrow();
    expect(() => requireProfileSweepSequentialContact(
      new Uint8Array([0b001, 0b011, 0b110, 0b100]), [4, 1, 1], 3
    )).not.toThrow();
    const diagonal = new Uint8Array([0b001, 0, 0, 0b010]);
    expect(() => requireProfileSweepSequentialContact(
      diagonal, [2, 2, 1], 2
    )).toThrow("GEOMETRY_MATH_PROFILE_SWEEP_JOINT_DISCONNECTED");
  });

  test("a multistation straight taper preserves one source Recipe and its ordered joins", () => {
    const multi = profile({
      stations: [
        station([0, 0, 0], 2, 1),
        station([4, 0, 0], 2, 1),
        station([8, 0, 0], 2, 1),
      ],
    });
    const before = structuredClone(multi);
    const same = sweepMathProfileVolume(multi);
    expect(same).toEqual(sweepMathProfileVolume(profile()));
    const produced = compileAuthoringRecipe(candidate(multi));
    expect(produced.metrics.realized_cube_count).toBe(1);
    expect(multi).toEqual(before);
  });

  test("strict v13 opt-in and legacy v12 rejection preserve frozen contracts", () => {
    const item = profile();
    expect(geometryMathProgramSchema.parse(rawProgram(item)).version).toBe(13);
    expect(() => geometryMathProgramSchema.parse({
      version: 12, scale_context: {model_units_per_block:16},
      uncertainty_targets: [{
        id:"scope",part_id:"horn",axis:"X",
        unit:"MODEL_UNITS",min_value:1,max_value:12,
        tolerance_model_units:1,evidence:{kind:"DECLARED_SPEC"},
      }],
      parts:[item],
    })).toThrow();
    expect(() => geometryMathProgramSchema.parse({
      ...rawProgram(item),
      calibration_uncertainty: {
        meters_per_block: {
          min_value:0.8,max_value:1.2,
          evidence:{kind:"DECLARED_SPEC"},
        },
      },
    })).toThrow();
  });

  test("compiles, persists and reconstructs one canonical Recipe source", () => {
    const recipe = candidate(profile());
    const compiled = compileAuthoringRecipe(recipe);
    expect(compiled.metrics.realized_cube_count).toBe(1);
    expect(reviewStoredAdvancedGeometrySource(recipe).state)
      .toBe("AVAILABLE_MATCHED_SOURCE");
    const context = projectRecipeFormSignatures(recipe, {
      source_cohorts: recipe.advanced_geometry_source,
    });
    expect(context.signatures[0]?.parameter_source?.parts[0]).toMatchObject({
      id: "horn", method: "PROFILE_SWEEP",
    });
    expect(context.signatures[0]?.variation_policy)
      .toBe("NO_DECLARED_VARIATION_BOUNDS");
    expect(context.visual_verdict).toBe("NOT_EVALUATED");
  });
});

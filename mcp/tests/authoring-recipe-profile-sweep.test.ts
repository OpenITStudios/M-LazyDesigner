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

  test("rejects out-of-station contact even when the entire mass is connected", () => {
    // The X-line is globally face-connected. Segment 0 occupies x=0..4;
    // segment 1 occupies x=4..5; their only contact occurs at x=4,
    // whereas their declared shared station is near x=1.5.
    const ownership = new Uint8Array([
      0b001, 0b001, 0b001, 0b001, 0b011, 0b010,
    ]);
    expect(() => requireProfileSweepSequentialContact(
      ownership, [6, 1, 1], 2
    )).not.toThrow(); // Earlier global-only source semantics.
    const joints = [
      station([0, 0.5, 0.5], 1, 1),
      station([1.5, 0.5, 0.5], 1, 1),
      station([6, 0.5, 0.5], 1, 1),
    ];
    expect(() => requireProfileSweepSequentialContact(
      ownership, [6, 1, 1], 2, { low: [0, 0, 0], stations: joints }
    )).toThrow(
      "GEOMETRY_MATH_PROFILE_SWEEP_JOINT_DISCONNECTED: 0 -> 1;reason=OFF_STATION"
    );
  });

  test("retains full-face station contact and rejects only misplaced joint evidence", () => {
    const actualJoin = new Uint8Array([
      0b001, 0b001, 0b001, 0b010, 0b010, 0b010,
    ]);
    const joints = [
      station([0, 0.5, 0.5], 1, 1),
      station([2.5, 0.5, 0.5], 1, 1),
      station([6, 0.5, 0.5], 1, 1),
    ];
    expect(() => requireProfileSweepSequentialContact(
      actualJoin, [6, 1, 1], 2, { low: [0, 0, 0], stations: joints }
    )).not.toThrow();
    // Invalid station count must not accidentally disable local grounding.
    expect(() => requireProfileSweepSequentialContact(
      actualJoin, [6, 1, 1], 2,
      { low: [0, 0, 0], stations: joints.slice(1) }
    )).toThrow("GEOMETRY_MATH_PROFILE_SWEEP_JOINT_CONTEXT_INVALID");
  });

  test("a bent, explicitly twisted profile stays deterministic with station-local joins", () => {
    const bent = profile({
      cross_section: "RECTANGLE",
      stations: [
        station([0, 0, 0], 2, 1, 0),
        station([6, 0, 0], 2, 1, 30),
        station([6, 0, 6], 2, 1, 60),
      ],
    });
    const before = structuredClone(bent);
    const cubes = sweepMathProfileVolume(bent);
    expect(cubes.length).toBeGreaterThan(0);
    expect(cubes).toEqual(sweepMathProfileVolume(bent));
    expect(bent).toEqual(before);
    // This proves only a bounded source/voxel invariant if executed,
    // not smoothness or visual resemblance to the reference.
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

  test("rejects a material taper collapsed into one voxel-length section", () => {
    const unresolved = profile({
      stations: [station([0, 0, 0], 1, 1), station([1, 0, 0], 2, 1)],
    });
    expect(geometryMathProfileSweepPartSchema.parse(unresolved)).toEqual(unresolved);
    const before = structuredClone(unresolved);
    // One occupied x-cell cannot represent distinct early/late radial bands.
    expect(() => sweepMathProfileVolume(unresolved))
      .toThrow("GEOMETRY_MATH_PROFILE_SWEEP_TAPER_UNREPRESENTED");
    expect(() => candidate(unresolved))
      .toThrow("GEOMETRY_MATH_PROFILE_SWEEP_TAPER_UNREPRESENTED");
    expect(unresolved).toEqual(before);
  });

  test("rejects source taper whose early and late voxel sections are identical", () => {
    // At x=0.5 the authored half-width is 1.5625; at x=7.5 it
    // is 2.4375. Both sections still rasterize only y=±0.5,±1.5.
    // The declared +1 model-unit change has disappeared entirely.
    const widthLost = profile({
      stations: [
        station([0, 0, 0], 1.5, 1),
        station([8, 0, 0], 2.5, 1),
      ],
    });
    expect(() => sweepMathProfileVolume(widthLost))
      .toThrow("GEOMETRY_MATH_PROFILE_SWEEP_TAPER_UNREPRESENTED: segment=0;axis=WIDTH");

    const heightLost = profile({
      stations: [
        station([0, 0, 0], 1, 1.5),
        station([8, 0, 0], 1, 2.5),
      ],
    });
    expect(() => sweepMathProfileVolume(heightLost))
      .toThrow("GEOMETRY_MATH_PROFILE_SWEEP_TAPER_UNREPRESENTED: segment=0;axis=HEIGHT");
  });

  test("preserves independent resolved width and height taper signals", () => {
    const shaped = profile({
      stations: [station([0, 0, 0], 1, 3), station([8, 0, 0], 3, 1)],
    });
    const before = structuredClone(shaped);
    const boxes = sweepMathProfileVolume(shaped);
    const widthsAt = (x: number) => {
      const ys = new Set<number>(), zs = new Set<number>();
      for (let y = -5; y < 5; y++) for (let z = -5; z < 5; z++) {
        if (boxes.some(box =>
          x + 0.5 >= box.from[0] && x + 0.5 < box.to[0] &&
          y + 0.5 >= box.from[1] && y + 0.5 < box.to[1] &&
          z + 0.5 >= box.from[2] && z + 0.5 < box.to[2])) {
          ys.add(y); zs.add(z);
        }
      }
      return {width: ys.size, height: zs.size};
    };
    const start = widthsAt(0), end = widthsAt(7);
    expect(end.width).toBeGreaterThan(start.width);
    expect(end.height).toBeLessThan(start.height);
    expect(sweepMathProfileVolume(shaped)).toEqual(boxes);
    expect(compileAuthoringRecipe(candidate(shaped)).metrics.realized_cube_count)
      .toBe(boxes.length);
    expect(shaped).toEqual(before);
  });

  test("retains smaller-than-one-unit variation without inventing visible taper", () => {
    const subtle = profile({
      stations: [station([0, 0, 0], 1, 1), station([1, 0, 0], 1.25, 1)],
    });
    const before = structuredClone(subtle);
    const boxes = sweepMathProfileVolume(subtle);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every(box => [0, 1, 2].every(axis =>
      box.to[axis]! > box.from[axis]!))).toBe(true);
    expect(subtle).toEqual(before);
    // Source acceptance does not claim visible sub-voxel fidelity.
  });

  test("rejects a full authored twist erased by one axial voxel", () => {
    const lost = profile({
      stations: [
        station([0, 0, 0], 3, 1, -180),
        station([1, 0, 0], 3, 1, 180),
      ],
    });
    const unchanged = structuredClone(lost);
    expect(geometryMathProfileSweepPartSchema.parse(lost)).toEqual(lost);
    // The only occupied x-cell is at t=0.5. At that sample the
    // interpolated twist is 0 degrees, geometrically identical to
    // the -180-degree starting rectangle. No angular change survives
    // the native one-unit raster despite 360 degrees of source twist.
    expect(() => sweepMathProfileVolume(lost))
      .toThrow("GEOMETRY_MATH_PROFILE_SWEEP_TWIST_UNREPRESENTED: segment=0");
    expect(() => candidate(lost))
      .toThrow("GEOMETRY_MATH_PROFILE_SWEEP_TWIST_UNREPRESENTED");
    expect(lost).toEqual(unchanged);
  });

  test("keeps pronounced anisotropic twist with distinct raster handedness", () => {
    const positive = profile({
      stations: [
        station([0, 0, 0], 2, 1, 0),
        station([8, 0, 0], 2, 1, 90),
      ],
    });
    const negative = profile({
      stations: [
        station([0, 0, 0], 2, 1, 0),
        station([8, 0, 0], 2, 1, -90),
      ],
    });
    const before = structuredClone(positive);
    const a = sweepMathProfileVolume(positive);
    const b = sweepMathProfileVolume(negative);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
    expect(a).toEqual(sweepMathProfileVolume(positive));
    expect(compileAuthoringRecipe(candidate(positive))
      .metrics.realized_cube_count).toBe(a.length);
    expect(positive).toEqual(before);
  });

  test("preserves symmetry and subthreshold turns without inventing rotational evidence", () => {
    const circular = profile({
      cross_section: "ELLIPSE",
      stations: [
        station([0, 0, 0], 2, 2, -180),
        station([1, 0, 0], 2, 2, 180),
      ],
    });
    // A circular section cannot expose its twist by occupancy; do not
    // arbitrarily reject valid rotationally symmetric source geometry.
    expect(sweepMathProfileVolume(circular).length).toBeGreaterThan(0);

    const subtle = profile({
      stations: [
        station([0, 0, 0], 2, 1, 0),
        station([1, 0, 0], 2, 1, 30),
      ],
    });
    expect(sweepMathProfileVolume(subtle).length).toBeGreaterThan(0);
    // A source pass is not proof that small twist is visually rendered.
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

import { describe, expect, test } from "bun:test";
import type { RecipeVec3 } from "@/lib/authoringRecipe/contracts";
import type { GeometryMathConnectorPart } from "@/lib/authoringRecipe/geometryMathLanguage";
import { geometryMathConnectorPartSchema } from "@/lib/authoringRecipe/geometryMathLanguage";
import {
  buildMathConnector,
  type GeometryConnectorSource,
} from "@/lib/authoringRecipe/geometryMathConnect";

const vec = (x: number, y: number, z: number): RecipeVec3 =>
  [x, y, z];

function source(
  id: string, from: RecipeVec3, to: RecipeVec3
): GeometryConnectorSource {
  return {
    id, world_min: [...from], world_max: [...to],
    translation: [0, 0, 0],
    local_boxes: [{ id: "solid", from: [...from], to: [...to] }],
  };
}

function sources() {
  return new Map([
    ["start", source("start", vec(-6, -2, -2), vec(-2, 2, 2))],
    ["end", source("end", vec(2, -2, -2), vec(6, 2, 2))],
  ]);
}

function connector(
  via: GeometryMathConnectorPart["via"] = []
): GeometryMathConnectorPart {
  return {
    id: "joined-beam", method: "CONNECT",
    start: {
      part_id: "start", anchor: ["MAX", "CENTER", "CENTER"],
    },
    end: {
      part_id: "end", anchor: ["MIN", "CENTER", "CENTER"],
    },
    radius: [1, 1],
    interpolation: "LINEAR",
    max_chord_error: 0.5,
    via,
  };
}

describe("face-aware CONNECT source-material waypoint preflight", () => {
  test("preserves straight and outward curved connections with canonical Cube contact", () => {
    const straight = connector();
    expect(geometryMathConnectorPartSchema.parse(straight)).toEqual(straight);
    const unchanged = structuredClone(straight);
    const boxes = buildMathConnector(straight, sources(), 6);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every(box =>
      [0, 1, 2].every(axis => box.to[axis]! > box.from[axis]!)
    )).toBe(true);
    expect(straight).toEqual(unchanged);

    // The curved elbow stays outside both source solids; source face
    // contact and path voxel-connectivity are still checked as before.
    const elbow = connector([{
      fraction: 0.5, offset: [0, 3, 0], radius: 1,
    }]);
    expect(geometryMathConnectorPartSchema.parse(elbow)).toEqual(elbow);
    expect(buildMathConnector(elbow, sources(), 6).length)
      .toBeGreaterThan(0);
  });

  test("rejects a waypoint inside an endpoint Cube even when both face directions pass", () => {
    // With start=-2 and end=+2 along X, these two via positions are:
    // +3 (inside END solid) followed by 0 (outside both solids).
    // First step heads outward (+X); the last step approaches the
    // end's NEG_X face from outside (+X), so direction checks alone pass.
    const detour = connector([
      { fraction: 0.25, offset: [4, 0, 0], radius: 1 },
      { fraction: 0.75, offset: [-1, 0, 0], radius: 1 },
    ]);
    expect(geometryMathConnectorPartSchema.parse(detour)).toEqual(detour);
    const original = structuredClone(detour);
    expect(() => buildMathConnector(detour, sources(), 6))
      .toThrow("GEOMETRY_MATH_CONNECT_WAYPOINT_INSIDE_SOURCE: joined-beam");
    expect(detour).toEqual(original);
  });

  test("checks all LINEAR centerline segments, not only waypoint samples", () => {
    // The route begins outward and approaches the target from the correct
    // side, while neither waypoint is inside a source Cube. Its middle
    // chord nevertheless crosses the START solid between the two points.
    const crossing = connector([
      { fraction: 0.25, offset: [1, 4, 0], radius: 1 }, // [0,4,0]
      { fraction: 0.75, offset: [-9, -4, 0], radius: 1 }, // [-8,-4,0]
    ]);
    expect(geometryMathConnectorPartSchema.parse(crossing)).toEqual(crossing);
    const before = structuredClone(crossing);
    expect(() => buildMathConnector(crossing, sources(), 6))
      .toThrow("GEOMETRY_MATH_CONNECT_CENTERLINE_INSIDE_SOURCE: joined-beam");
    expect(crossing).toEqual(before);
  });

  test("proves curved centerline intervals from the canonical Catmull-Rom controls", () => {
    // All authored points are to the right of the start solid's x=-2
    // boundary, and every straight chord is exterior. The Catmull-Rom
    // tangent between the two nearly aligned -1.999 samples overshoots
    // back through the START source mass in between those knots.
    const looping = connector([
      { fraction: 0.2, offset: [2.2, 0, 0], radius: 1 },   // [1,0,0]
      { fraction: 0.5, offset: [-1.999, 0, 0], radius: 1 }, // [-1.999,0,0]
      { fraction: 0.8, offset: [-3.199, 1, 0], radius: 1 }, // [-1.999,1,0]
    ]);
    looping.interpolation = "CENTRIPETAL_CATMULL_ROM";
    expect(geometryMathConnectorPartSchema.parse(looping)).toEqual(looping);
    expect(() => buildMathConnector(looping, sources(), 6))
      .toThrow(/GEOMETRY_MATH_CONNECT_CENTERLINE_(INSIDE_SOURCE|UNVERIFIED)/);
  });

  test("keeps genuinely exterior Catmull-Rom and LINEAR connections eligible", () => {
    const outside = connector([{
      fraction: 0.5, offset: [0, 3, 0], radius: 1,
    }]);
    outside.interpolation = "CENTRIPETAL_CATMULL_ROM";
    expect(geometryMathConnectorPartSchema.parse(outside)).toEqual(outside);
    const result = buildMathConnector(outside, sources(), 6);
    expect(result.length).toBeGreaterThan(0);
    const linear = connector();
    expect(buildMathConnector(linear, sources(), 6).length)
      .toBeGreaterThan(0);
  });

  test("does not retroactively change v5 connector source semantics", () => {
    const detour = connector([
      { fraction: 0.25, offset: [4, 0, 0], radius: 1 },
      { fraction: 0.75, offset: [-1, 0, 0], radius: 1 },
    ]);
    // V5 lacks the v6 exterior-face contract; stored v5 inputs stay
    // on their original source behavior, not a silent version migration.
    expect(() => buildMathConnector(detour, sources(), 5)).not.toThrow();
  });

  test("does not mistake an empty source envelope for occupied Cuboid material", () => {
    const actualSources = sources();
    const emptyMiddle: GeometryConnectorSource = {
      id: "end",
      world_min: [2, -2, -2], world_max: [6, 2, 2],
      translation: [0, 0, 0],
      local_boxes: [
        { id: "top", from: [2, 1, -2], to: [6, 2, 2] },
        { id: "bottom", from: [2, -2, -2], to: [6, -1, 2] },
      ],
    };
    actualSources.set("end", emptyMiddle);
    const open = connector([
      // Interpolated waypoint (3, 0, 0) lies within the END part AABB,
      // but in the actual void between its two separated Cube strips.
      { fraction: 0.25, offset: [4, -0.375, 0], radius: 1 },
      { fraction: 0.75, offset: [-1, 0.375, 0], radius: 1 },
    ]);
    open.end.offset = [0, 1.5, 0];
    expect(geometryMathConnectorPartSchema.parse(open)).toEqual(open);
    expect(() => buildMathConnector(open, actualSources, 6)).not.toThrow();
  });
});

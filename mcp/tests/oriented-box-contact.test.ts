import { describe, expect, test } from "bun:test";
import {
  analyzeOrientedBoxContact,
  analyzeOrientedBoxContainment,
  type OrientedBox,
  type Vec3,
} from "@/lib/orientedBoxContact";

const IDENTITY_AXES: [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function box(
  center: Vec3,
  axes: [Vec3, Vec3, Vec3] = IDENTITY_AXES,
  halfSizes: Vec3 = [1, 1, 1]
): OrientedBox {
  return { center, axes, halfSizes };
}

describe("oriented box contact", () => {
  test("classifies axis-aligned separation with a decisive signed gap", () => {
    const result = analyzeOrientedBoxContact(
      box([0, 0, 0]),
      box([3, 0, 0])
    );

    expect(result.classification).toBe("separate");
    expect(result.separation).toBeCloseTo(1);
    expect(result.signedAxisDistance).toBeCloseTo(1);
    expect(result.penetrationDepth).toBe(0);
    expect(result.normal).toEqual([1, 0, 0]);
    expect(result.exactForOrientedBoxes).toBe(true);
  });

  test("treats exact or tolerance-bounded contact as touching", () => {
    const exact = analyzeOrientedBoxContact(
      box([0, 0, 0]),
      box([2, 0, 0])
    );
    expect(exact.classification).toBe("touching");
    expect(exact.signedAxisDistance).toBe(0);

    const withinTolerance = analyzeOrientedBoxContact(
      box([0, 0, 0]),
      box([2.0005, 0, 0]),
      0.001
    );
    expect(withinTolerance.classification).toBe("touching");
    expect(withinTolerance.separation).toBe(0);
  });

  test("reports minimum translation depth for intersecting boxes", () => {
    const result = analyzeOrientedBoxContact(
      box([0, 0, 0]),
      box([1.5, 0, 0])
    );

    expect(result.classification).toBe("intersecting");
    expect(result.signedAxisDistance).toBeCloseTo(-0.5);
    expect(result.penetrationDepth).toBeCloseTo(0.5);
    expect(result.separation).toBe(0);
  });

  test("handles rotated oriented boxes instead of falling back to AABB-only checks", () => {
    const cosine = Math.SQRT1_2;
    const sine = Math.SQRT1_2;
    const rotatedAxes: [Vec3, Vec3, Vec3] = [
      [cosine, sine, 0],
      [-sine, cosine, 0],
      [0, 0, 1],
    ];

    const separate = analyzeOrientedBoxContact(
      box([0, 0, 0]),
      box([2.6, 0, 0], rotatedAxes)
    );
    expect(separate.classification).toBe("separate");
    expect(separate.separation).toBeGreaterThan(0);

    const intersecting = analyzeOrientedBoxContact(
      box([0, 0, 0]),
      box([2.2, 0, 0], rotatedAxes)
    );
    expect(intersecting.classification).toBe("intersecting");
    expect(intersecting.penetrationDepth).toBeGreaterThan(0);
  });

  test("strict OBB containment supports independently rotated target and container", () => {
    const rotatedAxes: [Vec3, Vec3, Vec3] = [
      [Math.SQRT1_2, Math.SQRT1_2, 0],
      [-Math.SQRT1_2, Math.SQRT1_2, 0],
      [0, 0, 1],
    ];
    const outer = box([0, 0, 0], rotatedAxes, [5, 5, 5]);
    const inner = box([0, 0, 0], rotatedAxes, [1, 1, 1]);
    const result = analyzeOrientedBoxContainment(outer, inner);
    expect(result.contained).toBe(true);
    expect(result.minimum_signed_clearance).toBeCloseTo(4);
    expect(result.exactForOrientedBoxes).toBe(true);
    expect(analyzeOrientedBoxContainment(inner, outer).contained).toBe(false);
    expect(analyzeOrientedBoxContainment(
      outer, box([6, 0, 0], rotatedAxes, [1, 1, 1])
    ).contained).toBe(false);
  });

  test("OBB containment does not treat touching faces or zero-thickness planes as hidden volumes", () => {
    const outer = box([0, 0, 0], IDENTITY_AXES, [5, 5, 5]);
    const touching = box([4, 0, 0], IDENTITY_AXES, [1, 1, 1]);
    expect(analyzeOrientedBoxContainment(outer, touching).contained).toBe(false);
    expect(analyzeOrientedBoxContainment(outer,
      box([0, 0, 0], IDENTITY_AXES, [0, 1, 1])
    ).contained).toBe(false);
    expect(() => analyzeOrientedBoxContainment(outer, touching, Number.NaN))
      .toThrow("tolerance");
  });

  test("rejects malformed axes, half sizes, and tolerance before analysis", () => {
    expect(() =>
      analyzeOrientedBoxContact(
        box([0, 0, 0]),
        box([3, 0, 0], [
          [1, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ])
      )
    ).toThrow();

    expect(() =>
      analyzeOrientedBoxContact(
        box([0, 0, 0]),
        box([3, 0, 0], IDENTITY_AXES, [-1, 1, 1])
      )
    ).toThrow();

    expect(() =>
      analyzeOrientedBoxContact(
        box([0, 0, 0]),
        box([3, 0, 0]),
        Number.NaN
      )
    ).toThrow();
  });
});

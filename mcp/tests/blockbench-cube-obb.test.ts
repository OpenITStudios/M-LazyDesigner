import { describe, expect, test } from "bun:test";
import { orientedBoxFromBlockbenchCubeState } from "@/lib/blockbenchCubeObb";
import {
  analyzeOrientedBoxContact,
  analyzeOrientedBoxContainment,
} from "@/lib/orientedBoxContact";

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

describe("Blockbench Cube OBB mapping", () => {
  test("identity matrix maps authored cube center and half-sizes", () => {
    const box = orientedBoxFromBlockbenchCubeState({
      from: [0, 0, 0],
      to: [4, 6, 8],
      origin: [2, 3, 4],
      matrixWorld: IDENTITY,
    });
    expect(box.center).toEqual([0, 0, 0]);
    expect(box.halfSizes).toEqual([2, 3, 4]);
    expect(box.axes).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  test("matrix translation and basis scale are reflected exactly", () => {
    const box = orientedBoxFromBlockbenchCubeState({
      from: [0, 0, 0],
      to: [2, 4, 6],
      origin: [1, 2, 3],
      matrixWorld: [
        2, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 4, 0,
        10, 20, 30, 1,
      ],
    });
    expect(box.center).toEqual([10, 20, 30]);
    expect(box.halfSizes).toEqual([2, 6, 12]);
  });

  test("90-degree world rotation produces rotated OBB axes", () => {
    const box = orientedBoxFromBlockbenchCubeState({
      from: [-2, -1, -1],
      to: [2, 1, 1],
      origin: [0, 0, 0],
      matrixWorld: [
        0, 1, 0, 0,
        -1, 0, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
    });
    expect(box.axes[0]).toEqual([0, 1, 0]);
    expect(box.axes[1]).toEqual([-1, 0, 0]);
    expect(box.halfSizes).toEqual([2, 1, 1]);
  });

  test("inflate expands all rendered half-sizes symmetrically", () => {
    const box = orientedBoxFromBlockbenchCubeState({
      from: [0, 0, 0],
      to: [2, 2, 2],
      origin: [1, 1, 1],
      inflate: 0.5,
      matrixWorld: IDENTITY,
    });
    expect(box.halfSizes).toEqual([1.5, 1.5, 1.5]);
  });

  test("mapped boxes feed exact SAT contact classification", () => {
    const first = orientedBoxFromBlockbenchCubeState({
      from: [-1, -1, -1],
      to: [1, 1, 1],
      origin: [0, 0, 0],
      matrixWorld: IDENTITY,
    });
    const second = orientedBoxFromBlockbenchCubeState({
      from: [-1, -1, -1],
      to: [1, 1, 1],
      origin: [0, 0, 0],
      matrixWorld: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        2, 0, 0, 1,
      ],
    });
    expect(analyzeOrientedBoxContact(first, second).classification).toBe(
      "touching"
    );
  });

  test("Cube world-matrix mapping feeds rotated OBB containment at one pose", () => {
    const c = Math.SQRT1_2;
    const matrixWorld = [
      c, c, 0, 0,
      -c, c, 0, 0,
      0, 0, 1, 0,
      8, 3, 2, 1,
    ];
    const shell = orientedBoxFromBlockbenchCubeState({
      from: [-5, -5, -5], to: [5, 5, 5], origin: [0, 0, 0],
      matrixWorld,
    });
    const detail = orientedBoxFromBlockbenchCubeState({
      from: [-1, -1, -1], to: [1, 1, 1], origin: [0, 0, 0],
      matrixWorld,
    });
    const review = analyzeOrientedBoxContainment(shell, detail);
    expect(review.contained).toBe(true);
    expect(review.minimum_signed_clearance).toBeCloseTo(4);
  });

  test("invalid matrix and excessive negative inflate fail closed", () => {
    expect(() =>
      orientedBoxFromBlockbenchCubeState({
        from: [0, 0, 0],
        to: [1, 1, 1],
        origin: [0, 0, 0],
        matrixWorld: [1, 0, 0],
      })
    ).toThrow("16 finite matrix values");

    expect(() =>
      orientedBoxFromBlockbenchCubeState({
        from: [0, 0, 0],
        to: [1, 1, 1],
        origin: [0, 0, 0],
        inflate: -1,
        matrixWorld: IDENTITY,
      })
    ).toThrow("negative or non-finite rendered half-size");
  });
});

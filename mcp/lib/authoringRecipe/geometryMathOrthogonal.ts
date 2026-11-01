import type { RecipeVec3 } from "./contracts";
import type { MathCuboid } from "./geometryMathVoxel";

type Axis = "X" | "Y" | "Z";

/**
 * Pure exact right-angle transformation for source-local axis-aligned
 * Cuboids. Rotation is about the supplied semantic-part bounds centre,
 * not a Blockbench Bone pivot, native Cube rotation or a texture operation.
 * It preserves dimensions without sine/cosine rounding and does not
 * infer UV mirror policies.
 *
 * Right-handed positive quarter turns:
 * X: (y,z) -> (-z,y)
 * Y: (x,z) -> (z,-x)
 * Z: (x,y) -> (-y,x)
 */
export function rotateMathCuboidsQuarterTurns(
  boxes: readonly MathCuboid[],
  min: RecipeVec3,
  max: RecipeVec3,
  axis: Axis,
  steps: number
): MathCuboid[] {
  if (![1, 2, 3].includes(steps)) {
    throw new Error("GEOMETRY_MATH_ORIENT_QUARTER_TURNS_INVALID");
  }
  const pivot = [0, 1, 2].map(index =>
    (min[index]! + max[index]!) / 2
  ) as RecipeVec3;
  if (![...pivot, ...min, ...max].every(Number.isFinite) ||
    min.some((value, index) => max[index]! <= value)) {
    throw new Error("GEOMETRY_MATH_ORIENT_FRAME_INVALID");
  }
  const rotatePoint = (point: RecipeVec3): RecipeVec3 => {
    let [x, y, z] = [
      point[0] - pivot[0],
      point[1] - pivot[1],
      point[2] - pivot[2],
    ];
    for (let index = 0; index < steps; index++) {
      if (axis === "X") [y, z] = [-z, y];
      else if (axis === "Y") [x, z] = [z, -x];
      else if (axis === "Z") [x, y] = [-y, x];
      else throw new Error("GEOMETRY_MATH_ORIENT_AXIS_INVALID");
    }
    const rotated: RecipeVec3 = [
      x + pivot[0], y + pivot[1], z + pivot[2],
    ];
    if (rotated.some(value => !Number.isFinite(value))) {
      throw new Error("GEOMETRY_MATH_ORIENT_COORDINATE_NONFINITE");
    }
    return rotated;
  };

  return boxes.map(box => {
    const corners: RecipeVec3[] = [];
    for (const x of [box.from[0], box.to[0]]) {
      for (const y of [box.from[1], box.to[1]]) {
        for (const z of [box.from[2], box.to[2]]) {
          corners.push(rotatePoint([x, y, z]));
        }
      }
    }
    const from = [0, 1, 2].map(i =>
      Math.min(...corners.map(point => point[i]!))
    ) as RecipeVec3;
    const to = [0, 1, 2].map(i =>
      Math.max(...corners.map(point => point[i]!))
    ) as RecipeVec3;
    if (from.some((value, i) =>
      !Number.isFinite(value) || !Number.isFinite(to[i]) ||
      to[i]! - value < 1
    )) {
      throw new Error("GEOMETRY_MATH_ORIENT_NATIVE_SPAN_INVALID");
    }
    // Preserve the source-local part identity; the enclosing INSTANCE
    // owns independent final prototype/instance IDs in the Recipe.
    return { id: box.id, from, to };
  });
}

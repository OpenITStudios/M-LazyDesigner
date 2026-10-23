import type {
  GridPattern, LinearPattern, RadialPattern, RecipeInstance, RecipePattern, RecipeVec3,
} from "@/lib/authoringRecipe/contracts";

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(label + " must be finite.");
  return value;
}

/** Technical expansion ceiling for one recipe, not an artistic Cube quota. */
export const AUTHORING_RECIPE_MAX_INSTANCES = 4_096;

function requireCount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > AUTHORING_RECIPE_MAX_INSTANCES) {
    throw new Error(label + " must be an integer between 1 and " +
      AUTHORING_RECIPE_MAX_INSTANCES + ".");
  }
  return value;
}

/** A cheap cardinality check shared by direct pattern callers and the compiler. */
export function countRecipePatternInstances(pattern: RecipePattern): number {
  if (!pattern.id || !pattern.prototype_id) {
    throw new Error("Recipe pattern requires non-empty id and prototype_id.");
  }
  if (pattern.kind === "LINEAR" || pattern.kind === "RADIAL") {
    return requireCount(pattern.count, "Pattern " + pattern.id + " count");
  }
  if (pattern.kind === "GRID") {
    const first = requireCount(pattern.counts[0], "Pattern " + pattern.id + " first count");
    const second = requireCount(pattern.counts[1], "Pattern " + pattern.id + " second count");
    const total = first * second;
    if (total > AUTHORING_RECIPE_MAX_INSTANCES) {
      throw new Error(
        "RECIPE_INSTANCE_BUDGET_EXCEEDED: grid pattern " + pattern.id +
        " expands to " + total + " Cubes; technical limit " +
        AUTHORING_RECIPE_MAX_INSTANCES + ". Reduce unnecessary repetition."
      );
    }
    return total;
  }
  throw new Error("Unsupported recipe pattern kind.");
}

function vec3(value: readonly number[] | undefined): RecipeVec3 {
  const source = value ?? [0, 0, 0];
  if (source.length !== 3 || source.some((entry) => !Number.isFinite(entry))) {
    throw new Error("Recipe pattern vector must contain three finite values.");
  }
  return [source[0], source[1], source[2]];
}

function axisVector(axis: "X" | "Y" | "Z"): RecipeVec3 {
  if (axis === "X") return [1, 0, 0];
  if (axis === "Y") return [0, 1, 0];
  return [0, 0, 1];
}

function addScaled(base: RecipeVec3, direction: RecipeVec3, scale: number): RecipeVec3 {
  return [
    base[0] + direction[0] * scale,
    base[1] + direction[1] * scale,
    base[2] + direction[2] * scale,
  ];
}

function expandLinear(pattern: LinearPattern): RecipeInstance[] {
  const count = countRecipePatternInstances(pattern);
  const spacing = requireFinite(pattern.spacing, "Pattern " + pattern.id + " spacing");
  const start = vec3(pattern.start);
  const direction = axisVector(pattern.axis);
  return Array.from({ length: count }, (_, index) => ({
    id: pattern.id + ":" + index,
    prototype_id: pattern.prototype_id,
    translation: addScaled(start, direction, spacing * index),
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    semantic_group: pattern.semantic_group,
  }));
}

function expandGrid(pattern: GridPattern): RecipeInstance[] {
  // Grid size is checked before the first allocation (e.g., 4096x4096).
  countRecipePatternInstances(pattern);
  const [firstCount, secondCount] = pattern.counts;
  if (pattern.axes[0] === pattern.axes[1]) throw new Error("Pattern " + pattern.id + " grid axes must be distinct.");
  const firstSpacing = requireFinite(pattern.spacing[0], "Pattern " + pattern.id + " first spacing");
  const secondSpacing = requireFinite(pattern.spacing[1], "Pattern " + pattern.id + " second spacing");
  const start = vec3(pattern.start);
  const firstAxis = axisVector(pattern.axes[0]);
  const secondAxis = axisVector(pattern.axes[1]);
  const result: RecipeInstance[] = [];
  for (let first = 0; first < firstCount; first += 1) {
    for (let second = 0; second < secondCount; second += 1) {
      const index = first * secondCount + second;
      const firstPosition = addScaled(start, firstAxis, firstSpacing * first);
      result.push({
        id: pattern.id + ":" + index,
        prototype_id: pattern.prototype_id,
        translation: addScaled(firstPosition, secondAxis, secondSpacing * second),
        rotation: [0, 0, 0], scale: [1, 1, 1], semantic_group: pattern.semantic_group,
      });
    }
  }
  return result;
}

function radialTranslation(axis: "X" | "Y" | "Z", radius: number, angle: number, center: RecipeVec3): RecipeVec3 {
  const cosine = Math.cos(angle) * radius;
  const sine = Math.sin(angle) * radius;
  if (axis === "X") return [center[0], center[1] + cosine, center[2] + sine];
  if (axis === "Y") return [center[0] + cosine, center[1], center[2] + sine];
  return [center[0] + cosine, center[1] + sine, center[2]];
}

function radialRotation(axis: "X" | "Y" | "Z", angleDegrees: number, rotate: boolean): RecipeVec3 {
  if (!rotate) return [0, 0, 0];
  if (axis === "X") return [angleDegrees, 0, 0];
  if (axis === "Y") return [0, angleDegrees, 0];
  return [0, 0, angleDegrees];
}

function expandRadial(pattern: RadialPattern): RecipeInstance[] {
  const count = countRecipePatternInstances(pattern);
  const radius = requireFinite(pattern.radius, "Pattern " + pattern.id + " radius");
  if (radius < 0) throw new Error("Pattern " + pattern.id + " radius must be non-negative.");
  const center = vec3(pattern.center);
  return Array.from({ length: count }, (_, index) => {
    const fraction = index / count;
    const angle = fraction * Math.PI * 2;
    const angleDegrees = fraction * 360;
    return {
      id: pattern.id + ":" + index,
      prototype_id: pattern.prototype_id,
      translation: radialTranslation(pattern.axis, radius, angle, center),
      rotation: radialRotation(pattern.axis, angleDegrees, pattern.rotate_with_pattern === true),
      scale: [1, 1, 1] as RecipeVec3,
      semantic_group: pattern.semantic_group,
    };
  });
}

export function expandRecipePattern(pattern: RecipePattern): RecipeInstance[] {
  if (pattern.kind === "LINEAR") return expandLinear(pattern);
  if (pattern.kind === "GRID") return expandGrid(pattern);
  if (pattern.kind === "RADIAL") return expandRadial(pattern);
  throw new Error("Unsupported recipe pattern kind.");
}

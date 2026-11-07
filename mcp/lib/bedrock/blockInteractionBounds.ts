import { createHash } from "node:crypto";
import type { WorldAabb } from "./projectSemantics";
import {
  planBedrockBlockVisual,
  type BlockVisualPlanningInput,
  type BlockVisualPlanningReview,
} from "./blockVisualPlanning";
import type { BedrockBlockVisualFeature } from "./blockVisualCompatibility";

/**
 * C1 block-local interaction preview only. Does not alter Resource/Behavior
 * Packs, inspect a live Blockbench scene, run Minecraft physics, or infer
 * rendered-world bounds from rotated/parented Geometry Cubes.
 *
 * Full-block default and origin/size coordinates use the documented Bedrock
 * bottom-center convention: X/Z [-8,8], Y [0,16] for selection; collision
 * can extend to Y=24 on sufficiently recent non-experimental formats.
 */
export type BlockInteractionBox = {
  origin: readonly [number, number, number];
  size: readonly [number, number, number];
};

export type BlockCollisionDeclaration =
  | boolean | BlockInteractionBox | readonly BlockInteractionBox[];
export type BlockSelectionDeclaration = boolean | BlockInteractionBox;
export type BlockInteractionPlanningInput = {
  visual: BlockVisualPlanningInput;
  /** undefined = component omitted; Bedrock default is full-block. */
  collision_box?: BlockCollisionDeclaration;
  /** undefined = component omitted; Bedrock default is full-block. */
  selection_box?: BlockSelectionDeclaration;
};

type BoxMode = "DEFAULT_FULL" | "FULL" | "DISABLED" | "CUSTOM" | "MULTI";
export type BlockInteractionArea = {
  mode: BoxMode;
  /** Explicit evaluated block-local AABBs, never live collision geometry. */
  boxes: WorldAabb[];
  envelope: WorldAabb | null;
  contains_zero_size_box: boolean;
};
export type BlockInteractionExtent =
  | "NO_INTERACTION_AREA"
  | "VISUAL_ENVELOPE_UNAVAILABLE"
  | "WITHIN_VISUAL_ENVELOPE"
  | "EXTENDS_BEYOND_VISUAL_ENVELOPE";
export type BlockInteractionReviewWarning =
  | "BLOCK_GEOMETRY_LOCAL_NOT_WORLD_ATTESTED"
  | "ROTATED_OR_INFLATED_GEOMETRY_NEEDS_NATIVE_BOUNDS"
  | "VISUAL_GEOMETRY_ENVELOPE_UNAVAILABLE"
  | "INTERACTION_ENVELOPES_DIFFER"
  | "COLLISION_EXTENDS_BEYOND_VISUAL_ENVELOPE"
  | "SELECTION_EXTENDS_BEYOND_VISUAL_ENVELOPE"
  | "INTERACTION_ZERO_THICKNESS_REVIEW"
  | "EXTENDED_COLLISION_HEIGHT_NATIVE_REVIEW"
  | "COLLISION_ARRAY_NATIVE_BEHAVIOR_UNVERIFIED"
  | "DEFAULT_COMPONENTS_ARE_NOT_AUTHORED_COMPONENTS"
  | "ROTATED_VISUAL_DOES_NOT_ROTATE_INTERACTION"
  | "GAMEPLAY_AND_RAYCAST_NOT_ATTESTED";

export type BlockInteractionPlanningResult = {
  state: "BLOCKED_BY_DECLARED_COMPATIBILITY" | "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED";
  project_uuid: string;
  block_identifier: string;
  source_fingerprint: string;
  /** Underlying F0/B1 source report, never a verified Minecraft source. */
  visual: BlockVisualPlanningReview;
  derived_version_features: BedrockBlockVisualFeature[];
  collision: BlockInteractionArea;
  selection: BlockInteractionArea;
  comparison: {
    source_visual_bounds: WorldAabb | null;
    visual_scope: "B1_DECLARED_CUBE_LOCAL_ENVELOPE";
    collision_extent: BlockInteractionExtent;
    selection_extent: BlockInteractionExtent;
    /** Bounding envelope difference only; not a proof of actual contact. */
    interaction_envelopes_differ: boolean;
  };
  warnings: BlockInteractionReviewWarning[];
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
  gameplay_verified: false;
  pack_written: false;
};

const FULL_BLOCK = { min: [-8, 0, -8] as [number, number, number],
  max: [8, 16, 8] as [number, number, number] };
const MAX_COLLISION_BOXES = 16;
const AXIS_MIN = [-8, 0, -8] as const;
const AXIS_MAX = [8, 16, 8] as const;
const COLLISION_Y_MAX = 24;
const normalize = (n: number) => Object.is(n, -0) ? 0 : n;

function vector(value: unknown, context: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 ||
      value.some(n => typeof n !== "number" || !Number.isFinite(n))) {
    throw new Error("BLOCK_INTERACTION_VECTOR_INVALID: " + context);
  }
  return [normalize(value[0]), normalize(value[1]), normalize(value[2])];
}

function checkedBox(value: unknown, kind: "COLLISION" | "SELECTION"): {
  bounds: WorldAabb; height_extended: boolean; zero_size: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !("origin" in value) || !("size" in value)) {
    throw new Error("BLOCK_INTERACTION_BOX_INVALID: " + kind);
  }
  const row = value as BlockInteractionBox;
  const origin = vector(row.origin, kind + ".origin");
  const size = vector(row.size, kind + ".size");
  if (size.some(s => s < 0)) {
    throw new Error("BLOCK_INTERACTION_BOX_NEGATIVE_SIZE: " + kind);
  }
  const max = origin.map((n, i) => normalize(n + size[i]!)) as [number, number, number];
  const yLimit = kind === "COLLISION" ? COLLISION_Y_MAX : AXIS_MAX[1];
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(max[i]) ||
        origin[i]! < AXIS_MIN[i]! ||
        origin[i]! > AXIS_MAX[i]! ||
        max[i]! > (i === 1 ? yLimit : AXIS_MAX[i]!) ||
        max[i]! < AXIS_MIN[i]!) {
      throw new Error("BLOCK_INTERACTION_BOX_OUTSIDE_BLOCK_RANGE: " + kind);
    }
  }
  return {
    bounds: { min: origin, max },
    height_extended: kind === "COLLISION" && max[1] > 16,
    zero_size: size.some(s => s === 0),
  };
}

function envelope(boxes: readonly WorldAabb[]): WorldAabb | null {
  if (!boxes.length) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, box.min[i]!);
      max[i] = Math.max(max[i]!, box.max[i]!);
    }
  }
  return { min, max };
}

function area(
  value: BlockCollisionDeclaration | BlockSelectionDeclaration | undefined,
  kind: "COLLISION" | "SELECTION"
): { report: BlockInteractionArea; extended_height: boolean; array: boolean } {
  if (value === undefined || value === true) {
    return {
      report: {
        mode: value === undefined ? "DEFAULT_FULL" : "FULL",
        boxes: [{ min: [...FULL_BLOCK.min], max: [...FULL_BLOCK.max] }],
        envelope: { min: [...FULL_BLOCK.min], max: [...FULL_BLOCK.max] },
        contains_zero_size_box: false,
      },
      extended_height: false, array: false,
    };
  }
  if (value === false) {
    return { report: { mode: "DISABLED", boxes: [],
      envelope: null, contains_zero_size_box: false },
      extended_height: false, array: false };
  }
  const multiple = Array.isArray(value);
  if (multiple && kind === "SELECTION") {
    throw new Error("BLOCK_INTERACTION_SELECTION_ARRAY_UNSUPPORTED");
  }
  if (multiple && (!value.length || value.length > MAX_COLLISION_BOXES)) {
    // An empty array has a surprising default-full effect on some engines;
    // do not silently interpret it as empty collision/disabled collision.
    throw new Error("BLOCK_INTERACTION_COLLISION_ARRAY_BUDGET_OR_EMPTY");
  }
  const rawBoxes = multiple ? value as readonly BlockInteractionBox[]
    : [value as BlockInteractionBox];
  const checked = rawBoxes.map(v => checkedBox(v, kind));
  const boxes = checked.map(row => row.bounds);
  return {
    report: {
      mode: multiple ? "MULTI" : "CUSTOM",
      boxes,
      envelope: envelope(boxes),
      contains_zero_size_box: checked.some(row => row.zero_size),
    },
    extended_height: checked.some(row => row.height_extended),
    array: multiple,
  };
}

function extent(
  area: BlockInteractionArea, visual: WorldAabb | null
): BlockInteractionExtent {
  if (!area.boxes.length) return "NO_INTERACTION_AREA";
  if (!visual) return "VISUAL_ENVELOPE_UNAVAILABLE";
  const outside = area.boxes.some(box =>
    box.min.some((v, axis) => v < visual.min[axis]!) ||
    box.max.some((v, axis) => v > visual.max[axis]!)
  );
  return outside ? "EXTENDS_BEYOND_VISUAL_ENVELOPE"
    : "WITHIN_VISUAL_ENVELOPE";
}

/**
 * Only compares DECLARED block-local AABB envelopes. The existing B1 source
 * planner owns Geometry identity, Cube inventory and material validation;
 * the existing F0 source gate owns all Bedrock format-version thresholds.
 */
export function reviewBedrockBlockInteractionBounds(
  input: BlockInteractionPlanningInput
): BlockInteractionPlanningResult {
  if (!input || typeof input !== "object" ||
      !input.visual || typeof input.visual !== "object") {
    throw new Error("BLOCK_INTERACTION_INPUT_INVALID");
  }
  const collision = area(input.collision_box, "COLLISION");
  const selection = area(input.selection_box, "SELECTION");
  const features = new Set<BedrockBlockVisualFeature>(
    input.visual.compatibility?.features ?? []
  );
  if (input.collision_box !== undefined) features.add("collision_box");
  if (input.selection_box !== undefined) features.add("selection_box");
  if (collision.array) features.add("multi_collision_boxes");
  if (collision.extended_height) features.add("extended_collision_height");
  const derived_version_features = [...features].sort();
  // Derive the component's actual feature needs before F0, without mutating
  // caller input or introducing a competing Bedrock version registry.
  const visual = planBedrockBlockVisual({
    ...input.visual,
    compatibility: {
      ...input.visual.compatibility,
      features: derived_version_features,
    },
  });
  const geometryBounds = visual.geometry_summary.local_bounds;
  const local = geometryBounds
    ? { min: [...geometryBounds.min] as [number,number,number],
        max: [...geometryBounds.max] as [number,number,number] } : null;
  const collisionExtent = extent(collision.report, local);
  const selectionExtent = extent(selection.report, local);
  const different = JSON.stringify(collision.report.envelope) !==
    JSON.stringify(selection.report.envelope);
  const warnings = new Set<BlockInteractionReviewWarning>([
    "BLOCK_GEOMETRY_LOCAL_NOT_WORLD_ATTESTED",
    "GAMEPLAY_AND_RAYCAST_NOT_ATTESTED",
  ]);
  if (input.collision_box === undefined || input.selection_box === undefined) {
    warnings.add("DEFAULT_COMPONENTS_ARE_NOT_AUTHORED_COMPONENTS");
  }
  if (visual.warnings.includes("ROTATED_OR_INFLATED_BOUNDS_NOT_WORLD_ATTESTED")) {
    warnings.add("ROTATED_OR_INFLATED_GEOMETRY_NEEDS_NATIVE_BOUNDS");
  }
  if (local === null) warnings.add("VISUAL_GEOMETRY_ENVELOPE_UNAVAILABLE");
  if (different) warnings.add("INTERACTION_ENVELOPES_DIFFER");
  if (collisionExtent === "EXTENDS_BEYOND_VISUAL_ENVELOPE") {
    warnings.add("COLLISION_EXTENDS_BEYOND_VISUAL_ENVELOPE");
  }
  if (selectionExtent === "EXTENDS_BEYOND_VISUAL_ENVELOPE") {
    warnings.add("SELECTION_EXTENDS_BEYOND_VISUAL_ENVELOPE");
  }
  if (collision.report.contains_zero_size_box ||
      selection.report.contains_zero_size_box) {
    warnings.add("INTERACTION_ZERO_THICKNESS_REVIEW");
  }
  if (collision.extended_height) {
    warnings.add("EXTENDED_COLLISION_HEIGHT_NATIVE_REVIEW");
  }
  if (collision.array) warnings.add("COLLISION_ARRAY_NATIVE_BEHAVIOR_UNVERIFIED");
  if (features.has("n_way_visual_rotation")) {
    warnings.add("ROTATED_VISUAL_DOES_NOT_ROTATE_INTERACTION");
  }

  const source_fingerprint = "sha256:" + createHash("sha256")
    .update(JSON.stringify({
      contract: "bedrock-block-interaction-c1-source-v1",
      visual_source_fingerprint: visual.source_fingerprint,
      collision: collision.report, selection: selection.report,
      derived_version_features,
    })).digest("hex");
  return {
    state: visual.state === "BLOCKED_BY_DECLARED_COMPATIBILITY"
      ? "BLOCKED_BY_DECLARED_COMPATIBILITY"
      : "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED",
    project_uuid: visual.project_uuid,
    block_identifier: visual.block_identifier,
    source_fingerprint, visual, derived_version_features,
    collision: collision.report, selection: selection.report,
    comparison: {
      source_visual_bounds: local,
      visual_scope: "B1_DECLARED_CUBE_LOCAL_ENVELOPE",
      collision_extent: collisionExtent,
      selection_extent: selectionExtent,
      interaction_envelopes_differ: different,
    },
    warnings: [...warnings],
    native_verified: false,
    visual_verified: false,
    minecraft_verified: false,
    gameplay_verified: false,
    pack_written: false,
  };
}

import type {
  UvLayoutPlan,
  UvRect,
} from "@/lib/uv/contracts";
import { samePackingShape, stackBlockers } from "@/lib/uv/stacking";

function intersects(a: UvRect, b: UvRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function sameRect(a: UvRect, b: UvRect): boolean {
  return a.x === b.x && a.y === b.y &&
    a.width === b.width && a.height === b.height;
}

export type UvPlanValidation = {
  valid: boolean;
  errors: string[];
};

export function validateUvLayoutPlan(
  plan: UvLayoutPlan
): UvPlanValidation {
  const errors: string[] = [];

  if (plan.schema !== 1) errors.push("UNSUPPORTED_PLAN_SCHEMA");
  if (plan.planner_version !== 1) {
    errors.push("UNSUPPORTED_PLANNER_VERSION");
  }
  if (plan.backend !== "maxrects_v1") {
    errors.push("UNSUPPORTED_PACKING_BACKEND");
  }
  if (plan.backend_version !== 1) {
    errors.push("UNSUPPORTED_BACKEND_VERSION");
  }
  if (!plan.score.valid || plan.score.hard_violations.length > 0) {
    errors.push("PACKING_SCORE_INVALID");
  }
  if (plan.before.logical_width !== plan.proposed.logical_width ||
      plan.before.logical_height !== plan.proposed.logical_height) {
    errors.push("LOGICAL_CANVAS_CHANGED");
  }
  const movedIds = new Set(plan.moved_island_ids);
  if (movedIds.size !== plan.moved_island_ids.length) {
    errors.push("DUPLICATE_MOVED_ISLAND_ID");
  }
  const fixedIds = new Set(plan.fixed_island_ids);
  if (fixedIds.size !== plan.fixed_island_ids.length) {
    errors.push("DUPLICATE_FIXED_ISLAND_ID");
  }

  const beforeById = new Map(
    plan.before.islands.map((island) => [island.id, island])
  );
  const proposedById = new Map(
    plan.proposed.islands.map((island) => [island.id, island])
  );
  if (beforeById.size !== plan.before.islands.length) {
    errors.push("DUPLICATE_BEFORE_ISLAND_ID");
  }
  if (proposedById.size !== plan.proposed.islands.length) {
    errors.push("DUPLICATE_PROPOSED_ISLAND_ID");
  }
  if (beforeById.size !== proposedById.size) {
    errors.push("ISLAND_COUNT_CHANGED");
  }

  for (const [id, before] of beforeById) {
    const proposed = proposedById.get(id);
    if (!proposed) {
      errors.push(`MISSING_PROPOSED_ISLAND:${id}`);
      continue;
    }
    if (
      proposed.source.cube_uuid !== before.source.cube_uuid ||
      proposed.source.box_uv !== before.source.box_uv ||
      JSON.stringify(proposed.source.faces) !==
        JSON.stringify(before.source.faces)
    ) {
      errors.push(`ISLAND_IDENTITY_CHANGED:${id}`);
    }
    if (
      !Number.isFinite(proposed.rect.x) ||
      !Number.isFinite(proposed.rect.y) ||
      !Number.isFinite(proposed.rect.width) ||
      !Number.isFinite(proposed.rect.height) ||
      proposed.rect.width <= 0 ||
      proposed.rect.height <= 0
    ) {
      errors.push(`INVALID_RECT:${id}`);
      continue;
    }
    if (
      proposed.rect.x < 0 ||
      proposed.rect.y < 0 ||
      proposed.rect.x + proposed.rect.width >
        plan.proposed.logical_width ||
      proposed.rect.y + proposed.rect.height >
        plan.proposed.logical_height
    ) {
      errors.push(`OUT_OF_BOUNDS:${id}`);
    }
  }

  for (const id of plan.fixed_island_ids) {
    const before = beforeById.get(id);
    const proposed = proposedById.get(id);
    if (!before || !proposed) {
      errors.push(`MISSING_FIXED_ISLAND:${id}`);
      continue;
    }
    if (!sameRect(before.rect, proposed.rect)) {
      errors.push(`FIXED_ISLAND_MOVED:${id}`);
    }
  }

  const transforms = new Map(
    plan.placement_transforms.map((entry) => [
      entry.island_id,
      entry,
    ])
  );
  if (transforms.size !== plan.placement_transforms.length) {
    errors.push("DUPLICATE_PLACEMENT_TRANSFORM");
  }
  // Do not trust a plan's self-reported moved/fixed lists. The proposed
  // snapshot must be fully covered by native mutation instructions.
  for (const [id, before] of beforeById) {
    const after = proposedById.get(id);
    if (!after) continue;
    const rectChanged = !sameRect(before.rect, after.rect);
    const rotated = transforms.get(id)?.rotated_90 === true;
    if (before.constraints.locked && (rectChanged || rotated)) {
      errors.push(`LOCKED_ISLAND_MOVED:${id}`);
    }
    if (rectChanged && !movedIds.has(id)) {
      errors.push(`UNDECLARED_MOVEMENT:${id}`);
    }
    if (rotated && !movedIds.has(id)) {
      errors.push(`UNDECLARED_ROTATION:${id}`);
    }
    if (!rectChanged && !rotated && movedIds.has(id)) {
      errors.push(`FALSE_MOVEMENT_DECLARATION:${id}`);
    }
  }
  for (const id of plan.moved_island_ids) {
    const before = beforeById.get(id);
    if (!before) {
      errors.push(`UNKNOWN_MOVED_ISLAND:${id}`);
      continue;
    }
    const transform = transforms.get(id);
    if (!transform) {
      errors.push(`MISSING_PLACEMENT_TRANSFORM:${id}`);
      continue;
    }
    if (transform.rotated_90) {
      if (
        before.source.box_uv ||
        !before.constraints.rotation.allowed ||
        before.constraints.rotation.step !== 90
      ) {
        errors.push(`UNREPRESENTABLE_ROTATION:${id}`);
      }
    }
  }

  const proposed = plan.proposed.islands;
  for (let i = 0; i < proposed.length; i += 1) {
    for (let j = i + 1; j < proposed.length; j += 1) {
      if (!intersects(proposed[i].rect, proposed[j].rect)) continue;
      // Exact reuse remains possible only when both islands intentionally share
      // one explicit stack_group. Otherwise overlap is unsafe at apply time.
      const exactReuse = sameRect(proposed[i].rect, proposed[j].rect);
      const sharedGroup =
        proposed[i].constraints.stack_group &&
        proposed[i].constraints.stack_group ===
          proposed[j].constraints.stack_group;
      if (!(exactReuse && sharedGroup)) {
        errors.push(
          `UNDECLARED_OVERLAP:${proposed[i].id}:${proposed[j].id}`
        );
        continue;
      }
      // An explicit stack_group authorizes an overlap only when both
      // islands pass the same shape/uniqueness/mirroring checks used by
      // discoverUvStackProposals. A score.valid packing flag is insufficient.
      const blockers = [
        ...stackBlockers(proposed[i]),
        ...stackBlockers(proposed[j]),
      ];
      if (!samePackingShape(proposed[i], proposed[j])) {
        blockers.push("INCOMPATIBLE_SHAPE");
      }
      if (blockers.length > 0) {
        errors.push(
          `UNSAFE_SHARED_UV:${proposed[i].id}:${proposed[j].id}:${blockers.join("|")}`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function requireValidUvLayoutPlan(
  plan: UvLayoutPlan
): void {
  const validation = validateUvLayoutPlan(plan);
  if (!validation.valid) {
    throw new Error(
      `UV_LAYOUT_PLAN_INVALID: ${validation.errors.join(", ")}`
    );
  }
}

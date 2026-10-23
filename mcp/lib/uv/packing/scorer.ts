import type { UvPackingScore } from "@/lib/uv/contracts";
import type {
  UvPackingCandidate,
  UvPackingItem,
  UvPackingRect,
} from "@/lib/uv/packing/types";

function intersects(a: UvPackingRect, b: UvPackingRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function scoreUvPacking(
  candidate: UvPackingCandidate,
  items: readonly UvPackingItem[],
  occupied: readonly UvPackingRect[] = []
): UvPackingScore {
  const violations: string[] = [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const canvasArea =
    candidate.canvas.width * candidate.canvas.height;

  for (let i = 0; i < candidate.placements.length; i += 1) {
    const current = candidate.placements[i];
    if (
      current.footprint.x < 0 ||
      current.footprint.y < 0 ||
      current.footprint.x + current.footprint.width >
        candidate.canvas.width ||
      current.footprint.y + current.footprint.height >
        candidate.canvas.height
    ) {
      violations.push(`OUT_OF_BOUNDS:${current.id}`);
    }
    for (let j = i + 1; j < candidate.placements.length; j += 1) {
      if (
        intersects(
          current.footprint,
          candidate.placements[j].footprint
        )
      ) {
        violations.push(
          `OVERLAP:${current.id}:${candidate.placements[j].id}`
        );
      }
    }
    for (const fixed of occupied) {
      if (intersects(current.footprint, fixed)) {
        violations.push(`LOCKED_OVERLAP:${current.id}`);
      }
    }
  }

  const packedArea = candidate.placements.reduce(
    (sum, placement) =>
      sum + placement.footprint.width * placement.footprint.height,
    0
  );
  const occupiedArea = occupied.reduce(
    (sum, rect) => sum + rect.width * rect.height,
    0
  );

  let movementCost = 0;
  for (const placement of candidate.placements) {
    const original = itemById.get(placement.id)?.original_rect;
    if (!original) continue;
    movementCost +=
      Math.abs(placement.rect.x - original.x) +
      Math.abs(placement.rect.y - original.y) +
      Math.abs(placement.rect.width - original.width) +
      Math.abs(placement.rect.height - original.height);
  }

  // Score actual editable atlas locality, not aesthetic fidelity.
  // This is only compared across plans with identical authored islands.
  const groupCenters = new Map<string, Array<[number, number]>>();
  for (const placement of candidate.placements) {
    const group = itemById.get(placement.id)?.semantic_group?.trim();
    if (!group) continue;
    const centers = groupCenters.get(group) ?? [];
    centers.push([
      placement.rect.x + placement.rect.width / 2,
      placement.rect.y + placement.rect.height / 2,
    ]);
    groupCenters.set(group, centers);
  }
  let spread = 0;
  let comparedGroups = 0;
  for (const centers of groupCenters.values()) {
    if (centers.length < 2) continue;
    comparedGroups += 1;
    const x = centers.reduce((sum, center) => sum + center[0], 0) / centers.length;
    const y = centers.reduce((sum, center) => sum + center[1], 0) / centers.length;
    spread += centers.reduce((sum, center) =>
      sum + Math.abs(center[0] - x) / candidate.canvas.width +
        Math.abs(center[1] - y) / candidate.canvas.height, 0);
  }

  return {
    valid: violations.length === 0,
    hard_violations: violations,
    occupancy_ratio:
      canvasArea <= 0 ? 0 : (packedArea + occupiedArea) / canvasArea,
    density_error: null,
    movement_cost: movementCost,
    fragmentation: candidate.free_rectangles.length,
    semantic_spread: comparedGroups ? Number(spread.toFixed(6)) : null,
  };
}

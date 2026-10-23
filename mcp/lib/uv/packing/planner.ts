import type {
  UvLayoutPlan,
  UvLayoutSnapshot,
  UvPackingMode,
  UvRect,
} from "@/lib/uv/contracts";
import { physicalPixelsPerUvUnit } from "@/lib/uv/density";
import { packMaxRects } from "@/lib/uv/packing/maxRects";
import { scoreUvPacking } from "@/lib/uv/packing/scorer";
import { samePackingShape, stackBlockers } from "@/lib/uv/stacking";
import type {
  UvPackingItem,
  UvPackingRect,
} from "@/lib/uv/packing/types";

function toPackingRect(rect: UvRect): UvPackingRect {
  return { ...rect };
}

function measureProposedMetrics(
  snapshot: UvLayoutSnapshot,
  rects: ReadonlyMap<string, UvRect>
) {
  const islands = snapshot.islands.map((island) => ({
    ...island,
    rect: { ...(rects.get(island.id) ?? island.rect) },
  }));
  let occupiedBounds: UvRect | null = null;
  if (islands.length > 0) {
    const left = Math.min(...islands.map((island) => island.rect.x));
    const top = Math.min(...islands.map((island) => island.rect.y));
    const right = Math.max(
      ...islands.map((island) => island.rect.x + island.rect.width)
    );
    const bottom = Math.max(
      ...islands.map((island) => island.rect.y + island.rect.height)
    );
    occupiedBounds = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }
  return {
    islands,
    metrics: {
      island_count: islands.length,
      face_count: islands.reduce(
        (sum, island) => sum + island.source.faces.length,
        0
      ),
      physical_area: islands.reduce(
        (sum, island) => sum + island.physical.area,
        0
      ),
      uv_area: islands.reduce(
        (sum, island) =>
          sum + island.rect.width * island.rect.height,
        0
      ),
      occupied_bounds: occupiedBounds,
    },
  };
}

function resolveMovableIds(
  snapshot: UvLayoutSnapshot,
  mode: UvPackingMode,
  explicitIds: readonly string[]
): Set<string> {
  const known = new Set(snapshot.islands.map((island) => island.id));
  for (const id of explicitIds) {
    if (!known.has(id)) {
      throw new Error(`UV packing target island "${id}" was not found.`);
    }
  }

  if (mode === "REPACK_ALL") {
    return new Set(
      snapshot.islands
        .filter((island) => !island.constraints.locked)
        .map((island) => island.id)
    );
  }

  if (explicitIds.length === 0) {
    throw new Error(
      `${mode} requires at least one explicit island ID.`
    );
  }

  const requested = new Set(explicitIds);
  return new Set(
    snapshot.islands
      .filter(
        (island) =>
          requested.has(island.id) &&
          !island.constraints.locked
      )
      .map((island) => island.id)
  );
}

export function planUvPacking(
  snapshot: UvLayoutSnapshot,
  options: {
    bitmap_width: number;
    bitmap_height: number;
    mode?: UvPackingMode;
    island_ids?: readonly string[];
    size_overrides?: Readonly<
      Record<string, readonly [number, number]>
    >;
  }
): UvLayoutPlan {
  const pixelScale = physicalPixelsPerUvUnit(
    snapshot.logical_width,
    snapshot.logical_height,
    options.bitmap_width,
    options.bitmap_height
  );

  const mode = options.mode ?? "REPACK_ALL";
  const explicitIds = options.island_ids ?? [];
  const movableIds = resolveMovableIds(
    snapshot,
    mode,
    explicitIds
  );
  const movable = snapshot.islands.filter((island) =>
    movableIds.has(island.id)
  );
  const fixed = snapshot.islands.filter(
    (island) => !movableIds.has(island.id)
  );

  // Existing explicitly shared texels form one semantic editing unit.
  // Moving only one face would silently sever that reuse relationship.
  // A locked face also locks its shared cohort, not unrelated islands.
  const sharedByRegion = new Map<string, typeof snapshot.islands>();
  for (const island of snapshot.islands) {
    const group = island.constraints.stack_group;
    if (!group || stackBlockers(island).length > 0) continue;
    const key = JSON.stringify([group, island.rect]);
    const members = sharedByRegion.get(key) ?? [];
    members.push(island);
    sharedByRegion.set(key, members);
  }
  for (const members of sharedByRegion.values()) {
    if (members.length < 2 ||
        !members.slice(1).every((island) => samePackingShape(members[0], island))) {
      continue;
    }
    const moving = members.filter((island) => movableIds.has(island.id));
    if (moving.length > 0 && moving.length !== members.length) {
      throw new Error(
        "UV_SHARED_STACK_SCOPE_INCOMPLETE: selected repack would split explicitly " +
        "shared texels. Select the entire compatible stack or leave it fixed: " +
        members.map((island) => island.id).sort().join(", ")
      );
    }
  }

  const occupiedMap = new Map<string, UvPackingRect>();
  for (const island of fixed) {
    const rect = toPackingRect(island.rect);
    const key = [
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    ].join(":");
    if (!occupiedMap.has(key)) {
      occupiedMap.set(key, rect);
    }
  }
  const occupied = [...occupiedMap.values()];

  // Existing, *explicit* stacked islands already read the same texels.
  // Preserve one atlas allocation when their full movable cohort agrees.
  // Matching dimensions alone never create new shared UV ownership.
  const owners = new Map<string, {
    island: UvLayoutSnapshot["islands"][number];
    item: UvPackingItem;
  }>();
  const knownBySignature = new Map<string, string>();
  const ownerByIsland = new Map<string, string>();
  for (const island of [...movable].sort((a, b) => a.id.localeCompare(b.id))) {
    const override = options.size_overrides?.[island.id];
    const width = override?.[0] ?? island.rect.width;
    const height = override?.[1] ?? island.rect.height;
    const paddingPixels = island.constraints.padding_pixels;
    const item: UvPackingItem = {
      id: island.id,
      width,
      height,
      padding_x: paddingPixels / pixelScale[0],
      padding_y: paddingPixels / pixelScale[1],
      allow_rotate_90:
        !island.source.box_uv &&
        island.constraints.rotation.allowed &&
        island.constraints.rotation.step === 90,
      priority: island.constraints.priority,
      semantic_group: island.constraints.semantic_group?.trim() || undefined,
      original_rect: { ...island.rect },
    };
    const group = island.constraints.stack_group;
    const eligible = Boolean(group) && stackBlockers(island).length === 0;
    const signature = eligible ? JSON.stringify([
      group, island.rect, island.source.box_uv,
      island.source.faces.length, island.physical.density_basis,
      width, height, paddingPixels, item.allow_rotate_90, item.priority,
    ]) : null;
    const existing = signature ? knownBySignature.get(signature) : undefined;
    const owner = existing ? owners.get(existing) : undefined;
    if (owner && samePackingShape(owner.island, island)) {
      ownerByIsland.set(island.id, existing!);
      continue;
    }
    owners.set(island.id, { island, item });
    ownerByIsland.set(island.id, island.id);
    if (signature) knownBySignature.set(signature, island.id);
  }
  const items = [...owners.values()].map((entry) => entry.item);

  let candidate = packMaxRects(
    items, snapshot.logical_width, snapshot.logical_height, occupied
  );
  let score = scoreUvPacking(candidate, items, occupied);

  // Only a full repack with explicitly named cohorts can justify a second
  // candidate. Prefer it iff it actually lowers editability spread; otherwise
  // retain the exact proven area-first result. Never sacrifice fit or safety.
  const groups = new Map<string, number>();
  for (const item of items) {
    if (item.semantic_group) {
      groups.set(item.semantic_group, (groups.get(item.semantic_group) ?? 0) + 1);
    }
  }
  if (mode === "REPACK_ALL" && groups.size > 1 &&
      [...groups.values()].some((count) => count > 1)) {
    try {
      const cohortCandidate = packMaxRects(
        items, snapshot.logical_width, snapshot.logical_height,
        occupied, { ordering: "semantic" }
      );
      const cohortScore = scoreUvPacking(cohortCandidate, items, occupied);
      if (cohortScore.valid && cohortScore.semantic_spread !== null &&
          (score.semantic_spread === null ||
            cohortScore.semantic_spread < score.semantic_spread)) {
        candidate = cohortCandidate;
        score = cohortScore;
      }
    } catch (error) {
      // A locality-based order can fail in a tight atlas even when area-first
      // fits. Preserve the valid original instead of failing production.
      if (!(error instanceof Error) ||
          !error.message.startsWith("MaxRects could not fit UV island")) {
        throw error;
      }
    }
  }
  const representativePlacements = new Map(
    candidate.placements.map((placement) => [placement.id, placement])
  );
  const placementById = new Map(
    movable.map((island) => [
      island.id,
      representativePlacements.get(ownerByIsland.get(island.id) ?? island.id),
    ])
  );
  // The native apply contract still requires instructions for every face.
  const proposedRectById = new Map(
    [...placementById]
      .filter((entry) => entry[1] !== undefined)
      .map(([id, placement]) => [id, placement!.rect])
  );
  const proposed = measureProposedMetrics(
    snapshot,
    proposedRectById
  );

  const movedIslandIds = movable
    .filter((island) => {
      const placement = placementById.get(island.id);
      if (!placement) return false;
      return (
        placement.rect.x !== island.rect.x ||
        placement.rect.y !== island.rect.y ||
        placement.rect.width !== island.rect.width ||
        placement.rect.height !== island.rect.height ||
        placement.rotated_90
      );
    })
    .map((island) => island.id);

  return {
    schema: 1,
    planner_version: snapshot.planner_version,
    backend: "maxrects_v1",
    backend_version: 1,
    mode,
    before: snapshot,
    proposed: {
      ...snapshot,
      islands: proposed.islands,
      metrics: proposed.metrics,
    },
    score,
    moved_island_ids: movedIslandIds,
    fixed_island_ids: fixed.map((island) => island.id),
    placement_transforms: movable.map((island) => ({
      island_id: island.id,
      rotated_90: placementById.get(island.id)?.rotated_90 ?? false,
    })),
  };
}

import { packAtlasRects, type AtlasPlacement, type ReservedAtlasRect } from "@/lib/uv/maxRectsPlanner";

export type SemanticUvIdentityPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type SemanticUvReusePolicy = "ALLOW_REUSE" | "UNIQUE" | "REQUIRE_REUSE";

export type SemanticUvIsland = {
  id: string;
  world_size: readonly [number, number];
  cohort: string;
  texel_density?: number;
  allow_rotation?: boolean;
  identity_priority?: SemanticUvIdentityPriority;
  reuse_policy?: SemanticUvReusePolicy;
  share_with?: string;
  locked?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotated?: boolean;
  };
};

export type SemanticUvPlanOptions = {
  atlas_width: number;
  atlas_height: number;
  default_texel_density: number;
  padding?: number;
  allow_rotation?: boolean;
  cohort_texel_density?: Readonly<Record<string, number>>;
  previous_placements?: readonly AtlasPlacement[];
  affected_ids?: readonly string[];
};

export type SemanticUvPlacement = AtlasPlacement & {
  source_id: string;
  shared_with?: string;
  locked: boolean;
};

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(label + " must be finite and positive.");
  return value;
}

function pixelExtent(world: number, density: number): number {
  return Math.max(1, Math.ceil(positive(world, "UV world extent") * positive(density, "UV texel density")));
}

function identityPriority(value: SemanticUvIdentityPriority | undefined): number {
  if (value === "CRITICAL") return 3;
  if (value === "HIGH") return 2;
  if (value === "NORMAL") return 1;
  return 0;
}

function validateShareGraph(islands: readonly SemanticUvIsland[]): Map<string, SemanticUvIsland> {
  const byId = new Map<string, SemanticUvIsland>();
  for (const island of islands) {
    if (!island.id || byId.has(island.id)) throw new Error("Semantic UV island IDs must be non-empty and unique.");
    if (!island.cohort) throw new Error("Semantic UV island " + island.id + " requires a cohort.");
    byId.set(island.id, island);
  }
  for (const island of islands) {
    const reusePolicy = island.reuse_policy ?? "ALLOW_REUSE";
    if (reusePolicy === "UNIQUE" && island.share_with) {
      throw new Error(
        "Semantic UV island " + island.id +
          " is identity-unique and cannot share another UV region."
      );
    }
    if (reusePolicy === "REQUIRE_REUSE" && !island.share_with) {
      throw new Error(
        "Semantic UV island " + island.id +
          " requires an explicit share_with owner."
      );
    }
    if (!island.share_with) continue;
    const source = byId.get(island.share_with);
    if (!source) throw new Error("Semantic UV island " + island.id + " shares with missing island " + island.share_with + ".");
    if (source.share_with) throw new Error("Semantic UV sharing must point directly at an owning island, not another alias.");
    if (source.reuse_policy === "UNIQUE") {
      throw new Error(
        "Semantic UV island " + island.id + " cannot share identity-unique source " +
          source.id + ". A UNIQUE owner may not be aliased by other islands."
      );
    }
    if (island.locked) throw new Error("Shared semantic UV island " + island.id + " cannot also own a locked region.");
  }
  return byId;
}

function placementMap(values: readonly AtlasPlacement[] | undefined): Map<string, AtlasPlacement> {
  const map = new Map<string, AtlasPlacement>();
  for (const placement of values ?? []) {
    if (!placement.id || map.has(placement.id)) {
      throw new Error("Previous UV placements require unique non-empty IDs.");
    }
    map.set(placement.id, placement);
  }
  return map;
}

function resolvedDensity(island: SemanticUvIsland, options: SemanticUvPlanOptions): number {
  return island.texel_density ??
    options.cohort_texel_density?.[island.cohort] ??
    options.default_texel_density;
}

function islandPixelSize(
  island: SemanticUvIsland,
  options: SemanticUvPlanOptions
): [number, number] {
  const density = resolvedDensity(island, options);
  return [
    pixelExtent(island.world_size[0], density),
    pixelExtent(island.world_size[1], density),
  ];
}

function retainedReservation(
  placement: AtlasPlacement,
  padding: number,
  atlasWidth: number,
  atlasHeight: number
): ReservedAtlasRect {
  // Padding can be clipped at an atlas edge, but the original retained
  // placement cannot. Never conceal stale/out-of-bounds UVs by clipping them.
  if (![placement.x, placement.y, placement.width, placement.height].every(Number.isSafeInteger) ||
      placement.x < 0 || placement.y < 0 ||
      placement.width <= 0 || placement.height <= 0) {
    throw new Error("RETAINED_UV_INVALID_GEOMETRY: " + placement.id + " has invalid pixel coordinates or dimensions.");
  }
  if (placement.x + placement.width > atlasWidth ||
      placement.y + placement.height > atlasHeight) {
    throw new Error("RETAINED_UV_OUT_OF_BOUNDS: " + placement.id + " extends beyond the requested atlas.");
  }
  const left = Math.max(0, placement.x - padding);
  const top = Math.max(0, placement.y - padding);
  const right = Math.min(atlasWidth, placement.x + placement.width + padding);
  const bottom = Math.min(atlasHeight, placement.y + placement.height + padding);
  return {
    id: placement.id,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function planSemanticUv(islands: readonly SemanticUvIsland[], options: SemanticUvPlanOptions) {
  const byId = validateShareGraph(islands);
  const previous = placementMap(options.previous_placements);
  const affected = options.affected_ids ? new Set(options.affected_ids) : null;
  const padding = options.padding ?? 0;
  if (!Number.isInteger(padding) || padding < 0) throw new Error("Semantic UV padding must be a non-negative integer.");
  if (affected) for (const id of affected) if (!byId.has(id)) throw new Error("Affected UV island does not exist: " + id + ".");

  for (const island of islands) {
    if (!island.share_with) continue;
    const source = byId.get(island.share_with)!;
    const sourceSize = islandPixelSize(source, options);
    const targetSize = islandPixelSize(island, options);
    if (sourceSize[0] !== targetSize[0] || sourceSize[1] !== targetSize[1]) {
      throw new Error(
        "Shared UV islands must resolve to identical pixel extents: " +
          island.id +
          " cannot share " +
          source.id +
          "."
      );
    }
  }

  const reserved: ReservedAtlasRect[] = [];
  const lockedPlacementById = new Map<string, AtlasPlacement>();

  for (const island of islands) {
    if (island.share_with) continue;
    if (island.locked) {
      const locked: AtlasPlacement = {
        id: island.id,
        x: island.locked.x,
        y: island.locked.y,
        width: island.locked.width,
        height: island.locked.height,
        rotated: island.locked.rotated ?? false,
        cohort: island.cohort,
      };
      reserved.push({ id: island.id, x: locked.x, y: locked.y, width: locked.width, height: locked.height });
      lockedPlacementById.set(island.id, locked);
      continue;
    }
    if (affected && !affected.has(island.id)) {
      const retained = previous.get(island.id);
      if (!retained) throw new Error("Affected-only UV planning requires a previous placement for unchanged island " + island.id + ".");
      const [width, height] = islandPixelSize(island, options);
      const expectedWidth = retained.rotated ? height : width;
      const expectedHeight = retained.rotated ? width : height;
      // An unchanged island must remain compatible with its new requested
      // density, dimensions and orientation policy. Otherwise callers must
      // explicitly include that island in the affected set and replan it.
      if (retained.width !== expectedWidth || retained.height !== expectedHeight ||
          (retained.cohort !== undefined && retained.cohort !== island.cohort) ||
          (retained.rotated && island.allow_rotation === false)) {
        throw new Error("RETAINED_UV_SOURCE_DRIFT: " + island.id +
          " changed size, cohort or rotation constraints; include it in affected_ids.");
      }
      reserved.push(retainedReservation(retained, padding, options.atlas_width, options.atlas_height));
      lockedPlacementById.set(island.id, retained);
    }
  }

  const inputs = islands
    .filter(
      (island) =>
        !island.share_with && !lockedPlacementById.has(island.id)
    )
    .slice()
    .sort(
      (left, right) =>
        identityPriority(right.identity_priority) -
          identityPriority(left.identity_priority) ||
        left.id.localeCompare(right.id)
    )
    .map((island) => {
      const size = islandPixelSize(island, options);
      return {
        id: island.id,
        width: size[0],
        height: size[1],
        allow_rotation: island.allow_rotation,
        cohort: island.cohort,
      };
    });

  const packed = packAtlasRects(inputs, {
    width: options.atlas_width,
    height: options.atlas_height,
    padding,
    allow_rotation: options.allow_rotation,
    reserved_rects: reserved,
  });

  const ownerPlacement = new Map<string, AtlasPlacement>();
  for (const placement of lockedPlacementById.values()) ownerPlacement.set(placement.id, placement);
  for (const placement of packed.placements) ownerPlacement.set(placement.id, placement);

  const placements: SemanticUvPlacement[] = [];
  for (const island of islands) {
    if (island.share_with) {
      const owner = ownerPlacement.get(island.share_with);
      if (!owner) continue;
      placements.push({
        ...owner,
        id: island.id,
        source_id: island.share_with,
        shared_with: island.share_with,
        cohort: island.cohort,
        locked: false,
      });
      continue;
    }
    const owner = ownerPlacement.get(island.id);
    if (!owner) continue;
    placements.push({
      ...owner,
      source_id: island.id,
      locked: lockedPlacementById.has(island.id),
    });
  }

  const unresolved = new Set(packed.unplaced);
  for (const island of islands) if (island.share_with && unresolved.has(island.share_with)) unresolved.add(island.id);

  return {
    atlas: { width: options.atlas_width, height: options.atlas_height, padding },
    placements,
    owner_placements: [...ownerPlacement.values()].sort((a, b) => a.id.localeCompare(b.id)),
    unplaced: [...unresolved].sort(),
    complete: unresolved.size === 0,
    utilization: packed.utilization,
    incremental: affected !== null,
    affected_ids: affected ? [...affected].sort() : null,
    retained_ids: affected ? [...lockedPlacementById.keys()].filter((id) => !affected.has(id)).sort() : [],
    art_direction: {
      unique_island_ids: islands
        .filter((island) => island.reuse_policy === "UNIQUE")
        .map((island) => island.id)
        .sort(),
      required_reuse_island_ids: islands
        .filter((island) => island.reuse_policy === "REQUIRE_REUSE")
        .map((island) => island.id)
        .sort(),
      high_priority_island_ids: islands
        .filter(
          (island) =>
            island.identity_priority === "HIGH" ||
            island.identity_priority === "CRITICAL"
        )
        .sort(
          (left, right) =>
            identityPriority(right.identity_priority) -
              identityPriority(left.identity_priority) ||
            left.id.localeCompare(right.id)
        )
        .map((island) => island.id),
    },
  };
}

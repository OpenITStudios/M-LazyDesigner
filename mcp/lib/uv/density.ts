import type {
  UvDensityPolicy,
  UvIsland,
  UvLayoutSnapshot,
  UvRect,
} from "@/lib/uv/contracts";

export type UvDensityMeasurement = {
  island_id: string;
  policy: UvDensityPolicy;
  pixels_per_model_unit: [number, number];
  mean_pixels_per_model_unit: number;
  anisotropy_ratio: number;
  target_pixels_per_model_unit: number | null;
  target_error_ratio: number | null;
};

export type UvDensityProposal = {
  island_id: string;
  current_rect: UvRect;
  proposed_size: [number, number];
  target_pixels_per_model_unit: number;
  scale: [number, number];
  changed: boolean;
};

export type UvDensityPlan = {
  schema: 1;
  physical_pixels_per_uv_unit: [number, number];
  default_target_pixels_per_model_unit: number;
  measurements: UvDensityMeasurement[];
  proposals: UvDensityProposal[];
  changed_island_ids: string[];
};

function requirePositiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  return value;
}

export function physicalPixelsPerUvUnit(
  logicalWidth: number,
  logicalHeight: number,
  bitmapWidth: number,
  bitmapHeight: number
): [number, number] {
  return [
    requirePositiveFinite(bitmapWidth, "Bitmap width") /
      requirePositiveFinite(logicalWidth, "Logical UV width"),
    requirePositiveFinite(bitmapHeight, "Bitmap height") /
      requirePositiveFinite(logicalHeight, "Logical UV height"),
  ];
}

function targetForIsland(
  island: UvIsland,
  defaultTarget: number
): number | null {
  const density = island.constraints.density;
  if (density.policy === "PRESERVE") return null;
  const base =
    density.policy === "CUSTOM"
      ? requirePositiveFinite(
          density.target_pixels_per_model_unit ?? defaultTarget,
          `UV island ${island.id} custom density target`
        )
      : defaultTarget;
  const multiplier =
    density.multiplier === undefined
      ? 1
      : requirePositiveFinite(
          density.multiplier,
          `UV island ${island.id} density multiplier`
        );
  return base * multiplier;
}

export function measureUvIslandDensity(
  island: UvIsland,
  pixelScale: readonly [number, number],
  defaultTarget: number
): UvDensityMeasurement {
  const basisU = island.physical.density_basis.u_model_units;
  const basisV = island.physical.density_basis.v_model_units;
  requirePositiveFinite(basisU, `UV island ${island.id} U density basis`);
  requirePositiveFinite(basisV, `UV island ${island.id} V density basis`);
  const u =
    (island.rect.width * requirePositiveFinite(pixelScale[0], "U pixel scale")) /
    basisU;
  const v =
    (island.rect.height * requirePositiveFinite(pixelScale[1], "V pixel scale")) /
    basisV;
  const minimum = Math.min(u, v);
  const maximum = Math.max(u, v);
  const target =
    island.source.box_uv || island.constraints.locked
      ? null
      : targetForIsland(island, defaultTarget);
  const mean = (u + v) / 2;

  return {
    island_id: island.id,
    policy: island.constraints.density.policy,
    pixels_per_model_unit: [u, v],
    mean_pixels_per_model_unit: mean,
    anisotropy_ratio: minimum <= 0 ? Number.POSITIVE_INFINITY : maximum / minimum,
    target_pixels_per_model_unit: target,
    target_error_ratio:
      target === null || target <= 0 ? null : Math.abs(mean / target - 1),
  };
}

/** Never round a requested density down to less than one physical texel. */
function ceilPositivePhysicalPixels(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error("UV density target has an unrepresentable physical pixel extent.");
  }
  return Math.max(1, Math.ceil(value - 1e-9));
}

export function planUvDensity(
  snapshot: UvLayoutSnapshot,
  options: {
    bitmap_width: number;
    bitmap_height: number;
    default_target_pixels_per_model_unit: number;
  }
): UvDensityPlan {
  const target = requirePositiveFinite(
    options.default_target_pixels_per_model_unit,
    "Default target pixels per model unit"
  );
  const pixelScale = physicalPixelsPerUvUnit(
    snapshot.logical_width,
    snapshot.logical_height,
    options.bitmap_width,
    options.bitmap_height
  );

  const measurements = snapshot.islands.map((island) =>
    measureUvIslandDensity(island, pixelScale, target)
  );
  const measurementById = new Map(
    measurements.map((measurement) => [
      measurement.island_id,
      measurement,
    ])
  );

  const proposals: UvDensityProposal[] = snapshot.islands.map((island) => {
    const measurement = measurementById.get(island.id)!;
    const desired = measurement.target_pixels_per_model_unit;
    if (desired === null) {
      return {
        island_id: island.id,
        current_rect: { ...island.rect },
        proposed_size: [island.rect.width, island.rect.height],
        target_pixels_per_model_unit:
          measurement.mean_pixels_per_model_unit,
        scale: [1, 1],
        changed: false,
      };
    }

    const basisU = island.physical.density_basis.u_model_units;
    const basisV = island.physical.density_basis.v_model_units;
    // Quantize in physical pixel space, then return to logical UV units.
    const proposedWidth = ceilPositivePhysicalPixels(basisU * desired) / pixelScale[0];
    const proposedHeight = ceilPositivePhysicalPixels(basisV * desired) / pixelScale[1];
    const scaleU =
      island.rect.width === 0 ? 1 : proposedWidth / island.rect.width;
    const scaleV =
      island.rect.height === 0 ? 1 : proposedHeight / island.rect.height;
    const changed =
      Math.abs(proposedWidth - island.rect.width) > 1e-9 ||
      Math.abs(proposedHeight - island.rect.height) > 1e-9;

    return {
      island_id: island.id,
      current_rect: { ...island.rect },
      proposed_size: [proposedWidth, proposedHeight],
      target_pixels_per_model_unit: desired,
      scale: [scaleU, scaleV],
      changed,
    };
  });

  return {
    schema: 1,
    physical_pixels_per_uv_unit: pixelScale,
    default_target_pixels_per_model_unit: target,
    measurements,
    proposals,
    changed_island_ids: proposals
      .filter((proposal) => proposal.changed)
      .map((proposal) => proposal.island_id),
  };
}

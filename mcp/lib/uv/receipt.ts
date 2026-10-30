import { z } from "zod";
import type {
  UvLayoutPlan,
  UvLayoutReceipt,
} from "@/lib/uv/contracts";

/**
 * A stored UV planning result is not necessarily eligible for apply.
 * The Runtime registry and source fingerprint remain final authority at
 * apply-time; this limited receipt is only an ephemeral Graph readiness hint.
 */
export const uvUsablePlanReceiptSchema = z.object({
  plan_id: z.string().regex(/^uvplan:[a-f0-9]{64}$/),
  source_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  report: z.object({
    schema: z.literal(1),
    execution: z.literal("planned"),
    apply_allowed: z.literal(true),
    hard_violations: z.array(z.string()).length(0),
  }),
});

export function isUvUsablePlanReceipt(value: unknown): boolean {
  return uvUsablePlanReceiptSchema.safeParse(value).success;
}

/**
 * Observed plan-apply receipt identity; a successful tool response alone
 * cannot assert that UV mapping is current. The native UV transaction owns
 * the postcondition, with request/source binding checked at the Graph edge.
 */
const uvReceiptRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const uvReceiptFaceSchema = z.enum([
  "north", "south", "east", "west", "up", "down",
]);

export const uvAppliedPlanReceiptSchema = z.object({
  receipt: z.object({
    schema: z.literal(1),
    source_fingerprint_before: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    source_fingerprint_after: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    changed_island_ids: z.array(z.string().min(1)).min(1),
    changed_cube_ids: z.array(z.string().min(1)).min(1),
    changed_faces: z.array(z.object({
      cube_uuid: z.string().min(1),
      face: uvReceiptFaceSchema.nullable(),
    })).min(1),
    moved: z.array(z.object({
      island_id: z.string().min(1),
      before: uvReceiptRectSchema,
      after: uvReceiptRectSchema,
      rotated_90: z.boolean(),
    })).min(1),
  }).superRefine((receipt, ctx) => {
    // The source transaction emits all of these fields from one committed
    // native plan. Graph readiness must not accept internally contradictory
    // "successful" receipts when Control's scoped recheck refuses them.
    const islands = new Set(receipt.changed_island_ids);
    const moved = new Set(receipt.moved.map((row) => row.island_id));
    if (
      islands.size !== receipt.changed_island_ids.length ||
      moved.size !== receipt.moved.length ||
      islands.size !== moved.size ||
      [...islands].some((id) => !id.trim() || !moved.has(id))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["moved"],
        message: "UV moved islands must match unique changed island IDs exactly.",
      });
    }

    const cubes = new Set(receipt.changed_cube_ids);
    const faceCubes = new Set(receipt.changed_faces.map((row) => row.cube_uuid));
    const uniqueFaces = new Set(
      receipt.changed_faces.map((row) => JSON.stringify([row.cube_uuid, row.face]))
    );
    if (
      cubes.size !== receipt.changed_cube_ids.length ||
      faceCubes.size !== cubes.size ||
      uniqueFaces.size !== receipt.changed_faces.length ||
      [...cubes].some((id) => !id.trim() || !faceCubes.has(id)) ||
      receipt.changed_faces.some((row) => !row.cube_uuid.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["changed_faces"],
        message: "UV changed faces must cover exactly the unique changed cubes.",
      });
    }

    // A claimed move with identical before/after rectangles and no rotation
    // cannot be evidence of an authored mapping change.
    for (const [index, entry] of receipt.moved.entries()) {
      if (!entry.rotated_90 &&
          entry.before.x === entry.after.x &&
          entry.before.y === entry.after.y &&
          entry.before.width === entry.after.width &&
          entry.before.height === entry.after.height) {
        ctx.addIssue({
          code: "custom",
          path: ["moved", index],
          message: "UV move must change its rectangle or rotate the mapping.",
        });
      }
    }
  }),
});

export function isUvAppliedPlanReceipt(
  value: unknown,
  args: Readonly<Record<string, unknown>>
): boolean {
  const parsed = uvAppliedPlanReceiptSchema.safeParse(value);
  return parsed.success &&
    typeof args.plan_id === "string" &&
    /^uvplan:[a-f0-9]{64}$/.test(args.plan_id) &&
    typeof args.expected_source_fingerprint === "string" &&
    args.expected_source_fingerprint ===
      parsed.data.receipt.source_fingerprint_before &&
    // A changed source fingerprint is necessary (not sufficient) for a
    // successful native apply; unchanged/empty receipts never prove UV PASS.
    parsed.data.receipt.source_fingerprint_after !==
      parsed.data.receipt.source_fingerprint_before;
}

export function buildUvLayoutReceipt(
  plan: UvLayoutPlan,
  sourceFingerprintBefore: string,
  sourceFingerprintAfter: string
): UvLayoutReceipt {
  const beforeById = new Map(
    plan.before.islands.map((island) => [island.id, island])
  );
  const afterById = new Map(
    plan.proposed.islands.map((island) => [island.id, island])
  );
  const transformById = new Map(
    plan.placement_transforms.map((transform) => [
      transform.island_id,
      transform,
    ])
  );

  const moved = plan.moved_island_ids.map((islandId) => {
    const before = beforeById.get(islandId);
    const after = afterById.get(islandId);
    if (!before || !after) {
      throw new Error(
        `UV receipt cannot resolve moved island ${islandId}.`
      );
    }
    return {
      island_id: islandId,
      before: { ...before.rect },
      after: { ...after.rect },
      rotated_90:
        transformById.get(islandId)?.rotated_90 === true,
    };
  });

  const changedCubes = new Set<string>();
  const changedFaces: Array<{
    cube_uuid: string;
    face: import("@/lib/uv/contracts").UvFaceKey | null;
  }> = [];

  for (const islandId of plan.moved_island_ids) {
    const island = beforeById.get(islandId);
    if (!island) continue;
    changedCubes.add(island.source.cube_uuid);
    if (island.source.box_uv) {
      changedFaces.push({
        cube_uuid: island.source.cube_uuid,
        face: null,
      });
    } else {
      for (const face of island.source.faces) {
        changedFaces.push({
          cube_uuid: island.source.cube_uuid,
          face,
        });
      }
    }
  }

  return {
    schema: 1,
    planner_version: plan.planner_version,
    backend: plan.backend,
    backend_version: plan.backend_version,
    mode: plan.mode,
    source_fingerprint_before: sourceFingerprintBefore,
    source_fingerprint_after: sourceFingerprintAfter,
    changed_island_ids: [...plan.moved_island_ids],
    changed_cube_ids: [...changedCubes].sort(),
    changed_faces: changedFaces.sort((a, b) =>
      a.cube_uuid.localeCompare(b.cube_uuid) ||
      String(a.face).localeCompare(String(b.face))
    ),
    moved,
    before_metrics: { ...plan.before.metrics },
    after_metrics: { ...plan.proposed.metrics },
  };
}

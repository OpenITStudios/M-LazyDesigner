import type {
  UvLayoutReceipt,
  UvPackingMode,
} from "@/lib/uv/contracts";
import type { UvConstraintRule } from "@/lib/uv/constraints";
import {
  assignUvConstraints,
  constraintResolverFromAssignments,
} from "@/lib/uv/constraints";
import {
  buildUvLayoutSnapshot,
  type UvCubeSnapshot,
} from "@/lib/uv/islands";
import { planUvDensity } from "@/lib/uv/density";
import { planUvPacking } from "@/lib/uv/packing/planner";
import { discoverUvStackProposals } from "@/lib/uv/stacking";
import { buildUvDryRunReport } from "@/lib/uv/dryRun";
import { applyUvLayoutPlanAtomic } from "@/lib/uv/transaction";
import { invalidationForUvReceipt } from "@/lib/uv/invalidation";
import {
  fingerprintUvNativeSource,
  type UvNativeSourceSnapshot,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import type { UvApplyAdapter } from "@/lib/uv/transaction";
import {
  UvPlanRegistry,
  type UvAutoBitmapSource,
} from "@/lib/uv/planRegistry";

export type UvLayoutPlanningInput = {
  bitmap_width?: number;
  bitmap_height?: number;
  mode: UvPackingMode;
  island_ids?: readonly string[];
  default_target_pixels_per_model_unit?: number;
  constraints?: readonly UvConstraintRule[];
  include_implicit_stack_candidates?: boolean;
};

function nativeCubesForCore(
  native: UvNativeSourceSnapshot
): UvCubeSnapshot[] {
  return native.cubes.map((cube) => ({
    uuid: cube.uuid,
    name: cube.name,
    from: [...cube.from],
    to: [...cube.to],
    box_uv: cube.box_uv,
    ...(cube.uv_offset !== null
      ? { uv_offset: [...cube.uv_offset] }
      : {}),
    autouv: cube.autouv,
    mirror_uv: cube.mirror_uv,
    faces: cube.faces.map((face) => ({
      face: face.face,
      uv: [...face.uv],
      rotation: face.rotation,
      enabled: face.enabled,
    })),
  }));
}

export type UvLayoutServiceDependencies = {
  readSource(): Promise<UvNativeSourceSnapshot> | UvNativeSourceSnapshot;
  readBitmapDimensions?():
    | Promise<UvAutoBitmapSource | null>
    | UvAutoBitmapSource
    | null;
  createApplyAdapter(): UvApplyAdapter;
};

function requireValidAutoBitmapSource(source: UvAutoBitmapSource): UvAutoBitmapSource {
  if (
    !Number.isSafeInteger(source.width) || source.width <= 0 ||
    !Number.isSafeInteger(source.height) || source.height <= 0 ||
    (source.logical_width === undefined) !== (source.logical_height === undefined) ||
    (source.logical_width !== undefined &&
      (!Number.isSafeInteger(source.logical_width) || source.logical_width <= 0)) ||
    (source.logical_height !== undefined &&
      (!Number.isSafeInteger(source.logical_height) || source.logical_height <= 0)) ||
    (source.atlas_uuid !== undefined &&
      (typeof source.atlas_uuid !== "string" || !source.atlas_uuid.trim())) ||
    (source.atlas_revision !== undefined &&
      (typeof source.atlas_revision !== "string" ||
       !/^sha256:\d+x\d+:[0-9a-f]{64}$/.test(source.atlas_revision)))
  ) {
    throw new Error(
      "UV_BITMAP_SOURCE_INVALID: automatic atlas dimensions, optional logical UV, UUID and decoded RGBA revision must be valid."
    );
  }
  return {
    width: source.width,
    height: source.height,
    ...(source.atlas_uuid !== undefined ? { atlas_uuid: source.atlas_uuid } : {}),
    ...(source.logical_width !== undefined
      ? { logical_width: source.logical_width, logical_height: source.logical_height }
      : {}),
    ...(source.atlas_revision !== undefined
      ? { atlas_revision: source.atlas_revision }
      : {}),
  };
}

function sameAutoBitmapSource(
  expected: UvAutoBitmapSource,
  actual: UvAutoBitmapSource | null | undefined
): boolean {
  return actual !== null && actual !== undefined &&
    expected.width === actual.width &&
    expected.height === actual.height &&
    (expected.atlas_uuid ?? null) === (actual.atlas_uuid ?? null) &&
    (expected.logical_width ?? null) === (actual.logical_width ?? null) &&
    (expected.logical_height ?? null) === (actual.logical_height ?? null) &&
    (expected.atlas_revision ?? null) === (actual.atlas_revision ?? null);
}

export function createUvLayoutService(
  dependencies: UvLayoutServiceDependencies,
  registry = new UvPlanRegistry()
) {
  return {
    async plan(input: UvLayoutPlanningInput) {
      const native = await dependencies.readSource();
      const sourceFingerprint = fingerprintUvNativeSource(native);
      if (
        (input.bitmap_width === undefined) !==
        (input.bitmap_height === undefined)
      ) {
        throw new Error(
          "UV bitmap override requires bitmap_width and bitmap_height together."
        );
      }

      // Explicit atlas dimensions are authoritative; bypass unrelated
      // native atlas discovery when both overrides are present.
      const discoveredBitmap = input.bitmap_width === undefined
        ? await dependencies.readBitmapDimensions?.()
        : undefined;
      const automaticBitmap = discoveredBitmap
        ? requireValidAutoBitmapSource(discoveredBitmap) : undefined;
      if (automaticBitmap?.logical_width !== undefined &&
          (automaticBitmap.logical_width !== native.logical_width ||
           automaticBitmap.logical_height !== native.logical_height)) {
        throw new Error(
          "UV_BITMAP_LOGICAL_MISMATCH: the base-color atlas logical UV dimensions differ from the active project."
        );
      }
      const bitmapWidth = input.bitmap_width ?? automaticBitmap?.width;
      const bitmapHeight = input.bitmap_height ?? automaticBitmap?.height;
      if (
        bitmapWidth === undefined ||
        bitmapHeight === undefined
      ) {
        throw new Error(
          "UV_BITMAP_SCALE_REQUIRED: no established base-color atlas was found. Provide bitmap_width and bitmap_height for this pre-atlas plan, or create/resolve the base atlas first."
        );
      }

      const coreCubes = nativeCubesForCore(native);
      const base = buildUvLayoutSnapshot(
        coreCubes,
        native.logical_width,
        native.logical_height
      );
      const assignments = assignUvConstraints(
        base.islands,
        input.constraints ?? []
      );
      const constrained = buildUvLayoutSnapshot(
        coreCubes,
        native.logical_width,
        native.logical_height,
        constraintResolverFromAssignments(assignments)
      );
      const density = planUvDensity(constrained, {
        bitmap_width: bitmapWidth,
        bitmap_height: bitmapHeight,
        default_target_pixels_per_model_unit:
          input.default_target_pixels_per_model_unit ?? 1,
      });
      const sizeOverrides = Object.fromEntries(
        density.proposals
          .filter((proposal) => proposal.changed)
          .map((proposal) => [
            proposal.island_id,
            proposal.proposed_size,
          ])
      );
      const plan = planUvPacking(constrained, {
        bitmap_width: bitmapWidth,
        bitmap_height: bitmapHeight,
        mode: input.mode,
        island_ids: input.island_ids,
        size_overrides: sizeOverrides,
      });
      const stackProposals = discoverUvStackProposals(
        constrained.islands,
        {
          include_implicit_candidates:
            input.include_implicit_stack_candidates,
        }
      );
      const report = buildUvDryRunReport(plan, {
        density_plan: density,
        stack_proposals: stackProposals.proposals,
        stack_proposals_truncated: stackProposals.implicit_examples_truncated,
      });
      // Atlas resolution can await native code: do not publish a plan if
      // the active project, Geometry or UV changed in the meantime.
      const confirmedFingerprint = fingerprintUvNativeSource(
        await dependencies.readSource()
      );
      if (confirmedFingerprint !== sourceFingerprint) {
        throw new Error(
          "STALE_UV_PLAN: project or UV state changed during planning. Replan from the current source."
        );
      }
      // Auto atlas discovery is an input to UV pixel density, not part of
      // Cube geometry fingerprinting. An asynchronous atlas edit must not
      // publish a stale handle, even when all Cube UV coordinates are intact.
      if (automaticBitmap && !sameAutoBitmapSource(
        automaticBitmap, await dependencies.readBitmapDimensions?.()
      )) {
        throw new Error(
          "STALE_UV_PLAN: base-color atlas dimensions, identity, logical UV or decoded pixels changed during planning."
        );
      }
      const stored = registry.put(
        plan,
        sourceFingerprint,
        report,
        automaticBitmap
      );

      return {
        plan_id: stored.plan_id,
        source_fingerprint: sourceFingerprint,
        report,
      };
    },

    async apply(input: {
      plan_id: string;
      expected_source_fingerprint: string;
    }): Promise<{
      receipt: UvLayoutReceipt;
      invalidation: ReturnType<typeof invalidationForUvReceipt>;
    }> {
      const stored = registry.get(input.plan_id);
      if (
        stored.source_fingerprint !==
        input.expected_source_fingerprint
      ) {
        throw new Error(
          "STALE_UV_PLAN: supplied source fingerprint does not match the stored plan."
        );
      }
      // Both dry-run and apply treat an unchanged layout as inspection-only.
      // Retain the precise no-op error before the generic blocked-report guard.
      if (stored.plan.moved_island_ids.length === 0) {
        throw new Error(
          "UV_NO_OP_PLAN: the plan contains no UV changes; inspect its report instead of applying."
        );
      }
      if (!stored.report.apply_allowed) {
        throw new Error(
          "UV_LAYOUT_PLAN_BLOCKED: dry-run report contains blocking violations."
        );
      }

      // Automatic atlas dimensions, UV scale and pixel revision are required
      // private plan dependencies. This rejects same-UUID repaints before Undo.
      // This is a read-only preflight, before consuming the plan or opening
      // native Undo. Explicit pre-atlas sizes bypass native atlas discovery.
      if (stored.auto_bitmap_source && !sameAutoBitmapSource(
        stored.auto_bitmap_source, await dependencies.readBitmapDimensions?.()
      )) {
        throw new Error(
          "STALE_UV_PLAN: base-color atlas dimensions, identity, logical UV or decoded pixels changed after planning. Replan before applying."
        );
      }

      // Claim synchronously after the last awaited atlas read and before
      // creating the adapter. Concurrent applies still race on one handle;
      // only the first claim may proceed, including after OUTCOME_UNKNOWN.
      const claimed = registry.consume(input.plan_id);
      const receipt = await applyUvLayoutPlanAtomic(
        claimed.plan,
        claimed.source_fingerprint,
        dependencies.createApplyAdapter()
      );
      return {
        receipt,
        invalidation: invalidationForUvReceipt(receipt),
      };
    },

    registrySize(): number {
      return registry.size();
    },
  };
}

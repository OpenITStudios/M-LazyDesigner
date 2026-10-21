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
import { UvPlanRegistry } from "@/lib/uv/planRegistry";

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
    | Promise<{ width: number; height: number } | null>
    | { width: number; height: number }
    | null;
  createApplyAdapter(): UvApplyAdapter;
};

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
      const automaticBitmap = input.bitmap_width === undefined
        ? await dependencies.readBitmapDimensions?.()
        : undefined;
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
        stack_proposals: stackProposals,
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
      const stored = registry.put(
        plan,
        sourceFingerprint,
        report
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
      if (!stored.report.apply_allowed) {
        throw new Error(
          "UV_LAYOUT_PLAN_BLOCKED: dry-run report contains blocking violations."
        );
      }

      // A computed layout with no moved islands is inspection evidence,
      // not an authored mutation. Refuse it before touching native Undo.
      if (stored.plan.moved_island_ids.length === 0) {
        throw new Error(
          "UV_NO_OP_PLAN: the plan contains no UV changes; inspect its report instead of applying."
        );
      }

      const receipt = await applyUvLayoutPlanAtomic(
        stored.plan,
        stored.source_fingerprint,
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

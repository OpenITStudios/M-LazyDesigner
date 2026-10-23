import type {
  UvLayoutPlan,
} from "@/lib/uv/contracts";
import { validateUvLayoutPlan } from "@/lib/uv/validatePlan";
import type {
  UvDensityPlan,
} from "@/lib/uv/density";
import type {
  UvStackProposal,
} from "@/lib/uv/stacking";

export type UvDryRunReport = {
  schema: 1;
  execution: "planned";
  backend: UvLayoutPlan["backend"];
  mode: UvLayoutPlan["mode"];
  summary: {
    island_count: number;
    moved_islands: number;
    fixed_islands: number;
    occupancy_ratio: number;
    movement_cost: number;
    fragmentation: number;
    density_changes: number;
    ready_stack_groups: number;
    review_stack_candidates: number;
    blocked_stack_proposals: number;
  };
  moved_island_ids: string[];
  fixed_island_ids: string[];
  density_changed_island_ids: string[];
  stack_proposals: UvStackProposal[];
  hard_violations: string[];
  apply_allowed: boolean;
};

export function buildUvDryRunReport(
  plan: UvLayoutPlan,
  options: {
    density_plan?: UvDensityPlan;
    stack_proposals?: readonly UvStackProposal[];
  } = {}
): UvDryRunReport {
  const stacks = [...(options.stack_proposals ?? [])];
  const densityChanged =
    options.density_plan?.changed_island_ids ?? [];
  // The exact same validator owns both dry-run acceptance and native apply.
  // Prevent "apply_allowed: true" when a semantic/locked/overlap constraint
  // would be refused only after the user starts a transaction.
  const validation = validateUvLayoutPlan(plan);
  const hardViolations = [...new Set([
    ...plan.score.hard_violations,
    ...validation.errors,
  ])];

  return {
    schema: 1,
    execution: "planned",
    backend: plan.backend,
    mode: plan.mode,
    summary: {
      island_count: plan.proposed.islands.length,
      moved_islands: plan.moved_island_ids.length,
      fixed_islands: plan.fixed_island_ids.length,
      occupancy_ratio: plan.score.occupancy_ratio,
      movement_cost: plan.score.movement_cost,
      fragmentation: plan.score.fragmentation,
      density_changes: densityChanged.length,
      ready_stack_groups: stacks.filter(
        (proposal) =>
          proposal.kind === "EXPLICIT_STACK_GROUP" &&
          proposal.state === "READY"
      ).length,
      review_stack_candidates: stacks.filter(
        (proposal) => proposal.state === "REVIEW"
      ).length,
      blocked_stack_proposals: stacks.filter(
        (proposal) => proposal.state === "BLOCKED"
      ).length,
    },
    moved_island_ids: [...plan.moved_island_ids],
    fixed_island_ids: [...plan.fixed_island_ids],
    density_changed_island_ids: [...densityChanged],
    stack_proposals: stacks,
    hard_violations: hardViolations,
    apply_allowed:
      plan.score.valid &&
      hardViolations.length === 0,
  };
}

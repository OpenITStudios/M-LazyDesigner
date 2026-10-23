import type { UvIsland } from "@/lib/uv/contracts";

export type UvStackProposalKind =
  | "EXPLICIT_STACK_GROUP"
  | "MATCHING_FOOTPRINT_CANDIDATE";

export type UvStackProposalState =
  | "READY"
  | "REVIEW"
  | "BLOCKED";

export type UvStackProposal = {
  id: string;
  kind: UvStackProposalKind;
  state: UvStackProposalState;
  island_ids: string[];
  evidence: string[];
  blockers: string[];
};

function nearlyEqual(left: number, right: number, epsilon = 1e-9): boolean {
  return Math.abs(left - right) <= epsilon;
}

export function samePackingShape(a: UvIsland, b: UvIsland): boolean {
  return (
    a.source.box_uv === b.source.box_uv &&
    a.source.faces.length === b.source.faces.length &&
    nearlyEqual(a.physical.density_basis.u_model_units, b.physical.density_basis.u_model_units) &&
    nearlyEqual(a.physical.density_basis.v_model_units, b.physical.density_basis.v_model_units) &&
    nearlyEqual(a.rect.width, b.rect.width) &&
    nearlyEqual(a.rect.height, b.rect.height)
  );
}

export function stackBlockers(island: UvIsland): string[] {
  const blockers: string[] = [];
  if (island.constraints.unique_detail) {
    blockers.push(island.id + ":UNIQUE_DETAIL");
  }
  if (island.constraints.mirror_policy === "FORBID") {
    blockers.push(island.id + ":MIRROR_FORBIDDEN");
  }
  return blockers;
}

function explicitGroupProposals(islands: readonly UvIsland[]): UvStackProposal[] {
  const groups = new Map<string, UvIsland[]>();
  for (const island of islands) {
    const group = island.constraints.stack_group;
    if (!group) continue;
    const entries = groups.get(group) ?? [];
    entries.push(island);
    groups.set(group, entries);
  }

  const proposals: UvStackProposal[] = [];
  for (const [group, entries] of groups) {
    if (entries.length < 2) continue;
    const ordered = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    const blockers = ordered.flatMap(stackBlockers);
    const shapeCompatible = ordered.slice(1).every((island) => samePackingShape(ordered[0], island));
    if (!shapeCompatible) blockers.push("stack_group:" + group + ":INCOMPATIBLE_SHAPE");
    proposals.push({
      id: "stack:" + group,
      kind: "EXPLICIT_STACK_GROUP",
      state: blockers.length > 0 ? "BLOCKED" : "READY",
      island_ids: ordered.map((island) => island.id),
      evidence: [
        "explicit stack_group=" + group,
        shapeCompatible ? "matching packing shape" : "packing shape mismatch",
      ],
      blockers,
    });
  }
  return proposals.sort((a, b) => a.id.localeCompare(b.id));
}

function implicitPairProposals(
  islands: readonly UvIsland[],
  explicitIslandIds: ReadonlySet<string>
): UvStackProposal[] {
  const eligible = [...islands]
    .filter((island) => !explicitIslandIds.has(island.id) && !island.constraints.unique_detail)
    .sort((a, b) => a.id.localeCompare(b.id));
  const proposals: UvStackProposal[] = [];
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      const a = eligible[left];
      const b = eligible[right];
      if (!samePackingShape(a, b)) continue;
      const blockers = [...stackBlockers(a), ...stackBlockers(b)];
      proposals.push({
        id: "candidate:" + a.id + ":" + b.id,
        kind: "MATCHING_FOOTPRINT_CANDIDATE",
        state: blockers.length > 0 ? "BLOCKED" : "REVIEW",
        island_ids: [a.id, b.id],
        evidence: [
          "matching physical density basis",
          "matching current UV dimensions",
          a.source.box_uv ? "matching Box-UV representation" : "matching per-face representation",
        ],
        blockers,
      });
    }
  }
  return proposals;
}

export function discoverUvStackProposals(
  islands: readonly UvIsland[],
  options: { include_implicit_candidates?: boolean } = {}
): UvStackProposal[] {
  const explicit = explicitGroupProposals(islands);
  if (options.include_implicit_candidates === false) return explicit;
  const explicitIds = new Set(explicit.flatMap((proposal) => proposal.island_ids));
  return [...explicit, ...implicitPairProposals(islands, explicitIds)];
}

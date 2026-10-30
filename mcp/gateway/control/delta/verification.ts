import { getCapabilityMetadata } from "../../../lib/capabilities/metadata";
import { manifestEntryForBranch } from "../../capabilities/manifest";
import type { CapabilityBranchHint } from "../../capabilities/types";
import { cubeVisualScopeFromResult } from "../../../lib/receipts/cubeMutation";
import type { ControlDelta, ControlVerificationScope } from "../types";
import { STATE_MUTATIONS } from "./policy";
import {
  record,
  authoritativeReceipt,
  receiptSupportsContinuation,
} from "./receipts";

export function cubeVerificationScope(value: unknown): ControlVerificationScope | null {
  const candidate = authoritativeReceipt(value);
  if (!candidate) return null;
  const scope = cubeVisualScopeFromResult(candidate);
  if (!scope) return null;
  return {
    kind: "CUBE_TARGETS",
    cube_uuids: [...scope.cube_uuids],
    framing: {
      min: [...scope.framing.min] as [number, number, number],
      max: [...scope.framing.max] as [number, number, number],
    },
  };
}

export function animationVerificationScope(value: unknown): ControlVerificationScope | null {
  const candidate = authoritativeReceipt(value);
  if (!candidate) return null;
  const animation = record(candidate.animation);
  const bone = record(candidate.bone);
  const keyframes = candidate.affected_keyframes;
  if (
    typeof animation?.uuid !== "string" || !animation.uuid.trim() ||
    typeof bone?.uuid !== "string" || !bone.uuid.trim() ||
    !Array.isArray(keyframes) || keyframes.length === 0
  ) return null;

  // A mixed or incomplete native edit cannot justify a narrow time window.
  // Dropping malformed entries would silently exclude changed keyframes.
  const times = keyframes.map((entry) => record(entry)?.time);
  if (times.some((time) =>
    typeof time !== "number" || !Number.isFinite(time) || time < 0
  )) return null;
  const numericTimes = times as number[];
  const start = Math.min(...numericTimes);
  const end = Math.max(...numericTimes);
  const midpoint = start + (end - start) / 2;
  return {
    kind: "ANIMATION_RANGE",
    animation_uuid: animation.uuid,
    bone_uuid: bone.uuid,
    channel: typeof candidate.channel === "string" ? candidate.channel : null,
    time_range: [start, end],
    review: {
      bone_ids: [bone.uuid],
      range: { start, end },
      sample_times: [...new Set([start, midpoint, end])],
    },
  };
}

export function textureVerificationScope(value: unknown): ControlVerificationScope | null {
  const candidate = authoritativeReceipt(value);
  if (!candidate) return null;
  const texture = record(candidate.texture);
  const revision = record(candidate.revision);
  const rect = candidate.affected_rect;
  // Producer receipts use [left, top, right-exclusive, bottom-exclusive],
  // not [x, y, width, height]. Reject a non-region rather than advertising
  // a focused review that can miss the actual changed pixels.
  if (
    typeof texture?.uuid !== "string" || !texture.uuid.trim() ||
    typeof revision?.after !== "string" || !revision.after.trim() ||
    !Array.isArray(rect) || rect.length !== 4 ||
    !rect.every((entry) => Number.isSafeInteger(entry)) ||
    rect[0] < 0 || rect[1] < 0 ||
    rect[2] <= rect[0] || rect[3] <= rect[1]
  ) return null;
  const visualEvidence = record(candidate.visual_evidence);
  // The native tool emits this metadata only alongside the PNG produced
  // after the verified mutation. An unbound kind label cannot replace a
  // fresh on-demand get_texture read of the actual affected region.
  const imageMatchesReceipt =
    visualEvidence?.kind === "affected_region_png" &&
    visualEvidence.revision === revision.after &&
    Array.isArray(visualEvidence.affected_rect) &&
    visualEvidence.affected_rect.length === 4 &&
    visualEvidence.affected_rect.every(
      (value, index) => value === rect[index]
    ) &&
    visualEvidence.width === rect[2] - rect[0] &&
    visualEvidence.height === rect[3] - rect[1];
  return {
    kind: "TEXTURE_REGION",
    texture_uuid: texture.uuid,
    affected_rect: rect as [number, number, number, number],
    revision: revision.after,
    evidence_source: imageMatchesReceipt
      ? "mutation_response"
      : "follow_up_read",
  };
}

type VisualScopeResolver = (
  value: unknown
) => ControlVerificationScope | null;

const VISUAL_SCOPE_RESOLVERS: Readonly<
  Record<string, VisualScopeResolver>
> = {
  manage_cubes: cubeVerificationScope,
  animation_graph_editor: animationVerificationScope,
  manage_animation_timeline: animationVerificationScope,
  manage_keyframes: animationVerificationScope,
  paint_texture_transaction: textureVerificationScope,
};

export const BOUNDED_VISUAL_SCOPE_CAPABILITIES = Object.freeze(
  Object.keys(VISUAL_SCOPE_RESOLVERS).sort((a, b) =>
    a.localeCompare(b)
  )
);

export function verificationScopeForResult(
  capability: string,
  verificationClass: ControlDelta["verification_class"],
  result: unknown
): ControlVerificationScope | null {
  if (verificationClass !== "visual") return null;
  return VISUAL_SCOPE_RESOLVERS[capability]?.(result) ?? null;
}

export function verificationClassForResult(
  capability: string,
  branch: CapabilityBranchHint | undefined,
  succeeded: boolean,
  freshness: ControlDelta["freshness"],
  result: unknown
): ControlDelta["verification_class"] {
  const fallback =
    manifestEntryForBranch(capability, branch)?.verificationClass ??
    getCapabilityMetadata(capability).verificationClass;
  if (!succeeded) return fallback;

  if (
    fallback === "not_applicable" &&
    freshness.basis === "NO_CHANGE"
  ) {
    return "not_applicable";
  }

  if (STATE_MUTATIONS.has(capability) && freshness.basis === "NO_CHANGE") {
    return "receipt_only";
  }

  if (receiptSupportsContinuation(capability, result)) {
    return "receipt_only";
  }

  return fallback;
}
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
    typeof animation?.uuid !== "string" ||
    typeof bone?.uuid !== "string" ||
    !Array.isArray(keyframes)
  ) return null;

  const times = keyframes
    .map((entry) => record(entry)?.time)
    .filter((time): time is number => typeof time === "number" && Number.isFinite(time));
  if (times.length === 0) return null;
  const start = Math.min(...times);
  const end = Math.max(...times);
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
  if (
    typeof texture?.uuid !== "string" ||
    typeof revision?.after !== "string" ||
    !Array.isArray(rect) ||
    rect.length !== 4 ||
    !rect.every((entry) => typeof entry === "number" && Number.isSafeInteger(entry))
  ) return null;
  const visualEvidence = record(candidate.visual_evidence);
  return {
    kind: "TEXTURE_REGION",
    texture_uuid: texture.uuid,
    affected_rect: rect as [number, number, number, number],
    revision: revision.after,
    evidence_source:
      visualEvidence?.kind === "affected_region_png"
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
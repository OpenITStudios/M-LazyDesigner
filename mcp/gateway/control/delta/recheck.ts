import {
  assetDependencyForScope,
  type AssetDependencyDomain,
  type AssetDependencyRecheckAction,
} from "../../../lib/authoring/assetDependencyGraph";
import type {
  ControlAuthoringDomain,
  ControlFreshnessScope,
  ControlVerificationScope,
} from "../types";
import { record, resultCandidates } from "./receipts";
import { animationVerificationScope, textureVerificationScope } from "./verification";
import { uvAppliedPlanReceiptSchema } from "../../../lib/uv/receipt";

export type ControlRecheckAction = AssetDependencyRecheckAction;

export type ControlDownstreamRecheck = {
  scope: ControlFreshnessScope;
  domain: ControlAuthoringDomain;
  action: ControlRecheckAction;
  reason: string;
  target?: {
    cube_ids?: string[];
    island_ids?: string[];
    faces?: Array<{ cube_uuid: string; face: string | null }>;
    texture_uuid?: string;
    affected_rect?: [number, number, number, number];
    revision?: string;
    animation_uuid?: string;
    bone_ids?: string[];
    channel?: string | null;
    channels?: string[];
    time_range?: [number, number];
    controller_uuid?: string;
    state_ids?: string[];
  };
};

type UvTargetObservation = {
  target?: ControlDownstreamRecheck["target"];
  /** Do not substitute a texture rectangle for a malformed UV change set. */
  attempted: boolean;
};

const UV_RECHECK_FACES = new Set([
  "north", "south", "east", "west", "up", "down",
]);
const uvIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;

function uvTargetFromCandidates(
  candidates: readonly Record<string, unknown>[],
  uvMappingStale: boolean
): UvTargetObservation {
  for (const candidate of candidates) {
    const hasReceipt = Object.prototype.hasOwnProperty.call(candidate, "receipt");
    const receipt = hasReceipt ? record(candidate.receipt) : candidate;
    // A non-UV producer may have a nested "receipt" of its own. Treat it
    // as UV evidence only when UV_MAPPING is stale or actual UV change fields
    // are present; otherwise preserve a complete Texture-region receipt.
    const attempted = (hasReceipt && uvMappingStale) || (receipt !== null && [
      "changed_cube_ids", "changed_island_ids", "changed_faces",
    ].some((field) => Object.prototype.hasOwnProperty.call(receipt, field)));
    if (!attempted) continue;
    if (!receipt) return { attempted: true };

    const cubes = receipt.changed_cube_ids;
    const islands = receipt.changed_island_ids;
    const changedFaces = receipt.changed_faces;
    // A partial/malformed array is NOT a complete bounded affected set.
    // Large repacks use the existing broad recheck, not a huge AI payload.
    if (!Array.isArray(cubes) || cubes.length === 0 || cubes.length > 64 ||
        !Array.isArray(islands) || islands.length === 0 || islands.length > 128 ||
        !Array.isArray(changedFaces) || changedFaces.length === 0 ||
        changedFaces.length > 384 ||
        !cubes.every(uvIdentifier) || !islands.every(uvIdentifier)) {
      return { attempted: true };
    }
    const cubeIds = [...new Set(cubes as string[])];
    const islandIds = [...new Set(islands as string[])];
    const cubeSet = new Set(cubeIds);
    const faces: Array<{ cube_uuid: string; face: string | null }> = [];
    const seenFaces = new Set<string>();
    for (const item of changedFaces) {
      const face = record(item);
      if (!face || !uvIdentifier(face.cube_uuid) ||
          (face.face !== null &&
            (typeof face.face !== "string" || !UV_RECHECK_FACES.has(face.face))) ||
          !cubeSet.has(face.cube_uuid)) {
        return { attempted: true };
      }
      const normalized = {
        cube_uuid: face.cube_uuid,
        face: face.face as string | null,
      };
      const key = JSON.stringify([normalized.cube_uuid, normalized.face]);
      if (!seenFaces.has(key)) {
        seenFaces.add(key);
        faces.push(normalized);
      }
    }
    const faceCubes = new Set(faces.map((face) => face.cube_uuid));
    if (cubeIds.some((id) => !faceCubes.has(id))) {
      return { attempted: true };
    }
    // When the native UV producer supplies moved islands, the scope may
    // not omit an island or claim one that was not actually moved.
    if (receipt.moved !== undefined) {
      const moved = receipt.moved;
      if (!Array.isArray(moved) || moved.length !== islandIds.length ||
          moved.some((entry) => !uvIdentifier(record(entry)?.island_id))) {
        return { attempted: true };
      }
      const movedSet = new Set(moved.map((entry) =>
        (record(entry)!.island_id as string)
      ));
      if (movedSet.size !== islandIds.length ||
          islandIds.some((id) => !movedSet.has(id))) {
        return { attempted: true };
      }
    }
    return {
      attempted: true,
      target: { cube_ids: cubeIds, island_ids: islandIds, faces },
    };
  }
  return { attempted: false };
}

function materialRenderTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    if (!Array.isArray(candidate.changes) || candidate.changes.length === 0 ||
        candidate.changes.length > 384) continue;
    // A partially serialized face ledger must not narrow a material recheck.
    const changes = candidate.changes;
    if (candidate.face_count !== undefined &&
        (typeof candidate.face_count !== "number" ||
          !Number.isSafeInteger(candidate.face_count) ||
          candidate.face_count !== changes.length)) return undefined;
    const faces: Array<{ cube_uuid: string; face: string | null }> = [];
    const seen = new Set<string>();
    for (const value of changes) {
      const change = record(value);
      if (!change || !uvIdentifier(change.cube_uuid) ||
          typeof change.face !== "string" ||
          !UV_RECHECK_FACES.has(change.face)) return undefined;
      const key = JSON.stringify([change.cube_uuid, change.face]);
      if (seen.has(key)) return undefined;
      seen.add(key);
      faces.push({ cube_uuid: change.cube_uuid, face: change.face });
    }
    const cubeIds = [...new Set(faces.map((entry) => entry.cube_uuid))];
    if (candidate.cube_count !== undefined &&
        (typeof candidate.cube_count !== "number" ||
          !Number.isSafeInteger(candidate.cube_count) ||
          candidate.cube_count !== cubeIds.length)) return undefined;
    return { cube_ids: cubeIds, faces };
  }
  return undefined;
}

function textureRegionTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    // Reuse the same strict identity, revision and right-exclusive rectangle
    // proof as visual verification; do not invent a narrow downstream review.
    const scope = textureVerificationScope(candidate);
    if (scope?.kind === "TEXTURE_REGION") {
      return targetFromVerificationScope(scope);
    }
  }
  return undefined;
}


function animationMotionTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    const animation = record(candidate.animation);
    if (typeof animation?.uuid !== "string" || !animation.uuid.trim()) continue;

    // Verification owns time/identity validation. Never use only the valid
    // subset of affected keys to claim a complete edit range.
    const scope = animationVerificationScope(candidate);
    if (scope?.kind === "ANIMATION_RANGE") {
      return targetFromVerificationScope(scope);
    }

    // Clip properties have no bone/window: retain the legitimate clip target.
    if (
      candidate.action === "properties" &&
      Array.isArray(candidate.changed_fields)
    ) {
      return { animation_uuid: animation.uuid };
    }
  }
  return undefined;
}


const ANIMATION_EFFECT_RECHECK_CHANNELS = new Set([
  "sound", "particle", "timeline",
]);

function animationEffectsTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    const animation = record(candidate.animation);
    if (!animation || !uvIdentifier(animation.uuid) ||
        !Array.isArray(candidate.results) || candidate.results.length === 0 ||
        candidate.results.length > 384) continue;
    const results = candidate.results;
    if (candidate.operation_count !== undefined &&
        (typeof candidate.operation_count !== "number" ||
          !Number.isSafeInteger(candidate.operation_count) ||
          candidate.operation_count !== results.length)) return undefined;

    // No channel may disappear from a partial or malformed effects batch.
    // Time-free removals remain valid, but mixed times cannot bound a range.
    const channels = new Set<string>();
    const times: unknown[] = [];
    for (const value of results) {
      const entry = record(value);
      if (!entry || typeof entry.channel !== "string" ||
          !ANIMATION_EFFECT_RECHECK_CHANNELS.has(entry.channel)) return undefined;
      channels.add(entry.channel);
      times.push(entry.time);
    }
    const boundedTimes = times.every(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value >= 0
    ) ? times as number[] : [];

    return {
      animation_uuid: animation.uuid,
      channels: [...channels],
      ...(boundedTimes.length
        ? { time_range: [
            Math.min(...boundedTimes), Math.max(...boundedTimes),
          ] as [number, number] }
        : {}),
    };
  }
  return undefined;
}

function animationControllerTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    const controller = record(candidate.controller);
    if (typeof controller?.uuid !== "string") continue;

    const stateIds = new Set<string>();
    if (Array.isArray(candidate.affected_states)) {
      for (const value of candidate.affected_states) {
        const state = record(value);
        if (typeof state?.uuid === "string") stateIds.add(state.uuid);
      }
    }
    const created = record(candidate.created);
    if (Array.isArray(created?.states)) {
      for (const value of created.states) {
        const state = record(value);
        if (typeof state?.uuid === "string") stateIds.add(state.uuid);
      }
    }
    const removed = record(candidate.removed);
    if (Array.isArray(removed?.states)) {
      for (const value of removed.states) {
        const state = record(value);
        if (typeof state?.uuid === "string") stateIds.add(state.uuid);
      }
    }

    return {
      controller_uuid: controller.uuid,
      ...(stateIds.size ? { state_ids: [...stateIds] } : {}),
    };
  }
  return undefined;
}

/**
 * Verification has already inspected the same authoritative Runtime receipt
 * when it produces a bounded visual scope. Reuse that evidence for matching
 * downstream targets instead of re-reading keyframe times / texture region.
 * This is internal call-local reuse, not an alternative receipt authority.
 */
function targetFromVerificationScope(
  scope: ControlVerificationScope | null | undefined
): ControlDownstreamRecheck["target"] | undefined {
  if (scope?.kind === "TEXTURE_REGION") {
    return {
      texture_uuid: scope.texture_uuid,
      affected_rect: scope.affected_rect,
      revision: scope.revision,
    };
  }
  if (scope?.kind === "ANIMATION_RANGE") {
    return {
      animation_uuid: scope.animation_uuid,
      bone_ids: [scope.bone_uuid],
      channel: scope.channel,
      time_range: scope.time_range,
    };
  }
  return undefined;
}

export function downstreamRechecksForFreshness(input: {
  /** Canonical UV apply must use the same receipt proof as Graph readiness. */
  capability?: string;
  stale: readonly ControlFreshnessScope[];
  currentDomain: ControlAuthoringDomain;
  result?: unknown;
  /** Optional verified scope from the same Control Delta invocation. */
  verificationScope?: ControlVerificationScope | null;
}): {
  required: ControlDownstreamRecheck[];
  preserved_domains: ControlAuthoringDomain[];
} {
  // Candidate resolution is request-local and lazy. No receipt interpretation
  // is needed for scopes that have no targeted recheck extractor.
  let candidates: Record<string, unknown>[] | undefined;
  const currentCandidates = (): readonly Record<string, unknown>[] =>
    candidates ?? (candidates = resultCandidates(input.result));
  // UV and mapped Texture commonly appear together: do not re-extract the
  // same UV target twice or lose the texture-region fallback.
  let uvTargetResolved = false;
  let uvTarget: ControlDownstreamRecheck["target"] | undefined;
  let uvAttempted = false;
  const sharedUvTarget = () => {
    if (!uvTargetResolved) {
      uvTargetResolved = true;
      if (input.capability === "manage_uv_layout" &&
          input.stale.includes("UV_MAPPING") &&
          !uvAppliedPlanReceiptSchema.safeParse(input.result).success) {
        // A malformed/partial native UV apply cannot narrow Texture/Seam
        // rechecks even if it contains believable Cube or face IDs.
        // Graph readiness uses this same source validator. No fallback to
        // an unrelated Texture rectangle when UV evidence is suspect.
        uvAttempted = true;
        return undefined;
      }
      const observation = uvTargetFromCandidates(
        currentCandidates(), input.stale.includes("UV_MAPPING")
      );
      uvTarget = observation.target;
      uvAttempted = observation.attempted;
    }
    return uvTarget;
  };

  const required = [...new Set(input.stale)]
    .map((scope) => {
      const dependency = assetDependencyForScope(scope);
      const target =
        scope === "UV_MAPPING"
          ? sharedUvTarget()
          : scope === "TEXTURE_APPEARANCE"
            ? sharedUvTarget() ??
              (uvAttempted ? undefined
                : input.verificationScope?.kind === "TEXTURE_REGION"
                  ? targetFromVerificationScope(input.verificationScope)
                  : textureRegionTargetFromCandidates(currentCandidates()))
            : scope === "MATERIAL_RENDER"
              ? materialRenderTargetFromCandidates(currentCandidates())
              : scope === "ANIMATION_MOTION"
                ? (input.verificationScope?.kind === "ANIMATION_RANGE"
                    ? targetFromVerificationScope(input.verificationScope)
                    : animationMotionTargetFromCandidates(currentCandidates()))
                : scope === "ANIMATION_CONTROLLER"
                  ? animationControllerTargetFromCandidates(currentCandidates())
                  : scope === "ANIMATION_EFFECTS"
                    ? animationEffectsTargetFromCandidates(currentCandidates())
                    : undefined;
      return {
        scope,
        domain: dependency.domain,
        action: dependency.recheck,
        reason: dependency.reason,
        ...(target ? { target } : {}),
      };
    })
    .sort(
      (left, right) =>
        left.domain.localeCompare(right.domain) ||
        left.scope.localeCompare(right.scope)
    );

  const affectedDomains = new Set(required.map((entry) => entry.domain));
  const all: AssetDependencyDomain[] = [
    "GEOMETRY",
    "TEXTURING",
    "ANIMATION",
  ];
  const preserved = all.filter(
    (domain) =>
      domain !== input.currentDomain && !affectedDomains.has(domain)
  );

  return {
    required,
    preserved_domains: preserved,
  };
}

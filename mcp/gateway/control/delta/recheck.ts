import {
  assetDependencyForScope,
  type AssetDependencyDomain,
  type AssetDependencyRecheckAction,
} from "../../../lib/authoring/assetDependencyGraph";
import type {
  ControlAuthoringDomain,
  ControlFreshnessScope,
} from "../types";
import { record, resultCandidates } from "./receipts";

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

function uvTargetFromCandidates(candidates: readonly Record<string, unknown>[]): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    const receipt = record(candidate.receipt) ?? candidate;
    const cubeIds = Array.isArray(receipt.changed_cube_ids)
      ? receipt.changed_cube_ids.filter((value): value is string => typeof value === "string")
      : [];
    const islandIds = Array.isArray(receipt.changed_island_ids)
      ? receipt.changed_island_ids.filter((value): value is string => typeof value === "string")
      : [];
    const faces = Array.isArray(receipt.changed_faces)
      ? receipt.changed_faces.flatMap((value) => {
          const face = record(value);
          return typeof face?.cube_uuid === "string" &&
            (typeof face.face === "string" || face.face === null)
            ? [{ cube_uuid: face.cube_uuid, face: face.face as string | null }]
            : [];
        })
      : [];
    if (cubeIds.length || islandIds.length || faces.length) {
      return {
        ...(cubeIds.length ? { cube_ids: [...new Set(cubeIds)] } : {}),
        ...(islandIds.length ? { island_ids: [...new Set(islandIds)] } : {}),
        ...(faces.length ? { faces } : {}),
      };
    }
  }
  return undefined;
}

function materialRenderTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    const changes = Array.isArray(candidate.changes) ? candidate.changes : [];
    const faces = changes.flatMap((value) => {
      const change = record(value);
      return typeof change?.cube_uuid === "string" &&
        typeof change.face === "string"
        ? [{ cube_uuid: change.cube_uuid, face: change.face }]
        : [];
    });
    if (!faces.length) continue;
    return {
      cube_ids: [...new Set(faces.map((entry) => entry.cube_uuid))],
      faces,
    };
  }
  return undefined;
}

function textureRegionTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    const texture = record(candidate.texture);
    const revision = record(candidate.revision);
    const rect = candidate.affected_rect;
    if (
      typeof texture?.uuid === "string" &&
      typeof revision?.after === "string" &&
      Array.isArray(rect) &&
      rect.length === 4 &&
      rect.every(
        (value) => typeof value === "number" && Number.isSafeInteger(value)
      )
    ) {
      return {
        texture_uuid: texture.uuid,
        affected_rect: rect as [number, number, number, number],
        revision: revision.after,
      };
    }
  }
  return undefined;
}


function animationMotionTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    const animation = record(candidate.animation);
    const bone = record(candidate.bone);
    if (typeof animation?.uuid !== "string") continue;

    if (
      typeof bone?.uuid === "string" &&
      Array.isArray(candidate.affected_keyframes)
    ) {
      const times = candidate.affected_keyframes
        .map((value) => record(value)?.time)
        .filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value)
        );
      if (times.length > 0) {
        return {
          animation_uuid: animation.uuid,
          bone_ids: [bone.uuid],
          channel:
            typeof candidate.channel === "string"
              ? candidate.channel
              : null,
          time_range: [Math.min(...times), Math.max(...times)],
        };
      }
    }

    if (
      candidate.action === "properties" &&
      Array.isArray(candidate.changed_fields)
    ) {
      return {
        animation_uuid: animation.uuid,
      };
    }
  }
  return undefined;
}


function animationEffectsTargetFromCandidates(
  candidates: readonly Record<string, unknown>[]
): ControlDownstreamRecheck["target"] | undefined {
  for (const candidate of candidates) {
    const animation = record(candidate.animation);
    const results = Array.isArray(candidate.results) ? candidate.results : [];
    if (typeof animation?.uuid !== "string" || results.length === 0) continue;

    const channels = [
      ...new Set(
        results
          .map((value) => record(value)?.channel)
          .filter((value): value is string => typeof value === "string")
      ),
    ];
    const times = results
      .map((value) => record(value)?.time)
      .filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value)
      );

    return {
      animation_uuid: animation.uuid,
      ...(channels.length ? { channels } : {}),
      ...(times.length
        ? { time_range: [Math.min(...times), Math.max(...times)] as [number, number] }
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

export function downstreamRechecksForFreshness(input: {
  stale: readonly ControlFreshnessScope[];
  currentDomain: ControlAuthoringDomain;
  result?: unknown;
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
  const sharedUvTarget = () => {
    if (!uvTargetResolved) {
      uvTargetResolved = true;
      uvTarget = uvTargetFromCandidates(currentCandidates());
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
              textureRegionTargetFromCandidates(currentCandidates())
            : scope === "MATERIAL_RENDER"
              ? materialRenderTargetFromCandidates(currentCandidates())
              : scope === "ANIMATION_MOTION"
                ? animationMotionTargetFromCandidates(currentCandidates())
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
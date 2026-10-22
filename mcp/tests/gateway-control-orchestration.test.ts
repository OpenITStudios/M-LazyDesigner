import { describe, expect, test } from "bun:test";
import {
  nextActionForControlDelta,
  reduceControlExecutionState,
} from "@/gateway/control/orchestration";
import type { ControlDelta } from "@/gateway/control/types";
import { projectControlDeltaForGateway } from "@/gateway/control/delta/projection";

function delta(
  patch: Partial<ControlDelta> = {}
): ControlDelta {
  return {
    protocol: "lazydesigner-control-v1",
    capability: "manage_cubes",
    authoring_domain: "GEOMETRY",
    source_owner: {
      source: "mcp/server/tools/geometry/cubes.ts",
      specialist: ".agents/skills/lazydesigner-modelling/SKILL.md",
      anchor_test: null,
    },
    phase_before: "geometry",
    phase_after: "geometry",
    project_uuid: "project-a",
    changed: [],
    invalidates: {
      authoring_domains: ["GEOMETRY"],
      workspace_projection: true,
      acceptance_gates: true,
    },
    freshness: {
      basis: "PRECISE_EFFECT",
      stale: ["GEOMETRY_STRUCTURE"],
      fresh: ["MATERIAL_RENDER"],
      unknown: [],
    },
    revision_evidence: {},
    next_intent: "VERIFY_OR_CONTINUE_GEOMETRY",
    verification_class: "visual",
    verification_scope: {
      kind: "CUBE_TARGETS",
      cube_uuids: ["cube-a"],
      framing: { min: [0, 0, 0], max: [4, 4, 4] },
    },
    downstream_recheck: {
      required: [
        {
          scope: "GEOMETRY_STRUCTURE",
          domain: "GEOMETRY",
          action: "REVERIFY_GEOMETRY",
          reason: "Authored geometry structure changed.",
        },
      ],
      preserved_domains: ["TEXTURING", "ANIMATION"],
    },
    requires_status_refresh: false,
    ...patch,
  };
}

describe("Control orchestration reducer", () => {
  test("single-call Control Delta and continuation agree on identity and freshness", () => {
    const outcomes: ControlDelta[] = [
      delta(),
      delta({
        freshness: {
          basis: "UNKNOWN_OUTCOME",
          stale: [],
          fresh: [],
          unknown: ["GEOMETRY_STRUCTURE", "UV_MAPPING"],
        },
      }),
      delta({
        freshness: {
          basis: "NO_CHANGE",
          stale: [],
          fresh: ["GEOMETRY_STRUCTURE"],
          unknown: [],
        },
        verification_class: "receipt_only",
        verification_scope: null,
      }),
    ];

    for (const current of outcomes) {
      const publicDelta = projectControlDeltaForGateway(current);
      const { continuation } = reduceControlExecutionState(null, current);
      expect(publicDelta.project_uuid).toBe(continuation.project_uuid);
      expect(publicDelta.authoring_domain).toBe(continuation.owner);
      expect(publicDelta.freshness.basis).toBe(continuation.freshness.basis);
      expect(
        "stale" in publicDelta.freshness ? publicDelta.freshness.stale : []
      ).toEqual(continuation.freshness.stale);
      expect(
        "unknown" in publicDelta.freshness ? publicDelta.freshness.unknown : []
      ).toEqual(continuation.freshness.unknown);
    }
  });

  test("cohort continuation may aggregate earlier stale scopes without rewriting latest delta", () => {
    const prior = delta({
      freshness: {
        basis: "PRECISE_EFFECT",
        stale: ["GEOMETRY_STRUCTURE"],
        fresh: [],
        unknown: [],
      },
    });
    const later = delta({
      freshness: {
        basis: "PRECISE_EFFECT",
        stale: ["UV_MAPPING"],
        fresh: [],
        unknown: [],
      },
    });
    const options = { taskContextId: "edit-batch-a", cohortBoundary: "CONTINUE" as const };
    const first = reduceControlExecutionState(null, prior, options);
    const second = reduceControlExecutionState(first.state, later, options);
    const publicDelta = projectControlDeltaForGateway(later);
    expect(publicDelta.freshness).toEqual({
      basis: "PRECISE_EFFECT",
      stale: ["UV_MAPPING"],
    });
    expect(second.continuation.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
      "UV_MAPPING",
    ]);
    expect(second.continuation.cohort?.deferred).toBe(true);
    expect(second.continuation.next_action.kind).toBe("CONTINUE");
  });

  test("turns scoped geometry visual verification into an explicit next action", () => {
    const action = nextActionForControlDelta(delta());
    expect(action.kind).toBe("VERIFY_VISUAL");
    expect(action.recommended_capability).toBe("capture_model_views");
  });

  test("never converts unknown mutation outcome into an automatic retry", () => {
    const action = nextActionForControlDelta(
      delta({
        freshness: {
          basis: "UNKNOWN_OUTCOME",
          stale: [],
          fresh: [],
          unknown: ["GEOMETRY_STRUCTURE", "UV_MAPPING"],
        },
      })
    );
    expect(action.kind).toBe("RECOVER");
    expect(action.recommended_capability).toBeNull();
  });

  test("resets revision on project change and increments inside one project", () => {
    const first = reduceControlExecutionState(null, delta());
    const second = reduceControlExecutionState(first.state, delta());
    const third = reduceControlExecutionState(
      second.state,
      delta({ project_uuid: "project-b" })
    );
    expect(first.state.revision).toBe(1);
    expect(second.state.revision).toBe(2);
    expect(third.state.revision).toBe(1);
  });

  test("phase authority changes require reorientation", () => {
    const reduced = reduceControlExecutionState(
      null,
      delta({
        capability: "switch_authoring_phase",
        phase_before: "geometry",
        phase_after: "animation",
        changed: ["authoring_phase"],
        requires_status_refresh: true,
        verification_class: "receipt_only",
      })
    );
    expect(reduced.continuation.next_action.kind).toBe("STATUS");
    expect(reduced.continuation.context.reorient_required).toBe(true);
  });
});

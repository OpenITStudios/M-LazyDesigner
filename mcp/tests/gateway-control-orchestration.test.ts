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

  test("a single Cube edit owes visual review but never triggers per-Cube capture", () => {
    const action = nextActionForControlDelta(delta());
    expect(action.kind).toBe("VERIFY_VISUAL");
    expect(action.recommended_capability).toBeNull();
    expect(action.reason).toContain("Do not capture per Cube");
    const oneShot = reduceControlExecutionState(null, delta(), {
      taskContextId: "one-shot", cohortBoundary: "COMPLETE",
    });
    expect(oneShot.continuation.next_action.recommended_capability).toBeNull();
  });

  test("explicit completed Geometry cohort suggests one bounded capture only at its final material gate", () => {
    const first = reduceControlExecutionState(null, delta(), {
      taskContextId: "form-assembly", cohortBoundary: "CONTINUE",
    });
    expect(first.continuation.next_action.kind).toBe("CONTINUE");
    expect(first.continuation.next_action.recommended_capability).toBeNull();

    const next = reduceControlExecutionState(first.state, delta({
      verification_scope: {
        kind: "CUBE_TARGETS",
        cube_uuids: ["cube-b"],
        framing: { min: [4, 0, 0], max: [8, 4, 4] },
      },
    }), { taskContextId: "form-assembly", cohortBoundary: "CONTINUE" });
    expect(next.continuation.next_action.kind).toBe("CONTINUE");

    // The final call has no new visual requirement. It must not erase the
    // prior two Cube edits' deferred visual review.
    const finished = reduceControlExecutionState(next.state, delta({
      verification_class: "receipt_only",
      verification_scope: null,
      freshness: {
        basis: "NO_CHANGE", stale: [],
        fresh: ["GEOMETRY_STRUCTURE"], unknown: [],
      },
    }), { taskContextId: "form-assembly", cohortBoundary: "COMPLETE" });
    expect(finished.continuation.next_action).toMatchObject({
      kind: "VERIFY_VISUAL",
      recommended_capability: "capture_model_views",
      verification_scope: {
        kind: "CUBE_TARGETS",
        cube_uuids: ["cube-a", "cube-b"],
        framing: { min: [0, 0, 0], max: [8, 4, 4] },
      },
    });
    expect(finished.state.pending_action)
      .toEqual(finished.continuation.next_action);
    expect(finished.continuation.next_action.reason).toContain("approved source");
    expect(finished.continuation.next_action.reason).toContain("front_direction");
    expect(finished.continuation.next_action.reason).toContain("evidence_targets");
    expect(finished.state.pending_verification).toBeNull();

    // Reusing the task ID after completion is not an open cohort: do not
    // manufacture a second capture recommendation for a one-call mutation.
    const repeated = reduceControlExecutionState(
      finished.state, delta(),
      { taskContextId: "form-assembly", cohortBoundary: "COMPLETE" }
    );
    expect(repeated.continuation.next_action.recommended_capability).toBeNull();
  });

  test("a receipt-only precursor does not turn one later Cube edit into a cohort capture", () => {
    const first = reduceControlExecutionState(null, delta({
      verification_class: "receipt_only",
      verification_scope: null,
      freshness: {
        basis: "NO_CHANGE", stale: [], fresh: ["GEOMETRY_STRUCTURE"],
        unknown: [],
      },
    }), { taskContextId: "mixed-cohort", cohortBoundary: "CONTINUE" });
    expect(first.continuation.next_action.kind).toBe("CONTINUE");
    expect(first.state.pending_verification).toMatchObject({
      verification_class: "receipt_only", verification_scope: null,
    });
    const final = reduceControlExecutionState(first.state, delta(), {
      taskContextId: "mixed-cohort", cohortBoundary: "COMPLETE",
    });
    expect(final.continuation.next_action.kind).toBe("VERIFY_VISUAL");
    expect(final.continuation.next_action.recommended_capability).toBeNull();
    expect(final.state.pending_action).toEqual(final.continuation.next_action);
  });

  test("a different previous owner cannot authorize Geometry's capture hint", () => {
    const previous = reduceControlExecutionState(null, delta({
      authoring_domain: "TEXTURING",
    }), { taskContextId: "cross-domain", cohortBoundary: "CONTINUE" });
    const final = reduceControlExecutionState(previous.state, delta(), {
      taskContextId: "cross-domain", cohortBoundary: "COMPLETE",
    });
    expect(final.continuation.next_action.kind).toBe("VERIFY_VISUAL");
    expect(final.continuation.next_action.recommended_capability).toBeNull();
  });

  test("unscoped, uncertain, and cross-project cohorts never advertise capture", () => {
    const first = reduceControlExecutionState(null, delta(), {
      taskContextId: "visual-batch", cohortBoundary: "CONTINUE",
    });
    const finishedUnscoped = reduceControlExecutionState(first.state, delta({
      verification_scope: null,
    }), { taskContextId: "visual-batch", cohortBoundary: "COMPLETE" });
    // A later unscoped visual edit broadens verification, so the scoped
    // earlier Cube evidence cannot justify a targeted capture hint.
    expect(finishedUnscoped.continuation.next_action.kind).toBe("VERIFY_VISUAL");
    expect(finishedUnscoped.continuation.next_action.recommended_capability).toBeNull();
    const unscopedStart = reduceControlExecutionState(null, delta({
      verification_scope: null,
    }), { taskContextId: "unscoped", cohortBoundary: "CONTINUE" });
    const unscopedEnd = reduceControlExecutionState(unscopedStart.state, delta({
      verification_scope: null,
    }), { taskContextId: "unscoped", cohortBoundary: "COMPLETE" });
    expect(unscopedEnd.continuation.next_action.recommended_capability).toBeNull();

    const uncertain = reduceControlExecutionState(first.state, delta({
      freshness: {
        basis: "UNKNOWN_OUTCOME", stale: [], fresh: [],
        unknown: ["GEOMETRY_STRUCTURE"],
      },
    }), { taskContextId: "visual-batch", cohortBoundary: "COMPLETE" });
    expect(uncertain.continuation.next_action.kind).toBe("RECOVER");
    expect(uncertain.continuation.next_action.recommended_capability).toBeNull();

    const projectChanged = reduceControlExecutionState(first.state, delta({
      project_uuid: "project-b",
    }), { taskContextId: "visual-batch", cohortBoundary: "COMPLETE" });
    expect(projectChanged.continuation.next_action.recommended_capability).toBeNull();
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

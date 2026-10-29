import { describe, expect, test } from "bun:test";
import {
  buildControlDelta,
  reduceControlExecutionState,
} from "@/gateway/control";

function cubeEffect(field: string) {
  return {
    changed_fields: [field],
    center_delta: [0, 0, 0],
    size_delta: [0, 0, 0],
    origin_delta: [0, 0, 0],
    rotation_delta: [0, 0, 0],
    inflate_delta: 0,
    uv_offset_delta: [0, 0],
    mirror_uv_changed: false,
    autouv_changed: false,
    visibility_changed: false,
    faces_changed: false,
  };
}

function cubeDelta(id: string, field: string, min: number, max: number) {
  return buildControlDelta({
    capability: "manage_cubes",
    phaseBefore: "geometry",
    phaseAfter: "geometry",
    projectUuid: "project-a",
    succeeded: true,
    result: {
      execution: "applied",
      visual_verdict: "not_evaluated",
      modified: 1,
      geometry_effect: cubeEffect(field),
      visual_scope: {
        cube_uuids: [id],
        framing: { min: [min, 0, min], max: [max, 2, max] },
      },
    },
  });
}

function textureDelta(
  rect: [number, number, number, number] | null,
  revision: string,
  returnImage = true
) {
  return buildControlDelta({
    capability: "paint_texture_transaction",
    phaseBefore: "texturing",
    phaseAfter: "texturing",
    projectUuid: "project-a",
    succeeded: true,
    result: {
      execution: "applied",
      texture: { uuid: "atlas-a", name: "atlas" },
      revision: { before: "sha256:prior", after: revision },
      operation_count: 1,
      pixel_writes: 4,
      ...(rect ? { affected_rect: rect,
        affected_size: [rect[2] - rect[0], rect[3] - rect[1]] } : {}),
      visual_evidence: rect && returnImage ? {
        kind: "affected_region_png", affected_rect: rect, revision,
        width: rect[2] - rect[0], height: rect[3] - rect[1],
      } : null,
    },
  });
}

describe("Control verification cohort", () => {
  test("default COMPLETE behavior keeps one-call verification semantics", () => {
    const delta = cubeDelta("cube-a", "rotation", -1, 1);
    const result = reduceControlExecutionState(null, delta);

    expect(result.continuation.next_action.kind).toBe("VERIFY_VISUAL");
    expect(result.continuation).not.toHaveProperty("cohort");
    expect(result.state.pending_verification).toBeNull();
  });

  test("CONTINUE defers verification and COMPLETE merges affected cube scope", () => {
    const first = reduceControlExecutionState(
      null,
      cubeDelta("cube-a", "rotation", -1, 1),
      { taskContextId: "task-1", cohortBoundary: "CONTINUE" }
    );

    expect(first.continuation.next_action.kind).toBe("CONTINUE");
    expect(first.continuation.cohort).toMatchObject({
      task_context_id: "task-1",
      boundary: "CONTINUE",
      deferred: true,
      pending_verification_class: "visual",
    });

    const second = reduceControlExecutionState(
      first.state,
      cubeDelta("cube-b", "from", 2, 5),
      { taskContextId: "task-1", cohortBoundary: "COMPLETE" }
    );

    expect(second.continuation.next_action.kind).toBe("VERIFY_VISUAL");
    expect(second.continuation.next_action.verification_scope).toEqual({
      kind: "CUBE_TARGETS",
      cube_uuids: ["cube-a", "cube-b"],
      framing: { min: [-1, 0, -1], max: [5, 2, 5] },
    });
    expect(second.continuation.freshness.stale).toEqual(
      expect.arrayContaining([
        "GEOMETRY_STRUCTURE",
        "UV_MAPPING",
        "TEXTURE_APPEARANCE",
        "ANIMATION_MOTION",
      ])
    );
    expect(second.state.pending_verification).toBeNull();
  });

  test("different cropped texture images cannot silently certify a merged final revision", () => {
    const first = reduceControlExecutionState(
      null,
      textureDelta([1, 2, 3, 4], "sha256:rev-1"),
      { taskContextId: "texture-cohort", cohortBoundary: "CONTINUE" }
    );
    expect(first.continuation.next_action.kind).toBe("CONTINUE");

    const completed = reduceControlExecutionState(
      first.state,
      textureDelta([10, 12, 14, 16], "sha256:rev-2"),
      { taskContextId: "texture-cohort", cohortBoundary: "COMPLETE" }
    );
    expect(completed.continuation.next_action).toMatchObject({
      kind: "VERIFY_VISUAL",
      recommended_capability: "get_texture",
      verification_scope: {
        kind: "TEXTURE_REGION",
        affected_rect: [1, 2, 14, 16],
        revision: "sha256:rev-2",
        evidence_source: "follow_up_read",
      },
    });
    expect(completed.state.pending_verification).toBeNull();
  });

  test("the latest full-cover texture image can replace another read safely", () => {
    const first = reduceControlExecutionState(
      null,
      textureDelta([3, 3, 5, 5], "sha256:rev-1"),
      { taskContextId: "texture-cohort", cohortBoundary: "CONTINUE" }
    );
    const completed = reduceControlExecutionState(
      first.state,
      textureDelta([2, 1, 8, 9], "sha256:rev-2"),
      { taskContextId: "texture-cohort", cohortBoundary: "COMPLETE" }
    );
    expect(completed.continuation.next_action).toMatchObject({
      kind: "REVIEW_RETURNED_EVIDENCE",
      verification_scope: {
        affected_rect: [2, 1, 8, 9],
        revision: "sha256:rev-2",
        evidence_source: "mutation_response",
      },
    });
  });

  test("unknown visual scope on either cohort side cannot inherit narrow proof", () => {
    for (const unboundedFirst of [true, false]) {
      const first = reduceControlExecutionState(
        null,
        textureDelta(unboundedFirst ? null : [2, 2, 4, 4], "sha256:rev-1"),
        { taskContextId: "texture-cohort", cohortBoundary: "CONTINUE" }
      );
      const completed = reduceControlExecutionState(
        first.state,
        textureDelta(unboundedFirst ? [5, 5, 7, 7] : null, "sha256:rev-2"),
        { taskContextId: "texture-cohort", cohortBoundary: "COMPLETE" }
      );
      expect(completed.continuation.next_action).toMatchObject({
        kind: "VERIFY_VISUAL",
        verification_scope: null,
      });
    }
  });

  test("different task_context_id never inherits pending verification", () => {
    const first = reduceControlExecutionState(
      null,
      cubeDelta("cube-a", "rotation", -1, 1),
      { taskContextId: "task-1", cohortBoundary: "CONTINUE" }
    );
    const second = reduceControlExecutionState(
      first.state,
      cubeDelta("cube-b", "visibility", 3, 4),
      { taskContextId: "task-2", cohortBoundary: "COMPLETE" }
    );

    expect(second.continuation.next_action.verification_scope).toMatchObject({
      kind: "CUBE_TARGETS",
      cube_uuids: ["cube-b"],
    });
    expect(second.continuation.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
    ]);
  });

  test("hard boundaries cannot defer uncertain mutation recovery", () => {
    const failed = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: false,
    });
    const result = reduceControlExecutionState(null, failed, {
      taskContextId: "task-1",
      cohortBoundary: "CONTINUE",
    });

    expect(result.continuation.next_action.kind).toBe("RECOVER");
    expect(result.continuation.cohort?.deferred).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { manifestEntryForBranch } from "@/gateway/capabilities/manifest";
import { buildControlDelta } from "@/gateway/control";
import {
  isUvAppliedPlanReceipt,
  isUvUsablePlanReceipt,
} from "@/lib/uv/receipt";

describe("UV plan/apply branch semantics", () => {
  test("usable plan receipt requires both source identity and an unblocked report", () => {
    const candidate = {
      plan_id: "uvplan:" + "a".repeat(64),
      source_fingerprint: "sha256:" + "b".repeat(64),
      report: {
        schema: 1,
        execution: "planned",
        apply_allowed: true,
        hard_violations: [],
      },
    };
    expect(isUvUsablePlanReceipt(candidate)).toBe(true);
    expect(isUvUsablePlanReceipt({
      ...candidate, report: {...candidate.report, apply_allowed: false},
    })).toBe(false);
    expect(isUvUsablePlanReceipt({
      ...candidate, report: {...candidate.report, hard_violations: ["invalid UV"]},
    })).toBe(false);
    expect(isUvUsablePlanReceipt({...candidate, plan_id:"uvplan:malformed"}))
      .toBe(false);
    expect(isUvUsablePlanReceipt({
      ...candidate, source_fingerprint: "sha256:broken",
    })).toBe(false);
  });

  test("apply receipt must identify the requested source revision", () => {
    const request = {
      plan_id: "uvplan:" + "a".repeat(64),
      expected_source_fingerprint: "sha256:" + "b".repeat(64),
    };
    const candidate = {
      receipt: {
        schema: 1,
        source_fingerprint_before: request.expected_source_fingerprint,
        source_fingerprint_after: "sha256:" + "c".repeat(64),
        changed_island_ids: ["face:cube-a:north"],
        changed_cube_ids: ["cube-a"],
        changed_faces: [{ cube_uuid: "cube-a", face: "north" }],
        moved: [{
          island_id: "face:cube-a:north",
          before: { x: 0, y: 0, width: 4, height: 4 },
          after: { x: 4, y: 0, width: 4, height: 4 },
          rotated_90: false,
        }],
      },
    };
    expect(isUvAppliedPlanReceipt(candidate, request)).toBe(true);
    expect(isUvAppliedPlanReceipt({
      receipt: { ...candidate.receipt, changed_island_ids: [] },
    }, request)).toBe(false);
    expect(isUvAppliedPlanReceipt({
      receipt: { ...candidate.receipt, changed_cube_ids: [] },
    }, request)).toBe(false);
    expect(isUvAppliedPlanReceipt({
      receipt: { ...candidate.receipt, moved: [] },
    }, request)).toBe(false);
    expect(isUvAppliedPlanReceipt({
      receipt: {
        ...candidate.receipt,
        source_fingerprint_after: candidate.receipt.source_fingerprint_before,
      },
    }, request)).toBe(false);
    expect(isUvAppliedPlanReceipt(candidate, {
      ...request, expected_source_fingerprint: "sha256:" + "d".repeat(64),
    })).toBe(false);
    expect(isUvAppliedPlanReceipt(candidate, {
      ...request, plan_id: "missing",
    })).toBe(false);
    expect(isUvAppliedPlanReceipt({ receipt: { schema: 1 } }, request)).toBe(false);

    const badReceipts = [
      { changed_island_ids: ["face:cube-a:north", "face:cube-a:north"] },
      { changed_island_ids: ["face:cube-b:north"] },
      { moved: [{ ...candidate.receipt.moved[0], island_id: "different-island" }] },
      { moved: [...candidate.receipt.moved, candidate.receipt.moved[0]] },
      { changed_cube_ids: ["cube-a", "cube-a"] },
      { changed_cube_ids: ["cube-b"] },
      { changed_faces: [] },
      { changed_faces: [{ cube_uuid: "cube-b", face: "north" }] },
      { changed_faces: [{ cube_uuid: "cube-a", face: "front" }] },
      { changed_faces: [
        candidate.receipt.changed_faces[0], candidate.receipt.changed_faces[0],
      ] },
      { moved: [{ ...candidate.receipt.moved[0],
        before: { x: 0, y: 0, width: 0, height: 4 } }] },
      { moved: [{ ...candidate.receipt.moved[0],
        after: candidate.receipt.moved[0].before }] },
      { moved: [{ island_id: "face:cube-a:north" }] },
    ];
    for (const malformed of badReceipts) {
      expect(
        isUvAppliedPlanReceipt({ receipt: { ...candidate.receipt, ...malformed } }, request),
        JSON.stringify(malformed)
      ).toBe(false);
    }

    // A 90-degree native turn on a square region may keep the same bounds;
    // the explicit rotation is still an authored UV change.
    expect(isUvAppliedPlanReceipt({
      receipt: {
        ...candidate.receipt,
        moved: [{ ...candidate.receipt.moved[0],
          after: candidate.receipt.moved[0].before, rotated_90: true }],
      },
    }, request)).toBe(true);
  });

  test("plan is workflow CONTROL while apply is authored MUTATION", () => {
    expect(
      manifestEntryForBranch("manage_uv_layout", {
        field: "operation",
        value: "plan",
      })
    ).toMatchObject({
      operationClass: "CONTROL",
      verificationClass: "not_applicable",
    });

    expect(
      manifestEntryForBranch("manage_uv_layout", {
        field: "operation",
        value: "apply",
      })
    ).toMatchObject({
      operationClass: "MUTATION",
      verificationClass: "visual",
    });
  });

  test("planning does not invalidate authored UV or texture evidence", () => {
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "plan" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        plan_id: "uvplan:" + "a".repeat(64),
        source_fingerprint: "sha256:" + "b".repeat(64),
        report: { apply_allowed: true },
      },
    });

    expect(delta.freshness.basis).toBe("NO_CHANGE");
    expect(delta.freshness.stale).toEqual([]);
    expect(delta.invalidates.authoring_domains).toEqual([]);
    expect(delta.invalidates.acceptance_gates).toBe(false);
    expect(delta.verification_class).toBe("not_applicable");
  });

  test("apply keeps normal authored invalidation", () => {
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "apply" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        receipt: {
          changed_island_ids: ["face:a:north"],
        },
      },
    });

    expect(delta.freshness.basis).not.toBe("NO_CHANGE");
    expect(delta.freshness.stale).toEqual([
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
    ]);
    expect(delta.invalidates.authoring_domains).toEqual(["TEXTURING"]);
  });
});

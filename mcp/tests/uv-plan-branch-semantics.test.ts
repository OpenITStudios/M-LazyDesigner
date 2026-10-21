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
        moved: [{ island_id: "face:cube-a:north" }],
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

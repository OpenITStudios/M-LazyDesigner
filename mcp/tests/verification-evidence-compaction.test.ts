import { describe, expect, test } from "bun:test";
import { compileVerificationEvidenceRequests, type VerificationEvidenceRequest } from "@/lib/orchestration/evidencePlan";
import { VerificationEvidenceRegistry } from "@/lib/orchestration/evidenceRegistry";
import {
  compactVerificationEvidence,
  diagnoseMinecraftDiscrepancy,
  minecraftQualityFocus,
  prioritizeMinecraftDiscrepancies,
  selectMinecraftEvidenceNeed,
  type VerificationDiscrepancy,
} from "@/lib/orchestration/compactEvidence";
import type { VerificationTask } from "@/lib/orchestration/verificationPlan";
import { compileDeltaVerificationPlan } from "@/lib/orchestration/deltaVerification";

describe("verification evidence compaction", () => {
  test.each([false, true])("UV full_replan=%s stays unavailable and cannot compact to CLEAR", (fullReplan) => {
    const islandIds = fullReplan ? [] : ["arm:0:north"];
    const [request] = compileVerificationEvidenceRequests([
      { domain: "UV", kind: "UV_ISLAND_SCOPE", island_ids: islandIds, full_replan: fullReplan },
    ], "HIGH");
    expect(request).toEqual({
      domain: "UV",
      source: null,
      availability: "UNAVAILABLE",
      reason: "UV_CAPABILITY_UNREGISTERED",
      island_ids: islandIds,
      full_replan: fullReplan,
    });
    expect(compactVerificationEvidence(request, "verificationevidence:uv-unavailable", []))
      .toMatchObject({ domain: "UV", source: null, state: "BLOCKED", discrepancy_count: 0 });
  });

  test("mixed delta plan retains mandatory UV and executable evidence for all other domains", () => {
    const plan = compileDeltaVerificationPlan({
      geometry: { upsert_instance_ids: ["arm:0"], remove_instance_ids: [], metadata_only_instance_ids: [], preserved_instance_ids: [] },
      uv: { stale: true, affected_island_ids: ["arm:0:north"], scope: "AFFECTED_ONLY" },
      rig: { stale: true, affected_instance_ids: ["arm:0"], scope: "AFFECTED_ONLY" },
      animation: { stale: true, affected_instance_ids: ["arm:0"], scope: "AFFECTED_ONLY" },
      texture: { stale: true, reason: "UV_CHANGED", scope: "AFFECTED_SURFACES" },
      symmetry_changed_relation_ids: [],
    });
    expect(plan.required_task_count).toBe(5);
    expect(plan.tasks.map((task) => task.domain)).toEqual(["GEOMETRY", "UV", "RIG", "ANIMATION", "TEXTURE"]);
    expect(plan.evidence_requests.map((request) => request.source)).toEqual([
      "capture_model_views", null, "inspect_elements", "inspect_animation", "get_texture",
    ]);
    expect(plan.evidence_requests[1]).toMatchObject({ availability: "UNAVAILABLE", reason: "UV_CAPABILITY_UNREGISTERED" });
    for (const request of plan.evidence_requests.filter((request) => request.source !== null)) {
      expect(compactVerificationEvidence(request, "verificationevidence:available", []).state).toBe("CLEAR");
    }
  });

  test("low-risk geometry verification requests one focused 256 view", () => {
    const tasks: VerificationTask[] = [
      { domain: "GEOMETRY", kind: "CUBE_SCOPE", instance_ids: ["arm:0"] },
    ];
    const requests = compileVerificationEvidenceRequests(tasks, "LOW");
    expect(requests).toEqual([
      {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arm:0"],
      },
    ]);
  });

  test("affected texture verification stays region-scoped", () => {
    const tasks: VerificationTask[] = [
      { domain: "TEXTURE", kind: "TEXTURE_SCOPE", mode: "AFFECTED_SURFACES" },
    ];
    const requests = compileVerificationEvidenceRequests(tasks, "MEDIUM");
    expect(requests[0]).toEqual({
      domain: "TEXTURE",
      source: "get_texture",
      mode: "AFFECTED_SURFACES",
      inspection: "region",
    });
  });

  test("full evidence remains local while model-facing discrepancy output stays bounded", () => {
    const registry = new VerificationEvidenceRegistry();
    const request: VerificationEvidenceRequest = {
      domain: "GEOMETRY",
      source: "capture_model_views",
      verification_risk: "LOW",
      views: ["front"],
      views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
      size: 256,
      size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
      scope_instance_ids: ["arm:0"],
    };
    const result = { png_data_url: "data:image/png;base64," + "x".repeat(5000) };
    const handle = registry.put({ request, result });
    const discrepancies: VerificationDiscrepancy[] = Array.from(
      { length: 10 },
      (_, index) => ({
        code: "D" + index,
        severity: index === 9 ? "BLOCKING" : "REVIEW",
        summary: "issue " + index,
        views: index === 0 ? ["front"] : undefined,
        evidence_targets: index === 0 ? ["width"] : undefined,
      })
    );
    const compact = compactVerificationEvidence(request, handle, discrepancies);

    expect(compact.state).toBe("BLOCKED");
    expect(compact.discrepancy_count).toBe(10);
    expect(compact.discrepancies).toHaveLength(6);
    expect(compact.discrepancies[0]).toMatchObject({ code: "D9", severity: "BLOCKING" });
    expect(compact.discrepancies.find((entry) => entry.code === "D0")).toMatchObject({
      views: ["front"],
      evidence_targets: ["width"],
    });
    expect(JSON.stringify(compact)).not.toContain("base64");
    expect(registry.get(handle).result).toEqual(result);
  });

  test("Minecraft quality critic prioritizes explicit structural causes without guessing from prose", () => {
    const discrepancies: VerificationDiscrepancy[] = [
      {
        code: "DETAIL",
        severity: "REVIEW",
        summary: "small decorative difference",
        quality_class: "SECONDARY_DETAIL",
        owner: "GEOMETRY",
      },
      {
        code: "LEG_MISSING",
        severity: "REVIEW",
        summary: "required leg absent in the approved reference comparison",
        quality_class: "REQUIRED_PART",
        owner: "GEOMETRY",
        cause_family: "MISSING_REQUIRED_PART",
        views: ["front", "left"],
        evidence_targets: ["silhouette"],
      },
      {
        code: "FREE_TEXT_ONLY",
        severity: "REVIEW",
        summary: "looks like something may be wrong",
      },
    ];

    const prioritized = prioritizeMinecraftDiscrepancies(discrepancies);
    expect(prioritized.map((item) => item.code)).toEqual([
      "LEG_MISSING",
      "DETAIL",
      "FREE_TEXT_ONLY",
    ]);
    expect(minecraftQualityFocus(discrepancies)).toEqual({
      code: "LEG_MISSING",
      severity: "REVIEW",
      quality_class: "REQUIRED_PART",
      owner: "GEOMETRY",
      cause_family: "MISSING_REQUIRED_PART",
      repair_route: "ADD_MASS",
      evidence_backed_cause: true,
      evidence_need: null,
      views: ["front", "left"],
      evidence_targets: ["silhouette"],
    });
  });

  test("blocking severity still outranks lower-severity structural category", () => {
    const prioritized = prioritizeMinecraftDiscrepancies([
      {
        code: "REQUIRED_REVIEW",
        severity: "REVIEW",
        summary: "required part mismatch",
        quality_class: "REQUIRED_PART",
        owner: "GEOMETRY",
      },
      {
        code: "UNCLASSIFIED_BLOCKER",
        severity: "BLOCKING",
        summary: "explicit blocker from evidence producer",
      },
    ]);
    expect(prioritized.map((item) => item.code)).toEqual([
      "UNCLASSIFIED_BLOCKER",
      "REQUIRED_REVIEW",
    ]);
    expect(minecraftQualityFocus(prioritized)?.quality_class).toBe(
      "UNCLASSIFIED"
    );
    expect(minecraftQualityFocus(prioritized)?.owner).toBe("UNKNOWN");
    expect(minecraftQualityFocus(prioritized)?.repair_route).toBe(
      "MORE_EVIDENCE"
    );
    expect(minecraftQualityFocus(prioritized)?.evidence_need).toEqual({
      action: "CLASSIFY_CAUSE",
      capability: null,
    });
  });

  test("uncertain geometry asks runtime for minimum target-driven visual evidence", () => {
    const discrepancy: VerificationDiscrepancy = {
      code: "DEPTH_UNKNOWN",
      severity: "REVIEW",
      summary: "depth cause remains unresolved",
      owner: "GEOMETRY",
      evidence_targets: ["depth", "attachment"],
    };

    expect(selectMinecraftEvidenceNeed(discrepancy, "MEDIUM")).toEqual({
      action: "CAPTURE_VISUAL_EVIDENCE",
      capability: "capture_model_views",
      evidence_targets: ["depth", "attachment"],
      verification_risk: "MEDIUM",
      selection: "RUNTIME_MINIMUM_TARGET_COVERAGE",
    });
    expect(minecraftQualityFocus([discrepancy], "MEDIUM")?.evidence_need).toEqual({
      action: "CAPTURE_VISUAL_EVIDENCE",
      capability: "capture_model_views",
      evidence_targets: ["depth", "attachment"],
      verification_risk: "MEDIUM",
      selection: "RUNTIME_MINIMUM_TARGET_COVERAGE",
    });
  });

  test("uncertain specialist-owned causes request focused existing inspection paths", () => {
    expect(
      selectMinecraftEvidenceNeed({
        code: "PIVOT_UNKNOWN",
        severity: "REVIEW",
        summary: "pivot cause not yet proven",
        owner: "RIG",
      })
    ).toEqual({
      action: "INSPECT_RIG_STATE",
      capability: "inspect_elements",
    });
    expect(
      selectMinecraftEvidenceNeed({
        code: "MATERIAL_UNKNOWN",
        severity: "REVIEW",
        summary: "material cause not yet proven",
        owner: "TEXTURE",
      })
    ).toEqual({
      action: "INSPECT_TEXTURE_STATE",
      capability: "get_texture",
    });
    expect(
      selectMinecraftEvidenceNeed({
        code: "MOTION_UNKNOWN",
        severity: "REVIEW",
        summary: "motion cause not yet proven",
        owner: "ANIMATION",
      })
    ).toEqual({
      action: "INSPECT_ANIMATION_STATE",
      capability: "inspect_animation",
    });
  });

  test("causal diagnosis maps only explicit evidence-backed causes to repair routes", () => {
    expect(
      diagnoseMinecraftDiscrepancy({
        code: "TORSO_WIDE",
        severity: "REVIEW",
        summary: "torso width differs from reference",
        quality_class: "PRIMARY_FORM",
        owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH",
      })
    ).toEqual({
      evidence_backed: true,
      owner: "GEOMETRY",
      cause_family: "SIZE_MISMATCH",
      repair_route: "RESIZE",
      needs_more_evidence: false,
    });

    expect(
      diagnoseMinecraftDiscrepancy({
        code: "AMBIGUOUS",
        severity: "REVIEW",
        summary: "leg looks wrong",
      })
    ).toEqual({
      evidence_backed: false,
      owner: "UNKNOWN",
      cause_family: "UNKNOWN",
      repair_route: "MORE_EVIDENCE",
      needs_more_evidence: true,
    });
  });

  test("evidence invalidation and runtime clear make stale handles fail closed", () => {
    const registry = new VerificationEvidenceRegistry();
    const request: VerificationEvidenceRequest = {
      domain: "GEOMETRY",
      source: "capture_model_views",
      verification_risk: "LOW",
      views: ["front"],
      views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
      size: 256,
      size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
      scope_instance_ids: ["arm:0"],
    };

    const first = registry.put({ request, result: { revision: 1 } });
    expect(registry.invalidate(first)).toBe(true);
    expect(() => registry.get(first)).toThrow("VERIFICATION_EVIDENCE_NOT_FOUND");

    const second = registry.put({ request, result: { revision: 2 } });
    registry.clear();
    expect(registry.size()).toBe(0);
    expect(() => registry.get(second)).toThrow("VERIFICATION_EVIDENCE_NOT_FOUND");
  });
});

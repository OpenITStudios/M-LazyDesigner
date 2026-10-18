import { describe, expect, test } from "bun:test";
import { runMcpEfficiencyScorecard } from "@/scripts/measure/measure-mcp-efficiency";
import { evaluateStaticDynamicTradeoff } from "@/lib/efficiencyScorecard";
import { getEnabledToolDefinitions } from "@/lib/factories";
import { getMcpSurfaceToolNames } from "@/server/tools";

describe("MCP efficiency scorecard", () => {
  test("measures all prioritized hot paths with preserved quality", () => {
    const report = runMcpEfficiencyScorecard();

    expect(report.scores.map((item) => item.id)).toEqual([
      "geometry_coherent_cube_batch",
      "animation_coherent_keyframe_batch",
      "texture_inventory_default",
      "texture_layer_metadata_batch",
      "texture_atomic_region_transaction",
      "receipt_only_hierarchy_continuation",
      "particle_verified_write_receipt",
      "bone_rigging_final_state_receipt",
      "element_removal_receipt",
      "render_profile_verified_write_receipt",
      "unknown_target_focused_discovery",
    ]);
    expect(report.aggregate.quality_preserved).toBe(true);

    for (const score of report.scores) {
      expect(score.quality_preserved, score.id).toBe(true);
      expect(score.optimized_calls, score.id).toBeLessThanOrEqual(
        score.baseline_calls
      );
      expect(
        score.net_call_delta >= 0 || score.net_payload_delta_bytes >= 0,
        score.id
      ).toBe(true);
      expect(
        score.net_call_delta > 0 || score.net_payload_delta_bytes > 0,
        score.id
      ).toBe(true);
    }
  });

  test("texture discovery defaults to inventory rather than full diagnostics", () => {
    const score = runMcpEfficiencyScorecard().scores.find(
      (item) => item.id === "texture_inventory_default"
    )!;

    expect(score.baseline_calls).toBe(1);
    expect(score.optimized_calls).toBe(1);
    expect(score.net_payload_delta_bytes).toBeGreaterThan(0);
    expect(score.quality_preserved).toBe(true);
  });

  test("layer metadata cohorts collapse repeated editor recomposition", () => {
    const score = runMcpEfficiencyScorecard().scores.find(
      (item) => item.id === "texture_layer_metadata_batch"
    )!;

    expect(score.baseline_mutation_calls).toBe(4);
    expect(score.optimized_mutation_calls).toBe(1);
    expect(score.saved_calls).toBe(3);
    expect(score.quality_preserved).toBe(true);
  });

  test("batch-capable domains collapse micro-mutations without deleting verification", () => {
    const byId = new Map(
      runMcpEfficiencyScorecard().scores.map((item) => [item.id, item] as const)
    );

    for (const id of [
      "geometry_coherent_cube_batch",
      "animation_coherent_keyframe_batch",
      "texture_atomic_region_transaction",
      "texture_layer_metadata_batch",
    ]) {
      const score = byId.get(id)!;
      expect(score.optimized_mutation_calls, id).toBe(1);
      expect(score.optimized_mutation_calls, id).toBeLessThan(
        score.baseline_mutation_calls
      );
      expect(score.optimized_verification_calls, id).toBe(
        score.baseline_verification_calls
      );
    }
  });

  test("receipt continuation removes only redundant readback", () => {
    const score = runMcpEfficiencyScorecard().scores.find(
      (item) => item.id === "receipt_only_hierarchy_continuation"
    )!;

    expect(score.baseline_inspection_calls).toBe(1);
    expect(score.optimized_inspection_calls).toBe(0);
    expect(score.optimized_mutation_calls).toBe(1);
    expect(score.quality_preserved).toBe(true);
  });

  test("verified particle writes continue from the mutation receipt", () => {
    const score = runMcpEfficiencyScorecard().scores.find(
      (item) => item.id === "particle_verified_write_receipt"
    )!;

    expect(score.baseline_inspection_calls).toBe(1);
    expect(score.optimized_inspection_calls).toBe(0);
    expect(score.optimized_mutation_calls).toBe(1);
    expect(score.quality_preserved).toBe(true);
  });

  test("bone rigging continues from complete final bone state", () => {
    const score = runMcpEfficiencyScorecard().scores.find(
      (item) => item.id === "bone_rigging_final_state_receipt"
    )!;

    expect(score.baseline_inspection_calls).toBe(1);
    expect(score.optimized_inspection_calls).toBe(0);
    expect(score.optimized_mutation_calls).toBe(1);
    expect(score.quality_preserved).toBe(true);
  });

  test("element removal continues from a complete deletion receipt", () => {
    const score = runMcpEfficiencyScorecard().scores.find(
      (item) => item.id === "element_removal_receipt"
    )!;

    expect(score.baseline_inspection_calls).toBe(1);
    expect(score.optimized_inspection_calls).toBe(0);
    expect(score.optimized_mutation_calls).toBe(1);
    expect(score.quality_preserved).toBe(true);
  });

  test("verified render-profile writes continue from the mutation receipt", () => {
    const score = runMcpEfficiencyScorecard().scores.find(
      (item) => item.id === "render_profile_verified_write_receipt"
    )!;

    expect(score.baseline_inspection_calls).toBe(1);
    expect(score.optimized_inspection_calls).toBe(0);
    expect(score.optimized_mutation_calls).toBe(1);
    expect(score.quality_preserved).toBe(true);
  });

  test("focused discovery preserves the one identity read required for safe mutation", () => {
    const score = runMcpEfficiencyScorecard().scores.find(
      (item) => item.id === "unknown_target_focused_discovery"
    )!;

    expect(score.baseline_inspection_calls).toBe(2);
    expect(score.optimized_inspection_calls).toBe(1);
    expect(score.optimized_mutation_calls).toBe(1);
    expect(score.quality_preserved).toBe(true);
  });

  test("implemented optimizations reuse the existing Runtime surface", () => {
    const report = runMcpEfficiencyScorecard();

    // Total enabled source catalog can exceed the normal AUTHORING surface:
    // the scorecard inventories shared capabilities across all stage owners.
    const authoringCount = getMcpSurfaceToolNames("bedrock_entity", "geometry").length;
    expect(authoringCount).toBe(47);
    expect(report.static_surface.runtime_tool_count).toBe(
      Object.keys(getEnabledToolDefinitions()).length
    );
    expect(report.static_surface.runtime_tool_count).toBeGreaterThanOrEqual(authoringCount);
    expect(report.static_surface.reused_primitive_count).toBe(12);
    expect(report.static_surface.new_public_capabilities_required).toBe(0);
    expect(report.static_surface.reused_primitive_static_bytes).toBeGreaterThan(0);

    for (const row of report.static_surface.reused_primitives) {
      expect(row.schema_bytes, row.capability).toBeGreaterThan(0);
      expect(row.static_bytes, row.capability).toBeGreaterThan(row.schema_bytes);
    }
  });

  test("opportunity register separates implemented savings from unproven helpers", () => {
    const report = runMcpEfficiencyScorecard();
    const byId = new Map(
      report.opportunity_register.map((item) => [item.id, item] as const)
    );

    expect(byId.get("geometry_coherent_cube_batch")?.status).toBe("implemented");
    expect(byId.get("animation_coherent_keyframe_batch")?.status).toBe("implemented");
    expect(byId.get("texture_atomic_region_transaction")?.status).toBe("implemented");
    expect(byId.get("texture_layer_metadata_batch")?.status).toBe("implemented");
    expect(byId.get("rig_locator_cohort_mutation")?.status).toBe("evidence_required");
    expect(byId.get("render_target_native_adapter")?.status).toBe("blocked_by_stable_api");
  });

  test("schema growth must pay back against recurring dynamic savings", () => {
    const paysBack = evaluateStaticDynamicTradeoff({
      static_added_bytes: 1200,
      dynamic_saved_bytes_per_use: 400,
      expected_uses_per_session: 4,
    });
    expect(paysBack.break_even_uses).toBe(3);
    expect(paysBack.projected_net_savings_bytes).toBe(400);
    expect(paysBack.pays_back_within_session).toBe(true);

    const doesNotPayBack = evaluateStaticDynamicTradeoff({
      static_added_bytes: 1200,
      dynamic_saved_bytes_per_use: 200,
      expected_uses_per_session: 2,
    });
    expect(doesNotPayBack.break_even_uses).toBe(6);
    expect(doesNotPayBack.projected_net_savings_bytes).toBe(-800);
    expect(doesNotPayBack.pays_back_within_session).toBe(false);

    expect(
      evaluateStaticDynamicTradeoff({
        static_added_bytes: 0,
        dynamic_saved_bytes_per_use: 0,
        expected_uses_per_session: 0,
      }).break_even_uses
    ).toBe(0);
  });

  test("aggregate establishes a guarded material saving floor", () => {
    const { aggregate } = runMcpEfficiencyScorecard();

    expect(aggregate.saved_calls).toBeGreaterThan(0);
    expect(aggregate.call_reduction_percent).toBeGreaterThanOrEqual(50);
    expect(aggregate.payload_reduction_percent).toBeGreaterThanOrEqual(25);
    expect(aggregate.optimized_verification_calls).toBe(
      aggregate.baseline_verification_calls
    );
    expect(aggregate.quality_preserved).toBe(true);
  });
});

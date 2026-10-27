import { describe, expect, test } from "bun:test";
import { analyzeSemanticImpact } from "../../gateway/development/impact";
import { CAPABILITY_BRANCH_MANIFEST } from "../../gateway/capabilities/manifest";
import { listExplicitSourceOwners } from "../../gateway/development/sourceOwners";
import type { CapabilityBranchManifestEntry } from "../../gateway/capabilities/manifest";
import type { DevelopmentSourceOwner } from "../../gateway/development/types";

describe("semantic affected graph", () => {
  test("maps a source change to its canonical capability and anchor test", () => {
    const report = analyzeSemanticImpact({
      changedPaths: ["mcp/server/tools/geometry/cubes.ts"],
      sourceOwners: listExplicitSourceOwners(),
      manifest: CAPABILITY_BRANCH_MANIFEST,
    });

    expect(report.direct_capabilities).toContain("manage_cubes");
    expect(report.affected_capabilities.find(
      (entry) => entry.capability === "manage_cubes"
    )?.reasons).toContain("DIRECT_SOURCE");
    expect(report.affected_sources).toContain("mcp/server/tools/geometry/cubes.ts");
    expect(report.affected_anchor_tests).toContain(
      "mcp/tests/model-effectiveness-correction-accuracy.test.ts"
    );
    expect(
      report.affected_capabilities.find(
        (entry) => entry.capability === "manage_cubes"
      )?.semantic_ids
    ).toContain("branch:manage_cubes/operation=update");
  });

  test("expands through produced facts without loading unrelated domains", () => {
    const report = analyzeSemanticImpact({
      changedPaths: ["mcp/server/runtime/uv/layoutService.ts"],
      sourceOwners: listExplicitSourceOwners(),
      manifest: CAPABILITY_BRANCH_MANIFEST,
    });

    expect(report.direct_capabilities).toContain("manage_uv_layout");
    expect(report.affected_capabilities.map((entry) => entry.capability)).toContain(
      "manage_uv_layout"
    );
    expect(report.affected_capabilities.map((entry) => entry.capability)).not.toContain(
      "manage_animation_controller"
    );
    expect(report.affected_capabilities.map((entry) => entry.capability)).not.toContain(
      "manage_particle"
    );
  });

  test("specialist changes identify only capabilities owned by that specialist", () => {
    const report = analyzeSemanticImpact({
      changedPaths: [".agents/skills/lazydesigner-animation/SKILL.md"],
      sourceOwners: listExplicitSourceOwners(),
      manifest: CAPABILITY_BRANCH_MANIFEST,
    });

    expect(report.direct_capabilities).toContain("manage_animation_timeline");
    expect(report.direct_capabilities).toContain("manage_animation_controller");
    expect(report.direct_capabilities).not.toContain("manage_cubes");
  });

  test("invalidation-only changes select affected prerequisite owners transitively", () => {
    const sourceOwners: Record<string, DevelopmentSourceOwner> = {
      invalidate_only: {
        source: "mcp/server/tools/revise-geometry.ts",
        anchor_test: "mcp/tests/geometry-invalidation.test.ts",
        specialist: null,
      },
      apply_uv: {
        source: "mcp/server/tools/apply-uv.ts",
        anchor_test: "mcp/tests/uv-apply-contract.test.ts",
        specialist: null,
      },
      paint_texture: {
        source: "mcp/server/tools/paint-texture.ts",
        anchor_test: "mcp/tests/texture-paint-contract.test.ts",
        specialist: null,
      },
      unrelated_animation: {
        source: "mcp/server/tools/animate.ts",
        anchor_test: "mcp/tests/animation-contract.test.ts",
        specialist: null,
      },
    };
    const manifest: CapabilityBranchManifestEntry[] = [
      { id: "cap:invalidate_only", capability: "invalidate_only",
        graph: { invalidates: ["uv_plan_available"] } },
      { id: "cap:apply_uv", capability: "apply_uv",
        graph: {
          requires: ["uv_plan_available"],
          invalidates: ["texture_alignment_current"],
        } },
      { id: "cap:paint_texture", capability: "paint_texture",
        graph: { requires: ["texture_alignment_current"] } },
      { id: "cap:unrelated_animation", capability: "unrelated_animation",
        graph: { requires: ["animation_available"] } },
    ];
    const report = analyzeSemanticImpact({
      changedPaths: ["./mcp\\server\\tools\\revise-geometry.ts"],
      sourceOwners,
      manifest,
    });

    expect(report.direct_capabilities).toEqual(["invalidate_only"]);
    expect(report.affected_capabilities.map((entry) => entry.capability)).toEqual([
      "apply_uv", "invalidate_only", "paint_texture",
    ]);
    expect(report.affected_capabilities.find((entry) =>
      entry.capability === "apply_uv"
    )?.reasons).toEqual(["REQUIRES_CHANGED_FACT"]);
    expect(report.affected_capabilities.find((entry) =>
      entry.capability === "paint_texture"
    )?.reasons).toEqual(["REQUIRES_CHANGED_FACT"]);
    expect(report.affected_anchor_tests).toContain("mcp/tests/uv-apply-contract.test.ts");
    expect(report.affected_anchor_tests).toContain("mcp/tests/texture-paint-contract.test.ts");
    expect(report.affected_anchor_tests).not.toContain("mcp/tests/animation-contract.test.ts");
    expect(report.truncated).toBe(false);
  });

  test("combined produces and invalidates fact counts one downstream change", () => {
    const report = analyzeSemanticImpact({
      changedPaths: ["mcp/server/tools/dual-effect.ts"],
      sourceOwners: {
        dual_effect: {
          source: "mcp/server/tools/dual-effect.ts",
          specialist: null, anchor_test: null,
        },
        consumer: {
          source: "mcp/server/tools/consumer.ts",
          specialist: null, anchor_test: null,
        },
      },
      manifest: [
        { id: "cap:dual_effect", capability: "dual_effect",
          graph: {
            produces: ["uv_plan_available"],
            invalidates: ["uv_plan_available"],
          } },
        { id: "cap:consumer", capability: "consumer",
          graph: { requires: ["uv_plan_available"] } },
      ],
    });

    expect(report.affected_capabilities.map((entry) => entry.capability))
      .toEqual(["consumer", "dual_effect"]);
    expect(report.affected_capabilities[0]?.reasons)
      .toEqual(["REQUIRES_CHANGED_FACT"]);
    expect(report.truncated).toBe(false);
  });

  test("bounded invalidation propagation reports truncation rather than all-clear", () => {
    const report = analyzeSemanticImpact({
      changedPaths: ["mcp/server/tools/first.ts"],
      sourceOwners: {
        first: {
          source: "mcp/server/tools/first.ts", specialist: null, anchor_test: null,
        },
      },
      manifest: [
        { id: "cap:first", capability: "first",
          graph: { invalidates: ["uv_plan_available"] } },
        { id: "cap:second", capability: "second",
          graph: {
            requires: ["uv_plan_available"],
            invalidates: ["texture_alignment_current"],
          } },
        { id: "cap:third", capability: "third",
          graph: { requires: ["texture_alignment_current"] } },
      ],
      maxCapabilities: 2,
    });

    expect(report.affected_capabilities.map((entry) => entry.capability))
      .toEqual(["first", "second"]);
    expect(report.truncated).toBe(true);
  });

  test("a terminal capability exactly at the budget is not truncated", () => {
    const report = analyzeSemanticImpact({
      changedPaths: ["mcp/server/tools/terminal.ts"],
      sourceOwners: {
        terminal: {
          source: "mcp/server/tools/terminal.ts",
          specialist: null,
          anchor_test: "mcp/tests/terminal-contract.test.ts",
        },
      },
      manifest: [{ id: "cap:terminal", capability: "terminal", graph: {} }],
      maxCapabilities: 1,
    });

    expect(report.affected_capabilities.map((entry) => entry.capability))
      .toEqual(["terminal"]);
    expect(report.affected_anchor_tests)
      .toEqual(["mcp/tests/terminal-contract.test.ts"]);
    expect(report.truncated).toBe(false);
  });

  test("exact-budget transitive graph exhausts the last node before deciding truncation", () => {
    const report = analyzeSemanticImpact({
      changedPaths: ["mcp/server/tools/update.ts"],
      sourceOwners: {
        update: {
          source: "mcp/server/tools/update.ts",
          specialist: null,
          anchor_test: "mcp/tests/update-contract.test.ts",
        },
        downstream: {
          source: "mcp/server/tools/downstream.ts",
          specialist: null,
          anchor_test: "mcp/tests/downstream-contract.test.ts",
        },
      },
      manifest: [
        { id: "cap:update", capability: "update",
          graph: { invalidates: ["uv_plan_available"] } },
        { id: "cap:downstream", capability: "downstream",
          graph: { requires: ["uv_plan_available"] } },
      ],
      maxCapabilities: 2,
    });

    expect(report.affected_capabilities.map((entry) => entry.capability))
      .toEqual(["downstream", "update"]);
    expect(report.affected_anchor_tests)
      .toContain("mcp/tests/downstream-contract.test.ts");
    expect(report.truncated).toBe(false);
  });

  test("honors the capability budget", () => {
    const report = analyzeSemanticImpact({
      changedPaths: [".agents/skills/lazydesigner-texturing/SKILL.md"],
      sourceOwners: listExplicitSourceOwners(),
      manifest: CAPABILITY_BRANCH_MANIFEST,
      maxCapabilities: 3,
    });

    expect(report.affected_capabilities.length).toBeLessThanOrEqual(3);
    expect(report.truncated).toBe(true);
  });
});
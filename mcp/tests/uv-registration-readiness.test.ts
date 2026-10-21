import { describe, expect, test } from "bun:test";
import { classifyMcpToolPhaseByName } from "@/lib/authoringPhase";
import { getCapabilityMetadata } from "@/lib/capabilityMetadata";
import {
  authoringDomainForCapability,
  sourceOwnerForCapability,
} from "@/gateway/control";
import {
  getCapabilityBranchFields,
} from "@/gateway/schemaProjection";
import { GATEWAY_TOOL_NAMES } from "@/gateway/contract";
import { tools } from "@/lib/factories";
import { uvLayoutToolDocs } from "@/server/runtime/uv/layoutService";
import "@/server/tools";

describe("UV Runtime registration readiness", () => {
  test("future UV layout remains Geometry-owned without changing the Gateway surface", () => {
    expect(classifyMcpToolPhaseByName("manage_uv_layout")).toBe("geometry");
    expect(authoringDomainForCapability("manage_uv_layout")).toBe("GEOMETRY");
    expect(sourceOwnerForCapability("manage_uv_layout")).toEqual({
      source: "mcp/server/runtime/uv/layoutService.ts",
      specialist: ".agents/skills/lazydesigner-modelling/SKILL.md",
      anchor_test: "mcp/tests/uv-registration-readiness.test.ts",
    });
    expect(GATEWAY_TOOL_NAMES).toEqual([
      "status",
      "search_capabilities",
      "describe_capability",
      "invoke_capability",
    ]);
  });

  test("UV ownership never transfers texture atlas and Painter to Modelling", () => {
    expect(classifyMcpToolPhaseByName("create_texture")).toBe("texturing");
    expect(classifyMcpToolPhaseByName("paint_texture_transaction")).toBe("texturing");
    expect(authoringDomainForCapability("create_texture")).toBe("TEXTURING");
    expect(sourceOwnerForCapability("create_texture").specialist)
      .toBe(".agents/skills/lazydesigner-texturing/SKILL.md");
    // Shared AUTHORING surface does not imply shared semantic ownership.
    expect(classifyMcpToolPhaseByName("manage_cubes")).toBe("geometry");
  });

  test("metadata and describe branches are ready before generator-backed catalog registration", () => {
    const metadata = getCapabilityMetadata("manage_uv_layout");
    expect(metadata.tier).toBe("primary");
    expect(metadata.verificationClass).toBe("visual");
    expect(metadata.searchAliases).toContain("uv layout");

    expect(
      getCapabilityBranchFields("manage_uv_layout", {
        field: "operation",
        value: "plan",
      })
    ).toContain("constraints");
    expect(
      getCapabilityBranchFields("manage_uv_layout", {
        field: "operation",
        value: "apply",
      })
    ).toEqual([
      "operation",
      "plan_id",
      "expected_source_fingerprint",
    ]);
  });

  test("UV engine documents reflect current source implementation without claiming Runtime registration", async () => {
    const engine = await Bun.file("docs/UV_AUTHORING_ENGINE.md").text();
    const planner = await Bun.file("docs/SEMANTIC_UV_PLANNER.md").text();
    for (const source of [
      "lib/uv/stacking.ts",
      "lib/uv/receipt.ts",
      "lib/uv/invalidation.ts",
      "lib/uv/planRegistry.ts",
      "lib/uv/transaction.ts",
      "lib/uv/service.ts",
      "lib/uv/adapters/blockbenchCubeUv.ts",
    ]) expect(await Bun.file(source).exists(), source).toBe(true);
    expect(engine).toContain("Geometry/Modelling owner");
    expect(engine).toContain("source implemented");
    expect(engine).toContain("does NOT register a new Runtime capability");
    expect(planner).toContain("Geometry/Modelling-owned");
    expect(planner).toContain("not yet a registered MCP executor");
  });

  test("UV documentation distinguishes canonical implementations from compatibility facades", async () => {
    const [document, receipt, contracts] = await Promise.all([
      Bun.file("docs/UV_AUTHORING_ENGINE.md").text(),
      Bun.file("lib/uv/receipt.ts").text(),
      Bun.file("lib/uv/contracts.ts").text(),
    ]);
    for (const path of [
      "lib/uv/boxLayout.ts",
      "lib/uv/physicalEvidence.ts",
      "server/tools/texture/atlas.ts",
      "server/tools/texture/create.ts",
      "server/tools/geometry/cubes.ts",
    ]) expect(await Bun.file(path).exists(), path).toBe(true);
    expect(document).toContain("compatibility **re-export facades**");
    expect(document).toContain("lib/uv/boxLayout.ts");
    expect(document).toContain("lib/uv/physicalEvidence.ts");
    expect(document).toContain("server/tools/texture/atlas.ts");
    expect(document).toContain("server/tools/texture/create.ts");
    expect(document).toContain("server/tools/geometry/cubes.ts");
    for (const field of ["schema", "planner_version", "backend", "backend_version", "mode"]) {
      expect(document).toContain(field);
      expect(contracts).toContain(`${field}:`);
    }
    expect(receipt).toContain("backend: plan.backend");
    expect(document).toContain("constraint-schema version field is **not currently recorded**");
    expect(document).toContain("matching-SHA Bun and native apply/Undo/reopen verification");
  });

  test("UV plan/apply declarative tool spec matches the existing branch schemas", () => {
    expect(uvLayoutToolDocs.name).toBe("manage_uv_layout");
    expect(uvLayoutToolDocs.status).toBe("stable");
    expect(uvLayoutToolDocs.branches.discriminator).toBe("operation");
    expect(Object.keys(uvLayoutToolDocs.branches.schemas).sort()).toEqual(["apply", "plan"]);
    expect(uvLayoutToolDocs.parameters.safeParse({
      operation: "plan",
      mode: "REPACK_SELECTED",
      island_ids: ["face:cube-1:north"],
      bitmap_width: 32,
      bitmap_height: 32,
    }).success).toBe(true);
    expect(uvLayoutToolDocs.parameters.safeParse({
      operation: "apply",
      plan_id: "uvplan:" + "a".repeat(64),
      expected_source_fingerprint: "sha256:" + "b".repeat(64),
    }).success).toBe(true);
    expect(uvLayoutToolDocs.parameters.safeParse({
      operation: "apply",
      plan_id: "missing",
      expected_source_fingerprint: "sha256:" + "b".repeat(64),
    }).success).toBe(false);
  });

  test("remote prewiring does not register manage_uv_layout before generated docs can be refreshed", () => {
    expect(tools).not.toHaveProperty("manage_uv_layout");
  });
});

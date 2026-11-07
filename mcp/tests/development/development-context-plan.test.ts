import { describe, expect, test } from "bun:test";
import {
  buildDevelopmentContextPlan,
  projectDevelopmentEvidenceChain,
  validateEvidenceChangePaths,
} from "../../scripts/development/plan-development-context";
import { buildAffectedExecutionPlan } from "../../scripts/development/plan-affected-execution";
import { evaluatePreflight } from "../../../.agents/permissions/preflight.mjs";

// These integration cases build real TypeScript programs on Windows. The limit
// bounds cold compiler/IO work; correctness and payload budgets remain asserted.
const INTEGRATION_TIMEOUT_MS = 20_000;

describe("development context planner", () => {
  test("combines intent routing, bounded symbols and semantic impact", async () => {
    const plan = await buildDevelopmentContextPlan({
      intent: "adjust cube geometry proportions",
      changedPaths: ["mcp/server/tools/geometry/cubes.ts"],
      symbolMapMaxBytes: 3000,
      knowledgeTokenBudget: 600,
    });

    expect(plan.routing.domain).toBe("GEOMETRY");
    expect(plan.symbol_map.bytes).toBeLessThanOrEqual(3000);
    expect(plan.read_targets.source).toContain("mcp/server/tools/geometry/cubes.ts");
    expect(plan.read_targets.anchor_tests).toContain(
      "mcp/tests/model-effectiveness-correction-accuracy.test.ts"
    );
    expect(plan.semantic_impact?.direct_capabilities).toContain("manage_cubes");
    expect(plan.semantic_catalog_revisions.aggregate).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(
      plan.knowledge_sections.reduce(
        (sum, section) => sum + section.token_proxy,
        0
      )
    ).toBeLessThanOrEqual(600);
  }, INTEGRATION_TIMEOUT_MS);

  test("direct changed-path ownership outranks ambiguous keyword routing", async () => {
    const plan = await buildDevelopmentContextPlan({
      intent: "geometry texture issue",
      changedPaths: ["mcp/server/tools/geometry/cubes.ts"],
      symbolMapMaxBytes: 2500,
    });

    expect(plan.routing.domain).toBe("GEOMETRY");
    expect(plan.routing.confidence).toBe("EXACT");
    expect(plan.routing.context_strategy).toBe("DIRECT_SOURCE_OWNERS");
    expect(plan.routing.matched_terms).toContain(
      "changed-owner:manage_cubes"
    );
    expect(plan.semantic_impact?.direct_capabilities).toContain("manage_cubes");
    expect(plan.read_targets.source).toContain("mcp/server/tools/geometry/cubes.ts");
    expect(plan.read_targets.source).not.toContain(
      "mcp/server/tools/texture/create.ts"
    );
    expect(plan.read_targets.specialists).toEqual([
      ".agents/skills/lazydesigner-modelling/SKILL.md",
    ]);
  }, INTEGRATION_TIMEOUT_MS);

  test("uncertain development intent follows only authored canonical document links", async () => {
    const plan = await buildDevelopmentContextPlan({
      intent: "unclassified repository architecture change",
      symbolMapMaxBytes: 2000,
      knowledgeTokenBudget: 500,
    });
    expect(plan.routing.confidence).toBe("UNRESOLVED");
    expect(plan.documentation_route).toMatchObject({
      authority: "EXPLICIT_MARKDOWN_LINK",
      nodes: [
        "docs/README.md",
        "docs/04-system/README.md",
        "docs/04-system/implementation-map.md",
      ],
      canonical_owner: "docs/04-system/implementation-map.md",
    });
    expect(plan.documentation_route?.edges).toHaveLength(2);
    expect(plan.read_targets.source).toEqual([]);
    expect(plan.knowledge_sections.every(
      (section) => section.source !== "docs/04-system/README.md"
    )).toBe(true);
  }, INTEGRATION_TIMEOUT_MS);

  test("known source ownership avoids an extra documentation graph traversal", async () => {
    const plan = await buildDevelopmentContextPlan({
      intent: "manage_cubes source issue",
      changedPaths: ["mcp/server/tools/geometry/cubes.ts"],
      symbolMapMaxBytes: 2000,
    });
    expect(plan.routing.confidence).toBe("EXACT");
    expect(plan.documentation_route).toBeNull();
    expect(plan.read_targets.source).toContain("mcp/server/tools/geometry/cubes.ts");
  }, INTEGRATION_TIMEOUT_MS);

  test("method flow connects exact owner, bounded impact, verifier consumers and Local permission", async () => {
    const changedPath = "mcp/server/tools/geometry/cubes.ts";
    const context = await buildDevelopmentContextPlan({
      intent: "repair manage_cubes regression in canonical Geometry source",
      changedPaths: [changedPath],
      symbolMapMaxBytes: 2000,
      knowledgeTokenBudget: 180,
    });
    const affected = buildAffectedExecutionPlan([changedPath]);
    const explicitScope = {
      lane: "DEVELOPMENT",
      task: "DEVELOP",
      action: "source-write",
      branch: "Local",
      path: changedPath,
      task_scope_paths: [changedPath],
      authorized_scope: true,
    };

    expect(context.routing.domain).toBe("GEOMETRY");
    expect(context.routing.confidence).toBe("EXACT");
    expect(context.documentation_route).toBeNull();
    expect(context.read_targets.source).toContain(changedPath);
    expect(context.read_targets.anchor_tests).toContain(
      "mcp/tests/model-effectiveness-correction-accuracy.test.ts"
    );
    expect(affected.semantic_impact.direct_capabilities).toContain("manage_cubes");
    expect(affected.semantic_impact.affected_anchor_tests).toContain(
      "mcp/tests/model-effectiveness-correction-accuracy.test.ts"
    );
    expect(affected.execution.checks).toContain("PROJECT_GRAPH");
    expect(
      affected.execution.commands.some((command) =>
        command === "bun run verify:project-graph" ||
        command === "bun run verify:full"
      )
    ).toBe(true);

    expect(evaluatePreflight(explicitScope).decision).toBe("allow");
    expect(evaluatePreflight({ ...explicitScope, branch: "main" }).decision).toBe("ask");
    expect(evaluatePreflight({
      ...explicitScope,
      path: "mcp/server/tools/texture/create.ts",
    }).decision).toBe("deny");
  }, INTEGRATION_TIMEOUT_MS);

  test("omits semantic impact when there is no change set", async () => {
    const plan = await buildDevelopmentContextPlan({
      intent: "gateway routing discovery",
      symbolMapMaxBytes: 2500,
    });

    expect(plan.semantic_impact).toBeNull();
    expect(plan.read_targets.source.length).toBeGreaterThan(0);
  }, INTEGRATION_TIMEOUT_MS);

  test("opt-in evidence chain binds declared source owner to the existing affected check plan", async () => {
    const selected = "mcp/server/tools/geometry/cubes.ts";
    const plan = await buildDevelopmentContextPlan({
      intent: "repair manage_cubes geometry source",
      changedPaths: [selected],
      includeEvidenceChain: true,
      symbolMapMaxBytes: 2000,
      knowledgeTokenBudget: 250,
    });
    const chain = plan.evidence_chain!;
    const affected = buildAffectedExecutionPlan([selected]);
    expect(chain.authority).toBe("DERIVED_DEVELOPMENT_EVIDENCE_NOT_EXECUTION");
    expect(chain.proof).toBe("PLANNED_NOT_EXECUTED");
    expect(chain.source_revision).toBe("GIT_HEAD_NOT_BOUND_BY_CONTEXT_PLANNER");
    expect(chain.change_set_provenance).toBe("CALLER_SUPPLIED_NOT_GIT_DIFF_VERIFIED");
    expect(chain.verification.added_path_proof).toBe("ADDED_PATH_IDENTITY_NOT_PROVIDED");
    expect(chain.changed_paths).toEqual([selected]);
    expect(chain.direct_capability_owners).toContainEqual(
      expect.objectContaining({
        capability: "manage_cubes",
        owner_source: selected,
        anchor_test: "mcp/tests/model-effectiveness-correction-accuracy.test.ts",
        changed_evidence: expect.arrayContaining(["DIRECT_SOURCE"]),
        proof: "EXPLICIT_CAPABILITY_OWNER_DECLARATION_NOT_RUNTIME_PROOF",
      })
    );
    expect(chain.outside_explicit_capability_owner_paths).not.toContain(selected);
    expect(chain.verification.checks).toEqual(affected.execution.checks);
    expect(chain.verification.targeted_tests).toEqual(affected.execution.targeted_tests);
    expect(chain.verification.commands).toEqual(affected.execution.commands);
    expect(chain.verification.status).toBe("CHECKS_PLANNED_NOT_EXECUTED");
    expect(chain.open_obligations).toContain("CHECKS_NOT_EXECUTED");
    expect(chain.decision.document_to_code_relation).toBe(
      "NOT_ESTABLISHED_FROM_DOCUMENT_NAVIGATION"
    );
    expect(chain.decision.witnesses).toEqual([]);
    expect(chain.source_dependency.status).toBe(
      "AST_IMPORT_GRAPH_NOT_SCANNED_BY_CONTEXT_PLANNER"
    );
    expect(chain.source_dependency.available_impact_queries).toContain(
      "bun run audit:reachability -- --impact=" + selected + " --format=json"
    );
  }, INTEGRATION_TIMEOUT_MS);

  test("ambiguous architecture route preserves exact router witnesses and source hashes", async () => {
    const plan = await buildDevelopmentContextPlan({
      intent: "unclassified repository architecture change",
      includeEvidenceChain: true,
      symbolMapMaxBytes: 1800,
      knowledgeTokenBudget: 300,
    });
    const chain = plan.evidence_chain!;
    expect(chain.decision.status).toBe("AUTHORED_DOCUMENT_ROUTE");
    expect(chain.decision.canonical_document).toBe(
      "docs/04-system/implementation-map.md"
    );
    expect(chain.decision.witnesses).toHaveLength(2);
    expect(chain.decision.witnesses.map(x => x.source_sha256)
      .every(x => typeof x === "string" && /^[0-9a-f]{64}$/.test(x))).toBe(true);
    expect(chain.decision.witnesses[0]).toMatchObject({
      from: "docs/README.md",
      to: "docs/04-system/README.md",
      relation: "EXPLICIT_MARKDOWN_LINK",
    });
    expect(chain.decision.document_to_code_relation).toBe(
      "NOT_ESTABLISHED_FROM_DOCUMENT_NAVIGATION"
    );
    expect(chain.direct_capability_owners).toEqual([]);
    expect(chain.open_obligations).toContain("NO_SELECTED_CHANGE_SET");
    expect(chain.verification.status).toBe("CHECKS_PLANNED_NOT_EXECUTED");
  }, INTEGRATION_TIMEOUT_MS);

  test("noncapability shared source stays unclassified rather than acquiring keyword owner", async () => {
    const selected = "mcp/lib/semantic/knowledge.ts";
    const plan = await buildDevelopmentContextPlan({
      intent: "unclassified repository architecture source review",
      changedPaths: [selected],
      includeEvidenceChain: true,
      symbolMapMaxBytes: 1800,
      knowledgeTokenBudget: 250,
    });
    const chain = plan.evidence_chain!;
    expect(chain.changed_paths).toEqual([selected]);
    expect(chain.outside_explicit_capability_owner_paths).toContain(selected);
    expect(chain.open_obligations).toContain(
      "NO_EXACT_CAPABILITY_OWNER_FOR_SOME_PATHS"
    );
    expect(chain.direct_capability_owners.every(x =>
      x.owner_source !== selected)).toBe(true);
    expect(chain.verification.commands.length).toBeGreaterThan(0);
    expect(chain.source_revision).toBe("GIT_HEAD_NOT_BOUND_BY_CONTEXT_PLANNER");
  }, INTEGRATION_TIMEOUT_MS);

  test("default development context remains lean without evidence projection", async () => {
    const plan = await buildDevelopmentContextPlan({
      intent: "manage_cubes source issue",
      changedPaths: ["mcp/server/tools/geometry/cubes.ts"],
      symbolMapMaxBytes: 1200,
      knowledgeTokenBudget: 150,
    });
    expect(plan.evidence_chain).toBeUndefined();
  }, INTEGRATION_TIMEOUT_MS);


  test("opt-in evidence chain rejects unsafe paths rather than rendering shell commands", () => {
    expect(validateEvidenceChangePaths([
      "mcp/lib/semantic/knowledge.ts", "./mcp/lib/semantic/knowledge.ts",
      "docs/04-system/knowledge-architecture.md",
    ])).toEqual([
      "docs/04-system/knowledge-architecture.md",
      "mcp/lib/semantic/knowledge.ts",
    ]);
    for (const bad of [
      "mcp/../AGENTS.md", "/tmp/script.ts", "C:\\outside\\bad.ts",
      "mcp/server/a.ts;echo", "mcp/lib/bad name.ts",
      "mcp/lib/.env.local", "other-repo/script.ts", "mcp/lib//bad.ts",
      "mcp/lib/foo.ts\n--flag",
    ]) expect(() => validateEvidenceChangePaths([bad])).toThrow(
      "EVIDENCE_CHANGE_PATH_UNSAFE"
    );
    expect(() => validateEvidenceChangePaths(
      Array.from({ length: 65 }, (_, i) => "mcp/lib/source" + i + ".ts")
    )).toThrow("EVIDENCE_CHANGE_SCOPE_TOO_LARGE");
  });

  test("unsafe selected source cannot enter the opt-in check planner", async () => {
    await expect(buildDevelopmentContextPlan({
      intent: "repair source",
      changedPaths: ["mcp/tests/a.test.ts;echo illegal"],
      includeEvidenceChain: true,
      symbolMapMaxBytes: 500,
    })).rejects.toThrow("EVIDENCE_CHANGE_PATH_UNSAFE");
  }, INTEGRATION_TIMEOUT_MS);


  test("evidence composition rejects proof plans with a different selected change set", () => {
    const first = "mcp/server/tools/geometry/cubes.ts";
    const second = "mcp/server/tools/texture/create.ts";
    const context = buildAffectedExecutionPlan([first]);
    expect(() => projectDevelopmentEvidenceChain({
      changedPaths: [second],
      semanticImpact: context.semantic_impact,
      documentationRoute: null,
    })).toThrow("EVIDENCE_CHANGE_SET_MISMATCH");
    expect(() => projectDevelopmentEvidenceChain({
      changedPaths: [first],
      semanticImpact: null,
      documentationRoute: null,
    })).toThrow("EVIDENCE_CHANGE_SET_MISMATCH");
    expect(() => projectDevelopmentEvidenceChain({
      changedPaths: [first],
      semanticImpact: { ...context.semantic_impact,
        direct_capabilities: ["forged_capability"],
      },
      documentationRoute: null,
    })).toThrow("EVIDENCE_SEMANTIC_OWNER_DRIFT");
  });

});

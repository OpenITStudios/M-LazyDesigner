import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import {
  planAffectedExecution,
  RECEIPT_CONTRACT_TESTS_BY_PATH,
  UV_REGRESSION_TESTS_BY_PATH,
} from "../../gateway/development/affectedExecution";
import { buildAffectedExecutionPlan } from "../../scripts/development/plan-affected-execution";
import type { SemanticImpactReport } from "../../gateway/development/impact";
import { planSemanticInvalidation } from "../../gateway/development/semanticInvalidation";

function impact(overrides: Partial<SemanticImpactReport> = {}): SemanticImpactReport {
  return {
    changed_paths: [],
    direct_capabilities: [],
    affected_capabilities: [],
    affected_sources: [],
    affected_anchor_tests: [],
    affected_specialists: [],
    truncated: false,
    ...overrides,
  };
}

describe("affected execution planner", () => {
  test("Hybrid-4 experimental owners trigger bounded benchmark and contract checks", () => {
    const plan = buildAffectedExecutionPlan([
      "mcp/gateway/experimental/hybridRegistration.ts",
    ]);

    expect(plan.execution.fallback_full_verify).toBe(false);
    expect(plan.execution.checks).toContain("GATEWAY_HOT_PATH_BENCHMARK");
    expect(plan.execution.checks).toContain("HYBRID4_EXPERIMENTAL_CONTRACTS");
    expect(plan.execution.commands).toContain(
      "bun run benchmark:gateway-hot-path"
    );
    expect(plan.execution.commands).toContain(
      "bun test tests/benchmark/gateway-hot-path-strategy-benchmark.test.ts tests/benchmark/hybrid4-generated-schema.test.ts tests/benchmark/hybrid4-precondition-safety.test.ts"
    );
  });

  test("docs API changes validate generated Hybrid-4 schema freshness", () => {
    const plan = buildAffectedExecutionPlan(["mcp/docs/api.json"]);

    expect(plan.execution.checks).toContain("HYBRID4_EXPERIMENTAL_CONTRACTS");
  });


  test("selects runtime checks and exact owner tests for a bounded tool change", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/server/tools/geometry/cubes.ts"],
      semanticImpact: impact({
        affected_anchor_tests: [
          "mcp/tests/model-effectiveness-correction-accuracy.test.ts",
        ],
      }),
    });

    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("PROJECT_GRAPH");
    expect(plan.checks).not.toContain("TYPECHECK_RUNTIME");
    expect(plan.checks).not.toContain("AUDIT_UNUSED_RUNTIME");
    expect(plan.checks).toContain("DOCS_FRESHNESS");
    expect(plan.checks).toContain("AUTHORING_CONTRACTS");
    expect(plan.targeted_tests).toEqual([
      "mcp/tests/model-effectiveness-correction-accuracy.test.ts",
    ]);
    expect(plan.commands.some((command) =>
      command.includes("model-effectiveness-correction-accuracy.test.ts")
    )).toBe(true);
  });

  test("directly changed executable tests get executed, rather than only typechecked", () => {
    for (const path of [
      "mcp/tests/animation-mutation-contract.test.ts",
      "mcp/tests/benchmark/quality-benchmark-contract.test.ts",
      "mcp/gateway/runtime/operationQueue.test.ts",
    ]) {
      const plan = planAffectedExecution({
        changedPaths: [path], semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, path).toBe(false);
      expect(plan.targeted_tests, path).toContain(path);
      expect(plan.commands, path).toContain(`bun test ${path.slice(4)}`);
    }
  });

  test("repository and authoring test edits use their existing suites, without duplicate focused runs", async () => {
    for (const [path, suite] of [
      ["mcp/tests/repository/semantic-dependency-matrix-ownership.test.ts", "bun run verify:repository"],
      ["mcp/tests/authoring/quality-first-authoring-contract.test.ts", "bun run verify:authoring"],
    ] as const) {
      const plan = planAffectedExecution({
        changedPaths: [path], semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, path).toBe(false);
      expect(plan.commands, path).toContain(suite);
      expect(plan.targeted_tests, path).not.toContain(path);
      expect(await Bun.file(path.slice(4)).exists(), path).toBe(true);
    }
  });

  test("all current data fixtures select existing consumers; unknown fixtures fail conservatively", async () => {
    const owned: Array<[string, string[]]> = [
      ["mcp/tests/fixtures/agent-permission-cases.json", ["mcp/tests/repository/agent-permission-preflight.test.ts"]],
      ["mcp/tests/fixtures/astra-live-golden-tasks.json", ["mcp/tests/astra-usage-validation-contract.test.ts"]],
      ["mcp/tests/fixtures/astra-usage-validation-template.json", ["mcp/tests/astra-usage-validation-contract.test.ts"]],
      ["mcp/tests/fixtures/codex-session-policy-input-template.json", ["mcp/tests/astra-usage-ready-contract.test.ts"]],
      ["mcp/tests/fixtures/golden-authoring-run-template.json", ["mcp/tests/benchmark/golden-authoring-run-contract.test.ts"]],
      ["mcp/tests/fixtures/golden-task-cases.json", ["mcp/tests/benchmark/golden-benchmark-session-runner.test.ts", "mcp/tests/benchmark/quality-benchmark-corpus-contract.test.ts"]],
      ["mcp/tests/fixtures/native-acceptance-manifest.json", ["mcp/tests/native-acceptance-manifest-contract.test.ts"]],
      ["mcp/tests/fixtures/quality-benchmark-cases.json", ["mcp/tests/benchmark/quality-benchmark-contract.test.ts"]],
      ["mcp/tests/fixtures/regression-cases.json", ["mcp/tests/benchmark/quality-benchmark-corpus-contract.test.ts"]],
      ["mcp/tests/fixtures/skill-routing-cases.json", ["mcp/tests/repository/skill-lane-contract.test.ts"]],
    ];
    for (const [path, owners] of owned) {
      expect(await Bun.file(path.slice(4)).exists(), path).toBe(true);
      for (const owner of owners) {
        expect(await Bun.file(owner.slice(4)).exists(), owner).toBe(true);
      }
      const plan = planAffectedExecution({
        changedPaths: [path], semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, path).toBe(false);
      expect(plan.targeted_tests, path).toEqual([...owners].sort());
      expect(plan.commands, path).toContain(
        `bun test ${[...owners].sort().map((owner) => owner.slice(4)).join(" ")}`
      );
    }
    const unknown = planAffectedExecution({
      changedPaths: ["mcp/tests/fixtures/unmapped-cases.json"],
      semanticImpact: impact(),
    });
    expect(unknown.fallback_full_verify).toBe(true);
    expect(unknown.commands).toEqual(["bun run verify:full"]);
  });

  test("all explicit affected-verifier source and test references resolve in the active tree", async () => {
    const source = await Bun.file("gateway/development/affectedExecution.ts").text();
    const paths = [...new Set(
      [...source.matchAll(/["'](mcp\/[^"']+?\.(?:ts|json|md|yml))["']/g)]
        .map((match) => match[1]!)
    )];
    expect(paths.length).toBeGreaterThan(50);
    for (const path of paths) {
      expect(await Bun.file(path.slice(4)).exists(), path).toBe(true);
    }
  });

  test("every shared receipt module has an explicit bounded verifier owner", async () => {
    const receiptFiles = (await readdir("lib/receipts"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `mcp/lib/receipts/${name}`)
      .sort();

    expect(Object.keys(RECEIPT_CONTRACT_TESTS_BY_PATH).sort()).toEqual(
      receiptFiles
    );

    for (const [source, contracts] of Object.entries(
      RECEIPT_CONTRACT_TESTS_BY_PATH
    )) {
      expect(contracts.length, source).toBeGreaterThanOrEqual(2);
      for (const contract of contracts) {
        expect(contract, source).toMatch(/^mcp\/tests\/.*\.test\.ts$/);
      }
    }
  });

  test("one shared receipt change does not execute unrelated receipt suites", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/lib/receipts/materialMutation.ts"],
      semanticImpact: impact(),
    });

    expect(plan.targeted_tests).toEqual(
      expect.arrayContaining([
        "mcp/tests/contracts/material-receipt-contract.test.ts",
        "mcp/tests/contracts/material-persistence-receipt-contract.test.ts",
        "mcp/tests/control-texture-mutation-precision.test.ts",
      ])
    );
    expect(plan.targeted_tests).not.toContain(
      "mcp/tests/contracts/animation-controller-receipt-contract.test.ts"
    );
    expect(plan.targeted_tests).not.toContain(
      "mcp/tests/contracts/particle-receipt-contract.test.ts"
    );
  });

  test("UV implementation changes select only their existing behavior owners", async () => {
    expect(Object.keys(UV_REGRESSION_TESTS_BY_PATH).length).toBeGreaterThanOrEqual(25);
    for (const [path, owners] of Object.entries(UV_REGRESSION_TESTS_BY_PATH)) {
      expect(owners.length, path).toBeGreaterThan(0);
      expect(await Bun.file(path.slice(4)).exists(), path).toBe(true);
      for (const owner of owners) {
        expect(await Bun.file(owner.slice(4)).exists(), owner).toBe(true);
      }
      const plan = planAffectedExecution({
        changedPaths: [path],
        semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, path).toBe(false);
      expect(plan.checks, path).toContain("TARGETED_TESTS");
      expect(plan.checks, path).toContain("PROJECT_GRAPH");
      expect(plan.targeted_tests, path).toEqual([...owners].sort());
      expect(plan.commands, path).toContain(
        `bun test ${[...owners].sort().map(owner => owner.slice(4)).join(" ")}`
      );
      expect(plan.commands, path).not.toContain("bun run verify:full");
      expect(plan.targeted_tests, path).not.toContain(
        "mcp/tests/texture-seam-continuity.test.ts"
      );
    }
  });

  test("new unowned UV sources retain full verification rather than typecheck-only green", () => {
    for (const path of [
      "mcp/lib/uv/futureAuthoringHelper.ts",
      "mcp/server/runtime/uv/newNativeAdapter.ts",
      "mcp/lib/uv/workflow.ts",
    ]) {
      const plan = planAffectedExecution({
        changedPaths: [path],
        semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, path).toBe(true);
      expect(plan.commands, path).toEqual(["bun run verify:full"]);
      expect(plan.reasons, path).toContain(
        "UV source has no explicit behavior regression owner"
      );
    }
  });

  test("UV source checks stay scoped on mixed changes without omitting required contracts", () => {
    const plan = planAffectedExecution({
      changedPaths: [
        "mcp/lib/uv/planRegistry.ts",
        "mcp/lib/uv/transaction.ts",
        "mcp/lib/uv/planRegistry.ts",
      ],
      semanticImpact: impact(),
    });
    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.targeted_tests).toEqual([
      "mcp/tests/uv-plan-service.test.ts",
      "mcp/tests/uv-transaction-contract.test.ts",
    ]);
    expect(plan.commands).toContain(
      "bun test tests/uv-plan-service.test.ts tests/uv-transaction-contract.test.ts"
    );
  });

  test("Gateway hot-path source edits select direct behavior regressions", () => {
    const cases: Array<[string, string[]]> = [
      ["mcp/lib/factories.ts", [
        "mcp/tests/structured-result-compaction.test.ts",
        "mcp/tests/mcp-surface-closure.test.ts",
      ]],
      ["mcp/gateway/presentation/resultCompaction.ts", [
        "mcp/gateway/presentation/resultCompaction.test.ts",
        "mcp/tests/gateway-contract.test.ts",
      ]],
      ["mcp/gateway/execution/capabilityExecutor.ts", [
        "mcp/gateway/presentation/resultCompaction.test.ts",
        "mcp/tests/gateway-contract.test.ts",
        "mcp/gateway/capabilities/effects.test.ts",
      ]],
      ["mcp/gateway/control/receipt.ts", [
        "mcp/gateway/capabilities/effects.test.ts",
      ]],
      ["mcp/gateway/capabilities/effects.ts", [
        "mcp/gateway/capabilities/effects.test.ts",
      ]],
      ["mcp/gateway/control/orchestration.ts", [
        "mcp/tests/gateway-control-orchestration.test.ts",
      ]],
      ["mcp/gateway/capabilities/catalog.ts", [
        "mcp/gateway/capabilities/intelligence.test.ts",
        "mcp/tests/capability-discovery-efficiency.test.ts",
      ]],
      ["mcp/gateway/capabilities/intelligence.ts", [
        "mcp/gateway/capabilities/intelligence.test.ts",
      ]],
      ["mcp/gateway/control/contextHeadroom.ts", [
        "mcp/tests/gateway-control-context-headroom.test.ts",
      ]],
      ["mcp/gateway/runtime/operationQueue.ts", [
        "mcp/gateway/runtime/operationQueue.test.ts",
      ]],
      ["mcp/lib/texture/diagnosticReadContext.ts", [
        "mcp/tests/texture-diagnostic-read-context.test.ts",
      ]],
    ];
    for (const [source, expected] of cases) {
      const plan = planAffectedExecution({
        changedPaths: [source], semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, source).toBe(false);
      expect(plan.checks, source).toContain("PROJECT_GRAPH");
      expect(plan.targeted_tests, source).toEqual([...expected].sort());
      expect(plan.targeted_tests, source).not.toContain(
        "mcp/tests/uv-plan-service.test.ts"
      );
    }
  });

  test("Runtime affinity and receipt producers share their existing effect contract", () => {
    const cases: Array<[string, string[]]> = [
      ["mcp/gateway/runtime/backend.ts", [
        "mcp/gateway/backend-effects-boundary.test.ts",
        "mcp/gateway/index-boundary.test.ts",
        "mcp/gateway/capabilities/effects.test.ts",
      ]],
      ["mcp/gateway/runtime/backendContract.ts", [
        "mcp/gateway/backend-effects-boundary.test.ts",
        "mcp/gateway/capabilities/effects.test.ts",
      ]],
    ];
    for (const [path, expected] of cases) {
      const plan = planAffectedExecution({
        changedPaths: [path], semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, path).toBe(false);
      expect(plan.targeted_tests, path).toEqual([...expected].sort());
      expect(plan.checks, path).toContain("PROJECT_GRAPH");
    }
  });

  test("recent Texture source changes route directly to their owning regressions", () => {
    const cases: Array<[string, string]> = [
      ["mcp/lib/texture/seamContinuity.ts", "mcp/tests/texture-seam-continuity.test.ts"],
      ["mcp/lib/texture/geometrySignalCompiler.ts", "mcp/tests/texture-geometry-signal-compiler.test.ts"],
      ["mcp/lib/texture/geometrySignalBuilder.ts", "mcp/tests/texture-geometry-signal-compiler.test.ts"],
      ["mcp/lib/texture/maskedOps.ts", "mcp/tests/texture-masks.test.ts"],
      ["mcp/lib/texture/geometryAwareTreatment.ts", "mcp/tests/texture-masks.test.ts"],
      ["mcp/lib/texture/sourceComposer.ts", "mcp/tests/texture-masks.test.ts"],
    ];
    for (const [source, owningTest] of cases) {
      const plan = planAffectedExecution({
        changedPaths: [source],
        semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, source).toBe(false);
      expect(plan.checks, source).toContain("PROJECT_GRAPH");
      expect(plan.checks, source).toContain("TARGETED_TESTS");
      expect(plan.targeted_tests, source).toContain(owningTest);
      expect(plan.commands, source).toContain(
        `bun test ${owningTest.slice("mcp/".length)}`
      );
      expect(plan.commands, source).not.toContain("bun run verify:full");
    }
  });

  test("unrelated Texture source does not inherit arbitrary seam checks", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/lib/texture/vanillaKnowledge.ts"],
      semanticImpact: impact(),
    });
    expect(plan.checks).toContain("PROJECT_GRAPH");
    expect(plan.targeted_tests).not.toContain("mcp/tests/texture-seam-continuity.test.ts");
    expect(plan.targeted_tests).not.toContain("mcp/tests/texture-masks.test.ts");
  });

  test("toolchain and dependency changes still require full verification", () => {
    for (const source of [".bun-version", "mcp/bun.lock", "mcp/package.json"]) {
      const plan = planAffectedExecution({
        changedPaths: [source],
        semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, source).toBe(true);
      expect(plan.commands).toContain("bun run verify:full");
    }
  });

  test("shared receipt changes run bounded receipt and continuation contracts", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/lib/receipts/materialMutation.ts"],
      semanticImpact: impact(),
    });

    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("PROJECT_GRAPH");
    expect(plan.checks).toContain("TARGETED_TESTS");
    expect(plan.targeted_tests).toContain(
      "mcp/tests/contracts/material-receipt-contract.test.ts"
    );
    expect(plan.targeted_tests).toContain(
      "mcp/tests/control-texture-mutation-precision.test.ts"
    );
    expect(plan.commands.some((command) =>
      command.includes("material-receipt-contract.test.ts")
    )).toBe(true);
  });

  test("semantic history changes run history and Control continuation contracts", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/lib/authoring/semanticHistory.ts"],
      semanticImpact: impact(),
    });

    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("PROJECT_GRAPH");
    expect(plan.checks).toContain("TARGETED_TESTS");
    for (const required of [
      "mcp/tests/history-result-state.test.ts",
      "mcp/tests/semantic-history-contract.test.ts",
      "mcp/tests/semantic-history-native-owned.test.ts",
      "mcp/tests/gateway-control-continuation-hardening.test.ts",
    ]) {
      expect(plan.targeted_tests).toContain(required);
    }
  });

  test("verification helpers select their direct visual and invalidation regression owners", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/gateway/control/delta/verification.ts"],
      semanticImpact: impact(),
    });
    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.targeted_tests).toContain(
      "mcp/tests/visual-verification-scope-contract.test.ts"
    );
    expect(plan.targeted_tests).toContain(
      "mcp/tests/gateway-control-invalidation.test.ts"
    );
    expect(plan.targeted_tests).toContain(
      "mcp/tests/gateway-control-continuation-hardening.test.ts"
    );
    expect(plan.commands).not.toContain("bun run verify:full");
  });

  test("Control Delta engine selects verification-to-recheck integration contracts", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/gateway/control/delta/engine.ts"],
      semanticImpact: impact(),
    });
    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.targeted_tests).toContain(
      "mcp/tests/control-downstream-recheck.test.ts"
    );
    expect(plan.targeted_tests).toContain(
      "mcp/tests/visual-verification-scope-contract.test.ts"
    );
    expect(plan.targeted_tests).toContain(
      "mcp/tests/gateway-control-invalidation.test.ts"
    );
  });

  test("Control downstream recheck owner selects its five existing targeted contracts", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/gateway/control/delta/recheck.ts"],
      semanticImpact: impact(),
    });
    const expected = [
      "mcp/tests/control-downstream-recheck.test.ts",
      "mcp/tests/uv-downstream-recheck-targets.test.ts",
      "mcp/tests/texture-region-recheck-targets.test.ts",
      "mcp/tests/animation-downstream-recheck-targets.test.ts",
      "mcp/tests/animation-controller-effects-recheck-targets.test.ts",
    ];
    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("PROJECT_GRAPH");
    expect(plan.targeted_tests).toEqual([...expected].sort());
    expect(plan.commands).toContain(
      `bun test ${[...expected].sort().map(path => path.slice(4)).join(" ")}`
    );
    expect(plan.commands).not.toContain("bun run verify:full");
  });

  test("Control receipt validation changes select native continuation proof without a full sweep", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/gateway/control/delta/receipts.ts"],
      semanticImpact: impact(),
    });
    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.targeted_tests).toContain(
      "mcp/tests/contracts/receipt-continuation-contract.test.ts"
    );
    expect(plan.targeted_tests).toContain(
      "mcp/tests/gateway-control-invalidation.test.ts"
    );
    expect(plan.targeted_tests).toContain(
      "mcp/tests/gateway-control-continuation-hardening.test.ts"
    );
    expect(new Set(plan.targeted_tests).size).toBe(plan.targeted_tests.length);
  });

  test("Control Delta engine and freshness changes select the exact invalidation owner", () => {
    for (const source of [
      "mcp/gateway/control/delta/engine.ts",
      "mcp/gateway/control/delta/freshness.ts",
      "mcp/gateway/control/delta/verification.ts",
    ]) {
      const plan = planAffectedExecution({
        changedPaths: [source],
        semanticImpact: impact(),
      });
      expect(plan.fallback_full_verify, source).toBe(false);
      expect(plan.targeted_tests, source).toContain(
        "mcp/tests/gateway-control-invalidation.test.ts"
      );
      expect(plan.targeted_tests, source).toContain(
        "mcp/tests/gateway-control-continuation-hardening.test.ts"
      );
    }
  });

  test("Control delta contract changes run continuation regressions", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/gateway/control/delta/freshness.ts"],
      semanticImpact: impact(),
    });

    expect(plan.targeted_tests).toEqual(
      expect.arrayContaining([
        "mcp/tests/gateway-control-continuation-hardening.test.ts",
        "mcp/tests/control-texture-mutation-precision.test.ts",
      ])
    );
  });

  test("gateway recovery source changes select their bounded recovery contracts", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/gateway/session/orchestrationRecoveryState.ts"],
      semanticImpact: impact(),
    });

    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("PROJECT_GRAPH");
    expect(plan.checks).toContain("TARGETED_TESTS");
    expect(plan.targeted_tests).toEqual(
      expect.arrayContaining([
        "mcp/gateway/session/orchestrationRecoveryState.test.ts",
        "mcp/gateway/index-boundary.test.ts",
      ])
    );
    expect(plan.commands.some((command) =>
      command.includes("gateway/session/orchestrationRecoveryState.test.ts")
    )).toBe(true);
  });

  test.each([
    "mcp/lib/orchestration/correctionLoop.ts",
    "mcp/lib/orchestration/correctionContinuation.ts",
  ])("correction source %s selects correction and public-surface contracts", (path) => {
    const plan = planAffectedExecution({
      changedPaths: [path],
      semanticImpact: impact(),
    });

    expect(plan.targeted_tests).toEqual(
      expect.arrayContaining([
        "mcp/tests/correction-loop-reuse.test.ts",
        "mcp/tests/orchestration-public-surface.test.ts",
      ])
    );
  });

  test("semantic core changes exercise the isolated compiler project", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/lib/semantic/canonical.ts"],
      semanticImpact: impact(),
    });

    expect(plan.checks).toContain("PROJECT_GRAPH");
    expect(plan.commands).toContain("bun run verify:project-graph");
  });

  test("project-owned source uses one strict composite compiler graph", () => {
    for (const path of [
      "mcp/gateway/capabilities/catalog.ts",
      "mcp/server/tools/geometry/cubes.ts",
      "mcp/lib/semantic/canonical.ts",
    ]) {
      const plan = planAffectedExecution({
        changedPaths: [path],
        semanticImpact: impact(),
      });

      expect(plan.checks).toContain("PROJECT_GRAPH");
      expect(plan.checks).not.toContain("TYPECHECK_RUNTIME");
      expect(plan.checks).not.toContain("TYPECHECK_GATEWAY");
      expect(plan.checks).not.toContain("AUDIT_UNUSED_RUNTIME");
      expect(plan.checks).not.toContain("AUDIT_UNUSED_GATEWAY");
      expect(plan.commands).toContain("bun run verify:project-graph");
    }
  });

  test("report-only tooling stays bounded to compiler hygiene and never becomes full acceptance", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/scripts/measure/measure-mcp-efficiency.ts"],
      semanticImpact: impact(),
    });

    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("TYPECHECK_RUNTIME");
    expect(plan.checks).toContain("AUDIT_UNUSED_RUNTIME");
    expect(plan.checks).not.toContain("PROJECT_GRAPH");
    expect(plan.checks).not.toContain("FULL_VERIFY");
    expect(plan.checks).not.toContain("GATEWAY_HOT_PATH_BENCHMARK");
    expect(plan.checks).not.toContain("GATEWAY_REPLAY_SHADOW");
    expect(plan.checks).not.toContain("HYBRID4_EXPERIMENTAL_CONTRACTS");
    expect(plan.commands).toEqual([
      "bun run audit:unused",
      "bun run typecheck",
    ]);
  });


  test("replay corpus changes run shadow benchmark and promotion policy", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/scripts/benchmark/fixtures/gateway-replay-corpus.ts"],
      semanticImpact: impact(),
    });

    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("GATEWAY_REPLAY_SHADOW");
    expect(plan.commands).toContain("bun run benchmark:gateway-replay-shadow");
    expect(plan.commands).toContain("bun run eval:hybrid-promotion-policy");
  });

  test("hot-path benchmark changes run the dedicated deterministic benchmark", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/scripts/benchmark/benchmark-gateway-hot-path.ts"],
      semanticImpact: impact(),
    });

    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("GATEWAY_HOT_PATH_BENCHMARK");
    expect(plan.commands).toContain("bun run benchmark:gateway-hot-path");
  });

  test("semantic invalidation is folded into the same bounded execution plan", () => {
    const semanticInvalidation = planSemanticInvalidation([
      {
        id: "branch:manage_cubes/operation=update",
        change: "CHANGED",
        dimensions: ["ROUTING"],
      },
    ]);
    const plan = planAffectedExecution({
      changedPaths: ["mcp/gateway/capabilities/catalog.ts"],
      semanticImpact: impact(),
      semanticInvalidation,
    });

    expect(plan.fallback_full_verify).toBe(false);
    expect(plan.checks).toContain("CAPABILITY_INTELLIGENCE");
    expect(plan.checks).toContain("DECISION_EFFICIENCY");
    expect(plan.commands).toContain("bun run eval:capability-intelligence");
    expect(plan.commands).toContain("bun run eval:decision-efficiency");
  });

  test("authoring domains stay scoped for a texture-only change", () => {
    const plan = planAffectedExecution({
      changedPaths: ["mcp/server/tools/texture/create.ts"],
      semanticImpact: impact(),
    });

    expect(plan.authoring_domains).toEqual(["TEXTURE_UV"]);
  });

  test("identity-set semantic changes fail wide", () => {
    const semanticInvalidation = planSemanticInvalidation([
      {
        id: "cap:new_capability",
        change: "ADDED",
        dimensions: ["ROUTING", "GRAPH", "SCHEMA_PROJECTION"],
      },
    ]);
    const plan = planAffectedExecution({
      changedPaths: ["mcp/gateway/capabilities/manifest.ts"],
      semanticImpact: impact(),
      semanticInvalidation,
    });

    expect(plan.fallback_full_verify).toBe(true);
    expect(plan.commands).toEqual(["bun run verify:full"]);
  });

  test("governance and agent changes select repository contracts without a full-suite fallback", () => {
    for (const path of [
      ".agents/permissions/preflight.mjs",
      ".agents/skills/lazydesigner-modelling/SKILL.md",
      "docs/README.md",
      "mcp/AGENTS.md",
      "CONTRIBUTING.md",
      "mcp/gateway/development/sourceOwners/geometry.ts",
    ]) {
      const plan = planAffectedExecution({ changedPaths: [path], semanticImpact: impact() });
      expect(plan.fallback_full_verify, path).toBe(false);
      expect(plan.checks, path).toContain("REPOSITORY_CONTRACTS");
      expect(plan.commands, path).toContain("bun run verify:repository");
    }
  });

  test("development and knowledge owners select their exact consumer regression tests", async () => {
    const scenarios: Array<[string, string[]]> = [
      ["mcp/lib/semantic/knowledge.ts", [
        "mcp/tests/knowledge-index.test.ts",
        "mcp/tests/development/development-context-plan.test.ts",
      ]],
      ["mcp/scripts/development/plan-development-context.ts", [
        "mcp/tests/development/development-context-plan.test.ts",
      ]],
      ["mcp/gateway/development/sourceOwners.ts", [
        "mcp/gateway/development/sourceOwners.test.ts",
        "mcp/tests/development/semantic-impact.test.ts",
      ]],
      ["mcp/gateway/development/impact.ts", [
        "mcp/tests/development/semantic-impact.test.ts",
      ]],
      ["mcp/scripts/development/analyze-semantic-impact.ts", [
        "mcp/tests/development/semantic-impact.test.ts",
      ]],
      ["mcp/gateway/development/affectedExecution.ts", [
        "mcp/tests/development/affected-execution.test.ts",
      ]],
      ["mcp/tests/development/semantic-impact.test.ts", [
        "mcp/tests/development/semantic-impact.test.ts",
      ]],
    ];
    for (const [path, expectedFiles] of scenarios) {
      const plan = planAffectedExecution({ changedPaths: [path], semanticImpact: impact() });
      expect(plan.fallback_full_verify, path).toBe(false);
      expect(plan.checks, path).toContain("TARGETED_TESTS");
      for (const file of expectedFiles) {
        expect(plan.targeted_tests, path).toContain(file);
        expect(await Bun.file(file.slice(4)).exists(), file).toBe(true);
      }
    }
  });

  test("unmapped, infra, empty-owner, or truncated changes fail safe to the full verifier", () => {
    for (const candidate of [
      planAffectedExecution({
        changedPaths: ["unknown.bin"],
        semanticImpact: impact(),
      }),
      planAffectedExecution({
        changedPaths: ["mcp/package.json"],
        semanticImpact: impact(),
      }),
      planAffectedExecution({
        changedPaths: [".github/workflows/mcp-verify.yml"],
        semanticImpact: impact(),
      }),
      planAffectedExecution({
        changedPaths: ["mcp/about.md"],
        semanticImpact: impact(),
      }),
      planAffectedExecution({
        changedPaths: ["mcp/server/tools/geometry/cubes.ts"],
        semanticImpact: impact({ truncated: true }),
      }),
    ]) {
      expect(candidate.fallback_full_verify).toBe(true);
      expect(candidate.commands).toEqual(["bun run verify:full"]);
    }
  });
});
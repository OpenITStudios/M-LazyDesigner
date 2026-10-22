import type { SemanticImpactReport } from "./impact";
import type { SemanticInvalidationPlan } from "./semanticInvalidation";
import { semanticInvalidationCommands } from "./semanticInvalidation";
import {
  planAuthoringDomainInvalidation,
  type AuthoringDomain,
} from "./domainInvalidation";

export type AffectedExecutionCheck =
  | "TYPECHECK_RUNTIME"
  | "TYPECHECK_GATEWAY"
  | "PROJECT_GRAPH"
  | "AUDIT_UNUSED_RUNTIME"
  | "AUDIT_UNUSED_GATEWAY"
  | "DOCS_FRESHNESS"
  | "REPOSITORY_CONTRACTS"
  | "AUTHORING_CONTRACTS"
  | "TARGETED_TESTS"
  | "CAPABILITY_MANIFEST"
  | "CAPABILITY_INTELLIGENCE"
  | "DECISION_EFFICIENCY"
  | "DESCRIBE_PAYLOADS"
  | "GATEWAY_HOT_PATH_BENCHMARK"
  | "GATEWAY_REPLAY_SHADOW"
  | "HYBRID4_EXPERIMENTAL_CONTRACTS"
  | "FULL_VERIFY";

export type AffectedExecutionPlan = {
  changed_paths: string[];
  checks: AffectedExecutionCheck[];
  targeted_tests: string[];
  authoring_domains: AuthoringDomain[];
  commands: string[];
  fallback_full_verify: boolean;
  reasons: string[];
};

function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

const RECEIPT_CONTINUATION_TEST =
  "mcp/tests/gateway-control-continuation-hardening.test.ts";
const TEXTURE_CONTINUATION_TEST =
  "mcp/tests/control-texture-mutation-precision.test.ts";

export const RECEIPT_CONTRACT_TESTS_BY_PATH: Readonly<
  Record<string, readonly string[]>
> = {
  "mcp/lib/receipts/animationController.ts": [
    "mcp/tests/contracts/animation-controller-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/animationCreation.ts": [
    "mcp/tests/contracts/animation-creation-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/animationEffects.ts": [
    "mcp/tests/contracts/animation-effects-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/authorityTransition.ts": [
    "mcp/tests/contracts/authority-transition-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/boneRigging.ts": [
    "mcp/tests/contracts/bone-rigging-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/cubeMutation.ts": [
    "mcp/tests/contracts/cube-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/groupMutation.ts": [
    "mcp/tests/contracts/group-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/locatorMutation.ts": [
    "mcp/tests/contracts/locator-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/materialInstances.ts": [
    "mcp/tests/contracts/material-instances-receipt-contract.test.ts",
    TEXTURE_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/materialMutation.ts": [
    "mcp/tests/contracts/material-receipt-contract.test.ts",
    "mcp/tests/contracts/material-persistence-receipt-contract.test.ts",
    TEXTURE_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/particleMutation.ts": [
    "mcp/tests/contracts/particle-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/removeElement.ts": [
    "mcp/tests/contracts/remove-element-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/renameElement.ts": [
    "mcp/tests/contracts/rename-element-receipt-contract.test.ts",
    RECEIPT_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/renderProfile.ts": [
    "mcp/tests/contracts/render-profile-receipt-contract.test.ts",
    TEXTURE_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/textureCreation.ts": [
    "mcp/tests/contracts/texture-creation-receipt-contract.test.ts",
    TEXTURE_CONTINUATION_TEST,
  ],
  "mcp/lib/receipts/textureGroup.ts": [
    "mcp/tests/contracts/texture-group-receipt-contract.test.ts",
    TEXTURE_CONTINUATION_TEST,
  ],
};


const SEMANTIC_HISTORY_CONTRACT_TESTS = [
  "mcp/tests/history-result-state.test.ts",
  "mcp/tests/semantic-history-contract.test.ts",
  "mcp/tests/semantic-history-coverage.test.ts",
  "mcp/tests/semantic-history-native-owned.test.ts",
  "mcp/tests/gateway-control-continuation-hardening.test.ts",
] as const;

const CONTROL_DELTA_CONTRACT_TESTS = [
  "mcp/tests/gateway-control-continuation-hardening.test.ts",
  "mcp/tests/gateway-control-invalidation.test.ts",
  "mcp/tests/control-texture-mutation-precision.test.ts",
] as const;

// Direct, source-grounded regressions for recent Texture owners. Keep this
// in the existing affected-work planner; do not introduce a test router or
// infer a false all-clear from an absent filename match.
export const TEXTURE_REGRESSION_TESTS_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  "mcp/lib/texture/paintTransaction.ts": [
    "mcp/tests/texture-region-copy.test.ts",
    "mcp/tests/texture-transaction-dirty-region.test.ts",
  ],
  "mcp/lib/texture/seamContinuity.ts": [
    "mcp/tests/texture-seam-continuity.test.ts",
  ],
  "mcp/lib/texture/geometrySignalCompiler.ts": [
    "mcp/tests/texture-geometry-signal-compiler.test.ts",
  ],
  "mcp/lib/texture/geometrySignalBuilder.ts": [
    "mcp/tests/texture-geometry-signal-compiler.test.ts",
  ],
  "mcp/lib/texture/maskedOps.ts": [
    "mcp/tests/texture-masks.test.ts",
  ],
  "mcp/lib/texture/geometryAwareTreatment.ts": [
    "mcp/tests/texture-masks.test.ts",
  ],
  "mcp/lib/texture/sourceComposer.ts": [
    "mcp/tests/texture-masks.test.ts",
  ],
};

/**
 * Explicit UV source-to-behavior ownership. Local helpers are not guaranteed
 * to resolve through capability-level semantic impact, so project-graph only
 * would otherwise miss their real regression contracts. Keep each key scoped
 * to its existing executor/test owner. Unknown UV modules fail to full verify.
 */
export const UV_REGRESSION_TESTS_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  "mcp/lib/uv/adapters/blockbenchCubeUv.ts": [
    "mcp/tests/uv-u7-apply-contracts.test.ts",
    "mcp/tests/uv-transaction-contract.test.ts",
  ],
  "mcp/lib/uv/authoringRecipeUv.ts": [
    "mcp/tests/uv-authoring-recipe-bridge.test.ts",
  ],
  "mcp/lib/uv/boxLayout.ts": [
    "mcp/tests/uv-core-islands.test.ts",
    "mcp/tests/uv-box-policy.test.ts",
  ],
  "mcp/lib/uv/boxUvPolicy.ts": [
    "mcp/tests/uv-box-policy.test.ts",
  ],
  "mcp/lib/uv/constraints.ts": [
    "mcp/tests/uv-constraints.test.ts",
  ],
  "mcp/lib/uv/contracts.ts": [
    "mcp/tests/uv-core-islands.test.ts",
    "mcp/tests/uv-u7-apply-contracts.test.ts",
    "mcp/tests/uv-tool-contract.test.ts",
  ],
  "mcp/lib/uv/density.ts": [
    "mcp/tests/uv-density-planner.test.ts",
  ],
  "mcp/lib/uv/dryRun.ts": [
    "mcp/tests/uv-dry-run-legacy.test.ts",
  ],
  "mcp/lib/uv/invalidation.ts": [
    "mcp/tests/uv-transaction-contract.test.ts",
    "mcp/tests/uv-downstream-recheck-targets.test.ts",
  ],
  "mcp/lib/uv/islands.ts": [
    "mcp/tests/uv-core-islands.test.ts",
    "mcp/tests/uv-stable-packing.test.ts",
  ],
  "mcp/lib/uv/legacyBridge.ts": [
    "mcp/tests/uv-dry-run-legacy.test.ts",
  ],
  "mcp/lib/uv/maxRectsPlanner.ts": [
    "mcp/tests/uv-maxrects-planner.test.ts",
  ],
  "mcp/lib/uv/nativeApplyPlan.ts": [
    "mcp/tests/uv-native-apply-plan.test.ts",
  ],
  "mcp/lib/uv/nativeState.ts": [
    "mcp/tests/uv-native-state.test.ts",
  ],
  "mcp/lib/uv/nativeTransaction.ts": [
    "mcp/tests/uv-native-transaction.test.ts",
  ],
  "mcp/lib/uv/packing/maxRects.ts": [
    "mcp/tests/uv-maxrects-packing.test.ts",
  ],
  "mcp/lib/uv/packing/planner.ts": [
    "mcp/tests/uv-maxrects-packing.test.ts",
    "mcp/tests/uv-stable-packing.test.ts",
  ],
  "mcp/lib/uv/packing/scorer.ts": [
    "mcp/tests/uv-maxrects-packing.test.ts",
  ],
  "mcp/lib/uv/packing/types.ts": [
    "mcp/tests/uv-maxrects-packing.test.ts",
  ],
  "mcp/lib/uv/physicalEvidence.ts": [
    "mcp/tests/uv-physical-evidence.test.ts",
  ],
  "mcp/lib/uv/planRegistry.ts": [
    "mcp/tests/uv-plan-service.test.ts",
  ],
  "mcp/lib/uv/receipt.ts": [
    "mcp/tests/uv-plan-branch-semantics.test.ts",
    "mcp/tests/uv-transaction-contract.test.ts",
  ],
  "mcp/lib/uv/semanticDiff.ts": [
    "mcp/tests/uv-semantic-planner.test.ts",
  ],
  "mcp/lib/uv/semanticPlanner.ts": [
    "mcp/tests/uv-semantic-planner.test.ts",
    "mcp/tests/uv-share-validation.test.ts",
  ],
  "mcp/lib/uv/service.ts": [
    "mcp/tests/uv-plan-service.test.ts",
    "mcp/tests/uv-plan-branch-semantics.test.ts",
  ],
  "mcp/lib/uv/stacking.ts": [
    "mcp/tests/uv-stacking-proposals.test.ts",
  ],
  "mcp/lib/uv/toolContract.ts": [
    "mcp/tests/uv-tool-contract.test.ts",
    "mcp/tests/uv-registration-readiness.test.ts",
  ],
  "mcp/lib/uv/transaction.ts": [
    "mcp/tests/uv-transaction-contract.test.ts",
  ],
  "mcp/lib/uv/validatePlan.ts": [
    "mcp/tests/uv-u7-apply-contracts.test.ts",
  ],
  "mcp/server/runtime/uv/layoutRuntime.ts": [
    "mcp/tests/uv-blockbench-runtime-adapter.test.ts",
  ],
  "mcp/server/runtime/uv/layoutService.ts": [
    "mcp/tests/uv-registration-readiness.test.ts",
    "mcp/tests/uv-plan-service.test.ts",
  ],
};

// These hot paths affect repeated MCP discovery/Control calls but may not
// map to a single capability source owner. Reuse their existing focused tests.
const GATEWAY_HOT_PATH_REGRESSIONS_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  "mcp/lib/factories.ts": [
    "mcp/tests/structured-result-compaction.test.ts",
    "mcp/tests/mcp-surface-closure.test.ts",
  ],
  "mcp/gateway/presentation/resultCompaction.ts": [
    "mcp/gateway/presentation/resultCompaction.test.ts",
    "mcp/tests/gateway-contract.test.ts",
  ],
  "mcp/gateway/execution/capabilityExecutor.ts": [
    "mcp/gateway/presentation/resultCompaction.test.ts",
    "mcp/tests/gateway-contract.test.ts",
    "mcp/gateway/capabilities/effects.test.ts",
  ],
  "mcp/gateway/control/receipt.ts": [
    "mcp/gateway/capabilities/effects.test.ts",
  ],
  "mcp/gateway/capabilities/effects.ts": [
    "mcp/gateway/capabilities/effects.test.ts",
  ],
  "mcp/gateway/control/orchestration.ts": [
    "mcp/tests/gateway-control-orchestration.test.ts",
  ],
  "mcp/gateway/capabilities/catalog.ts": [
    "mcp/gateway/capabilities/intelligence.test.ts",
    "mcp/tests/capability-discovery-efficiency.test.ts",
  ],
  "mcp/gateway/capabilities/intelligence.ts": [
    "mcp/gateway/capabilities/intelligence.test.ts",
  ],
  "mcp/gateway/control/capabilities.ts": [
    "mcp/tests/gateway-contract.test.ts",
  ],
  "mcp/gateway/handlers/registerCoreTools.ts": [
    "mcp/tests/gateway-contract.test.ts",
    "mcp/gateway/index-boundary.test.ts",
    "mcp/tests/gateway-output-schema.test.ts",
  ],
  "mcp/gateway/control/contextHeadroom.ts": [
    "mcp/tests/gateway-control-context-headroom.test.ts",
  ],
  "mcp/gateway/runtime/operationQueue.ts": [
    "mcp/gateway/runtime/operationQueue.test.ts",
  ],
  "mcp/lib/texture/diagnosticReadContext.ts": [
    "mcp/tests/texture-diagnostic-read-context.test.ts",
  ],
};

const GATEWAY_RECOVERY_CONTRACT_TESTS_BY_PATH: Readonly<
  Record<string, readonly string[]>
> = {
  "mcp/gateway/runtime/backend.ts": [
    "mcp/gateway/backend-effects-boundary.test.ts",
    "mcp/gateway/index-boundary.test.ts",
    "mcp/gateway/capabilities/effects.test.ts",
    "mcp/gateway/runtime/recovery.test.ts",
  ],
  "mcp/gateway/runtime/recovery.ts": [
    "mcp/gateway/runtime/recovery.test.ts",
    "mcp/gateway/runtime/faultInjection.contract.test.ts",
  ],
  "mcp/gateway/runtime/backendContract.ts": [
    "mcp/gateway/backend-effects-boundary.test.ts",
    "mcp/gateway/capabilities/effects.test.ts",
  ],
  "mcp/gateway/session/orchestrationRecoveryState.ts": [
    "mcp/gateway/session/orchestrationRecoveryState.test.ts",
    "mcp/gateway/index-boundary.test.ts",
  ],
  "mcp/gateway/index.ts": [
    "mcp/gateway/index-boundary.test.ts",
  ],
  "mcp/lib/orchestration/correctionLoop.ts": [
    "mcp/tests/correction-loop-reuse.test.ts",
    "mcp/tests/orchestration-public-surface.test.ts",
  ],
  "mcp/lib/orchestration/correctionContinuation.ts": [
    "mcp/tests/correction-loop-reuse.test.ts",
    "mcp/tests/orchestration-public-surface.test.ts",
  ],
  "mcp/lib/orchestration/evidenceRegistry.ts": [
    "mcp/tests/verification-evidence-compaction.test.ts",
  ],
  "mcp/gateway/control/continuationCheckpoint.ts": [
    "mcp/tests/control-continuation-checkpoint.test.ts",
  ],
};


export const FIXTURE_CONTRACT_TESTS_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  "mcp/tests/fixtures/agent-permission-cases.json": [
    "mcp/tests/repository/agent-permission-preflight.test.ts",
  ],
  "mcp/tests/fixtures/astra-live-golden-tasks.json": [
    "mcp/tests/astra-usage-validation-contract.test.ts",
  ],
  "mcp/tests/fixtures/astra-usage-validation-template.json": [
    "mcp/tests/astra-usage-validation-contract.test.ts",
  ],
  "mcp/tests/fixtures/codex-session-policy-input-template.json": [
    "mcp/tests/astra-usage-ready-contract.test.ts",
  ],
  "mcp/tests/fixtures/golden-authoring-run-template.json": [
    "mcp/tests/benchmark/golden-authoring-run-contract.test.ts",
  ],
  "mcp/tests/fixtures/golden-task-cases.json": [
    "mcp/tests/benchmark/golden-benchmark-session-runner.test.ts",
    "mcp/tests/benchmark/quality-benchmark-corpus-contract.test.ts",
  ],
  "mcp/tests/fixtures/native-acceptance-manifest.json": [
    "mcp/tests/native-acceptance-manifest-contract.test.ts",
  ],
  "mcp/tests/fixtures/quality-benchmark-cases.json": [
    "mcp/tests/benchmark/quality-benchmark-contract.test.ts",
  ],
  "mcp/tests/fixtures/regression-cases.json": [
    "mcp/tests/benchmark/quality-benchmark-corpus-contract.test.ts",
  ],
  "mcp/tests/fixtures/skill-routing-cases.json": [
    "mcp/tests/repository/skill-lane-contract.test.ts",
  ],
};

function sharedContractTestsForPath(path: string): readonly string[] {
  const hotPathTests = GATEWAY_HOT_PATH_REGRESSIONS_BY_PATH[path];
  if (hotPathTests) return hotPathTests;
  const textureTests = TEXTURE_REGRESSION_TESTS_BY_PATH[path];
  if (textureTests) return textureTests;
  const uvTests = UV_REGRESSION_TESTS_BY_PATH[path];
  if (uvTests) return uvTests;
  const recoveryContracts = GATEWAY_RECOVERY_CONTRACT_TESTS_BY_PATH[path];
  if (recoveryContracts) return recoveryContracts;
  if (path.startsWith("mcp/lib/receipts/")) {
    return RECEIPT_CONTRACT_TESTS_BY_PATH[path] ?? [];
  }
  if (path === "mcp/lib/authoring/semanticHistory.ts") {
    return SEMANTIC_HISTORY_CONTRACT_TESTS;
  }
  if (path === "mcp/gateway/control/delta/recheck.ts") {
    // Target extraction is a shared Control domain boundary, not a single
    // capability owner. Select its existing Geometry/UV/Texture/Animation
    // behavior contracts without invoking every MCP test.
    return [
      "mcp/tests/control-downstream-recheck.test.ts",
      "mcp/tests/uv-downstream-recheck-targets.test.ts",
      "mcp/tests/texture-region-recheck-targets.test.ts",
      "mcp/tests/animation-downstream-recheck-targets.test.ts",
      "mcp/tests/animation-controller-effects-recheck-targets.test.ts",
    ];
  }
  if (path === "mcp/gateway/control/delta/receipts.ts") {
    return [
      ...CONTROL_DELTA_CONTRACT_TESTS,
      "mcp/tests/contracts/receipt-continuation-contract.test.ts",
    ];
  }
  if (path === "mcp/gateway/control/delta/engine.ts") {
    // Engine is the integration point between verification scopes and
    // downstream target projection, in addition to freshness/invalidation.
    return [
      ...CONTROL_DELTA_CONTRACT_TESTS,
      "mcp/tests/control-downstream-recheck.test.ts",
      "mcp/tests/visual-verification-scope-contract.test.ts",
    ];
  }
  if (path === "mcp/gateway/control/delta/verification.ts") {
    return [
      ...CONTROL_DELTA_CONTRACT_TESTS,
      "mcp/tests/visual-verification-scope-contract.test.ts",
    ];
  }
  if (path === "mcp/gateway/control/delta/freshness.ts") {
    return CONTROL_DELTA_CONTRACT_TESTS;
  }

  // Engineering ownership remains in the existing affected-work planner.
  if (path === "mcp/lib/semantic/knowledge.ts" ||
      path === "mcp/scripts/development/build-knowledge-index.ts") {
    return ["mcp/tests/knowledge-index.test.ts",
      "mcp/tests/development/development-context-plan.test.ts"];
  }
  if (path === "mcp/scripts/development/plan-development-context.ts") {
    return ["mcp/tests/development/development-context-plan.test.ts"];
  }
  if (path === "mcp/gateway/development/sourceOwners.ts" ||
      path.startsWith("mcp/gateway/development/sourceOwners/")) {
    return ["mcp/gateway/development/sourceOwners.test.ts",
      "mcp/tests/development/source-ownership-contract.test.ts",
      "mcp/tests/development/semantic-impact.test.ts"];
  }
  if (path === "mcp/gateway/development/impact.ts" ||
      path === "mcp/scripts/development/analyze-semantic-impact.ts") {
    return ["mcp/tests/development/semantic-impact.test.ts"];
  }
  if (path === "mcp/gateway/development/affectedExecution.ts" ||
      path === "mcp/scripts/development/plan-affected-execution.ts") {
    return ["mcp/tests/development/affected-execution.test.ts"];
  }
  if (path === "mcp/scripts/development/run-affected-execution.ts") {
    return ["mcp/tests/development/affected-execution.test.ts",
      "mcp/tests/development/affected-runner-portability.test.ts"];
  }
  // Select the tests that consume fixture data, not only path-name guards.
  // An unknown fixture keeps the existing conservative full gate.
  if (path.startsWith("mcp/tests/fixtures/")) {
    return FIXTURE_CONTRACT_TESTS_BY_PATH[path] ?? [];
  }
  if (path.startsWith("mcp/tests/development/") &&
      path.endsWith(".test.ts")) return [path];
  return [];
}

function isProjectGraphTypeScript(path: string): boolean {
  return (
    path.endsWith(".ts") &&
    (
      path.startsWith("mcp/gateway/") ||
      path.startsWith("mcp/server/") ||
      path.startsWith("mcp/lib/")
    )
  );
}

function isRuntimeTypeScriptOutsideProjectGraph(path: string): boolean {
  return (
    path.startsWith("mcp/") &&
    path.endsWith(".ts") &&
    !isProjectGraphTypeScript(path)
  );
}

function affectsProjectGraph(path: string): boolean {
  return isProjectGraphTypeScript(path);
}

function affectsDocs(path: string): boolean {
  return (
    path.startsWith("mcp/server/tools/") ||
    path.startsWith("mcp/server/resources/") ||
    path.startsWith("mcp/server/runtime/") ||
    path.startsWith("mcp/build/") ||
    path.startsWith("mcp/prompts/") ||
    path === "mcp/lib/factories.ts"
  );
}

function affectsRepositoryContracts(path: string): boolean {
  return (
    path.startsWith(".github/") ||
    path.startsWith(".agents/permissions/") ||
    path.startsWith(".agents/skills/") ||
    path === "AGENTS.md" ||
    path === "GITHUB_RULES.md" ||
    path === "CONTEXT.md" ||
    path === "CONTRIBUTING.md" ||
    path === "SECURITY.md" ||
    path === "README.md" ||
    path === "mcp/AGENTS.md" ||
    path === "docs/README.md" ||
    path.startsWith("docs/04-system/") ||
    path.startsWith("docs/05-operations/") ||
    path.startsWith("mcp/tests/repository/") ||
    path.startsWith("mcp/gateway/control/") ||
    path.startsWith("mcp/gateway/development/") ||
    path === "mcp/lib/semantic/knowledge.ts" ||
    path === "mcp/scripts/development/plan-development-context.ts" ||
    path === "mcp/scripts/development/build-knowledge-index.ts" ||
    path === "mcp/scripts/development/analyze-semantic-impact.ts" ||
    path === "mcp/scripts/development/plan-affected-execution.ts" ||
    path === "mcp/scripts/development/run-affected-execution.ts"
  );
}

function affectsGatewayHotPathBenchmark(path: string): boolean {
  return (
    path === "mcp/scripts/benchmark/benchmark-gateway-hot-path.ts" ||
    path === "mcp/tests/benchmark/gateway-hot-path-strategy-benchmark.test.ts" ||
    path === "mcp/gateway/experimental/hybridProfile.ts" ||
    path === "mcp/gateway/experimental/hybridRegistration.ts"
  );
}

function affectsGatewayReplayShadow(path: string): boolean {
  return (
    path === "mcp/scripts/benchmark/fixtures/gateway-replay-corpus.ts" ||
    path === "mcp/gateway/experimental/shadowRouting.ts" ||
    path === "mcp/scripts/benchmark/benchmark-gateway-replay-shadow.ts" ||
    path === "mcp/scripts/evaluate/evaluate-hybrid-promotion-policy.ts" ||
    path === "mcp/tests/benchmark/gateway-replay-shadow-benchmark.test.ts" ||
    path === "mcp/tests/benchmark/hybrid-promotion-policy.test.ts" ||
    path === "mcp/gateway/experimental/hybridProfile.ts" ||
    path === "mcp/gateway/experimental/generated/hybrid4Schemas.ts"
  );
}

function affectsGatewayOutputContracts(path: string): boolean {
  return (
    path === "mcp/gateway/contracts/outputSchemas.ts" ||
    path === "mcp/tests/gateway-output-schema.test.ts" ||
    path === "mcp/gateway/index.ts"
  );
}

function affectsHybrid4ExperimentalContracts(path: string): boolean {
  return (
    path.startsWith("mcp/gateway/experimental/") ||
    path === "mcp/scripts/generate/generate-hybrid4-schemas.ts" ||
    path === "mcp/scripts/benchmark/benchmark-gateway-hot-path.ts" ||
    path === "mcp/tests/benchmark/gateway-hot-path-strategy-benchmark.test.ts" ||
    path === "mcp/tests/benchmark/hybrid4-generated-schema.test.ts" ||
    path === "mcp/tests/benchmark/hybrid4-precondition-safety.test.ts" ||
    path === "mcp/docs/api.json"
  );
}

function affectsAuthoringContracts(path: string): boolean {
  return (
    path.startsWith(".agents/skills/lazydesigner-") ||
    path.startsWith("docs/03-authoring/") ||
    path.startsWith("mcp/server/tools/") ||
    path.startsWith("mcp/server/runtime/") ||
    path.startsWith("mcp/gateway/control/") ||
    path.startsWith("mcp/tests/authoring/")
  );
}

function requiresFullVerify(path: string): boolean {
  return (
    path === "mcp/package.json" ||
    path === "mcp/bun.lock" ||
    path === "mcp/tsconfig.json" ||
    path === "mcp/gateway/tsconfig.json" ||
    path === ".bun-version" ||
    path === ".github/workflows/mcp-verify.yml"
  );
}

function clearlyMappedPath(path: string): boolean {
  return (
    path.startsWith("mcp/") ||
    path.startsWith(".agents/") ||
    path.startsWith("docs/") ||
    path.startsWith(".github/") ||
    path === "AGENTS.md" ||
    path === "GITHUB_RULES.md" ||
    path === "CONTEXT.md" ||
    path === "CONTRIBUTING.md" ||
    path === "SECURITY.md" ||
    path === "README.md"
  );
}

export function planAffectedExecution(input: {
  changedPaths: readonly string[];
  semanticImpact: SemanticImpactReport;
  semanticInvalidation?: SemanticInvalidationPlan;
}): AffectedExecutionPlan {
  const changedPaths = uniqueSorted(input.changedPaths.map(normalize));
  const checks = new Set<AffectedExecutionCheck>();
  const reasons: string[] = [];
  const domainInvalidation = planAuthoringDomainInvalidation({
    changedPaths,
    affectedCapabilities: input.semanticImpact.affected_capabilities.map(
      (entry) => entry.capability
    ),
    affectedSources: input.semanticImpact.affected_sources,
    affectedSpecialists: input.semanticImpact.affected_specialists,
  });

  if (
    input.semanticImpact.truncated ||
    changedPaths.length === 0 ||
    changedPaths.some(requiresFullVerify) ||
    // New or previously unowned UV source cannot pass on a typecheck alone.
    changedPaths.some((path) =>
      (path.startsWith("mcp/lib/uv/") ||
        path.startsWith("mcp/server/runtime/uv/")) &&
      path.endsWith(".ts") &&
      !UV_REGRESSION_TESTS_BY_PATH[path]
    ) ||
    changedPaths.some((path) => !clearlyMappedPath(path))
  ) {
    checks.add("FULL_VERIFY");
    reasons.push(
      input.semanticImpact.truncated
        ? "semantic impact was truncated"
        : changedPaths.length === 0
          ? "no change set was provided"
          : changedPaths.some(requiresFullVerify)
            ? "change set contains build or dependency infrastructure"
            : changedPaths.some((path) =>
                (path.startsWith("mcp/lib/uv/") ||
                  path.startsWith("mcp/server/runtime/uv/")) &&
                path.endsWith(".ts") &&
                !UV_REGRESSION_TESTS_BY_PATH[path]
              )
              ? "UV source has no explicit behavior regression owner"
              : "change set contains an unmapped path"
    );
  }

  if (changedPaths.some(affectsProjectGraph)) {
    checks.add("PROJECT_GRAPH");
  }
  if (changedPaths.some(isRuntimeTypeScriptOutsideProjectGraph)) {
    checks.add("TYPECHECK_RUNTIME");
    checks.add("AUDIT_UNUSED_RUNTIME");
  }
  if (changedPaths.some(affectsDocs)) checks.add("DOCS_FRESHNESS");
  if (changedPaths.some(affectsGatewayHotPathBenchmark)) {
    checks.add("GATEWAY_HOT_PATH_BENCHMARK");
  }
  if (changedPaths.some(affectsGatewayOutputContracts)) {
    checks.add("TARGETED_TESTS");
  }
  if (changedPaths.some(affectsGatewayReplayShadow)) {
    checks.add("GATEWAY_REPLAY_SHADOW");
  }
  if (changedPaths.some(affectsHybrid4ExperimentalContracts)) {
    checks.add("HYBRID4_EXPERIMENTAL_CONTRACTS");
  }
  if (changedPaths.some(affectsRepositoryContracts)) {
    checks.add("REPOSITORY_CONTRACTS");
  }
  if (changedPaths.some(affectsAuthoringContracts)) {
    checks.add("AUTHORING_CONTRACTS");
  }

  if (input.semanticInvalidation?.full_catalog_invalidation) {
    checks.add("FULL_VERIFY");
    reasons.push("semantic capability identity set changed");
  } else if (input.semanticInvalidation) {
    for (const check of input.semanticInvalidation.checks) {
      checks.add(check);
    }
  }

  const targetedTests = uniqueSorted([
    ...input.semanticImpact.affected_anchor_tests.filter((path) =>
      path.startsWith("mcp/") && path.endsWith(".test.ts")
    ),
    ...changedPaths.flatMap(sharedContractTestsForPath),
    // An edited executable test must run. Repository/authoring tests already
    // run via their owning suite, so avoid a duplicate focused invocation.
    ...changedPaths.filter((path) =>
      path.startsWith("mcp/") && path.endsWith(".test.ts") &&
      !path.startsWith("mcp/tests/repository/") &&
      !path.startsWith("mcp/tests/authoring/")
    ),
    ...(changedPaths.some(affectsGatewayOutputContracts)
      ? ["mcp/tests/gateway-output-schema.test.ts"]
      : []),
  ]);
  if (targetedTests.length > 0) checks.add("TARGETED_TESTS");

  if (checks.size === 0) {
    checks.add("FULL_VERIFY");
    reasons.push("mapped change produced no safe bounded verification owner");
  }

  const commands: string[] = [];
  if (checks.has("FULL_VERIFY")) {
    commands.push("bun run verify:full");
  } else {
    if (checks.has("DOCS_FRESHNESS")) commands.push("bun run docs:check");
    if (checks.has("PROJECT_GRAPH")) {
      commands.push("bun run verify:project-graph");
    }
    if (checks.has("TYPECHECK_RUNTIME")) commands.push("bun run typecheck");
    if (checks.has("TYPECHECK_GATEWAY")) commands.push("bun run typecheck:gateway");
    if (checks.has("AUDIT_UNUSED_RUNTIME")) commands.push("bun run audit:unused");
    if (checks.has("AUDIT_UNUSED_GATEWAY")) {
      commands.push("bun run audit:unused:gateway");
    }
    if (checks.has("TARGETED_TESTS")) {
      commands.push(
        `bun test ${targetedTests.map((path) =>
          path.startsWith("mcp/") ? path.slice(4) : path
        ).join(" ")}`
      );
    }
    if (checks.has("GATEWAY_HOT_PATH_BENCHMARK")) {
      commands.push("bun run benchmark:gateway-hot-path");
    }
    if (checks.has("GATEWAY_REPLAY_SHADOW")) {
      commands.push("bun run benchmark:gateway-replay-shadow");
      commands.push("bun run eval:hybrid-promotion-policy");
    }
    if (checks.has("HYBRID4_EXPERIMENTAL_CONTRACTS")) {
      commands.push(
        "bun test tests/benchmark/gateway-hot-path-strategy-benchmark.test.ts tests/benchmark/hybrid4-generated-schema.test.ts tests/benchmark/hybrid4-precondition-safety.test.ts"
      );
    }
    if (checks.has("AUTHORING_CONTRACTS")) {
      commands.push("bun run verify:authoring");
    }
    if (checks.has("REPOSITORY_CONTRACTS")) {
      commands.push("bun run verify:repository");
    }
    if (input.semanticInvalidation) {
      commands.push(...semanticInvalidationCommands(input.semanticInvalidation));
    }
  }

  return {
    changed_paths: changedPaths,
    checks: [...checks].sort(),
    targeted_tests: targetedTests,
    authoring_domains: domainInvalidation.domains,
    commands: uniqueSorted(commands),
    fallback_full_verify: checks.has("FULL_VERIFY"),
    reasons,
  };
}

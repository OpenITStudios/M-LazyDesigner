import { readFile } from "node:fs/promises";
import { analyzeSemanticImpact } from "../../gateway/development/impact";
import {
  indexMarkdownKnowledge,
  indexExplicitDocumentationEdges,
  describeKnowledgeSource,
  selectKnowledgeSections,
  type ExplicitDocumentationEdge,
  type KnowledgeSelection,
} from "../../lib/semantic/knowledge";
import { CAPABILITY_BRANCH_MANIFEST } from "../../gateway/capabilities/manifest";
import { CAPABILITY_SEMANTIC_CATALOG_REVISIONS } from "../../gateway/capabilities/semanticRegistry";
import {
  anchorTestForSourceOwner,
  authoringDomainForCapability,
  listExplicitSourceOwners,
} from "../../gateway/development/sourceOwners";
import { resolveDevelopmentIntent } from "../../gateway/development/intent";
import { buildAffectedExecutionPlan } from "./plan-affected-execution";
import {
  buildDevelopmentSymbolMap,
  DEVELOPMENT_SYMBOL_MAP_PROXY_BYTES,
} from "./build-development-symbol-map";

export type DevelopmentContextPlan = {
  schema: 1;
  intent: string;
  routing: {
    domain: string;
    confidence: string;
    context_strategy: string;
    matched_terms: string[];
    required_context_paths: string[];
    avoid_context_classes: string[];
  };
  symbol_map: Awaited<ReturnType<typeof buildDevelopmentSymbolMap>>;
  semantic_impact: ReturnType<typeof analyzeSemanticImpact> | null;
  semantic_catalog_revisions: typeof CAPABILITY_SEMANTIC_CATALOG_REVISIONS;
  knowledge_sections: KnowledgeSelection[];
  documentation_route: {
    authority: "EXPLICIT_MARKDOWN_LINK";
    nodes: string[];
    edges: ExplicitDocumentationEdge[];
    canonical_owner: string;
    /** Snapshot identity of the two authored routers, not Git HEAD proof. */
    source_hashes: Array<{ path: string; content_sha256: string }>;
  } | null;
  evidence_chain?: DevelopmentEvidenceChain;
  read_targets: {
    source: string[];
    anchor_tests: string[];
    specialists: string[];
  };
};

/**
 * Read only two canonical routers when exact implementation ownership remains
 * ambiguous. Links must exist in authored Markdown: search/ranking cannot
 * invent document relationships.
 */
async function resolveUncertainSystemDocumentRoute(): Promise<NonNullable<DevelopmentContextPlan["documentation_route"]>> {
  const root = "docs/README.md";
  const findUniqueRole = (
    links: ExplicitDocumentationEdge[],
    label: string,
    router: string
  ): ExplicitDocumentationEdge => {
    const matches = links.filter((edge) => edge.label === label);
    if (matches.length !== 1) {
      throw new Error(
        `Expected one canonical "${label}" route from ${router}, found ${matches.length}. ` +
        "Repair the router instead of guessing a document owner."
      );
    }
    return matches[0]!;
  };
  const rootText = await readFile("../docs/README.md", "utf8");
  const rootEdge = findUniqueRole(
    indexExplicitDocumentationEdges(root, rootText),
    "System documentation router",
    root
  );
  const system = rootEdge.to;
  const systemText = await readFile(`../${system}`, "utf8");
  const ownerEdge = findUniqueRole(
    indexExplicitDocumentationEdges(system, systemText),
    "Implementation Map",
    system
  );
  const owner = ownerEdge.to;
  return {
    authority: "EXPLICIT_MARKDOWN_LINK",
    nodes: [root, system, owner],
    edges: [rootEdge, ownerEdge],
    canonical_owner: owner,
    source_hashes: [
      { path: root,
        content_sha256: describeKnowledgeSource(root, rootText).content_sha256 },
      { path: system,
        content_sha256: describeKnowledgeSource(system, systemText).content_sha256 },
    ],
  };
}

function developmentDomainForCapability(
  capability: string
): "GEOMETRY" | "TEXTURING" | "ANIMATION" | "PARTICLE" | null {
  if (capability === "manage_particle" || capability === "inspect_particle") {
    return "PARTICLE";
  }
  const domain = authoringDomainForCapability(capability);
  return domain === "GEOMETRY" ||
      domain === "TEXTURING" ||
      domain === "ANIMATION"
    ? domain
    : null;
}

function directEvidenceDomain(
  directCapabilities: readonly string[]
): "GEOMETRY" | "TEXTURING" | "ANIMATION" | "PARTICLE" | null {
  const domains = new Set(
    directCapabilities
      .map(developmentDomainForCapability)
      .filter(
        (
          value
        ): value is "GEOMETRY" | "TEXTURING" | "ANIMATION" | "PARTICLE" =>
          value !== null
      )
  );
  return domains.size === 1 ? [...domains][0] : null;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}


/**
 * An optional, read-only cross-owner PROJECTION, not a task state store or a
 * new authority registry. It composes existing Router, Capability ownership,
 * semantic impact and the canonical affected verification planner. All fields
 * are static declarations/plans; no command is executed or permission granted.
 */
export type DevelopmentEvidenceChain = {
  schema: 1;
  authority: "DERIVED_DEVELOPMENT_EVIDENCE_NOT_EXECUTION";
  proof: "PLANNED_NOT_EXECUTED";
  source_revision: "GIT_HEAD_NOT_BOUND_BY_CONTEXT_PLANNER";
  change_set_provenance: "CALLER_SUPPLIED_NOT_GIT_DIFF_VERIFIED";
  changed_paths: string[];
  decision: {
    status: "AUTHORED_DOCUMENT_ROUTE" | "NO_DOCUMENT_ROUTE_DIRECT_OR_UNRESOLVED_SOURCE";
    canonical_document: string | null;
    document_to_code_relation: "NOT_ESTABLISHED_FROM_DOCUMENT_NAVIGATION";
    witnesses: Array<{
      from: string;
      to: string;
      line: number;
      relation: ExplicitDocumentationEdge["relation"];
      source_sha256: string | null;
    }>;
  };
  direct_capability_owners: Array<{
    capability: string;
    owner_source: string;
    owner_specialist: string | null;
    anchor_test: string | null;
    changed_evidence: Array<
      "DIRECT_SOURCE" | "DIRECT_ANCHOR_TEST" | "DIRECT_SPECIALIST"
    >;
    proof: "EXPLICIT_CAPABILITY_OWNER_DECLARATION_NOT_RUNTIME_PROOF";
  }>;
  outside_explicit_capability_owner_paths: string[];
  affected_capabilities: Array<{
    capability: string;
    reasons: string[];
    owner_source: string | null;
    anchor_test: string | null;
    proof: "SEMANTIC_IMPACT_CANDIDATE";
  }>;
  source_dependency: {
    status: "AST_IMPORT_GRAPH_NOT_SCANNED_BY_CONTEXT_PLANNER";
    available_impact_queries: string[];
    interpretation: string;
  };
  verification: {
    status: "CHECKS_PLANNED_NOT_EXECUTED";
    added_path_proof: "ADDED_PATH_IDENTITY_NOT_PROVIDED";
    checks: string[];
    anchor_test_declarations: string[];
    targeted_tests: string[];
    commands: string[];
    fallback_full_verify: boolean;
    unowned_new_runtime_sources: string[];
    reasons: string[];
  };
  open_obligations: Array<
    "NO_SELECTED_CHANGE_SET" | "NO_EXACT_CAPABILITY_OWNER_FOR_SOME_PATHS" |
    "NO_DIRECT_DOCUMENT_TO_SOURCE_WITNESS" | "SOURCE_IMPORTS_UNVERIFIED" |
    "CHECKS_NOT_EXECUTED" | "NEW_RUNTIME_SOURCE_TEST_OWNER_MISSING" |
    "CHANGE_SET_NOT_GIT_VERIFIED" | "ADDED_PATH_IDENTITY_NOT_PROVIDED"
  >;
};


/** Path-only evidence selection; never trust it as an actual Git diff. */
export function validateEvidenceChangePaths(paths: readonly string[]): string[] {
  if (paths.length > 64)
    throw new Error("EVIDENCE_CHANGE_SCOPE_TOO_LARGE: select at most 64 paths.");
  const permittedRoots = new Set([
    "mcp", "apps", "distribution", "docs", "experiments",
    ".agents", ".github", "workspace",
  ]);
  const permittedFiles = new Set([
    "AGENTS.md", "GITHUB_RULES.md", "CONTEXT.md", "CONTRIBUTING.md",
    "README.md", "SECURITY.md", "package.json", "LICENSE",
  ]);
  const sensitiveSegments = new Set([
    ".git", ".env", ".ssh", "secrets", "credentials",
  ]);
  const normalized: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== "string" || raw.length < 1 || raw.length > 4096)
      throw new Error("EVIDENCE_CHANGE_PATH_UNSAFE");
    const path = raw.replaceAll("\\", "/").replace(/^\.\//, "");
    const parts = path.split("/");
    if (!/^[A-Za-z0-9._/-]+$/.test(path) ||
        parts.some(part => !part || part === "." || part === ".." ||
          sensitiveSegments.has(part.toLowerCase()) ||
          part.toLowerCase().startsWith(".env.")) ||
        (parts.length === 1 ? !permittedFiles.has(path)
          : !permittedRoots.has(parts[0]!))) {
      throw new Error("EVIDENCE_CHANGE_PATH_UNSAFE: " + raw);
    }
    normalized.push(path);
  }
  return uniqueSorted(normalized);
}

export function projectDevelopmentEvidenceChain(input: {
  changedPaths: readonly string[];
  semanticImpact: DevelopmentContextPlan["semantic_impact"];
  documentationRoute: DevelopmentContextPlan["documentation_route"];
}): DevelopmentEvidenceChain {
  // These are the actual selected changed paths, not keyword-matched candidates.
  const changed = validateEvidenceChangePaths(input.changedPaths);
  // Compose verification only from its canonical planner, not a caller-supplied
  // or independently cached plan with potentially forged commands.
  const affectedPlan = buildAffectedExecutionPlan(changed);
  const matchesSelection = (actual: readonly string[]) =>
    JSON.stringify(validateEvidenceChangePaths(actual)) === JSON.stringify(changed);
  if ((input.semanticImpact !== null &&
       !matchesSelection(input.semanticImpact.changed_paths)) ||
      (input.semanticImpact === null && changed.length !== 0) ||
      !matchesSelection(affectedPlan.execution.changed_paths)) {
    throw new Error("EVIDENCE_CHANGE_SET_MISMATCH: refuse to join unrelated source and proof plans.");
  }
  if (input.semanticImpact !== null &&
      JSON.stringify(input.semanticImpact) !== JSON.stringify(affectedPlan.semantic_impact)) {
    throw new Error("EVIDENCE_SEMANTIC_OWNER_DRIFT: source impact and check plan disagree.");
  }
  const changedSet = new Set(changed);
  const directReasons = new Set([
    "DIRECT_SOURCE", "DIRECT_ANCHOR_TEST", "DIRECT_SPECIALIST",
  ]);
  const direct = (input.semanticImpact?.affected_capabilities ?? [])
    .filter(entry => entry.source_owner !== null &&
      entry.reasons.some(reason => directReasons.has(reason)))
    .map(entry => ({
      capability: entry.capability,
      owner_source: entry.source_owner!.source,
      owner_specialist: entry.source_owner!.specialist,
      anchor_test: entry.source_owner!.anchor_test,
      changed_evidence: entry.reasons.filter(reason =>
        directReasons.has(reason)) as Array<
        "DIRECT_SOURCE" | "DIRECT_ANCHOR_TEST" | "DIRECT_SPECIALIST">,
      proof: "EXPLICIT_CAPABILITY_OWNER_DECLARATION_NOT_RUNTIME_PROOF" as const,
    }))
    .sort((a, b) => a.capability.localeCompare(b.capability));
  const directlyRepresented = new Set<string>();
  for (const item of direct) {
    if (changedSet.has(item.owner_source)) directlyRepresented.add(item.owner_source);
    if (item.anchor_test && changedSet.has(item.anchor_test))
      directlyRepresented.add(item.anchor_test);
  }
  // Specialist paths are admitted only when declared by the same explicit
  // capability owner; keyword-matched routing is never ownership proof.
  for (const item of direct) {
    if (item.owner_specialist && changedSet.has(item.owner_specialist))
      directlyRepresented.add(item.owner_specialist);
  }
  const unclassified = changed.filter(path => !directlyRepresented.has(path));
  const hashByPath = new Map((input.documentationRoute?.source_hashes ?? [])
    .map(item => [item.path, item.content_sha256]));
  const anchorTests = uniqueSorted(direct.flatMap(item =>
    item.anchor_test ? [item.anchor_test] : []
  ));
  const selectedImpactQueries = changed.filter(path =>
    (path === "mcp/index.ts" ||
      /^mcp\/(?:lib|gateway|server|plugin|scripts|build|compatibility)\//.test(path)) &&
    /\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/.test(path)
  ).slice(0, 3).map(path =>
    "bun run audit:reachability -- --impact=" + path + " --format=json"
  );
  const execution = affectedPlan.execution;
  const obligations: DevelopmentEvidenceChain["open_obligations"] = [];
  if (changed.length === 0) obligations.push("NO_SELECTED_CHANGE_SET");
  if (unclassified.length > 0) obligations.push("NO_EXACT_CAPABILITY_OWNER_FOR_SOME_PATHS");
  // A doc-to-doc router edge is not a doc-to-source witness.
  obligations.push("NO_DIRECT_DOCUMENT_TO_SOURCE_WITNESS", "SOURCE_IMPORTS_UNVERIFIED");
  if (execution.unowned_new_runtime_sources.length)
    obligations.push("NEW_RUNTIME_SOURCE_TEST_OWNER_MISSING");
  obligations.push("CHECKS_NOT_EXECUTED",
    "CHANGE_SET_NOT_GIT_VERIFIED", "ADDED_PATH_IDENTITY_NOT_PROVIDED");

  return {
    schema: 1,
    authority: "DERIVED_DEVELOPMENT_EVIDENCE_NOT_EXECUTION",
    proof: "PLANNED_NOT_EXECUTED",
    source_revision: "GIT_HEAD_NOT_BOUND_BY_CONTEXT_PLANNER",
    change_set_provenance: "CALLER_SUPPLIED_NOT_GIT_DIFF_VERIFIED",
    changed_paths: changed,
    decision: {
      status: input.documentationRoute
        ? "AUTHORED_DOCUMENT_ROUTE" : "NO_DOCUMENT_ROUTE_DIRECT_OR_UNRESOLVED_SOURCE",
      canonical_document: input.documentationRoute?.canonical_owner ?? null,
      document_to_code_relation: "NOT_ESTABLISHED_FROM_DOCUMENT_NAVIGATION",
      witnesses: (input.documentationRoute?.edges ?? []).map(edge => ({
        from: edge.from, to: edge.to, line: edge.line,
        relation: edge.relation,
        source_sha256: hashByPath.get(edge.from) ?? null,
      })),
    },
    direct_capability_owners: direct,
    outside_explicit_capability_owner_paths: unclassified,
    affected_capabilities: (input.semanticImpact?.affected_capabilities ?? [])
      .map(entry => ({
        capability: entry.capability,
        reasons: entry.reasons,
        owner_source: entry.source_owner?.source ?? null,
        anchor_test: entry.source_owner?.anchor_test ?? null,
        proof: "SEMANTIC_IMPACT_CANDIDATE" as const,
      })),
    source_dependency: {
      status: "AST_IMPORT_GRAPH_NOT_SCANNED_BY_CONTEXT_PLANNER",
      available_impact_queries: selectedImpactQueries,
      interpretation: "No AST import, function call or knowledge consumption was " +
        "established by this context plan. Use the existing opt-in source auditor.",
    },
    verification: {
      status: "CHECKS_PLANNED_NOT_EXECUTED",
      added_path_proof: "ADDED_PATH_IDENTITY_NOT_PROVIDED",
      checks: execution.checks,
      anchor_test_declarations: anchorTests,
      targeted_tests: execution.targeted_tests,
      commands: execution.commands,
      fallback_full_verify: execution.fallback_full_verify,
      unowned_new_runtime_sources: execution.unowned_new_runtime_sources,
      reasons: execution.reasons,
    },
    open_obligations: obligations,
  };
}

export async function buildDevelopmentContextPlan(input: {
  intent: string;
  changedPaths?: readonly string[];
  symbolMapMaxBytes?: number;
  knowledgeTokenBudget?: number;
  /** Opt-in evidence/proof planning, never a default authoring/context read. */
  includeEvidenceChain?: boolean;
}): Promise<DevelopmentContextPlan> {
  const evidencePaths = input.includeEvidenceChain === true
    ? validateEvidenceChangePaths(input.changedPaths ?? [])
    : input.changedPaths;
  const routing = resolveDevelopmentIntent(input.intent);
  const sourceOwners = listExplicitSourceOwners();
  const symbolMap = await buildDevelopmentSymbolMap(
    input.intent,
    input.symbolMapMaxBytes ?? DEVELOPMENT_SYMBOL_MAP_PROXY_BYTES
  );
  const semanticImpact =
    evidencePaths && evidencePaths.length > 0
      ? analyzeSemanticImpact({
          changedPaths: evidencePaths,
          sourceOwners,
          manifest: CAPABILITY_BRANCH_MANIFEST,
        })
      : null;

  const evidenceDomain = semanticImpact
    ? directEvidenceDomain(semanticImpact.direct_capabilities)
    : null;
  const evidenceOwners = semanticImpact
    ? semanticImpact.direct_capabilities
        .map((capability) => sourceOwners[capability])
        .filter((owner): owner is NonNullable<typeof owner> => owner != null)
    : [];
  const effectiveRouting =
    routing.confidence !== "EXACT" && evidenceDomain
      ? {
          ...routing,
          domain: evidenceDomain,
          confidence: "EXACT" as const,
          context_strategy: "DIRECT_SOURCE_OWNERS" as const,
          matched_terms: semanticImpact!.direct_capabilities.map(
            (capability) => `changed-owner:${capability}`
          ),
          source_owners: evidenceOwners,
          required_context_paths: [
            ...new Set([
              "AGENTS.md",
              "mcp/AGENTS.md",
              ...evidenceOwners.flatMap((owner) =>
                owner.specialist ? [owner.specialist] : []
              ),
            ]),
          ],
        }
      : routing;

  const routingSources = effectiveRouting.source_owners.map((owner) => owner.source);
  const routingAnchorTests = effectiveRouting.source_owners.flatMap((owner) => {
    const anchorTest = anchorTestForSourceOwner(owner);
    return anchorTest ? [anchorTest] : [];
  });
  const routingSpecialists = effectiveRouting.source_owners.flatMap((owner) =>
    owner.specialist ? [owner.specialist] : []
  );


  // Source ownership outranks docs graph discovery. Only unresolved/ambiguous
  // development requests follow the explicit two-hop documentation route.
  const documentationRoute = effectiveRouting.context_strategy === "DIRECT_SOURCE_OWNERS"
    ? null
    : await resolveUncertainSystemDocumentRoute();

  const knowledgePaths = uniqueSorted([
    ...(documentationRoute ? [documentationRoute.canonical_owner] : []),
    ...effectiveRouting.required_context_paths,
    ...routingSpecialists,
    ...(semanticImpact?.affected_specialists ?? []),
  ]).filter((path) => /\.md$/i.test(path));

  const knowledgeSections = (
    await Promise.all(
      knowledgePaths.map(async (path) => {
        const localPath = path.startsWith("mcp/")
          ? path.slice(4)
          : `../${path}`;
        // A missing routed/required source is an unresolved authority error,
        // never evidence that the relevant knowledge is empty.
        const content = await readFile(localPath, "utf8");
        return indexMarkdownKnowledge(path, content);
      })
    )
  ).flat();

  const selectedKnowledge = selectKnowledgeSections({
    sections: knowledgeSections,
    query: effectiveRouting.intent,
    maxTokenProxy: input.knowledgeTokenBudget ?? 1200,
  });

  const directOwnershipIsAuthoritative =
    semanticImpact !== null &&
    evidenceDomain !== null &&
    effectiveRouting.context_strategy === "DIRECT_SOURCE_OWNERS";

  return {
    schema: 1,
    intent: effectiveRouting.intent,
    routing: {
      domain: effectiveRouting.domain,
      confidence: effectiveRouting.confidence,
      context_strategy: effectiveRouting.context_strategy,
      matched_terms: effectiveRouting.matched_terms,
      required_context_paths: effectiveRouting.required_context_paths,
      avoid_context_classes: effectiveRouting.avoid_context_classes,
    },
    symbol_map: symbolMap,
    semantic_impact: semanticImpact,
    semantic_catalog_revisions:
      CAPABILITY_SEMANTIC_CATALOG_REVISIONS,
    knowledge_sections: selectedKnowledge,
    documentation_route: documentationRoute,
    ...(input.includeEvidenceChain === true ? {
      evidence_chain: projectDevelopmentEvidenceChain({
        changedPaths: evidencePaths ?? [],
        semanticImpact,
        documentationRoute,
      }),
    } : {}),
    read_targets: {
      source: uniqueSorted([
        ...routingSources,
        ...(directOwnershipIsAuthoritative
          ? []
          : semanticImpact?.affected_sources ?? []),
      ]),
      anchor_tests: uniqueSorted([
        ...routingAnchorTests,
        ...(directOwnershipIsAuthoritative
          ? []
          : semanticImpact?.affected_anchor_tests ?? []),
      ]),
      specialists: uniqueSorted([
        ...routingSpecialists,
        ...(directOwnershipIsAuthoritative
          ? []
          : semanticImpact?.affected_specialists ?? []),
      ]),
    },
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const evidenceFlags = rawArgs.filter(arg => arg === "--evidence-chain");
  if (evidenceFlags.length > 1) {
    throw new Error("Duplicate --evidence-chain option.");
  }
  const includeEvidenceChain = evidenceFlags.length === 1;
  const args = rawArgs.filter(arg => arg !== "--evidence-chain");
  const separator = args.indexOf("--changed");
  const intentParts = separator >= 0 ? args.slice(0, separator) : args;
  const changedPaths = separator >= 0 ? args.slice(separator + 1) : [];
  const intent = intentParts.join(" ").trim();

  if (!intent) {
    throw new Error(
      'Usage: bun run plan:development-context -- "<intent>" [--changed <path> ...] [--evidence-chain]'
    );
  }

  console.log(
    JSON.stringify(
      await buildDevelopmentContextPlan({
        intent,
        changedPaths,
        includeEvidenceChain,
      }),
      null,
      2
    )
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

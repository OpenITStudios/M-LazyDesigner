/**
 * Read-only, on-demand import reachability audit for source hygiene.
 *
 * This is a derived source graph, not a new registry, Runtime router or
 * permission to delete files. Runtime imports, CLI scripts, tests, dynamic
 * imports and external compatibility callers have different ownership.
 * Absence of a static edge is REVIEW_REQUIRED, never proof of dead code.
 */
import ts from "typescript-compat";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type SourceReachabilityClass =
  | "RUNTIME_REACHABLE"
  | "TOOLING_REACHABLE"
  | "TYPE_ONLY_REFERENCED"
  | "TEST_ONLY"
  | "EXTERNAL_COMPATIBILITY_REVIEW"
  | "UNREFERENCED_REVIEW";

export type SourceReachabilityRoots = {
  runtime: readonly string[];
  tooling: readonly string[];
  tests: readonly string[];
};

export type SourceReachabilityGraph = Readonly<Record<string, readonly string[]>>;

export type SourceReachabilitySummary = {
  schema: "lazydesigner-source-reachability-v1";
  authority: "STATIC_IMPORT_GRAPH_REVIEW_ONLY";
  total_source_modules: number;
  classes: Record<SourceReachabilityClass, number>;
  missing_roots: string[];
  review_candidate_count: number;
  /** Offset of this deterministic orphan-first review page. */
  review_offset: number;
  review_next_offset: number | null;
  review_examples: string[];
  review_examples_truncated: boolean;
  unresolved_local_imports: string[];
  unresolved_local_imports_truncated: boolean;
  dynamic_import_file_count: number;
  limitations: string;
};

const CLASS_ORDER: readonly SourceReachabilityClass[] = [
  "RUNTIME_REACHABLE", "TOOLING_REACHABLE", "TYPE_ONLY_REFERENCED", "TEST_ONLY",
  "EXTERNAL_COMPATIBILITY_REVIEW", "UNREFERENCED_REVIEW",
];
const LIMITATIONS =
  "A static import graph does not prove dead code or live execution. " +
  "Dynamic/nonliteral imports, unobserved Runtime registrations, externally consumed facades, " +
  "Runtime registrations and generated artifacts require separate review. " +
  "Never auto-remove a flagged module or call an unexecuted audit a PASS.";

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function walkDependencies(
  graph: SourceReachabilityGraph,
  roots: readonly string[]
): Set<string> {
  const available = new Set(Object.keys(graph));
  const visited = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (!available.has(next) || visited.has(next)) continue;
    visited.add(next);
    for (const dependency of graph[next] ?? []) {
      if (!visited.has(dependency)) stack.push(dependency);
    }
  }
  return visited;
}

export function summarizeSourceReachability(
  graph: SourceReachabilityGraph,
  roots: SourceReachabilityRoots,
  facadeCandidates: readonly string[] = [],
  unresolvedLocalImports: readonly string[] = [],
  dynamicImportFiles: readonly string[] = [],
  sampleLimit = 20,
  auditedPaths?: readonly string[],
  allSourceImports: SourceReachabilityGraph = graph,
  reviewOffset = 0
): SourceReachabilitySummary {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 100) {
    throw new Error("Source reachability sample limit must be 0..100.");
  }
  if (!Number.isSafeInteger(reviewOffset) || reviewOffset < 0) {
    throw new Error("Source reachability review offset must be a non-negative safe integer.");
  }
  const paths = uniqueSorted(auditedPaths ?? Object.keys(graph));
  if (paths.some((path) =>
    !Object.hasOwn(graph, path) || !Object.hasOwn(allSourceImports, path)
  )) {
    throw new Error("SOURCE_AUDIT_UNKNOWN_REVIEW_PATH: graph omits a requested source.");
  }
  const declaredRoots = uniqueSorted([
    ...roots.runtime, ...roots.tooling, ...roots.tests,
  ]);
  const missingRoots = declaredRoots.filter((path) => !Object.hasOwn(graph, path));
  const runtime = walkDependencies(graph, roots.runtime);
  const tooling = walkDependencies(graph, roots.tooling);
  // Type-only imports are source dependencies, NOT executable JavaScript
  // edges. Preserve their ownership even when they are never bundled by
  // the Plugin/Gateway. Tests count as source consumers, not Runtime proof.
  const referencedAtCompileTime = walkDependencies(
    allSourceImports, [...roots.runtime, ...roots.tooling]
  );
  const tests = walkDependencies(allSourceImports, roots.tests);
  const facades = new Set(facadeCandidates);
  const classes = Object.fromEntries(CLASS_ORDER.map((value) => [value, 0]))
    as Record<SourceReachabilityClass, number>;
  const unreferenced: string[] = [];
  const compatibility: string[] = [];
  for (const path of paths) {
    const state: SourceReachabilityClass =
      runtime.has(path) ? "RUNTIME_REACHABLE" :
      tooling.has(path) ? "TOOLING_REACHABLE" :
      referencedAtCompileTime.has(path) ? "TYPE_ONLY_REFERENCED" :
      tests.has(path) ? "TEST_ONLY" :
      facades.has(path) ? "EXTERNAL_COMPATIBILITY_REVIEW" :
      "UNREFERENCED_REVIEW";
    classes[state]++;
    if (state === "UNREFERENCED_REVIEW") unreferenced.push(path);
    if (state === "EXTERNAL_COMPATIBILITY_REVIEW") compatibility.push(path);
  }
  // Never let numerous intentional compatibility facades hide the actual
  // unreferenced candidates from the first page. Alphabetical per cohort.
  const review = [...unreferenced, ...compatibility];
  const page = review.slice(reviewOffset, reviewOffset + sampleLimit);
  const nextOffset = sampleLimit > 0 && reviewOffset + page.length < review.length
    ? reviewOffset + page.length : null;
  return {
    schema: "lazydesigner-source-reachability-v1",
    authority: "STATIC_IMPORT_GRAPH_REVIEW_ONLY",
    total_source_modules: paths.length,
    classes,
    missing_roots: missingRoots,
    review_candidate_count: review.length,
    review_offset: reviewOffset,
    review_next_offset: nextOffset,
    review_examples: page,
    // A zero-sized page intentionally yields no next cursor, but candidates
    // are still present and must not be reported as fully displayed.
    review_examples_truncated: reviewOffset + page.length < review.length,
    unresolved_local_imports: uniqueSorted(unresolvedLocalImports).slice(0, sampleLimit),
    unresolved_local_imports_truncated:
      new Set(unresolvedLocalImports).size > sampleLimit,
    dynamic_import_file_count: new Set(dynamicImportFiles).size,
    limitations: LIMITATIONS,
  };
}

type ParsedSourceImports = {
  /** All source dependencies, including erased TypeScript type imports. */
  specifiers: string[];
  /** Module specifiers that may load during JavaScript execution. */
  runtimeSpecifiers: string[];
  /** Dependencies referenced only by erased type imports/exports. */
  typeOnlySpecifiers: string[];
  hasNonLiteralImport: boolean;
};

export function readSourceImports(source: string, path = "fixture.ts"): ParsedSourceImports {
  const file = ts.createSourceFile(
    path, source, ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX :
      /\.(?:mjs|cjs|js)$/.test(path) ? ts.ScriptKind.JS :
      ts.ScriptKind.TS
  );
  const imports = new Set<string>();
  const runtime = new Set<string>();
  let hasNonLiteralImport = false;
  const collect = (value: ts.Node | undefined, runtimeEdge: boolean) => {
    if (value && ts.isStringLiteral(value)) {
      imports.add(value.text);
      if (runtimeEdge) runtime.add(value.text);
    } else {
      hasNonLiteralImport = true;
    }
  };
  const importIsOnlyTypes = (clause: ts.ImportClause | undefined) => {
    if (clause?.isTypeOnly) return true;
    if (!clause || clause.name || !clause.namedBindings ||
        !ts.isNamedImports(clause.namedBindings)) return false;
    return clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((item) => item.isTypeOnly);
  };
  const exportIsOnlyTypes = (node: ts.ExportDeclaration) =>
    node.isTypeOnly || (
      node.exportClause !== undefined &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((item) => item.isTypeOnly)
    );
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier) {
        collect(node.moduleSpecifier, !importIsOnlyTypes(node.importClause));
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        collect(node.moduleSpecifier, !exportIsOnlyTypes(node));
      }
    } else if (ts.isImportEqualsDeclaration(node) &&
               ts.isExternalModuleReference(node.moduleReference)) {
      collect(node.moduleReference.expression, !node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) &&
               ts.isLiteralTypeNode(node.argument)) {
      collect(node.argument.literal, false);
    } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
         ts.isIdentifier(node.expression) &&
         node.expression.text === "require")) {
      collect(node.arguments[0], true);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return {
    specifiers: uniqueSorted(imports),
    runtimeSpecifiers: uniqueSorted(runtime),
    typeOnlySpecifiers: uniqueSorted([...imports].filter(
      (specifier) => !runtime.has(specifier)
    )),
    hasNonLiteralImport,
  };
}


/** Selected source-only AST witnesses. No runtime execution or call graph implied. */
export type SourceImportWitness = {
  path: string; line: number; column: number;
  /** Hash of exact source bytes inspected; not a commit or Runtime proof. */
  source_sha256?: string;
  specifier: string | null;
  kind: "IMPORT" | "EXPORT" | "IMPORT_EQUALS" | "IMPORT_TYPE" |
        "DYNAMIC_IMPORT" | "REQUIRE" | "MEMBER_REQUIRE";
  runtime_capable: boolean;
};
export type SourceKnowledgeWitness = {
  path: string; line: number; column: number;
  source_sha256?: string;
  api?: "selectKnowledgeSections" | "indexMarkdownKnowledge" |
    "resolveRecipeKnowledgeLinks" | "indexRecipeKnowledge" |
    "suggestRecipeKnowledge" | "reviewRecipeKnowledge" |
    "prepareKnowledgeAwareRecipe" | "collectRecipeKnowledge";
};
export type SourceAstEvidence = {
  imports: SourceImportWitness[];
  knowledge_literals: SourceKnowledgeWitness[];
  knowledge_api_candidates: SourceKnowledgeWitness[];
};

/** Preserve exact AST locations; unlike keyword search, comments are excluded. */
export function readSourceAstEvidence(
  source: string, path = "fixture.ts", knowledgeId?: string
): SourceAstEvidence {
  const file = ts.createSourceFile(
    path, source, ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX :
      /\.(?:mjs|cjs|js)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );
  const sourceHash = createHash("sha256").update(source, "utf8").digest("hex");
  const imports: SourceImportWitness[] = [];
  const knowledge_literals: SourceKnowledgeWitness[] = [];
  const knowledge_api_candidates: SourceKnowledgeWitness[] = [];
  type CandidateAPI =
    "selectKnowledgeSections" | "indexMarkdownKnowledge" |
    "resolveRecipeKnowledgeLinks" | "indexRecipeKnowledge" |
    "suggestRecipeKnowledge" | "reviewRecipeKnowledge" |
    "prepareKnowledgeAwareRecipe" | "collectRecipeKnowledge";
  const importedKnowledgeAPIs = new Map<string, CandidateAPI>();
  if (knowledgeId !== undefined) {
    if (!/^knowledge:[a-zA-Z0-9_./#-]{1,500}$/.test(knowledgeId))
      throw new Error("Knowledge inspection requires one exact stable knowledge: ID.");
    // These names are existing source consumers, not bindings or consumption proof.
    const ownedAPI: Readonly<Record<string, readonly CandidateAPI[]>> = {
      "lib/semantic/knowledge": ["selectKnowledgeSections", "indexMarkdownKnowledge"],
      "lib/authoringRecipe/knowledge": ["resolveRecipeKnowledgeLinks", "indexRecipeKnowledge"],
      "lib/authoringRecipe/knowledgeSelection": ["suggestRecipeKnowledge"],
      "lib/authoringRecipe/knowledgePlanning": [
        "reviewRecipeKnowledge", "prepareKnowledgeAwareRecipe", "collectRecipeKnowledge",
      ],
    };
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const importedFrom = statement.moduleSpecifier.text.replace(/\.[cm]?[jt]sx?$/, "");
      if (!importedFrom.startsWith(".") && !importedFrom.startsWith("@/")) continue;
      const matchingOwner = Object.keys(ownedAPI).find(owner =>
        importedFrom.endsWith("/" + owner));
      if (!matchingOwner) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly || !clause.namedBindings ||
          !ts.isNamedImports(clause.namedBindings)) continue;
      for (const item of clause.namedBindings.elements) {
        if (item.isTypeOnly) continue;
        const name = item.propertyName?.text ?? item.name.text;
        if (ownedAPI[matchingOwner]!.includes(name as CandidateAPI))
          importedKnowledgeAPIs.set(item.name.text, name as CandidateAPI);
      }
    }
  }
  const site = (node: ts.Node) => {
    const pos = file.getLineAndCharacterOfPosition(node.getStart(file));
    return { path, line: pos.line + 1, column: pos.character + 1,
      source_sha256: sourceHash };
  };
  const add = (
    node: ts.Node, expression: ts.Node | undefined,
    kind: SourceImportWitness["kind"], runtime_capable: boolean
  ) => {
    imports.push({
      ...site(expression ?? node),
      specifier: expression && ts.isStringLiteral(expression) ? expression.text : null,
      kind, runtime_capable,
    });
  };
  const isOnlyTypeImport = (clause: ts.ImportClause | undefined) =>
    clause?.isTypeOnly === true || !!(clause && !clause.name &&
      clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every(element => element.isTypeOnly));
  const isOnlyTypeExport = (node: ts.ExportDeclaration) =>
    node.isTypeOnly || !!(node.exportClause && ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every(element => element.isTypeOnly));

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      add(node, node.moduleSpecifier, "IMPORT", !isOnlyTypeImport(node.importClause));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, node.moduleSpecifier, "EXPORT", !isOnlyTypeExport(node));
    } else if (ts.isImportEqualsDeclaration(node) &&
               ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, "IMPORT_EQUALS", !node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, "IMPORT_TYPE", false);
    } else if (ts.isCallExpression(node) &&
               node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node, node.arguments[0], "DYNAMIC_IMPORT", true);
    } else if (ts.isCallExpression(node) &&
               ts.isIdentifier(node.expression) && node.expression.text === "require") {
      // No source-level proof that require has not been shadowed.
      add(node, node.arguments[0], "REQUIRE", true);
    } else if (ts.isCallExpression(node) &&
               ts.isPropertyAccessExpression(node.expression) &&
               node.expression.name.text === "require") {
      add(node, node.arguments[0], "MEMBER_REQUIRE", true);
    }
    if (knowledgeId !== undefined) {
      if (ts.isStringLiteral(node) && node.text === knowledgeId) {
        knowledge_literals.push(site(node));
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const api = importedKnowledgeAPIs.get(node.expression.text);
        if (api) knowledge_api_candidates.push({ ...site(node.expression), api });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const order = (a: {path:string;line:number;column:number},
                 b: {path:string;line:number;column:number}) =>
    a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column;
  return {
    imports: imports.sort(order),
    knowledge_literals: knowledge_literals.sort(order),
    knowledge_api_candidates: knowledge_api_candidates.sort(order),
  };
}

export type ResolvedSourceImport = SourceImportWitness & {
  dependency: string;
};
export type SourceImportObligation = SourceImportWitness & {
  reason: "NONLITERAL_IMPORT" | "UNVERIFIED_REQUIRE" | "EXCLUDED_NON_RELATIVE" |
          "UNRESOLVED_RELATIVE" | "UNREGISTERED_TARGET" | "EXCLUDED_NON_CODE";
};
export type SourceDependencyGraph = {
  files: readonly string[];
  edges: readonly ResolvedSourceImport[];
  obligations: readonly SourceImportObligation[];
};
export type SourceDependencyStep = {
  importer: string; dependency: string;
  witness: ResolvedSourceImport;
};
export type SourceDependencyRoute = {
  path: string; steps: SourceDependencyStep[];
};
export type SourceDependencyInspection = {
  schema: 1; proof_scope: "STATIC_AST_IMPORT_WITNESSES_ONLY";
  mode: "IMPACT" | "TRACE"; status: "FOUND" | "UNKNOWN_SOURCE" | "NO_PATH" |
    "DEPTH_LIMIT" | "INCOMPLETE_EVIDENCE" | "SAME_SOURCE_NO_IMPORT_EDGE";
  source_scope: "MCP_TSCONFIG_AND_STANDALONE_SCRIPT_JS";
  inspected_file_count: number;
  source: string; target?: string; max_hops: number;
  routes: SourceDependencyRoute[];
  route_count: number; truncated: boolean;
  relevant_obligations: SourceImportObligation[];
  global_obligation_count: number;
  relevant_obligation_count: number;
  relevant_obligations_truncated: boolean;
  possible_dependency_gap_count: number;
  interpretation: string;
};
export type KnowledgeInspection = {
  schema: 1; proof_scope: "AST_REFERENCE_NOT_KNOWLEDGE_CONSUMPTION";
  mode: "KNOWLEDGE"; knowledge_id: string;
  catalog_registration: "NOT_CHECKED";
  evidence_class: "EXACT_AST_LITERAL_REFERENCE_NOT_CONSUMPTION_PROOF" |
    "GENERIC_KNOWLEDGE_API_CANDIDATE" | "DECLARATION_ONLY" | "NO_SOURCE_WITNESS";
  literal_source_count: number; literal_test_count: number; generic_candidate_count: number;
  literal_source_sites: SourceKnowledgeWitness[];
  literal_test_sites: SourceKnowledgeWitness[];
  generic_candidates: SourceKnowledgeWitness[];
  truncated: boolean;
  interpretation: string;
};
export type SourceInspectionRequest =
  | { mode: "IMPACT"; source: string; maxHops?: number; resultLimit?: number }
  | { mode: "TRACE"; source: string; target: string; maxHops?: number; resultLimit?: number }
  | { mode: "KNOWLEDGE"; id: string; resultLimit?: number };
export type SourceInspectionResult = SourceDependencyInspection | KnowledgeInspection;
const SOURCE_PROOF = "STATIC_AST_IMPORT_WITNESSES_ONLY" as const;
const SOURCE_LIMIT = "This trace is potential module dependency, not function-call execution, " +
  "native Blockbench behavior or proof an imported symbol is consumed. " +
  "Unverified require, computed import and external references stay unresolved.";

function boundedSourceOptions(options: { maxHops?: number; resultLimit?: number }) {
  const maxHops = options.maxHops ?? 6;
  const resultLimit = options.resultLimit ?? 30;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 6)
    throw new Error("Source trace maxHops must be 1..6.");
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 100)
    throw new Error("Source trace resultLimit must be 1..100.");
  return { maxHops, resultLimit };
}

/** All paths must be exact files in the already inventoried source graph. */
export function explainSourceDependency(
  graph: SourceDependencyGraph,
  request: Extract<SourceInspectionRequest, { mode: "IMPACT" | "TRACE" }>
): SourceDependencyInspection {
  const { maxHops, resultLimit } = boundedSourceOptions(request);
  const files = new Set(graph.files);
  const { source } = request;
  const target = request.mode === "TRACE" ? request.target : undefined;
  const base = {
    schema: 1 as const, proof_scope: SOURCE_PROOF,
    mode: request.mode, source, ...(target ? { target } : {}),
    source_scope: "MCP_TSCONFIG_AND_STANDALONE_SCRIPT_JS" as const,
    inspected_file_count: graph.files.length,
    max_hops: maxHops, routes: [] as SourceDependencyRoute[],
    route_count: 0, truncated: false,
    relevant_obligations: [] as SourceImportObligation[],
    global_obligation_count: graph.obligations.length,
    relevant_obligation_count: 0,
    relevant_obligations_truncated: false,
    possible_dependency_gap_count: 0,
    interpretation: SOURCE_LIMIT,
  };
  if (!files.has(source) || (target !== undefined && !files.has(target)))
    return { ...base, status: "UNKNOWN_SOURCE" };
  if (target !== undefined && source === target) return {
    ...base, status: "SAME_SOURCE_NO_IMPORT_EDGE",
    interpretation: "The selected source is identical to the target; no import edge " +
      "or function execution is established by this identity route.",
  };
  const reversed = request.mode === "IMPACT";
  const visited = new Set<string>([source]);
  const queue: SourceDependencyRoute[] = [{ path: source, steps: [] }];
  const routes: SourceDependencyRoute[] = [];
  let hitLimit = false;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    const neighbors = graph.edges.filter(edge => reversed
      ? edge.dependency === current.path : edge.path === current.path
    ).sort((a, b) => (reversed ? a.path : a.dependency)
      .localeCompare(reversed ? b.path : b.dependency) ||
      a.line - b.line || a.column - b.column);
    for (const edge of neighbors) {
      const next = reversed ? edge.path : edge.dependency;
      if (visited.has(next)) continue;
      if (current.steps.length >= maxHops) { hitLimit = true; continue; }
      const step = { importer: edge.path, dependency: edge.dependency, witness: edge };
      const route = { path: next, steps: [...current.steps, step] };
      visited.add(next);
      if (reversed) {
        // Detect a real overflow; exactly resultLimit routes is not truncation.
        if (routes.length >= resultLimit) { hitLimit = true; break; }
        routes.push(route);
      } else if (next === target) routes.push(route);
      queue.push(route);
      if (!reversed && next === target) break;
    }
    if (hitLimit && reversed) break;
    if (!reversed && routes.length) break;
  }
  const relevant = new Set([source, ...queue.map(item => item.path)]);
  const unresolvedKind = (reason: SourceImportObligation["reason"]) =>
    reason === "NONLITERAL_IMPORT" || reason === "UNVERIFIED_REQUIRE" ||
    reason === "UNRESOLVED_RELATIVE" || reason === "UNREGISTERED_TARGET";
  // Reverse impact cannot safely exclude an unknown importer elsewhere
  // in the selected MCP inventory. Excluded non-code/external imports are
  // separate, and do not manufacture an internal dependency.
  const relevantAll = graph.obligations.filter(obligation =>
    relevant.has(obligation.path) || (reversed && unresolvedKind(obligation.reason)));
  const possibleGaps = relevantAll.filter(obligation => unresolvedKind(obligation.reason));
  const relevant_obligations = relevantAll.slice(0, 40);
  const status: SourceDependencyInspection["status"] = routes.length
    ? "FOUND" : hitLimit ? "DEPTH_LIMIT" :
      possibleGaps.length ? "INCOMPLETE_EVIDENCE" : "NO_PATH";
  return { ...base, status, routes, route_count: routes.length,
    truncated: hitLimit,
    relevant_obligations,
    relevant_obligation_count: relevantAll.length,
    relevant_obligations_truncated: relevantAll.length > relevant_obligations.length,
    possible_dependency_gap_count: possibleGaps.length };

}

export function inspectKnowledgeSourceSites(
  id: string, witnesses: readonly SourceAstEvidence[],
  resultLimit = 50
): KnowledgeInspection {
  boundedSourceOptions({ resultLimit });
  const literals = witnesses.flatMap(item => item.knowledge_literals);
  const generic = witnesses.flatMap(item => item.knowledge_api_candidates);
  const bySite = (a: SourceKnowledgeWitness, b: SourceKnowledgeWitness) =>
    a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column;
  const sources = literals.filter(site => !isTestSource(site.path)).sort(bySite);
  const tests = literals.filter(site => isTestSource(site.path)).sort(bySite);
  const genericCandidates = generic.filter(site => !isTestSource(site.path)).sort(bySite);
  return {
    schema: 1, mode: "KNOWLEDGE",
    proof_scope: "AST_REFERENCE_NOT_KNOWLEDGE_CONSUMPTION",
    knowledge_id: id,
    catalog_registration: "NOT_CHECKED",
    evidence_class: sources.length
      ? "EXACT_AST_LITERAL_REFERENCE_NOT_CONSUMPTION_PROOF"
      : genericCandidates.length ? "GENERIC_KNOWLEDGE_API_CANDIDATE"
      : tests.length ? "DECLARATION_ONLY" : "NO_SOURCE_WITNESS",
    literal_source_count: sources.length,
    literal_test_count: tests.length, generic_candidate_count: genericCandidates.length,
    literal_source_sites: sources.slice(0, resultLimit),
    literal_test_sites: tests.slice(0, resultLimit),
    generic_candidates: genericCandidates.slice(0, resultLimit),
    truncated: sources.length > resultLimit || tests.length > resultLimit ||
      genericCandidates.length > resultLimit,
    interpretation: "Exact AST literal references do not prove a knowledge item was loaded or applied. " +
      "Imported section-index/selection calls are generic candidates only; " +
      "no exact-ID consumption, Runtime execution or quality claim follows from their presence.",
  };
}

export function sourceInspectionMermaid(report: SourceDependencyInspection): string {
  if (report.status !== "FOUND") return 'flowchart LR\n  unresolved["NO VERIFIED SOURCE PATH"]';
  const nodes = [report.source, ...report.routes.flatMap(route => [
    route.path, ...route.steps.flatMap(step => [step.importer, step.dependency]),
  ])];
  const paths = [...new Set(nodes)];
  const ids = new Map(paths.map((path, index) => [path, "n" + index]));
  const lines = ["flowchart LR"];
  for (const [path, id] of ids) lines.push("  " + id + "[" + JSON.stringify(path) + "]");
  const seen = new Set<string>();
  for (const route of report.routes) for (const step of route.steps) {
    // Import direction is always importer --> dependency, also for reverse impact exploration.
    const left = ids.get(step.importer), right = ids.get(step.dependency);
    if (left && right && !seen.has(left + ":" + right)) {
      lines.push("  " + left + " -->|imports| " + right);
      seen.add(left + ":" + right);
    }
  }
  return lines.join("\n");
}
export function sourceInspectionMarkdown(report: SourceDependencyInspection): string {
  const mark = String.fromCharCode(96), fence = mark.repeat(3);
  const out = ["# Source dependency inspection", "", "Status: " + report.status,
    "Scope: " + report.mode + " / " + report.proof_scope + " / " + report.source_scope,
    "Inspected code files: " + report.inspected_file_count + ".",
    "",
    "The following are AST import sites, not function-call or Runtime proof.", ""];
  for (const route of report.routes) {
    out.push("- " + mark + route.path + mark);
    for (const step of route.steps) out.push(
      "  - " + step.importer + " imports " + step.dependency + " at " +
      step.witness.path + ":" + step.witness.line + ":" + step.witness.column +
      (step.witness.source_sha256
        ? " (source SHA-256 " + step.witness.source_sha256.slice(0, 12) + ")"
        : "") +
      " [" + step.witness.kind + (step.witness.runtime_capable ? ", runtime-capable" : ", type-only") + "]"
    );
  }
  out.push("", "Unresolved/excluded import sites (global): " +
    report.global_obligation_count + "; relevant: " + report.relevant_obligation_count +
    "; sample: " + report.relevant_obligations.length +
    "; sample truncated: " + report.relevant_obligations_truncated +
    "; possible dependency gaps: " + report.possible_dependency_gap_count + ".",
    "Truncated: " + report.truncated + ".", "",
    "## Mermaid / Pele-compatible source", "", fence + "mermaid",
    sourceInspectionMermaid(report), fence, "", report.interpretation);
  return out.join("\n");
}

function configuredProject(path: string) {
  const config = ts.readConfigFile(path, ts.sys.readFile);
  if (config.error) throw new Error("SOURCE_AUDIT_CONFIG_UNREADABLE: " + path);
  const parsed = ts.parseJsonConfigFileContent(
    config.config, ts.sys, dirname(path), undefined, path
  );
  if (parsed.errors.length > 0) {
    throw new Error("SOURCE_AUDIT_CONFIG_INVALID: " + path);
  }
  return parsed;
}

function localModulePath(root: string, fullPath: string): string | null {
  const result = relative(root, fullPath).split(sep).join("/");
  return result.startsWith("../") || result === ".." ||
    !/\.(?:tsx?|mjs|cjs|js)$/.test(result) || /\.d\.(?:ts|mts|cts)$/.test(result)
    ? null : result;
}

function isAuditedSource(path: string): boolean {
  return /^(?:lib|gateway|server|plugin|ui|macros|scripts|build|compatibility)\//.test(path) ||
    path === "index.ts";
}

function isTestSource(path: string): boolean {
  return path.startsWith("tests/") || /(?:^|\/)\S+\.(?:test|spec)\.tsx?$/.test(path);
}

function isFacadeCandidate(path: string, source: string): boolean {
  return /^lib\/[^/]+\.ts$/.test(path) &&
    /^export \* from ["']\.[^"']+["'];?$/.test(source.trim());
}

function scriptEntrypoints(scripts: Record<string, string>): string[] {
  const entries = ["build/index.ts"];
  for (const command of Object.values(scripts)) {
    // Captures explicit package-authorized developer/CLI roots. A script
    // launched solely outside package.json remains a review candidate.
    for (const match of command.matchAll(
      /\bbun\s+run\s+(?:\.\/)?((?:scripts|build)\/[A-Za-z0-9_./-]+\.tsx?)/g
    )) entries.push(match[1]!);
  }
  return uniqueSorted(entries);
}

/** Audits standalone JS CLI helpers ignored by the TypeScript tsconfig
 * globs. These are REVIEW candidates until a package/script/manual owner
 * is proven; neither no importer nor no package script licenses deletion.
 */
async function standaloneScriptSources(dir: string, root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", ".cache"].includes(entry.name)) {
          await visit(path);
        }
      } else if (entry.isFile() && /\.(?:mjs|cjs|js)$/.test(entry.name)) {
        const local = localModulePath(root, path);
        if (local) found.push(local);
      }
    }
  };
  await visit(dir);
  return uniqueSorted(found);
}

export async function auditRepositorySourceReachability(
  root: string, sampleLimit?: number, reviewOffset?: number
): Promise<SourceReachabilitySummary>;
export async function auditRepositorySourceReachability(
  root: string, sampleLimit: number, reviewOffset: number,
  request: SourceInspectionRequest
): Promise<SourceInspectionResult>;
export async function auditRepositorySourceReachability(
  root: string, sampleLimit = 20, reviewOffset = 0,
  request?: SourceInspectionRequest
): Promise<SourceReachabilitySummary | SourceInspectionResult> {
  const absoluteRoot = resolve(root);
  const runtime = configuredProject(resolve(absoluteRoot, "tsconfig.json"));
  const gateway = configuredProject(resolve(absoluteRoot, "gateway/tsconfig.json"));
  const standalone = await standaloneScriptSources(
    resolve(absoluteRoot, "scripts"), absoluteRoot
  );
  const files = uniqueSorted([
    ...[...runtime.fileNames, ...gateway.fileNames]
      .map((path) => localModulePath(absoluteRoot, path))
      .filter((path): path is string => path !== null),
    ...standalone,
  ]);
  // Two projections over one parsed source: the executable value-import
  // graph and the complete compilation/reference graph. The latter retains
  // type-only source owners and prevents false orphan classifications.
  const graph: Record<string, string[]> = {};
  const sourceGraph: Record<string, string[]> = {};
  const raw = new Map<string, string>();
  const unresolved: string[] = [];
  const dynamic: string[] = [];
  const facades: string[] = [];
  const sourceEdges: ResolvedSourceImport[] = [];
  const importObligations: SourceImportObligation[] = [];
  const knowledgeEvidence: SourceAstEvidence[] = [];
  for (const path of files) {
    const text = await readFile(resolve(absoluteRoot, path), "utf8");
    raw.set(path, text);
    graph[path] = [];
    sourceGraph[path] = [];
  }
  for (const path of files) {
    const contents = raw.get(path)!;
    const { specifiers, runtimeSpecifiers, hasNonLiteralImport } =
      readSourceImports(contents, path);
    const runtimeSpecifiersSet = new Set(runtimeSpecifiers);
    if (hasNonLiteralImport) dynamic.push(path);
    if (isFacadeCandidate(path, contents)) facades.push(path);
    const options = path.startsWith("gateway/") ? gateway.options : runtime.options;
    for (const specifier of specifiers) {
      if (!(specifier.startsWith(".") || specifier.startsWith("@/"))) continue;
      const resolved = ts.resolveModuleName(
        specifier, resolve(absoluteRoot, path), options, ts.sys
      ).resolvedModule;
      const local = resolved &&
        localModulePath(absoluteRoot, resolved.resolvedFileName);
      if (local && Object.hasOwn(graph, local)) {
        sourceGraph[path]!.push(local);
        if (runtimeSpecifiersSet.has(specifier)) {
          graph[path]!.push(local);
        }
      } else if (!resolved && !/\.(?:svg|md|css|html|json|png|webp)$/.test(specifier)) {
        unresolved.push(path + " -> " + specifier);
      }
    }
    if (request) {
      const evidence = readSourceAstEvidence(contents, path,
        request.mode === "KNOWLEDGE" ? request.id : undefined);
      if (request.mode === "KNOWLEDGE") knowledgeEvidence.push(evidence);
      else {
        for (const site of evidence.imports) {
          const unverifiedRequire = site.kind === "REQUIRE" || site.kind === "MEMBER_REQUIRE";
          const literal = site.specifier;
          const reason: SourceImportObligation["reason"] | null =
            unverifiedRequire ? "UNVERIFIED_REQUIRE" :
            literal === null ? "NONLITERAL_IMPORT" :
            !literal.startsWith(".") ? "EXCLUDED_NON_RELATIVE" :
            /\.(?:svg|md|css|html|json|png|webp)$/.test(literal) ? "EXCLUDED_NON_CODE" : null;
          if (reason !== null) {
            importObligations.push({ ...site, reason });
            continue;
          }
          const resolved = ts.resolveModuleName(
            literal!, resolve(absoluteRoot, path), options, ts.sys
          ).resolvedModule;
          const dependency = resolved && localModulePath(absoluteRoot, resolved.resolvedFileName);
          if (dependency && Object.hasOwn(sourceGraph, dependency)) {
            sourceEdges.push({ ...site, dependency });
          } else {
            importObligations.push({ ...site,
              reason: dependency ? "UNREGISTERED_TARGET" : "UNRESOLVED_RELATIVE" });
          }
        }
      }
    }
    graph[path] = uniqueSorted(graph[path]!);
    sourceGraph[path] = uniqueSorted(sourceGraph[path]!);
  }
  if (request?.mode === "KNOWLEDGE") {
    return inspectKnowledgeSourceSites(request.id, knowledgeEvidence, request.resultLimit);
  }
  if (request) {
    const graph: SourceDependencyGraph = { files, edges: sourceEdges, obligations: importObligations };
    return explainSourceDependency(graph, request);
  }
  const manifest = JSON.parse(
    await readFile(resolve(absoluteRoot, "package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  const roots: SourceReachabilityRoots = {
    runtime: ["index.ts", "gateway/index.ts"],
    tooling: scriptEntrypoints(manifest.scripts),
    tests: files.filter(isTestSource),
  };
  // Include every local test as a consumer, but never treat it as proof
  // that a source module is used by the deployed native Plugin/Gateway.
  const report = summarizeSourceReachability(
    graph, roots, facades, unresolved, dynamic, sampleLimit,
    files.filter((path) => isAuditedSource(path) && !isTestSource(path)),
    sourceGraph,
    reviewOffset
  );
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seen = new Set<string>();
  const options = new Map<string, string>();
  for (const arg of args) {
    const i = arg.indexOf("=");
    const key = i < 0 ? arg : arg.slice(0, i);
    const value = i < 0 ? "" : arg.slice(i + 1);
    if (seen.has(key) || !new Set(["--sample-limit", "--review-offset",
      "--impact", "--trace", "--knowledge-id", "--max-hops", "--result-limit",
      "--format"]).has(key) || i < 0 || !value)
      throw new Error("Unknown, repeated or missing source audit option: " + key);
    seen.add(key); options.set(key, value);
  }
  const sample = options.get("--sample-limit");
  const offset = options.get("--review-offset");
  const limit = sample === undefined ? 20 : Number(sample);
  const reviewOffset = offset === undefined ? 0 : Number(offset);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100 ||
      !Number.isSafeInteger(reviewOffset) || reviewOffset < 0)
    throw new Error("Invalid legacy reachability sample-limit/review-offset.");
  const selectors = ["--impact", "--trace", "--knowledge-id"].filter(key => options.has(key));
  if (selectors.length > 1) throw new Error("Only one source evidence selection is allowed.");
  if (!selectors.length && ["--max-hops", "--result-limit", "--format"].some(key => options.has(key)))
    throw new Error("Source evidence limits and format require a selected inspection.");
  const maxHops = options.get("--max-hops") === undefined ? 6 : Number(options.get("--max-hops"));
  const resultLimit = options.get("--result-limit") === undefined ? 30 :
    Number(options.get("--result-limit"));
  boundedSourceOptions({ maxHops, resultLimit });
  const format = options.get("--format") ?? "json";
  if (!["json", "markdown", "mermaid"].includes(format))
    throw new Error("Expected --format=json|markdown|mermaid.");
  if (options.has("--knowledge-id") && format !== "json")
    throw new Error("Knowledge source evidence is JSON only, never a rendered consumption graph.");
  const normalize = (input: string) => {
    const path = input.startsWith("mcp/") ? input.slice(4) : input;
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.[cm]?[jt]sx?$/.test(path) ||
        path.split("/").some(part => part === "." || part === ".."))
      throw new Error("Source selection requires an exact safe .ts/.tsx/.js/.mjs/.cjs file.");
    return path;
  };
  let request: SourceInspectionRequest | undefined;
  if (options.has("--impact")) request = {
    mode: "IMPACT", source: normalize(options.get("--impact")!), maxHops, resultLimit,
  };
  if (options.has("--trace")) {
    const items = options.get("--trace")!.split(",");
    if (items.length !== 2) throw new Error("--trace requires source,target.");
    request = { mode: "TRACE", source: normalize(items[0]!),
      target: normalize(items[1]!), maxHops, resultLimit };
  }
  if (options.has("--knowledge-id")) request = {
    mode: "KNOWLEDGE", id: options.get("--knowledge-id")!, resultLimit,
  };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const report = request
    ? await auditRepositorySourceReachability(root, limit, reviewOffset, request)
    : await auditRepositorySourceReachability(root, limit, reviewOffset);
  if (report && "mode" in report && report.mode !== "KNOWLEDGE" && format !== "json") {
    console.log(format === "markdown"
      ? sourceInspectionMarkdown(report) : sourceInspectionMermaid(report));
  } else console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

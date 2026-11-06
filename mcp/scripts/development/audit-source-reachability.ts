/**
 * Read-only, on-demand import reachability audit for source hygiene.
 *
 * This is a derived source graph, not a new registry, Runtime router or
 * permission to delete files. Runtime imports, CLI scripts, tests, dynamic
 * imports and external compatibility callers have different ownership.
 * Absence of a static edge is REVIEW_REQUIRED, never proof of dead code.
 */
import ts from "typescript-compat";
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
  root: string,
  sampleLimit = 20,
  reviewOffset = 0
): Promise<SourceReachabilitySummary> {
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
    graph[path] = uniqueSorted(graph[path]!);
    sourceGraph[path] = uniqueSorted(sourceGraph[path]!);
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
  if (args.some((arg) =>
    !/^--(?:sample-limit|review-offset)=\d+$/.test(arg)
  ) || args.filter((arg) => arg.startsWith("--sample-limit=")).length > 1 ||
       args.filter((arg) => arg.startsWith("--review-offset=")).length > 1) {
    throw new Error("Only one --sample-limit=0..100 and --review-offset=N are supported.");
  }
  const sample = args.find((item) => item.startsWith("--sample-limit="));
  const offset = args.find((item) => item.startsWith("--review-offset="));
  const limit = sample ? Number(sample.split("=")[1]) : 20;
  const reviewOffset = offset ? Number(offset.split("=")[1]) : 0;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const report = await auditRepositorySourceReachability(root, limit, reviewOffset);
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

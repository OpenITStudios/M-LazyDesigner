import ts from "typescript-compat";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveDevelopmentIntent } from "../../gateway/development/intent";

export const DEVELOPMENT_SYMBOL_MAP_PROXY_BYTES = 6000;
const MAX_SYMBOLS_PER_FILE = 24;
const MAX_IMPORTS_PER_FILE = 12;
const MAX_TYPE_TEXT_CHARS = 220;

export type DevelopmentSymbol = {
  kind: string;
  name: string;
  signature: string;
  exported: boolean;
};

export type DevelopmentFileMap = {
  path: string;
  imports: string[];
  symbols: DevelopmentSymbol[];
  anchor_test: string | null;
};

export type DevelopmentSymbolMap = {
  schema: 1;
  proof_scope: "SYSTEM_DEVELOPMENT_LOCAL_CONTEXT";
  intent: string;
  domain: string;
  confidence: string;
  max_bytes: number;
  bytes: number;
  truncated: boolean;
  files: DevelopmentFileMap[];
};

type DevelopmentPrograms = {
  runtime: ts.Program | null;
  gateway: ts.Program | null;
};

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function exported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return Boolean(
    ts.getModifiers(node)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    )
  );
}

function compactTypeText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= MAX_TYPE_TEXT_CHARS
    ? compact
    : `${compact.slice(0, MAX_TYPE_TEXT_CHARS - 1)}…`;
}

function inferredTypeText(
  checker: ts.TypeChecker | undefined,
  node: ts.Node
): string | null {
  if (!checker) return null;
  try {
    return compactTypeText(
      checker.typeToString(
        checker.getTypeAtLocation(node),
        node,
        ts.TypeFormatFlags.NoTruncation
      )
    );
  } catch {
    return null;
  }
}

function typeText(
  type: ts.TypeNode | undefined,
  source: ts.SourceFile,
  checker?: ts.TypeChecker,
  inferenceNode?: ts.Node
): string {
  if (type) return compactTypeText(type.getText(source));
  return inferenceNode
    ? inferredTypeText(checker, inferenceNode) ?? "unknown"
    : "unknown";
}

function returnTypeText(
  node: ts.FunctionDeclaration,
  source: ts.SourceFile,
  checker?: ts.TypeChecker
): string {
  if (node.type) return compactTypeText(node.type.getText(source));
  if (!checker) return "unknown";
  try {
    const signature = checker.getSignatureFromDeclaration(node);
    return signature
      ? compactTypeText(
          checker.typeToString(checker.getReturnTypeOfSignature(signature))
        )
      : "unknown";
  } catch {
    return "unknown";
  }
}

function paramText(
  parameter: ts.ParameterDeclaration,
  source: ts.SourceFile,
  checker?: ts.TypeChecker
): string {
  const name = parameter.name.getText(source);
  const optional = parameter.questionToken ? "?" : "";
  const rest = parameter.dotDotDotToken ? "..." : "";
  return `${rest}${name}${optional}: ${typeText(
    parameter.type,
    source,
    checker,
    parameter.name
  )}`;
}

function functionSymbol(
  node: ts.FunctionDeclaration,
  source: ts.SourceFile,
  checker?: ts.TypeChecker
): DevelopmentSymbol | null {
  if (!node.name) return null;
  return {
    kind: "function",
    name: node.name.text,
    signature: `function ${node.name.text}(${node.parameters
      .map((parameter) => paramText(parameter, source, checker))
      .join(", ")}): ${returnTypeText(node, source, checker)}`,
    exported: exported(node),
  };
}

function classSymbol(
  node: ts.ClassDeclaration,
  source: ts.SourceFile
): DevelopmentSymbol | null {
  if (!node.name) return null;
  const members = node.members
    .flatMap((member) => {
      if (
        (ts.isMethodDeclaration(member) ||
          ts.isPropertyDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member)) &&
        member.name
      ) {
        return [member.name.getText(source)];
      }
      return [];
    })
    .slice(0, 12);
  return {
    kind: "class",
    name: node.name.text,
    signature:
      members.length > 0
        ? `class ${node.name.text} { ${members.join("; ")} }`
        : `class ${node.name.text}`,
    exported: exported(node),
  };
}

function declarationSymbol(
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
  source: ts.SourceFile
): DevelopmentSymbol {
  const kind = ts.isInterfaceDeclaration(node)
    ? "interface"
    : ts.isTypeAliasDeclaration(node)
      ? "type"
      : "enum";
  let signature = `${kind} ${node.name.text}`;
  if (ts.isTypeAliasDeclaration(node)) {
    const alias = compactTypeText(node.type.getText(source));
    signature += alias.length <= 180 ? ` = ${alias}` : "";
  }
  return {
    kind,
    name: node.name.text,
    signature,
    exported: exported(node),
  };
}

function variableSymbols(
  node: ts.VariableStatement,
  source: ts.SourceFile,
  checker?: ts.TypeChecker
): DevelopmentSymbol[] {
  return node.declarationList.declarations.flatMap((declaration) => {
    if (!ts.isIdentifier(declaration.name)) return [];
    const keyword =
      node.declarationList.flags & ts.NodeFlags.Const
        ? "const"
        : node.declarationList.flags & ts.NodeFlags.Let
          ? "let"
          : "var";
    return [{
      kind: "variable",
      name: declaration.name.text,
      signature: `${keyword} ${declaration.name.text}: ${typeText(
        declaration.type,
        source,
        checker,
        declaration.name
      )}`,
      exported: exported(node),
    }];
  });
}

function mapSourceFile(
  source: ts.SourceFile,
  path: string,
  checker?: ts.TypeChecker
): Omit<DevelopmentFileMap, "anchor_test"> {
  const imports: string[] = [];
  const symbols: DevelopmentSymbol[] = [];

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      if (imports.length < MAX_IMPORTS_PER_FILE) {
        imports.push(statement.moduleSpecifier.text);
      }
      continue;
    }
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) continue;

    if (ts.isFunctionDeclaration(statement)) {
      const symbol = functionSymbol(statement, source, checker);
      if (symbol) symbols.push(symbol);
    } else if (ts.isClassDeclaration(statement)) {
      const symbol = classSymbol(statement, source);
      if (symbol) symbols.push(symbol);
    } else if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      symbols.push(declarationSymbol(statement, source));
    } else if (ts.isVariableStatement(statement)) {
      symbols.push(
        ...variableSymbols(statement, source, checker).slice(
          0,
          MAX_SYMBOLS_PER_FILE - symbols.length
        )
      );
    }
  }

  return { path, imports, symbols };
}

export function mapTypeScriptSource(
  sourceText: string,
  path = "fixture.ts"
): Omit<DevelopmentFileMap, "anchor_test"> {
  const source = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return mapSourceFile(source, path);
}

export function mapTypeScriptProgramFile(
  program: ts.Program,
  fileName: string,
  path = fileName
): Omit<DevelopmentFileMap, "anchor_test"> {
  const absolute = resolve(fileName);
  const source =
    program.getSourceFile(absolute) ??
    program
      .getSourceFiles()
      .find((candidate) => resolve(candidate.fileName) === absolute);
  if (!source) {
    throw new Error(`TypeScript program does not contain ${fileName}`);
  }
  return mapSourceFile(source, path, program.getTypeChecker());
}

function createConfiguredProgram(configPath: string): ts.Program | null {
  if (!ts.sys.fileExists(configPath)) return null;
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) return null;
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath
  );
  if (parsed.errors.length > 0) return null;
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
}

function createDevelopmentPrograms(): DevelopmentPrograms {
  return {
    runtime: createConfiguredProgram(resolve(process.cwd(), "tsconfig.json")),
    gateway: createConfiguredProgram(
      resolve(process.cwd(), "gateway", "tsconfig.json")
    ),
  };
}

function localPath(ownerPath: string): string {
  return ownerPath.startsWith("mcp/") ? ownerPath.slice(4) : `../${ownerPath}`;
}

function programForPath(
  programs: DevelopmentPrograms,
  path: string
): ts.Program | null {
  return path.startsWith("gateway/") ? programs.gateway : programs.runtime;
}

export async function buildDevelopmentSymbolMap(
  intent: string,
  maxBytes = DEVELOPMENT_SYMBOL_MAP_PROXY_BYTES
): Promise<DevelopmentSymbolMap> {
  const resolution = resolveDevelopmentIntent(intent);
  const normalizedMax = Number.isFinite(maxBytes)
    ? Math.max(1200, Math.trunc(maxBytes))
    : DEVELOPMENT_SYMBOL_MAP_PROXY_BYTES;
  const programs = createDevelopmentPrograms();

  const base: DevelopmentSymbolMap = {
    schema: 1,
    proof_scope: "SYSTEM_DEVELOPMENT_LOCAL_CONTEXT",
    intent: resolution.intent,
    domain: resolution.domain,
    confidence: resolution.confidence,
    max_bytes: normalizedMax,
    bytes: 0,
    truncated: false,
    files: [],
  };

  for (const owner of resolution.source_owners) {
    const local = localPath(owner.source);
    let mapped: Omit<DevelopmentFileMap, "anchor_test"> | null = null;
    const program = programForPath(programs, local);

    if (program) {
      try {
        mapped = mapTypeScriptProgramFile(
          program,
          resolve(process.cwd(), local),
          owner.source
        );
      } catch {
        mapped = null;
      }
    }

    if (!mapped) {
      let sourceText: string;
      try {
        sourceText = await readFile(local, "utf8");
      } catch {
        continue;
      }
      mapped = mapTypeScriptSource(sourceText, owner.source);
    }

    const file: DevelopmentFileMap = {
      ...mapped,
      anchor_test: owner.anchor_test,
    };

    const wholeCandidate = { ...base, files: [...base.files, file] };
    if (utf8Bytes(wholeCandidate) <= normalizedMax) {
      base.files.push(file);
      continue;
    }

    const boundedFile: DevelopmentFileMap = {
      path: file.path,
      imports: [],
      symbols: [],
      anchor_test: file.anchor_test,
    };
    for (const imported of file.imports) {
      const nextFile = {
        ...boundedFile,
        imports: [...boundedFile.imports, imported],
      };
      if (
        utf8Bytes({ ...base, files: [...base.files, nextFile] }) >
        normalizedMax
      ) break;
      boundedFile.imports.push(imported);
    }
    for (const symbol of file.symbols) {
      const nextFile = {
        ...boundedFile,
        symbols: [...boundedFile.symbols, symbol],
      };
      if (
        utf8Bytes({ ...base, files: [...base.files, nextFile] }) >
        normalizedMax
      ) break;
      boundedFile.symbols.push(symbol);
    }
    if (boundedFile.imports.length > 0 || boundedFile.symbols.length > 0) {
      base.files.push(boundedFile);
    }
    base.truncated = true;
    break;
  }

  base.bytes = utf8Bytes({ ...base, bytes: 0 });
  if (base.bytes > normalizedMax) base.truncated = true;
  return base;
}

async function main() {
  const intent = process.argv.slice(2).join(" ").trim();
  if (!intent) {
    throw new Error('Usage: bun run generate:development-symbol-map -- "<development intent>"');
  }
  console.log(JSON.stringify(await buildDevelopmentSymbolMap(intent), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
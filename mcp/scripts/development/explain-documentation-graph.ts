import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDocumentationGraph, explainDocumentationPath, auditDocumentationNavigation,
  documentationTraceMarkdown, documentationTraceMermaid,
} from "../../lib/semantic/documentation-graph";

async function listMarkdown(dir: string, root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await listMarkdown(full, root));
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      const path = relative(root, full).split(sep).join("/");
      if (!path.startsWith("docs/")) throw new Error("Out-of-root document.");
      paths.push(path);
    }
  }
  return paths.sort();
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const audit = args.length === 1 && args[0] === "--audit";
  if (!audit && (args[0] !== "--trace" || args.length < 3))
    throw new Error("Use --audit or --trace <from-path-or-id> <to-path-or-id> " +
      "[--max-hops=1..6] [--both-directions] [--format=json|markdown|mermaid]");
  let maxHops = 6, bothDirections = false;
  let format: "json" | "markdown" | "mermaid" = "json";
  const seen = new Set<string>();
  for (const arg of audit ? [] : args.slice(3)) {
    const key = arg.split("=", 1)[0]!;
    if (seen.has(key)) throw new Error("Duplicate option: " + key);
    seen.add(key);
    if (arg === "--both-directions") bothDirections = true;
    else if (/^--max-hops=[1-6]$/.test(arg)) maxHops = Number(arg.slice(11));
    else if (/^--format=(?:json|markdown|mermaid)$/.test(arg))
      format = arg.slice(9) as typeof format;
    else throw new Error("Invalid option: " + arg);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const paths = await listMarkdown(resolve(root, "docs"), root);
  if (paths.length > 3000) throw new Error("Document inventory exceeds 3000.");
  const docs = await Promise.all(paths.map(async path =>
    ({ path, markdown: await readFile(resolve(root, path), "utf8") })));
  const graph = buildDocumentationGraph(docs);
  if (audit) { console.log(JSON.stringify(auditDocumentationNavigation(graph), null, 2)); return; }
  const trace = explainDocumentationPath(graph, args[1]!, args[2]!,
    { maxHops, bothDirections });
  if (format === "markdown") console.log(documentationTraceMarkdown(trace));
  else if (format === "mermaid") console.log(documentationTraceMermaid(trace));
  else console.log(JSON.stringify({ ...trace,
    unresolved_link_count: graph.unresolved.length,
    relevant_unresolved: graph.unresolved.filter(edge =>
      trace.nodes.includes(edge.from)),
  }, null, 2));
}
if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

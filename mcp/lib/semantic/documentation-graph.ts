import { indexExplicitDocumentationEdges, type ExplicitDocumentationEdge } from "./knowledge";

/** Derived, read-only document navigation; never a Runtime/source dependency graph. */
export type DocumentationGraph = {
  schema: 1;
  proof_scope: "AUTHORED_NAVIGATION_ONLY";
  resources: { id: string; path: string; role: "ROUTER" | "DOCUMENT" }[];
  edges: ExplicitDocumentationEdge[];
  unresolved: ExplicitDocumentationEdge[];
};
export type DocumentationStep = {
  from: string; to: string; direction: "FORWARD" | "REVERSE";
  witness: ExplicitDocumentationEdge;
};
export type DocumentationTrace = {
  schema: 1; proof_scope: DocumentationGraph["proof_scope"];
  status: "FOUND" | "NO_PATH" | "UNKNOWN_RESOURCE" | "DEPTH_LIMIT";
  from: string; to: string; nodes: string[]; steps: DocumentationStep[];
  max_hops: number; both_directions: boolean;
};

export function documentResourceId(path: string): string {
  if (!/^docs\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.md$/.test(path) ||
      path.split("/").some(x => x === "." || x === ".."))
    throw new Error("Exact canonical docs/*.md path required.");
  return "document:" + path.slice(0, -3);
}

export function buildDocumentationGraph(
  inputs: readonly { path: string; markdown: string }[]
): DocumentationGraph {
  const seen = new Set<string>();
  for (const entry of inputs) {
    documentResourceId(entry.path);
    if (seen.has(entry.path)) throw new Error("Duplicate document resource: " + entry.path);
    seen.add(entry.path);
  }
  const resources = [...seen].sort().map(path => ({
    id: documentResourceId(path), path,
    role: (path.endsWith("/README.md") ? "ROUTER" : "DOCUMENT") as "ROUTER" | "DOCUMENT",
  }));
  const authored = inputs.flatMap(entry =>
    indexExplicitDocumentationEdges(entry.path, entry.markdown)
  ).sort((a, b) => a.from.localeCompare(b.from) ||
    a.line - b.line || a.to.localeCompare(b.to) || a.label.localeCompare(b.label));
  return { schema: 1, proof_scope: "AUTHORED_NAVIGATION_ONLY", resources,
    edges: authored.filter(link => seen.has(link.to)),
    unresolved: authored.filter(link => !seen.has(link.to)) };
}

export function explainDocumentationPath(
  graph: DocumentationGraph, from: string, to: string,
  options: { maxHops?: number; bothDirections?: boolean } = {}
): DocumentationTrace {
  const maxHops = options.maxHops ?? 6;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 6)
    throw new Error("maxHops must be 1..6.");
  const bothDirections = options.bothDirections === true;
  const asPath = (value: string) => value.startsWith("document:")
    ? value.slice("document:".length) + ".md" : value;
  const start = asPath(from), target = asPath(to);
  const base: DocumentationTrace = { schema: 1, proof_scope: graph.proof_scope,
    from, to, max_hops: maxHops, both_directions: bothDirections,
    status: "UNKNOWN_RESOURCE", nodes: [], steps: [] };
  if (!graph.resources.some(x => x.path === start) ||
      !graph.resources.some(x => x.path === target)) return base;
  if (start === target) return { ...base, status: "FOUND", from: start, to: target, nodes: [start] };

  const visited = new Set([start]);
  const queue: { path: string; nodes: string[]; steps: DocumentationStep[] }[] =
    [{ path: start, nodes: [start], steps: [] }];
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    const neighbors = graph.edges.flatMap(edge => {
      const hits: DocumentationStep[] = [];
      if (edge.from === current.path) hits.push({
        from: current.path, to: edge.to, direction: "FORWARD", witness: edge });
      if (bothDirections && edge.to === current.path) hits.push({
        from: current.path, to: edge.from, direction: "REVERSE", witness: edge });
      return hits;
    }).sort((a, b) => a.to.localeCompare(b.to) ||
      a.witness.from.localeCompare(b.witness.from) || a.witness.line - b.witness.line);
    for (const step of neighbors) {
      if (visited.has(step.to)) continue;
      if (current.steps.length >= maxHops) { truncated = true; continue; }
      const nodes = [...current.nodes, step.to];
      const steps = [...current.steps, step];
      if (step.to === target) return { ...base, status: "FOUND",
        from: start, to: target, nodes, steps };
      visited.add(step.to); queue.push({ path: step.to, nodes, steps });
    }
  }
  return { ...base, status: truncated ? "DEPTH_LIMIT" : "NO_PATH",
    from: start, to: target, nodes: [start] };
}

export function auditDocumentationNavigation(graph: DocumentationGraph) {
  const start = "docs/README.md";
  if (!graph.resources.some(x => x.path === start))
    throw new Error("Canonical documentation root missing.");
  const seen = new Set([start]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of graph.edges) {
      if (edge.from !== queue[i] || seen.has(edge.to)) continue;
      seen.add(edge.to); queue.push(edge.to);
    }
  }
  return {
    proof_scope: graph.proof_scope, resource_count: graph.resources.length,
    resolved_link_count: graph.edges.length,
    unresolved_link_count: graph.unresolved.length, unresolved: graph.unresolved,
    unreachable_paths: graph.resources.filter(x => !seen.has(x.path)).map(x => x.path),
    note: "Unreachable documents are review candidates, not proof of unused or retired content.",
  };
}

/** Outputs are presentations, never installed Obsidian/Pele or executable proof. */
export function documentationTraceMermaid(trace: DocumentationTrace): string {
  const out = ["flowchart LR"];
  if (trace.status !== "FOUND") return 'flowchart LR\n  no_path["NO VERIFIED PATH"]';
  trace.nodes.forEach((path, i) => out.push("  n" + i + "[" + JSON.stringify(path) + "]"));
  trace.steps.forEach((step, i) => {
    const from = step.direction === "FORWARD" ? i : i + 1;
    const to = step.direction === "FORWARD" ? i + 1 : i;
    out.push("  n" + from + " -->|authored link| n" + to);
  });
  return out.join("\n");
}
export function documentationTraceMarkdown(trace: DocumentationTrace): string {
  const backtick = String.fromCharCode(96), fence = backtick.repeat(3);
  const out = ["# Architecture navigation", "", "Status: **" + trace.status + "**",
    "Proof: " + trace.proof_scope + " (navigation only).", ""];
  if (trace.status === "FOUND") {
    out.push("## Obsidian-compatible resource links", "");
    for (const path of trace.nodes)
      out.push("- [[" + path + "|" + documentResourceId(path) + "]]");
    out.push("", "## Link evidence", "");
    if (!trace.steps.length) out.push("- Same resource; no relationship inferred.");
    for (const step of trace.steps) out.push(
      "- " + step.from + (step.direction === "FORWARD" ? " → " : " ← reverse ") +
      step.to + " at " + step.witness.from + ":" + step.witness.line +
      " (" + step.witness.relation + ", " + step.witness.label + ")"
    );
  } else out.push("No source-backed route within the selected limits.");
  out.push("", "## Mermaid / Pele-compatible source", "", fence + "mermaid",
    documentationTraceMermaid(trace), fence, "",
    "This is not proof of source imports, execution, ownership, visuals or approval.");
  return out.join("\n");
}

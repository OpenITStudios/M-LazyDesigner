export type WatchAction =
  | "ignore"
  | "rebuild"
  | "regenerate-prompts-and-rebuild";

export type RuntimeWatchTarget = {
  path: string;
  recursive: boolean;
};

export const RUNTIME_WATCH_TARGETS: RuntimeWatchTarget[] = [
  { path: "index.ts", recursive: false },
  { path: "icon.svg", recursive: false },
  { path: "about.md", recursive: false },
  { path: "server", recursive: true },
  { path: "lib", recursive: true },
  { path: "ui", recursive: true },
  { path: "macros", recursive: true },
  { path: "prompts/bedrock_entity_workflow.md", recursive: false },
  { path: "../docs/03-authoring/modelling/decision-cases.md", recursive: false },
];

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function classifyWatchPath(path: string): WatchAction {
  const normalized = normalizeRepoPath(path);

  if (normalized === "prompts/bedrock_entity_workflow.md") {
    return "regenerate-prompts-and-rebuild";
  }
  if (normalized === "../docs/03-authoring/modelling/decision-cases.md") {
    return "rebuild";
  }

  if (
    normalized === "index.ts" ||
    normalized === "icon.svg" ||
    normalized === "about.md"
  ) {
    return "rebuild";
  }

  if (
    normalized.startsWith("server/") ||
    normalized.startsWith("lib/") ||
    normalized.startsWith("ui/") ||
    normalized.startsWith("macros/")
  ) {
    return "rebuild";
  }

  return "ignore";
}

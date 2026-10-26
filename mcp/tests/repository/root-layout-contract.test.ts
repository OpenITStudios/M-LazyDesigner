import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const ALLOWED_TOP_LEVEL_DIRECTORIES = [
  ".agents", ".github", "apps", "distribution", "docs", "experiments", "mcp", "workspace",
] as const;
const ALLOWED_TOP_LEVEL_FILES = [
  ".bun-version", ".editorconfig", ".gitattributes", ".gitignore", "AGENTS.md",
  "CONTEXT.md", "CONTRIBUTING.md", "GITHUB_RULES.md", "LICENSE", "package.json",
  "README.md", "SECURITY.md",
] as const;
const LOCAL_DIRECTORIES = [
  ".cache", ".codex", ".claude", ".idea", ".vscode",
  ".blockit", ".capture", ".sample-renders", // Compatibility-only local state.
];
const LOCAL_FILES = [".DS_Store", "Thumbs.db", "Desktop.ini"];
const localEnvironment = (name: string) => name === ".env" || name.startsWith(".env.");

function allowedRootEntry(name: string, directory: boolean, tracked = false): boolean {
  if (directory && (ALLOWED_TOP_LEVEL_DIRECTORIES as readonly string[]).includes(name)) return true;
  if (!directory && (ALLOWED_TOP_LEVEL_FILES as readonly string[]).includes(name)) return true;
  if (tracked) return false;
  return name === ".git" || (directory
    ? LOCAL_DIRECTORIES.includes(name)
    : LOCAL_FILES.includes(name) || localEnvironment(name));
}

describe("repository root layout", () => {
  test("keeps only canonical files/domains and explicitly local state at root", async () => {
    const entries = await readdir("..", { withFileTypes: true });
    const unexpected = entries.filter(entry =>
      entry.isSymbolicLink() || !allowedRootEntry(entry.name, entry.isDirectory())
    ).map(entry => entry.name).sort();
    expect(unexpected).toEqual([]);
    for (const name of ALLOWED_TOP_LEVEL_DIRECTORIES) {
      expect(entries.some(entry => entry.name === name && entry.isDirectory())).toBe(true);
    }
    for (const name of ALLOWED_TOP_LEVEL_FILES) {
      expect(entries.some(entry => entry.name === name && entry.isFile())).toBe(true);
    }
  });

  test("local state cannot become tracked source", () => {
    const git = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: "..", stdout: "pipe" });
    expect(git.exitCode).toBe(0);
    const unexpected = git.stdout.toString().split("\0").filter(Boolean).filter(path => {
      const segments = path.split("/");
      return !allowedRootEntry(segments[0]!, segments.length > 1, true);
    });
    expect(unexpected).toEqual([]);
  });

  test("rejects loose media, new domains, misplaced files and tracked local state", () => {
    for (const name of ["reference.gif", "delivery.zip", "model.bbmodel", "notes.md", ".unknown"]) {
      expect(allowedRootEntry(name, false)).toBe(false);
    }
    for (const name of ["development", "authoring", "temp", "MCP", "README.md"]) {
      expect(allowedRootEntry(name, true)).toBe(false);
    }
    for (const name of [".cache", ".codex", ".git"]) {
      expect(allowedRootEntry(name, true)).toBe(true);
      expect(allowedRootEntry(name, true, true)).toBe(false);
    }
    for (const name of [".env", ".env.local", "Desktop.ini", ".git"]) {
      expect(allowedRootEntry(name, false)).toBe(true);
      expect(allowedRootEntry(name, false, true)).toBe(false);
    }
    expect(allowedRootEntry("mcp", false)).toBe(false);
    expect(allowedRootEntry(".cache", false)).toBe(false);
  });

  test("uses lowercase kebab-case for public top-level domains", () => {
    for (const name of ALLOWED_TOP_LEVEL_DIRECTORIES.filter(name => !name.startsWith("."))) {
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  test("documented root allowlists match the executable contract", async () => {
    const root = await Bun.file("../AGENTS.md").text();
    const rule = root.match(/Allowed top-level domains are ([^\n]+), plus repository-wide/);
    expect(rule).not.toBeNull();
    const names = [...rule![1]!.matchAll(/`([.a-z-]+)\/`/g)].map(match => match[1]).sort();
    expect(names).toEqual([...ALLOWED_TOP_LEVEL_DIRECTORIES].sort());
    expect(root).toContain("research                  → experiments/");

    const readme = await Bun.file("../README.md").text();
    for (const [label, expected] of [
      ["directories", ALLOWED_TOP_LEVEL_DIRECTORIES],
      ["files", ALLOWED_TOP_LEVEL_FILES],
    ] as const) {
      const line = readme.split("\n").find(line => line.startsWith("Allowed source " + label + ":"));
      expect(line).toBeDefined();
      const names = [...line!.matchAll(/`([^`]+)`/g)].map(match => match[1]!.replace(/\/$/, ""));
      expect(names.sort()).toEqual([...expected].sort());
    }
  });
});

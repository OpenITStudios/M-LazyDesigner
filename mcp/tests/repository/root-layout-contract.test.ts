import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const ALLOWED_TOP_LEVEL_DIRECTORIES = [
  ".agents",
  ".github",
  "apps",
  "distribution",
  "docs",
  "experiments",
  "mcp",
  "workspace",
] as const;

describe("repository root layout", () => {
  test("keeps a sparse canonical top-level directory surface", async () => {
    const entries = await readdir("..", { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && entry.name !== ".git" && entry.name !== ".cache")
      .map((entry) => entry.name)
      .sort();

    expect(directories).toEqual([...ALLOWED_TOP_LEVEL_DIRECTORIES].sort());
  });

  test("uses lowercase kebab-case for public top-level domains", () => {
    const publicDomains = ALLOWED_TOP_LEVEL_DIRECTORIES.filter(
      (name) => !name.startsWith(".")
    );

    for (const name of publicDomains) {
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
  test("agent root taxonomy matches the executable canonical domain list", async () => {
    const root = await Bun.file("../AGENTS.md").text();
    const rule = root.match(/Allowed top-level domains are ([^\n]+), plus repository-wide/);
    expect(rule).not.toBeNull();
    const names = [...rule![1]!.matchAll(/`([.a-z-]+)\/`/g)]
      .map(match => match[1]).sort();
    expect(names).toEqual([...ALLOWED_TOP_LEVEL_DIRECTORIES].sort());
    expect(root).toContain("research                  → experiments/");
  });

});

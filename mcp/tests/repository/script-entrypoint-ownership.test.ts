import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

async function scriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await scriptFiles(path)));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(relative("scripts", path).replace(/\\/g, "/"));
    }
  }
  return files;
}

describe("script entrypoint ownership", () => {
  test("every runnable script is named in package.json and helpers are explicitly owned", async () => {
    const pkg = JSON.parse(await Bun.file("package.json").text()) as {
      scripts: Record<string, string>;
    };
    const files = (await scriptFiles("scripts")).sort();

    const referenced = new Set<string>();
    for (const command of Object.values(pkg.scripts)) {
      for (const match of command.matchAll(
        /\.\/scripts\/([A-Za-z0-9._\/-]+\.ts)/g
      )) {
        referenced.add(match[1]!);
      }
    }

    // These renderers are legitimate internal modules of package-owned CLI
    // entrypoints, not independent scripts. Verify their exact import owners
    // instead of mislabeling them as unused or auto-deleting report features.
    const rendererOwners: Readonly<Record<string, string>> = {
      "reporting/render-observability-report.ts":
        "reporting/compare-observability-sessions.ts",
      "reporting/render-project-observation.ts":
        "reporting/summarize-project-observation.ts",
    };
    const helpers = new Set([
      "verify/live-e2e-common.ts",
      "generate/internal/docs-manifest.ts",
      "generate/internal/doc-schema.ts",
      "benchmark/fixtures/gateway-replay-corpus.ts",
      ...Object.keys(rendererOwners),
    ]);
    const unowned = files.filter(
      (name) => !referenced.has(name) && !helpers.has(name)
    );
    expect(unowned).toEqual([]);

    for (const [helper, owner] of Object.entries(rendererOwners)) {
      // A future removed/renamed importer must reopen the review. Declaring
      // a helper here is not blanket permission for orphaned source files.
      expect(referenced.has(owner), owner).toBe(true);
      expect(files.includes(helper), helper).toBe(true);
      const stem = helper.split("/").at(-1)!.replace(/\.ts$/, "");
      const body = await Bun.file(`scripts/${owner}`).text();
      expect(body, owner).toContain(`from "./${stem}"`);
    }

    const scriptBodies = await Promise.all(
      files
        .filter((name) => !helpers.has(name))
        .map((name) => Bun.file(`scripts/${name}`).text())
    );
    expect(
      scriptBodies.some((body) => body.includes('./live-e2e-common'))
    ).toBe(true);
  });
});

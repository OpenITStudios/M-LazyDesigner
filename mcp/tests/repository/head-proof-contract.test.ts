import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

async function read(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("exact-head proof contract", () => {
  test("manual Head Proof classifies source equivalence without executable verification", async () => {
    const workflow = await read(".github/disabled-workflows/head-proof.yml");

    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^  push:/m);
    expect(workflow).toContain('classification="documentation-only"');
    expect(workflow).toContain('classification="source-impacting"');
    expect(workflow).toContain("source-equivalence evidence only");
    expect(workflow).toContain("does not substitute");
    expect(workflow).not.toContain("bun install");
    expect(workflow).not.toContain("verify:full");
  });

  test("current validation does not promote docs-only source equivalence into exact-head execution proof", async () => {
    const validation = await read("docs/05-operations/current-validation.md");

    expect(validation).toContain("docs-only head");
    expect(validation).toContain("Head Proof");
    expect(validation).toContain("executable source did not change");
    expect(validation).toContain("Source-impacting heads continue to require");
  });
});

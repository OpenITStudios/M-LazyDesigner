import { describe, expect, test } from "bun:test";

async function read(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("ChatGPT-first product contract", () => {
  test("the mandatory flow never routes through an external app", async () => {
    const flow = await read("../docs/01-product/flow.md");
    const main = flow.split("## Canonical ChatGPT-Only Flow")[1]
      ?.split("## Optional Native MCP Flow")[0] ?? "";
    expect(main).toContain("CHATGPT");
    expect(main).not.toContain("→ CODEX");
    expect(main).not.toContain("→ GATEWAY");
    expect(main).not.toContain("→ BLOCKBENCH");
  });

  test("entrypoints require no standalone application", async () => {
    const paths = [
      "../README.md", "../AGENTS.md", "../CONTEXT.md", "../docs/README.md",
      "../docs/01-product/overview.md", "../docs/01-product/requirements.md",
      "../docs/01-product/flow.md", "../docs/04-system/implementation-map.md",
    ];
    for (const path of paths) {
      const doc = await read(path);
      expect(doc).toMatch(/ChatGPT/i);
      expect(doc).toMatch(/no standalone|no separate|not required|no requirement/i);
    }
    const next = await read("../docs/05-operations/next-action.md");
    expect(next).toContain("CHATGPT_FIRST / NO_STANDALONE_APP_REQUIRED");
  });
});

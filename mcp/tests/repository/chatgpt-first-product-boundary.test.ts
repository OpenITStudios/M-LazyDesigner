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

  test("reference preparation delivers in ChatGPT and keeps native handoff optional", async () => {
    const [readme, skill] = await Promise.all([
      read("../docs/02-reference/README.md"),
      read("../.agents/skills/lazydesigner-reference-preparation/SKILL.md"),
    ]);
    expect(readme).toContain("direct artifact delivery");
    expect(readme).toContain("delivered directly in ChatGPT");
    expect(readme).toContain("requires a connected executor");
    expect(skill).toContain("a separate Codex/LazyDesigner app is not required");
    expect(skill).toContain("Do not treat a reference image as a native `.bbmodel`");
    expect(skill).not.toContain("Then stop. Downstream implementation belongs to Codex/LazyDesigner authoring Skills.");
  });

  test("modelling, texturing and animation deliver ChatGPT artifacts without an app", async () => {
    const [entry, workflow, model, texture, animation] = await Promise.all([
      read("../docs/03-authoring/README.md"),
      read("../docs/03-authoring/workflow.md"),
      read("../.agents/skills/lazydesigner-modelling/SKILL.md"),
      read("../.agents/skills/lazydesigner-texturing/SKILL.md"),
      read("../.agents/skills/lazydesigner-animation/SKILL.md"),
    ]);
    expect(entry).toContain("## ChatGPT-only delivery gate");
    expect(entry).toContain("representative QA cases");
    for (const marker of ["Minecraft model/reference", "Texture/pixel art", "Animation"]) {
      expect(entry).toContain(marker);
    }
    expect(entry).toContain("A reference image is not an editable");
    expect(entry).toContain("an actual connected executor is available");
    expect(workflow).toContain("## Execution applicability");
    expect(workflow).toContain("Optional native path");
    for (const skill of [model, texture, animation]) {
      expect(skill).toContain("## ChatGPT-only scope");
      expect(skill).toContain("docs/03-authoring/README.md");
      expect(skill).toContain("only when actually generated");
      expect(skill).toMatch(/explicitly requested|explicitly connected/);
    }
    expect(model).toContain("Do not claim Cube/Group/UV mutation");
    expect(texture).toContain("do not claim mapped-model seam/render/PBR PASS");
    expect(animation).toContain("do not claim actual playback");
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

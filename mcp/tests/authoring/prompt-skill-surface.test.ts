import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { assertBedrockWorkflowSourceCompatible } from "@/lib/promptContract";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("Bedrock prompt and skill surface", () => {
  test("runtime MCP exposes only the canonical Bedrock workflow prompt", async () => {
    const prompts = await source("server/prompts.ts");
    expect(prompts).toContain('createPrompt("bedrock_entity_workflow"');
    expect(prompts).not.toContain('createPrompt("blockbench_native_apis"');
    expect(prompts).not.toContain('createPrompt("blockbench_code_eval_safety"');
    expect(prompts).toContain("selectMcpPhaseWorkflowBody");
  });

  test("runtime prompt manifest exactly mirrors canonical source and is deterministic", async () => {
    const [promptSource, manifestText, generator, loader] = await Promise.all([
      source("prompts/bedrock_entity_workflow.md"),
      source("prompts/manifest.json"),
      source("build/generate-manifest.ts"),
      source("lib/prompts/loader.ts"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      version: string;
      prompts: Record<string, string>;
      generatedAt?: unknown;
    };

    expect(Object.keys(manifest.prompts)).toEqual(["bedrock_entity_workflow"]);
    expect(manifest.prompts.bedrock_entity_workflow).toBe(promptSource);
    expect("generatedAt" in manifest).toBe(false);
    expect(generator).not.toContain("generatedAt");
    expect(generator).not.toContain("new Date");
    expect(loader).not.toContain("generatedAt");
  });

  test("maintainer references remain source files but are excluded from runtime bundle", async () => {
    const files = (await readdir("prompts")).filter((name) => name.endsWith(".md")).sort();
    expect(files).toEqual(["bedrock_entity_workflow.md", "blockbench_code_eval_safety.md", "blockbench_native_apis.md"]);
    const manifest = JSON.parse(await source("prompts/manifest.json")) as { prompts: Record<string, string> };
    expect(Object.keys(manifest.prompts)).toEqual(["bedrock_entity_workflow"]);
  });

  test("prompt override compatibility is authoring-stage aware and stale overrides are rejected", async () => {
    const workflow = await source("prompts/bedrock_entity_workflow.md");
    expect(() => assertBedrockWorkflowSourceCompatible(workflow)).not.toThrow();
    expect(() =>
      assertBedrockWorkflowSourceCompatible(
        workflow.replace("## Texture Verify", "## Legacy Texture Review")
      )
    ).toThrow("missing section(s)");

    const [loader, dialog, prompts] = await Promise.all([
      source("lib/prompts/loader.ts"),
      source("ui/promptOverrideDialog.ts"),
      source("server/prompts.ts"),
    ]);
    expect(loader).toContain("PROMPT_OVERRIDE_STORE_VERSION = 2");
    expect(loader).toContain("base_fingerprint");
    expect(loader).toContain("schema_version");
    expect(loader).toContain("assertBedrockWorkflowSourceCompatible");
    expect(dialog).toContain("Prompt override rejected");
    expect(prompts).toContain("assertBedrockWorkflowSourceCompatible(workflow)");
  });

  test("Control routing stays separate from specialist visual judgement", async () => {
    const [root, control, modelling, texturing, animation] = await Promise.all([
      source("../AGENTS.md"),
      source("gateway/control/README.md"),
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-animation/SKILL.md"), source("../.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md")]).then((parts) => parts.join("\n")),
    ]);

    expect(root).toContain("LazyDesigner Control is the canonical routing/context authority");
    expect(control).toContain("Control does not own");
    expect(control).toContain("Codex creative/technical reasoning");
    expect(modelling).toContain("Difference-First Reference Fidelity Verdict");
    expect(texturing).toContain("material_instance");
    expect(texturing).toContain("PBR/material semantics");
    expect(animation).toContain("inspect_animation");
    expect(animation).toContain("manage_animation_controller");
    expect(animation).toMatch(/`batch`.*coherent cohort/);
  });

  test("normal authoring stays asset-only while retaining visual and controller intelligence", async () => {
    const [root, context, modelling, texturing, animation] = await Promise.all([
      source("../AGENTS.md"),
      source("../CONTEXT.md"),
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-animation/SKILL.md"), source("../.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md")]).then((parts) => parts.join("\n")),
    ]);

    expect(root).toContain("not Minecraft add-on development");
    expect(context).toContain("Asset-only product scope");
    expect(context).toContain("Behavior Pack");

    expect(modelling).toContain("Production-Scale Entity Construction");
    expect(modelling).toContain("rotated Cubes");
    expect(modelling).toContain("per-face UV");
    expect(modelling).toContain("Locator = lightweight attachment/effect anchor");
    expect(modelling).toContain("visible_bounds_*");

    expect(texturing).toContain("Asset-Only Visual Runtime Boundary");
    expect(texturing).toContain("Texture variants");
    expect(texturing).toContain("opaque/cutout/blend/emissive");

    expect(animation).toContain("Artist-Facing Controller Boundary");
    expect(animation).toContain("resource_operations");
    expect(animation).toContain("not a normal asset-authoring route");
    expect(animation).toContain("transition/blend continuity");
  });

  test("reference-driven modelling keeps a difference-first three-state visual verdict", async () => {
    const [workflow, modelling, validation] = await Promise.all([
      source("prompts/bedrock_entity_workflow.md"),
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n")),
      source("../docs/03-authoring/validation/visual.md"),
    ]);
    for (const text of [workflow, modelling, validation]) {
      expect(text).toContain("FAIL");
      expect(text).toContain("UNVERIFIED");
      expect(text).toContain("PASS");
      expect(text.toLowerCase()).toContain("difference-first");
    }
    expect(workflow).toContain("Front PASS is not full 3D PASS");
  });

  test("product-facing README uses LazyDesigner and keeps the canonical bundle identity explicit", async () => {
    const [identity, readme] = await Promise.all([
      source("lib/product/productIdentity.ts"),
      source("README.md"),
    ]);
    expect(identity).toContain('PRODUCT_NAME = "LazyDesigner — Bedrock Entity MCP"');
    expect(readme).toContain("# LazyDesigner — Bedrock Entity MCP");
    expect(readme).toContain("The canonical production bundle filename is `dist/lazydesigner_mcp.js`");
    expect(readme).toContain("Do not bulk-rename them");
  });
});

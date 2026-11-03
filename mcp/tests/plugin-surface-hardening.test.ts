import { describe, expect, test } from "bun:test";
import { createSurfaceManifest } from "@/lib/surfaceManifest";
import { PRODUCT_NAME, PRODUCT_REPOSITORY } from "@/lib/productIdentity";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("LazyDesigner plugin surface hardening", () => {
  test("surface manifest distinguishes phase, exposed, disabled, and catalog entries deterministically", () => {
    const manifest = createSurfaceManifest({
      profile: "bedrock_entity",
      stage: "geometry",
      tools: {
        exposed_b: { name: "exposed_b", description: "", enabled: true, status: "stable" },
        disabled_a: { name: "disabled_a", description: "", enabled: false, status: "experimental" },
        exposed_a: { name: "exposed_a", description: "", enabled: true, status: "stable" },
      },
      resources: { texture: { name: "texture", description: "", uriTemplate: "textures://{id}" } },
      prompts: {
        disabled_prompt: { name: "disabled_prompt", description: "", arguments: [], enabled: false, status: "stable" },
        bedrock_prompt: { name: "bedrock_prompt", description: "", arguments: [], enabled: true, status: "stable" },
      },
    });
    expect(manifest.profile).toBe("bedrock_entity");
    expect(manifest.authoring_phase).toBe("geometry");
    expect(manifest.tools).toEqual({
      exposed_count: 2, disabled_count: 1, catalog_count: 3,
      exposed: ["exposed_a", "exposed_b"], disabled: ["disabled_a"],
    });
    expect(manifest.resources).toEqual({
      exposed_count: 1, disabled_count: 0, catalog_count: 1,
      exposed: ["texture"], disabled: [],
    });
    expect(manifest.prompts.exposed_count).toBe(1);
  });

  test("plugin identity is LazyDesigner-owned while compatibility identifiers stay internal", async () => {
    expect(PRODUCT_NAME).toContain("LazyDesigner");
    expect(PRODUCT_REPOSITORY).toBe("https://github.com/MIVUBI-STD/M-LazyDesigner");
    const [indexSource, readme] = await Promise.all([source("index.ts"), source("README.md")]);
    expect(indexSource).toContain('title: "LazyDesigner"');
    expect(indexSource).not.toContain("repository: PRODUCT_REPOSITORY");
    expect(indexSource).toContain('author: "Anonymous"');
    expect(indexSource).not.toContain("jasonjgardner.github.io/blockbench-mcp-plugin");
    expect(readme).toContain("runtime authority for this repository");
    expect(readme).toContain("LazyDesigner source/builds come from this repository");
    expect(readme).toContain("canonical production bundle filename is `dist/lazydesigner_mcp.js`");
  });

  test("panel identity stays minimal without build fingerprint state", async () => {
    const [panel, uiSource, identitySource, buildSource] = await Promise.all([
      source("ui/panel.html"), source("ui/index.ts"), source("lib/product/productIdentity.ts"), source("build/index.ts"),
    ]);
    expect(panel).not.toContain("<dt>Build</dt>");
    expect(uiSource).not.toContain("PRODUCT_BUILD_REVISION");
    expect(identitySource).not.toContain("BUILD_REVISION");
    expect(buildSource).not.toContain("GITHUB_SHA");
  });

  test("panel keeps human readiness primary and hides AI registry details", async () => {
    const [panel, uiSource, identitySource] = await Promise.all([
      source("ui/panel.html"),
      source("ui/index.ts"),
      source("lib/product/productIdentity.ts"),
    ]);

    expect(panel).toContain("runtimeStatusLabel(runtime.state)");
    expect(panel).toContain("Current project");
    expect(panel).toContain("Open the project folder");
    expect(panel).toContain("AI works through the existing MCP Gateway.");
    expect(panel).not.toContain("availableToolCount");
    expect(panel).not.toContain("resources.length");
    expect(panel).not.toContain("availablePromptCount");
    expect(panel).not.toContain("Advanced details");
    expect(panel).not.toContain("Runtime endpoint");
    expect(panel).not.toContain("tools.length");
    expect(panel).not.toContain("mcp.server.phase");
    expect(panel).not.toContain("server.authoringPhase");

    expect(uiSource).toContain('name: "LazyDesigner"');
    expect(uiSource).toContain("void input.tools");
    expect(uiSource).toContain("void input.resources");
    expect(uiSource).toContain("void input.prompts");
    expect(uiSource).not.toContain("availableToolCount");
    expect(uiSource).not.toContain("createSurfaceManifest");
    expect(identitySource).toContain("authoring_phase: authoringStage");
  });

  test("status bar and plugin summary use user-facing LazyDesigner readiness language", async () => {
    const [statusSource, statusCss, identitySource] = await Promise.all([
      source("ui/statusBar.ts"),
      source("ui/statusBar.css"),
      source("lib/product/productIdentity.ts"),
    ]);

    expect(statusSource).toContain('return "LazyDesigner Runtime Ready"');
    expect(statusSource).toContain("LAZYDESIGNER_RUNTIME_STATUS_CHANGED");
    expect(statusSource).not.toContain("serverInfo");
    expect(statusCss).not.toContain("mcp-server-info");
    expect(statusCss).not.toContain("animation: pulse");

    expect(identitySource).toContain(
      '"AI-assisted Minecraft Bedrock Entity authoring for Blockbench."'
    );
    expect(identitySource).toContain("Create Minecraft Bedrock models, textures, and animations with AI in Blockbench.");
    expect(identitySource).not.toContain("Only the active authoring phase is exposed at a time");
  });

  test("Blockbench Tool Test cannot bypass disabled registration or full schema validation", async () => {
    const dialog = await source("ui/toolTestDialog.ts");
    const disabledGuard = dialog.indexOf("!tools[toolName]?.enabled");
    const fullValidation = dialog.indexOf("toolDef.parameterSchema.parseAsync(args)");
    const execute = dialog.indexOf("toolDef.execute(validatedArgs)");
    expect(disabledGuard).toBeGreaterThan(-1);
    expect(fullValidation).toBeGreaterThan(disabledGuard);
    expect(execute).toBeGreaterThan(fullValidation);
  });

  test("canonical implementation map preserves one-system ownership and protected boundaries", async () => {
    const implementation = await source("../docs/04-system/implementation-map.md");
    for (const capability of [
      "manage_animation_controller",
      "manage_locator",
      "manage_null_object",
      "material instances",
      "mcp/server/runtime/bootstrap.ts",
      "mcp/plugin/runtimeHost.ts",
      "mcp/plugin/devSync.ts",
    ]) expect(implementation.toLowerCase()).toContain(capability.toLowerCase());
    expect(implementation).toContain("There is one authoring system");
    expect(implementation).toContain("Capability/intelligence reduction is not an efficiency strategy");
    expect(implementation).toContain("never visual/user approval");
  });
});

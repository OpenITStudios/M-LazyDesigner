import { describe, expect, test } from "bun:test";
import { getChannelTextureInfo } from "@/lib/util";
import {
  animationIdOptionalSchema,
  boneNameSchema,
  cubeIdOptionalSchema,
  cubeIdSchema,
  elementIdSchema,
  textureIdOptionalSchema,
  textureIdSchema,
} from "@/lib/zodObjects";
import {
  findElementsByCriteriaParameters,
  listOutlineParameters,
} from "@/server/tools/element";
import { getUndoStackParameters } from "@/server/tools/history";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("static footprint budget", () => {
  test("current instruction owners stay within deliberate guardrail ceilings", async () => {
    const [root, mcpAgents, referenceGenerator, controlPacket, modelling, texturing, animation, workflow] = await Promise.all([
      source("../AGENTS.md"),
      source("AGENTS.md"),
      source("../.agents/skills/lazydesigner-reference-preparation/SKILL.md"),
      source("gateway/control/packet.ts"),
      source("../.agents/skills/lazydesigner-modelling/SKILL.md"),
      source("../.agents/skills/lazydesigner-texturing/SKILL.md"),
      source("../.agents/skills/lazydesigner-animation/SKILL.md"),
      source("prompts/bedrock_entity_workflow.md"),
    ]);

    expect(root.length).toBeLessThan(9_500);
    expect(mcpAgents.length).toBeLessThan(9_000);
    for (const invariant of [
      "Capability/intelligence loss is forbidden as an efficiency technique",
      "structuredContent",
      "Cost to Accepted Result",
      "persistent Gateway",
      "not auto-retried",
      "Tests are evidence",
    ]) expect(mcpAgents).toContain(invariant);
    expect(referenceGenerator.length).toBeLessThan(20_000);
    expect(controlPacket.length).toBeLessThan(14_000);
    expect(modelling.length).toBeLessThan(17_500);
    expect(texturing.length).toBeLessThan(13_200);
    expect(animation.length).toBeLessThan(14_500);
    expect(workflow.length).toBeLessThan(15_000);

    for (const [skill, terms] of [
      [modelling, ["selected_profile", "do not independently classify", "reference evidence contract"]],
      [texturing, ["stage-specific Texturing projection", "Geometry APPROVED + UV Layout PASS", "request only that exact context", "Pixel Art is conditional reference evidence", "never load the full Pixel Art corpus"]],
      [animation, ["stage-specific Animation projection", "participating semantic IDs", "request only that exact context"]],
    ] as const) {
      for (const term of terms) expect(skill).toContain(term);
    }
    const gateway = await source("gateway/index.ts");
    const instructionStart = gateway.indexOf("const GATEWAY_INSTRUCTIONS =");
    const instructionEnd = gateway.indexOf("\n\ntype ExperimentalHybridRegistrar", instructionStart);
    const instructionBlock = gateway.slice(instructionStart, instructionEnd);
    expect(instructionStart).toBeGreaterThanOrEqual(0);
    expect(instructionEnd).toBeGreaterThan(instructionStart);
    expect(instructionBlock.length).toBeLessThan(1_100);
    const schemaOwner = await source("gateway/handlers/registerCoreTools.ts");
    const schemaStart = schemaOwner.indexOf("const statusInput =");
    const schemaEnd = schemaOwner.indexOf("\n\nexport function registerCoreGatewayTools", schemaStart);
    const gatewaySchemaBlock = schemaOwner.slice(schemaStart, schemaEnd);
    expect(schemaStart).toBeGreaterThanOrEqual(0);
    expect(schemaEnd).toBeGreaterThan(schemaStart);
    expect(gatewaySchemaBlock.length).toBeLessThan(2_900);
    for (const invariant of [
      "status only for missing/stale orientation",
      "Known capability/schema: invoke directly",
      "Unknown: search",
      "uncertain schema: describe required branch",
      "receipt_only=no reread",
      "focused_read=missing evidence only",
      "visual=decision-changing evidence",
      "Geometry/Texturing share AUTHORING",
      "Never auto-retry interrupted mutations",
    ]) expect(instructionBlock).toContain(invariant);
  });

  test("static footprint is explicitly separate from authoring efficiency", async () => {
    const [brief, implementation, runbook, validation] = await Promise.all([
      source("../.agents/skills/lazydesigner-development-brief/SKILL.md"),
      source("../docs/04-system/implementation-map.md"),
      source("../docs/05-operations/local-acceptance-runbook.md"),
      source("../docs/05-operations/current-validation.md"),
    ]);

    expect(brief).toContain("Authoring Efficiency");
    expect(brief).toContain("Static Footprint");
    expect(brief).toContain("Cost to Accepted Result");
    expect(implementation).toContain("one authoring system");
    expect(implementation).not.toContain("Static Footprint");
    expect(runbook.toLowerCase()).toContain("authoring efficiency");
    expect(validation).toContain("Do not strengthen source/static claims");
    expect((await source("../AGENTS.md"))).toContain("**Authoring Efficiency** = cost to accepted result; **Static Footprint** = guardrail only");
  });

  test("normal discovery and recovery reads default to compact bounds", () => {
    const outline = listOutlineParameters.parse({});
    expect(outline.max_depth).toBe(8);
    expect(outline.max_nodes).toBe(120);
    expect(listOutlineParameters.parse({ max_depth: 32, max_nodes: 5000 })).toEqual({ include_cubes: true, max_depth: 32, max_nodes: 5000 });

    expect(findElementsByCriteriaParameters.parse({}).limit).toBe(50);
    expect(findElementsByCriteriaParameters.parse({ limit: 1000 }).limit).toBe(1000);
    expect(getUndoStackParameters.parse({}).limit).toBe(20);
    expect(getUndoStackParameters.parse({ limit: 200 }).limit).toBe(200);
  });

  test("high-reuse identity guidance stays concise without losing targeting semantics", () => {
    const cases = [
      { description: elementIdSchema.description ?? "", max: 32, terms: ["Element", "UUID", "name"] },
      { description: textureIdOptionalSchema.description ?? "", max: 50, terms: ["Texture", "UUID", "ID", "name", "omit", "selected/default"] },
      { description: textureIdSchema.description ?? "", max: 32, terms: ["Texture", "UUID", "ID", "name"] },
      { description: animationIdOptionalSchema.description ?? "", max: 70, terms: ["Animation", "UUID", "name", "omit", "current"] },
      { description: boneNameSchema.description ?? "", max: 36, terms: ["Bone", "Group", "UUID", "name"] },
      { description: cubeIdOptionalSchema.description ?? "", max: 64, terms: ["Cube", "UUID", "name", "omit", "selected"] },
      { description: cubeIdSchema.description ?? "", max: 30, terms: ["Cube", "UUID", "name"] },
    ] as const;

    for (const { description, max, terms } of cases) {
      expect(description.length).toBeLessThanOrEqual(max);
      for (const term of terms) expect(description).toContain(term);
    }

    for (const schema of [elementIdSchema, textureIdOptionalSchema, textureIdSchema, animationIdOptionalSchema, boneNameSchema, cubeIdOptionalSchema, cubeIdSchema]) {
      expect(schema.safeParse("").success).toBe(false);
    }
  });

  test("optional Texture identity guidance is shared across Paint and texture reads", async () => {
    const [paintBrush, paintPrimitives, paintSelectionLayers, textureRead] = await Promise.all([
      source("server/tools/paint/brush.ts"),
      source("server/tools/paint/primitives.ts"),
      source("server/tools/paint/selectionLayers.ts"),
      source("server/tools/texture/read.ts"),
    ]);
    const paint = [paintBrush, paintPrimitives, paintSelectionLayers].join("\n");
    expect((paint.match(/texture_id:\s*textureIdOptionalSchema/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(textureRead).toContain("texture: textureIdOptionalSchema");
  });

  test("undo and redo return compact recovery position without a stack reread", async () => {
    const history = await source("server/tools/state/history.ts");
    const undoStart = history.indexOf("createTool(historyToolDocs[0].name");
    const redoStart = history.indexOf("createTool(historyToolDocs[1].name", undoStart);
    const stackStart = history.indexOf("createTool(historyToolDocs[2].name", redoStart);
    const undoBlock = history.slice(undoStart, redoStart);
    const redoBlock = history.slice(redoStart, stackStart);

    for (const block of [undoBlock, redoBlock]) {
      expect(block).toContain("const position = currentHistoryPosition();");
      expect(block).toContain("new_index: position.index");
      expect(block).toContain("total: position.total");
      expect(block).toContain("can_undo: position.can_undo");
      expect(block).toContain("can_redo: position.can_redo");
      expect(block).toContain("structuredContent: result");
      expect(block).not.toContain("summarizeHistory(");
    }
    expect(history.slice(stackStart)).toContain("JSON.stringify(summarizeHistory(limit))");
  });

  test("material discovery channel summaries omit redundant presence flags", () => {
    const textures = [{ name: "Color", uuid: "tex-color", pbr_channel: "color" }] as Texture[];
    expect(getChannelTextureInfo(textures, "color")).toEqual({ name: "Color", uuid: "tex-color" });
    expect(getChannelTextureInfo(textures, "normal")).toBeNull();
  });

  test("project info stays lifecycle/counts-only and structured result mirrors stay compact", async () => {
    const [project, factories] = await Promise.all([source("server/tools/project/project.ts"), source("lib/factories.ts")]);
    expect(project).not.toContain("ROOT_GROUP_SUMMARY_LIMIT");
    expect(project).not.toContain("root_groups_truncated");
    expect(project).not.toContain("root_groups: rootGroups");
    expect(project).toContain("root_groups: rootGroupCount");
    expect(project).toContain("Use inspect_elements(mode=outline) only when hierarchy detail is needed");
    expect(project).toContain("structuredContent: result");
    expect(factories).toContain("compactMirroredStructuredContent");
    expect(factories).toContain("returned structured data");
  });

  test("runtime prompt bundle contains only the exposed Bedrock workflow", async () => {
    const manifest = JSON.parse(await source("prompts/manifest.json")) as { prompts: Record<string, string> };
    const serverPrompts = await source("server/prompts.ts");
    const generator = await source("build/generate-manifest.ts");
    expect(Object.keys(manifest.prompts)).toEqual(["bedrock_entity_workflow"]);
    expect(serverPrompts).toContain('createPrompt("bedrock_entity_workflow"');
    expect(serverPrompts).not.toContain('createPrompt("blockbench_native_apis"');
    expect(serverPrompts).not.toContain('createPrompt("blockbench_code_eval_safety"');
    expect(generator).toContain('RUNTIME_PROMPT_FILES = ["bedrock_entity_workflow.md"]');
  });
});

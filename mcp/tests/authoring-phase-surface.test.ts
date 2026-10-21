import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MCP_AUTHORING_PHASE,
  MCP_AUTHORING_PHASES,
  MCP_HANDOFF_REQUIRED,
  buildMcpPhaseHandoffContract,
  buildMcpPhasePromptHeader,
  classifyMcpToolPhase,
  getMcpPhaseReadinessSummary,
  resolveMcpAuthoringStage,
} from "@/lib/authoringPhase";
import { getAllToolDefinitions, getEnabledToolDefinitions } from "@/lib/factories";
import { getActiveMcpAuthoringStage, setActiveMcpAuthoringStage } from "@/lib/capabilities/authoringStage";
import { runWithMcpStageRequest, setMcpStageSwitchHandler } from "@/server/runtime/phaseControl";
import { buildMcpServerInstructions } from "@/server/server";
import { selectMcpPhaseWorkflowBody } from "@/server/prompts";
import {
  applyMcpToolSurface,
  getMcpSurfaceToolNames,
  getToolRegistrationFamily,
  isCatalogToolEnabled,
  tools,
} from "@/server/tools";

const RETIRED_3D_CAPABILITIES = [
  "materialize_3d_assisted_scaffold",
  "manage_geometry_reference",
] as const;

const phaseSurface = (phase: (typeof MCP_AUTHORING_PHASES)[number]) =>
  new Set(getMcpSurfaceToolNames("bedrock_entity", phase));

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("authoring stage MCP surface", () => {
  test("Gateway Stage handoff stays scoped while direct Runtime handoff retains global ownership", async () => {
    const globalBefore = getActiveMcpAuthoringStage();
    const switched: string[] = [];
    setMcpStageSwitchHandler(stage => {
      switched.push(stage);
      setActiveMcpAuthoringStage(stage);
    });
    const executor = getAllToolDefinitions().switch_authoring_phase?.execute;
    expect(executor).toBeDefined();
    const args = (target_phase: "geometry" | "texturing") => ({
      target_phase, reason: "scoped stage regression",
      resume_from: "same Gateway session",
    });

    try {
      applyMcpToolSurface("bedrock_entity", "geometry");
      const animationToAuthoring = await runWithMcpStageRequest(
        "animation", true, async () => executor!(args("texturing"))
      );
      expect(animationToAuthoring).toMatchObject({ structuredContent: {
        phase: "texturing", runtime_surface: "AUTHORING", surface_changed: true,
      } });
      expect(switched).toEqual([]);
      expect(getActiveMcpAuthoringStage()).toBe("geometry");

      const geometryToTexturing = await runWithMcpStageRequest(
        "geometry", true, async () => executor!(args("texturing"))
      );
      expect(geometryToTexturing).toMatchObject({ structuredContent: {
        phase: "texturing", runtime_surface: "AUTHORING", surface_changed: false,
      } });
      expect(switched).toEqual([]);
      expect(getActiveMcpAuthoringStage()).toBe("geometry");

      await expect(runWithMcpStageRequest("animation", true, async () => {
        throw new Error("scoped failure");
      })).rejects.toThrow("scoped failure");
      const direct = await runWithMcpStageRequest(
        "geometry", false, async () => executor!(args("texturing"))
      );
      expect(direct).toMatchObject({ structuredContent: {
        phase: "texturing", runtime_surface: "AUTHORING", surface_changed: false,
      } });
      expect(switched).toEqual(["texturing"]);
      expect(getActiveMcpAuthoringStage()).toBe("texturing");
    } finally {
      setMcpStageSwitchHandler(undefined);
      applyMcpToolSurface("bedrock_entity", globalBefore);
    }
  });

  test("stage setting remains backward compatible and defaults to Geometry focus", () => {
    expect(DEFAULT_MCP_AUTHORING_PHASE).toBe("geometry");
    expect(resolveMcpAuthoringStage(undefined)).toBe("geometry");
    expect(resolveMcpAuthoringStage(null)).toBe("geometry");
    expect(resolveMcpAuthoringStage("texturing")).toBe("texturing");
    expect(resolveMcpAuthoringStage("animation")).toBe("animation");
    expect(() => resolveMcpAuthoringStage("texturingg")).toThrow("Invalid MCP Authoring Stage");
  });

  test("Geometry and Texturing startup stages expose one shared AUTHORING surface", () => {
    const geometry = phaseSurface("geometry");
    const texturing = phaseSurface("texturing");
    expect([...geometry].sort()).toEqual([...texturing].sort());
    expect(geometry.size).toBe(47);

    for (const tool of [
      "manage_cubes",
      "add_group",
      "bone_rigging",
      "create_texture",
      "paint_with_brush",
      "manage_material",
      "manage_material_instances",
      "switch_authoring_phase",
    ]) {
      expect(geometry.has(tool), tool).toBe(true);
    }
    for (const retired of RETIRED_3D_CAPABILITIES) {
      expect(geometry.has(retired), retired).toBe(false);
      expect(texturing.has(retired), retired).toBe(false);
    }
    expect(geometry.has("create_animation")).toBe(false);

    const animation = phaseSurface("animation");
    expect(animation.size).toBe(18);
    expect(animation.has("create_animation")).toBe(true);
    expect(animation.has("create_project")).toBe(false);
    expect(animation.has("manage_cubes")).toBe(false);
    expect(animation.has("create_texture")).toBe(false);
    expect(animation.has("select_all_of_type")).toBe(false);
    expect(animation.has("get_selection")).toBe(false);
    for (const retired of RETIRED_3D_CAPABILITIES) {
      expect(animation.has(retired), retired).toBe(false);
    }
  });

  test("applying a stage surface controls the exact production definitions", () => {
    try {
      for (const phase of MCP_AUTHORING_PHASES) {
        applyMcpToolSurface("bedrock_entity", phase);
        const enabledProductionTools = Object.keys(getEnabledToolDefinitions())
          .filter((toolName) => getToolRegistrationFamily(toolName) !== undefined)
          .sort();
        expect(enabledProductionTools).toEqual([...phaseSurface(phase)].sort());
      }
    } finally {
      applyMcpToolSurface("bedrock_entity", DEFAULT_MCP_AUTHORING_PHASE);
    }
  });

  test("runtime contract describes shared AUTHORING and bounded Animation handoff", () => {
    for (const phase of MCP_AUTHORING_PHASES) {
      const expected = getMcpSurfaceToolNames("bedrock_entity", phase);
      const header = buildMcpPhasePromptHeader(phase, expected);
      expect(header).toContain(`Allowed tools (${expected.length}):`);
      expect(header).toContain("Gateway");
      expect(header).not.toContain("Reconnect the client to refresh tools/list");
      if (phase === "animation") expect(header).toContain("ANIMATION tools available");
      else expect(header).toContain("AUTHORING tools available");
    }
  });

  test("legacy-risk and retired tools stay outside active authoring surfaces", () => {
    const legacyRiskTools = [
      "from_geo_json",
      "risky_eval",
      "filter_by_material",
      "capture_app_screenshot",
      "set_camera_angle",
      "apply_texture",
      ...RETIRED_3D_CAPABILITIES,
    ];
    try {
      for (const profile of ["bedrock_entity", "extended"] as const) {
        for (const phase of MCP_AUTHORING_PHASES) {
          applyMcpToolSurface(profile, phase);
          const exposed = getMcpSurfaceToolNames(profile, phase);
          for (const tool of legacyRiskTools) expect(exposed).not.toContain(tool);
        }
      }
    } finally {
      applyMcpToolSurface("bedrock_entity", DEFAULT_MCP_AUTHORING_PHASE);
    }
  });

  test("every retained callable tool has exactly one semantic ownership category", () => {
    for (const toolName of Object.keys(tools)) {
      if (!isCatalogToolEnabled(toolName)) continue;
      const family = getToolRegistrationFamily(toolName);
      expect(family, `${toolName} family`).toBeDefined();
      if (RETIRED_3D_CAPABILITIES.includes(toolName as any)) {
        expect(classifyMcpToolPhase(toolName, family!), `${toolName} category`).toBeNull();
        continue;
      }
      expect(classifyMcpToolPhase(toolName, family!), `${toolName} category`).not.toBeNull();
    }
  });

  test("initialize instructions keep only Animation as a foreign runtime surface", () => {
    for (const phase of MCP_AUTHORING_PHASES) {
      const instructions = buildMcpServerInstructions(phase);
      expect(instructions).toContain(`ACTIVE STAGE: ${phase.toUpperCase()}`);
      expect(instructions).toContain("MCP CORE");
      expect(instructions).toContain(MCP_HANDOFF_REQUIRED);
      expect(instructions).toContain("switch_authoring_phase");
      expect(instructions).toContain("Gateway");
      expect(instructions).toContain("Do not search for, emulate, rename, or substitute foreign tools");
      expect(instructions).not.toContain("Reconnect the client to refresh tools/list");
      expect(instructions.length).toBeLessThan(700);
    }
  });

  test("runtime workflow renders full Authoring guidance for Geometry and Texturing focus", async () => {
    const workflow = await source("prompts/bedrock_entity_workflow.md");
    const geometry = selectMcpPhaseWorkflowBody(workflow, "geometry");
    const texturing = selectMcpPhaseWorkflowBody(workflow, "texturing");
    const animation = selectMcpPhaseWorkflowBody(workflow, "animation");

    for (const authoring of [geometry, texturing]) {
      expect(authoring).toContain("## Geometry / Visual Gate");
      expect(authoring).toContain("## Texture Atlas");
      expect(authoring).toContain("manage_cubes");
      expect(authoring).toContain("create_texture");
      expect(authoring).not.toContain("create_animation");
    }
    expect(animation).toContain("## Animation Workflow");
    expect(animation).toContain("create_animation");
    expect(animation).not.toContain("manage_cubes");
    expect(animation).not.toContain("create_texture");
  });

  test("handoff is reserved for AUTHORING and Animation boundary", () => {
    expect(getMcpPhaseReadinessSummary("geometry")).toContain("Geometry APPROVED");
    expect(getMcpPhaseReadinessSummary("geometry")).toContain("UV Layout PASS");
    expect(getMcpPhaseReadinessSummary("texturing")).toContain("Texture APPROVED");

    for (const phase of ["geometry", "texturing"] as const) {
      const contract = buildMcpPhaseHandoffContract(phase);
      expect(contract).toContain("does not require HANDOFF_REQUIRED");
      expect(contract).toContain("AUTHORING↔ANIMATION");
      expect(contract).toContain("switch_authoring_phase");
      expect(contract).toContain("same task/chat");
    }

    const animation = buildMcpPhaseHandoffContract("animation");
    for (const key of ["target_phase", "reason", "readiness", "resume_from"]) expect(animation).toContain(key);
    expect(animation).toContain("STOP Animation mutation routes");
    expect(animation).toContain("shared AUTHORING surface");
  });

  test("canonical specialists use shared Authoring corrections and current consolidated tools", async () => {
    const [modelling, texturing, animation] = await Promise.all([
      source("../.agents/skills/lazydesigner-modelling/SKILL.md"),
      source("../.agents/skills/lazydesigner-texturing/SKILL.md"),
      source("../.agents/skills/lazydesigner-animation/SKILL.md"),
    ]);

    for (const owner of [modelling, texturing, animation]) {
      expect(owner).toContain(MCP_HANDOFF_REQUIRED);
      expect(owner).toContain("switch_authoring_phase");
      expect(owner).not.toContain("action: set MCP Authoring Phase=");
      expect(owner).not.toContain("reload BlockIT MCP");
    }

    expect(modelling).toContain("Geometry↔Texturing stays shared AUTHORING");
    expect(modelling).toContain("AUTHORING↔Animation");
    expect(texturing).toContain("No Geometry↔Texturing Runtime Surface switch");
    expect(texturing).toContain("manage_material");
    expect(animation).toContain("manage_animation_timeline");
    expect(animation).toContain("inspect_particle / manage_particle");
  });

  test("plugin setting is a startup focus while Gateway owns Animation boundary", async () => {
    const [indexSource, settingsSource] = await Promise.all([
      Bun.file("index.ts").text(),
      Bun.file("ui/settings.ts").text(),
    ]);
    expect(indexSource).toContain("resolveMcpAuthoringStage");
    expect(indexSource).toContain("applyMcpToolSurface(registrationProfile, authoringStage)");
    expect(settingsSource).toContain('name: "Startup Focus (Advanced)"');
    expect(settingsSource).toContain("AI switches between authoring and animation automatically during normal use.");
    expect(settingsSource).toContain("requires_restart: true");
  });
});

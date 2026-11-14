import { describe, expect, test } from "bun:test";
import {
  BEDROCK_AUTHORING_COORDINATE_CONTRACT,
  MCP_AUTHORING_PHASES,
  buildMcpPhaseRuntimeContract,
} from "@/lib/authoringPhase";
import { buildMcpServerInstructions } from "@/server/server";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("Codex Bedrock agent legibility contract", () => {
  test("initialize exposes units/axes and Gateway-aware phase semantics without embedding routed tools", () => {
    expect(BEDROCK_AUTHORING_COORDINATE_CONTRACT).toContain(
      "16 Blockbench units=1 Minecraft block"
    );
    for (const term of ["x=width", "y=height", "z=length", "+Y=up"]) {
      expect(BEDROCK_AUTHORING_COORDINATE_CONTRACT).toContain(term);
    }

    for (const phase of MCP_AUTHORING_PHASES) {
      const runtime = buildMcpPhaseRuntimeContract(phase);
      const instructions = buildMcpServerInstructions(phase);
      expect(runtime).toContain(BEDROCK_AUTHORING_COORDINATE_CONTRACT);
      expect(instructions).toContain(BEDROCK_AUTHORING_COORDINATE_CONTRACT);
      expect(instructions).toContain(
        "Do not search for, emulate, rename, or substitute foreign tools"
      );
      expect(instructions).toContain("HANDOFF_REQUIRED");
      expect(instructions).toContain("switch_authoring_phase");
      expect(instructions).toContain("Gateway");
      expect(instructions.length).toBeLessThan(700);
      for (const routedTool of [
        "add_group=",
        "bone_rigging=",
        "create_texture=",
        "create_animation=",
      ]) expect(instructions).not.toContain(routedTool);
    }
  });

  test("root authoring boot deterministically routes through Control then one current specialist", async () => {
    const [agents, control, modelling, texturing, animation] = await Promise.all([
      source("../AGENTS.md"),
      source("gateway/control/packet.ts"),
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-animation/SKILL.md"), source("../.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md")]).then((parts) => parts.join("\n")),
    ]);

    expect(agents).toContain("LazyDesigner Control");
    expect(agents).toContain("exactly one active specialist");
    expect(agents).not.toContain(".agents/skills/blockit-bedrock-entity-mcp/SKILL.md");
    for (const path of [
      ".agents/skills/lazydesigner-modelling/SKILL.md",
      ".agents/skills/lazydesigner-texturing/SKILL.md",
      ".agents/skills/lazydesigner-animation/SKILL.md",
    ]) expect(await source("gateway/context/authoring.ts")).toContain(path);

    expect(control).toContain('mode: ControlTaskMode');
    expect(control).toContain("buildControlStageContext");
    expect(control).toContain("contextForAuthoringDomain");
    expect(control).not.toContain("control_protocol");

    expect(modelling).toMatch(/Bedrock Geometry|modelling/i);
    expect(texturing).toMatch(/Bedrock Texture|texturing/i);
    expect(animation).toMatch(/Bedrock Entity animation|animation/i);
  });

  test("common Geometry choices remain explicit in the modelling specialist while coordinate semantics stay centrally owned", async () => {
    const [control, modelling] = await Promise.all([
      source("gateway/control/packet.ts"),
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n")),
    ]);

    expect(control).toContain("contextForAuthoringDomain");
    expect(BEDROCK_AUTHORING_COORDINATE_CONTRACT).toContain("16 Blockbench units=1 Minecraft block");
    expect(modelling).toContain("add_group");
    expect(modelling).toContain("reparent_element");
    expect(modelling).toContain("modify_group");
    expect(modelling).toContain("manage_cubes");
  });

  test("Texturing exposes hard entry gate, UV gate, Painter intent, and blank-atlas guard", async () => {
    const texturing = await Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n"));

    expect(texturing).toContain("Geometry APPROVED + UV Layout PASS");
    expect(texturing).toMatch(/Entry:.*Geometry APPROVED \+ UV Layout PASS/);
    expect(texturing).toContain("`uv_audit.production_gate`");
    expect(texturing).toMatch(/16×16 blank default[^\n]*compatibility\/provisional/);
    expect(texturing).toContain("do not rely on omitted size");
    expect(texturing).toContain("128×128 default, 256×256 opt-in");
    expect(texturing).toMatch(/`gradient_tool`.*reference-supported continuous transition/);
  });

  test("distributed low-thinking authoring boot preserves current context and scoped quality claims", async () => {
    const [bootstrap, texturing, benchmark, packageSource] = await Promise.all([
      source("../distribution/authoring-AGENTS.md"),
      source("../.agents/skills/lazydesigner-texturing/SKILL.md"),
      source("docs/QUALITY_BENCHMARK.md"),
      source("../distribution/package.ts"),
    ]);
    // These are source contracts only: they cannot certify Codex loaded any
    // instructions or that the output visually matches its approved reference.
    expect(packageSource).toContain('join(packageDir, "AGENTS.md")');
    expect(bootstrap).toContain("reference_package_path");
    expect(bootstrap).toContain("current_user_delta");
    expect(bootstrap).toContain("invoke_capability.task_context_id");
    expect(bootstrap).toContain("do not switch models or thinking levels automatically");
    expect(bootstrap).toContain("At each material review boundary");
    expect(bootstrap).toContain("PASS | FAIL | UNVERIFIED");
    expect(bootstrap).toContain("READY_FOR_USER_REVIEW");
    expect(bootstrap).toContain("user Undo/reversals");
    expect(texturing).toContain("Low-thinking hot-path decision");
    expect(texturing).toContain("relevant back/side faces");
    expect(texturing).toContain("not finished");
    expect(benchmark).toContain("Codex Sol 6.1 Low Thinking");
    expect(benchmark).toContain("Do not switch reasoning effort, models or agent hosts");
  });

  test("persistent workspace preserves resume-critical UV gate, scale, front orientation, and Control resume route", async () => {
    const workspace = await source("../workspace/README.md");
    expect(workspace).toContain("UV Layout:");
    expect(workspace).toContain("NOT_STARTED | IN_PROGRESS | PASS | INVALIDATED | BLOCKED");
    expect(workspace).toContain("Texturing cannot enter `IN_PROGRESS` until `UV Layout: PASS`");
    expect(workspace).toContain("LazyDesigner Control");
    expect(workspace).toContain("current-worktree active specialist");
    expect(workspace).toContain(
      "Material handoff constraints (scale/front_direction/pose override when material)"
    );
    expect(workspace).toContain(
      "front_direction` means the canonical object front used by `capture_model_views`"
    );
    expect(workspace).toContain("1 block = 16 Blockbench units");
  });
});

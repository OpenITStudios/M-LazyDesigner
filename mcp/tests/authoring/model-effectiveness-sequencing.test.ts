import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("model creation effectiveness — texture/animation sequencing", () => {
  test("Authoring keeps Geometry approval → UV PASS → Texturing while Animation uses Gateway handoff", async () => {
    const [agents, flow, workspace, readiness, texturing, animation] = await Promise.all([
      source("../AGENTS.md"),
      source("../docs/01-product/flow.md"),
      source("../workspace/README.md"),
      source("gateway/control/readiness.ts"),
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-animation/SKILL.md"), source("../.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md")]).then((parts) => parts.join("\n")),
    ]);

    for (const text of [agents, workspace]) {
      expect(text).toContain("Geometry APPROVED");
      expect(text).toContain("UV Layout PASS");
    }
    expect(flow).toContain("USER GEOMETRY APPROVAL");
    expect(flow).toContain("PRODUCTION UV LAYOUT");
    expect(flow).toContain("TEXTURING");
    expect(workspace).toContain("Texturing cannot enter `IN_PROGRESS` until `UV Layout: PASS`");
    expect(readiness).toContain("GEOMETRY_APPROVAL_REQUIRED");
    expect(readiness).toContain("UV_LAYOUT_PASS_REQUIRED");
    expect(readiness).toContain("TEXTURE_APPROVAL_REQUIRED");

    expect(agents).toContain("AUTHORING↔Animation handoff when required");
    for (const text of [texturing, animation]) {
      expect(text).toContain("switch_authoring_phase");
      expect(text).toContain("Gateway");
    }
    expect(texturing).toContain("HANDOFF_REQUIRED");
    expect(animation).toContain("HANDOFF_REQUIRED");
    expect(texturing).toContain("No Geometry↔Texturing Runtime Surface switch");
    expect(animation.toLowerCase().replaceAll("/", " ")).toContain("participating hierarchy pivots are suitable");
  });

  test("existing-asset baseline policy stays with the modelling owner", async () => {
    const modelling = await Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n"));
    expect(modelling).toMatch(/Existing geometry is a baseline, not fidelity proof/);
    expect(modelling).toContain("Existing Assets / Shared Session");
  });

  test("Texturing can correct upstream Geometry/UV in-session; Animation still hands back", async () => {
    const [texturing, animation] = await Promise.all([
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-animation/SKILL.md"), source("../.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md")]).then((parts) => parts.join("\n")),
    ]);

    expect(texturing).toMatch(/unlocked\/invalid UV\s+→ Geometry owner \+ bounded UV correction; no Runtime Surface switch/);
    expect(texturing).toContain("Geometry/UV capabilities remain available in the shared AUTHORING Runtime Surface for **Modelling-owned** bounded upstream correction");
    expect(texturing).toContain("No Geometry↔Texturing Runtime Surface switch");
    expect(animation).toContain("Animation owns motion, not structural rig mutation");
    expect(animation).toContain("target_phase: geometry");
    expect(animation).not.toContain("tool_search");
  });

  test("texture and animation guidance remains evidence-based without preset density metrics", async () => {
    const [texturing, animation, texturePolicy] = await Promise.all([
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      Promise.all([source("../.agents/skills/lazydesigner-animation/SKILL.md"), source("../.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md")]).then((parts) => parts.join("\n")),
      source("../docs/03-authoring/texture/standard.md"),
    ]);

    expect(texturePolicy).toContain("## Box UV / UV Lock");
    expect(texturePolicy).toContain("one coherent final UV lock with autouv=0");
    expect(texturePolicy).toContain("Do not optimize atlas occupancy as a quality score");
    expect(texturePolicy).toContain("physical pixels per UV unit");

    expect(texturing).toContain("pixels per UV unit");
    expect(texturing).toContain("random high-contrast noise");
    for (const quality of ["face aspect ratio", "texel density", "semantic UV reuse"]) {
      expect(texturing).toContain(quality);
    }

    const normalizedAnimation = animation.toLowerCase();
    expect(normalizedAnimation).toContain("no universal fps, duration, amplitude, phase, keyframe count, or bezier target");
    expect(normalizedAnimation).toContain("animation quality score");
    expect(normalizedAnimation).toContain("manage_animation_timeline");
    expect(normalizedAnimation).toContain("molang");
  });

  test("R07 expensive expansion is impact-scoped and not an extra approval system", async () => {
    const [workflow, modelling, texturing, animation] = await Promise.all([
      source("../docs/03-authoring/workflow.md"),
      source("../.agents/skills/lazydesigner-modelling/SKILL.md"),
      source("../.agents/skills/lazydesigner-texturing/SKILL.md"),
      source("../.agents/skills/lazydesigner-animation/SKILL.md"),
    ]);
    expect(workflow).toContain("### Latest correction before high-cost expansion");
    expect(workflow).toContain("latest explicit user correction");
    expect(workflow).toContain("misread requirement");
    expect(workflow).toContain("new scope");
    expect(workflow).toContain("A new durable requirement belongs in the existing approved Reference/Workspace authority");
    expect(workflow).toContain("Missing/conflicting decision-critical evidence");
    expect(workflow).toContain("independent low-risk work may continue");
    expect(workflow).toContain("not a new stage, approval checkpoint");
    expect(workflow).toContain("Color/material-only alternatives first reuse the same model");
    expect(modelling).toContain("before detail, recheck affected form/views against latest user correction");
    expect(modelling).toContain("Core View Triad");
    expect(texturing).toContain("Latest user correction before broad paint");
    expect(texturing).toContain("color-only changes reuse the same `.bbmodel` and UVs");
    expect(animation).toContain("reconcile latest user correction's event order");
    expect(animation).toContain("attachment/contact");
    expect(animation).toContain("Before follower keys");
  });

  test("sequencing remains instruction/stage ownership rather than a registration profile", async () => {
    const profile = await source("lib/capabilities/registrationProfile.ts");
    expect(profile).toContain('export type McpRegistrationProfile = "bedrock_entity" | "extended";');
    expect(profile).not.toContain("sequencing_profile");
    expect(profile).not.toContain("readiness_profile");
  });
});

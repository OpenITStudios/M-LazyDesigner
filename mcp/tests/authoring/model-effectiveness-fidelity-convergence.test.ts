/**
 * Source-policy text assertions only. A PASS here does not execute Blockbench,
 * inspect model/reference pixels, measure fidelity, or establish acceptance.
 */
import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("model-fidelity policy text (not generated-model performance)", () => {
  test("local corrections require qualitative convergence rather than mutation activity", async () => {
    const [modelling, correction, workflow] = await Promise.all([
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n")),
      source("../.agents/skills/lazydesigner-modelling/references/correction.md"),
      source("prompts/bedrock_entity_workflow.md"),
    ]);
    for (const text of [correction, workflow]) {
      expect(text).toContain("IMPROVED | UNCHANGED | REGRESSED");
      const lower = normalized(text);
      expect(lower).toContain("regressed");
      expect(lower).toContain("same causal direction");
      expect(lower).toContain("blocked");
    }
    expect(normalized(modelling)).toContain("require `improved` without regression elsewhere");
    expect(normalized(correction)).toMatch(/progress requires improvement/);
  });

  test("correction reuses fresh pre-correction evidence instead of recapturing ceremonially", async () => {
    const correction = await source("../.agents/skills/lazydesigner-modelling/references/correction.md");
    const correctionText = normalized(correction);

    expect(correctionText).toContain("reuse fresh exact authored state");
    expect(correctionText).toContain("recapture only targeted stale views");
    expect(correctionText).toContain("after mutation, recapture only affected evidence");
  });

  test("model-facing evaluation remains evidence-bound and non-circular", async () => {
    const [reference, validation] = await Promise.all([
      source("../docs/02-reference/policy.md"),
      source("../docs/03-authoring/validation/visual.md"),
    ]);
    expect(normalized(reference)).toContain("approved visual reference");
    expect(normalized(reference)).toContain("visible source evidence");
    expect(normalized(validation)).toContain("actual approved reference image");
    expect(normalized(validation)).toContain("fresh current-revision model");
    expect(normalized(validation)).toContain("difference-first");
  });

  test("normal Codex Geometry correction uses the callable Gateway route, not an internal solver facade", async () => {
    const [skill, correction, control, handler, recovery, architecture] = await Promise.all([
      source("../.agents/skills/lazydesigner-modelling/SKILL.md"),
      source("../.agents/skills/lazydesigner-modelling/references/correction.md"),
      source("gateway/control/README.md"),
      source("gateway/handlers/registerCoreTools.ts"),
      source("gateway/session/orchestrationRecoveryState.ts"),
      source("lib/orchestration/README.md"),
    ]);
    // Static source-boundary assertions, not live AI/Blockbench performance.
    expect(skill).toContain("Actual production correction route:");
    expect(skill).toContain("references/correction.md");
    expect(correction).toContain("Actual Codex → Gateway correction workflow");
    for (const key of ["status", "invoke_capability", "manage_cubes", "capture_model_views", "control_delta", "UNKNOWN_OUTCOME"]) {
      expect(correction).toContain(key === "UNKNOWN_OUTCOME" ? "uncertain/failed outcome" : key);
    }
    expect(correction).toContain("IMPROVED | UNCHANGED | REGRESSED");
    expect(correction).toContain("do not load this section");
    expect(correction).toContain("not a Gateway input");
    expect(control).toContain("control_delta");
    expect(handler).toContain("GATEWAY_TOOLS.invokeCapability");
    expect(handler).not.toContain("startFromObservations(");
    expect(handler).not.toContain("planGeometryCorrection(");
    expect(recovery).toContain("readonly corrections = new CorrectionLoopRegistry()");
    expect(recovery).not.toContain("readEvidence:");
    expect(architecture).toContain("default null `applyEvidenceSource`");
    expect(architecture).toContain("does **not** expose `CorrectionLoopRegistry`");
  });

  test("fidelity hardening adds no scorer, planner, runtime profile, or fixture-specific law", async () => {
    const [profile, cubes, modelling, workflow] = await Promise.all([
      source("lib/capabilities/registrationProfile.ts"),
      source("server/tools/geometry/cubes.ts"),
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n")),
      source("prompts/bedrock_entity_workflow.md"),
    ]);
    for (const forbidden of ["reference_eval", "fidelity_profile", "vision_score", "fidelity_score"]) {
      expect(profile).not.toContain(forbidden);
      expect(cubes).not.toContain(forbidden);
    }
    expect(normalized(modelling)).not.toContain("zebra");
    expect(normalized(workflow)).not.toContain("zebra");
    expect(normalized(modelling)).toContain("similarity scores cannot justify `pass`");
    expect(normalized(workflow)).toContain("similarity scores cannot create visual `pass`");
  });
});

import { describe, expect, test } from "bun:test";

async function read(path: string) {
  return (await Bun.file(path).text()).replaceAll("**", "").replace(/\s+/g, " ").toLowerCase();
}

const REFERENCE_SKILL = "../.agents/skills/lazydesigner-reference-preparation/SKILL.md";

describe("LazyDesigner reference preparation contract", () => {
  test("clear user image requests generate directly while real blockers and requested pre-review remain gated", async () => {
    const [skill, flow, compiler, templates] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/flow.md"),
      read("../.agents/skills/lazydesigner-prompt-compiler/SKILL.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);

    expect(skill).toContain("generate directly");
    expect(skill).toContain("silence does not constitute approval");
    expect(flow).toContain("already authorizes that generation");
    expect(flow).toContain("blocking");
    expect(compiler).toContain("ready_for_generation");
    expect(templates).toContain("the user requested this image or edit");
    expect(templates).not.toContain("explicit user confirmation exists for current target");
  });

  test("creative defaults do not fabricate source-backed facts", async () => {
    const [skill, compiler, policy] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../.agents/skills/lazydesigner-prompt-compiler/SKILL.md"),
      read("../docs/02-reference/policy.md"),
    ]);

    expect(skill).toContain("reversible appearance defaults");
    expect(compiler).toContain("new creative design");
    expect(compiler).toContain("source reconstruction");
    expect(compiler).toContain("creative defaults");
    expect(policy).toContain("never as observed evidence");
    expect(compiler).not.toContain("actual generation is still forbidden until");
  });

  test("multi-view keeps the underlying 3d shape, not identical 2d silhouettes", async () => {
    const [prompt, templates] = await Promise.all([
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);

    expect(prompt).toContain("different projected");
    expect(prompt).toContain("underlying 3d dimensions");
    expect(prompt).not.toContain("change thickness or silhouette");
    expect(templates).toContain("different projected 2d silhouettes");
    expect(templates).toContain("one pass by default");
  });

  test("visual QA follows actual image visibility and never claims a hidden pre-display gate", async () => {
    const [prompt, templates] = await Promise.all([
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);

    expect(prompt).toContain("after-generation inspection");
    expect(templates).toContain("may show the result immediately");
    expect(templates).toContain("unverified");
    expect(templates).not.toContain("before presenting the generated image, verify");
  });

  test("source images remain evidence while final generated sheets target Minecraft/Blockbench", async () => {
    const [skill, policy, standard] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/policy.md"),
      read("../docs/02-reference/image/standard.md"),
    ]);

    expect(policy).toContain("a user-supplied image may already be sufficient");
    expect(skill).toContain("visible source evidence");
    expect(policy).toContain("approved minecraft/blockbench interpretation only");
    expect(standard).toContain("source image = evidence");
    expect(standard).toContain("final production sheet = approved minecraft/blockbench interpretation");
  });

  test("one unified visual system keeps panel detail in the canonical image standard", async () => {
    const [skill, standard] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/image/standard.md"),
    ]);

    expect(skill).toContain("owns panel economy and layout");
    expect(skill).toContain("do not generate every module by default");
    expect(standard).toContain("1 primary reference sheet per asset");
    expect(standard).toContain("geometry_ambiguity");
    expect(standard).toContain("texture_ambiguity");
    expect(standard).toContain("animation_ambiguity");
    expect(standard).toContain("p1");
    expect(standard).toContain("p2");
    expect(standard).toContain("p3");
    expect(standard).toContain("content decides layout");
    expect(standard).not.toContain("five fixed broad preview positions");
  });

  test("construction views are minimum-sufficient rather than a mandatory turnaround ritual", async () => {
    const [policy, standard] = await Promise.all([
      read("../docs/02-reference/policy.md"),
      read("../docs/02-reference/image/standard.md"),
    ]);

    expect(policy).toContain("minimum evidence that materially reduces downstream uncertainty");
    expect(standard).toContain("use minimum sufficient views");
    expect(standard).toContain("right → only when left/right asymmetry matters");
    expect(standard).toContain("top → only when footprint/depth/layout matters");
  });

  test("Minecraft player-relative scale is canonical without inventing exact dimensions", async () => {
    const [skill, scale] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/image/scale-and-escalation.md"),
    ]);

    expect(skill).toContain("owns player/world scale");
    expect(skill).toContain("never infer numeric scale from pixels");
    expect(scale).toContain("player_height");
    expect(scale).toContain("rideable_1p");
    expect(scale).toContain("never invent numeric values from a relative category");
    expect(scale).toContain("never infer precise block dimensions from image pixels alone");
  });

  test("sheet escalation preserves identity and scale instead of overpacking", async () => {
    const [skill, standard, scale] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/scale-and-escalation.md"),
    ]);

    expect(skill).toContain("sheet 02+");
    expect(standard).toContain("identity + scale lock / anti-drift");
    expect(standard).toContain("additional sheets never redesign or rescale the asset");
    expect(scale).toContain("scale lock");
    expect(scale).toContain("remove p3");
    expect(scale).toContain("remove lowest-value p2");
    expect(scale).toContain("sheet 02+");
  });

  test("generation prompting uses compiled state, not raw conversation", async () => {
    const [skill, prompt, templates] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);

    expect(skill).toContain("compiled brief is internal working state");
    expect(prompt).toContain("never generate directly from the uncontrolled conversation when a compiled brief exists");
    expect(prompt).toContain("identity lock");
    expect(templates).toContain("template a");
    expect(templates).toContain("template b");
    expect(templates).toContain("template c");
  });

  test("corrections are delta-first and preserve unaffected visual authority", async () => {
    const [skill, prompt] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/image/prompt-contract.md"),
    ]);

    expect(skill).toContain("corrections use change + preserve against approved authority");
    expect(prompt).toContain("approved current visual + change + preserve + affected panels");
    expect(prompt).toContain("bounded editing when possible");
  });
  test("surface coverage gate keeps view selection evidence-driven without compulsory turnarounds", async () => {
    const [standard, prompt, templates, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
      read(REFERENCE_SKILL),
    ]);
    for (const owner of [standard, prompt, skill]) expect(owner).toContain("surface coverage gate");
    expect(standard).toContain("not a mandatory six-view turnaround");
    expect(standard).toContain("minimum sufficient view set");
    expect(standard).toContain("a plain back is not automatically a defect");
    expect(standard).toContain("merely not seeing asymmetry is insufficient");
    expect(prompt).toContain("not a new package field");
    expect(templates).toContain("critical_surface_coverage when material");
    expect(skill).toContain("a single view is sufficient");
  });

  test("surface coverage scenarios distinguish hidden source facts from original creative proposals", async () => {
    const [standard, prompt, templates] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);
    for (const scenario of [
      "one_view_sufficient", "rear_structural_unknown", "proven_symmetry",
      "right_side_difference", "top_or_underside", "cross_view_conflict",
      "composite_turnaround", "original_hidden_side",
    ]) expect(standard).toContain(scenario);
    expect(prompt).toContain("do not invent rear/hidden source features");
    expect(prompt).toContain("provisional original form");
    expect(templates).toContain("source-backed hidden construction still unknown");
    expect(standard).toContain("block only that stage");
  });


  test("panel-level review keeps a composite sheet one authority and rechecks changed panels", async () => {
    const [standard, prompt, templates] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);
    expect(standard).toContain("panel-level visual review");
    expect(standard).toContain("parent image id/sha");
    expect(standard).toContain("full sheet");
    expect(standard).toContain("fake back");
    expect(standard).toContain("insufficient_evidence");
    expect(prompt).toContain("same composite bytes");
    expect(prompt).toContain("re-ground panel focus locations");
    expect(templates).toContain("panel-level recheck");
    expect(templates).toContain("collateral changes");
    expect(templates).not.toContain("create a new reference panel validator");
  });

  test("coverage review cannot turn declared metadata or unobserved images into visual PASS", async () => {
    const [standard, prompt, templates, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
      read(REFERENCE_SKILL),
    ]);
    expect(standard).toContain("after generation, inspect actual visible pixels");
    expect(standard).toContain("never by themselves visual pass");
    expect(standard).toContain("needs_review");
    expect(standard).toContain("blocked");
    expect(prompt).toContain("metadata agreement is not visual pass");
    expect(templates).toContain("critical rear/side/top/contact p1 coverage is planned");
    expect(templates).toContain("p1 rear/side/attachment coverage is actually inspectable");
    expect(skill).toContain("after inspecting the actual generated pixels");
  });

});

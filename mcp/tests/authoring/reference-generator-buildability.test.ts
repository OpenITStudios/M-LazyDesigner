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


  test("ChatGPT image generator uses one shared object-space brief rather than MCP generation", async () => {
    const [skill, prompt, templates] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);
    expect(skill).toContain("chatgpt is the image-generation actor");
    expect(skill).toContain("downstream consumer, not the image generator");
    expect(skill).toContain("invoke image generation once when authorized");
    expect(prompt).toContain("chatgpt shared object-space build brief");
    expect(prompt).toContain("not a persisted scene graph");
    expect(templates).toContain("construction lock — one shared object-space form");
  });

  test("reference generator distinguishes real volume from shading and retains side identity", async () => {
    const [prompt, standard, templates] = await Promise.all([
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);
    for (const scenario of [
      "duplicated_front_as_back", "swapped_object_sides", "part_count_drift",
      "floating_or_fake_contact", "shadow_as_geometry", "unreadable_panel",
      "source_hidden_invention",
    ]) expect(prompt).toContain(scenario);
    expect(prompt).toContain("cannot guarantee true 3d consistency");
    expect(prompt).toContain("not quotas");
    expect(standard).toContain("shadow or dark paint interpreted as unsupported geometric depth");
    expect(templates).toContain("back is the same underlying object volume");
    expect(templates).not.toContain("six views are mandatory");
  });

  test("ChatGPT reviews real generated images and performs bounded corrections", async () => {
    const [skill, prompt, templates] = await Promise.all([
      read(REFERENCE_SKILL),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
    ]);
    expect(skill).toContain("review actual generated pixels after generation");
    expect(skill).toContain("bounded change + preserve image correction");
    expect(skill).toContain("hidden pre-display quality pass");
    expect(prompt).toContain("actual previous approved image");
    expect(templates).toContain("actual approved image when available");
    expect(templates).toContain("painted shadows/highlights are not mistaken");
  });


  test("Minecraft Blockbench references preserve styled cuboid geometry and hand-painted face textures", async () => {
    const [standard, prompt, templates, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
      read(REFERENCE_SKILL),
    ]);
    for (const document of [standard, prompt, templates, skill]) {
      expect(document).toContain("minecraft_stylized_blockbench");
      expect(document).toContain("clean_blockbench_form");
      expect(document).toContain("intentional_voxel_block_art");
      expect(document).toContain("hand-painted");
    }
    expect(standard).toContain("three scales");
    expect(prompt).toContain("the middle");
    expect(skill).toContain("subject identity authority");
    expect(templates).toContain("not a smooth real-world product render");
  });

  test("source object remains distinct from the style example and no invented dimensions appear", async () => {
    const [standard, prompt, templates, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
      read(REFERENCE_SKILL),
    ]);
    expect(standard).toContain("style-only authority");
    expect(standard).toContain("invented_source_details");
    expect(prompt).toContain("subject_source");
    expect(prompt).toContain("style_example");
    expect(templates).toContain("subject =");
    expect(skill).toContain("never invent numeric dimensions");
  });

  test("style correction defaults to one hero with no infographic or unwanted views", async () => {
    const [standard, prompt, templates, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
      read(REFERENCE_SKILL),
    ]);
    expect(standard).toContain("one large, uncropped 3/4 model");
    expect(standard).toContain("two targeted retries");
    expect(prompt).toContain("no infographic");
    expect(prompt).toContain("16×7×7 claims");
    expect(templates).toContain("style-calibrating hero-only pass");
    expect(templates).toContain("no secondary views or detail thumbnails");
    expect(skill).toContain("repair a rejected style before expanding views");
    expect(skill).toContain("no infographic, dimensions, labels");
  });


  test("style analysis studies material-aware clusters and visual rest before new image generation", async () => {
    const [standard, prompt, templates, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
      read(REFERENCE_SKILL),
    ]);
    expect(standard).toContain("evidence-led style dissection");
    for (const layer of ["macro / silhouette", "meso / construction", "micro / face texture", "rest / visual quiet"]) {
      expect(standard).toContain(layer);
    }
    for (const defect of [
      "uniform_checkerboard_surface", "no_visual_rest", "material_homogenization",
      "style_identity_leak", "poster_instead_of_object",
    ]) expect(standard).toContain(defect);
    expect(prompt).toContain("no generic voxel adjectives");
    expect(prompt).toContain("rest_zones");
    expect(templates).toContain("no repeated checkerboard squares");
    expect(skill).toContain("reference learning rule");
    expect(skill).toContain("not weight training");
  });

  test("texture-only pattern failure does not trigger extra Cube geometry or invented style identity", async () => {
    const [standard, prompt, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read(REFERENCE_SKILL),
    ]);
    expect(standard).toContain("micro-pixels must not become separate protruding cubes");
    expect(prompt).toContain("correct silhouette but checkerboard surfaces");
    expect(prompt).toContain("without adding meso cubes");
    expect(standard).toContain("the supplied angular off-road vehicle image");
    expect(standard).toContain("do not transplant this vehicle");
    expect(skill).toContain("only promote observed");
    expect(skill).toContain("do not compensate by making the render busier");
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


  test("Builder examples are presentation-only and do not contaminate model identity", async () => {
    const [standard, prompt, templates, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
      read(REFERENCE_SKILL),
    ]);
    for (const role of ["subject_source", "style_example", "presentation_example", "approved_target"]) {
      expect(prompt).toContain(role);
      expect(templates).toContain(role);
      expect(skill).toContain(role);
    }
    expect(prompt).toContain("source_identity_leak");
    expect(prompt).toContain("builder does not grant global lazydesigner approval");
    expect(standard).toContain("not an approved lazydesigner");
    expect(skill).toContain("visual-match claims \`unverified\`");
  });

  test("versioned request bounds four-side layout and style HERO without false QA", async () => {
    const [standard, prompt, templates, skill] = await Promise.all([
      read("../docs/02-reference/image/standard.md"),
      read("../docs/02-reference/image/prompt-contract.md"),
      read("../docs/02-reference/image/master-templates.md"),
      read(REFERENCE_SKILL),
    ]);
    const core = templates.split("m-ld-ref — controlled reference request v1.0")[1]?.split("a style-mismatch report")[0] ?? "";
    for (const token of ["hero_style_check", "minimum_construction", "four_side_construction",
      "front top-left / right top-right / back bottom-left", "only direction labels",
      "one first-observed failure", "one bounded correction", "no_false_pass"]) {
      expect(core).toContain(token);
    }
    expect(standard).toContain("universal turnaround quota");
    expect(prompt).toContain("do not squeeze a fifth hero");
    expect(skill).toContain("construction-only");
    expect(skill).toContain("remain unverified without real tests");
  });

});

import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("particle reference authoring contract", () => {
  test("appearance orientation and flipbook timing have explicit semantic owners", async () => {
    const [skill, spec, texture, emitter] = await Promise.all([
      source("../.agents/skills/lazydesigner-particle-reference-authoring/SKILL.md"),
      source("../docs/02-reference/particle/authoring-spec.md"),
      source("../docs/02-reference/particle/texture-authoring.md"),
      source("../docs/02-reference/particle/emitter.md"),
    ]);

    expect(skill).toContain("Appearance / Timing Gate");
    expect(skill).toContain("camera-facing vs direction-aligned");
    expect(skill).toContain("frames_per_second");
    expect(skill).toContain("stretch_to_lifetime");
    expect(skill).toContain("activation_expression");

    expect(spec).toContain("facing_camera_mode");
    expect(spec).toContain("timing owner: frames_per_second | stretch_to_lifetime");
    expect(spec).toContain("physical travel");
    expect(spec).toContain("motion component, not flipbook");
    expect(texture).toContain("flipbook");
    expect(texture).toContain("stretch_to_lifetime");
    expect(emitter).toContain("activation_expression");
    expect(emitter).toContain("Do not confuse emitter activation with individual particle lifetime");
  });

  test("canonical six-case visual/game QA protects proof boundaries", async () => {
    const [qa, runbook] = await Promise.all([
      source("../docs/02-reference/particle/qa.md"),
      source("../docs/05-operations/local-acceptance-runbook.md"),
    ]);
    expect(qa).toContain("Six-case particle visual and Minecraft game-load acceptance matrix");
    for (const scenario of ["Flame (continuous)", "Smoke / plume", "Magic aura",
      "Impact / explosion", "Moving projectile trail", "Collision splash / reactive"]) {
      expect(qa).toContain(scenario);
    }
    expect(qa).toContain("baseline effect off");
    expect(qa).toContain("worst-reasonable-case");
    expect(qa).toContain("median, p95/p99 frame time");
    expect(qa).toContain("visual PASS/FAIL/UNVERIFIED");
    expect(qa).toContain("performance PASS/FAIL/UNVERIFIED");
    expect(runbook).toContain("six-case matrix");
    expect(runbook).toContain("visual claim remains `not_evaluated`");
    expect(runbook).toContain("testing hold remains active");
  });

  test("particle knowledge routing keeps one canonical patterns link", async () => {
    const map = await source("../docs/02-reference/particle/knowledge-map.md");
    expect(map.match(/\[patterns\.md\]\(patterns\.md\)/g)).toHaveLength(1);
    expect(map).not.toContain("patternsauthoring-spec.md");
    for (const owner of ["authoring-spec.md", "workflow.md", "qa.md", "delivery.md"]) {
      expect(map).toContain("[" + owner + "](" + owner + ")");
    }
  });

  test("particle authoring remains minimal and does not promote flipbook or reactivity by default", async () => {
    const [skill, spec] = await Promise.all([
      source("../.agents/skills/lazydesigner-particle-reference-authoring/SKILL.md"),
      source("../docs/02-reference/particle/authoring-spec.md"),
    ]);

    expect(skill).toContain("Use the first level that satisfies the requested visual behavior.");
    expect(spec).toContain("Do not create an atlas, flipbook, or generated texture pipeline by default.");
    expect(spec).toContain("Start at the lowest viable tier.");
    expect(spec).toContain("Do not promote a DIRECT request into COMPOSED");
  });
});

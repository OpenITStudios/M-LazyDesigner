import { describe, expect, test } from "bun:test";
import { readReferencePackageProjection } from "../../gateway/control/referencePackage";

type RegressionCase = {
  id: string;
  surface: string;
  failure: string;
  invariant: string;
  regression_test: string;
  status: "REGRESSION_GUARDED";
};

type GoldenTask = {
  id: string;
  profile: string;
  request: string;
  seed_kind: "BLANK_DISPOSABLE";
  start_stage: "geometry";
  fixture: { seed_path: string; reference_package_path: string; concept_image_path: string };
  phases: string[];
  checkpoints: string[];
  acceptance: string[];
  execution_state: "UNMEASURED";
};

describe("quality benchmark corpus contracts", () => {
  test("single Golden documentation matches the current fixture identity", async () => {
    const corpus = await Bun.file("tests/fixtures/golden-task-cases.json").json() as {
      tasks: GoldenTask[];
    };
    expect(corpus.tasks).toHaveLength(1);
    const task = corpus.tasks[0]!;
    const [policy, fixture] = await Promise.all([
      Bun.file("docs/GOLDEN_TASKS.md").text(),
      Bun.file("tests/fixtures/golden/full-asset/README.md").text(),
    ]);
    expect(policy).toContain("`" + task.id + "`");
    expect(policy).toContain(task.fixture.seed_path);
    expect(policy).toContain(task.fixture.reference_package_path);
    expect(fixture).toContain("Beacon Courier Bot");
    expect(fixture).toContain("seed.bbmodel");
    expect(fixture).toContain("reference/REFERENCE.json");
  });

  test("regression corpus names existing test source files, not current-head PASS evidence", async () => {
    const corpus = await Bun.file("tests/fixtures/regression-cases.json").json() as { schema: string; cases: RegressionCase[] };
    expect(corpus.schema).toBe("lazydesigner-regression-corpus-v1");
    expect(corpus.cases.length).toBeGreaterThanOrEqual(8);
    expect(new Set(corpus.cases.map((entry) => entry.id)).size).toBe(corpus.cases.length);
    for (const entry of corpus.cases) {
      expect(entry.id.length).toBeGreaterThan(6);
      expect(entry.surface.length).toBeGreaterThan(2);
      expect(entry.failure.length).toBeGreaterThan(12);
      expect(entry.invariant.length).toBeGreaterThan(12);
      expect(entry.regression_test).toMatch(/^tests\/.+\.test\.ts$/);
      expect(await Bun.file(entry.regression_test).exists(), entry.regression_test).toBe(true);
      expect(entry.status).toBe("REGRESSION_GUARDED");
    }
  });

  test("the full Golden Task uses an isolated fixture and remains unmeasured", async () => {
    const corpus = await Bun.file("tests/fixtures/golden-task-cases.json").json() as { schema: string; policy: { execution_state: string; historical_project_reuse: string; reference_policy: string }; tasks: GoldenTask[] };
    expect(corpus.schema).toBe("lazydesigner-golden-tasks-v1");
    expect(corpus.policy.execution_state).toBe("UNMEASURED");
    expect(corpus.tasks).toHaveLength(1);
    expect(corpus.policy.historical_project_reuse).toBe("FORBIDDEN");
    expect(corpus.policy.reference_policy).toBe("ONE_APPROVED_REFERENCE_FIXTURE_PER_BENCHMARK_REVISION");
    expect(new Set(corpus.tasks.map((entry) => entry.id)).size).toBe(corpus.tasks.length);
    expect(corpus.tasks[0]?.id).toBe("golden-full-asset-authoring");
    for (const task of corpus.tasks) {
      expect(task.request.length).toBeGreaterThan(24);
      expect(task.phases.length).toBeGreaterThan(0);
      expect(task.phases[0]).toBe(task.start_stage);
      expect(task.seed_kind).toBe("BLANK_DISPOSABLE");
      expect(task.start_stage).toBe("geometry");
      expect(task.phases).toEqual(["geometry", "texturing", "animation"]);
      expect(task.checkpoints).toEqual([
        "REFERENCE_APPROVED", "GEOMETRY_APPROVED", "UV_LAYOUT_PASS",
        "TEXTURING_APPROVED", "ANIMATION_APPROVED", "FINALIZATION_COMPLETE",
      ]);
      expect(task.checkpoints).toContain("FINALIZATION_COMPLETE");
      expect(task.acceptance).toContain("save_reopen_export_integrity");
      expect(task.request).not.toContain("workspace/active/");
      expect(task.request).not.toContain("workspace/saved/");
      for (const item of [task.fixture.seed_path, task.fixture.reference_package_path, task.fixture.concept_image_path]) {
        expect(item).toMatch(/^tests\/fixtures\/golden\/full-asset\//);
        expect(await Bun.file(item).exists(), item).toBe(true);
      }
      const seed = await Bun.file(task.fixture.seed_path).json();
      expect(seed.meta.model_format).toBe("bedrock");
      expect(seed.meta.format_version).toBe("5.0");
      for (const key of ["elements", "groups", "outliner", "textures", "animations"]) {
        expect(seed[key]).toEqual([]);
      }
      const reference = await Bun.file(task.fixture.reference_package_path).json();
      expect(reference.schema).toBe("lazydesigner-reference-v1");
      expect(reference.asset.name).toBe("beacon_courier_bot");
      expect(reference.asset.profile).toBe("MECHANICAL");
      expect(reference.asset.task).toBe("NEW_ASSET");
      expect(reference.approval).toEqual({
        brief: "APPROVED",
        visual_authority: "APPROVED",
        package_generation: "APPROVED",
      });
      expect(reference.unknowns.blocking).toEqual([]);
      expect(reference.images).toHaveLength(1);
      expect(reference.images[0]).toMatchObject({
        id: "BEACON_COMPOSITE",
        file: "beacon-courier-approved.png",
        role: "APPROVED_VOXEL_TURNAROUND",
        status: "APPROVED",
        used_by: ["GEOMETRY", "TEXTURE", "ANIMATION"],
      });
      for (const stage of ["overall", "geometry", "texture", "animation"]) {
        expect(reference.readiness[stage]).toBe("READY");
      }
      // Control owns image-byte verification. A source-level APPROVED flag
      // alone must never replace a current actual PNG integrity check.
      const projection = await readReferencePackageProjection(
        task.fixture.reference_package_path
      );
      expect(projection.available).toBe(true);
      expect(projection.readiness.overall).toBe("READY");
      expect(projection.images[0]).toMatchObject({
        integrity: "VERIFIED",
        media_type: "image/png",
        sha256: "ad8ecd1e07aa858bdecff779dc7097e49bcf5410c864d1320d252c9134e56245",
        bytes: 1640048,
        status: "APPROVED",
      });
      expect(task.acceptance.length).toBeGreaterThanOrEqual(4);
      expect(task.execution_state).toBe("UNMEASURED");
      expect(task).not.toHaveProperty("score");
      expect(task).not.toHaveProperty("pass");
      expect(task).not.toHaveProperty("accepted");
    }
  });
});
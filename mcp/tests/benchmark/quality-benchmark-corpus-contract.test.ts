import { describe, expect, test } from "bun:test";

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
  seed_kind: "BLANK_DISPOSABLE" | "STAGED_DISPOSABLE";
  start_stage: "geometry" | "texturing" | "animation";
  phases: string[];
  checkpoints: string[];
  acceptance: string[];
  execution_state: "UNMEASURED";
};

describe("quality benchmark corpus contracts", () => {
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

  test("golden task corpus stays unmeasured until real live authoring evidence exists", async () => {
    const corpus = await Bun.file("tests/fixtures/golden-task-cases.json").json() as { schema: string; policy: { execution_state: string; historical_project_reuse: string; reference_policy: string }; tasks: GoldenTask[] };
    expect(corpus.schema).toBe("lazydesigner-golden-tasks-v1");
    expect(corpus.policy.execution_state).toBe("UNMEASURED");
    expect(corpus.tasks).toHaveLength(6);
    expect(corpus.policy.historical_project_reuse).toBe("FORBIDDEN");
    expect(corpus.policy.reference_policy).toBe("FRESH_APPROVED_REFERENCE_FOR_EACH_BENCHMARK");
    expect(new Set(corpus.tasks.map((entry) => entry.id)).size).toBe(corpus.tasks.length);
    expect(corpus.tasks.map(entry => entry.id).sort()).toEqual([
      "golden-animation-correction", "golden-articulated-authoring",
      "golden-geometry-correction", "golden-organic-authoring",
      "golden-rigid-authoring", "golden-texture-correction",
    ]);
    for (const task of corpus.tasks) {
      expect(task.request.length).toBeGreaterThan(24);
      expect(task.phases.length).toBeGreaterThan(0);
      expect(task.phases[0]).toBe(task.start_stage);
      expect(["BLANK_DISPOSABLE", "STAGED_DISPOSABLE"]).toContain(task.seed_kind);
      if (task.seed_kind === "BLANK_DISPOSABLE") expect(task.start_stage).toBe("geometry");
      expect(task.checkpoints).toContain("FINALIZATION_COMPLETE");
      expect(task.acceptance).toContain("save_reopen_export_integrity");
      expect(task.request).not.toContain("workspace/active/");
      expect(task.request).not.toContain("workspace/saved/");
      expect(task.acceptance.length).toBeGreaterThanOrEqual(4);
      expect(task.execution_state).toBe("UNMEASURED");
      expect(task).not.toHaveProperty("score");
      expect(task).not.toHaveProperty("pass");
      expect(task).not.toHaveProperty("accepted");
    }
  });
});
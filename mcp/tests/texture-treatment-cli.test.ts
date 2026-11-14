import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TREATMENT_PLAN_BYTES,
  prepareTextureTreatmentReport,
  runTextureTreatmentCli,
} from "../scripts/authoring/plan-texture-treatment";

const baseInput = () => ({
  required_faces: [{ cube_uuid: "armor-a", face: "north" }],
  regions: [{
    region: "armor_front",
    evidence: "inferred",
    surface_pattern: "painted_metal",
    render_profile: "opaque",
    face_targets: [{
      cube_uuid: "armor-a", face: "north", treatment: "PAINT",
    }],
  }],
});

describe("Read-only CLI-Anything-inspired Texture planning", () => {
  test("managed executable source routes only read-only planning to the same owner", async () => {
    const [manager, packageBuilder] = await Promise.all([
      Bun.file("../distribution/cli.ts").text(),
      Bun.file("../distribution/package.ts").text(),
    ]);
    expect(manager).toContain('const readOnlyAuthoringPlan =');
    expect(manager).toContain('command === "plan-texture-treatment"');
    expect(manager).toContain('await import("../mcp/scripts/authoring/plan-texture-treatment")');
    expect(manager).toContain("runTextureTreatmentCli(raw)");
    expect(packageBuilder).toContain("Compiled manager read-only Texture planning smoke failed.");
    expect(packageBuilder).toContain('"PLAN_NOT_APPLIED"');
    // Static route assertion only: a compiled executable must later be run
    // by an authorized PC-local agent at the matching source SHA.
  });

  test("complete declared face inventory remains planning-only and visually UNVERIFIED", () => {
    const report = prepareTextureTreatmentReport(baseInput(), "a".repeat(64));
    expect(report.schema).toBe("lazydesigner-texture-treatment-cli-v1");
    expect(report.planning_readiness).toMatchObject({
      state: "ready", scope: "explicit_face_inventory",
    });
    expect(report.plan.face_coverage).toMatchObject({
      state: "assigned", required_count: 1, assigned_count: 1,
      visual_verdict: "not_evaluated",
    });
    expect(report.execution).toBe("PLAN_NOT_APPLIED");
    expect(report.native_mutation).toBe(false);
    expect(report.native_revision_verified).toBe(false);
    expect(report.user_approved).toBe(false);
    expect(report.visual_verdict).toBe("UNVERIFIED");
    expect(report.next_action).toContain("CURRENT_NATIVE_MODEL");
  });

  test("unaccounted back face cannot become whole-model styling PASS", () => {
    const input = baseInput();
    input.required_faces.push({ cube_uuid: "armor-a", face: "south" });
    const report = prepareTextureTreatmentReport(input);
    expect(report.planning_readiness.state).toBe("review_required");
    expect(report.plan.face_coverage).toMatchObject({
      state: "incomplete", missing_count: 1,
    });
    expect(report.plan.face_coverage).toMatchObject({ missing_examples: ["armor-a:south"] });
    expect(report.visual_verdict).toBe("UNVERIFIED");
  });

  test("out-of-scope face, empty regions and oversized scopes fail closed", () => {
    expect(() => prepareTextureTreatmentReport({
      ...baseInput(), regions: [],
    })).toThrow("TEXTURE_TREATMENT_INPUT_INVALID");
    expect(() => prepareTextureTreatmentReport({
      ...baseInput(), required_faces: [],
    })).toThrow("out-of-scope face");
    expect(() => prepareTextureTreatmentReport({
      ...baseInput(),
      required_faces: Array.from({ length: 4097 }, (_, i) => ({
        cube_uuid: String(i), face: "north",
      })),
    })).toThrow("TEXTURE_TREATMENT_INPUT_INVALID");
  });

  test("file CLI returns machine JSON but does not mutate the source plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazy-texture-plan-cli-"));
    const file = join(dir, "plan.json");
    try {
      const original = JSON.stringify(baseInput());
      await writeFile(file, original);
      const result = await runTextureTreatmentCli(["--input", file, "--json"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const json = JSON.parse(result.stdout);
      expect(json.execution).toBe("PLAN_NOT_APPLIED");
      expect(json.native_mutation).toBe(false);
      expect(json.input_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(await readFile(file, "utf8")).toBe(original);
      const help = await runTextureTreatmentCli(["--help"]);
      expect(help.stdout).toContain("--json");
      expect(help.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("invalid JSON, oversized payload and unknown flags do not leak file contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazy-texture-plan-errors-"));
    const file = join(dir, "invalid.json");
    try {
      await writeFile(file, "{private_secret:");
      const invalid = await runTextureTreatmentCli(["--input", file, "--json"]);
      expect(invalid.exitCode).toBe(2);
      expect(invalid.stderr).toContain("TEXTURE_TREATMENT_INPUT_JSON_INVALID");
      expect(invalid.stderr).not.toContain("private_secret");
      await writeFile(file, "X".repeat(MAX_TREATMENT_PLAN_BYTES + 1));
      const huge = await runTextureTreatmentCli(["--input", file, "--json"]);
      expect(huge.exitCode).toBe(2);
      expect(huge.stderr).toContain("TEXTURE_TREATMENT_INPUT_FILE_INVALID");
      const unknown = await runTextureTreatmentCli(["--input", file, "--apply"]);
      expect(unknown.exitCode).toBe(2);
      expect(unknown.stderr).toContain("TEXTURE_TREATMENT_CLI_ARGUMENT_INVALID");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

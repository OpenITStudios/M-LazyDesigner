import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppearanceVariantContinuityInput } from "../lib/texture/appearanceVariantContinuity";
import {
  MAX_APPEARANCE_VARIANT_INPUT_BYTES,
  prepareAppearanceVariantReport,
  runAppearanceVariantCli,
} from "../scripts/authoring/plan-appearance-variant";
import { parseAuthoringPlanFlags } from "../scripts/authoring/cliInput";

const h = (token: string) => "sha256:" + token.repeat(64);
function sample(): AppearanceVariantContinuityInput {
  const source = {
    uuid: "base", name: "base.png", width: 64, height: 64,
    role: "base_color_candidate" as const,
  };
  const bone = {
    uuid: "root", name: "root", parent_uuid: null,
    pivot: [0, 0, 0] as [number, number, number],
  };
  const baseline = {
    geometry_identifier: "geometry.bot",
    uv_mapping_sha256: h("a"),
    bones: [bone],
    material_code: "entity",
  };
  return {
    expected_project_uuid: "project-bot",
    entity_identifier: "demo:bot",
    texture_create: {
      source, base_color_candidates: [source],
      target_group: {
        uuid: "variants", name: "Colors", is_material: false,
      },
      requested_name: "red.png", existing_texture_names: ["base.png"],
    },
    mode: "TEXTURE_ONLY",
    baseline,
    proposed: { ...baseline, bitmap_width: 64, bitmap_height: 64 },
    render: {
      controller_identifier: "controller.render.bot",
      base_texture_slot: "base", variant_texture_slot: "red",
      base_geometry_slot: "base", base_material_slot: "base",
    },
    source_refs: ["approved:bot"],
  };
}

describe("read-only appearance variant CLI", () => {
  test("unmodified declared source has no continuity issues, but not visual PASS", () => {
    const input = sample();
    const before = structuredClone(input);
    const report = prepareAppearanceVariantReport(input, "a".repeat(64));
    expect(report.schema).toBe("lazydesigner-appearance-variant-cli-v1");
    expect(report.review.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(report.review.issues).toEqual([]);
    expect(report.review.warnings).toContain("TEXTURE_BITMAP_NOT_NATIVE_ATTESTED");
    expect(report.review.changed).toEqual({
      geometry: false, uv_mapping: false, rig: false, material: false,
    });
    expect(report.execution).toBe("PLAN_NOT_APPLIED");
    expect(report.native_mutation).toBe(false);
    expect(report.native_verified).toBe(false);
    expect(report.visual_verdict).toBe("UNVERIFIED");
    expect(report.user_approved).toBe(false);
    expect(input).toEqual(before);
  });

  test("unexpected UV/rig/material changes block a TEXTURE_ONLY variant", () => {
    const input = sample();
    input.proposed = {
      ...input.proposed,
      uv_mapping_sha256: h("b"),
      material_code: "entity_alphatest",
      bones: [{ ...input.proposed.bones[0]!, pivot: [0, 1, 0] }],
    };
    const report = prepareAppearanceVariantReport(input);
    expect(report.review.state).toBe("BLOCKED_BY_DECLARED_CONTINUITY");
    expect(report.review.issues).toEqual(expect.arrayContaining([
      "TEXTURE_ONLY_UV_CHANGED",
      "TEXTURE_ONLY_RIG_CHANGED",
      "TEXTURE_ONLY_MATERIAL_CHANGED",
    ]));
    expect(report.next_action).toBe("RESOLVE_DECLARED_VARIANT_CONTINUITY_ISSUES");
    expect(report.visual_verdict).toBe("UNVERIFIED");
  });

  test("file route is JSON-readable and never changes its source file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "appearance-cli-"));
    const file = join(dir, "variant.json");
    try {
      const original = JSON.stringify(sample());
      await writeFile(file, original);
      const result = await runAppearanceVariantCli(["--input", file, "--json"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        schema: "lazydesigner-appearance-variant-cli-v1",
        execution: "PLAN_NOT_APPLIED",
        native_verified: false, visual_verdict: "UNVERIFIED",
      });
      expect(await readFile(file, "utf8")).toBe(original);
      expect((await runAppearanceVariantCli(["--help"])).stdout).toContain("--json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("oversized, missing, invalid JSON and unknown flags fail without echoing data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "appearance-cli-error-"));
    const file = join(dir, "variant.json");
    try {
      await writeFile(file, "{not-a-secret-to-echo:");
      const bad = await runAppearanceVariantCli(["--input", file, "--json"]);
      expect(bad.exitCode).toBe(2);
      expect(bad.stderr).toContain("APPEARANCE_VARIANT_INPUT_JSON_INVALID");
      expect(bad.stderr).not.toContain("not-a-secret-to-echo");
      await writeFile(file, "x".repeat(MAX_APPEARANCE_VARIANT_INPUT_BYTES + 1));
      const huge = await runAppearanceVariantCli(["--input", file]);
      expect(huge.exitCode).toBe(2);
      expect(huge.stderr).toContain("APPEARANCE_VARIANT_INPUT_FILE_INVALID");
      const missing = await runAppearanceVariantCli(["--input", join(dir, "missing.json")]);
      expect(missing.exitCode).toBe(2);
      expect(missing.stderr).toContain("APPEARANCE_VARIANT_INPUT_UNAVAILABLE");
      const extra = await runAppearanceVariantCli(["--input", file, "--apply"]);
      expect(extra.exitCode).toBe(2);
      expect(extra.stderr).toContain("APPEARANCE_VARIANT_CLI_ARGUMENT_INVALID");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the two CLI surfaces share one bounded input parser", () => {
    expect(parseAuthoringPlanFlags(["--input", "plan.json", "--json"], "TEXTURE_TREATMENT"))
      .toEqual({ inputPath: "plan.json", json: true, help: false });
    expect(() => parseAuthoringPlanFlags([
      "--input", "a.json", "--input", "b.json",
    ], "TEXTURE_TREATMENT")).toThrow("TEXTURE_TREATMENT_CLI_ARGUMENT_INVALID");
    expect(() => parseAuthoringPlanFlags([], "APPEARANCE_VARIANT"))
      .toThrow("APPEARANCE_VARIANT_INPUT_PATH_REQUIRED");
    expect(() => prepareAppearanceVariantReport({}))
      .toThrow("APPEARANCE_VARIANT_INPUT_INVALID");
  });

  test("compiled manager source has a bounded route and compiled smoke", async () => {
    const [manager, packaging] = await Promise.all([
      Bun.file("../distribution/cli.ts").text(),
      Bun.file("../distribution/package.ts").text(),
    ]);
    expect(manager).toContain('command === "plan-appearance-variant"');
    expect(manager).toContain('runAppearanceVariantCli(raw)');
    expect(packaging).toContain("Compiled manager read-only appearance variant planning smoke failed.");
    // Source contract only; no Windows executable was run.
  });
});

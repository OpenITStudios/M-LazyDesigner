import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CAPABILITY_CORE_MANIFEST } from "../../lib/capabilities/manifest";
import { GEOMETRY_SOURCE_OWNERS } from "./sourceOwners/geometry";
import { TEXTURING_SOURCE_OWNERS } from "./sourceOwners/texturing";
import { ANIMATION_SOURCE_OWNERS } from "./sourceOwners/animation";
import { CORE_SOURCE_OWNERS } from "./sourceOwners/core";
import {
  anchorTestForSourceOwner,
  authoringDomainForCapability,
  listExplicitSourceOwners,
  sourceOwnerForCapability,
} from "./sourceOwners";

async function activeTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await activeTypeScriptFiles(path)));
    } else if (
      entry.isFile() &&
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts")
    ) {
      files.push(path.replaceAll("\\", "/"));
    }
  }
  return files;
}

const MODULES = [
  GEOMETRY_SOURCE_OWNERS,
  TEXTURING_SOURCE_OWNERS,
  ANIMATION_SOURCE_OWNERS,
  CORE_SOURCE_OWNERS,
] as const;

describe("Control source-owner registry", () => {
  test("domain source-owner modules do not overlap keys", () => {
    const seen = new Set<string>();
    for (const module of MODULES) {
      for (const key of Object.keys(module)) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(Object.keys(listExplicitSourceOwners()).length).toBe(seen.size);
  });

  test("every canonical phased capability has an explicit source owner", () => {
    const explicit = listExplicitSourceOwners();
    const missing = [...CAPABILITY_CORE_MANIFEST.entries()]
      .filter(([, entry]) => entry.stage != null)
      .map(([name]) => name)
      .filter((name) => explicit[name] == null)
      .sort();

    expect(missing).toEqual([]);
  });

  test("explicit owner registries no longer author the legacy test_owner field", async () => {
    for (const path of [
      "gateway/development/sourceOwners/core.ts",
      "gateway/development/sourceOwners/geometry.ts",
      "gateway/development/sourceOwners/texturing.ts",
      "gateway/development/sourceOwners/animation.ts",
    ]) {
      const source = await Bun.file(path).text();
      expect(source, path).toContain("anchor_test:");
      expect(source, path).not.toContain("test_owner:");
    }
  });

  test("public source-owner projections expose anchor_test without legacy test_owner", () => {
    const explicit = listExplicitSourceOwners();
    const owner = sourceOwnerForCapability("manage_cubes");

    expect(owner.anchor_test).toBe(
      "mcp/tests/model-effectiveness-correction-accuracy.test.ts"
    );
    expect(owner).not.toHaveProperty("test_owner");
    expect(explicit.manage_cubes?.anchor_test).toBe(
      "mcp/tests/model-effectiveness-correction-accuracy.test.ts"
    );
    expect(explicit.manage_cubes).not.toHaveProperty("test_owner");
  });

  test("anchor-test semantics remain canonical for explicit and fallback owners", () => {
    expect(
      anchorTestForSourceOwner(sourceOwnerForCapability("manage_cubes"))
    ).toBe("mcp/tests/model-effectiveness-correction-accuracy.test.ts");

    expect(
      anchorTestForSourceOwner(sourceOwnerForCapability("future_unknown_tool"))
    ).toBe("mcp/tests/gateway-contract.test.ts");
  });

  test("active Gateway and development code cannot reintroduce legacy test_owner", async () => {
    const files = [
      ...(await activeTypeScriptFiles("gateway")),
      ...(await activeTypeScriptFiles("scripts")),
    ];

    const violations: string[] = [];
    for (const path of files) {
      const source = await Bun.file(path).text();
      if (
        /\btest_owner\b/.test(source) ||
        /\.test_owner\b/.test(source)
      ) {
        violations.push(path);
      }
    }

    expect(violations).toEqual([]);
  });

  test("preserves representative ownership mappings", () => {
    expect(sourceOwnerForCapability("manage_cubes")).toMatchObject({
      source: "mcp/server/tools/geometry/cubes.ts",
      specialist: ".agents/skills/lazydesigner-modelling/SKILL.md",
    });
    expect(sourceOwnerForCapability("manage_uv_layout")).toMatchObject({
      source: "mcp/server/runtime/uv/layoutService.ts",
      specialist: ".agents/skills/lazydesigner-modelling/SKILL.md",
    });
    expect(sourceOwnerForCapability("manage_animation_controller")).toMatchObject({
      source: "mcp/server/tools/animation/controller.ts",
      specialist: ".agents/skills/lazydesigner-animation/SKILL.md",
    });
    expect(sourceOwnerForCapability("switch_authoring_phase")).toMatchObject({
      source: "mcp/server/runtime/phaseControl.ts",
      specialist: null,
    });
  });

  test("all explicit capability owners have real canonical source, regression anchor and specialist files", async () => {
    const owners = Object.entries(listExplicitSourceOwners());
    expect(owners.length).toBeGreaterThanOrEqual(71);
    for (const [capability, owner] of owners) {
      expect(owner.resolution, capability).toBeUndefined();
      expect(owner.source, capability).toMatch(/^mcp\/[A-Za-z0-9/_-]+\.ts$/);
      expect(await Bun.file(`../${owner.source}`).exists(), `${capability}: ${owner.source}`).toBe(true);
      const testPath = anchorTestForSourceOwner(owner);
      expect(testPath, capability).toMatch(/^mcp\/.*\.test\.ts$/);
      expect(await Bun.file(`../${testPath}`).exists(), `${capability}: ${testPath}`).toBe(true);
      if (owner.specialist) {
        expect(owner.specialist, capability).toMatch(/^\.agents\/skills\/lazydesigner-[a-z-]+\/SKILL\.md$/);
        expect(await Bun.file(`../${owner.specialist}`).exists(), `${capability}: ${owner.specialist}`).toBe(true);
      }
    }
  });

  test("development producers and regression consumers never import Control compatibility source owners", async () => {
    const testFiles = (await readdir("tests/development", { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
      .map((entry) => `tests/development/${entry.name}`);
    const files = [
      ...(await activeTypeScriptFiles("gateway/development")),
      ...(await activeTypeScriptFiles("scripts/development")),
      ...testFiles,
    ];
    const violations: string[] = [];
    for (const file of files) {
      const source = await Bun.file(file).text();
      for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
        const specifier = match[1]!;
        const destination = specifier.startsWith("@/")
          ? specifier.slice(2)
          : specifier.startsWith(".")
            ? join(file.slice(0, file.lastIndexOf("/")), specifier).replaceAll("\\", "/")
            : specifier;
        if (
          destination === "gateway/control/sourceOwners" ||
          destination === "gateway/control/sourceOwners.ts"
        ) {
          violations.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
    expect(await Bun.file("scripts/development/analyze-semantic-impact.ts").text())
      .toContain('from "../../gateway/development/sourceOwners"');
  });

  test("canonical capabilities never use the generic registration fallback", () => {
    const explicit = listExplicitSourceOwners();
    for (const [name, entry] of CAPABILITY_CORE_MANIFEST) {
      if (entry.stage == null) continue;
      expect(explicit[name]).toBeDefined();
      expect(sourceOwnerForCapability(name).source).not.toBe(
        "mcp/server/runtime/registration.ts"
      );
    }
  });

  test("unknown capabilities fall back by canonical authoring domain", () => {
    expect(authoringDomainForCapability("future_unknown_tool")).toBe("CORE");
    expect(sourceOwnerForCapability("future_unknown_tool")).toMatchObject({
      source: "mcp/server/runtime/registration.ts",
      specialist: null,
      resolution: "FALLBACK",
    });
  });
  test("source-owner modules match canonical authoring domains", () => {
    for (const key of Object.keys(GEOMETRY_SOURCE_OWNERS)) {
      expect(authoringDomainForCapability(key)).toBe("GEOMETRY");
    }
    for (const key of Object.keys(TEXTURING_SOURCE_OWNERS)) {
      expect(authoringDomainForCapability(key)).toBe("TEXTURING");
    }
    for (const key of Object.keys(ANIMATION_SOURCE_OWNERS)) {
      expect(authoringDomainForCapability(key)).toBe("ANIMATION");
    }
    for (const key of Object.keys(CORE_SOURCE_OWNERS)) {
      expect(authoringDomainForCapability(key)).toBe("CORE");
    }
  });

});
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { PACKAGE_SOURCE_PATHS, SKILLS } from "../../../distribution/managed-install";

// Production package paths stay explicit and bounded: the standalone Windows
// installer cannot discover repository source directories at runtime.
// This repository check makes authoring-module additions/removals fail before
// producing a managed distribution with missing or obsolete references.
function managedSkillReferenceDrift(
  activeReferences: readonly string[],
  packagedReferences: readonly string[]
): { missing: string[]; stale: string[] } {
  const active = new Set(activeReferences);
  const packaged = new Set(packagedReferences);
  return {
    missing: [...active].filter((p) => !packaged.has(p)).sort(),
    stale: [...packaged].filter((p) => !active.has(p)).sort(),
  };
}

describe("managed Skill package reference integrity", () => {
  test("packaged references exactly cover the active one-hop specialist modules", async () => {
    const activeReferences: string[] = [];
    for (const skill of SKILLS) {
      const skillPath = `../.agents/skills/${skill}/SKILL.md`;
      const source = await Bun.file(skillPath).text();
      const entries = await readdir(`../.agents/skills/${skill}/references`, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        // Fail closed on a malformed candidate instead of silently omitting it.
        expect(entry.isFile(), `${skill}: nested reference is unsupported`).toBe(true);
        expect(entry.name, `${skill}: invalid reference filename`)
          .toMatch(/^[a-z0-9-]+\.md$/);
        expect(source, `${skill}: module is not linked from SKILL.md`)
          .toContain(`references/${entry.name}`);
        activeReferences.push(`.agents/skills/${skill}/references/${entry.name}`);
      }
    }
    const packagedReferences = PACKAGE_SOURCE_PATHS.filter((path) =>
      path.startsWith(".agents/skills/") && path.includes("/references/")
    );
    const packageNames = PACKAGE_SOURCE_PATHS.map((path) => path.toLowerCase());
    expect(new Set(packageNames).size, "Duplicate/case-colliding package source path")
      .toBe(packageNames.length);
    expect(managedSkillReferenceDrift(activeReferences, packagedReferences)).toEqual({
      missing: [],
      stale: [],
    });
    for (const skill of SKILLS) {
      expect(PACKAGE_SOURCE_PATHS).toContain(`.agents/skills/${skill}/SKILL.md`);
    }
  });

  test("conditional Animation math guide is shipped and routed without a second Skill", async () => {
    const path = "docs/03-authoring/animation/math-motion-reference.md";
    expect(PACKAGE_SOURCE_PATHS).toContain(path);
    const skill = await Bun.file("../.agents/skills/lazydesigner-animation/SKILL.md").text();
    const math = await Bun.file("../" + path).text();
    expect(skill).toContain(path);
    expect(skill).toContain("NO_DEEP_REFERENCE");
    expect(skill).toContain("Conditional math authority");
    expect(math).toContain("## 5. Euler winding");
    expect(math).toContain("## 6. Contact");
    expect(math).toContain("## 7. Secondary motion");
    expect(math).toContain("NOT_EXECUTED/UNVERIFIED");
  });

  test("package drift is observable for new, renamed and retired modules", () => {
    const old = ".agents/skills/lazydesigner-texturing/references/legacy.md";
    const updated = ".agents/skills/lazydesigner-texturing/references/material.md";
    expect(managedSkillReferenceDrift([old], [old])).toEqual({
      missing: [], stale: [],
    });
    expect(managedSkillReferenceDrift([updated], [old])).toEqual({
      missing: [updated], stale: [old],
    });
    expect(managedSkillReferenceDrift([old, updated], [old])).toEqual({
      missing: [updated], stale: [],
    });
  });
});

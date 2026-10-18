import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

// Character budgets are review signals, NOT hard acceptance limits.
// Relevant expertise and safety contracts are more important than meeting an
// arbitrary size. This test still fails on broken routing and module links.
const SKILLS = [
  {
    path: "../.agents/skills/lazydesigner-reference-preparation/SKILL.md",
    reviewAtChars: 9000, classMarker: "CLASS: ROUTER", deepReferences: false,
  },
  {
    path: "../.agents/skills/lazydesigner-prompt-compiler/SKILL.md",
    reviewAtChars: 6000, classMarker: "CLASS: DELEGATED", deepReferences: false,
  },
  {
    path: "../.agents/skills/lazydesigner-pixel-art-authoring/SKILL.md",
    reviewAtChars: 11000, classMarker: "CLASS: SPECIALIST", deepReferences: false,
  },
  {
    path: "../.agents/skills/lazydesigner-particle-reference-authoring/SKILL.md",
    reviewAtChars: 10000, classMarker: "CLASS: SPECIALIST", deepReferences: false,
  },
  {
    path: "../.agents/skills/lazydesigner-modelling/SKILL.md",
    reviewAtChars: 15000, classMarker: "CLASS: SPECIALIST",
    deepReferences: true,
  },
  {
    path: "../.agents/skills/lazydesigner-animation/SKILL.md",
    reviewAtChars: 15000, classMarker: "CLASS: SPECIALIST",
    deepReferences: true,
  },
  {
    path: "../.agents/skills/lazydesigner-texturing/SKILL.md",
    reviewAtChars: 15000, classMarker: "CLASS: SPECIALIST",
    deepReferences: true,
  },
] as const;

export function skillSizeNeedsReview(chars: number, reviewAtChars: number): boolean {
  return chars > reviewAtChars;
}

/**
 * The canonical module inventory is the files present under each specialist.
 * Never maintain a parallel per-module registry in a test or Runtime.
 */
async function specialistReferenceFiles(skillPath: string): Promise<string[]> {
  const directory = skillPath.replace(/SKILL\.md$/, "references");
  const entries = await readdir(directory, { withFileTypes: true });
  const markdown = entries.filter((entry) => entry.name.endsWith(".md"));
  for (const entry of markdown) {
    if (!entry.isFile() || !/^[a-z0-9-]+\.md$/.test(entry.name)) {
      throw new Error(`Invalid or unsafe direct reference module: ${directory}/${entry.name}`);
    }
  }
  return markdown.map((entry) => `references/${entry.name}`).sort();
}

function specialistReferenceDrift(
  mainSource: string,
  actualFiles: readonly string[]
): { missingFiles: string[]; unlinkedFiles: string[] } {
  const linked = new Set(mainSource.match(/references\/[a-z0-9-]+\.md/g) ?? []);
  const current = new Set(actualFiles);
  return {
    missingFiles: [...linked].filter((path) => !current.has(path)).sort(),
    unlinkedFiles: [...current].filter((path) => !linked.has(path)).sort(),
  };
}

describe("Skill quality-first context contract", () => {
  test("size thresholds flag review rather than causing a hard character-limit failure", () => {
    expect(skillSizeNeedsReview(15000, 15000)).toBe(false);
    expect(skillSizeNeedsReview(15001, 15000)).toBe(true);
    expect(skillSizeNeedsReview(25000, 15000)).toBe(true);
    // Above-threshold content is reviewed for relevance and quality, not
    // automatically rejected, truncated, or split into another Skill.
  });

  test("every Skill retains valid discovery metadata and one declared owner", async () => {
    for (const skill of SKILLS) {
      const source = await Bun.file(skill.path).text();
      expect(source).toMatch(/^---\r?\nname: lazydesigner-[a-z-]+\r?\ndescription: .+\r?\n---/);
      expect(source).toContain(skill.classMarker);
      for (const label of ["LANE:", "DOMAIN:", "OWNER:"]) {
        expect(source).toContain(label);
      }
      if (skillSizeNeedsReview(source.length, skill.reviewAtChars)) {
        console.warn(
          `SKILL_SIZE_REVIEW: ${skill.path}: ${source.length} characters; ` +
          `advisory threshold ${skill.reviewAtChars}. Review scope, duplication, ` +
          "required rules and evidence before deciding whether to split."
        );
      }
    }
  });

  test("direct specialist modules cannot be missing, orphaned, or nested behind a second index", async () => {
    for (const skill of SKILLS.filter((item) => item.deepReferences)) {
      const main = await Bun.file(skill.path).text();
      const available = await specialistReferenceFiles(skill.path);
      const drift = specialistReferenceDrift(main, available);
      expect(drift.missingFiles, `${skill.path}: referenced modules missing from disk`).toEqual([]);
      expect(drift.unlinkedFiles, `${skill.path}: orphan modules not discoverable from SKILL.md`).toEqual([]);
      expect(available.length).toBeGreaterThan(0);
      for (const reference of available) {
        const path = skill.path.replace(/SKILL\.md$/, reference);
        const body = await Bun.file(path).text();
        expect(body).toMatch(/^# .+/);
        expect(body).toMatch(/\bLoad (?:this file )?only (?:when|for|after)\b/i);
      }
    }
    const obsolete = "../.agents/skills/lazydesigner-modelling/references/verification-uv-correction.md";
    expect(await Bun.file(obsolete).exists()).toBe(false);
  });

  test("renamed or added modules cause observable link drift without changing a hardcoded test inventory", () => {
    const linked = "Load references/correction.md only for a diagnosed defect.";
    expect(specialistReferenceDrift(linked, ["references/correction.md"]))
      .toEqual({ missingFiles: [], unlinkedFiles: [] });
    expect(specialistReferenceDrift(linked, ["references/new-technique.md"]))
      .toEqual({ missingFiles: ["references/correction.md"], unlinkedFiles: ["references/new-technique.md"] });
    expect(specialistReferenceDrift(linked, ["references/correction.md", "references/new-technique.md"]))
      .toEqual({ missingFiles: [], unlinkedFiles: ["references/new-technique.md"] });
  });

  test("growth or refactoring cannot silently remove specialist safety and quality gates", async () => {
    const required = [
      {
        file: "lazydesigner-modelling",
        markers: [
          "user geometry approved", "screenshot-per-mutation loop",
          "visual pass", "tool success", "pivot",
        ],
      },
      {
        file: "lazydesigner-texturing",
        markers: [
          "geometry approved + uv layout pass", "must not borrow cube/uv mutation",
          "tool success never creates texture pass",
          "no evidence-per-micro-mutation loop",
        ],
      },
      {
        file: "lazydesigner-animation",
        markers: [
          "structural rig defects hand back to geometry",
          "user approval", "internal `pass`", "checkpoint",
        ],
      },
    ] as const;
    for (const skill of required) {
      const source = (await Bun.file(
        `../.agents/skills/${skill.file}/SKILL.md`
      ).text()).toLowerCase();
      for (const obligation of skill.markers) {
        expect(source).toContain(obligation);
      }
    }
  });

  test("module-loading fixture covers required and unnecessary reads for each active specialist", async () => {
    const fixture = await Bun.file("tests/fixtures/skill-reference-loading-cases.json").json() as {
      version: number;
      cases: Array<{
        id: string; skill: string; prompt: string; decision: string;
        reference?: string | null; references?: string[]; reason: string;
      }>;
    };
    expect(fixture.version).toBe(1);
    const ids = new Set<string>();
    const owners = ["lazydesigner-modelling", "lazydesigner-texturing", "lazydesigner-animation"];
    const inventory = new Map<string, string[]>();
    for (const skill of SKILLS.filter((item) => item.deepReferences)) {
      const name = skill.path.split("/").at(-2);
      if (name) inventory.set(name, await specialistReferenceFiles(skill.path));
    }
    for (const row of fixture.cases) {
      expect(row.id.length).toBeGreaterThan(0);
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
      expect(row.prompt.trim().length).toBeGreaterThan(0);
      expect(row.reason.trim().length).toBeGreaterThan(0);
      expect(owners).toContain(row.skill);
      const owner = SKILLS.find((item) => item.path.endsWith(`/${row.skill}/SKILL.md`));
      expect(owner).toBeDefined();
      if (!owner) continue;
      const available = inventory.get(row.skill) ?? [];
      if (row.decision === "REQUIRED_ON_TRIGGER") {
        expect(typeof row.reference).toBe("string");
        expect(available).toContain(row.reference);
        expect(row.references).toBeUndefined();
      } else if (row.decision === "SEQUENTIAL_REQUIRED") {
        // Do not block valid multi-decision work with a one-module ceiling.
        const ordered = row.references ?? [];
        expect(ordered.length).toBeGreaterThan(1);
        expect(new Set(ordered).size).toBe(ordered.length);
        expect(row.reference).toBeUndefined();
        for (const reference of ordered) {
          expect(available).toContain(reference);
        }
      } else {
        expect(row.decision).toBe("NO_DEEP_REFERENCE");
        expect(row.reference).toBeNull();
        expect(row.references).toBeUndefined();
      }
    }
    for (const skill of owners) {
      expect(fixture.cases.some((row) => row.skill === skill && row.decision === "REQUIRED_ON_TRIGGER")).toBe(true);
      expect(fixture.cases.some((row) => row.skill === skill && row.decision === "NO_DEEP_REFERENCE")).toBe(true);
      for (const reference of inventory.get(skill) ?? []) {
        // New modules need at least one representative must-load decision;
        // adding unused documentation is not quality evidence.
        expect(fixture.cases.some((row) => row.skill === skill && (
          (row.decision === "REQUIRED_ON_TRIGGER" && row.reference === reference) ||
          (row.decision === "SEQUENTIAL_REQUIRED" && row.references?.includes(reference))
        )), `Missing activation evaluation for ${skill}/${reference}`).toBe(true);
      }
    }
    expect(fixture.cases.some((row) => row.decision === "SEQUENTIAL_REQUIRED")).toBe(true);
    // These are intended model-evaluation cases, not an executed AI trace.
  });

  test("canonical policy keeps size advisory while requiring actual quality/evidence gates", async () => {
    const [policy, engineering] = await Promise.all([
      Bun.file("../docs/04-system/ai-context-loading.md").text(),
      Bun.file("../.agents/skills/lazydesigner-skill-development/SKILL.md").text(),
    ]);
    expect(policy).toContain("15,000 characters");
    expect(policy).toContain("advisory review threshold");
    expect(policy).toContain("required-on-trigger");
    expect(policy).toContain("loaded content");
    expect(policy.toLowerCase()).toContain("quality before efficiency");
    expect(engineering).toContain("quality-first progressive disclosure");
    expect(engineering).toContain("not a pass/fail size constraint");
  });
});

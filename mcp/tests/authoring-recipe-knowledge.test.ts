import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { createAuthoringRecipeService } from "@/lib/authoringRecipe/service";
import type { AuthoringRecipeNativeSnapshot } from "@/lib/authoringRecipe/nativeState";
import {
  buildRecipeKnowledgeIndexFromWorkflow,
  buildRecipeGeometryCaseIndex,
  readBundledRecipeKnowledgeIndex,
} from "@/server/runtime/recipes/authoring/knowledgeRuntime";
import { createRecipeKnowledgeExcerptReader } from "@/lib/authoringRecipe/knowledgeExcerpt";
import { proposeGeometryConstruction } from "@/lib/authoringRecipe/geometryProposal";
import { reviewRecipeKnowledge } from "@/lib/authoringRecipe/knowledgePlanning";
import { classifyWatchPath, RUNTIME_WATCH_TARGETS } from "@/build/watch-policy";
import {
  bindRecipeKnowledge,
  resolveRecipeKnowledgeLinks,
  RECIPE_GEOMETRY_CASE_SOURCE_PATH,
} from "@/lib/authoringRecipe/knowledge";
import { suggestRecipeKnowledge } from "@/lib/authoringRecipe/knowledgeSelection";
import { prepareKnowledgeAwareRecipe } from "@/lib/authoringRecipe/knowledgePlanning";
import {
  parseAuthoringRecipeStore,
  serializeAuthoringRecipeStore,
} from "@/lib/authoringRecipe/store";
import {
  describeKnowledgeSource,
  indexMarkdownKnowledge,
  type KnowledgeIndexSnapshot,
} from "@/lib/semantic/knowledge";

const path = "docs/03-authoring/model-knowledge.md";
const knowledge = [
  "# Model rules",
  "## Arm pivot",
  "Arm pivot follows the shoulder and maintains animation clearance.",
  "## Cloth markings",
  "Cloth markings are surface texture details on a UV atlas.",
].join("\n");
function snapshot(markdown = knowledge): KnowledgeIndexSnapshot {
  return {
    sections: indexMarkdownKnowledge(path, markdown),
    sources: [describeKnowledgeSource(path, markdown)],
  };
}
function recipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1, id: "character", name: "character",
    prototypes: [{ id: "arm-prototype", name: "arm", size: [4, 12, 4] }],
    patterns: [{
      kind: "LINEAR", id: "arm-pattern", feature_id: "arm",
      prototype_id: "arm-prototype", count: 1, axis: "X", spacing: 0,
    }],
    feature_intents: [
      {
        id: "arm", label: "arm pivot", visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: ["reference:front"],
        geometry_reasons: ["MOTION"],
      },
      {
        id: "cloth", label: "cloth markings", visual_role: "SURFACE_DETAIL",
        evidence: "SUPPORTED", evidence_refs: ["reference:front"],
      },
    ],
  };
}
const sectionFor = (index: KnowledgeIndexSnapshot, heading: string) => {
  const found = index.sections.find(section => section.heading === heading);
  if (!found) throw new Error("Missing test knowledge section " + heading);
  return found;
};

describe("Recipe-owned knowledge: selection, binding, and source-snapshot review", () => {
  test("legacy Recipe compiles unchanged and missing bindings are not a PASS", () => {
    const original = recipe();
    const compiled = compileAuthoringRecipe(original);
    expect(compiled.metrics.realized_cube_count).toBe(1);
    expect(resolveRecipeKnowledgeLinks(original, snapshot()).state).toBe("NOT_BOUND");
    expect(original.knowledge_links).toBeUndefined();
  });

  test("selects relevant indexed guidance per feature without silently binding it", () => {
    const original = recipe();
    const before = structuredClone(original);
    const suggestions = suggestRecipeKnowledge(original, snapshot(), {
      max_per_feature: 2,
    });
    const arm = suggestions.find(item => item.feature_id === "arm")!;
    const cloth = suggestions.find(item => item.feature_id === "cloth")!;
    expect(arm.feature_route).toBe("GEOMETRY");
    expect(cloth.feature_route).toBe("TEXTURE");
    expect(arm.sections[0]?.heading).toBe("Arm pivot");
    expect(cloth.sections[0]?.heading).toBe("Cloth markings");
    expect(original).toEqual(before);
    expect(original.knowledge_links).toBeUndefined();
    expect(arm.evidence_boundary).toBe("ADVISORY_CANDIDATES_NOT_REFERENCE_OR_VISUAL_PROOF");
  });

  test("pins knowledge on the SAME Recipe, preserves compile and survives store roundtrip", () => {
    const original = recipe();
    const index = snapshot();
    const armSection = sectionFor(index, "Arm pivot");
    const next = bindRecipeKnowledge(original, index, [{
      feature_id: "arm", section_id: armSection.id,
    }]);
    expect(original.knowledge_links).toBeUndefined();
    expect(next.knowledge_links).toEqual([{
      feature_id: "arm", section_id: armSection.id,
      section_sha256: armSection.sha256,
      source_sha256: index.sources![0]!.content_sha256,
    }]);
    expect(compileAuthoringRecipe(next).placements)
      .toEqual(compileAuthoringRecipe(original).placements);
    const stored = parseAuthoringRecipeStore(serializeAuthoringRecipeStore({
      schema: 1, recipes: [next],
    }));
    expect(stored.recipes[0]!.knowledge_links).toEqual(next.knowledge_links);
    const inspected = prepareKnowledgeAwareRecipe(stored.recipes[0]!, index);
    expect(inspected.knowledge.state).toBe("CURRENT_SOURCE_SNAPSHOT");
    expect(inspected.knowledge.matched[0]?.feature_id).toBe("arm");
    expect(inspected.knowledge.evidence_boundary)
      .toBe("INDEX_METADATA_ONLY_NOT_VISUAL_OR_RUNTIME_PROOF");
    expect(inspected.compiled.feature_plan?.state).toBe("ready");
  });

  test("changed and missing knowledge are REVIEW_REQUIRED, never silently trusted", () => {
    const original = recipe();
    const base = snapshot();
    const bound = bindRecipeKnowledge(original, base, [{
      feature_id: "arm", section_id: sectionFor(base, "Arm pivot").id,
    }]);
    const edited = snapshot(knowledge.replace("animation clearance", "pose clearance"));
    const stale = prepareKnowledgeAwareRecipe(bound, edited);
    expect(stale.knowledge.state).toBe("REVIEW_REQUIRED");
    expect(stale.knowledge.issues).toEqual([{
      feature_id: "arm", section_id: sectionFor(base, "Arm pivot").id,
      reason: "SECTION_STALE",
    }]);
    expect(stale.compiled.metrics.realized_cube_count).toBe(1);
    const unrelatedChange = snapshot(knowledge + "\n\n## Other rule\nNew reference note.");
    const sourceStale = resolveRecipeKnowledgeLinks(bound, unrelatedChange);
    expect(sourceStale.state).toBe("REVIEW_REQUIRED");
    expect(sourceStale.issues[0]?.reason).toBe("SOURCE_STALE");
    expect(resolveRecipeKnowledgeLinks(bound, { sections: [] }).issues[0]?.reason)
      .toBe("SECTION_MISSING");
    expect(resolveRecipeKnowledgeLinks(bound, { sections: base.sections }).issues[0]?.reason)
      .toBe("SOURCE_PROVENANCE_MISSING");
  });

  test("rejects unknown owner, duplicate and malformed knowledge even in compiled/store paths", () => {
    const base = snapshot();
    const section = sectionFor(base, "Arm pivot");
    expect(() => bindRecipeKnowledge(recipe(), base, [{
      feature_id: "unknown", section_id: section.id,
    }])).toThrow("RECIPE_KNOWLEDGE_BIND_FEATURE_UNKNOWN");
    const bound = bindRecipeKnowledge(recipe(), base, [{
      feature_id: "arm", section_id: section.id,
    }]);
    bound.knowledge_links!.push({ ...bound.knowledge_links![0]! });
    expect(() => compileAuthoringRecipe(bound)).toThrow("RECIPE_KNOWLEDGE_LINK_DUPLICATED");
    expect(() => serializeAuthoringRecipeStore({ schema: 1, recipes: [bound] }))
      .toThrow("RECIPE_KNOWLEDGE_LINK_DUPLICATED");
    const malformed = recipe();
    malformed.knowledge_links = [{
      feature_id: "arm", section_id: section.id, section_sha256: "untrusted",
      source_sha256: "a".repeat(64),
    }];
    expect(() => compileAuthoringRecipe(malformed)).toThrow("RECIPE_KNOWLEDGE_LINK_INVALID");
  });

  test("external sections need explicit exact compatibility and never override image evidence", () => {
    const externalPath = "references/bedrock/rigging.md";
    const body = "# Rigging\n## Arm pivot\nPlace arm pivots on joints.";
    const external: KnowledgeIndexSnapshot = {
      sections: indexMarkdownKnowledge(externalPath, body),
      sources: [describeKnowledgeSource(externalPath, body, {
        upstream_url: "https://learn.microsoft.com/en-us/minecraft/creator/",
        upstream_revision: "v1.2.0",
        compatible_with: [{ product: "MINECRAFT_BEDROCK", version: "1.21.0" }],
      })],
    };
    expect(suggestRecipeKnowledge(recipe(), external)[0]?.sections).toEqual([]);
    expect(suggestRecipeKnowledge(recipe(), external, {
      compatible_with: { product: "MINECRAFT_BEDROCK", version: "1.20.0" },
    })[0]?.sections).toEqual([]);
    const matching = { product: "MINECRAFT_BEDROCK", version: "1.21.0" } as const;
    expect(suggestRecipeKnowledge(recipe(), external, {
      compatible_with: matching,
    }).find(item => item.feature_id === "arm")!.sections[0]?.heading)
      .toBe("Arm pivot");
    const bound = bindRecipeKnowledge(recipe(), external, [{
      feature_id: "arm", section_id: sectionFor(external, "Arm pivot").id,
    }], matching);
    expect(resolveRecipeKnowledgeLinks(bound, external, matching).state)
      .toBe("CURRENT_SOURCE_SNAPSHOT");
    const changedRevision: KnowledgeIndexSnapshot = {
      sections: external.sections,
      sources: external.sources!.map(source => source.origin === "EXTERNAL_SNAPSHOT"
        ? { ...source, upstream_revision: "v1.2.1" } : source),
    };
    expect(resolveRecipeKnowledgeLinks(bound, changedRevision, matching)
      .issues[0]?.reason).toBe("UPSTREAM_REVISION_STALE");
    expect(resolveRecipeKnowledgeLinks(bound, external, {
      product: "MINECRAFT_BEDROCK", version: "1.20.0",
    }).issues[0]?.reason).toBe("SOURCE_INCOMPATIBLE");
    const unconfirmed = recipe();
    unconfirmed.feature_intents![0]!.evidence = "PROVISIONAL";
    const linked = bindRecipeKnowledge(unconfirmed, external, [{
      feature_id: "arm", section_id: sectionFor(external, "Arm pivot").id,
    }], matching);
    expect(() => prepareKnowledgeAwareRecipe(linked, external, {
      compatible_with: matching,
    })).toThrow("FEATURE_DECISION_REVIEW_REQUIRED");
  });
});


describe("Recipe source planning and Runtime knowledge bridge", () => {
  test("selects one exact feature without claiming reference or native proof", () => {
    const index = snapshot();
    const filtered = suggestRecipeKnowledge(recipe(), index, {
      feature_ids: ["arm"], max_per_feature: 2,
    });
    expect(filtered.map(item => item.feature_id)).toEqual(["arm"]);
    expect(filtered[0]?.sections[0]?.heading).toBe("Arm pivot");
    expect(() => suggestRecipeKnowledge(recipe(), index, {
      feature_ids: ["not-a-feature"],
    })).toThrow("RECIPE_KNOWLEDGE_SELECTION_FEATURE_UNKNOWN");
    expect(() => suggestRecipeKnowledge(recipe(), index, {
      feature_ids: ["arm", "arm"],
    })).toThrow("RECIPE_KNOWLEDGE_SELECTION_FEATURE_SCOPE_INVALID");
  });

  test("indexes only bounded source with explicit provenance", () => {
    expect(buildRecipeKnowledgeIndexFromWorkflow("")).toBeNull();
    expect(buildRecipeKnowledgeIndexFromWorkflow("X".repeat(64001))).toBeNull();
    const index = buildRecipeKnowledgeIndexFromWorkflow(
      "# Bedrock\n## Geometry\nGeometry uses Cube patterns and pivots."
    )!;
    expect(index.sections.some(item => item.heading === "Geometry")).toBe(true);
    expect(index.sources?.[0]).toMatchObject({
      origin: "REPOSITORY", source: "prompts/bedrock_entity_workflow.md",
    });
  });

  test("planStored consumes indexed knowledge; stale and unavailable are not silently accepted", async () => {
    const base = recipe();
    const index = snapshot();
    const pinned = bindRecipeKnowledge(base, index, [{
      feature_id: "arm", section_id: sectionFor(index, "Arm pivot").id,
    }]);
    const geometry: AuthoringRecipeNativeSnapshot = {
      schema: 1, recipe_id: base.id,
      cubes: compileAuthoringRecipe(base).placements.map((item, i) => ({
        uuid: "native-" + i, recipe_id: base.id, instance_id: item.id,
        name: item.name, from: item.from, to: item.to,
        origin: item.origin, rotation: item.rotation, inflate: item.inflate,
      })),
    };
    let reads = 0;
    const service = createAuthoringRecipeService({
      readOwned: () => geometry, readStoredRecipe: () => base,
      readKnowledgeIndex: () => { reads++; return index; },
      createApplyAdapter: () => { throw new Error("No native mutation in planning."); },
    });
    const plan = await service.planStored(pinned);
    expect(reads).toBe(1);
    expect(plan.recipe_knowledge).toMatchObject({
      source_state: "AVAILABLE",
      knowledge: { state: "CURRENT_SOURCE_SNAPSHOT" },
      suggestions: [{ feature_id: "arm" }, { feature_id: "cloth" }],
      execution_boundary: "SOURCE_PLANNING_ONLY_NO_NATIVE_MUTATION_OR_VISUAL_PROOF",
    });
    const changed = snapshot(knowledge + "\n\n## New rule\nA new unrelated rule.");
    const staleService = createAuthoringRecipeService({
      readOwned: () => geometry, readKnowledgeIndex: () => changed,
      createApplyAdapter: () => { throw new Error("No native mutation."); },
    });
    const stale = await staleService.plan(base, pinned);
    expect(stale.recipe_knowledge).toMatchObject({
      source_state: "AVAILABLE",
      knowledge: { state: "REVIEW_REQUIRED", issues: [{ reason: "SOURCE_STALE" }] },
    });
    const unavailable = createAuthoringRecipeService({
      readOwned: () => geometry, readKnowledgeIndex: () => null,
      createApplyAdapter: () => { throw new Error("No native mutation."); },
    });
    const noKnowledge = await unavailable.plan(base, pinned);
    expect(noKnowledge.recipe_knowledge).toMatchObject({
      source_state: "UNAVAILABLE", reason: "RECIPE_KNOWLEDGE_INDEX_UNAVAILABLE",
    });
    const legacy = structuredClone(base);
    delete legacy.feature_intents;
    delete legacy.knowledge_links;
    for (const pattern of legacy.patterns) delete pattern.feature_id;
    let legacyReads = 0;
    const legacyService = createAuthoringRecipeService({
      readOwned: () => geometry,
      readKnowledgeIndex: () => { legacyReads++; return index; },
      createApplyAdapter: () => { throw new Error("No native mutation."); },
    });
    const oldPlan = await legacyService.plan(legacy, legacy);
    expect(oldPlan).not.toHaveProperty("recipe_knowledge");
    expect(legacyReads).toBe(0);
  });
});


describe("G1 source-grounded Geometry knowledge case pilot", () => {
  const sourcePath = "docs/03-authoring/modelling/decision-cases.md";
  const cases = readFileSync(
    new URL("../../docs/03-authoring/modelling/decision-cases.md", import.meta.url),
    "utf8"
  );
  const caseIndex = {
    sections: indexMarkdownKnowledge(sourcePath, cases),
    sources: [describeKnowledgeSource(sourcePath, cases)],
  };

  const queries = [
    ["G-P01", "scale cross-view depth"],
    ["G-P02", "primary silhouette mass"],
    ["G-P03", "protruding form surface marking"],
    ["G-P04", "sloped form staircase"],
    ["G-P05", "joint pivot bone parenting"],
    ["G-P06", "negative space painted shadow"],
    ["G-P07", "symmetry intentional asymmetry"],
    ["G-P08", "thin plane uv compatibility"],
  ] as const;

  test("all eight distinct case sections carry conditional source and counterexample boundaries", () => {
    const actual = caseIndex.sections.filter(s => /^G-P\d{2} /.test(s.heading));
    expect(actual).toHaveLength(8);
    expect(new Set(actual.map(s => s.id)).size).toBe(8);
    const spans = cases.split(/^## G-P\d{2} /m).slice(1);
    expect(spans).toHaveLength(8);
    for (const span of spans) {
      for (const marker of [
        "**Apply:**", "**Reject/defer:**", "**Source evidence:**",
        "**Recipe decision:**", "**Counterexample (hypothetical):**",
        "**Proof required:**",
      ]) expect(span).toContain(marker);
    }
    expect(cases).toContain("SOURCE-GROUNDED_CANDIDATE");
    expect(cases).toContain("Git blob object IDs, not SHA-256");
  });

  test("indexed source selects its exact case per semantic problem without upgrading unknown reference evidence", () => {
    for (const [id, label] of queries) {
      const provisional: AuthoringRecipe = {
        schema: 1, compiler_version: 1,
        id: "pilot-" + id, name: "geometry decision",
        prototypes: [], patterns: [],
        feature_intents: [{
          id: "test-feature", label, visual_role: "THREE_DIMENSIONAL",
          evidence: "PROVISIONAL", geometry_reasons: ["SILHOUETTE"],
        }],
      };
      const selected = suggestRecipeKnowledge(provisional, caseIndex, {
        feature_ids: ["test-feature"], max_per_feature: 1,
        max_token_proxy: 1600,
      });
      expect(selected).toHaveLength(1);
      expect(selected[0]?.sections[0]?.section_id).toContain(id.toLowerCase());
      expect(selected[0]?.sections[0]?.section_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(selected[0]?.feature_route).toBe("REVIEW_REQUIRED");
      expect(compileAuthoringRecipe(provisional).feature_plan?.state)
        .toBe("review_required");
    }
  });

  test("explicit Recipe binding preserves knowledge freshness without granting visual approval", () => {
    const selected = caseIndex.sections.find(s => s.heading.startsWith("G-P05 "))!;
    const provisional: AuthoringRecipe = {
      schema: 1, compiler_version: 1,
      id: "g1-provisional-hinge", name: "mechanical hinge case",
      prototypes: [], patterns: [],
      feature_intents: [{
        id: "hinge", label: "joint pivot bone parenting",
        visual_role: "THREE_DIMENSIONAL",
        evidence: "PROVISIONAL", geometry_reasons: ["MOTION"],
      }],
    };
    const bound = bindRecipeKnowledge(provisional, caseIndex, [
      { feature_id: "hinge", section_id: selected.id },
    ]);
    const current = resolveRecipeKnowledgeLinks(bound, caseIndex);
    expect(current.state).toBe("CURRENT_SOURCE_SNAPSHOT");
    expect(current.evidence_boundary)
      .toBe("INDEX_METADATA_ONLY_NOT_VISUAL_OR_RUNTIME_PROOF");
    expect(compileAuthoringRecipe(bound).feature_plan?.state)
      .toBe("review_required");
    const updated = cases.replace(
      "use the actual joint/hinge pivot.",
      "use the explicitly confirmed joint/hinge pivot."
    );
    expect(updated).not.toBe(cases);
    const revisedIndex = {
      sections: indexMarkdownKnowledge(sourcePath, updated),
      sources: [describeKnowledgeSource(sourcePath, updated)],
    };
    expect(resolveRecipeKnowledgeLinks(bound, revisedIndex).issues)
      .toEqual([{ feature_id: "hinge", section_id: selected.id, reason: "SECTION_STALE" }]);
  });
});


describe("G2 bundled casebook and on-demand Recipe guidance", () => {
  const canonicalPath = "docs/03-authoring/modelling/decision-cases.md";
  const cases = readFileSync(
    new URL("../../docs/03-authoring/modelling/decision-cases.md", import.meta.url),
    "utf8"
  );
  const original = buildRecipeGeometryCaseIndex(cases)!;

  function pilotRecipe(label = "joint pivot bone parenting"): AuthoringRecipe {
    return {
      schema: 1, compiler_version: 1, id: "g2-pilot", name: "hinge model",
      prototypes: [], patterns: [],
      feature_intents: [{
        id: "joint", label, visual_role: "THREE_DIMENSIONAL",
        evidence: "PROVISIONAL", geometry_reasons: ["MOTION"],
      }],
    };
  }

  test("Runtime imports the canonical casebook rather than another generated manifest", () => {
    const bundled = readBundledRecipeKnowledgeIndex();
    expect(bundled).not.toBeNull();
    const sections = bundled!.sections.filter(s => s.source === canonicalPath);
    expect(sections).toHaveLength(8);
    expect(sections.map(s => s.heading.slice(0, 5)))
      .toEqual(["G-P01", "G-P02", "G-P03", "G-P04", "G-P05", "G-P06", "G-P07", "G-P08"]);
    expect(bundled!.source_contents?.[canonicalPath]).toBe(cases);
    expect(bundled!.sources?.find(s => s.source === canonicalPath))
      .toEqual(describeKnowledgeSource(canonicalPath, cases));
    const broken = cases.replace("## G-P08 Thin", "## G-P09 Thin");
    expect(buildRecipeGeometryCaseIndex(broken)).toBeNull();
    expect(buildRecipeGeometryCaseIndex("")).toBeNull();
  });

  test("the selected case includes only the verified bounded section text and its exception", () => {
    const index = readBundledRecipeKnowledgeIndex()!;
    const suggestions = suggestRecipeKnowledge(pilotRecipe(), index, {
      feature_ids: ["joint"], max_per_feature: 1, max_token_proxy: 500,
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.feature_route).toBe("REVIEW_REQUIRED");
    const caseSection = suggestions[0]!.sections[0]!;
    expect(caseSection.heading.startsWith("G-P05 Joint Pivot")).toBe(true);
    expect(caseSection.guidance?.guidance_source_state)
      .toBe("CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF");
    expect(caseSection.guidance?.guidance_text).toContain("**Apply:**");
    expect(caseSection.guidance?.guidance_text).toContain("**Reject/defer:**");
    expect(caseSection.guidance?.guidance_text).toContain("**Proof required:**");
    expect(caseSection.guidance?.guidance_text).not.toContain("G-P07");
    expect(caseSection.guidance?.guidance_truncated).toBe(false);
    expect(compileAuthoringRecipe(pilotRecipe()).feature_plan?.state)
      .toBe("review_required");
  });

  test("missing, corrupted and altered source bytes never supply a substituted excerpt", () => {
    const real = original.sections.find(s => s.heading.startsWith("G-P05 "))!;
    const read = createRecipeKnowledgeExcerptReader(original);
    const excerpt = read(real);
    expect(excerpt?.guidance_text).toContain("joint/hinge pivot");
    const badBytes = {
      ...original,
      source_contents: { [canonicalPath]: cases.replace(
        "use the actual joint/hinge pivot.",
        "use a random center pivot."
      ) },
    };
    expect(() => suggestRecipeKnowledge(pilotRecipe(), badBytes, {
      feature_ids: ["joint"], max_per_feature: 1, max_token_proxy: 500,
    })).toThrow("RECIPE_KNOWLEDGE_SOURCE_CONTENT_STALE");
    const tamperedIndex = {
      ...original, sections: original.sections.map(s =>
        s.id === real.id ? { ...s, sha256: "0".repeat(64) } : s
      ),
    };
    expect(() => suggestRecipeKnowledge(pilotRecipe(), tamperedIndex, {
      feature_ids: ["joint"], max_per_feature: 1, max_token_proxy: 500,
    })).toThrow("RECIPE_KNOWLEDGE_SECTION_CONTENT_STALE");
    const metadataOnly = {
      sections: original.sections, sources: original.sources,
    };
    expect(suggestRecipeKnowledge(pilotRecipe(), metadataOnly, {
      feature_ids: ["joint"], max_per_feature: 1,
    })[0]?.sections[0]).not.toHaveProperty("guidance");
  });

  test("stale binding suppresses excerpts; a valid source does not authorize an unverified feature", () => {
    const selected = original.sections.find(s => s.heading.startsWith("G-P05 "))!;
    const bound = bindRecipeKnowledge(pilotRecipe(), original, [{
      feature_id: "joint", section_id: selected.id,
    }]);
    const current = reviewRecipeKnowledge(bound, original, {
      feature_ids: ["joint"], max_per_feature: 1,
    });
    expect(current.knowledge.state).toBe("CURRENT_SOURCE_SNAPSHOT");
    expect(current.suggestions[0]?.sections[0]?.guidance?.guidance_text)
      .toContain("**Reject/defer:**");
    const updated = buildRecipeGeometryCaseIndex(
      cases.replace("use the actual joint/hinge pivot.",
        "use an explicitly confirmed joint/hinge pivot.")
    )!;
    const stale = reviewRecipeKnowledge(bound, updated, {
      feature_ids: ["joint"],
    });
    expect(stale.knowledge.state).toBe("REVIEW_REQUIRED");
    expect(stale.suggestions).toEqual([]);
    expect(stale.guidance_blocked_reason)
      .toBe("RECIPE_KNOWLEDGE_LINK_REVIEW_REQUIRED");
    expect(compileAuthoringRecipe(bound).feature_plan?.state)
      .toBe("review_required");
  });

  test("watch mode tracks bundled case changes without touching the prompt generator", () => {
    expect(RUNTIME_WATCH_TARGETS.some(t =>
      t.path === "../docs/03-authoring/modelling/decision-cases.md" &&
      t.recursive === false
    )).toBe(true);
    expect(classifyWatchPath("../docs/03-authoring/modelling/decision-cases.md"))
      .toBe("rebuild");
    expect(classifyWatchPath("prompts/bedrock_entity_workflow.md"))
      .toBe("regenerate-prompts-and-rebuild");
  });
});


describe("G2 retrieval discrimination before the G3 Geometry quality benchmark", () => {
  test("curated cases require a unique feature-title match, never only broad Recipe context", () => {
    const corpus = readBundledRecipeKnowledgeIndex();
    expect(corpus).not.toBeNull();
    const examples: Array<{
      label: string;
      recipe_name: string;
      reason: "SILHOUETTE" | "MOTION" | "TECHNICAL";
      expected_case: string | null;
    }> = [
      { label: "scale cross-view depth", recipe_name: "geometry decision",
        reason: "SILHOUETTE", expected_case: "G-P01" },
      { label: "primary silhouette mass", recipe_name: "geometry decision",
        reason: "SILHOUETTE", expected_case: "G-P02" },
      { label: "protruding form surface marking", recipe_name: "geometry decision",
        reason: "SILHOUETTE", expected_case: "G-P03" },
      { label: "sloped form staircase", recipe_name: "vehicle",
        reason: "SILHOUETTE", expected_case: "G-P04" },
      { label: "joint pivot bone parenting", recipe_name: "hinge model",
        reason: "MOTION", expected_case: "G-P05" },
      { label: "negative space painted shadow", recipe_name: "geometry decision",
        reason: "SILHOUETTE", expected_case: "G-P06" },
      { label: "symmetry intentional asymmetry", recipe_name: "geometry decision",
        reason: "SILHOUETTE", expected_case: "G-P07" },
      { label: "thin plane uv compatibility", recipe_name: "geometry decision",
        reason: "TECHNICAL", expected_case: "G-P08" },
      { label: "arm pivot", recipe_name: "character",
        reason: "MOTION", expected_case: "G-P05" },
      { label: "surface cloth markings", recipe_name: "character",
        reason: "SILHOUETTE", expected_case: "G-P03" },
      { label: "red eyes glowing pattern", recipe_name: "character",
        reason: "SILHOUETTE", expected_case: null },
      { label: "dragon tail", recipe_name: "creature",
        reason: "MOTION", expected_case: null },
      { label: "geometry", recipe_name: "geometry model",
        reason: "SILHOUETTE", expected_case: null },
      { label: "form", recipe_name: "generic model",
        reason: "SILHOUETTE", expected_case: null },
    ];
    for (const example of examples) {
      const intent: AuthoringRecipe = {
        schema: 1, compiler_version: 1,
        id: "g2-discriminating-case", name: example.recipe_name,
        prototypes: [], patterns: [],
        feature_intents: [{
          id: "target", label: example.label,
          visual_role: "THREE_DIMENSIONAL",
          evidence: "PROVISIONAL",
          geometry_reasons: [example.reason],
        }],
      };
      const selected = suggestRecipeKnowledge(intent, corpus!, {
        feature_ids: ["target"], max_per_feature: 2,
        max_token_proxy: 500,
      });
      const curated = selected[0]!.sections.filter(section =>
        section.source === RECIPE_GEOMETRY_CASE_SOURCE_PATH
      );
      expect(curated.map(section => section.heading.slice(0, 5)))
        .toEqual(example.expected_case ? [example.expected_case] : []);
      expect(selected[0]?.feature_route).toBe("REVIEW_REQUIRED");
      expect(compileAuthoringRecipe(intent).feature_plan?.state)
        .toBe("review_required");
    }
  });
});


describe("R1 source-grounded Geometry alternatives before Recipe compilation", () => {
  const canonical = readFileSync(
    new URL("../../docs/03-authoring/modelling/decision-cases.md", import.meta.url),
    "utf8"
  );
  const index = buildRecipeGeometryCaseIndex(canonical)!;
  const caseSource = index.sources![0]!;

  function featureRecipe(
    label: string,
    opts: {
      role?: "THREE_DIMENSIONAL" | "SURFACE_DETAIL";
      evidence?: "SUPPORTED" | "PROVISIONAL" | "CONFLICTING";
      references?: string[];
      reasons?: Array<"MOTION" | "SILHOUETTE">;
    } = {}
  ): AuthoringRecipe {
    return {
      schema: 1, compiler_version: 1,
      id: "r1-feature", name: "R1 shape draft",
      prototypes: [], patterns: [],
      feature_intents: [{
        id: "part", label, visual_role: opts.role ?? "THREE_DIMENSIONAL",
        evidence: opts.evidence ?? "SUPPORTED",
        evidence_refs: opts.references ?? ["reference:joint-side"],
        geometry_reasons: opts.reasons ??
          (opts.role === "SURFACE_DETAIL" ? [] : ["MOTION"]),
      }],
    };
  }

  test("pinned source facts yield a bounded, explainable, non-executable geometry option", () => {
    const target = featureRecipe("joint pivot bone parenting");
    const before = structuredClone(target);
    const view = reviewRecipeKnowledge(target, index, {
      feature_ids: ["part"], max_per_feature: 1,
    });
    expect(view.geometry_proposals).toHaveLength(1);
    const proposal = view.geometry_proposals[0]!;
    expect(proposal).toMatchObject({
      feature_id: "part",
      feature_route: "GEOMETRY",
      reference_claim_ids: ["reference:joint-side"],
      verdict: "PROPOSAL_ONLY",
      mutation_authorized: false,
      visual_verdict: "NOT_EVALUATED",
      knowledge: [{
        source_sha256: caseSource.content_sha256,
        usage: "ADVISORY_ONLY",
      }],
    });
    expect(proposal.options).toHaveLength(1);
    expect(proposal.options[0]?.strategy).toBe(
      "G-P05 Joint Pivot And Bone Parenting"
    );
    expect(proposal.options[0]?.contribution).toEqual(["MOTION"]);
    expect(proposal.options[0]?.apply_when[0]).toContain("known attachment side/axis");
    expect(proposal.options[0]?.reject_when[0]).toContain("mass center");
    expect(proposal.options[0]?.recipe_guidance[1]).toContain("separate linked transform");
    expect(proposal.options[0]?.missing_evidence[0]).toContain("current approved reference");
    expect(proposal.options[0]?.visual_or_native_proof_needed[0])
      .toContain("extreme pose");
    expect(proposal.knowledge[0]?.section_id).toBe(
      index.sections.find(item => item.heading.startsWith("G-P05 "))?.id
    );
    expect(target).toEqual(before);
    // An approved THREE_DIMENSIONAL feature cannot be compiled away simply
    // because only a knowledge proposal was prepared. This is a valid
    // compiler safety gate, NOT a requirement for provisional zero Cubes.
    expect(() => compileAuthoringRecipe(target))
      .toThrow("FEATURE_GEOMETRY_UNREALIZED");
  });

  test("provisional or conflicting feature evidence never becomes Geometry authority", () => {
    for (const evidence of ["PROVISIONAL", "CONFLICTING"] as const) {
      const target = featureRecipe("joint pivot bone parenting", {
        evidence,
        references: ["unverified:view"],
      });
      const preflight = reviewRecipeKnowledge(target, index);
      expect(preflight.geometry_proposals[0]).toMatchObject({
        feature_route: "REVIEW_REQUIRED",
        reference_claim_ids: [],
        verdict: "MORE_REFERENCE_EVIDENCE_REQUIRED",
        mutation_authorized: false,
      });
      expect(preflight.geometry_proposals[0]?.options[0]?.strategy)
        .toBe("G-P05 Joint Pivot And Bone Parenting");
      expect(compileAuthoringRecipe(target).feature_plan?.state)
        .toBe("review_required");
    }
  });

  test("surface-only detail, unknown case and ambiguous generic label do not invent Geometry", () => {
    const texture = featureRecipe("surface cloth markings", {
      role: "SURFACE_DETAIL", reasons: [],
    });
    const textureView = reviewRecipeKnowledge(texture, index);
    expect(textureView.geometry_proposals).toEqual([]);
    expect(compileAuthoringRecipe(texture).feature_plan?.texture_handoff.count)
      .toBe(1);
    for (const label of ["red eyes glowing pattern", "geometry", "form"]) {
      const notGrounded = reviewRecipeKnowledge(featureRecipe(label), index);
      expect(notGrounded.geometry_proposals).toHaveLength(1);
      expect(notGrounded.geometry_proposals[0]).toMatchObject({
        options: [], knowledge: [],
        verdict: "MORE_REFERENCE_EVIDENCE_REQUIRED",
        mutation_authorized: false,
      });
    }
  });

  test("a changed source, incomplete G1 guidance or mismatched explicit binding cannot silently propose", () => {
    const original = featureRecipe("joint pivot bone parenting");
    const section = index.sections.find(item =>
      item.heading.startsWith("G-P05 "))!;
    const bound = bindRecipeKnowledge(original, index, [{
      feature_id: "part", section_id: section.id,
    }]);
    const current = reviewRecipeKnowledge(bound, index);
    expect(current.geometry_proposals[0]?.options).toHaveLength(1);
    const modified = buildRecipeGeometryCaseIndex(
      canonical.replace("use the actual joint/hinge pivot.",
        "use the current observed joint/hinge pivot.")
    )!;
    const stale = reviewRecipeKnowledge(bound, modified);
    expect(stale.knowledge.state).toBe("REVIEW_REQUIRED");
    expect(stale.suggestions).toEqual([]);
    expect(stale.geometry_proposals).toEqual([]);
    const otherLabel = featureRecipe("primary silhouette mass");
    otherLabel.knowledge_links = bound.knowledge_links;
    const pinnedOther = reviewRecipeKnowledge(otherLabel, index);
    expect(pinnedOther.geometry_proposals[0]?.options).toEqual([]);
    const incomplete = buildRecipeGeometryCaseIndex(
      canonical.replace("- **Apply:** an articulated limb, panel, wing, jaw",
        "- **Missing applicability:** an articulated limb, panel, wing, jaw")
    )!;
    const invalid = reviewRecipeKnowledge(original, incomplete);
    expect(invalid.geometry_proposals[0]?.options).toEqual([]);
    // Missing on-disk source bytes cannot be treated as a verified proposal.
    const metadataOnly = { sections: index.sections, sources: index.sources };
    expect(reviewRecipeKnowledge(original, metadataOnly)
      .geometry_proposals[0]?.options).toEqual([]);
    // Direct pure function also refuses stale explicit bindings.
    expect(proposeGeometryConstruction(bound, modified,
      stale.knowledge, current.suggestions)).toEqual([]);
  });

  test("the actual service constructs precompile guidance before planning its next Recipe", async () => {
    const base = recipe();
    const native: AuthoringRecipeNativeSnapshot = {
      schema: 1, recipe_id: base.id,
      cubes: compileAuthoringRecipe(base).placements.map((placement, i) => ({
        uuid: "native:" + i, recipe_id: base.id, instance_id: placement.id,
        name: placement.name, from: placement.from, to: placement.to,
        origin: placement.origin, rotation: placement.rotation,
        inflate: placement.inflate,
      })),
    };
    let reads = 0;
    const service = createAuthoringRecipeService({
      readOwned: () => native,
      readStoredRecipe: () => base,
      readKnowledgeIndex: () => { reads++; return index; },
      createApplyAdapter: () => {
        throw new Error("R1 proposals must not create native Undo");
      },
    });
    const report = await service.planStored(base);
    expect(reads).toBe(1);
    expect(report.recipe_knowledge?.geometry_proposals[0]?.options[0]?.strategy)
      .toBe("G-P05 Joint Pivot And Bone Parenting");
    expect(report.recipe_knowledge?.geometry_proposals[0]?.mutation_authorized)
      .toBe(false);
    expect(report.summary).toBeDefined();
    const planCount = reads;
    const broken = structuredClone(base);
    broken.prototypes[0]!.size = [-1, 12, 4];
    const orderService = createAuthoringRecipeService({
      readOwned: () => native,
      readKnowledgeIndex: () => {
        throw new Error("R1_PREFLIGHT_BEFORE_COMPILATION");
      },
      createApplyAdapter: () => {
        throw new Error("No native execution");
      },
    });
    await expect(orderService.plan(base, broken))
      .rejects.toThrow("R1_PREFLIGHT_BEFORE_COMPILATION");
    expect(reads).toBe(planCount);
  });
});


describe("G2/R1 case-first budget regression", () => {
  test("a unique G-P03 marking decision survives generic workflow words and 1-slot budget", () => {
    const index = readBundledRecipeKnowledgeIndex()!;
    const target: AuthoringRecipe = {
      schema: 1, compiler_version: 1,
      id: "g2-budget", name: "generic silhouette geometry",
      prototypes: [], patterns: [],
      feature_intents: [{
        id: "part", label: "surface cloth markings",
        visual_role: "THREE_DIMENSIONAL",
        evidence: "PROVISIONAL",
        geometry_reasons: ["SILHOUETTE"],
      }],
    };
    const selection = suggestRecipeKnowledge(target, index, {
      feature_ids: ["part"], max_per_feature: 1, max_token_proxy: 350,
    });
    expect(selection[0]?.sections.map(section => section.heading)).toEqual([
      "G-P03 Protruding Form Versus Surface Marking",
    ]);
    const review = reviewRecipeKnowledge(target, index, {
      feature_ids: ["part"], max_per_feature: 1, max_token_proxy: 350,
    });
    expect(review.geometry_proposals[0]?.options[0]?.strategy)
      .toBe("G-P03 Protruding Form Versus Surface Marking");
    expect(review.geometry_proposals[0]?.verdict)
      .toBe("MORE_REFERENCE_EVIDENCE_REQUIRED");
    expect(review.geometry_proposals[0]?.mutation_authorized).toBe(false);
    expect(suggestRecipeKnowledge(target, index, {
      feature_ids: ["part"], max_per_feature: 1, max_token_proxy: 60,
    })[0]?.sections.some(section =>
      section.source === RECIPE_GEOMETRY_CASE_SOURCE_PATH)).toBe(false);
  });
});

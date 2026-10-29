import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  bindRecipeKnowledge,
  resolveRecipeKnowledgeLinks,
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
    const unrelatedChange = snapshot(knowledge + "\\n\\n## Other rule\\nNew reference note.");
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

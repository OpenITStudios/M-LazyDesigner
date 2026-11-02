import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { AdvancedGeometryFeature } from "@/lib/authoringRecipe/geometrySchema";
import { projectRecipeFormSignatures } from "@/lib/authoringRecipe/formSignature";
import { collectRecipeKnowledge } from "@/lib/authoringRecipe/knowledgePlanning";

function recipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1, id: "form-source", name: "Form source",
    prototypes: [], patterns: [],
    feature_intents: [
      {
        id: "crest", label: "crest", visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: ["ref:front"],
        geometry_reasons: ["SILHOUETTE", "CONTACT"],
      },
      {
        id: "paint", label: "paint marks", visual_role: "SURFACE_DETAIL",
        evidence: "SUPPORTED", evidence_refs: ["ref:front"],
      },
      {
        id: "unknown", label: "unseen back", visual_role: "THREE_DIMENSIONAL",
        evidence: "UNAVAILABLE", geometry_reasons: ["VOLUME"],
      },
    ],
  };
}

const source: AdvancedGeometryFeature = {
  id: "crest", label: "crest", kind: "program",
  evidence_refs: ["ref:front"],
  geometry_reasons: ["SILHOUETTE", "CONTACT"],
  program: {
    version: 9,
    parts: [
      { id: "main", method: "BOX", at: [0, 0, 0], size: [6, 6, 4] },
      { id: "tip", method: "BOX", at: [0, 6, 0], size: [3, 2, 3] },
    ],
    anchors: [{
      kind: "ANCHOR", id: "tip-contact", source_part_id: "main",
      target_part_id: "tip", axes: ["Y"],
      source_anchor: ["CENTER", "MAX", "CENTER"],
      target_anchor: ["CENTER", "MIN", "CENTER"],
    }],
    dimension_links: [{
      id: "tip-width", target_part_id: "tip", target_axis: "X",
      source_part_id: "main", source_axis: "X",
      numerator: 1, denominator: 2,
    }],
  },
};

describe("R3y source-derived Form Signature", () => {
  test("projects only declared purposes; never hallucinates identity or variation", () => {
    const input = recipe();
    const before = structuredClone(input);
    const result = projectRecipeFormSignatures(input);
    expect(result.state).toBe("DECLARED_SOURCE_ONLY");
    expect(result.signatures.map(row => row.feature_id))
      .toEqual(["crest", "paint", "unknown"]);
    expect(result.signatures[0]).toMatchObject({
      representation: "GEOMETRY",
      declared_3d_contributions: ["SILHOUETTE", "CONTACT"],
      evidence_refs: ["ref:front"],
      design_role: "NOT_DECLARED",
      variation_policy: "NO_DECLARED_VARIATION_BOUNDS",
      parameter_source: null,
    });
    expect(result.signatures[1]?.representation).toBe("TEXTURE");
    expect(result.signatures[2]?.representation).toBe("REVIEW_REQUIRED");
    expect(result.reference_content_attested).toBe(false);
    expect(result.visual_verdict).toBe("NOT_EVALUATED");
    expect(input).toEqual(before);
  });

  test("exposes only caller-vetted parametric part/method/relationship IDs", () => {
    const input = recipe();
    const result = projectRecipeFormSignatures(input, {
      source_cohorts: [source],
      feature_ids: ["crest"],
    });
    expect(result.signatures[0]?.parameter_source).toEqual({
      kind: "program",
      parts: [
        { id: "main", method: "BOX", references: [] },
        { id: "tip", method: "BOX", references: [] },
      ],
      contract_ids: ["ANCHOR:tip-contact", "DIMENSION_LINK:tip-width"],
      omitted_contract_count: 0,
    });
    expect(result.signatures[0]?.design_role).toBe("NOT_DECLARED");
    expect(result.native_geometry_attested).toBe(false);
    // Unrelated source IDs cannot become a feature or a source attachment.
    expect(projectRecipeFormSignatures(input, {
      source_cohorts: [{ ...source, id: "not-owned" }],
      feature_ids: ["crest"],
    }).signatures[0]?.parameter_source).toBeNull();
    expect(() => projectRecipeFormSignatures(input, {
      source_cohorts: [source, source],
    })).toThrow("FORM_SIGNATURE_DUPLICATE_SOURCE_ID");
  });

  test("does not invent focus identity and bounds the response independently of model size", () => {
    const input = recipe();
    const stale = projectRecipeFormSignatures(input, {
      feature_ids: ["missing", "crest"],
    });
    expect(stale.state).toBe("FOCUS_REVIEW_REQUIRED");
    expect(stale.missing_focus_ids).toEqual(["missing"]);
    expect(stale.signatures.map(row => row.feature_id)).toEqual(["crest"]);

    input.feature_intents = Array.from({ length: 12 }, (_, index) => ({
      id: "feature-" + index, label: "Feature " + index,
      visual_role: "UNNECESSARY" as const,
      evidence: "SUPPORTED" as const,
      evidence_refs: ["ref:front"],
    }));
    const bounded = projectRecipeFormSignatures(input);
    expect(bounded.selected_feature_count).toBe(12);
    expect(bounded.signatures).toHaveLength(8);
    expect(bounded.omitted_feature_count).toBe(4);
  });

  test("Recipe planning keeps its source projection even without a knowledge index", async () => {
    const input = recipe();
    const output = await collectRecipeKnowledge(input, () => null, ["crest"]);
    expect(output?.source_state).toBe("UNAVAILABLE");
    expect(output?.form_signatures.signatures[0]).toMatchObject({
      feature_id: "crest", representation: "GEOMETRY",
      parameter_source: null,
    });
    expect(output?.form_signatures.reference_content_attested).toBe(false);
  });
});

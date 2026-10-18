/**
 * These are deterministic source-contract probes, not image/model evaluation,
 * runtime receipts, user approval or a measured improvement in authoring quality.
 * Reuse the existing visual observation + correction loop owners.
 */
import { describe, expect, test } from "bun:test";
import benchmark from "../fixtures/quality-benchmark-cases.json";
import {
  compileStructuredVisualObservation,
  type StructuredVisualObservation,
  type CompiledVisualObservation,
} from "../../lib/orchestration/visualObservation";
import {
  minecraftQualityFocus,
  prioritizeMinecraftDiscrepancies,
  type MinecraftQualityClass,
  type MinecraftQualityOwner,
  type MinecraftRepairRoute,
  type MinecraftEvidenceNeed,
} from "../../lib/orchestration/compactEvidence";
import { CorrectionLoopRegistry } from "../../lib/orchestration/correctionLoop";
import { stageReferenceSemanticFingerprint } from "../../gateway/control/contextProjection";
import { emptyReference } from "../../gateway/control/referenceParser";
import type { AuthoringRecipe } from "../../lib/authoringRecipe/contracts";

type ProbeExpected =
  | {
      state: "UNVERIFIED";
      reason: Extract<CompiledVisualObservation, { state: "UNVERIFIED" }>["reason"];
    }
  | {
      state: "SUPPORTED";
      owner: MinecraftQualityOwner;
      quality_class: MinecraftQualityClass;
      repair_route: MinecraftRepairRoute;
      evidence_action?: NonNullable<MinecraftEvidenceNeed>["action"];
    };

const probes = benchmark.decision_probes.cases;
function byId(id: string) {
  const probe = probes.find((entry) => entry.id === id);
  if (!probe) throw new Error("Missing R07 decision probe: " + id);
  return probe;
}
function observe(id: string) {
  return compileStructuredVisualObservation(
    byId(id).observation as unknown as StructuredVisualObservation
  );
}
function geometryRecipe(): AuthoringRecipe {
  return {
    schema: 1,
    compiler_version: 1,
    id: "r07-fixture",
    name: "R07 fixture",
    prototypes: [{ id: "segment", name: "segment", size: [4, 8, 4], semantic_group: "segment" }],
    patterns: [{
      kind: "LINEAR", id: "segments", prototype_id: "segment",
      count: 2, axis: "X", spacing: 8, semantic_group: "segment",
    }],
  };
}

describe("R07 decision probes on existing evidence and correction owners", () => {
  test("all authoring scenarios route only from evidence-backed owner/cause", () => {
    for (const probe of probes) {
      const observed = compileStructuredVisualObservation(
        probe.observation as unknown as StructuredVisualObservation
      );
      const expected = probe.expected as unknown as ProbeExpected;
      expect(observed.state).toBe(expected.state);
      if (observed.state === "UNVERIFIED") {
        if (expected.state !== "UNVERIFIED") throw new Error(`R07 fixture ${probe.id} expects unsupported output`);
        expect(observed.reason).toBe(expected.reason);
        expect(observed.discrepancy).toBeNull();
        continue;
      }
      if (expected.state !== "SUPPORTED") throw new Error(`R07 fixture ${probe.id} expects supported output`);
      const focus = minecraftQualityFocus([observed.discrepancy]);
      expect(focus).not.toBeNull();
      expect(focus?.owner).toBe(expected.owner);
      expect(focus?.quality_class).toBe(expected.quality_class);
      expect(focus?.repair_route).toBe(expected.repair_route);
      if (expected.evidence_action) {
        expect(focus?.evidence_backed_cause).toBe(false);
        expect(focus?.evidence_need?.action).toBe(expected.evidence_action);
      } else {
        expect(focus?.evidence_backed_cause).toBe(true);
      }
    }
  });

  test("a blocking primary-form mismatch precedes secondary detail and material expansion", () => {
    const primary = observe("r07-character-primary-helmet");
    const material = observe("r07-vehicle-color-only-variant");
    expect(primary.state).toBe("SUPPORTED");
    expect(material.state).toBe("SUPPORTED");
    if (primary.state !== "SUPPORTED" || material.state !== "SUPPORTED") return;
    const secondary = {
      code: "ORNAMENT_MINOR", severity: "REVIEW" as const,
      summary: "Secondary trim is small.",
      quality_class: "SECONDARY_DETAIL" as const, owner: "GEOMETRY" as const,
    };
    const ranked = prioritizeMinecraftDiscrepancies([
      secondary, material.discrepancy, primary.discrepancy,
    ]);
    expect(ranked[0]?.code).toBe("HELMET_SILHOUETTE");
    expect(minecraftQualityFocus(ranked)?.repair_route).toBe("RESIZE");
  });

  test("a missing source view never enters the existing correction loop as a guessed fix", () => {
    const registry = new CorrectionLoopRegistry();
    const referenceMissing = byId("r07-flower-missing-reference-view");
    const input = {
      recipe_id: "r07-fixture",
      base_recipe: geometryRecipe(),
      verification_request: {
        domain: "GEOMETRY" as const,
        source: "capture_model_views" as const,
        verification_risk: "LOW" as const,
        views: ["front" as const],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS" as const,
        size: 256 as const,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS" as const,
        scope_instance_ids: ["segments:0"],
      },
      verification_evidence_handle: "verificationevidence:r07-fixture" as const,
    };
    const missing = registry.startFromObservations({
      ...input,
      observations: [referenceMissing.observation as unknown as StructuredVisualObservation],
    });
    expect(missing.handle).toBeNull();
    expect(missing.unverified).toEqual([
      { code: "FLOWER_DEPTH_UNKNOWN", reason: "REFERENCE_EVIDENCE_REQUIRED" },
    ]);

    const supported = registry.startFromObservations({
      ...input,
      observations: [
        byId("r07-character-primary-helmet").observation as unknown as StructuredVisualObservation,
        referenceMissing.observation as unknown as StructuredVisualObservation,
      ],
    });
    expect(supported.handle).not.toBeNull();
    expect(supported.unverified).toEqual([
      { code: "FLOWER_DEPTH_UNKNOWN", reason: "REFERENCE_EVIDENCE_REQUIRED" },
    ]);
    expect(registry.projectContinuation(supported.handle!).unresolved.map((item) => item.code))
      .toEqual(["HELMET_SILHOUETTE"]);
  });

  test("a color/material-only variant changes texture-stage facts, not Geometry authority", () => {
    const reference = emptyReference("REFERENCE_PATH_UNAVAILABLE");
    reference.available = true;
    reference.asset_name = "Vehicle fixture";
    reference.asset_kind = "MODEL";
    reference.intent = "Reuse same geometry for another paint color";
    reference.selected_profile = "VEHICLE";
    reference.semantic_facts = {
      parts: [{ id: "body", role: "GEOMETRY", evidence: "SUPPORTED" }],
      articulation: [],
      materials: [{ id: "paint", base_color: "red", affected_parts: ["body"] }],
      animation_guidance: [],
      constraints: [],
    };
    const changed = {
      ...reference,
      semantic_facts: {
        ...reference.semantic_facts,
        materials: [{ id: "paint", base_color: "blue", affected_parts: ["body"] }],
      },
    };
    expect(stageReferenceSemanticFingerprint("GEOMETRY", changed))
      .toBe(stageReferenceSemanticFingerprint("GEOMETRY", reference));
    expect(stageReferenceSemanticFingerprint("TEXTURING", changed))
      .not.toBe(stageReferenceSemanticFingerprint("TEXTURING", reference));
  });
});

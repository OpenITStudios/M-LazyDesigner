import { describe, expect, test } from "bun:test";
import {
  compileStructuredVisualObservation,
  compileStructuredVisualObservations,
} from "@/lib/orchestration/visualObservation";

describe("structured visual observation compiler", () => {
  test("geometry silhouette observation becomes an owned discrepancy without cause inference", () => {
    const result = compileStructuredVisualObservation({
      code: "TORSO_TOO_WIDE",
      criterion: "SILHOUETTE_PROPORTION",
      severity: "REVIEW",
      summary: "Torso reads materially wider than the approved front view.",
      evidence: {
        current_evidence_ref: "visual:model:front:rev2",
        reference_evidence_ref: "IMG_GEO_FRONT",
        views: ["front"],
        evidence_targets: ["width", "silhouette"],
      },
    });
    expect(result).toEqual({
      state: "SUPPORTED",
      discrepancy: {
        code: "TORSO_TOO_WIDE",
        severity: "REVIEW",
        summary: "Torso reads materially wider than the approved front view.",
        quality_class: "PRIMARY_FORM",
        owner: "GEOMETRY",
        views: ["front"],
        evidence_targets: ["width", "silhouette"],
      },
    });
  });

  test("reference-dependent visual claims fail closed without approved reference evidence", () => {
    const result = compileStructuredVisualObservation({
      code: "MARKING_WRONG",
      criterion: "TEXTURE_IDENTITY_MARKING",
      severity: "REVIEW",
      summary: "Chest marking differs.",
      evidence: {
        current_evidence_ref: "texture:region:rev4",
      },
    });
    expect(result).toEqual({
      state: "UNVERIFIED",
      discrepancy: null,
      reason: "REFERENCE_EVIDENCE_REQUIRED",
    });
  });

  test("runtime contact evidence can support animation contact without a visual reference image", () => {
    const result = compileStructuredVisualObservation({
      code: "FOOT_SLIDE",
      criterion: "ANIMATION_CONTACT",
      severity: "BLOCKING",
      summary: "Planted foot drifts beyond the supported contact tolerance.",
      evidence: {
        current_evidence_ref: "contact:left_foot:rev8",
        views: ["left"],
      },
      cause_family: "MOTION_MISMATCH",
    });
    expect(result.state).toBe("SUPPORTED");
    if (result.state !== "SUPPORTED") throw new Error("expected supported");
    expect(result.discrepancy).toMatchObject({
      quality_class: "ANIMATION_MOTION",
      owner: "ANIMATION",
      cause_family: "MOTION_MISMATCH",
    });
  });

  test("cause family is rejected when it contradicts explicit criterion ownership", () => {
    const result = compileStructuredVisualObservation({
      code: "BAD_CAUSE",
      criterion: "TEXTURE_MATERIAL_REGION",
      severity: "REVIEW",
      summary: "Material region differs from reference.",
      evidence: {
        current_evidence_ref: "texture:rev2",
        reference_evidence_ref: "IMG_TEX_01",
      },
      cause_family: "SIZE_MISMATCH",
    });
    expect(result).toEqual({
      state: "UNVERIFIED",
      discrepancy: null,
      reason: "OBSERVATION_INVALID",
    });
  });


  test("unrecognized visual metadata fails closed before entering priority or correction routing", () => {
    const valid = {
      code: "WIDTH_BLOCKING",
      criterion: "SILHOUETTE_PROPORTION" as const,
      severity: "BLOCKING" as const,
      summary: "The primary silhouette is wider than the reviewed reference.",
      evidence: {
        current_evidence_ref: "capture:front:current",
        reference_evidence_ref: "reference:front",
        views: ["front" as const],
        evidence_targets: ["silhouette" as const],
      },
      cause_family: "SIZE_MISMATCH" as const,
    };
    const invalid: unknown[] = [
      { ...valid, criterion: "__proto__" },
      { ...valid, severity: "CRITICAL" },
      { ...valid, cause_family: "INVENTED_GEOMETRY_CAUSE" },
      { ...valid, evidence: { ...valid.evidence, views: ["mirrored_front"] } },
      { ...valid, evidence: { ...valid.evidence, evidence_targets: ["impossible_target"] } },
      { ...valid, evidence: null },
    ];
    for (const observation of invalid) {
      expect(compileStructuredVisualObservation(
        observation as Parameters<typeof compileStructuredVisualObservation>[0]
      )).toEqual({
        state: "UNVERIFIED",
        discrepancy: null,
        reason: "OBSERVATION_INVALID",
      });
    }
    expect(compileStructuredVisualObservation(valid)).toMatchObject({
      state: "SUPPORTED",
      discrepancy: {
        severity: "BLOCKING",
        cause_family: "SIZE_MISMATCH",
        views: ["front"],
        evidence_targets: ["silhouette"],
      },
    });
  });

  test("invalid review metadata cannot poison independent supported visual observations", () => {
    const valid = {
      code: "CAPE_CONTACT",
      criterion: "ANIMATION_CONTACT" as const,
      severity: "REVIEW" as const,
      summary: "Cape attachment moves away from its intended contact point.",
      evidence: {
        current_evidence_ref: "contact:clip:current",
        views: ["left" as const],
      },
      cause_family: "MOTION_MISMATCH" as const,
    };
    const compiled = compileStructuredVisualObservations([
      {
        ...valid,
        code: "BAD_VIEW",
        evidence: { ...valid.evidence, views: ["unknown_view" as "left"] },
      },
      valid,
    ]);
    expect(compiled.supported.map((item) => item.code)).toEqual(["CAPE_CONTACT"]);
    expect(compiled.unverified).toEqual([
      { code: "BAD_VIEW", reason: "OBSERVATION_INVALID" },
    ]);
  });

  test("conflicting duplicate codes cannot select different correction owners", () => {
    const result = compileStructuredVisualObservations([
      {
        code: "FORM_MISMATCH",
        criterion: "SILHOUETTE_PROPORTION",
        severity: "BLOCKING",
        summary: "Torso proportions differ.",
        evidence: {
          current_evidence_ref: "model:front:1",
          reference_evidence_ref: "ref:front",
          views: ["front"],
        },
      },
      {
        code: " FORM_MISMATCH ",
        criterion: "TEXTURE_MATERIAL_REGION",
        severity: "REVIEW",
        summary: "Different material.",
        evidence: {
          current_evidence_ref: "model:front:1",
          reference_evidence_ref: "ref:front",
          views: ["front"],
        },
      },
    ]);
    expect(result.supported).toEqual([]);
    expect(result.unverified).toEqual([
      { code: "FORM_MISMATCH", reason: "OBSERVATION_INVALID" },
      { code: "FORM_MISMATCH", reason: "OBSERVATION_INVALID" },
    ]);
  });

  test("ambiguous codes are excluded without discarding independent valid claims", () => {
    const base = {
      code: "A",
      criterion: "SILHOUETTE_PROPORTION" as const,
      severity: "REVIEW" as const,
      summary: "A discrepancy.",
      evidence: {
        current_evidence_ref: "model:front:1",
        reference_evidence_ref: "ref:front",
        views: ["front" as const],
      },
    };
    const result = compileStructuredVisualObservations([
      base,
      { ...base, code: " A ", summary: "Second conflicting claim." },
      { ...base, code: "B", summary: "Independent valid claim." },
    ]);
    expect(result.supported.map((item) => item.code)).toEqual(["B"]);
    expect(result.unverified).toEqual([
      { code: "A", reason: "OBSERVATION_INVALID" },
      { code: "A", reason: "OBSERVATION_INVALID" },
    ]);
  });

  test("batch compilation separates supported observations from unverified claims", () => {
    const result = compileStructuredVisualObservations([
      {
        code: "A",
        criterion: "TOPOLOGY_ATTACHMENT",
        severity: "BLOCKING",
        summary: "Basket floats behind torso.",
        evidence: {
          current_evidence_ref: "visual:left:2",
          reference_evidence_ref: "IMG_SIDE",
          views: ["left"],
          evidence_targets: ["attachment"],
        },
        cause_family: "WRONG_ATTACHMENT",
      },
      {
        code: "B",
        criterion: "ANIMATION_WEIGHT_TRANSFER",
        severity: "REVIEW",
        summary: "Weight transfer is not yet grounded.",
        evidence: {
          current_evidence_ref: "playback:clip:4",
        },
      },
    ]);
    expect(result.supported).toHaveLength(1);
    expect(result.supported[0]).toMatchObject({
      code: "A",
      owner: "GEOMETRY",
      quality_class: "TOPOLOGY_ATTACHMENT",
      cause_family: "WRONG_ATTACHMENT",
    });
    expect(result.unverified).toEqual([
      { code: "B", reason: "REFERENCE_EVIDENCE_REQUIRED" },
    ]);
  });
});

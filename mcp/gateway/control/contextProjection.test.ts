import { describe, expect, test } from "bun:test";
import {
  buildControlStageContext,
  decisionPacketForAuthoringDomain,
  semanticFactsForAuthoringDomain,
  stageReferenceSemanticFingerprint,
} from "./contextProjection";
import {
  projectControlStageContextWithHeadroom,
  serializedUtf8Bytes,
} from "./contextHeadroom";
import type { ControlReferenceProjection } from "./referenceTypes";
import { parseReferencePackage } from "./referenceParser";
import type { ControlWorkspaceProjection } from "./workspace";

const workspace: ControlWorkspaceProjection = {
  available: true,
  source_path: null,
  fingerprint: "workspace|one",
  asset: "Deer",
  current_stage: "Geometry",
  gates: {
    geometry: "IN_PROGRESS",
    uv_layout: "NOT_STARTED",
    texturing: "NOT_STARTED",
    animation: "NOT_STARTED",
  },
  next_step: "refine silhouette",
  blockers: [],
};

const reference: ControlReferenceProjection = {
  available: true,
  source_path: null,
  package_root: null,
  fingerprint: "reference|whole",
  schema: "lazydesigner-reference-v1",
  asset_name: "Deer",
  asset_kind: "MODEL",
  intent: "build a Minecraft Bedrock deer",
  selected_profile: "CREATURE",
  requirements: {
    dimensions_blocks: { width: 1.2, height: 1.8, length: 2.1 },
    player_relative_scale: "PLAYER_HEIGHT",
    animation_required: true,
  },
  readiness: {
    overall: "READY",
    geometry: "READY",
    texture: "READY",
    animation: "READY",
  },
  particle: null,
  blocking_unknowns: [],
  non_blocking_unknowns: ["underside tail color"],
  documents: {
    GEOMETRY: "GEOMETRY.md",
    TEXTURE: "TEXTURE.md",
    ANIMATION: "ANIMATION.md",
  },
  images: [
    {
      id: "geo-main",
      file: "geo.png",
      role: "PRIMARY_GEOMETRY",
      used_by: ["GEOMETRY"],
      status: "APPROVED",
    },
    {
      id: "tex-main",
      file: "tex.png",
      role: "MATERIAL_TEXTURE",
      used_by: ["TEXTURE"],
      status: "APPROVED",
    },
  ],
  semantic_facts: {
    parts: [
      {
        id: "torso",
        role: "GEOMETRY",
        motion: "STATIC",
        evidence: "SUPPORTED",
        tutorial_note: "verbose source-only prose should not reach Codex",
      },
      {
        id: "front_leg",
        role: "GEOMETRY",
        parent: "torso",
        motion: "ARTICULATED",
        evidence: "SUPPORTED",
        uv_cohort: "limb",
        uv_identity_priority: "LOW",
        uv_reuse_policy: "ALLOW_REUSE",
        uv_density_multiplier: 1,
        implementation_hint: "do not expose as a decision field",
      },
      {
        id: "blink",
        role: "ANIMATION_ONLY",
        motion: "ARTICULATED",
        evidence: "SUPPORTED",
        uv_cohort: "limb",
        uv_identity_priority: "LOW",
        uv_reuse_policy: "ALLOW_REUSE",
        uv_density_multiplier: 1,
      },
      {
        id: "coat_marking",
        role: "TEXTURE",
        motion: "STATIC",
        evidence: "SUPPORTED",
      },
    ],
    articulation: [
      {
        id: "front_leg_joint",
        parent: "torso",
        child: "front_leg",
        pivot_region: "shoulder",
        preferred_axis: "X",
        bend_direction: "forward",
        rotation_min: -15,
        rotation_max: 65,
        twist_policy: "LIMITED",
        contact_invariant: "shoulder remains visually closed",
        risk: "joint gap",
        prose_note: "not decision-critical",
      },
    ],
    materials: [
      {
        id: "coat",
        base_color: "brown",
        affected_parts: ["torso", "front_leg"],
        unrelated_note: "omit",
      },
    ],
    animation_guidance: [
      {
        name: "walk",
        type: "LOOP",
        participants: ["front_leg"],
        key_poses: ["contact", "passing"],
        prose_note: "omit",
      },
    ],
    constraints: ["preserve slender leg silhouette"],
  },
};

describe("Control stage semantic projection", () => {
  test("projects only decision-critical facts for the active authoring owner", () => {
    const geometry = semanticFactsForAuthoringDomain("GEOMETRY", reference);
    const texture = semanticFactsForAuthoringDomain("TEXTURING", reference);
    const animation = semanticFactsForAuthoringDomain("ANIMATION", reference);

    expect(geometry.parts.map((part) => part.id)).toEqual([
      "torso",
      "front_leg",
    ]);
    expect(geometry.articulation).toHaveLength(1);
    expect(geometry.materials).toEqual([]);
    expect(geometry.animation_guidance).toEqual([]);

    expect(texture.parts).toEqual([]);
    expect(texture.articulation).toEqual([]);
    expect(texture.materials).toHaveLength(1);
    expect(texture.animation_guidance).toEqual([]);

    expect(animation.parts.map((part) => part.id)).toEqual([
      "front_leg",
      "blink",
    ]);
    expect(animation.articulation).toHaveLength(1);
    expect(animation.materials).toEqual([]);
    expect(animation.animation_guidance).toHaveLength(1);
  });

  test("decision packet keeps Minecraft modelling decisions and removes source-only noise", () => {
    const geometry = decisionPacketForAuthoringDomain("GEOMETRY", reference);
    const texture = decisionPacketForAuthoringDomain("TEXTURING", reference);
    const animation = decisionPacketForAuthoringDomain("ANIMATION", reference);

    expect(geometry.parts).toEqual([
      {
        id: "torso",
        role: "GEOMETRY",
        motion: "STATIC",
        evidence: "SUPPORTED",
      },
      {
        id: "front_leg",
        role: "GEOMETRY",
        parent: "torso",
        motion: "ARTICULATED",
        evidence: "SUPPORTED",
        uv_cohort: "limb", uv_density_multiplier: 1,
        uv_identity_priority: "LOW", uv_reuse_policy: "ALLOW_REUSE",
      },
    ]);
    expect(geometry.articulation?.[0]).toEqual({
      id: "front_leg_joint",
      parent: "torso",
      child: "front_leg",
      pivot_region: "shoulder",
      preferred_axis: "X",
      bend_direction: "forward",
      rotation_min: -15,
      rotation_max: 65,
      twist_policy: "LIMITED",
      contact_invariant: "shoulder remains visually closed",
      risk: "joint gap",
    });
    expect(texture.materials?.[0]).toEqual({
      id: "coat",
      base_color: "brown",
      affected_parts: ["torso", "front_leg"],
    });
    expect(animation.motion?.[0]).toEqual({
      name: "walk",
      type: "LOOP",
      participants: ["front_leg"],
      key_poses: ["contact", "passing"],
    });
  });

  test("geometry fingerprint ignores texture-only fact changes", () => {
    const base = stageReferenceSemanticFingerprint("GEOMETRY", reference);
    const textureChanged: ControlReferenceProjection = {
      ...reference,
      fingerprint: "reference|texture-change",
      semantic_facts: {
        ...reference.semantic_facts!,
        materials: [
          {
            id: "coat",
            base_color: "dark brown",
            affected_parts: ["torso", "front_leg"],
          },
        ],
      },
    };

    expect(
      stageReferenceSemanticFingerprint("GEOMETRY", textureChanged)
    ).toBe(base);
    expect(
      stageReferenceSemanticFingerprint("TEXTURING", textureChanged)
    ).not.toBe(stageReferenceSemanticFingerprint("TEXTURING", reference));
  });

  test("geometry fingerprint changes for geometry facts and active image authority", () => {
    const base = stageReferenceSemanticFingerprint("GEOMETRY", reference);
    const partChanged: ControlReferenceProjection = {
      ...reference,
      semantic_facts: {
        ...reference.semantic_facts!,
        parts: reference.semantic_facts!.parts.map((part) =>
          part.id === "front_leg"
            ? { ...part, evidence: "CONFLICTING" }
            : part
        ),
      },
    };
    const imageChanged: ControlReferenceProjection = {
      ...reference,
      images: reference.images.map((image) =>
        image.id === "geo-main"
          ? { ...image, file: "geo-v2.png" }
          : image
      ),
    };

    expect(
      stageReferenceSemanticFingerprint("GEOMETRY", partChanged)
    ).not.toBe(base);
    expect(
      stageReferenceSemanticFingerprint("GEOMETRY", imageChanged)
    ).not.toBe(base);
  });

  test("actual 25th source part is recoverable from canonical revision instead of being invented", () => {
    const doc = {
      schema: "lazydesigner-reference-v1",
      asset: { name: "Large model", kind: "MODEL" },
      parts: Array.from({ length: 25 }, (_, i) => ({
        id: `part_${i}`, role: "GEOMETRY", importance: i === 24 ? "CRITICAL" : "NORMAL",
      })),
    };
    const parsed = parseReferencePackage(JSON.stringify(doc), "/pkg/REFERENCE.json", "/pkg");
    expect(parsed?.semantic_facts?.parts).toHaveLength(24);
    const stage = buildControlStageContext({
      domain: "GEOMETRY", reference: parsed!, workspace,
    });
    expect(stage.reference_recovery).toEqual({
      source_path: "/pkg/REFERENCE.json", omitted_sections: ["parts"],
    });
    expect(stage.decision_packet.parts?.some((part) => part.id === "part_24")).toBe(false);
    const changedDoc = {
      ...doc,
      parts: doc.parts.map((part, i) =>
        i === 24 ? { ...part, importance: "CHANGED" } : part
      ),
    };
    const changed = parseReferencePackage(JSON.stringify(changedDoc), "/pkg/REFERENCE.json", "/pkg");
    expect(changed?.semantic_facts?.parts).toEqual(parsed?.semantic_facts?.parts);
    expect(stageReferenceSemanticFingerprint("GEOMETRY", changed!))
      .not.toBe(stageReferenceSemanticFingerprint("GEOMETRY", parsed!));
  });

  test("omitted future-stage material facts do not block Geometry or alter its context identity", () => {
    const baseline = stageReferenceSemanticFingerprint("GEOMETRY", reference);
    const unrelated = {
      ...reference,
      fingerprint: "source|new-material-tail",
      truncated_sections: ["materials"] as NonNullable<ControlReferenceProjection["truncated_sections"]>,
    };
    expect(stageReferenceSemanticFingerprint("GEOMETRY", unrelated)).toBe(baseline);
    const geometry = buildControlStageContext({ domain: "GEOMETRY", reference: unrelated, workspace });
    expect(geometry.reference_recovery).toBeUndefined();
    const texturing = buildControlStageContext({ domain: "TEXTURING", reference: unrelated, workspace });
    expect(texturing.reference_recovery?.omitted_sections).toEqual(["materials"]);
  });

  test("omitted current-stage facts preserve recovery provenance and invalidate stage identity", () => {
    const incomplete = {
      ...reference,
      source_path: "/test/REFERENCE.json",
      fingerprint: "source|original",
      truncated_sections: ["parts", "materials"] as NonNullable<ControlReferenceProjection["truncated_sections"]>,
    };
    const changed = { ...incomplete, fingerprint: "source|updated-tail" };
    expect(stageReferenceSemanticFingerprint("GEOMETRY", incomplete))
      .not.toBe(stageReferenceSemanticFingerprint("GEOMETRY", changed));
    const geometry = buildControlStageContext({ domain: "GEOMETRY", reference: incomplete, workspace });
    expect(geometry.reference_recovery).toEqual({
      source_path: "/test/REFERENCE.json", omitted_sections: ["parts"],
    });
    const projected = projectControlStageContextWithHeadroom(geometry, 1);
    expect(projected.context.reference_recovery).toEqual(geometry.reference_recovery);
  });


  test("Texture stage projects bounded image+region source hints without inventing face ownership", () => {
    const source: ControlReferenceProjection = {
      ...reference,
      images: [{
        id: "tex-main", file: "tex.png", role: "MATERIAL_TEXTURE",
        used_by: ["TEXTURE"], status: "APPROVED",
        view: "front", integrity: "VERIFIED",
        sha256: "a".repeat(64),
        regions: Array.from({ length: 9 }, (_, i) => ({
          id: "mark_" + i, part_id: "coat_marking",
          evidence_role: "SURFACE_DETAIL" as const,
          visibility: "DIRECT" as const,
          box_uv: [0.2, 0.2, 0.6, 0.5] as [number, number, number, number],
          related_part_id: null,
        })),
      }],
    };
    const texture = buildControlStageContext({
      domain: "TEXTURING", reference: source, workspace,
    });
    const summary = texture.decision_packet.texture_surface_regions;
    expect(summary).toMatchObject({
      source_state: "PACKAGE_METADATA_ONLY",
      total_count: 9, returned_count: 6, omitted_count: 3,
      visual_verdict: "not_evaluated",
      regions: [{
        image_id: "tex-main", image_sha256: "a".repeat(64),
        view: "front", part_id: "coat_marking", image_region_id: "mark_0",
      }],
    });
    expect(JSON.stringify(summary)).not.toContain("cube_uuid");
    // Earlier source order previously filled every slot with one material
    // part; now an independently observed side-view material must survive
    // even when the first source image has many annotations.
    const diversified: ControlReferenceProjection = {
      ...source,
      images: [
        ...source.images,
        {
          id: "tex-side", file: "tex-side.png", role: "MATERIAL_TEXTURE",
          used_by: ["TEXTURE"], status: "APPROVED",
          integrity: "VERIFIED", view: "left", sha256: "c".repeat(64),
          regions: [{
            id: "side-emblem", part_id: "arm_emblem",
            evidence_role: "SURFACE_DETAIL", visibility: "DIRECT",
            box_uv: [0.1, 0.2, 0.4, 0.6], related_part_id: null,
          }],
        },
      ],
    };
    const balanced = decisionPacketForAuthoringDomain("TEXTURING", diversified)
      .texture_surface_regions!;
    expect(balanced).toMatchObject({
      source_state: "PACKAGE_METADATA_ONLY",
      total_count: 10, returned_count: 6, omitted_count: 4,
      visual_verdict: "not_evaluated",
    });
    expect(balanced.regions.map((row) => row.image_id)).toContain("tex-side");
    expect(balanced.regions.map((row) => row.part_id)).toContain("arm_emblem");
    expect(balanced.regions[0]?.image_region_id).toBe("mark_0");
    expect(JSON.stringify(balanced)).not.toContain("cube_uuid");
    // Source bbox pixels are explicitly not mapped Atlas UV or paint targets.
    expect(balanced.regions.find((row) => row.part_id === "arm_emblem")?.box_uv)
      .toEqual([0.1, 0.2, 0.4, 0.6]);


    expect(buildControlStageContext({
      domain: "GEOMETRY", reference: source, workspace,
    }).decision_packet.texture_surface_regions).toBeUndefined();
    const projected = projectControlStageContextWithHeadroom(texture, 16384);
    expect(projected.context.decision_packet?.texture_surface_regions?.omitted_count).toBe(3);

    const revised: ControlReferenceProjection = {
      ...source,
      images: source.images.map(image => ({
        ...image, sha256: "b".repeat(64),
      })),
    };
    const next = buildControlStageContext({
      domain: "TEXTURING", reference: revised, workspace,
    });
    expect(next.context_hash).not.toBe(texture.context_hash);
    expect(next.decision_packet.texture_surface_regions?.regions[0]?.image_sha256)
      .toBe("b".repeat(64));

    for (const change of [
      { status: "DRAFT" },
      { integrity: "INVALID" as const },
      { view: null },
      { used_by: ["GEOMETRY"] as Array<"GEOMETRY" | "TEXTURE"> },
    ]) {
      const untrusted: ControlReferenceProjection = {
        ...source, images: source.images.map(image => ({ ...image, ...change })),
      };
      expect(decisionPacketForAuthoringDomain("TEXTURING", untrusted)
        .texture_surface_regions).toBeUndefined();
    }
  });

  test("stage context carries internal facts plus the compact Codex decision packet", () => {
    const context = buildControlStageContext({
      domain: "GEOMETRY",
      reference,
      workspace,
      currentUserDelta: "make the legs slightly longer",
    });

    expect(context.semantic_facts.parts.map((part) => part.id)).toEqual([
      "torso",
      "front_leg",
    ]);
    expect(context.semantic_facts.materials).toEqual([]);
    expect(context.decision_packet.parts?.map((part) => part.id)).toEqual([
      "torso",
      "front_leg",
    ]);
    expect(context.asset_health).toMatchObject({
      overall: "REVIEW",
      stages: {
        reference: "PASS",
        geometry: "REVIEW",
        uv_layout: "UNVERIFIED",
        texturing: "UNVERIFIED",
        animation: "UNVERIFIED",
      },
    });
    expect(context.reference_image_ids).toEqual(["geo-main"]);
    expect(context.current_user_delta).toBe(
      "make the legs slightly longer"
    );
  });

  test("R07 latest correction survives stage and size-limited projection without inventing a new authority", () => {
    const correction = "fall before breaking; keep the cape attached through impact";
    for (const domain of ["GEOMETRY", "TEXTURING", "ANIMATION"] as const) {
      const context = buildControlStageContext({
        domain, reference, workspace, currentUserDelta: correction,
      });
      const projected = projectControlStageContextWithHeadroom(context, 64);
      expect(projected.context.original_user_intent).toBe(reference.intent);
      expect(projected.context.current_user_delta).toBe(correction);
      expect(projected.context.reference_package_id_or_hash).toBe(reference.fingerprint);
      expect(projected.context.headroom_state).toBe("REQUIRED_OVER_BUDGET");
      expect("semantic_facts" in projected.context).toBe(false);
      const oldDecision = buildControlStageContext({
        domain, reference, workspace, currentUserDelta: "break before falling",
      });
      expect(context.context_hash).not.toBe(oldDecision.context_hash);
    }
  });

  test("Gateway projection exposes compact decisions without retransmitting raw semantic facts", () => {
    const context = buildControlStageContext({
      domain: "GEOMETRY",
      reference,
      workspace,
    });
    const projected = projectControlStageContextWithHeadroom(context, 8192);

    expect(projected.context.decision_packet?.parts?.map((part) => part.id)).toEqual([
      "torso",
      "front_leg",
    ]);
    expect("semantic_facts" in projected.context).toBe(false);
    expect(
      serializedUtf8Bytes(projected.context.decision_packet)
    ).toBeLessThan(serializedUtf8Bytes(context.semantic_facts));
  });

  test("quality-critical decisions survive proxy headroom pressure", () => {
    const context = buildControlStageContext({
      domain: "GEOMETRY",
      reference,
      workspace,
    });
    const projected = projectControlStageContextWithHeadroom(context, 64);

    expect(projected.context.decision_packet?.parts?.[1]).toMatchObject({
      id: "front_leg",
      parent: "torso",
      motion: "ARTICULATED",
    });
    expect(projected.diagnostics.required_over_budget).toBe(true);
    expect(projected.context.headroom_state).toBe("REQUIRED_OVER_BUDGET");
  });
});

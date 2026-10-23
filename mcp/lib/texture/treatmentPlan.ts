import {
  inspectEntityRenderMaterialCode,
  minecraftMaterialCodeForRenderProfile,
  type EntityRenderProfile,
} from "./renderProfile";
import {
  getTextureSurfacePatternRecipe,
  type TextureSurfacePattern,
} from "./surfacePattern";

export type TextureTreatmentEvidenceState = "observed" | "inferred" | "unknown";
export type TextureTreatmentPbrIntent =
  | "none"
  | "optional"
  | "normal"
  | "height"
  | "mer"
  | "mers";

export type TextureTreatmentFace = {
  cube_uuid: string;
  face: "north" | "south" | "east" | "west" | "up" | "down";
};
export type TextureFaceTreatment = TextureTreatmentFace & {
  // PAINT is a future operation, never an artistic styling PASS.
  treatment: "PAINT" | "INTENTIONAL_FLAT" | "INTENTIONAL_TRANSPARENT" | "SHARED";
  shared_with?: TextureTreatmentFace;
};

function faceId(face: TextureTreatmentFace): string {
  if (!face.cube_uuid.trim() ||
      !["north", "south", "east", "west", "up", "down"].includes(face.face)) {
    throw new Error("Texture face targets require a Cube UUID and valid local face direction.");
  }
  return face.cube_uuid + ":" + face.face;
}

export type TextureTreatmentRegionInput = {
  region: string;
  evidence: TextureTreatmentEvidenceState;
  surface_pattern?: TextureSurfacePattern | null;
  render_profile?: EntityRenderProfile | null;
  minecraft_material_code?: string | null;
  pbr_intent?: TextureTreatmentPbrIntent;
  identity_colors?: readonly string[];
  notes?: readonly string[];
  face_targets?: readonly TextureFaceTreatment[];
};

export type TextureTreatmentPlanInput = {
  identity_colors?: readonly string[];
  regions: readonly TextureTreatmentRegionInput[];
  /** Explicit complete scope for this bounded treatment task; never inferred from a sample. */
  required_faces?: readonly TextureTreatmentFace[];
};

export function planTextureTreatment(input: TextureTreatmentPlanInput) {
  if (!input.regions.length) {
    throw new Error("Texture treatment planning requires at least one region.");
  }
  const seen = new Set<string>();
  const unresolved: Array<{ region: string; reason: string }> = [];
  const expected = input.required_faces
    ? new Map(input.required_faces.map((face) => [faceId(face), face]))
    : null;
  if (expected && expected.size !== input.required_faces!.length) {
    throw new Error("Texture required face inventory contains duplicate Cube/face identities.");
  }
  const assigned = new Map<string, { region: string; treatment: TextureFaceTreatment }>();
  let missingInventory = false;

  const regions = input.regions.map((region) => {
    const name = region.region.trim();
    if (!name) throw new Error("Texture treatment region names must be non-empty.");
    if (seen.has(name)) {
      throw new Error(`Texture treatment region "${name}" appears more than once.`);
    }
    seen.add(name);
    for (const treatment of region.face_targets ?? []) {
      const id = faceId(treatment);
      if (!expected) {
        missingInventory = true;
      } else if (!expected.has(id)) {
        throw new Error(`Texture region "${name}" assigns out-of-scope face ${id}.`);
      }
      const prior = assigned.get(id);
      if (prior) {
        throw new Error(
          `Texture face ${id} is claimed by both "${prior.region}" and "${name}".`
        );
      }
      assigned.set(id, { region: name, treatment });
    }

    const pattern = region.surface_pattern
      ? getTextureSurfacePatternRecipe(region.surface_pattern)
      : null;
    if (!pattern) unresolved.push({ region: name, reason: "SURFACE_PATTERN_UNRESOLVED" });

    let render = null;
    if (region.minecraft_material_code) {
      render = inspectEntityRenderMaterialCode(region.minecraft_material_code);
      if (
        region.render_profile &&
        region.render_profile !== "custom" &&
        render.render_profile !== region.render_profile
      ) {
        throw new Error(
          `Region "${name}" render_profile ${region.render_profile} conflicts with minecraft_material_code ${region.minecraft_material_code}.`
        );
      }
    } else if (region.render_profile) {
      if (region.render_profile === "custom") {
        unresolved.push({ region: name, reason: "CUSTOM_MATERIAL_CODE_REQUIRED" });
      } else {
        render = inspectEntityRenderMaterialCode(
          minecraftMaterialCodeForRenderProfile(region.render_profile)
        );
      }
    } else {
      unresolved.push({ region: name, reason: "RENDER_PROFILE_UNRESOLVED" });
    }

    if (region.evidence === "unknown") {
      unresolved.push({ region: name, reason: "REFERENCE_EVIDENCE_UNKNOWN" });
    }

    const pbrIntent = region.pbr_intent ?? "none";
    return {
      region: name,
      evidence: region.evidence,
      surface_pattern: pattern,
      render_contract: render,
      pbr_intent: pbrIntent,
      pbr_depth_source:
        pbrIntent === "normal"
          ? "normal"
          : pbrIntent === "height"
            ? "height"
            : "none",
      identity_colors: [...(region.identity_colors ?? [])],
      notes: [...(region.notes ?? [])],
      face_targets: [...(region.face_targets ?? [])].map((target) => ({
        ...target,
        ...(target.shared_with ? { shared_with: { ...target.shared_with } } : {}),
      })),
      invariant:
        "surface_pattern describes RGB/pixel language only and never selects render_profile or PBR automatically",
    };
  });

  // Missing face ownership is a planning defect, not a styling verdict.
  const missing = expected
    ? [...expected.keys()].filter((id) => !assigned.has(id)).sort()
    : [];
  if (missingInventory) {
    unresolved.push({ region: "*", reason: "FACE_INVENTORY_REQUIRED" });
  }
  if (missing.length > 0) {
    unresolved.push({ region: "*", reason: "FACE_ASSIGNMENT_INCOMPLETE" });
  }
  for (const [id, owner] of assigned) {
    const target = owner.treatment;
    if (target.treatment !== "SHARED") {
      if (target.shared_with) {
        throw new Error(`Non-shared face ${id} may not specify shared_with.`);
      }
      continue;
    }
    if (!target.shared_with) {
      unresolved.push({ region: owner.region, reason: "SHARED_UV_SOURCE_REQUIRED" });
      continue;
    }
    const sourceId = faceId(target.shared_with);
    if (id === sourceId || !expected?.has(sourceId) ||
        assigned.get(sourceId)?.treatment.treatment === "SHARED" ||
        !assigned.has(sourceId)) {
      unresolved.push({ region: owner.region, reason: "SHARED_UV_SOURCE_INVALID" });
    }
  }

  return {
    domain: "texture_treatment_plan" as const,
    identity_colors: [...(input.identity_colors ?? [])],
    passes: [
      "BASE PASS",
      "VALUE / FORM PASS",
      "SURFACE PATTERN PASS",
      "IDENTITY PASS",
      "SECONDARY DETAIL PASS",
      "RENDER / ALPHA VERIFY",
      "MAPPED MODEL VERIFY",
    ] as const,
    regions,
    face_coverage: expected ? {
      state: missing.length ? ("incomplete" as const) : ("assigned" as const),
      required_count: expected.size,
      assigned_count: expected.size - missing.length,
      missing_count: missing.length,
      missing_examples: missing.slice(0, 12),
      examples_truncated: missing.length > 12,
      visual_verdict: "not_evaluated" as const,
      note: "Face coverage describes a proposed treatment for every named Cube face; it does not prove that paint was applied, that shared native UVs match, or that mapped appearance passes reference review.",
    } : {
      state: "not_evaluated" as const,
      note: "Region-only material planning has no full face inventory and cannot certify model-wide surface completion.",
    },
    readiness: {
      scope: expected ? ("explicit_face_inventory" as const) : ("regions_only" as const),
      state: unresolved.length ? ("review_required" as const) : ("ready" as const),
      unresolved,
    },
    rules: {
      pattern_does_not_select_render_profile: true,
      render_profile_does_not_select_surface_pattern: true,
      pbr_is_optional_and_explicit: true,
      no_similarity_score: true,
    },
  };
}

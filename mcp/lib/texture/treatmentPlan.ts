import {
  inspectEntityRenderMaterialCode,
  minecraftMaterialCodeForRenderProfile,
  type EntityRenderProfile,
} from "./renderProfile";
import {
  getTextureSurfacePatternRecipe,
  type TextureSurfacePattern,
} from "./surfacePattern";
import type { TextureSeamContinuityIntent } from "./seamContinuity";
import { parseReferenceImageRegions, type ReferenceRegionImage } from "../reference/imageRegionEvidence";
import { MODEL_VIEWS } from "../reference/visualEvidence";

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
/** Explicit image-region to Cube-face declaration; not visual recognition. */
export type TextureReferenceSurfaceClaim = {
  image_id: string; image_sha256: string; image_region_id: string;
  part_id: string; face: TextureTreatmentFace;
};
/** Narrow Control image projection; origin/bytes are not authenticated here. */
export type TextureReferenceSurfaceContext = {
  fingerprint: string;
  images: readonly (ReferenceRegionImage & {
    integrity: "VERIFIED" | "MISSING" | "INVALID";
    /** A declared Reference Package state; absent is never approved. */
    status?: string | null;
    used_by: readonly string[];
  })[];
};
export type TextureTreatmentEdge = TextureTreatmentFace & {
  edge: "left" | "right" | "top" | "bottom";
};

/**
 * Author-declared, exact edge pair within the owner-scoped face inventory.
 * Neither the treatment plan nor this declaration alone proves continuity.
 */
export type TextureSeamReferenceObservation = {
  /** Caller-supplied reference asset ID; not authenticated here. */
  reference_id: string;
  /** Explicit version of that reference asset; not a verified digest. */
  reference_revision: string;
  observation_id: string;
  /** Exact two treated Cube-face edges this observation claims to show. */
  observed_edges: readonly [TextureTreatmentEdge, TextureTreatmentEdge];
};

export type TextureTreatmentSeamPair = {
  left: TextureTreatmentEdge;
  right: TextureTreatmentEdge;
  continuity_intent: TextureSeamContinuityIntent;
  surface_id: string | null;
  material_id: string | null;
  /** REQUIRED continuity cannot rely only on evidence: "observed". */
  reference_observation?: TextureSeamReferenceObservation;
};

export type TextureTreatmentNativeFaceBinding = TextureTreatmentFace & {
  /** Explicit read of the current resolved Blockbench CubeFace.getTexture. */
  texture_uuid: string | null;
  /** Exact native CubeFace.material_name; empty string is a valid default. */
  native_material_name: string;
};

export type TextureTreatmentCrossCubeSeamHandoffEdge = TextureTreatmentEdge & {
  continuity_intent: TextureSeamContinuityIntent;
  surface_id: string | null;
  material_id: string | null;
  expected_texture_uuid: string;
  expected_native_material_name: string;
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
  reference_surfaces?: readonly TextureReferenceSurfaceClaim[];
};

export type TextureTreatmentPlanInput = {
  identity_colors?: readonly string[];
  regions: readonly TextureTreatmentRegionInput[];
  /** Explicit complete scope for this bounded treatment task; never inferred from a sample. */
  required_faces?: readonly TextureTreatmentFace[];
  reference_context?: TextureReferenceSurfaceContext;
  /**
   * Specific inter-Cube edge-pair intent with referenced per-face ownership.
   * Authoring metadata, NOT user approval or a claim that seams are continuous.
   */
  seam_pairs?: readonly TextureTreatmentSeamPair[];
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
      ...(region.reference_surfaces ? { reference_surfaces:
        region.reference_surfaces.map(claim => ({ ...claim, face: { ...claim.face } }))
      } : {}),
      invariant:
        "surface_pattern describes RGB/pixel language only and never selects render_profile or PBR automatically",
    };
  });


  // Strict opt-in metadata checks. Existing callers without reference claims
  // keep their structural planning behavior; even matched claims never grant
  // automatic pixel writes or assert that a reference depicts the target face.
  const referenceRequested = input.reference_context !== undefined ||
    regions.some(region => region.reference_surfaces !== undefined);
  let referenceIssues = 0, referenceClaims = 0, referenceMatches = 0;
  const flag = (region: string, reason: string) => {
    unresolved.push({ region, reason }); referenceIssues++;
  };
  let referenceContext: TextureReferenceSurfaceContext | null = null;
  if (referenceRequested) {
    if (!input.reference_context) {
      flag("*", "REFERENCE_SURFACE_CONTEXT_REQUIRED");
    } else {
      const context = input.reference_context;
      if (!/^[a-f0-9]{64}$/i.test(context.fingerprint) ||
          !Array.isArray(context.images) || context.images.length > 32) {
        throw new Error("TEXTURE_REFERENCE_CONTEXT_INVALID");
      }
      const imageIds = new Set<string>();
      referenceContext = { fingerprint: context.fingerprint, images: context.images.map(image => {
        if (!image || typeof image.id !== "string" || !image.id.trim() ||
            image.id.length > 96 || imageIds.has(image.id) ||
            !Array.isArray(image.used_by) ||
            (image.status !== undefined && image.status !== null &&
              typeof image.status !== "string"))
          throw new Error("TEXTURE_REFERENCE_CONTEXT_INVALID");
        imageIds.add(image.id);
        const parsed = parseReferenceImageRegions(image.regions);
        if (parsed === null) throw new Error("TEXTURE_REFERENCE_CONTEXT_INVALID");
        return { id: image.id, sha256: image.sha256 ?? null,
          integrity: image.integrity, status: image.status ?? null,
          view: image.view ?? null,
          used_by: [...image.used_by], regions: parsed };
      }) };
    }
    const imageMap = new Map((referenceContext?.images ?? []).map(i => [i.id, i]));
    for (const region of regions) {
      const claims = region.reference_surfaces ?? [];
      if (claims.length > 32 || referenceClaims + claims.length > 64)
        throw new Error("TEXTURE_REFERENCE_CLAIMS_LIMIT");
      referenceClaims += claims.length;
      const targets = new Set(region.face_targets.map(faceId));
      const mustBind = region.face_targets.filter(f =>
        f.treatment === "PAINT" || f.treatment === "SHARED").map(faceId);
      const visited = new Set<string>(), matched = new Set<string>();
      const parts = new Map<string, string>();
      for (const claim of claims) {
        if (!claim || !claim.face ||
            ![claim.image_id, claim.image_sha256, claim.image_region_id, claim.part_id]
              .every(v => typeof v === "string" && !!v.trim() && v.length <= 128))
          throw new Error("TEXTURE_REFERENCE_CLAIM_INVALID");
        const face = faceId(claim.face);
        if (!targets.has(face)) throw new Error("TEXTURE_REFERENCE_CLAIM_OUT_OF_SCOPE");
        const key = JSON.stringify([face, claim.image_id, claim.image_region_id]);
        if (visited.has(key)) throw new Error("TEXTURE_REFERENCE_CLAIM_DUPLICATE");
        visited.add(key);
        if (region.evidence !== "observed") {
          flag(region.region, "REFERENCE_SURFACE_NOT_OBSERVED"); continue;
        }
        const image = imageMap.get(claim.image_id);
        if (!image || image.integrity !== "VERIFIED" ||
            !image.used_by.includes("TEXTURE") ||
            !/^[a-f0-9]{64}$/i.test(claim.image_sha256) ||
            claim.image_sha256 !== image.sha256) {
          flag(region.region, "REFERENCE_SURFACE_SOURCE_STALE"); continue;
        }
        // Same ID/SHA is not source-image review, but DRAFT or missing
        // Reference Package authority cannot even support a metadata match.
        if (image.status !== "APPROVED") {
          flag(region.region, "REFERENCE_SURFACE_SOURCE_NOT_APPROVED"); continue;
        }
        if (!image.view || !MODEL_VIEWS.includes(image.view)) {
          flag(region.region, "REFERENCE_SURFACE_VIEW_UNRESOLVED"); continue;
        }
        const annotation = image.regions?.find(a => a.id === claim.image_region_id);
        if (!annotation) {
          flag(region.region, "REFERENCE_SURFACE_ANNOTATION_MISSING"); continue;
        }
        if (annotation.part_id !== claim.part_id) {
          flag(region.region, "REFERENCE_SURFACE_PART_MISMATCH"); continue;
        }
        if (annotation.evidence_role !== "SURFACE_DETAIL" ||
            annotation.visibility === "OCCLUDED" || !annotation.box_uv) {
          flag(region.region, "REFERENCE_SURFACE_NOT_VISIBLE_DETAIL"); continue;
        }
        if (parts.has(face) && parts.get(face) !== claim.part_id) {
          flag(region.region, "REFERENCE_SURFACE_FACE_PART_CONFLICT"); continue;
        }
        parts.set(face, claim.part_id); matched.add(face); referenceMatches++;
      }
      if (region.evidence === "observed") for (const face of mustBind) {
        if (!matched.has(face) && !claims.some(c => faceId(c.face) === face))
          flag(region.region, "REFERENCE_SURFACE_FACE_UNBOUND");
      }
    }
  }

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
      continue;
    }
    // K6 source-only semantic preflight: two declarations claiming the same
    // texels cannot independently demand different explicitly authored pixels
    // or material treatment. This is REVIEW, not proof of actual native UV
    // overlap, matching reference artwork or permission to repaint.
    const sourceOwner = assigned.get(sourceId)!;
    const destinationRegion = regions.find(region => region.region === owner.region);
    const sourceRegion = regions.find(region => region.region === sourceOwner.region);
    if (!destinationRegion || !sourceRegion) continue;
    if (destinationRegion.surface_pattern && sourceRegion.surface_pattern &&
        destinationRegion.surface_pattern.pattern !== sourceRegion.surface_pattern.pattern) {
      unresolved.push({ region: owner.region, reason: "SHARED_UV_PATTERN_CONFLICT" });
    }
    if (destinationRegion.render_contract && sourceRegion.render_contract &&
        destinationRegion.render_contract.minecraft_material_code !==
          sourceRegion.render_contract.minecraft_material_code) {
      unresolved.push({ region: owner.region, reason: "SHARED_UV_RENDER_CONFLICT" });
    }
    if (destinationRegion.pbr_intent !== sourceRegion.pbr_intent) {
      unresolved.push({ region: owner.region, reason: "SHARED_UV_PBR_CONFLICT" });
    }
    const lhs = destinationRegion.identity_colors.map(color =>
      typeof color === "string" ? color.trim().toLowerCase() : "");
    const rhs = sourceRegion.identity_colors.map(color =>
      typeof color === "string" ? color.trim().toLowerCase() : "");
    // One-sided/blank palette intent is missing evidence, not compatibility.
    // Preserve two genuinely unspecified cohorts as planning-only candidates;
    // no shared UV claim here is a native/reference visual PASS.
    if (lhs.some(color => !color) || rhs.some(color => !color) ||
        (lhs.length === 0) !== (rhs.length === 0)) {
      unresolved.push({ region: owner.region, reason: "SHARED_UV_IDENTITY_UNVERIFIED" });
    } else if (lhs.length > 0 &&
        (lhs.length !== rhs.length || lhs.some((color, index) =>
          color !== rhs[index]))) {
      unresolved.push({ region: owner.region, reason: "SHARED_UV_IDENTITY_CONFLICT" });
    }

    // Explicitly SHARED texels cannot encode separate authored marks. In
    // reference-aware mode require equal sets of source-declared surface
    // observations for both exact faces before reporting structural readiness.
    // Equal claims are still caller assertions, NOT native UV equality,
    // orientation agreement, visual equivalence or painting permission.
    if (referenceRequested) {
      const observations = (region: typeof destinationRegion, face: string) =>
        new Set((region.reference_surfaces ?? [])
          .filter(claim => faceId(claim.face) === face)
          .map(claim => JSON.stringify([
            claim.image_id, claim.image_sha256,
            claim.image_region_id, claim.part_id,
          ])));
      const dstMarks = observations(destinationRegion, id);
      const srcMarks = observations(sourceRegion, sourceId);
      if (dstMarks.size === 0 || srcMarks.size === 0 ||
          dstMarks.size !== srcMarks.size ||
          [...dstMarks].some(mark => !srcMarks.has(mark))) {
        unresolved.push({
          region: owner.region,
          reason: "SHARED_UV_REFERENCE_ARTWORK_UNVERIFIED",
        });
      }
    }
    if (sourceOwner.treatment.treatment === "INTENTIONAL_TRANSPARENT" &&
        destinationRegion.identity_colors.length > 0) {
      unresolved.push({ region: owner.region, reason: "SHARED_UV_ALPHA_IDENTITY_CONFLICT" });
    }
  }


  // Seam intent is never inferred from matching geometry, material names,
  // color, region proximity, or the treatment planner's "ready" state.
  const seamPairs = input.seam_pairs ?? [];
  if (!Array.isArray(seamPairs) || seamPairs.length > 32) {
    throw new Error("TEXTURE_SEAM_PAIR_SCOPE_INVALID: at most 32 explicit cross-Cube pairs.");
  }
  const declaredEdges = new Set<string>();
  const observationOwners = new Set<string>();
  const edgeKey = (face: TextureTreatmentEdge): string => {
    const id = faceId(face);
    if (!["left", "right", "top", "bottom"].includes(face.edge)) {
      throw new Error("TEXTURE_SEAM_PAIR_INVALID: local Cube face edge must be left/right/top/bottom.");
    }
    return id + ":" + face.edge;
  };
  for (const pair of seamPairs) {
    if (!pair || !pair.left || !pair.right ||
        !["REQUIRED", "INTENTIONAL_BOUNDARY", "UNSPECIFIED"].includes(
          pair.continuity_intent
        ) ||
        typeof pair.surface_id !== "string" && pair.surface_id !== null ||
        typeof pair.material_id !== "string" && pair.material_id !== null ||
        (typeof pair.surface_id === "string" && !pair.surface_id.trim()) ||
        (typeof pair.material_id === "string" && !pair.material_id.trim())) {
      throw new Error("TEXTURE_SEAM_PAIR_INVALID: explicit edge pair and continuity/material fields required.");
    }
    const left = edgeKey(pair.left), right = edgeKey(pair.right);
    if (pair.left.cube_uuid === pair.right.cube_uuid ||
        left === right || declaredEdges.has(left) || declaredEdges.has(right)) {
      throw new Error("TEXTURE_SEAM_PAIR_DUPLICATE: edge pairs must connect distinct Cubes with unique edge ownership.");
    }
    declaredEdges.add(left);
    declaredEdges.add(right);
    const observation = pair.reference_observation;
    if (observation !== undefined) {
      const token = (value: unknown): value is string =>
        typeof value === "string" && value.trim().length > 0 && value.length <= 256;
      if (!observation || !token(observation.reference_id) ||
          !token(observation.reference_revision) ||
          !token(observation.observation_id) ||
          !Array.isArray(observation.observed_edges) ||
          observation.observed_edges.length !== 2) {
        throw new Error("TEXTURE_SEAM_REFERENCE_INVALID: require a bounded source ID, revision, observation ID and two explicit edges.");
      }
      const claimed = observation.observed_edges.map(edgeKey).sort();
      if (claimed[0] !== [left, right].sort()[0] ||
          claimed[1] !== [left, right].sort()[1]) {
        throw new Error("TEXTURE_SEAM_REFERENCE_SCOPE_MISMATCH: observed reference edges differ from their declared seam pair.");
      }
      const key = JSON.stringify([
        observation.reference_id,
        observation.reference_revision,
        observation.observation_id,
      ]);
      if (observationOwners.has(key)) {
        throw new Error("TEXTURE_SEAM_REFERENCE_REUSED: one exact edge observation cannot authorize multiple seam pairs.");
      }
      observationOwners.add(key);
    }
    const a = assigned.get(faceId(pair.left));
    const b = assigned.get(faceId(pair.right));
    if (!expected || !a || !b) {
      unresolved.push({ region: "*", reason: "SEAM_FACE_INVENTORY_OR_ASSIGNMENT_REQUIRED" });
      continue;
    }
    if (pair.continuity_intent === "REQUIRED") {
      if (!observation) {
        unresolved.push({ region: "*", reason: "SEAM_REFERENCE_OBSERVATION_REQUIRED" });
      }
      if (!pair.surface_id || !pair.material_id) {
        unresolved.push({ region: "*", reason: "SEAM_SURFACE_AND_MATERIAL_REQUIRED" });
      }
      const leftRegion = regions.find(region => region.region === a.region);
      const rightRegion = regions.find(region => region.region === b.region);
      if (!leftRegion || !rightRegion ||
          leftRegion.evidence !== "observed" ||
          rightRegion.evidence !== "observed") {
        unresolved.push({ region: "*", reason: "SEAM_OBSERVED_REFERENCE_REQUIRED" });
      }
      if (!leftRegion?.render_contract || !rightRegion?.render_contract ||
          leftRegion.render_contract.minecraft_material_code !==
          rightRegion.render_contract.minecraft_material_code ||
          leftRegion.pbr_intent !== rightRegion.pbr_intent) {
        unresolved.push({ region: "*", reason: "SEAM_RENDER_OR_PBR_COHORT_MISMATCH" });
      }
      if (a.treatment.treatment === "INTENTIONAL_TRANSPARENT" ||
          b.treatment.treatment === "INTENTIONAL_TRANSPARENT") {
        unresolved.push({ region: "*", reason: "SEAM_TRANSPARENT_SURFACE_REVIEW_REQUIRED" });
      }
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
    seam_pairs: seamPairs.map(pair => ({
      ...pair,
      left: { ...pair.left },
      right: { ...pair.right },
      ...(pair.reference_observation ? {
        reference_observation: {
          ...pair.reference_observation,
          observed_edges: [
            { ...pair.reference_observation.observed_edges[0] },
            { ...pair.reference_observation.observed_edges[1] },
          ] as [TextureTreatmentEdge, TextureTreatmentEdge],
        },
      } : {}),
    })),
    ...(referenceContext ? { reference_context: referenceContext } : {}),
    reference_surface_evidence: {
      state: !referenceRequested ? ("not_requested" as const)
        : referenceIssues ? ("review_required" as const)
          : referenceClaims ? ("claim_metadata_matched" as const)
            : ("not_evaluated" as const),
      reference_fingerprint: referenceContext?.fingerprint ?? null,
      declared_claim_count: referenceClaims, matched_claim_count: referenceMatches,
      assertion_provenance: "CALLER_CONTROL_PROJECTION_UNATTESTED" as const,
      current_reference_read_attested: false as const,
      native_face_mapping_attested: false as const,
      mutation_authorized: false as const,
      visual_verdict: "not_evaluated" as const,
    },
    seam_reference_evidence_state: seamPairs.some(pair =>
      pair.continuity_intent === "REQUIRED"
    ) ? ("caller_observation_unverified" as const)
      : ("not_requested" as const),
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
      visual_verdict: "not_evaluated" as const,
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


/**
 * Revalidate the *current* plan representation before reading native
 * textures. A plain plan result is mutable: post-planning edits to seam
 * pairs, evidence, render/PBR intent, or face assignments must not inherit
 * yesterday's ready flag.
 *
 * This checks structural source ownership, not trusted visual approval.
 */
export function requireTextureTreatmentSeamPlanReady(
  plan: ReturnType<typeof planTextureTreatment>
): void {
  if (!plan || plan.domain !== "texture_treatment_plan" ||
      plan.readiness.scope !== "explicit_face_inventory" ||
      plan.readiness.state !== "ready" ||
      plan.face_coverage.state !== "assigned" ||
      plan.readiness.unresolved.length !== 0 ||
      !Array.isArray(plan.regions) || !Array.isArray(plan.seam_pairs)) {
    throw new Error("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY: require unblocked, complete treatment source ownership.");
  }
  const requiredFaces = plan.regions.flatMap(region =>
    region.face_targets.map(face => ({
      cube_uuid: face.cube_uuid, face: face.face,
    }))
  );
  if (requiredFaces.length !== plan.face_coverage.required_count ||
      plan.face_coverage.assigned_count !== requiredFaces.length ||
      plan.face_coverage.missing_count !== 0) {
    throw new Error("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY: the planned face inventory was modified.");
  }
  // Reuse the canonical authoring owner rather than adding another seam
  // validator that would drift from the original REQUIRED intent policy.
  const verified = planTextureTreatment({
    identity_colors: plan.identity_colors,
    required_faces: requiredFaces,
    ...(plan.reference_context ? { reference_context: plan.reference_context } : {}),
    regions: plan.regions.map(region => ({
      region: region.region,
      evidence: region.evidence,
      surface_pattern: region.surface_pattern?.pattern,
      minecraft_material_code:
        region.render_contract?.minecraft_material_code ?? undefined,
      pbr_intent: region.pbr_intent,
      identity_colors: region.identity_colors,
      face_targets: region.face_targets,
      ...(region.reference_surfaces ? { reference_surfaces: region.reference_surfaces } : {}),
    })),
    seam_pairs: plan.seam_pairs,
  });
  if (verified.readiness.state !== "ready" ||
      verified.readiness.scope !== "explicit_face_inventory" ||
      verified.face_coverage.state !== "assigned" ||
      verified.readiness.unresolved.length !== 0) {
    throw new Error("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY: post-planning source or continuity intent became unresolved.");
  }
}

/**
 * Source-owner handoff for the existing unregistered native seam sampler.
 * No new approval manager: this verifies explicit treatment-plan face and
 * seam-pair ownership against a caller-provided bounded native face inventory.
 *
 * "ready" only means no treatment planning blockers. It never means visual
 * approval, trusted native readback, current texture revision, or seam PASS.
 * The native reader MUST independently revalidate bindings before sampling.
 */
export function buildTextureTreatmentCrossCubeSeamHandoff(
  plan: ReturnType<typeof planTextureTreatment>,
  nativeFaceBindings: readonly TextureTreatmentNativeFaceBinding[]
): {
  state: "review_required" | "not_evaluated";
  source: "texture_treatment_plan";
  declared_pair_count: number;
  /** Caller-provided observation references, not authenticated approvals. */
  reference_observations: Array<{
    reference_id: string;
    reference_revision: string;
    observation_id: string;
    observed_edges: [TextureTreatmentEdge, TextureTreatmentEdge];
    assertion_provenance: "CALLER_DECLARATION_UNVERIFIED";
  }>;
  declarations: TextureTreatmentCrossCubeSeamHandoffEdge[];
  scope: "explicit_face_inventory";
  native_binding_attested: false;
  texture_revision_attested: false;
  material_approval_attested: false;
  scene_coverage_attested: false;
  visual_verdict: "not_evaluated";
} {
  requireTextureTreatmentSeamPlanReady(plan);

  // Exact alignment with the treatment owner's full bounded face inventory;
  // never accept just the two conveniently sampled seam faces.
  const assigned = plan.regions.flatMap(region => region.face_targets.map(
    face => ({ ...face, region: region.region })
  ));
  const faceKeys = new Set<string>();
  for (const face of assigned) {
    const key = faceId(face);
    if (faceKeys.has(key)) {
      throw new Error("TEXTURE_SEAM_HANDOFF_SCOPE_INVALID: duplicate treatment face assignment.");
    }
    faceKeys.add(key);
  }
  if (faceKeys.size !== plan.face_coverage.required_count ||
      !Array.isArray(nativeFaceBindings) ||
      nativeFaceBindings.length !== faceKeys.size) {
    throw new Error(
      "TEXTURE_SEAM_HANDOFF_SCOPE_INVALID: native face inventory must exactly cover the planned faces."
    );
  }
  const native = new Map<string, TextureTreatmentNativeFaceBinding>();
  for (const binding of nativeFaceBindings) {
    const id = faceId(binding);
    if (native.has(id) || !faceKeys.has(id) ||
        typeof binding.native_material_name !== "string" ||
        (binding.texture_uuid !== null &&
          (typeof binding.texture_uuid !== "string" ||
           !binding.texture_uuid.trim()))) {
      throw new Error(
        "TEXTURE_SEAM_HANDOFF_SCOPE_INVALID: duplicate, foreign or malformed face-to-Texture evidence."
      );
    }
    native.set(id, binding);
  }
  if (native.size !== faceKeys.size) {
    throw new Error("TEXTURE_SEAM_HANDOFF_SCOPE_INVALID: required native faces are missing.");
  }

  const edgeKeys = new Set<string>();
  const declarations: TextureTreatmentCrossCubeSeamHandoffEdge[] = [];
  for (const pair of plan.seam_pairs) {
    const leftKey = faceId(pair.left) + ":" + pair.left.edge;
    const rightKey = faceId(pair.right) + ":" + pair.right.edge;
    if (edgeKeys.has(leftKey) || edgeKeys.has(rightKey) ||
        leftKey === rightKey || pair.left.cube_uuid === pair.right.cube_uuid) {
      throw new Error("TEXTURE_SEAM_HANDOFF_PAIR_INVALID: duplicated or same-Cube seam owner.");
    }
    edgeKeys.add(leftKey);
    edgeKeys.add(rightKey);
    const left = native.get(faceId(pair.left));
    const right = native.get(faceId(pair.right));
    if (!left?.texture_uuid || !right?.texture_uuid) {
      throw new Error("TEXTURE_SEAM_HANDOFF_BINDING_UNAVAILABLE: requested seam faces require resolved native texture UUIDs.");
    }
    if (pair.continuity_intent === "REQUIRED" &&
        (left.native_material_name !== right.native_material_name ||
         !pair.surface_id || !pair.material_id)) {
      throw new Error(
        "TEXTURE_SEAM_HANDOFF_NATIVE_MATERIAL_MISMATCH: REQUIRED faces must share exact native material names and explicit material/surface IDs."
      );
    }
    for (const [face, binding] of [
      [pair.left, left], [pair.right, right],
    ] as const) {
      declarations.push({
        ...face,
        continuity_intent: pair.continuity_intent,
        surface_id: pair.surface_id,
        material_id: pair.material_id,
        // Both mapped faces were checked for a non-empty resolved UUID
        // before this local construction; no implicit native default.
        expected_texture_uuid: binding.texture_uuid!,
        expected_native_material_name: binding.native_material_name,
      });
    }
  }
  return {
    state: declarations.length ? "review_required" : "not_evaluated",
    source: "texture_treatment_plan",
    declared_pair_count: plan.seam_pairs.length,
    reference_observations: plan.seam_pairs.flatMap(pair =>
      pair.reference_observation ? [{
        reference_id: pair.reference_observation.reference_id,
        reference_revision: pair.reference_observation.reference_revision,
        observation_id: pair.reference_observation.observation_id,
        observed_edges: [
          { ...pair.reference_observation.observed_edges[0] },
          { ...pair.reference_observation.observed_edges[1] },
        ] as [TextureTreatmentEdge, TextureTreatmentEdge],
        assertion_provenance: "CALLER_DECLARATION_UNVERIFIED" as const,
      }] : []
    ),
    declarations,
    scope: "explicit_face_inventory",
    native_binding_attested: false,
    texture_revision_attested: false,
    material_approval_attested: false,
    scene_coverage_attested: false,
    visual_verdict: "not_evaluated",
  };
}

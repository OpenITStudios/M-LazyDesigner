import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { resolveSemanticIdentity } from "@/lib/authoringRecipe/semanticIdentity";
import {
  fingerprintAuthoringRecipeNativeSnapshot,
  type AuthoringRecipeNativeSnapshot,
} from "@/lib/authoringRecipe/nativeState";
import {
  assessVisualPartCorrespondence,
  type PartCorrespondenceInput,
} from "@/lib/reference/partCorrespondence";
import { parseReferenceImageRegions } from "@/lib/reference/imageRegionEvidence";

// Editable fixture only; production assessment inputs remain readonly.
type Editable<T> = T extends readonly unknown[]
  ? { -readonly [K in keyof T]: Editable<T[K]> }
  : T extends object ? { -readonly [K in keyof T]: Editable<T[K]> } : T;

const HASH = "a".repeat(64);
const MODEL_FRONT_SHA = "f".repeat(64);
const MODEL_LEFT_SHA = "e".repeat(64);
const BASE_REF = "c".repeat(64);
const CAPTURE = "verificationevidence:current";

function recipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1, id: "seat-asset", name: "Seat",
    prototypes: [
      { id: "seat-cube", name: "seat", size: [3, 1, 3], semantic_group: "seat" },
    ],
    patterns: [{
      kind: "LINEAR", id: "seat-pieces", prototype_id: "seat-cube",
      count: 2, axis: "X", spacing: 3, semantic_group: "seat",
    }],
  };
}

function fixture(): Editable<PartCorrespondenceInput> {
  const authored = recipe();
  const native: AuthoringRecipeNativeSnapshot = {
    schema: 1, recipe_id: authored.id,
    cubes: compileAuthoringRecipe(authored).placements.map((p, i) => ({
      uuid: "cube-uuid-" + i, recipe_id: authored.id, instance_id: p.id,
      name: p.name,
      from: [...p.from] as [number, number, number],
      to: [...p.to] as [number, number, number],
      origin: [...p.origin] as [number, number, number],
      rotation: [...p.rotation] as [number, number, number],
      inflate: p.inflate,
    })),
  };
  const fingerprint = fingerprintAuthoringRecipeNativeSnapshot(native);
  const identities = resolveSemanticIdentity(authored, native, { semantic_group: "seat" });
  const region = parseReferenceImageRegions([{
    id: "seat-volume", part_id: "seat", evidence_role: "PRIMARY_VOLUME",
    visibility: "DIRECT", box_uv: [0.1, 0.2, 0.9, 0.75],
  }])!;
  return {
    reference: {
      package_fingerprint: BASE_REF,
      current_package_fingerprint: BASE_REF,
      images: [{
        id: "IMG_FRONT", sha256: HASH, integrity: "VERIFIED",
        status: "APPROVED", view: "front", regions: region,
      }],
      parts: [{ id: "seat", role: "GEOMETRY" }],
    },
    model: {
      project_uuid: "project-1", recipe_id: authored.id,
      native_snapshot_fingerprint: fingerprint,
      current_native_snapshot_fingerprint: fingerprint,
      capture_dependency_fingerprint: "sha256:" + "d".repeat(64),
      current_capture_dependency_fingerprint: "sha256:" + "d".repeat(64),
      identities,
      capture: {
        project_uuid: "project-1",
        native_snapshot_fingerprint: fingerprint,
        capture_dependency_fingerprint: "sha256:" + "d".repeat(64),
        evidence_handle: CAPTURE, views: ["front"],
        image_digests: [{ view: "front", sha256: MODEL_FRONT_SHA }],
      },
    },
    proposals: [{
      image_id: "IMG_FRONT", region_id: "seat-volume", part_id: "seat",
      native_cube_uuids: ["cube-uuid-0", "cube-uuid-1"],
      review: {
        outcome: "MATCHED", source_image_id: "IMG_FRONT",
        source_region_id: "seat-volume", source_sha256: HASH,
        model_evidence_handle: CAPTURE, model_view: "front",
        model_image_sha256: MODEL_FRONT_SHA,
        source_pixels_inspected: true, model_pixels_inspected: true,
      },
    }],
  };
}

function evaluate(input: PartCorrespondenceInput) {
  return assessVisualPartCorrespondence(input).claims[0]!;
}

describe("pure source-image to recipe-owned Cube correspondence", () => {
  test("accepts an explicitly reviewed part mapped to two verified UUIDs without visual-quality PASS", () => {
    const input = fixture(), untouched = structuredClone(input);
    const result = assessVisualPartCorrespondence(input);
    expect(result.state).toBe("ASSESSED");
    expect(result.visual_verdict).toBe("NOT_EVALUATED");
    expect(result.source_views).toEqual(["front"]);
    expect(result.claims[0]).toMatchObject({
      part_id: "seat", image_id: "IMG_FRONT", image_sha256: HASH,
      region_id: "seat-volume", owner: "GEOMETRY", visibility: "DIRECT",
      native_cube_uuids: ["cube-uuid-0", "cube-uuid-1"],
      native_instance_ids: ["seat-pieces:0", "seat-pieces:1"],
      project_uuid: "project-1",
      state: "SUPPORTED", reason: "MATCH_REVIEWED", hidden_shape_status: "UNVERIFIED",
    });
    expect(input).toEqual(untouched);
  });

  test("no proposed Cube is a provisional identity gap, never evidence a required part is missing", () => {
    const input = fixture();
    input.proposals[0] = { ...input.proposals[0]!, native_cube_uuids: [] };
    expect(evaluate(input)).toMatchObject({
      state: "PROVISIONAL", reason: "NO_EXPLICIT_TARGET",
    });
    input.proposals[0] = { ...input.proposals[0]!, native_cube_uuids: ["unknown-cube"] };
    expect(evaluate(input)).toMatchObject({
      state: "UNAVAILABLE", reason: "NATIVE_TARGET_NOT_PROVEN",
    });
  });

  test("revisions, projects and capture identity are fail-closed", () => {
    const refStale = fixture();
    refStale.reference.current_package_fingerprint = "new-ref";
    expect(evaluate(refStale).reason).toBe("SOURCE_OR_MODEL_REVISION_CHANGED");
    const nativeStale = fixture();
    nativeStale.model.current_native_snapshot_fingerprint = "new-native";
    expect(evaluate(nativeStale).reason).toBe("SOURCE_OR_MODEL_REVISION_CHANGED");
    const captureStale = fixture();
    captureStale.model.capture.native_snapshot_fingerprint = "another-model";
    expect(evaluate(captureStale).reason).toBe("SOURCE_OR_MODEL_REVISION_CHANGED");
    const projectChanged = fixture();
    projectChanged.model.capture.project_uuid = "other-project";
    expect(evaluate(projectChanged).reason).toBe("SOURCE_OR_MODEL_REVISION_CHANGED");
    const staleScene = fixture();
    staleScene.model.current_capture_dependency_fingerprint = "sha256:" + "e".repeat(64);
    expect(evaluate(staleScene)).toMatchObject({
      state: "UNAVAILABLE", reason: "SOURCE_OR_MODEL_REVISION_CHANGED",
    });
    const captureMismatch = fixture();
    captureMismatch.model.capture.capture_dependency_fingerprint = "sha256:" + "e".repeat(64);
    expect(evaluate(captureMismatch).reason).toBe("SOURCE_OR_MODEL_REVISION_CHANGED");
    const noView = fixture();
    noView.model.capture.views = ["left"];
    expect(evaluate(noView).reason).toBe("VIEW_NOT_CAPTURED");
    const sourceMissing = fixture();
    sourceMissing.reference.images[0]!.integrity = "MISSING";
    expect(evaluate(sourceMissing).reason).toBe("SOURCE_UNAVAILABLE");
    expect(assessVisualPartCorrespondence(sourceMissing).source_views).toEqual([]);
  });

  test("a matching view or matching label cannot replace direct fresh image review", () => {
    const input = fixture();
    delete input.proposals[0]!.review;
    expect(evaluate(input)).toMatchObject({
      state: "PROVISIONAL", reason: "IMAGE_REVIEW_NOT_COMPLETE",
    });
    const uninspected = fixture();
    uninspected.proposals[0]!.review!.source_pixels_inspected = false;
    expect(evaluate(uninspected).state).toBe("PROVISIONAL");
    const stalePixels = fixture();
    stalePixels.proposals[0]!.review!.source_sha256 = "b".repeat(64);
    expect(evaluate(stalePixels).reason).toBe("IMAGE_REVIEW_STALE");
    const wrongRegion = fixture();
    wrongRegion.proposals[0]!.review!.source_region_id = "different-region";
    expect(evaluate(wrongRegion).reason).toBe("IMAGE_REVIEW_STALE");
    const wrongImage = fixture();
    wrongImage.proposals[0]!.review!.source_image_id = "IMG_DIFFERENT";
    expect(evaluate(wrongImage).reason).toBe("IMAGE_REVIEW_STALE");
    const oldModel = fixture();
    oldModel.proposals[0]!.review!.model_evidence_handle = "verificationevidence:old";
    expect(evaluate(oldModel).reason).toBe("IMAGE_REVIEW_STALE");
    const mismatch = fixture();
    mismatch.proposals[0]!.review!.outcome = "MISMATCHED";
    expect(evaluate(mismatch)).toMatchObject({
      state: "CONFLICTING", reason: "VISUAL_MISMATCH_REPORTED",
    });
  });


  test("model review binds to the exact shaded PNG digest for its captured view", () => {
    const missing = fixture();
    missing.model.capture.image_digests = [];
    expect(evaluate(missing)).toMatchObject({
      state: "UNAVAILABLE", reason: "MODEL_CAPTURE_IMAGE_IDENTITY_UNVERIFIED",
    });
    const invalid = fixture();
    invalid.model.capture.image_digests[0]!.sha256 = "not-a-digest";
    expect(evaluate(invalid)).toMatchObject({
      state: "UNAVAILABLE", reason: "MODEL_CAPTURE_IMAGE_IDENTITY_UNVERIFIED",
    });
    const wrongView = fixture();
    wrongView.model.capture.image_digests[0]!.view = "left";
    expect(evaluate(wrongView)).toMatchObject({
      state: "UNAVAILABLE", reason: "MODEL_CAPTURE_IMAGE_IDENTITY_UNVERIFIED",
    });
    const missingReviewDigest = fixture();
    missingReviewDigest.proposals[0]!.review!.model_image_sha256 = "";
    expect(evaluate(missingReviewDigest)).toMatchObject({
      state: "UNAVAILABLE", reason: "IMAGE_REVIEW_STALE",
    });
    const changedPixels = fixture();
    changedPixels.model.capture.image_digests[0]!.sha256 = "b".repeat(64);
    expect(evaluate(changedPixels)).toMatchObject({
      state: "UNAVAILABLE", reason: "IMAGE_REVIEW_STALE",
    });
    expect(evaluate(fixture())).toMatchObject({
      state: "SUPPORTED", reason: "MATCH_REVIEWED",
    });
  });

  test("identical rendered pixels from separate valid model views remain allowed for symmetric geometry", () => {
    const input = fixture();
    input.reference.images.push({
      ...structuredClone(input.reference.images[0]!),
      id: "IMG_LEFT", view: "left", sha256: "b".repeat(64),
    });
    input.model.capture.views.push("left");
    input.model.capture.image_digests.push({
      view: "left", sha256: MODEL_FRONT_SHA,
    });
    input.proposals.push({
      ...structuredClone(input.proposals[0]!),
      image_id: "IMG_LEFT",
      review: {
        ...structuredClone(input.proposals[0]!.review!),
        source_image_id: "IMG_LEFT",
        source_sha256: "b".repeat(64),
        model_view: "left",
        model_image_sha256: MODEL_FRONT_SHA,
      },
    });
    const result = assessVisualPartCorrespondence(input);
    expect(result.claims.map((claim) => claim.state)).toEqual(["SUPPORTED", "SUPPORTED"]);
    expect(result.visual_verdict).toBe("NOT_EVALUATED");
  });

  test("occlusion cannot prove hidden geometry; surface details belong to TEXTURE", () => {
    const hidden = fixture();
    hidden.reference.images[0]!.regions = parseReferenceImageRegions([{
      id: "seat-volume", part_id: "seat", evidence_role: "PRIMARY_VOLUME",
      visibility: "OCCLUDED",
    }])!;
    expect(evaluate(hidden)).toMatchObject({
      state: "PROVISIONAL", reason: "OCCLUDED_NOT_ABSENT",
      hidden_shape_status: "UNVERIFIED",
    });
    const part = fixture();
    part.reference.images[0]!.regions = parseReferenceImageRegions([{
      id: "seat-volume", part_id: "seat", evidence_role: "SURFACE_DETAIL",
      visibility: "PARTIAL", box_uv: [0.1, 0.2, 0.9, 0.75],
    }])!;
    expect(evaluate(part)).toMatchObject({
      state: "SUPPORTED", owner: "TEXTURE", visibility: "PARTIAL",
      hidden_shape_status: "UNVERIFIED",
    });
    const relationship = fixture();
    relationship.reference.images[0]!.regions = parseReferenceImageRegions([{
      id: "seat-volume", part_id: "seat", evidence_role: "NEGATIVE_SPACE",
      visibility: "DIRECT", box_uv: [0.1, 0.2, 0.9, 0.75],
    }])!;
    expect(evaluate(relationship)).toMatchObject({
      state: "PROVISIONAL", owner: "RELATIONSHIP",
      reason: "RELATIONSHIP_NEEDS_SEPARATE_REVIEW",
    });
  });

  test("owner conflicts and cross-part reuse of the same UUID are never silently accepted", () => {
    const owner = fixture();
    owner.reference.parts[0] = { id: "seat", role: "TEXTURE" };
    expect(evaluate(owner)).toMatchObject({
      state: "CONFLICTING", reason: "OWNER_CONFLICT",
    });
    const unknownOwner = fixture();
    unknownOwner.reference.parts[0] = { id: "seat", role: null };
    expect(evaluate(unknownOwner)).toMatchObject({
      state: "PROVISIONAL", reason: "OWNER_CONFLICT",
    });
    const cross = fixture();
    cross.reference.parts.push({ id: "leg", role: "GEOMETRY" });
    cross.reference.images[0]!.regions = parseReferenceImageRegions([
      ...cross.reference.images[0]!.regions,
      { id: "leg-volume", part_id: "leg", evidence_role: "PRIMARY_VOLUME",
        visibility: "DIRECT", box_uv: [0.1, 0.2, 0.2, 0.6] },
    ])!;
    cross.proposals.push({
      image_id: "IMG_FRONT", region_id: "leg-volume", part_id: "leg",
      native_cube_uuids: ["cube-uuid-0"],
    });
    expect(assessVisualPartCorrespondence(cross).claims.map((x) => x.reason))
      .toEqual(["CUBE_CLAIMED_BY_DIFFERENT_PARTS", "CUBE_CLAIMED_BY_DIFFERENT_PARTS"]);
  });

  test("same front view repeated under another image ID cannot manufacture multi-view support", () => {
    const x = fixture();
    x.reference.images.push({
      ...structuredClone(x.reference.images[0]!), id: "IMG_FRONT_2",
      sha256: HASH,
    });
    const result = assessVisualPartCorrespondence(x);
    expect(result.source_views).toEqual(["front"]);
    expect(result.claims[0]).toMatchObject({
      state: "SUPPORTED", reason: "MATCH_REVIEWED",
    });
  });

  test("same image bytes relabelled as different views conflict even with reported review", () => {
    const x = fixture();
    x.reference.images.push({
      ...structuredClone(x.reference.images[0]!), id: "IMG_LEFT",
      view: "left", sha256: HASH,
    });
    x.model.capture.views.push("left");
    x.model.capture.image_digests.push({ view: "left", sha256: MODEL_LEFT_SHA });
    x.proposals.push({
      ...structuredClone(x.proposals[0]!),
      image_id: "IMG_LEFT",
      review: {
        ...structuredClone(x.proposals[0]!.review!),
        source_image_id: "IMG_LEFT", model_view: "left",
        model_image_sha256: MODEL_LEFT_SHA,
      },
    });
    const result = assessVisualPartCorrespondence(x);
    expect(result.source_views).toEqual([]);
    expect(result.visual_verdict).toBe("NOT_EVALUATED");
    expect(result.claims.map((claim) => [claim.state, claim.reason])).toEqual([
      ["CONFLICTING", "SOURCE_VIEW_IDENTITY_CONFLICT"],
      ["CONFLICTING", "SOURCE_VIEW_IDENTITY_CONFLICT"],
    ]);
  });

  test("distinct approved image bytes can support distinct reviewed view associations", () => {
    const x = fixture();
    const leftSha = "b".repeat(64);
    x.reference.images.push({
      ...structuredClone(x.reference.images[0]!), id: "IMG_LEFT",
      view: "left", sha256: leftSha,
    });
    x.model.capture.views.push("left");
    x.model.capture.image_digests.push({ view: "left", sha256: MODEL_LEFT_SHA });
    x.proposals.push({
      ...structuredClone(x.proposals[0]!),
      image_id: "IMG_LEFT",
      review: {
        ...structuredClone(x.proposals[0]!.review!),
        source_image_id: "IMG_LEFT", source_sha256: leftSha, model_view: "left",
        model_image_sha256: MODEL_LEFT_SHA,
      },
    });
    const result = assessVisualPartCorrespondence(x);
    expect(result.source_views).toEqual(["front", "left"]);
    expect(result.claims.map((claim) => claim.state)).toEqual(["SUPPORTED", "SUPPORTED"]);
    expect(result.visual_verdict).toBe("NOT_EVALUATED");
  });

  test("rejects duplicate proposals, duplicate native identities and oversized scopes", () => {
    const duplicates = fixture();
    duplicates.proposals.push(structuredClone(duplicates.proposals[0]!));
    expect(() => assessVisualPartCorrespondence(duplicates)).toThrow("PART_CORRESPONDENCE_PROPOSAL_INVALID");
    const native = fixture();
    native.model.identities.identities[1]!.native_uuid =
      native.model.identities.identities[0]!.native_uuid;
    expect(() => assessVisualPartCorrespondence(native)).toThrow("PART_CORRESPONDENCE_IDENTITY_INVALID");
    const images = fixture();
    images.reference.images.push(structuredClone(images.reference.images[0]!));
    expect(() => assessVisualPartCorrespondence(images)).toThrow("PART_CORRESPONDENCE_IDENTITY_INVALID");
    const tooMany = fixture();
    tooMany.proposals = Array.from({ length: 17 }, (_, i) => ({
      ...tooMany.proposals[0]!, region_id: "part" + i,
    }));
    expect(() => assessVisualPartCorrespondence(tooMany)).toThrow("PART_CORRESPONDENCE_SCOPE_INVALID");
  });
});

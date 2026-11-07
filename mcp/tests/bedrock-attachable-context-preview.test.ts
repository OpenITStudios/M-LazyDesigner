import { describe, expect, test } from "bun:test";
import { type AttachableBindingInput } from "@/lib/bedrock/attachableBinding";
import {
  planBedrockAttachableContextPreview,
  reviewBedrockAttachableContextCapture,
  type AttachableContextPreviewInput,
  type AttachableContextCaptureEvidence,
} from "@/lib/bedrock/attachableContextPreview";

const sha = (char: string) => "sha256:" + char.repeat(64);

function base(): AttachableContextPreviewInput {
  const binding: AttachableBindingInput = {
    expected_project_uuid: "asset-project",
    attachable_identifier: "demo:staff",
    item_identifier: "demo:staff",
    geometry_identifier: "geometry.staff",
    target_bone_uuid: "bone-staff",
    model_bones: [{ uuid: "bone-staff", name: "staff", parent_uuid: null }],
    holder: {
      entity_identifier: "minecraft:player",
      bone_names: ["rightItem", "leftItem", "body"],
    },
    binding: { strategy: "ITEM_SLOT", preview_slot: "main_hand" },
    source_refs: ["approved:front"],
  };
  return {
    binding,
    expected: {
      asset_fingerprint: sha("a"),
      holder_fingerprint: sha("b"),
      holder_pose_fingerprint: sha("c"),
      runtime_build_fingerprint: sha("d"),
      reference_image_fingerprint: sha("e"),
      holder_pose_label: "hold_idle",
    },
  };
}

function claim(
  input: AttachableContextPreviewInput = base()
): AttachableContextCaptureEvidence {
  const plan = planBedrockAttachableContextPreview(input);
  return {
    plan_id: plan.plan_id,
    project_uuid: plan.project_uuid,
    attachable_identifier: plan.attachable_identifier,
    holder_entity_identifier: plan.holder_entity_identifier,
    geometry_identifier: plan.geometry_identifier,
    target_model_bone_uuid: plan.target_model_bone_uuid,
    item_slot: plan.item_slot,
    expected: { ...plan.expected },
    captures: plan.required_views.map((perspective, i) => ({
      perspective, image_sha256: sha(["f", "1", "2"][i]!),
      evidence_handle: "native-claim-" + i,
    })),
  };
}

describe("A2 attachable holder-composite preview evidence (source-only)", () => {
  test("A1 is recomputed and three contextual views are requested without native PASS", () => {
    const input = base();
    const before = structuredClone(input);
    const p = planBedrockAttachableContextPreview(input);
    expect(p.state).toBe("SOURCE_PLAN_WAITING_FOR_NATIVE_HOLDER_CAPTURE");
    expect(p.required_views).toEqual([
      "FIRST_PERSON", "THIRD_PERSON_FRONT", "THIRD_PERSON_SIDE",
    ]);
    expect(p.existing_capture_route).toBe("capture_model_views");
    expect(p.capture_route).toBe("NATIVE_HOLDER_COMPOSITE_REQUIRED");
    expect(p.native_verified).toBe(false);
    expect(p.visual_verified).toBe(false);
    expect(p.minecraft_verified).toBe(false);
    expect(input).toEqual(before);
    expect(planBedrockAttachableContextPreview(input).plan_id).toBe(p.plan_id);
  });

  test("equivalent A1 inventories and object key ordering retain the same A2 capture plan", () => {
    const initial = base();
    initial.binding = {
      ...initial.binding,
      model_bones: [
        { uuid: "bone-staff", name: "staff", parent_uuid: null },
        { uuid: "bone-detail", name: "detail", parent_uuid: "bone-staff" },
      ],
      source_refs: ["approved:front", "approved:side"],
    };
    const before = structuredClone(initial);
    const reordered: AttachableContextPreviewInput = {
      expected: {
        holder_pose_label: initial.expected.holder_pose_label,
        reference_image_fingerprint: initial.expected.reference_image_fingerprint,
        runtime_build_fingerprint: initial.expected.runtime_build_fingerprint,
        holder_pose_fingerprint: initial.expected.holder_pose_fingerprint,
        holder_fingerprint: initial.expected.holder_fingerprint,
        asset_fingerprint: initial.expected.asset_fingerprint,
      },
      binding: {
        source_refs: [...initial.binding.source_refs].reverse(),
        binding: { preview_slot: "main_hand", strategy: "ITEM_SLOT" },
        holder: {
          bone_names: [...initial.binding.holder.bone_names].reverse(),
          entity_identifier: initial.binding.holder.entity_identifier,
        },
        model_bones: [...initial.binding.model_bones].reverse().map(bone => ({
          parent_uuid: bone.parent_uuid, name: bone.name, uuid: bone.uuid,
        })),
        target_bone_uuid: initial.binding.target_bone_uuid,
        geometry_identifier: initial.binding.geometry_identifier,
        item_identifier: initial.binding.item_identifier,
        attachable_identifier: initial.binding.attachable_identifier,
        expected_project_uuid: initial.binding.expected_project_uuid,
      },
    };
    const planned = planBedrockAttachableContextPreview(initial);
    expect(planBedrockAttachableContextPreview(reordered).plan_id).toBe(planned.plan_id);
    expect(reviewBedrockAttachableContextCapture(reordered, claim(initial)).state)
      .toBe("CLAIMS_READY_FOR_HUMAN_VISUAL_REVIEW");
    expect(initial).toEqual(before);
  });

  test("no capture remains incomplete and no issued claim can create a PASS", () => {
    const r = reviewBedrockAttachableContextCapture(base(), null);
    expect(r.state).toBe("CAPTURE_NOT_PROVIDED");
    expect(r.missing_views).toHaveLength(3);
    const claimed = reviewBedrockAttachableContextCapture(base(), claim());
    expect(claimed.state).toBe("CLAIMS_READY_FOR_HUMAN_VISUAL_REVIEW");
    expect(claimed.missing_views).toEqual([]);
    expect(claimed.review_gates).toContain("CALLER_CAPTURE_NOT_NATIVELY_ATTESTED");
    expect(claimed.visual_verified).toBe(false);
    expect(claimed.minecraft_verified).toBe(false);
  });

  test("missing perspective cannot masquerade as complete holder fitting", () => {
    const missing = claim();
    missing.captures = missing.captures.slice(0, 2);
    const r = reviewBedrockAttachableContextCapture(base(), missing);
    expect(r.state).toBe("CAPTURE_SET_INCOMPLETE");
    expect(r.missing_views).toEqual(["THIRD_PERSON_SIDE"]);
  });

  test("revised asset, holder, pose, reference, or runtime build retire old captures", () => {
    const original = base();
    const baseline = claim(original);
    for (const key of [
      "asset_fingerprint", "holder_fingerprint", "holder_pose_fingerprint",
      "runtime_build_fingerprint", "reference_image_fingerprint",
    ] as const) {
      const updated = base();
      updated.expected[key] = sha("9");
      expect(reviewBedrockAttachableContextCapture(updated, baseline).state)
        .toBe("STALE_CAPTURE_SOURCE");
    }
    const edited = base();
    edited.binding = { ...edited.binding, target_bone_uuid: "not-a-bone" };
    expect(() => planBedrockAttachableContextPreview(edited))
      .toThrow("ATTACHABLE_MODEL_TARGET_BONE_NOT_FOUND");
  });

  test("material bone, holder and source edits still expire previous A2 claims", () => {
    const initial = base();
    const old = claim(initial);
    const changed = [
      { ...initial.binding,
        model_bones: [{ uuid: "bone-staff", name: "staff_v2", parent_uuid: null }] },
      { ...initial.binding,
        holder: { ...initial.binding.holder,
          bone_names: [...initial.binding.holder.bone_names, "newBone"] } },
      { ...initial.binding,
        source_refs: [...initial.binding.source_refs, "approved:side"] },
    ];
    for (const binding of changed) {
      const revised = { ...initial, binding };
      expect(planBedrockAttachableContextPreview(revised).plan_id)
        .not.toBe(old.plan_id);
      expect(reviewBedrockAttachableContextCapture(revised, old).state)
        .toBe("STALE_CAPTURE_SOURCE");
    }
    const direct = base();
    direct.binding = { ...direct.binding,
      binding: { strategy: "DIRECT_BONE", holder_bone_name: "rightItem" } };
    const first = planBedrockAttachableContextPreview(direct);
    const second = planBedrockAttachableContextPreview({ ...direct, binding: {
      ...direct.binding, binding: { strategy: "DIRECT_BONE", holder_bone_name: "body" },
    } });
    expect(first.plan_id).not.toBe(second.plan_id);
  });

  test("swapped identity, slot or plan handle fails closed as stale", () => {
    const original = base();
    for (const changes of [
      { project_uuid: "other-project" },
      { attachable_identifier: "demo:other" },
      { holder_entity_identifier: "demo:other" },
      { geometry_identifier: "geometry.other" },
      { target_model_bone_uuid: "bone-other" },
      { item_slot: "off_hand" as const },
      { plan_id: "attachable-context:stale" },
    ]) {
      const bad = { ...claim(original), ...changes };
      const r = reviewBedrockAttachableContextCapture(original, bad);
      expect(r.state).toBe("STALE_CAPTURE_SOURCE");
      expect(r.reason).toBe("SOURCE_IDENTITY_CHANGED");
    }
  });

  test("exactly one image per contextual view, no duplicate identity", () => {
    const dup = claim();
    dup.captures = [dup.captures[0]!, dup.captures[0]!];
    expect(() => reviewBedrockAttachableContextCapture(base(), dup))
      .toThrow("ATTACHABLE_CONTEXT_CAPTURE_VIEW_INVALID_OR_DUPLICATE");
    const invalid = claim();
    invalid.captures = [{
      perspective: "front" as AttachableContextCaptureEvidence["captures"][number]["perspective"],
      image_sha256: sha("a"), evidence_handle: "bad",
    }];
    expect(() => reviewBedrockAttachableContextCapture(base(), invalid))
      .toThrow("ATTACHABLE_CONTEXT_CAPTURE_VIEW_INVALID_OR_DUPLICATE");
  });

  test("hash labels are not accepted as real pixel inspection", () => {
    const bad = claim();
    bad.captures = bad.captures.map((capture, i) =>
      i === 1 ? { ...capture, image_sha256: "not-image-bytes" } : capture
    );
    expect(() => reviewBedrockAttachableContextCapture(base(), bad))
      .toThrow("ATTACHABLE_CONTEXT_FINGERPRINT_INVALID");
    const duplicateBytes = claim();
    duplicateBytes.captures = duplicateBytes.captures.map((capture, i) =>
      i === 1 ? { ...capture, image_sha256: duplicateBytes.captures[0]!.image_sha256 }
        : capture
    );
    const r = reviewBedrockAttachableContextCapture(base(), duplicateBytes);
    expect(r.review_gates).toContain("SAME_IMAGE_BYTES_REQUIRE_INDEPENDENT_REVIEW");
    expect(r.visual_verified).toBe(false);
  });

  test("missing source identity or malformed fingerprint cannot create a plan", () => {
    const broken = base();
    broken.expected.runtime_build_fingerprint = "latest";
    expect(() => planBedrockAttachableContextPreview(broken))
      .toThrow("ATTACHABLE_CONTEXT_FINGERPRINT_INVALID");
    const wrong = base();
    wrong.expected.holder_pose_label = " ";
    expect(() => planBedrockAttachableContextPreview(wrong))
      .toThrow("ATTACHABLE_CONTEXT_SOURCE_INVALID");
  });

  test("direct bone remains rig review even with complete capture claims", () => {
    const input = base();
    input.binding = {
      ...input.binding,
      binding: { strategy: "DIRECT_BONE", holder_bone_name: "body" },
    };
    const plan = planBedrockAttachableContextPreview(input);
    expect(plan.binding_strategy).toBe("DIRECT_BONE");
    expect(plan.item_slot).toBeNull();
    expect(plan.review_gates).toContain("DIRECT_BONE_HOLDER_RIG_REVIEW_REQUIRED");
    const r = reviewBedrockAttachableContextCapture(input, claim(input));
    expect(r.state).toBe("CLAIMS_READY_FOR_HUMAN_VISUAL_REVIEW");
    expect(r.review_gates).toContain("DIRECT_BONE_RIG_REVIEW_REQUIRED");
    expect(r.native_verified).toBe(false);
  });

  test("source reviewer never substitutes isolated model images for holder composite", async () => {
    const source = await Bun.file("lib/bedrock/attachableContextPreview.ts").text();
    expect(source).toContain("NATIVE_HOLDER_COMPOSITE_REQUIRED");
    expect(source).toContain('existing_capture_route: "capture_model_views"');
    expect(source).not.toContain("createTool(");
    expect(source).not.toContain("Undo.");
    expect(source).not.toContain("captureScreenshot(");
  });
});

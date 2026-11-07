import { describe, expect, test } from "bun:test";
import { planBedrockAttachableBinding, type AttachableBindingInput } from
  "@/lib/bedrock/attachableBinding";

function sample(change: Partial<AttachableBindingInput> = {}): AttachableBindingInput {
  return {
    expected_project_uuid: "project-uuid",
    attachable_identifier: "demo:runic_sword",
    item_identifier: "demo:runic_sword",
    geometry_identifier: "geometry.runic_sword",
    target_bone_uuid: "bone-main",
    model_bones: [
      { uuid: "bone-main", name: "bb_main", parent_uuid: null },
      { uuid: "bone-blade", name: "blade", parent_uuid: "bone-main" },
    ],
    holder: {
      entity_identifier: "minecraft:player",
      bone_names: ["rightItem", "leftItem", "head", "body"],
    },
    binding: { strategy: "ITEM_SLOT", preview_slot: "main_hand" },
    source_refs: ["approved:front", "approved:side"],
    ...change,
  };
}

describe("A1 Bedrock attachable source binding (no native pass)", () => {
  test("main-hand binding is canonical, immutable, never native verified", () => {
    const input = sample();
    const snapshot = structuredClone(input);
    expect(planBedrockAttachableBinding(input)).toMatchObject({
      state: "SOURCE_SLOT_BINDING_PLANNED",
      selected_model_bone: { uuid: "bone-main", name: "bb_main" },
      candidate_geometry_binding: "q.item_slot_to_bone_name(context.item_slot)",
      preview_slot: "main_hand",
      native_verified: false,
      minecraft_verified: false,
    });
    expect(planBedrockAttachableBinding(input).review_gates)
      .toContain("HOLDER_SLOT_RESOLUTION_UNVERIFIED");
    expect(input).toEqual(snapshot);
  });

  test("off-hand binding remains runtime-selected even with unusual holder names", () => {
    const result = planBedrockAttachableBinding(sample({
      binding: { strategy: "ITEM_SLOT", preview_slot: "off_hand" },
      holder: { entity_identifier: "demo:skeleton",
        bone_names: ["customLeftGrip", "customRightGrip"] },
    }));
    expect(result.preview_slot).toBe("off_hand");
    expect(result.candidate_geometry_binding)
      .toBe("q.item_slot_to_bone_name(context.item_slot)");
    expect(result.review_gates).toContain("HOLDER_SLOT_RESOLUTION_UNVERIFIED");
  });

  test("direct binding reviews exact holder bone, does not synthesize a rig", () => {
    const direct = planBedrockAttachableBinding(sample({
      binding: { strategy: "DIRECT_BONE", holder_bone_name: "head" },
    }));
    expect(direct.state).toBe("DIRECT_BONE_REQUIRES_RIG_REVIEW");
    expect(direct.candidate_geometry_binding).toBeNull();
    expect(direct.review_gates).toContain("DIRECT_BONE_COMBINED_RIG_REQUIRED");
    expect(() => planBedrockAttachableBinding(sample({
      binding: { strategy: "DIRECT_BONE", holder_bone_name: "imaginary" },
    }))).toThrow("ATTACHABLE_HOLDER_TARGET_BONE_NOT_FOUND");
  });

  test("never renames a geometry identifier or an item ID", () => {
    expect(() => planBedrockAttachableBinding(sample({
      item_identifier: "demo:wrong_item",
    }))).toThrow("ATTACHABLE_ITEM_IDENTIFIER_MISMATCH");
    expect(() => planBedrockAttachableBinding(sample({
      item_identifier: "demo:../wrong_item",
    }))).toThrow("ATTACHABLE_BEDROCK_IDENTIFIER_INVALID");
    expect(() => planBedrockAttachableBinding(sample({
      attachable_identifier: "unqualified",
    }))).toThrow("ATTACHABLE_BEDROCK_IDENTIFIER_INVALID");
    expect(() => planBedrockAttachableBinding(sample({
      geometry_identifier: "runic_sword",
    }))).toThrow("ATTACHABLE_GEOMETRY_IDENTIFIER_NOT_CANONICAL");
  });

  test("explicit item mapping needs opt-in and never claims Resource Pack installation", () => {
    const review = planBedrockAttachableBinding(sample({
      item_identifier: "demo:alternative_sword",
      explicit_item_mapping: true,
    }));
    expect(review.explicit_item_mapping_required).toBe(true);
    expect(review.item_identifier).toBe("demo:alternative_sword");
    expect(review.review_gates).toContain("EXPLICIT_ITEM_MAPPING_NOT_COMPILED");
    expect(review.candidate_geometry_binding)
      .toBe("q.item_slot_to_bone_name(context.item_slot)");
    expect(review.minecraft_verified).toBe(false);
    expect(() => planBedrockAttachableBinding(sample({
      item_identifier: "demo:alternative_sword",
      explicit_item_mapping: false,
    }))).toThrow("ATTACHABLE_ITEM_IDENTIFIER_MISMATCH");
    expect(() => planBedrockAttachableBinding(sample({
      explicit_item_mapping: "true" as unknown as boolean,
    }))).toThrow("ATTACHABLE_EXPLICIT_ITEM_MAPPING_INVALID");
    expect(planBedrockAttachableBinding(sample())
      .explicit_item_mapping_required).toBe(false);
  });

  test("ambiguous, orphaned, cyclic and wrong model bone identities refuse", () => {
    const root = { uuid: "root", name: "root", parent_uuid: null };
    for (const model_bones of [
      [root, { uuid: "root", name: "other", parent_uuid: null }],
      [root, { uuid: "other", name: "root", parent_uuid: null }],
      [root, { uuid: "child", name: "child", parent_uuid: "missing" }],
      [{ uuid: "a", name: "a", parent_uuid: "b" },
       { uuid: "b", name: "b", parent_uuid: "a" }],
    ]) {
      expect(() => planBedrockAttachableBinding(sample({
        model_bones, target_bone_uuid: model_bones[0]!.uuid,
      }))).toThrow();
    }
    expect(() => planBedrockAttachableBinding(sample({
      target_bone_uuid: "unknown",
    }))).toThrow("ATTACHABLE_MODEL_TARGET_BONE_NOT_FOUND");
  });

  test("rejects nested item-slot target and unproven slot category", () => {
    expect(() => planBedrockAttachableBinding(sample({
      target_bone_uuid: "bone-blade",
    }))).toThrow("ATTACHABLE_SLOT_TARGET_MUST_BE_TOP_LEVEL_BONE");
    expect(() => planBedrockAttachableBinding(sample({
      binding: { strategy: "ITEM_SLOT", preview_slot: "head" as "main_hand" },
    }))).toThrow("ATTACHABLE_SLOT_UNSUPPORTED_OR_UNVERIFIED");
  });

  test("missing or nonstring UUID/name/parent never pass RegExp coercion", () => {
    const malformed = [
      { uuid: undefined, name: "root", parent_uuid: null },
      { uuid: null, name: "root", parent_uuid: null },
      { uuid: "uuid", name: undefined, parent_uuid: null },
      { uuid: "uuid", name: "root", parent_uuid: undefined },
      { uuid: "uuid", name: "root", parent_uuid: 7 },
    ];
    for (const bone of malformed) {
      expect(() => planBedrockAttachableBinding(sample({
        model_bones: [bone as unknown as AttachableBindingInput["model_bones"][number]],
        target_bone_uuid: "uuid",
      }))).toThrow("ATTACHABLE_MODEL_BONE_IDENTITY_INVALID");
    }
  });

  test("holder and source identities are unambiguous and bounded", () => {
    for (const bone_names of [[], ["head", "head"], ["head", ""]]) {
      expect(() => planBedrockAttachableBinding(sample({
        holder: { entity_identifier: "minecraft:player", bone_names },
      }))).toThrow();
    }
    for (const source_refs of [[], ["approved", "approved"], [""]]) {
      expect(() => planBedrockAttachableBinding(sample({ source_refs })))
        .toThrow("ATTACHABLE_SOURCE_REFERENCES_INVALID");
    }
  });
});

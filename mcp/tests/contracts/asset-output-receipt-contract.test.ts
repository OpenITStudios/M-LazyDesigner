import { describe, expect, test } from "bun:test";
import { planAssetOutputRequirements } from "@/lib/product/assetOutputContracts";
import { reviewAssetOutputReceipts } from "@/lib/receipts/assetOutput";

const HASH = "sha256:" + "a".repeat(64);
const plan = (asset_profile_id: "entity" | "particle" | "item_icon",
  requested: string[] = []) =>
  planAssetOutputRequirements({ asset_profile_id, requested });

function exported(
  codecId: "project" | "bedrock" | "bedrock_animation",
  overrides: Record<string, unknown> = {}
) {
  const path = codecId === "project" ? "/pack/asset.bbmodel" : "/pack/model.geo.json";
  return {
    project_format: "bedrock",
    codec: { id: codecId },
    project: {
      uuid: "project-1", saved: true,
      save_path: codecId === "project" ? path : "/pack/asset.bbmodel",
      export_path: codecId === "bedrock" ? path : null,
      export_codec: codecId === "bedrock" ? "bedrock" : null,
    },
    byte_length: 128,
    compiled_payload_sha256: HASH,
    compiled_payload_sha256_scope: "NATIVE_CODEC_OUTPUT_BYTES",
    file_integrity_state: "READBACK_MATCHED",
    written_file_sha256: HASH,
    save_behavior: codecId === "project" ? "NATIVE_PROJECT_SAVE"
      : codecId === "bedrock" ? "NATIVE_BEDROCK_EXPORT" : "COMPILE_ONLY",
    wrote_to_path: codecId === "bedrock_animation" ? null : path,
    truncated: false,
    content: codecId === "bedrock_animation" ? "{\"animations\":{}}" : null,
    ...(codecId === "bedrock" ? { geometry_export_identity: {
      state: "COMPILED_GEOMETRY_IDENTITIES_VALIDATED", geometry_count: 1,
    } } : {}),
    ...(codecId === "bedrock_animation" ? { animation_export_identity: {
      state: "SOURCE_CLIP_IDENTITIES_MATCHED",
      source_clip_count: 1, compiled_clip_count: 1,
    }, file_integrity_state: "NOT_WRITTEN", written_file_sha256: null } : {}),
    ...overrides,
  };
}

function observe(deliverable_id: string, structured_content: unknown,
  capability = "export_model") {
  return { deliverable_id, structured_content, capability };
}

function particleReceipt(wrote: string | null = "/pack/particles/spark.json") {
  return {
    valid: true, artifact_ready: true,
    source_path: null, wrote_to_path: wrote,
    preview_path: null, preview_error: null,
    byte_length: 80, operation_count: 1,
    summary: { identifier: "test:spark", component_count: 1, diagnostics: [] },
    writes: wrote ? [{ kind: "particle", path: wrote, byte_length: 80,
      replaced_existing: false }] : [],
  };
}

describe("Asset Output receipt bridge against current native producers", () => {
  test("Entity .bbmodel receipt reports native readback but never a Finalization PASS", () => {
    const reviewed = reviewAssetOutputReceipts({
      plan: plan("entity"), expected_project_uuid: "project-1",
      observations: [observe("editable_bbmodel", exported("project"))],
    });
    expect(reviewed.rows).toHaveLength(1);
    expect(reviewed.rows[0].state).toBe("FILE_READBACK_REPORTED");
    expect(reviewed.rows[0].receipt_provenance).toBe("CALLER_SUPPLIED_NOT_AUTHENTICATED");
    expect(reviewed.rows[0].current_asset_revision_verified).toBe(false);
    expect(reviewed.rows[0].visual_approved).toBe(false);
    expect(reviewed.finalization_ready).toBe(false);
    expect(reviewed.minecraft_verified).toBe(false);
  });

  test("Bedrock geometry needs matching export identity, lifecycle, and readback hash", () => {
    const entity = plan("entity", ["entity_geometry_json"]);
    const good = reviewAssetOutputReceipts({
      plan: entity, expected_project_uuid: "project-1",
      observations: [observe("entity_geometry_json", exported("bedrock"))],
    });
    expect(good.rows[1].state).toBe("FILE_READBACK_REPORTED");
    const bad = [
      exported("bedrock", { written_file_sha256: "sha256:" + "b".repeat(64) }),
      exported("bedrock", { geometry_export_identity: { geometry_count: 1 } }),
      exported("bedrock", { project: { uuid: "project-2" } }),
      exported("bedrock", { project: { uuid: "project-1", saved: true,
        export_path: "/pack/other.geo.json", export_codec: "bedrock" } }),
      exported("bedrock", { save_behavior: "COMPILE_ONLY" }),
    ];
    for (const native of bad) {
      const checked = reviewAssetOutputReceipts({
        plan: entity, expected_project_uuid: "project-1",
        observations: [observe("entity_geometry_json", native)],
      });
      expect(checked.rows[1].state).toBe("RECEIPT_REJECTED");
    }
    expect(reviewAssetOutputReceipts({
      plan: entity,
      observations: [observe("entity_geometry_json", exported("bedrock"))],
    }).rows[1].state).toBe("RECEIPT_REJECTED");
  });

  test("SIZE_ONLY and compile-only never count as file readback", () => {
    const entity = plan("entity", ["entity_geometry_json"]);
    const sizeOnly = reviewAssetOutputReceipts({
      plan: entity, expected_project_uuid: "project-1",
      observations: [observe("entity_geometry_json", exported("bedrock", {
        file_integrity_state: "SIZE_ONLY", written_file_sha256: null,
      }))],
    });
    expect(sizeOnly.rows[1].state).toBe("WRITE_SIZE_ONLY_REPORTED");
    const compile = reviewAssetOutputReceipts({
      plan: entity, expected_project_uuid: "project-1",
      observations: [observe("entity_geometry_json", exported("bedrock", {
        save_behavior: "COMPILE_ONLY", wrote_to_path: null,
        file_integrity_state: "NOT_WRITTEN", content: "{\"minecraft:geometry\":[]}",
        written_file_sha256: null,
      }))],
    });
    expect(compile.rows[1].state).toBe("COMPILE_ONLY_REPORTED");
    expect(compile.finalization_ready).toBe(false);
    expect(compile.rows[1].current_asset_revision_verified).toBe(false);
  });

  test("Animation codec returns content only, not a saved animation FILE", () => {
    const entity = plan("entity", ["entity_animation_json"]);
    const review = reviewAssetOutputReceipts({
      plan: entity, expected_project_uuid: "project-1",
      observations: [observe("entity_animation_json", exported("bedrock_animation"))],
    });
    expect(review.rows[1].state).toBe("COMPILE_ONLY_REPORTED");
    expect(review.rows[1].reason).toBe("ANIMATION_FILE_PERSISTENCE_REQUIRED");
    const truncated = reviewAssetOutputReceipts({
      plan: entity, expected_project_uuid: "project-1",
      observations: [observe("entity_animation_json", exported("bedrock_animation", {
        truncated: true,
      }))],
    });
    expect(truncated.rows[1].state).toBe("RECEIPT_REJECTED");
  });

  test("Particle existing write receipt does not claim PNG or file readback", () => {
    const reviewed = reviewAssetOutputReceipts({
      plan: plan("particle"), observations: [
        observe("particle_definition_json", particleReceipt(), "manage_particle"),
      ],
    });
    expect(reviewed.rows[0].state).toBe("PARTICLE_WRITE_REPORTED");
    expect(reviewed.rows[1].state).toBe("NATIVE_ROUTE_UNAVAILABLE");
    expect(reviewed.unresolved_conditionals).toEqual(["particle_texture_png"]);
    expect(reviewed.finalization_ready).toBe(false);
    const previewOnly = reviewAssetOutputReceipts({
      plan: plan("particle"),
      observations: [observe("particle_definition_json", particleReceipt(null), "manage_particle")],
    });
    expect(previewOnly.rows[0].state).toBe("RECEIPT_REJECTED");
  });

  test("Unwired 2D output and review cannot be spoofed by Entity exports", () => {
    const icon = plan("item_icon");
    const review = reviewAssetOutputReceipts({
      plan: icon, observations: [observe("item_icon_png", exported("bedrock"))],
    });
    expect(review.rows[0].state).toBe("NATIVE_ROUTE_UNAVAILABLE");
    expect(review.rows[1].state).toBe("NATIVE_ROUTE_UNAVAILABLE");
    expect(review.finalization_ready).toBe(false);
  });

  test("Unknown/duplicate observations and forged plan fail closed", () => {
    const entity = plan("entity");
    expect(() => reviewAssetOutputReceipts({
      plan: entity, observations: [observe("item_icon_png", {})],
    })).toThrow("ASSET_OUTPUT_RECEIPT_UNPLANNED_OBSERVATION");
    expect(() => reviewAssetOutputReceipts({
      plan: entity, observations: [
        observe("editable_bbmodel", exported("project")),
        observe("editable_bbmodel", exported("project")),
      ],
    })).toThrow("ASSET_OUTPUT_RECEIPT_DUPLICATE_OBSERVATION");
    expect(() => reviewAssetOutputReceipts({
      plan: { ...entity, deliverables: [] }, observations: [],
    })).toThrow("ASSET_OUTPUT_RECEIPT_PLAN_REQUIRED_MISSING");
    expect(() => reviewAssetOutputReceipts({
      plan: { ...entity, native_verified: true as never }, observations: [],
    })).toThrow("ASSET_OUTPUT_RECEIPT_PLAN_STATE_INVALID");
    expect(() => reviewAssetOutputReceipts({
      plan: { ...entity, unresolved_conditionals: ["particle_texture_png"],
        state: "CONDITIONAL_REFERENCE_UNRESOLVED" }, observations: [],
    })).toThrow("ASSET_OUTPUT_RECEIPT_PLAN_CONDITIONAL_INVALID");
    const particle = plan("particle");
    expect(() => reviewAssetOutputReceipts({
      plan: { ...particle, unresolved_conditionals: [] }, observations: [],
    })).toThrow("ASSET_OUTPUT_RECEIPT_PLAN_STATE_INVALID");
    const wrong = reviewAssetOutputReceipts({
      plan: entity, observations: [
        observe("editable_bbmodel", exported("project"), "manage_particle"),
      ],
    });
    expect(wrong.rows[0].state).toBe("RECEIPT_REJECTED");
    expect(wrong.rows[0].reason).toBe("RECEIPT_WRONG_NATIVE_CAPABILITY");
    expect(() => reviewAssetOutputReceipts({
      plan: entity, observations: null as never,
    })).toThrow("ASSET_OUTPUT_RECEIPT_OBSERVATIONS_INVALID");
  });
});

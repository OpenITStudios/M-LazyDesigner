import { describe, expect, test } from "bun:test";
import {
  reviewBedrockBlockInteractionBounds,
  type BlockInteractionPlanningInput,
} from "@/lib/bedrock/blockInteractionBounds";

function fixture(
  change: Partial<BlockInteractionPlanningInput> = {}
): BlockInteractionPlanningInput {
  return {
    visual: {
      expected_project_uuid: "native-project-not-verified",
      block_identifier: "demo:lantern",
      geometry_identifier: "geometry.lantern",
      compatibility: {
        format_version: "1.26.30",
        has_geometry_component: true,
        has_material_instances_component: true,
        features: [],
      },
      cubes: [{ uuid: "main-cube", bone_name: "bb_main",
        from: [-8, 0, -8], to: [8, 16, 8], box_uv: true }],
      materials: [{ key: "*", texture_key: "lantern", render_method: "opaque" }],
      placement_intent: "SPARSE",
    },
    ...change,
  };
}
const review = (input: BlockInteractionPlanningInput) =>
  reviewBedrockBlockInteractionBounds(input);

describe("C1 Bedrock block-local collision and selection preview", () => {
  test("omitted collision and selection are DEFAULT_FULL, not disabled", () => {
    const input = fixture();
    const original = structuredClone(input);
    const result = review(input);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(result.derived_version_features).toEqual([]);
    expect(result.collision.mode).toBe("DEFAULT_FULL");
    expect(result.selection.mode).toBe("DEFAULT_FULL");
    expect(result.collision.boxes).toEqual([{
      min: [-8, 0, -8], max: [8, 16, 8],
    }]);
    expect(result.comparison.collision_extent).toBe("WITHIN_VISUAL_ENVELOPE");
    expect(result.comparison.selection_extent).toBe("WITHIN_VISUAL_ENVELOPE");
    expect(result.warnings)
      .toContain("DEFAULT_COMPONENTS_ARE_NOT_AUTHORED_COMPONENTS");
    expect(result.native_verified).toBe(false);
    expect(result.minecraft_verified).toBe(false);
    expect(result.gameplay_verified).toBe(false);
    expect(result.pack_written).toBe(false);
    expect(input).toEqual(original);
  });

  test("disabled collision never implies disabled selection or vice versa", () => {
    const result = review(fixture({
      collision_box: false,
      selection_box: true,
    }));
    expect(result.collision.mode).toBe("DISABLED");
    expect(result.collision.boxes).toEqual([]);
    expect(result.selection.mode).toBe("FULL");
    expect(result.derived_version_features).toEqual(["collision_box","selection_box"]);
    expect(result.comparison.collision_extent).toBe("NO_INTERACTION_AREA");
    expect(result.comparison.interaction_envelopes_differ).toBe(true);
    expect(result.warnings).toContain("INTERACTION_ENVELOPES_DIFFER");
  });

  test("single custom selection box may be narrower than collision", () => {
    const result = review(fixture({
      collision_box: true,
      selection_box: { origin: [-3, 0, -3], size: [6, 10, 6] },
    }));
    expect(result.selection.mode).toBe("CUSTOM");
    expect(result.selection.envelope).toEqual({
      min: [-3, 0, -3], max: [3, 10, 3],
    });
    expect(result.comparison.interaction_envelopes_differ).toBe(true);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
  });

  test("multi collision is source-planned and version-gated through F0", () => {
    const collision_box = [
      { origin: [-2, 0, -2], size: [4, 16, 4] },
      { origin: [-8, 0, -8], size: [16, 8, 16] },
    ] as const;
    const modern = review(fixture({ collision_box }));
    expect(modern.collision.mode).toBe("MULTI");
    expect(modern.collision.boxes).toHaveLength(2);
    expect(modern.derived_version_features).toContain("multi_collision_boxes");
    expect(modern.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(modern.warnings)
      .toContain("COLLISION_ARRAY_NATIVE_BEHAVIOR_UNVERIFIED");
    const old = review(fixture({
      collision_box,
      visual: { ...fixture().visual, compatibility: {
        ...fixture().visual.compatibility, format_version: "1.25.99",
      } },
    }));
    expect(old.state).toBe("BLOCKED_BY_DECLARED_COMPATIBILITY");
    expect(old.visual.compatibility.issues).toContainEqual({
      code: "FORMAT_TOO_OLD",
      feature: "multi_collision_boxes",
      minimum_format_version: "1.26.0",
    });
  });

  test("taller collision up to Y=24 is separately version-gated, not selection", () => {
    const tall = { origin: [-4, 0, -4], size: [8, 24, 8] } as const;
    const modern = review(fixture({ collision_box: tall }));
    expect(modern.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(modern.derived_version_features).toContain("extended_collision_height");
    expect(modern.collision.envelope?.max[1]).toBe(24);
    expect(modern.warnings).toContain("EXTENDED_COLLISION_HEIGHT_NATIVE_REVIEW");
    const old = review(fixture({ collision_box: tall, visual: {
      ...fixture().visual,
      compatibility: { ...fixture().visual.compatibility, format_version: "1.25.99" },
    } }));
    expect(old.visual.compatibility.issues).toContainEqual({
      code: "FORMAT_TOO_OLD",
      feature: "extended_collision_height",
      minimum_format_version: "1.26.0",
    });
    expect(old.state).toBe("BLOCKED_BY_DECLARED_COMPATIBILITY");
    expect(() => review(fixture({ selection_box: tall })))
      .toThrow("BLOCK_INTERACTION_BOX_OUTSIDE_BLOCK_RANGE");
  });

  test("no axis can escape block-local limits or accept negative size", () => {
    for (const box of [
      { origin: [-9, 0, -8], size: [16, 16, 16] },
      { origin: [-8, 0, -8], size: [17, 16, 16] },
      { origin: [-8, 17, -8], size: [16, 1, 16] },
      { origin: [-8, 0, -8], size: [16, 25, 16] },
    ]) {
      expect(() => review(fixture({ collision_box: box })))
        .toThrow("BLOCK_INTERACTION_BOX_OUTSIDE_BLOCK_RANGE");
    }
    expect(() => review(fixture({
      collision_box: { origin: [-8, 0, -8], size: [-1, 16, 16] },
    }))).toThrow("BLOCK_INTERACTION_BOX_NEGATIVE_SIZE");
  });

  test("selection array and empty collision array cannot be misread as disabled", () => {
    expect(() => review(fixture({
      selection_box: [
        { origin: [-8, 0, -8], size: [16, 16, 16] },
      ] as unknown as BlockInteractionPlanningInput["selection_box"],
    }))).toThrow("BLOCK_INTERACTION_SELECTION_ARRAY_UNSUPPORTED");
    expect(() => review(fixture({ collision_box: [] })))
      .toThrow("BLOCK_INTERACTION_COLLISION_ARRAY_BUDGET_OR_EMPTY");
    expect(() => review(fixture({
      collision_box: Array.from({length:17},()=>({
        origin: [-2,0,-2], size: [4,4,4],
      })),
    }))).toThrow("BLOCK_INTERACTION_COLLISION_ARRAY_BUDGET_OR_EMPTY");
  });

  test("degenerate zero thickness remains a review warning, not invented physics", () => {
    const r = review(fixture({
      collision_box: { origin: [-2, 0, -2], size: [4, 0, 4] },
    }));
    expect(r.collision.contains_zero_size_box).toBe(true);
    expect(r.warnings).toContain("INTERACTION_ZERO_THICKNESS_REVIEW");
    expect(r.gameplay_verified).toBe(false);
  });

  test("relative-to-visual envelope status never means physical contact pass", () => {
    const smallVisual = { ...fixture().visual, cubes: [{
      uuid: "center", bone_name: "bb_main",
      from: [-2, 0, -2] as const, to: [2, 8, 2] as const, box_uv: true,
    }] };
    const result = review(fixture({
      visual: smallVisual,
      collision_box: true,
      selection_box: false,
    }));
    expect(result.comparison.collision_extent)
      .toBe("EXTENDS_BEYOND_VISUAL_ENVELOPE");
    expect(result.warnings)
      .toContain("COLLISION_EXTENDS_BEYOND_VISUAL_ENVELOPE");
    expect(result.comparison.selection_extent).toBe("NO_INTERACTION_AREA");
    expect(result.visual_verified).toBe(false);
  });

  test("rotation/absent visible Cubes preserve honest local-only status", () => {
    const rotated = review(fixture({ visual: {
      ...fixture().visual,
      cubes: [{...fixture().visual.cubes[0]!, rotation: [0,90,0]}],
      compatibility: {...fixture().visual.compatibility,
        features:["n_way_visual_rotation"] },
      n_way_rotation_state:"minecraft:cardinal_direction",
    } }));
    expect(rotated.warnings)
      .toContain("ROTATED_OR_INFLATED_GEOMETRY_NEEDS_NATIVE_BOUNDS");
    expect(rotated.warnings)
      .toContain("ROTATED_VISUAL_DOES_NOT_ROTATE_INTERACTION");
    expect(rotated.comparison.visual_scope)
      .toBe("B1_DECLARED_CUBE_LOCAL_ENVELOPE");
    const noVisible = review(fixture({ visual: {
      ...fixture().visual,
      cubes: [{ ...fixture().visual.cubes[0]!, visible: false }],
    } }));
    expect(noVisible.comparison.source_visual_bounds).toBeNull();
    expect(noVisible.comparison.collision_extent)
      .toBe("VISUAL_ENVELOPE_UNAVAILABLE");
    expect(noVisible.warnings)
      .toContain("VISUAL_GEOMETRY_ENVELOPE_UNAVAILABLE");
  });

  test("B1/F0 source blockers are preserved without local downgrade", () => {
    const bad = review(fixture({ visual: {
      ...fixture().visual,
      compatibility: { ...fixture().visual.compatibility,
        has_material_instances_component: false },
    } }));
    expect(bad.state).toBe("BLOCKED_BY_DECLARED_COMPATIBILITY");
    expect(bad.visual.compatibility.issues.map(x=>x.code))
      .toContain("GEOMETRY_MATERIAL_PAIR_REQUIRED");
  });

  test("fingerprint varies by collision and selection while input stays intact", () => {
    const base = fixture();
    const original = structuredClone(base);
    const a = review(base);
    const b = review(fixture({ collision_box: false }));
    const c = review(fixture({ selection_box: false }));
    expect(b.source_fingerprint).not.toBe(a.source_fingerprint);
    expect(c.source_fingerprint).not.toBe(a.source_fingerprint);
    expect(b.source_fingerprint).not.toBe(c.source_fingerprint);
    expect(review(base).source_fingerprint).toBe(a.source_fingerprint);
    expect(base).toEqual(original);
  });

  test("malformed and duplicate upstream F0 feature inventory cannot be normalized away", () => {
    expect(() => review(fixture({ visual: {
      ...fixture().visual,
      compatibility: { ...fixture().visual.compatibility,
        features: null as unknown as string[] },
    } }))).toThrow("BLOCK_INTERACTION_FEATURE_INVENTORY_INVALID");
    expect(() => review(fixture({ visual: {
      ...fixture().visual,
      compatibility: { ...fixture().visual.compatibility,
        features: ["collision_box", "collision_box"] },
    } }))).toThrow("BLOCK_INTERACTION_FEATURE_INVENTORY_AMBIGUOUS");
  });

  test("malformed vectors and explicit unknown inputs fail closed", () => {
    for (const box of [
      { origin: [NaN,0,-8], size:[16,16,16] },
      { origin: [-8,0,-8], size:[16,Infinity,16] },
      { origin: [-8,0], size:[16,16,16] },
      { origin: [-8,0,-8], size:[16,16] },
    ]) {
      expect(() => review(fixture({collision_box:box as BlockInteractionPlanningInput["collision_box"]})))
        .toThrow("BLOCK_INTERACTION_VECTOR_INVALID");
    }
    expect(() => review(fixture({
      collision_box: null as unknown as boolean,
    }))).toThrow("BLOCK_INTERACTION_BOX_INVALID");
  });

  test("C1 is advisory and does not register tools or write gameplay files", async () => {
    const source = await Bun.file("lib/bedrock/blockInteractionBounds.ts").text();
    expect(source).toContain("planBedrockBlockVisual({");
    expect(source).toContain('visual_scope: "B1_DECLARED_CUBE_LOCAL_ENVELOPE"');
    expect(source).not.toContain("createTool(");
    expect(source).not.toContain("Undo.");
    expect(source).not.toContain("writeFile");
  });
});

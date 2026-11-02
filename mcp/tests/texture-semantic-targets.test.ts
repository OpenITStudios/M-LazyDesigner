import { describe, expect, test } from "bun:test";
import {
  buildTextureSemanticCandidates,
  type TextureSemanticFace,
} from "@/lib/texture/semanticTargets";
import {
  inspectNativeTextureSemanticTargets,
} from "@/server/runtime/extensions/texture/semanticTargets";

const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;

function face(
  cube_uuid: string,
  cube_name: string,
  native_material_name: string,
  texture_uuid: string | null = "atlas",
  side: TextureSemanticFace["face"] = "north"
): TextureSemanticFace {
  return { cube_uuid, cube_name, native_material_name, texture_uuid,
    enabled: true, face: side };
}

function candidate(
  result: ReturnType<typeof buildTextureSemanticCandidates>,
  kind: "part" | "native_material",
  label: string
) {
  return (kind === "part" ? result.parts : result.native_materials)
    .find(item => item.normalized_label === label);
}

describe("read-only texturing semantic target discovery", () => {
  test("groups explicitly named native materials without recoloring other parts", () => {
    const result = buildTextureSemanticCandidates([
      face("body", "Armor Plate", "metal", "atlas", "north"),
      face("body", "Armor Plate", "metal", "atlas", "south"),
      face("arm", "Armor Sleeve", "metal", "atlas", "north"),
      face("eye", "Eye", "emblem", "atlas", "north"),
    ]);
    const metal = candidate(result, "native_material", "metal");
    expect(metal).toMatchObject({
      kind: "native_material",
      status: "face_targets_candidate",
      face_count: 3, cube_count: 2, texture_uuid: "atlas",
      uv_ownership_verified: false, mutation_authorized: false,
    });
    expect(metal?.face_targets).toEqual([
      { cube_uuid: "arm", face: "north" },
      { cube_uuid: "body", face: "north" },
      { cube_uuid: "body", face: "south" },
    ]);
    expect(metal?.face_targets).not.toContainEqual({
      cube_uuid: "eye", face: "north",
    });
    expect(candidate(result, "part", "armor plate")?.face_targets).toHaveLength(2);
    expect(result.visual_verdict).toBe("not_evaluated");
  });

  test("label normalization never silently merges different source names or duplicate parts", () => {
    const aliases = buildTextureSemanticCandidates([
      face("a", "Arm_Guard", "metal"),
      face("b", "Arm Guard", "metal"),
    ]);
    expect(candidate(aliases, "part", "arm guard")).toMatchObject({
      status: "review_required",
      face_targets: null,
    });
    expect(candidate(aliases, "part", "arm guard")?.reasons)
      .toContain("NORMALIZED_LABEL_COLLISION");

    const duplicates = buildTextureSemanticCandidates([
      face("left", "Sleeve", "cloth"),
      face("right", "Sleeve", "cloth"),
    ]);
    expect(candidate(duplicates, "part", "sleeve")?.reasons)
      .toContain("AMBIGUOUS_PART_NAME");
    expect(candidate(duplicates, "part", "sleeve")?.face_targets).toBeNull();
    expect(candidate(duplicates, "native_material", "cloth")?.face_targets)
      .toHaveLength(2);
  });

  test("refuses mixed materials, mixed atlases and missing bindings", () => {
    const result = buildTextureSemanticCandidates([
      face("chair", "Chair", "wood", "atlas", "north"),
      face("chair", "Chair", "fabric", "atlas", "south"),
      face("chair", "Chair", "fabric", null, "up"),
      face("table", "Table", "wood", "second", "north"),
    ]);
    const part = candidate(result, "part", "chair");
    expect(part?.status).toBe("review_required");
    expect(part?.reasons).toEqual(expect.arrayContaining([
      "UNRESOLVED_FACE_TEXTURE", "MIXED_NATIVE_MATERIALS",
    ]));
    expect(part?.face_targets).toBeNull();
    expect(candidate(result, "native_material", "wood")?.reasons)
      .toContain("MULTIPLE_OR_MISSING_TEXTURES");
    expect(candidate(result, "native_material", "fabric")?.face_targets)
      .toBeNull();
    expect(result.state).toBe("partial");
  });

  test("no truncated group is returned as an apparently complete face target set", () => {
    const crowded = buildTextureSemanticCandidates(Array.from({ length: 65 },
      (_, i) => face("cube" + i, "Part " + i, "metal")));
    const metal = candidate(crowded, "native_material", "metal");
    expect(metal?.face_count).toBe(65);
    expect(metal?.reasons).toContain("FACE_TARGET_LIMIT");
    expect(metal?.face_targets).toBeNull();

    const tooManyLabels = buildTextureSemanticCandidates(Array.from({length: 15},
      (_, i) => face("cube" + i, "Part " + i, "material" + i)));
    expect(tooManyLabels.omitted_candidate_count).toBeGreaterThan(0);
    expect(tooManyLabels.state).toBe("partial");
    expect(tooManyLabels.returned_face_target_count)
      .toBeLessThanOrEqual(64);
  });

  test("corrupt, duplicate or inconsistent face inventory fails closed", () => {
    const valid = face("a", "Armor", "steel");
    expect(() => buildTextureSemanticCandidates([valid, valid]))
      .toThrow("SEMANTIC_TARGET_DUPLICATE_FACE");
    expect(() => buildTextureSemanticCandidates([
      valid, face("a", "Other", "steel", "atlas", "south"),
    ])).toThrow("SEMANTIC_TARGET_INCONSISTENT_CUBE_NAME");
    expect(() => buildTextureSemanticCandidates([]))
      .toThrow("SEMANTIC_TARGET_INVENTORY_BUDGET");
  });

  test("native adapter resolves only current registered texture objects", () => {
    const global = globalThis as Record<string, unknown>;
    const names = ["Cube", "Texture", "Project", "Outliner", "Format"];
    const saved = names.map(name =>
      [name, Object.getOwnPropertyDescriptor(global, name)] as const);
    try {
      const texture = { uuid: "atlas" };
      const cube = {
        uuid: "armor", name: "Armor",
        faces: Object.fromEntries(FACE_KEYS.map(side => [
          side,
          { enabled: true, material_name: "metal", getTexture: () => texture },
        ])),
      };
      Object.assign(global, {
        Format: { id: "bedrock" },
        Cube: { all: [cube] },
        Texture: { all: [texture] },
        Project: { textures: [texture] },
        Outliner: { elements: [cube] },
      });
      const result = inspectNativeTextureSemanticTargets();
      expect(result.state).toBe("available");
      expect("native_materials" in result && result.native_materials[0])
        .toMatchObject({
          label: "metal", face_count: 6,
          status: "face_targets_candidate",
          texture_uuid: "atlas",
          mutation_authorized: false,
        });
      expect("binding_evidence" in result && result.binding_evidence)
        .toBe("resolved_current_native_objects");

      Object.assign(global, { Project: { textures: [{uuid: "atlas"}] } });
      expect(inspectNativeTextureSemanticTargets().state).toBe("unavailable");
      Object.assign(global, { Format: { id: "java_block" } });
      expect(inspectNativeTextureSemanticTargets().state).toBe("unavailable");
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(global, name, descriptor);
        else delete global[name];
      }
    }
  });
});

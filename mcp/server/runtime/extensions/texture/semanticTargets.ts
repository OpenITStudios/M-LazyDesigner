/// <reference types="blockbench-types" />
import {
  buildTextureSemanticCandidates,
  type TextureSemanticFace,
} from "@/lib/texture/semanticTargets";

const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;
const MAX_CUBES = 256;

function unavailable(reason: string) {
  return {
    state: "unavailable" as const,
    reason,
    scope: "native_cube_and_material_labels" as const,
    mutation_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}

/**
 * Read-only, bounded snapshot for opt-in list_textures coverage diagnostics.
 * No pixel reads, UV claims, Painter changes, Undo, persistent cache or
 * additional Gateway capability. All candidates are advisory.
 */
export function inspectNativeTextureSemanticTargets() {
  if (typeof Format === "undefined" || Format.id !== "bedrock" ||
      typeof Cube === "undefined" || !Array.isArray(Cube.all) ||
      typeof Texture === "undefined" || !Array.isArray(Texture.all) ||
      typeof Project === "undefined" || !Array.isArray(Project?.textures) ||
      typeof Outliner === "undefined" || !Array.isArray(Outliner.elements)) {
    return unavailable("BEDROCK_NATIVE_INVENTORY_UNAVAILABLE");
  }
  if (Cube.all.length < 1 || Cube.all.length > MAX_CUBES) {
    return unavailable("CUBE_INVENTORY_BUDGET");
  }
  const cubes = [...Cube.all];
  const cubeIds = new Set<string>();
  const outliner = new Set<unknown>(Outliner.elements);
  if (outliner.size !== Outliner.elements.length ||
      cubes.some(cube => !outliner.has(cube))) {
    return unavailable("OUTLINER_CUBE_INVENTORY_INCOMPLETE");
  }
  for (const cube of cubes) {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim() ||
        cubeIds.has(cube.uuid)) {
      return unavailable("DUPLICATE_OR_MISSING_CUBE_ID");
    }
    cubeIds.add(cube.uuid);
  }

  const registered = new Set<Texture>(Texture.all);
  const project = new Set<Texture>(Project.textures);
  const textureUuids = new Set<string>();
  if (registered.size !== Texture.all.length ||
      project.size !== Project.textures.length ||
      registered.size !== project.size ||
      [...registered].some(texture => !project.has(texture))) {
    return unavailable("TEXTURE_OBJECT_INVENTORY_INCOMPLETE");
  }
  for (const texture of Texture.all) {
    if (typeof texture.uuid !== "string" || !texture.uuid.trim() ||
        textureUuids.has(texture.uuid)) {
      return unavailable("DUPLICATE_OR_MISSING_TEXTURE_UUID");
    }
    textureUuids.add(texture.uuid);
  }

  const faces: TextureSemanticFace[] = [];
  let resolverFailures = 0;
  for (const cube of cubes) {
    for (const key of FACE_KEYS) {
      const face = cube.faces?.[key];
      const enabled = face?.enabled !== false;
      let textureUuid: string | null = null;
      if (enabled) {
        try {
          if (face && typeof face.getTexture === "function") {
            const actual = face.getTexture();
            if (actual && typeof actual === "object" &&
                registered.has(actual as Texture) &&
                project.has(actual as Texture)) {
              textureUuid = (actual as Texture).uuid;
            }
          }
        } catch {
          // Incomplete native resolution is recorded, never guessed.
        }
        if (textureUuid === null) resolverFailures += 1;
      }
      faces.push({
        cube_uuid: cube.uuid,
        cube_name: typeof cube.name === "string" ? cube.name : "",
        face: key,
        enabled,
        texture_uuid: textureUuid,
        native_material_name:
          face && typeof face.material_name === "string"
            ? face.material_name : "",
      });
    }
  }
  try {
    return {
      ...buildTextureSemanticCandidates(faces),
      binding_evidence: "resolved_current_native_objects" as const,
      texture_revision_attested: false as const,
      native_failed_face_count: resolverFailures,
    };
  } catch {
    return unavailable("SEMANTIC_FACE_INVENTORY_INVALID");
  }
}

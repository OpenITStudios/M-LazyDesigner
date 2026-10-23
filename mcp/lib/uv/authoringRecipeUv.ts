import type {
  CompiledAuthoringRecipe,
  CompiledCubePlacement,
  CompiledSymmetryRelationship,
} from "@/lib/authoringRecipe/contracts";
import type { SemanticUvIsland } from "@/lib/uv/semanticPlanner";

export type CubeFaceKey = "north" | "south" | "east" | "west" | "up" | "down";

const FACE_KEYS: readonly CubeFaceKey[] = ["north", "south", "east", "west", "up", "down"];

function dimensions(placement: CompiledCubePlacement): [number, number, number] {
  const size: [number, number, number] = [
    Math.abs(placement.to[0] - placement.from[0]),
    Math.abs(placement.to[1] - placement.from[1]),
    Math.abs(placement.to[2] - placement.from[2]),
  ];
  if (size.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("UV derivation requires positive finite Cube dimensions for " + placement.id + ".");
  }
  return size;
}

function faceSize(placement: CompiledCubePlacement, face: CubeFaceKey): readonly [number, number] {
  const [x, y, z] = dimensions(placement);
  if (face === "up" || face === "down") return [x, z];
  if (face === "east" || face === "west") return [z, y];
  return [x, y];
}

function mirroredFace(face: CubeFaceKey, axis: "X" | "Y" | "Z"): CubeFaceKey {
  if (axis === "X") {
    if (face === "east") return "west";
    if (face === "west") return "east";
  }
  if (axis === "Y") {
    if (face === "up") return "down";
    if (face === "down") return "up";
  }
  if (axis === "Z") {
    if (face === "north") return "south";
    if (face === "south") return "north";
  }
  return face;
}

function faceId(instanceId: string, face: CubeFaceKey): string {
  return instanceId + ":" + face;
}

function ownerByTarget(symmetry: readonly CompiledSymmetryRelationship[]) {
  const result = new Map<string, CompiledSymmetryRelationship>();
  for (const relation of symmetry) {
    if (result.has(relation.target_instance_id)) {
      throw new Error("UV symmetry target has multiple owners: " + relation.target_instance_id + ".");
    }
    result.set(relation.target_instance_id, relation);
  }
  return result;
}

export type AuthoringRecipeUvOptions = {
  default_cohort?: string;
  cohort_by_semantic_group?: Readonly<Record<string, string>>;
  texel_density_by_cohort?: Readonly<Record<string, number>>;
  allow_rotation?: boolean;
};

export function deriveAuthoringRecipeUvIslands(
  compiled: CompiledAuthoringRecipe,
  options: AuthoringRecipeUvOptions = {}
): SemanticUvIsland[] {
  const byInstance = new Map(compiled.placements.map((placement) => [placement.id, placement]));
  const targetSymmetry = ownerByTarget(compiled.symmetry_relationships);
  const islands: SemanticUvIsland[] = [];

  for (const placement of compiled.placements) {
    const symmetry = targetSymmetry.get(placement.id);
    const cohort =
      (placement.semantic_group && options.cohort_by_semantic_group?.[placement.semantic_group]) ||
      placement.semantic_group ||
      options.default_cohort ||
      "default";

    for (const face of FACE_KEYS) {
      const island: SemanticUvIsland = {
        id: faceId(placement.id, face),
        world_size: faceSize(placement, face),
        cohort,
        texel_density: options.texel_density_by_cohort?.[cohort],
        allow_rotation: options.allow_rotation,
      };

      if (symmetry?.uv_policy === "SHARE") {
        if (symmetry.texture_policy !== "MIRROR") {
          throw new Error(
            "UV SHARE conflicts with UNIQUE texture ownership for symmetry " +
              symmetry.id + ". Allocate independent UV islands for unique markings, " +
              "wear or material treatment."
          );
        }
        const source = byInstance.get(symmetry.source_instance_id);
        if (!source) {
          throw new Error("UV symmetry source instance is missing: " + symmetry.source_instance_id + ".");
        }
        const sourceFace = mirroredFace(face, symmetry.plane.axis);
        const targetSize = faceSize(placement, face);
        const sourceSize = faceSize(source, sourceFace);
        if (targetSize[0] !== sourceSize[0] || targetSize[1] !== sourceSize[1]) {
          throw new Error(
            "UV SHARE requires matching mirrored face dimensions for " +
              faceId(placement.id, face) +
              " and " +
              faceId(source.id, sourceFace) +
              "."
          );
        }
        island.share_with = faceId(source.id, sourceFace);
      }
      islands.push(island);
    }
  }
  return islands;
}

export function expandAffectedUvIds(
  compiled: CompiledAuthoringRecipe,
  affectedInstanceIds: readonly string[]
): string[] {
  const affectedInstances = new Set(affectedInstanceIds);
  const affectedFaces = new Set<string>();
  for (const placement of compiled.placements) {
    if (affectedInstances.has(placement.id)) {
      for (const face of FACE_KEYS) affectedFaces.add(faceId(placement.id, face));
    }
  }
  for (const relation of compiled.symmetry_relationships) {
    if (relation.uv_policy !== "SHARE") continue;
    if (affectedInstances.has(relation.source_instance_id) || affectedInstances.has(relation.target_instance_id)) {
      for (const face of FACE_KEYS) {
        affectedFaces.add(faceId(relation.source_instance_id, face));
        affectedFaces.add(faceId(relation.target_instance_id, face));
      }
    }
  }
  return [...affectedFaces].sort();
}

import type { PublicationCubeManifest } from "@/lib/publication/sourceManifest";

/** Strict, bounded glTF 2.0 GLB envelope and semantic inventory preflight.
 * Khronos glTF-Validator and native Blender reimport remain separately required:
 * this does not certify full spec compliance or visual equality.
 */
export type PublicationGlbInventory = {
  mesh_count: number;
  material_count: number;
  texture_count: number;
  image_count: number;
  primitive_count: number;
};

type GltfRecord = Record<string, unknown>;

function record(value: unknown): value is GltfRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positiveArray(value: unknown): GltfRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(x => !record(x))) {
    throw new Error("PUBLICATION_GLB_INVENTORY_INVALID");
  }
  return value as GltfRecord[];
}
function validIndex(index: unknown, length: number): boolean {
  return Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < length;
}

export function inspectPublicationGlb(
  glb: Buffer,
  expectedMeshes: number,
  expectedMaterials: number,
  expectedCubes?: readonly PublicationCubeManifest[],
): PublicationGlbInventory {
  if (!Buffer.isBuffer(glb) || glb.length < 20 || glb.length > 96 * 1024 * 1024 ||
      glb.toString("ascii", 0, 4) !== "glTF" || glb.readUInt32LE(4) !== 2 ||
      glb.readUInt32LE(8) !== glb.length) {
    throw new Error("PUBLICATION_GLB_HEADER_OR_LENGTH_INVALID");
  }
  if (glb.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error("PUBLICATION_GLB_JSON_CHUNK_MISSING");
  }
  const jsonLength = glb.readUInt32LE(12);
  if (!jsonLength || jsonLength % 4 !== 0 || 20 + jsonLength > glb.length) {
    throw new Error("PUBLICATION_GLB_JSON_CHUNK_INVALID");
  }
  const pointer = 20 + jsonLength;
  if (pointer < glb.length) {
    if (pointer + 8 > glb.length ||
        glb.readUInt32LE(pointer + 4) !== 0x004e4942) {
      throw new Error("PUBLICATION_GLB_BIN_CHUNK_INVALID");
    }
    const binLength = glb.readUInt32LE(pointer);
    if (binLength % 4 !== 0 || pointer + 8 + binLength !== glb.length) {
      throw new Error("PUBLICATION_GLB_BIN_CHUNK_INVALID");
    }
  }
  let json: unknown;
  try {
    json = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength).trimEnd());
  } catch {
    throw new Error("PUBLICATION_GLB_JSON_INVALID");
  }
  if (!record(json) || !record(json.asset) || json.asset.version !== "2.0") {
    throw new Error("PUBLICATION_GLB_VERSION_INVALID");
  }
  const isPng = (bytes: Buffer): boolean =>
    bytes.length >= 24 &&
    bytes.toString("hex", 0, 8) === "89504e470d0a1a0a" &&
    bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 8192 &&
    bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 8192;
  const embeddedPng = (image: GltfRecord, views: GltfRecord[]): boolean => {
    const uri = image.uri;
    if (typeof uri === "string") {
      // A detached source snapshot must never load network or external images.
      if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri) ||
          uri.length > 42 * 1024 * 1024) return false;
      return isPng(Buffer.from(uri.slice("data:image/png;base64,".length), "base64"));
    }
    if (image.mimeType !== "image/png" ||
        !validIndex(image.bufferView, views.length) || pointer >= glb.length) return false;
    const view = views[image.bufferView as number]!;
    const offset = view.byteOffset ?? 0;
    const length = view.byteLength;
    if (!Number.isSafeInteger(offset) || (offset as number) < 0 ||
        !Number.isSafeInteger(length) || (length as number) < 24 ||
        (length as number) > 32 * 1024 * 1024 ||
        pointer + 8 + (offset as number) + (length as number) > glb.length) return false;
    const start = pointer + 8 + (offset as number);
    return isPng(glb.subarray(start, start + (length as number)));
  };
  const meshes = positiveArray(json.meshes);
  const materials = positiveArray(json.materials);
  const accessors = positiveArray(json.accessors);
  const images = Array.isArray(json.images) ? json.images : [];
  const textures = Array.isArray(json.textures) ? json.textures : [];
  const bufferViews = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  if (bufferViews.some(view => !record(view))) throw new Error("PUBLICATION_GLB_BUFFERVIEWS_INVALID");
  if (meshes.length !== expectedMeshes || materials.length !== expectedMaterials ||
      meshes.length < 1 || materials.length < 1 || images.length < 1 ||
      images.some(item => !record(item) || !embeddedPng(item, bufferViews))) {
    throw new Error("PUBLICATION_GLB_SOURCE_INVENTORY_MISMATCH");
  }
  let primitiveCount = 0;
  for (const mesh of meshes) {
    if (!Array.isArray(mesh.primitives) || mesh.primitives.length < 1) {
      throw new Error("PUBLICATION_GLB_PRIMITIVES_MISSING");
    }
    for (const primitive of mesh.primitives) {
      if (!record(primitive) || !record(primitive.attributes) ||
          !validIndex(primitive.attributes.POSITION, accessors.length) ||
          !validIndex(primitive.attributes.TEXCOORD_0, accessors.length) ||
          !validIndex(primitive.material, materials.length)) {
        throw new Error("PUBLICATION_GLB_PRIMITIVE_UV_OR_MATERIAL_INVALID");
      }
      primitiveCount++;
    }
  }
  for (const texture of textures) {
    if (!record(texture) || !validIndex(texture.source, images.length)) {
      throw new Error("PUBLICATION_GLB_TEXTURE_IMAGE_REFERENCE_INVALID");
    }
  }
  for (const material of materials) {
    const pbr = record(material.pbrMetallicRoughness) ? material.pbrMetallicRoughness : {};
    for (const ref of [pbr.baseColorTexture, pbr.metallicRoughnessTexture,
      material.normalTexture, material.emissiveTexture]) {
      if (ref !== undefined && (!record(ref) || !validIndex(ref.index, textures.length))) {
        throw new Error("PUBLICATION_GLB_MATERIAL_TEXTURE_REFERENCE_INVALID");
      }
    }
  }
  // Multiple intentionally distinct source materials may share one atlas.
  // Do not require more texture objects than materials; verify per-material
  // base-color references and the exact source face/group mapping instead.
  if (materials.some(material =>
    !record(material.pbrMetallicRoughness) ||
    !record(material.pbrMetallicRoughness.baseColorTexture) ||
    !validIndex(material.pbrMetallicRoughness.baseColorTexture.index, textures.length)
  )) {
    throw new Error("PUBLICATION_GLB_BASE_COLOR_TEXTURE_MISSING");
  }
  if (expectedCubes) {
    if (expectedCubes.length !== expectedMeshes) {
      throw new Error("PUBLICATION_GLB_EXPECTED_SOURCE_MESH_COUNT_INVALID");
    }
    const nodes = Array.isArray(json.nodes) ? json.nodes : [];
    if (nodes.some(node => !record(node))) {
      throw new Error("PUBLICATION_GLB_NODE_INVENTORY_INVALID");
    }
    const byName = new Map<string, GltfRecord>();
    for (const node of nodes as GltfRecord[]) {
      if (typeof node.name !== "string" || !node.name.startsWith("cube_")) continue;
      if (byName.has(node.name)) {
        throw new Error("PUBLICATION_GLB_DUPLICATE_CUBE_NODE: " + node.name);
      }
      byName.set(node.name, node);
    }
    if (byName.size !== expectedCubes.length) {
      throw new Error("PUBLICATION_GLB_SOURCE_CUBE_NODES_MISMATCH");
    }
    const expectedMaterialNames = new Set<string>();
    const usedMeshIds = new Set<number>();
    for (const cube of expectedCubes) {
      const node = byName.get("cube_" + cube.cube_uuid);
      if (!node || !validIndex(node.mesh, meshes.length)) {
        throw new Error("PUBLICATION_GLB_SOURCE_CUBE_NODE_MISSING: " + cube.cube_uuid);
      }
      const extras = node.extras;
      if (!record(extras) || extras.lazydesigner_cube_uuid !== cube.cube_uuid ||
          !Array.isArray(extras.lazydesigner_bounds_min) ||
          !Array.isArray(extras.lazydesigner_bounds_max) ||
          (["lazydesigner_bounds_min", "lazydesigner_bounds_max"] as const).some(key => {
            const values = extras[key] as unknown[];
            const expected = key === "lazydesigner_bounds_min"
              ? cube.expected_blender_bounds_min : cube.expected_blender_bounds_max;
            return values.length !== 3 ||
              values.some((value, axis) =>
                typeof value !== "number" || !Number.isFinite(value) ||
                Math.abs(value - expected[axis]!) > 1e-6);
          })) {
        throw new Error("PUBLICATION_GLB_SOURCE_BOUNDS_EXTRAS_MISMATCH: " + cube.cube_uuid);
      }
      const meshIndex = node.mesh as number;
      if (usedMeshIds.has(meshIndex)) {
        throw new Error("PUBLICATION_GLB_SOURCE_CUBE_MESH_SHARED_UNEXPECTEDLY");
      }
      usedMeshIds.add(meshIndex);
      const primitives = meshes[meshIndex]!.primitives as GltfRecord[];
      if (primitives.length !== cube.primitives.length) {
        throw new Error("PUBLICATION_GLB_SOURCE_PRIMITIVE_COUNT_MISMATCH: " + cube.cube_uuid);
      }
      for (let i = 0; i < cube.primitives.length; i++) {
        const expected = cube.primitives[i]!;
        const actual = primitives[i]!;
        const name = materials[actual.material as number]!.name;
        if (name !== expected.material_name) {
          throw new Error("PUBLICATION_GLB_FACE_MATERIAL_MISMATCH: " +
            cube.cube_uuid + ":" + expected.face_keys.join(","));
        }
        expectedMaterialNames.add(expected.material_name);
      }
    }
    const outputMaterialNames = materials.map(material => material.name);
    if (outputMaterialNames.some(name => typeof name !== "string") ||
        new Set(outputMaterialNames).size !== outputMaterialNames.length ||
        outputMaterialNames.length !== expectedMaterialNames.size ||
        outputMaterialNames.some(name => !expectedMaterialNames.has(name as string))) {
      throw new Error("PUBLICATION_GLB_SOURCE_MATERIAL_IDENTITY_MISMATCH");
    }
  }
  return {
    mesh_count: meshes.length,
    material_count: materials.length,
    texture_count: textures.length,
    image_count: images.length,
    primitive_count: primitiveCount,
  };
}

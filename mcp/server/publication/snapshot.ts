/// <reference types="three" />
/// <reference types="blockbench-types" />
declare const THREE: typeof import("three");
import { createHash } from "node:crypto";

import type { PublicationJob } from "@/lib/publication/contracts";

const MAX_TEXTURE_PIXELS = 4_194_304;
const MAX_CUBES = 10_000;
const MAX_GLTF_BYTES = 96 * 1024 * 1024;

type MaterialReceipt = PublicationJob["materials"];
export type DetachedPublicationSnapshot = {
  project_uuid: string;
  source_sha256: string;
  glb_sha256: string;
  glb: Buffer;
  cube_count: number;
  material_count: number;
  materials: MaterialReceipt;
};

type NativeState = {
  project: object;
  project_uuid: string;
  signature: string;
};

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function requireSourceProject(): { project: object; project_uuid: string } {
  if (!Project || (Format as { id?: string } | undefined)?.id !== "bedrock") {
    throw new Error("PUBLICATION_BEDROCK_PROJECT_REQUIRED: Open an existing Bedrock Entity project.");
  }
  if (typeof Project.uuid !== "string" || !Project.uuid.trim()) {
    throw new Error("PUBLICATION_PROJECT_IDENTITY_UNAVAILABLE");
  }
  if (typeof Cube === "undefined" || !Array.isArray(Cube.all)) {
    throw new Error("PUBLICATION_CUBE_INVENTORY_UNAVAILABLE");
  }
  if (typeof Texture === "undefined" || !Array.isArray(Texture.all)) {
    throw new Error("PUBLICATION_TEXTURE_INVENTORY_UNAVAILABLE");
  }
  return { project: Project, project_uuid: Project.uuid };
}

function visibleWithParents(cube: Cube): boolean {
  if (cube.visibility === false || cube.export === false) return false;
  let parent: unknown = cube.parent;
  const parents = new Set<object>();
  while (typeof Group !== "undefined" && parent instanceof Group) {
    if (parents.has(parent)) throw new Error("PUBLICATION_GROUP_CYCLE");
    parents.add(parent);
    if (parent.visibility === false || parent.export === false) return false;
    parent = parent.parent;
  }
  return true;
}

function imageData(texture: Texture): ImageData {
  const ctx = texture.ctx;
  const w = ctx?.canvas?.width;
  const h = ctx?.canvas?.height;
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) ||
      !w || !h || w * h > MAX_TEXTURE_PIXELS) {
    throw new Error("PUBLICATION_TEXTURE_PIXELS_UNAVAILABLE_OR_OVERSIZED: " + texture.uuid);
  }
  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    throw new Error("PUBLICATION_TEXTURE_PIXEL_READ_DENIED: " + texture.uuid);
  }
  if (pixels.data.length !== w * h * 4) {
    throw new Error("PUBLICATION_TEXTURE_PIXEL_LENGTH_INVALID: " + texture.uuid);
  }
  return pixels;
}

function texturePixelsSha(pixels: ImageData): string {
  return sha256(Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength));
}

/**
 * Identity is scoped to the exact visible source geometry, hierarchy, UV and
 * referenced image bytes. Any unavailable material semantics fail closed.
 * This intentionally makes no QA/reference-approval claims.
 */
function nativeState(): NativeState {
  const { project, project_uuid } = requireSourceProject();
  if (Cube.all.length > MAX_CUBES) {
    throw new Error("PUBLICATION_CUBE_BUDGET_EXCEEDED");
  }
  const cubeRows: unknown[] = [];
  const usedTextureIds = new Set<string>();
  const seen = new Set<string>();
  const cubes = Cube.all.filter(visibleWithParents).sort((a, b) => a.uuid.localeCompare(b.uuid));
  if (!cubes.length) throw new Error("PUBLICATION_NO_VISIBLE_CUBES");
  if (typeof Mesh !== "undefined" && Array.isArray(Mesh.all) &&
      Mesh.all.some(mesh => mesh.visibility !== false && mesh.export !== false)) {
    throw new Error("PUBLICATION_UNSUPPORTED_NON_CUBE_GEOMETRY");
  }
  for (const cube of cubes) {
    if (!cube.uuid || seen.has(cube.uuid)) throw new Error("PUBLICATION_DUPLICATE_CUBE_UUID");
    seen.add(cube.uuid);
    if (!cube.mesh?.geometry?.attributes?.position || !cube.mesh.geometry.attributes.uv) {
      throw new Error("PUBLICATION_NATIVE_MESH_OR_UV_MISSING: " + cube.uuid);
    }
    cube.mesh.updateWorldMatrix(true, false);
    const matrix = Array.from(cube.mesh.matrixWorld.elements);
    if (matrix.some(n => !Number.isFinite(n))) throw new Error("PUBLICATION_INVALID_WORLD_MATRIX");
    const geometry = cube.mesh.geometry;
    const f = (geometry as typeof geometry & { faces?: string[] }).faces;
    if (!Array.isArray(f) || !f.length) throw new Error("PUBLICATION_NATIVE_FACE_INVENTORY_MISSING");
    const faces = f.map(faceKey => {
      const face = cube.faces?.[faceKey as keyof typeof cube.faces] as CubeFace | undefined;
      const tex = face?.getTexture();
      if (!face || !tex?.uuid) {
        throw new Error("PUBLICATION_FACE_TEXTURE_UNRESOLVED: " + cube.uuid + ":" + faceKey);
      }
      usedTextureIds.add(tex.uuid);
      return [faceKey, tex.uuid, face.uv, face.rotation, face.material_name ?? null];
    });
    const uv = Array.from(geometry.attributes.uv.array);
    const indices = geometry.index ? Array.from(geometry.index.array) : null;
    cubeRows.push([
      cube.uuid, matrix, cube.from, cube.to, cube.origin, cube.rotation,
      cube.inflate ?? 0, cube.box_uv, cube.mirror_uv, cube.uv_offset, faces,
      uv, indices, geometry.groups.map(g => [g.start, g.count, g.materialIndex]),
    ]);
  }
  const imageRows = [...usedTextureIds].sort().map(uuid => {
    const texture = Texture.all.find(item => item.uuid === uuid);
    if (!texture) throw new Error("PUBLICATION_TEXTURE_DISAPPEARED: " + uuid);
    const pixels = imageData(texture);
    return [uuid, pixels.width, pixels.height, texturePixelsSha(pixels)];
  });
  return {
    project,
    project_uuid,
    signature: sha256(JSON.stringify([project_uuid, cubeRows, imageRows])),
  };
}

function resolveTexture(uuid: string): Texture {
  const texture = Texture.all.find(item => item.uuid === uuid);
  if (!texture) throw new Error("PUBLICATION_MISSING_TEXTURE: " + uuid);
  return texture;
}

function makeMaterial(
  uuid: string,
  materials: MaterialReceipt,
  textures: THREE.Texture[],
  nativeTextures: Map<string, THREE.Texture>,
): THREE.MeshStandardMaterial {
  const texture = resolveTexture(uuid);
  const groupId = texture.group;
  const materialGroup = typeof TextureGroup !== "undefined" && Array.isArray(TextureGroup.all)
    ? TextureGroup.all.find(group => group.uuid === groupId || group.name === groupId)
    : null;
  // A PBR atlas must not lose its authored normal/MER/emission channel on export.
  // A dedicated PBR bridge is required before that input is accepted.
  if (materialGroup?.is_material === true) {
    throw new Error("PUBLICATION_PBR_CHANNEL_BRIDGE_REQUIRED: " + texture.uuid);
  }

  let exported = nativeTextures.get(uuid);
  if (!exported) {
    const pixels = imageData(texture);
    let hasZeroAlpha = false;
    let hasIntermediateAlpha = false;
    for (let i = 3; i < pixels.data.length; i += 4) {
      const alpha = pixels.data[i]!;
      if (alpha === 0) hasZeroAlpha = true;
      else if (alpha < 255) hasIntermediateAlpha = true;
    }
    if (hasZeroAlpha || hasIntermediateAlpha) {
      throw new Error(
        "PUBLICATION_ALPHA_SEMANTICS_UNVERIFIED: " + uuid +
        " (transparent, cutout, color-mask and emissive-alpha are not interchangeable)",
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PUBLICATION_TEXTURE_CANVAS_UNAVAILABLE");
    context.putImageData(pixels, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.name = "ld_color_" + uuid;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    textures.push(tex);
    nativeTextures.set(uuid, tex);
    exported = tex;
    materials["ld_color_" + uuid] = {
      color_uuid: uuid,
      texture_sha256: texturePixelsSha(pixels),
      alpha_mode: "OPAQUE",
      pbr: "NONE",
    };
  }
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: exported,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  material.name = "ld_color_" + uuid;
  return material;
}

/**
 * Export from cloned native Cube geometry and copied texture pixels.
 * The active native Outliner, UI camera, Undo stack, mode, textures and pose
 * are never mutated. Unsupported fidelity semantics block the job.
 */
export async function snapshotDetachedPublicationGlb(): Promise<DetachedPublicationSnapshot> {
  const before = nativeState();
  const createdMaterials: THREE.Material[] = [];
  const createdTextures: THREE.Texture[] = [];
  const createdGeometry: THREE.BufferGeometry[] = [];
  const nativeTextures = new Map<string, THREE.Texture>();
  const materialReceipts: MaterialReceipt = {};
  const scene = new THREE.Scene();
  scene.name = "lazydesigner_publication_snapshot";
  try {
    for (const cube of Cube.all.filter(visibleWithParents)) {
      const original = cube.mesh;
      if (!original || !(original instanceof THREE.Mesh)) {
        throw new Error("PUBLICATION_UNSUPPORTED_CUBE_RENDERER: " + cube.uuid);
      }
      const nativeFaces = (original.geometry as typeof original.geometry & { faces?: string[] }).faces;
      if (!Array.isArray(nativeFaces) || !nativeFaces.length) {
        throw new Error("PUBLICATION_NATIVE_FACE_INVENTORY_MISSING");
      }
      const mappedMaterials = nativeFaces.map(faceKey => {
        const face = cube.faces?.[faceKey as keyof typeof cube.faces] as CubeFace | undefined;
        const tex = face?.getTexture();
        if (!tex?.uuid) throw new Error("PUBLICATION_FACE_TEXTURE_UNRESOLVED: " + cube.uuid);
        const m = makeMaterial(tex.uuid, materialReceipts, createdTextures, nativeTextures);
        createdMaterials.push(m);
        return m;
      });
      original.updateWorldMatrix(true, false);
      const geometry = original.geometry.clone();
      geometry.applyMatrix4(original.matrixWorld);
      // Native Blockbench Cube geometry groups are face-ordered and can merge
      // consecutive same-texture faces. Preserve their existing material indices.
      if (geometry.groups.some(g => g.materialIndex < 0 || g.materialIndex >= mappedMaterials.length)) {
        throw new Error("PUBLICATION_FACE_GROUP_MATERIAL_INDEX_INVALID: " + cube.uuid);
      }
      createdGeometry.push(geometry);
      const detached = new THREE.Mesh(geometry, mappedMaterials);
      detached.name = "cube_" + cube.uuid;
      detached.userData = { lazydesigner_cube_uuid: cube.uuid };
      scene.add(detached);
    }
    const Exporter = (THREE as unknown as {
      GLTFExporter?: new () => {
        parse(input: THREE.Scene, done: (result: unknown) => void, options: Record<string, unknown>): void;
      };
    }).GLTFExporter;
    if (typeof Exporter !== "function") throw new Error("PUBLICATION_NATIVE_GLTF_EXPORTER_UNAVAILABLE");
    const data = await new Promise<unknown>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("PUBLICATION_GLTF_EXPORT_TIMEOUT")), 30_000);
      try {
        new Exporter().parse(scene, value => { clearTimeout(deadline); resolve(value); }, {
          binary: true, embedImages: true, onlyVisible: true,
          truncateDrawRange: false, forcePowerOfTwoTextures: false,
          exportFaceColors: false, animations: [],
        });
      } catch (error) { clearTimeout(deadline); reject(error); }
    });
    if (!(data instanceof ArrayBuffer)) throw new Error("PUBLICATION_GLTF_EXPECTED_BINARY_GLB");
    const glb = Buffer.from(data);
    if (glb.length < 20 || glb.length > MAX_GLTF_BYTES ||
        glb.toString("ascii", 0, 4) !== "glTF") {
      throw new Error("PUBLICATION_GLTF_INVALID_OR_OVERSIZED");
    }
    const after = nativeState();
    if (before.project !== after.project ||
        before.project_uuid !== after.project_uuid ||
        before.signature !== after.signature) {
      throw new Error("PUBLICATION_SOURCE_CHANGED_DURING_GLTF_SNAPSHOT");
    }
    return {
      project_uuid: before.project_uuid,
      source_sha256: before.signature,
      glb_sha256: sha256(glb),
      glb,
      cube_count: scene.children.length,
      material_count: Object.keys(materialReceipts).length,
      materials: materialReceipts,
    };
  } finally {
    for (const geometry of createdGeometry) geometry.dispose();
    for (const material of createdMaterials) material.dispose();
    for (const texture of createdTextures) texture.dispose();
    scene.clear();
  }
}

/** Final job must still point at the same live authored source revision. */
export function verifyPublicationSourceCurrent(
  expectedProjectUuid: string,
  expectedSha256: string,
): void {
  const now = nativeState();
  if (now.project_uuid !== expectedProjectUuid || now.signature !== expectedSha256) {
    throw new Error("PUBLICATION_SOURCE_STALE_AFTER_RENDER: no final PNG was promoted.");
  }
}

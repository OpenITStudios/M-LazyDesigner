/// <reference types="three" />
/// <reference types="blockbench-types" />
declare const THREE: typeof import("three");
import { createHash } from "node:crypto";

import type { PublicationJob } from "@/lib/publication/contracts";
import { convertBedrockMerToGltf, convertBedrockNormalToGltf } from "@/lib/publication/materialChannels";
import {
  inspectPublicationPbrPlan,
  expectedPublicationGltfMaterial,
  requirePublicationTexturePreviewMode,
} from "@/lib/publication/materialContract";
import { inspectPublicationGlb } from "@/lib/publication/glbIntegrity";
import { verifyVisibleAtlasPixelsOpaque, type AtlasRect } from "@/lib/publication/atlasCoverage";
import {
  PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT,
  PUBLICATION_UNITS_PER_MINECRAFT_BLOCK,
  derivePublicationPrimitiveBindings,
  expectedPublicationBlenderBounds,
  expectedPublicationGltfUvSha256,
  type PublicationCubeManifest,
  type PublicationSourceManifest,
} from "@/lib/publication/sourceManifest";

const MAX_TEXTURE_PIXELS = 4_194_304;
const MAX_TOTAL_TEXTURE_PIXELS = 8_388_608;
const MAX_TEXTURE_COUNT = 128;
const MAX_CUBES = 10_000;
const MAX_VERTEX_COMPONENTS = 3_000_000;
const MAX_GLTF_BYTES = 96 * 1024 * 1024;

function requireFiniteGeometryArray(
  values: readonly number[],
  itemSize: number,
  label: string,
): void {
  if (values.length === 0 || values.length % itemSize !== 0 ||
      values.some(value => !Number.isFinite(value))) {
    throw new Error("PUBLICATION_SOURCE_GEOMETRY_INVALID_" + label);
  }
}

function validateNativeCubeIndexGroups(
  indices: readonly number[],
  groups: readonly { start: number; count: number; materialIndex?: number }[],
  vertexCount: number,
  faceCount: number,
): void {
  if (indices.length === 0 || indices.length % 3 !== 0 ||
      indices.some(value => !Number.isSafeInteger(value) ||
        value < 0 || value >= vertexCount)) {
    throw new Error("PUBLICATION_SOURCE_INDEX_OUT_OF_RANGE");
  }
  let offset = 0;
  for (const group of groups) {
    const materialIndex = group.materialIndex;
    if (!Number.isSafeInteger(group.start) || group.start !== offset ||
        !Number.isSafeInteger(group.count) || group.count < 3 ||
        group.count % 3 !== 0 ||
        typeof materialIndex !== "number" ||
        !Number.isSafeInteger(materialIndex) ||
        materialIndex < 0 || materialIndex >= faceCount ||
        group.start + group.count > indices.length) {
      throw new Error("PUBLICATION_SOURCE_FACE_GROUP_INVALID");
    }
    offset += group.count;
  }
  if (offset !== indices.length) {
    throw new Error("PUBLICATION_SOURCE_FACE_GROUP_COVERAGE_MISMATCH");
  }
}

type MaterialReceipt = PublicationJob["materials"];
export type DetachedPublicationSnapshot = {
  project_uuid: string;
  source_sha256: string;
  glb_sha256: string;
  glb: Buffer;
  cube_count: number;
  material_count: number;
  materials: MaterialReceipt;
  source_manifest: PublicationSourceManifest;
  source_manifest_sha256: string;
};

type NativeState = {
  project: object;
  project_uuid: string;
  signature: string;
  manifest: PublicationSourceManifest;
};

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Snapshot only a proven static edit pose. Never reset animation or texture frames. */
function requireVerifiedPublicationEditPose(): void {
  if (typeof Modes === "undefined" || Modes.edit !== true ||
      Modes.animate === true ||
      (typeof Timeline !== "undefined" && Timeline.playing === true)) {
    throw new Error(
      "PUBLICATION_POSE_PROVENANCE_UNVERIFIED: switch to Blockbench Edit mode " +
      "and stop timeline playback before requesting a static publication render.",
    );
  }
}

/** Read-only editor fence: avoids mistaking a native export side effect for an
 * acceptable model-only snapshot. Do not invoke view/mode/timeline setters.
 */
function publicationEditorFence(): string {
  const activeUndo = (typeof Undo !== "undefined" ? Undo : null) as
    | { history?: unknown[]; index?: number } | null;
  const selectedCubes = Array.isArray(Cube.selected)
    ? Cube.selected.map(item => item.uuid).sort() : [];
  const selectedGroups = typeof Group !== "undefined" && Array.isArray(Group.selected)
    ? Group.selected.map(item => item.uuid).sort() : [];
  return JSON.stringify({
    project_uuid: Project?.uuid ?? null,
    project_save_path: Project?.save_path ?? null,
    project_saved: Project?.saved ?? null,
    editor_mode: typeof Modes !== "undefined"
      ? [Modes.edit, Modes.animate] : null,
    project_view_mode: Project?.view_mode ?? null,
    selected_cubes: selectedCubes,
    selected_groups: selectedGroups,
    selected_texture: typeof Texture !== "undefined" ? Texture.selected?.uuid ?? null : null,
    undo_length: activeUndo?.history?.length ?? null,
    undo_index: activeUndo?.index ?? null,
    timeline: typeof Timeline !== "undefined"
      ? [Timeline.time, Timeline.playing] : null,
  });
}

function publicationGroupAncestry(cube: Cube): string[] {
  const uuids: string[] = [];
  const visited = new Set<object>();
  let parent: unknown = cube.parent;
  while (typeof Group !== "undefined" && parent instanceof Group) {
    if (visited.has(parent) || typeof parent.uuid !== "string" || !parent.uuid) {
      throw new Error("PUBLICATION_PARENT_GROUP_IDENTITY_INVALID: " + cube.uuid);
    }
    visited.add(parent);
    uuids.unshift(parent.uuid);
    parent = parent.parent;
  }
  return uuids;
}

function requireStaticSourceTexture(texture: Texture): void {
  // Blockbench frameCount getter is undefined for a static texture.
  const frameCount = texture.frameCount ?? 1;
  if (!Number.isSafeInteger(frameCount) || frameCount !== 1 ||
      !Number.isSafeInteger(texture.currentFrame) ||
      texture.currentFrame !== 0) {
    throw new Error(
      "PUBLICATION_TEXTURE_FRAME_PROVENANCE_UNVERIFIED: " + texture.uuid,
    );
  }
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
  requireVerifiedPublicationEditPose();
  if (Cube.all.length > MAX_CUBES) {
    throw new Error("PUBLICATION_CUBE_BUDGET_EXCEEDED");
  }
  const cubeRows: unknown[] = [];
  const manifestCubes: PublicationCubeManifest[] = [];
  let vertexComponentCount = 0;
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
    // A negative determinant changes triangle winding. Do not silently make
    // it look correct by forcing every imported material double-sided.
    const determinant =
      matrix[0]! * (matrix[5]! * matrix[10]! - matrix[6]! * matrix[9]!) -
      matrix[4]! * (matrix[1]! * matrix[10]! - matrix[2]! * matrix[9]!) +
      matrix[8]! * (matrix[1]! * matrix[6]! - matrix[2]! * matrix[5]!);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
      throw new Error("PUBLICATION_SOURCE_WORLD_TRANSFORM_SINGULAR: " + cube.uuid);
    }
    if (determinant < 0) {
      throw new Error("PUBLICATION_SOURCE_MIRROR_WINDING_UNVERIFIED: " + cube.uuid);
    }
    const geometry = cube.mesh.geometry;
    const f = (geometry as typeof geometry & { faces?: string[] }).faces;
    if (!Array.isArray(f) || !f.length) throw new Error("PUBLICATION_NATIVE_FACE_INVENTORY_MISSING");
    const faceBindings = f.map(faceKey => {
      const face = cube.faces?.[faceKey as keyof typeof cube.faces] as CubeFace | undefined;
      const tex = face?.getTexture();
      if (!face || !tex?.uuid) {
        throw new Error("PUBLICATION_FACE_TEXTURE_UNRESOLVED: " + cube.uuid + ":" + faceKey);
      }
      usedTextureIds.add(tex.uuid);
      return {
        face_key: faceKey,
        texture_uuid: tex.uuid,
        material_name: face.material_name ?? null,
        uv: face.uv, rotation: face.rotation,
      };
    });
    const uv = Array.from(geometry.attributes.uv.array);
    const positions = Array.from(geometry.attributes.position.array);
    requireFiniteGeometryArray(positions, 3, "POSITION");
    requireFiniteGeometryArray(uv, 2, "UV");
    if (uv.length / 2 !== positions.length / 3) {
      throw new Error("PUBLICATION_SOURCE_VERTEX_UV_COUNT_MISMATCH");
    }
    vertexComponentCount += positions.length;
    if (vertexComponentCount > MAX_VERTEX_COMPONENTS) {
      throw new Error("PUBLICATION_SOURCE_VERTEX_COMPONENT_BUDGET_EXCEEDED");
    }
    const normals = geometry.attributes.normal
      ? Array.from(geometry.attributes.normal.array) : null;
    if (normals) {
      requireFiniteGeometryArray(normals, 3, "NORMAL");
      if (normals.length !== positions.length) {
        throw new Error("PUBLICATION_SOURCE_NORMAL_COUNT_MISMATCH");
      }
    }
    const indices = geometry.index ? Array.from(geometry.index.array) : null;
    if (!indices) throw new Error("PUBLICATION_SOURCE_INDEX_REQUIRED");
    validateNativeCubeIndexGroups(
      indices, geometry.groups, positions.length / 3, f.length,
    );
    const primitives = derivePublicationPrimitiveBindings(
      cube.uuid, faceBindings, geometry.groups, indices.length,
    );
    const ancestry = publicationGroupAncestry(cube);
    const bounds = expectedPublicationBlenderBounds(positions, matrix);
    const positionSha = sha256(JSON.stringify(positions));
    const uvSha = sha256(JSON.stringify(uv));
    const indexSha = sha256(JSON.stringify(indices));
    const normalSha = normals ? sha256(JSON.stringify(normals)) : null;
    manifestCubes.push({
      cube_uuid: cube.uuid,
      group_ancestry_uuids: ancestry,
      source_world_matrix: matrix,
      expected_blender_bounds_min: bounds.min,
      expected_blender_bounds_max: bounds.max,
      position_sha256: positionSha,
      uv_sha256: uvSha,
      gltf_uv_sha256: expectedPublicationGltfUvSha256(uv),
      uv_vertex_count: uv.length / 2,
      normal_sha256: normalSha,
      index_sha256: indexSha,
      primitives,
    });
    cubeRows.push([
      cube.uuid, ancestry, matrix, cube.from, cube.to, cube.origin, cube.rotation,
      cube.inflate ?? 0, cube.box_uv, cube.mirror_uv, cube.uv_offset, faceBindings,
      cube.visibility, cube.export, uv, positions, normals, indices, primitives,
      geometry.groups.map(g => [g.start, g.count, g.materialIndex]),
    ]);
  }
  const pbrGroups: unknown[] = [];
  const groupsSeen = new Set<string>();
  for (const uuid of [...usedTextureIds]) {
    const texture = resolveTexture(uuid);
    const group = resolvePublicationTextureGroup(texture);
    if (group?.is_material === true && !groupsSeen.has(group.uuid)) {
      groupsSeen.add(group.uuid);
      const channels = group.getTextures();
      for (const channel of channels) usedTextureIds.add(channel.uuid);
      pbrGroups.push([group.uuid,
        group.material_config?.mer_value ?? null,
        group.material_config?.color_value ?? null,
        group.material_config?.subsurface_value ?? null,
        channels.map(channel => [channel.uuid, channel.pbr_channel]).sort()]);
    }
  }
  if (usedTextureIds.size > MAX_TEXTURE_COUNT) {
    throw new Error("PUBLICATION_TEXTURE_COUNT_BUDGET_EXCEEDED");
  }
  let totalTexturePixels = 0;
  const imageRows = [...usedTextureIds].sort().map(uuid => {
    const texture = Texture.all.find(item => item.uuid === uuid);
    if (!texture) throw new Error("PUBLICATION_TEXTURE_DISAPPEARED: " + uuid);
    requireStaticSourceTexture(texture);
    const pixels = imageData(texture);
    totalTexturePixels += pixels.width * pixels.height;
    if (totalTexturePixels > MAX_TOTAL_TEXTURE_PIXELS) {
      throw new Error("PUBLICATION_TEXTURE_TOTAL_PIXEL_BUDGET_EXCEEDED");
    }
    return [
      uuid, pixels.width, pixels.height, texturePixelsSha(pixels),
      texture.frameCount ?? 1, texture.currentFrame,
      texture.render_mode ?? "default",
    ];
  });
  const signature = sha256(JSON.stringify([
    project_uuid, "EDIT_STATIC_VERIFIED", PUBLICATION_UNITS_PER_MINECRAFT_BLOCK,
    cubeRows, imageRows, pbrGroups.sort(),
  ]));
  return {
    project,
    project_uuid,
    signature,
    manifest: {
      schema_version: 1,
      target_kind: "ACTIVE_PROJECT_VISIBLE_EXPORTABLE_CUBES",
      project_uuid,
      pose_mode: "EDIT_STATIC_VERIFIED",
      source_sha256: signature,
      source_units_per_minecraft_block: PUBLICATION_UNITS_PER_MINECRAFT_BLOCK,
      gltf_units_per_blockbench_unit: PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT,
      cubes: manifestCubes,
    },
  };
}

/** Never guess a PBR source group from the first matching display name. */
function resolvePublicationTextureGroup(texture: Texture): TextureGroup | null {
  const id = texture.group;
  if (!id) return null;
  if (typeof TextureGroup === "undefined" || !Array.isArray(TextureGroup.all)) {
    throw new Error("PUBLICATION_TEXTURE_GROUP_INVENTORY_UNAVAILABLE: " + texture.uuid);
  }
  const exact = TextureGroup.all.filter(group => group.uuid === id);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new Error("PUBLICATION_TEXTURE_GROUP_UUID_AMBIGUOUS: " + id);
  const named = TextureGroup.all.filter(group => group.name === id);
  if (named.length !== 1) {
    throw new Error("PUBLICATION_TEXTURE_GROUP_UNRESOLVED_OR_AMBIGUOUS: " + id);
  }
  return named[0]!;
}

function resolveTexture(uuid: string): Texture {
  const texture = Texture.all.find(item => item.uuid === uuid);
  if (!texture) throw new Error("PUBLICATION_MISSING_TEXTURE: " + uuid);
  return texture;
}


function copyPixelTexture(
  pixels: ImageData,
  name: string,
  color: boolean,
  created: THREE.Texture[],
  replacement?: Uint8ClampedArray,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PUBLICATION_TEXTURE_CANVAS_UNAVAILABLE");
  if (replacement) {
    if (replacement.byteLength !== pixels.data.byteLength) {
      throw new Error("PUBLICATION_PBR_CHANNEL_DIMENSIONS_INVALID");
    }
    const result = context.createImageData(pixels.width, pixels.height);
    result.data.set(replacement);
    context.putImageData(result, 0, 0);
  } else {
    context.putImageData(pixels, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.name = name;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  created.push(tex);
  return tex;
}

/** Build face-to-atlas UV ownership once instead of rescanning all cubes for every material. */
function collectUsedAtlasUv(): Map<string, AtlasRect[]> {
  const usage = new Map<string, AtlasRect[]>();
  for (const cube of Cube.all.filter(visibleWithParents)) {
    const faceKeys = (cube.mesh?.geometry as { faces?: string[] } | undefined)?.faces;
    if (!Array.isArray(faceKeys)) throw new Error("PUBLICATION_NATIVE_FACE_INVENTORY_MISSING");
    for (const faceKey of faceKeys) {
      const face = cube.faces?.[faceKey as keyof typeof cube.faces] as CubeFace | undefined;
      const texture = face?.getTexture();
      if (!texture?.uuid) throw new Error("PUBLICATION_FACE_TEXTURE_UNRESOLVED");
      if (!Array.isArray(face.uv) || face.uv.length !== 4) {
        throw new Error("PUBLICATION_FACE_UV_REQUIRED_FOR_ALPHA_FIDELITY");
      }
      const entries = usage.get(texture.uuid) ?? [];
      entries.push(face.uv as unknown as AtlasRect);
      usage.set(texture.uuid, entries);
    }
  }
  return usage;
}

function makeMaterial(
  uuid: string,
  receipts: MaterialReceipt,
  createdTextures: THREE.Texture[],
  materialCache: Map<string, THREE.MeshStandardMaterial>,
  uvUsage: ReadonlyMap<string, AtlasRect[]>,
): THREE.MeshStandardMaterial {
  const previous = materialCache.get(uuid);
  if (previous) return previous;
  const texture = resolveTexture(uuid);
  requirePublicationTexturePreviewMode(uuid, texture.render_mode);
  const colorPixels = imageData(texture);
  // Transparent atlas padding is not transparency on the 3D object. Verify
  // the precise authored face-UV regions rather than rejecting empty islands.
  const uvRects = uvUsage.get(uuid) ?? [];
  const logicalWidth = Number(Project.texture_width) || colorPixels.width;
  const logicalHeight = Number(Project.texture_height) || colorPixels.height;
  const alphaCoverage = verifyVisibleAtlasPixelsOpaque(
    colorPixels.data, colorPixels.width, colorPixels.height,
    logicalWidth, logicalHeight, uvRects,
  );
  const group = resolvePublicationTextureGroup(texture);
  const plan = group?.is_material === true
    ? inspectPublicationPbrPlan(
      uuid,
      group.getTextures().map(channel => ({
        uuid: channel.uuid,
        pbr_channel: channel.pbr_channel,
      })),
      {
        mer_value: group.material_config?.mer_value,
        subsurface_value: group.material_config?.subsurface_value,
      },
    )
    : null;
  const colorMap = copyPixelTexture(colorPixels, "ld_base_" + uuid, true, createdTextures);
  const material = new THREE.MeshStandardMaterial({
    map: colorMap, color: 0xffffff, side: THREE.DoubleSide,
    roughness: 0.85, metalness: 0,
  });
  material.name = "ld_color_" + uuid;
  const receipt: MaterialReceipt[string] = {
    color_uuid: uuid, texture_sha256: texturePixelsSha(colorPixels),
    alpha_mode: "OPAQUE", pbr: plan ? "MAPPED" : "NONE",
    unused_alpha_pixels: alphaCoverage.transparent_pixels_outside_mapped_uv,
    gltf: expectedPublicationGltfMaterial(plan),
  };
  if (plan) {
    if (plan.mer_uuid) {
      const pixels = imageData(resolveTexture(plan.mer_uuid));
      if (pixels.width !== colorPixels.width || pixels.height !== colorPixels.height) {
        throw new Error("PUBLICATION_PBR_CHANNEL_DIMENSIONS_INVALID: " + uuid);
      }
      const mapped = convertBedrockMerToGltf(colorPixels.data, pixels.data);
      const metalRough = copyPixelTexture(
        pixels, "ld_mer_" + uuid, false, createdTextures, mapped.metallicRoughness,
      );
      material.metalness = 1;
      material.roughness = 1;
      material.metalnessMap = metalRough;
      material.roughnessMap = metalRough;
      const emissionMap = copyPixelTexture(
        pixels, "ld_emission_" + uuid, true, createdTextures, mapped.emission,
      );
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveMap = emissionMap;
      material.emissiveIntensity = 1;
      receipt.mer_sha256 = texturePixelsSha(pixels);
    } else {
      const values = plan.uniform_mer!;
      material.metalness = values[0] / 255;
      material.roughness = values[2] / 255;
      if (values[1] > 0) {
        material.emissive = new THREE.Color(0xffffff);
        material.emissiveMap = colorMap;
        material.emissiveIntensity = values[1] / 255;
      }
    }
    if (plan.normal_uuid) {
      const pixels = imageData(resolveTexture(plan.normal_uuid));
      if (pixels.width !== colorPixels.width || pixels.height !== colorPixels.height) {
        throw new Error("PUBLICATION_NORMAL_CHANNEL_DIMENSIONS_INVALID: " + uuid);
      }
      const normalMap = copyPixelTexture(
        pixels, "ld_normal_" + uuid, false, createdTextures,
        convertBedrockNormalToGltf(pixels.data),
      );
      material.normalMap = normalMap;
      receipt.normal_sha256 = texturePixelsSha(pixels);
    }
  }
  receipts[material.name] = receipt;
  materialCache.set(uuid, material);
  return material;
}

/**
 * Export from cloned native Cube geometry and copied texture pixels.
 * The active native Outliner, UI camera, Undo stack, mode, textures and pose
 * are never mutated. Unsupported fidelity semantics block the job.
 */
export async function snapshotDetachedPublicationGlb(): Promise<DetachedPublicationSnapshot> {
  const editorFenceBefore = publicationEditorFence();
  const before = nativeState();
  const createdMaterials: THREE.Material[] = [];
  const createdTextures: THREE.Texture[] = [];
  const createdGeometry: THREE.BufferGeometry[] = [];
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  const uvUsage = collectUsedAtlasUv();
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
        const m = makeMaterial(tex.uuid, materialReceipts, createdTextures, materialCache, uvUsage);
        if (!createdMaterials.includes(m)) createdMaterials.push(m);
        return m;
      });
      original.updateWorldMatrix(true, false);
      const geometry = original.geometry.clone();
      geometry.applyMatrix4(original.matrixWorld);
      geometry.scale(
        PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT,
        PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT,
        PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT,
      );
      // Native Blockbench Cube geometry groups are face-ordered and can merge
      // consecutive same-texture faces. Preserve their existing material indices.
      if (geometry.groups.some(g => g.materialIndex < 0 || g.materialIndex >= mappedMaterials.length)) {
        throw new Error("PUBLICATION_FACE_GROUP_MATERIAL_INDEX_INVALID: " + cube.uuid);
      }
      createdGeometry.push(geometry);
      const detached = new THREE.Mesh(geometry, mappedMaterials);
      detached.name = "cube_" + cube.uuid;
      const sourceCube = before.manifest.cubes.find(item => item.cube_uuid === cube.uuid);
      if (!sourceCube) {
        throw new Error("PUBLICATION_SOURCE_CUBE_MANIFEST_MISSING: " + cube.uuid);
      }
      detached.userData = {
        lazydesigner_cube_uuid: cube.uuid,
        lazydesigner_bounds_min: sourceCube.expected_blender_bounds_min,
        lazydesigner_bounds_max: sourceCube.expected_blender_bounds_max,
      };
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
    inspectPublicationGlb(
      glb, scene.children.length, Object.keys(materialReceipts).length,
      before.manifest.cubes, materialReceipts,
    );
    const after = nativeState();
    if (publicationEditorFence() !== editorFenceBefore) {
      throw new Error("PUBLICATION_EDITOR_STATE_CHANGED_DURING_SNAPSHOT");
    }
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
      source_manifest: before.manifest,
      source_manifest_sha256: sha256(JSON.stringify(before.manifest)),
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

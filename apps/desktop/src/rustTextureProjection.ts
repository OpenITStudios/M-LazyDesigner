// Read-only per-face UV projection for the existing Three.js viewport.
// This never owns, writes or normalizes authoritative Rust model data.
import type { CubeFace } from './rustEditorTypes';

export function textureIndexForFace(face: CubeFace | undefined, textureCount: number): number | null {
  if (!face || face.enabled === false || face.texture === null || textureCount < 1) return null;
  if (typeof face.texture === 'number') {
    return Number.isInteger(face.texture) && face.texture >= 0 && face.texture < textureCount
      ? face.texture : null;
  }
  // Bedrock single-texture projects use the first available texture for
  // implicit/false face references; a null reference means no face texture.
  return face.texture === undefined || face.texture === false ? 0 : null;
}

// BoxGeometry order is east/west/up/down/south/north, four vertices per face.
// Convert Blockbench top-left pixel UVs to Three.js bottom-left normalized UVs.
// Face rotation, texture frame animation, wrap rules and per-texture resolution
// are explicitly outside this first projection slice.
export function faceUvCoordinates(
  face: CubeFace | undefined, resolution: readonly number[],
): number[] | null {
  if (!face || !Array.isArray(face.uv) || face.uv.length !== 4 ||
      resolution.length !== 2 ||
      !resolution.every(n => Number.isFinite(n) && n > 0)) return null;
  const [u0, v0, u1, v1] = face.uv;
  if (![u0, v0, u1, v1].every(Number.isFinite)) return null;
  const [w, h] = resolution;
  return [
    u0 / w, 1 - v0 / h,
    u1 / w, 1 - v0 / h,
    u0 / w, 1 - v1 / h,
    u1 / w, 1 - v1 / h,
  ];
}

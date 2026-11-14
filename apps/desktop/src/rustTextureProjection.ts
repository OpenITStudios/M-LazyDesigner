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
// Match Blockbench 5.2.1 Cube.updateUV's corner order and 90-degree permutation.
// Texture animation, non-limited wrap and per-texture resolution are excluded.
export function faceUvCoordinates(
  face: CubeFace | undefined, resolution: readonly number[], boxUv = false,
): number[] | null {
  if (!face || !Array.isArray(face.uv) || face.uv.length !== 4 ||
      resolution.length !== 2 ||
      !resolution.every(n => Number.isFinite(n) && n > 0)) return null;
  const [u0, v0, u1, v1] = face.uv;
  if (![u0, v0, u1, v1].every(Number.isFinite)) return null;
  const rotation = face.rotation ?? 0;
  if (typeof rotation !== 'number' || ![0, 90, 180, 270].includes(rotation)) return null;
  const [w, h] = resolution;
  // The pinned Cube.updateUV applies a 1/64 atlas-unit inset in Box UV
  // to mitigate bleeding; signed rectangles preserve the mirrored direction.
  const marginU = boxUv ? (u0 > u1 ? -1 : 1) / 64 : 0;
  const marginV = boxUv ? (v0 > v1 ? -1 : 1) / 64 : 0;
  const uStart = (u0 + marginU) / w, uEnd = (u1 - marginU) / w;
  const vStart = 1 - (v0 + marginV) / h, vEnd = 1 - (v1 - marginV) / h;
  const corners = [
    [uStart, vStart],
    [uEnd, vStart],
    [uStart, vEnd],
    [uEnd, vEnd],
  ];
  for (let degrees = 0; degrees < rotation; degrees += 90) {
    const first = corners[0];
    corners[0] = corners[2];
    corners[2] = corners[3];
    corners[3] = corners[1];
    corners[1] = first;
  }
  return corners.flat();
}

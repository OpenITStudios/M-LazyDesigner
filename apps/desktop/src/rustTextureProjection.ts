// Read-only per-face UV projection for the existing Three.js viewport.
// This never owns, writes or normalizes authoritative Rust model data.
import type { CubeFace } from './rustEditorTypes';

// Blockbench v5.2.1 Cube.updateFaces excludes a face only when its
// texture is null. The saved `enabled` metadata is not a geometry switch.
export function isCubeFacePresent(face: CubeFace | undefined): boolean {
  return Boolean(face && face.texture !== null);
}

export function textureIndexForFace(face: CubeFace | undefined, textureCount: number): number | null {
  if (!isCubeFacePresent(face) || textureCount < 1) return null;
  if (typeof face.texture === 'number') {
    return Number.isInteger(face.texture) && face.texture >= 0 && face.texture < textureCount
      ? face.texture : null;
  }
  // Bedrock single-texture projects use the first available texture for
  // implicit/false face references; a null reference means no face texture.
  return face.texture === undefined || face.texture === false ? 0 : null;
}

// Bedrock Entity's pinned single_texture preview selects Texture.getDefault(),
// which follows the active texture (falling back to the first one).
// Selection here is an ephemeral view option, not a serialized face rewrite.
export function bedrockDefaultTextureIndex(
  selected: number | null, count: number,
): number | null {
  if (!Number.isInteger(count) || count < 1) return null;
  if (selected !== null && Number.isInteger(selected) && selected >= 0 && selected < count) {
    return selected;
  }
  return 0;
}

export function bedrockTextureForFace(
  face: CubeFace | undefined, selected: number | null, count: number,
  scoped = false, scopedIndex: number | null = null,
): number | null {
  if (!isCubeFacePresent(face)) return null;
  if (scoped) {
    // The native attachable ruleset can select a texture by Cube scope.
    // Never fall back to global selection on a missing/ambiguous scope.
    return scopedIndex !== null && Number.isInteger(scopedIndex) &&
      scopedIndex >= 0 && scopedIndex < count ? scopedIndex : null;
  }
  return bedrockDefaultTextureIndex(selected, count);
}

// Read-only side selection from the Rust-vetted texture projection.
// A missing or unsupported material uses the default double-sided fallback.
export function previewRenderSide(side: 'front' | 'double' | null | undefined): 'front' | 'double' {
  return side === 'front' ? 'front' : 'double';
}

// The same bounded rotations drive read-only UV rendering and Inspector
// admission. Unknown imported values remain opaque; never show 0 by default.
export function supportedFaceUvRotation(face: CubeFace | undefined): 0 | 90 | 180 | 270 | null {
  if (!face) return null;
  const value: unknown = face.rotation === undefined ? 0 : face.rotation;
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : null;
}

// BoxGeometry order is east/west/up/down/south/north, four vertices per face.
// Match Blockbench 5.2.1 Cube.updateUV's corner order and 90-degree permutation.
// Texture animation and non-limited wrap are excluded. A vetted per-texture
// resolution may be projected for a matched bedrock_attachable scope.
export function faceUvCoordinates(
  face: CubeFace | undefined, resolution: readonly number[], boxUv = false,
): number[] | null {
  if (!face || !Array.isArray(face.uv) || face.uv.length !== 4 ||
      resolution.length !== 2 ||
      !resolution.every(n => Number.isFinite(n) && n > 0)) return null;
  const [u0, v0, u1, v1] = face.uv;
  if (![u0, v0, u1, v1].every(Number.isFinite)) return null;
  const rotation = supportedFaceUvRotation(face);
  if (rotation === null) return null;
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

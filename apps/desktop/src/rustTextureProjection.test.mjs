// Node 24 source regression; NOT_EXECUTED under the repository hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isCubeFacePresent, textureIndexForFace, faceUvCoordinates, supportedFaceUvRotation, bedrockDefaultTextureIndex, bedrockTextureForFace, BEDROCK_PREVIEW_ALPHA_TEST } from './rustTextureProjection.ts';

test('pinned Blockbench shader discards zero-alpha texels before depth rendering', () => {
  // Blockbench 5.2.1 js/shaders/texture.frag.glsl:
  // if (color.a < 0.01) discard;
  // Matches Three.js MeshLambertMaterial alphaTest used in RustViewport.
  assert.equal(BEDROCK_PREVIEW_ALPHA_TEST, 0.01);
  assert.equal(0 / 255 < BEDROCK_PREVIEW_ALPHA_TEST, true);
  assert.equal(1 / 255 < BEDROCK_PREVIEW_ALPHA_TEST, true);
  assert.equal(2 / 255 < BEDROCK_PREVIEW_ALPHA_TEST, true);
  assert.equal(3 / 255 < BEDROCK_PREVIEW_ALPHA_TEST, false);
  assert.equal(128 / 255 < BEDROCK_PREVIEW_ALPHA_TEST, false);
  assert.equal(255 / 255 < BEDROCK_PREVIEW_ALPHA_TEST, false);
  // This tests the source cutoff, not native GPU depth/alpha behavior.
});

test('only null face references remove geometry; enabled metadata does not', () => {
  assert.equal(isCubeFacePresent(undefined), false);
  assert.equal(isCubeFacePresent({ uv: [0, 0, 4, 4], texture: null }), false);
  assert.equal(isCubeFacePresent({ uv: [0, 0, 4, 4], texture: false }), true);
  assert.equal(isCubeFacePresent({ uv: [0, 0, 4, 4], texture: 0, enabled: false }), true);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4] }, 1), 0);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: false }, 1), 0);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: 1 }, 2), 1);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: null }, 1), null);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], enabled: false }, 1), 0);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: null, enabled: true }, 1), null);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: 2 }, 2), null);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: -1 }, 2), null);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4] }, 0), null);
});

test('top-left UV rectangle maps to bottom-left Three coordinates', () => {
  assert.deepEqual(faceUvCoordinates({ uv: [8, 4, 12, 8] }, [64, 32]),
    [0.125, 0.875, 0.1875, 0.875, 0.125, 0.75, 0.1875, 0.75]);
});

test('flipped atlas rectangle retains signed orientation', () => {
  assert.deepEqual(faceUvCoordinates({ uv: [12, 8, 8, 4] }, [64, 32]),
    [0.1875, 0.75, 0.125, 0.75, 0.1875, 0.875, 0.125, 0.875]);
});

test('incomplete UV or invalid atlas resolution is not projected', () => {
  assert.equal(faceUvCoordinates({ uv: [0, 0, 4] }, [64, 32]), null);
  assert.equal(faceUvCoordinates({ uv: [0, 0, 4, 4] }, [0, 32]), null);
  assert.equal(faceUvCoordinates({ uv: [0, Infinity, 4, 4] }, [64, 32]), null);
});

test('quarter-turn face rotations follow Blockbench Cube.updateUV corner permutation', () => {
  const base = { uv: [8, 4, 12, 8] };
  const resolution = [64, 32];
  const uv = faceUvCoordinates(base, resolution);
  assert.deepEqual(faceUvCoordinates({ ...base, rotation: 90 }, resolution),
    [uv[4], uv[5], uv[0], uv[1], uv[6], uv[7], uv[2], uv[3]]);
  assert.deepEqual(faceUvCoordinates({ ...base, rotation: 180 }, resolution),
    [uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]]);
  assert.deepEqual(faceUvCoordinates({ ...base, rotation: 270 }, resolution),
    [uv[2], uv[3], uv[6], uv[7], uv[0], uv[1], uv[4], uv[5]]);
  assert.deepEqual(faceUvCoordinates({ ...base, rotation: 0 }, resolution), uv);
  assert.equal(faceUvCoordinates({ ...base, rotation: 45 }, resolution), null);
  assert.equal(faceUvCoordinates({ ...base, rotation: '90' }, resolution), null);
});

test('UV rotation Inspector and viewport share a strict import-safe orientation gate', () => {
  const base = { uv: [0, 0, 4, 4] };
  assert.equal(supportedFaceUvRotation(base), 0);
  for (const degrees of [0, 90, 180, 270]) {
    assert.equal(supportedFaceUvRotation({ ...base, rotation: degrees }), degrees);
    assert.notEqual(faceUvCoordinates({ ...base, rotation: degrees }, [16, 16]), null);
  }
  for (const rotation of [null, 45, 360, -90, '90', {}, Number.NaN]) {
    assert.equal(supportedFaceUvRotation({ ...base, rotation }), null);
    assert.equal(faceUvCoordinates({ ...base, rotation }, [16, 16]), null);
  }
  assert.equal(supportedFaceUvRotation(undefined), null);
});

test('Box UV applies the pinned 1/64 atlas-unit inset with mirrored orientation', () => {
  const inset = 1 / 64;
  assert.deepEqual(faceUvCoordinates({ uv: [0, 0, 4, 4] }, [16, 16], true),
    [inset/16, 1-inset/16, (4-inset)/16, 1-inset/16,
      inset/16, 1-(4-inset)/16, (4-inset)/16, 1-(4-inset)/16]);
  assert.deepEqual(faceUvCoordinates({ uv: [4, 4, 0, 0] }, [16, 16], true),
    [(4-inset)/16, 1-(4-inset)/16, inset/16, 1-(4-inset)/16,
      (4-inset)/16, 1-inset/16, inset/16, 1-inset/16]);
});

test('render-side projection defaults to double, with explicit front override', async () => {
  const { previewRenderSide } = await import('./rustTextureProjection.ts');
  assert.equal(previewRenderSide('front'), 'front');
  assert.equal(previewRenderSide('double'), 'double');
  assert.equal(previewRenderSide(null), 'double');
  assert.equal(previewRenderSide(undefined), 'double');
});

test('Bedrock single-texture default follows a bounded view selection', () => {
  assert.equal(bedrockDefaultTextureIndex(null, 2), 0);
  assert.equal(bedrockDefaultTextureIndex(1, 2), 1);
  assert.equal(bedrockDefaultTextureIndex(-1, 2), 0);
  assert.equal(bedrockDefaultTextureIndex(9, 2), 0);
  assert.equal(bedrockDefaultTextureIndex(0, 0), null);
  assert.equal(bedrockDefaultTextureIndex(1.5, 2), 0);
});

test('scoped attachable preview resolves one texture and its own UV grid', () => {
  const face = { uv: [8, 4, 16, 12], texture: false };
  assert.equal(bedrockTextureForFace(face, 0, 2, true, 1), 1);
  assert.equal(bedrockTextureForFace(face, 1, 2, true, 0), 0);
  assert.equal(bedrockTextureForFace(face, 0, 2, true, null), null);
  assert.equal(bedrockTextureForFace(face, 0, 2, true, 3), null);
  assert.equal(bedrockTextureForFace({ ...face, texture: null }, 0, 2, true, 1), null);
  assert.equal(bedrockTextureForFace(face, 0, 2), 0);
  assert.deepEqual(faceUvCoordinates(face, [32, 64]),
    [0.25, 0.9375, 0.5, 0.9375, 0.25, 0.8125, 0.5, 0.8125]);
  assert.notDeepEqual(faceUvCoordinates(face, [32, 64]), faceUvCoordinates(face, [16, 16]));
});

test('Bedrock preview selects one material without rewriting saved face references', () => {
  const indexedFace = { uv: [0, 0, 4, 4], texture: 0 };
  const omittedFace = { uv: [0, 0, 4, 4] };
  const nullFace = { uv: [0, 0, 4, 4], texture: null };
  const before = JSON.stringify(indexedFace);
  assert.equal(bedrockTextureForFace(indexedFace, 1, 2), 1);
  assert.equal(bedrockTextureForFace(omittedFace, 1, 2), 1);
  assert.equal(bedrockTextureForFace(nullFace, 1, 2), null);
  assert.equal(bedrockTextureForFace({ ...indexedFace, enabled: false }, 1, 2), 1);
  assert.equal(bedrockTextureForFace({ ...nullFace, enabled: true }, 1, 2), null);
  assert.equal(bedrockTextureForFace(indexedFace, 0, 2), 0);
  assert.equal(JSON.stringify(indexedFace), before);
});

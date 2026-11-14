// Node 24 source regression; NOT_EXECUTED under the repository hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { textureIndexForFace, faceUvCoordinates, bedrockDefaultTextureIndex, bedrockTextureForFace } from './rustTextureProjection.ts';

test('default Bedrock texture is index zero; null and disabled faces remain untextured', () => {
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4] }, 1), 0);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: false }, 1), 0);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: 1 }, 2), 1);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], texture: null }, 1), null);
  assert.equal(textureIndexForFace({ uv: [0, 0, 4, 4], enabled: false }, 1), null);
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

test('Bedrock preview selects one material without rewriting saved face references', () => {
  const indexedFace = { uv: [0, 0, 4, 4], texture: 0 };
  const omittedFace = { uv: [0, 0, 4, 4] };
  const nullFace = { uv: [0, 0, 4, 4], texture: null };
  const before = JSON.stringify(indexedFace);
  assert.equal(bedrockTextureForFace(indexedFace, 1, 2), 1);
  assert.equal(bedrockTextureForFace(omittedFace, 1, 2), 1);
  assert.equal(bedrockTextureForFace(nullFace, 1, 2), null);
  assert.equal(bedrockTextureForFace({ ...indexedFace, enabled: false }, 1, 2), null);
  assert.equal(bedrockTextureForFace(indexedFace, 0, 2), 0);
  assert.equal(JSON.stringify(indexedFace), before);
});

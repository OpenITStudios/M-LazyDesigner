// Node 24 source regression; NOT_EXECUTED under the repository hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { textureIndexForFace, faceUvCoordinates } from './rustTextureProjection.ts';

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

// SOURCE_AUTHORED_NOT_RUN. No WebGL/native/Node tests executed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {faceUvCoordinates} from './rustTextureProjection.ts';
import {hitFaceLocalTexel,protectedAtlasRectangle,sameSurface,
  canBeginSurfaceSeam,SURFACE_FACE_ORDER} from './rustSurfacePaint.ts';
function uvAt(corners,s,t){
  return [
    corners[0]+s*(corners[2]-corners[0])+t*(corners[4]-corners[0]),
    corners[1]+s*(corners[3]-corners[1])+t*(corners[5]-corners[1]),
  ];
}
test('raster hit inverts signed mirrored and quarter-turn rendered UV',()=>{
  assert.deepEqual(SURFACE_FACE_ORDER,
    ['east','west','up','down','south','north']);
  for(const rotation of [0,90,180,270]){
    for(const face of [
      {uv:[2,4,10,8],rotation,texture:'atlas'},
      {uv:[10,8,2,4],rotation,texture:'atlas'},
    ]){
      const corners=faceUvCoordinates(face,[32,32],false);
      assert.ok(corners);
      const target=hitFaceLocalTexel(face,corners,uvAt(corners,.63,.37));
      assert.deepEqual(target?.size,rotation===90||rotation===270?[4,8]:[8,4]);
      assert.deepEqual(target?.texel,rotation===90||rotation===270?[2,2]:[5,1]);
    }
  }
});
test('3D pixel picker refuses unresolved, noninteger or boundary coordinates',()=>{
  const face={uv:[0,0,4,4],rotation:0,texture:'atlas'};
  const corners=faceUvCoordinates(face,[16,16],false);
  assert.equal(hitFaceLocalTexel(face,corners,uvAt(corners,1,.4)),null);
  assert.equal(hitFaceLocalTexel(face,corners,uvAt(corners,-.2,.4)),null);
  assert.equal(hitFaceLocalTexel({...face,uv:[0,0,4.5,4]},corners,
    uvAt(corners,.3,.3)),null);
  assert.equal(hitFaceLocalTexel({...face,rotation:45},corners,
    uvAt(corners,.3,.3)),null);
  assert.equal(hitFaceLocalTexel(face,[0,0],uvAt(corners,.3,.3)),null);
});
test('3D gestures cannot silently continue onto another Cube, face or atlas',()=>{
  const a={cubeUuid:'cube',face:'north',textureIndex:0,
    texel:[0,0],size:[4,4],sourceUv:[0,0,4,4],sourceRotation:0};
  assert.equal(sameSurface(a,{...a,texel:[3,3]}),true);
  assert.equal(sameSurface(a,{...a,face:'east'}),false);
  assert.equal(sameSurface(a,{...a,cubeUuid:'other'}),false);
  assert.equal(sameSurface(a,{...a,textureIndex:1}),false);
  assert.equal(sameSurface(a,{...a,sourceUv:[4,0,0,4]}),false);
  assert.equal(sameSurface(a,{...a,sourceRotation:90}),false);
});
test('reviewer masks are exact atlas rectangles with no guessed bounds',()=>{
  assert.deepEqual(protectedAtlasRectangle([7,8],[2,3],[32,32]),{
    from:[2,3],to:[8,9]});
  assert.equal(protectedAtlasRectangle([-1,1],[2,3],[32,32]),null);
  assert.equal(protectedAtlasRectangle([1,1],[32,3],[32,32]),null);
});

test('direct 3D renderer hit on mirrored Box UV inset remains face-local',()=>{
  const face={uv:[12,3,4,11],rotation:180,texture:'atlas'};
  const corners=faceUvCoordinates(face,[32,32],true);
  const hit=hitFaceLocalTexel(face,corners,uvAt(corners,.25,.875));
  assert.deepEqual(hit,{size:[8,8],texel:[2,7]});
});

test('seam candidate is only a same-atlas/same-face different Cube',()=>{
  const a={cubeUuid:'a',face:'north',textureIndex:0,
    sourceUv:[0,0,4,4],sourceRotation:0,
    texel:[3,2],size:[4,4]};
  assert.equal(canBeginSurfaceSeam(a,{...a,cubeUuid:'b'}),true);
  assert.equal(canBeginSurfaceSeam(a,{...a,cubeUuid:'b',face:'east'}),false);
  assert.equal(canBeginSurfaceSeam(a,{...a,cubeUuid:'b',textureIndex:1}),false);
  assert.equal(canBeginSurfaceSeam(a,{...a}),false);
});

test('material role brush variants never change signed UV sampling coordinates',()=>{
  const face={uv:[10,9,2,5],rotation:270,texture:'atlas'};
  const corners=faceUvCoordinates(face,[32,32],true);
  const target=hitFaceLocalTexel(face,corners,uvAt(corners,.45,.75));
  assert.deepEqual(target,{size:[4,8],texel:[1,6]});
});

/**
 * Pure, read-only alignment of four authored Mesh-face UV corners to the
 * Blockbench 5.2.2 CubeFace.UVToLocal() per-face coordinate convention.
 *
 * A signed UV rectangle can mirror either coordinate; uv_rotation supports
 * 0/90/180/270 in the Bedrock format. Only a corner-verified candidate is
 * reported. No Cube is instantiated or exported here.
 */
export type CubeSide = "north" | "south" | "east" | "west" | "up" | "down";
export type CubeUvCorner = Readonly<{
  position: readonly number[];
  uv: readonly number[];
}>;
export type CubeFaceUvPlan = Readonly<{
  state: "representable";
  uv: readonly [number, number, number, number];
  rotation: 0 | 90 | 180 | 270;
  max_corner_uv_error: number;
  uv_mirrored_u: boolean;
  uv_mirrored_v: boolean;
  geometry_to_uv_convention: "BLOCKBENCH_5_2_2_CUBEFACE_UVTOLOCAL";
  native_export_verified: false;
}> | Readonly<{
  state: "blocked";
  reason:
    | "CUBE_UV_INVALID_BOUNDARY"
    | "CUBE_UV_INVALID_CORNER"
    | "CUBE_UV_INCOMPLETE_RECTANGLE"
    | "CUBE_UV_DEGENERATE_RECTANGLE"
    | "CUBE_UV_CORNER_ORIENTATION_UNREPRESENTABLE";
  native_export_verified: false;
}>;

const EPS = 1e-7;
const ROTATIONS = [0, 90, 180, 270] as const;
const opposite = (v:number)=>1-v;
const close=(a:number,b:number)=>Math.abs(a-b)<=EPS;

function finiteVec(value:readonly number[],length:number):boolean {
  return Array.isArray(value) && value.length===length &&
    value.every((x)=>typeof x==="number" && Number.isFinite(x));
}

function localFaceCorner(
  side:CubeSide,p:readonly number[],from:readonly number[],to:readonly number[]
):[number,number]|null {
  const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2];
  if(!(dx>EPS && dy>EPS && dz>EPS))return null;
  switch(side){
    case "north":
      if(!close(p[2],from[2]))return null;
      return [(to[0]-p[0])/dx,(to[1]-p[1])/dy];
    case "south":
      if(!close(p[2],to[2]))return null;
      return [(p[0]-from[0])/dx,(to[1]-p[1])/dy];
    case "east":
      if(!close(p[0],to[0]))return null;
      return [(to[2]-p[2])/dz,(to[1]-p[1])/dy];
    case "west":
      if(!close(p[0],from[0]))return null;
      return [(p[2]-from[2])/dz,(to[1]-p[1])/dy];
    case "up":
      if(!close(p[1],to[1]))return null;
      return [(p[0]-from[0])/dx,(p[2]-from[2])/dz];
    case "down":
      if(!close(p[1],from[1]))return null;
      return [(p[0]-from[0])/dx,(to[2]-p[2])/dz];
  }
}

function unrotate(x:number,y:number,rotation:number):[number,number]{
  // CubeFace.UVToLocal(): for every +90, [x,y] = [1-y,x].
  // Recover the UV interpolation fractions from the geometry corner.
  for(let i=0;i<rotation;i+=90)[x,y]=[y,opposite(x)];
  return [x,y];
}

/**
 * Try every rotation and independently signed UV rectangle, and confirm the
 * exact authored UV at each geometric corner. A rectangular UV bounding box
 * ALONE is insufficient: an arbitrary permutation can scramble its artwork.
 */
export function planCubeFaceUvFromMeshCorners(input: {
  face:CubeSide;
  from:readonly number[];
  to:readonly number[];
  corners:readonly CubeUvCorner[];
}):CubeFaceUvPlan {
  const fail=(reason:Extract<CubeFaceUvPlan,{state:"blocked"}>["reason"])=>({
    state:"blocked" as const,reason,native_export_verified:false as const,
  });
  if(!finiteVec(input.from,3) || !finiteVec(input.to,3) ||
     !["north","south","east","west","up","down"].includes(input.face) ||
     ![0,1,2].every(i=>input.to[i]-input.from[i]>EPS)){
    return fail("CUBE_UV_INVALID_BOUNDARY");
  }
  if(!Array.isArray(input.corners) || input.corners.length!==4 ||
     input.corners.some(c=>!c || !finiteVec(c.position,3) ||
       !finiteVec(c.uv,2))){
    return fail("CUBE_UV_INVALID_CORNER");
  }
  const positions=input.corners.map(c=>
    localFaceCorner(input.face,c.position,input.from,input.to)
  );
  if(positions.some(p=>!p || !p.every(v=>close(v,0)||close(v,1)))){
    return fail("CUBE_UV_INCOMPLETE_RECTANGLE");
  }
  const positionsSet=new Set(positions.map(p=>
    (close(p![0],0)?"0":"1")+(close(p![1],0)?"0":"1")
  ));
  if(positionsSet.size!==4)return fail("CUBE_UV_INCOMPLETE_RECTANGLE");
  const us=input.corners.map(c=>c.uv[0]),vs=input.corners.map(c=>c.uv[1]);
  const minU=Math.min(...us),maxU=Math.max(...us),
        minV=Math.min(...vs),maxV=Math.max(...vs);
  if(maxU-minU<=EPS || maxV-minV<=EPS){
    return fail("CUBE_UV_DEGENERATE_RECTANGLE");
  }
  // Choose lowest rotation then lowest reflection count for stable receipts.
  for(const rotation of ROTATIONS){
    for(const flipU of [false,true]){
      for(const flipV of [false,true]){
        const startU=flipU?maxU:minU,endU=flipU?minU:maxU;
        const startV=flipV?maxV:minV,endV=flipV?minV:maxV;
        let maximum=0;
        let match=true;
        for(let i=0;i<4;i++){
          const [u,v]=unrotate(positions[i]![0],positions[i]![1],rotation);
          const observed=input.corners[i].uv;
          const a=startU+u*(endU-startU),b=startV+v*(endV-startV);
          const delta=Math.max(Math.abs(a-observed[0]),Math.abs(b-observed[1]));
          if(!Number.isFinite(delta)||delta>EPS){match=false;break;}
          maximum=Math.max(maximum,delta);
        }
        if(match){
          return {
            state:"representable" as const,
            uv:[startU,startV,endU,endV] as const,
            rotation,
            max_corner_uv_error:Number(maximum.toPrecision(6)),
            uv_mirrored_u:flipU,
            uv_mirrored_v:flipV,
            geometry_to_uv_convention:"BLOCKBENCH_5_2_2_CUBEFACE_UVTOLOCAL" as const,
            native_export_verified:false as const,
          };
        }
      }
    }
  }
  return fail("CUBE_UV_CORNER_ORIENTATION_UNREPRESENTABLE");
}

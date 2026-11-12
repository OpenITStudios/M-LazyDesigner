import { describe, expect, test } from "bun:test";
import {
  planBalancedTextureFaceScanOrder,
  TEXTURE_CUBE_LOCAL_FACE_SCAN_ORDER,
} from "@/lib/textureOptimization";

type Face = typeof TEXTURE_CUBE_LOCAL_FACE_SCAN_ORDER[number];
describe("balanced bounded texture face scan", () => {
  test("all 372 candidates are retained, six directions remain represented under budget", () => {
    const targets = Array.from({length:62},(_,i)=>
      TEXTURE_CUBE_LOCAL_FACE_SCAN_ORDER.map(face=>({
        cube_uuid: "cube-"+String(i).padStart(3,"0"), face,
      }))
    ).flat();
    const ordered = planBalancedTextureFaceScanOrder([...targets].reverse());
    expect(ordered).toEqual(planBalancedTextureFaceScanOrder(targets));
    expect(new Set(ordered.map(t=>t.cube_uuid+":"+t.face)).size).toBe(372);
    const accepted = ordered.slice(0,128); // 32768 / (16 * 16)
    for(const face of TEXTURE_CUBE_LOCAL_FACE_SCAN_ORDER) {
      const count=accepted.filter(t=>t.face===face).length;
      expect(count).toBeGreaterThanOrEqual(21);
      expect(count).toBeLessThanOrEqual(22);
    }
    expect(accepted.some(t=>t.cube_uuid==="cube-061")).toBe(true);
  });

  test("unequal/absent directions never produce duplicate or invented targets",()=>{
    const targets: Array<{cube_uuid:string;face:Face}> = [
      {cube_uuid:"a",face:"east"},{cube_uuid:"b",face:"west"},
      {cube_uuid:"b",face:"north"},
    ];
    const ordered=planBalancedTextureFaceScanOrder(targets);
    expect(ordered.map(t=>t.face)).toEqual(["north","west","east"]);
    expect(new Set(ordered.map(t=>t.cube_uuid+":"+t.face)).size).toBe(3);
  });

  test("mocked native 372-face scan stays at 32768 pixels and reports partial/unevaluated",()=>{
    const run=Bun.spawnSync([process.execPath,"-e",`
      import {textureOptimizationRuntime} from "./server/tools/validation/qualityIntelligence.ts";
      const dirs=["down","up","south","north","west","east"];
      let reads=0;
      const texture={
        uuid:"atlas",name:"atlas",getUVWidth:()=>512,getUVHeight:()=>512,
        ctx:{canvas:{width:512,height:512},getImageData(_x,_y,w,h){
          reads++;const data=new Uint8ClampedArray(w*h*4);
          for(let i=3;i<data.length;i+=4)data[i]=255;
          return {data};
        }}
      };
      globalThis.Texture={all:[texture]};
      globalThis.Cube={all:Array.from({length:62},(_,i)=>({
        uuid:"cube-"+String(i).padStart(3,"0"),name:"cube",
        faces:Object.fromEntries(dirs.map((face,j)=>{
          const n=i*6+j,x=(n%32)*16,y=Math.floor(n/32)*16;
          return [face,{enabled:true,texture:"atlas",uv:[x,y,x+16,y+16],
            getTexture:()=>texture}];
        }))
      }))};
      const out=textureOptimizationRuntime();
      console.log(JSON.stringify({
        dirs:out.coverage.cube_local_face_coverage.directions,
        readCount:reads,scanned:out.scan.complete_face_patches,
        omitted:out.scan.omitted_faces,used:out.pixel_budget_used,
        gate:out.coverage.gate.state,verdict:out.coverage.visual_verdict
      }));
    `],{cwd:process.cwd()});
    expect(run.exitCode,run.stderr.toString()).toBe(0);
    const out=JSON.parse(run.stdout.toString());
    expect(out.scanned).toBe(128);
    expect(out.omitted).toBe(244);
    expect(out.used).toBe(32768);
    expect(out.readCount).toBe(128);
    expect(out.gate).toBe("partial");
    expect(out.verdict).toBe("not_evaluated");
    expect(out.dirs).toHaveLength(6);
    for(const face of TEXTURE_CUBE_LOCAL_FACE_SCAN_ORDER) {
      const row=out.dirs.find((entry:{local_face:string})=>entry.local_face===face);
      expect(row).toBeDefined();
      expect(row.scanned).toBeGreaterThanOrEqual(21);
      expect(row.scanned).toBeLessThanOrEqual(22);
      expect(row.scanned+row.omitted).toBe(62);
    }
  });
});

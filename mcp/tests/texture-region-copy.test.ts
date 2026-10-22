import {describe,expect,test} from "bun:test";
import {applyPaintTransactionRgba,planPaintTransaction,paintTransactionOperationSchema,paintTransactionParameters} from "@/lib/paintTransaction";
const source=new Uint8ClampedArray([10,20,30,255,40,50,60,0,70,80,90,128,100,110,120,255]);
const copy=(extra={})=>paintTransactionOperationSchema.parse({operation:"copy_region",source:{x:0,y:0,width:2,height:1},target:{x:2,y:0},flip_x:true,...extra});
describe("entity atlas region copy",()=>{
  test("mirrors complete RGBA without touching source",()=>{
    const result=applyPaintTransactionRgba(source,4,1,[copy()]);
    expect(result.pixels.slice(8)).toEqual(new Uint8ClampedArray([40,50,60,0,10,20,30,255]));
    expect(result.pixels.slice(0,8)).toEqual(source.slice(0,8));
    expect(result.affected_rect).toEqual([2,0,4,1]);
  });
  test("overlap reads a snapshot, not partially overwritten pixels",()=>{
    const result=applyPaintTransactionRgba(source,4,1,[copy({source:{x:0,y:0,width:3,height:1},target:{x:1,y:0},flip_x:false})]);
    expect(result.pixels.slice(4)).toEqual(source.slice(0,12));
  });
  test("shared operation schema keeps Runtime parameters and planner at the same 1–64 boundary",()=>{
    const revision = "sha256:4x1:"+"a".repeat(64);
    for(const count of [0,1,64,65]){
      const operations=Array.from({length:count},()=>copy());
      const accepted=count>=1&&count<=64;
      expect(paintTransactionParameters.safeParse({expected_revision:revision,operations}).success,count.toString()).toBe(accepted);
      if(accepted){
        const plan=planPaintTransaction(operations,4,1);
        expect(plan.operation_count).toBe(count);
        expect(plan.pixel_writes).toBe(2*count);
        expect(plan.affected_rect).toEqual([2,0,4,1]);
      }else{
        expect(()=>planPaintTransaction(operations,4,1)).toThrow();
      }
    }
  });
  test("shared operation schema rejects malformed operation in both registration and planning",()=>{
    const revision="sha256:4x1:"+"a".repeat(64);
    const invalid={operation:"copy_region",source:{x:0,y:0,width:2,height:1},target:{x:2,y:0},flip_x:"yes"};
    expect(paintTransactionParameters.safeParse({expected_revision:revision,operations:[invalid]}).success).toBe(false);
    expect(()=>planPaintTransaction([invalid] as any,4,1)).toThrow();
  });
  test("flips vertically and rejects out-of-bounds destination",()=>{
    const result=applyPaintTransactionRgba(source,2,2,[copy({source:{x:0,y:0,width:2,height:2},target:{x:0,y:0},flip_x:false,flip_y:true})]);
    expect(result.pixels.slice(0,8)).toEqual(source.slice(8));
    expect(()=>applyPaintTransactionRgba(source,4,1,[copy({target:{x:3,y:0}})])).toThrow("outside");
  });
});

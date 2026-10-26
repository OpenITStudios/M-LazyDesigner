import {describe,expect,test} from "bun:test";
import {applyPaintTransactionRgba,planPaintTransaction,paintTransactionOperationSchema,paintTransactionParameters,requireExactBrushPostcondition} from "@/lib/paintTransaction";
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
  test("color validation runs through the operation schema; apply still decodes precise RGBA",()=>{
    const revision="sha256:4x1:"+"a".repeat(64);
    for(const invalid of [
      {operation:"fill_rect",color:"#1122GG",rect:{x:0,y:0,width:1,height:1}},
      {operation:"set_pixels",color:"blue",coordinates:[{x:1,y:0}]},
    ]){
      expect(paintTransactionParameters.safeParse({
        expected_revision:revision,operations:[invalid],
      }).success).toBe(false);
      expect(()=>planPaintTransaction([invalid] as any,4,1)).toThrow();
      expect(()=>applyPaintTransactionRgba(source,4,1,[invalid] as any)).toThrow();
    }
    const operations=paintTransactionParameters.parse({
      expected_revision:revision,
      operations:[
        {operation:"fill_rect",color:"#11223344",rect:{x:0,y:0,width:2,height:1}},
        {operation:"set_pixels",color:"#AABBCC",coordinates:[{x:1,y:0}]},
      ],
    }).operations!;
    const plan=planPaintTransaction(operations,4,1);
    expect(plan.pixel_writes).toBe(3);
    expect(plan.affected_rect).toEqual([0,0,2,1]);
    const result=applyPaintTransactionRgba(source,4,1,operations);
    expect(Array.from(result.pixels.slice(0,8))).toEqual([
      17,34,51,68,170,187,204,255,
    ]);
    expect(result.pixels.slice(8)).toEqual(source.slice(8));
  });


  test("exact brush native readback verifies requested RGBA and protects nearby pixels", () => {
    const original = new Uint8ClampedArray(3 * 2 * 4);
    const modified = original.slice();
    modified.set([17, 34, 51, 128], (1 * 3 + 1) * 4);
    expect(requireExactBrushPostcondition(
      original, modified, 3, 2, [{ x: 1, y: 1 }], "#11223380"
    )).toBe(1);

    const roundedAlpha = original.slice();
    roundedAlpha.set([18, 34, 52, 128], (1 * 3 + 1) * 4);
    expect(requireExactBrushPostcondition(
      original, roundedAlpha, 3, 2, [{ x: 1, y: 1 }], "#11223380"
    )).toBe(1);

    // A missed draw, even when the callback reports success, cannot commit.
    expect(() => requireExactBrushPostcondition(
      original, original.slice(), 3, 2, [{ x: 1, y: 1 }], "#11223380"
    )).toThrow("did not apply the requested RGBA");

    // Correct color at the target is not enough when the native brush also
    // changes a neighboring pixel in the same bounded rectangle.
    const spill = modified.slice();
    spill.set([255, 0, 0, 255], 0);
    expect(() => requireExactBrushPostcondition(
      original, spill, 3, 2,
      [{ x: 0, y: 1 }, { x: 1, y: 1 }], "#11223380"
    )).toThrow("changed an unrequested pixel");
    const spillBetween = original.slice();
    spillBetween.set([17, 34, 51, 128], (1 * 3) * 4);
    spillBetween.set([17, 34, 51, 128], (1 * 3 + 2) * 4);
    spillBetween.set([17, 34, 51, 128], (1 * 3 + 1) * 4);
    expect(() => requireExactBrushPostcondition(
      original, spillBetween, 3, 2,
      [{ x: 0, y: 1 }, { x: 2, y: 1 }], "#11223380"
    )).toThrow("changed an unrequested pixel");

    // A byte-wise RGB drift under zero alpha is not a visible authored edit.
    const transparent = original.slice();
    transparent.set([200, 99, 77, 0], 0);
    expect(() => requireExactBrushPostcondition(
      original, transparent, 3, 2, [{ x: 0, y: 0 }], "#11223300"
    )).toThrow("no authored pixel change");

    const duplicateTargets = [{ x: 1, y: 1 }, { x: 1, y: 1 }];
    expect(requireExactBrushPostcondition(
      original, modified, 3, 2, duplicateTargets, "#11223380"
    )).toBe(1);
    expect(() => requireExactBrushPostcondition(
      original, modified, 3, 2, [{ x: 3, y: 1 }], "#11223380"
    )).toThrow("outside readback region");
  });

  test("flips vertically and rejects out-of-bounds destination",()=>{
    const result=applyPaintTransactionRgba(source,2,2,[copy({source:{x:0,y:0,width:2,height:2},target:{x:0,y:0},flip_x:false,flip_y:true})]);
    expect(result.pixels.slice(0,8)).toEqual(source.slice(8));
    expect(()=>applyPaintTransactionRgba(source,4,1,[copy({target:{x:3,y:0}})])).toThrow("outside");
  });
});

import { expect, test } from "bun:test";
import { inspectPaintStylingEvidence } from "@/lib/texture/stylingEvidence";

function grid(w:number,h:number,choose:(x:number,y:number)=>readonly[number,number,number,number]){
  const rgba=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)
    rgba.set(choose(x,y),(y*w+x)*4);
  return rgba;
}
test("one-color 8x8 fill is BASE_ONLY, not styled, even with successful bitmap changes",()=>{
  const rgba=grid(8,8,()=>[80,80,80,255]);
  const result=inspectPaintStylingEvidence(rgba,8,8);
  expect(result.status).toBe("BASE_ONLY_CANDIDATE");
  expect(result.review_hints).toContain("UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE");
  expect(result.visual_verdict).toBe("UNVERIFIED");
  expect(result.texture_completion_attested).toBe(false);
});
test("similar but distinct RGB in one quantized bucket is not mislabeled a single-color fill",()=>{
  const rgba=grid(8,8,(x,y)=>x<4?[100,100,100,255]:[110,110,110,255]);
  const result=inspectPaintStylingEvidence(rgba,8,8);
  expect(result.color_bucket_count).toBe(1);
  expect(result.exact_uniform_visible_rgb).toBe(false);
  expect(result.review_hints).not.toContain("UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE");
  expect(result.status).toBe("REVIEW_REQUIRED"); // weak form contrast still needs comparison
});
test("three big horizontal bands produce a review warning despite three strong colors",()=>{
  const rgba=grid(8,8,(_x,y)=>y<2?[55,70,90,255]:
    y<6?[120,132,145,255]:[195,205,215,255]);
  const result=inspectPaintStylingEvidence(rgba,8,8);
  expect(result.review_hints).toContain("UNIFORM_HORIZONTAL_BANDS_REVIEW");
  expect(result.status).toBe("REVIEW_REQUIRED");
});
test("checkerboard variation is never accepted as form-following material",()=>{
  const rgba=grid(8,8,(x,y)=>(x+y)%2?[8,8,8,255]:[240,240,240,255]);
  const result=inspectPaintStylingEvidence(rgba,8,8);
  expect(result.review_hints).toContain("FRAGMENTED_OR_NOISE_FIRST_REVIEW");
  expect(result.texture_completion_attested).toBe(false);
});
test("a small intentional identity pixel cannot be classified as a failed whole material",()=>{
  const rgba=grid(2,2,()=>[200,20,20,255]);
  const result=inspectPaintStylingEvidence(rgba,2,2);
  expect(result.status).toBe("NOT_EVALUATED");
  expect(result.scope).toBe("affected_atlas_crop_only");
});
test("stepped clusters still need actual shaded mapped-model evidence for quality",()=>{
  const rgba=grid(8,8,(x,y)=>x<3&&y<3?[35,39,50,255]:
    x>4&&y<4?[190,195,215,255]:[110,120,145,255]);
  const result=inspectPaintStylingEvidence(rgba,8,8);
  expect(result.status).not.toBe("BASE_ONLY_CANDIDATE");
  expect(result.visual_verdict).toBe("UNVERIFIED");
  expect(result.texture_completion_attested).toBe(false);
});
test("large valid bitmap does not fail native painting just because optional evidence is bounded",()=>{
  const w=1025,h=1025;
  const result=inspectPaintStylingEvidence({length:w*h*4},w,h);
  expect(result.status).toBe("NOT_EVALUATED");
  expect(result.visual_verdict).toBe("UNVERIFIED");
  expect(result.texture_completion_attested).toBe(false);
});
test("malformed bitmap input is never silently treated as style clearance",()=>{
  expect(()=>inspectPaintStylingEvidence(new Uint8Array(3),8,8))
    .toThrow("TEXTURE_STYLING_EVIDENCE_BITMAP_INVALID");
});

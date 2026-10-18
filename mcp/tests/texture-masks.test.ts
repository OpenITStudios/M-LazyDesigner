import { describe, expect, test } from "bun:test";
import { edgeMask } from "@/lib/texture/masks";
import { applyDirectionalWear, applyMaskedColor } from "@/lib/texture/maskedOps";
import { applyGeometryAwareMaterialTreatment } from "@/lib/texture/geometryAwareTreatment";
import { renderTextureSourceRecipe } from "@/lib/texture/sourceComposer";

describe("procedural texture masks",()=>{
  test("builds deterministic edge masks and uses them in source composition",()=>{
    const edge=edgeMask(5,5,2);
    expect(edge.values[0]).toBe(1);
    expect(edge.values[12]).toBe(0);
    const rendered=renderTextureSourceRecipe({
      material:{kind:"PLASTIC",width:5,height:5,base:[20,20,20,255],variation:0},
      edge_treatment:{color:[100,100,100,255],strength:1,falloff:2},
    });
    expect(rendered[0]).toBe(100);
    expect(rendered[(2*5+2)*4]).toBe(20);
  });
});

describe("geometry-aware texture alpha boundaries", () => {
  test("wear and grime preserve transparent atlas islands, cutout alpha and original input", () => {
    const src = new Uint8Array([
      60, 90, 120, 0,    70, 90, 120, 128,
      80, 90, 120, 255,  90, 90, 120, 255,
    ]);
    const original = Array.from(src);
    const full = { width: 2, height: 2, values: new Float32Array([1, 1, 1, 1]) };
    const corner = { width: 2, height: 2, values: new Float32Array([0, 1, 0, 0]) };
    const result = applyGeometryAwareMaterialTreatment(src, 2, 2, {
      edge: full,
      contact: corner,
    }, {
      wear: { color: [240, 20, 20, 255], strength: 1 },
      contact_dirt: { color: [5, 5, 5, 0], strength: 1 },
    });
    expect(Array.from(src)).toEqual(original);
    expect(Array.from(result.slice(0, 4))).toEqual(original.slice(0, 4));
    expect(Array.from(result.filter((_, i) => i % 4 === 3))).toEqual([0, 128, 255, 255]);
    expect(Array.from(result.slice(4, 8))).toEqual([5, 5, 5, 128]);
    expect(Array.from(result.slice(8, 12))).toEqual([240, 20, 20, 255]);
  });

  test("composed edge and directional wear cannot paint transparent pixels or erase semi-alpha", () => {
    const blank = renderTextureSourceRecipe({
      material: { kind: "PLASTIC", width: 3, height: 3, base: [20, 30, 40, 0], variation: 0 },
      edge_treatment: { color: [250, 0, 0, 255], strength: 1, falloff: 2 },
      directional_wear: { color: [255, 255, 0, 255], strength: 1, falloff: 2, axis: "y" },
    });
    for (let i = 3; i < blank.length; i += 4) expect(blank[i]).toBe(0);

    const translucent = renderTextureSourceRecipe({
      material: { kind: "PLASTIC", width: 3, height: 3, base: [20, 30, 40, 128], variation: 0 },
      edge_treatment: { color: [250, 0, 0, 0], strength: 1, falloff: 2 },
      directional_wear: { color: [255, 255, 0, 0], strength: 1, falloff: 2, axis: "y" },
    });
    for (let i = 3; i < translucent.length; i += 4) expect(translucent[i]).toBe(128);
    expect(translucent[0]).not.toBe(20);
  });

  test("general masked color remains RGBA-capable unless preservation is explicitly requested", () => {
    const source = new Uint8Array([10, 20, 30, 0]);
    const mask = { width: 1, height: 1, values: new Float32Array([1]) };
    expect(Array.from(applyMaskedColor(source, 1, 1, mask, [90, 90, 90, 255], 1)))
      .toEqual([90, 90, 90, 255]);
    expect(Array.from(applyMaskedColor(source, 1, 1, mask, [90, 90, 90, 255], 1,
      { preserveAlpha: true, skipTransparent: true })))
      .toEqual([10, 20, 30, 0]);
  });
});

describe("mask evidence must not silently corrupt authored texture", () => {
  const original = new Uint8Array([40, 70, 120, 0, 140, 180, 210, 128]);

  test("rejects NaN/infinite coverage without mutating original RGBA", () => {
    const before = Array.from(original);
    for (const badWeight of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const mask = { width: 2, height: 1, values: new Float32Array([0.5, badWeight]) };
      expect(() => applyMaskedColor(original, 2, 1, mask, [255, 0, 0, 255], 1))
        .toThrow("finite mask weights");
      expect(() => applyDirectionalWear(original, 2, 1, mask, [255, 0, 0, 255], "x", 1))
        .toThrow("finite mask weights");
      expect(() => applyGeometryAwareMaterialTreatment(original, 2, 1,
        { edge: mask }, { wear: { color: [255, 0, 0, 255], strength: 1 } }))
        .toThrow("finite mask weights");
      expect(Array.from(original)).toEqual(before);
    }
  });

  test("rejects incomplete coverage and invalid colors before any paint result", () => {
    const incomplete = { width: 2, height: 1, values: new Float32Array([1]) };
    expect(() => applyDirectionalWear(original, 2, 1, incomplete, [255, 255, 0, 255], "y", 1))
      .toThrow("Mask dimensions");
    const valid = { width: 2, height: 1, values: new Float32Array([1, 1]) };
    expect(() => applyMaskedColor(original, 2, 1, valid, [255, Number.NaN, 0, 255], 1))
      .toThrow("finite RGBA");
  });

  test("finite normalized masks preserve cutout alpha with protected color styling", () => {
    const valid = { width: 2, height: 1, values: new Float32Array([1, 0.5]) };
    const result = applyDirectionalWear(original, 2, 1, valid, [200, 10, 10, 255], "x", 1,
      { preserveAlpha: true, skipTransparent: true });
    expect([...result.slice(0, 4)]).toEqual([...original.slice(0, 4)]);
    expect(result[7]).toBe(128);
    expect(result[4]).not.toBe(original[4]);
    expect(Array.from(original)).toEqual([40, 70, 120, 0, 140, 180, 210, 128]);
  });
});

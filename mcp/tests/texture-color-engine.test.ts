import { describe, expect, test } from "bun:test";
import {
  autoLevelsRgba,
  createTextureColorComputeContext,
  directionalShadeRgba,
  extractPaletteMedianCut,
  generateShadeRamp,
  generateSpatialGradientRgba,
  gradientMapRgba,
  heightFieldFromRgba,
  nearestPaletteIndex,
  oklabToRgba,
  palettizeErrorDiffusionRgba,
  palettizeRgba,
  posterizeLightnessRgba,
  parseHexRgba,
  rgbaToHex,
  rgbaToOklab,
  sobelHeightGradient,
} from "@/lib/textureColorEngine";

function lightness(hex: string): number {
  return rgbaToOklab(parseHexRgba(hex)).L;
}

describe("texture color intelligence core", () => {
  test("scalar Oklab hot paths preserve blended gradient determinism", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 16 }, (_, index) => {
        const value = 32 + index * 12;
        return [value, value, value, 255];
      }).flat()
    );
    const first = gradientMapRgba(
      pixels,
      4,
      4,
      ["#201510", "#845442", "#D8A070"],
      { mode: "blend" }
    );
    const second = gradientMapRgba(
      pixels,
      4,
      4,
      ["#201510", "#845442", "#D8A070"],
      { mode: "blend" }
    );
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  test("channel-based hot paths preserve cached Oklab output semantics", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 32 }, (_, index) => {
        const value = index % 2 === 0 ? 72 : 184;
        return [value, value - 12, value - 24, 255];
      }).flat()
    );
    const context = createTextureColorComputeContext();
    const first = posterizeLightnessRgba(
      pixels,
      8,
      4,
      { levels: 4, strength: 0.8 },
      context
    );
    const second = posterizeLightnessRgba(
      pixels,
      8,
      4,
      { levels: 4, strength: 0.8 },
      context
    );

    expect(Array.from(second)).toEqual(Array.from(first));
    expect(context.metrics.oklab_cache_hits).toBeGreaterThan(0);
  });

  test("Oklab conversion round-trips representative sRGB colors", () => {
    for (const color of [
      "#000000",
      "#FFFFFF",
      "#845442",
      "#27A5D8",
      "#E34B71",
      "#81B24C",
    ]) {
      const source = parseHexRgba(color);
      const roundTrip = oklabToRgba(rgbaToOklab(source), source[3]);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(
          Math.abs(roundTrip[channel] - source[channel]),
          color
        ).toBeLessThanOrEqual(1);
      }
    }
  });


  test("selective hue gradient maps preserve unrelated hues, neutral pixels, and alpha", () => {
    const pixels = new Uint8ClampedArray([
      64, 0, 0, 255, 200, 0, 0, 190,
      0, 0, 255, 255, 80, 80, 80, 255, 255, 0, 0, 0,
    ]);
    const before = [...pixels];
    const result = gradientMapRgba(pixels, 5, 1, ["#16441e", "#c1f4c4"], {
      sourceHueColor: "#ff0000", hueToleranceDegrees: 25,
    });
    expect([...result.slice(0, 3)]).not.toEqual(before.slice(0, 3));
    expect([...result.slice(4, 7)]).not.toEqual(before.slice(4, 7));
    expect(result[7]).toBe(190);
    expect([...result.slice(8)]).toEqual(before.slice(8));
    expect([...pixels]).toEqual(before);
  });

  test("selective hue gradient maps reject near-neutral source and descending shade ramp", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
    expect(() => gradientMapRgba(pixels, 1, 1, ["#16441e", "#c1f4c4"], {
      sourceHueColor: "#777777",
    })).toThrow("near-neutral");
    expect(() => gradientMapRgba(pixels, 1, 1, ["#c1f4c4", "#16441e"], {
      sourceHueColor: "#ff0000",
    })).toThrow("strictly increasing");
  });


  test("empty or invisible hue source fails closed instead of recoloring an entire atlas", () => {
    const pixels = new Uint8ClampedArray([
      240, 10, 10, 255, 10, 20, 240, 255,
    ]);
    const original = [...pixels];
    const ramp = ["#16441e", "#c1f4c4"];
    for (const badSource of ["", "#ff000000"]) {
      expect(() => gradientMapRgba(pixels, 2, 1, ramp, {
        sourceHueColor: badSource,
      })).toThrow(/Hue-family source color/);
    }
    expect([...pixels]).toEqual(original);
  });

  test("translucent but visible source swatches remain eligible for hue selection", () => {
    const pixels = new Uint8ClampedArray([
      200, 0, 0, 100, 0, 0, 255, 255,
    ]);
    const result = gradientMapRgba(pixels, 2, 1,
      ["#16441e", "#c1f4c4"], { sourceHueColor: "#ff000080" });
    expect([...result.slice(0, 3)]).not.toEqual([...pixels.slice(0, 3)]);
    expect(result[3]).toBe(100);
    expect([...result.slice(4)]).toEqual([...pixels.slice(4)]);
  });

  test("shade ramps are deterministic and monotonic in perceived lightness", () => {
    const ramp = generateShadeRamp("#845442", { steps: 5 });
    expect(ramp).toHaveLength(5);
    expect(ramp[2]).toBe("#845442");

    const values = ramp.map(lightness);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1]);
    }

    expect(generateShadeRamp("#845442", { steps: 5 })).toEqual(ramp);
  });

  test("custom shade-ramp controls remain bounded and deterministic", () => {
    const ramp = generateShadeRamp("#557799", {
      steps: 7,
      shadowLightnessDelta: -0.3,
      highlightLightnessDelta: 0.18,
      shadowHueShift: -14,
      highlightHueShift: 10,
      shadowChromaScale: 1.1,
      highlightChromaScale: 0.8,
    });

    expect(ramp).toHaveLength(7);
    expect(new Set(ramp).size).toBeGreaterThanOrEqual(5);
    expect(ramp.every((color) => /^#[0-9A-F]{6}$/.test(color))).toBe(true);
  });

  test("nearest palette matching uses perceptual color distance", () => {
    const palette = ["#101010", "#808080", "#F0F0F0"];
    expect(nearestPaletteIndex(parseHexRgba("#777777"), palette)).toBe(1);
    expect(nearestPaletteIndex(parseHexRgba("#F9F9F9"), palette)).toBe(2);
  });

  test("nearest gradient map collapses grayscale into explicit shade steps", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      128, 128, 128, 255,
      255, 255, 255, 255,
      0, 0, 0, 0,
    ]);
    const ramp = ["#220000", "#AA5500", "#FFF0C0"];
    const mapped = gradientMapRgba(pixels, 4, 1, ramp, {
      mode: "nearest",
    });

    expect(rgbaToHex(Array.from(mapped.slice(0, 4)) as [number,number,number,number])).toBe("#220000");
    expect(rgbaToHex(Array.from(mapped.slice(4, 8)) as [number,number,number,number])).toBe("#AA5500");
    expect(rgbaToHex(Array.from(mapped.slice(8, 12)) as [number,number,number,number])).toBe("#FFF0C0");
    expect(Array.from(mapped.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  test("ordered gradient mapping is deterministic and uses only ramp colors", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 8 * 8 }, () => [128, 128, 128, 255]).flat()
    );
    const ramp = ["#000000", "#FFFFFF"];
    const first = gradientMapRgba(pixels, 8, 8, ramp, {
      mode: "ordered",
      matrix: "bayer4",
    });
    const second = gradientMapRgba(pixels, 8, 8, ramp, {
      mode: "ordered",
      matrix: "bayer4",
    });

    expect(Array.from(second)).toEqual(Array.from(first));
    const colors = new Set<string>();
    for (let offset = 0; offset < first.length; offset += 4) {
      colors.add(
        rgbaToHex([
          first[offset],
          first[offset + 1],
          first[offset + 2],
          first[offset + 3],
        ])
      );
    }
    expect([...colors].sort()).toEqual(["#000000", "#FFFFFF"]);
  });

  test("palettize preserves exact palette colors and alpha", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 128,
      10, 10, 10, 0,
    ]);
    const result = palettizeRgba(
      pixels,
      3,
      1,
      ["#FF0000", "#00FF00", "#0000FF"],
      { dither: "none" }
    );

    expect(Array.from(result)).toEqual(Array.from(pixels));
  });

  test("ordered palettize is deterministic and remains palette-bound", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 16 }, () => [120, 120, 120, 255]).flat()
    );
    const palette = ["#000000", "#FFFFFF"];
    const result = palettizeRgba(pixels, 4, 4, palette, {
      dither: "ordered",
      matrix: "bayer2",
    });

    const colors = new Set<string>();
    for (let offset = 0; offset < result.length; offset += 4) {
      colors.add(
        rgbaToHex([
          result[offset],
          result[offset + 1],
          result[offset + 2],
          result[offset + 3],
        ])
      );
    }
    expect(colors.size).toBe(2);
    expect([...colors].every((color) => palette.includes(color))).toBe(true);
  });

  test("median-cut extraction returns a deterministic lightness-sorted palette", () => {
    const pixels = new Uint8ClampedArray([
      ...Array.from({ length: 8 }, () => [10, 10, 10, 255]).flat(),
      ...Array.from({ length: 8 }, () => [230, 230, 230, 255]).flat(),
    ]);
    const palette = extractPaletteMedianCut(pixels, 16, 1, 2);

    expect(palette).toHaveLength(2);
    expect(lightness(palette[0])).toBeLessThan(lightness(palette[1]));
    expect(extractPaletteMedianCut(pixels, 16, 1, 2)).toEqual(palette);
  });

  test("auto levels expands visible tonal range without touching transparency", () => {
    const pixels = new Uint8ClampedArray([
      80, 80, 80, 255,
      100, 100, 100, 255,
      120, 120, 120, 255,
      0, 0, 0, 0,
    ]);
    const result = autoLevelsRgba(pixels, 4, 1, {
      lowClipPercent: 0,
      highClipPercent: 0,
    });

    expect(rgbaToOklab(Array.from(result.slice(0, 4)) as [number,number,number,number]).L)
      .toBeLessThan(
        rgbaToOklab(Array.from(result.slice(8, 12)) as [number,number,number,number]).L
      );
    expect(Array.from(result.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  test("posterize lightness reduces tonal states while preserving alpha", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 8 }, (_, index) => {
        const value = index * 32;
        return [value, value, value, index === 0 ? 0 : 255];
      }).flat()
    );
    const result = posterizeLightnessRgba(pixels, 8, 1, { levels: 3 });
    const levels = new Set<number>();
    for (let offset = 4; offset < result.length; offset += 4) {
      levels.add(Math.round(rgbaToOklab([
        result[offset],
        result[offset + 1],
        result[offset + 2],
        result[offset + 3],
      ]).L * 100));
    }
    expect(levels.size).toBeLessThanOrEqual(3);
    expect(result[3]).toBe(0);
  });

  test("spatial gradients support deterministic pixel-art shapes and ordered ramps", () => {
    const ramp = ["#000000", "#808080", "#FFFFFF"];
    for (const type of ["linear", "reflected", "radial", "diamond", "conical"] as const) {
      const first = generateSpatialGradientRgba(8, 8, ramp, {
        type,
        start: { x: 1, y: 1 },
        end: { x: 7, y: 5 },
        mode: "ordered",
        matrix: "bayer4",
      });
      const second = generateSpatialGradientRgba(8, 8, ramp, {
        type,
        start: { x: 1, y: 1 },
        end: { x: 7, y: 5 },
        mode: "ordered",
        matrix: "bayer4",
      });
      expect(Array.from(second), type).toEqual(Array.from(first));
      for (let offset = 0; offset < first.length; offset += 4) {
        expect(ramp).toContain(
          rgbaToHex([
            first[offset],
            first[offset + 1],
            first[offset + 2],
            first[offset + 3],
          ])
        );
      }
    }
  });

  test("flat height field has zero Sobel slope", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 9 }, () => [128, 128, 128, 255]).flat()
    );
    const field = heightFieldFromRgba(pixels, 3, 3);
    const gradient = sobelHeightGradient(field, 3, 3);

    expect(Array.from(gradient.dx).every((value) => Math.abs(value) < 1e-8)).toBe(true);
    expect(Array.from(gradient.dy).every((value) => Math.abs(value) < 1e-8)).toBe(true);
  });

  test("directional shading creates highlight and shadow around a raised feature", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 25 }, (_, index) => {
        const x = index % 5;
        const y = Math.floor(index / 5);
        const value = x === 2 && y === 2 ? 230 : 100;
        return [value, value, value, 255];
      }).flat()
    );
    const shaded = directionalShadeRgba(pixels, 5, 5, {
      azimuthDegrees: 315,
      elevationDegrees: 35,
      depth: 4,
      ambient: 0.2,
      strength: 1,
    });

    const sourceL = rgbaToOklab([100, 100, 100, 255]).L;
    const visible = [];
    for (let offset = 0; offset < shaded.length; offset += 4) {
      visible.push(
        rgbaToOklab([
          shaded[offset],
          shaded[offset + 1],
          shaded[offset + 2],
          shaded[offset + 3],
        ]).L
      );
    }
    expect(Math.min(...visible)).toBeLessThan(sourceL);
    expect(Math.max(...visible)).toBeGreaterThan(sourceL);
  });

  test("Floyd-Steinberg palette diffusion is deterministic and palette-bound", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 64 }, (_, index) => {
        const value = Math.round((index / 63) * 255);
        return [value, value, value, 255];
      }).flat()
    );
    const palette = ["#000000", "#555555", "#AAAAAA", "#FFFFFF"];
    const first = palettizeErrorDiffusionRgba(pixels, 8, 8, palette, {
      strength: 1,
      serpentine: true,
    });
    const second = palettizeErrorDiffusionRgba(pixels, 8, 8, palette, {
      strength: 1,
      serpentine: true,
    });

    expect(Array.from(second)).toEqual(Array.from(first));
    for (let offset = 0; offset < first.length; offset += 4) {
      expect(palette).toContain(
        rgbaToHex([
          first[offset],
          first[offset + 1],
          first[offset + 2],
          first[offset + 3],
        ])
      );
    }
  });

  test("per-invocation color caches stay bounded on high-entropy input", () => {
    const width = 65;
    const height = 65;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      pixels[offset] = index & 0xff;
      pixels[offset + 1] = (index >>> 4) & 0xff;
      pixels[offset + 2] = (index >>> 8) & 0xff;
      pixels[offset + 3] = 255;
    }
    const context = createTextureColorComputeContext();
    palettizeRgba(
      pixels,
      width,
      height,
      ["#000000", "#555555", "#AAAAAA", "#FFFFFF"],
      { dither: "none" },
      context
    );

    expect(context.labs.size).toBeLessThanOrEqual(4096);
    expect(context.nearest.values().next().value?.size ?? 0).toBeLessThanOrEqual(4096);
    expect(context.metrics.cache_bypasses).toBeGreaterThan(0);
    expect(context.metrics.oklab_admission_disabled).toBe(true);
    expect(context.metrics.oklab_peak_entries).toBeLessThanOrEqual(512);
    expect(context.metrics.oklab_hit_ratio).toBeLessThan(0.05);
  });

  test("low-entropy color workloads keep Oklab admission enabled and reuse entries", () => {
    const width = 64;
    const height = 64;
    const colors = [
      [32, 48, 64, 255],
      [96, 112, 128, 255],
      [160, 176, 192, 255],
      [224, 232, 240, 255],
    ] as const;
    const pixels = new Uint8ClampedArray(
      Array.from({ length: width * height }, (_, index) =>
        colors[index % colors.length]
      ).flat()
    );
    const context = createTextureColorComputeContext();
    palettizeRgba(
      pixels,
      width,
      height,
      ["#000000", "#555555", "#AAAAAA", "#FFFFFF"],
      { dither: "none" },
      context
    );

    expect(context.metrics.oklab_admission_disabled).toBe(false);
    expect(context.metrics.nearest_cache_hits).toBeGreaterThan(
      context.metrics.nearest_cache_misses
    );
    expect(context.metrics.oklab_cache_misses).toBeLessThanOrEqual(8);
    expect(context.metrics.oklab_peak_entries).toBeLessThanOrEqual(8);
  });

  test("color engine rejects unbounded requests before pixel work", () => {
    expect(() => generateShadeRamp("#845442", { steps: 17 })).toThrow(
      "2 to 16"
    );
    expect(() =>
      palettizeRgba(
        new Uint8ClampedArray(4),
        1,
        1,
        [],
        {}
      )
    ).toThrow("1 to 64");
    expect(() =>
      extractPaletteMedianCut(
        new Uint8ClampedArray(4),
        1,
        1,
        33
      )
    ).toThrow("1 to 32");
  });
});

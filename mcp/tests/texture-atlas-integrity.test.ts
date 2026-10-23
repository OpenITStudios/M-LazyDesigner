import { describe, expect, test } from "bun:test";
import { textureOptimizationRuntime } from "@/server/tools/quality-intelligence";
import {
  buildUvAtlasAudit,
  classifyTextureProductionRole,
  collectUvAtlasUsages,
  isAiProductionColorCanvas,
  type UvAtlasUsage,
} from "@/server/tools/texture";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("texture atlas integrity", () => {
  test("shared pixel regions are read once per invocation while every face stays accounted", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = { Cube: globals.Cube, Texture: globals.Texture };
    let reads = 0, alpha = 255;
    const texture = { uuid: "atlas", name: "atlas", getUVWidth: () => 256, getUVHeight: () => 256,
      ctx: { canvas: { width: 256, height: 256 }, getImageData: (_x: number, _y: number, w: number, h: number) => {
        reads++; const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = alpha;
        return { data };
      } } };
    globals.Texture = {};
    globals.Cube = { all: [0, 1, 2].map(i => ({ uuid: `cube-${i}`, name: `cube-${i}`, faces: {
      north: { uv: i === 1 ? [16, 16, 0, 0] : [0, 0, 16, 16], getTexture: () => texture },
    } })) };
    try {
      const first = textureOptimizationRuntime();
      if (!("coverage" in first)) throw new Error("coverage unavailable");
      expect(reads).toBe(1);
      expect(first.pixel_budget_used).toBe(256);
      expect(first.pixel_budget_basis).toBe("unique_texture_regions");
      expect(first.coverage.scanned_faces).toBe(3);
      expect(first.coverage.review.solid_color_faces.examples.map(f => f.cube_uuid).sort()).toEqual(["cube-0", "cube-1", "cube-2"]);
      alpha = 0;
      const second = textureOptimizationRuntime();
      if (!("coverage" in second)) throw new Error("coverage unavailable");
      expect(reads).toBe(2);
      expect(second.coverage.states.transparent).toBe(3);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globals[key]; else globals[key] = value;
      }
    }
  });

  test("unique-region budget isolates atlases and rejects invalid mappings before cache lookup", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = { Cube: globals.Cube, Texture: globals.Texture };
    const reads: string[] = [];
    const textures = ["a", "b"].map(uuid => ({ uuid, name: uuid, getUVWidth: () => 128, getUVHeight: () => 128,
      ctx: { canvas: { width: 256, height: 256 }, getImageData: (_x: number, _y: number, w: number, h: number) => {
        reads.push(uuid); return { data: new Uint8ClampedArray(w * h * 4).fill(255) };
      } } }));
    const mappings = [
      [0, [0, 0, 64, 64]], [0, [0, 0, 64, 64]], [1, [0, 0, 64, 64]],
      [0, [64, 0, 64.5, 0.5]], [0, [0.25, 0, 1, 1]], [0, [127, 0, 129, 1]],
    ] as const;
    globals.Texture = {};
    globals.Cube = { all: mappings.map(([index, uv], i) => ({ uuid: `cube-${i}`, name: `cube-${i}`,
      faces: { north: { uv, getTexture: () => textures[index] } } })) };
    try {
      const result = textureOptimizationRuntime();
      if (!("coverage" in result)) throw new Error("coverage unavailable");
      expect(reads).toEqual(["a", "b"]);
      expect(result.pixel_budget_used).toBe(32768);
      expect(result.coverage.scanned_faces).toBe(3);
      expect(result.coverage.omissions.counts.budget).toBe(1);
      expect(result.coverage.omissions.counts.non_integral_pixel_mapping).toBe(2);
      expect(result.coverage.gate.state).toBe("incomplete");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globals[key]; else globals[key] = value;
      }
    }
  });
  test("coverage-first scheduling reads small underside before large face patches exhaust budget", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = { Cube: globals.Cube, Texture: globals.Texture };
    const reads: number[][] = [];
    const atlas = {
      uuid: "atlas", name: "atlas",
      getUVWidth: () => 256, getUVHeight: () => 256,
      ctx: { canvas: { width: 256, height: 256 },
        getImageData: (x: number, y: number, w: number, h: number) => {
          reads.push([x, y, w, h]);
          return { data: new Uint8ClampedArray(w * h * 4).fill(255) };
        },
      },
    };
    globals.Texture = {};
    globals.Cube = { all: [{
      uuid: "shoe", name: "shoe",
      faces: {
        north: { uv: [0, 0, 128, 128], getTexture: () => atlas },
        south: { uv: [128, 0, 256, 128], getTexture: () => atlas },
        down: { uv: [0, 128, 4, 132], getTexture: () => atlas },
      },
    }] };
    try {
      const result = textureOptimizationRuntime();
      if (!("coverage" in result)) throw new Error("coverage unavailable");
      expect(reads[0]).toEqual([0, 128, 4, 4]);
      expect(result.coverage.scanned_faces).toBe(2);
      expect(result.coverage.omissions.counts.budget).toBe(1);
      expect(result.coverage.face_review_ledger.examples).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ cube_uuid: "shoe", face: "down", scan_state: "scanned" }),
        ])
      );
      expect(result.coverage.gate.state).toBe("partial");
      expect(result.pixel_budget_used).toBe(16 + 128 * 128);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globals[key]; else globals[key] = value;
      }
    }
  });

  test("coverage scans fractional logical UV only when it maps to whole physical pixels", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = { Cube: globals.Cube, Texture: globals.Texture };
    const reads: number[][] = [];
    const texture = { uuid: "atlas", name: "atlas", getUVWidth: () => 128, getUVHeight: () => 128,
      ctx: { canvas: { width: 256, height: 256 }, getImageData: (...rect: number[]) => {
        reads.push(rect); return { data: new Uint8ClampedArray(rect[2] * rect[3] * 4).fill(255) };
      } } };
    globals.Texture = {};
    globals.Cube = { all: [{ uuid: "mixed", name: "mixed", faces: {
      north: { uv: [0.5, 0, 1, 2], getTexture: () => texture },
      south: { uv: [2.25, 0, 3, 2], getTexture: () => texture },
    } }] };
    try {
      const result = textureOptimizationRuntime();
      expect(reads).toEqual([[1, 0, 1, 4]]);
      if (!("coverage" in result)) throw new Error("coverage unavailable");
      expect(result.coverage.omissions.counts.non_integral_pixel_mapping).toBe(1);
      expect(result.coverage.omissions.counts.fractional_uv).toBe(0);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globals[key]; else globals[key] = value;
      }
    }
  });
  test("256px atlas / 128 UV accepts physical texels for mixed Box and per-face mappings", () => {
    const faces = [true, false].map((box_uv, index) => ({
      cube_uuid: String(index), cube_name: "density_fixture", face: "north",
      uv: [index * 4 + 0.5, 0, index * 4 + 1, 2], box_uv, autouv: 0,
      mirror_uv: false, face_rotation: 0, pixel_scale: [2, 2] as [number, number],
    }));
    const audit = buildUvAtlasAudit(faces, 128, 128);
    if (audit.state !== "available") throw new Error("audit unavailable");
    expect(audit.fractional_uv.count).toBe(2);
    expect(audit.production_gate.state).toBe("ready");
    for (const uv of [[0.25, 0, 1, 2], [0, 0, 129, 2], [1, 0, 1, 2], [NaN, 0, 1, 2]]) {
      const invalid = buildUvAtlasAudit([{ ...faces[0], uv }], 128, 128);
      if (invalid.state !== "available") throw new Error("audit unavailable");
      expect(invalid.production_gate.state).toBe("review_required");
    }
  });

  test("overlap and exact texel reuse are scoped to the same texture UUID", () => {
    const usage = (
      cube_uuid: string,
      texture_uuid: string,
      uv: readonly number[]
    ): UvAtlasUsage => ({
      cube_uuid,
      cube_name: cube_uuid,
      texture_uuid,
      face: "north",
      uv,
      box_uv: false,
      autouv: 0,
      mirror_uv: false,
      face_rotation: 0,
      pixel_scale: [1, 1],
    });

    const left = usage("left", "atlas-a", [0, 0, 8, 8]);
    const right = usage("right", "atlas-b", [4, 4, 12, 12]);
    const separate = buildUvAtlasAudit([left, right], 128, 128);
    if (separate.state !== "available") throw new Error("audit unavailable");
    expect(separate.partial_overlap.pair_count).toBe(0);
    expect(separate.production_gate.state).toBe("ready");

    const sameAtlas = buildUvAtlasAudit([
      left, { ...right, texture_uuid: "atlas-a" },
    ], 128, 128);
    if (sameAtlas.state !== "available") throw new Error("audit unavailable");
    expect(sameAtlas.partial_overlap.pair_count).toBe(1);
    expect(sameAtlas.production_gate.reasons).toContain("PARTIAL_OVERLAP");

    const independentReuse = buildUvAtlasAudit([
      left, { ...right, uv: left.uv },
    ], 128, 128);
    if (independentReuse.state !== "available") throw new Error("audit unavailable");
    expect(independentReuse.exact_reuse.region_count).toBe(0);

    const sameBitmapReuse = buildUvAtlasAudit([
      left, { ...right, texture_uuid: "atlas-a", uv: left.uv },
    ], 128, 128);
    if (sameBitmapReuse.state !== "available") throw new Error("audit unavailable");
    expect(sameBitmapReuse.exact_reuse.region_count).toBe(1);
    expect(sameBitmapReuse.partial_overlap.pair_count).toBe(0);

    // Missing source bitmap identity must never conceal a possible collision.
    const unknown = buildUvAtlasAudit([
      left, { ...right, texture_uuid: null },
    ], 128, 128);
    if (unknown.state !== "available") throw new Error("audit unavailable");
    expect(unknown.partial_overlap.pair_count).toBe(1);
  });

  test("animated UV audit computes V scale from one frame, not the stacked bitmap", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const previous = { Project: g.Project, Cube: g.Cube };
    const texture = {
      uuid: "animated-atlas",
      width: 256,
      height: 512,
      display_height: 256,
      getUVWidth: () => 128,
      getUVHeight: () => 128,
    };
    const face = {
      texture: "animated-atlas",
      enabled: true,
      uv: [0, 0.25, 2, 2.25],
      rotation: 0,
      getTexture: () => texture,
    };
    g.Project = { texture_width: 128, texture_height: 128 };
    g.Cube = { all: [{
      uuid: "animated-cube", name: "animated-cube",
      box_uv: false, autouv: 0, mirror_uv: false,
      size: () => [2, 2, 2],
      faces: { north: face },
    }] };

    try {
      const usages = collectUvAtlasUsages();
      expect(usages).toHaveLength(1);
      expect(usages[0]).toMatchObject({
        cube_uuid: "animated-cube",
        texture_uuid: "animated-atlas",
        pixel_scale: [2, 2],
      });
      // 0.25 logical V is half a physical pixel in a displayed frame.
      // The old 512/128 scale incorrectly accepted it as one full pixel.
      const invalid = buildUvAtlasAudit(usages, 128, 128);
      if (invalid.state !== "available") throw new Error("audit unavailable");
      expect(invalid.non_integral_pixel_mapping.count).toBe(1);
      expect(invalid.production_gate.reasons).toContain(
        "NON_INTEGRAL_PIXEL_MAPPING"
      );

      face.uv = [0, 0.5, 2, 2.5];
      const corrected = buildUvAtlasAudit(collectUvAtlasUsages(), 128, 128);
      if (corrected.state !== "available") throw new Error("audit unavailable");
      expect(corrected.non_integral_pixel_mapping.count).toBe(0);
      expect(corrected.production_gate.state).toBe("ready");
    } finally {
      for (const key of ["Project", "Cube"]) {
        if (previous[key as keyof typeof previous] === undefined) delete g[key];
        else g[key] = previous[key as keyof typeof previous];
      }
    }
  });

  test("AI color canvas standard is square and 128-based", () => {
    for (const size of [128, 256, 384, 512, 1024]) {
      expect(isAiProductionColorCanvas(size, size)).toBe(true);
    }

    for (const [width, height] of [
      [16, 16],
      [64, 64],
      [128, 256],
      [192, 192],
      [256, 128],
    ]) {
      expect(isAiProductionColorCanvas(width, height)).toBe(false);
    }
  });

  test("texture roles distinguish base color, explicit variants, and PBR support", () => {
    expect(
      classifyTextureProductionRole({
        pbr_channel: "color",
        has_group: false,
      })
    ).toBe("base_color_candidate");

    expect(
      classifyTextureProductionRole({
        pbr_channel: "color",
        has_group: true,
        group_is_material: true,
      })
    ).toBe("base_color_candidate");

    expect(
      classifyTextureProductionRole({
        pbr_channel: "color",
        has_group: true,
        group_is_material: false,
      })
    ).toBe("explicit_variant");

    for (const pbr_channel of ["normal", "height", "mer"]) {
      expect(
        classifyTextureProductionRole({
          pbr_channel,
          has_group: true,
          group_is_material: true,
        })
      ).toBe("pbr_support");
    }
  });

  test("global UV audit allows exact reuse but reports partial overlap and unstable UV", () => {
    const exactReuse = buildUvAtlasAudit(
      [
        {
          cube_uuid: "left",
          cube_name: "left_arm",
          face: "north",
          uv: [0, 0, 8, 8],
          box_uv: true,
          autouv: 0,
          mirror_uv: false,
          face_rotation: 0,
        },
        {
          cube_uuid: "right",
          cube_name: "right_arm",
          face: "north",
          uv: [0, 0, 8, 8],
          box_uv: true,
          autouv: 0,
          mirror_uv: true,
          face_rotation: 0,
        },
      ],
      128,
      128
    );

    expect(exactReuse.state).toBe("available");
    if (exactReuse.state !== "available") throw new Error("expected available audit");
    expect(exactReuse.exact_reuse.region_count).toBe(1);
    expect(exactReuse.partial_overlap.pair_count).toBe(0);
    expect(exactReuse.production_gate.state).toBe("ready");

    const review = buildUvAtlasAudit(
      [
        {
          cube_uuid: "a",
          cube_name: "a",
          face: "north",
          uv: [0, 0, 8, 8],
          box_uv: true,
          autouv: 1,
          mirror_uv: false,
          face_rotation: 0,
        },
        {
          cube_uuid: "b",
          cube_name: "b",
          face: "north",
          uv: [4, 4, 12, 12],
          box_uv: true,
          autouv: 0,
          mirror_uv: false,
          face_rotation: 0,
        },
        {
          cube_uuid: "c",
          cube_name: "c",
          face: "north",
          uv: [120, 120, 132, 132],
          box_uv: true,
          autouv: 0,
          mirror_uv: false,
          face_rotation: 0,
        },
        {
          cube_uuid: "d",
          cube_name: "d",
          face: "north",
          uv: [20.5, 20, 28.5, 28],
          box_uv: true,
          autouv: 0,
          mirror_uv: false,
          face_rotation: 0,
        },
      ],
      128,
      128
    );

    expect(review.state).toBe("available");
    if (review.state !== "available") throw new Error("expected available audit");
    expect(review.unlocked_box_uv_cubes.count).toBe(1);
    expect(review.out_of_bounds.count).toBe(1);
    expect(review.fractional_uv.count).toBe(1);
    expect(review.partial_overlap.pair_count).toBeGreaterThan(0);
    expect(review.production_gate.state).toBe("review_required");
    for (const reason of [
      "OUT_OF_BOUNDS",
      "NON_INTEGRAL_PIXEL_MAPPING",
      "BOX_UV_AUTOUV_UNLOCKED",
      "PARTIAL_OVERLAP",
    ]) {
      expect(review.production_gate.reasons).toContain(reason);
    }
  });

  test("native template Box UV readiness is checked before generator and Undo", async () => {
    const code = await source("server/tools/texture/create.ts");
    const begin = code.indexOf('if (type === "template") {');
    const native = code.slice(begin, code.indexOf("Undo.initEdit({\n          textures:", begin));
    const preflight = native.indexOf("requireBoxUvTemplateReadiness(");
    const transaction = native.indexOf("return await runNativeTemplateEdit(");
    const generator = native.indexOf("await generator.generateTemplate(");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(transaction).toBeGreaterThan(preflight);
    expect(generator).toBeGreaterThan(transaction);
    expect(native).toContain("Format.single_texture ? Outliner.elements : Outliner.selected");
    expect(native).toContain("cube.box_uv === true");
    expect(native).toContain("visible: cube.visibility === true");
    expect(native).not.toContain("cube.box_uv = false");
    expect(code.indexOf("return resizeMappedAtlas(")).toBeLessThan(begin);
  });

  test("texture creation preflight runs before Undo and prevents atlas fragmentation", async () => {
    const [texture, atlas] = await Promise.all([
      source("server/tools/texture/create.ts"),
      source("server/tools/texture/atlas.ts"),
    ]);
    const createBlock = texture;

    expect(createBlock.indexOf("requireTextureCreationPreflight")).toBeGreaterThanOrEqual(0);
    expect(createBlock.indexOf("Undo.initEdit")).toBeGreaterThan(
      createBlock.indexOf("requireTextureCreationPreflight")
    );

    for (const invariant of [
      "base-color atlas already exists",
      "square 128-based canvas",
      "explicit non-material TextureGroup",
      "PBR support textures require an explicit material TextureGroup",
      "match the base atlas bitmap size",
    ]) {
      expect(atlas).toContain(invariant);
    }
  });

  test("list_textures exposes atlas inventory and global UV gate without a new tool", async () => {
    const [texture, atlas] = await Promise.all([
      source("server/tools/texture/read.ts"),
      source("server/tools/texture/atlas.ts"),
    ]);
    const listBlock = texture.slice(
      texture.indexOf("createTool(listTexturesToolDoc.name"),
      texture.indexOf("createTool(getTextureToolDoc.name")
    );

    for (const marker of [
      "currentTextureInventory()",
      "buildUvAtlasAudit(",
      "atlas_state:",
      "uv_audit:",
      "structuredContent: result",
      "base-color atlas state",
      "UV atlas gate",
    ]) {
      expect(listBlock).toContain(marker);
    }

    for (const auditMarker of [
      "invalid_uv",
      "out_of_bounds",
      "fractional_uv",
      "unlocked_box_uv_cubes",
      "exact_reuse",
      "partial_overlap",
      "production_gate",
    ]) {
      expect(atlas).toContain(auditMarker);
    }
  });

  test("painting requires explicit texture identity when multiple textures are loaded", async () => {
    const util = await source("lib/texture/selection.ts");
    expect(util).toContain("available.length > 1");
    expect(util).toContain("Pass texture_id explicitly");
    expect(util).toContain("implicit selected/default state");
    expect(util).toContain("resolveCoreTexture(");
  });

  test("full-atlas image evidence is explicit in multi-texture state and returns density metadata", async () => {
    const [texture, atlas] = await Promise.all([
      source("server/tools/texture/read.ts"),
      source("server/tools/texture/atlas.ts"),
    ]);
    const block = texture.slice(texture.indexOf("createTool(getTextureToolDoc.name"));

    expect(block).toContain("available.length > 1");
    expect(block).toContain("Pass texture explicitly");
    expect(block).toContain("implicit default state");
    expect(block).toContain('inspection: "full_atlas"');
    expect(block).toContain("textureInventoryEntry(image)");
    expect(block).toContain("imageContent({ url: image.getDataURL() })");
    expect(atlas).toContain("physical_pixels_per_uv_unit");
  });
});

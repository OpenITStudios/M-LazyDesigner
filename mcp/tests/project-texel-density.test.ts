import { describe, expect, test } from "bun:test";
import {
  summarizeProjectTexelDensity,
  UV_MODEL_TEXEL_DENSITY_MATERIAL_AREA_FRACTION,
  UV_MODEL_TEXEL_DENSITY_REVIEW_FACTOR,
  type ProjectTexelDensitySample,
} from "@/server/tools/element-inspection";

function sample(
  cube: string,
  face: string,
  modelArea: number,
  logicalDensity: number,
  physicalDensity: number | null = null
): ProjectTexelDensitySample {
  return {
    cube_uuid: `${cube}-uuid`,
    cube_name: cube,
    face,
    model_area: modelArea,
    logical_uv_units_per_model_unit: logicalDensity,
    physical_pixels_per_model_unit: physicalDensity,
  };
}

describe("model-wide texel density diagnostics", () => {
  test("major surfaces with different one-pixel model scale require UV review", () => {
    const audit = summarizeProjectTexelDensity([
      sample("door_left", "north", 100, 1, 2),
      sample("door_right", "north", 100, 1, 2),
      sample("door_header", "north", 100, 1, 2),
      sample("roof", "up", 100, 0.25, 0.5),
    ]);

    expect(UV_MODEL_TEXEL_DENSITY_REVIEW_FACTOR).toBe(2);
    expect(audit.state).toBe("review_required");
    expect(audit.reference_logical_uv_units_per_model_unit).toBe(1);
    expect(audit.spread_factor).toBe(4);
    expect(audit.outlier_faces).toBe(1);
    expect(audit.outlier_model_area_fraction).toBe(0.25);
    expect(audit.examples[0]).toMatchObject({
      cube_name: "roof",
      face: "up",
      relative_to_reference: "lower_density",
      ratio_to_reference: 4,
      physical_pixels_per_model_unit: 0.5,
      model_units_per_physical_pixel: 2,
    });
  });

  test("tiny deliberate high-detail allocation is reported without blocking major surfaces", () => {
    const audit = summarizeProjectTexelDensity([
      sample("body_a", "north", 100, 1, 2),
      sample("body_b", "north", 100, 1, 2),
      sample("button", "north", 1, 4, 8),
    ]);

    expect(audit.outlier_model_area_fraction).toBeLessThan(
      UV_MODEL_TEXEL_DENSITY_MATERIAL_AREA_FRACTION
    );
    expect(audit.state).toBe("localized_variance");
    expect(audit.examples[0]).toMatchObject({
      cube_name: "button",
      relative_to_reference: "higher_density",
      ratio_to_reference: 4,
    });
  });

  test("coherent major surfaces remain consistent and preserve physical one-pixel scale", () => {
    const audit = summarizeProjectTexelDensity([
      sample("panel_a", "north", 80, 1, 2),
      sample("panel_b", "north", 80, 1.1, 2.2),
      sample("panel_c", "north", 80, 0.9, 1.8),
    ]);

    expect(audit.state).toBe("consistent");
    expect(audit.outlier_faces).toBe(0);
    expect(audit.reference_physical_pixels_per_model_unit).toBe(2);
    expect(audit.reference_model_units_per_physical_pixel).toBe(0.5);
  });


  test("equal logical UV density still requires review when physical bitmap density differs", () => {
    const inputs = [
      sample("body", "north", 100, 1, 1),
      sample("wing", "north", 100, 1, 2),
    ];
    const report = summarizeProjectTexelDensity(inputs);
    expect(report.state).toBe("review_required");
    expect(report.comparison_basis).toBe("physical_pixels");
    expect(report.physical_density_complete).toBe(true);
    expect(report.spread_factor).toBe(1);
    expect(report.comparison_spread_factor).toBe(2);
    expect(report.outlier_faces).toBe(1);
    expect(report.examples[0]).toMatchObject({
      cube_name: "wing", comparison_basis: "physical_pixels",
      relative_to_reference: "higher_density", ratio_to_reference: 2,
    });
    const partial = summarizeProjectTexelDensity([
      inputs[0], sample("unmapped", "north", 100, 1, null),
    ]);
    expect(partial.comparison_basis).toBe("logical_uv");
    expect(partial.physical_density_complete).toBe(false);
    expect(partial.state).toBe("consistent");
  });

  test("UV inspection uses per-face bitmap scales and excludes untextured faces", async () => {
    const globals = globalThis as Record<string, any>;
    const keys = ["Project", "Texture", "Cube", "Group", "Locator", "NullObject"];
    const previous = Object.fromEntries(keys.map(key => [key, globals[key]]));
    const base = {
      uuid: "base", name: "base", id: "base",
      width: 128, height: 128, display_height: 128,
      getUVWidth: () => 128, getUVHeight: () => 128, error: false,
    };
    const detail = {
      uuid: "detail", name: "detail", id: "detail",
      width: 256, height: 256, display_height: 256,
      getUVWidth: () => 128, getUVHeight: () => 128, error: false,
    };
    class NativeCube {
      static all: NativeCube[] = [];
      uuid = "cube-1";
      name = "cube";
      from: [number, number, number] = [0, 0, 0];
      to: [number, number, number] = [4, 4, 4];
      origin: [number, number, number] = [0, 0, 0];
      rotation: [number, number, number] = [0, 0, 0];
      uv_offset: [number, number] = [0, 0];
      box_uv = false;
      autouv = 0;
      mirror_uv = false;
      faces: Record<string, any> = {};
      constructor() { NativeCube.all.push(this); }
    }
    class Empty { static all: Empty[] = []; }
    const cube = new NativeCube();
    for (const key of ["north", "south", "east", "west", "up", "down"]) {
      cube.faces[key] = {
        texture: "base", enabled: false, rotation: 0, uv: [0, 0, 4, 4],
        getTexture: () => base,
      };
    }
    cube.faces.north.enabled = true;
    cube.faces.east = {
      texture: "detail", enabled: true, rotation: 0,
      uv: [0, 0, 4, 4], getTexture: () => detail,
    };
    cube.faces.south = {
      texture: null, enabled: true, rotation: 0,
      uv: [0, 0, 0.1, 0.1], getTexture: () => base,
    };
    cube.faces.west = {
      texture: "base", enabled: true, rotation: 0,
      uv: [127, 0, 129, 2], getTexture: () => base,
    };

    globals.Project = {};
    globals.Texture = { getDefault: () => base };
    globals.Cube = NativeCube;
    globals.Group = Empty;
    globals.Locator = Empty;
    globals.NullObject = Empty;
    try {
      const { registerElementInspectionTools } =
        await import("@/server/tools/element-inspection");
      const { getAllToolDefinitions } = await import("@/lib/factories");
      if (!getAllToolDefinitions().inspect_element) registerElementInspectionTools();
      const tool = getAllToolDefinitions().inspect_element;
      const output = await tool.execute(
        await tool.parameterSchema.parseAsync({ id: "cube-1", detail: "uv" })
      );
      const uv = (output.structuredContent as any).uv;
      expect(uv.texture_space).toMatchObject({
        scope: "default_texture", effective_texture: { uuid: "base" },
      });
      expect(uv.faces.north).toMatchObject({
        paintable: true,
        texture_space: { state: "mapped", effective_texture: { uuid: "base" } },
        quality: { physical_pixels_per_model_unit: 1 },
      });
      expect(uv.faces.east).toMatchObject({
        paintable: true,
        texture_space: { state: "mapped", effective_texture: { uuid: "detail" } },
        quality: { physical_pixels_per_model_unit: 2 },
      });
      expect(uv.faces.east.texture_pixels.size).toEqual([8, 8]);
      expect(uv.faces.west).toMatchObject({
        enabled: true, paintable: false, mapping_state: "mapped",
        texture_pixels: { in_bounds: false, rect: [127, 0, 129, 2] },
      });
      expect(uv.faces.south).toMatchObject({
        enabled: true, paintable: false, mapping_state: "no_texture",
        texture_space: { state: "no_texture", effective_texture: null },
        quality: null,
      });
      expect(uv.quality_summary.project_texel_density).toMatchObject({
        measured_faces: 2, comparison_basis: "physical_pixels",
        physical_density_complete: true, state: "review_required",
        outlier_faces: 1, excluded_invalid_faces: 1,
      });
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete globals[key];
        else globals[key] = previous[key];
      }
    }
  });

  test("Texturing routes undersized UV islands upstream instead of painting around them", async () => {
    const skill = await Promise.all([Bun.file("../.agents/skills/lazydesigner-texturing/SKILL.md").text(), Bun.file("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md").text()]).then((parts) => parts.join("\n"));
    const inspection = await Bun.file(
      "server/tools/element/inspection.ts"
    ).text();

    expect(skill).toMatch(/^## UV(?: Layout Quality)? Gate$/m);
    expect(skill).toContain("texel density");
    expect(skill).toContain("pixels per UV unit");
    expect(skill).toMatch(/return to Geometry\/UV (?:if|when) (?:detail|it) cannot fit/i);
    expect(skill).toContain(
      "Pin atlas UUID and pass `texture_id` when multiple textures are loaded"
    );
    // Palette/identity wording belongs to texture-design reasoning tests;
    // this regression owns upstream routing when physical texels cannot fit.
    expect(inspection).toContain("model_units_per_physical_pixel");
    expect(inspection).toContain("outlier_model_area_fraction");
  });
});

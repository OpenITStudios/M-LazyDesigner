import {describe,expect,test} from "bun:test";
import tinycolor from "tinycolor2";
import {
  texturePaletteParameters,
  generateTexturePalette,
  reviewReferencePaletteRoles,
  type ReferencePaletteSwatch,
} from "@/lib/texturePalette";
import {registerPaintTools} from "@/server/tools/paint";
import {getAllToolDefinitions} from "@/lib/factories";
describe("hue shifted palette",()=>{
  test("retains exact base and orders shadows through highlights",()=>{
    const input=texturePaletteParameters.parse({base:"#806040"});
    const result=generateTexturePalette(input);
    expect(result.colors).toHaveLength(7);expect(result.colors[result.base_index]).toBe(input.base);
    const light=result.colors.map(color=>tinycolor(color).toHsl().l);
    expect(light).toEqual([...light].sort((a,b)=>a-b));
    expect(result.unique_colors).toBe(7);
  });
  test("validates opaque base and odd count",()=>{
    for(const args of [{base:"#ffffffff"},{base:"red"},{base:"#123456",count:4}])expect(texturePaletteParameters.safeParse(args).success).toBe(false);
  });
  test("executor previews without ColorPanel and applies explicit append/replace",async()=>{
    const g=globalThis as any, previous=g.ColorPanel;
    try{
      delete g.ColorPanel;
      if(!getAllToolDefinitions().paint_settings)registerPaintTools();
      const tool=getAllToolDefinitions().paint_settings;
      const run=async(mode:string)=>tool.execute(await tool.parameterSchema.parseAsync({palette:{base:"#806040",mode}}));
      const preview:any=await run("preview");expect(preview.structuredContent.palette.colors).toHaveLength(7);
      await expect(run("replace")).rejects.toThrow("unavailable");
      g.ColorPanel={palette:["#010101"]};const original=g.ColorPanel.palette;
      await run("append");expect(original).toHaveLength(8);expect(original[0]).toBe("#010101");
      await run("replace");expect(original).toHaveLength(7);expect(original).not.toContain("#010101");
      expect(g.ColorPanel.palette).toBe(original);
    }finally{g.ColorPanel=previous;}
  });
});


describe("reference-pinned palette role review (no automatic painting)", () => {
  const sha = "a".repeat(64);
  const face = { cube_uuid: "panel", face: "north" as const };
  const make = (
    role: ReferencePaletteSwatch["palette_role"],
    hex: string,
    alpha = 255
  ): ReferencePaletteSwatch => ({
    treatment_region: "body",
    image_id: "front",
    image_sha256: sha,
    image_region_id: "paint",
    part_id: "body",
    face,
    palette_role: role,
    observed_hex: hex,
    observed_rgba: [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      alpha,
    ],
  });
  const regions = [{
    region: "body",
    identity_colors: ["#e0231a"],
    surface_pattern: {
      pattern: "painted_metal" as const,
      directionality: "form_driven" as const,
    },
  }];

  test("retains only exact observed shadow/base/highlight and separate identity color", () => {
    const observed = [
      make("base", "#825040"),
      make("shadow", "#392219"),
      make("highlight", "#c6a082"),
      make("identity", "#e0231a"),
    ];
    const result = reviewReferencePaletteRoles(observed, regions);
    expect(result.state).toBe("source_anchors_for_review");
    expect(result.scope_count).toBe(1);
    expect(result.scopes[0]).toMatchObject({
      scope: { image_sha256: sha, face },
      ramp: {
        state: "source_anchor_candidate",
        exact_observed_colors: ["#392219", "#825040", "#c6a082"],
        reasons: [],
      },
      identity: { state: "declared_colors_consistent", source_colors: ["#e0231a"] },
      surface_pattern: {
        declared: "painted_metal",
        directionality: "form_driven",
        source_material_verified: false,
        physical_texel_density_verified: false,
      },
      source_role_labels: "CALLER_SELECTED",
      painting_authorized: false, visual_verdict: "not_evaluated",
    });
    expect(result.palette_selected).toBe(false);
    expect(result.material_inferred).toBe(false);
    expect(result.scopes[0].ramp.relative_luminance?.shadow)
      .toBeLessThan(result.scopes[0].ramp.relative_luminance!.base);
    expect(result.scopes[0].ramp.relative_luminance?.base)
      .toBeLessThan(result.scopes[0].ramp.relative_luminance!.highlight);
  });

  test("missing roles, ambiguous sources, wrong value order and alpha always require review", () => {
    const base = make("base", "#825040");
    const missing = reviewReferencePaletteRoles([base], regions);
    expect(missing.state).toBe("review_required");
    expect(missing.scopes[0].ramp.reasons)
      .toContain("REFERENCE_RAMP_ANCHORS_INCOMPLETE_OR_AMBIGUOUS");

    const wrongOrder = reviewReferencePaletteRoles([
      make("shadow", "#eeeeee"), base, make("highlight", "#111111"),
      make("identity", "#e0231a"),
    ], regions);
    expect(wrongOrder.scopes[0].ramp.reasons)
      .toContain("REFERENCE_RAMP_VALUE_ORDER_UNVERIFIED");
    expect(wrongOrder.scopes[0].ramp.exact_observed_colors).toBeNull();

    const nonOpaque = reviewReferencePaletteRoles([
      make("shadow", "#392219"), base, make("highlight", "#c6a082", 120),
      make("identity", "#e0231a"),
    ], regions);
    expect(nonOpaque.scopes[0].ramp.reasons)
      .toContain("REFERENCE_RAMP_ALPHA_UNVERIFIED");
    const different = reviewReferencePaletteRoles([
      make("shadow", "#392219"), base, make("highlight", "#c6a082"),
      make("identity", "#ffffff"),
    ], regions);
    expect(different.scopes[0].identity.reasons)
      .toContain("REFERENCE_IDENTITY_COLOR_CONFLICT");
    expect(different.state).toBe("review_required");

    const ambiguousBase = reviewReferencePaletteRoles([
      make("base", "#825040"), make("base", "#665544"),
      make("shadow", "#392219"), make("highlight", "#c6a082"),
    ], [{ ...regions[0], identity_colors: [] }]);
    expect(ambiguousBase.scopes[0].ramp.reasons)
      .toContain("REFERENCE_RAMP_ANCHORS_INCOMPLETE_OR_AMBIGUOUS");
  });

  test("cannot combine different images/revisions/faces or accept forged RGBA", () => {
    const a = make("shadow", "#392219");
    const b = { ...make("base", "#825040"), image_sha256: "b".repeat(64) };
    const c = { ...make("highlight", "#c6a082"),
      face: { cube_uuid: "other", face: "north" as const } };
    const separated = reviewReferencePaletteRoles(
      [a, b, c], [{ ...regions[0], identity_colors: [] }]
    );
    expect(separated.scope_count).toBe(3);
    expect(separated.state).toBe("review_required");
    expect(separated.scopes.every(s => s.ramp.state === "review_required")).toBe(true);
    expect(() => reviewReferencePaletteRoles(
      [{ ...a, observed_hex: "#ffffff" }], regions
    )).toThrow("REFERENCE_PALETTE_COLOR_MISMATCH");
    expect(() => reviewReferencePaletteRoles(
      [{ ...a, observed_rgba: [1, 2, 300, 255] }], regions
    )).toThrow("REFERENCE_PALETTE_SAMPLE_INVALID");
    expect(() => reviewReferencePaletteRoles(Array(17).fill(a), regions))
      .toThrow("REFERENCE_PALETTE_SAMPLE_BUDGET");
    expect(reviewReferencePaletteRoles([], regions).state).toBe("not_requested");
  });
});

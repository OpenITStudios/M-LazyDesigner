import { describe, expect, test } from "bun:test";
import { applyTextureComputePipeline } from "@/lib/textureComputePipeline";
import {
  generateShadeRamp,
  gradientMapRgba,
  palettizeRgba,
  posterizeLightnessRgba,
} from "@/lib/textureColorEngine";
import {
  parseTextureComputeRequest,
  parseTextureComputeSteps,
} from "@/lib/textureComputeRequest";
import {
  planFaceScopedTextureSelection,
  planProtectedFaceLocalRegions,
  type NativeFaceFootprint,
} from "@/lib/texture/selectionPlanning";

describe("texture compute request and pipeline", () => {
  test("parses compact compute steps into strict internal operations", () => {
    const steps = parseTextureComputeSteps([
      { operation: "auto_levels", args: { strength: 0.8 } },
      {
        operation: "generated_gradient_map",
        args: {
          base_color: "#845442",
          steps: 5,
          mode: "nearest",
        },
      },
      {
        operation: "palette_diffusion",
        args: {
          palette: ["#201510", "#845442", "#D8A070"],
          strength: 0.7,
        },
      },
    ]);

    expect(steps.map((step) => step.operation)).toEqual([
      "auto_levels",
      "generated_gradient_map",
      "palette_diffusion",
    ]);
  });


  test("opt-in source material anchors preserve shadow/base/highlight and exact identity pixels", () => {
    const material = ["#500000", "#a00000", "#f00000"] as const;
    const ramp = ["#103020", "#34834d", "#b7f6c4"] as const;
    const input = new Uint8ClampedArray([
      0x50, 0, 0, 255,  0xa0, 0, 0, 255,  0xf0, 0, 0, 255,
      0xb0, 0, 0, 255,  0, 0, 255, 255,
      0xa0, 0, 0, 255,  0x50, 0, 0, 0,
    ]);
    const faces = [
      {cube_uuid:"armor",face:"north" as const,enabled:true,texture_uuid:"atlas",
        native_material_name:"armor",rect:[0,0,5,1] as const},
      {cube_uuid:"eye",face:"north" as const,enabled:true,texture_uuid:"atlas",
        native_material_name:"eye",rect:[5,0,7,1] as const},
    ];
    const request = parseTextureComputeRequest([{
      operation:"gradient_map",
      args:{
        ramp:[...ramp], mode:"nearest",
        source_hue_color:"#a00000",
        source_ramp:[...material],
        protected_colors:["#b00000"],
        face_targets:[{cube_uuid:"armor",face:"north"}],
      },
    }]);
    const scope = planFaceScopedTextureSelection({
      texture_uuid:"atlas",bitmap_width:7,bitmap_height:1,
      faces,face_targets:request.face_targets!,
    });
    const result = applyTextureComputePipeline(input,7,1,request.steps,
      scope.target_rect,scope.target_mask);
    const rgba = (i:number) => Array.from(result.pixels.slice(i*4,i*4+4));
    const rgb = (hex:string) => [
      parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),
      parseInt(hex.slice(5,7),16),255,
    ];
    expect(rgba(0)).toEqual(rgb(ramp[0]));
    expect(rgba(1)).toEqual(rgb(ramp[1]));
    expect(rgba(2)).toEqual(rgb(ramp[2]));
    expect(rgba(3)).toEqual([0xb0,0,0,255]); // same-hue identity mark
    expect(rgba(4)).toEqual([0,0,255,255]); // unrelated material
    expect(rgba(5)).toEqual([0xa0,0,0,255]); // different face
    expect(rgba(6)).toEqual([0x50,0,0,0]); // hidden RGB and alpha
    expect(result.receipt.changed_pixels).toBe(3);
    expect(result.receipt.execution.region.mask_scope).toBe("exact_cube_faces");
  });


  test("face-local identity mask protects a logo sharing the material RGB", () => {
    const faces = [
      { cube_uuid: "body", face: "north" as const, enabled: true,
        texture_uuid: "atlas", native_material_name: "metal",
        rect: [0, 0, 3, 2] as const, uv: [0, 0, 3, 2], rotation: 0 },
      { cube_uuid: "other", face: "north" as const, enabled: true,
        texture_uuid: "atlas", native_material_name: "metal",
        rect: [3, 0, 5, 2] as const, uv: [3, 0, 5, 2], rotation: 0 },
    ];
    const request = parseTextureComputeRequest([{
      operation: "gradient_map",
      args: { ramp: ["#16441e", "#c1f4c4"], mode: "nearest",
        source_hue_color: "#a00000",
        face_targets: [{ cube_uuid: "body", face: "north" }],
        protected_face_regions: [{ cube_uuid: "body", face: "north",
          rect: { x: 1, y: 0, width: 1, height: 2 } }] },
    }]);
    const scope = planFaceScopedTextureSelection({
      texture_uuid: "atlas", bitmap_width: 5, bitmap_height: 2,
      faces, face_targets: request.face_targets!,
    });
    const protection = planProtectedFaceLocalRegions({
      texture_uuid: "atlas", bitmap_width: 5, bitmap_height: 2,
      logical_uv_width: 5, logical_uv_height: 2,
      native_faces: faces, face_targets: request.face_targets!,
      selection: scope, protected_regions: request.protected_face_regions!,
    });
    expect([...scope.target_mask]).toEqual([1, 1, 1, 1, 1, 1]);
    expect([...protection.target_mask]).toEqual([1, 0, 1, 1, 0, 1]);
    expect(protection).toMatchObject({ protected_pixels: 2, editable_pixels: 4 });
    const source = new Uint8ClampedArray(
      Array.from({ length: 10 }, () => [160, 0, 0, 255]).flat()
    );
    const result = applyTextureComputePipeline(source, 5, 2, request.steps,
      scope.target_rect, protection.target_mask);
    expect(result.receipt.changed_pixels).toBe(4);
    for (const offset of [1, 6, 3, 4, 8, 9]) {
      expect([...result.pixels.slice(offset * 4, offset * 4 + 4)])
        .toEqual([...source.slice(offset * 4, offset * 4 + 4)]);
    }
    expect([...result.pixels.slice(0, 4)]).not.toEqual([...source.slice(0, 4)]);
  });

  test("protected face-local pixels follow signed and quarter-turned native UV", () => {
    const face = {
      cube_uuid: "plate", face: "north" as const, enabled: true,
      texture_uuid: "atlas", native_material_name: "painted",
      rect: [2, 1, 6, 3] as const, uv: [6, 1, 2, 3], rotation: 90,
    };
    const scope = planFaceScopedTextureSelection({
      texture_uuid: "atlas", bitmap_width: 8, bitmap_height: 4,
      faces: [face], face_targets: [{ cube_uuid: "plate", face: "north" }],
    });
    const protection = planProtectedFaceLocalRegions({
      texture_uuid: "atlas", bitmap_width: 8, bitmap_height: 4,
      logical_uv_width: 8, logical_uv_height: 4,
      native_faces: [face],
      face_targets: [{ cube_uuid: "plate", face: "north" }],
      selection: scope,
      protected_regions: [{ cube_uuid: "plate", face: "north",
        rect: { x: 0, y: 0, width: 1, height: 2 } }],
    });
    // rotation 90 + flipped U maps face-local (0,0),(0,1) to (5,2),(4,2).
    expect([...protection.target_mask]).toEqual([1,1,1,1, 1,1,0,0]);
    expect(protection).toMatchObject({ protected_pixels: 2, editable_pixels: 6 });
  });

  test("protected-face parser refuses foreign, duplicated and unscoped identity regions", () => {
    const region = { cube_uuid: "body", face: "north",
      rect: { x: 0, y: 0, width: 1, height: 1 } };
    const base = { ramp: ["#16441e", "#c1f4c4"],
      source_hue_color: "#a00000",
      face_targets: [{ cube_uuid: "body", face: "north" }],
      protected_face_regions: [region] };
    const parse = (args: Record<string, unknown>) =>
      parseTextureComputeRequest([{ operation: "gradient_map", args }]);
    expect(() => parse(base)).not.toThrow();
    expect(() => parse({ ...base, protected_face_regions: [region, region] }))
      .toThrow("protected_face_regions");
    expect(() => parse({ ...base, protected_face_regions: [
      { ...region, cube_uuid: "foreign" }] })).toThrow("FACE_PROTECTION_TARGET_NOT_SELECTED");
    expect(() => parse({
      ramp: base.ramp, source_hue_color: base.source_hue_color,
      protected_face_regions: [region],
    })).toThrow("protected_face_regions require face_targets");
    expect(() => parse({ ...base, target_rect: { x: 0, y: 0, width: 1, height: 1 } }))
      .toThrow("mutually exclusive");
    expect(() => parse({ ...base, protected_face_regions: [
      { ...region, rect: { x: -1, y: 0, width: 1, height: 1 } }] }))
      .toThrow("protected_face_regions");
    expect(() => parseTextureComputeRequest([
      { operation: "gradient_map", args: {
        ramp: ["#16441e", "#c1f4c4"],
        source_hue_color: "#a00000",
        face_targets: base.face_targets,
      } },
      { operation: "posterize", args: { levels: 3, protected_face_regions: [region] } },
    ])).toThrow("only on compute[0]");
  });

  test("protected-face selection fails closed on unsafe native owners or masks", () => {
    const base = {
      cube_uuid: "body", face: "north" as const, enabled: true,
      texture_uuid: "atlas", native_material_name: "metal",
      rect: [0, 0, 2, 2] as const, uv: [0, 0, 2, 2], rotation: 0,
    };
    const selected = [{ cube_uuid: "body", face: "north" as const }];
    const scope = planFaceScopedTextureSelection({
      texture_uuid: "atlas", bitmap_width: 4, bitmap_height: 2,
      faces: [base], face_targets: selected,
    });
    const region = { cube_uuid: "body", face: "north" as const,
      rect: { x: 0, y: 0, width: 1, height: 1 } };
    const run = (overrides: Record<string, unknown> = {}) =>
      planProtectedFaceLocalRegions({
        texture_uuid: "atlas", bitmap_width: 4, bitmap_height: 2,
        logical_uv_width: 4, logical_uv_height: 2,
        native_faces: [base], face_targets: selected,
        selection: scope, protected_regions: [region],
        ...overrides,
      });
    expect(() => run({ protected_regions: [{ ...region,
      rect: { x: 2, y: 0, width: 1, height: 1 } }] }))
      .toThrow("FACE_PROTECTION_LOCAL_BOUNDS");
    expect(() => run({ protected_regions: [region, region] }))
      .toThrow("FACE_PROTECTION_OVERLAPPING_REGIONS");
    expect(() => run({ protected_regions: [{ ...region,
      rect: { x: 0, y: 0, width: 2, height: 2 } }] }))
      .toThrow("FACE_PROTECTION_EXHAUSTS_TARGET");
    expect(() => run({ native_faces: [{ ...base, uv: [0, 0, 1, 2] }] }))
      .toThrow("FACE_PROTECTION_NATIVE_UV_RECT_MISMATCH");
    const stacked = { ...base, cube_uuid: "other" };
    const stackedSelection = planFaceScopedTextureSelection({
      texture_uuid: "atlas", bitmap_width: 4, bitmap_height: 2,
      faces: [base, stacked],
      face_targets: [...selected, { cube_uuid: "other", face: "north" }],
    });
    expect(() => run({ native_faces: [base, stacked],
      face_targets: [...selected, { cube_uuid: "other", face: "north" }],
      selection: stackedSelection })).toThrow("FACE_PROTECTION_SHARED_UV_REVIEW_REQUIRED");
  });

  test("observes shadow/base/highlight on one exact face while preserving a same-RGB logo", () => {
    const image = new Uint8ClampedArray([
      0x50,0,0,255,  0xa0,0,0,255,  0xf0,0,0,255,
      0xa0,0,0,255,  0,0,255,255,  0x50,0,0,255,
    ]);
    const face = { cube_uuid: "armor", face: "north" as const,
      enabled: true, texture_uuid: "atlas",
      native_material_name: "metal", rect: [0,0,5,1] as const,
      uv: [0,0,5,1], rotation: 0 };
    const other = { ...face, cube_uuid: "other",
      rect: [5,0,6,1] as const, uv: [5,0,6,1] };
    const request = parseTextureComputeRequest([{
      operation: "gradient_map", args: {
        ramp: ["#103020","#34834d","#b7f6c4"], mode: "nearest",
        source_hue_color: "#a00000",
        source_ramp_from_selected_pixels: true,
        face_targets: [{ cube_uuid: "armor", face: "north" }],
        protected_face_regions: [{ cube_uuid: "armor", face: "north",
          rect: { x: 3, y: 0, width: 1, height: 1 } }],
      },
    }]);
    const scope = planFaceScopedTextureSelection({
      texture_uuid: "atlas", bitmap_width: 6, bitmap_height: 1,
      faces: [face, other], face_targets: request.face_targets!,
    });
    const protectedMask = planProtectedFaceLocalRegions({
      texture_uuid: "atlas", bitmap_width: 6, bitmap_height: 1,
      logical_uv_width: 6, logical_uv_height: 1,
      native_faces: [face,other], face_targets: request.face_targets!,
      selection: scope, protected_regions: request.protected_face_regions!,
    });
    const result = applyTextureComputePipeline(
      image,6,1,request.steps,scope.target_rect,protectedMask.target_mask
    );
    expect(result.receipt.execution.source_ramp_observation).toMatchObject({
      method: "selected_current_atlas_pixels",
      source_ramp: ["#500000","#a00000","#f00000"],
      scanned_roi_pixels: 5,
      sampled_opaque_pixels: 4, qualifying_opaque_pixels: 3,
      visual_verdict: "not_evaluated",
    });
    expect(result.receipt.changed_pixels).toBe(3);
    for(const i of [3,4,5]){
      expect([...result.pixels.slice(i*4,i*4+4)])
        .toEqual([...image.slice(i*4,i*4+4)]);
    }
    expect([...result.pixels.slice(0,4)]).toEqual([0x10,0x30,0x20,255]);
    expect([...result.pixels.slice(4,8)]).toEqual([0x34,0x83,0x4d,255]);
    expect([...result.pixels.slice(8,12)]).toEqual([0xb7,0xf6,0xc4,255]);
  });

  test("samples a generated-gradient ramp within ROI without changing other materials", () => {
    const image = new Uint8ClampedArray([
      0x50,0,0,255, 0xa0,0,0,255, 0xf0,0,0,255,
      0x30,0,0,255, 0x20,0,0,255,
    ]);
    const parsed = parseTextureComputeRequest([{
      operation: "generated_gradient_map", args: {
        base_color: "#398455", steps: 3,
        source_hue_color: "#a00000",
        source_ramp_from_selected_pixels: true,
        target_rect: { x: 0, y: 0, width: 3, height: 1 },
      },
    }]);
    const result = applyTextureComputePipeline(
      image, 5, 1, parsed.steps, parsed.target_rect!
    );
    expect(result.receipt.execution.source_ramp_observation?.source_ramp)
      .toEqual(["#500000","#a00000","#f00000"]);
    expect(result.receipt.changed_pixels).toBe(3);
    expect([...result.pixels.slice(12)]).toEqual([...image.slice(12)]);
    const manual = parseTextureComputeRequest([{
      operation: "gradient_map", args: {
        ramp: ["#103020","#34834d","#b7f6c4"], mode: "nearest",
        source_hue_color: "#a00000",
        source_ramp: ["#500000","#a00000","#f00000"],
        target_rect: { x: 0, y: 0, width: 3, height: 1 },
      },
    }]);
    const observed = parseTextureComputeRequest([{
      operation: "gradient_map", args: {
        ramp: ["#103020","#34834d","#b7f6c4"], mode: "nearest",
        source_hue_color: "#a00000",
        source_ramp_from_selected_pixels: true,
        target_rect: { x: 0, y: 0, width: 3, height: 1 },
      },
    }]);
    const a = applyTextureComputePipeline(image,5,1,manual.steps,manual.target_rect!);
    const b = applyTextureComputePipeline(image,5,1,observed.steps,observed.target_rect!);
    expect([...a.pixels]).toEqual([...b.pixels]);
    expect(b.receipt.execution.planner.estimated_pixel_visits_upper_bound -
      a.receipt.execution.planner.estimated_pixel_visits_upper_bound).toBe(3);
    expect(a.receipt.execution.source_ramp_observation).toBeUndefined();
  });

  test("existing constant ordered-gradient ROI rewrite still runs before scope validation", () => {
    const request = parseTextureComputeRequest([{
      operation: "gradient_map", args: {
        ramp: ["#112233", "#112233"], mode: "ordered",
        target_rect: { x: 0, y: 0, width: 1, height: 1 },
      },
    }]);
    const result = applyTextureComputePipeline(
      new Uint8ClampedArray([255,0,0,255]), 1, 1,
      request.steps, request.target_rect!
    );
    expect(result.receipt.rewrites).toContain("constant_ordered_gradient->nearest");
    expect([...result.pixels]).toEqual([0x11,0x22,0x33,255]);
  });

  test("auto source ramp fails closed on missing, contradictory or non-opaque shades", () => {
    const ramp = ["#103020","#34834d","#b7f6c4"];
    const rect = { x: 0,y: 0,width: 3,height: 1 };
    const auto = (args: Record<string,unknown>) =>
      parseTextureComputeRequest([{operation:"gradient_map",args}]);
    const params = {ramp,source_hue_color:"#a00000",
      target_rect:rect,source_ramp_from_selected_pixels:true};
    expect(()=>auto({...params,source_ramp:["#500000","#a00000","#f00000"]}))
      .toThrow("MATERIAL_RAMP_SOURCE_CONFLICT");
    expect(()=>auto({ramp,target_rect:rect,source_ramp_from_selected_pixels:true}))
      .toThrow("requires source_hue_color");
    expect(()=>auto({...params,source_ramp_from_selected_pixels:false}))
      .toThrow();
    const request=auto(params);
    const onlyBase=new Uint8ClampedArray([
      0xa0,0,0,255, 0xa0,0,0,255, 0xa0,0,0,255,
    ]);
    expect(()=>applyTextureComputePipeline(onlyBase,3,1,request.steps,rect))
      .toThrow("MATERIAL_OBSERVED_RAMP_UNRESOLVED");
    const transparentShadow=new Uint8ClampedArray([
      0x50,0,0,0, 0xa0,0,0,255, 0xf0,0,0,255,
    ]);
    expect(()=>applyTextureComputePipeline(transparentShadow,3,1,request.steps,rect))
      .toThrow("MATERIAL_OBSERVED_RAMP_UNRESOLVED");
    const full=new Uint8ClampedArray([
      0x50,0,0,255, 0xa0,0,0,255, 0xf0,0,0,255,
    ]);
    const hiddenBase = new Uint8Array([1,0,1]);
    expect(()=>applyTextureComputePipeline(full,3,1,request.steps,rect,hiddenBase))
      .toThrow("MATERIAL_SOURCE_SWATCH_NOT_FOUND");
    const narrow=auto({...params,source_hue_color:"#f00000"});
    expect(()=>applyTextureComputePipeline(full,3,1,narrow.steps,rect))
      .toThrow("MATERIAL_OBSERVED_RAMP_UNRESOLVED");
    const direct = {
      sourceHueColor: "#a00000", sourceRampFromSelectedPixels:true as const,
    };
    expect(()=>gradientMapRgba(full,3,1,ramp,direct))
      .toThrow("MATERIAL_OBSERVED_RAMP_REQUIRES_SCOPED_COMPUTE");
  });

  test("material source/protection samples must be physically present in selected faces", () => {
    const source = new Uint8ClampedArray([
      0x50,0,0,255,  0xa0,0,0,255,  0xf0,0,0,255,
      0xb0,0,0,255,
    ]);
    const request = parseTextureComputeRequest([{
      operation:"gradient_map",
      args:{
        ramp:["#103020","#34834d","#b7f6c4"],mode:"nearest",
        source_hue_color:"#a00000",
        source_ramp:["#500000","#a00000","#f00000"],
        protected_colors:["#b00000"],
        target_rect:{x:0,y:0,width:4,height:1},
      },
    }]);
    const step = request.steps;
    // Every sample exists in the atlas, but the selected face/mask lacks
    // the highlight and identity. No inferred palette or partial mutation.
    expect(() => applyTextureComputePipeline(source,4,1,step,
      request.target_rect!,new Uint8Array([1,1,0,0])))
      .toThrow("MATERIAL_SOURCE_SWATCH_NOT_FOUND");
    expect(() => applyTextureComputePipeline(source,4,1,step,
      request.target_rect!,new Uint8Array([1,1,1,0])))
      .toThrow("MATERIAL_SOURCE_SWATCH_NOT_FOUND");
    expect(Array.from(source)).toEqual([
      0x50,0,0,255,  0xa0,0,0,255,  0xf0,0,0,255,
      0xb0,0,0,255,
    ]);
  });

  test("source-bound material composition refuses ambiguous or conflicting palette instructions", () => {
    const step = (args:Record<string,unknown>) => parseTextureComputeRequest([{
      operation:"gradient_map",args:{
        ramp:["#103020","#34834d","#b7f6c4"],
        target_rect:{x:0,y:0,width:4,height:1},...args,
      },
    }]);
    expect(() => step({source_ramp:["#500000","#a00000","#f00000"]}))
      .toThrow("require source_hue_color");
    expect(() => step({source_hue_color:"#a00000",
      source_ramp:["#500000","#f00000"]}))
      .toThrow();
    expect(() => step({source_hue_color:"#a00000",
      protected_colors:["#b00000","#B00000"]}))
      .toThrow();
    const source = new Uint8ClampedArray([
      0x50,0,0,255, 0xa0,0,0,255, 0xf0,0,0,255, 0xb0,0,0,255,
    ]);
    const doMap = (source_ramp:string[],protected_colors:string[]) => {
      const req=step({source_hue_color:"#a00000",source_ramp,
        protected_colors,mode:"nearest"});
      return applyTextureComputePipeline(source,4,1,req.steps,req.target_rect!);
    };
    expect(() => doMap(["#f00000","#a00000","#500000"],["#b00000"]))
      .toThrow("MATERIAL_RAMP_VALUE_ORDER");
    expect(() => doMap(["#500000","#a00000","#f00000"],["#a00000"]))
      .toThrow("MATERIAL_RAMP_PROTECTED_COLLISION");
    expect(() => doMap(["#500000","#a00000","#f00000"],["#f00000"]))
      .toThrow("MATERIAL_RAMP_PROTECTED_COLLISION");
    expect(() => doMap(["#500000","#a00000","#f00000"],["#bb0000"]))
      .toThrow("MATERIAL_SOURCE_SWATCH_NOT_FOUND");
    expect(() => parseTextureComputeRequest([{
      operation:"gradient_map",args:{
        ramp:["#103020","#34834d","#b7f6c4"],
        source_hue_color:"#a00000",
        source_ramp:["#500000","#a00000","#f00000"],
      },
    }])).toThrow("explicit target_rect or face_targets");
  });

  test("selective hue-family recolor is bounded to an explicit ROI and preserves unrelated pixels", () => {
    const source = new Uint8ClampedArray([
      64, 0, 0, 255, 200, 0, 0, 255, 0, 0, 255, 255,
      80, 80, 80, 255, 255, 0, 0, 0, 255, 0, 0, 255,
    ]);
    const request = parseTextureComputeRequest([{
      operation: "gradient_map",
      args: {
        ramp: ["#16441e", "#c1f4c4"],
        source_hue_color: "#ff0000", hue_tolerance_degrees: 25,
        target_rect: { x: 0, y: 0, width: 5, height: 1 },
      },
    }]);
    expect(request.steps).toHaveLength(1);
    const result = applyTextureComputePipeline(source, 6, 1, request.steps, request.target_rect ?? undefined);
    expect(result.receipt.changed_pixels).toBe(2);
    expect([...result.pixels.slice(8)]).toEqual([...source.slice(8)]);
    expect([...result.pixels.slice(0, 8)]).not.toEqual([...source.slice(0, 8)]);
    expect(result.receipt.execution.region.bounded).toBe(true);
  });

  test("selective recolor fails closed without ROI, for mixed steps, and for missing hue identity", () => {
    expect(() => parseTextureComputeRequest([{
      operation: "gradient_map",
      args: { ramp: ["#16441e", "#c1f4c4"], source_hue_color: "#ff0000" },
    }])).toThrow("explicit target_rect");
    expect(() => parseTextureComputeRequest([
      { operation: "gradient_map", args: {
        ramp: ["#16441e", "#c1f4c4"], source_hue_color: "#ff0000",
        target_rect: { x: 0, y: 0, width: 1, height: 1 },
      } },
      { operation: "posterize", args: { levels: 3 } },
    ])).toThrow("exactly one");
    expect(() => parseTextureComputeRequest([{
      operation: "generated_gradient_map",
      args: { base_color: "#527935", steps: 5, hue_tolerance_degrees: 15,
        target_rect: { x: 0, y: 0, width: 1, height: 1 } },
    }])).toThrow("requires source_hue_color");
    expect(() => applyTextureComputePipeline(
      new Uint8ClampedArray([255, 0, 0, 255]), 1, 1,
      [{ operation: "gradient_map", ramp: ["#16441e", "#c1f4c4"],
        options: { sourceHueColor: "#ff0000" } }]
    )).toThrow("explicit target_rect");
  });


  test("selective face-owned recoloring preserves same-hue material elsewhere in atlas",()=>{
    const faces=[
      {cube_uuid:"cloth",face:"north" as const,enabled:true,
        texture_uuid:"atlas",native_material_name:"cloth",rect:[0,0,2,2] as const},
      {cube_uuid:"eye",face:"north" as const,enabled:true,
        texture_uuid:"atlas",native_material_name:"eye",rect:[3,0,5,2] as const},
    ];
    const request=parseTextureComputeRequest([{
      operation:"gradient_map",
      args:{ramp:["#16441e","#c1f4c4"],source_hue_color:"#ff0000",
        face_targets:[{cube_uuid:"cloth",face:"north"}]},
    }]);
    expect(request.target_rect).toBeNull();
    const scope=planFaceScopedTextureSelection({
      texture_uuid:"atlas",bitmap_width:5,bitmap_height:2,
      faces,face_targets:request.face_targets!,
    });
    expect(scope).toMatchObject({target_rect:{x:0,y:0,width:2,height:2},
      covered_pixels:4,material_identity:"native_named"});
    const pixels=new Uint8ClampedArray(Array.from({length:10},()=>[190,0,0,255]).flat());
    const output=applyTextureComputePipeline(pixels,5,2,request.steps,
      scope.target_rect,scope.target_mask);
    expect(output.receipt.changed_pixels).toBe(4);
    expect(output.receipt.execution.region)
      .toMatchObject({mask_scope:"exact_cube_faces",covered_pixels:4});
    for(let y=0;y<2;y++)for(let x=2;x<5;x++){
      const i=(y*5+x)*4;
      expect([...output.pixels.slice(i,i+4)]).toEqual([...pixels.slice(i,i+4)]);
    }
  });

  test("disjoint faces keep sparse pixels outside both UVs byte-identical",()=>{
    const faces=[
      {cube_uuid:"a",face:"north" as const,enabled:true,
        texture_uuid:"atlas",native_material_name:"",rect:[0,0,1,1] as const},
      {cube_uuid:"b",face:"north" as const,enabled:true,
        texture_uuid:"atlas",native_material_name:"",rect:[4,0,5,1] as const},
    ];
    const scope=planFaceScopedTextureSelection({
      texture_uuid:"atlas",bitmap_width:5,bitmap_height:1,faces,
      face_targets:[{cube_uuid:"a",face:"north"},{cube_uuid:"b",face:"north"}],
    });
    expect([...scope.target_mask]).toEqual([1,0,0,0,1]);
    expect(scope.material_identity).toBe("unnamed_default");
    const pixels=new Uint8ClampedArray(Array.from({length:5},()=>[180,0,0,255]).flat());
    const request=parseTextureComputeRequest([{
      operation:"gradient_map",args:{ramp:["#16441e","#c1f4c4"],
        source_hue_color:"#ff0000",face_targets:[{cube_uuid:"a",face:"north"}]},
    }]);
    const result=applyTextureComputePipeline(pixels,5,1,request.steps,
      scope.target_rect,scope.target_mask);
    expect(result.receipt.changed_pixels).toBe(2);
    expect([...result.pixels.slice(4,16)]).toEqual([...pixels.slice(4,16)]);
  });

  test("unselected exact or partially shared UV ownership refuses recoloring",()=>{
    const left={cube_uuid:"left",face:"north" as const,enabled:true,
      texture_uuid:"atlas",native_material_name:"cloth",rect:[0,0,2,2] as const};
    for(const rect of [[0,0,2,2],[1,1,3,3]] as const){
      expect(()=>planFaceScopedTextureSelection({
        texture_uuid:"atlas",bitmap_width:8,bitmap_height:8,
        faces:[left,{...left,cube_uuid:"right",native_material_name:"eye",rect}],
        face_targets:[{cube_uuid:"left",face:"north"}],
      })).toThrow("FACE_SCOPE_UNSELECTED_UV_OWNER");
    }
    expect(()=>planFaceScopedTextureSelection({
      texture_uuid:"atlas",bitmap_width:8,bitmap_height:8,
      faces:[left,{...left,cube_uuid:"right",rect:[2,0,4,2] as const}],
      face_targets:[{cube_uuid:"left",face:"north"}],
    })).not.toThrow();
  });

  test("face planner rejects partial selected overlap and mixed native materials",()=>{
    const a={cube_uuid:"a",face:"north" as const,enabled:true,
      texture_uuid:"atlas",native_material_name:"cloth",rect:[0,0,2,2] as const};
    const run=(b:NativeFaceFootprint)=>planFaceScopedTextureSelection({
      texture_uuid:"atlas",bitmap_width:8,bitmap_height:8,
      faces:[a,b],
      face_targets:[{cube_uuid:"a",face:"north"},{cube_uuid:"b",face:"north"}],
    });
    expect(()=>run({...a,cube_uuid:"b",rect:[1,1,3,3] as const}))
      .toThrow("FACE_SCOPE_PARTIAL_UV_OVERLAP");
    expect(()=>run({...a,cube_uuid:"b",rect:[2,0,4,2] as const,
      native_material_name:"metal"})).toThrow("FACE_SCOPE_MATERIAL_MISMATCH");
  });

  test("face-target parser blocks combined rectangle/mixed/unscoped edits",()=>{
    const gradient={operation:"gradient_map" as const,
      args:{ramp:["#16441e","#c1f4c4"],source_hue_color:"#ff0000",
        face_targets:[{cube_uuid:"a",face:"north"}]}};
    expect(()=>parseTextureComputeRequest([{...gradient,args:{...gradient.args,
      target_rect:{x:0,y:0,width:1,height:1}}}])).toThrow("mutually exclusive");
    expect(()=>parseTextureComputeRequest([gradient,
      {operation:"posterize",args:{levels:3}}])).toThrow("one selective gradient");
    expect(()=>parseTextureComputeRequest([{operation:"gradient_map",
      args:{ramp:["#16441e","#c1f4c4"],face_targets:[{cube_uuid:"a",face:"north"}]}
    }])).toThrow("source_hue_color");
    expect(()=>parseTextureComputeRequest([{...gradient,args:{...gradient.args,
      face_targets:[gradient.args.face_targets[0],gradient.args.face_targets[0]]}}
    ])).toThrow("face_targets");
  });

  test("internal pixel masks reject mismatched, empty and illegal coverage",()=>{
    const image=new Uint8ClampedArray([190,0,0,255]);
    const steps=[{operation:"gradient_map" as const,ramp:["#16441e","#c1f4c4"],
      options:{sourceHueColor:"#ff0000"}}];
    const rect={x:0,y:0,width:1,height:1};
    expect(()=>applyTextureComputePipeline(image,1,1,steps,rect,new Uint8Array([0])))
      .toThrow("FACE_SCOPE_MASK_EMPTY");
    expect(()=>applyTextureComputePipeline(image,1,1,steps,rect,new Uint8Array([2])))
      .toThrow("FACE_SCOPE_MASK_INVALID");
    expect(()=>applyTextureComputePipeline(image,1,1,steps,rect,new Uint8Array(0)))
      .toThrow("FACE_SCOPE_MASK_INVALID");
    expect(()=>applyTextureComputePipeline(image,1,1,steps,undefined,new Uint8Array([1])))
      .toThrow("FACE_SCOPE_MASK_INVALID");
  });

  test("extracts one bounded pipeline target from compute[0] without changing public envelope", () => {
    const request = parseTextureComputeRequest([
      {
        operation: "posterize",
        args: {
          levels: 3,
          target_rect: { x: 1, y: 2, width: 4, height: 5 },
        },
      },
      {
        operation: "gradient_map",
        args: {
          ramp: ["#000000", "#FFFFFF"],
          mode: "nearest",
        },
      },
    ]);

    expect(request.target_rect).toEqual({
      x: 1,
      y: 2,
      width: 4,
      height: 5,
    });
    expect(request.steps[0]).toEqual({
      operation: "posterize",
      options: { levels: 3 },
    });
    expect(() =>
      parseTextureComputeRequest([
        {
          operation: "posterize",
          args: { levels: 3 },
        },
        {
          operation: "gradient_map",
          args: {
            ramp: ["#000000", "#FFFFFF"],
            target_rect: { x: 0, y: 0, width: 1, height: 1 },
          },
        },
      ])
    ).toThrow("must be declared only on compute[0].args");
  });

  test("invalid compute args fail closed with step context", () => {
    expect(() =>
      parseTextureComputeSteps([
        {
          operation: "posterize",
          args: { levels: 1 },
        },
      ])
    ).toThrow("compute[0] posterize is invalid");
  });

  test("pipeline returns bounded changed-state receipt", () => {
    const source = new Uint8ClampedArray([
      60, 60, 60, 255,
      90, 90, 90, 255,
      160, 160, 160, 255,
      220, 220, 220, 255,
    ]);
    const result = applyTextureComputePipeline(source, 4, 1, [
      {
        operation: "generated_gradient_map",
        base_color: "#845442",
        ramp: { steps: 5 },
        options: { mode: "nearest" },
      },
    ]);

    expect(result.receipt.operation_count).toBe(1);
    expect(result.receipt.operations).toEqual(["generated_gradient_map"]);
    expect(result.receipt.changed_pixels).toBeGreaterThan(0);
    expect(result.receipt.changed_rect).toEqual([0, 0, 4, 1]);
    expect(Array.from(result.pixels)).not.toEqual(Array.from(source));
  });

  test("adaptive planner skips explicit no-ops before execution", () => {
    const source = new Uint8ClampedArray([
      60, 60, 60, 255,
      180, 180, 180, 255,
    ]);
    const result = applyTextureComputePipeline(source, 2, 1, [
      { operation: "auto_levels", options: { strength: 0 } },
      { operation: "posterize", options: { levels: 2, strength: 1 } },
    ]);

    expect(result.receipt.requested_operation_count).toBe(2);
    expect(result.receipt.operation_count).toBe(1);
    expect(result.receipt.skipped_operations).toContain("auto_levels");
    expect(result.receipt.operations).toEqual(["posterize"]);
  });

  test("zero-strength palette diffusion is rewritten to equivalent nearest mapping", () => {
    const source = new Uint8ClampedArray([
      110, 110, 110, 255,
      180, 180, 180, 255,
    ]);
    const result = applyTextureComputePipeline(source, 2, 1, [
      {
        operation: "palette_diffusion",
        palette: ["#000000", "#FFFFFF"],
        options: { strength: 0 },
      },
    ]);

    expect(result.receipt.rewrites).toContain(
      "palette_diffusion(strength=0)->palettize(nearest)"
    );
    expect(result.receipt.operations).toEqual(["palettize"]);
  });

  test("pointwise fusion avoids a second full compliance/remap pass", () => {
    const source = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      120, 120, 120, 255,
    ]);
    const result = applyTextureComputePipeline(source, 3, 1, [
      {
        operation: "posterize",
        options: { levels: 2, strength: 1 },
      },
      {
        operation: "palettize",
        palette: ["#000000", "#FFFFFF"],
        options: { dither: "none" },
      },
    ]);

    expect(result.receipt.operations).toEqual(["posterize", "palettize"]);
    expect(result.receipt.execution.fused_groups).toBe(1);
    expect(result.receipt.execution.fused_steps).toBe(2);
    expect(result.receipt.execution.unique_color_transforms).toBeLessThanOrEqual(3);
    expect(result.receipt.execution.planner.selected_paths).toContain("fused_pointwise");
    expect(result.receipt.execution.planner.estimated_full_pixel_passes).toBe(1);
    expect(
      result.receipt.execution.planner.estimated_pixel_visits_upper_bound
    ).toBeGreaterThanOrEqual(
      result.receipt.execution.planner.estimated_pixel_visits_baseline
    );
  });

  test("request-local color cache reuses repeated pixel conversions", () => {
    const source = new Uint8ClampedArray(
      Array.from({ length: 64 }, () => [120, 80, 40, 255]).flat()
    );
    const result = applyTextureComputePipeline(source, 8, 8, [
      {
        operation: "directional_shade",
        options: { depth: 2, strength: 0.8 },
      },
      {
        operation: "generated_gradient_map",
        base_color: "#845442",
        ramp: { steps: 5 },
        options: { mode: "nearest" },
      },
    ]);

    expect(result.receipt.color_cache.oklab_cache_hits).toBeGreaterThan(
      result.receipt.color_cache.oklab_cache_misses
    );
  });

  test("fused pointwise pipeline is byte-identical to sequential execution", () => {
    const source = new Uint8ClampedArray(
      Array.from({ length: 64 }, (_, index) => {
        const value = index % 2 === 0 ? 90 : 170;
        return [value, value - 20, value - 40, 255];
      }).flat()
    );
    const ramp = ["#201510", "#845442", "#D8A070"];
    const palette = ["#201510", "#845442", "#D8A070"];

    const sequentialPosterize = posterizeLightnessRgba(
      source,
      8,
      8,
      { levels: 4, strength: 1 }
    );
    const sequentialGradient = gradientMapRgba(
      sequentialPosterize,
      8,
      8,
      ramp,
      { mode: "nearest" }
    );
    const sequential = palettizeRgba(
      sequentialGradient,
      8,
      8,
      palette,
      { dither: "none" }
    );

    const fused = applyTextureComputePipeline(source, 8, 8, [
      {
        operation: "posterize",
        options: { levels: 4, strength: 1 },
      },
      {
        operation: "gradient_map",
        ramp,
        options: { mode: "nearest" },
      },
      {
        operation: "palettize",
        palette,
        options: { dither: "none" },
      },
    ]);

    expect(Array.from(fused.pixels)).toEqual(Array.from(sequential));
    expect(fused.receipt.execution.fused_groups).toBe(1);
    expect(fused.receipt.execution.fused_steps).toBe(3);
    expect(fused.receipt.execution.unique_color_transforms).toBeLessThan(64);
    expect(fused.receipt.execution.transient_sample_buffers).toBe(0);
    expect(fused.receipt.execution.scalar_transform_calls).toBe(
      fused.receipt.execution.unique_color_transforms * 3
    );
  });

  test("fused generated ramps are prepared once per group and remain sequentially equivalent", () => {
    const source = new Uint8ClampedArray(
      Array.from({ length: 32 }, (_, index) => {
        const value = index % 4 === 0 ? 60 : index % 4 === 1 ? 100 : index % 4 === 2 ? 160 : 220;
        return [value, value - 10, value - 20, 255];
      }).flat()
    );
    const generatedStep = {
      operation: "generated_gradient_map" as const,
      base_color: "#845442",
      ramp: { steps: 5 },
      options: { mode: "nearest" as const },
    };
    const palette = ["#201510", "#845442", "#D8A070"];
    const generatedRamp = generateShadeRamp("#845442", { steps: 5 });
    const sequentialGradient = gradientMapRgba(
      source,
      8,
      4,
      generatedRamp,
      { mode: "nearest" }
    );
    const sequential = palettizeRgba(
      sequentialGradient,
      8,
      4,
      palette,
      { dither: "none" }
    );
    const fused = applyTextureComputePipeline(source, 8, 4, [
      generatedStep,
      {
        operation: "palettize",
        palette,
        options: { dither: "none" },
      },
    ]);

    expect(Array.from(fused.pixels)).toEqual(Array.from(sequential));
    expect(fused.receipt.execution.prepared_generated_ramps).toBe(1);
    expect(fused.receipt.execution.transient_sample_buffers).toBe(0);
    expect(fused.receipt.execution.planner.unique_color_sample.sampled_pixels).toBe(32);
    expect(fused.receipt.execution.actual_palette_comparisons).toBeGreaterThan(0);
  });

  test("bounded ROI computes and diffs only the requested target", () => {
    const source = new Uint8ClampedArray(
      Array.from({ length: 16 }, (_, index) => {
        const value = 40 + index * 10;
        return [value, value, value, 255];
      }).flat()
    );
    const result = applyTextureComputePipeline(
      source,
      4,
      4,
      [
        {
          operation: "posterize",
          options: { levels: 2, strength: 1 },
        },
      ],
      { x: 1, y: 1, width: 2, height: 2 }
    );

    expect(result.receipt.execution.region).toEqual({
      bounded: true,
      target_rect: [1, 1, 3, 3],
      compute_rect: [1, 1, 3, 3],
      halo: 0,
      atlas_pixels: 16,
      target_pixels: 4,
      compute_pixels: 4,
    });
    expect(result.receipt.changed_rect?.[0]).toBeGreaterThanOrEqual(1);
    expect(result.receipt.changed_rect?.[1]).toBeGreaterThanOrEqual(1);
    expect(result.receipt.changed_rect?.[2]).toBeLessThanOrEqual(3);
    expect(result.receipt.changed_rect?.[3]).toBeLessThanOrEqual(3);

    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (x >= 1 && x < 3 && y >= 1 && y < 3) continue;
        const offset = (y * 4 + x) * 4;
        expect(Array.from(result.pixels.slice(offset, offset + 4))).toEqual(
          Array.from(source.slice(offset, offset + 4))
        );
      }
    }
  });

  test("bounded directional shading derives a one-pixel halo", () => {
    const source = new Uint8ClampedArray(
      Array.from({ length: 25 }, (_, index) => {
        const value = 40 + index * 5;
        return [value, value, value, 255];
      }).flat()
    );
    const result = applyTextureComputePipeline(
      source,
      5,
      5,
      [
        {
          operation: "directional_shade",
          options: { depth: 1, strength: 0.7 },
        },
      ],
      { x: 2, y: 2, width: 1, height: 1 }
    );

    expect(result.receipt.execution.region.halo).toBe(1);
    expect(result.receipt.execution.region.compute_rect).toEqual([1, 1, 4, 4]);
    expect(result.receipt.execution.region.compute_pixels).toBe(9);
    expect(result.receipt.execution.planner.selected_paths).toContain("bounded_roi");
    expect(result.receipt.execution.planner.selected_paths).toContain("streaming_spatial");
    expect(
      result.receipt.execution.planner.estimated_peak_temporary_bytes
    ).toBeGreaterThan(9 * 4);
  });

  test("bounded ROI fails closed for coordinate-phase or propagation-sensitive operations", () => {
    const source = new Uint8ClampedArray([
      80, 80, 80, 255,
      160, 160, 160, 255,
    ]);

    expect(() =>
      applyTextureComputePipeline(
        source,
        2,
        1,
        [
          {
            operation: "palettize",
            palette: ["#000000", "#FFFFFF"],
            options: { dither: "ordered" },
          },
        ],
        { x: 0, y: 0, width: 1, height: 1 }
      )
    ).toThrow("Bayer phase");

    expect(() =>
      applyTextureComputePipeline(
        source,
        2,
        1,
        [
          {
            operation: "palette_diffusion",
            palette: ["#000000", "#FFFFFF"],
          },
        ],
        { x: 0, y: 0, width: 1, height: 1 }
      )
    ).toThrow("error propagation");
  });

  test("pipeline rejects no-op compute results", () => {
    const source = new Uint8ClampedArray([0, 0, 0, 0]);
    expect(() =>
      applyTextureComputePipeline(source, 1, 1, [
        { operation: "auto_levels" },
      ])
    ).toThrow("no authored pixel change");
  });
});

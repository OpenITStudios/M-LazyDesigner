/// <reference types="blockbench-types" />

import { z } from "zod";
import {
  recordCurrentCapabilitySemanticHistoryEffect,
  recordCurrentCapabilitySemanticHistoryEffectIfAdvanced,
} from "@/lib/authoring/semanticHistory";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { runPaintStroke } from "@/lib/texture/paintStroke";
import {
  resolveExactBrushLayerTarget,
  requireExactBrushLayerUnchanged,
} from "./layerState";
import { requireExactBrushPostcondition } from "@/lib/texture/paintTransaction";
import {
  requireSingleFrameBitmapPixels,
  resolveTextureFrameLayout,
} from "@/lib/texture/frameMapping";
import { setBarItemValues } from "@/lib/blockbench/barItems";
import {
  getAndActivateTexture,
  resolvePaintTexture,
} from "@/lib/texture/selection";
import {
  blendModeEnum,
  brushSettingsSchema,
  brushShapeEnum,
  brushSizeSchema,
  brushSoftnessSchema,
  opacitySchema,
} from "@/lib/schemas/texture";
import { coordinateSchema, hexColorSchema } from "@/lib/schemas/common";
import { textureIdOptionalSchema } from "@/lib/schemas/ids";
import {
  exactPixelBounds,
  getRuntimePainter,
  isExactPixelAuthoringRequest,
  requirePaintCoordinates,
  requirePixelsWithinTexture,
  requireTextureCoordinatesWithinBounds,
} from "./shared";

function requireExactPixelsInActiveCanvas(
  coordinates: readonly { x: number; y: number }[],
  canvas: { width: number; height: number },
  offset: readonly number[],
  context: string
): void {
  if (
    !canvas ||
    !Number.isSafeInteger(canvas.width) || canvas.width <= 0 ||
    !Number.isSafeInteger(canvas.height) || canvas.height <= 0 ||
    !Array.isArray(offset) || offset.length !== 2 ||
    !offset.every(Number.isSafeInteger)
  ) {
    throw new Error(
      `${context} requires a valid native canvas and integer frame/layer offset.`
    );
  }
  for (const coordinate of coordinates) {
    const x = coordinate.x - offset[0];
    const y = coordinate.y - offset[1];
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
      throw new Error(
        `${context} exact pixel (${coordinate.x}, ${coordinate.y}) falls outside the active texture canvas/layer.`
      );
    }
  }
}

function runSemanticNativePaintStroke(
  capability: "eraser_tool" | "paint_with_brush",
  stroke: () => void
): void {
  const historyIndexBefore = typeof Undo === "undefined" ? 0 : (Undo.index ?? 0);
  runPaintStroke(stroke);
  recordCurrentCapabilitySemanticHistoryEffectIfAdvanced(
    capability,
    historyIndexBefore
  );
}

export const eraserToolParameters = z.object({
  texture_id: textureIdOptionalSchema,
  coordinates: z
    .array(
      coordinateSchema.extend({
        x: z.number().describe("X coordinate to erase at."),
        y: z.number().describe("Y coordinate to erase at."),
      })
    )
    .describe("Array of coordinates to erase at."),
  brush_size: brushSizeSchema.describe("Eraser brush size."),
  opacity: opacitySchema.describe("Eraser opacity (0-255)."),
  softness: brushSoftnessSchema.describe("Eraser softness percentage."),
  shape: brushShapeEnum.optional().describe("Eraser shape."),
  connect_strokes: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to connect erase strokes with lines."),
});


export const paintWithBrushParameters = z.object({
  texture_id: textureIdOptionalSchema,
  coordinates: z
    .array(
      coordinateSchema.extend({
        x: z.number().describe("X coordinate on texture."),
        y: z.number().describe("Y coordinate on texture."),
      })
    )
    .describe("Array of coordinates to paint at."),
  brush_settings: brushSettingsSchema,
  connect_strokes: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to connect paint strokes with lines."),
});

const pressureCurveSchema = z.array(z.number().finite().min(0).max(1)).length(8)
  .refine((p) => p[0] === 0 && p[6] === 1 && p[2] <= p[4],
    "Curve requires pressure endpoints 0/1 and ordered control-point pressure coordinates.")
  .describe("Four normalized Bezier [pressure,value] pairs. Requires active Brush Tuna and stylus pressure when loaded; does not affect exact pixel transactions.");

export const createBrushPresetParameters = z.object({
  name: z.string().min(1).describe("Non-empty name of the brush preset."),
  size: brushSizeSchema,
  opacity: opacitySchema,
  softness: brushSoftnessSchema,
  shape: brushShapeEnum.optional().describe("Brush shape."),
  color: hexColorSchema.describe("Brush color as hex string."),
  blend_mode: blendModeEnum.optional().describe("Brush blend mode."),
  lock_alpha: z.boolean().optional().describe("Preserve transparent pixels during native brush painting. Does not control exact pixel transactions."),
  size_pressure_curve: pressureCurveSchema.optional(),
  softness_pressure_curve: pressureCurveSchema.optional(),
  opacity_pressure_curve: pressureCurveSchema.optional(),
  pixel_perfect: z
    .boolean()
    .optional()
    .describe("Enable pixel perfect drawing."),
});

export const loadBrushPresetParameters = z.object({
  preset_name: z.string().describe("Name of the brush preset to load."),
});


export const paintBrushToolDocs: ToolSpec[] = [
  {
      name: "eraser_tool",
      description: "Erases parts of textures with customizable settings.",
      annotations: {
        title: "Eraser Tool",
        destructiveHint: true,
      },
      parameters: eraserToolParameters,
      status: STATUS_EXPERIMENTAL,
    },
  {
      name: "paint_with_brush",
      description:
        "Paints on textures using the brush tool with customizable settings.",
      annotations: {
        title: "Paint with Brush",
        destructiveHint: true,
      },
      parameters: paintWithBrushParameters,
      status: STATUS_EXPERIMENTAL,
    },
  {
      name: "create_brush_preset",
      description: "Creates a custom brush preset with specified settings.",
      annotations: {
        title: "Create Brush Preset",
        destructiveHint: true,
      },
      parameters: createBrushPresetParameters,
      status: STATUS_EXPERIMENTAL,
    },
  {
      name: "load_brush_preset",
      description: "Loads and applies a brush preset by name. Pressure curves require active Brush Tuna and stylus input; presets do not control exact pixel transactions.",
      annotations: {
        title: "Load Brush Preset",
        destructiveHint: true,
      },
      parameters: loadBrushPresetParameters,
      status: STATUS_EXPERIMENTAL,
    }
];

export function registerPaintEraserTool(): void {
  createTool(
        paintBrushToolDocs[0].name,
        {
          ...paintBrushToolDocs[0],
          parameters: eraserToolParameters,
          async execute({
            texture_id,
            coordinates,
            brush_size,
            opacity,
            softness,
            shape,
            connect_strokes,
          }) {
            requirePaintCoordinates(coordinates, "eraser_tool");
            const texture = getAndActivateTexture(texture_id);
            requirePixelsWithinTexture(texture, coordinates);
    
            // @ts-ignore - official Blockbench Painter tool ID
            BarItems.eraser.select();
            setBarItemValues({
              ...(brush_size === undefined ? {} : {slider_brush_size:brush_size}),
              ...(opacity === undefined ? {} : {slider_brush_opacity:opacity}),
              ...(softness === undefined ? {} : {slider_brush_softness:softness}),
              ...(shape === undefined ? {} : {brush_shape:shape}),
            });
    
            const first = coordinates[0];
            runSemanticNativePaintStroke("eraser_tool", () => {
              getRuntimePainter().startPaintTool(
                texture,
                first.x,
                first.y,
                {},
                { shiftKey: false }
              );
              for (const coord of coordinates.slice(1)) {
                getRuntimePainter().movePaintTool(
                  texture,
                  coord.x,
                  coord.y,
                  {},
                  !connect_strokes
                );
              }
            });
            Canvas.updateAll();
    
            return `Erased ${coordinates.length} points on texture "${texture.name}"`;
          },
        },
        paintBrushToolDocs[0].status
      );
}

export function registerPaintBrushTools(): void {
  createTool(
        paintBrushToolDocs[1].name,
        {
          ...paintBrushToolDocs[1],
          parameters: paintWithBrushParameters,
          async execute({
            texture_id,
            coordinates,
            brush_settings,
            connect_strokes,
          }) {
            requirePaintCoordinates(coordinates, "paint_with_brush");
            const texture = resolvePaintTexture(texture_id);
            requirePixelsWithinTexture(texture, coordinates);
    
            const colorHex = brush_settings?.color ?? "#000000";
            const size = brush_settings?.size ?? 1;
            const opacity = brush_settings?.opacity ?? 255;
            const softness = brush_settings?.softness ?? 0;
            const shape = brush_settings?.shape ?? "square";
            // Neutral default must match blendModeEnum's "default" so omitted
            // settings can still qualify for the bounded exact-pixel path.
            const blendMode = brush_settings?.blend_mode ?? "default";
            const painter = getRuntimePainter();
    
            // Decide the direct deterministic path before mutating native tool,
            // slider, or ColorPanel state. Exact-pixel writes do not consume that UI state.
            const exactPixelMode = isExactPixelAuthoringRequest(coordinates, {
              size,
              opacity,
              softness,
              shape,
              blendMode,
              connectStrokes: connect_strokes,
              mirrorPainting: painter.mirror_painting,
              lockAlpha: painter.lock_alpha,
              eraseMode: painter.erase_mode,
            });
    
            if (exactPixelMode) {
              // Coordinates are absolute bitmap pixels, not frame-local Y.
              // The selected frame can be addressed beyond display_height,
              // but this edit cannot mix frames in one Undo transaction.
              const frameLayout = resolveTextureFrameLayout(
                texture.width,
                texture.height,
                texture.display_height,
                "paint_with_brush exact pixel"
              );
              requireSingleFrameBitmapPixels(
                frameLayout, coordinates, "paint_with_brush exact pixel"
              );
              requireTextureCoordinatesWithinBounds(
                coordinates,
                texture.width,
                texture.height,
                "paint_with_brush exact pixel"
              );
              const layerTarget = resolveExactBrushLayerTarget(texture);
              const active = texture.getActiveCanvas();
              requireExactBrushLayerUnchanged(texture, layerTarget);
              requireExactPixelsInActiveCanvas(
                coordinates, active.canvas, active.offset,
                "paint_with_brush"
              );
    
              // Read back the whole bounded footprint, so a nearby native
              // paint spill is also detectable before Undo is committed.
              const bounds = exactPixelBounds(coordinates);
              const localTargets = coordinates.map((coordinate) => ({
                x: coordinate.x - bounds.rect[0],
                y: coordinate.y - bounds.rect[1],
              }));

              const undoAspects: UndoAspects = { bitmap: true };
              if (layerTarget.mode === "active_layer") {
                undoAspects.layers = [layerTarget.layer];
              } else {
                undoAspects.textures = [texture];
              }
    
              Undo.initEdit(undoAspects);
              try {
                texture.edit(
                  (
                    _canvas: HTMLCanvasElement,
                    env: BlockbenchRuntimeTextureEditEnvironment
                  ) => {
                    requireExactBrushLayerUnchanged(texture, layerTarget);
                    // Revalidate the actual callback canvas BEFORE any pixel
                    // write. Native layer/frame offset may change after the
                    // preflight; otherwise we could commit a silent no-op or
                    // paint a different frame than the requested bitmap Y.
                    requireExactPixelsInActiveCanvas(
                      coordinates, _canvas, env.offset,
                      "paint_with_brush"
                    );
                    if (
                      env.offset[0] !== active.offset[0] ||
                      env.offset[1] !== active.offset[1]
                    ) {
                      throw new Error(
                        "paint_with_brush exact pixel active frame/layer offset changed during native edit."
                      );
                    }
                    const localLeft = bounds.rect[0] - env.offset[0];
                    const localTop = bounds.rect[1] - env.offset[1];
                    const [regionWidth, regionHeight] = bounds.size;
                    const beforePixels = new Uint8ClampedArray(
                      env.ctx.getImageData(
                        localLeft, localTop, regionWidth, regionHeight
                      ).data
                    );
                    env.ctx.save();
                    try {
                      env.ctx.globalAlpha = 1;
                      env.ctx.globalCompositeOperation = "source-over";
                      env.ctx.fillStyle = colorHex;
                      for (const coordinate of coordinates) {
                        // Exact RGBA replaces the destination, including alpha.
                        env.ctx.clearRect(
                          coordinate.x - env.offset[0],
                          coordinate.y - env.offset[1],
                          1,
                          1
                        );
                        env.ctx.fillRect(
                          coordinate.x - env.offset[0],
                          coordinate.y - env.offset[1],
                          1,
                          1
                        );
                      }
                    } finally {
                      env.ctx.restore();
                    }
                    const afterPixels = env.ctx.getImageData(
                      localLeft, localTop, regionWidth, regionHeight
                    ).data;
                    requireExactBrushPostcondition(
                      beforePixels,
                      afterPixels,
                      regionWidth,
                      regionHeight,
                      localTargets,
                      colorHex
                    );
                    requireExactBrushLayerUnchanged(texture, layerTarget);
                  },
                  { no_undo: true }
                );
                // Native Texture.edit can return after moving the selection
                // even when its canvas dimensions and offsets are unchanged.
                requireExactBrushLayerUnchanged(texture, layerTarget);
                Undo.finishEdit("Paint exact texture pixels");
                recordCurrentCapabilitySemanticHistoryEffect("paint_with_brush");
              } catch (error) {
                Undo.cancelEdit(true);
                throw error;
              }
              Canvas.updateAll();
    
              const result = {
                operation: "paint_with_brush",
                mode: "exact_pixels",
                texture: { uuid: texture.uuid, name: texture.name, id: texture.id },
                pixels_requested: coordinates.length,
                affected_rect: bounds.rect,
                affected_size: bounds.size,
                write_target: {
                  kind: layerTarget.mode,
                  layer_uuid: layerTarget.layer_uuid,
                },
                verification_scope: "native_edit_canvas_rgba" as const,
              };
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Painted ${coordinates.length} exact pixels inside [${bounds.rect.join(", ")}] on "${texture.name}".`,
                  },
                ],
                structuredContent: result,
              };
            }

            // Native Painter state is activated only after the deterministic
            // compatibility path has been ruled out.
            if (Texture.selected?.uuid !== texture.uuid) texture.select();
            // @ts-ignore - official Blockbench Painter tool ID
            BarItems.brush_tool.select();
            setBarItemValues({
              slider_brush_size: size,
              slider_brush_opacity: opacity,
              slider_brush_softness: softness,
              brush_shape: shape,
              blend_mode: blendMode,
            });
            ColorPanel.set(colorHex, false, false);
    
            const first = coordinates[0];
            runSemanticNativePaintStroke("paint_with_brush", () => {
              getRuntimePainter().startPaintTool(
                texture,
                first.x,
                first.y,
                undefined,
                { shiftKey: false }
              );
              for (const coord of coordinates.slice(1)) {
                getRuntimePainter().movePaintTool(
                  texture,
                  coord.x,
                  coord.y,
                  {},
                  !connect_strokes
                );
              }
            });
            Canvas.updateAll();
    
            return `Painted ${coordinates.length} points on texture "${texture.name}"`;
          },
        },
        paintBrushToolDocs[1].status
      );
    
      createTool(
        paintBrushToolDocs[2].name,
        {
          ...paintBrushToolDocs[2],
          parameters: createBrushPresetParameters,
          async execute({
            name,
            size,
            opacity,
            softness,
            shape,
            color,
            blend_mode,
            pixel_perfect,
            lock_alpha,
            size_pressure_curve,
            softness_pressure_curve,
            opacity_pressure_curve,
          }) {
            const memory = (globalThis as unknown as { StateMemory: {
              brush_presets: Array<{ name: string }>;
              save: (key: string) => void;
            } }).StateMemory;
            if (memory.brush_presets.some((p) => p.name === name)) {
              throw new Error(`Brush preset "${name}" already exists.`);
            }
            const preset = {
              name,
              size: size ?? null,
              opacity: opacity ?? null,
              softness: softness ?? null,
              shape: shape || "square",
              color: color || null,
              blend_mode: blend_mode || "default",
              pixel_perfect: pixel_perfect || false,
              ...(lock_alpha === undefined ? {} : { lock_alpha }),
              ...(size_pressure_curve === undefined ? {} : { size_pressure_curve }),
              ...(softness_pressure_curve === undefined ? {} : { softness_pressure_curve }),
              ...(opacity_pressure_curve === undefined ? {} : { opacity_pressure_curve }),
            };
    
            memory.brush_presets.push(preset);
            try {
              memory.save("brush_presets");
            } catch (error) {
              memory.brush_presets.splice(memory.brush_presets.indexOf(preset), 1);
              throw error;
            }
    
            return `Created brush preset "${name}" with settings: ${JSON.stringify(
              preset
            )}`;
          },
        },
        paintBrushToolDocs[2].status
      );
    
      createTool(
        paintBrushToolDocs[3].name,
        {
          ...paintBrushToolDocs[3],
          parameters: loadBrushPresetParameters,
          async execute({ preset_name }) {
            // @ts-ignore
            const matches = StateMemory.brush_presets.filter(
              (p: { name: string }) => p.name === preset_name
            );
    
            if (matches.length === 0) {
              throw new Error(`Brush preset "${preset_name}" not found.`);
            }
            if (matches.length > 1) {
              throw new Error(
                `Brush preset name "${preset_name}" is ambiguous (${matches.length} presets share it). Delete duplicates or recreate the intended preset with a unique name.`
              );
            }
    
            const preset = matches[0];
            const hasPressure = ["size_pressure_curve", "softness_pressure_curve", "opacity_pressure_curve"]
              .some((field) => preset[field] != null);
            const tuna = (globalThis as unknown as { BrushTuna?: { brushPreset: unknown } }).BrushTuna;
            if (hasPressure && !tuna) {
              throw new Error("Brush Tuna must be active to load pressure curves; native presets alone ignore them.");
            }
            for (const field of ["size_pressure_curve", "softness_pressure_curve", "opacity_pressure_curve"]) {
              if (preset[field] != null) pressureCurveSchema.parse(preset[field]);
            }
            const alphaToggle = BarItems.lock_alpha as unknown as { set?: (value: boolean) => void } | undefined;
            if (typeof preset.lock_alpha === "boolean" && typeof alphaToggle?.set !== "function") {
              throw new Error("Native lock-alpha control is unavailable.");
            }
            // @ts-ignore
            Painter.loadBrushPreset(preset);
            if (hasPressure) tuna!.brushPreset = preset;
            if (typeof preset.lock_alpha === "boolean") alphaToggle!.set!(preset.lock_alpha);
    
            return `Loaded brush preset "${preset_name}"`;
          },
        },
        paintBrushToolDocs[3].status
      );
}
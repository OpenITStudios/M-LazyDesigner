/// <reference types="three" />
/// <reference types="blockbench-types" />

import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { createTextureParameters } from "./createSchema";
export { createTextureParameters, isDeterministicTextureSource } from "./createSchema";
import { resolveCoreTexture } from "@/lib/core/identity";
import {
  buildUvAtlasAudit,
  collectUvAtlasUsages,
  requireTextureCreationPreflight,
  textureInventoryEntry,
  textureProductionRole,
} from "../texture-atlas";
import { resolveTextureToolMaterial } from "./materialState";



export const createTextureToolDoc: ToolSpec = {
  name: "create_texture",
  description:
    "Creates a texture and returns compact metadata. Use get_texture only when image data is needed.",
  annotations: {
    title: "Create Texture",
    destructiveHint: true,
    openWorldHint: true,
  },
  parameters: createTextureParameters,
  status: STATUS_EXPERIMENTAL,
};

export async function runNativeTemplateEdit<T>(generate: () => Promise<void>, accept: () => T): Promise<T> {
  if (Undo.current_save) throw new Error("Finish the current edit before generating a template.");
  const project = Project;
  const saved = project.saved;
  const history = [...Undo.history];
  const index = Undo.index;
  const aspects = (): UndoAspects => ({ elements: [...Cube.all], textures: [...Texture.all], bitmap: true, uv_only: true, uv_mode: true, selected_texture: true, texture_order: true });
  Undo.initEdit(aspects());
  const before = Undo.current_save!;
  Undo.cancelEdit(false);
  try {
    await generate();
    const entry = Undo.history[Undo.index - 1];
    if (!entry || history.includes(entry)) throw new Error("Native template generation was cancelled before completion.");
    const result = accept();
    // Include the existing atlas in rebuild Undo, and any post-generation metadata.
    Undo.initEdit(aspects());
    entry.before = before;
    entry.post = Undo.current_save!;
    Undo.cancelEdit(false);
    return result;
  } catch (error) {
    Undo.initEdit(aspects());
    const current = Undo.current_save!;
    Undo.cancelEdit(false);
    Undo.loadSave(before, current);
    Undo.history.splice(0, Undo.history.length, ...history);
    Undo.index = index;
    project.saved = saved;
    Canvas.updateAll();
    throw error;
  } finally {
    if (Dialog.open?.id === "generate_template_progress") Dialog.open.hide();
    Blockbench.setProgress(0);
  }
}

export async function resizeMappedAtlas(base: Texture, width: number, height: number) {
  const textures = [...Texture.all];
  if (Undo.current_save) throw new Error("Finish the current edit before resizing an atlas.");
  for (const texture of textures) {
    if (texture.width !== base.width || texture.height !== base.height ||
        texture.getUVWidth() !== base.getUVWidth() || texture.getUVHeight() !== base.getUVHeight()) {
      throw new Error("Atlas resize requires matching bitmap and logical UV dimensions for every dependent texture.");
    }
    if (texture.layers_enabled || (texture.frameCount ?? 1) > 1) {
      throw new Error("Atlas resize requires flattened, non-animated textures.");
    }
  }
  if (textures.every(texture => texture.width === width && texture.height === height)) {
    throw new Error("Atlas already has the requested bitmap dimensions.");
  }
  const plans = textures.map(texture => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Atlas resize requires a 2D canvas context.");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(texture.canvas, 0, 0, width, height);
    return { texture, source: canvas.toDataURL("image/png"), uv: [texture.uv_width, texture.uv_height] };
  });
  Undo.initEdit({ textures, bitmap: true, uv_mode: true });
  try {
    for (const { texture, source, uv } of plans) {
      texture.updateSource(source);
      await texture.img.decode();
      texture.width = width;
      texture.height = height;
      [texture.uv_width, texture.uv_height] = uv;
    }
    Canvas.updateAll();
    Undo.finishEdit("Resize mapped atlas and variants");
    recordCurrentCapabilitySemanticHistoryEffect("create_texture");
  } catch (error) {
    Undo.cancelEdit();
    Canvas.updateAll();
    throw error;
  }
  return {
    content: [{ type: "text" as const, text: `Resized ${textures.length} mapped texture(s) to ${width}×${height}; UUIDs and logical UV layout preserved.` }],
    structuredContent: {
      texture: textureInventoryEntry(base),
      resized_textures: textures.map(textureInventoryEntry),
      rebuilt: true,
      template: { rearranged_uv: false, bitmap_resize: true },
    },
  };
}


export function registerCreateTextureTool(): void {
  createTool(createTextureToolDoc.name, {
      ...createTextureToolDoc,
      parameters: createTextureParameters,
      async execute({
        name,
        texture_id,
        type,
        width,
        height,
        pixel_density,
        rearrange_uv,
        power_of_two,
        keep_multi_texture_occupancy,
        padding,
        data,
        pbr_channel,
        fill_color,
        group,
        layer_name,
        render_mode,
        render_sides,
      }) {
        const textureGroup =
          group !== undefined ? resolveTextureToolMaterial(group) : undefined;
  
        const rebuildTexture = texture_id === undefined ? undefined : resolveCoreTexture(texture_id, "Use list_textures to identify the base atlas.");
        if (rebuildTexture) {
          const baseAtlases = Texture.all.filter(texture => textureProductionRole(texture) === "base_color_candidate");
          if (baseAtlases.length !== 1 || baseAtlases[0] !== rebuildTexture) {
            throw new Error("Template rebuild requires the single existing base-color atlas.");
          }
          if (type === "template" && !rearrange_uv) {
            if (group !== undefined || fill_color !== undefined || padding) {
              throw new Error("Mapped atlas resize preserves existing pixels and groups; omit group, fill_color and padding.");
            }
            return resizeMappedAtlas(rebuildTexture,
              Math.round(rebuildTexture.getUVWidth() * pixel_density / 16),
              Math.round(rebuildTexture.getUVHeight() * pixel_density / 16));
          }
          if (Texture.all.some(texture => texture !== rebuildTexture)) {
            throw new Error("Rebuild UV before adding variants or PBR channels; dependent atlases require matching remapping.");
          }
        } else requireTextureCreationPreflight({
          width,
          height,
          data,
          pbr_channel,
          textureGroup,
        });
  
        if (type === "template") {
          if (group !== undefined) {
            throw new Error(
              "Template mode creates the single base-color atlas; assign it to a material group after UV generation."
            );
          }
  
          const generator = (
            globalThis as typeof globalThis & {
              TextureGenerator?: {
                generateTemplate: (
                  options: Record<string, unknown>,
                  callback: (dataUrl: string) => Texture
                ) => Promise<void>;
              };
            }
          ).TextureGenerator;
          if (!generator?.generateTemplate) {
            throw new Error(
              "Blockbench TextureGenerator is unavailable. Reload BlockIT/Blockbench before creating a texture template."
            );
          }
  
          // The native callback route uses all visible elements for Bedrock's
          // single atlas; changing the user's selection is unnecessary.
          if (!Cube.all.some(cube => cube.visibility)) {
            throw new Error(
              "Template generation requires at least one visible Cube."
            );
          }
  
          const nativeColor = fill_color
            ? (globalThis as typeof globalThis & { tinycolor?: (value: unknown) => unknown })
              .tinycolor?.(
                Array.isArray(fill_color)
                  ? {
                    r: Number(fill_color[0]),
                    g: Number(fill_color[1]),
                    b: Number(fill_color[2]),
                    a: Number(fill_color[3] ?? 255) / 255,
                  }
                  : fill_color
              )
            : undefined;
  
          let templateTexture: Texture | undefined;
          return await runNativeTemplateEdit(async () => {
              await generator.generateTemplate({
                name,
                type: "template",
                resolution: pixel_density,
                color: nativeColor,
                rearrange_uv,
                power: power_of_two,
                double_use: keep_multi_texture_occupancy,
                padding,
                particle: "auto",
                texture: rebuildTexture ?? Texture.getDefault(),
              }, (dataUrl: string) => {
                  templateTexture = rebuildTexture
                    ? rebuildTexture.updateSource(dataUrl)
                    : new Texture({ name, keep_size: true }).fromDataURL(dataUrl).add(false).select();
                  return templateTexture;
              });
              if (templateTexture) await templateTexture.img.decode();
              Canvas.updateAll();
          }, () => {
          if (!templateTexture) {
            throw new Error("Blockbench did not return the generated texture template.");
          }
          const templateUvAudit = buildUvAtlasAudit(
            collectUvAtlasUsages(),
            templateTexture.getUVWidth(),
            templateTexture.getUVHeight()
          );
          if (
            templateUvAudit.state !== "available" ||
            templateUvAudit.invalid_uv.count > 0 ||
            templateUvAudit.out_of_bounds.count > 0 ||
            templateUvAudit.production_gate.state !== "ready"
          ) {
            throw new Error(
              `Native template generation finished without a valid UV atlas. The edit was rolled back; inspect the affected geometry/UV before retrying. Reasons: ${templateUvAudit.state === "available" ? templateUvAudit.production_gate.reasons.join(", ") : templateUvAudit.reason}`
            );
          }
          templateTexture.render_mode = render_mode;
          templateTexture.render_sides = render_sides;
          if (fill_color && layer_name) {
            templateTexture.activateLayers(false);
            templateTexture.getActiveLayer().name = layer_name;
          }
          Canvas.updateAll();
  
          const templateResult = {
            texture: {
              ...textureInventoryEntry(templateTexture),
              uuid: templateTexture.uuid,
            },
            template: {
              pixel_density,
              pixels_per_model_unit: pixel_density / 16,
              rearranged_uv: rearrange_uv,
              power_of_two: power_of_two,
              keep_multi_texture_occupancy,
              padding,
              uv_locked: true,
            },
            uv_audit: templateUvAudit,
            rebuilt: Boolean(rebuildTexture),
          };
          return {
            content: [
              {
                type: "text" as const,
                text: `Created texture template "${templateTexture.name}" (${templateTexture.uuid}) with native UV generation at ${pixel_density}x. Paint only after inspecting the returned UV/atlas evidence.`,
              },
            ],
            structuredContent: templateResult,
          };
          });
        }
  
        Undo.initEdit({
          textures: [],
          collections: [],
        });
  
        let texture!: Texture;
  
        try {
          texture = new Texture({
            name,
            width,
            height,
            group: textureGroup?.uuid,
            pbr_channel,
            render_mode,
            render_sides,
            internal: true,
          });
  
          if (data) {
            if (data.startsWith("data:image/")) {
              texture.source = data;
              texture.width = width;
              texture.height = height;
            } else {
              texture = texture.fromFile({
                name: data.split(/[\/\\]/).pop() || data,
                path: data.replace(/^file:\/\//, ""),
              });
            }
  
            texture.load();
            texture.fillParticle();
            texture.layers_enabled = false;
          } else {
            const { ctx } = texture.getActiveCanvas();
  
            if (
              ctx.canvas.width !== texture.width ||
              ctx.canvas.height !== texture.height
            ) {
              ctx.canvas.width = texture.width;
              ctx.canvas.height = texture.height;
            }
  
            if (fill_color) {
              const color = Array.isArray(fill_color)
                // @ts-ignore - tinycolor is available globally in Blockbench
                ? tinycolor({
                  r: Number(fill_color[0]),
                  g: Number(fill_color[1]),
                  b: Number(fill_color[2]),
                  a: Number(fill_color[3] ?? 255) / 255,
                })
                // @ts-ignore - tinycolor ok
                : tinycolor(fill_color);
  
              ctx.fillStyle = color.toRgbString().toLowerCase();
              ctx.fillRect(0, 0, texture.width, texture.height);
            } else {
              ctx.clearRect(0, 0, texture.width, texture.height);
            }
  
            texture.updateSource(ctx.canvas.toDataURL("image/png", 1));
            texture.updateLayerChanges(true);
          }
  
          texture.add();
  
          if (fill_color && layer_name) {
            texture.activateLayers(false);
            texture.getActiveLayer().name = layer_name;
          }
  
          Undo.finishEdit("Agent created texture", {
            textures: [texture],
            collections: [],
          });
          recordCurrentCapabilitySemanticHistoryEffect("create_texture");
        } catch (error) {
          if (texture) texture.remove(true);
          Undo.cancelEdit();
          Canvas.updateAll();
          throw error;
        }
  
        Canvas.updateAll();
  
        const result = {
          texture: {
            ...textureInventoryEntry(texture),
            uuid: texture.uuid,
          },
        };
        return {
          content: [
            {
              type: "text" as const,
              text: `Created texture "${texture.name}" (${texture.uuid}). Use get_texture only when image evidence is needed.`,
            },
          ],
          structuredContent: result,
        };
      },
    }, createTextureToolDoc.status);
}

/// <reference types="blockbench-types" />

import { z } from "zod";
import {
  getAllToolDefinitions,
  invalidateToolRegistrationRuntimeCaches,
} from "@/lib/factories";
import { resolveCoreTexture } from "@/lib/core/identity";
import { imageContent } from "@/lib/protocol/imageContent";
import {
  buildTextureEvidenceSnapshot,
  focusedGetTextureParameters,
} from "@/lib/texture/evidence";
import {
  buildTextureEvidenceDeliveryMetadata,
  requireStableTextureEvidenceIdentity,
  type TextureEvidenceSourceIdentity,
} from "@/lib/texture/evidenceDelivery";
import {
  createTextureVariantParameters,
  planTextureVariantFromBase,
  type TextureVariantSource,
} from "@/lib/texture/variantPlan";
import { textureIdSchema } from "@/lib/schemas/ids";
import {
  fullTextureRgba,
  requireUnchangedTextureBitmap,
  rgbaToPngDataUrl,
} from "@/lib/texture/bitmapRuntime";
import { createTextureParameters } from "../../tools/texture/createSchema";

export const wiredCreateTextureParameters = z.union([
  createTextureParameters,
  createTextureVariantParameters,
]);

type RuntimeToolDefinition = {
  inputSchema: Record<string, z.ZodType>;
  parameterSchema: z.ZodType;
  execute: (
    args: Record<string, unknown>,
    context?: unknown
  ) => Promise<unknown>;
};

let textureRuntimeContractsWired = false;

function requireRuntimeToolDefinition(name: string): RuntimeToolDefinition {
  const definitions = getAllToolDefinitions() as unknown as Record<
    string,
    RuntimeToolDefinition
  >;
  const definition = definitions[name];
  if (!definition) {
    throw new Error(
      `Cannot wire ${name}: its canonical runtime definition is unavailable.`
    );
  }
  return definition;
}

function textureGroupByReference(reference: string): TextureGroup {
  const groups = TextureGroup.all ?? [];
  const uuidMatch = groups.find((group) => group.uuid === reference);
  if (uuidMatch) return uuidMatch;

  const nameMatches = groups.filter((group) => group.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `TextureGroup name "${reference}" is ambiguous. Pass the TextureGroup UUID.`
    );
  }
  throw new Error(
    `TextureGroup "${reference}" was not found. Use add_texture_group first and pass its UUID or unique exact name.`
  );
}

function textureProductionRoleForVariant(texture: Texture): TextureVariantSource["role"] {
  const channel = texture.pbr_channel ?? "color";
  if (channel !== "color") return "pbr_support";
  if (!texture.group) return "base_color_candidate";
  const group = TextureGroup.all.find((candidate) => candidate.uuid === texture.group);
  return group?.is_material === false ? "explicit_variant" : "base_color_candidate";
}

function variantSource(texture: Texture): TextureVariantSource {
  return {
    uuid: texture.uuid,
    name: texture.name,
    width: texture.width,
    height: texture.height,
    role: textureProductionRoleForVariant(texture),
  };
}

async function createTextureVariant(request: z.infer<typeof createTextureVariantParameters>) {
  const source = resolveCoreTexture(
    request.source_texture_id,
    "Use list_textures to identify the single established base-color atlas."
  );
  const targetGroup = textureGroupByReference(request.group);
  const sources = Texture.all.map(variantSource);
  const plan = planTextureVariantFromBase({
    source: variantSource(source),
    base_color_candidates: sources.filter(
      (candidate) => candidate.role === "base_color_candidate"
    ),
    target_group: {
      uuid: targetGroup.uuid,
      name: targetGroup.name,
      is_material: targetGroup.is_material,
    },
    requested_name: request.name,
    existing_texture_names: Texture.all.map((texture) => texture.name),
  });

  Undo.initEdit({ textures: [], collections: [] });
  let variant: Texture | undefined;
  try {
    variant = new Texture({
      name: plan.requested_name,
      width: source.width,
      height: source.height,
      keep_size: true,
      group: targetGroup.uuid,
      pbr_channel: "color",
      render_mode: source.render_mode,
      render_sides: source.render_sides,
      wrap_mode: source.wrap_mode,
      frame_time: source.frame_time,
      frame_order_type: source.frame_order_type,
      frame_order: source.frame_order,
      frame_interpolate: source.frame_interpolate,
      internal: true,
    }).fromDataURL(source.getDataURL());

    variant.group = targetGroup.uuid;
    variant.pbr_channel = "color";
    variant.uv_width = source.uv_width;
    variant.uv_height = source.uv_height;
    variant.add(false, false);
    await variant.img.decode();

    Undo.finishEdit("Agent created texture variant", {
      textures: [variant],
      collections: [],
    });
  } catch (error) {
    variant?.remove(true);
    Undo.cancelEdit();
    Canvas.updateAll();
    throw error;
  }

  Canvas.updateAll();
  return {
    content: [
      {
        type: "text" as const,
        text: `Created explicit texture variant "${variant.name}" (${variant.uuid}) from base "${source.name}".`,
      },
    ],
    structuredContent: {
      texture: {
        uuid: variant.uuid,
        id: variant.id,
        name: variant.name,
        width: variant.width,
        height: variant.height,
        group: variant.group,
        pbr_channel: variant.pbr_channel,
      },
      variant_creation: plan,
    },
  };
}

function textureEvidenceSourceIdentity(
  texture: Texture
): TextureEvidenceSourceIdentity {
  return {
    uuid: texture.uuid,
    id: texture.id,
    name: texture.name,
    width: texture.width,
    height: texture.height,
    display_height: texture.display_height,
    uv_width: texture.getUVWidth(),
    uv_height: texture.getUVHeight(),
  };
}

async function getFocusedTextureEvidence(request: z.infer<typeof focusedGetTextureParameters>) {
  const available = Project?.textures ?? Texture.all;
  if (!request.texture && available.length > 1) {
    throw new Error(
      "Multiple textures are loaded. Pass texture explicitly so get_texture returns evidence for the intended atlas."
    );
  }
  const texture = request.texture
    ? resolveCoreTexture(
        request.texture,
        "Use list_textures to confirm the intended texture UUID or unique exact name."
      )
    : Texture.getDefault();
  if (!texture) {
    throw new Error("No texture is available. Use create_texture first.");
  }

  const bitmap = fullTextureRgba(texture);
  const sourceIdentity = textureEvidenceSourceIdentity(texture);
  const snapshot = await buildTextureEvidenceSnapshot(
    bitmap.pixels,
    bitmap.width,
    bitmap.height,
    {
      region: request.region,
      expected_revision: request.expected_revision,
    }
  );
  // Revision hashing above is asynchronous. Ensure the bitmap and frame/UV
  // metadata still belong to that exact decoded source before the PNG/result
  // can be presented as current evidence. Both checks are synchronous.
  requireStableTextureEvidenceIdentity(
    sourceIdentity,
    textureEvidenceSourceIdentity(texture)
  );
  requireUnchangedTextureBitmap(
    bitmap,
    fullTextureRgba(texture),
    "get_texture decoded bitmap changed during evidence readback. Refresh the full-bitmap revision and retry."
  );
  const metadata = buildTextureEvidenceDeliveryMetadata({
    inspection: snapshot.inspection,
    revision: snapshot.revision,
    bitmap: snapshot.bitmap,
    region: snapshot.region,
    display_height: sourceIdentity.display_height,
    source_byte_length: snapshot.byte_length,
    uv_width: sourceIdentity.uv_width,
    uv_height: sourceIdentity.uv_height,
  });
  const png = rgbaToPngDataUrl(
    snapshot.rgba,
    snapshot.region.width,
    snapshot.region.height
  );
  const image = imageContent(png, "image/png");

  return {
    ...image,
    structuredContent: {
      ...metadata,
      texture: sourceIdentity,
    },
  };
}

export function wireTextureRuntimeContracts(): void {
  if (textureRuntimeContractsWired) return;

  const createDefinition = requireRuntimeToolDefinition("create_texture");
  const originalCreate = createDefinition.execute.bind(createDefinition);
  createDefinition.parameterSchema = wiredCreateTextureParameters;
  createDefinition.inputSchema = {
    ...createDefinition.inputSchema,
    type: z
      .enum(["blank", "template", "variant"])
      .default("blank")
      .describe("Texture creation mode. variant duplicates the established base atlas into an explicit non-material group."),
    source_texture_id: textureIdSchema
      .optional()
      .describe("Required only when type=variant: established base-color texture UUID/ID/unique exact name."),
  };
  createDefinition.execute = async (args, context) => {
    if (args.type === "variant") {
      return createTextureVariant(
        createTextureVariantParameters.parse(args)
      );
    }
    return originalCreate(args, context);
  };

  const getDefinition = requireRuntimeToolDefinition("get_texture");
  getDefinition.parameterSchema = focusedGetTextureParameters;
  getDefinition.inputSchema = focusedGetTextureParameters.shape;
  getDefinition.execute = async (args) =>
    getFocusedTextureEvidence(focusedGetTextureParameters.parse(args));

  textureRuntimeContractsWired = true;
  invalidateToolRegistrationRuntimeCaches();
}
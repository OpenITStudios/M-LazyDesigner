/** Publication material translation contract for genuine MCP-authored Blockbench assets.
 * No Bedrock render-profile is inferred from a geometry face material slot,
 * an asset name, or a Blockbench editor-only texture render_mode.
 */
export type PublicationPbrSourceChannel = Readonly<{
  uuid: string;
  pbr_channel: string | null | undefined;
}>;

export type PublicationMaterialExpectation = Readonly<{
  alpha_mode: "OPAQUE";
  double_sided: true;
  metallic_factor: number;
  roughness_factor: number;
  emissive_factor: number;
  metallic_roughness_texture: boolean;
  normal_texture: boolean;
  emissive_texture: boolean;
  sampler: "NEAREST";
}>;

export type PublicationPbrPlan = Readonly<{
  color_uuid: string;
  mer_uuid: string | null;
  normal_uuid: string | null;
  uniform_mer: readonly [number, number, number] | null;
}>;

const VALID_CHANNELS = new Set(["color", "mer", "normal", "height"]);
const DEFAULT_METAL = 0;
const DEFAULT_ROUGHNESS = 0.85;

function finiteMer(values: unknown): [number, number, number] {
  if (!Array.isArray(values) || values.length !== 3 ||
      values.some(v => typeof v !== "number" ||
        !Number.isInteger(v) || v < 0 || v > 255)) {
    throw new Error("PUBLICATION_PBR_UNIFORM_MER_INVALID");
  }
  return [values[0], values[1], values[2]];
}

/** Allowed input modes are exactly the textures and uniform MER that this
 * Cycles bridge currently translates. No hidden dropped PBR channels.
 */
export function inspectPublicationPbrPlan(
  colorUuid: string,
  channels: readonly PublicationPbrSourceChannel[],
  configuration: {
    mer_value?: unknown;
    subsurface_value?: unknown;
  },
): PublicationPbrPlan {
  if (!colorUuid || channels.length === 0 || channels.length > 4) {
    throw new Error("PUBLICATION_PBR_CHANNEL_INVENTORY_INVALID");
  }
  const byRole = new Map<string, string>();
  const identities = new Set<string>();
  for (const channel of channels) {
    const role = channel.pbr_channel;
    if (!channel.uuid || !role || !VALID_CHANNELS.has(role)) {
      throw new Error("PUBLICATION_PBR_UNKNOWN_CHANNEL");
    }
    if (byRole.has(role) || identities.has(channel.uuid)) {
      throw new Error("PUBLICATION_PBR_CHANNEL_IDENTITY_DUPLICATE");
    }
    byRole.set(role, channel.uuid);
    identities.add(channel.uuid);
  }
  if (byRole.get("color") !== colorUuid) {
    throw new Error("PUBLICATION_PBR_COLOR_SOURCE_MISMATCH");
  }
  if (byRole.has("height")) {
    throw new Error("PUBLICATION_PBR_HEIGHT_CHANNEL_REQUIRES_EXPLICIT_BRIDGE");
  }
  // RenderDragon subsurface has no faithful mapping in the current glTF
  // standard-material bridge. Refuse authored nonzero subsurface instead of
  // silently delivering a false material.
  const subsurface = configuration.subsurface_value ?? 0;
  if (typeof subsurface !== "number" || !Number.isFinite(subsurface) ||
      !Number.isInteger(subsurface) || subsurface < 0 || subsurface > 255) {
    throw new Error("PUBLICATION_PBR_SUBSURFACE_CONFIG_INVALID");
  }
  if (subsurface > 0) {
    throw new Error("PUBLICATION_PBR_SUBSURFACE_UNSUPPORTED");
  }
  const merUuid = byRole.get("mer") ?? null;
  return {
    color_uuid: colorUuid,
    mer_uuid: merUuid,
    normal_uuid: byRole.get("normal") ?? null,
    uniform_mer: merUuid ? null : finiteMer(configuration.mer_value),
  };
}

/** This is expected glTF material serialization, not a shader quality score. */
export function expectedPublicationGltfMaterial(
  plan: PublicationPbrPlan | null,
): PublicationMaterialExpectation {
  if (!plan) {
    return {
      alpha_mode: "OPAQUE",
      double_sided: true,
      metallic_factor: DEFAULT_METAL,
      roughness_factor: DEFAULT_ROUGHNESS,
      emissive_factor: 0,
      metallic_roughness_texture: false,
      normal_texture: false,
      emissive_texture: false,
      sampler: "NEAREST",
    };
  }
  const merTexture = plan.mer_uuid !== null;
  const uniform = plan.uniform_mer;
  const emission = merTexture ? 1 : (uniform?.[1] ?? 0) / 255;
  return {
    alpha_mode: "OPAQUE",
    double_sided: true,
    metallic_factor: merTexture ? 1 : (uniform?.[0] ?? 0) / 255,
    roughness_factor: merTexture ? 1 : (uniform?.[2] ?? 0) / 255,
    emissive_factor: emission,
    metallic_roughness_texture: merTexture,
    normal_texture: plan.normal_uuid !== null,
    emissive_texture: merTexture || emission > 0,
    sampler: "NEAREST",
  };
}

/** Editor preview render_mode is not Minecraft Bedrock render_profile. We
 * cannot render arbitrary additive/layered/emissive previews as equivalent
 * to an authored material unless the actual material contract says so.
 */
export function requirePublicationTexturePreviewMode(
  textureUuid: string,
  renderMode: unknown,
): void {
  if (renderMode === undefined || renderMode === null ||
      renderMode === "default") return;
  throw new Error(
    "PUBLICATION_TEXTURE_PREVIEW_MODE_UNSUPPORTED: " + textureUuid +
    ". Blockbench render_mode=" + String(renderMode) +
    " is not an authored Bedrock material/render_profile.",
  );
}

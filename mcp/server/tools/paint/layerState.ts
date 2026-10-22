export type ManagedTextureLayer = TextureLayer & {
  width: number;
  height: number;
  offset?: [number, number];
  parent_uuid?: string;
};

/**
 * Direct exact-pixel painting must bind one authoritative native pixel-layer
 * identity. A layered texture with no active layer is NOT an unlayered bitmap
 * and may not fall back to the texture-only Undo path.
 */
export type ExactBrushLayerTarget =
  | { mode: "base_texture"; layer: null; layer_uuid: null }
  | { mode: "active_layer"; layer: TextureLayer; layer_uuid: string };

export function resolveExactBrushLayerTarget(
  texture: Texture
): ExactBrushLayerTarget {
  if (texture.layers_enabled !== true) {
    return { mode: "base_texture", layer: null, layer_uuid: null };
  }
  const layers = texture.layers;
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error(
      "Exact brush layered texture has no pixel layers; refusing texture-only Undo fallback."
    );
  }
  if (typeof texture.getActiveLayer !== "function") {
    throw new Error("Exact brush requires native active pixel-layer resolution.");
  }
  const layer = texture.getActiveLayer();
  if (!layer || !layers.includes(layer)) {
    throw new Error(
      "Exact brush active layer is missing or not owned by the target texture."
    );
  }
  if (texture.selected_layer && texture.selected_layer !== layer) {
    throw new Error(
      "Exact brush native active layer differs from the selected texture layer."
    );
  }
  const type = (layer as TextureLayer & { type?: string }).type;
  if (type !== undefined && type !== "pixel_layer") {
    throw new Error(
      "Exact brush requires a native pixel layer, not a layer group or unsupported layer kind."
    );
  }
  const uuid = layer.uuid;
  if (typeof uuid !== "string" || uuid.length === 0 ||
      layers.filter((item) => item.uuid === uuid).length !== 1) {
    throw new Error(
      "Exact brush active layer UUID is missing or ambiguous within the texture."
    );
  }
  return { mode: "active_layer", layer, layer_uuid: uuid };
}

/** Compare native object identity, not only UUID or the canvas offset/size. */
export function requireExactBrushLayerUnchanged(
  texture: Texture,
  expected: ExactBrushLayerTarget
): void {
  const current = resolveExactBrushLayerTarget(texture);
  if (
    current.mode !== expected.mode ||
    current.layer !== expected.layer ||
    current.layer_uuid !== expected.layer_uuid
  ) {
    throw new Error(
      "Exact brush active layer changed during native painting; refusing Undo completion."
    );
  }
}

export type LayerMetadataBatchUpdate = {
  layer_id: string;
  name?: string;
  opacity?: number;
  blend_mode?: TextureLayer["blend_mode"];
  target_index?: number;
};

/**
 * Blockbench 5.2 stores TextureLayerGroup and pixel layers in one ordered
 * texture.layers array. Raw flat-array edits cannot preserve nested parent
 * ordering or guarantee the rendered composite. Reject structural operations
 * until the native group round-trip contract has been accepted.
 */
export function requireFlatLayerStructure(texture: Texture, action: string): void {
  const hierarchical = texture.layers.some((layer) => {
    const item = layer as TextureLayer & {
      type?: string;
      parent_uuid?: string;
    };
    return Boolean(item.parent_uuid) ||
      (typeof item.type === "string" && item.type !== "pixel_layer");
  });
  if (hierarchical) {
    throw new Error(
      `texture_layer_management(${action}) requires a flat pixel-layer stack. ` +
      "Native Blockbench texture layer groups/parent links are present; " +
      "refusing to alter hierarchy or composite before native group acceptance."
    );
  }
}

export function resolveManagedTextureLayer(
  texture: Texture,
  reference: string
): ManagedTextureLayer {
  const layers = (texture.layers ?? []).filter(
    (layer): layer is ManagedTextureLayer => layer instanceof TextureLayer
  );
  const uuidMatch = layers.find((layer) => layer.uuid === reference);
  if (uuidMatch) return uuidMatch;

  const nameMatches = layers.filter((layer) => layer.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Texture layer name "${reference}" is ambiguous inside texture "${texture.name}". Pass the exact layer UUID.`
    );
  }
  throw new Error(
    `Texture layer "${reference}" was not found inside texture "${texture.name}".`
  );
}

export function layerContinuationState(
  texture: Texture,
  layer: ManagedTextureLayer
) {
  return {
    uuid: layer.uuid,
    name: layer.name,
    index: texture.layers.indexOf(layer),
    opacity: layer.opacity,
    blend_mode: layer.blend_mode,
    width: layer.width,
    height: layer.height,
    offset: Array.isArray(layer.offset) ? [...layer.offset] : null,
    parent_uuid: layer.parent_uuid || null,
  };
}

export function textureLayerContinuationState(texture: Texture) {
  return {
    uuid: texture.uuid,
    name: texture.name,
    layers_enabled: texture.layers_enabled === true,
    layer_count: texture.layers.length,
    selected_layer_uuid: texture.selected_layer?.uuid ?? null,
  };
}

function requireDistinctBatchLayerTargets(
  updates: readonly LayerMetadataBatchUpdate[]
): void {
  const seen = new Set<string>();
  for (const update of updates) {
    if (seen.has(update.layer_id)) {
      throw new Error(
        `batch_metadata contains duplicate layer target "${update.layer_id}". Combine metadata for one layer into one update.`
      );
    }
    seen.add(update.layer_id);
  }
}

export function preflightLayerMetadataBatch<
  TUpdate extends LayerMetadataBatchUpdate
>(
  texture: Texture,
  updates: readonly TUpdate[]
) {
  requireDistinctBatchLayerTargets(updates);
  if (updates.some((update) => update.target_index !== undefined)) {
    requireFlatLayerStructure(texture, "batch_metadata");
  }
  const resolved = updates.map((update) => ({
    update,
    layer: resolveManagedTextureLayer(texture, update.layer_id),
  }));

  for (const { update, layer } of resolved) {
    if (
      update.target_index !== undefined &&
      update.target_index >= texture.layers.length
    ) {
      throw new Error(
        `Target index ${update.target_index} is out of range for ${texture.layers.length} layers.`
      );
    }
    if (
      update.name === layer.name &&
      update.opacity === undefined &&
      update.blend_mode === undefined &&
      update.target_index === undefined
    ) {
      throw new Error(
        `Layer "${layer.name}" already has the requested name and no other metadata change was supplied.`
      );
    }
  }

  const finalNames = new Map(
    texture.layers.map((layer) => [layer.uuid, layer.name] as const)
  );
  for (const { update, layer } of resolved) {
    if (update.name !== undefined) finalNames.set(layer.uuid, update.name);
  }

  const nameOwners = new Map<string, string>();
  for (const [uuid, name] of finalNames) {
    const key = name.toLowerCase();
    const previous = nameOwners.get(key);
    if (previous && previous !== uuid) {
      throw new Error(
        `batch_metadata would create duplicate layer name "${name}" (case-insensitive).`
      );
    }
    nameOwners.set(key, uuid);
  }

  const previous = resolved.map(({ layer }) => ({
    layer_uuid: layer.uuid,
    state: layerContinuationState(texture, layer),
  }));

  const anyChange = resolved.some(
    ({ update, layer }) =>
      (update.name !== undefined && update.name !== layer.name) ||
      (update.opacity !== undefined && update.opacity !== layer.opacity) ||
      (update.blend_mode !== undefined &&
        update.blend_mode !== layer.blend_mode) ||
      (update.target_index !== undefined &&
        update.target_index !== texture.layers.indexOf(layer))
  );
  if (!anyChange) {
    throw new Error(
      "batch_metadata already matches the requested final layer metadata; no authored change is required."
    );
  }

  const visualChange = resolved.some(
    ({ update, layer }) =>
      (update.opacity !== undefined && update.opacity !== layer.opacity) ||
      (update.blend_mode !== undefined &&
        update.blend_mode !== layer.blend_mode) ||
      (update.target_index !== undefined &&
        update.target_index !== texture.layers.indexOf(layer))
  );
  const orderChange = resolved.some(
    ({ update, layer }) =>
      update.target_index !== undefined &&
      update.target_index !== texture.layers.indexOf(layer)
  );

  return { resolved, previous, visualChange, orderChange };
}


export type LayerMetadataBatchPlan<
  TUpdate extends LayerMetadataBatchUpdate = LayerMetadataBatchUpdate
> = ReturnType<typeof preflightLayerMetadataBatch<TUpdate>>;

/**
 * Apply only deterministic in-memory layer metadata/order changes.
 * Undo, bitmap recomposition, project sync, UI refresh, and receipts remain
 * executor-owned side effects.
 */
export function applyLayerMetadataBatchPlan<
  TUpdate extends LayerMetadataBatchUpdate
>(
  texture: Texture,
  plan: LayerMetadataBatchPlan<TUpdate>
): void {
  for (const { update, layer } of plan.resolved) {
    if (update.name !== undefined) layer.name = update.name;
    if (update.opacity !== undefined) layer.opacity = update.opacity;
    if (update.blend_mode !== undefined) {
      layer.blend_mode = update.blend_mode;
    }
  }

  for (const { update, layer } of plan.resolved) {
    if (update.target_index === undefined) continue;
    const currentIndex = texture.layers.indexOf(layer);
    if (currentIndex === update.target_index) continue;
    texture.layers.remove(layer);
    texture.layers.splice(update.target_index, 0, layer);
  }
}


export function requireLayerOpacityChange(
  layer: ManagedTextureLayer,
  opacity: number
): void {
  if (layer.opacity === opacity) {
    throw new Error(
      `Layer "${layer.name}" already has opacity ${opacity}%; no authored change is required.`
    );
  }
}

export function requireLayerBlendModeChange(
  layer: ManagedTextureLayer,
  blendMode: string
): void {
  if (layer.blend_mode === blendMode) {
    throw new Error(
      `Layer "${layer.name}" already uses blend mode ${blendMode}; no authored change is required.`
    );
  }
}

export function requireLayerMove(
  texture: Texture,
  layer: ManagedTextureLayer,
  targetIndex: number
): number {
  if (targetIndex >= texture.layers.length) {
    throw new Error(
      `Target index ${targetIndex} is out of range for ${texture.layers.length} layers.`
    );
  }
  const currentIndex = texture.layers.indexOf(layer);
  if (currentIndex === targetIndex) {
    throw new Error(
      `Layer "${layer.name}" is already at index ${targetIndex}; no authored change is required.`
    );
  }
  return currentIndex;
}

export function requireLayerRename(
  texture: Texture,
  layer: ManagedTextureLayer,
  nextName: string
): string {
  if (layer.name === nextName) {
    throw new Error(
      `Layer already has the exact name "${nextName}"; no authored change is required.`
    );
  }
  const collision = texture.layers.some(
    (candidate) =>
      candidate !== layer &&
      candidate.name.toLowerCase() === nextName.toLowerCase()
  );
  if (collision) {
    throw new Error(
      `Layer name "${nextName}" collides case-insensitively inside texture "${texture.name}".`
    );
  }
  return layer.name;
}

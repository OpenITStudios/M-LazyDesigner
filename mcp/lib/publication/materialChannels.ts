/**
 * Minecraft Bedrock MER -> glTF 2.0 metallic-roughness/emissive channels.
 * MER: R metalness, G emissive, B roughness; glTF: G roughness, B metalness.
 * Keep this pure and independently regression-tested.
 */
export function convertBedrockMerToGltf(
  color: Uint8ClampedArray,
  mer: Uint8ClampedArray,
): {
  metallicRoughness: Uint8ClampedArray;
  emission: Uint8ClampedArray;
} {
  if (color.length !== mer.length || color.length === 0 || color.length % 4 !== 0) {
    throw new Error("PUBLICATION_PBR_CHANNEL_DIMENSIONS_INVALID");
  }
  const metallicRoughness = new Uint8ClampedArray(mer.length);
  const emission = new Uint8ClampedArray(mer.length);
  for (let i = 0; i < mer.length; i += 4) {
    metallicRoughness[i] = 0;
    metallicRoughness[i + 1] = mer[i + 2]!;
    metallicRoughness[i + 2] = mer[i]!;
    metallicRoughness[i + 3] = 255;
    const amount = mer[i + 1]! / 255;
    emission[i] = Math.round(color[i]! * amount);
    emission[i + 1] = Math.round(color[i + 1]! * amount);
    emission[i + 2] = Math.round(color[i + 2]! * amount);
    emission[i + 3] = 255;
  }
  return { metallicRoughness, emission };
}

/**
 * Blockbench Bedrock preview applies normalScale.y = -1.
 * Bake the inverse green tangent normal channel for portable glTF.
 */
export function convertBedrockNormalToGltf(normal: Uint8ClampedArray): Uint8ClampedArray {
  if (normal.length === 0 || normal.length % 4 !== 0) {
    throw new Error("PUBLICATION_NORMAL_CHANNEL_INVALID");
  }
  const data = new Uint8ClampedArray(normal);
  for (let i = 1; i < data.length; i += 4) data[i] = 255 - data[i]!;
  return data;
}

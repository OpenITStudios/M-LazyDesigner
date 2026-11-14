// UI-only Paint atlas navigation. A new Rust session cannot inherit a
// texture index from the previous model, even if both have equal counts.
export function reconcilePaintTextureSelection(
  previousEpoch: number | null, nextEpoch: number,
  selectedIndex: number, textureCount: number,
): number {
  if (!Number.isSafeInteger(nextEpoch) || nextEpoch < 0 ||
      !Number.isSafeInteger(textureCount) || textureCount < 0 ||
      previousEpoch !== nextEpoch ||
      !Number.isSafeInteger(selectedIndex) || selectedIndex < 0 ||
      selectedIndex >= textureCount) return 0;
  return selectedIndex;
}

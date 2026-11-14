// Read-only GPU cache guard. A URI can recur after Paint/Undo/Redo, so
// identifying only the index and image source is insufficient.
export function isActiveTextureRequest(
  cache: ReadonlyMap<number, object>, index: number, request: object,
): boolean {
  return cache.get(index) === request;
}

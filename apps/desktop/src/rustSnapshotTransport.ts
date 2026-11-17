// WebView may reuse an existing immutable PNG payload only with a native
// content identity from the same epoch; never infer from element count.
import type { EditorSnapshot } from './rustEditorTypes';

export function reconcileTexturePreview(
  previous: EditorSnapshot | null, incoming: EditorSnapshot,
): EditorSnapshot {
  if (incoming.previewSourcesReused === true) {
    if (!previous || !previous.previewSourceKey ||
        previous.epoch !== incoming.epoch ||
        previous.previewSourceKey !== incoming.previewSourceKey ||
        incoming.texturePreviewSources.length !== 0 ||
        previous.texturePreviewSources.length !== incoming.textureNames.length) {
      throw new Error('RUST_EDITOR_PREVIEW_REUSE_STALE');
    }
    return { ...incoming, texturePreviewSources: previous.texturePreviewSources,
      previewSourcesReused: false };
  }
  if (incoming.texturePreviewSources.length !== incoming.textureNames.length) {
    throw new Error('RUST_EDITOR_PREVIEW_SOURCES_INCOMPLETE');
  }
  return incoming;
}

// WebView may reuse an existing immutable PNG payload only with a native
// content identity from the same epoch; never infer from element count.
import type { EditorSnapshot } from './rustEditorTypes';

/** A rejected IPC preview shortcut may follow an already-committed Rust edit.
 * It must be reconciled with a fresh, read-only full snapshot; never retry
 * the original mutation on this transport error.
 */
export function isPreviewTransportFailure(cause: unknown): boolean {
  return cause instanceof Error && (
    cause.message === 'RUST_EDITOR_PREVIEW_REUSE_STALE' ||
    cause.message === 'RUST_EDITOR_PREVIEW_SOURCES_INCOMPLETE'
  );
}

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

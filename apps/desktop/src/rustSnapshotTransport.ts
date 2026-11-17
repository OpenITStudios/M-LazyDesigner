// WebView may reuse an existing immutable PNG payload only with a native
// content identity from the same epoch; never infer from element count.
import type { EditorSnapshot } from './rustEditorTypes';

// These native operations all return the canonical Rust snapshot. A missing
// optional image identity means a normal full response; never request omitted
// PNG data for a command that has not opted into this transport contract.
const REUSE_COMMANDS = new Set([
  'rust_editor_apply', 'rust_editor_undo', 'rust_editor_redo',
  'rust_editor_add_cube', 'rust_editor_duplicate_cube',
  'rust_editor_add_bone', 'rust_editor_create_animation',
  'rust_editor_add_rotation_keyframe',
]);
export function canReusePreviewInCommand(name: string): boolean {
  return REUSE_COMMANDS.has(name);
}

/** A rejected IPC preview shortcut may follow an already-committed Rust edit.
 * It must be reconciled with a fresh, read-only full snapshot; never retry
 * the original mutation on this transport error.
 */
export function isPreviewTransportFailure(cause: unknown): boolean {
  return cause instanceof Error && (
    cause.message === 'RUST_EDITOR_PREVIEW_REUSE_STALE' ||
    cause.message === 'RUST_EDITOR_PREVIEW_SOURCES_INCOMPLETE' ||
    cause.message === 'RUST_EDITOR_SNAPSHOT_STALE'
  );
}

/** A completed IPC projection may arrive after a newer edit or model open.
 * This test compares authoritative epoch/revision only; it cannot grant
 * changes to authored data or infer that the file on disk is current. */
export function isOlderEditorSnapshot(
  current: EditorSnapshot | null, incoming: EditorSnapshot,
): boolean {
  return current !== null && (
    incoming.epoch < current.epoch ||
    (incoming.epoch === current.epoch && incoming.revision < current.revision)
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

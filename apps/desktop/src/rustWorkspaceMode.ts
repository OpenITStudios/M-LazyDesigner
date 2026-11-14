// UI-only mode navigation; neither mode owns a second model session.
export type WorkspaceMode = 'edit' | 'paint';

export function canChangeWorkspace(
  hasModel: boolean, busy: boolean, loading: boolean, paintStrokeActive: boolean,
): boolean {
  return hasModel && !busy && !loading && !paintStrokeActive;
}

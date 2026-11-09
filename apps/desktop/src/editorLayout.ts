// Presentation-only editor layout. Both companion side docks stay present
// (expanded or as shortcut rails); only explicit Focus Editor hides them.
// Neither dock creates/owns the Blockbench editor or persists model state.
export type EditorLayoutBand = 'wide' | 'standard' | 'rail' | 'compact';
export type EditorDock = 'projects' | 'tools';

export type EditorLayoutState = {
  band: EditorLayoutBand | null;
  projectsExpanded: boolean;
  diagnosticExpanded: boolean;
  focusMode: boolean;
  projectsWidth: number;
  toolsWidth: number;
};

export const INITIAL_EDITOR_LAYOUT: EditorLayoutState = {
  band: null,
  projectsExpanded: true,
  diagnosticExpanded: true,
  focusMode: false,
  projectsWidth: 220,
  toolsWidth: 260,
};

export function editorLayoutBand(width: number): EditorLayoutBand {
  if (width >= 1810) return 'wide';
  if (width >= 1320) return 'standard';
  if (width >= 920) return 'rail';
  return 'compact';
}

export function defaultEditorPanels(band: EditorLayoutBand) {
  // Only one companion dock remains. Keep it open whenever the 320px native
  // workspace minimum fits; the compact band uses its shortcut rail.
  return { projectsExpanded: false, diagnosticExpanded: band !== 'compact' };
}

export function editorDockWidth(dock: EditorDock, proposed: number): number {
  const min = dock === 'projects' ? 160 : 220;
  const max = dock === 'projects' ? 260 : 300;
  return Math.min(max, Math.max(min, Math.round(proposed)));
}

// A full dock must not crush the reserved original Blockbench region.
// On unusually narrow windows the shortcut rails offer Workspace/Support
// navigation instead of mounting an unusably thin native editor.
export const MIN_NATIVE_EXPANSION_WIDTH = 320;
export function canExpandEditorDock(
  editorWidth: number,
  dock: EditorDock,
  expandedDockWidth: number,
  otherRailWidth: number,
): boolean {
  if (!Number.isFinite(editorWidth) || editorWidth <= 0) return false;
  return editorWidth - editorDockWidth(dock, expandedDockWidth)
    - otherRailWidth - 6 >= MIN_NATIVE_EXPANSION_WIDTH;
}

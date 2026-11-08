// Presentation-only editor layout. Both companion side docks stay present
// (expanded or as shortcut rails); only explicit Focus Editor hides them.
// Neither dock creates/owns the Blockbench editor or persists model state.
export type EditorLayoutBand = 'wide' | 'standard' | 'rail' | 'compact';
export type EditorDock = 'projects' | 'tools';

export type EditorLayoutState = {
  band: EditorLayoutBand | null;
  projectsExpanded: boolean;
  assistantExpanded: boolean;
  focusMode: boolean;
  projectsWidth: number;
  toolsWidth: number;
};

export const INITIAL_EDITOR_LAYOUT: EditorLayoutState = {
  band: null,
  projectsExpanded: true,
  assistantExpanded: true,
  focusMode: false,
  projectsWidth: 220,
  toolsWidth: 240,
};

export function editorLayoutBand(width: number): EditorLayoutBand {
  if (width >= 1810) return 'wide';
  if (width >= 1320) return 'standard';
  if (width >= 920) return 'rail';
  return 'compact';
}

export function defaultEditorPanels(band: EditorLayoutBand) {
  const expanded = band === 'wide' || band === 'standard';
  return { projectsExpanded: expanded, assistantExpanded: expanded };
}

export function editorDockWidth(dock: EditorDock, proposed: number): number {
  const min = dock === 'projects' ? 160 : 220;
  const max = dock === 'projects' ? 260 : 300;
  return Math.min(max, Math.max(min, Math.round(proposed)));
}

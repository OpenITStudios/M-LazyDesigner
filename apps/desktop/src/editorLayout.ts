// Presentation-only editor layout. No native or persisted workspace ownership.
export type EditorLayoutBand = 'wide' | 'standard' | 'rail' | 'compact';
export type EditorDock = 'projects' | 'tools';

export type EditorLayoutState = {
  band: EditorLayoutBand | null;
  projectsVisible: boolean;
  toolsVisible: boolean;
  focusMode: boolean;
  railExpanded: boolean;
  restoreProjectsAfterTools: boolean;
  restoreRailAfterTools: boolean;
  projectsWidth: number;
  toolsWidth: number;
};

export const INITIAL_EDITOR_LAYOUT: EditorLayoutState = {
  band: null,
  projectsVisible: true,
  toolsVisible: false,
  focusMode: false,
  railExpanded: false,
  restoreProjectsAfterTools: false,
  restoreRailAfterTools: false,
  projectsWidth: 200,
  toolsWidth: 240,
};

export function editorLayoutBand(width: number): EditorLayoutBand {
  if (width >= 1810) return 'wide';
  if (width >= 1320) return 'standard';
  if (width >= 920) return 'rail';
  return 'compact';
}

export function defaultEditorPanels(band: EditorLayoutBand) {
  return {
    projectsVisible: band !== 'compact',
    toolsVisible: band === 'wide',
    railExpanded: false,
    restoreProjectsAfterTools: false,
    restoreRailAfterTools: false,
  };
}

export function editorDockWidth(dock: EditorDock, proposed: number): number {
  const min = dock === 'projects' ? 160 : 220;
  const max = dock === 'projects' ? 260 : 300;
  return Math.min(max, Math.max(min, Math.round(proposed)));
}

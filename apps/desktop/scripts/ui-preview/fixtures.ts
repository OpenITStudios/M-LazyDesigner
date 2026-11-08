import type { DevFixture } from '../../src/desktopFixtures';

// Only canonical production App.svelte development-fixture states are allowed.
export const PREVIEW_VIEWPORTS = {
  compact: { width: 1280, height: 760 },
  desktop: { width: 1600, height: 940 },
  large: { width: 1920, height: 1080 },
} as const;

export type PreviewViewport = keyof typeof PREVIEW_VIEWPORTS;

export const PREVIEW_SCENARIOS = [
  { id: 'editor-ready', label: 'Unified Editor · ready', fixture: 'ready', view: 'editor' },
  { id: 'editor-many-projects', label: 'Unified Editor · many projects', fixture: 'many-projects', view: 'editor' },
  { id: 'editor-status-unverified', label: 'Unified Editor · status unverified', fixture: 'status-unverified', view: 'editor' },
  { id: 'workspace-ready', label: 'Workspace · ready', fixture: 'ready', view: 'workspace' },
  { id: 'workspace-fresh-install', label: 'Workspace · first run', fixture: 'fresh-install', view: 'workspace' },
  { id: 'support-plugin-missing', label: 'Support · plugin missing', fixture: 'plugin-missing', view: 'support' },
  { id: 'analytics-ready', label: 'Analytics · synthetic', fixture: 'ready', view: 'analytics' },
] as const satisfies readonly {
  id: string;
  label: string;
  fixture: DevFixture;
  view: 'editor' | 'workspace' | 'support' | 'analytics';
}[];

export type PreviewScenario = (typeof PREVIEW_SCENARIOS)[number]['id'];

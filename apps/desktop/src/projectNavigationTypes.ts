export type ProjectNavigationModel = {
  id: string;
  name: string;
  active: boolean;
  open: boolean;
  dirty: boolean;
  exists: boolean;
};

export type ProjectNavigationFolder = {
  id: string;
  label: string;
  kind: 'models' | 'references' | 'textures' | 'exports';
};

export type ProjectNavigationProject = {
  id: string;
  name: string;
  active: boolean;
  pinned: boolean;
  registered: boolean;
  available: boolean;
  model_count: number;
  models: ProjectNavigationModel[];
  folders: ProjectNavigationFolder[];
};

export type ActiveProjectNavigation = {
  project_id: string | null;
  project_name: string | null;
  model_id: string | null;
  model_name: string;
  saved: boolean;
  dirty: boolean;
};

export type ProjectNavigation = {
  revision: string | null;
  session_live: boolean;
  continue_model_id: string | null;
  recent_model_ids: string[];
  preferences_issue: 'RECOVERABLE' | 'UNRECOVERABLE' | null;
  active: ActiveProjectNavigation | null;
  projects: ProjectNavigationProject[];
};

export type ProjectAction =
  | 'open-project-folder'
  | 'open-folder'
  | 'reveal-model'
  | 'pin-project'
  | 'unpin-project'
  | 'remove-project-folder'
  | 'restore-project-preferences';

/** Explorer-only actions: Rust resolves the opaque ID again before using the filesystem.
 * Project preference changes and model launch are deliberately excluded.
 */
export function isSafeFileNavigationAction(action: ProjectAction): boolean {
  return action === 'open-project-folder' || action === 'open-folder' || action === 'reveal-model';
}

/** One-time native confirmation; the client never supplies an arbitrary path to deletion. */
export type ProjectDeletePreview = {
  token: string;
  project_name: string;
  folder_path: string;
  expires_in_seconds: number;
};

export type ProjectDeleteResult = {
  status: 'RECYCLED' | 'RECYCLED_SHORTCUT_RETAINED';
  message: string;
};

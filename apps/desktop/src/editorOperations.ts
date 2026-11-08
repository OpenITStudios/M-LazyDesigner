import type { DesktopInvoke, BlockbenchFocusResult, BlockbenchEditorResult, ModelBrowseResult, ProjectNavigationActionResult } from './desktopTypes';

/** A native launch acknowledgement is not equivalent to verified model activation. */
export type ModelOpenFeedback = {
  verification: 'confirmed-active' | 'launched-unverified';
  message: string;
};

/** Launching Blockbench is distinct from foreground focus or opening a model. */
export type EditorOpenFeedback = {
  verification: 'focused' | 'launched-unverified';
  message: string;
};

/** Native editor operations never prepare AI, install components or own view state. */
export function createEditorOperations(invoke: DesktopInvoke) {
  async function focusBlockbenchAfterOpen(): Promise<boolean> {
    // Windows may deny foreground activation without invalidating the launch.
    try {
      const result = await invoke<BlockbenchFocusResult>('focus_blockbench_window');
      return result.status === 'FOCUSED';
    } catch {
      return false;
    }
  }

  return {
    focus: focusBlockbenchAfterOpen,
    async openModel(id?: string): Promise<ModelOpenFeedback | null> {
      const launch = id === undefined
        ? await invoke<ModelBrowseResult>('browse_model')
        : await invoke<ProjectNavigationActionResult>('project_navigation_action', { action: 'open-model', id });
      if (launch.status !== 'CONFIRMED_ACTIVE' && launch.status !== 'LAUNCHED_UNVERIFIED') {
        if (id === undefined) return null;
        throw new Error('Blockbench did not acknowledge the model launch request.');
      }
      const focused = await focusBlockbenchAfterOpen();
      if (launch.status === 'CONFIRMED_ACTIVE') {
        return {
          verification: 'confirmed-active',
          message: 'Model confirmed active in the matching Blockbench session.',
        };
      }
      return {
        verification: 'launched-unverified',
        message: focused
          ? 'Blockbench opened, but the model tab is not verified. Check the active model.'
          : 'Model launch sent, but the active tab is not verified. Select Blockbench and check the model.',
      };
    },
    async openEditor(): Promise<EditorOpenFeedback> {
      await invoke<BlockbenchEditorResult>('open_blockbench_editor');
      const focused = await focusBlockbenchAfterOpen();
      return {
        verification: focused ? 'focused' : 'launched-unverified',
        message: focused
          ? 'Blockbench is open.'
          : 'Blockbench launched. Select its window from the taskbar if needed.',
      };
    },
  };
}

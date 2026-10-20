import type { DesktopInvoke, BlockbenchFocusResult, BlockbenchEditorResult, ModelBrowseResult, ProjectNavigationActionResult } from './desktopTypes';

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
    async openModel(id?: string): Promise<string | null> {
      const launch = id === undefined
        ? await invoke<ModelBrowseResult>('browse_model')
        : await invoke<ProjectNavigationActionResult>('project_navigation_action', { action: 'open-model', id });
      if (launch.status !== 'CONFIRMED_ACTIVE' && launch.status !== 'LAUNCHED_UNVERIFIED') {
        if (id === undefined) return null;
        throw new Error('Blockbench did not acknowledge the model launch request.');
      }
      const focused = await focusBlockbenchAfterOpen();
      return launch.status === 'CONFIRMED_ACTIVE'
        ? 'Confirmed: the requested model is active in the matching Blockbench session.'
        : focused
          ? 'Editor launch confirmed; model tab not verified. Check Blockbench.'
          : 'Model launch sent; active tab not verified. Select Blockbench and check its model tab.';
    },
    async openEditor(): Promise<string> {
      await invoke<BlockbenchEditorResult>('open_blockbench_editor');
      const focused = await focusBlockbenchAfterOpen();
      return focused
        ? 'Blockbench is open.'
        : 'Blockbench launched. Select its window from the taskbar if needed.';
    },
  };
}

import type { DesktopInvoke, ManagedActionResult, ManagedUpdateCheck, SystemStatus } from './desktopTypes';
import { managedActionPresentation, type ManagedAction } from './desktopPresentation';

export type ManagedActionRequest =
  | { action: 'update'; expectedSourceSha: string }
  | { action: Exclude<ManagedAction, 'update'> };

/** Bind update execution to the source shown on screen; Rust revalidates it. */
export function planManagedAction(
  action: ManagedAction,
  status: SystemStatus,
  updateCheck: ManagedUpdateCheck | null,
): ManagedActionRequest | null {
  if (action !== 'update') return { action };
  const expectedSourceSha = updateCheck?.status === 'UPDATE_AVAILABLE' || updateCheck?.status === 'UPDATE_STAGED'
    ? updateCheck.available_source_sha : null;
  if (!expectedSourceSha || (status.managed?.pending && updateCheck?.status !== 'UPDATE_STAGED')) return null;
  return { action, expectedSourceSha };
}

/** One-shot discovery and receipt validation; no background updater or view state. */
export function createMaintenanceOperations(invoke: DesktopInvoke) {
  let updateCheckStarted = false;
  return {
    async checkUpdate(allowed: boolean): Promise<ManagedUpdateCheck | null | undefined> {
      if (!allowed || updateCheckStarted) return undefined;
      updateCheckStarted = true;
      try {
        return await invoke<ManagedUpdateCheck>('check_managed_update');
      } catch {
        // Advisory only: offline/restricted networks never block local use.
        return null;
      }
    },
    resetUpdateCheck() {
      updateCheckStarted = false;
    },
    async execute(request: ManagedActionRequest) {
      const result = await invoke<ManagedActionResult>('managed_action', {
        action: request.action,
        ...(request.action === 'update' ? { expectedSourceSha: request.expectedSourceSha } : {}),
      });
      return managedActionPresentation(request.action, result.receipt);
    },
  };
}

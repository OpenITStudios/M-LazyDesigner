import type { BootstrapActionResult, DesktopInvoke, EnsureReadyResult } from './desktopTypes';
import { bootstrapInstallPresentation, type BootstrapInstallFeedback } from './desktopPresentation';

type ReadinessHooks = {
  refresh: () => Promise<void>;
  onReadiness: (result: EnsureReadyResult) => void;
};

/** Preserve native setup ordering while the caller owns visible intermediate state. */
export function createSetupOperations(invoke: DesktopInvoke) {
  async function ensureReady(hooks: ReadinessHooks): Promise<EnsureReadyResult> {
    const result = await invoke<EnsureReadyResult>('ensure_ready');
    hooks.onReadiness(result);
    await hooks.refresh();
    return result;
  }

  return {
    connect: ensureReady,
    async install(hooks: ReadinessHooks & { onBootstrap: (feedback: BootstrapInstallFeedback) => void }, migrateLegacy = false) {
      const result = await invoke<BootstrapActionResult>('bootstrap_install', migrateLegacy ? { migrateLegacy: true } : undefined);
      const feedback = bootstrapInstallPresentation(result.receipt);
      hooks.onBootstrap(feedback);
      await hooks.refresh();
      if (!feedback.verifyRuntime) return { feedback, readiness: null };
      return { feedback, readiness: await ensureReady(hooks) };
    },
  };
}

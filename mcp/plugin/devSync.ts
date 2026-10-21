import { isRuntimeGenerationCurrent } from "@/lib/runtime/lifecycle";
import { getReloadableLazyDesignerPlugin } from "@/plugin/reload";

type LocalDevFileWatcher = { close(): void };
type LocalDevFilesystem = {
  watch(
    path: string,
    listener: (eventType?: string, filename?: string | Buffer) => void
  ): LocalDevFileWatcher;
  readFileSync(path: string, encoding: "utf8"): string;
};

let localDevFileWatcher: LocalDevFileWatcher | null = null;
let localDevReloadTimer: ReturnType<typeof setTimeout> | null = null;
let localDevReloadInProgress: Promise<void> | null = null;

function embeddedBuildIdentity(content: string): string | null {
  return (
    content.match(
      /globalThis\.__LAZYDESIGNER_BUILD_ID__\s*=\s*["'](sha256:[a-f0-9]{64})["']/
    )?.[1] ?? null
  );
}

function splitPluginPath(path: string): { directory: string; filename: string } {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return {
    directory: slash >= 0 ? path.slice(0, slash) || "." : ".",
    filename: slash >= 0 ? path.slice(slash + 1) : path,
  };
}

export function stopLocalDevAutoReload(): void {
  if (localDevReloadTimer) {
    clearTimeout(localDevReloadTimer);
    localDevReloadTimer = null;
  }
  // Drop ownership before invoking the native watcher: close() can throw
  // after a Blockbench update. Never leave a stale watcher blocking reload.
  const watcher = localDevFileWatcher;
  localDevFileWatcher = null;
  try {
    watcher?.close();
  } catch (error) {
    console.warn("[MCP] dev:sync watcher cleanup failed", error);
  }
}

export function setupLocalDevAutoReload(
  generation: number,
  runningBuildIdentity: string | null
): void {
  if (
    process.env.NODE_ENV !== "development" ||
    localDevFileWatcher ||
    !isRuntimeGenerationCurrent(generation)
  ) {
    return;
  }

  const plugin = getReloadableLazyDesignerPlugin();
  if (
    !plugin ||
    plugin.source !== "file" ||
    !plugin.path ||
    typeof plugin.reload !== "function" ||
    (typeof plugin.isReloadable === "function" && !plugin.isReloadable())
  ) {
    console.warn(
      "[MCP] dev:sync auto-reload requires LazyDesigner to be loaded as a reloadable file-based plugin."
    );
    return;
  }

  if (!runningBuildIdentity) {
    console.warn(
      "[MCP] dev:sync auto-reload disabled: current build_identity is unavailable."
    );
    return;
  }

  // @ts-ignore - requireNativeModule is a Blockbench desktop global.
  const devFs = requireNativeModule("fs", {
    message:
      "LazyDesigner development sync watches its local plugin directory for successful atomic rebuilds.",
    detail:
      "This is used only by development builds to reload the file-based LazyDesigner plugin automatically.",
    optional: true,
  }) as LocalDevFilesystem | null;
  if (!devFs) {
    console.warn(
      "[MCP] dev:sync auto-reload disabled: filesystem access was not granted."
    );
    return;
  }

  const { directory: watchDirectory, filename: pluginFilename } = splitPluginPath(
    plugin.path
  );

  const scheduleReload = () => {
    if (!isRuntimeGenerationCurrent(generation)) return;
    if (localDevReloadTimer) clearTimeout(localDevReloadTimer);
    localDevReloadTimer = setTimeout(() => {
      localDevReloadTimer = null;
      if (
        localDevReloadInProgress ||
        !isRuntimeGenerationCurrent(generation)
      ) {
        return;
      }

      let nextContent: string;
      try {
        nextContent = devFs.readFileSync(plugin.path!, "utf8");
      } catch (error) {
        console.warn("[MCP] dev:sync could not read the updated plugin file", error);
        return;
      }

      const nextBuildIdentity = embeddedBuildIdentity(nextContent);
      if (!nextBuildIdentity || nextBuildIdentity === runningBuildIdentity) return;

      localDevReloadInProgress = Promise.resolve()
        .then(() => {
          if (!isRuntimeGenerationCurrent(generation)) return;
          console.log(
            `[MCP] Development bundle changed ${runningBuildIdentity} → ${nextBuildIdentity}; reloading LazyDesigner through native plugin lifecycle.`
          );
          plugin.reload?.();
        })
        .catch((error) => {
          console.error("[MCP] Automatic development plugin reload failed", error);
          Blockbench.showQuickMessage(
            "LazyDesigner dev sync could not reload automatically; use the plugin Reload action once.",
            5000
          );
        })
        .finally(() => {
          localDevReloadInProgress = null;
        });
    }, 250);
  };

  try {
    localDevFileWatcher = devFs.watch(
      watchDirectory,
      (_eventType, changedFilename) => {
        if (changedFilename !== undefined) {
          const changed = String(changedFilename)
            .replace(/\\/g, "/")
            .split("/")
            .pop();
          if (changed && changed !== pluginFilename) return;
        }
        scheduleReload();
      }
    );
    console.log(`[MCP] dev:sync auto-reload watching ${watchDirectory}`);
    scheduleReload();
  } catch (error) {
    console.warn("[MCP] dev:sync auto-reload watcher could not start", error);
  }
}
import { describe, expect, test } from "bun:test";

const source = (relative: string) =>
  Bun.file(new URL(`../${relative}`, import.meta.url)).text();

describe("human-facing Blockbench UI", () => {
  test("managed update notice distinguishes staged, applied, missing, and invalid receipts", async () => {
    const { managedActionPresentation } = await import("../../apps/desktop/src/desktopPresentation");
    const staged = managedActionPresentation("update", { status: "STAGED" });
    expect(staged.kind).toBe("pending");
    expect(staged.message).toContain("not installed");
    expect(staged.message).toContain("Close Blockbench");

    const installed = managedActionPresentation("update", { status: "INSTALLED" });
    expect(installed.kind).toBe("success");
    const noChange = managedActionPresentation("update", { status: "NO_PENDING_UPDATE" });
    expect(noChange.kind).toBe("unchanged");
    expect(managedActionPresentation("repair", { status: "REPAIRED" }).kind).toBe("success");
    expect(managedActionPresentation("setup-tls", { status: "TLS_READY" }).kind).toBe("success");
    expect(() => managedActionPresentation("update", { status: "UNKNOWN" })).toThrow("Unexpected managed");
    expect(() => managedActionPresentation("update", {})).toThrow("no verified status");

    const app = await Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text();
    const operations = await Bun.file(new URL("../../apps/desktop/src/maintenanceOperations.ts", import.meta.url)).text();
    expect(operations).toContain("managedActionPresentation(request.action, result.receipt)");
    expect(app).toContain("maintenanceOperations.execute(request)");
    expect(app).toContain("actionMessageKind === 'pending' ? 'Next step'");
    expect(app).toContain("operation.outcome === 'unchanged' ? 'No change'");
  });

  test("late-mounted plugin panels never default to false Runtime-ready status", async () => {
    const [ui, bar] = await Promise.all([source("ui/index.ts"), source("ui/statusBar.ts")]);
    expect(bar).toContain("export function getStatusBarState()");
    expect(bar).toContain("state: currentStatus.state");
    expect(bar).toContain('detail: currentStatus.detail ?? ""');
    expect(ui).toContain("runtime: getStatusBarState()");
    expect(ui).toContain("const current = getStatusBarState()");
    expect(ui).toContain("vm.runtime.state = current.state");
    expect(ui).not.toContain('state: "running" as McpServerStatus');
  });

  test("Desktop UI labels versions and actions without presenting a fake menu", async () => {
    const app = await Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text();
    expect(app).toContain("import { version as desktopVersion } from '../package.json'");
    expect(app).toContain("<strong>{desktopVersion}</strong>");
    expect(app).toContain("LazyDesigner Desktop version");
    expect(app).not.toContain("<strong>0.1.0</strong>");
    expect(app).toContain("async function showPluginFile()");
    expect(app).toContain("'show_plugin_file'");
    expect(app).toContain("onclick={showPluginFile}");
    expect(app).toContain("Show approval file");
    expect(app).not.toContain('aria-label="Blockbench actions"');
  });

  test("normal panel exposes only human status and useful project actions", async () => {
    const panel = await source("ui/panel.html");

    expect(panel).toContain("LazyDesigner status");
    expect(panel).toContain("Current project");
    expect(panel).toContain("Open Project Folder");
    expect(panel).toContain("Technical authoring runs through your connected AI client.");

    for (const internal of [
      "Advanced details",
      "Tools",
      "Resources",
      "Workflow",
      "Runtime endpoint",
      "Tool catalog",
      "Coming soon",
    ]) {
      expect(panel).not.toContain(internal);
    }
  });

  test("status wording stays simple and actionable", async () => {
    const [ui, statusBar] = await Promise.all([
      source("ui/index.ts"),
      source("ui/statusBar.ts"),
    ]);

    expect(ui).toContain('return "Runtime ready"');
    expect(ui).toContain('return "Starting"');
    expect(ui).toContain('return "Needs attention"');
    expect(ui).toContain('return "Local Runtime is ready. AI client connection is managed separately."');
    expect(ui).toContain('return "AI authoring is not available right now."');

    expect(statusBar).toContain('return "LazyDesigner Runtime Ready"');
    expect(statusBar).toContain('return "LazyDesigner Needs Attention"');
    expect(statusBar).not.toContain("runtimeAddress");
    expect(statusBar).not.toContain("127.0.0.1");
  });

  test("project display is event-driven and folder access reuses Blockbench native action", async () => {
    const ui = await source("ui/index.ts");

    for (const event of [
      "select_project",
      "new_project",
      "setup_project",
      "load_project",
      "save_project",
      "close_project",
    ]) {
      expect(ui).toContain(`"${event}"`);
    }
    expect(ui).toContain("Blockbench.on(event, callback)");
    expect(ui).toContain("Blockbench.removeListener(event, callback)");
    expect(ui).toContain("open_model_folder");
    expect(ui).not.toContain("setInterval(");
  });

  test("recovery actions are contextual and copied support details avoid local paths", async () => {
    const [panel, ui, reload] = await Promise.all([
      source("ui/panel.html"),
      source("ui/index.ts"),
      source("plugin/reload.ts"),
    ]);

    expect(panel).toContain("runtime.state === 'failed'");
    expect(panel).toContain("Reload LazyDesigner");
    expect(panel).toContain("Copy Error Details");
    expect(ui).toContain("reloadLazyDesignerPlugin()");
    expect(ui).toContain("LazyDesigner support details");
    expect(ui).not.toContain("Project.save_path}");
    expect(ui).not.toContain("Project.export_path}");
    expect(reload).toContain("canReloadLazyDesignerPlugin");
    expect(reload).toContain("reloadLazyDesignerPlugin");
  });

  test("dev auto-reload and human reload share one native plugin owner", async () => {
    const [devSync, reload] = await Promise.all([
      source("plugin/devSync.ts"),
      source("plugin/reload.ts"),
    ]);

    expect(devSync).toContain("getReloadableLazyDesignerPlugin");
    expect(devSync).not.toContain("function getReloadableBlockItPlugin");
    expect(reload).toContain("plugin.reload()");
  });

  test("normal plugin metadata keeps creator credentials anonymous", async () => {
    const plugin = await source("index.ts");

    expect(plugin).toContain('title: "LazyDesigner"');
    expect(plugin).toContain('author: "Anonymous"');
    expect(plugin).toContain('repository: ""');
    expect(plugin).toContain('bug_tracker: ""');

    expect(plugin).not.toContain("@author");
    expect(plugin).not.toContain("@discord");
    expect(plugin).not.toContain("@github");
    expect(plugin).not.toContain("compatibility surface switched");
    expect(plugin).not.toContain("MCP phase switched");
  });

  test("rare manual settings are clearly marked advanced or developer-only", async () => {
    const settings = await source("ui/settings.ts");

    expect(settings).toContain("Connection Port (Advanced)");
    expect(settings).toContain("Connection Path (Advanced)");
    expect(settings).toContain("Startup Focus (Advanced)");
    expect(settings).toContain("Legacy Compatibility (Developer)");
    expect(settings).toContain("Leave this at the default for normal use.");
    expect(settings).toContain("Leave this off for normal use.");
  });

  test("panel mounts before the network permission gate", async () => {
    const [entry, status, css, panel] = await Promise.all([
      source("index.ts"), source("ui/statusBar.ts"), source("ui/panel.css"), source("ui/index.ts"),
    ]);
    expect(entry).toContain("blockbenchIntegration.setupUi(registrationProfile, authoringStage)");
    expect(entry.indexOf("blockbenchIntegration.setupUi(registrationProfile, authoringStage)"))
      .toBeLessThan(entry.indexOf("runtimeHost.acquireNativeNetwork(generation)"));
    expect(entry).toContain('setStatusBarState("failed"');
    expect(status).toContain('document.createElement("button")');
    expect(status).toContain('state: "starting"');
    expect(css).not.toContain("nth-last-child");
    expect(panel).not.toContain("pluginBrowserSetup");
  });

  test("Desktop connection comparison preserves unknown Gateway observations", async () => {
    // MCP compilation is rootDir=mcp; do not import Desktop TypeScript into this package.
    const comparison = await Bun.file(new URL("../../apps/desktop/src/connectionWatch.ts", import.meta.url)).text();
    expect(comparison).toContain("candidate.gateway_active !== null && current.managed !== null");
    expect(comparison).toContain("candidate.project_revision !== current.project_navigation.revision");
    expect(comparison).toContain("candidate.runtime_listener_live !== current.runtime_listener_live");
  });

  test("Desktop guards overlapping probes and signals stale state", async () => {
    const app = await Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text();
    const monitor = await Bun.file(new URL("../../apps/desktop/src/connectionMonitor.ts", import.meta.url)).text();
    expect(monitor).toContain("inFlight");
    expect(app).toContain("statusProbeFailures >= 2");
    expect(monitor).toContain("connectionChanged(candidate, current)");
  });
});

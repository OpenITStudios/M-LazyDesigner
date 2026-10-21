import { describe, expect, test } from "bun:test";

const source = (relative: string) =>
  Bun.file(new URL(`../${relative}`, import.meta.url)).text();

describe("human-facing Blockbench UI", () => {

  test("project-list selectors retain search, first-match, continue and recent order semantics", async () => {
    const { visibleProjects, visibleProjectModels, recentModelTargets, continueTarget } =
      await import("../../apps/desktop/src/desktopPresentation");
    const makeModel = (id: string, name: string, exists = true, active = false) =>
      ({ id, name, exists, active, open: false, dirty: false });
    const makeProject = (id: string, name: string, models: ReturnType<typeof makeModel>[]) =>
      ({ id, name, models, active: false, pinned: false, registered: true,
        available: true, model_count: models.length, folders: [] });
    const alpha = makeProject("alpha", "Alpha", [
      makeModel("shared", "Old copy", false),
      makeModel("draft", "Draft", true, true),
      makeModel("continue", "Continue"),
      makeModel("stay", "Stone"),
    ]);
    const studio = makeProject("studio", "Studio", [
      makeModel("shared", "Shared"),
      makeModel("needle", "Needle model"),
    ]);
    const state = {
      revision: null, session_live: false, continue_model_id: "continue",
      recent_model_ids: ["shared", "draft", "continue", "needle", "stay", "missing"],
      preferences_issue: null, active: null, projects: [alpha, studio],
    } satisfies import("../../apps/desktop/src/projectNavigationTypes").ProjectNavigation;

    expect(visibleProjects(state, "STUDIO", false).map(p => p.id)).toEqual(["studio"]);
    expect(visibleProjects(state, "NEEDLE", false).map(p => p.id)).toEqual(["studio"]);
    expect(visibleProjectModels(studio, "studio").map(m => m.id)).toEqual(["shared", "needle"]);
    expect(visibleProjectModels(studio, "needle").map(m => m.id)).toEqual(["needle"]);
    expect(visibleProjectModels(studio, "missing")).toEqual([]);

    const seven = Array.from({ length: 7 }, (_, n) => makeProject(String(n), `Item ${n}`, []));
    expect(visibleProjects({ ...state, projects: seven }, "", false)).toHaveLength(6);
    expect(visibleProjects({ ...state, projects: seven }, "", true)).toHaveLength(7);
    expect(visibleProjects({ ...state, projects: seven }, "ITEM 6", false).map(p => p.id)).toEqual(["6"]);

    expect(recentModelTargets(state).map(t => [t.project.id, t.model.id])).toEqual([
      ["studio", "shared"], ["studio", "needle"], ["alpha", "stay"],
    ]);
    expect(recentModelTargets({ ...state, recent_model_ids: [] })).toEqual([]);
    expect(continueTarget(state)?.model.id).toBe("continue");
    expect(continueTarget({ ...state, active: {
      project_id: "alpha", project_name: "Alpha", model_id: "continue",
      model_name: "Continue", saved: true, dirty: false,
    } })).toBeNull();
  });

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
    const support = await Bun.file(new URL("../../apps/desktop/src/SupportPage.svelte", import.meta.url)).text();
    expect(support).toContain("operation.outcome === 'unchanged' ? 'No change'");
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
    const support = await Bun.file(new URL("../../apps/desktop/src/SupportPage.svelte", import.meta.url)).text();
    expect(app).toContain("<SupportPage");
    expect(support).toContain("import { version as desktopVersion } from '../package.json'");
    expect(support).toContain("<strong>{desktopVersion}</strong>");
    expect(support).toContain("LazyDesigner Desktop version");
    expect(support).not.toContain("<strong>0.1.0</strong>");
    expect(app).toContain("async function showPluginFile()");
    expect(app).toContain("'show_plugin_file'");
    const workspace = await Bun.file(new URL("../../apps/desktop/src/WorkspacePage.svelte", import.meta.url)).text();
    expect(workspace).toContain("onclick={showPluginFile}");
    expect(workspace).toContain("Show approval file");
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
});

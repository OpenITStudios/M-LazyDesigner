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

  test("Desktop visual fixtures render offline and separate Analytics from native commands", async () => {
    const { createDevFixtureStatus, createDevAnalyticsFixture, devFixtureFromLocation } =
      await import("../../apps/desktop/src/desktopFixtures");

    expect(createDevFixtureStatus("fresh-install").product_state).toBe("welcome");
    expect(createDevFixtureStatus("fresh-install").project_navigation.projects).toHaveLength(0);
    expect(createDevFixtureStatus("ready").product_state).toBe("ready");
    expect(createDevFixtureStatus("ready").project_navigation.projects).toHaveLength(1);
    const noActive = createDevFixtureStatus("ready-no-active");
    expect(noActive.product_state).toBe("ready");
    expect(noActive.project_navigation.active).toBeNull();
    expect(noActive.project_navigation.continue_model_id).toBeNull();
    expect(noActive.project_navigation.projects).toHaveLength(1);
    expect(noActive.project_navigation.projects[0].models.every(model => !model.active)).toBe(true);
    expect(createDevFixtureStatus("status-unverified").product_state).toBe("ready");
    expect(createDevFixtureStatus("plugin-modified").plugin_integrity).toBe("modified");
    expect(createDevFixtureStatus("unsupported").blockbench.compatibility?.status).toBe("unsupported");
    expect(createDevAnalyticsFixture().state).toBe("PARTIAL");
    expect(createDevAnalyticsFixture().projects).toHaveLength(1);
    expect(devFixtureFromLocation(false, "?fixture=ready")).toBeNull();
    expect(devFixtureFromLocation(true, "?fixture=ready")).toBe("ready");
    expect(devFixtureFromLocation(true, "?fixture=ready-no-active")).toBe("ready-no-active");
    expect(devFixtureFromLocation(true, "?fixture=status-unverified")).toBe("status-unverified");

    const [app, support, analytics] = await Promise.all([
      Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/SupportPage.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/AnalyticsPage.svelte", import.meta.url)).text(),
    ]);
    expect(app).toContain("status = createDevFixtureStatus(devFixture)");
    expect(app).toContain("devFixture ? createDevAnalyticsFixture()");
    expect(app).toContain("const stopProgressListener = devFixture ? () => {} : subscribeManagedProgress(");
    expect(app).not.toContain("applyDevFixture(status, devFixture)");
    expect(app).toContain("migrateLegacySetup={() => performInstall(true)}");
    expect(support).toContain("{#if error}");
    expect(support).toContain("{#if errorDetail}");
    expect(analytics).toContain("Back to Support");
    expect(app).toContain("backToSupport={() => navigate('Support')}");
    expect(app).toContain('data-qa-fixture={devFixture ?? undefined}');
    expect(app).toContain("if (view === 'support') page = 'Support'");
    expect(app).toContain("else if (view === 'analytics')");
    expect(app).toContain("document.querySelector<HTMLElement>('.page-toolbar h1')?.focus()");
    expect(app).toContain('<h1 tabindex="-1">');
    const capture = await Bun.file(new URL("../../apps/desktop/scripts/capture-ui.py", import.meta.url)).text();
    expect(capture).toContain('nativeOrVisualApproval');
    expect(capture).toContain('("fresh-install", "workspace")');
    expect(capture).toContain('("ready", "analytics")');
    expect(capture).toContain('("ready-no-active", "workspace")');
    expect(capture).toContain('("status-unverified", "workspace")');
    expect(capture).toContain('("status-unverified", "support")');
    expect(capture).toContain("def inspect_action_states(page, fixture, view):");
    expect(capture).toContain('"Go to Blockbench for Modern Chair": False');
    expect(capture).toContain('"Open Model…": True');
    expect(capture).toContain('"Choose…": False');
    expect(capture).toContain('VIEWPORTS = ((780, 560), (980, 680))');
  });


  test("Workspace blocks stale project decisions without blocking direct model browsing", async () => {
    const [app, workspace, navigator, deleteDialog, pluginDoc, support] = await Promise.all([
      Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/WorkspacePage.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/ProjectNavigator.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/ProjectDeleteDialog.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../docs/05-operations/blockbench-plugin-ui.md", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/SupportPage.svelte", import.meta.url)).text(),
    ]);
    expect(workspace).toContain("canOpenModel={statusProbeFailures < 2}");
    expect(workspace).toContain("canEditProjectPrefs={statusProbeFailures < 2}");
    expect(workspace).toContain("busy={busyAction !== null || statusProbeFailures >= 2}");
    expect(workspace).toContain("{#if !status.project_navigation.active}");
    expect(workspace).toContain("Open Blockbench</button>");
    expect(workspace).toContain('onclick={() => openModel()} disabled={busyAction !== null}');
    expect(app).toContain("(id !== undefined && statusProbeFailures >= 2)");
    expect(app).toContain("async function runProjectAction(action: ProjectAction, id: string) {\n    if (devFixture || busyAction || statusProbeFailures >= 2) return;");
    expect(app).toContain("async function confirmDeleteProject() {\n    if (devFixture || busyAction || !deleteReview || statusProbeFailures >= 2) return;");
    expect(app).toContain("confirmBlocked={statusProbeFailures >= 2}");
    expect(app).toContain("if (devFixture === 'status-unverified') statusProbeFailures = 2;");
    expect(deleteDialog).toContain("disabled={busy || confirmBlocked}");
    expect(deleteDialog).toContain("onclick={onCancel} disabled={busy}");
    expect(support).toContain("onclick={migrateLegacySetup} disabled={busyAction !== null || status.manager_available || statusProbeFailures >= 2}");
    expect(support).toContain("onclick={chooseBlockbenchExecutable} disabled={busyAction !== null || statusProbeFailures >= 2}");
    expect(support).toContain("onclick={exportDiagnostics} disabled={busyAction !== null}");
    expect(navigator).toContain('aria-label={`Open model ${model.name}`}');
    expect(navigator).toContain('aria-label={`Open folder for project ${project.name}`}');
    expect(pluginDoc).toContain("No empty Texture or Animation tabs");
    expect(pluginDoc).not.toContain("Keep exactly three navigation categories");
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

  test("human panel exposes actionable Geometry tools without empty tabs and preserves review on save", async () => {
    const [panel, ui] = await Promise.all([source("ui/panel.html"), source("ui/index.ts")]);

    expect(panel).toContain('aria-label="Geometry tools"');
    expect(panel).toContain("Review Latest Edit");
    expect(panel).toContain("Find Geometry Issues");
    expect(panel).toContain("Safe Cube Cleanup");
    expect(panel).toContain("Locate in Outliner");
    expect(panel).toContain('v-else-if="!project.isBedrock"');
    expect(panel).not.toContain('role="tablist"');
    expect(panel).not.toContain("Coming soon");
    expect(panel).not.toContain("Tool catalog");
    expect(ui).toContain('isBedrock: Project.format?.id === "bedrock"');
    expect(ui).toContain('event === "save_project" ||');
    expect(ui).toContain("runRuntimeOperationExclusive(generation");
    expect(ui).not.toContain("activeCategory");
    expect(ui).not.toContain("setActiveMcpAuthoringStage(");
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
    expect(ui).toContain("Blockbench.on(event, listener)");
    expect(ui).toContain("Blockbench.removeListener(event, listener)");
    expect(ui).toContain('event === "update_selection"');
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
    expect(panel).toContain('@click="reloadLazyDesigner"');
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

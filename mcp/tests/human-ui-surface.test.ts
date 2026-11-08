import { describe, expect, test } from "bun:test";

const source = (relative: string) =>
  Bun.file(new URL(`../${relative}`, import.meta.url)).text();

describe("human-facing Blockbench UI", () => {

  test("stale project actions explain their disabled state without blocking safe file access", async () => {
    const [workspace, navigator, app, support] = await Promise.all([
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/SupportPage.svelte"),
    ]);
    expect(workspace).toContain("statusUnverified={statusProbeFailures >= 2}");
    expect(navigator).toContain('id="ld-project-action-note"');
    expect(navigator).toContain("Refresh required for project changes.");
    expect(navigator).toContain("You can still open models and folders.");
    expect(navigator).toContain("aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined}");
    expect(navigator).toContain("disabled={busy || !canEditProjectPrefs}>Add Project Folder</button>");
    expect(navigator).toContain("disabled={!project.available || busy}>Open Folder</button>");
    expect(navigator).toContain("disabled={!model.exists || busy || !canOpenModel}>Open</button>");
    expect(app).toContain("statusProbeFailures >= 2 && !isSafeFileNavigationAction(action)");
    expect(workspace).toContain("updateCheck?.status === 'UPDATE_STAGED_UNVERIFIED'");
    expect(workspace).toContain("Staged package unverified");
    expect(support).toContain('aria-label="Last unsuccessful action"');
    expect(support).toContain("<h2>{errorTitle}</h2>");
    expect(app).toContain("{errorTitle} {errorDetail} {operations}");
    expect(app).toContain("errorTitle = 'Blockbench connection needs attention'");
    expect(app).toContain("errorTitle = 'Setup needs attention'");
    expect(app).toContain("{#if error && status}<button");
  });

  test("small-window layouts wrap controls while retaining semantic focus and recovery", async () => {
    const [navigator, workspace, app, support, shared, capture] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/SupportPage.svelte"),
      source("../apps/desktop/src/styles.css"),
      source("../apps/desktop/scripts/capture-ui.py"),
    ]);
    expect(navigator).toContain("@media(max-width:680px)");
    expect(navigator).toContain(".project-actions,.model-actions{flex:1 1 100%");
    expect(navigator).toContain(".project-search-controls{flex-wrap:wrap}");
    expect(workspace).toContain("@media(max-width:680px)");
    expect(workspace).toContain(".definition-row{flex-wrap:wrap");
    expect(support).toContain("@media(max-width:680px)");
    expect(support).toContain(".recovery-list code{display:block;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}");
    expect(app).toContain("@media(max-width:520px)");
    expect(app).toContain(".page-toolbar{min-height:48px;flex-wrap:wrap");
    expect(shared).toContain("prefers-reduced-motion: reduce");
    expect(shared).toContain("button:focus-visible");
    expect(capture).toContain("VIEWPORTS = ((390, 640), (780, 560), (980, 680))");
    expect(capture).toContain("ld-project-action-note");
  });

  test("AI labels reflect recent verification, missing handshake and stale observations", async () => {
    const { aiStatusPresentation } = await import("../../apps/desktop/src/desktopPresentation");
    const { createDevFixtureStatus } = await import("../../apps/desktop/src/desktopFixtures");
    const ready = aiStatusPresentation(createDevFixtureStatus("ready"), 0);
    expect(ready.label).toBe("Recently verified");
    expect(ready.headline).toBe("AI connection recently verified");
    expect(ready.recentlyVerified).toBe(true);
    expect(ready.detail).not.toContain("permanently");

    const stale = aiStatusPresentation(createDevFixtureStatus("ready"), 2);
    expect(stale.label).toBe("Verification required");
    expect(stale.recentlyVerified).toBe(false);
    expect(stale.detail).toContain("Models and folders remain accessible");
    const waiting = createDevFixtureStatus("client-wait");
    expect(aiStatusPresentation(waiting, 0).label).toBe("AI client not connected");
    waiting.gateway.state = "gateway-detected";
    const handshake = aiStatusPresentation(waiting, 0);
    expect(handshake.label).toBe("AI handshake unverified");
    expect(handshake.detail).toContain("not verified");
    expect(aiStatusPresentation(createDevFixtureStatus("fresh-install"), 0).label).toBe("Setup needed");

    const [workspace, support] = await Promise.all([
      source("../apps/desktop/src/WorkspacePage.svelte"), source("../apps/desktop/src/SupportPage.svelte"),
    ]);
    expect(workspace).toContain("aiStatusPresentation(status, statusProbeFailures)");
    expect(workspace).toContain("{aiStatus.headline}");
    expect(workspace).toContain("{aiStatus.label}");
    expect(workspace).not.toContain("productMode(status) === 'ready' ? 'Connected'");
    expect(support).toContain("aiStatusPresentation(status, statusProbeFailures)");
    expect(support).toContain("{aiStatus.label}");
  });

  test("next-step notifications persist; optional launch focus is not a success claim", async () => {
    const [app, editor] = await Promise.all([
      source("../apps/desktop/src/App.svelte"), source("../apps/desktop/src/editorOperations.ts"),
    ]);
    expect(app).toContain("if (kind === 'pending') return;");
    expect(app).toContain("actionToastTimer = window.setTimeout");
    expect(app).toContain("onclick={clearActionFeedback}");
    expect(app).toContain("role={error ? 'alert' : 'status'}");
    expect(app).toContain("feedback.verification === 'focused' ? 'success' : 'pending'");
    expect(app).toContain("approvalPending ? 'pending' : 'success'");
    expect(app).toContain("result.reason !== 'MCP_SESSION_UNVERIFIED' ? 'success' : 'pending'");
    expect(editor).toContain("verification: focused ? 'focused' : 'launched-unverified'");
  });

  test("Desktop model search has an explicit clear action and live result count", async () => {
    const [navigator, workspace] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/WorkspacePage.svelte"),
    ]);
    expect(navigator).toContain('for="ld-project-search"');
    expect(navigator).toContain('bind:this={searchInput}');
    expect(navigator).toContain('function clearProjectSearch()');
    expect(navigator).toContain("searchInput?.focus()");
    expect(navigator).toContain("Clear search</button>");
    expect(navigator).toContain('id="ld-project-search-results"');
    expect(navigator).toContain('role="status" aria-live="polite"');
    expect(navigator).toContain("matchingProjects.length");
    expect(workspace).toContain("You can edit models even when AI is not connected.");
  });

  test("keyboard quick-open resolves only one available nonactive model by name", async () => {
    const { uniqueModelSearchTarget } = await import("../../apps/desktop/src/desktopPresentation");
    const { createDevFixtureStatus } = await import("../../apps/desktop/src/desktopFixtures");
    const ready = createDevFixtureStatus("ready").project_navigation;
    expect(uniqueModelSearchTarget(ready, " SOFA ")?.model.id).toBe("model-fixture-2");
    expect(uniqueModelSearchTarget(ready, "")).toBeNull();
    expect(uniqueModelSearchTarget(ready, "no_such_model")).toBeNull();
    expect(uniqueModelSearchTarget(ready, "Modern Chair")).toBeNull(); // Active model is not opened again.
    expect(uniqueModelSearchTarget(ready, "Furniture")).toBeNull(); // Project-name match is not a model shortcut.

    const large = createDevFixtureStatus("many-projects").project_navigation;
    expect(uniqueModelSearchTarget(large, "needle")?.model.id).toBe("fixture-model-8");
    large.projects[0].models[0].name = "Needle duplicate";
    expect(uniqueModelSearchTarget(large, "needle")).toBeNull(); // Ambiguous; explicit selection required.
    large.projects[0].available = false;
    expect(uniqueModelSearchTarget(large, "needle")?.model.id).toBe("fixture-model-8");

    const missing = createDevFixtureStatus("ready").project_navigation;
    missing.projects[0].models[1].exists = false;
    expect(uniqueModelSearchTarget(missing, "sofa")).toBeNull();
    const unavailable = createDevFixtureStatus("ready").project_navigation;
    unavailable.projects[0].available = false;
    expect(uniqueModelSearchTarget(unavailable, "sofa")).toBeNull();
  });

  test("search keyboard affordances are explained, bounded and do not open ambiguous results", async () => {
    const [navigator, presentation, fixture] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/desktopPresentation.ts"),
      source("../apps/desktop/scripts/capture-ui.py"),
    ]);
    expect(navigator).toContain('onkeydown={handleProjectSearchKeydown}');
    expect(navigator).toContain('id="ld-project-search-help"');
    expect(navigator).toContain('aria-describedby="ld-project-search-results ld-project-search-help"');
    expect(navigator).toContain("if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;");
    expect(navigator).toContain("event.key === 'Escape' && projectSearch");
    expect(navigator).toContain("event.stopPropagation()");
    expect(navigator).toContain("event.key === 'Enter' && uniqueSearchModel && canOpenModel && !busy");
    expect(navigator).toContain("void onOpenModel(uniqueSearchModel.model.id)");
    expect(navigator).toContain('Press Enter to open');
    expect(navigator).toContain('Escape clears search.');
    expect(presentation).toContain("if (target !== null) return null;");
    expect(fixture).toContain('search.press("Escape")');
    expect(fixture).not.toContain('model.click()');
    expect(fixture).not.toContain('search.press("Enter")'); // Preserve native safety in browser QA.
  });

  test("first-run Workspace makes model opening primary and AI setup an explicit optional action", async () => {
    const [workspace, navigator] = await Promise.all([
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
    ]);
    expect(workspace).toContain("Opening and editing models in Blockbench does not require an AI connection.");
    expect(workspace).toContain('aria-label="Optional AI setup"');
    expect(workspace).toContain('<h2>Set up AI tools</h2>');
    expect(workspace).toContain("What happens during setup?");
    expect(workspace).not.toContain("Prepare workstation");
    expect(workspace).toContain("setupStaged ? 'Finish setup'");
    expect(workspace).toContain("migrationConflict ? 'Check again'");
    expect(workspace).toContain("disabled={!status.bootstrap_available || busyAction !== null || statusProbeFailures >= 2}");
    expect(workspace).toContain("{#if status.project_navigation.projects.length > 0}");
    expect(workspace).toContain("{#if status.project_navigation.projects.length > 0 || status.project_navigation.active}");
    expect(workspace).toContain("{#if !status.project_navigation.active && status.project_navigation.projects.length === 0}");
    expect(workspace).toContain("{@render projectNavigator(status)}");
    const welcome = workspace.indexOf("{#if productMode(status) === 'welcome'}");
    const setup = workspace.indexOf('<section class="setup-panel"', welcome);
    const firstModel = workspace.indexOf('<h2>Open a model</h2>');
    expect(firstModel).toBeLessThan(setup);
    expect(setup).toBeGreaterThan(welcome);

    // Empty inventory does not show a nonproductive search, but folder add
    // remains accessible and an existing query can still be cleared.
    expect(navigator).toContain("navigation.projects.length > 0 || projectSearch.trim().length > 0");
    expect(navigator).toContain("onAddProjectFolder");
    expect(navigator).toContain("Clear search</button>");

    const fixture = await source("../apps/desktop/scripts/capture-ui.py");
    expect(fixture).toContain("def inspect_first_run(page, fixture, view):");
    expect(fixture).toContain('("fresh-install", "workspace"): {');
    expect(fixture).toContain('page.get_by_text("AI status needs verification", exact=True)');
    expect(fixture).toContain('entry["firstRunChecks"]');
  });

  test("Particle Studio is an optional disclosure without losing native authoring commands", async () => {
    const [panel, css, ui] = await Promise.all([
      source("ui/panel.html"), source("ui/panel.css"), source("ui/index.ts"),
    ]);
    const geometry = panel.indexOf('aria-label="Geometry tools"');
    const particle = panel.indexOf('aria-label="Particle Studio"');
    const disclosure = panel.indexOf('<details class="ld-studio-disclosure">', particle);
    expect(geometry).toBeGreaterThan(0);
    expect(geometry).toBeLessThan(particle);
    expect(disclosure).toBeGreaterThan(particle);
    expect(panel.indexOf('<summary class="ld-studio-toggle">', disclosure)).toBeGreaterThan(disclosure);
    expect(panel).not.toContain('<details class="ld-studio-disclosure" open');
    expect(panel).toContain("Draft in progress");
    expect(panel).toContain("Editing saved effect");
    expect(panel).toContain("Animation stage required");
    expect(panel).toContain("Open a Bedrock Model");
    expect(panel).toContain('v-else-if="!studioStageReady()"');
    for (const method of ["studioRefresh", "studioReset", "studioOpen", "studioCreate",
      "studioSave", "studioRevert", "studioPlay", "studioStop", "studioCheck", "studioAttach"]) {
      expect(panel.indexOf(`@click="${method}"`, disclosure)).toBeGreaterThan(disclosure);
    }
    expect(panel).toContain(':disabled="studioBusy || !project.hasFolder || !studioHasChanges()"');
    expect(panel).toContain(':disabled="studioBusy || !studioLoaded.path"');
    expect(css).toContain('.ld-studio-disclosure > summary:focus-visible');
    expect(css).toContain('.ld-studio-disclosure[open] > summary::before');
    expect(ui).toContain("stopStudioPreview");
    expect(ui).toContain("studioStageReady(this: HumanPanelContext): boolean {");
  });

  test("native authoring panel prioritizes the actionable Geometry section", async () => {
    const [panel, css] = await Promise.all([source("ui/panel.html"), source("ui/panel.css")]);
    expect(panel.indexOf('aria-label="Geometry tools"')).toBeGreaterThan(0);
    expect(panel.indexOf('aria-label="Geometry tools"')).toBeLessThan(panel.indexOf('aria-label="Particle Studio"'));
    expect(panel).toContain('Open a Bedrock Model project to use these checks.');
    expect(panel).toContain('studioStageReady()');
    expect(panel).toContain('@click="studioSave"');
    expect(css).toContain('.ld-workspace + .ld-workspace');
  });

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

  test("large project fixture exposes a model beyond the six initially visible rows", async () => {
    const { createDevFixtureStatus, devFixtureFromLocation } =
      await import("../../apps/desktop/src/desktopFixtures");
    const { visibleProjects, visibleProjectModels } =
      await import("../../apps/desktop/src/desktopPresentation");
    const fixture = createDevFixtureStatus("many-projects");
    const state = fixture.project_navigation;
    expect(fixture.product_state).toBe("ready");
    expect(state.active).toBeNull();
    expect(state.projects).toHaveLength(8);
    expect(new Set(state.projects.map(p => p.id)).size).toBe(8);
    expect(new Set(state.projects.flatMap(p => p.models.map(m => m.id))).size).toBe(8);
    expect(visibleProjects(state, "", false)).toHaveLength(6);
    expect(visibleProjects(state, "Needle asset", false).map(p => p.id))
      .toEqual(["fixture-project-8"]);
    expect(visibleProjectModels(state.projects[7], "Needle asset").map(m => m.name))
      .toEqual(["Needle asset"]);
    expect(visibleProjects(state, "", true)).toHaveLength(8);
    expect(devFixtureFromLocation(false, "?fixture=many-projects")).toBeNull();
    expect(devFixtureFromLocation(true, "?fixture=many-projects")).toBe("many-projects");
  });

  test("offline UX task probes record presentation paths without claiming real user completion", async () => {
    const script = await source("../apps/desktop/scripts/capture-ui.py");
    for (const task of [
      "discover_model_without_ai",
      "find_model_and_recover_empty_search",
      "find_model_beyond_first_six_projects",
      "locate_stale_status_recovery",
      "navigate_to_safe_repair",
    ]) expect(script).toContain(task);
    expect(script).toContain('("many-projects", "workspace")');
    expect(script).toContain("def inspect_task_journey(page, fixture, view):");
    expect(script).toContain('"taskJourney"');
    expect(script).toContain('"humanTaskSuccess": "NOT_MEASURED"');
    expect(script).toContain('"native_action": "NOT_ATTEMPTED"');
    expect(script).toContain('"automation_elapsed_ms"');
    const start = script.indexOf("def inspect_task_journey(");
    const end = script.indexOf("\ndef main():", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const probe = script.slice(start, end);
    for (const forbidden of ["model.click()", "repair.click()", "refresh.click()", "invoke(",
      "launch_model", "confirm_delete_project", "runManagedAction("]) {
      expect(probe).not.toContain(forbidden);
    }
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
    expect(capture).toContain('VIEWPORTS = ((390, 640), (780, 560), (980, 680))');
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
    expect(workspace).toContain("canOpenModel={true}");
    expect(workspace).toContain("canFocusCurrentEditor={statusProbeFailures < 2}");
    expect(workspace).toContain("canEditProjectPrefs={statusProbeFailures < 2}");
    expect(workspace).toContain("busy={busyAction !== null}");
    expect(workspace).toContain("{#if !status.project_navigation.active}");
    expect(workspace).toContain("Open Blockbench</button>");
    expect(workspace).toContain('onclick={() => openModel()} disabled={busyAction !== null}');
    expect(app).toContain("async function openModel(id?: string) {\n    if (devFixture || busyAction) return;");
    expect(app).toContain("statusProbeFailures >= 2 && !isSafeFileNavigationAction(action)");
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

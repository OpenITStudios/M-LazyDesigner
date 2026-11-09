import { describe, expect, test } from "bun:test";

const source = (path: string) => Bun.file(path).text();

describe("Unified Editor P1 source-owned workspace", () => {
  test("dev-only route preserves production Workspace and Support and one native editor", async () => {
    const [app, unified, native, stage] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/UnifiedWorkspacePage.svelte"),
      source("../apps/desktop/src-tauri/src/blockbench_surface.rs"),
      source("../apps/desktop/src/NativeEditorStage.svelte"),
    ]);
    expect(app).toContain("import UnifiedWorkspacePage from './UnifiedWorkspacePage.svelte'");
    expect(app).toContain("page === 'Editor' && import.meta.env.DEV");
    expect(app).toContain("<UnifiedWorkspacePage bind:this={nativeEditorStage}");
    expect(app).toContain("<WorkspacePage");
    expect(app).toContain("<SupportPage");
    expect(app).toContain("if (restored) finishNavigate(next)");
    expect(app).toContain("class:editor-shell={page === 'Editor' && import.meta.env.DEV}");
    expect(app).toContain("{#if page !== 'Editor' || !import.meta.env.DEV}");
    expect(app).toContain("navigateWorkspace={() => navigate('Overview')}");
    expect(app).toContain("navigateSupport={() => navigate('Support')}");
    expect(app).toContain("navigateActivity={() => navigate('Analytics')}");
    expect(app).toContain("document.querySelector<HTMLElement>('.editor-header h1')?.focus()");
    expect(unified).toContain('aria-label="LazyDesigner editor controls"');
    expect(unified).toContain('aria-label="Return to Workspace"');
    expect(unified).toContain('aria-label="Open Support"');
    expect(app).toContain("{focusCurrentEditor} {openBlockbenchEditor} {refresh}");
    expect(unified).toContain("<NativeEditorStage bind:this={nativeStage} {fixture} compact={true}");
    expect(unified).toContain("export async function detach(): Promise<boolean>");
    expect(unified).not.toContain("invoke(");
    expect(unified).not.toContain("SetParent(");
    expect(stage).toContain("export let compact = false");
    expect(native).toContain("#[cfg(all(windows, debug_assertions))]");
    expect(native).toContain("#[cfg(not(all(windows, debug_assertions)))]");
  });

  test("project search and actions retain existing model ID and Rust authorization boundaries", async () => {
    const unified = await source("../apps/desktop/src/UnifiedWorkspacePage.svelte");
    for (const term of [
      "visibleProjects(navigation, search, showAll)",
      "uniqueModelSearchTarget(navigation, search)",
      "recentModelTargets(navigation)",
      "visibleProjectModels(project, search)",
      "event.isComposing", "event.altKey", "event.ctrlKey",
      "event.metaKey", "event.shiftKey",
      "const restored = await detach();",
      "if (!restored)", "await action();",
      "runProjectAction('open-project-folder', id)",
      "runProjectAction('reveal-model', id)",
      "return afterDetach(() => openModel(id));",
      "function launchBlockbench() { return afterDetach(openBlockbenchEditor); }",
      "if (statusProbeFailures >= 2 || !status)",
      "disabled={!model.exists || actionBusy || fixture || (model.active && statusProbeFailures >= 2)}",
      "onclick={() => void chooseModel(model)}",
      "aria-current={model.active ? 'true' : undefined}",
      "aria-busy={openingModelId === model.id}",
      "aria-label=\"Clear project search\"",
      "runProjectAction(project.pinned ? 'unpin-project' : 'pin-project', project.id)",
      "recentExpanded = !recentExpanded",
      "runProjectAction('open-folder', id)",
      "project.folders.length > 0",
      "project.folders as folder (folder.id)",
      "'Open ' + folder.label + ' folder for project ' + project.name",
      "No project folders added yet.",
      'aria-label="Modified at last observation"',
      "projectsExpanded: true",
      "diagnosticExpanded: false",
      "projectActionsId = projectActionsId === id ? null : id;",
      "projectActionsId === project.id",
      "'Show actions for project ' + project.name",
      "'Actions for project ' + project.name",
      "class=\"project-inline-actions\"",
      "Browse projects in Workspace",
      "Open Diagnostic Support",
      "aria-label=\"Clear project search\"",
    ]) expect(unified).toContain(term);
    expect(unified).not.toContain("window.confirm");
    expect(unified).not.toContain("Delete Project");
    expect(unified).not.toContain("model_path");
    expect(unified).not.toContain("fetch(");
  });

  test("Diagnostic has only readiness/issues and Activity has connection/observed statistics", async () => {
    const [unified, app] = await Promise.all([
      source("../apps/desktop/src/UnifiedWorkspacePage.svelte"),
      source("../apps/desktop/src/App.svelte"),
    ]);
    expect(unified).toContain('aria-label="Diagnostic"');
    expect(unified).toContain('aria-label="Toggle Diagnostic panel"');
    expect(unified).toContain('role="tablist" aria-label="Diagnostic sections"');
    expect(unified).toContain('class="diagnostic-panel-bar"');
    expect(unified).toContain('class="diagnostic-collapse"');
    expect(unified).toContain(".diagnostic-tabs [role=\"tab\"][aria-selected=\"true\"]");
    expect(unified).not.toContain('bind:this={diagnosticHeading}');
    expect(unified).not.toContain('>Diagnostic</h3>');
    expect(unified).toContain("height:40px;padding:3px 0 0;gap:1px;");
    for (const id of ["diagnostic", "activity"]) {
      expect(unified).toContain('data-companion-tab="' + id + '"');
      expect(unified).toContain("aria-selected={diagnosticTab === '" + id + "'}");
      expect(unified).toContain("hidden={diagnosticTab !== '" + id + "'}");
    }
    expect(unified).toContain('role="tabpanel" tabindex="0" class="inspector-section diagnostic-section"');
    expect(unified).toContain('role="tabpanel" tabindex="0" class="inspector-section activity-section"');
    expect(unified).toContain('aria-labelledby="ld-tab-diagnostic"');
    expect(unified).toContain('aria-labelledby="ld-tab-activity"');
    expect(unified).toContain("status.readiness.ready");
    expect(unified).toContain("status?.readiness.summary");
    expect(unified).toContain("fullStatusObservationAgeMs(status.observed_at_unix_ms, statusPresentationNowMs)");
    expect(unified).toContain("readinessObservationAge > FULL_STATUS_RECENT_MS");
    expect(unified).toContain("readinessOutdated ? 'Check out of date'");
    expect(unified).toContain("statusProbeFailures >= 2 ? 'Verification required'");
    expect(unified).toContain("!loading && !readinessOutdated");
    expect(unified).toContain("Refresh to verify readiness. Last observed:");
    expect(unified).not.toContain('class="ai-indicator"');
    expect(unified).toContain("status.plugin_integrity");
    expect(unified).toContain("status?.diagnostic");
    expect(unified).toContain("status?.blockbench.diagnostic");
    expect(unified).toContain("observedProjectCount");
    expect(unified).toContain("observedModelCount");
    expect(unified).toContain("project.model_count");
    expect(unified).toContain("aiStatusPresentation(status, statusProbeFailures, statusPresentationNowMs)");
    expect(unified).toContain("onclick={navigateActivity}>View Gateway statistics");
    expect(app).toContain("navigateActivity={() => navigate('Analytics')}");
    expect(unified).not.toContain('id="ld-tab-assistant"');
    expect(unified).not.toContain('id="ld-tab-review"');
    expect(unified).not.toContain(">Model Review</h4>");
    expect(unified).not.toContain(">Assistant</button>");
    expect(unified).not.toContain("QA passed");
    expect(unified).not.toContain("ChatGPT API");
    expect(unified).not.toContain('class="tool-row"');
  });

  test("viewport-first docks keep the native editor in-flow, with focus and keyboard resize", async () => {
    const [unified, app] = await Promise.all([
      source("../apps/desktop/src/UnifiedWorkspacePage.svelte"),
      source("../apps/desktop/src/App.svelte"),
    ]);
    expect(unified).toContain("class:with-projects={showProjects}");
    expect(unified).toContain("class:with-inspector={showTools}");
    expect(unified).toContain("class:rail={explorerRail}");
    expect(unified).toContain("class:tools-rail={diagnosticRail}");
    expect(unified).toContain("showProjects = !layout.focusMode");
    expect(unified).toContain("showTools = !layout.focusMode");
    expect(unified).toContain("editorLayoutBand(width)");
    expect(unified).toContain("defaultEditorPanels(band)");
    expect(unified).toContain("canExpandEditorDock(editorWidth, 'projects'");
    expect(unified).toContain("canExpandEditorDock(editorWidth, 'tools'");
    expect(unified).toContain("if (opening && !canExpandProjects) return;");
    expect(unified).toContain("if (opening && !canExpandDiagnostic) return;");
    expect(unified).toContain("editorDockWidth(drag.dock");
    expect(unified).toContain("import { onMount, tick } from 'svelte'");
    expect(unified).toContain("await tick();");
    expect(unified).toContain("element?.focus();");
    expect(unified).toContain("element instanceof HTMLButtonElement && element.disabled");
    expect(unified).toContain("editorRoot?.querySelector<HTMLButtonElement>(fallback)?.focus();");
    expect(unified).toContain("void focusAfterLayout(() => explorerToggle)");
    expect(unified).toContain("void focusAfterLayout(() => diagnosticToggle)");
    expect(unified).toContain("bind:this={explorerToggle}");
    expect(unified).toContain("bind:this={diagnosticToggle}");
    expect(unified).toContain("project-inline-actions");
    expect(unified).not.toContain("position:fixed");
    expect(unified).toContain("toggleFocusMode");
    expect(unified).toContain("role=\"separator\" tabindex=\"0\"");
    expect(unified).toContain("Resize Project Explorer");
    expect(unified).toContain("Resize Diagnostic panel");
    expect(unified).toContain("aria-label={layout.focusMode ? 'Exit Focus Editor' : 'Focus Editor'}");
    expect(unified).toContain("grid-template-columns:var(--explorer-width,220px)");
    expect(unified).toContain('class="model-current-indicator"');
    expect(unified).toContain('title="Current model at last observation"');
    expect(unified).not.toContain('title="Current at last observation">Current</span>');
    expect(unified).toContain("grid-template-columns:48px minmax(0,1fr) 48px");
    expect(unified).toContain("min-height:32px; padding:2px 8px");
    expect(unified).toContain("overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;");
    expect(unified).toContain("scrollbar-width:thin;scrollbar-color:var(--color-button) transparent;");
    expect(unified).toContain(".editor-controls button:focus-visible{outline-offset:-2px}");
    expect(unified).toContain(".editor-header{min-height:38px;padding:2px 5px;gap:4px;flex-wrap:nowrap}");
    expect(unified).toContain(".editor-controls{width:auto;flex:1 1 0;justify-content:flex-start;flex-wrap:nowrap;gap:3px}");
    expect(unified).not.toContain(".editor-leading{width:100%;flex:1 1 100%}");
    expect(unified).not.toContain(".editor-header{min-height:55px;flex-wrap:wrap");
    expect(unified).toContain("height:28px;padding:2px 5px;line-height:1.2");
    expect(unified).toContain("height:28px;padding:2px 4px;line-height:1.2");
    expect(unified).not.toContain("grid-template-rows:140px minmax(220px,1fr)");
    expect(unified).toContain("overflow:hidden");
    expect(unified).toContain("--color-ui: #1e2127");
    expect(unified).toContain("--color-back: #181b1f");
    expect(unified).toContain("--color-accent: #3e90ff");
    expect(unified).toContain('aria-label="Project Explorer"');
    expect(unified).toContain('aria-label="Diagnostic"');
    expect(unified).toContain('aria-label="Blockbench native editor area"');
    expect(unified).toContain('aria-expanded={showProjects && !explorerRail}');
    expect(unified).toContain('aria-expanded={showTools && !diagnosticRail}');
    expect(unified).toContain('aria-label="Toggle Project Explorer"');
    expect(unified).toContain('aria-label="Toggle Diagnostic panel"');
    expect(app).toContain("let editorLayout: EditorLayoutState = { ...INITIAL_EDITOR_LAYOUT }");
    expect(app).toContain("bind:layout={editorLayout}");
    expect(unified).not.toContain("position:fixed");
    expect(unified).not.toContain(".native-stage{position:absolute");
  });

  test("responsive bands favor Blockbench width and never assume native visual proof", async () => {
    const {
      editorLayoutBand, defaultEditorPanels, editorDockWidth,
      canExpandEditorDock, MIN_NATIVE_EXPANSION_WIDTH, INITIAL_EDITOR_LAYOUT,
    } = await import("../../../apps/desktop/src/editorLayout");
    expect(editorLayoutBand(1920)).toBe("wide");
    expect(editorLayoutBand(1800)).toBe("standard");
    expect(editorLayoutBand(1600)).toBe("standard");
    expect(editorLayoutBand(1280)).toBe("rail");
    expect(editorLayoutBand(780)).toBe("compact");
    expect(defaultEditorPanels("wide")).toEqual({ projectsExpanded: true, diagnosticExpanded: true });
    expect(defaultEditorPanels("standard")).toEqual({ projectsExpanded: true, diagnosticExpanded: true });
    expect(defaultEditorPanels("rail")).toEqual({ projectsExpanded: false, diagnosticExpanded: false });
    expect(defaultEditorPanels("compact")).toEqual({ projectsExpanded: false, diagnosticExpanded: false });
    expect(INITIAL_EDITOR_LAYOUT.projectsWidth).toBe(220);
    expect(MIN_NATIVE_EXPANSION_WIDTH).toBe(320);
    expect(canExpandEditorDock(390, "projects", 220, 44)).toBe(false);
    expect(canExpandEditorDock(390, "tools", 240, 44)).toBe(false);
    expect(canExpandEditorDock(780, "projects", 220, 44)).toBe(true);
    expect(canExpandEditorDock(780, "tools", 240, 44)).toBe(true);
    expect(canExpandEditorDock(600, "tools", 300, 44)).toBe(false);
    expect(editorDockWidth("projects", 20)).toBe(160);
    expect(editorDockWidth("projects", 800)).toBe(260);
    expect(editorDockWidth("tools", 100)).toBe(220);
    expect(editorDockWidth("tools", 999)).toBe(300);
    expect(1920 - INITIAL_EDITOR_LAYOUT.projectsWidth - INITIAL_EDITOR_LAYOUT.toolsWidth - 12).toBeGreaterThan(1400);
    expect(1600 - INITIAL_EDITOR_LAYOUT.projectsWidth - INITIAL_EDITOR_LAYOUT.toolsWidth - 12).toBeGreaterThan(1100);
  });

  test("browser fixture captures real Svelte layout only, never native Blockbench", async () => {
    const [app, script, stage] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/scripts/capture-ui.py"),
      source("../apps/desktop/src/NativeEditorStage.svelte"),
    ]);
    expect(app).toContain("else if (view === 'editor') page = 'Editor'");
    expect(app).toContain("fixture={devFixture !== null}");
    expect(script).toContain('("ready", "editor")');
    expect(script).toContain('("many-projects", "editor")');
    expect(script).toContain('("fresh-install", "editor")');
    expect(script).toContain("OFFLINE_BROWSER_FIXTURE_ONLY");
    expect(script).toContain("Editor duplicates the global navigation/toolbar");
    expect(script).toContain("both companion side docks must remain mounted at every normal viewport");
    expect(script).toContain("fixture must never be able to place a native Blockbench window");
    expect(script).toContain("(1920, 1080)");
    expect(script).toContain("Focus Mode must restore both side docks");
    expect(script).toContain("Expanded Project Explorer cannot return to icon rail");
    expect(script).toContain("Collapsing Project Explorer loses keyboard focus");
    expect(script).toContain("Collapsing Diagnostic panel loses keyboard focus");
    expect(script).toContain("Project actions overlap the reserved native editor");
    expect(script).toContain("Narrow Project Explorer must offer safe Workspace navigation");
    expect(script).toContain("Narrow Diagnostic rail must provide Support fallback");
    expect(script).toContain("Aged status must not appear as verified ready");
    expect(script).toContain("Repeated probe failures must not appear as verified ready");
    expect(script).toContain("AI connection must not be duplicated in the top toolbar");
    expect(script).toContain("Compact editor toolbar wraps instead of staying on one row");
    expect(script).toContain("Compact editor actions cannot scroll when clipped");
    expect(script).toContain("Last editor toolbar action is not reachable by horizontal scrolling");
    expect(script).toContain('("ready-aged", "editor")');
    expect(script).toContain('("status-unverified", "editor")');
    expect(script).toContain("Diagnostic tabs lack arrow-key navigation");
    expect(script).toContain("Diagnostic must have exactly Diagnostic and Activity tabs");
    expect(script).toContain("Activity must show observed project statistics");
    expect(script).toContain("Diagnostic tabs must retain Blockbench's 40px bar");
    expect(script).toContain("Diagnostic duplicates its panel title above the tabs");
    expect(script).toContain("Diagnostic tab bar is not flush to the dock top");
    expect(script).toContain("Diagnostic collapse button must sit beside its tablist");
    expect(script).toContain("Expanding Diagnostic must focus its selected tab");
    expect(stage).toContain("disabled={busy || fixture}");
  });
  test("Svelte host icon controls are real components, not generated screenshots", async () => {
    const [icons, unified, stage] = await Promise.all([
      source("../apps/desktop/src/EditorChromeIcon.svelte"),
      source("../apps/desktop/src/UnifiedWorkspacePage.svelte"),
      source("../apps/desktop/src/NativeEditorStage.svelte"),
    ]);
    expect(icons).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(icons).toContain('aria-hidden="true"');
    expect(unified).toContain("import EditorChromeIcon from './EditorChromeIcon.svelte'");
    expect(unified).toContain('<EditorChromeIcon name="projects"/>');
    expect(unified).toContain('<EditorChromeIcon name="diagnostic"/>');
    expect(stage).toContain('data-native-editor-reservation="true"');
    expect(stage).not.toContain('class="native-placeholder"');
    expect(icons).not.toContain("image_gen");
    expect(icons).not.toContain("WebGLRenderer");
  });

  test("scoped Blockbench-compatible theme retains native and legacy product ownership", async () => {
    const [app, unified, stage, tokens] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/UnifiedWorkspacePage.svelte"),
      source("../apps/desktop/src/NativeEditorStage.svelte"),
      source("../apps/desktop/src/tokens.css"),
    ]);
    expect(unified).toContain('<header class="editor-header"');
    expect(unified).toContain('<h1 tabindex="-1"');
    expect(unified).toContain('navigateWorkspace');
    expect(unified).toContain('navigateSupport');
    expect(unified).toContain("--color-ui: #1e2127");
    expect(unified).toContain("--color-back: #181b1f");
    expect(unified).toContain("--color-accent: #3e90ff");
    expect(stage).toContain('data-native-editor-reservation="true"');
    expect(stage).toContain("{#if !compact}");
    expect(stage).toContain("export async function present(): Promise<void>");
    expect(stage).not.toContain('class="native-placeholder"');
    expect(unified).toContain("onPlacementChange={onNativePlacementChange}");
    expect(unified).toContain("--ed-native-bg:var(--color-dark)");
    expect(stage).toContain("background:var(--ed-native-bg,var(--ed-bg,var(--bg)))");
    expect(unified).toContain('aria-label="Place original Blockbench window in workspace"');
    expect(unified).toContain('aria-label="Detach and restore original Blockbench window"');
    expect(stage).toContain("Native behavior unverified");
    expect(app).toContain("{#if page !== 'Editor' || !import.meta.env.DEV}");
    expect(app).toContain(".desktop-shell.editor-shell");
    expect(tokens).toContain("--accent: #1bd96a");
    expect(unified).not.toContain("SetParent(");
    expect(unified).not.toContain("WebGLRenderer(");
  });

});

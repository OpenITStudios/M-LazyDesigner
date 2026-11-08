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
      "restoreProjectsAfterTools: layout.projectsVisible",
      "projectsVisible: layout.restoreProjectsAfterTools",
    ]) expect(unified).toContain(term);
    expect(unified).not.toContain("window.confirm");
    expect(unified).not.toContain("Delete Project");
    expect(unified).not.toContain("model_path");
    expect(unified).not.toContain("fetch(");
  });

  test("Model Tools is a truthful, clearly labelled Blockbench companion, not duplicate authoring", async () => {
    const unified = await source("../apps/desktop/src/UnifiedWorkspacePage.svelte");
    expect(unified).toContain("aiStatusPresentation(status, statusProbeFailures, statusPresentationNowMs)");
    expect(unified).toContain("Geometry checks</strong><span>Blockbench plugin");
    expect(unified).toContain("Texturing</strong><span>Blockbench native");
    expect(unified).toContain("Animation</strong><span>Blockbench native");
    expect(unified).toContain("Particle Studio</strong><span>Blockbench plugin");
    expect(unified).toContain("No separate QA result or AI prompt is generated");
    expect(unified).toContain('aria-label="Model Tools"');
    expect(unified).toContain('aria-label="Toggle Model Tools"');
    expect(unified).toContain('Model Overview</h4>');
    expect(unified).toContain('Checks in Blockbench</h4>');
    expect(unified).toContain('AI Connection</h4>');
    expect(unified).not.toContain('aria-label="AI and QA"');
    expect(unified).toContain("navigateSupport");
    expect(unified).toContain("statusProbeFailures >= 2");
    expect(unified).not.toContain("QA passed");
    expect(unified).not.toContain("ChatGPT API");
  });

  test("viewport-first docks keep the native editor in-flow, with focus and keyboard resize", async () => {
    const [unified, app] = await Promise.all([
      source("../apps/desktop/src/UnifiedWorkspacePage.svelte"),
      source("../apps/desktop/src/App.svelte"),
    ]);
    expect(unified).toContain("class:with-projects={showProjects}");
    expect(unified).toContain("class:with-inspector={showTools}");
    expect(unified).toContain("class:rail={explorerRail}");
    expect(unified).toContain("editorLayoutBand(editorRoot.getBoundingClientRect().width)");
    expect(unified).toContain("defaultEditorPanels(band)");
    expect(unified).toContain("editorDockWidth(drag.dock");
    expect(unified).toContain("toggleFocusMode");
    expect(unified).toContain("role=\"separator\" tabindex=\"0\"");
    expect(unified).toContain("Resize Project Explorer");
    expect(unified).toContain("Resize Model Tools");
    expect(unified).toContain("aria-label={layout.focusMode ? 'Exit Focus Editor' : 'Focus Editor'}");
    expect(unified).toContain("grid-template-columns:var(--explorer-width,200px)");
    expect(unified).toContain("grid-template-columns:48px minmax(0,1fr)");
    expect(unified).toContain("grid-template-rows:140px minmax(220px,1fr)");
    expect(unified).toContain("overflow:hidden");
    expect(unified).toContain("--ed-bg: #1b1f27");
    expect(unified).toContain("--ed-accent: #85a9df");
    expect(unified).toContain('aria-label="Project Explorer"');
    expect(unified).toContain('aria-label="Model Tools"');
    expect(unified).toContain('aria-label="Blockbench native editor area"');
    expect(unified).toContain('aria-expanded={showProjects}');
    expect(unified).toContain('aria-expanded={showTools}');
    expect(unified).toContain('aria-label="Toggle Project Explorer"');
    expect(unified).toContain('aria-label="Toggle Model Tools"');
    expect(app).toContain("let editorLayout: EditorLayoutState = { ...INITIAL_EDITOR_LAYOUT }");
    expect(app).toContain("bind:layout={editorLayout}");
    expect(unified).not.toContain("position:fixed");
    expect(unified).not.toContain(".native-stage{position:absolute");
  });

  test("responsive bands favor Blockbench width and never assume native visual proof", async () => {
    const { editorLayoutBand, defaultEditorPanels, editorDockWidth, INITIAL_EDITOR_LAYOUT } =
      await import("../../../apps/desktop/src/editorLayout");
    expect(editorLayoutBand(1920)).toBe("wide");
    expect(editorLayoutBand(1800)).toBe("standard");
    expect(editorLayoutBand(1600)).toBe("standard");
    expect(editorLayoutBand(1280)).toBe("rail");
    expect(editorLayoutBand(780)).toBe("compact");
    expect(defaultEditorPanels("wide")).toEqual({
      projectsVisible: true, toolsVisible: true, railExpanded: false,
      restoreProjectsAfterTools: false, restoreRailAfterTools: false,
    });
    expect(defaultEditorPanels("standard").toolsVisible).toBe(false);
    expect(defaultEditorPanels("compact").projectsVisible).toBe(false);
    expect(editorDockWidth("projects", 20)).toBe(160);
    expect(editorDockWidth("projects", 800)).toBe(260);
    expect(editorDockWidth("tools", 100)).toBe(220);
    expect(editorDockWidth("tools", 999)).toBe(300);
    expect(1920 - INITIAL_EDITOR_LAYOUT.projectsWidth - INITIAL_EDITOR_LAYOUT.toolsWidth - 12).toBeGreaterThan(1400);
    expect(1600 - INITIAL_EDITOR_LAYOUT.projectsWidth - 6).toBeGreaterThan(1300);
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
    expect(script).toContain("compact Editor must start with Project Explorer collapsed");
    expect(script).toContain("fixture must never be able to place a native Blockbench window");
    expect(script).toContain("(1920, 1080)");
    expect(script).toContain("Focus Mode did not restore Model Tools visibility");
    expect(script).toContain("Expanded Project Explorer cannot return to the narrow icon rail");
    expect(stage).toContain("disabled={busy || fixture}");
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
    expect(unified).toContain("--ed-bg: #1b1f27");
    expect(unified).toContain("--ed-panel: #232833");
    expect(unified).toContain("--ed-accent: #85a9df");
    expect(stage).toContain('data-native-editor-reservation="true"');
    expect(stage).toContain("{#if !compact}");
    expect(stage).toContain("export async function present(): Promise<void>");
    expect(stage).not.toContain('class="native-placeholder"');
    expect(unified).toContain("onPlacementChange={onNativePlacementChange}");
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

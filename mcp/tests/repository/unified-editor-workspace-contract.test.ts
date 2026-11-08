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
      "disabled={model.active || !model.exists || actionBusy || fixture}",
    ]) expect(unified).toContain(term);
    expect(unified).not.toContain("window.confirm");
    expect(unified).not.toContain("Delete Project");
    expect(unified).not.toContain("model_path");
    expect(unified).not.toContain("fetch(");
  });

  test("AI and QA panel is a truthful existing-owner projection, not duplicate authoring", async () => {
    const unified = await source("../apps/desktop/src/UnifiedWorkspacePage.svelte");
    expect(unified).toContain("aiStatusPresentation(status, statusProbeFailures, statusPresentationNowMs)");
    expect(unified).toContain("Geometry checks</strong><span>Blockbench plugin");
    expect(unified).toContain("Texturing</strong><span>Blockbench native");
    expect(unified).toContain("Animation</strong><span>Blockbench native");
    expect(unified).toContain("Particle Studio</strong><span>Blockbench plugin");
    expect(unified).toContain("No separate QA result or AI prompt is generated");
    expect(unified).toContain("navigateSupport");
    expect(unified).toContain("statusProbeFailures >= 2");
    expect(unified).not.toContain("QA passed");
    expect(unified).not.toContain("ChatGPT API");
  });

  test("panel collapse is non-overlay and keeps native viewport fixed at high zoom", async () => {
    const unified = await source("../apps/desktop/src/UnifiedWorkspacePage.svelte");
    expect(unified).toContain("class:with-projects={projectsVisible}");
    expect(unified).toContain("class:with-inspector={inspectorVisible}");
    expect(unified).toContain("projectsVisible && inspectorVisible");
    expect(unified).toContain("if (projectsVisible && window.innerWidth <= 650)");
    expect(unified).toContain("if (inspectorVisible && window.innerWidth <= 650)");
    expect(unified).toContain("overflow:hidden");
    expect(unified).toContain("grid-template-rows:88px minmax(220px,1fr)");
    expect(unified).toContain('aria-label="Project Explorer"');
    expect(unified).toContain('aria-label="AI and QA"');
    expect(unified).toContain('aria-label="Blockbench native editor area"');
    expect(unified).toContain('aria-expanded={projectsVisible}');
    expect(unified).toContain('aria-expanded={inspectorVisible}');
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
    expect(stage).toContain("disabled={busy || fixture}");
  });
});

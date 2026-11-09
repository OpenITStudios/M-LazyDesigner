import { describe, expect, test } from "bun:test";

const root = (path: string) => Bun.file("../" + path).text();
const desktop = (path: string) => root("apps/desktop/" + path);
const specialist = ".agents/skills/lazydesigner-desktop-ui-design-development/";

describe("Desktop UI Preview: real application only", () => {
  test("canonical Skill and root policy ban all AI-generated screenshots and unsolicited visual work", async () => {
    const [skill, protocol, agents, taxonomy] = await Promise.all([
      root(specialist + "SKILL.md"),
      root(specialist + "references/ui-preview-protocol.md"),
      root("AGENTS.md"),
      root("docs/04-system/skill-taxonomy.md"),
    ]);
    expect(skill).toContain("OWNER: DESKTOP_VISUAL_UI_PREVIEW");
    expect(taxonomy).toContain(specialist + "SKILL.md");
    expect(agents).toContain("NEVER use generative-image tools for UI/UX");
    expect(skill).toContain("NEVER use generative-image tools");
    expect(skill).toContain("including `image_gen`");
    expect(skill).toContain("PLAN / DISCUSS");
    expect(skill).toContain("PREVIEW");
    expect(skill).toContain("NO PREVIEW RENDERED");
    expect(protocol).toContain("PLAN/DISCUSS is text-only");
    expect(protocol).toContain("PREVIEW needs an explicit visual request");
    expect(protocol).toContain("F1 reconstruction is deliberately unavailable");
  });

  test("F2 frame is actual App.svelte entry, not a hand-copied production UI", async () => {
    const [index, main, preview, fixtures, productionIndex, productionMain, app, appFixtures] = await Promise.all([
      desktop("scripts/ui-preview/index.html"),
      desktop("scripts/ui-preview/main.ts"),
      desktop("scripts/ui-preview/PreviewApp.svelte"),
      desktop("scripts/ui-preview/fixtures.ts"),
      desktop("index.html"),
      desktop("src/main.ts"),
      desktop("src/App.svelte"),
      desktop("src/desktopFixtures.ts"),
    ]);
    expect(index).toContain('src="./main.ts"');
    expect(main).toContain("PreviewApp.svelte");
    expect(main).not.toContain("App.svelte");
    expect(preview).toContain("iframe data-preview-frame inert");
    expect(preview).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(preview).toContain("const frameUrl = $derived('/?fixture='");
    expect(preview).toContain("SYNTHETIC · NOT NATIVE");
    expect(preview).not.toMatch(/<(?:UnifiedWorkspacePage|WorkspacePage|SupportPage|NativeEditorStage)\b/);
    expect(productionIndex).toContain('src="/src/main.ts"');
    expect(productionMain).toContain("import App from './App.svelte'");
    expect(app).toContain("devFixtureFromLocation(import.meta.env.DEV");
    expect(app).toContain("if (devFixture)");
    expect(app).toContain("view === 'editor'");
    expect(app).toContain("<UnifiedWorkspacePage");
    expect(app).toContain("fixture={devFixture !== null}");
    expect(appFixtures).toContain("export type DevFixture");
    for (const id of ["editor-ready","editor-many-projects","editor-status-unverified","workspace-ready","workspace-fresh-install","support-plugin-missing","analytics-ready"])
      expect(fixtures).toContain("id: '" + id + "'");
    for (const viewport of ["compact", "desktop", "large"])
      expect(fixtures).toContain(viewport + ": {");
  });

  test("existing browser fixture and native-stage guards prevent Tauri/native side effects", async () => {
    const [app, nativeStage, monitor, fixtures, preview, script] = await Promise.all([
      desktop("src/App.svelte"),
      desktop("src/NativeEditorStage.svelte"),
      desktop("src/connectionMonitor.ts"),
      desktop("src/desktopFixtures.ts"),
      desktop("scripts/ui-preview/PreviewApp.svelte"),
      desktop("scripts/ui-preview/render.mjs"),
    ]);
    expect(app).toContain("if (devFixture) {");
    expect(app).toContain("if (devFixture || busyAction) return;");
    expect(nativeStage).toContain("if (fixture || busy || uncertain) return;");
    expect(nativeStage).toContain("if (!fixture) {");
    expect(monitor).toContain("if (disposed || fixture");
    expect(fixtures).toContain("export const FIXTURE_NOW_MS");
    expect(preview).toContain("native Blockbench window is NOT inside this screenshot");
    expect(preview).toContain("let viewport = $state<PreviewViewport>('large')");
    expect(preview).toContain("center is intentionally empty");
    expect(script).toContain("native_tauri_host_absent");
    expect(script).toContain("empty_native_window_reservation");
    expect(script).toContain("no_native_ui_in_center");
    expect(script).toContain('viewport: "large"');
    expect(script).toContain("native_editor_dominates_layout");
    expect(script).toContain("native_reservation_has_real_area");
    expect(script).toContain("side_docks_have_accessible_names");
    expect(script).toContain("both_side_docks_present");
    expect(script).toContain("active_model_name_readable_default");
    expect(script).toContain("dock_responsive_rails");
    expect(script).toContain("diagnostic_activity_truthful");
    expect(script).toContain("diagnosticPanelCount === 2");
    expect(script).toContain("blockbench_tab_strip_geometry");
    expect(script).toContain("blockbench_selected_tab_colors");
    expect(script).toContain("blockbench_outliner_row_density");
    expect(script).toContain("blank_native_area_uses_real_dark_token");
    expect(script).toContain("default_dark_matches_blockbench_source");
    expect(nativeStage).toContain('data-native-editor-reservation="true"');
    expect(nativeStage).not.toContain('class="native-placeholder"');
    expect(script).not.toMatch(/image_gen|(?:npm|pnpm|yarn)\s+(?:install|add|ci)|npx\s/);
  });

  test("renderer is plan-only, pins clean Local, denies external traffic and captures the rendered canvas", async () => {
    const [script, typecheck, pkg, config] = await Promise.all([
      desktop("scripts/ui-preview/render.mjs"),
      desktop("scripts/ui-preview/typecheck.mjs"),
      desktop("package.json").then(JSON.parse),
      desktop("scripts/ui-preview/tsconfig.json").then(JSON.parse),
    ]);
    expect(pkg.scripts["preview:plan"]).toBe("node scripts/ui-preview/render.mjs --current-local");
    expect(pkg.scripts["preview:quick"]).toBe("node scripts/ui-preview/render.mjs --execute --current-local");
    expect(pkg.scripts["preview:render"]).toBe("node scripts/ui-preview/render.mjs");
    expect(pkg.scripts["preview:typecheck"]).toBe("node scripts/ui-preview/typecheck.mjs");
    expect(config.extends).toBe("../../tsconfig.json");
    expect(config.include).toContain("./**/*.svelte");
    expect(script).toContain('if (branch !== "Local")');
    expect(script).toContain("head !== input.expectedSha");
    expect(script).toContain('"--porcelain"');
    expect(script).toContain('"--untracked-files=all"');
    expect(script).toContain("if (!input.execute)");
    expect(script).toContain('import("vite")');
    expect(script).toContain('import("playwright")');
    expect(script).toContain("context.routeWebSocket");
    expect(script).toContain('route.abort("blockedbyclient")');
    expect(script).toContain('serviceWorkers: "block"');
    expect(script).toContain("acceptDownloads: false");
    expect(script).toContain("exact_canvas_viewport");
    expect(script).toContain("visible_toolbar_controls_contained");
    expect(script).toContain("no_horizontal_document_overflow");
    expect(script).toContain("source_unchanged_during_render");
    expect(script).toContain("screenshotSha256");
    expect(script).toContain("await canvas.screenshot");
    expect(script).toContain('native_windows: "NOT_EXECUTED"');
    expect(script).toContain('native_blockbench_content: "NOT_EXECUTED"');
    expect(script).not.toMatch(/(?:npm|pnpm|yarn)\s+(?:install|add|ci)|npx\s|cargo run|image_gen/);
    expect(typecheck).toContain("svelte-check/package.json");
    expect(typecheck).toContain("--tsconfig");
    expect(typecheck).toContain("0 errors and 0 warnings");
    const executionGate = script.indexOf("if (!input.execute)");
    const browserLaunch = script.indexOf("playwright.chromium.launch");
    const capture = script.indexOf("await canvas.screenshot");
    const finalSha = script.indexOf("checks.source_unchanged_during_render");
    expect(executionGate).toBeGreaterThan(0);
    expect(browserLaunch).toBeGreaterThan(executionGate);
    expect(capture).toBeGreaterThan(browserLaunch);
    expect(finalSha).toBeGreaterThan(capture);
  });
});

// Explicit LOCAL_CODE-only real-app browser renderer. Plan-only without --execute.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(appRoot, "../..");
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const fail = (message) => { throw new Error(message); };
const tracked = [
  "apps/desktop/src",
  "apps/desktop/scripts/ui-preview",
  "apps/desktop/index.html",
  "apps/desktop/vite.config.ts",
  "apps/desktop/package.json",
  "apps/desktop/package-lock.json",
];

function options(argv) {
  const input = { execute: false, currentLocal: false, expectedSha: "", scenario: "editor-ready", viewport: "large" };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--execute") input.execute = true;
    else if (value === "--current-local") input.currentLocal = true;
    else if (value === "--expected-sha") input.expectedSha = argv[++i] ?? "";
    else if (value === "--scenario") input.scenario = argv[++i] ?? "";
    else if (value === "--viewport") input.viewport = argv[++i] ?? "";
    else fail("Unrecognized preview argument: " + value);
  }
  if (input.currentLocal === Boolean(input.expectedSha))
    fail("Provide exactly one of --current-local or --expected-sha <full Local SHA>.");
  if (input.expectedSha && !/^[0-9a-f]{40}$/.test(input.expectedSha))
    fail("Expected SHA must be exactly 40 lowercase hex characters.");
  if (!/^[a-z][a-z-]{0,48}$/.test(input.scenario) || !/^[a-z][a-z-]{0,32}$/.test(input.viewport))
    fail("Invalid scenario or viewport name.");
  return input;
}

async function main() {
  const start = performance.now();
  const input = options(process.argv.slice(2));
  const head = git("rev-parse", "HEAD");
  const branch = git("branch", "--show-current");
  if (branch !== "Local") fail("Only the selected Local source branch may be previewed.");
  if (input.currentLocal) input.expectedSha = head;
  if (head !== input.expectedSha) fail("Source HEAD differs from the pinned commit; no screenshot was made.");
  if (git("status", "--porcelain", "--untracked-files=all", "--", ...tracked))
    fail("UI preview source dependencies are dirty. No mixed-source screenshot is allowed.");
  const receiptBase = {
    repository: "OpenITStudios/M-LazyDesigner",
    ref: "Local",
    sha: head,
    scenario: input.scenario,
    viewport: input.viewport,
    source_entry: "apps/desktop/src/main.ts -> App.svelte",
    fidelity: "F2_BROWSER_COMPONENT",
    synthetic: true,
    native_windows: "NOT_EXECUTED",
    native_blockbench_content: "NOT_EXECUTED",
  };
  if (!input.execute) {
    console.log(JSON.stringify({ ...receiptBase, status: "PLAN_ONLY", rendered: "NOT_EXECUTED", next: "F2 requires authorized LOCAL_CODE and existing Vite, Playwright and Chromium." }, null, 2));
    return;
  }
  if (!existsSync(join(appRoot, "node_modules", "vite", "package.json")))
    fail("Existing Vite dependency not found; F2 NOT_EXECUTED. No installation attempted.");
  let viteApi, playwright;
  try { viteApi = await import("vite"); }
  catch { fail("Existing Vite module unavailable; F2 NOT_EXECUTED."); }
  try { playwright = await import("playwright"); }
  catch { fail("Playwright is not already available; F2 NOT_EXECUTED. No installation attempted."); }
  if (!playwright.chromium) fail("Chromium is unavailable from existing Playwright.");

  let viteServer = null;
  let browser = null;
  try {
    viteServer = await viteApi.createServer({
      root: appRoot,
      configFile: join(appRoot, "vite.config.ts"),
      mode: "development",
      server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
      logLevel: "error",
    });
    await viteServer.listen();
    const address = viteServer.httpServer?.address();
    if (!address || typeof address === "string") fail("Vite did not bind a local TCP port.");
    const port = address.port;
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 2060, height: 1290 },
      locale: "en-GB",
      timezoneId: "Asia/Jakarta",
      colorScheme: "dark",
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const denied = [];
    const errors = [];
    if (typeof context.routeWebSocket !== "function")
      fail("WebSocket interception unavailable: cannot guarantee F2 network isolation.");
    await context.routeWebSocket("**/*", socket => {
      const u = new URL(socket.url());
      if (u.protocol === "ws:" && u.hostname === "127.0.0.1" && u.port === String(port)) {
        socket.connectToServer();
        return;
      }
      denied.push(u.origin);
      socket.close({ code: 1008, reason: "External WebSocket blocked by UI preview" });
    });
    await context.route("**/*", route => {
      const u = new URL(route.request().url());
      if (u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port === String(port))
        return route.continue();
      denied.push(u.origin);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(20_000);
    page.on("pageerror", error => errors.push(String(error.message)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("websocket", ws => {
      const u = new URL(ws.url());
      if (u.hostname !== "127.0.0.1" || u.port !== String(port)) denied.push(u.origin);
    });

    const loaded = await page.goto("http://127.0.0.1:" + port + "/scripts/ui-preview/index.html", { waitUntil: "domcontentloaded" });
    if (!loaded?.ok()) fail("The preview toolbar entry failed to load.");
    const scenarios = page.locator('select[aria-label="Preview scenario"]');
    const viewports = page.locator('select[aria-label="Preview viewport"]');
    if (await scenarios.locator('option[value="' + input.scenario + '"]').count() !== 1)
      fail("Scenario is not declared in the pinned production-fixture map.");
    if (await viewports.locator('option[value="' + input.viewport + '"]').count() !== 1)
      fail("Viewport is not declared in the pinned preview layout.");
    await scenarios.selectOption(input.scenario);
    await viewports.selectOption(input.viewport);

    const canvas = page.locator("[data-preview-canvas]");
    const src = await page.locator("iframe[data-preview-frame]").getAttribute("src");
    if (!src || !src.startsWith("/?fixture=")) fail("Iframe must load the real production app entry.");
    const fixture = new URL(src, "http://127.0.0.1:" + port);
    const statusFixture = fixture.searchParams.get("fixture");
    const view = fixture.searchParams.get("view");
    if (!statusFixture || !["editor", "workspace", "support", "analytics"].includes(view))
      fail("Unexpected production app fixture route.");
    const frame = page.frameLocator("iframe[data-preview-frame]");
    const root = frame.locator('.desktop-shell[data-qa-fixture="' + statusFixture + '"]');
    await root.waitFor({ state: "visible" });
    const pageSelectors = {
      editor: 'main[aria-label="LazyDesigner unified editor workspace"]',
      workspace: 'main.workspace-overview',
      support: 'main.settings-content',
      analytics: 'main',
    };
    await frame.locator(pageSelectors[view]).first().waitFor({ state: "visible" });
    await root.evaluate(async () => { await document.fonts.ready; });

    const dims = await canvas.evaluate(element => ({
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    }));
    const state = await frame.locator("body").evaluate(body => {
      const viewport = { width: innerWidth, height: innerHeight };
      const root = document.querySelector(".desktop-shell");
      const topbar = document.querySelector(".editor-header") ?? document.querySelector(".page-toolbar");
      const visible = topbar ? Array.from(topbar.querySelectorAll("button")).filter(el => {
        const css = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return css.display !== "none" && css.visibility !== "hidden" && box.width > 0 && box.height > 0;
      }) : [];
      const contained = el => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0
          && box.left >= -1 && box.right <= innerWidth + 1
          && box.top >= -1 && box.bottom <= innerHeight + 1;
      };
      // Clipped controls are acceptable ONLY when they are within a bounded,
      // keyboard-scrollable toolbar. An arbitrary overflow is still an error.
      const reachableViaActionScroll = el => {
        const scroller = el.closest(".editor-controls");
        if (!scroller || getComputedStyle(scroller).overflowX !== "auto" || !contained(scroller))
          return false;
        const outer = scroller.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const relativeLeft = rect.left - outer.left + scroller.scrollLeft;
        const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
        const minScroll = Math.max(0, relativeLeft + rect.width - scroller.clientWidth);
        return rect.width <= scroller.clientWidth + 1
          && relativeLeft >= -1
          && relativeLeft + rect.width <= scroller.scrollWidth + 1
          && minScroll <= Math.min(maxScroll, relativeLeft) + 1;
      };
      const actionScroller = topbar?.querySelector(".editor-controls") ?? null;
      const toolbarButtonContained = el => {
        const scroller = el.closest(".editor-controls");
        if (!scroller) return contained(el);
        const outer = scroller.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const directlyVisible = contained(el)
          && rect.left >= outer.left - 1 && rect.right <= outer.right + 1;
        return directlyVisible || reachableViaActionScroll(el);
      };
      const headerRect = topbar?.getBoundingClientRect() ?? null;
      return {
        viewport,
        scrollWidth: document.documentElement.scrollWidth,
        nativeBridgeAbsent: typeof window.__TAURI_INTERNALS__ === "undefined",
        cssApplied: Boolean(root && getComputedStyle(root).display === "grid" && getComputedStyle(body).fontFamily),
        rootRect: root ? { width: root.getBoundingClientRect().width, height: root.getBoundingClientRect().height } : null,
        toolbarContained: Boolean(topbar && contained(topbar)),
        toolbarSingleRow: Boolean(headerRect && headerRect.height <= 48),
        actionToolbarScrollEnabled: Boolean(actionScroller
          && getComputedStyle(actionScroller).overflowX === "auto"
          && contained(actionScroller)),
        actionToolbarDocumentBounded: Boolean(actionScroller
          && actionScroller.scrollWidth >= actionScroller.clientWidth),
        visibleToolbarButtons: visible.length,
        toolbarButtonsContained: visible.length > 0
          && visible.every(toolbarButtonContained),
        syntheticFixture: root?.getAttribute("data-qa-fixture") ?? null,
      };
    });
    const editor = view === "editor";
    const checks = {
      exact_canvas_viewport: state.viewport.width === dims.width && state.viewport.height === dims.height,
      app_shell_fills_frame: state.rootRect !== null && Math.abs(state.rootRect.width - dims.width) < 2 && Math.abs(state.rootRect.height - dims.height) < 2,
      original_app_fixture_mounted: state.syntheticFixture === statusFixture,
      real_app_css_applied: state.cssApplied,
      no_horizontal_document_overflow: state.scrollWidth <= state.viewport.width + 1,
      native_tauri_host_absent: state.nativeBridgeAbsent,
      source_iframe_read_only: await page.locator("iframe[data-preview-frame][inert]").count() === 1,
      synthetic_notice_visible: await page.locator(".synthetic-warning").isVisible(),
      page_present: await frame.locator(pageSelectors[view]).count() >= 1,
      toolbar_contained: state.toolbarContained,
      visible_toolbar_controls_contained: state.toolbarButtonsContained,
      no_browser_errors: errors.length === 0,
      no_remote_requests: denied.length === 0,
    };
    if (editor) {
      checks.unified_editor_header = await frame.locator("header.editor-header").isVisible();
      checks.compact_editor_header_single_row = dims.width > 1030 || state.toolbarSingleRow;
      checks.compact_editor_actions_scrollable = dims.width > 1030
        || (state.actionToolbarScrollEnabled && state.actionToolbarDocumentBounded);
      checks.ai_connection_not_duplicated_in_header =
        await frame.locator("header.editor-header .ai-indicator").count() === 0;
      checks.empty_native_window_reservation = await frame
        .locator('.native-editor-aperture[data-native-editor-reservation="true"]')
        .evaluate((element) => element.childElementCount === 0
          && (element.textContent ?? "").trim() === ""
          && getComputedStyle(element).backgroundImage === "none");
      checks.no_native_ui_in_center = await frame.locator(
        ".native-stage button, .native-stage canvas, .native-stage img, .native-stage .native-placeholder, .native-stage .native-editor-heading, .native-stage .native-editor-note"
      ).count() === 0;
      checks.native_composition_not_claimed = await frame.locator(".native-editor-page").count() === 1;
      const sidePanels = await frame.locator('.unified-body').evaluate(element => {
        const native = element.querySelector('.native-stage');
        const center = element.querySelector('[data-native-editor-reservation="true"]');
        const explorer = element.querySelector('#ld-unified-explorer');
        const tools = element.querySelector('#ld-unified-inspector');
        const width = element.getBoundingClientRect().width;
        const nativeWidth = native?.getBoundingClientRect().width ?? 0;
        const centerRect = center?.getBoundingClientRect();
        return {
          nativeFraction: width > 0 ? nativeWidth / width : 0,
          nativeSize: centerRect ? { width: centerRect.width, height: centerRect.height } : null,
          explorerLabel: explorer?.getAttribute('aria-label') ?? null,
          toolsLabel: tools?.getAttribute('aria-label') ?? null,
          explorerRail: explorer?.classList.contains('rail') ?? false,
          diagnosticRail: tools?.classList.contains('rail') ?? false,
          diagnosticTabs: Array.from(tools?.querySelectorAll(
            '[role="tablist"][aria-label="Diagnostic sections"] [role="tab"]'
          ) ?? []).map(node => ({
            name: node.textContent?.trim().toLowerCase() ?? "",
            selected: node.getAttribute("aria-selected") === "true",
          })),
          diagnosticSelectedPanel: tools?.querySelector('[role="tabpanel"]:not([hidden])')?.id ?? null,
          diagnosticPanelCount: tools?.querySelectorAll('[role="tabpanel"]').length ?? 0,
          diagnosticTabBarHeight: tools?.querySelector('.diagnostic-tabs')
            ?.getBoundingClientRect().height ?? 0,
          diagnosticPanelBarHeight: tools?.querySelector('.diagnostic-panel-bar')
            ?.getBoundingClientRect().height ?? 0,
          diagnosticHeadingCount: tools?.querySelectorAll('.pane-heading').length ?? 0,
          diagnosticBarAtTop: (() => {
            const bar = tools?.querySelector('.diagnostic-panel-bar');
            return !!bar && !!tools &&
              Math.abs(bar.getBoundingClientRect().top - tools.getBoundingClientRect().top) < 1;
          })(),
          diagnosticCollapseBesideTabs: Boolean(
            tools?.querySelector('.diagnostic-panel-bar > button.diagnostic-collapse')
          ) && !tools?.querySelector('.diagnostic-tabs > button.diagnostic-collapse'),
          selectedTabBackground: (() => {
            const chosen = tools?.querySelector('.diagnostic-tabs [role="tab"][aria-selected="true"]');
            return chosen ? getComputedStyle(chosen).backgroundColor : null;
          })(),
          tabStripBackground: (() => {
            const strip = tools?.querySelector('.diagnostic-tabs');
            return strip ? getComputedStyle(strip).backgroundColor : null;
          })(),
          projectRowHeight: explorer?.querySelector('.project-line')
            ?.getBoundingClientRect().height ?? 0,
          modelRowHeight: explorer?.querySelector('.model-line')
            ?.getBoundingClientRect().height ?? 0,
          nativeBackground: center ? getComputedStyle(center).backgroundColor : null,
          theme: {
            ui: getComputedStyle(element.closest('.desktop-shell')?.querySelector('.unified-workspace') ?? element)
              .getPropertyValue('--color-ui').trim(),
            back: getComputedStyle(element.closest('.desktop-shell')?.querySelector('.unified-workspace') ?? element)
              .getPropertyValue('--color-back').trim(),
            accent: getComputedStyle(element.closest('.desktop-shell')?.querySelector('.unified-workspace') ?? element)
              .getPropertyValue('--color-accent').trim(),
          },
        };
      });
      checks.native_reservation_has_real_area = Boolean(sidePanels.nativeSize
        && sidePanels.nativeSize.width > 600 && sidePanels.nativeSize.height > 300);
      checks.native_editor_dominates_layout = sidePanels.nativeFraction >=
        (dims.width >= 1320 ? 0.70 : 0.80);
      checks.active_model_name_readable_default = dims.width < 1320 || await frame
        .locator('#ld-unified-explorer')
        .evaluate(explorer => {
          const label = explorer.querySelector('.model-line.current .model-name');
          return !label || label.scrollWidth <= label.clientWidth + 1;
        });
      checks.both_side_docks_present = (await frame.locator('#ld-unified-explorer').count()) === 1
        && (await frame.locator('#ld-unified-inspector').count()) === 1;
      checks.side_docks_have_accessible_names = sidePanels.explorerLabel === 'Project Explorer'
        && sidePanels.toolsLabel === 'Diagnostic';
      const shouldRail = dims.width < 1320;
      checks.dock_responsive_rails = sidePanels.explorerRail === shouldRail
        && sidePanels.diagnosticRail === shouldRail;
      checks.diagnostic_status_readable = shouldRail
        || await frame.locator('#ld-inspector-diagnostic .connection-status strong').count() === 1;
      checks.diagnostic_activity_truthful = shouldRail
        || (sidePanels.diagnosticTabs.map(tab => tab.name).join(",") === "diagnostic,activity"
          && sidePanels.diagnosticTabs.filter(tab => tab.selected).length === 1
          && sidePanels.diagnosticTabs[0].selected
          && sidePanels.diagnosticPanelCount === 2
          && sidePanels.diagnosticSelectedPanel === "ld-inspector-diagnostic");
      checks.blockbench_tab_strip_geometry = shouldRail
        || (Math.abs(sidePanels.diagnosticTabBarHeight - 40) < 1
          && Math.abs(sidePanels.diagnosticPanelBarHeight - 40) < 1);
      checks.single_diagnostic_panel_bar = shouldRail
        || (sidePanels.diagnosticHeadingCount === 0
          && sidePanels.diagnosticBarAtTop
          && sidePanels.diagnosticCollapseBesideTabs);
      checks.blockbench_selected_tab_colors = shouldRail
        || (sidePanels.selectedTabBackground === "rgb(30, 33, 39)"
          && sidePanels.tabStripBackground === "rgb(24, 27, 31)");
      checks.blockbench_outliner_row_density = shouldRail
        || (Math.abs(sidePanels.projectRowHeight - 28) < 1
          && (sidePanels.modelRowHeight === 0 || Math.abs(sidePanels.modelRowHeight - 28) < 1));
      checks.blank_native_area_uses_real_dark_token = sidePanels.nativeBackground === "rgb(16, 19, 22)";
      checks.default_dark_matches_blockbench_source = sidePanels.theme.ui === '#1e2127'
        && sidePanels.theme.back === '#181b1f'
        && sidePanels.theme.accent === '#3e90ff';
    }
    if (view === "workspace")
      checks.workspace_heading = await frame.locator('.page-toolbar h1').first().textContent() === "Workspace";
    if (view === "support")
      checks.support_heading = await frame.locator('.page-toolbar h1').first().textContent() === "Support";

    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-ui-preview-"));
    const png = join(dir, input.scenario + "-" + input.viewport + ".png");
    const json = join(dir, "receipt.json");
    await canvas.screenshot({ path: png, animations: "disabled" });
    const screenshotSha256 = createHash("sha256").update(await readFile(png)).digest("hex");
    checks.source_unchanged_during_render = git("rev-parse", "HEAD") === head
      && git("status", "--porcelain", "--untracked-files=all", "--", ...tracked) === "";
    checks.no_browser_errors = errors.length === 0;
    checks.no_remote_requests = denied.length === 0;
    const passed = Object.values(checks).every(Boolean);
    const receipt = {
      ...receiptBase,
      status: passed ? "F2_RENDERED_CHECKS_PASS" : "F2_RENDERED_CHECKS_FAILED",
      page: view, fixture: statusFixture, dimensions: dims,
      browser: "Chromium", browserVersion: browser.version(),
      locale: "en-GB", timezone: "Asia/Jakarta",
      deviceScaleFactor: 1,
      elapsedMs: Math.round(performance.now() - start),
      checks, browserErrors: errors.slice(0, 5),
      deniedRequests: denied.length, screenshot: png, screenshotSha256,
    };
    await writeFile(json, JSON.stringify(receipt, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ ...receipt, receipt: json }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await browser?.close();
    await viteServer?.close();
  }
}
main().catch(error => {
  console.error(JSON.stringify({ status: "NOT_VERIFIED", rendered: "NOT_CONFIRMED", message: String(error?.message ?? error) }));
  process.exitCode = 1;
});

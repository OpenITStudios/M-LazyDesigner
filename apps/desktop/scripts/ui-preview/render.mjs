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
        return box.width > 0 && box.height > 0 && box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
      };
      return {
        viewport,
        scrollWidth: document.documentElement.scrollWidth,
        nativeBridgeAbsent: typeof window.__TAURI_INTERNALS__ === "undefined",
        cssApplied: Boolean(root && getComputedStyle(root).display === "grid" && getComputedStyle(body).fontFamily),
        rootRect: root ? { width: root.getBoundingClientRect().width, height: root.getBoundingClientRect().height } : null,
        toolbarContained: Boolean(topbar && contained(topbar)),
        visibleToolbarButtons: visible.length,
        toolbarButtonsContained: visible.length > 0 && visible.every(contained),
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
          modelOverview: Boolean(tools?.querySelector('#ld-inspector-model')),
          checksInBlockbench: Boolean(tools?.querySelector('#ld-inspector-checks')),
        };
      });
      checks.native_reservation_has_real_area = Boolean(sidePanels.nativeSize
        && sidePanels.nativeSize.width > 600 && sidePanels.nativeSize.height > 300);
      checks.native_editor_dominates_layout = sidePanels.nativeFraction >=
        (dims.width >= 1810 ? 0.70 : dims.width >= 1320 ? 0.80 : 0.90);
      checks.side_docks_have_accessible_names = sidePanels.explorerLabel === 'Project Explorer'
        && (dims.width < 1810 || sidePanels.toolsLabel === 'Model Tools');
      checks.model_tools_sections_truthful = dims.width < 1810
        || (sidePanels.modelOverview && sidePanels.checksInBlockbench);
      const showPanels = dims.width >= 1810;
      checks.explorer_visible = (await frame.locator('#ld-unified-explorer').count() === 1) === (dims.width >= 920);
      checks.inspector_responsive = (await frame.locator('#ld-unified-inspector').count() === 1) === showPanels;
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

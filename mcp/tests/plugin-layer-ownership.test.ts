import { describe, expect, test } from "bun:test";

// Static ownership guards; executed reload behavior lives in plugin-settings-reload.
describe("Plugin architecture boundaries", () => {
  test("entrypoint delegates network, dev sync and Blockbench integration", async () => {
    const entry = await Bun.file("index.ts").text();
    for (const delegated of [
      'from "@/plugin/devSync"', 'from "@/plugin/runtimeHost"',
      "const runtimeHost = new RuntimeHost()", "runtimeHost.acquireNativeNetwork(generation)",
      "new BlockbenchIntegration()", "blockbenchIntegration.setupBase",
      "blockbenchIntegration.loadPrompts", "blockbenchIntegration.setupUi", "blockbenchIntegration.teardown",
    ]) expect(entry).toContain(delegated);
    for (const implementation of [
      "localDevFileWatcher", "SERVER_BIND_TIMEOUT_MS", "createNetServer(", "devFs.watch(",
      'requireNativeModule("http"', "settingsSetup()", "uiSetup({",
      "registerReferenceModelsResource()", "initPromptLoader()",
    ]) expect(entry).not.toContain(implementation);
  });

  test("RuntimeHost owns secure networking and listener teardown", async () => {
    const host = await Bun.file("plugin/runtimeHost.ts").text();
    for (const owned of [
      "export class RuntimeHost", "createNetServer", "beginRuntimeGenerationTeardown", "closeAndWait",
      'requireNativeModule("https"',
    ]) expect(host).toContain(owned);
    expect(host).not.toContain('requireNativeModule("http"');
  });

  test("development reload stays outside the production path", async () => {
    const watcher = await Bun.file("plugin/devSync.ts").text();
    expect(watcher).toContain('process.env.NODE_ENV !== "development"');
    expect(watcher).toContain("export function stopLocalDevAutoReload");
    expect(watcher).toContain("export function setupLocalDevAutoReload");
  });

  test("Blockbench integration owns setup and teardown services", async () => {
    const integration = await Bun.file("plugin/blockbenchIntegration.ts").text();
    for (const service of [
      "settingsSetup()", "registerReferenceModelsResource()", "await initPromptLoader()",
      "uiSetup({", "uiTeardown()", "settingsTeardown()",
    ]) expect(integration).toContain(service);
  });

  test("UI setup delegates disposal before rebuilding its panel", async () => {
    const ui = await Bun.file("ui/index.ts").text();
    const setup = ui.slice(ui.indexOf("export function uiSetup"));
    expect(setup).toContain("uiTeardown();");
  });
});

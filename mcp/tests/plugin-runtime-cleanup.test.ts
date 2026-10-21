import { describe, expect, test } from "bun:test";
import { setupLocalDevAutoReload, stopLocalDevAutoReload } from "@/plugin/devSync";
import { beginRuntimeGenerationTeardown, claimRuntimeGeneration } from "@/lib/runtime/lifecycle";
import {
  registerAuthoringRecipeOwnershipProperties,
  unregisterAuthoringRecipeOwnershipProperties,
} from "@/server/runtime/recipes/authoring/ownership";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("pre-local plugin runtime cleanup", () => {
  test("a throwing native dev watcher is detached and cannot block reload setup", async () => {
    const previousEnvironment = process.env.NODE_ENV;
    const originalPlugins = Object.getOwnPropertyDescriptor(globalThis, "Plugins");
    const originalRequire = Object.getOwnPropertyDescriptor(globalThis, "requireNativeModule");
    const buildIdentity = `sha256:${"a".repeat(64)}`;
    let created = 0;
    let closed = 0;
    const nativeFs = {
      readFileSync: () => "",
      watch: () => {
        created += 1;
        return {
          close: () => {
            closed += 1;
            if (closed === 1) throw new Error("native watcher was already invalidated");
          },
        };
      },
    };
    const { generation } = claimRuntimeGeneration(buildIdentity);
    try {
      process.env.NODE_ENV = "development";
      Object.defineProperty(globalThis, "Plugins", {
        configurable: true,
        value: { registered: { lazydesigner_mcp: {
          source: "file",
          path: "C:\\fixture\\lazydesigner_mcp.js",
          reload: () => undefined,
        } } },
      });
      Object.defineProperty(globalThis, "requireNativeModule", {
        configurable: true,
        value: (name: string) => {
          expect(name).toBe("fs");
          return nativeFs;
        },
      });
      setupLocalDevAutoReload(generation, buildIdentity);
      expect(created).toBe(1);
      expect(() => stopLocalDevAutoReload()).not.toThrow();
      expect(closed).toBe(1);
      setupLocalDevAutoReload(generation, buildIdentity);
      expect(created).toBe(2);
      stopLocalDevAutoReload();
      expect(closed).toBe(2);
    } finally {
      stopLocalDevAutoReload();
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (originalPlugins) Object.defineProperty(globalThis, "Plugins", originalPlugins);
      else Reflect.deleteProperty(globalThis, "Plugins");
      if (originalRequire) Object.defineProperty(globalThis, "requireNativeModule", originalRequire);
      else Reflect.deleteProperty(globalThis, "requireNativeModule");
      await beginRuntimeGenerationTeardown(generation, async () => {});
    }
  });


  test("one invalid native recipe property cannot prevent the others from releasing", () => {
    const prior = new Map(
      ["Cube", "ModelProject", "Property"].map(name => [
        name, Object.getOwnPropertyDescriptor(globalThis, name),
      ])
    );
    const deleted: string[] = [];
    try {
      Object.defineProperty(globalThis, "Cube", {
        configurable: true, value: { properties: {} },
      });
      Object.defineProperty(globalThis, "ModelProject", {
        configurable: true, value: { properties: {} },
      });
      Object.defineProperty(globalThis, "Property", {
        configurable: true,
        value: class {
          constructor(_target: unknown, _type: string, readonly name: string) {}
          delete() {
            deleted.push(this.name);
            if (this.name === "lazydesigner_authoring_recipe_store") {
              throw new Error("property already removed by Blockbench");
            }
          }
        },
      });
      registerAuthoringRecipeOwnershipProperties();
      expect(() => unregisterAuthoringRecipeOwnershipProperties()).not.toThrow();
      expect(deleted).toEqual([
        "lazydesigner_authoring_recipe_store",
        "lazydesigner_recipe_instance_id",
        "lazydesigner_recipe_id",
      ]);
      // Idempotent unload must not attempt deletion against old generations.
      unregisterAuthoringRecipeOwnershipProperties();
      expect(deleted).toHaveLength(3);
    } finally {
      unregisterAuthoringRecipeOwnershipProperties();
      for (const [name, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });

  test("plugin unload releases independent owners before the required Runtime listener barrier", async () => {
    const sourceCode = await source("index.ts");
    const begin = sourceCode.indexOf("function beginBlockItRuntimeTeardown");
    const end = sourceCode.indexOf("async function initializeBlockItRuntime", begin);
    const teardown = sourceCode.slice(begin, end);
    for (const [owner, warning] of [
      ["stopLocalDevAutoReload();", "Development watcher cleanup failed"],
      ["unregisterAuthoringRecipeOwnershipProperties();", "Recipe ownership cleanup failed"],
      ["setMcpPhaseSwitchHandler(undefined);", "Stage handler cleanup failed"],
      ["blockbenchIntegration.teardown();", "Blockbench integration cleanup failed"],
    ]) {
      expect(teardown).toContain(owner);
      expect(teardown).toContain(warning);
    }
    expect(teardown).toContain("runtimeHost.teardown(generation);");
    expect(teardown.indexOf("runtimeHost.teardown(generation);"))
      .toBeGreaterThan(teardown.indexOf("blockbenchIntegration.teardown();"));
  });


  test("MCP ownership is request-only with LazyDesigner identity", async () => {
    const server = await source("server/server.ts");
    const factories = await source("lib/factories.ts");

    expect(server).toContain("PRODUCT_NAME");
    expect(server).not.toContain("serverInstance");
    expect(server).not.toContain("getServer");
    expect(server).not.toContain("setServer");
    expect(factories).not.toContain('from "@/server/server"');
    expect(factories).not.toContain("const server = getServer()");
    expect(factories).toContain("registerToolsOnServer");
  });

  test("plugin uses unique install identity and does not report ready before HTTP bind", async () => {
    const [index, runtimeHost, tools, phaseControl, net] = await Promise.all([
      source("index.ts"),
      source("plugin/runtimeHost.ts"),
      source("server/tools.ts"),
      source("server/runtime/phaseControl.ts"),
      source("server/net.ts"),
    ]);

    const candidateCreated = runtimeHost.indexOf("const candidate = createNetServer(this.nativeHttp");
    const candidateOwned = runtimeHost.indexOf("this.httpServer = candidate;", candidateCreated);
    const listeningHook = runtimeHost.indexOf('server.once("listening"');
    const errorHook = runtimeHost.indexOf('server.once("error"');
    const bindCleanup = runtimeHost.indexOf("candidate.closeActiveSockets()", candidateCreated);
    const failedReturn = runtimeHost.indexOf("return false;", bindCleanup);
    const startCall = index.indexOf("if (!(await runtimeHost.start(generation, currentBuildIdentity()))) return;");
    const readyUi = runtimeHost.indexOf('setStatusBarState("running"');
    const listenerReady = runtimeHost.indexOf("await this.waitForListening(candidate)");

    expect(index).toContain('BBPlugin.register("lazydesigner_mcp"');
    expect(candidateCreated).toBeGreaterThan(-1);
    expect(candidateOwned).toBeGreaterThan(candidateCreated);
    expect(listeningHook).toBeGreaterThan(-1);
    expect(errorHook).toBeGreaterThan(-1);
    expect(bindCleanup).toBeGreaterThan(candidateCreated);
    expect(failedReturn).toBeGreaterThan(bindCleanup);
    expect(startCall).toBeGreaterThan(-1);
    expect(listenerReady).toBeGreaterThan(candidateOwned);
    expect(readyUi).toBeGreaterThan(listenerReady);

    expect(phaseControl).toMatch(/if \(!stageSwitchHandler\).*throw/s);
    expect(phaseControl).toContain("requestMcpPhaseSwitch");
    expect(phaseControl).toContain("stageSwitchHandler(stage)");
    expect(net).toContain("requestedAuthoringPhase !== null");
    expect(net).toContain("runWithMcpStageRequest(");
    expect(net).not.toContain("requestMcpPhaseSwitch(envelope.targetAuthoringPhase)");
    expect(tools).not.toContain("surface_changed: true");
    expect(phaseControl).toContain("reload_required: false");
  });

  test("phase switching follows the canonical Runtime profile without shadowing listener config", async () => {
    const [index, runtimeHost] = await Promise.all([
      source("index.ts"),
      source("plugin/runtimeHost.ts"),
    ]);

    expect(index).toContain("const activeProfile = getActiveMcpRegistrationProfile();");
    expect(index).toContain("applyMcpToolSurface(activeProfile, targetPhase);");
    expect(index).not.toContain("applyMcpToolSurface(registrationProfile, targetPhase);");
    expect(index).not.toContain("runtimeHost.updateSurface(");
    expect(runtimeHost).not.toContain("updateSurface(");
    expect(runtimeHost).not.toContain("updateProfile(");
    expect(runtimeHost).not.toContain("updatePhase(");
    expect(runtimeHost).not.toContain("this.config.profile");
    expect(runtimeHost).not.toContain("this.config.phase");
  });

  test("Blockbench lifecycle callbacks stay synchronous while async teardown is coordinator-owned", async () => {
    const index = await source("index.ts");
    const lifecycle = await source("lib/runtime/lifecycle.ts");

    expect(index).toContain("onload() {");
    expect(index).toContain("onunload() {");
    expect(index).not.toContain("async onload() {");
    expect(index).not.toContain("async onunload() {");
    expect(index).toContain("claimRuntimeGeneration(currentBuildIdentity(), beginBlockItRuntimeTeardown)");
    expect(index).toContain("beginBlockItRuntimeTeardown();");
    expect(index).toContain("initializationInProgress = null;");
    expect(lifecycle).toContain("priorTeardown");
    expect(lifecycle).toContain("beginRuntimeGenerationTeardown");
  });

  test("plugin unload detaches integration synchronously and drains listener ownership asynchronously", async () => {
    const [index, runtimeHost, integration, net, ui, status, settings] = await Promise.all([
      source("index.ts"),
      source("plugin/runtimeHost.ts"),
      source("plugin/blockbenchIntegration.ts"),
      source("server/net.ts"),
      source("ui/index.ts"),
      source("ui/statusBar.ts"),
      source("ui/settings.ts"),
    ]);

    const teardownStart = index.indexOf("function beginBlockItRuntimeTeardown");
    const integrationTeardown = index.indexOf("blockbenchIntegration.teardown();", teardownStart);
    const runtimeTeardown = index.indexOf("runtimeHost.teardown(generation);", teardownStart);
    expect(teardownStart).toBeGreaterThan(-1);
    expect(integrationTeardown).toBeGreaterThan(teardownStart);
    expect(runtimeTeardown).toBeGreaterThan(integrationTeardown);
    expect(integration).toContain("uiTeardown();");
    expect(integration).toContain("settingsTeardown();");
    expect(runtimeHost).toContain("const closePromise = current?.closeAndWait() ?? Promise.resolve();");
    expect(runtimeHost).toContain("beginRuntimeGenerationTeardown(generation");
    expect(net).toContain("activeSockets");
    expect(net).toContain("closeActiveSockets");
    expect(net).toContain("waitForRuntimeOperationDrain()");
    expect(net).toContain("ERR_SERVER_NOT_RUNNING");
    expect(ui).toContain("toolTestDialogTeardown()");
    expect(ui).toContain("promptPreviewDialogTeardown()");
    expect(ui).toContain("panelCssHandle?.delete()");
    expect(status).toContain("statusBarCssHandle?.delete()");
    expect(settings).toContain("settings.splice(0)");
  });

  test("native tool serialization survives listener replacement through the global coordinator", async () => {
    const net = await source("server/net.ts");
    const lifecycle = await source("lib/runtime/lifecycle.ts");

    expect(net).toContain("runRuntimeOperationExclusive(generation");
    expect(net).not.toContain("let runtimeRequestTail: Promise<void>");
    expect(lifecycle).toContain("operationTail: Promise<void>");
    expect(lifecycle).toContain("RuntimeGenerationRetiredError");
  });

  test("dead prompt CDN and stateless session settings are removed", async () => {
    const promptLoader = await source("lib/prompts/loader.ts");
    const settings = await source("ui/settings.ts");
    const i18n = await source("ui/i18n.ts");

    expect(promptLoader).not.toContain("CDN_BASE_URL");
    expect(promptLoader).not.toContain("remoteManifest");
    expect(promptLoader).not.toContain("refreshFromCDN");
    expect(settings).not.toContain("mcp_prompt_cdn_enabled");
    expect(settings).not.toContain("mcp_instructions");
    expect(i18n).not.toContain("session_timeout");
    expect(i18n).not.toContain("sse_heartbeat");
    expect(i18n).not.toContain("connected_clients");
  });

  test("package/runtime metadata identify LazyDesigner while upstream attribution remains documentation", async () => {
    const pkg = JSON.parse(await source("package.json")) as {
      name: string;
      description: string;
      author: string;
      contributors?: string[];
    };
    const readme = await source("README.md");

    expect(pkg.name).toBe("lazydesigner-bedrock-entity-mcp");
    expect(pkg.description).toContain("Minecraft Bedrock Entity");
    expect(pkg.author).toBe("Halo Karya Media");
    expect(pkg.contributors).toContain("Jason J. Gardner");
    expect(readme).toContain("upstream hosted plugin");
    expect(await Bun.file("server/types.ts").exists()).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("single LazyDesigner managed installation identity", () => {
  test("builder, plugin, manager, Desktop and release pipeline use the same product", async () => {
    const [identifiers, build, plugin, manager, packager, desktop, resource, workflow, pkg, lock] =
      await Promise.all([
        source("compatibility/engineering-identifiers.ts"),
        source("build/index.ts"),
        source("index.ts"),
        source("../distribution/cli.ts"),
        source("../distribution/package.ts"),
        source("../apps/desktop/src-tauri/src/system_status.rs"),
        source("../apps/desktop/scripts/prepare-managed-resource.ps1"),
        source("../.github/workflows/managed-distribution.yml"),
        source("package.json"),
        source("bun.lock"),
      ]);
    expect(identifiers).toContain("LAZYDESIGNER_PLUGIN_PATH");
    expect(identifiers).toContain("__LAZYDESIGNER_BUILD_ID__");
    expect(build).toContain("MCP_BUNDLE_FILENAME");
    expect(build).toContain("globalThis.__LAZYDESIGNER_BUILD_ID__");
    expect(plugin).toContain('BBPlugin.register("lazydesigner_mcp"');
    expect(packager).toContain('join(packageDir, "lazydesigner.exe")');
    expect(packager).toContain('"lazydesigner-package.json"');
    expect(manager).toContain('process.env.LAZYDESIGNER_HOME');
    expect(manager).toContain('"LazyDesigner", "managed"');
    expect(manager).toContain('parsed.mcp_servers?.lazydesigner?.env?.LAZYDESIGNER_RUNTIME_URL');
    expect(desktop).toContain('"resources/managed/lazydesigner.exe"');
    expect(desktop).toContain('join("plugins").join("lazydesigner_mcp.js")');
    expect(resource).toContain("'lazydesigner-package.json'");
    expect(workflow).toContain("lazydesigner-windows-x64.zip");
    expect(workflow).toContain("lazydesigner-package.json");
    expect(JSON.parse(pkg).name).toBe("lazydesigner-bedrock-entity-mcp");
    expect(JSON.parse(pkg).main).toBe("dist/lazydesigner_mcp.js");
    // Bun lockfiles use JSONC, including trailing commas: JSON.parse is invalid.
    // Anchor the name to the root workspace, not any transitively named package.
    expect(lock).toMatch(/"workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"lazydesigner-bedrock-entity-mcp"/);
    expect(plugin).not.toContain('BBPlugin.register("blockit_mcp"');
    expect(manager).not.toContain('process.env.BLOCKIT_HOME');
  });

  test("Runtime health and plugin lease reuse the canonical product ID", async () => {
    const [identity, runtime, lease] = await Promise.all([
      source("compatibility/lazydesigner-identity.ts"),
      source("lib/product/productIdentity.ts"),
      source("plugin/runtimeSessionLease.ts"),
    ]);
    expect(identity).toContain('runtimeProductId: "lazydesigner-bedrock-entity-mcp"');
    expect(runtime).toContain("PRODUCT_ID = LAZYDESIGNER_IDENTITY.runtimeProductId");
    expect(lease).toContain("product_id: PRODUCT_ID");
  });

  test("retired BlockIT may be inspected, never silently adopted as active Runtime", async () => {
    const [managed, native, gateway, affinity, tls] = await Promise.all([
      source("../distribution/managed-install.ts"),
      source("server/net.ts"),
      source("gateway/contracts/protocol.ts"),
      source("lib/runtime/affinity.ts"),
      source("lib/runtime/connection.ts"),
    ]);
    expect(managed).toContain("before.mcp_servers?.blockit");
    expect(managed).toContain('const retiredPlugin = join(dirname(options.plugin), "blockit_mcp.js")');
    expect(managed).toContain("# BEGIN LAZYDESIGNER MANAGED");
    expect(managed).toContain('Retired BlockIT plugin exists in this Blockbench profile');
    expect(native).toContain("__LAZYDESIGNER_BUILD_ID__");
    expect(gateway).toContain('GATEWAY_NAME = "lazydesigner-gateway"');
    expect(affinity).toContain('"x-lazydesigner-project-uuid"');
    expect(affinity).toContain('"x-lazydesigner-authoring-stage"');
    expect(tls).toContain("env.LAZYDESIGNER_TLS_DIR");
    expect(tls).not.toContain("env.BLOCKIT_TLS_DIR");
  });

  test("live verifier and packaged Gateway both require canonical build proof", async () => {
    const [live, probe, cli, backend, desktop, contract] = await Promise.all([
      source("scripts/verify/live-e2e-common.ts"),
      source("scripts/verify/verify-stateless-local.ts"),
      source("../distribution/cli.ts"),
      source("gateway/runtime/backend.ts"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("plugin/runtimeSessionLease.ts"),
    ]);
    expect(live).toContain("LAZYDESIGNER_AUTHORING_STAGE_AFFINITY_HEADER");
    expect(live).toContain("__LAZYDESIGNER_BUILD_ID__");
    expect(probe).toContain("dist/lazydesigner_mcp.js");
    expect(cli).toContain("process.env.LAZYDESIGNER_EXPECTED_RUNTIME_BUILD_ID");
    expect(backend).toContain("verifyRuntimeBuildIdentity");
    expect(desktop).toContain("runtime_build_match");
    expect(contract).toContain("build_identity: string");
  });
});

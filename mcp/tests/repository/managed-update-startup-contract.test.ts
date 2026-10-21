import { describe, expect, test } from "bun:test";
import { createMaintenanceOperations, planManagedAction } from "../../../apps/desktop/src/maintenanceOperations";
import type { DesktopInvoke, ManagedUpdateCheck, SystemStatus } from "../../../apps/desktop/src/desktopTypes";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("Desktop maintenance operations", () => {
  test("only the verified staged source is sent for a pending update", async () => {
    const status = { managed: { pending: true } } as SystemStatus;
    const check: ManagedUpdateCheck = {
      status: "UPDATE_AVAILABLE", installed_source_sha: "a".repeat(40),
      available_source_sha: "b".repeat(40), tag: null, published_at: null,
    };
    expect(planManagedAction("update", status, check)).toBeNull();
    expect(planManagedAction("update", status, null)).toBeNull();
    const request = planManagedAction("update", status, { ...check, status: "UPDATE_STAGED" });
    expect(request).toEqual({ action: "update", expectedSourceSha: "b".repeat(40) });
    const calls: unknown[] = [];
    const invoke: DesktopInvoke = async (command, args) => {
      calls.push({ command, args });
      return { action: "update", receipt: { status: "STAGED" } } as never;
    };
    if (!request) throw new Error("Expected a verified request");
    const feedback = await createMaintenanceOperations(invoke).execute(request);
    expect(feedback.kind).toBe("pending");
    expect(calls).toEqual([{ command: "managed_action", args: { action: "update", expectedSourceSha: check.available_source_sha } }]);
  });

  test("startup discovery is one-shot and only explicit reset allows another attempt", async () => {
    let attempts = 0;
    const invoke: DesktopInvoke = async () => { attempts += 1; throw new Error("Offline"); };
    const operations = createMaintenanceOperations(invoke);
    expect(await operations.checkUpdate(false)).toBeUndefined();
    expect(attempts).toBe(0);
    expect(await operations.checkUpdate(true)).toBeNull();
    expect(await operations.checkUpdate(true)).toBeUndefined();
    expect(attempts).toBe(1);
    operations.resetUpdateCheck();
    expect(await operations.checkUpdate(true)).toBeNull();
    expect(attempts).toBe(2);
  });
});

describe("managed startup update contract", () => {
  test("managed releases publish a lightweight digest-verifiable manifest beside the full package", async () => {
    const [packager, workflow] = await Promise.all([
      source("../distribution/package.ts"),
      source("../.github/workflows/managed-distribution.yml"),
    ]);

    expect(packager).toContain('join(output, "lazydesigner-package.json")');
    expect(workflow).toContain("mcp/dist/managed/lazydesigner-package.json");
    expect(workflow).toContain('gh release create "$TAG" lazydesigner-windows-x64.zip lazydesigner-package.json');
  });

  test("install and update reject old-profile conflicts before staging or TLS", async () => {
    const [cli, install] = await Promise.all([
      source("../distribution/cli.ts"),
      source("../distribution/managed-install.ts"),
    ]);
    const preflight = cli.indexOf("await preflightManagedInstallTargets(");
    const staging = cli.indexOf("const staging = command ===");
    const provision = cli.indexOf('progress("install", "provisioning-runtime-security")');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(staging);
    expect(preflight).toBeLessThan(provision);
    expect(install).toContain("await requirePlainPath(retiredPlugin)");
    expect(install).toContain("configureCodex(configuration, executable, parseToml, adopt)");
    expect(install).toContain("await preflightManagedInstallTargets(options, join(version,");
  });

  test("check-update is read-only and separated from full package download", async () => {
    const cli = await source("../distribution/cli.ts");
    const checkStart = cli.indexOf("async function checkUpdate()");
    const fetchStart = cli.indexOf("async function fetchRelease()", checkStart);
    expect(checkStart).toBeGreaterThanOrEqual(0);
    expect(fetchStart).toBeGreaterThan(checkStart);

    const check = cli.slice(checkStart, fetchStart);
    expect(check).toContain("fetchPublishedRelease()");
    expect(check).toContain("fetchUpdateManifest(release)");
    expect(check).toContain('"UP_TO_DATE"');
    expect(check).toContain('"UPDATE_AVAILABLE"');
    expect(check).toContain('"UPDATE_STAGED"');
    expect(check).not.toContain("RELEASE_ASSET");
    expect(check).not.toContain("installPackage(");
    expect(check).not.toContain("atomicWrite(");
    expect(check).not.toContain("activatePending(");
    expect(cli).toContain('if (command === "check-update") { receipt(await checkUpdate()); return; }');
  });

  test("Desktop invokes update discovery once after local status and never from heartbeat/focus handlers", async () => {
    const app = await source("../apps/desktop/src/App.svelte");
    expect(app).toContain("async function checkManagedUpdateOnce()");
    const operations = await source("../apps/desktop/src/maintenanceOperations.ts");
    expect(operations).toContain("updateCheckStarted");
    expect(operations).toContain("await invoke<ManagedUpdateCheck>('check_managed_update')");
    expect(app).toContain("maintenanceOperations.checkUpdate(!devFixture && !!status?.manager_available)");
    expect(app).toContain("void checkManagedUpdateOnce();");

    const monitor = await source("../apps/desktop/src/connectionMonitor.ts");
    expect(monitor).not.toContain("checkManagedUpdateOnce");
    expect(monitor).not.toContain("check_managed_update");

    const mountStart = app.indexOf("onMount(() =>");
    const destroyStart = app.indexOf("</script>", mountStart);
    const mount = app.slice(mountStart, destroyStart);
    expect(mount.match(/checkManagedUpdateOnce\(\)/g)?.length).toBe(1);
    expect(mount).not.toMatch(/setInterval\([^\n]*checkManagedUpdateOnce/);
  });

  test("Desktop passes the exact selected source through Rust to the installer", async () => {
    const [app, rust, main, cli] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../distribution/cli.ts"),
    ]);
    const operations = await source("../apps/desktop/src/maintenanceOperations.ts");
    expect(operations).toContain("updateCheck.available_source_sha");
    expect(operations).toContain("expectedSourceSha: request.expectedSourceSha");
    expect(app).toContain("planManagedAction(action, status, updateCheck)");
    expect(app).toContain("maintenanceOperations.execute(request)");
    expect(main).toContain("expected_source_sha: Option<String>");
    expect(rust).toContain('command.arg("--expected-source-sha").arg(sha)');
    expect(rust).toContain('A verified selected update source is required.');
    expect(cli).toContain("requireExpectedUpdateSource(publishedManifest, expectedSourceSha)");
    expect(cli).toContain("requireExpectedUpdateSource(await verifyPackage(pending.directory), expectedSourceSha)");
  });

  test("a staged update revalidates in place and never offers activation without proof", async () => {
    const app = await source("../apps/desktop/src/App.svelte");
    const action = app.slice(
      app.indexOf("async function runManagedAction("),
      app.indexOf("onMount(() =>")
    );
    expect(action).toContain("if (feedback.status === 'STAGED')");
    expect(action).toContain("maintenanceOperations.resetUpdateCheck()");
    expect(action).toContain("await checkManagedUpdateOnce()");
    expect(app).toContain("async function verifyPendingUpdate()");
    const workspace = await source("../apps/desktop/src/WorkspacePage.svelte");
    expect(app).toContain("<WorkspacePage");
    expect(workspace).toContain("onclick={verifyPendingUpdate}");
    expect(workspace).toContain("updateCheck?.status === 'UPDATE_STAGED_UNVERIFIED'");
    expect(workspace).toContain("updateCheck?.status !== 'UPDATE_STAGED'");
  });

  test("managed Gateway receives the exact installed Runtime build identity", async () => {
    const [cli, backend, identity] = await Promise.all([
      source("../distribution/cli.ts"),
      source("gateway/runtime/backend.ts"),
      source("gateway/runtime/identity.ts"),
    ]);
    expect(cli).toContain("process.env.LAZYDESIGNER_EXPECTED_RUNTIME_BUILD_ID = installedPackage.build_identity");
    expect(cli).toContain("await verifyPackage(");
    expect(backend).toContain("process.env.LAZYDESIGNER_EXPECTED_RUNTIME_BUILD_ID");
    expect(backend).toContain("verifyRuntimeBuildIdentity(body, this.expectedRuntimeBuildIdentity)");
    expect(identity).toContain("product.id !== PRODUCT_ID");
    expect(identity).toContain("root.build_identity !== expectedBuildIdentity");
  });

  test("Desktop backend exposes a bounded dedicated read-only check command", async () => {
    const [main, status] = await Promise.all([
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
    ]);
    expect(main).toContain("fn check_managed_update()");
    expect(main).toContain("check_managed_update,");
    expect(status).toContain('arg("check-update")');
    expect(status).toContain("Duration::from_secs(12)");
    expect(status).toContain('"UPDATE_AVAILABLE"');
    expect(status).toContain('"UPDATE_STAGED"');
  });
});

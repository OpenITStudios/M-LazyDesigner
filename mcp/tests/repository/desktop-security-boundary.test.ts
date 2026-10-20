import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("Desktop security boundary", () => {
  test("Tauri CSP stays local-only and forbids executable/embed escape hatches", async () => {
    const config = JSON.parse(
      await source("../apps/desktop/src-tauri/tauri.conf.json")
    ) as {
      app: { security: { csp: string } };
    };
    const csp = config.app.security.csp;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain(
      "connect-src 'self' ipc: http://ipc.localhost"
    );
    expect(csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
  });

  test("Tauri dependency surface excludes high-privilege plugins not required by the control plane", async () => {
    const [cargo, packageJson] = await Promise.all([
      source("../apps/desktop/src-tauri/Cargo.toml"),
      source("../apps/desktop/package.json"),
    ]);

    for (const plugin of [
      "tauri-plugin-shell",
      "tauri-plugin-fs",
      "tauri-plugin-http",
      "tauri-plugin-process",
      "tauri-plugin-opener",
    ]) {
      expect(cargo).not.toContain(plugin);
      expect(packageJson).not.toContain(plugin);
    }
    const manifest = Bun.TOML.parse(cargo) as { dependencies: { tauri: { version: string; features: string[] } } };
    expect(manifest.dependencies.tauri.version.split(".")[0]).toBe("2");
    expect(manifest.dependencies.tauri.features).toEqual([]);
  });

  test("Tauri Rust runtime and npm API/CLI preserve matching minor versions", async () => {
    const [cargoLock, npmLock] = await Promise.all([
      source("../apps/desktop/src-tauri/Cargo.lock"),
      source("../apps/desktop/package-lock.json"),
    ]);
    const rustVersion = cargoLock.match(
      /^\[\[package\]\]\r?\nname = "tauri"\r?\nversion = "(\d+\.\d+\.\d+)"/m
    )?.[1];
    expect(rustVersion).toBeDefined();
    const lock = JSON.parse(npmLock) as {
      packages: Record<string, { version?: string }>;
    };
    const minor = rustVersion?.split(".").slice(0, 2).join(".");
    for (const dependency of ["@tauri-apps/api", "@tauri-apps/cli"]) {
      const version = lock.packages["node_modules/" + dependency]?.version;
      expect(version, dependency).toBeDefined();
      expect(version?.split(".").slice(0, 2).join("."), dependency).toBe(minor);
    }
  });

  test("Desktop NSIS installer retains explicit downgrade protection", async () => {
    const config = JSON.parse(await source("../apps/desktop/src-tauri/tauri.conf.json")) as {
      bundle: { windows: { allowDowngrades: boolean } };
    };
    expect(config.bundle.windows.allowDowngrades).toBe(false);
  });

  test("Desktop command surface delegates mutation to an exact managed-action allowlist", async () => {
    const [main, status] = await Promise.all([
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
    ]);

    expect(main).toContain("system_status::run_managed_action(&app, &action, expected_source_sha.as_deref())");
    expect(status).toContain(
      'matches!(action, "update" | "rollback" | "recover" | "repair" | "setup-tls")'
    );
    expect(status).toContain("Unsupported LazyDesigner desktop action.");
    expect(status).toContain("let mut command = Command::new(&executable)");
    expect(status).toContain('command.arg(action).arg("--root").arg(&root).arg("--progress-json")');
    expect(status).toContain('command.arg("--expected-source-sha").arg(sha)');
    expect(status).not.toContain("cmd /C");
  });

  test("operation journal is bounded, rotated and metadata-only", async () => {
    const log = await source(
      "../apps/desktop/src-tauri/src/operation_log.rs"
    );

    expect(log).toContain("const MAX_LOG_BYTES: u64 = 512 * 1024");
    expect(log).toContain('join("LazyDesigner").join("logs")');
    expect(log).toContain('dir.join("desktop.log.1")');
    expect(log).toContain("clean_token(event)");
    expect(log).toContain("clean_token(outcome)");
    expect(log).toContain(".take(64)");
    expect(log).not.toContain("serde_json");
    expect(log).not.toContain("arguments");
    expect(log).not.toContain("payload");
    expect(log).not.toContain("prompt");
  });

  test("Desktop verify and draft-release both gate high-severity npm advisories", async () => {
    const [verifyWorkflow, releaseWorkflow] = await Promise.all([
      source("../.github/disabled-workflows/desktop-verify.yml"),
      source("../.github/workflows/desktop-draft-release.yml"),
    ]);

    for (const workflow of [verifyWorkflow, releaseWorkflow]) {
      expect(workflow).toContain("npm ci");
      expect(workflow).toContain("npm audit --audit-level=high");
    }
  });

  test("diagnostic export explicitly excludes project, environment, TLS key and Codex config data", async () => {
    const diagnostics = await source(
      "../apps/desktop/src-tauri/src/diagnostics.rs"
    );

    for (const field of [
      '"contains_project_content": false',
      '"contains_environment_variables": false',
      '"contains_tls_private_key": false',
      '"contains_codex_config": false',
    ]) {
      expect(diagnostics).toContain(field);
    }
    expect(diagnostics).not.toContain("std::env::vars");
    expect(diagnostics).not.toContain("key.pem");
    expect(diagnostics).not.toContain("config.toml");
  });
});

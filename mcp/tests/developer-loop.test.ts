import { describe, expect, test } from "bun:test";

test("plugin bundles tinycolor2 instead of requesting an unsupported native module", async () => {
  const source = await Bun.file("build/index.ts").text();
  const external = source.match(/external:\s*\[([\s\S]*?)\]/)?.[1];
  expect(external).toBeDefined();
  expect(external).not.toContain('"tinycolor2"');
  expect(external).not.toContain('"three"');
});
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePromptManifest } from "@/build/generate-manifest";
import {
  RUNTIME_WATCH_TARGETS,
  classifyWatchPath,
} from "@/build/watch-policy";
import {
  deployArtifact,
  extractBuildIdentity,
  resolveDeployTarget,
} from "@/scripts/operations/deploy-local";

describe("developer loop", () => {
  test("authoritative typecheck reuses only ignored local incremental state", async () => {
    const [packageJson, tsconfig, gitignore] = await Promise.all([
      Bun.file("package.json").json(),
      Bun.file("tsconfig.json").json(),
      Bun.file("../.gitignore").text(),
    ]);

    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
    expect(packageJson.scripts["typecheck:profile"]).toBe(
      "tsc --noEmit --extendedDiagnostics"
    );
    expect(tsconfig.compilerOptions.incremental).toBe(true);
    expect(tsconfig.compilerOptions.tsBuildInfoFile).toBe(
      ".cache/tsconfig.tsbuildinfo"
    );
    expect(gitignore).toContain("mcp/.cache/");
  });

  test("watch mode observes production inputs instead of the entire MCP tree", async () => {
    const packageJson = await Bun.file("package.json").json();
    const buildSource = await Bun.file("build/index.ts").text();

    expect(packageJson.scripts["dev:watch"]).toBe(
      "bun run prompts:build && bun run ./build --sourcemap --watch"
    );
    expect(
      packageJson.scripts["dev:watch"].match(/prompts:build/g)?.length ?? 0
    ).toBe(1);
    expect(buildSource).not.toContain('watch("./"');
    expect(buildSource).toContain("RUNTIME_WATCH_TARGETS.map");

    expect(RUNTIME_WATCH_TARGETS.map((entry) => entry.path)).toEqual([
      "index.ts",
      "icon.svg",
      "about.md",
      "server",
      "lib",
      "ui",
      "macros",
      "prompts/bedrock_entity_workflow.md",
    ]);

    expect(classifyWatchPath("server/tools/geometry/cubes.ts")).toBe("rebuild");
    expect(classifyWatchPath("lib/factories.ts")).toBe("rebuild");
    expect(classifyWatchPath("ui/settings.ts")).toBe("rebuild");
    expect(classifyWatchPath("macros/getIcon.ts")).toBe("rebuild");
    expect(classifyWatchPath("prompts/bedrock_entity_workflow.md")).toBe(
      "regenerate-prompts-and-rebuild"
    );
    expect(classifyWatchPath("tests/developer-loop.test.ts")).toBe("ignore");
    expect(classifyWatchPath("docs/api.json")).toBe("ignore");
    expect(classifyWatchPath("prompts/manifest.json")).toBe("ignore");
  });

  test("dev sync owns build, atomic deploy, native reload, and live freshness", async () => {
    const [packageJson, buildSource, entrySource, devSyncSource, deploySource, readme] = await Promise.all([
      Bun.file("package.json").json(),
      Bun.file("scripts/operations/dev-sync.ts").text(),
      Bun.file("index.ts").text(),
      Bun.file("plugin/devSync.ts").text(),
      Bun.file("scripts/operations/deploy-local.ts").text(),
      Bun.file("README.md").text(),
    ]);

    expect(packageJson.scripts["dev:sync"]).toBe(
      "bun run ./scripts/operations/dev-sync.ts"
    );
    expect(buildSource).toContain('["run", "dev:watch"]');
    expect(buildSource).toContain("resolveDeployTarget(Bun.argv.slice(2), process.env)");
    expect(buildSource).toContain("deployArtifact(ARTIFACT_PATH, target)");
    expect(buildSource).toContain("waitForLiveBuildIdentity(receipt.build_identity)");
    expect(buildSource).toContain("LIVE_SYNCED");
    expect(buildSource).toContain("STALE_BUILD");
    expect(buildSource).toContain("DEPLOYED_OFFLINE");

    expect(devSyncSource).toContain('process.env.NODE_ENV !== "development"');
    expect(devSyncSource).toContain('plugin.source !== "file"');
    expect(devSyncSource).toContain('requireNativeModule("fs"');
    expect(devSyncSource).toContain("watchDirectory");
    expect(devSyncSource).toContain("plugin.reload?.()");
    expect(devSyncSource).toContain("isRuntimeGenerationCurrent(generation)");
    expect(entrySource).toContain("claimRuntimeGeneration");
    expect(entrySource).toContain("beginBlockItRuntimeTeardown");
    expect(entrySource).toContain("setupLocalDevAutoReload(generation, currentBuildIdentity())");
    expect(entrySource).not.toContain("watchDirectory");
    expect(entrySource).not.toContain('requireNativeModule("fs"');
    expect(entrySource).not.toContain("await teardownBlockItRuntime()");

    expect(deploySource).toContain("await copyFile(source, stagedTarget)");
    expect(deploySource).toContain("await rename(stagedTarget, target)");
    expect(deploySource).not.toContain("await copyFile(source, target)");
    expect(readme).toContain("bun run dev:sync");
    expect(readme).toContain("LIVE_SYNCED");
  });

  test("prompt generator is import-safe for watch-mode reuse", () => {
    expect(typeof generatePromptManifest).toBe("function");
  });

  test("local deploy requires one explicit absolute stable plugin path", () => {
    const root = mkdtempSync(join(tmpdir(), "blockit-deploy-target-"));
    try {
      const target = join(root, "lazydesigner_mcp.js");
      expect(resolveDeployTarget([target], {})).toBe(target);
      expect(resolveDeployTarget([], { LAZYDESIGNER_PLUGIN_PATH: target })).toBe(target);
      expect(() => resolveDeployTarget([], {})).toThrow(/Missing local Blockbench plugin destination/);
      expect(() => resolveDeployTarget(["relative/lazydesigner_mcp.js"], {})).toThrow(
        /absolute filesystem path/
      );
      expect(() => resolveDeployTarget([join(root, "wrong-name.js")], {})).toThrow(
        /lazydesigner_mcp\.js/
      );
      expect(() => resolveDeployTarget([target, target], {})).toThrow(
        /exactly one destination path/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local deploy atomically replaces exact built bytes and preserves build identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "blockit-deploy-copy-"));
    try {
      const sourceDir = join(root, "source");
      const installDir = join(root, "installed");
      mkdirSync(sourceDir);
      mkdirSync(installDir);

      const source = join(sourceDir, "lazydesigner_mcp.js");
      const target = join(installDir, "lazydesigner_mcp.js");
      const stagedTarget = `${target}.next-${process.pid}`;
      const identity = `sha256:${"a".repeat(64)}` as const;
      const content = `globalThis.__LAZYDESIGNER_BUILD_ID__ = ${JSON.stringify(identity)};\nconsole.log("fixture");\n`;
      await Bun.write(source, content);
      await Bun.write(target, "old complete plugin\n");

      expect(extractBuildIdentity(content)).toBe(identity);
      const receipt = await deployArtifact(source, target);
      expect(receipt).toEqual({ target, build_identity: identity });
      expect(await Bun.file(target).text()).toBe(content);
      expect(await Bun.file(stagedTarget).exists()).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

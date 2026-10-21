import { test } from "bun:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyTransaction, configureCodex, installPackage, installedState, parseManifest, parsePublishedReleaseManifest, LEGACY_REPOSITORY, readOptional, recoverInstallation, repairInstallation, rollbackStatus, REPOSITORY, requireMatchingReleaseManifest, requireExpectedUpdateSource, preflightManagedInstallTargets, requirePlainPath, sameInstalledPath, sha256, SKILLS, PACKAGE_SOURCE_PATHS, withInstallLock, type InstallOptions, type Manifest } from "../../distribution/managed-install";
import { MODELLING_PATH, TEXTURING_PATH, ANIMATION_PATH, PROFILE_PATHS } from "../gateway/control/contexts";
const parse = (s: string): any => Bun.TOML.parse(s);

test("installation identity survives native Windows path virtualization", async () => {
  await sandbox(async (directory, options) => {
    const source = join(directory, "package");
    await fixture(source);
    await installPackage(source, options, parse);
    const physicalRoot = realpathSync.native(options.root);
    assert.equal((await installedState(physicalRoot))?.source_sha, "a".repeat(40));
    const executable = join(options.root, "versions", "a".repeat(40), "lazydesigner.exe");
    assert.equal(sameInstalledPath(executable, realpathSync.native(executable)), true);
    assert.equal(sameInstalledPath(executable, join(source, "lazydesigner.exe")), false);
  });
});

async function fixture(directory: string, digit = "a"): Promise<Manifest> {
  const paths = ["lazydesigner.exe", "lazydesigner_mcp.js", "AGENTS.md", "THIRD_PARTY_NOTICES.txt", ...PACKAGE_SOURCE_PATHS];
  const manifest: Manifest = { schema: 1, repository: REPOSITORY, source_sha: digit.repeat(40), build_identity: "sha256:" + digit.repeat(64), platform: "windows-x64", files: [] };
  for (const path of paths) {
    const bytes = Buffer.from(path === "lazydesigner_mcp.js" ? `globalThis.__LAZYDESIGNER_BUILD_ID__="${manifest.build_identity}";` : `Fixture ${path} ${digit}\n`);
    await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), bytes);
    manifest.files.push({ path, size: bytes.length, sha256: sha256(bytes) });
  }
  await writeFile(join(directory, "lazydesigner-package.json"), JSON.stringify(manifest)); return manifest;
}
async function sandbox(work: (directory: string, options: InstallOptions) => Promise<void>): Promise<void> {
  const d = await mkdtemp(join(tmpdir(), "lazydesigner-install-"));
  try { await work(d, { root: join(d, "installed"), workspace: join(d, "assets"), plugin: join(d, "plugins/lazydesigner_mcp.js"), config: join(d, "codex/config.toml") }); }
  finally { await rm(d, { recursive: true, force: true }); }
}

test("package paths and complete required files are fail-closed", async () => sandbox(async d => {
  const manifest = await fixture(join(d, "pkg")); assert.equal(parseManifest(manifest).files.length, 4 + PACKAGE_SOURCE_PATHS.length);
  for (const required of [".agents/skills/lazydesigner-modelling/references/uv-layout.md", "docs/03-authoring/modelling/profiles/generic.md"]) {
    assert.throws(() => parseManifest({ ...manifest, files: manifest.files.filter(file => file.path !== required) }), /Incomplete package/);
  }
  for (const path of ["../config.toml", "C:/evil.exe", ".agents/skills/other/SKILL.md", "workspace/active/model.bbmodel"]) {
    assert.throws(() => parseManifest({ ...manifest, files: [...manifest.files, { path, size: 1, sha256: "a".repeat(64) }] }));
  }
  assert.throws(() => parseManifest({ ...manifest, files: manifest.files.slice(1) }));
  assert.throws(() => parseManifest({ ...manifest, files: [...manifest.files, manifest.files[0]] }));
}));


test("current remote releases and legacy local packages keep separate trust boundaries", async () => {
  await sandbox(async directory => {
    const fresh = await fixture(join(directory, "current"));
    assert.equal(REPOSITORY, "OpenITStudios/M-LazyDesigner");
    assert.equal(fresh.repository, REPOSITORY);
    assert.equal(parsePublishedReleaseManifest(fresh).repository, REPOSITORY);

    // Old on-disk manifests must remain verifiable for existing installations
    // and rollback; they are never accepted as a newly published update.
    const previous = { ...fresh, repository: LEGACY_REPOSITORY };
    assert.equal(parseManifest(previous).repository, LEGACY_REPOSITORY);
    assert.throws(() => parsePublishedReleaseManifest(previous), /unexpected repository identity/);
    assert.throws(() => parseManifest({ ...fresh, repository: "other-owner/M-LazyDesigner" }), /Invalid LazyDesigner package manifest/);
    assert.throws(() => parsePublishedReleaseManifest({ ...fresh, repository: "other-owner/M-LazyDesigner" }));
    assert.throws(() => requireMatchingReleaseManifest(previous, fresh), /does not match the published release manifest/);
  });
});

test("selected update source SHA rejects a changed candidate before writing", async () => {
  await sandbox(async directory => {
    const candidate = await fixture(join(directory, "new"), "a");
    assert.doesNotThrow(() => requireExpectedUpdateSource(candidate, candidate.source_sha));
    assert.throws(() => requireExpectedUpdateSource(candidate, "b".repeat(40)), /Selected update changed/);
    assert.throws(() => requireExpectedUpdateSource(candidate, "unexpected"), /source identity is invalid/);
    assert.doesNotThrow(() => requireExpectedUpdateSource(candidate, null));
  });
});

test("update refuses valid but different release package identities and inventory", async () => {
  await sandbox(async directory => {
    const published = await fixture(join(directory, "published"), "a");
    const same = structuredClone(published);
    assert.doesNotThrow(() => requireMatchingReleaseManifest(same, published));

    const differentSource = structuredClone(published);
    differentSource.source_sha = "b".repeat(40);
    assert.throws(
      () => requireMatchingReleaseManifest(differentSource, published),
      /does not match the published release manifest/
    );

    const differentBuild = structuredClone(published);
    differentBuild.build_identity = "sha256:" + "b".repeat(64);
    assert.throws(
      () => requireMatchingReleaseManifest(differentBuild, published),
      /does not match the published release manifest/
    );

    const differentFile = structuredClone(published);
    differentFile.files[0]!.sha256 = "b".repeat(64);
    assert.throws(
      () => requireMatchingReleaseManifest(differentFile, published),
      /does not match the published release manifest/
    );
  });
});

test("managed package covers every Runtime-required Skill/profile context", async () => {
  const required = [MODELLING_PATH, TEXTURING_PATH, ANIMATION_PATH, ...Object.values(PROFILE_PATHS)];
  for (const path of required) {
    assert.ok(PACKAGE_SOURCE_PATHS.includes(path), `Missing managed context: ${path}`);
  }
  await sandbox(async d => {
    const manifest = await fixture(join(d, "pkg"));
    for (const path of required) {
      assert.throws(() => parseManifest({
        ...manifest, files: manifest.files.filter(file => file.path !== path),
      }), /Incomplete package/);
    }
  });
});

test("corrupt payload cannot change active installation", async () => sandbox(async (d, o) => {
  const pkg = join(d, "pkg"); await fixture(pkg); await writeFile(join(pkg, "lazydesigner_mcp.js"), "wrong");
  await assert.rejects(installPackage(pkg, o, parse), /integrity/);
  assert.equal(await installedState(o.root), null); assert.equal(await readOptional(o.config), null);
}));

test("Codex configuration preserves other servers, settings and LazyDesigner timeouts", () => {
  const before = '# user comment\nmodel="chosen"\n[mcp_servers.other]\ncommand="other.exe"\n[mcp_servers.lazydesigner]\ncommand="bun"\nargs=["old.ts"]\ntool_timeout_sec=120\n[mcp_servers.lazydesigner.env]\nLAZYDESIGNER_RUNTIME_URL="http://127.0.0.1:3100/bb-mcp"\n';
  assert.throws(() => configureCodex(before, "C:\\LazyDesigner\\lazydesigner.exe", parse), /adopt/);
  const after = configureCodex(before, "C:\\LazyDesigner\\lazydesigner.exe", parse, true);
  assert.ok(after.includes('# user comment')); const data = parse(after);
  assert.equal(data.model, "chosen"); assert.deepEqual(data.mcp_servers.other, parse(before).mcp_servers.other);
  assert.equal(data.mcp_servers.lazydesigner.tool_timeout_sec, 120);
  assert.equal(data.mcp_servers.lazydesigner.env.LAZYDESIGNER_RUNTIME_URL, "http://127.0.0.1:3100/bb-mcp");
  assert.equal(configureCodex(after, "C:\\LazyDesigner\\lazydesigner.exe", parse), after);
  assert.throws(() => configureCodex('[mcp_servers.lazydesigner]\nenabled=false\n', "x.exe", parse, true), /disabled/);
  assert.throws(() => configureCodex('[mcp_servers.lazydesigner]\nurl="https://remote.invalid"\n', "x.exe", parse, true), /remote/);
  assert.throws(() => configureCodex('not valid TOML', "x.exe", parse));
});


test("retired BlockIT configuration and plugin are rejected without changing files", async () => {
  assert.throws(
    () => configureCodex('[mcp_servers.blockit]\ncommand="old.exe"\n', "new.exe", parse, true),
    /Retired BlockIT client configuration/
  );
  await sandbox(async (d, o) => {
    const pkg = join(d, "pkg"); await fixture(pkg);
    await mkdir(dirname(o.plugin), { recursive: true });
    await writeFile(join(dirname(o.plugin), "blockit_mcp.js"), "USER LEGACY PLUGIN");
    await assert.rejects(installPackage(pkg, o, parse, true), /Retired BlockIT plugin/);
    assert.equal(await readOptional(o.plugin), null);
    assert.equal((await readFile(join(dirname(o.plugin), "blockit_mcp.js"))).toString(), "USER LEGACY PLUGIN");
    assert.equal(await installedState(o.root), null);
  });
});

test("preflight catches legacy blockers before package staging, without touching user files", async () => {
  await sandbox(async (_directory, options) => {
    const executable = join(options.root, "versions", "a".repeat(40), "lazydesigner.exe");
    await mkdir(dirname(options.plugin), { recursive: true });
    const oldPlugin = join(dirname(options.plugin), "blockit_mcp.js");
    await writeFile(oldPlugin, "DO NOT REPLACE");
    await assert.rejects(
      preflightManagedInstallTargets(options, executable, parse),
      /Retired BlockIT plugin/
    );
    assert.equal((await readFile(oldPlugin, "utf8")), "DO NOT REPLACE");
    assert.equal(await readOptional(join(options.root, "pending.json")), null);
    await rm(oldPlugin);
    await mkdir(dirname(options.config), { recursive: true });
    const userConfig = '[mcp_servers.blockit]\ncommand="old.exe"\n';
    await writeFile(options.config, userConfig);
    await assert.rejects(
      preflightManagedInstallTargets(options, executable, parse, true),
      /Retired BlockIT client configuration/
    );
    assert.equal(await readFile(options.config, "utf8"), userConfig);
    assert.equal(await readOptional(join(options.root, "installed.json")), null);
  });
});

test("Codex first install gives the Gateway enough timeout headroom without overriding an explicit value", () => {
  const executable = "C:\\LazyDesigner\\lazydesigner.exe";
  const fresh = configureCodex("", executable, parse);
  const defaultEntry = parse(fresh).mcp_servers.lazydesigner;
  assert.equal(defaultEntry.tool_timeout_sec, 180);
  assert.equal(defaultEntry.command, executable);
  assert.deepEqual(defaultEntry.args, ["mcp"]);
  assert.equal(configureCodex(fresh, executable, parse), fresh);

  const selected = '[mcp_servers.lazydesigner]\ncommand="user-gateway"\ntool_timeout_sec=45\n';
  const adopted = parse(configureCodex(selected, executable, parse, true)).mcp_servers.lazydesigner;
  assert.equal(adopted.tool_timeout_sec, 45);
});

test("install is idempotent and keeps user assets and root instructions", async () => sandbox(async (d, o) => {
  const pkg = join(d, "pkg"); await fixture(pkg); await mkdir(o.workspace, { recursive: true });
  await writeFile(join(o.workspace, "AGENTS.md"), "User-owned instructions\n");
  await writeFile(join(o.workspace, "model.bbmodel"), "USER MODEL");
  const first = await withInstallLock(o.root, () => installPackage(pkg, o, parse)); assert.ok(first.changed_files > 0);
  const second = await withInstallLock(o.root, () => installPackage(pkg, o, parse)); assert.equal(second.changed_files, 0);
  assert.equal((await readFile(join(o.workspace, "model.bbmodel"))).toString(), "USER MODEL");
  assert.ok((await readFile(join(o.workspace, "AGENTS.md"))).toString().startsWith("User-owned instructions\n"));
  assert.equal((await readdir(join(o.root, "transactions"))).length, 1);
  assert.equal(parse((await readFile(o.config)).toString()).mcp_servers.lazydesigner.command, join(o.root, "versions", "a".repeat(40), "lazydesigner.exe"));
}));

test("update and rollback switch the complete managed package, never user assets", async () => sandbox(async (d, o) => {
  const a = join(d, "a"), b = join(d, "b"); await fixture(a); await fixture(b, "b");
  await withInstallLock(o.root, () => installPackage(a, o, parse));
  const config = await readFile(o.config), plugin = await readFile(o.plugin);
  await writeFile(join(o.workspace, "art.png"), "USER ART");
  await withInstallLock(o.root, () => installPackage(b, o, parse)); assert.equal((await installedState(o.root))?.source_sha, "b".repeat(40));
  await withInstallLock(o.root, () => recoverInstallation(o.root, true));
  assert.equal((await installedState(o.root))?.source_sha, "a".repeat(40));
  assert.deepEqual(await readFile(o.config), config); assert.deepEqual(await readFile(o.plugin), plugin);
  assert.equal((await readFile(join(o.workspace, "art.png"))).toString(), "USER ART");
}));

test("rollback status exposes only a committed previous managed version", async () => sandbox(async (d, o) => {
  const a = join(d, "a"), b = join(d, "b"); await fixture(a); await fixture(b, "b");
  assert.deepEqual(await rollbackStatus(o.root), { available: false, previous_source_sha: null, transaction: null });
  await installPackage(a, o, parse); assert.equal((await rollbackStatus(o.root)).available, false);
  await installPackage(b, o, parse);
  const available = await rollbackStatus(o.root);
  assert.equal(available.available, true); assert.equal(available.previous_source_sha, "a".repeat(40));
  await recoverInstallation(o.root, true); assert.equal((await rollbackStatus(o.root)).available, false);
}));

test("user-modified managed skills block overwrite unless explicitly adopted", async () => sandbox(async (d, o) => {
  const a = join(d, "a"), b = join(d, "b"); await fixture(a); await fixture(b, "b");
  await installPackage(a, o, parse); const skill = join(o.workspace, `.agents/skills/${SKILLS[0]}/SKILL.md`);
  await writeFile(skill, "CUSTOM EDIT");
  await assert.rejects(installPackage(b, o, parse), /Local file/); assert.equal((await installedState(o.root))?.source_sha, "a".repeat(40));
  await installPackage(b, o, parse, true); await recoverInstallation(o.root, true);
  assert.equal((await readFile(skill)).toString(), "CUSTOM EDIT");
}));

test("failure after a partial write restores the complete before-state", async () => sandbox(async (d, o) => {
  const old = join(d, "old"), fresh = join(d, "new"); await writeFile(old, "before");
  await assert.rejects(applyTransaction(o.root, [{ path: old, bytes: Buffer.from("after"), expected: sha256("before") }, { path: fresh, bytes: Buffer.from("new"), expected: null }], n => { if (n === 2) throw new Error("injected failure"); }));
  assert.equal((await readFile(old)).toString(), "before"); assert.equal(await readOptional(fresh), null);
}));

test("persistent prepared journal is recoverable after simulated process interruption", async () => sandbox(async (d, o) => {
  const path = join(d, "managed"); await writeFile(path, "old");
  const id = await applyTransaction(o.root, [{ path, bytes: Buffer.from("new"), expected: sha256("old") }]);
  const journalPath = join(o.root, "transactions", id, "journal.json"), journal = JSON.parse((await readFile(journalPath)).toString());
  journal.status = "prepared"; await writeFile(journalPath, JSON.stringify(journal));
  await recoverInstallation(o.root); assert.equal((await readFile(path)).toString(), "old");
}));

test("rollback refuses to overwrite a post-install user edit", async () => sandbox(async (d, o) => {
  const path = join(d, "managed"); await writeFile(path, "old");
  await applyTransaction(o.root, [{ path, bytes: Buffer.from("new"), expected: sha256("old") }]);
  await writeFile(path, "USER EDIT"); await assert.rejects(recoverInstallation(o.root, true), /Local modification/);
  assert.equal((await readFile(path)).toString(), "USER EDIT");
}));

test("concurrent writers and symlink/junction destinations are refused", async () => sandbox(async (d, o) => {
  await withInstallLock(o.root, async () => { await assert.rejects(withInstallLock(o.root, async () => {}), /active/); });
  const real = join(d, "real"), link = join(d, "link"); await mkdir(real); await symlink(real, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(requirePlainPath(join(link, "lazydesigner_mcp.js")), /linked/);
  const file = join(d, "changed"); await writeFile(file, "now");
  await assert.rejects(applyTransaction(o.root, [{ path: file, bytes: Buffer.from("bad"), expected: sha256("stale") }]), /Concurrent/);
}));


test("TOML preflight rejects parser-recovered statements and incomplete values", () => {
  for (const source of ['not valid TOML', 'model="chosen"\nignored words', 'model="unterminated', 'args=["one"', 'model= # missing']) {
    assert.throws(() => configureCodex(source, "x.exe", parse));
    // A permissive parser cannot authorize silently discarded source.
    assert.throws(() => configureCodex(source, "x.exe", () => ({})));
  }
});

test("TOML preflight preserves quoted comments and multiline configuration", () => {
  const original = '# comment\nmodel="chosen"\nnote="""first # [ ignored\nsecond"""\n[ mcp_servers.other ]\nargs = [\n "one", # comma\n "two",\n]\n';
  const after = configureCodex(original, "C:\\LazyDesigner\\lazydesigner.exe", parse);
  assert.deepEqual(parse(after).mcp_servers.other, parse(original).mcp_servers.other);
  assert.equal(parse(after).note, parse(original).note);
});


test("native availability probe distinguishes an open listener from a closed port", async () => {
  const { createServer } = await import("node:net");
  const { probeLoopbackPort } = await import("../../distribution/runtime-probe");
  const listener = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  try { assert.equal(await probeLoopbackPort("127.0.0.1", address.port), true); }
  finally { await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); }
  assert.equal(await probeLoopbackPort("127.0.0.1", address.port), false);
});

test("availability probe rejects non-local targets and invalid deadlines", async () => {
  const { probeLoopbackPort } = await import("../../distribution/runtime-probe");
  for (const host of ["example.com", "192.168.1.2", "127.bad", "0.0.0.0"]) {
    await assert.rejects(probeLoopbackPort(host, 3000), /Invalid loopback/);
  }
  await assert.rejects(probeLoopbackPort("127.0.0.1", 0));
  await assert.rejects(probeLoopbackPort("127.0.0.1", 3000, 0));
});


test("managed status exposes one desktop-ready machine health contract", async () => sandbox(async (_d, o) => {
  const { buildManagedStatus } = await import("../../distribution/status");
  let observedConfig: string | undefined;
  const status = await buildManagedStatus(
    o.root,
    join(o.root, "pending.json"),
    async config => {
      observedConfig = config;
      return { online: false, url: "https://127.0.0.1:3000/bb-mcp" };
    },
    () => ({ ready: false, error: "missing test identity" })
  );
  assert.deepEqual(status, {
    schema: 1,
    installed: null,
    pending: false,
    gateway_active: false,
    runtime_online: false,
    runtime_url: "https://127.0.0.1:3000/bb-mcp",
    tls_ready: false,
    tls_error: "missing test identity",
    rollback: { available: false, previous_source_sha: null, transaction: null },
  });
  assert.equal(observedConfig, undefined);
}));


test("repair restores missing managed files from the active immutable version without upgrading", async () => sandbox(async (d, o) => {
  const pkg = join(d, "pkg");
  await fixture(pkg);
  await installPackage(pkg, o, parse);
  const before = await installedState(o.root);
  await rm(o.plugin);
  assert.equal(await readOptional(o.plugin), null);

  const repaired = await repairInstallation(o.root, parse);
  assert.equal(repaired.source_sha, before?.source_sha);
  assert.ok(repaired.changed_files >= 1);
  assert.ok(await readOptional(o.plugin));
  assert.equal((await installedState(o.root))?.source_sha, before?.source_sha);
}));

test("repair refuses to overwrite a user-modified managed file", async () => sandbox(async (d, o) => {
  const pkg = join(d, "pkg");
  await fixture(pkg);
  await installPackage(pkg, o, parse);
  await writeFile(o.plugin, "USER MODIFIED PLUGIN");
  await assert.rejects(repairInstallation(o.root, parse), /Local file/);
  assert.equal((await readFile(o.plugin)).toString(), "USER MODIFIED PLUGIN");
}));


test("Runtime TLS status is fail-closed for an absent disposable identity", async () => sandbox(async d => {
  const { runtimeTlsStatus } = await import("../../distribution/runtime-tls");
  const directory = join(d, "tls");
  const status = runtimeTlsStatus(
    { ...process.env, LAZYDESIGNER_TLS_DIR: directory },
    process.platform
  );
  assert.equal(status.ready, false);
  assert.match(status.error ?? "", /missing|incomplete/i);
}));

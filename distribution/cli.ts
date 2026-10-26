import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DEFAULT_RUNTIME_URL, normalizeRuntimeUrl } from "../mcp/gateway/runtime/identity";
import { MCP_BUNDLE_FILENAME } from "../mcp/compatibility/build-artifact";
import { probeLoopbackPort } from "./runtime-probe";
import { buildManagedStatus } from "./status";
import { inspectAlignment } from "./alignment";
import { legacyClientActive } from "./managed-install";
import { rollbackStatus } from "./managed-install";
import { ensureRuntimeTlsIdentity, renewRuntimeTlsIdentity, runtimeTlsStatus } from "./runtime-tls";
import { atomicWrite, activeGateways, installedState, installPackage, parsePublishedReleaseManifest, readOptional, recoverInstallation, repairInstallation, REPOSITORY, requirePlainPath, sameInstalledPath, sha256, verifyPackage, requireMatchingReleaseManifest, requireExpectedUpdateSource, requireDesktopContract, preflightManagedInstallTargets, withInstallLock, type InstallOptions, type Manifest } from "./managed-install";

const RELEASE_ASSET = "lazydesigner-windows-x64.zip";
const RELEASE_MANIFEST_ASSET = "lazydesigner-package.json";
const raw = process.argv.slice(2).filter(a => a !== "--");
const command = raw.shift() ?? "help";
const flags = new Map<string, string>();
for (let i = 0; i < raw.length; i++) {
  const flag = raw[i]!;
  if (!["--root", "--workspace", "--workspace-mode", "--plugin-path", "--config", "--package", "--tag", "--expected-source-sha", "--desktop-contract", "--migrate-legacy", "--adopt", "--preview", "--progress-json"].includes(flag) || flags.has(flag)) throw new Error(`Unknown or repeated option: ${flag}`);
  if (["--adopt", "--preview", "--progress-json", "--migrate-legacy"].includes(flag)) flags.set(flag, "true");
  else { const value = raw[++i]; if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`); flags.set(flag, value); }
}
const executableDir = dirname(process.execPath);
const inferredRoot = /[\\/]versions[\\/][a-f0-9]{40}$/.test(executableDir) ? dirname(dirname(executableDir)) : null;
const root = resolve(flags.get("--root") ?? process.env.LAZYDESIGNER_HOME ?? inferredRoot ?? join(process.env.LOCALAPPDATA ?? homedir(), "LazyDesigner", "managed"));
const pendingPath = join(root, "pending.json");
const expectedSourceSha = flags.get("--expected-source-sha") ?? null;
const desktopContract = flags.has("--desktop-contract") ? Number(flags.get("--desktop-contract")) : undefined;
if (desktopContract !== undefined && (!Number.isSafeInteger(desktopContract) || desktopContract < 1)) throw new Error("Invalid Desktop contract.");
if (flags.has("--workspace-mode") && flags.get("--workspace-mode") !== "repository") throw new Error("Invalid workspace mode.");
if (flags.has("--migrate-legacy") && command !== "install") throw new Error("Legacy migration is only supported by an explicit install.");
if (expectedSourceSha !== null && !/^[a-f0-9]{40}$/.test(expectedSourceSha)) {
  throw new Error("Selected update source identity is invalid.");
}
if (expectedSourceSha !== null && command !== "update") {
  throw new Error("Selected update source may only be specified for update.");
}
const parseToml = (text: string) => Bun.TOML.parse(text);
const receipt = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const progress = (action: string, stage: string) => { if (flags.has("--progress-json")) console.error(JSON.stringify({ schema: 1, kind: "progress", action, stage })); };

async function runtimeStatus(config?: string): Promise<{ online: boolean; url: string }> {
  const parsed = config ? parseToml((await readOptional(config))?.toString() ?? "") as any : {};
  const endpoint = normalizeRuntimeUrl(
    parsed.mcp_servers?.lazydesigner?.env?.LAZYDESIGNER_RUNTIME_URL
      ?? process.env.LAZYDESIGNER_RUNTIME_URL
      ?? DEFAULT_RUNTIME_URL
  );
  const url = new URL(endpoint);
  const online = await probeLoopbackPort(
    url.hostname.replace(/^\[|\]$/g, ""),
    Number(url.port || (url.protocol === "https:" ? 443 : 80))
  );
  return { online, url: endpoint };
}

async function runtimeOnline(config?: string): Promise<boolean> {
  return (await runtimeStatus(config)).online;
}

async function activatePending(): Promise<unknown> {
  const rawPending = await readOptional(pendingPath);
  if (!rawPending) return { status: "NO_PENDING_UPDATE" };
  const pending = JSON.parse(rawPending.toString()) as { directory: string; options: InstallOptions; adopt: boolean; migrate_legacy?: boolean; desktop_contract?: number };
  if (!sameInstalledPath(pending.options.root, root) || !sameInstalledPath(dirname(dirname(resolve(pending.directory))), join(root, "downloads")) || !/^[0-9a-f-]{36}$/.test(basename(dirname(pending.directory))) || basename(pending.directory) !== "package") throw new Error("Pending update is outside its installation.");
  if (await activeGateways(root) || await runtimeOnline(pending.options.config)) return { status: "STAGED", reason: "Close Blockbench and finish existing Codex MCP sessions; then run update again. Files are replaced automatically, not manually." };
  if (pending.migrate_legacy && await legacyClientActive(pending.options.config)) return { status: "STAGED", reason: "Finish the older BlockIT/Codex MCP sessions, then finish setup in Desktop. The verified package is retained; existing files are unchanged." };
  const candidate = await verifyPackage(pending.directory);
  requireExpectedUpdateSource(candidate, expectedSourceSha);
  requireDesktopContract(candidate, desktopContract ?? pending.desktop_contract);
  const result = await installPackage(pending.directory, pending.options, parseToml, pending.adopt, pending.migrate_legacy === true, desktopContract ?? pending.desktop_contract);
  await rm(pendingPath);
  await rm(dirname(pending.directory), { recursive: true, force: true }).catch(e => console.error(`LazyDesigner staging cleanup deferred: ${String(e)}`));
  return { status: "INSTALLED", ...result, plugin: pending.options.plugin, workspace: pending.options.workspace, note: "First installation still requires native Blockbench plugin trust/load permission. Later updates replace the same file automatically; start Blockbench and a fresh Codex session." };
}

async function child(executable: string, args: string[], env = process.env): Promise<number> {
  return new Promise((accept, reject) => {
    const p = spawn(executable, args, { stdio: "inherit", env, windowsHide: true });
    p.once("error", reject); p.once("exit", code => accept(code ?? 1));
  });
}

async function download(url: string, max: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "LazyDesigner-Managed-Install", "Accept": "application/octet-stream" } });
  const final = new URL(response.url);
  if (final.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(final.hostname)) throw new Error("Unexpected release download origin.");
  if (!response.ok || !response.body) throw new Error(`Release download failed: ${response.status}`);
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const bytes of response.body as any as AsyncIterable<Uint8Array>) {
    size += bytes.length; if (size > max) { await response.body.cancel().catch(() => {}); throw new Error("Release archive is too large."); }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

// Fixed script, no interpolated user commands; verify all ZIP entries before extraction.
// Native ZipArchive is used instead of adding an archive library to the authoring runtime.
const EXTRACT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($env:LAZYDESIGNER_ARCHIVE)
try {
  $base = [IO.Path]::GetFullPath($env:LAZYDESIGNER_EXTRACT) + [IO.Path]::DirectorySeparatorChar
  $seen = @{}; $total = 0
  if ($zip.Entries.Count -gt 160) { throw 'Too many archive entries' }
  foreach ($e in $zip.Entries) {
    $name = $e.FullName
    if (!$name -or $name -match '(^/|\\|:|(^|/)\.\.?(/|$)|[\x00-\x1f])' -or $seen.ContainsKey($name.ToLowerInvariant())) { throw 'Unsafe archive path' }
    $seen[$name.ToLowerInvariant()] = $true
    $kind = ($e.ExternalAttributes -shr 16) -band 61440
    if ($kind -ne 0 -and $kind -ne 32768 -and $kind -ne 16384) { throw 'Linked/special archive entry' }
    $total += $e.Length
    if ($total -gt 250000000 -or $e.Length -gt 180000000) { throw 'Archive size limit' }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($base, $name))
    if (!$target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive escape' }
  }
  foreach ($e in $zip.Entries) {
    $target = [IO.Path]::Combine($base, $e.FullName)
    if ($e.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    $inputStream = $e.Open(); $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew)
    try {
      $buffer = New-Object byte[] 65536; $written = 0
      while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $written += $count
        if ($written -gt $e.Length) { throw 'Expanded entry exceeds declared length' }
        $outputStream.Write($buffer, 0, $count)
      }
      if ($written -ne $e.Length) { throw 'Truncated archive entry' }
    } finally { $inputStream.Dispose(); $outputStream.Dispose() }
  }
} finally { $zip.Dispose() }
`;

async function fetchPublishedRelease(): Promise<any> {
  const tag = flags.get("--tag");
  if (tag && !/^lazydesigner-v\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(tag)) {
    throw new Error("Use a versioned lazydesigner-vX.Y.Z release tag.");
  }
  const preview = flags.has("--preview");
  // The GitHub latest release may be a Desktop release, not a managed package.
  // Select only the explicit LazyDesigner managed channel.
  const endpoint = tag ? `tags/${tag}` : "?per_page=60";
  const api = `https://api.github.com/repos/${REPOSITORY}/releases${endpoint.startsWith("?") ? endpoint : "/" + endpoint}`;
  const response = await fetch(api, {
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "LazyDesigner-Managed-Install",
    },
  });
  if (!response.ok) {
    throw new Error(`No installable release (${response.status}); the current installation is unchanged.`);
  }
  let release: any = await response.json();
  if (Array.isArray(release)) {
    release = release
      .filter((entry) => !entry.draft && /^lazydesigner-v/.test(entry.tag_name) &&
        (preview ? entry.prerelease === true : entry.prerelease === false))
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0];
  }
  if (
    !release ||
    release.draft ||
    (release.prerelease && !preview) ||
    !/^lazydesigner-v\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(release.tag_name)
  ) {
    throw new Error("Release is not published on the selected channel.");
  }
  return release;
}

function trustedReleaseAsset(release: any, name: string, maxSize: number): any {
  const asset = release.assets?.find((candidate: any) => candidate.name === name);
  if (
    !asset ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > maxSize
  ) {
    throw new Error(`Release has no digest-verified ${name} asset.`);
  }
  const url = new URL(asset.browser_download_url);
  if (
    url.origin !== "https://github.com" ||
    url.pathname !== `/${REPOSITORY}/releases/download/${release.tag_name}/${name}` ||
    url.search ||
    url.hash
  ) {
    throw new Error("Release asset URL does not match the trusted repository/tag.");
  }
  return { asset, url };
}

async function fetchUpdateManifest(release: any): Promise<Manifest> {
  const { asset, url } = trustedReleaseAsset(release, RELEASE_MANIFEST_ASSET, 1_000_000);
  const bytes = await download(url.href, 1_000_000);
  if (bytes.length !== asset.size || `sha256:${sha256(bytes)}` !== asset.digest) {
    throw new Error("Release manifest digest mismatch.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Release manifest is not valid JSON.");
  }
  return parsePublishedReleaseManifest(parsed);
}

async function checkUpdate(): Promise<unknown> {
  const installed = await installedState(root);
  if (!installed) {
    return { status: "NOT_INSTALLED" };
  }

  const pending = await readOptional(pendingPath);
  if (pending) {
    try {
      const parsed = JSON.parse(pending.toString()) as {
        directory?: string;
        options?: InstallOptions;
      };
      // A pending file alone must not prove an installable update. Match the
      // same installation root/path envelope used by activatePending first.
      if (
        typeof parsed.directory === "string" &&
        parsed.options &&
        sameInstalledPath(parsed.options.root, root) &&
        sameInstalledPath(dirname(dirname(resolve(parsed.directory))), join(root, "downloads")) &&
        /^[0-9a-f-]{36}$/.test(basename(dirname(parsed.directory))) &&
        basename(parsed.directory) === "package"
      ) {
        const manifest = await verifyPackage(parsed.directory);
        return {
          status: desktopUpdateRequired(manifest) ? "DESKTOP_UPDATE_REQUIRED" : "UPDATE_STAGED",
          installed_source_sha: installed.source_sha,
          available_source_sha: manifest.source_sha,
        };
      }
    } catch {
      // Status remains read-only; a malformed pending state is handled by the
      // normal recovery/update path rather than mutated during startup check.
    }
    return {
      status: "UPDATE_STAGED_UNVERIFIED",
      installed_source_sha: installed.source_sha,
      available_source_sha: null,
    };
  }

  const release = await fetchPublishedRelease();
  const manifest = await fetchUpdateManifest(release);
  return {
    status: desktopUpdateRequired(manifest) ? "DESKTOP_UPDATE_REQUIRED" : manifest.source_sha === installed.source_sha ? "UP_TO_DATE" : "UPDATE_AVAILABLE",
    installed_source_sha: installed.source_sha,
    available_source_sha: manifest.source_sha,
    tag: release.tag_name,
    published_at: typeof release.published_at === "string" ? release.published_at : null,
  };
}

function desktopUpdateRequired(manifest: Manifest): boolean {
  if (desktopContract === undefined) return false;
  const contract = manifest.desktop_contract;
  return !contract || desktopContract < contract.minimum || desktopContract > contract.maximum;
}

async function fetchRelease(): Promise<string> {
  const release = await fetchPublishedRelease();
  // The ZIP and published manifest must originate from this same release
  // selection. Do not separately re-resolve "latest" halfway through update.
  const publishedManifest = await fetchUpdateManifest(release);
  requireExpectedUpdateSource(publishedManifest, expectedSourceSha);
  const { asset, url } = trustedReleaseAsset(release, RELEASE_ASSET, 250_000_000);
  const bytes = await download(url.href, 250_000_000);
  if (bytes.length !== asset.size || `sha256:${sha256(bytes)}` !== asset.digest) {
    throw new Error("Release archive digest mismatch.");
  }
  const staging = join(root, "downloads", randomUUID());
  const directory = join(staging, "package");
  const archive = join(staging, "release.zip");
  await requirePlainPath(staging);
  await mkdir(directory, { recursive: true });
  await writeFile(archive, bytes, { flag: "wx" });
  const code = await child(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", EXTRACT],
    { ...process.env, LAZYDESIGNER_ARCHIVE: archive, LAZYDESIGNER_EXTRACT: directory }
  );
  if (code !== 0) {
    throw new Error("Safe release extraction failed; the current installation is unchanged.");
  }
  const candidate = await verifyPackage(directory);
  requireMatchingReleaseManifest(candidate, publishedManifest);
  await rm(archive);
  return directory;
}

async function main(): Promise<void> {
  if (command === "help") { console.log("LazyDesigner: install [--workspace PATH] [--plugin-path EXISTING_FILE] [--adopt] | check-update [--tag lazydesigner-vX.Y.Z] [--preview] | update [--tag lazydesigner-vX.Y.Z] [--preview] | rollback | recover | repair | setup-tls | status | mcp. No app, user build, or manual file replacement."); return; }
  if (command === "self-test") { receipt({ status: "PASS", platform: process.platform, arch: process.arch, repository: REPOSITORY }); return; }
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Managed installation v1 supports Windows x64; other platforms retain the existing developer workflow.");
  if (command === "status") { receipt(await buildManagedStatus(root, pendingPath, runtimeStatus, runtimeTlsStatus)); return; }
  if (command === "check-update") { receipt(await checkUpdate()); return; }
  if (command === "setup-tls") {
    progress("setup-tls", "preflight");
    const installed = await installedState(root);
    if (!installed) throw new Error("LazyDesigner is not installed; Runtime TLS setup requires an installed managed state.");
    await withInstallLock(root, async () => {
      const current = await installedState(root);
      if (!current) throw new Error("LazyDesigner installation changed before Runtime TLS setup.");
      if (await activeGateways(root) || await runtimeOnline(current.options.config)) {
        throw new Error("Close Blockbench and active Codex MCP sessions before Runtime TLS setup.");
      }
      progress("setup-tls", "provisioning");
      receipt({ status: "TLS_READY", ...renewRuntimeTlsIdentity() });
    });
    return;
  }
  if (command === "mcp") {
    let executable = process.execPath;
    await withInstallLock(root, async () => {
      await recoverInstallation(root);
      if (await readOptional(pendingPath)) await activatePending(); // Failure-path only, never startup network polling without a pending update.
      const state = await installedState(root);
      if (!state) throw new Error("Install LazyDesigner before connecting the AI client.");
      const installedPackage = await verifyPackage(
        join(root, "versions", state.source_sha)
      );
      if (installedPackage.source_sha !== state.source_sha) {
        throw new Error("Installed LazyDesigner source does not match its managed package.");
      }
      const alignment = await inspectAlignment(root, parseToml);
      if (alignment.state !== "aligned") throw new Error(`INSTALLATION_MISMATCH: ${alignment.issues.join(", ")}. Open Desktop Support; no Runtime operation was executed.`);
      // The Gateway inherits the exact installed plugin build identity.
      // HTTP health cannot substitute an arbitrary Runtime on the same port.
      process.env.LAZYDESIGNER_EXPECTED_RUNTIME_BUILD_ID = installedPackage.build_identity;
      executable = join(root, "versions", state.source_sha, "lazydesigner.exe");
      if (!sameInstalledPath(executable, process.execPath)) return;
      await mkdir(join(root, "leases"), { recursive: true });
      const lease = join(root, "leases", `${process.pid}.json`);
      await writeFile(lease, JSON.stringify({ source_sha: state.source_sha, producer_pid: process.pid }), { flag: "wx" });
       process.env.LAZYDESIGNER_GATEWAY_LEASE_PATH = lease;
      process.once("exit", () => { try { unlinkSync(lease); } catch {} });
    });
    if (!sameInstalledPath(executable, process.execPath)) process.exit(await child(executable, ["mcp", "--root", root]));
    await import("../mcp/gateway/index"); // The existing four-tool Gateway, not a second server.
    return;
  }
  if (!["install", "update", "rollback", "recover", "repair"].includes(command)) throw new Error(`Unknown command: ${command}`);
  await withInstallLock(root, async () => {
    const previous = await installedState(root);
    if (command === "recover" || command === "rollback") {
      progress(command, "preflight");
      if (await activeGateways(root) || await runtimeOnline(previous?.options.config)) throw new Error("Close Blockbench and active Codex MCP sessions before recovery/rollback.");
      if (command === "rollback") {
        const target = await rollbackStatus(root);
        if (target.previous_source_sha) requireDesktopContract(await verifyPackage(join(root, "versions", target.previous_source_sha)), desktopContract);
      }
      progress(command, command === "rollback" ? "restoring-previous-version" : "recovering-transaction");
      await recoverInstallation(root, command === "rollback");
      if (command === "rollback") await rm(pendingPath, { force: true });
      receipt({ status: command.toUpperCase() + "_COMPLETE" }); return;
    }
    if (command === "repair") {
      progress("repair", "preflight");
      if (!previous) throw new Error("LazyDesigner is not installed; repair cannot select an active version.");
      if (await activeGateways(root) || await runtimeOnline(previous.options.config)) throw new Error("Close Blockbench and active Codex MCP sessions before repair.");
      progress("repair", "verifying-and-restoring");
      const result = await repairInstallation(root, parseToml);
      receipt({ status: "REPAIRED", ...result });
      return;
    }
    progress(command, "preflight");
    await recoverInstallation(root);
    // Retrying a staged update uses its already-verified local package: no repeated download.
    if ((command === "update" || command === "install") && await readOptional(pendingPath) && !flags.has("--tag") && !flags.has("--preview")) { progress(command, "activating-staged"); receipt(await activatePending()); return; }
    if (command === "update") progress("update", "fetching-release");
    const source = command === "install" ? resolve(flags.get("--package") ?? executableDir) : await fetchRelease();
    progress(command, "verifying-package");
    const manifest = await verifyPackage(source);
    requireDesktopContract(manifest, desktopContract);
    if (command === "update") requireExpectedUpdateSource(manifest, expectedSourceSha);
    const options: InstallOptions = previous?.options ?? {
      root, workspace: resolve(flags.get("--workspace") ?? join(homedir(), "LazyDesigner-Workspace")),
      plugin: resolve(flags.get("--plugin-path") ?? join(root, "plugin", MCP_BUNDLE_FILENAME)),
      config: resolve(flags.get("--config") ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml")),
      ...(flags.get("--workspace-mode") === "repository" ? { workspace_mode: "repository" as const } : {}),
    };
    // A known old plugin or BlockIT Codex server must block before copying a
    // staged package or provisioning TLS. Activation repeats this preflight.
    await preflightManagedInstallTargets(
      options, join(root, "versions", manifest.source_sha, "lazydesigner.exe"),
      parseToml, flags.has("--adopt"), flags.has("--migrate-legacy")
    );
    // Retain the candidate under installation ownership even when a downloaded ZIP is later removed.
    const staging = command === "update" ? source : join(root, "downloads", randomUUID(), "package");
    await requirePlainPath(staging); await mkdir(staging, { recursive: true });
    for (const f of staging === source ? [] : ["lazydesigner-package.json", ...manifest.files.map(f => f.path)]) {
      await mkdir(dirname(join(staging, f)), { recursive: true });
      await writeFile(join(staging, f), await readFile(join(source, f)), { flag: "wx" });
    }
    progress(command, "staging");
    await verifyPackage(staging);
    if (command === "install" && !previous) { progress("install", "provisioning-runtime-security"); ensureRuntimeTlsIdentity(); }
    await atomicWrite(pendingPath, Buffer.from(JSON.stringify({ directory: staging, options, adopt: flags.has("--adopt"), migrate_legacy: flags.has("--migrate-legacy"), desktop_contract: desktopContract })));
    progress(command, "activating");
    receipt(await activatePending());
  }, command === "recover");
}

main().catch(error => { console.error(`LazyDesigner: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });

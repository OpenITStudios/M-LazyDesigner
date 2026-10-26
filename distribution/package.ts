import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { REPOSITORY, PACKAGE_SOURCE_PATHS, sha256, verifyPackage, type Manifest } from "./managed-install";
import {
  extractPluginBuildIdentity,
  MCP_BUNDLE_FILENAME,
} from "../mcp/compatibility/build-artifact";

// Build output only. Never writes generated source or commits back to the repository.
const repo = resolve(import.meta.dir, "..");
const output = resolve(import.meta.dir, "../mcp/dist/managed");
const packageDir = join(output, "package");
async function run(
  args: string[],
  cwd = join(repo, "mcp"),
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const p = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "inherit" });
  const [text, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code !== 0) throw new Error(`Package command failed (${code}): ${args[0]}`);
  return text.trim();
}
async function main(): Promise<void> {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build and smoke-test the Windows package on a Windows x64 runner.");
  const sourceSha = await run(["git", "rev-parse", "HEAD"], repo);
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sourceSha) throw new Error("Source SHA does not match the release checkout.");
  if (await run(["git", "status", "--porcelain", "--untracked-files=all"], repo)) throw new Error("Managed packages require a clean tracked checkout with no untracked inputs.");
  await rm(output, { recursive: true, force: true }); await mkdir(packageDir, { recursive: true });
  const plugin = await readFile(join(repo, "mcp/dist", MCP_BUNDLE_FILENAME));
  const buildIdentity = extractPluginBuildIdentity(plugin.toString());
  await run([process.execPath, "build", join(repo, "distribution/cli.ts"), "--compile", "--target=bun-windows-x64-baseline", "--outfile", join(packageDir, "lazydesigner.exe")]);
  const smoke = JSON.parse(await run([join(packageDir, "lazydesigner.exe"), "self-test"]));
  if (smoke.status !== "PASS" || smoke.platform !== "win32" || smoke.arch !== "x64") throw new Error("Compiled manager failed its platform smoke test.");
  await writeFile(join(packageDir, MCP_BUNDLE_FILENAME), plugin);
  for (const path of PACKAGE_SOURCE_PATHS) { await mkdir(dirname(join(packageDir, path)), { recursive: true }); await cp(join(repo, path), join(packageDir, path)); }
  await cp(join(repo, "distribution/authoring-AGENTS.md"), join(packageDir, "AGENTS.md"));
  const bunLicense = await fetch(`https://raw.githubusercontent.com/oven-sh/bun/bun-v${Bun.version}/LICENSE.md`);
  if (!bunLicense.ok) throw new Error("Pinned Bun license notice is unavailable; refusing an incomplete distribution.");
  const notices: string[] = [`LazyDesigner source: https://github.com/${REPOSITORY}/tree/${sourceSha}\nGPL-3.0-only; see LICENSE.\nRebuild with pinned Bun and the committed lockfile.\n`, `Bun ${Bun.version}\n${await bunLicense.text()}`];
  async function collectLicenses(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collectLicenses(path, depth + 1);
      else if (entry.isFile() && /^(license|copying|notice)(\.|$)/i.test(entry.name)) notices.push(`${path.slice(join(repo, "mcp/node_modules").length + 1)}\n${await readFile(path, "utf8")}`);
    }
  }
  await collectLicenses(join(repo, "mcp/node_modules"), 0);
  await writeFile(join(packageDir, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n---\n\n"));
  const files: Manifest["files"] = [];
  async function inventory(dir: string, prefix = ""): Promise<void> {
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix + e.name;
      if (e.isDirectory()) await inventory(join(dir, e.name), path + "/");
      else { const bytes = await readFile(join(dir, e.name)); files.push({ path, size: bytes.length, sha256: sha256(bytes) }); }
    }
  }
  await inventory(packageDir);
  const manifest: Manifest = { schema: 1, repository: REPOSITORY, source_sha: sourceSha, build_identity: buildIdentity, desktop_contract: { minimum: 1, maximum: 1 }, platform: "windows-x64", files };
  const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(join(packageDir, "lazydesigner-package.json"), manifestBytes);
  await writeFile(join(output, "lazydesigner-package.json"), manifestBytes);
  await verifyPackage(packageDir);
  // Execute the compiled installer against disposable paths, never the runner's user config.
  const smokeRoot = join(output, "smoke");
  const smokeArgs = ["install", "--root", join(smokeRoot, "installed"), "--workspace", join(smokeRoot, "workspace"), "--plugin-path", join(smokeRoot, "plugins", MCP_BUNDLE_FILENAME), "--config", join(smokeRoot, "codex/config.toml"), "--package", packageDir];
  const executable = join(packageDir, "lazydesigner.exe");
  const smokeEnv = { ...process.env, LAZYDESIGNER_TLS_DIR: join(smokeRoot, "tls") };
  const installed = JSON.parse(await run([executable, ...smokeArgs], join(repo, "mcp"), smokeEnv));
  if (installed.status !== "INSTALLED" || installed.source_sha !== sourceSha) throw new Error("Compiled installation smoke failed.");
  for (const name of ["cert.pem", "key.pem"]) {
    if (!(await readFile(join(smokeRoot, "tls", name)).catch(() => null))) throw new Error(`Fresh install did not provision Runtime TLS ${name}.`);
  }
  const status = JSON.parse(await run([executable, "status", "--root", join(smokeRoot, "installed")], join(repo, "mcp"), smokeEnv));
  if (status.tls_ready !== true || status.tls_error !== null) throw new Error("Managed status did not report ready Runtime TLS after fresh install.");
  const repeated = JSON.parse(await run([executable, ...smokeArgs], join(repo, "mcp"), smokeEnv));
  if (repeated.status !== "INSTALLED" || repeated.changed_files !== 0) throw new Error("Compiled install is not idempotent.");
  // No Blockbench is running here: this proves only the compiled stdio boundary.
  // Start the installed executable exactly as Codex does, not a forwarding parent.
  const gatewayExecutable = join(smokeRoot, "installed", "versions", sourceSha, "lazydesigner.exe");
  const gateway = Bun.spawn([gatewayExecutable, "mcp"], { env: smokeEnv, stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  gateway.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "managed-package-smoke", version: "1" } } }) + "\n");
  const reader = gateway.stdout.getReader(); let buffer = ""; let timer: ReturnType<typeof setTimeout> | undefined;
  async function responseLine(): Promise<any> {
    while (!buffer.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("Compiled Gateway closed before its response.");
      buffer += new TextDecoder().decode(chunk.value);
      if (buffer.length > 128_000) throw new Error("Unexpected Gateway stdout.");
    }
    const end = buffer.indexOf("\n");
    const result = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    return result;
  }
  try {
    await Promise.race([
      (async () => {
        const initialized = await responseLine();
        if (initialized.id !== 1 || !initialized.result?.serverInfo) throw new Error("Compiled Gateway protocol smoke failed.");
        gateway.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        gateway.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } }) + "\n");
        const status = await responseLine();
        if (status.id !== 2 || status.error || !status.result || status.result.isError) throw new Error(`Compiled Gateway Control smoke failed: ${JSON.stringify(status)}`);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Compiled Gateway smoke timed out.")), 30_000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock(); gateway.stdin.end();
    const shutdown = setTimeout(() => gateway.kill(), 5000);
    try { await gateway.exited; } finally { clearTimeout(shutdown); }
  }
  await rm(smokeRoot, { recursive: true, force: true });
  const zip = join(output, "lazydesigner-windows-x64.zip");
  const zipCommand = "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:LAZYDESIGNER_PACKAGE, $env:LAZYDESIGNER_ZIP)";
  const p = Bun.spawn(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", zipCommand], { env: { ...process.env, LAZYDESIGNER_PACKAGE: packageDir, LAZYDESIGNER_ZIP: zip }, stdout: "inherit", stderr: "inherit" });
  if (await p.exited !== 0) throw new Error("Release ZIP creation failed.");
  console.log(JSON.stringify({ status: "PACKAGE_BUILT", source_sha: sourceSha, zip, sha256: sha256(await readFile(zip)), native_blockbench: "NOT_RUN" }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });

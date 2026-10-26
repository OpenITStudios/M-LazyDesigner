import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { configureCodex, installedState, readOptional, requirePlainPath, sameInstalledPath, sha256, verifyPackage, type DesktopContract } from "./managed-install";
import { MCP_BUNDLE_FILENAME } from "../mcp/compatibility/build-artifact";

export type InstallationAlignment = {
  schema: 1;
  state: "aligned" | "drifted" | "unverified";
  issues: string[];
  desktop_contract: DesktopContract | null;
};

/** Full installation inspection only; connection heartbeats never hash packages. */
export async function inspectAlignment(root: string, parse: (text: string) => any): Promise<InstallationAlignment> {
  const result: InstallationAlignment = { schema: 1, state: "unverified", issues: [], desktop_contract: null };
  try {
    await requirePlainPath(join(root, "installed.json"));
    const installed = await installedState(root);
    if (!installed) { result.issues.push("NOT_INSTALLED"); return result; }
    const version = join(root, "versions", installed.source_sha);
    const manifest = await verifyPackage(version);
    if (manifest.source_sha !== installed.source_sha) result.issues.push("PACKAGE_IDENTITY_DRIFT");
    result.desktop_contract = manifest.desktop_contract ?? null;
    if (!result.desktop_contract) result.issues.push("DESKTOP_CONTRACT_UNVERIFIED");
    // Executable discovery can change casing for the same Windows location.
    const targetKey = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    const targets = new Set([installed.options.config, join(root, "lazydesigner.cmd"), installed.options.plugin].map(targetKey));
    if (installed.options.workspace_mode !== "repository") {
      for (const file of manifest.files) {
        if (["lazydesigner.exe", "LICENSE", "THIRD_PARTY_NOTICES.txt", MCP_BUNDLE_FILENAME].includes(file.path)) continue;
        targets.add(targetKey(join(installed.options.workspace, file.path)));
      }
    }
    if (Object.keys(installed.owned).length !== targets.size) result.issues.push("OWNERSHIP_UNVERIFIED");
    for (const [path, expected] of Object.entries(installed.owned)) {
      if (!targets.has(targetKey(path))) { result.issues.push("OWNERSHIP_UNVERIFIED"); continue; }
      if (targetKey(path) === targetKey(installed.options.config)) continue;
      await requirePlainPath(path);
      const bytes = await readOptional(path);
      if (!bytes || sha256(bytes) !== expected) result.issues.push("MANAGED_FILE_DRIFT");
    }
    await requirePlainPath(installed.options.plugin);
    const plugin = await readOptional(installed.options.plugin);
    if (!plugin || sha256(plugin) !== manifest.files.find(file => file.path === MCP_BUNDLE_FILENAME)?.sha256) result.issues.push("MANAGED_FILE_DRIFT");
    await requirePlainPath(installed.options.config);
    const text = await readFile(installed.options.config, "utf8");
    const config = parse(text);
    const entry = config.mcp_servers?.lazydesigner;
    if (config.mcp_servers?.blockit) result.issues.push("LEGACY_CLIENT_PRESENT");
    if (!entry || entry.url || entry.enabled === false || !Array.isArray(entry.args)
        || entry.args.length !== 1 || entry.args[0] !== "mcp" || typeof entry.command !== "string") {
      result.issues.push("CODEX_ENTRY_DRIFT");
    } else {
      try {
        await requirePlainPath(entry.command);
        if (!sameInstalledPath(entry.command, join(version, "lazydesigner.exe"))) result.issues.push("CODEX_ENTRY_DRIFT");
        // Reuse strict TOML validation and managed-section preservation.
        configureCodex(text, entry.command, parse, true);
      } catch { result.issues.push("CODEX_ENTRY_DRIFT"); }
    }
    const retired = join(dirname(installed.options.plugin), "blockit_mcp.js");
    await requirePlainPath(retired);
    if (await readOptional(retired)) result.issues.push("LEGACY_PLUGIN_PRESENT");
    result.issues = [...new Set(result.issues)];
    result.state = result.issues.length ? "drifted" : "aligned";
  } catch {
    result.issues.push("INSTALLATION_UNREADABLE");
  }
  return result;
}

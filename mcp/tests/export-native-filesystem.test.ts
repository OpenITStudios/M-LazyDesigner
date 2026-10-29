import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAllToolDefinitions } from "../lib/factories";
import "../server/tools";
import { exportModelParameters } from "../server/tools/export";

test("native restricted fs can overwrite regular projects but rejects symlinks and non-files", async () => {
  const directory = fs.mkdtempSync(join(tmpdir(), "lazydesigner-export-native-"));
  const project = { name: "fixture", uuid: "fixture", save_path: "", saved: false };
  let writes = 0;
  const nativeFs = {
    // Match Blockbench's permitted API, deliberately excluding lstatSync.
    existsSync: fs.existsSync, readdirSync: fs.readdirSync, statSync: fs.statSync,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => { writes++; fs.writeFileSync(...args); },
  };
  const globals = {
    Project: project, Format: { id: "bedrock" },
    Codecs: { project: { extension: "bbmodel", compile: () => '{"new":true}',
      afterSave: (path: string) => { project.save_path = path; project.saved = true; } },
      bedrock: { extension: "json", compile: () => "{}", afterSave() {} } },
    requireNativeModule: (name: string) => name === "fs" ? nativeFs : null,
  };
  const saved = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const run = (path: string, overwrite = true, codec_id = "project") =>
    getAllToolDefinitions().export_model.execute(exportModelParameters.parse({path, overwrite, codec_id}));
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, configurable:true, writable:true});
    // Runtime-facing errors use the current product name without rewriting
    // persisted codec IDs or the Blockbench native save lifecycle.
    const originalFormat = globals.Format.id;
    globals.Format.id = "java_block";
    await expect(run(join(directory, "unsupported.bbmodel")))
      .rejects.toThrow("LazyDesigner model export requires");
    globals.Format.id = originalFormat;
    expect(writes).toBe(0);
    const regular = join(directory, "fixture.bbmodel");
    fs.writeFileSync(regular, "old");
    await expect(run(regular, false)).rejects.toThrow("explicit consent");
    expect(writes).toBe(0);
    const savedProject = await run(regular) as { structuredContent: Record<string, any>; content: Array<{ text: string }> };
    expect(fs.readFileSync(regular, "utf8")).toBe('{"new":true}');
    expect(savedProject.structuredContent.save_behavior).toBe("NATIVE_PROJECT_SAVE_AS");
    expect(savedProject.structuredContent.compiled_payload_sha256).toBe(
      "sha256:" + createHash("sha256").update('{"new":true}').digest("hex")
    );
    expect(savedProject.structuredContent.compiled_payload_sha256_scope).toBe("NATIVE_CODEC_OUTPUT_BYTES");
    expect(savedProject.structuredContent).not.toHaveProperty("animation_export_identity");
    expect(savedProject.structuredContent.project_before.save_path).toBe("");
    expect(savedProject.structuredContent.project.save_path).toBe(regular);
    expect(savedProject.structuredContent.project_lifecycle_changes).toContain("save_path");
    expect(savedProject.structuredContent.project_lifecycle_changes).toContain("saved");
    expect(savedProject.content[0].text).toContain("not an independent diagnostic copy");
    expect(project.saved).toBe(true);
    // Subsequent authorized save to the same canonical file is a native
    // Save, not another Save As or a diagnostic backup file.
    const currentSave = await run(regular) as {
      structuredContent: Record<string, any>; content: Array<{ text: string }>;
    };
    expect(currentSave.structuredContent.save_behavior).toBe("NATIVE_PROJECT_SAVE");
    expect(currentSave.structuredContent.project_before.save_path).toBe(regular);
    expect(currentSave.structuredContent.project.save_path).toBe(regular);
    expect(currentSave.structuredContent.project_lifecycle_changes).toEqual([]);
    expect(currentSave.content[0].text).toContain("using native Blockbench Save;");
    expect(writes).toBe(2);
    // Same-path overwrite still requires affirmative consent.
    await expect(run(regular, false)).rejects.toThrow("explicit consent");
    expect(writes).toBe(2);
    const folder = join(directory, "folder.bbmodel");
    fs.mkdirSync(folder);
    await expect(run(folder)).rejects.toThrow("non-file");
    // Directory symlinks use junctions on Windows (no developer-mode requirement).
    const link = join(directory, "link.bbmodel");
    fs.symlinkSync(folder, link, process.platform === "win32" ? "junction" : "dir");
    await expect(run(link)).rejects.toThrow("symbolic link");
    const geometry = join(directory, "existing.geo.json");
    fs.writeFileSync(geometry, "keep");
    await expect(run(geometry, true, "bedrock")).rejects.toThrow("existing Bedrock geometry");
    expect(fs.readFileSync(geometry, "utf8")).toBe("keep");
    expect(writes).toBe(2);

    // The native write succeeded, but Blockbench Save As lifecycle failed.
    // Keep the destination and do not claim the active project was restored.
    const priorAfterSave = globals.Codecs.project.afterSave;
    globals.Codecs.project.afterSave = (path: string) => {
      project.save_path = path;
      throw new Error("injected native save failure");
    };
    const uncertain = join(directory, "uncertain.bbmodel");
    await expect(run(uncertain)).rejects.toThrow("EXPORT_LIFECYCLE_UNVERIFIED");
    expect(fs.readFileSync(uncertain, "utf8")).toBe('{"new":true}');
    expect(project.save_path).toBe(uncertain);
    expect(writes).toBe(3);
    globals.Codecs.project.afterSave = priorAfterSave;

    // A native write can also throw after creating a file. Do not mask this as
    // "no write" and do not delete the destination without proof.
    const nativeWrite = nativeFs.writeFileSync;
    nativeFs.writeFileSync = (...args: Parameters<typeof fs.writeFileSync>) => {
      nativeWrite(...args);
      throw new Error("injected interrupted write");
    };
    const interrupted = join(directory, "interrupted.bbmodel");
    await expect(run(interrupted)).rejects.toThrow("EXPORT_WRITE_OUTCOME_UNKNOWN");
    expect(fs.existsSync(interrupted)).toBe(true);
    expect(project.save_path).toBe(uncertain);
    nativeFs.writeFileSync = nativeWrite;
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    fs.rmSync(directory, {recursive:true, force:true});
  }
});

test("workspace policy keeps one current model and archives only on explicit request", async () => {
  const [policy, active] = await Promise.all([
    Bun.file("../workspace/README.md").text(),
    Bun.file("../workspace/active/README.md").text(),
  ]);
  expect(policy).toContain("NATIVE_PROJECT_SAVE");
  expect(policy).toContain("NATIVE_PROJECT_SAVE_AS");
  expect(policy).toContain("existing explicit overwrite-consent check");
  expect(policy).toContain("User-owned historic backups are preserved");
  expect(active).toContain("does **not** move");
  expect(active).toContain("explicitly requests archiving/parking");
});


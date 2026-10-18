import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAllToolDefinitions } from "@/lib/factories";
import { createProjectParameters } from "@/server/tools/project";
import { addGroupParameters, duplicateElementParameters, requireFiniteTranslatedElementVector3 } from "@/server/tools/element";
import {
  BLOCKIT_MODEL_CODEC_IDS,
  exportModelParameters,
  listExportFormatsParameters,
  registerExportTools,
} from "@/server/tools/export";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("generic semantics narrowing contract", () => {
  test("project creation has no redundant format selector", () => {
    expect(createProjectParameters.parse({ name: "entity" })).toEqual({ name: "entity" });
    expect(createProjectParameters.safeParse({ name: "entity", format: "bedrock" }).success).toBe(false);
    expect(createProjectParameters.safeParse({ name: "entity", format: "java_block" }).success).toBe(false);
  });

  test("add_group exposes only finite Bedrock bone create state", () => {
    expect(addGroupParameters.safeParse({ name: "body" }).success).toBe(true);
    expect(addGroupParameters.safeParse({ name: "body", origin: [0, Infinity, 0] }).success).toBe(false);
    expect(addGroupParameters.safeParse({ name: "body", rotation: [0, 0, -Infinity] }).success).toBe(false);
    for (const editorOnly of [{ selected: true }, { shade: false }, { visibility: false }, { autouv: "1" }]) {
      expect(addGroupParameters.safeParse({ name: "body", ...editorOnly }).success).toBe(false);
    }
  });

  test("duplicate_element rejects non-finite or overflowing translated coordinates", async () => {
    expect(duplicateElementParameters.safeParse({ id: "cube", offset: [0, Infinity, 0] }).success).toBe(false);
    expect(requireFiniteTranslatedElementVector3([1, 2, 3], [4, 5, 6], "test")).toEqual([5, 7, 9]);
    expect(() => requireFiniteTranslatedElementVector3([1e308, 0, 0], [1e308, 0, 0], "test")).toThrow("non-finite authored coordinate");
    const [mutation, shared] = await Promise.all([
      source("server/tools/element/mutation.ts"),
      source("server/tools/element/shared.ts"),
    ]);
    expect(mutation).toContain("preflightFaithfulDuplicate(element, offset, newName)");
    expect(shared).toContain("preflightDuplicateTranslation(element, offset)");
  });

  test("model export exposes only Bedrock geometry and editable Blockbench project codecs", () => {
    expect(BLOCKIT_MODEL_CODEC_IDS).toEqual(["bedrock", "project"]);
    expect(listExportFormatsParameters.parse({})).toEqual({});
    expect(exportModelParameters.parse({}).codec_id).toBe("bedrock");
    expect(exportModelParameters.safeParse({ codec_id: "project" }).success).toBe(true);
    expect(exportModelParameters.safeParse({ codec_id: "obj" }).success).toBe(false);
  });

  test("export executor returns no-path content and keeps verified writes metadata-first", async () => {
    if (!getAllToolDefinitions().export_model) registerExportTools();
    const tool = getAllToolDefinitions().export_model;
    const directory = fs.mkdtempSync(join(tmpdir(), "blockit-export-contract-"));
    let compiled = '{"minecraft:geometry":[]}';
    const project = {
      name: "export-fixture", uuid: "export-fixture", saved: false,
      save_path: "", export_path: "", export_codec: "",
    };
    const globals = {
      Project: project,
      Format: { id: "bedrock" },
      Codecs: {
        bedrock: {
          name: "Bedrock", extension: "json", compile: () => compiled,
          afterSave: (path: string) => {
            project.export_path = path;
            project.export_codec = "bedrock";
            project.saved = true;
          },
        },
      },
      requireNativeModule: (name: string) => name === "fs" ? fs : null,
    };
    const saved = Object.keys(globals).map((key) =>
      [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    const invoke = async (args: Record<string, unknown>) => {
      const result = await tool.execute(exportModelParameters.parse(args));
      if (typeof result === "string" || !result.structuredContent) {
        throw new Error("Expected structured export receipt.");
      }
      return result.structuredContent as {
        content: string | null; truncated: boolean; wrote_to_path: string | null;
      };
    };
    try {
      for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      }
      const noPath = await invoke({});
      expect(noPath.content).toBe(compiled);
      expect(noPath.wrote_to_path).toBeNull();
      expect(noPath.truncated).toBe(false);
      expect((await invoke({ max_content_length: 0 })).content).toBeNull();

      const path = join(directory, "default.geo.json");
      const written = await invoke({ path });
      expect(written.content).toBeNull();
      expect(written.wrote_to_path).toBe(path);
      expect(fs.readFileSync(path, "utf8")).toBe(compiled);

      const explicitPath = join(directory, "explicit.geo.json");
      expect((await invoke({ path: explicitPath, max_content_length: 6 })).content)
        .toBe(compiled.slice(0, 6));

      compiled = JSON.stringify({ label: "x".repeat(100_001) });
      const bounded = await invoke({});
      expect(bounded.content).toHaveLength(100_000);
      expect(bounded.truncated).toBe(true);

      compiled = JSON.stringify({ label: "a😀b" });
      const limit = compiled.indexOf("😀") + 1;
      const unicode = await invoke({ max_content_length: limit });
      expect(unicode.content).toBe(compiled.slice(0, limit - 1));
      expect(unicode.truncated).toBe(true);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("fixed export-format discovery is default-disabled without removing export capability", async () => {
    const exportSource = await source("server/tools/io/export.ts");
    expect(exportSource).toContain("exportToolDocs[0].status,\n    false");
    expect(exportSource).toContain("BLOCKIT_MODEL_CODEC_IDS = [\"bedrock\", \"project\"]");
    expect(exportSource).toContain('const blockitModelCodecEnum = z.enum([...BLOCKIT_MODEL_CODEC_IDS, "bedrock_animation"])');
    expect(exportSource).toMatch(/codec_id:\s*blockitModelCodecEnum\s*\.optional\(\)\s*\.default\("bedrock"\)/s);
    expect(exportSource).not.toContain('codec_id: z.enum(["obj"');
  });

  test("generic full-app capture and editor-camera mutation are default-disabled", async () => {
    const camera = await source("server/tools/inspection/camera.ts");
    expect(camera).toContain("cameraToolDocs[1].status, false");
    expect(camera).toContain("cameraToolDocs[2].status, false");
    expect(camera).toContain("capture_model_views");
  });

  test("generic per-face texture apply is disabled for Bedrock single-texture authoring", async () => {
    const texture = await source("server/tools/texture/assignment.ts");
    const skill = await source("../.agents/skills/lazydesigner-texturing/SKILL.md");
    expect(texture).toContain("applyTextureToolDoc.status, false");
    expect(texture).toContain("Legacy per-face texture wrapper. Disabled on the normal Bedrock Entity surface; use activate_texture.");
    expect(skill).not.toContain("- `apply_texture`");
    expect(skill).toContain("list_textures / activate_texture");
  });

  test("raw per-face texture discovery is disabled for Bedrock single-texture authoring", async () => {
    const elements = await source("server/tools/element/discovery.ts");
    const start = elements.indexOf('name: "filter_by_material"');
    const registration = elements.indexOf("elementDiscoveryToolDocs[3].status, false");
    expect(start).toBeGreaterThan(-1);
    expect(registration).toBeGreaterThan(start);
    expect(elements).toContain("Legacy raw face-material lookup. Disabled on the Bedrock Entity surface.");
  });

  test("validator inferred element references declare their non-authoritative source", async () => {
    const validator = await source("server/resources/validator.ts");
    expect(validator).toContain('elementRefsSource: elementRefs.length > 0 ? "message_heuristic" : "none"');
    expect(validator).toContain("elementRefsAuthoritative: false");
  });
});

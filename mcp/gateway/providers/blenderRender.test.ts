import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PUBLICATION_HANDOFF_BYTES,
  PUBLICATION_HANDOFF_KIND,
  parsePublicationHandoff,
} from "@/lib/publication/handoffContract";
import { expectedPublicationGltfMaterial } from "@/lib/publication/materialContract";
import { makeAutomaticPublicationRequest, publicationAutomaticOptions } from "@/lib/publication/contracts";
import {
  BLENDER_RENDER_TOOL,
  BlenderRenderProvider,
  blenderRenderControlParameters,
  shouldProbeBlenderRender,
} from "./blenderRender";
import { LocalCapabilityRegistry } from "./registry";
import { manifestEntriesForCapability } from "../capabilities/manifest";
import { projectCapabilityInputSchema } from "../capabilities/schemaProjection";
import { GatewayCapabilityExecutor } from "../execution/capabilityExecutor";
import { GatewaySessionState } from "../session/state";
import type { BlockitRuntimeBackend } from "../runtime/backend";

const sha = (value: string) => value.repeat(64);
const snapshot = {
  kind: PUBLICATION_HANDOFF_KIND,
  schema_version: 1,
  project_uuid: "project-a",
  source_sha256: sha("a"),
  source_manifest_sha256: sha("b"),
  glb_sha256: sha("c"),
  cube_count: 1,
  material_count: 1,
  source_manifest: {
    schema_version: 1, target_kind: "ACTIVE_PROJECT_VISIBLE_EXPORTABLE_CUBES",
    project_uuid: "project-a", pose_mode: "EDIT_STATIC_VERIFIED",
    source_sha256: sha("a"),
    source_units_per_minecraft_block: 16,
    gltf_units_per_blockbench_unit: 0.0625,
    cubes: [{
      cube_uuid: "cube-a", group_ancestry_uuids: [],
      source_world_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      expected_blender_bounds_min: [0, 0, 0],
      expected_blender_bounds_max: [1, 0, 1],
      position_sha256: sha("d"),
      uv_sha256: sha("e"), gltf_uv_sha256: sha("f"),
      uv_vertex_count: 4, normal_sha256: null,
      index_sha256: sha("1"), blender_triangle_sha256: sha("2"),
      primitives: [{
        face_keys: ["north"], texture_uuid: "abc",
        material_name: "ld_color_abc",
      }],
    }],
  },
  materials: {
    ld_color_abc: {
      color_uuid: "abc", texture_sha256: sha("3"),
      alpha_mode: "OPAQUE", pbr: "NONE",
      import_png_sha256: { base: sha("4") },
      gltf: expectedPublicationGltfMaterial(null),
    },
  },
};

const request = {
  blender_executable: "/opt/blender-5.2/blender",
  output_path: "/tmp/publication.png",
  quality: "preview",
  width: 640, height: 640,
};

describe("Independent Gateway Blender MCP control contract", () => {
  test("Blockbench handoff has a bounded, source-owned manifest and PNG receipts", () => {
    expect(parsePublicationHandoff(snapshot).kind).toBe(PUBLICATION_HANDOFF_KIND);
    expect(MAX_PUBLICATION_HANDOFF_BYTES).toBeLessThan(16 * 1024 * 1024);
    for (const broken of [
      { ...snapshot, schema_version: 2 },
      { ...snapshot, project_uuid: "changed" },
      { ...snapshot, cube_count: 2 },
      { ...snapshot, material_count: 2 },
      { ...snapshot, materials: {
        ld_color_abc: { ...snapshot.materials.ld_color_abc,
          import_png_sha256: { base: sha("4"), unknown: sha("5") } },
      } },
      { ...snapshot, source_manifest: {
        ...snapshot.source_manifest, cubes: [],
      } },
    ]) {
      expect(() => parsePublicationHandoff(broken)).toThrow();
    }
  });

  test("Blender remains discoverable in the single Gateway even without Runtime catalog", async () => {
    const registry = new LocalCapabilityRegistry();
    expect(registry.owns("blender_render")).toBe(true);
    expect((await registry.search("control Blender MCP", [], 5))
      .some(item => item.capability_id === "blender_render")).toBe(true);
    expect((await registry.describe("blender_render"))?.name).toBe("blender_render");
    expect(shouldProbeBlenderRender("UV paint only")).toBe(false);
    expect(shouldProbeBlenderRender("render this GLB in Blender")).toBe(true);
    expect(shouldProbeBlenderRender("render objek ini")).toBe(true);
    expect(shouldProbeBlenderRender("paint model texture")).toBe(false);
    expect(BLENDER_RENDER_TOOL.annotations?.readOnlyHint).toBe(false);
    // The tool contains an explicit file-deleting release branch; report it truthfully.
    expect(BLENDER_RENDER_TOOL.annotations?.destructiveHint).toBe(true);
    expect(manifestEntriesForCapability("blender_render")
      .map(item => [item.branch?.value, item.operationClass])).toEqual([
        ["auto", "EXPORT"], ["start", "EXPORT"], ["status", "QUERY"],
        ["preview", "QUERY"], ["cancel", "CONTROL"],
        ["recover", "CONTROL"], ["release", "CONTROL"],
      ]);
    await registry.close();
  });

  test("advertised Blender MCP schema matches strict operation-specific validation", () => {
    const jobId = "blender_" + "a".repeat(24);
    const path = "/tmp/.lazydesigner-blender-handoff-" +
      "a".repeat(24) + "/handoff.json";
    expect(blenderRenderControlParameters.safeParse({
      operation: "auto",
    }).success).toBe(true);
    expect(blenderRenderControlParameters.safeParse({
      operation: "auto", options: { quality: "preview", aspect: "landscape_16_9" },
    }).success).toBe(true);
    expect(blenderRenderControlParameters.safeParse({
      operation: "auto", options: { quality: "invalid" },
    }).success).toBe(false);
    expect(blenderRenderControlParameters.safeParse({
      operation: "auto", handoff_path: path,
    }).success).toBe(false);
    expect(blenderRenderControlParameters.safeParse({
      operation: "status",
    }).success).toBe(true);
    expect(blenderRenderControlParameters.safeParse({
      operation: "recover", receipt_path: "/tmp/render.png.lazydesigner.json",
    }).success).toBe(true);
    expect(blenderRenderControlParameters.safeParse({
      operation: "release", handoff_path: path,
    }).success).toBe(true);
    for (const operation of ["status", "preview", "cancel"] as const) {
      expect(blenderRenderControlParameters.parse({ operation, job_id: jobId }))
        .toMatchObject({ operation, job_id: jobId });
    }
    const expected = blenderRenderControlParameters.parse({
      operation: "start", handoff_path: path, request,
    });
    expect(expected.request).toMatchObject({ quality: "preview", width: 640 });
    for (const invalid of [
      { operation: "start", handoff_path: path },
      { operation: "start", handoff_path: path, request, extra: true },
      { operation: "start", handoff_path: path, request: {
        ...request, camera: { framing_padding: 0.1 },
      } },
      { operation: "status", job_id: "invalid" },
      { operation: "status", job_id: jobId, handoff_path: path },
      { operation: "cancel", job_id: jobId, request },
      { operation: "unknown", job_id: jobId },
      { operation: "recover" },
      { operation: "recover", receipt_path: "relative", unexpected: true },
      { operation: "release", handoff_path: path, job_id: jobId },
    ]) {
      expect(blenderRenderControlParameters.safeParse(invalid).success).toBe(false);
    }
    const schema = BLENDER_RENDER_TOOL.inputSchema as Record<string, unknown>;
    expect(JSON.stringify(schema)).toContain("framing_padding");
    expect(JSON.stringify(schema)).toContain("glow_strength");
    expect(JSON.stringify(schema)).toContain("handoff_path");
    const projectedStart = projectCapabilityInputSchema(
      "blender_render", schema, { field: "operation", value: "start" },
    );
    expect(projectedStart.projected).toBe(true);
    expect(JSON.stringify(projectedStart.inputSchema)).toContain("framing_padding");
    const projectedStatus = projectCapabilityInputSchema(
      "blender_render", schema, { field: "operation", value: "status" },
    );
    expect(projectedStatus.projected).toBe(true);
    expect(JSON.stringify(projectedStatus.inputSchema)).toContain("job_id");
    for (const [branch, field] of [
      ["auto", "options"], ["recover", "receipt_path"], ["release", "handoff_path"],
    ] as const) {
      const projection = projectCapabilityInputSchema(
        "blender_render", schema, { field: "operation", value: branch },
      );
      expect(projection.projected).toBe(true);
      expect(JSON.stringify(projection.inputSchema)).toContain(field);
    }
  });

  test("auto mode derives safe output without guessing local permissions", () => {
    expect(publicationAutomaticOptions.parse({})).toMatchObject({
      quality: "publication", aspect: "square", background: "dark",
    });
    const config = {
      blender_executable: "/opt/blender-5.2/blender",
      output_directory: "/tmp/lazydesigner",
    };
    const nonce = "a".repeat(24);
    const ready = makeAutomaticPublicationRequest({
      quality: "preview", aspect: "landscape_16_9",
    }, config, nonce);
    expect(ready.request).toMatchObject({
      quality: "preview", width: 640, height: 360,
      output_path: "/tmp/lazydesigner/lazydesigner_render_" + nonce + ".png",
    });
    expect(() => makeAutomaticPublicationRequest({}, {
      ...config, output_directory: "../unsafe",
    }, nonce)).toThrow("AUTO_CONFIG_REQUIRED");
    expect(() => makeAutomaticPublicationRequest({}, {
      ...config, output_directory: "/tmp/../escape",
    }, nonce)).toThrow("AUTO_CONFIG_REQUIRED");
    expect(() => makeAutomaticPublicationRequest({}, {
      ...config, blender_executable: "blender",
    }, nonce)).toThrow();
    expect(() => makeAutomaticPublicationRequest({}, config, "invalid")).toThrow("AUTO_JOB_ID_INVALID");
    expect(publicationAutomaticOptions.safeParse({ overwrite: true }).success).toBe(false);
    expect(() => new BlenderRenderProvider().startAutomatic({})).toThrow("AUTO_NATIVE_RUNTIME_UNAVAILABLE");
  });

  test("pending automatic handoff cleanup retains its job and blocks replacement", async () => {
    const provider = new BlenderRenderProvider();
    const path = "/tmp/.lazydesigner-blender-handoff-" + "a".repeat(24) + "/handoff.json";
    // A synthetic terminal state is enough to exercise the provider's
    // admission fence without spawning or simulating a successful Blender job.
    const current = {
      state: "RENDERED_DRAFT",
      handoff_cleanup: "PENDING",
      handoff_path: path,
    };
    (provider as unknown as { current: unknown }).current = current;
    expect(() => provider.start(path, request)).toThrow("JOB_BUSY");
    await expect(provider.recover("/tmp/render.png.lazydesigner.json"))
      .rejects.toThrow("JOB_BUSY");
    await expect(provider.releaseHandoff(path)).rejects.toThrow("HANDOFF_IN_USE");
    current.handoff_cleanup = "RELEASED";
    // Once cleanup completes, the old terminal state no longer blocks
    // recovery admission (which now reaches path/file validation).
    await expect(provider.recover("relative")).rejects.toThrow("COMPLETION_PATH_INVALID");
  });

  test("auto handoff failure uses exactly one native attempt and no Blender fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ld-render-auto-"));
    const blender = join(dir, "blender");
    await writeFile(blender, "test-only fake executable, never launched");
    const calls: string[] = [];
    const provider = new BlenderRenderProvider(async directory => {
      calls.push(directory);
      throw new Error("NATIVE_HANDOFF_FAILED");
    });
    try {
      const job = provider.startAutomatic({ quality: "preview" }, {
        blender_executable: blender, output_directory: dir,
      });
      expect(job.state).toBe("RUNNING");
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(calls).toEqual([dir]);
      expect(provider.status(job.job_id)).toMatchObject({
        state: "FAILED", handoff_cleanup: "REQUIRES_REVIEW",
      });
      expect(() => provider.preview(job.job_id)).toThrow("PREVIEW_NOT_READY");
      await provider.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cancelling during the native handoff never starts Cycles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ld-render-cancel-"));
    const blender = join(dir, "blender");
    await writeFile(blender, "test-only fake executable, never launched");
    let finish!: (path: string) => void;
    const pendingHandoff = new Promise<string>(resolve => { finish = resolve; });
    let handoffCalls = 0;
    const provider = new BlenderRenderProvider(async () => {
      handoffCalls += 1;
      return pendingHandoff;
    });
    try {
      const job = provider.startAutomatic({}, {
        blender_executable: blender, output_directory: dir,
      });
      await Promise.resolve();
      expect(provider.cancel(job.job_id).state).toBe("CANCELLING");
      finish(join(dir, ".lazydesigner-blender-handoff-" + "a".repeat(24), "handoff.json"));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(handoffCalls).toBe(1);
      expect(provider.status(job.job_id)).toMatchObject({
        state: "CANCELLED", handoff_cleanup: "REQUIRES_REVIEW",
        receipt: null,
      });
      await provider.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("local Blender output must not impersonate the Gateway's active Blockbench tab", async () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("blockbench-current-project");
    const local = {
      invoke: async () => ({
        content: [{ type: "text", text: "Blender job started" }],
        structuredContent: {
          job_id: "blender_" + "a".repeat(24),
          state: "RUNNING",
          source_project_uuid: "older-handoff-project",
          source_sha256: sha("a"),
        },
      }),
      readOnlyHint: () => false,
    } as unknown as LocalCapabilityRegistry;
    const backend = {
      invokeCapabilityWithMetadata: () => {
        throw new Error("Gateway-local Blender must not call Blockbench Runtime");
      },
    } as unknown as BlockitRuntimeBackend;
    const executor = new GatewayCapabilityExecutor(backend, local, session);
    const result = await executor.invoke("blender_render", { operation: "start" }) as {
      structuredContent?: { control_delta?: { project_uuid: string | null } };
    };
    expect(result.structuredContent?.control_delta?.project_uuid).toBeNull();
    expect(session.projectUuid).toBe("blockbench-current-project");
  });

  test("Blender start blocks arbitrary paths and unsafe executable/schema inputs", async () => {
    const provider = new BlenderRenderProvider();
    for (const path of [
      "../handoff.json", "/tmp/user.json",
      "/tmp/.lazydesigner-blender-handoff-bad/handoff.json",
    ]) {
      expect(() => provider.start(path, request)).toThrow("HANDOFF_PATH_INVALID");
    }
    const path = "/tmp/.lazydesigner-blender-handoff-" +
      "a".repeat(24) + "/handoff.json";
    expect(() => provider.start(path, {
      ...request, blender_executable: "not-an-absolute-executable",
    })).toThrow();
    const started = provider.start(path, request);
    expect(started).toMatchObject({ state: "RUNNING", phase: "PREPARING_ASSETS" });
    expect(() => provider.start(path, request)).toThrow("JOB_BUSY");
    expect(provider.status(undefined).job_id).toBe(started.job_id);
    expect(() => provider.status("blender_" + "b".repeat(24))).toThrow("NOT_FOUND");
    expect(() => provider.preview(started.job_id)).toThrow("PREVIEW_NOT_READY");
    await expect(provider.releaseHandoff(path)).rejects.toThrow("HANDOFF_IN_USE");
    await expect(provider.recover("relative-receipt.json")).rejects.toThrow("COMPLETION_PATH_INVALID");
    expect(provider.cancel(started.job_id).state).toBe("CANCELLING");
    await provider.close();
    expect(provider.status(started.job_id).state).toBe("CANCELLED");
    expect(() => provider.start(path, request)).toThrow("GATEWAY_RETIRED");
  });
});

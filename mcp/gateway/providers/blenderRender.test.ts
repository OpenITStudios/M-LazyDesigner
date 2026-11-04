import { describe, expect, test } from "bun:test";
import {
  MAX_PUBLICATION_HANDOFF_BYTES,
  PUBLICATION_HANDOFF_KIND,
  parsePublicationHandoff,
} from "@/lib/publication/handoffContract";
import { expectedPublicationGltfMaterial } from "@/lib/publication/materialContract";
import {
  BLENDER_RENDER_TOOL,
  BlenderRenderProvider,
  shouldProbeBlenderRender,
} from "./blenderRender";
import { LocalCapabilityRegistry } from "./registry";
import { manifestEntriesForCapability } from "../capabilities/manifest";

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
    expect(BLENDER_RENDER_TOOL.annotations?.readOnlyHint).toBe(false);
    expect(manifestEntriesForCapability("blender_render")
      .map(item => [item.branch?.value, item.operationClass])).toEqual([
        ["start", "EXPORT"], ["status", "QUERY"],
        ["preview", "QUERY"], ["cancel", "CONTROL"],
      ]);
    await registry.close();
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
    expect(() => provider.preview(started.job_id)).toThrow("PREVIEW_NOT_READY");
    expect(provider.cancel(started.job_id).state).toBe("CANCELLING");
    await provider.close();
    expect(provider.status(started.job_id).state).toBe("CANCELLED");
    expect(() => provider.start(path, request)).toThrow("GATEWAY_RETIRED");
  });
});

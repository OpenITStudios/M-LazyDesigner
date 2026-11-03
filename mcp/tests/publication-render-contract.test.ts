import { afterEach, describe, expect, test } from "bun:test";
import {
  PUBLICATION_QUALITY,
  blenderRenderArgs,
  makePublicationJob,
  publicationRenderParameters,
} from "@/lib/publication/contracts";
import {
  snapshotDetachedPublicationGlb,
  verifyPublicationSourceCurrent,
} from "@/server/publication/snapshot";
import { convertBedrockMerToGltf, convertBedrockNormalToGltf } from "@/lib/publication/materialChannels";
import { inspectPublicationGlb } from "@/lib/publication/glbIntegrity";
import {
  CAPABILITY_DEFINITIONS,
} from "@/lib/capabilities/manifest";
import {
  manifestEntriesForCapability,
} from "@/gateway/capabilities/manifest";

const valid = {
  blender_executable: "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe",
  output_path: "C:\\Art\\golem.png",
};

describe("Publication render contract", () => {
  test("validates explicit local renderer and no-overwrite PNG destination", () => {
    const args = publicationRenderParameters.parse(valid);
    expect(args.quality).toBe("publication");
    expect(args.width).toBe(2048);
    expect(args.height).toBe(2048);
    expect(args.background).toBe("dark");
    expect(args.camera.projection).toBe("perspective");
    for (const input of [
      { ...valid, blender_executable: "blender" },
      { ...valid, blender_executable: "C:\\Windows\\System32\\cmd.exe" },
      { ...valid, output_path: "C:\\Art\\..\\unsafe.png" },
      { ...valid, output_path: "../asset.png" },
      { ...valid, output_path: "C:\\Art\\asset.glb" },
      { ...valid, width: 8192 },
      { ...valid, width: 4096, height: 4096 },
      { ...valid, quality: "random" },
      { ...valid, background: "fantasy" },
      { ...valid, camera: { yaw_degrees: Infinity } },
      { ...valid, overwrite: true },
      { ...valid, unexpected_extra_field: true },
    ]) {
      expect(publicationRenderParameters.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  test("job sampler is bounded and worker args cannot inject shell commands", () => {
    expect(PUBLICATION_QUALITY.preview.samples).toBeLessThan(PUBLICATION_QUALITY.publication.samples);
    expect(PUBLICATION_QUALITY.publication.samples).toBeLessThan(PUBLICATION_QUALITY.high.samples);
    const job = makePublicationJob(publicationRenderParameters.parse(valid), {
      project_uuid: "test-project",
      sha256: "a".repeat(64),
      glb_path: "C:\\Art\\model.glb",
      materials: {
        ld_color_abc: { color_uuid: "abc", texture_sha256: "b".repeat(64), alpha_mode: "OPAQUE", pbr: "NONE" },
      },
    });
    expect(job.schema_version).toBe(1);
    expect(job.samples).toBe(128);
    expect(job.materials.ld_color_abc.color_uuid).toBe("abc");
    expect(blenderRenderArgs("C:\\Art\\render.py", "C:\\Art\\job.json")).toEqual([
      "--background", "--factory-startup", "--disable-autoexec", "--python",
      "C:\\Art\\render.py", "--", "C:\\Art\\job.json",
    ]);
    expect(() => blenderRenderArgs("render.py", "C:\\Art\\job.json")).toThrow("absolute");
  });

  test("publication remains discoverable without a fifth Gateway method", () => {
    expect(CAPABILITY_DEFINITIONS.render_publication).toMatchObject({
      stage: "core", operationClass: "EXPORT", executionClass: "heavy", verificationClass: "visual",
    });
    expect(manifestEntriesForCapability("render_publication")).toHaveLength(1);
    expect(manifestEntriesForCapability("render_publication")[0]?.semantic?.intents)
      .toContain("render actual Blockbench model to PNG");
  });
});

/** Minimal structurally plausible GLB; not a substitute for the real exporter. */
function fixtureGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "cube_cube-1" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    accessors: [{}, {}],
    materials: [{ name: "ld_color_tex-1" }],
    textures: [{ source: 0 }],
    images: [{ uri: "data:image/png;base64,AA==" }],
  }));
  const padded = Buffer.alloc(Math.ceil(json.byteLength / 4) * 4, 0x20);
  json.copy(padded);
  const glb = Buffer.alloc(20 + padded.byteLength);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.byteLength, 8);
  glb.writeUInt32LE(padded.byteLength, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20);
  return glb;
}

describe("GLB envelope and source fidelity preflight", () => {
  test("rejects malformed bytes, changed length, lost UV and unexpected material count", () => {
    const valid = fixtureGlb();
    expect(inspectPublicationGlb(valid, 1, 1)).toMatchObject({
      mesh_count: 1, material_count: 1, primitive_count: 1,
    });
    expect(() => inspectPublicationGlb(valid.subarray(0, 12), 1, 1)).toThrow();
    const invalidLength = Buffer.from(valid);
    invalidLength.writeUInt32LE(123456, 8);
    expect(() => inspectPublicationGlb(invalidLength, 1, 1)).toThrow("HEADER_OR_LENGTH_INVALID");
    expect(() => inspectPublicationGlb(valid, 2, 1)).toThrow("SOURCE_INVENTORY_MISMATCH");
    expect(() => inspectPublicationGlb(valid, 1, 2)).toThrow("SOURCE_INVENTORY_MISMATCH");
    const mutated = Buffer.from(valid);
    const pos = mutated.indexOf("TEXCOORD_0");
    expect(pos).toBeGreaterThan(0);
    mutated.write("TEXCOORX_0", pos, "ascii");
    expect(() => inspectPublicationGlb(mutated, 1, 1)).toThrow("PRIMITIVE_UV_OR_MATERIAL_INVALID");
  });
});

const previous = new Map<string, { present: boolean; value: unknown }>();
const names = ["Project", "Format", "Cube", "Group", "Mesh", "Texture", "TextureGroup", "THREE", "document"];

function installNativeFixture() {
  for (const name of names) {
    previous.set(name, {
      present: Object.hasOwn(globalThis, name),
      value: (globalThis as any)[name],
    });
  }
  class Geometry {
    attributes = { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] }, uv: { array: [0, 0, 1, 0, 0, 1] } };
    index = { array: [0, 1, 2] };
    faces = ["north"];
    groups = [{ start: 0, count: 3, materialIndex: 0 }];
    clone() { return new Geometry(); }
    applyMatrix4(_matrix: unknown) { return this; }
    dispose() {}
  }
  class MockMesh {
    geometry = new Geometry();
    matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    updateWorldMatrix() {}
    userData = {};
    name = "";
    constructor(_geometry?: Geometry, _materials?: unknown) {
      if (_geometry) this.geometry = _geometry;
    }
  }
  class MockScene {
    name = "";
    children: MockMesh[] = [];
    add(mesh: MockMesh) { this.children.push(mesh); }
    clear() { this.children = []; }
  }
  class MockMaterial {
    name = "";
    constructor(_args: unknown) {}
    dispose() {}
  }
  class MockCanvasTexture {
    name = "";
    magFilter: unknown;
    minFilter: unknown;
    generateMipmaps = true;
    colorSpace: unknown;
    needsUpdate = false;
    constructor(_canvas: unknown) {}
    dispose() {}
  }
  const rgba = new Uint8ClampedArray([80, 120, 170, 255]);
  const texture = {
    uuid: "tex-1",
    group: "",
    ctx: { canvas: { width: 1, height: 1 }, getImageData: () => ({ data: rgba, width: 1, height: 1 }) },
  };
  const cube = {
    uuid: "cube-1",
    visibility: true,
    export: true,
    mesh: new MockMesh(),
    parent: null,
    from: [0, 0, 0], to: [1, 1, 1], origin: [0, 0, 0],
    rotation: [0, 0, 0], inflate: 0, box_uv: false,
    mirror_uv: false, uv_offset: [0, 0],
    faces: { north: { uv: [0, 0, 1, 1], rotation: 0, material_name: null, getTexture: () => texture } },
  };
  const Project = { uuid: "project-1", name: "Fixture", saved: true };
  const glbBytes = fixtureGlb();
  const sceneInputs: unknown[] = [];
  const THREE = {
    Mesh: MockMesh,
    Scene: MockScene,
    MeshStandardMaterial: MockMaterial,
    CanvasTexture: MockCanvasTexture,
    DoubleSide: 2,
    NearestFilter: 1003,
    SRGBColorSpace: "srgb",
    NoColorSpace: "linear",
    Color: class { constructor(_value: unknown) {} },
    GLTFExporter: class {
      parse(scene: unknown, done: (out: ArrayBuffer) => void) {
        sceneInputs.push(scene);
        done(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength));
      }
    },
  };
  const values: Record<string, unknown> = {
    Project, Format: { id: "bedrock" }, Cube: { all: [cube] },
    Group: class {}, Mesh: { all: [] },
    Texture: { all: [texture] }, TextureGroup: { all: [] },
    THREE,
    document: {
      createElement: (_tag: string) => ({
        width: 0, height: 0,
        getContext: (_type: string) => ({
          putImageData: () => {},
          createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w*h*4) }),
        }),
      }),
    },
  };
  for (const [name, value] of Object.entries(values)) (globalThis as any)[name] = value;
  return { cube, texture, Project, rgba, sceneInputs, values };
}

afterEach(() => {
  for (const [name, prior] of previous) {
    if (prior.present) (globalThis as any)[name] = prior.value;
    else delete (globalThis as any)[name];
  }
  previous.clear();
});

describe("Detached native fidelity bridge", () => {
  test("clones Cube geometry without mutating project, face UV, source RGBA or native mesh", async () => {
    const f = installNativeFixture();
    const before = JSON.stringify({ cube: f.cube, rgba: [...f.rgba] });
    const result = await snapshotDetachedPublicationGlb();
    expect(result.project_uuid).toBe("project-1");
    expect(result.cube_count).toBe(1);
    expect(result.material_count).toBe(1);
    expect(result.glb.toString("ascii", 0, 4)).toBe("glTF");
    expect(f.sceneInputs).toHaveLength(1);
    expect(JSON.stringify({ cube: f.cube, rgba: [...f.rgba] })).toBe(before);
    verifyPublicationSourceCurrent(result.project_uuid, result.source_sha256);
    f.rgba[0] = 81;
    expect(() => verifyPublicationSourceCurrent(result.project_uuid, result.source_sha256)).toThrow("STALE");
  });

  test("maps supported MER/normal with exact pixel-channel semantics", async () => {
    const color = new Uint8ClampedArray([200, 100, 50, 255]);
    const mer = new Uint8ClampedArray([255, 128, 64, 255]);
    const packed = convertBedrockMerToGltf(color, mer);
    expect([...packed.metallicRoughness]).toEqual([0, 64, 255, 255]);
    expect([...packed.emission]).toEqual([100, 50, 25, 255]);
    expect([...convertBedrockNormalToGltf(new Uint8ClampedArray([128, 12, 255, 255]))])
      .toEqual([128, 243, 255, 255]);
    expect(() => convertBedrockMerToGltf(color, new Uint8ClampedArray(8))).toThrow();

    const f = installNativeFixture();
    const merTexture = {
      uuid: "mer-1", group: "group-1", pbr_channel: "mer",
      ctx: {
        canvas: { width: 1, height: 1 },
        getImageData: () => ({ data: mer, width: 1, height: 1 }),
      },
    };
    (globalThis as any).Texture.all.push(merTexture);
    (globalThis as any).TextureGroup.all = [{
      uuid: "group-1", name: "PBR", is_material: true,
      material_config: { mer_value: [0, 0, 255] },
      getTextures: () => [{ ...f.texture, pbr_channel: "color" }, merTexture],
    }];
    f.texture.group = "group-1";
    const result = await snapshotDetachedPublicationGlb();
    expect(result.materials["ld_color_tex-1"]).toMatchObject({
      pbr: "MAPPED", mer_sha256: expect.any(String),
    });
    verifyPublicationSourceCurrent(result.project_uuid, result.source_sha256);
    mer[1] = 200;
    expect(() => verifyPublicationSourceCurrent(result.project_uuid, result.source_sha256)).toThrow("STALE");
  });

  test("fails closed on ambiguous PBR, alpha, non-Cube geometry and invalid faces", async () => {
    const f = installNativeFixture();
    (globalThis as any).TextureGroup.all = [{
      uuid: "group-1", name: "PBR", is_material: true,
      material_config: { mer_value: [0, 0, 255] },
      getTextures: () => [],
    }];
    f.texture.group = "group-1";
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("PBR_CHANNELS_AMBIGUOUS");
    f.texture.group = "";
    f.rgba[3] = 127;
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("ALPHA_SEMANTICS_UNVERIFIED");
    f.rgba[3] = 255;
    (globalThis as any).Mesh.all = [{ visibility: true, export: true }];
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("UNSUPPORTED_NON_CUBE");
    (globalThis as any).Mesh.all = [];
    f.cube.faces.north.getTexture = () => undefined as any;
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("FACE_TEXTURE_UNRESOLVED");
  });

  test("rejects source modification during exporter callback instead of delivering stale GLB", async () => {
    const f = installNativeFixture();
    const THREE = (globalThis as any).THREE;
    THREE.GLTFExporter = class {
      parse(_scene: unknown, done: (out: ArrayBuffer) => void) {
        f.rgba[0] += 1;
        const data = fixtureGlb();
        done(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      }
    };
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("SOURCE_CHANGED_DURING_GLTF_SNAPSHOT");
  });
});

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
import { expectedPublicationGltfMaterial } from "@/lib/publication/materialContract";
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
    expect(args.camera).toMatchObject({ mode: "auto", projection: "perspective", framing_padding: 1.28 });
    expect(args.device).toBe("auto");
    expect(args.view_transform).toBe("AgX");
    expect(args.environment).toEqual({ mode: "studio" });
    expect(args.look).toEqual({
      key: 1, fill: 1, rim: 1, softness: 1,
      environment: 1, exposure_ev: 0,
      glow_strength: 0.08, glow_threshold: 2, glow_size: 0.45,
    });
    const partial = publicationRenderParameters.parse({
      ...valid,
      camera: { yaw_degrees: -24 },
      look: { key: 1.4, exposure_ev: -0.5 },
    });
    expect(partial.camera).toEqual({
      yaw_degrees: -24, elevation_degrees: 18, projection: "perspective",
      mode: "auto", framing_padding: 1.28,
    });
    expect(partial.look).toEqual({
      key: 1.4, fill: 1, rim: 1, softness: 1,
      environment: 1, exposure_ev: -0.5,
      glow_strength: 0.08, glow_threshold: 2, glow_size: 0.45,
    });
    for (const input of [
      { ...valid, blender_executable: "blender" },
      { ...valid, blender_executable: "C:\\Windows\\System32\\cmd.exe" },
      { ...valid, output_path: "C:\\Art\\..\\unsafe.png" },
      { ...valid, output_path: "../asset.png" },
      { ...valid, output_path: "C:\\Art\\asset.glb" },
      { ...valid, width: 8192 },
      { ...valid, width: 4096, height: 4096 },
      { ...valid, quality: "random" },
      { ...valid, device: "cuda_and_shell" },
      { ...valid, environment: { mode: "hdri" } },
      { ...valid, environment: { mode: "studio", hdri_path: "C:\\Art\\studio.hdr" } },
      { ...valid, environment: { mode: "hdri", hdri_path: "https://example.com/env.hdr" } },
      { ...valid, environment: { mode: "hdri", hdri_path: "C:\\Art\\..\\unsafe.hdr" } },
      { ...valid, view_transform: "unverified_transform" },
      { ...valid, camera: { mode: "unknown" } },
      { ...valid, camera: { framing_padding: 0.2 } },
      { ...valid, background: "fantasy" },
      { ...valid, camera: { yaw_degrees: Infinity } },
      { ...valid, look: { key: 0 } },
      { ...valid, look: { rim: -1 } },
      { ...valid, look: { softness: 6 } },
      { ...valid, look: { exposure_ev: Infinity } },
      { ...valid, look: { unknown: 1 } },
      { ...valid, look: { glow_strength: 0.4 } },
      { ...valid, look: { glow_threshold: 0 } },
      { ...valid, look: { glow_size: 2 } },
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
      mesh_count: 1,
      materials: {
        ld_color_abc: {
          color_uuid: "abc", texture_sha256: "b".repeat(64),
          alpha_mode: "OPAQUE", pbr: "NONE",
          gltf: expectedPublicationGltfMaterial(null),
        },
      },
    });
    expect(job.schema_version).toBe(1);
    expect(job.samples).toBe(128);
    expect(job.look).toEqual(publicationRenderParameters.parse(valid).look);
    expect(job.expected_mesh_count).toBe(1);
    expect(job.expected_material_count).toBe(1);
    expect(job.report_path).toMatch(/report\.json$/);
    expect(job.preview_path).toMatch(/evidence\.png$/);
    expect(job.environment).toEqual({ mode: "studio", hdri_path: null, hdri_sha256: null });
    expect(job.device).toBe("auto");
    expect(job.view_transform).toBe("AgX");
    expect(job.camera.mode).toBe("auto");
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
    const branches = manifestEntriesForCapability("render_publication");
    expect(branches).toHaveLength(4);
    expect(branches.map(branch => branch.branch?.value)).toEqual(["start", "status", "preview", "cancel"]);
    expect(branches.map(branch => branch.operationClass)).toEqual(["EXPORT", "QUERY", "QUERY", "CONTROL"]);
    expect(branches[0]?.semantic?.intents).toContain("start actual 3D Blender render");
  });
});

/** Minimal structurally plausible GLB; not a substitute for the real exporter. */
function fixtureGlb(options: {
  imageUri?: string;
  sourceIndex?: number;
  textureIndex?: number;
  corruptUv?: boolean;
  materialProfile?: "opaque" | "pbr_mer" | "pbr_uniform";
  corruptMaterial?: boolean;
  linearSampling?: boolean;
  swappedBaseTexture?: boolean;
  withNormal?: boolean;
} = {}): Buffer {
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  const uv = [0, 1, 1, 1, 1, 0, 0, 0]; // Blockbench preview V inverted for glTF.
  if (options.corruptUv) uv[1] = 0.5;
  const indices = [0, 2, 1, 0, 3, 2];
  const bin = Buffer.alloc(48 + 32 + 12);
  positions.forEach((value, index) => bin.writeFloatLE(value, index * 4));
  uv.forEach((value, index) => bin.writeFloatLE(value, 48 + index * 4));
  indices.forEach((value, index) => bin.writeUInt16LE(value, 80 + index * 2));
  const profile = options.materialProfile ?? "opaque";
  const pbr = profile === "pbr_mer"
    ? { metallicFactor: 1, roughnessFactor: 1 }
    : profile === "pbr_uniform"
      ? { metallicFactor: 0, roughnessFactor: 1 }
      : { metallicFactor: 0, roughnessFactor: 0.85 };
  const material = {
    name: "ld_color_tex-1",
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorTexture: { index: options.textureIndex ?? 0 },
      metallicFactor: options.corruptMaterial ? 0.3 : pbr.metallicFactor,
      roughnessFactor: pbr.roughnessFactor,
      ...(profile === "pbr_mer" ? { metallicRoughnessTexture: { index: 1 } } : {}),
    },
    ...(profile === "pbr_mer" ? {
      emissiveFactor: [1, 1, 1],
      emissiveTexture: { index: 2 },
    } : {}),
    ...(options.withNormal ? {
      normalTexture: { index: profile === "pbr_mer" ? 3 : 1 },
    } : {}),
  };
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{
      mesh: 0, name: "cube_cube-1",
      extras: {
        lazydesigner_cube_uuid: "cube-1",
        lazydesigner_bounds_min: [0, 0, 0],
        lazydesigner_bounds_max: [0.0625, 0, 0.0625],
      },
    }],
    meshes: [{ primitives: [{
      mode: 4, indices: 2,
      attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0,
    }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 48, byteLength: 32, target: 34962 },
      { buffer: 0, byteOffset: 80, byteLength: 12, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3",
        min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    materials: [material],
    samplers: [{
      magFilter: options.linearSampling ? 9729 : 9728,
      minFilter: options.linearSampling ? 9729 : 9728,
      wrapS: 33071, wrapT: 33071,
    }],
    textures: [
      {
        name: options.swappedBaseTexture ? "ld_normal_tex-1" : "ld_base_tex-1",
        source: options.sourceIndex ?? 0, sampler: 0,
      },
      ...(profile === "pbr_mer" ? [
        { name: "ld_mer_tex-1", source: 0, sampler: 0 },
        { name: "ld_emission_tex-1", source: 0, sampler: 0 },
      ] : []),
      ...(options.withNormal ? [{
        name: "ld_normal_tex-1", source: 0, sampler: 0,
      }] : []),
    ],
    images: [{ uri: options.imageUri ??
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAUAAarVyFEAAAAASUVORK5CYII=" }],
  }));
  const padded = Buffer.alloc(Math.ceil(json.byteLength / 4) * 4, 0x20);
  json.copy(padded);
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + bin.length);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20);
  const binOffset = 20 + padded.length;
  glb.writeUInt32LE(bin.length, binOffset);
  glb.writeUInt32LE(0x004e4942, binOffset + 4);
  bin.copy(glb, binOffset + 8);
  return glb;
}

describe("GLB envelope and source fidelity preflight", () => {
  test("checks PBR factors and nearest filtering, not just valid image/texture references", () => {
    const colorReceipt = {
      "ld_color_tex-1": {
        color_uuid: "tex-1", texture_sha256: "a".repeat(64),
        alpha_mode: "OPAQUE" as const, pbr: "NONE" as const,
        gltf: expectedPublicationGltfMaterial(null),
      },
    };
    expect(inspectPublicationGlb(fixtureGlb(), 1, 1, undefined, colorReceipt))
      .toMatchObject({ mesh_count: 1, material_count: 1 });
    expect(() => inspectPublicationGlb(
      fixtureGlb({ corruptMaterial: true }), 1, 1, undefined, colorReceipt,
    )).toThrow("PBR_FACTORS_OR_ALPHA_MISMATCH");
    expect(() => inspectPublicationGlb(
      fixtureGlb({ linearSampling: true }), 1, 1, undefined, colorReceipt,
    )).toThrow("PBR_NEAREST_SAMPLING_LOST");
    expect(() => inspectPublicationGlb(
      fixtureGlb({ swappedBaseTexture: true }), 1, 1, undefined, colorReceipt,
    )).toThrow("PBR_TEXTURE_IDENTITY_MISMATCH");

    const uniform = expectedPublicationGltfMaterial({
      color_uuid: "tex-1", mer_uuid: null, normal_uuid: null,
      uniform_mer: [0, 0, 255],
    });
    const uniformReceipt = {
      "ld_color_tex-1": { ...colorReceipt["ld_color_tex-1"], pbr: "MAPPED" as const, gltf: uniform },
    };
    expect(inspectPublicationGlb(
      fixtureGlb({ materialProfile: "pbr_uniform" }), 1, 1, undefined, uniformReceipt,
    ).material_count).toBe(1);
    const merMap = expectedPublicationGltfMaterial({
      color_uuid: "tex-1", mer_uuid: "mer-1", normal_uuid: null,
      uniform_mer: null,
    });
    const merReceipt = {
      "ld_color_tex-1": { ...colorReceipt["ld_color_tex-1"], pbr: "MAPPED" as const, gltf: merMap },
    };
    expect(inspectPublicationGlb(
      fixtureGlb({ materialProfile: "pbr_mer" }), 1, 1, undefined, merReceipt,
    ).material_count).toBe(1);
    expect(() => inspectPublicationGlb(
      fixtureGlb({ materialProfile: "pbr_uniform" }), 1, 1, undefined, merReceipt,
    )).toThrow("PBR_FACTORS_OR_ALPHA_MISMATCH");
    const merNormalReceipt = {
      "ld_color_tex-1": {
        ...merReceipt["ld_color_tex-1"],
        gltf: expectedPublicationGltfMaterial({
          color_uuid: "tex-1", mer_uuid: "mer-1",
          normal_uuid: "normal-1", uniform_mer: null,
        }),
      },
    };
    expect(inspectPublicationGlb(
      fixtureGlb({ materialProfile: "pbr_mer", withNormal: true }),
      1, 1, undefined, merNormalReceipt,
    ).material_count).toBe(1);
    expect(() => inspectPublicationGlb(
      fixtureGlb({ materialProfile: "pbr_mer" }),
      1, 1, undefined, merNormalReceipt,
    )).toThrow("PBR_TEXTURE_ROLE_MISMATCH");
  });

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
    expect(() => inspectPublicationGlb(
      fixtureGlb({ imageUri: "https://example.com/untrusted.png" }), 1, 1,
    )).toThrow("SOURCE_INVENTORY_MISMATCH");
    expect(() => inspectPublicationGlb(
      fixtureGlb({ imageUri: "data:image/png;base64,AA==" }), 1, 1,
    )).toThrow("SOURCE_INVENTORY_MISMATCH");
    expect(() => inspectPublicationGlb(
      fixtureGlb({ sourceIndex: 2 }), 1, 1,
    )).toThrow("TEXTURE_IMAGE_REFERENCE_INVALID");
    expect(() => inspectPublicationGlb(
      fixtureGlb({ textureIndex: 2 }), 1, 1,
    )).toThrow("MATERIAL_TEXTURE_REFERENCE_INVALID");
    const mutated = Buffer.from(valid);
    const pos = mutated.indexOf("TEXCOORD_0");
    expect(pos).toBeGreaterThan(0);
    mutated.write("TEXCOORX_0", pos, "ascii");
    expect(() => inspectPublicationGlb(mutated, 1, 1)).toThrow("PRIMITIVE_UV_OR_MATERIAL_INVALID");
  });
});

const previous = new Map<string, { present: boolean; value: unknown }>();
const names = ["Project", "Format", "Modes", "Cube", "Group", "Mesh", "Texture", "TextureGroup", "THREE", "document"];

function installNativeFixture() {
  for (const name of names) {
    previous.set(name, {
      present: Object.hasOwn(globalThis, name),
      value: (globalThis as any)[name],
    });
  }
  class Geometry {
    attributes = {
      position: { array: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] },
      uv: { array: [0, 0, 1, 0, 1, 1, 0, 1] },
    };
    index = { array: [0, 2, 1, 0, 3, 2] };
    faces = ["north"];
    groups = [{ start: 0, count: 6, materialIndex: 0 }];
    clone() { return new Geometry(); }
    applyMatrix4(_matrix: unknown) { return this; }
    scale(_x: number, _y: number, _z: number) { return this; }
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
    currentFrame: 0,
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
    ClampToEdgeWrapping: 1001,
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
    Project, Format: { id: "bedrock" }, Modes: { edit: true, animate: false },
    Cube: { all: [cube] },
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
    expect(result.source_manifest.pose_mode).toBe("EDIT_STATIC_VERIFIED");
    expect(result.source_manifest.gltf_units_per_blockbench_unit).toBe(0.0625);
    expect(result.source_manifest.cubes[0]?.expected_blender_bounds_max)
      .toEqual([0.0625, 0, 0.0625]);
    expect(result.source_manifest.cubes[0]?.primitives[0]?.material_name)
      .toBe("ld_color_tex-1");
    expect(result.source_manifest_sha256).toHaveLength(64);
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
      uuid: "mer-1", group: "group-1", pbr_channel: "mer", currentFrame: 0,
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
    const output = fixtureGlb({ materialProfile: "pbr_mer" });
    (globalThis as any).THREE.GLTFExporter = class {
      parse(_scene: unknown, done: (out: ArrayBuffer) => void) {
        done(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength));
      }
    };
    const result = await snapshotDetachedPublicationGlb();
    expect(result.materials["ld_color_tex-1"]).toMatchObject({
      pbr: "MAPPED", mer_sha256: expect.any(String),
    });
    verifyPublicationSourceCurrent(result.project_uuid, result.source_sha256);
    mer[1] = 200;
    expect(() => verifyPublicationSourceCurrent(result.project_uuid, result.source_sha256)).toThrow("STALE");
  });

  test("never substitutes an unrelated or ambiguous PBR display-name group", async () => {
    const f = installNativeFixture();
    f.texture.group = "not-found";
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow(
      "PUBLICATION_TEXTURE_GROUP_UNRESOLVED_OR_AMBIGUOUS"
    );
    const group = (uuid: string, name: string) => ({
      uuid, name, is_material: true,
      material_config: { mer_value: [0, 0, 255] },
      getTextures: () => [{ ...f.texture, pbr_channel: "color" }],
    });
    (globalThis as any).TextureGroup.all = [
      group("uuid-1", "shared-name"),
      group("uuid-2", "shared-name"),
    ];
    f.texture.group = "shared-name";
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow(
      "PUBLICATION_TEXTURE_GROUP_UNRESOLVED_OR_AMBIGUOUS"
    );
    // A stable UUID takes precedence over duplicate human-readable group names.
    f.texture.group = "uuid-1";
    const output = fixtureGlb({ materialProfile: "pbr_uniform" });
    (globalThis as any).THREE.GLTFExporter = class {
      parse(_scene: unknown, done: (out: ArrayBuffer) => void) {
        done(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength));
      }
    };
    const result = await snapshotDetachedPublicationGlb();
    expect(result.materials["ld_color_tex-1"]?.pbr).toBe("MAPPED");
  });

  test("fails closed on ambiguous PBR, alpha, non-Cube geometry and invalid faces", async () => {
    const f = installNativeFixture();
    (globalThis as any).TextureGroup.all = [{
      uuid: "group-1", name: "PBR", is_material: true,
      material_config: { mer_value: [0, 0, 255] },
      getTextures: () => [],
    }];
    f.texture.group = "group-1";
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("PBR_CHANNEL_INVENTORY_INVALID");
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

  test("rejects nonfinite MCP Cube positions and mismatched face UV inventory", async () => {
    const f = installNativeFixture();
    f.cube.mesh.geometry.attributes.position.array[0] = Number.NaN;
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow(
      "PUBLICATION_SOURCE_GEOMETRY_INVALID_POSITION",
    );
    f.cube.mesh.geometry.attributes.position.array[0] = 0;
    f.cube.mesh.geometry.attributes.uv.array.pop();
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow(
      "PUBLICATION_SOURCE_GEOMETRY_INVALID_UV",
    );
  });

  test("rejects out-of-bounds Cube triangle indices and malformed native material groups", async () => {
    const f = installNativeFixture();
    f.cube.mesh.geometry.index.array[2] = 99;
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow(
      "PUBLICATION_SOURCE_INDEX_OUT_OF_RANGE",
    );
    f.cube.mesh.geometry.index.array[2] = 2;
    f.cube.mesh.geometry.groups[0].start = 1;
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow(
      "PUBLICATION_SOURCE_FACE_GROUP_INVALID",
    );
  });

  test("fails closed on non-edit pose, ambiguous face slots and animated source frames", async () => {
    const fixture = installNativeFixture();
    (globalThis as any).Modes.edit = false;
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("POSE_PROVENANCE_UNVERIFIED");
    (globalThis as any).Modes.edit = true;
    fixture.texture.currentFrame = 1;
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("TEXTURE_FRAME_PROVENANCE_UNVERIFIED");
    fixture.texture.currentFrame = 0;
    fixture.cube.faces.north.material_name = "glass";
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow("UNSUPPORTED_FACE_MATERIAL");
  });

  test("detects corrupted actual GLB UV bytes even when mesh/material inventory matches", async () => {
    installNativeFixture();
    const corrupt = fixtureGlb({ corruptUv: true });
    (globalThis as any).THREE.GLTFExporter = class {
      parse(_scene: unknown, done: (out: ArrayBuffer) => void) {
        done(corrupt.buffer.slice(corrupt.byteOffset, corrupt.byteOffset + corrupt.byteLength));
      }
    };
    await expect(snapshotDetachedPublicationGlb()).rejects.toThrow(
      "PUBLICATION_GLB_SOURCE_UV_BYTES_MISMATCH",
    );
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

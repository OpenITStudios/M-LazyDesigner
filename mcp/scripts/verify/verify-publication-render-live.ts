/**
 * Explicit, disposable, real Blender 5.2 smoke proof. No user models, no
 * Blockbench, no network and no AI image generation. Never run automatically
 * as part of the default package checks. Requires an explicitly supplied,
 * existing Blender executable and a Bun-capable cloud/local environment.
 *
 * Usage (from mcp/): bun run ./scripts/verify/verify-publication-render-live.ts /absolute/path/to/blender
 * Proves only synthetic GLB->Blender Cycles PNG; LIVE_BLOCKBENCH fidelity is separate.
 */
import { createHash } from "node:crypto";
import { expectedPublicationGltfMaterial } from "../../lib/publication/materialContract";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { inspectPublicationGlb } from "../../lib/publication/glbIntegrity";
import { isAbsoluteFilesystemPath } from "../../lib/core/path";
import { blenderRenderArgs, makePublicationJob, publicationRenderParameters } from "../../lib/publication/contracts";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4U2HzHwAGVAKQ461wkAAAAABJRU5ErkJggg==",
  "base64",
);

function aligned(value: number): number {
  return (value + 3) & ~3;
}

function makeRealFixtureGlb(): Buffer {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
  const uv = Buffer.alloc(24);
  [0, 0, 1, 0, 0, 1].forEach((v, i) => uv.writeFloatLE(v, i * 4));
  const indices = Buffer.alloc(8);
  [0, 1, 2].forEach((v, i) => indices.writeUInt16LE(v, i * 2));
  const binary = Buffer.concat([positions, uv, indices, ONE_PIXEL_PNG]);
  const json = {
    asset: { version: "2.0", generator: "LazyDesigner disposable Cycles smoke" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{
      mesh: 0, name: "cube_test",
      extras: {
        lazydesigner_cube_uuid: "test",
        lazydesigner_bounds_min: [0, 0, 0],
        lazydesigner_bounds_max: [1, 0, 1],
      },
    }],
    meshes: [{ primitives: [{
      attributes: { POSITION: 0, TEXCOORD_0: 1 },
      indices: 2, material: 0, mode: 4,
    }] }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 24, target: 34962 },
      { buffer: 0, byteOffset: 60, byteLength: 6, target: 34963 },
      { buffer: 0, byteOffset: 68, byteLength: ONE_PIXEL_PNG.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0,0,0], max: [1,1,0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
      { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    images: [{ mimeType: "image/png", bufferView: 3, name: "ld_base_test" }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    textures: [{ source: 0, sampler: 0 }],
    materials: [{
      name: "ld_color_test", doubleSided: true,
      pbrMetallicRoughness: {
        metallicFactor: 0, roughnessFactor: 0.85,
        baseColorTexture: { index: 0 },
      },
    }],
  };
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(aligned(text.length), 0x20);
  text.copy(jsonChunk);
  const binaryChunk = Buffer.alloc(aligned(binary.length));
  binary.copy(binaryChunk);
  const glb = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binaryChunk.length);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  let offset = 12;
  glb.writeUInt32LE(jsonChunk.length, offset);
  glb.writeUInt32LE(0x4E4F534A, offset + 4);
  jsonChunk.copy(glb, offset + 8);
  offset += 8 + jsonChunk.length;
  glb.writeUInt32LE(binaryChunk.length, offset);
  glb.writeUInt32LE(0x004E4942, offset + 4);
  binaryChunk.copy(glb, offset + 8);
  inspectPublicationGlb(glb, 1, 1);
  return glb;
}

function runWithConfirmedExit(
  blender: string, worker: string, jobPath: string, cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(blender, blenderRenderArgs(worker, jobPath), {
      cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let stderr = "";
    let stdout = "";
    let timedOut = false;
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | null = null;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (grace !== null) clearTimeout(grace);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* no confirmation of process exit */ }
      grace = setTimeout(() => {
        settle(new Error("Cycles smoke process exit not confirmed after termination."));
      }, 12_000);
    }, 180_000);
    child.stdout.on("data", chunk => { stdout = (stdout + chunk.toString()).slice(-16_000); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-16_000); });
    child.on("error", error => settle(error));
    child.on("close", code => {
      if (timedOut || code !== 0 || !stdout.includes("LAZYDESIGNER_RENDER_OUTPUT=")) {
        settle(new Error("Cycles smoke failed: " + JSON.stringify({
          code, timedOut, stderr: stderr.slice(-1500), stdout: stdout.slice(-500),
        })));
      } else {
        settle();
      }
    });
  });
}

async function main(): Promise<void> {
  const blender = process.argv[2];
  if (!blender || !/[/\\]blender(?:\.exe)?$/i.test(blender) || !isAbsoluteFilesystemPath(blender)) {
    throw new Error("Provide an existing absolute Blender 5.2 executable path (POSIX) for this explicit smoke run.");
  }
  const dir = await mkdtemp(join(tmpdir(), "lazydesigner-publication-smoke-"));
  const glbPath = join(dir, "fixture.glb");
  const jobPath = join(dir, "job.json");
  const outputPath = join(dir, "result.png");
  const workerPath = resolve(import.meta.dir, "../../server/publication/worker/render.py");
  let processExitConfirmed = false;
  try {
    await writeFile(glbPath, makeRealFixtureGlb());
    const request = publicationRenderParameters.parse({
      blender_executable: blender,
      output_path: outputPath,
      quality: "preview",
      width: 256, height: 256,
      look: { key: 1, fill: 0.8, rim: 0.7, softness: 1.1, environment: 1, exposure_ev: 0 },
    });
    const job = makePublicationJob(request, {
      project_uuid: "disposable-synthetic-only",
      sha256: "0".repeat(64),
      glb_path: glbPath, mesh_count: 1,
      materials: { ld_color_test: {
        color_uuid: "synthetic", texture_sha256: createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),
        alpha_mode: "OPAQUE", pbr: "NONE",
        gltf: expectedPublicationGltfMaterial(null),
      } },
    });
    await writeFile(jobPath, JSON.stringify(job), { flag: "wx" });
    await runWithConfirmedExit(blender, workerPath, jobPath, dir);
    processExitConfirmed = true;
    const png = await readFile(outputPath);
    if (png.length < 32 || png.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
        png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) {
      throw new Error("Cycles smoke produced no valid 256x256 PNG.");
    }
    console.log(JSON.stringify({
      state: "BLENDER_SYNTHETIC_SMOKE_PASS",
      fixture: "DISPOSABLE_NOT_A_USER_MODEL",
      blender_target: "5.2.x",
      engine: "CYCLES",
      result_sha256: createHash("sha256").update(png).digest("hex"),
      bytes: png.length,
      source_fidelity_live_blockbench: "NOT_EXECUTED",
      visual_acceptance: "NOT_EVALUATED",
    }, null, 2));
  } finally {
    if (processExitConfirmed) {
      await rm(dir, { recursive: true, force: true });
    } else {
      console.warn("Synthetic smoke worker exit/receipt is unconfirmed; preserving isolated files:", dir);
    }
  }
}

await main();

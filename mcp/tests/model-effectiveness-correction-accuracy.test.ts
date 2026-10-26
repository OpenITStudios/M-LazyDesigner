import { describe, expect, test } from "bun:test";
import { cubeSchema } from "@/lib/zodObjects";
import {
  modifyCubeParameters,
  modifyCubesBatchParameters,
  placeCubeParameters,
} from "@/server/tools/geometry/cubes";
import { BoxUvCapacityError, packBoxUvOffsets } from "@/lib/boxUvLayout";
import { requireFiniteTranslatedElementVector3 } from "@/server/tools/element";
import { inspectElementParameters, requireFiniteInspectableVector3 } from "@/server/tools/element/inspection";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

// Isolated native mocks exercise the real registered executors and parameter
// schemas without leaking Blockbench globals into other tests. Not live proof.
const cubeRuntimeFixture = String.raw`
import assert from "node:assert/strict";
import { registerCubesTools } from "./server/tools/geometry/cubes.ts";
import { registerElementInspectionTools } from "./server/tools/element/inspection.ts";
import { getAllToolDefinitions } from "./lib/factories.ts";
class MockCube {
  static all = [];
  constructor(data) {
    Object.assign(this, {
      uuid: "cube-" + MockCube.all.length, name: "cube",
      from: [0,0,0], to: [16,16,16], origin: [0,0,0], rotation: [0,0,0],
      inflate: 0, box_uv: Project.box_uv, uv_offset: [0,0], autouv: 1,
      mirror_uv: false, visibility: true, export: true, parent: "root",
    }, data);
    this.faces = Object.fromEntries(["north","south","east","west","up","down"].map(key => [key, {
      uv: [0,0,16,16], rotation: 0, enabled: true,
      getTexture() { return texture; },
      extend(change) { Object.assign(this, structuredClone(change)); },
    }]));
  }
  init() { MockCube.all.push(this); return this; }
  addTo(parent) { this.parent = parent; return this; }
  extend(change) { Object.assign(this, structuredClone(change)); return this; }
  mapAutoUV() {}
}
class MockGroup { static all = []; }
class MockLocator { static all = []; }
class MockNull { static all = []; }
const undo = { started: 0, finished: 0, cancelled: 0 };
const texture = { uuid: "atlas", name: "atlas", id: "0", width: 128, height: 128, display_height: 128,
  getUVWidth() { return 128; }, getUVHeight() { return 128; } };
Object.assign(globalThis, {
  Project: { selected: true, box_uv: true, texture_width: 128, texture_height: 128, textures: [texture] },
  Format: { id: "bedrock" }, Cube: MockCube, Group: MockGroup, Locator: MockLocator, NullObject: MockNull,
  Texture: { getDefault: () => texture }, Canvas: { updateAll() {} },
  Undo: { initEdit() { undo.started++; }, finishEdit() { undo.finished++; }, cancelEdit() { undo.cancelled++; } },
});
registerCubesTools();
registerElementInspectionTools();
async function invoke(name, request) {
  const definition = getAllToolDefinitions()[name];
  const args = await definition.parameterSchema.parseAsync(request);
  const result = await definition.execute(args);
  return result.structuredContent;
}
async function create(elements) { return invoke("manage_cubes", { operation: "create", elements }); }
`;

function runCubeRuntimeFixture(body: string): void {
  const result = Bun.spawnSync([process.execPath, "--eval", cubeRuntimeFixture + body], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr) || `Cube fixture exited ${result.exitCode}`);
  }
}

describe("model creation effectiveness — correction accuracy", () => {
  test("single-Cube mutation rejects id-only correction requests", () => {
    expect(modifyCubeParameters.safeParse({ id: "cube-uuid" }).success).toBe(false);
    expect(modifyCubeParameters.safeParse({ id: "cube-uuid", from: [0, 0, 0] }).success).toBe(true);
  });

  test("Cube identity and face inputs remain deterministic", () => {
    expect(cubeSchema.safeParse({ name: "body" }).success).toBe(true);
    expect(cubeSchema.safeParse({ name: "" }).success).toBe(false);
    expect(placeCubeParameters.safeParse({
      elements: [{ name: "body", from: [0, 0, 0], to: [4, 8, 4] }],
      faces: [{ face: "north", uv: [0, 0, 4, 8] }],
    }).success).toBe(true);
    expect(placeCubeParameters.safeParse({
      elements: [{ name: "body", from: [0, 0, 0], to: [4, 8, 4] }],
      faces: [{ face: "north", uv: [0, 0, 4, 8] }, { face: "north", uv: [0, 0, 4, 8] }],
    }).success).toBe(false);
  });

  test("place_cube does not expose generic per-Cube texture selection", async () => {
    const cubes = await source("server/tools/geometry/cubes.ts");
    const start = cubes.indexOf("export const placeCubeParameters");
    const end = cubes.indexOf("export const modifyCubeParameters", start);
    const block = cubes.slice(start, end);
    expect(block).not.toContain("texture:");
    expect(block).not.toContain("applyTo");
    expect(block).toContain("faces:");
  });

  test("focused element inspection refuses non-finite transform evidence", () => {
    expect(inspectElementParameters.safeParse({ id: "cube-uuid" }).success).toBe(true);
    expect(inspectElementParameters.safeParse({ id: "" }).success).toBe(false);
    expect(() => requireFiniteInspectableVector3([0, Number.NaN, 2], "fixture")).toThrow();
  });

  test("batch Cube correction rejects duplicate/unsupported inputs at schema boundary", () => {
    expect(modifyCubesBatchParameters.safeParse({ updates: [{ id: "a", from: [0, 0, 0] }, { id: "a", to: [1, 1, 1] }] }).success).toBe(false);
    expect(modifyCubesBatchParameters.safeParse({ updates: [{ id: "a", uv_offset: [8, 16], autouv: "0", mirror_uv: true }] }).success).toBe(true);
    expect(modifyCubesBatchParameters.safeParse({ updates: [{ id: "a", name: "renamed" }] }).success).toBe(false);
    expect(modifyCubesBatchParameters.safeParse({ updates: [{ id: "a", faces: [{ face: "north", uv: [0, 0, 32, 32] }] }] }).success).toBe(true);
    expect(modifyCubesBatchParameters.safeParse({ updates: [{ id: "a", faces: [{ face: "north", uv: [0, 0, 32, 32] }, { face: "north", uv: [0, 0, 16, 16] }] }] }).success).toBe(false);
  });

  test("batch Cube correction carries existing Box-UV authored state without a new tool", async () => {
    const cubes = await source("server/tools/geometry/cubes.ts");
    expect(cubes).toContain("update.uv_offset");
    expect(cubes).toContain("update.autouv");
    expect(cubes).toContain("update.mirror_uv");
    expect(cubes).toContain("update.faces");
    expect(cubes).toContain("cube.faces[face].extend");
    expect(cubes).toContain('"faces"');
    expect(cubes).toContain("geometryVisibilityFields");
    expect(cubes).not.toContain("professional_uv");
  });

  test("Cube authoring rejects finite endpoints that produce non-finite size", () => {
    expect(() => requireFiniteTranslatedElementVector3([Number.MAX_VALUE, 0, 0], [Number.MAX_VALUE, 0, 0], "fixture")).toThrow();
  });

  test("single-Cube correction returns current authored state plus structural effects", async () => {
    const cubes = await source("server/tools/geometry/cubes.ts");
    const effectStart = cubes.indexOf("function cubeGeometryEffect");
    const effectEnd = cubes.indexOf("type ModifyCubeRequest", effectStart);
    const geometryEffect = cubes.slice(effectStart, effectEnd);
    const start = cubes.indexOf("const executeUpdateCube");
    const end = cubes.indexOf("const executeBatchUpdateCubes", start);
    const block = cubes.slice(start, end);
    expect(block).toContain("geometry_effect");
    expect(block).toContain("cubeGeometryEffect(before, after)");
    expect(block).toContain("visual_verdict: \"not_evaluated\"");
    expect(geometryEffect).toContain("center_delta");
    expect(geometryEffect).toContain("size_delta");
    expect(geometryEffect).toContain("rotation_delta");
  });

  test("modelling owner requires a declared invariant before numeric correction", async () => {
    const [geometry, modelling] = await Promise.all([
      source("../docs/03-authoring/modelling/standard.md"),
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md")]).then((parts) => parts.join("\n")),
    ]);
    for (const text of [geometry, modelling]) {
      expect(text.toLowerCase()).toContain("invariant");
      expect(text).toContain("TRANSLATE");
      expect(text).toContain("RESIZE");
      expect(text).toContain("ROTATE");
    }
    expect(geometry).toContain("geometry_effect");
    expect(modelling).toContain("geometry_operations = exact semantic operation(s)");
    expect(modelling).toContain("invariant");
    expect(modelling).toContain(
      "Reuse fresh exact authored state; otherwise inspect once."
    );
  });

  test("Cube semantic motion readiness includes pivot and rotation changes", async () => {
    const sourceText = await source("lib/receipts/cubeMutation.ts");
    expect(sourceText).toContain('"origin"');
    expect(sourceText).toContain('"rotation"');
    expect(sourceText).toContain("CUBE_MOTION_READINESS_FIELDS");
  });

  test("packing distinguishes capacity exhaustion from malformed data", () => {
    expect(() => packBoxUvOffsets([], Array.from({ length: 9 }, () => [64, 32] as const), 128, 128)).toThrow(BoxUvCapacityError);
    expect(packBoxUvOffsets([], [[64, 32]], 128, 128)).toEqual([[0, 0]]);
    try {
      packBoxUvOffsets([{ x: 200, y: 0, width: 1, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }], [[1, 1]], 128, 128);
      throw new Error("malformed occupancy was accepted");
    } catch (error) {
      expect(error).not.toBeInstanceOf(BoxUvCapacityError);
      expect(String(error)).toContain("finite positive");
    }
  });

  test("nine valid Cube footprints do not make provisional atlas capacity a Geometry gate", () => {
    runCubeRuntimeFixture(String.raw`
const result = await create(Array.from({ length: 9 }, (_, i) => ({ name: "mass_" + i, from: [i*16,0,0], to: [(i+1)*16,16,16] })));
assert.equal(result.added, 9);
assert.equal(Cube.all.length, 9);
assert.equal(result.box_uv_layout, "deferred_for_native_template");
assert.deepEqual(result.cubes[0].from, [0,0,0]);
assert.deepEqual(result.cubes[0].to, [16,16,16]);
assert.deepEqual(result.cubes[0].size, [16,16,16]);
assert.deepEqual(result.cubes[0].box_uv_region.size, [64,32]);
assert.equal(result.visual_verdict, "not_evaluated");
assert.deepEqual(undo, { started: 1, finished: 1, cancelled: 0 });
`);
  });

  test("oversized existing provisional occupancy defers without hiding non-finite UV state", () => {
    runCubeRuntimeFixture(String.raw`
await create([{ name: "large", from: [0,0,0], to: [128,128,128] }]);
const result = await create([{ name: "small", from: [0,0,0], to: [1,1,1] }]);
assert.equal(result.box_uv_layout, "deferred_for_native_template");
Cube.all[0].uv_offset = [NaN, 0];
const before = undo.started;
await assert.rejects(() => create([{ name: "invalid_context", from: [0,0,0], to: [1,1,1] }]), /non-finite/);
assert.equal(undo.started, before);
assert.equal(Cube.all.length, 2);
`);
  });

  test("inherited per-face Geometry is not checked against a Box-UV rectangle", () => {
    runCubeRuntimeFixture(String.raw`
Project.box_uv = false;
const result = await create([{ name: "wide", from: [0,0,0], to: [256,16,16] }]);
assert.equal(result.added, 1);
assert.deepEqual(result.cubes[0].size, [256,16,16]);
`);
  });

  test("same face coordinates still apply a UV mode change, then reject a true no-op", () => {
    runCubeRuntimeFixture(String.raw`
const made = await create([{ name: "body", from: [0,0,0], to: [16,16,16] }]);
const id = made.cubes[0].uuid;
const request = { operation: "update", id, faces: [{ face: "north", uv: [0,0,16,16] }] };
const updated = await invoke("manage_cubes", request);
assert.equal(updated.after.box_uv, false);
assert.equal(updated.after.autouv, 0);
assert.ok(updated.changed_fields.includes("box_uv"));
const before = undo.started;
await assert.rejects(() => invoke("manage_cubes", { ...request, autouv: "1" }), /no authored effect/);
assert.equal(undo.started, before);
`);
  });

  test("batch correction returns fresh state and effects for every requested UUID", () => {
    runCubeRuntimeFixture(String.raw`
const made = await create([{ name: "a", from: [0,0,0], to: [16,16,16] }, { name: "b", from: [16,0,0], to: [32,16,16] }]);
const ids = made.cubes.map(cube => cube.uuid);
const result = await invoke("manage_cubes", { operation: "batch_update", updates: [
  { id: ids[0], to: [18,16,16] },
  { id: ids[1], faces: [{ face: "north", uv: [0,0,16,16] }] },
] });
assert.equal(result.effects.length, 2);
assert.deepEqual(result.effects.map(effect => effect.after.uuid), ids);
assert.deepEqual(result.effects[0].geometry_effect.size_delta, [2,0,0]);
assert.deepEqual(result.effects[0].after.to, [18,16,16]);
assert.equal(result.effects[1].after.box_uv, false);
assert.equal(result.effects[1].after.autouv, 0);
assert.equal(result.effective_geometry_targets, 1);
assert.equal(undo.finished, 2);
`);
  });

  test("UV inspection forwards actual rotation and pixel-axis scale to face and project diagnostics", () => {
    runCubeRuntimeFixture(String.raw`
await create([{ name: "panel", from: [0,0,0], to: [8,4,2] }]);
const cube = Cube.all[0];
for (const face of Object.values(cube.faces)) face.enabled = false;
cube.faces.north.enabled = true;
cube.faces.north.uv = [0,0,4,8];
let result = await invoke("inspect_element", { id: cube.uuid, detail: "uv" });
assert.equal(result.uv.faces.north.quality.aspect_state, "review_required");
assert.equal(result.uv.quality_summary.project_texel_density.excluded_aspect_review_faces, 1);
cube.faces.north.rotation = 90;
result = await invoke("inspect_element", { id: cube.uuid, detail: "uv" });
assert.equal(result.uv.faces.north.quality.aspect_state, "matched");
assert.equal(result.uv.quality_summary.project_texel_density.measured_faces, 1);
texture.width = 256;
result = await invoke("inspect_element", { id: cube.uuid, detail: "uv" });
assert.equal(result.uv.faces.north.quality.aspect_state, "review_required");
assert.deepEqual(result.uv.faces.north.quality.physical_pixels_per_model_unit_axes, { width: 1, height: 2 });
`);
  });
});

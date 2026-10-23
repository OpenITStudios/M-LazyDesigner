import { describe, expect, test } from "bun:test";
import { assertBedrockGeometryExport } from "@/scripts/verify/verify-geometry-live";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("live Geometry E2E verifier source contract", () => {
  test("requires explicit disposable consent and preserves proof boundaries", async () => {
    const [script, packageText] = await Promise.all([
      source("scripts/verify/verify-geometry-live.ts"),
      source("package.json"),
    ]);
    const scripts = JSON.parse(packageText).scripts as Record<string, string>;

    expect(scripts["verify:geometry-live"]).toBe(
      "bun run ./scripts/verify/verify-geometry-live.ts"
    );
    expect(script).toContain("--confirm-disposable");
    expect(script).toContain("requireDisposableConsent();");
    expect(script).toContain("discard_unsaved: true");
    expect(script).toContain('expectedPhase: "geometry"');
    expect(script).toContain("build_identity");
    expect(script).toContain('visual_quality: "not_evaluated"');
    expect(script).toContain(
      "do not prove reference or in-game visual fidelity."
    );

    expect(script).not.toContain("risky_eval");
    expect(script).not.toMatch(/similarity[_ -]?score/i);
    expect(script).not.toMatch(/set.*authoring.*phase/i);
  });

  test("disposable native Geometry rig verification samples and restores Bone rotation before Cube corrections", async () => {
    const script = await source("scripts/verify/verify-geometry-live.ts");
    for (const marker of [
      '"modify_group"',
      '"inspect_model_bounds"',
      "const baseWorldSize = await renderedModelSize(client);",
      "const rotatedWorldSize = await renderedModelSize(client);",
      "const rotatedFrontImage = await captureFront(client);",
      "restored_bone_rotation_and_world_bounds: true",
      "child_geometry_unchanged_during_group_rotation: true",
    ]) expect(script).toContain(marker);
    const create = script.indexOf('operation: "create"');
    const rotate = script.indexOf('rotation: [0, 45, 0]', create);
    const restore = script.indexOf('rotation: [0, 0, 0]', rotate);
    const cubeEdit = script.indexOf('operation: "update"', restore);
    expect(rotate).toBeGreaterThan(create);
    expect(restore).toBeGreaterThan(rotate);
    expect(cubeEdit).toBeGreaterThan(restore);
    const block = script.slice(rotate, cubeEdit);
    expect(block).toContain("beforeImage.data !== rotatedFrontImage.data");
    expect(block).toContain("rendered-world bounds stayed unchanged");
    expect(block).toContain("Restoring Bone rotation did not restore");
    expect(block).not.toContain('operation: "create"');
    expect(block).not.toContain("Undo.undo()");
    expect(script).toContain("requireDisposableConsent();");
  });

  test("native Bedrock compile parity preserves Bone, Cube mass and six Per-face UV rectangles", () => {
    const faces = {
      north: { uv: [0, 0], uv_size: [1, 4] },
      south: { uv: [2, 0], uv_size: [1, 4] },
      east: { uv: [4, 0], uv_size: [0.5, 4] },
      west: { uv: [5, 0], uv_size: [0.5, 4] },
      up: { uv: [7, 0.5], uv_size: [-1, -0.5] },
      down: { uv: [9, 0.5], uv_size: [-1, -0.5] },
    };
    const artifact = {
      format_version: "1.12.0",
      "minecraft:geometry": [{
        description: {
          identifier: "geometry.disposable", texture_width: 128, texture_height: 128,
        },
        bones: [{
          name: "e2e_root", pivot: [0, 8, 0],
          cubes: [
            { origin: [-6, 0, -2], size: [10, 8, 4], uv: [0, 0] },
            { origin: [-8, 0, -0.25], size: [1, 4, 0.5], uv: faces },
          ],
        }],
      }],
    };
    const expected = {
      boneName: "e2e_root", bonePivot: [0, 8, 0], bodyUvOffset: [0, 0],
      bodyFrom: [-4, 0, -2], bodyTo: [6, 8, 2],
      thinFrom: [7, 0, -0.25], thinTo: [8, 4, 0.25],
    };
    const raw = JSON.stringify(artifact);
    const evidence = assertBedrockGeometryExport(raw, expected);
    expect(evidence.exported_cube_count).toBe(2);
    expect(evidence.verified_thin_face_count).toBe(6);
    expect(evidence.visual_quality).toBe("not_evaluated");

    const wrongPivot = structuredClone(artifact);
    wrongPivot["minecraft:geometry"][0].bones[0].pivot = [0, 0, 0];
    expect(() => assertBedrockGeometryExport(JSON.stringify(wrongPivot), expected))
      .toThrow("Bone pivot");
    const wrongMass = structuredClone(artifact);
    wrongMass["minecraft:geometry"][0].bones[0].cubes[0].size = [10, 8, 3];
    expect(() => assertBedrockGeometryExport(JSON.stringify(wrongMass), expected))
      .toThrow("body size/position");
    const wrongBoxUv = structuredClone(artifact);
    wrongBoxUv["minecraft:geometry"][0].bones[0].cubes[0].uv = [1, 0];
    expect(() => assertBedrockGeometryExport(JSON.stringify(wrongBoxUv), expected))
      .toThrow("Box UV offset");
    const mirroredNorth = structuredClone(artifact);
    (mirroredNorth["minecraft:geometry"][0].bones[0].cubes[1].uv as typeof faces)
      .north = { uv: [1, 4], uv_size: [-1, -4] };
    expect(() => assertBedrockGeometryExport(JSON.stringify(mirroredNorth), expected))
      .toThrow("thin face north");
    const mirroredTop = structuredClone(artifact);
    (mirroredTop["minecraft:geometry"][0].bones[0].cubes[1].uv as typeof faces)
      .up = { uv: [6, 0], uv_size: [1, 0.5] };
    expect(() => assertBedrockGeometryExport(JSON.stringify(mirroredTop), expected))
      .toThrow("thin face up");
    const rotatedFace = structuredClone(artifact);
    Object.assign((rotatedFace["minecraft:geometry"][0].bones[0].cubes[1].uv as typeof faces).east,
      { uv_rotation: 90 });
    expect(() => assertBedrockGeometryExport(JSON.stringify(rotatedFace), expected))
      .toThrow("thin face east");
    const wrongUv = structuredClone(artifact);
    (wrongUv["minecraft:geometry"][0].bones[0].cubes[1].uv as typeof faces)
      .east.uv_size = [0, 4];
    expect(() => assertBedrockGeometryExport(JSON.stringify(wrongUv), expected))
      .toThrow("thin face east");
    const missing = structuredClone(artifact);
    missing["minecraft:geometry"][0].bones[0].cubes.pop();
    expect(() => assertBedrockGeometryExport(JSON.stringify(missing), expected))
      .toThrow("lost or invented a fixture Cube");
    expect(() => assertBedrockGeometryExport("not-json", expected))
      .toThrow("BEDROCK_EXPORT_INVALID_JSON");
  });

  test("live Bedrock geometry parity checks compile-only after native Undo/Redo", async () => {
    const text = await source("scripts/verify/verify-geometry-live.ts");
    const redo = text.indexOf('await client.callTool("redo"');
    const compiled = text.indexOf('await client.callTool("export_model"', redo);
    const parity = text.indexOf("assertBedrockGeometryExport(compiled.content", compiled);
    const output = text.indexOf("bedrock_export_parity: bedrockParity", parity);
    expect(redo).toBeGreaterThanOrEqual(0);
    expect(compiled).toBeGreaterThan(redo);
    expect(parity).toBeGreaterThan(compiled);
    expect(output).toBeGreaterThan(parity);
    expect(text).toContain('codec_id: "bedrock"');
    expect(text).toContain("max_content_length: 2_000_000");
    expect(text).toContain('compiled.save_behavior === "COMPILE_ONLY"');
    expect(text).toContain("compiled.truncated === false");
    expect(text).not.toContain('codec_id: "project"');
  });

  test("runs a bounded create-readback-render-mutate-undo-redo sequence through current consolidated tools", async () => {
    const script = await source("scripts/verify/verify-geometry-live.ts");

    const consent = script.indexOf("requireDisposableConsent();");
    const preflight = script.indexOf("await client.preflight();", consent);
    const createProject = script.indexOf('"create_project",', preflight);
    const addGroup = script.indexOf('"add_group",', createProject);
    const manageCreate = script.indexOf('operation: "create"', addGroup);
    const firstInspect = script.indexOf(
      "const before = await inspectCube(client, cubeUuid)",
      manageCreate
    );
    const firstCapture = script.indexOf(
      "const beforeImage = await captureFront(client)",
      firstInspect
    );
    const manageUpdate = script.indexOf('operation: "update"', firstCapture);
    const secondInspect = script.indexOf(
      "const after = await inspectCube(client, cubeUuid)",
      manageUpdate
    );
    const secondCapture = script.indexOf(
      "const afterImage = await captureFront(client)",
      secondInspect
    );
    const undo = script.indexOf(
      'await client.callTool("undo"',
      secondCapture
    );
    const redo = script.indexOf('await client.callTool("redo"', undo);

    const ordered = [
      consent,
      preflight,
      createProject,
      addGroup,
      manageCreate,
      firstInspect,
      firstCapture,
      manageUpdate,
      secondInspect,
      secondCapture,
      undo,
      redo,
    ];
    let previous = -1;
    for (const index of ordered) {
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }

    expect(script).toContain('"manage_cubes"');
    expect(script).toContain('"inspect_elements"');
    expect(script).not.toContain('"place_cube"');
    expect(script).not.toContain('"modify_cube"');
    expect(script).not.toContain('"inspect_element"');
    expect(script).toContain("beforeImage.data !== afterImage.data");
    expect(script).toContain('mode: "explicit"');
    expect(script).toContain("Undo did not restore Cube geometry");
    expect(script).toContain("Redo did not restore modified Cube geometry");
  });
});
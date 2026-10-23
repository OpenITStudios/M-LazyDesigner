import {
  AUTHORING_E2E_BONE_NAME,
  AUTHORING_E2E_CUBE_NAME,
  AUTHORING_E2E_PROJECT_NAME,
  LiveMcpClient,
  expect,
  firstImage,
  requireDisposableConsent,
  structuredObject,
  type JsonObject,
} from "./live-e2e-common";

const REQUIRED_TOOLS = [
  "create_project",
  "add_group",
  "manage_cubes",
  "modify_group",
  "inspect_elements",
  "inspect_model_bounds",
  "capture_model_views",
  "undo",
  "redo",
] as const;
const THIN_CUBE_NAME = "e2e_thin_per_face";
const THIN_CUBE_SIZE = [1, 4, 0.5] as const;
const THIN_FACE_UV = [
  { face: "north", uv: [0, 0, 1, 4] },
  { face: "south", uv: [2, 0, 3, 4] },
  { face: "east", uv: [4, 0, 4.5, 4] },
  { face: "west", uv: [5, 0, 5.5, 4] },
  { face: "up", uv: [6, 0, 7, 0.5] },
  { face: "down", uv: [8, 0, 9, 0.5] },
] as const;

function sameVec3(actual: unknown, expected: readonly number[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === 3 &&
    actual.every((value, index) => value === expected[index])
  );
}

async function inspectCube(
  client: LiveMcpClient,
  id: string,
  detail: "geometry" | "uv" = "geometry"
): Promise<JsonObject> {
  return structuredObject(
    await client.callTool(
      "inspect_elements",
      { mode: "detail", id, detail },
      "inspection"
    ),
    "inspect_elements"
  );
}

function assertThinPerFaceState(detail: JsonObject, context: string): void {
  expect(
    sameVec3(detail.size, THIN_CUBE_SIZE),
    `${context} changed the approved thin geometry: ${JSON.stringify(detail.size)}.`
  );
  const uv = (detail.uv ?? {}) as JsonObject;
  const quality = (uv.quality_summary ?? {}) as JsonObject;
  expect(
    uv.mode === "per_face" && uv.box_uv === false && uv.autouv === 0,
    `${context} did not keep explicit per-face UV: ${JSON.stringify(uv)}.`
  );
  expect(
    quality.degenerate_faces === 0 && quality.aspect_review_faces === 0,
    `${context} produced collapsed or aspect-invalid thin-face UV: ${JSON.stringify(quality)}.`
  );
}

async function captureFront(client: LiveMcpClient) {
  return firstImage(
    await client.callTool(
      "capture_model_views",
      {
        views: ["front"],
        front_direction: "+z",
        framing: {
          mode: "explicit",
          min: [-8, -2, -6],
          max: [10, 12, 6],
        },
      },
      "evidence"
    ),
    "capture_model_views"
  );
}

/** Native rendered-world observation, not raw authored Cube extent. */
async function renderedModelSize(client: LiveMcpClient): Promise<number[]> {
  const observed = structuredObject(
    await client.callTool("inspect_model_bounds", {}, "inspection"),
    "inspect_model_bounds"
  );
  const bounds = (observed.bounds ?? null) as JsonObject | null;
  const size = bounds?.size_xyz;
  expect(
    Array.isArray(size) && size.length === 3 &&
      size.every((value) => typeof value === "number" && Number.isFinite(value)),
    "Native geometry bounds did not provide three finite current-world dimensions."
  );
  return [...(size as number[])];
}

async function main(): Promise<void> {
  requireDisposableConsent();
  const client = new LiveMcpClient({
    expectedPhase: "geometry",
    requiredTools: REQUIRED_TOOLS,
  });
  const environment = await client.preflight();

  await client.callTool(
    "create_project",
    {
      name: AUTHORING_E2E_PROJECT_NAME,
      discard_unsaved: true,
      resolution: 128,
    },
    "mutation"
  );

  const groupResult = structuredObject(
    await client.callTool(
      "add_group",
      {
        name: AUTHORING_E2E_BONE_NAME,
        origin: [0, 8, 0],
      },
      "mutation"
    ),
    "add_group"
  );
  const group = (groupResult.group ?? {}) as JsonObject;
  expect(typeof group.uuid === "string", "add_group returned no Group UUID.");

  const placement = structuredObject(
    await client.callTool(
      "manage_cubes",
      {
        operation: "create",
        group: group.uuid,
        elements: [
          {
            name: AUTHORING_E2E_CUBE_NAME,
            from: [-4, 0, -2],
            to: [4, 8, 2],
          },
        ],
      },
      "mutation"
    ),
    "manage_cubes"
  );
  const cubes = placement.cubes as Array<JsonObject> | undefined;
  const cubeUuid = cubes?.[0]?.uuid;
  expect(typeof cubeUuid === "string", "manage_cubes create returned no Cube UUID.");

  const thinPlacement = structuredObject(
    await client.callTool(
      "manage_cubes",
      {
        operation: "create",
        group: group.uuid,
        elements: [
          {
            name: THIN_CUBE_NAME,
            from: [7, 0, -0.25],
            to: [8, 4, 0.25],
          },
        ],
        faces: THIN_FACE_UV,
      },
      "mutation"
    ),
    "manage_cubes"
  );
  const thinCubes = thinPlacement.cubes as Array<JsonObject> | undefined;
  const thinCubeUuid = thinCubes?.[0]?.uuid;
  expect(
    typeof thinCubeUuid === "string",
    "manage_cubes thin per-face fixture returned no Cube UUID."
  );
  assertThinPerFaceState(
    await inspectCube(client, thinCubeUuid, "uv"),
    "Geometry thin-face preflight"
  );

  const before = await inspectCube(client, cubeUuid);
  expect(
    sameVec3(before.from, [-4, 0, -2]),
    `Unexpected initial from: ${JSON.stringify(before.from)}.`
  );
  expect(
    sameVec3(before.to, [4, 8, 2]),
    `Unexpected initial to: ${JSON.stringify(before.to)}.`
  );
  expect(
    (before.parent as JsonObject | null)?.uuid === group.uuid,
    "Cube is not parented to the created Group."
  );
  const beforeImage = await captureFront(client);

  // In the disposable model, the rigid torso/appendage assembly is owned by
  // one Group. Confirm a native Group rotation affects actual rendered world
  // extents and front-view media without rewriting any child's Cube geometry.
  const baseWorldSize = await renderedModelSize(client);
  const rotateReceipt = structuredObject(
    await client.callTool(
      "modify_group",
      { id: group.uuid, rotation: [0, 45, 0] },
      "mutation"
    ),
    "modify_group"
  );
  const rotatedGroup = (rotateReceipt.group ?? {}) as JsonObject;
  expect(sameVec3(rotatedGroup.rotation, [0, 45, 0]),
    "Native Bone rotation receipt did not show the authored 45-degree turn.");
  const rotatedWorldSize = await renderedModelSize(client);
  expect(!sameVec3(rotatedWorldSize, baseWorldSize),
    "Group rotation changed authored state but rendered-world bounds stayed unchanged.");
  const rotatedFrontImage = await captureFront(client);
  expect(beforeImage.data !== rotatedFrontImage.data,
    "Group rotation did not change fixed-frame rendered front PNG.");

  const restoreReceipt = structuredObject(
    await client.callTool(
      "modify_group",
      { id: group.uuid, rotation: [0, 0, 0] },
      "mutation"
    ),
    "modify_group"
  );
  const restoredGroup = (restoreReceipt.group ?? {}) as JsonObject;
  expect(sameVec3(restoredGroup.rotation, [0, 0, 0]),
    "Native Bone rotation was not restored to the original authored state.");
  expect(sameVec3(await renderedModelSize(client), baseWorldSize),
    "Restoring Bone rotation did not restore the initial world-space envelope.");
  const unchangedCube = await inspectCube(client, cubeUuid);
  expect(sameVec3(unchangedCube.from, before.from) &&
    sameVec3(unchangedCube.to, before.to),
    "Group rotation/restoration unexpectedly rewrote the child Cube geometry.");

  const modification = structuredObject(
    await client.callTool(
      "manage_cubes",
      {
        operation: "update",
        id: cubeUuid,
        to: [6, 8, 2],
      },
      "mutation"
    ),
    "manage_cubes"
  );
  const after = await inspectCube(client, cubeUuid);
  expect(
    sameVec3(after.to, [6, 8, 2]),
    `manage_cubes update readback stayed stale: ${JSON.stringify(after.to)}.`
  );
  const afterImage = await captureFront(client);
  expect(
    beforeImage.data !== afterImage.data,
    "Geometry readback changed but fixed-frame rendered PNG stayed byte-identical."
  );

  const undo = structuredObject(
    await client.callTool("undo", { steps: 1 }, "history"),
    "undo"
  );
  expect(undo.undone_count === 1, `Undo count mismatch: ${String(undo.undone_count)}.`);
  const undone = await inspectCube(client, cubeUuid);
  expect(
    sameVec3(undone.to, [4, 8, 2]),
    `Undo did not restore Cube geometry: ${JSON.stringify(undone.to)}.`
  );

  const redo = structuredObject(
    await client.callTool("redo", { steps: 1 }, "history"),
    "redo"
  );
  expect(redo.redone_count === 1, `Redo count mismatch: ${String(redo.redone_count)}.`);
  const redone = await inspectCube(client, cubeUuid);
  expect(
    sameVec3(redone.to, [6, 8, 2]),
    `Redo did not restore modified Cube geometry: ${JSON.stringify(redone.to)}.`
  );
  assertThinPerFaceState(
    await inspectCube(client, thinCubeUuid, "uv"),
    "Geometry body Undo/Redo"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        proof: "live_geometry_e2e",
        profile: "bedrock_entity",
        phase: "geometry",
        build_identity: environment.buildIdentity,
        fixture: {
          project: AUTHORING_E2E_PROJECT_NAME,
          animation_bone_name: AUTHORING_E2E_BONE_NAME,
          group_uuid: group.uuid,
          cube_uuid: cubeUuid,
          thin_cube_uuid: thinCubeUuid,
          next: "Keep the same shared AUTHORING session and run verify:texturing-live with --confirm-disposable; no Geometry-to-Texturing phase switch is required.",
        },
        initial_to: before.to,
        modified_to: after.to,
        render_changed: true,
        undo_restored_initial_geometry: true,
        redo_restored_modified_geometry: true,
        thin_per_face_without_geometry_thickening: true,
        native_bone_rotation_changed_rendered_bounds: true,
        native_bone_rotation_changed_front_capture: true,
        restored_bone_rotation_and_world_bounds: true,
        child_geometry_unchanged_during_group_rotation: true,
        modification_receipt_present: Object.keys(modification).length > 0,
        current_public_cube_surface: "manage_cubes",
        current_public_inspection_surface: "inspect_elements",
        cost: client.snapshotMetrics(),
        visual_quality: "not_evaluated",
        note: "Leaves the disposable project open for Texturing in the same shared AUTHORING session. Thin-face proof checks representation/UV preflight without thickening geometry. Runtime/readback/render/history proof is not reference-fidelity proof.",
      },
      null,
      2
    )
  );
}

if (import.meta.main) {
  await main();
}
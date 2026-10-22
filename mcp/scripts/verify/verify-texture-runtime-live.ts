import { PAINT_TEXTURE_TRANSACTION_TOOL_NAME } from "@/lib/texture/paintTransactionPolicy";
import {
  LiveMcpClient,
  expect,
  firstImage,
  imageDigest,
  requireDisposableConsent,
  structuredObject,
  type JsonObject,
} from "./live-e2e-common";

const PROJECT_NAME = "blockit_texture_runtime_e2e";
const BASE_NAME = "wiring_base";
const VARIANT_NAME = "wiring_variant";
const VARIANT_GROUP = "wiring_variants";
export const TEXTURE_RUNTIME_EXACT_BRUSH_SETTINGS = {
  size: 1,
  opacity: 255,
  softness: 0,
  shape: "square",
  blend_mode: "default",
} as const;
export const TEXTURE_RUNTIME_PROJECT_INPUT = {
  name: PROJECT_NAME,
  discard_unsaved: true,
  resolution: 128,
} as const;

const REQUIRED_TOOLS = [
  "create_project",
  "get_project_info",
  "create_texture",
  "add_texture_group",
  "get_texture",
  PAINT_TEXTURE_TRANSACTION_TOOL_NAME,
  "paint_settings",
  "paint_with_brush",
  "texture_layer_management",
  "undo",
  "redo",
] as const;

function revisionOf(value: JsonObject, context: string): string {
  const revision = value.revision;
  expect(
    typeof revision === "string" && /^sha256:\d+x\d+:[0-9a-f]{64}$/.test(revision),
    `${context} returned no valid full-RGBA revision.`
  );
  return revision;
}

async function expectToolFailure(
  action: () => Promise<unknown>,
  marker: string
): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(
      String(error).toLowerCase().includes(marker.toLowerCase()),
      `Expected failure containing ${JSON.stringify(marker)}, received ${String(error)}.`
    );
    return;
  }
  throw new Error(`Expected tool failure containing ${JSON.stringify(marker)}.`);
}

async function main(): Promise<void> {
  requireDisposableConsent();
  const client = new LiveMcpClient({
    expectedPhase: "geometry",
    requiredTools: REQUIRED_TOOLS,
  });
  const environment = await client.preflight();

  const created = structuredObject(
    await client.callTool(
      "create_project",
      TEXTURE_RUNTIME_PROJECT_INPUT,
      "mutation"
    ),
    "create_project"
  );
  const createdProject = (created.project ?? {}) as JsonObject;
  expect(
    typeof createdProject.uuid === "string" && createdProject.name === PROJECT_NAME,
    `create_project did not publish the disposable project identity: ${JSON.stringify(createdProject)}.`
  );

  const projectInfo = structuredObject(
    await client.callTool("get_project_info", {}, "inspection"),
    "get_project_info"
  );
  const project = (projectInfo.project ?? {}) as JsonObject;
  expect(
    project.uuid === createdProject.uuid && project.name === PROJECT_NAME,
    `get_project_info did not read back the created project identity: ${JSON.stringify(project)}.`
  );

  const baseCreated = structuredObject(
    await client.callTool(
      "create_texture",
      { name: BASE_NAME, type: "blank", width: 128, height: 128 },
      "mutation"
    ),
    "create_texture"
  );
  const base = (baseCreated.texture ?? {}) as JsonObject;
  expect(typeof base.uuid === "string", "Base create_texture returned no UUID.");

  await client.callTool(
    "add_texture_group",
    { name: VARIANT_GROUP, is_material: false },
    "mutation"
  );
  const variantCreated = structuredObject(
    await client.callTool(
      "create_texture",
      {
        type: "variant",
        name: VARIANT_NAME,
        source_texture_id: base.uuid,
        group: VARIANT_GROUP,
      },
      "mutation"
    ),
    "create_texture variant"
  );
  const variant = (variantCreated.texture ?? {}) as JsonObject;
  expect(typeof variant.uuid === "string", "Variant create_texture returned no UUID.");

  const baseBeforeResult = await client.callTool(
    "get_texture",
    {
      texture: base.uuid,
      region: { x: 0, y: 0, width: 4, height: 4 },
    },
    "evidence"
  );
  const baseBefore = structuredObject(baseBeforeResult, "get_texture base before");
  const beforeRevision = revisionOf(baseBefore, "get_texture base before");
  const beforeImage = firstImage(baseBeforeResult, "get_texture base before");
  expect(
    (baseBefore.region as JsonObject | undefined)?.width === 4 &&
      (baseBefore.region as JsonObject | undefined)?.height === 4,
    `Focused get_texture did not preserve requested 4x4 region: ${JSON.stringify(baseBefore.region)}.`
  );
  expect(
    JSON.stringify(baseBefore).includes("rgba") === false,
    "Focused get_texture leaked raw RGBA into structuredContent."
  );

  const variantBeforeResult = await client.callTool(
    "get_texture",
    { texture: variant.uuid, region: { x: 0, y: 0, width: 4, height: 4 } },
    "evidence"
  );
  const variantBeforeDigest = imageDigest(
    firstImage(variantBeforeResult, "get_texture variant before")
  );

  const transaction = structuredObject(
    await client.callTool(
      PAINT_TEXTURE_TRANSACTION_TOOL_NAME,
      {
        texture_id: base.uuid,
        expected_revision: beforeRevision,
        operations: [
          {
            operation: "fill_rect",
            color: "#112233FF",
            rect: { x: 0, y: 0, width: 4, height: 4 },
          },
          {
            operation: "set_pixels",
            color: "#FF0000FF",
            coordinates: [{ x: 0, y: 0 }, { x: 3, y: 3 }],
          },
        ],
      },
      "mutation"
    ),
    PAINT_TEXTURE_TRANSACTION_TOOL_NAME
  );
  const transactionRevision = (transaction.revision ?? {}) as JsonObject;
  expect(
    transactionRevision.before === beforeRevision &&
      typeof transactionRevision.after === "string" &&
      transactionRevision.after !== beforeRevision,
    `Paint transaction returned invalid revision receipt: ${JSON.stringify(transactionRevision)}.`
  );
  const afterRevision = transactionRevision.after as string;

  await expectToolFailure(
    () =>
      client.callTool(
        "get_texture",
        {
          texture: base.uuid,
          region: { x: 0, y: 0, width: 4, height: 4 },
          expected_revision: beforeRevision,
        },
        "evidence"
      ),
    "changed since"
  );

  const baseAfterResult = await client.callTool(
    "get_texture",
    {
      texture: base.uuid,
      region: { x: 0, y: 0, width: 4, height: 4 },
      expected_revision: afterRevision,
    },
    "evidence"
  );
  expect(
    imageDigest(firstImage(baseAfterResult, "get_texture base after")) !==
      imageDigest(beforeImage),
    "Atomic transaction did not change requested base crop evidence."
  );

  const variantAfterResult = await client.callTool(
    "get_texture",
    { texture: variant.uuid, region: { x: 0, y: 0, width: 4, height: 4 } },
    "evidence"
  );
  expect(
    imageDigest(firstImage(variantAfterResult, "get_texture variant after")) ===
      variantBeforeDigest,
    "Painting the base mutated the explicit variant target."
  );

  await client.callTool("undo", { steps: 1 }, "history");
  const undone = structuredObject(
    await client.callTool("get_texture", { texture: base.uuid }, "evidence"),
    "get_texture after undo"
  );
  expect(
    revisionOf(undone, "get_texture after undo") === beforeRevision,
    "One Undo did not restore the pre-transaction full bitmap revision."
  );

  await client.callTool("redo", { steps: 1 }, "history");
  const redone = structuredObject(
    await client.callTool("get_texture", { texture: base.uuid }, "evidence"),
    "get_texture after redo"
  );
  expect(
    revisionOf(redone, "get_texture after redo") === afterRevision,
    "One Redo did not restore the applied transaction revision."
  );


  // This same disposable native fixture now covers the direct pixel painter:
  // request -> active native edit canvas -> full-RGBA readback -> Undo/Redo.
  // Normalize the Painter configuration before requesting exact pixels.
  await client.callTool(
    "paint_settings",
    {
      mirror_painting: { enabled: false },
      lock_alpha: false,
      color_erase_mode: false,
    },
    "mutation"
  );

  const exactBaseRegion = { x: 1, y: 1, width: 1, height: 1 };
  const exactBaseBeforeResult = await client.callTool(
    "get_texture",
    {
      texture: base.uuid,
      region: exactBaseRegion,
      expected_revision: afterRevision,
    },
    "evidence"
  );
  const exactBaseBeforeDigest = imageDigest(
    firstImage(exactBaseBeforeResult, "get_texture exact base before")
  );
  const exactBase = structuredObject(
    await client.callTool(
      "paint_with_brush",
      {
        texture_id: base.uuid,
        coordinates: [{ x: 1, y: 1 }],
        connect_strokes: false,
        brush_settings: {
          ...TEXTURE_RUNTIME_EXACT_BRUSH_SETTINGS,
          color: "#00CC66FF",
        },
      },
      "mutation"
    ),
    "paint_with_brush exact base"
  );
  const exactBaseTarget = (exactBase.write_target ?? {}) as JsonObject;
  expect(
    exactBase.mode === "exact_pixels" &&
      exactBase.verification_scope === "native_edit_canvas_rgba" &&
      exactBaseTarget.kind === "base_texture" &&
      exactBaseTarget.layer_uuid === null,
    `Exact brush base receipt did not prove native edit-canvas scope: ${JSON.stringify(exactBase)}.`
  );
  const exactBaseAfterResult = await client.callTool(
    "get_texture",
    { texture: base.uuid, region: exactBaseRegion },
    "evidence"
  );
  const exactBaseAfter = structuredObject(
    exactBaseAfterResult, "get_texture exact base after"
  );
  const exactBrushBaseRevision = revisionOf(
    exactBaseAfter, "get_texture exact base after"
  );
  expect(
    exactBrushBaseRevision !== afterRevision &&
      imageDigest(firstImage(exactBaseAfterResult, "get_texture exact base after")) !==
      exactBaseBeforeDigest,
    "Exact brush returned a receipt but the requested bitmap pixel did not change."
  );

  await client.callTool("undo", { steps: 1 }, "history");
  const exactBaseUndo = structuredObject(
    await client.callTool("get_texture", { texture: base.uuid }, "evidence"),
    "get_texture exact base undo"
  );
  expect(
    revisionOf(exactBaseUndo, "get_texture exact base undo") === afterRevision,
    "Exact brush Undo did not restore the pre-brush full bitmap revision."
  );
  await client.callTool("redo", { steps: 1 }, "history");
  const exactBaseRedo = structuredObject(
    await client.callTool("get_texture", { texture: base.uuid }, "evidence"),
    "get_texture exact base redo"
  );
  expect(
    revisionOf(exactBaseRedo, "get_texture exact base redo") === exactBrushBaseRevision,
    "Exact brush Redo did not restore the post-brush full bitmap revision."
  );

  // Bind one actual native pixel layer, then prove the returned target UUID
  // matches the layer created within this disposable texture. Composite PNG
  // readback is checked separately and never inferred from an edit-canvas receipt.
  const createdLayer = structuredObject(
    await client.callTool(
      "texture_layer_management",
      { action: "create_layer", texture_id: variant.uuid, layer_name: "acceptance_ink" },
      "mutation"
    ),
    "texture_layer_management create_layer"
  );
  const inkLayer = (createdLayer.layer ?? {}) as JsonObject;
  const layeredState = (createdLayer.texture ?? {}) as JsonObject;
  expect(
    typeof inkLayer.uuid === "string" &&
      layeredState.layers_enabled === true &&
      layeredState.selected_layer_uuid === inkLayer.uuid,
    `The disposable variant did not select the newly created native pixel layer: ${JSON.stringify(createdLayer)}.`
  );
  const layeredRegion = { x: 2, y: 2, width: 1, height: 1 };
  const layeredBeforeResult = await client.callTool(
    "get_texture",
    { texture: variant.uuid, region: layeredRegion },
    "evidence"
  );
  const layeredBefore = structuredObject(
    layeredBeforeResult, "get_texture layered before"
  );
  const layeredBeforeRevision = revisionOf(
    layeredBefore, "get_texture layered before"
  );
  const layeredBeforeDigest = imageDigest(
    firstImage(layeredBeforeResult, "get_texture layered before")
  );
  await expectToolFailure(
    () => client.callTool(
      PAINT_TEXTURE_TRANSACTION_TOOL_NAME,
      {
        texture_id: variant.uuid,
        expected_revision: layeredBeforeRevision,
        operations: [{
          operation: "set_pixels",
          color: "#33AABBFF",
          coordinates: [{ x: 2, y: 2 }],
        }],
      },
      "mutation"
    ),
    "native Painter tools"
  );
  const layeredAfterRefusal = structuredObject(
    await client.callTool(
      "get_texture",
      { texture: variant.uuid, expected_revision: layeredBeforeRevision },
      "evidence"
    ),
    "get_texture layered transaction refusal"
  );
  expect(
    revisionOf(layeredAfterRefusal, "get_texture layered transaction refusal") ===
      layeredBeforeRevision,
    "Rejected layered paint transaction unexpectedly changed the bitmap."
  );

  const exactLayered = structuredObject(
    await client.callTool(
      "paint_with_brush",
      {
        texture_id: variant.uuid,
        coordinates: [{ x: 2, y: 2 }],
        connect_strokes: false,
        brush_settings: {
          ...TEXTURE_RUNTIME_EXACT_BRUSH_SETTINGS,
          color: "#CC3399FF",
        },
      },
      "mutation"
    ),
    "paint_with_brush exact native layer"
  );
  const layeredTarget = (exactLayered.write_target ?? {}) as JsonObject;
  expect(
    exactLayered.mode === "exact_pixels" &&
      exactLayered.verification_scope === "native_edit_canvas_rgba" &&
      layeredTarget.kind === "active_layer" &&
      layeredTarget.layer_uuid === inkLayer.uuid,
    `Exact brush did not bind the selected native pixel layer: ${JSON.stringify(exactLayered)}.`
  );
  const layeredAfterResult = await client.callTool(
    "get_texture",
    { texture: variant.uuid, region: layeredRegion },
    "evidence"
  );
  const layeredAfter = structuredObject(
    layeredAfterResult, "get_texture layered after"
  );
  const layeredAfterRevision = revisionOf(
    layeredAfter, "get_texture layered after"
  );
  expect(
    layeredAfterRevision !== layeredBeforeRevision &&
      imageDigest(firstImage(layeredAfterResult, "get_texture layered after")) !==
      layeredBeforeDigest,
    "Layer-local brush receipt did not produce a distinct composited PNG readback."
  );
  await client.callTool("undo", { steps: 1 }, "history");
  const layeredUndo = structuredObject(
    await client.callTool(
      "get_texture", { texture: variant.uuid }, "evidence"
    ),
    "get_texture layered brush undo"
  );
  expect(
    revisionOf(layeredUndo, "get_texture layered brush undo") === layeredBeforeRevision,
    "Layered exact brush Undo did not restore the composite revision."
  );
  await client.callTool("redo", { steps: 1 }, "history");
  const layeredRedo = structuredObject(
    await client.callTool(
      "get_texture", { texture: variant.uuid }, "evidence"
    ),
    "get_texture layered brush redo"
  );
  expect(
    revisionOf(layeredRedo, "get_texture layered brush redo") === layeredAfterRevision,
    "Layered exact brush Redo did not restore the composite revision."
  );
  const baseAfterLayered = structuredObject(
    await client.callTool(
      "get_texture",
      { texture: base.uuid, expected_revision: exactBrushBaseRevision },
      "evidence"
    ),
    "get_texture base after layered variant painting"
  );
  expect(
    revisionOf(baseAfterLayered, "get_texture base after layered variant painting") ===
      exactBrushBaseRevision,
    "Layer painting leaked from explicit variant into the base atlas."
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        proof: "texture_runtime_live",
        build_identity: environment.buildIdentity,
        project_uuid: project.uuid,
        base_texture_uuid: base.uuid,
        variant_texture_uuid: variant.uuid,
        revision_before: beforeRevision,
        revision_after: afterRevision,
        focused_png_delivery: true,
        stale_revision_rejected: true,
        one_undo_redo_transaction: true,
        variant_target_isolation: true,
        exact_brush_base_revision: exactBrushBaseRevision,
        layered_brush_composite_revision: layeredAfterRevision,
        exact_brush_undo_redo: true,
        layer_target_receipt: true,
        layered_transaction_rejected: true,
        layered_composite_readback: true,
        layered_variant_isolation: true,
        cost: client.snapshotMetrics(),
      },
      null,
      2
    )
  );
}

if (import.meta.main) {
  await main();
}
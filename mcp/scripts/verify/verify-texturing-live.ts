import {
  mapFaceLocalPixelToAtlasPixel,
  type FaceTexturePixelMapping,
} from "@/lib/facePixelMapping";
import {
  AUTHORING_E2E_ATLAS_NAME,
  AUTHORING_E2E_CUBE_NAME,
  AUTHORING_E2E_PROJECT_NAME,
  LiveMcpClient,
  expect,
  firstImage,
  imageDigest,
  requireDisposableConsent,
  structuredObject,
  type JsonObject,
  type ToolCallPayload,
} from "./live-e2e-common";

const REQUIRED_TOOLS = [
  "get_project_info",
  "inspect_elements",
  "create_texture",
  "list_textures",
  "get_texture",
  "add_texture_group",
  "activate_texture",
  "paint_with_brush",
  "draw_shape_tool",
  "color_picker_tool",
  "undo",
  "redo",
] as const;
const VARIANT_GROUP_NAME = "e2e_variant_group";
const DECOY_TEXTURE_NAME = "e2e_decoy";
const THIN_CUBE_NAME = "e2e_thin_per_face";
const THIN_CUBE_SIZE = [1, 4, 0.5] as const;
const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;

async function atlasImage(client: LiveMcpClient, texture: string) {
  return firstImage(
    await client.callTool("get_texture", { texture }, "evidence"),
    "get_texture"
  );
}

function firstText(result: ToolCallPayload, toolName: string): string {
  const item = result.content?.find((candidate) => candidate.type === "text");
  const text = item?.type === "text" ? item.text : undefined;
  expect(text, `${toolName} returned no text content.`);
  return text;
}

function pickedColor(result: ToolCallPayload): { color: string; opacity: number } {
  const text = firstText(result, "color_picker_tool");
  const match = text.match(
    /Picked color\s+(#[0-9a-f]{6,8})\s+with opacity\s+(\d+)/i
  );
  expect(match, `Unexpected color_picker_tool receipt: ${text}`);
  return { color: match[1].toLowerCase(), opacity: Number(match[2]) };
}

async function pickPixel(
  client: LiveMcpClient,
  texture: string,
  x: number,
  y: number
) {
  return pickedColor(
    await client.callTool(
      "color_picker_tool",
      {
        texture_id: texture,
        x,
        y,
        pick_opacity: true,
      },
      "inspection"
    )
  );
}

async function inspectCubeUv(
  client: LiveMcpClient,
  id: string
): Promise<JsonObject> {
  return structuredObject(
    await client.callTool(
      "inspect_elements",
      {
        mode: "detail",
        id,
        detail: "uv",
      },
      "inspection"
    ),
    "inspect_elements"
  );
}

async function inspectBodyUv(client: LiveMcpClient): Promise<JsonObject> {
  return inspectCubeUv(client, AUTHORING_E2E_CUBE_NAME);
}

function sameVec3(actual: unknown, expected: readonly number[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === 3 &&
    actual.every((value, index) => value === expected[index])
  );
}

function assertThinPerFaceState(detail: JsonObject, context: string): void {
  expect(
    sameVec3(detail.size, THIN_CUBE_SIZE),
    `${context} thickened or resized the thin fixture: ${JSON.stringify(detail.size)}.`
  );
  const uv = (detail.uv ?? {}) as JsonObject;
  const quality = (uv.quality_summary ?? {}) as JsonObject;
  expect(
    uv.mode === "per_face" && uv.box_uv === false && uv.autouv === 0,
    `${context} lost explicit per-face UV mode: ${JSON.stringify(uv)}.`
  );
  expect(
    quality.degenerate_faces === 0,
    `${context} collapsed a meaningful thin face: ${JSON.stringify(quality)}.`
  );
}

function uvMappingFingerprint(detail: JsonObject): string {
  const uv = (detail.uv ?? {}) as JsonObject;
  const faces = (uv.faces ?? {}) as JsonObject;
  return JSON.stringify({
    mode: uv.mode ?? null,
    box_uv: uv.box_uv ?? null,
    uv_offset: uv.uv_offset ?? null,
    autouv: uv.autouv ?? null,
    mirror_uv: uv.mirror_uv ?? null,
    faces: Object.fromEntries(
      FACE_KEYS.map((key) => {
        const face = (faces[key] ?? {}) as JsonObject;
        return [
          key,
          {
            uv: face.uv ?? null,
            rotation: face.rotation ?? null,
            texture_pixels: face.texture_pixels ?? null,
          },
        ];
      })
    ),
  });
}

function northFaceMapping(detail: JsonObject): {
  mapping: FaceTexturePixelMapping;
  rotation: number;
} {
  const uv = (detail.uv ?? {}) as JsonObject;
  const faces = (uv.faces ?? {}) as JsonObject;
  const north = (faces.north ?? {}) as JsonObject;
  const mapping = north.texture_pixels;
  expect(
    mapping && typeof mapping === "object" && !Array.isArray(mapping),
    "North face has no mapped texture-pixel state."
  );
  const rotation = north.rotation;
  expect(typeof rotation === "number", "North face has no numeric rotation.");
  return {
    mapping: mapping as unknown as FaceTexturePixelMapping,
    rotation,
  };
}

function requireReadyUvAudit(result: JsonObject, context: string): void {
  const audit = (result.uv_audit ?? {}) as JsonObject;
  const gate = (audit.production_gate ?? {}) as JsonObject;
  expect(
    audit.state === "available" && gate.state === "ready",
    `${context} did not return a ready UV audit: ${JSON.stringify(audit)}.`
  );
}

/**
 * K8 candidate diagnostic checks use the existing disposable native fixture.
 * Knowledge hints remain review-only, not source-art authentication or PASS.
 */
function positiveDiagnosticCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value : 0;
}

function expectKnowledgeHints(
  result: JsonObject,
  expectedIds: readonly string[],
  scope: string
): void {
  const raw = result.knowledge_guidance;
  if (expectedIds.length === 0) {
    expect(raw === undefined || (Array.isArray(raw) && raw.length === 0),
      `${scope} returned an unsolicited K3 hint without a qualified diagnostic: ${JSON.stringify(raw)}.`);
    return;
  }
  expect(Array.isArray(raw),
    `${scope} is missing its source-pinned K3 diagnostic guidance: ${JSON.stringify(raw)}.`);
  const hints = raw as JsonObject[];
  const ids = hints.map(hint => hint.case_id);
  expect(JSON.stringify(ids) === JSON.stringify(expectedIds),
    `${scope} selected unexpected cases: expected=${JSON.stringify(expectedIds)}, received=${JSON.stringify(ids)}.`);
  for (const hint of hints) {
    expect(hint.state === "REVIEW_REQUIRED" &&
      hint.source_state === "SOURCE_CANDIDATE" &&
      hint.mutation_authorized === false &&
      hint.visual_verdict === "not_evaluated" &&
      hint.reference_scope === "CURRENT_USER_REFERENCE_NOT_ATTESTED" &&
      hint.target_compatibility === "UNKNOWN_CURRENT_BEDROCK_AND_BLOCKBENCH",
      `${scope} promoted source knowledge to unverified authoring/visual authority.`);
    expect(typeof hint.source_sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(hint.source_sha256) &&
      typeof hint.section_sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(hint.section_sha256) &&
      typeof hint.required_evidence === "string" &&
      hint.required_evidence.length > 20,
      `${scope} omitted pinned source identity or required review evidence.`);
    const examples = (hint.decision_examples ?? {}) as JsonObject;
    for (const key of [
      "decision", "positive_hypothesis", "reject_hypothesis", "ambiguous_hypothesis",
    ]) {
      const field = examples[key];
      expect(typeof field === "string" &&
        field.length > 20 && field.length <= 800,
        `${scope} omitted or over-expanded ${key}; Gateway must receive actionable source examples without presumed approval.`);
    }
  }
}

async function exactUndo(client: LiveMcpClient): Promise<void> {
  const undo = structuredObject(
    await client.callTool("undo", { steps: 1 }, "history"),
    "undo"
  );
  expect(undo.undone_count === 1, `Undo count mismatch: ${String(undo.undone_count)}.`);
}

async function exactRedo(client: LiveMcpClient): Promise<void> {
  const redo = structuredObject(
    await client.callTool("redo", { steps: 1 }, "history"),
    "redo"
  );
  expect(redo.redone_count === 1, `Redo count mismatch: ${String(redo.redone_count)}.`);
}

async function main(): Promise<void> {
  requireDisposableConsent();
  // Geometry and Texturing share the same AUTHORING Runtime surface. This
  // verifier intentionally continues the Geometry-started session instead of
  // forcing a redundant Geometry→Texturing reload solely for testing.
  const client = new LiveMcpClient({
    expectedPhase: "geometry",
    requiredTools: REQUIRED_TOOLS,
  });
  const environment = await client.preflight();

  const projectInfo = structuredObject(
    await client.callTool("get_project_info", {}, "inspection"),
    "get_project_info"
  );
  const project = (projectInfo.project ?? {}) as JsonObject;
  const resolution = (projectInfo.resolution ?? {}) as JsonObject;
  expect(
    project.name === AUTHORING_E2E_PROJECT_NAME,
    `Expected shared disposable project ${AUTHORING_E2E_PROJECT_NAME}; current=${String(project.name)}. Run verify:geometry-live first.`
  );
  expect(
    resolution.texture_width === 128 && resolution.texture_height === 128,
    `Expected 128x128 disposable UV resolution; current=${JSON.stringify(resolution)}.`
  );

  const created = structuredObject(
    await client.callTool(
      "create_texture",
      {
        name: AUTHORING_E2E_ATLAS_NAME,
        type: "template",
        pixel_density: 16,
        rearrange_uv: true,
        power_of_two: true,
        keep_multi_texture_occupancy: true,
        padding: false,
      },
      "mutation"
    ),
    "create_texture"
  );
  requireReadyUvAudit(created, "Initial native template");
  const texture = (created.texture ?? {}) as JsonObject;
  expect(typeof texture.uuid === "string", "create_texture template returned no Texture UUID.");
  const baseTextureUuid = texture.uuid;
  const bitmap = (texture.bitmap ?? {}) as JsonObject;
  expect(
    typeof bitmap.width === "number" && typeof bitmap.height === "number",
    "Template receipt returned no bitmap dimensions."
  );
  const bitmapWidth = bitmap.width;
  const bitmapHeight = bitmap.height;
  assertThinPerFaceState(
    await inspectCubeUv(client, THIN_CUBE_NAME),
    "Initial native template"
  );

  const initialUv = await inspectBodyUv(client);
  const initialUvFingerprint = uvMappingFingerprint(initialUv);
  const initialNorth = northFaceMapping(initialUv);
  const semanticPixelBefore = mapFaceLocalPixelToAtlasPixel(
    initialNorth.mapping,
    initialNorth.rotation,
    0,
    0,
    "live texturing semantic pixel before rebuild"
  );

  const exactPaintReceipt = structuredObject(
    await client.callTool(
      "paint_with_brush",
      {
        texture_id: baseTextureUuid,
        coordinates: [semanticPixelBefore],
        brush_settings: {
          size: 1,
          opacity: 255,
          softness: 0,
          shape: "square",
          // End-point RGB channels avoid Canvas premultiplied-alpha rounding.
          color: "#0000ff80",
          blend_mode: "default",
        },
        connect_strokes: false,
      },
      "mutation"
    ),
    "paint_with_brush"
  );
  expect(
    exactPaintReceipt.mode === "exact_pixels",
    `Expected exact-pixel path; receipt=${JSON.stringify(exactPaintReceipt)}.`
  );
  const semanticColorBefore = await pickPixel(
    client,
    baseTextureUuid,
    semanticPixelBefore.x,
    semanticPixelBefore.y
  );
  expect(
    semanticColorBefore.color === "#0000ff" && semanticColorBefore.opacity === 128,
    `Exact RGBA pixel mismatch before rebuild: ${JSON.stringify(semanticColorBefore)}.`
  );

  const beforeRebuildHash = imageDigest(await atlasImage(client, baseTextureUuid));
  const rebuilt = structuredObject(
    await client.callTool(
      "create_texture",
      {
        name: AUTHORING_E2E_ATLAS_NAME,
        texture_id: baseTextureUuid,
        type: "template",
        pixel_density: 16,
        rearrange_uv: true,
        power_of_two: true,
        keep_multi_texture_occupancy: true,
        padding: true,
      },
      "mutation"
    ),
    "create_texture"
  );
  requireReadyUvAudit(rebuilt, "Padded native template rebuild");
  expect(rebuilt.rebuilt === true, "Template rebuild receipt did not report rebuilt=true.");
  const rebuiltTexture = (rebuilt.texture ?? {}) as JsonObject;
  expect(
    rebuiltTexture.uuid === baseTextureUuid,
    "Template rebuild changed the base atlas UUID."
  );
  const rebuildTemplate = (rebuilt.template ?? {}) as JsonObject;
  expect(
    rebuildTemplate.pixel_density === 16 && rebuildTemplate.padding === true,
    `Unexpected rebuild template contract: ${JSON.stringify(rebuildTemplate)}.`
  );
  assertThinPerFaceState(
    await inspectCubeUv(client, THIN_CUBE_NAME),
    "Padded native template rebuild"
  );

  const rebuiltUv = await inspectBodyUv(client);
  const rebuiltUvFingerprint = uvMappingFingerprint(rebuiltUv);
  const rebuiltNorth = northFaceMapping(rebuiltUv);
  const semanticPixelAfter = mapFaceLocalPixelToAtlasPixel(
    rebuiltNorth.mapping,
    rebuiltNorth.rotation,
    0,
    0,
    "live texturing semantic pixel after rebuild"
  );
  const semanticColorAfter = await pickPixel(
    client,
    baseTextureUuid,
    semanticPixelAfter.x,
    semanticPixelAfter.y
  );
  expect(
    semanticColorAfter.color === "#0000ff" && semanticColorAfter.opacity === 128,
    `Native repack did not preserve the semantic face pixel: ${JSON.stringify(semanticColorAfter)}.`
  );
  const afterRebuildHash = imageDigest(await atlasImage(client, baseTextureUuid));

  await exactUndo(client);
  expect(
    imageDigest(await atlasImage(client, baseTextureUuid)) === beforeRebuildHash,
    "Undo did not restore the exact pre-rebuild atlas PNG."
  );
  expect(
    uvMappingFingerprint(await inspectBodyUv(client)) === initialUvFingerprint,
    "Undo did not restore the exact pre-rebuild face UV mapping."
  );
  assertThinPerFaceState(
    await inspectCubeUv(client, THIN_CUBE_NAME),
    "Template rebuild Undo"
  );
  await exactRedo(client);
  expect(
    imageDigest(await atlasImage(client, baseTextureUuid)) === afterRebuildHash,
    "Redo did not restore the exact padded-rebuild atlas PNG."
  );
  expect(
    uvMappingFingerprint(await inspectBodyUv(client)) === rebuiltUvFingerprint,
    "Redo did not restore the exact padded-rebuild face UV mapping."
  );
  assertThinPerFaceState(
    await inspectCubeUv(client, THIN_CUBE_NAME),
    "Template rebuild Redo"
  );

  await client.callTool(
    "add_texture_group",
    { name: VARIANT_GROUP_NAME, is_material: false },
    "mutation"
  );
  const decoyCreated = structuredObject(
    await client.callTool(
      "create_texture",
      {
        name: DECOY_TEXTURE_NAME,
        width: bitmapWidth,
        height: bitmapHeight,
        group: VARIANT_GROUP_NAME,
      },
      "mutation"
    ),
    "create_texture"
  );
  const decoyTexture = (decoyCreated.texture ?? {}) as JsonObject;
  expect(typeof decoyTexture.uuid === "string", "Decoy texture returned no UUID.");
  const decoyUuid = decoyTexture.uuid;
  const decoyHash = imageDigest(await atlasImage(client, decoyUuid));

  await client.callTool("activate_texture", { texture: decoyUuid }, "other");
  const beforeNativeBrushHash = imageDigest(await atlasImage(client, baseTextureUuid));
  const nativePoint = {
    x: Math.max(4, Math.min(bitmapWidth - 5, Math.floor(bitmapWidth * 0.75))),
    y: Math.max(4, Math.min(bitmapHeight - 5, Math.floor(bitmapHeight * 0.75))),
  };
  const nativeBrush = await client.callTool(
    "paint_with_brush",
    {
      texture_id: baseTextureUuid,
      coordinates: [nativePoint],
      brush_settings: {
        size: 2,
        opacity: 255,
        softness: 0,
        shape: "square",
        color: "#AA5500",
        blend_mode: "default",
      },
      connect_strokes: false,
    },
    "mutation"
  );
  expect(
    nativeBrush.structuredContent === undefined,
    "Size-2 brush unexpectedly used the exact-pixel structured receipt instead of native Painter."
  );
  const afterNativeBrushHash = imageDigest(await atlasImage(client, baseTextureUuid));
  expect(
    afterNativeBrushHash !== beforeNativeBrushHash,
    "Native size-2 brush completed but target atlas did not change."
  );
  expect(
    imageDigest(await atlasImage(client, decoyUuid)) === decoyHash,
    "Explicit target brush mutation changed the selected decoy texture."
  );
  await exactUndo(client);
  expect(
    imageDigest(await atlasImage(client, baseTextureUuid)) === beforeNativeBrushHash,
    "Undo did not restore the target atlas after native size-2 brush."
  );
  expect(
    imageDigest(await atlasImage(client, decoyUuid)) === decoyHash,
    "Undo altered the decoy texture."
  );
  await exactRedo(client);
  expect(
    imageDigest(await atlasImage(client, baseTextureUuid)) === afterNativeBrushHash,
    "Redo did not restore the native size-2 brush result."
  );

  const shapeStart = { x: 2, y: 2 };
  const shapeEnd = { x: 4, y: 4 };
  const outsidePoint = { x: 1, y: 1 };
  // Use an opaque sentinel: the native picker retains its active RGB on alpha 0.
  await client.callTool("paint_with_brush", {
    texture_id: baseTextureUuid,
    coordinates: [outsidePoint],
    brush_settings: { size: 1, opacity: 255, softness: 0, shape: "square", color: "#aa5500", blend_mode: "default" },
    connect_strokes: false,
  }, "mutation");
  const outsideBefore = await pickPixel(
    client,
    baseTextureUuid,
    outsidePoint.x,
    outsidePoint.y
  );
  await client.callTool("activate_texture", { texture: decoyUuid }, "other");
  const beforeShapeHash = imageDigest(await atlasImage(client, baseTextureUuid));
  const shapeReceipt = structuredObject(
    await client.callTool(
      "draw_shape_tool",
      {
        texture_id: baseTextureUuid,
        shape: "rectangle",
        start: shapeStart,
        end: shapeEnd,
        color: "#00EE77",
        line_width: 8,
        opacity: 255,
        blend_mode: "default",
      },
      "mutation"
    ),
    "draw_shape_tool"
  );
  expect(
    shapeReceipt.bounded === true &&
      JSON.stringify(shapeReceipt.affected_rect) === JSON.stringify([2, 2, 5, 5]),
    `Bounded shape receipt mismatch: ${JSON.stringify(shapeReceipt)}.`
  );
  const afterShapeHash = imageDigest(await atlasImage(client, baseTextureUuid));
  expect(afterShapeHash !== beforeShapeHash, "Bounded native shape did not change the target atlas.");
  const outsideAfter = await pickPixel(
    client,
    baseTextureUuid,
    outsidePoint.x,
    outsidePoint.y
  );
  expect(
    JSON.stringify(outsideAfter) === JSON.stringify(outsideBefore),
    `Bounded shape bled outside its reported clip: before=${JSON.stringify(outsideBefore)} after=${JSON.stringify(outsideAfter)}.`
  );
  expect(
    imageDigest(await atlasImage(client, decoyUuid)) === decoyHash,
    "Bounded explicit-target shape changed the selected decoy texture."
  );
  await exactUndo(client);
  expect(
    imageDigest(await atlasImage(client, baseTextureUuid)) === beforeShapeHash,
    "Undo did not restore the exact pre-shape atlas PNG."
  );
  await exactRedo(client);
  expect(
    imageDigest(await atlasImage(client, baseTextureUuid)) === afterShapeHash,
    "Redo did not restore the exact bounded-shape atlas PNG."
  );

  // K8: use the SAME disposable fixture to verify that K5/K6 diagnostic
  // source guidance does not mutate the actual authored UV or bitmap.
  const knowledgeUvBefore = await inspectBodyUv(client);
  expect(knowledgeUvBefore.uv && typeof knowledgeUvBefore.uv === "object",
    "Native UV evidence is unavailable before diagnostic-only reads.");
  const knowledgeUvBeforeJson = JSON.stringify(knowledgeUvBefore.uv);
  const knowledgeAtlasBefore = imageDigest(await atlasImage(client, baseTextureUuid));

  const ordinaryInventory = structuredObject(
    await client.callTool("list_textures", {}, "inspection"),
    "list_textures inventory-only"
  );
  expectKnowledgeHints(ordinaryInventory, [], "inventory-only");

  const finalInventory = structuredObject(
    await client.callTool("list_textures", { diagnostics: true, diagnostic_scope: "uv" }, "inspection"),
    "list_textures"
  );
  const finalAudit = (finalInventory.uv_audit ?? {}) as JsonObject;
  const finalGate = (finalAudit.production_gate ?? {}) as JsonObject;
  expect(
    finalAudit.state === "available" && finalGate.state === "ready",
    `Final UV production gate is not ready: ${JSON.stringify(finalAudit)}.`
  );

  const exactReuse = (finalAudit.exact_reuse ?? {}) as JsonObject;
  const partialOverlap = (finalAudit.partial_overlap ?? {}) as JsonObject;
  const nativeUvHasReviewSignal =
    positiveDiagnosticCount(exactReuse.region_count) > 0 ||
    positiveDiagnosticCount(partialOverlap.pair_count) > 0;
  expectKnowledgeHints(
    finalInventory,
    nativeUvHasReviewSignal ? ["UV-P01"] : [],
    "UV-only diagnostics"
  );

  const coverageInventory = structuredObject(
    await client.callTool("list_textures", {
      diagnostics: true, diagnostic_scope: "coverage",
    }, "inspection"),
    "list_textures coverage"
  );
  const optimization = (coverageInventory.optimization_opportunities ?? {}) as JsonObject;
  const coverage = (optimization.coverage ?? {}) as JsonObject;
  expect(Number.isSafeInteger(coverage.scanned_faces) &&
    (coverage.scanned_faces as number) > 0,
    `Disposable coverage did not scan any native face: ${JSON.stringify(coverage)}.`);
  const review = (coverage.review ?? {}) as JsonObject;
  const solid = (review.solid_color_faces ?? {}) as JsonObject;
  const nativeFlatFaceSignal = positiveDiagnosticCount(solid.count) > 0;
  expectKnowledgeHints(
    coverageInventory,
    nativeFlatFaceSignal ? ["TEX-P01"] : [],
    "coverage-only diagnostics"
  );

  const knowledgeUvAfter = await inspectBodyUv(client);
  expect(JSON.stringify(knowledgeUvAfter.uv) === knowledgeUvBeforeJson,
    "Read-only K3 technical guidance changed native UV mapping.");
  expect(imageDigest(await atlasImage(client, baseTextureUuid)) === knowledgeAtlasBefore,
    "Read-only K3 technical guidance changed the production texture bitmap.");
  expect(imageDigest(await atlasImage(client, decoyUuid)) === decoyHash,
    "Read-only K3 technical guidance changed an unrelated variant/decoy texture.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        proof: "live_texturing_e2e",
        profile: "bedrock_entity",
        phase: "geometry (shared AUTHORING; Texturing semantics)",
        build_identity: environment.buildIdentity,
        project: AUTHORING_E2E_PROJECT_NAME,
        texture_uuid: baseTextureUuid,
        decoy_texture_uuid: decoyUuid,
        native_template_16x_ready: true,
        padded_rebuild_same_uuid: true,
        semantic_rgba_preserved_across_repack: true,
        thin_per_face_survived_native_template_repack_without_thickening: true,
        rebuild_undo_restored_atlas_and_uv: true,
        rebuild_redo_restored_atlas_and_uv: true,
        explicit_target_with_selected_decoy: true,
        native_size_2_brush_changed_target_only: true,
        bounded_shape_clip_preserved_outside_pixel: true,
        native_painter_undo_redo_exact_atlas: true,
        final_uv_gate: "ready",
        knowledge_guidance_native_probe: {
          default_inventory_has_no_guidance: true,
          uv_case: nativeUvHasReviewSignal ? "UV-P01" : null,
          uv_case_signal_present: nativeUvHasReviewSignal,
          material_case: nativeFlatFaceSignal ? "TEX-P01" : null,
          material_case_signal_present: nativeFlatFaceSignal,
          coverage_scanned_faces: coverage.scanned_faces,
          diagnostic_reads_left_uv_and_bitmaps_unchanged: true,
          artwork_reference_accepted: false,
        },
        atlas_sha256: {
          before_rebuild: beforeRebuildHash,
          after_rebuild: afterRebuildHash,
          after_native_brush: afterNativeBrushHash,
          after_bounded_shape: afterShapeHash,
          decoy: decoyHash,
        },
        cost: client.snapshotMetrics(),
        visual_quality: "not_evaluated",
        next: "Use the existing AUTHORING→Animation Gateway handoff with disposable-test readiness, reconnect once, then run verify:animation-live with --confirm-disposable.",
        note: "Runs Texturing on the same shared AUTHORING session created by Geometry. Exercises native 16x template/repack, semantic pixel preservation, sub-unit per-face representation without geometry thickening, explicit target isolation, native size-2 Painter, bounded clipping, exact Undo/Redo and read-only K3 evidence-guidance scope/bitmap/UV safety. Case hints remain review-only; conditional cases without a current signal are untested, not a visual or reference-fidelity PASS.",
      },
      null,
      2
    )
  );
}

if (import.meta.main) {
  await main();
}

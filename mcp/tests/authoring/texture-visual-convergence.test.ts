import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("texture visual convergence contract", () => {
  test("active guidance requires fresh atlas and mapped model-view evidence", async () => {
    const [skill, workflow, texture, camera, nativeAdapter, runtimeExtensions] = await Promise.all([
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      source("prompts/bedrock_entity_workflow.md"),
      source("server/tools/texture/read.ts"),
      source("server/tools/inspection/camera.ts"),
      source("server/runtime/contracts/texture.ts"),
      source("server/runtime/extensions.ts"),
    ]);

    for (const text of [skill, workflow]) {
      expect(text).toContain("get_texture");
      expect(text).toContain("capture_model_views");
      for (const verdict of ["FAIL", "UNVERIFIED", "PASS"]) expect(text).toContain(verdict);
    }
    expect(skill).toContain("mapped model-view evidence");
    expect(skill).toContain("fresh `get_texture`");
    expect(skill).toContain("fresh affected evidence");
    expect(workflow).toContain("fresh get_texture atlas");
    expect(workflow.toLowerCase()).toContain("stale");

    const getTexture = texture;
    expect(getTexture).toContain("imageContent");
    expect(getTexture).toContain("getDataURL()");
    // Actual caller schema is supplied by the registered Runtime extension,
    // not the base read.ts facade; no new capability or test surface.
    expect(nativeAdapter).toContain("getDefinition.parameterSchema = focusedGetTextureParameters");
    expect(nativeAdapter).toContain("getFocusedTextureEvidence");
    expect(runtimeExtensions).toContain("apply: wireTextureRuntimeContracts");
    expect(skill).toContain("normalized in the reference picture");
    expect(skill).toContain("omitted_count > 0");
    expect(skill).toContain("status(reference_package_path=..., include_reference_images=true, reference_image_ids=...)");
    expect(skill).toContain("paint_texture_transaction");
    expect(skill).toContain("expected_revision");
    expect(skill).toContain("`get_texture` uses `texture`");
    expect(skill).toContain("`paint_texture_transaction` uses `texture_id`");

    const captureStart = camera.indexOf("createTool(cameraToolDocs[3].name");
    const capture = camera.slice(captureStart);
    expect(capture).toContain("VIEW ${view}");
    expect(capture).toContain("content.push(image)");
    expect(capture).toContain("structuredContent");
  });

  test("paint transaction bounds delivered evidence while retaining full-bitmap freshness guards", async () => {
    const [transaction, bitmap] = await Promise.all([
      source("server/tools/paint/textureTransaction.ts"),
      source("lib/texture/bitmapRuntime.ts"),
    ]);
    expect(transaction).toContain("const dirtyRegion = cropRgbaRect(");
    expect(transaction).toContain("env.ctx.putImageData(imageData, localX, localY)");
    expect(transaction).toContain("rgbaToPngDataUrl(");
    expect(transaction).toContain("dirtyRegion.pixels");
    expect(transaction).toContain('kind: "affected_region_png"');
    expect(transaction).toContain("revision: plannedReceipt.revision.after");
    expect((transaction.match(/fullTextureRgba\(texture\)/g) ?? []).length).toBe(4);
    expect(transaction).toContain("requireUnchangedTextureBitmap(before, fullTextureRgba(texture))");
    expect(transaction).toContain("bitmap changed after postcondition verification");
    expect(bitmap).toContain("export function cropRgbaRect");
    expect(bitmap).toContain("pixels.subarray(sourceStart, sourceEnd)");
  });

  test("local texture correction proves qualitative direction instead of mutation activity", async () => {
    const [skill, workflow, validation] = await Promise.all([
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      source("prompts/bedrock_entity_workflow.md"),
      source("../docs/03-authoring/validation/visual.md"),
    ]);

    for (const text of [skill, workflow]) {
      expect(text.toLowerCase()).toContain("causal correction");
      expect(text).toContain("IMPROVED | UNCHANGED | REGRESSED");
      expect(text.toLowerCase()).toMatch(/same (?:causal|cause)/);
      expect(text).toContain("BLOCKED");
    }
    expect(skill).toContain("smallest bounded causal correction");
    expect(validation).toContain("IMPROVED | UNCHANGED | REGRESSED");
  });

  test("visual convergence stays on existing evidence and Painter surfaces", async () => {
    const [profile, skill, workflow] = await Promise.all([
      source("lib/capabilities/registrationProfile.ts"),
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      source("prompts/bedrock_entity_workflow.md"),
    ]);

    expect(profile).toContain('export type McpRegistrationProfile = "bedrock_entity" | "extended";');
    for (const forbidden of ["texture_convergence_profile", "auto_texture_generator", "texture_quality_score"]) {
      expect(profile).not.toContain(forbidden);
      expect(workflow).not.toContain(forbidden);
    }
    for (const tool of ["draw_shape_tool", "paint_with_brush", "get_texture", "capture_model_views"]) {
      expect(skill).toContain(tool);
      expect(workflow).toContain(tool);
    }
  });
});

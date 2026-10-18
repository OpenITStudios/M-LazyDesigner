import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("live authoring harness static contract", () => {
  test("shared live verifier source declares freshness, runtime identity, cost metrics, and stable fixture identities", async () => {
    const helper = await source("scripts/verify/live-e2e-common.ts");
    for (const contract of [
      "build_identity",
      "instance_id",
      "startup_time",
      "exposed_tool_count",
      "LAZYDESIGNER_AUTHORING_STAGE_AFFINITY_HEADER",
      "risky_eval",
      "from_geo_json",
      "ACTIVE STAGE",
      "tools/list",
      "mutation_calls",
      "inspection_calls",
      "evidence_calls",
      "history_calls",
      "request_bytes",
      "response_bytes",
      "not model tokens",
      "AUTHORING_E2E_CUBE_NAME",
      "AUTHORING_E2E_ATLAS_NAME",
      "AUTHORING_E2E_ANIMATION_A_NAME",
      "AUTHORING_E2E_ANIMATION_B_NAME",
    ]) {
      expect(helper).toContain(contract);
    }
    expect(helper).toContain("Stale installed LazyDesigner build");
    expect(helper).toContain("--confirm-disposable");
  });

  test("Geometry uses current consolidated tools, preserves a thin per-face fixture, and hands Texturing the same shared AUTHORING session", async () => {
    const geometry = await source("scripts/verify/verify-geometry-live.ts");
    for (const tool of [
      "create_project",
      "add_group",
      "manage_cubes",
      "inspect_elements",
      "capture_model_views",
      "undo",
      "redo",
    ]) {
      expect(geometry).toContain(tool);
    }
    for (const retired of ["place_cube", "modify_cube", "inspect_element\""]) {
      expect(geometry).not.toContain(retired);
    }
    expect(geometry).toContain("operation: \"create\"");
    expect(geometry).toContain("operation: \"update\"");
    expect(geometry).toContain('THIN_CUBE_NAME = "e2e_thin_per_face"');
    expect(geometry).toContain("faces: THIN_FACE_UV");
    expect(geometry).toContain("thin_per_face_without_geometry_thickening");
    expect(geometry).toContain("quality.degenerate_faces === 0");
    expect(geometry).toContain("same shared AUTHORING session");
    expect(geometry).toContain("no Geometry-to-Texturing phase switch is required");
    expect(geometry).toContain("client.snapshotMetrics()");
  });

  test("Texturing prebuilds native UV/repack, thin per-face preservation, target-isolation, clipping and history acceptance without an AUTHORING bounce", async () => {
    const texturing = await source("scripts/verify/verify-texturing-live.ts");
    for (const contract of [
      "type: \"template\"",
      "pixel_density: 16",
      "padding: true",
      "texture_id: baseTextureUuid",
      "inspect_elements",
      "mapFaceLocalPixelToAtlasPixel",
      "semanticColorBefore.opacity === 128",
      "color_picker_tool",
      "add_texture_group",
      "activate_texture",
      "size: 2",
      "draw_shape_tool",
      "affected_rect",
      "imageDigest",
      "undo",
      "redo",
      "semantic_rgba_preserved_across_repack",
      "thin_per_face_survived_native_template_repack_without_thickening",
      "native_size_2_brush_changed_target_only",
      "bounded_shape_clip_preserved_outside_pixel",
    ]) {
      expect(texturing).toContain(contract);
    }
    expect(texturing).toContain('THIN_CUBE_NAME = "e2e_thin_per_face"');
    expect(texturing).toContain("quality.degenerate_faces === 0");
    expect(texturing).toContain('expectedPhase: "geometry"');
    expect(texturing).toContain("same shared AUTHORING session created by Geometry");
    expect(texturing).not.toContain('expectedPhase: "texturing"');
    expect(texturing).not.toContain("capture_model_views");
    expect(texturing).not.toContain("place_cube");
    expect(texturing).toContain("client.snapshotMetrics()");
  });

  test("Animation proves A-vs-selected-B targeting and playback through the current consolidated surface", async () => {
    const animation = await source("scripts/verify/verify-animation-live.ts");
    for (const contract of [
      "create_animation",
      "inspect_animation",
      "manage_animation_timeline",
      "operation: \"timeline\"",
      "set_anim_time_update",
      "operation: \"keyframes\"",
      "action: \"play\"",
      "action: \"pause\"",
      "action: \"stop\"",
      "explicit_property_target_a_while_b_selected",
      "animation_b_unchanged",
      "undo",
      "redo",
      "client.snapshotMetrics()",
    ]) {
      expect(animation).toContain(contract);
    }
    expect(animation).not.toContain('"manage_keyframes"');
    expect(animation).not.toContain('"batch_keyframe_operations"');
    expect(animation).toContain("AUTHORING_E2E_BONE_NAME");
  });

  test("Persistence is a two-step native reopen proof instead of an open-project fallback", async () => {
    const persistence = await source("scripts/verify/verify-persistence-live.ts");
    for (const contract of [
      "--prepare",
      "--verify",
      "export_model",
      "codec_id: \"project\"",
      "wrote_to_path",
      "artifact_sha256",
      "save_path",
      "inspect_elements",
      "list_textures",
      "inspect_animation",
      "authored_state_matches_prepare_snapshot",
      "manual native reopen",
    ]) {
      expect(persistence).toContain(contract);
    }
    expect(persistence).not.toContain("open_existing_project");
    expect(persistence).not.toContain("switch_authoring_phase");
    expect(persistence).toContain("expectedPhase: \"animation\"");
  });

  test("package exposes explicit phase/persistence verifiers plus GitHub-first generic fixture/deploy entrypoints without an automatic authoring orchestrator", async () => {
    const pkg = JSON.parse(await source("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["verify:geometry-live"]).toBe(
      "bun run ./scripts/verify/verify-geometry-live.ts"
    );
    expect(pkg.scripts["verify:texturing-live"]).toBe(
      "bun run ./scripts/verify/verify-texturing-live.ts"
    );
    expect(pkg.scripts["verify:animation-live"]).toBe(
      "bun run ./scripts/verify/verify-animation-live.ts"
    );
    expect(pkg.scripts["verify:persistence-live"]).toBe(
      "bun run ./scripts/verify/verify-persistence-live.ts"
    );
    expect(pkg.scripts["verify:fixture-static"]).toBe(
      "bun test tests/authoring/current-workspace-fixture-static.test.ts"
    );
    expect(pkg.scripts["verify:lift-static"]).toBeUndefined();
    expect(pkg.scripts["deploy:verified"]).toBe(
      "bun run ./scripts/operations/verified-build-artifact.ts deploy"
    );
    expect(pkg.scripts["verify:authoring-live"]).toBeUndefined();
  });
});
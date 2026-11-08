import { describe, expect, test } from "bun:test";

const source = (path: string) => Bun.file(path).text();

describe("Native Blockbench composition P0 owner and recovery contract", () => {
  test("remains a manually invoked Windows debug-only feature, not model editing", async () => {
    const [native, main, app, stage] = await Promise.all([
      source("../apps/desktop/src-tauri/src/blockbench_surface.rs"),
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/NativeEditorStage.svelte"),
    ]);
    expect(native).toContain("#[cfg(all(windows, debug_assertions))]");
    expect(native).toContain("#[cfg(not(all(windows, debug_assertions)))]");
    expect(native).not.toContain("SetParent(");
    expect(native).not.toContain("SetWindowLongPtrW(");
    expect(native).not.toContain("TerminateProcess(");
    expect(native).not.toContain("SendInput(");
    expect(main).toContain("blockbench_surface::restore_on_exit()");
    expect(app).toContain("import.meta.env.DEV && !devFixture");
    expect(app).toContain("if (restored) finishNavigate(next)");
    expect(stage).toContain("onclick={present}");
    expect(stage).toContain("export async function detach()");
  });

  test("uses window-relative native cutout with GDI ownership and two-part rollback", async () => {
    const native = await source("../apps/desktop/src-tauri/src/blockbench_surface.rs");
    for (const term of [
      "CreateRectRgn(", "CombineRgn(", "EqualRgn(", "GetWindowRgn(",
      "SetWindowRgn(", "region.transfer()", "aperture: Option<Aperture>",
      "fn aperture_rect(", "fn assert_owned_region(", "fn clear_aperture(",
      "let region_error = clear_aperture(lease).err();",
      "let window_error = restore_window(lease).err();",
      "fn cutout_rejects_outside_or_overflowing_rectangles()",
      "fn window_cutout_uses_outer_window_coordinates()",
      "fn release_if_manager_minimized()",
      'receipt("DEFERRED"', 'receipt("DETACHED"'
    ]) expect(native).toContain(term);
  });

  test("coalesces native location changes and preserves an unverified failure", async () => {
    const [main, stage, app] = await Promise.all([
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src/NativeEditorStage.svelte"),
      source("../apps/desktop/src/App.svelte"),
    ]);
    expect(main).toContain('app.emit("native-editor-layout", ())');
    expect(stage).toContain("layoutDirty = true;");
    expect(stage).toContain("if (layoutDirty && presented && !uncertain) scheduleUpdate();");
    expect(stage).toContain("if (!mounted || !presented || busy || uncertain || fixture) return;");
    expect(stage).toContain("receipt.status === 'DETACHED'");
    expect(stage).toContain("receipt.status === 'DEFERRED'");
    expect(stage).toContain("unlistenLayout?.()");
    expect(app).toContain("<NativeEditorStage");
    expect(app).toContain("<WorkspacePage");
    expect(app).toContain("<SupportPage");
  });
});

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
    expect(native).toContain("SetWindowLongPtrW(");
    expect(native).not.toContain("SetWindowLongPtrW(hwnd, GWL_EXSTYLE");
    expect(native).not.toContain("WS_EX_TOOLWINDOW");
    expect(native).not.toContain("TerminateProcess(");
    expect(native).not.toContain("SendInput(");
    expect(main).toContain("blockbench_surface::restore_on_exit()");
    expect(app).toContain("import.meta.env.DEV && !devFixture");
    expect(app).toContain("if (restored) finishNavigate(next)");
    expect(stage).toContain("onclick={present}");
    expect(stage).toContain("export async function present(): Promise<void>");
    expect(stage).toContain('data-native-editor-reservation="true"');
    expect(stage).toContain("{#if !compact}");
    expect(stage).not.toContain('class="native-placeholder"');
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

  test("adopts one real HWND with frame rollback, hit-test and WebView repaint", async () => {
    const native = await source("../apps/desktop/src-tauri/src/blockbench_surface.rs");
    for (const term of [
      "original_frame_style: isize", "adopted_frame_style(", "restored_frame_style(",
      "fn change_frame_style(", "SWP_FRAMECHANGED", "WS_DISABLED",
      "fn confirm_native_hit(", "editor_at_native_center(",
      "GetAncestor(WindowFromPoint(center), GA_ROOT)",
      "SetForegroundWindow(editor)", "RedrawWindow(manager, ptr::null()",
      "RDW_ALLCHILDREN", "fn frame_restoration_preserves_live_blockbench_owned_flags()",
      ".and_then(|_| confirm_native_hit(&candidate, target, true))",
      "confirm_native_hit(existing, geometry, false)?",
    ]) expect(native).toContain(term);
    expect(native).not.toContain("SetParent(");
    expect(native).not.toContain("SendInput(");
    expect(native).not.toContain("TerminateProcess(");
  });

  test("pins the admitted Blockbench HWND and requires Rust detach even after a Svelte remount", async () => {
    const [native, stage, unified, app] = await Promise.all([
      source("../apps/desktop/src-tauri/src/blockbench_surface.rs"),
      source("../apps/desktop/src/NativeEditorStage.svelte"),
      source("../apps/desktop/src/UnifiedWorkspacePage.svelte"),
      source("../apps/desktop/src/App.svelte"),
    ]);
    expect(native).toContain("fn discover_manager() -> Result<usize, String>");
    expect(native).toContain("let manager = discover_manager()?;");
    expect(native).not.toContain("let manager = discover()?.0;");
    expect(native).toContain("manager_thread: u32");
    expect(native).toContain("manager_class: String");
    expect(native).toContain("existing.verify_manager()?;");
    expect(native).toContain("lease.verify_manager()?;");
    expect(stage).not.toContain("(!presented && !uncertain)");
    expect(stage).toContain("if (fixture) return true;");
    expect(unified).toContain("if (!nativeStage) {");
    expect(unified).not.toContain("nativeStage ? nativeStage.detach() : true");
    expect(app).toContain("if (!nativeEditorStage) {");
    expect(app).toContain("if (restored) finishNavigate(next)");
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
    const unified = await source("../apps/desktop/src/UnifiedWorkspacePage.svelte");
    expect(app).toContain("<UnifiedWorkspacePage");
    expect(unified).toContain("<NativeEditorStage");
    expect(app).toContain("<WorkspacePage");
    expect(app).toContain("<SupportPage");
  });
});

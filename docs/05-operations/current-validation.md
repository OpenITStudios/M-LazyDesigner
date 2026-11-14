# LazyDesigner Current Validation

## 2026-11-15 — Shared texture selection across Edit and Paint preview (SOURCE_ONLY)

Pinned upstream Blockbench 5.2.1 `Texture.getDefault()` uses the active selected texture when available, falling back to the first in a Bedrock single-texture project. The Svelte Rust editor previously maintained a single UI `paintTextureIndex` across modes but passed it to `RustViewport` only in Paint mode; switching to Edit reverted the derived material to texture zero without changing selection. The viewport now receives the same transient selection in both workspace modes. Existing Rust-session epoch reconciliation prevents carrying it across unrelated projects, while Undo/Redo and Paint changes in one session preserve it. No new state, saved face-reference rewrite, Rust engine/CLI/IPC change or native validation. SOURCE_REVIEWED; existing selection regression source TEST_AUTHORED_NOT_RUN; actual Windows/WebView2/Blockbench mode-switch and 1:1 visual acceptance remain UNVERIFIED.

## 2026-11-15 — New Cube face default texture reference (SOURCE_ONLY)

Pinned Blockbench v5.2.1 `js/outliner/types/cube.js` `Cube.init()` fills non-null face `texture` references with `Texture.getDefault().uuid` for single-texture Bedrock projects. The Tauri new-Cube adapter previously populated only UV rectangles; it now uses a bounded `new_cube_faces()` helper to set each face's `texture` to the first available asset UUID. No texture or UUID-less first asset produces `false`, without fabricating a UUID or changing imported asset order. Existing imported Cube faces remain untouched; Rust Core still validates and stores the resulting six faces as part of the existing Add Cube transaction and Undo/Redo. Focused Tauri regression cases are authored but NOT_EXECUTED. First-asset fallback is an intentional UI scope simplification: the current Edit mode has no persistent Blockbench texture selection state. Cargo/Tauri/Windows/WebView2, `.bbmodel` native reopen, and Blockbench 1:1 visual acceptance remain NOT_EXECUTED/UNVERIFIED.

## 2026-11-15 — Texture UUID ambiguity rejection in format-5.0 imports (SOURCE_ONLY)

After adding UUID-string Cube face references, the canonical Rust validator still accepted multiple `textures` with the same `uuid`; face lookup would select the first match and Auto UV could read the wrong texture's wrap metadata. `AuthoringDocument::validate` now requires all present texture UUIDs to be nonempty, well-formed strings under the existing project UUID guard, and distinct within the texture array. A missing UUID is retained for legacy index-referenced textures; no UUIDs or assets are automatically rewritten. Authored Rust regression source covers duplicate UUIDs referenced by Cube faces, malformed UUID values, and omission compatibility. No Cargo, native Blockbench, WebView or Windows validation executed. SOURCE_REVIEWED and TEST_AUTHORED_NOT_RUN; actual Blockbench round-trip remains UNVERIFIED.

## 2026-11-15 — `.bbmodel` Cube face UUID texture compatibility (SOURCE_ONLY)

Pinned upstream Blockbench 5.2.1 `js/outliner/types/cube.js` initializes face texture as `false`, sets it to `Texture.getDefault().uuid` for single-texture Cube initialization, and persists face saves through `getSaveCopy()`. Our Rust validator previously allowed only numeric texture indices (plus null/false), rejecting valid UUID-string face references. The canonical `validate_cube` now resolves UUID strings to the corresponding `textures[].uuid` while preserving previous numeric references; unknown UUIDs are refused. The Auto UV projection's wrap metadata lookup also resolves UUID strings to avoid accidentally treating an explicitly unsupported wrap as the default. Svelte CubeFace projection permits UUID string values but does not become a source owner. New Rust test source covers mixed face references, unchanged texture/animation opaque data, edit/export/reimport, Undo/Redo, unresolved UUID refusal and Auto UV invalid-wrap atomic refusal. SOURCE_REVIEWED, TEST_AUTHORED_NOT_RUN; no Cargo/Windows/WebView2 or native Blockbench reopen and 1:1 acceptance has been executed.

## 2026-11-15 — Recovery of PNG IHDR production gate and aggregate decoded-preview budget (SOURCE_ONLY)

A new HEAD inspection found the prior source commit (`94318bb`) included regression assertions for PNG headers, but the production function still contained the old signature-shaped Base64 check. The prior claim of deployed IHDR screening was incorrect at that HEAD. The current source fixes the production code and updates stale regression expectations: bounded Base64-decoded embedded PNGs must have the eight-byte PNG signature, 13-byte first IHDR chunk and nonzero dimensions at most 2048 pixels each. In addition to 2 MiB per Base64 candidate and 4 MiB combined source budget, the read-only Tauri snapshot now admits at most 4,194,304 decoded pixels and 16 textures in total, preventing many highly compressed images from entering the derived GPU cache. Generated sample PNGs replace synthetic signature-only placeholders in source regressions; new cases cover aggregate pixel budget and count. This is a header-screening and decoded pixel-budget guard, not a full PNG CRC/image/animation validation, executed test result or native GPU memory guarantee. The original Rust-owned texture fields and `.bbmodel` export, CLI, Paint/Undo transactions are unchanged. SOURCE_REVIEWED and TEST_AUTHORED_NOT_RUN; Cargo, WebView2, Windows, native Blockbench and visual parity NOT_EXECUTED/UNVERIFIED.

## 2026-11-15 — Bounded PNG header validation before WebView projection (SOURCE_ONLY)

`desktop_authoring.rs` formerly checked a `data:image/png;base64,` prefix, PNG signature-shaped Base64 and length only, accepting a truncated sample placeholder as an image candidate. Now the source verifies bounded Base64 decode, PNG signature, a 13-byte `IHDR` first chunk, and nonzero width/height not exceeding 2048 per side or four million pixels. This reduces incorrect preview claims and oversized decoded image exposure without decoding or mutating an imported PNG in the authoring engine. Existing exclusion of paths/network/multi-file/per-texture UV/malformed render modes remains. Rust source regressions construct a valid 2×2 PNG, refuse a truncated signature, invalid dimensions and multi-file preview. This is header screening, not full CRC/chunk/frame/image correctness proof; the browser is still the final PNG decoder with colored fallback on load failure. Cargo, Windows/WebView2 and native Blockbench tests remain NOT_EXECUTED; full `.bbmodel` round-trip and visual acceptance UNVERIFIED.

## 2026-11-15 — Asynchronous PNG cache identity guard (SOURCE_ONLY)

The derived Three.js viewport used index plus source string to identify a failed texture load, which is insufficient when an old image request finishes after a newer request that has reused the same source (possible after Paint, Undo/Redo, or a new model). `RustViewport.svelte` now retains a distinct cache request entry for each load and validates exact entry identity before any error callback deletes or disposes active GPU material state. A small `rustTextureCache.ts` read-only predicate and Node source regression cases check same-source replacement and removed entries. The Rust/Tauri snapshot, PNG codec, brush transactions, Undo/Redo and `.bbmodel` remain unchanged. SOURCE_REVIEWED, TEST_AUTHORED_NOT_RUN; actual browser load ordering, Windows/WebView2, native PNG rendering and Blockbench 1:1 visual parity remain NOT_EXECUTED/UNVERIFIED.

## 2026-11-15 — Paint atlas selection isolation across Rust model sessions (SOURCE_ONLY)

Read-only review of current `RustViewport.svelte` confirms that on a changed Rust snapshot, the render view rebuilds and its GPU texture cache is reconciled by the embedded PNG source string; this is source behavior, not a proven WebView frame render. A more direct source defect was the Paint selected texture index remaining active when a new Rust session opened with the same number of textures, which could target an unrelated atlas. The UI now reconciles the selected index against the authoritative snapshot `epoch`: switching projects resets to index zero, while edits, Save Copy, Undo and Redo within the same session preserve the valid selection. A pure `rustPaintSelection.ts` function and Node regression source cover same-count session changes, invalid indices and same-session continuity. No Rust document/codec/IPC change, no browser texture ownership, and no native tests. SOURCE_REVIEWED; TEST_AUTHORED_NOT_RUN; real Paint-to-3D refresh and Blockbench parity remain UNVERIFIED.

## 2026-11-15 — Paint editability parity and pointer-up endpoint (SOURCE_ONLY)

The Tauri `paintEditableTextures` projection previously repeated only part of the strict generated-RGBA8 ownership guard in Rust `paint::editable`, so an imported/extended texture could be shown as editable while Rust correctly refused to mutate it. A read-only `paint_texture_editable` Rust helper now makes UI flags call that exact predicate. The Paint pointer-up handler also takes its last valid atlas sample before ending an active gesture, covering fast drags with no final pointermove while still discarding cancelled/lost-capture strokes. Authored Rust regression intent covers unsupported extensions and incomplete owner marker; Node source intent covers final endpoint interpolation. No CLI schema, bitmap codec, Tauri command or native validation changed. SOURCE_REVIEWED, TEST_AUTHORED_NOT_RUN; Cargo/TypeScript/WebView2/Windows and Blockbench actual visual/round-trip acceptance remain NOT_EXECUTED.

## 2026-11-15 — Bedrock single-texture default preview selection (SOURCE_ONLY)

Pinned Blockbench v5.2.1 `js/formats/bedrock/bedrock.js` has `single_texture: true` and no `single_texture_default`; `js/texturing/textures.js` `Texture.getDefault()` follows the selected texture when available, otherwise the first texture. The Rust editor's derived Three.js projection now resolves a single bounded texture index for all non-null Cube faces. Paint selection is view-only and updates the preview, while Edit defaults to the first texture. A null face remains excluded, and `.bbmodel` indexed face references are not rewritten by this transient selection. Source-authored Node regression cases cover selection, fallbacks, absent/null faces and non-mutation. No new Rust texture owner or IPC; Cargo, TS, browser/WebView2 and native Blockbench correspondence NOT_EXECUTED/UNVERIFIED. Special material modes, external texture paths and true asset round-trip still require independent acceptance.

## 2026-11-15 — Bounded Filled Rectangle Paint tool (SOURCE_ONLY)

The generated RGBA8 Paint workspace now offers a filled rectangle tool that uses the start and end pixel of one pointer gesture, rather than a path replay or a separate JavaScript bitmap engine. Canonical Rust `PaintTextureRectangle` reuses the existing PNG decoder/encoder, checks both inclusive rectangle corners within project resolution, and performs one atomic Rust edit with one Undo step. An `erase` flag is also supported by the Rust operation, while UI exposes filled-color rectangles only. Source regressions assert rectangle pixel coverage including reversed corners, untouched outside pixels, `.bbmodel` export/reimport, no-op refusal, history, imported asset refusal and failed multi-operation atomicity; TEST_AUTHORED_NOT_RUN. The pinned Blockbench 5.2.1 Bedrock Entity format is single-texture, so the selected atlas is not necessarily the texture shown in the 3D model preview. No native PNG, TypeScript, Windows/WebView2, Blockbench save/reopen or 1:1 visual acceptance has been executed.

## 2026-11-15 — Dedicated Paint workspace layout (SOURCE_ONLY)

The Rust editor's `Paint` tab now selects a separate central Paint presentation with a larger RGBA8 atlas, generated-texture Pencil/Eraser/radius/alpha controls, and an independent read-only 3D preview. The original Textures dock continues listing and selecting assets and remains compatible with existing float/tab/side placement. Paint controls are rendered only once; the same Rust-owned `paint_texture_brush` operation, revision, Undo/Redo, Tauri and CLI authority are retained. The Edit tab restores the existing 3D model viewport with Move gizmo; Move is disabled while Paint is active. Switching is blocked during active brush capture or busy IPC. The source only covers generated RGBA8 Paint, not imported/layered textures, full tools, animations or Blockbench 5.2.1 UI parity. SOURCE_REVIEWED, SOURCE_COMMITTED intent; UI tests, Cargo, TypeScript, Windows/WebView2 and native visual acceptance NOT_EXECUTED.

## 2026-11-14 — Rust-owned circular Pencil/Eraser brush (SOURCE_ONLY)

Added one `paint_texture_brush` EditOperation for bounded generated RGBA8 atlas textures with radius 1–8, circular integer pixel footprint, clamped edge coverage, transparent Eraser and Pencil RGBA. The authoritative Rust PNG decoder/encoder and revision guard commit each brush gesture once; existing single-pixel and stroke operations remain supported. The Textures dock now offers Pencil/Eraser and radius controls, with transient gesture configuration snapped at pointer down. A stroke exceeding 4096 path points aborts entirely rather than silently committing a truncated path; cancelled gestures still do not write. Authored Rust tests include pixel footprint, Undo/Redo, .bbmodel preservation, malformed radius/coordinate and batch atomic refusal. No Cargo, Node/TypeScript, WebView2, real brush/native Blockbench acceptance or visual parity executed. This is not full Paint workspace or layered/imported texture editing.

## 2026-11-14 — Single-transaction Rust Paint strokes (SOURCE_ONLY)

Added `paint_texture_stroke` in the existing `EditOperation` schema, with a strict 4096-point bound, full coordinate validation before decoding, and one Rust PNG decode/encode per gesture. The legacy one-pixel operation now routes through this shared Rust stroke implementation. `RustEditorPage.svelte` stages cursor points only in transient UI state, uses bounded interpolation from `rustPaintStroke.ts`, and sends one revision-guarded request when the pointer is released; cancelled pointer capture does not submit. Rust regression source covers one-revision/one-Undo/Redo, export/reimport, no-op, oversized stroke, invalid coordinates, imported texture refusal and atomic multi-operation rollback. Node source regressions cover interpolation and invalid/oversized points. All tests are TEST_AUTHORED_NOT_RUN; Cargo/TypeScript/Windows/WebView2/native Blockbench and real pointer/PNG/alpha visual behavior remain NOT_EXECUTED/UNVERIFIED. This is not a full brush engine, Paint mode, layered texture editing, or native acceptance.

## 2026-11-14 — Rust-owned single-pixel Paint source slice (SOURCE_ONLY)

Added `authoring/paint.rs` with bounded RGBA8 PNG encode/decode and atomic one-pixel edits under the canonical Rust `EditorSession` revision/Undo owner. `CreatePaintTexture` creates a new transparent embedded atlas at project resolution (up to 256×256); `PaintTexturePixel` edits only a strictly whitelisted LazyDesigner-generated texture, rejecting imported PNGs, external paths, unexpected metadata and unsupported PNG formats instead of silently dropping data. Both operations use the existing CLI/Tauri apply plan, not a second pixel engine. The Textures panel now offers New RGBA8 Texture, color/alpha controls and a single-pixel pointer atlas editor. Pinned `png 0.17.16` and `base64 0.22.1` were already present in Cargo.lock; they are declared directly and included in the package dependency list. Rust source regressions cover mutation/round-trip/Undo/Redo/no-op, imported texture refusal, invalid coordinates, oversized resolution and atomic batch rollback. This is SOURCE_COMMITTED intent; Cargo, TypeScript, app/WebView2, actual Paint interaction, generated PNG decode, native Blockbench reopen and visual acceptance remain NOT_EXECUTED/UNVERIFIED. No general-purpose brush, imported texture paint, animation or layer support is claimed.

## 2026-11-14 — Default texture material sides and render-mode refusal (SOURCE_ONLY)

Pinned Blockbench 5.2.1 Texture material setup (`js/texturing/textures.js`) uses transparent normal texture materials with an explicit `render_sides` policy and separate shader/blend behavior for additive, emissive and layered modes. The current Rust/Tauri projection now rejects non-default or malformed render modes and unsupported side values before exposing an embedded PNG. It projects a read-only `texturePreviewSides` array with `front`/`double` choices; the Three.js Cube preview applies the corresponding FrontSide/DoubleSide material and ordinary transparency for available embedded PNGs, falling back to double-sided colored geometry for unsupported sources. Updated Rust and Node regression source is AUTHORED_NOT_RUN. This is not the Blockbench custom shader, alpha composition/ordering or material/layer/texture animation parity. Cargo, TypeScript, real image decode, native Blockbench and Windows tests remain NOT_EXECUTED/UNVERIFIED.

## 2026-11-14 — Cube UV rotation and texture decode fallback (SOURCE_ONLY)

Against pinned Blockbench 5.2.1 `js/outliner/types/cube.js` `updateUV`, the read-only Three.js projection now handles face rotation 0/90/180/270 by permuting the same four UV corners. For Box UV it applies the source's signed 1/64 atlas-unit inset to reduce texture bleeding; unsupported rotation values return no texture UV projection. A failed embedded PNG browser load is marked in the local GPU cache and the viewport rebuilds a colored fallback rather than repeatedly requesting the same invalid image. Source-only Node regression cases cover rotations, signed/mirrored Box UV and refusal of invalid rotations; NOT_EXECUTED. Rust asset/texture authority, CLI, file codec and native test holds are unchanged; real texture/alpha accuracy, animated frames, external paths, Cargo/TypeScript/WebView2 and Blockbench visual parity remain UNVERIFIED.

## 2026-11-14 — Bounded embedded PNG derived viewport (SOURCE_ONLY)

The native Rust/Tauri snapshot now projects only bounded inline PNG base64 candidates (2 MiB per candidate; 4 MiB aggregate), retaining the original opaque texture assets in Rust. External relative/absolute paths and network schemes are not accessed by the WebView. Multi-file/per-texture resolution and non-limited wrap modes fail closed to an untextured fallback. The existing Svelte/Three.js viewport derives six-face UV rectangles from Rust Cube snapshots and normalized project texture resolution for unrotated faces, with nearest-neighbor embedded PNG materials when browser decode succeeds. Face rotation, animated textures, source/PNG validation, per-texture dimensions, full Blockbench alpha/wrap parity and native 1:1 visual behavior remain unsupported or UNVERIFIED. Source-authored Rust and Node regressions; no Cargo, browser, native Blockbench or Windows tests executed.

## 2026-11-14 — Texture-bearing `.bbmodel` interchange fixture (SOURCE_ONLY)

Created a synthetic format-5.0 Bedrock Entity fixture with two texture metadata entries (one placeholder embedded data URL and one external relative path), referenced and untextured Cube faces, UV rotation, nested bones/outliner, Animation, texture groups and opaque extensions. Focused Rust regression source checks that face/rotation and Box UV offset edits do not drop the texture objects, relative path, face reference, null texture face, animation, hierarchy or project extension data across export/reimport and Undo/Redo. The embedded base64 is intentionally a placeholder and is NOT a decoded or image-valid PNG. No real Blockbench-generated model or native asset has been opened. Evidence: SOURCE_REVIEWED / TEST_AUTHORED_NOT_RUN; Cargo, Blockbench, WebView2 and native visual interoperability remain NOT_EXECUTED/UNVERIFIED.

## 2026-11-14 — Box UV inspector offsets (SOURCE_ONLY)

Source review of pinned Blockbench 5.2.1 `js/uv/uv.js` `slidePos` and Cube face layout informed a bounded integer Box UV offset editor. The existing Rust `EditOperation` now accepts `set_box_uv_offset`; Svelte exposes two numeric Box UV Inspector fields from the Tauri `uvOffset` projection. Rust checks finite integer values, Box UV mode, and no-op, then updates the offset and derived rectangles in a single revision-guarded transaction. Null-texture face UVs and opaque fields are preserved. Regression tests are authored NOT_EXECUTED; native Blockbench/CLI/Cargo/Windows/visual acceptance is UNVERIFIED. This does not implement complete Blockbench Box UV dragging/clamping or Paint.

## 2026-11-14 — Post-audit Rust Edit corrections (SOURCE_ONLY)

Review of 12 Rust development commits and pinned Blockbench v5.2.1 project/Bedrock/Cube source established input coercion and Box UV default mismatches. Svelte inspector numeric fields now share a finite decimal parser, preventing blank, partial and nonfinite values from entering Rust commands. The native Bedrock Entity project defaults to Box UV, and the shared Rust AddCube transaction calculates initial Box UV face rectangles. Explicit Face UV remains writable. Non-string multi_file_ruleset values fail closed during Auto UV remapping, rather than being interpreted as absent rules. Regression source is authored NOT_EXECUTED; native Cargo/TypeScript, CLI/Windows/WebView2 and actual editable Blockbench round trip remain UNVERIFIED.

## 2026-11-14 — Explicit per-texture UV remap guard (source-only)

The pinned Blockbench v5.2.1 `js/io/project.ts` `getUVWidth/Height(texture)` selects per-texture UV dimensions when its format enables `per_texture_uv_size`. The current Rust authoring subset only has project-wide UV resolution; Auto UV Move/Resize therefore now fails closed when imported project root or meta explicitly declares `per_texture_uv_size: true`, in addition to existing multi-file ruleset protection. Negative regression source covers both locations, atomic revision refusal and export preservation. This does not prove the flag exhaustively detects every Blockbench format rule, and does not implement per-texture mapping. SOURCE_REVIEWED; TEST_AUTHORED_NOT_RUN; native Blockbench/Cargo/WebView2 NOT_EXECUTED.

## 2026-11-14 — Manual face UV exits Auto UV (source-only)

The pinned Blockbench v5.2.1 `js/uv/uv.js` uses `disableAutoUV()` after manual UV editing. The Rust `SetFaceUv` operation now makes an actual changed face-UV rectangle and the Cube's `autouv=0` transition one revision-checked atomic edit, shared by Tauri and CLI. No-op edits leave the Auto UV mode unchanged. The Svelte face inspector enables manual UV for Auto UV cubes with an explicit mode-transition hint; Box UV face edits remain refused. Authored-only regression source covers Auto UV 1/2, opaque field preservation, Undo/Redo, no-op and invalid face refusal. Cargo, WebView2, native Blockbench two-way editability and visual parity remain NOT_EXECUTED / UNVERIFIED.

## 2026-11-14 — Rust Auto/Box UV source remapping (NOT_EXECUTED)

The pinned Blockbench v5.2.1 Bedrock Cube rules were reviewed at `JannisX11/blockbench@e2ede0809ee6bc91f374ac7e00d34cffbdf86a14` in `js/outliner/types/cube.js` and its format/UV context. The existing authoritative Rust `EditOperation` path now remaps six faces on Auto UV mode 1/2 Move and one-edge Resize, and updates Box UV offsets and derived faces for one-edge Resize. The Svelte Position/Size and selected-Cube Move gizmo use the same revision-checked operation as the headless CLI. Non-UV payloads, opaque extensions and Undo/Redo remain Rust-owned. Multi-edge UV-sensitive Resize, manual Auto/Box per-face changes, unsupported rotation/wrap settings and multi-file per-texture UV mapping still fail closed rather than risk silent loss. Source regression cases cover mode 1/2, face rotation, Box offset and Undo/Redo, preserving fields and negative atomicity; **TEST_AUTHORED_NOT_RUN**. No Cargo, TypeScript, native WebView2/Blockbench round-trip, pixel/behavior parity, actual speed or token-cost claim has been executed. Proof ceiling: SOURCE_REVIEWED / SOURCE_COMMITTED; native/local **NOT_EXECUTED**.

## 2026-11-14 — Rust .bbmodel Geometry/UV safety and Cube Rotation (source-only)

At this earlier `Rust` checkpoint, the source added one real `set_cube_rotation` edit to the canonical `AuthoringDocument`/Tauri GUI/CLI `EditOperation` path and its existing revision-checked Undo/Redo. The Svelte Cube inspector now displays Rotation degrees (X/Y/Z) from the Rust projection. Upstream Blockbench v5.2.1 serializes optional Cube `rotation` vectors and indexed face Texture references in `.bbmodel`. The Rust codec retains those, together with group/outliner order, opaque texture source data, animations and plugin/controller fields in the scoped synthetic source cases. Input validation refuses malformed Cube/Bone rotation vectors, unsupported Auto UV mode values, and invalid per-Cube Box UV flags. At that checkpoint the editor could not replicate Blockbench's UV remapping for `autouv=1/2` or Box UV resize offsets: those Move/Resize/manual UV operations failed closed and the Svelte controls explicitly indicate/disable them; supported Rotation remains available. Regression source includes stale/atomic edit behavior, Undo/Redo, media/hierarchy preservation and negative cases; **TEST_AUTHORED_NOT_RUN**. No Rust/TypeScript compilation, headless CLI, real Windows/Tauri/WebView2, actual Blockbench reopened file, true two-way editable `.bbmodel` fidelity, texture/animation operation, visual 1:1 or model/token efficiency has been executed or established. All existing holds, product Skills, legacy Blockbench Runtime, user assets and separate `Local` and `main` tracks remain intact. Proof ceiling: SOURCE_REVIEWED/SOURCE_COMMITTED; execution NOT_EXECUTED.


## 2026-11-14 — Rust-native attached-tabs source slice (NOT_EXECUTED)

The `Rust` Svelte Edit workspace now has source-authored **attached tabs** for its two existing logical panel groups only. The single `rustDockLayout.ts` UI preference owner can attach Textures and Outliner/Properties as a tab stack on the left or right, select exactly one displayed real content snippet (click, Arrow keys, Home/End), swap the stack to the opposite side, and separate it into the previous independent dock arrangement. The opposite rail retains a visible Separate Panels action, and the attached host provides a distinct accessible tab list. UI-only layout persistence has a whitelisted bounded `v3` schema, with v1/v2 migration and strict validation against impossible floating/hidden/attached combinations. The existing Rust `AuthoringDocument`, undo history, Tauri/CLI interface, .bbmodel persistence, old Blockbench Runtime, assets and project-owned Skills are unchanged. Authored regression source includes migration, tab/slot identity, switch/detach, and malformed preference refusal, but **no test was executed**. The subset is not arbitrary Blockbench panel attachments, OS-detached panels, top/bottom docking, complete drag-and-drop, or 1:1 pixel/input parity; native WebView2, source compilation, real Blockbench compatibility and performance remain **NOT_EXECUTED / UNVERIFIED**. Proof ceiling: SOURCE_REVIEWED / SOURCE_COMMITTED, TEST_AUTHORED_NOT_RUN.


## 2026-11-14 — Rust in-window floating panel extension (NOT_EXECUTED)

The `Rust` Edit UI has a source-authored in-window floating panel extension to the existing Svelte docking owner. Both real panel groups (Textures and Outliner/Properties) can be floated without duplicating their contents, moved/resized with bounded pointer or keyboard input, reattached by releasing over a left/right dock target, or returned by explicit Dock Left/Right/Fold commands. `rustDockLayout.ts` remains the sole UI layout owner and uses a validated `v2` `localStorage` preference with read-only migration from `v1`; persisted fields contain no model, file paths, UUIDs, Undo history or Rust revision. Floating rects are constrained to the current editor dimensions and a plain click does not trigger docking. Source regressions were authored for migration, malformed persisted values, geometry clamps, no duplicate panel state and docking targets, **NOT_EXECUTED**. This is not full Blockbench dock parity: independent OS windows, attached tabs, arbitrary drag-and-drop, top/bottom panel slots, actual WebView2 pointer/focus behavior, DPI and visual comparison remain UNVERIFIED or NOT_IMPLEMENTED. The Rust engine, CLI, legacy Blockbench Runtime, user assets, repository Skills and the current CI/localtest/release holds are unchanged. Proof: SOURCE_REVIEWED / SOURCE_COMMITTED; native and test execution NOT_EXECUTED.


## 2026-11-14 — Rust-native UI dock placement and splitter source (NOT_EXECUTED)

On the `Rust` branch, the independent Svelte Edit UI has a bounded **UI-only** dock owner in `apps/desktop/src/rustDockLayout.ts`. It supports left/right Textures ↔ Outliner/Properties relocation, fold/restore rails, pointer and keyboard dock width resizing, the Outliner/Properties vertical height divider, and Reset Dock Layout. The existing Svelte panel contents are reused in their current slots; no duplicate asset panels, model state or Rust editor history were created. UI preferences are parsed from a versioned bounded `localStorage` key, with safe defaults and session-only fallback when storage is denied. The pure layout constrains requested widths against a 320px minimum viewport at the supported desktop window sizes. `rustDockLayout.test.mjs` contains authored source regressions for defaults, swap, stored input validation, fold and resize boundaries; tests **NOT_EXECUTED**. Full Blockbench panel floating, drag-and-drop attachment, arbitrary dock slots, pixel/interaction parity, actual browser/Windows persistence, Cargo/TypeScript, native editing and editable `.bbmodel` round-trip remain **UNVERIFIED**. Previous Blockbench Runtime, model/UV/CLI core, user asset files, held tests, CI and release policy remain unchanged. State: SOURCE_REVIEWED / SOURCE_COMMITTED at the source-only proof ceiling.


## 2026-11-14 — Rust-native selected-Cube Move gizmo (source-only)

On branch `Rust`, the Svelte/Three.js Edit viewport now sources a selected-Cube **translation** gizmo from pinned Three.js r162 `TransformControls`. A drag updates the disposable pivot preview only; one bounded **parent-local** delta is sent through the existing Tauri `rust_editor_apply` to the Rust `EditorSession` on mouse release. Rust remains the unique document/Undo owner; stale, rejected, canceled and unsupported drags restore the displayed geometry from Rust snapshots without automatically retrying writes. Orbit is disabled during the gesture. The viewport Move toggle and status label disclose the supported action; Rotate, Scale, bone editing, docking, texture rendering and true Blockbench 1:1 behavior are NOT_IMPLEMENTED/UNVERIFIED. `rustMoveGizmo.test.mjs` contains source-authored positive and negative proposals but **was NOT_EXECUTED**. No new command, Gateway/MCP runtime, user asset, CI, localtest, release or model-effort change. Only GitHub source inspection is available; TypeScript/Cargo, WebView2 mouse/keyboard, real Blockbench import/export, visual fidelity and usage saving are UNVERIFIED.


## 2026-11-14 — Rust-native Tauri/Svelte Edit source (NOT_EXECUTED)

The `Rust` branch now has a source-authored independent Edit interface. Tauri `desktop_authoring.rs` uses the authoritative Rust `EditorSession` for New/Open/Add Cube/Apply/Undo/Redo/Save Copy, with the same bounded `authoring/storage.rs` file I/O used by the CLI. `src/main.ts` mounts `RustEditorRoot.svelte` by default on this branch, while preserving the previous companion as a deliberate legacy route. `RustEditorPage.svelte` connects Blockbench Default Dark-aligned Edit controls, Outliner selection and Cube Position/Size/face UV inputs to Rust IPC; `RustViewport.svelte` derives untextured, explicitly UNVERIFIED Three.js geometry from revision-tagged Rust snapshots. Three.js and TypeScript typings are pinned in the package/lock. Paint and Animate remain disabled. This is SOURCE_REVIEWED / SOURCE_COMMITTED only: Cargo, typecheck, real GUI, WebView2/3D, Windows picker, native bidirectional `.bbmodel` round-trip, 1:1 UI docking/interaction, textures, animations and AI efficiency remain NOT_EXECUTED / UNVERIFIED. Existing Runtime, managed distribution, user assets, 12 Skills and CI/test/release holds are preserved.


## 2026-11-14 — Rust-native headless Phase 1 source (NOT_EXECUTED)

The `Rust` branch now contains an isolated Rust `AuthoringDocument`, authoritative `EditorSession`, separate versioned `BlockbenchV5` format adapter, basic Bedrock cube/bone/outliner/face-UV operations with revision-checked batch mutations and in-memory Undo/Redo, plus a direct `lazydesigner-authoring` CLI (`new`/`inspect`/`apply`). The CLI admits only explicit bounded inputs and SHA-checked source revisions, and publishes fresh sibling files with non-overwriting staged hard-link semantics. A synthetic `.bbmodel` fixture, edit plan and source regressions cover intended round-trip preservation, stale batch refusal, unsupported types and overwrite safety. This is source code and test intent only, **not installed or executed**. GUI/Tauri/MCP integration, Cargo compilation, Windows hard-link behavior, actual editable Blockbench round-trip, texture/animation semantics, 1:1 UI parity, visual quality and measured token/cost improvements are **UNVERIFIED**. Existing Blockbench Runtime, Legacy Desktop, product Skills, user assets and test/CI/release holds remain unchanged.


## 2026-11-14 — Rust-native editor Phase 0 plan (source-only)

The maintainer approved a new `Rust` development branch for a standalone Rust/Tauri/Svelte Bedrock Entity editor, with Blockbench v5.2.1 Default Dark 1:1 supported-workflow UI and mandatory editable, bidirectional `.bbmodel` compatibility. The `Local` branch governance explicitly allowed the named branch without changing the current CI/test/release holds. On `Rust`, the branch-local profile selects only `Rust` as writable. The Phase 0 architecture document is a source specification, not executable Rust engine code. It explicitly preserves current Blockbench-based runtime, existing project Skills, media, installed behavior and bounded evidence policies until a tested replacement exists. No native UI screen, headless model write, Rust compilation, installed CLI, visual parity, Blockbench round trip, token saving or quality gain was executed or established. State: SOURCE_REVIEWED / SOURCE_COMMITTED for plan; execution NOT_EXECUTED.

## 2026-11-14 — Optional Animation CLI diagnosis (source-only)

Bun `analyze:animation` and the existing managed executable source
now route a bounded `lazydesigner-animation-analysis-input-v1` JSON
manifest to the original Animation Quality, Motion Dynamics, native
keyframe replacement-tolerance, world-marker Contact Evidence and
Temporal Evidence Sampling functions. The output highlights
caller-declared near-coincident times, loop-seam review, planted marker
drift/penetration and missing sampling windows; still image times are
candidate-only, not rendered or observed frames. The embedded source
does not sample Blockbench, move keyframes, apply IK, attest original
motion/marker provenance, or grant artistic or continuous-playback
approval. A compiled Windows executable JSON smoke and ten focused
positive/negative regressions have been authored but NOT_EXECUTED.
Sol 6.1 Low Thinking remains fixed. Actual local CLI behavior, native
preview, animation quality and correction reductions remain UNVERIFIED.

## 2026-11-14 — Read-only visual silhouette CLI (source-only)

The Bun `analyze:visual-silhouette` and existing managed-executable source
now route two caller-saved PNG files through the canonical
`compareBoundPngAlphaEvidence` implementation with strict SHA-256,
alpha-mask, approved-reference and capture-binding checks. Numerical
silhouette overlap is emitted only when a caller explicitly declares a
reviewed same-frame pairing; unknown framing, opaque source pixels, stale
hashes or missing capture evidence remain UNVERIFIED. The existing
`analyze:texture-pair` uses the shared bounded regular-PNG file reader.
The managed compiled help dispatch and focused negative/positive fixtures
are AUTHORED_NOT_RUN. Claims about actual native origin, current
Blockbench pose, camera calibration, Codex Skill uptake or model quality
are not established at this source proof level; Sol 6.1 Low Thinking
remains fixed and localtest is still held.


## 2026-11-14 — Pinned CLI-Anything vendor and Bun Texture planner (source-only)

Both source-level Texture and appearance-variant planners are connected to the existing managed `lazydesigner.exe` as read-only subcommands. Its actual compiled-binary smoke check is authored in the existing packaging procedure but has not run; an already installed older binary has no proven new CLI command. Upstream HKUDS/CLI-Anything Codex Skill/methodology was copied at revision `34f519533bc175d2fe287ab8316b0dd99bb9cc43` with Apache-2.0 license, without installing/activating an external Skill or script. Read-only Bun `plan:texture-treatment` and `plan:appearance-variant` commands wrap the canonical Texture treatment and appearance-variant continuity owners with shared bounded JSON input parsing. They report declared face/variant blockers, never native mutation, actual RGBA parity, visual PASS or user acceptance. Positive/negative CLI source regressions AUTHORED_NOT_RUN. No Bun execution, installed Codex invocation, source build, real Blockbench operation or accepted visual improvement has been measured. Do not infer speed/cost savings or quality change from source code.


## 2026-11-14 — Daily-use cohort identity and reference orientation (source-only)

The Gateway rejects an explicit `CONTINUE` without a nonblank outer `task_context_id` before invoking any native capability, reports `COHORT_TASK_CONTEXT_REQUIRED` with a non-uncertain recovery route, and retains standalone `COMPLETE` compatibility. The `status` text distinguishes unbound approved reference from a bound task context; the distributed agent instruction keeps the user's chosen Low Thinking model/effort fixed and instructs relevant Reference/Workspace/user-delta reorientation. The same Gateway now requires supplied non-empty cohort IDs to match the last issued online Control task identity; stale IDs fail before native execution with `COHORT_TASK_CONTEXT_STALE`, and the existing ephemeral Gateway session revokes them on verified project/Stage/Runtime loss. Focused handler/session/response regressions AUTHORED_NOT_RUN. Current behavior under Codex and installed Blockbench, actual reference consumption, stale-but-nonblank client IDs, model compliance, visual similarity, generator/build checks and quality improvement remain **NOT_EXECUTED / UNVERIFIED**. No new public tool, new persistent owner, localtest, CI or release.

The installed-authoring instruction source and the current Texturing specialist now state one reference-grounded representative-patch/cohort/scoped-review cycle, hold partial back/side coverage at UNVERIFIED, and preserve the latest user correction. The existing Golden comparison contract freezes Codex Sol 6.1 Low Thinking. A distribution/Skill/benchmark source regression was authored but NOT_EXECUTED. No real model uptake, rendered art improvement, native build, user approval or cost improvement is claimed.

## 2026-11-14 — Exact active Skill delivery through existing Gateway status (source-only)

Online authoring `status` is now source-wired to include the exact SHA-matched bytes of the required active Skill/profile handles in the MCP text result, without copying the instructions into Control structured state. A bounded authoring mutation without a previously issued authoring orientation with resolvable specialist context is rejected before native execution, while direct read-only queries and subsequent known authoring operations retain their normal paths. The existing `known_context_ids` contract suppresses retransmission only when the client claims the exact content remains loaded. Focused positive/negative source regressions are AUTHORED_NOT_RUN. Actual Codex instruction ingestion/decisions, workspace launch CWD, installed binary parity, native use and accepted artistic quality remain NOT_EXECUTED / UNVERIFIED.

Normal authoring guidance now allows the bounded first-party read-only Texture CLI conditionally, without changing the primary Gateway route or claiming that a locally unavailable executable can be called. The actual Codex invocation and effect on user corrections remain UNVERIFIED. The third-party vendor source is not enabled as an agent Skill.

A third first-party read-only route `analyze:geometry` now reuses the existing projected envelope, rig graph, and surface quality warning analyzers on caller-supplied JSON without native changes. Focused source regressions and a future managed compiled-executable smoke are AUTHORED_NOT_RUN. The reported numeric agreement, source-declared rig state and warnings are not evidence of a real model capture or accepted geometry. The actual Codex use, native Blockbench build and quality improvements remain UNVERIFIED.

## 2026-11-14 — Read-only Texture PNG pair CLI (source-only)

The CLI `analyze:texture-pair` is source-authored to compare two bounded
SHA-checked 8-bit RGBA PNG files using the original strict PNG decoder,
full-pixel revision function and region diff; optional client-declared
allowed-change regions and alpha identity mark potential violations.
The managed Windows binary routes to the same CLI and its existing packaging
procedure includes a dispatch smoke, while focused PNG/integrity/mask
regressions are AUTHORED_NOT_RUN. Input file SHA parity does not establish
the original native producer, active project binding, approved change scope
or visual PASS. Bun, compiled Windows build, Codex and Blockbench are
NOT_EXECUTED / UNVERIFIED; fixed Low Thinking remains unchanged.

This file owns current proof interpretation only. Continuation: [next-action.md](next-action.md); native procedure: [local-acceptance-runbook.md](local-acceptance-runbook.md). Git owns historical implementation and acceptance details.

## 2026-11-07 — Visual-asset source focus-switch closure (not executed)

V1 Texture Variant is source-wired with transaction-local render/wrap/visibility/frame setting continuity across the existing Undo lifecycle; Camera `capture_model_views` is source-wired to withhold part-correspondence evidence when capture freshness is not `MATCHED`. Owning regressions and architecture source closure are **SOURCE_REVIEWED / REGRESSION_AUTHORED_NOT_RUN**. Bun, TypeScript, canonical generators, installed Blockbench and Minecraft remain **NOT_EXECUTED / NATIVE_UNVERIFIED / QUALITY_UNVERIFIED** at this source revision. Internal Capability Graph `READY` versus Gateway/Control `UNKNOWN` and non-wired asset planners are open, not silently marked complete. No public capability, generated artifact, CI or release changed.

## 2026-11-05 — Initial PROFILE_SWEEP frame roll stability (source-only)

The existing v13+ `PROFILE_SWEEP` derives its initial normal by
projecting the declared `up_axis` perpendicular to the first tangent.
Nearly parallel/antiparallel directions could yield a very small
projected vector, so microscopic positive versus negative transverse
offsets flipped the normal and therefore all later transported frames
without a source-authored twist. The source constructor now refuses
projection sine below `1e-4` after retaining the prior exact-parallel
error. It reports
`GEOMETRY_MATH_PROFILE_SWEEP_UP_AXIS_UNSTABLE` rather than guessing
an alternative up direction. Previously valid sources with a near-
singular initial frame can newly refuse to rebuild until an explicit
better `up_axis` is authored.

This is a local numerical representation guard, not a bend smoothing
algorithm, visual fidelity evaluator, second frame solver or style
quota. All non-degenerate paths continue to use original parallel
transport, section twist and one-unit source raster. No extra
native mutation, Gateway tool, generated API, CI or release.

Proof: exact pinned GitHub `Local` source review, documented small
dimensionless stability threshold and focused positive/negative
regressions AUTHORED (not executed) for tiny signed transverse
offsets, antiparallel input, previous exactly parallel error and
valid X/Z/Y-axis straight/bent paths. Bun, TypeScript, Codex,
native Blockbench and visual QA NOT EXECUTED under the user's hold.

## 2026-11-05 — Significant PROFILE_SWEEP twist occupancy proof (source-only)

The existing v13+ `PROFILE_SWEEP` source kernel had no post-raster
check that declared twist affected voxel geometry. A large anisotropic
rotation could be aliased by one-unit quantization, even while all
source segments, station-local joints, and material taper checks pass.
For source segments with angular change >=45 degrees and declared
half-width/half-height asymmetry >=1 model unit, the existing voxel
predicate now compares its actual occupancy with a counterfactual
held at the authored START twist. The same cell, bend/tangent frame,
dimension and profile are used; it only varies the twist angle. A
single changed occupancy decision demonstrates a representable twist
signal; a fully aliased segment fails closed with
`GEOMETRY_MATH_PROFILE_SWEEP_TWIST_UNREPRESENTED`.

No second voxel allocation/raster, new geometry or output form,
native mutation, Gateway tool, runtime replacement or
generator-coupled API change. Symmetric or small-angle source remains
eligible without claiming visible rotational evidence. This is a
binary discretization diagnostic, not angle-accuracy validation,
continuous loft proof, UV/texturing orientation or reference-based
visual acceptance. v13+ stored sources with completely aliased
large twists may now reject on reconstruction.

Proof: pinned exact `Local` source and regression cases AUTHORED
for a one-layer 360-degree alias, source-retained positive/negative
handed anisotropic turns and rotationally symmetric/small-angle
compatibility. Source-only; Bun, TypeScript, Codex, installed
Blockbench and visual quality NOT EXECUTED per the user's test hold.

## 2026-11-05 — Station-local bent PROFILE_SWEEP joint contact (source-only)

The existing v13+ `PROFILE_SWEEP` joint test checked shared voxels
or face adjacency between each sequential segment pair, but accepted
such contact **anywhere** in the whole raster. On bent/twisted or
looping source shapes, a remote crossing could therefore mask a missing
joint at the declared shared station. The canonical source raster now
passes the station positions and grid origin to the same membership-mask
contact owner. It requires pairwise shared/face-connected voxels
within the station's explicit cross-section corner radius plus half
a voxel diagonal. Missing station-local contact refuses with
`GEOMETRY_MATH_PROFILE_SWEEP_JOINT_DISCONNECTED: ...;reason=OFF_STATION`.

No new voxel raster, extra Cuboids, runtime API or visual-quality
score. The prior three-argument helper remains backward compatible
for isolated source callers; the actual sweep always checks location.
Stored v13+ designs joined only through remote self-contact may newly
reject at reconstruction. The guard proves discrete structural contact,
not exact curvature, twist, thickness or target-reference quality.

Proof: pinned `Local` source and focused positive/negative
synthetic voxel-grid and bent/twisted Recipe regressions AUTHORED,
not run. Bun, TypeScript, Codex, native Blockbench, CI and visual
acceptance remain NOT EXECUTED under the user's test hold.

## 2026-11-05 — PROFILE_SWEEP material taper representability (source-only)

The existing v13+ `PROFILE_SWEEP` now checks whether material
half-width/half-height taper survives the existing one-unit
voxel raster. Previously a connected, fully represented segment
could have identical radial voxel extents in both endpoint bands
even though the source declared a one-model-unit change (e.g.
1.5→2.5 over eight units). The same raster pass now collects bounded
near-endpoint occupied voxel-center extents in the segment's actual
transported/twisted cross-section frame, only for axes with material
half-extent change of at least one model unit. A change of at least
0.5 model unit in the intended direction is required. Missing
endpoint-band samples or a collapsed/reversed raster signal refuses
the source with `GEOMETRY_MATH_PROFILE_SWEEP_TAPER_UNREPRESENTED`.

This is limited source/voxel representability, not exact pen-width,
reference-artistic resemblance or smooth CAD. Smaller changes are
not asserted visible. Source owner, deterministic disjoint Cuboids,
ordered joint checks and v1–v12 behavior remain. No second raster,
filler geometry, optimizer score, new public Gateway/Runtime tool,
generated API edit or native mutation. Stored v13+ sources with
unrepresented taper may now be rejected during reconstruction.

Proof: pinned GitHub `Local` and authored focused regressions for
insufficient endpoint sampling, nominal width/height changes erased
by voxel centers, visible anisotropic taper and small unclassified
variation. Exact staged Git blob readback before committing.
Bun, TypeScript, Codex, live Blockbench and visual acceptance
NOT EXECUTED per user instruction.

## 2026-11-05 — PROFILE_SWEEP ordered joint topology (source-only)

The existing v13+ source-local `PROFILE_SWEEP` voxelizer already checks
that each semantic path segment contributes some voxels and the full
generated mass is face-connected. Neither proves that each consecutive
authored segment pair retains contact when another/nonadjacent segment
can bridge its missing joint. The existing one-pass raster predicate
now also records a bounded 1-byte-per-cell segment membership mask.
After the canonical disjoint-Cuboid partition it requires an actual
shared occupied cell or full-face voxel adjacency for every adjacent
segment pair. A missing joint rejects the candidate with
`GEOMETRY_MATH_PROFILE_SWEEP_JOINT_DISCONNECTED`, not a misleading
continuous-section assertion.

No new runtime tool, second voxelization/mesh, global collision owner,
auto-fill geometry or generator-owned API change. Existing valid
Geometry stays on the same Cuboid Recipe realization path; v13+
saved source with missing sequential joints may be newly rejected.
This does not verify authored taper/section dimensions at pixel level,
native visual quality, actual performance or reference acceptance.

Proof: pinned `Local` source review and authored positive/negative
unit/canonical-Recipe regressions for ordered adjacency, diagonal-only
contact and globally connected but out-of-order segment masks. Bun,
TypeScript, Codex, native Blockbench and QA NOT EXECUTED under the
user's explicit testing hold.

## 2026-11-05 — Connector native-radius contact budget (source-only)

The existing v6 Geometry Construction CONNECT first checks waypoint
and full centerline exteriority, and then uses the original SWEEP
kernel to produce voxel-native Cuboids. That still allowed a correct
centerline to produce too much **radius-expanded overlap** with actual
endpoint part material. The CONNECT source owner now reviews each
positive-volume intersection between these already-generated Cuboids
and the two solved/repeated endpoint Cube inventories. The overlap
must fit within that endpoint's original joint anchor radius plus a
half-voxel diagonal (sqrt(3)/2 model-unit quantization margin).
Excess penetration yields
`GEOMETRY_MATH_CONNECT_NATIVE_VOLUME_EXCEEDS_CONTACT`.
Hollow bounding envelopes are never interpreted as occupied material.

The guard permits ordinary physical joint caps and deliberate thick
sections away from endpoint parts. It adds no second voxelization,
global scene scanner, style preset, auto-thickening, extra public
Gateway tool, Runtime change or generator-coupled API revision.
Stored v5 semantics are untouched; v6+ sources containing distant
material penetration can now be rejected during reconstruction.

Proof: pinned `Local` source review and authored positive/negative
regressions for an oversized bulging connector, ordinary face-cap
contact and exterior thick sections, plus exact staged Git blob readback.
Bun/TypeScript, Codex, native Blockbench, visual QA
and real performance results NOT EXECUTED under the user's testing hold.
The check covers emitted native voxel geometry against just the two
declared endpoint parts, not ideal continuous-spline volume clearance.

## 2026-11-05 — Continuous Connector centerline source review (source-only)

The v6+ Geometry Construction `CONNECT` preflight now examines full
source-declared centerline intervals against the actual solved/repeated
Cube material of the two endpoint parts. Previously only authored
intermediate waypoints and start/end directions were reviewed, leaving
straight chords or interpolated Catmull–Rom curves free to re-enter
endpoint material between valid waypoints. LINEAR uses exact open-box
slab intersection; Catmull–Rom reuses the canonical SWEEP cubic-control
reconstruction and a bounded conservative Bézier subdivision. A proven
entry fails with `GEOMETRY_MATH_CONNECT_CENTERLINE_INSIDE_SOURCE`;
unresolved near-surface intervals fail with
`GEOMETRY_MATH_CONNECT_CENTERLINE_UNVERIFIED`, never fabricated PASS.
The preexisting undeclared `sourceBoxes` TypeScript type reference in
`resolveEndpoint` was also corrected to the actual
`expandGeometrySourceBoxes` function.

Only centerline vs. endpoint-source material is reviewed; finite swept
radius, third-party obstacles, collision along native animation,
reference correctness, material/UV and native Blockbench outcomes
remain UNVERIFIED. The existing v5 behavior, native Cuboid SWEEP
kernel, Recipe application, four Gateway tools, generator-owned API
and source schemas remain unchanged.

Proof: pinned `Local` source review, exact staged Git blobs and three
focused positive/negative CONNECT regressions AUTHORED (not run).
Bun, TypeScript, Codex, native Blockbench, CI and visual acceptance
NOT EXECUTED per user instruction.

## 2026-11-05 — Face-aware connector waypoint exteriority (source-only)

The existing `geometryMathConnect.ts` v6 face-aware connector already
required exactly oriented outward start/end segments and native-voxel
contact with both source parts. It still allowed a curved route whose
intermediate declared waypoint fell strictly **inside an endpoint
source's actual Cube mass** before returning to an outward-facing
terminal segment. The kernel now rejects those waypoints, using
real solved and repeated Cuboid bounds rather than a coarse source
envelope. Genuine empty holes, tangent/boundary points and ordinary
external curved connectors are not automatically classified as
penetration. V5 source semantics remain unchanged.

This is not an all-segment spline self-intersection proof, global scene
collision validation or visual/rig/UV quality certification. No new
Geometry preset, solver, native tool, API or state store was added.

Proof: exact pinned `Local` source and focused positive/negative
connector regressions AUTHORED for direct and curved contacts,
outward-direction-valid interior loops, old v5 behavior and genuine
bounding-box void. Bun, TypeScript, Codex, CI, native Blockbench and
visual/model quality NOT EXECUTED; the user's testing hold remains active.

## 2026-11-05 — Voxel-cylinder negative-space topology correction (source-only)

The canonical source-only Advanced Geometry `voxel_cylinder` builder
previously checked both material and background with 4-neighbour
connectivity. A small annular cross-section (for example outer radius
2, inner radius 1) leaves corner-adjacent empty cells connecting the
declared cavity to the exterior, but the 4-neighbour exterior flood
could falsely call the opening enclosed. The existing builder now
keeps 4-connected solid material and uses 8-connected void/exterior
background, rejecting corner-leaking cavities and disjoint interior
void components. Valid solid cylinders and hollow tubes with a
well-separated central cavity remain compiled to the same bounded,
disjoint native Cuboid Recipe patterns; no geometry is silently added.

This is a geometry-construction source correction for arbitrary
voxelized radial forms, not a new tool, shape-specific generated
preset, automatic Cube deletion, or visual evidence. The
`construct_geometry` public Runtime capability remains unregistered.

Proof: exact pinned `Local` source plus dedicated positive/negative
topology and deterministic Recipe regressions AUTHORED. Bun, TypeScript,
Codex, CI, native Blockbench and visual-quality checks NOT EXECUTED;
the user's test hold remains active. No claim of a measured artistic
improvement or verified persisted legacy-model migration.

## 2026-11-05 — Scale-neutral projected Geometry metric integrity (source-only)

The canonical geometry `analyzeProjectedEnvelopeFidelity` helper previously
accepted finite AABB coordinates even when derived widths/areas/volumes,
area/volume unions or center deltas overflowed or underflowed numeric
precision. It could then return an `available` coarse envelope review
containing NaN/Infinity or misleading zero-overlap scores. The existing
projection now fails closed for nonrepresentable geometry and malformed
vectors. Stable midpoint arithmetic preserves valid large-offset models
when calculations remain representable; no object preset, native geometry
size quota, automatic Cube mutation or additional quality scorer was added.

Proof: pinned `Local` source audit and focused positive/negative quality
regressions AUTHORED for ordinary large Geometry, finite-but-extreme
numbers, overflow unions, underflow, malformed bounds and stable offsets.
Bun, TypeScript, Codex, CI, native Blockbench and actual visual fidelity
NOT EXECUTED under the user's explicit testing hold.

## 2026-11-05 — Golden-to-Harness recorder session correlation (source-only)

The existing Golden draft/finalizer and shared accepted-session comparator
now preserve the opt-in Gateway recorder's own `gateway_session_id`.
A Golden run bearing an ID must agree with every event's recorded ID;
mixed/partial sequences are rejected. Two accepted reports with the same
known recorder ID are rejected as reused evidence. Harness² requires
two distinct baseline/candidate IDs matching both the declared pair
and the values from the supplied Golden final reports. Missing,
malformed, repeated or swapped identities return INCONCLUSIVE rather
than an A/B reviewable result. Entirely legacy v1 Golden records
without recorder IDs remain compatible with general reporting, but not
reviewable under the stricter Harness² A/B gate.

Proof: pinned GitHub `Local` source, exact blob readback and focused
runner, accepted Golden, finalizer, direct comparison and Harness
regressions AUTHORED. Bun, TypeScript, Codex, native Blockbench and
model-quality acceptance NOT EXECUTED. These are supplied-metadata
correlation checks, not cryptographically signed native session proof.
User's prohibition on local/Codex test requests remains active.

## 2026-11-05 — Recorder-owned Gateway trace session identity (source-only)

The existing opt-in Gateway trace recorder already owned a fresh random
128-bit local trace nonce, but client `traceparent` can override the
reported trace ID. Each new recorder event now also emits that stable
`gateway_session_id`, independent of the client trace. The existing
read-only reporter requires that every event in one report has the same
bounded recorder ID, refuses mixed legacy/current and multiple-recorder
traces, and retains fully legacy v1 inputs with a null identity and
explicit `LEGACY_SESSION_ID_MISSING` scope. This is source/metadata
consistency, **not** authenticated two-run independence or native proof.

Proof: pinned `Local` exact blob readbacks and two focused positive/
negative regressions AUTHORED in existing trace owner tests. Bun,
TypeScript, Codex, native Blockbench, and model-quality acceptance
NOT EXECUTED; user's local-test hold remains active.

## 2026-11-05 — Cross-session accepted call metric reconciliation (source-only)

The existing Golden session comparator previously checked individual
non-negative metrics and accepted artifact/source identities but did not
reconcile per-kind call counts with the claimed accepted-result total.
An externally supplied candidate could therefore claim fewer tool calls
than its own breakdown. The shared comparator now requires six known
non-negative integer call-kind counters summing to the accepted total,
bounds decision-required and redundant inspect counts, requires at
least one mutation and verification, and rejects time-to-acceptance
greater than measured wall time. Existing legitimately unmeasured
time/token metrics remain nullable.

This source-only guard is reused by the Harness² candidate and Geometry
Knowledge comparison paths; it does not independently establish distinct
sessions, actual native executions, artifact lineage or visual PASS.

Proof: pinned GitHub `Local` source and authored positive/negative
regressions; Bun, TypeScript, Codex, live Blockbench and model quality
NOT EXECUTED. User's local-testing hold remains in force.

## 2026-11-05 — Golden final artifact saved after last mutation (source-only)

The canonical Golden accepted-result validator already required final shaded
capture after the latest native mutation, a post-authoring native save
receipt, and matching output .bbmodel digest. It still allowed a separate
mutate operation after that save (for example a Stage/control transition)
and before the final capture. The validator now refuses ACCEPTED unless
the last recorded native mutation is the matching readback-matched project
export. Both successful and failed/uncertain later mutations invalidate
the earlier saved receipt for acceptance; a fresh final save after the
mutation restores sequence validity. Read-only inspection remains allowed.
The validator does not inspect actual model bytes or certify visual
fidelity; independent native/visual evidence remains mandatory.

Proof: pinned `Local` source review and targeted acceptance regression
AUTHORED for later successful/failed mutations, resave and read-only
inspection. Bun, TypeScript, Codex, native Blockbench and live quality
NOT EXECUTED. No additional Gateway tools, Runtime change, CI activation,
generated API, asset mutation or local-test request.

## 2026-11-05 — Offline Golden trace evidence binding validation (source-only)

The existing read-only Gateway benchmark trace reporter previously allowed
optional `capture_evidence` and `artifact_evidence` values to pass through
in reported events without independently checking their internal digest
bindings. It now uses the recorder's own fingerprint functions, validates
bounded recognized views/project-save fields, verifies that claimed proof
comes from the appropriate successful capability/kind, and requires actual
recorded PNG-delivery counts for captured model views. Unknown extra fields
within claimed proof are rejected. Legacy trace rows without these optional
Golden proof fields remain supported.

This is supplied-JSON consistency only: a recomputed evidence hash cannot
authenticate the sender, PNG contents, saved `.bbmodel` bytes, same-project
runtime lineage, human approval or artistic quality. No Gateway hot-path,
native Runtime, Reference authority, CI or generated API change.

Proof: pinned `Local` source review; focused valid/tampered capture and save
receipt regression cases AUTHORED, not executed. Bun, TypeScript, Codex,
Blockbench native, Golden and visual acceptance remain NOT EXECUTED.
The user-requested hold on local/Codex tests remains active.

## 2026-11-05 — Code-only Gateway failure evidence classification (source-only)

The existing read-only Gateway trace reporter now adds a bounded
`diagnostics.failure_evidence` grouping of recorded error identifiers,
distinguishing uncertain mutation outcome, interrupted read transport,
lost project affinity, capability prerequisite/discovery, queue admission,
Reference errors and unknown failure codes. Because traces do not retain
native `receipt_issue` or full recovery detail, `BACKEND_UNAVAILABLE`
stays explicitly AMBIGUOUS instead of being misidentified as offline
Runtime or a safe-to-repeat mutation. A contradictory successful trace
event bearing a non-null error code is rejected as invalid.

Failure totals and source/Control trace correlation remain unchanged.
No new Runtime error policy, retry engine, agent, public MCP tool, CI,
generated API or Workspace mutation is introduced. This classification
does not independently attest native state, attribution or quality.

Proof: pinned `Local` source and exact Git blob readback, positive/negative
Bun regression cases AUTHORED. Bun, TypeScript, Codex, native Blockbench
and visual/model acceptance NOT EXECUTED. The user's Codex/local testing
hold remains in force.

## 2026-11-05 — Scoped repeat-error findings in Gateway trace (source-only)

The existing offline Gateway trace reporter previously grouped repeated
errors by capability and error code alone, potentially combining unrelated
Control tasks or client traces. It now separates failures by observed task
context hash when present, otherwise by trace ID; historical uncorrelated
events remain in their own legacy investigation bucket. Correlated repeat
findings add `grouping_basis` (`TASK_CONTEXT_HASH` or `TRACE_ID`).
Total failures by code and ordinary per-capability/latency statistics remain
unchanged. This is bounded diagnostic correlation only; no shared root cause,
replay safety, runtime quality, or native asset identity is inferred.

Proof: pinned `Local` source reviewed and positive/negative regression
cases AUTHORED for mixed contexts, traces and legacy events. Bun,
TypeScript, Codex, CI, Blockbench and live QA NOT EXECUTED. The user's
prohibition on local/Codex testing requests remains active.

## 2026-11-05 — L0 provenance and failure-count reconciliation (source-only)

The existing offline project-observation summary now rejects snapshots whose
per-capability counts do not equal observed `invoke_capability` calls, whose
named error-code totals exceed failed calls, or whose classified domain calls,
failures, duration or verification obligations exceed verified project
totals. Unknown/unclassified failures and unassigned domain calls remain
permitted, and historical optional build/context fields retain their
existing semantics. No new diagnostic pipeline, record schema, Runtime,
Gateway tool or native mutation was added.

Proof: pinned GitHub source audit and focused positive/negative L0 snapshot
regressions AUTHORED. Bun, TypeScript, CI, Codex, native Blockbench, visual
quality and actual performance tests NOT EXECUTED. User's prohibition on
local/Codex testing requests remains in force.

## 2026-11-05 — Strict Gateway trace core-metric validation (source-only)

The existing offline Gateway benchmark trace reporter now rejects invalid
event kinds, invalid/missing timestamps and missing, negative, fractional,
non-numeric or unsafe per-event `result_bytes` instead of reporting
distorted diagnostic metrics. Legitimate `result_bytes: null` remains
unknown. Totals that would exceed JavaScript's safe integer precision are
reported as unknown rather than a measured cost/efficiency improvement.
No Runtime transport, recorder schema, capture output, agent loop or
public Gateway tool changed.

Proof: exact pinned `Local` source review plus positive/negative
trace-report regression cases AUTHORED; Bun, TypeScript, Codex, CI,
native Blockbench and actual model-quality tests NOT EXECUTED.
The user's instruction to defer local/Codex testing remains in effect.

## 2026-11-05 — Golden evidence gated on complete image delivery (source-only)

The opt-in Gateway benchmark recorder previously checked each labeled
model-view PNG before issuing a capture digest but could ignore a malformed
*additional* image in the same response (for example a silhouette, native
four-side sheet or ingestion probe). The recorder now reuses one complete
MCP-image-delivery measurement as a prerequisite for creating the model-view
capture digest. An invalid extra image suppresses Golden capture evidence;
well-formed companion images remain allowed and are not reclassified as
model views. This changes benchmark evidence interpretation only, not native
camera rendering, transport, Control, Runtime tools or reference authority.

Proof: pinned `Local` source review, Git blob identity and focused positive/
negative regression cases AUTHORED in the existing trace test. Bun, TypeScript,
Codex, native Blockbench and live model quality NOT EXECUTED. User's hold on
local/Codex testing remains in force.

## 2026-11-05 — Canonical image byte evidence parity (source-only)

The opt-in Gateway benchmark recorder now uses one canonical, bounded Base64
decoder for MCP image-delivery metrics and Golden capture digests. Malformed
Base64 or a content list exceeding 128 items cannot yield a Golden capture
hash while delivery is unmeasurable; the existing 64 MiB encoded-image limit
also applies to captures. This is a source-level evidence consistency guard,
not native rendering, AI image consumption, or visual approval.

Proof: pinned Local source review and positive/negative trace regression
AUTHORED. Bun, TypeScript, Codex, GitHub CI and native Blockbench tests
NOT EXECUTED. The user still prohibits local/Codex test requests.

## 2026-11-05 — Gateway error identity cannot be overwritten by diagnostics (source-only)

The existing Gateway error adapter now applies diagnostic detail fields before
the authoritative `code`, `message`, and computed `recovery` fields. A
nested error detail can no longer impersonate a different failure or advise
automatic replay of an `OUTCOME_UNKNOWN` mutation. Existing capability and
native receipt-issue detail fields remain visible; no new error category,
agent runtime, retry loop, public Gateway tool or generated API was added.

Proof: pinned `Local` source review and an existing recovery-test owner's
positive/negative regression AUTHORED. Bun/TypeScript/Codex/CI/Blockbench
execution and native behavior NOT EXECUTED. User-requested suspension of all
local/Codex test requests remains active.

## 2026-11-05 — Branchless fallback surfaced in impact audit (source-only)

The existing read-only affected-execution planner previously omitted
multi-operation prerequisite graphs whenever a generic branchless graph
was present. It now preserves the diagnostic for Animation timeline and
records `branchless_fallback_present`, without inferring that a manifest
entry is registered in Runtime. The diagnostic is also selected when the
Control capability search projection changes. No Gateway executor, semantic
manifest, capability graph, generated API or native Runtime changed.

Proof: exact Local source analysis and focused positive/negative regression
AUTHORED in the existing affected-execution test owner. Bun/TypeScript,
Codex, GitHub verification CI, Blockbench and live quality NOT EXECUTED.
User-requested suspension of local/Codex test requests remains active.

## 2026-11-05 — Harness candidate session identity isolation (source-only)

The read-only Harness candidate evaluator now requires two distinct, bounded,
caller-declared `session_pair` IDs before offering a REVIEW_REQUIRED
comparison or a controlled negative result. Missing/malformed IDs produce
`SESSION_IDENTITIES_MISSING`; repeated IDs produce
`SESSION_REUSE_SUSPECTED`, both INCONCLUSIVE. Identifiers alone cannot prove
independent run execution, reset semantics, captured image provenance or human
review. No new runner, Workspace owner, agent Runtime, Gateway or tool.

Proof: pinned Local source review and positive/negative Golden regression
AUTHORED; executable Bun/TypeScript/Codex/native/model proof NOT EXECUTED.
User explicitly deferred any test requests until authorization.

## 2026-11-05 — Harness Control context isolation (source-only)

The opt-in Harness² evaluator now refuses comparative efficiency reporting
when a candidate's canonical Control task context ID differs from the
accepted baseline or the candidate lacks a bounded live project UUID.
Matching source, reference, starting bytes and Runtime alone cannot establish
that the same Control stage/task was used. A different disposable project
UUID may be legitimate; an absent UUID is not live provenance. An unbound
reported FAIL stays INCONCLUSIVE instead of being called a controlled quality
regression. Matching metadata is still not independent runtime attestation.

Proof: exact pinned Local source and regression cases AUTHORED for changed,
missing and restored Control task context and for unbound/matched project
identity. Bun, Codex, CI, Blockbench, visual acceptance and real Harness²
runs NOT EXECUTED. User-requested testing suspension remains in force.

## 2026-11-05 — Controlled Harness telemetry provenance (source-only)

The existing optional Harness candidate comparator now refuses per-metric
efficiency interpretation when baseline and candidate report missing or
different usage telemetry sources, even when the model name matches.
Results remain `INCONCLUSIVE` with distinct `TELEMETRY_SOURCE_UNKNOWN` or
`TELEMETRY_SOURCE_MISMATCH` reasons. This reuses existing report fields;
no new telemetry collection, score engine, Gateway, Runtime or model API.

Proof: pinned Local source review and focused positive/negative regression
AUTHORED. Bun/TypeScript/Codex/native visual/model-backed execution
NOT EXECUTED. User's explicit testing-request hold remains active.

## 2026-11-05 — Optional Harness context-byte identity check (source-only)

The existing read-only Harness candidate evaluator now optionally hashes the
actual bytes of two explicitly selected context files and rejects swapped,
tampered, identical or oversized inputs (256 KiB maximum per context). Without
files the evaluator continues to report declared, unverified context IDs;
with matching files it reports only that selected bytes match the claimed
SHA-256, NOT that Codex loaded/used them or produced a better asset. The
canonical Golden acceptance/quality gates and comparison remain unchanged;
no new agent runner, Gateway tool, model weight, dependency or Runtime hook.

Proof: pinned source changes and Git blob readbacks, focused pure helper
positive/negative Bun regressions AUTHORED. Bun/TypeScript, real Codex
sessions, native Blockbench, visual approval and real A/B model probes
NOT EXECUTED. User's suspension of any local/Codex test requests remains active.

## 2026-11-05 — Explicit unknown branch without graph prerequisites (source-only)

The existing Control search-only ambiguity guard now protects an unsupported
explicit operation whenever canonical branch metadata exists, even if the
branches have **no dependency graph** (e.g. material-instance operations).
An unknown explicit operation is `UNKNOWN`; a known selected operation keeps
its original readiness, a confirmed `BLOCKED` stays blocked, and tools with
no qualified manifest are not newly gated. This is a Control presentation
correction only. No manifest, semantic revision, schema, four-tool Gateway,
Runtime, registration, or generated API was changed.

Proof: exact pinned GitHub source readback and positive/negative search-boundary
regressions AUTHORED. Bun/TypeScript, Codex, CI, Blockbench and visual
acceptance NOT EXECUTED. User explicitly deferred any local/Codex testing
requests until later authorization.

## 2026-11-05 — Qualified-branch search readiness with fallback (source-only)

Control's AI-facing `search_capabilities` projection previously allowed an
exact capability-name result to omit `UNKNOWN` when the manifest contained
both branch-qualified prerequisites and a generic branchless graph. The
generic graph does not choose an operation; in particular, an unselected
`manage_animation_timeline` search must not imply operation readiness.
Control now projects `UNKNOWN` until a known branch is selected, even when
a generic graph exists. Known selected branches, confirmed `BLOCKED`, and
branch-independent tools are unchanged. Unsupported branches also remain
`UNKNOWN`. This only changes `gateway/control/capabilities.ts` search
presentation; core graph evaluation, Runtime registration, Gateway schema,
semantic manifests, generated API/HTML and native execution are unchanged.

Proof: Pinned `Local` source/blob review and targeted positive/negative Bun
regression AUTHORED in the existing discovery-hardening test. Bun/typecheck,
Codex, live Gateway, Blockbench and visual QA NOT EXECUTED. This does not
close the existing graph-level branchless readiness/semantic sync work.

## 2026-11-05 — Harness candidate evidence gate (source-only)

An opt-in read-only evaluator for a Harness²-inspired candidate probe was
authored in the existing mcp/scripts/evaluate/ owner. It reuses the canonical
Golden acceptance validator and comparison; mismatched task/source/reference/
initial asset/Runtime/model, unknown quality and missing native proof cannot
yield reviewable cost deltas. Confirmed reported LIVE quality FAIL vetoes
efficiency claims, and accepted PASS remains REVIEW_REQUIRED, not auto-promoted.
Declared context hashes are not authenticated payloads; report labels are not
independently correlated evidence.

Proof: exact-source/static checks and focused positive/negative regression
cases AUTHORED. Bun/TypeScript/CI, native Blockbench, visual acceptance,
real candidate probes, and measured cost-to-accepted-result NOT EXECUTED.
Verification CI remains disabled. P0 semantic/graph/generated-artifact
synchronization remains open, with no Runtime or Gateway mutation here.

## 2026-11-04 — AI-facing ambiguous branch readiness guard (source-only)

Control's existing `search_capabilities` projection now returns `UNKNOWN`
when a registered tool has branch-qualified prerequisite graphs but the
returned operation branch is missing or not recognized. Confirmed `BLOCKED`
readiness is preserved; known branches and branch-independent tools retain
their existing behavior. No Runtime registration, core graph implementation,
semantic manifest, generated API, native executor, model or asset changed.

Proof: exact-HEAD GitHub source and focused regression authored against real
catalog and output-schema contracts; Bun/TypeScript/CI/native Blockbench
NOT EXECUTED. Internal branchless/unknown-branch graph behavior remains
unresolved for actual routing implementation and requires generator-owned
semantic/API alignment before it can be changed.

## 2026-11-04 — Capability registration/discovery reconciliation (source-only)

The current Runtime registration/profile descriptor remains the only source
of executable capability exposure. The core/branch manifests carry semantic
metadata and may intentionally describe planned, unregistered operations.
`manage_uv_layout` and `construct_geometry` are not registered in the normal
Bedrock Runtime, while `manage_cubes` and `paint_texture_transaction` are.
An existing discovery test now includes a negative guard against exposing
the planned names, with explicit missing-identity and real-catalog assertions.
No production schema, registration, generator output or feature was activated.

Proof: exact Local source/registration/manifest review and authored regression
only. Bun/typecheck/build, CI and LIVE_BLOCKBENCH NOT EXECUTED. Branch-specific
readiness without a selected graph branch remains separate source work and
must not be mistaken for executable activation or approved visual quality.

## 2026-11-04 — Added-source test ownership guard (source-only)

The existing affected-execution planner now treats newly added executable
Runtime/Gateway/library modules without a mapped capability/behavior test as
a blocker, not structural typecheck PASS or an indiscriminate full-suite run.
The Git-aware CLI carries added/untracked path status into the existing plan;
the runner refuses a missing owner before running any verifier. Existing
mapped changes keep their focused path. Positive and negative regression
cases were authored in the existing affected-execution test owner.

Proof: pinned GitHub source review and static change checks only; Bun tests,
typecheck, CI, native Blockbench and Golden visual acceptance NOT EXECUTED.
Verification CI remains disabled. No release, new registry or asset mutation.

## 2026-11-04 — Unused MP4 pipeline retirement (source-only)

The MP4/H.264 recording plan and encoder, Runtime binary slot, Gateway proxy
and their three isolated tests were retired. Native registration, diagnostic
codec probing, Gateway read path, Control/Skill references and shared
animation evidence were reconciled without removing keyframe inspection,
focused pose PNG or playback. Temporal motion remains UNVERIFIED without
an independently observed native motion review. Generated API/HTML contained
no matching MP4 entries; no generated artifacts were manually changed.

Proof: pinned GitHub source/dependency screening and static patch checks only.
Bun tests/typecheck/build, native Blockbench, UI and Golden visual acceptance
NOT EXECUTED; verification CI disabled. Compatibility facades, historical
assets and still-used temporal sampling were retained pending separate proof.

## Current source authority — 2026-10-30

Source baseline before the first Golden correction: `2b24811f89541e3af0fbd5d6c6e3b7270b808d5a` on `Local`. Golden output destinations now reject Workspace/fixture paths and resolved symlink aliases; a Reference fingerprint is retained only when its post-session content matches preflight. The subsequent source-provenance correction requires clean Git HEAD at both session boundaries and withholds provenance on dirty/drifted source. On 2026-10-31 the user approved the new voxel-style visual. Its exact 1,640,048-byte PNG is now staged as a canonical Git fixture (`beacon-courier-approved.png`), matching SHA-256 `ad8ecd1e07aa858bdecff779dc7097e49bcf5410c864d1320d252c9134e56245` and Git blob `d6d58841a884498f9e9ce76ef5991e18b18d47c5`. The source Reference Package declares `APPROVED` visual authority and `READY` stage-reference input; the original SVG remains unchanged as non-active concept provenance. Actual Bun/Control execution and native model/human-result acceptance are NOT EXECUTED.

**Proof at this source revision:** exact GitHub source review; Golden guards, affected-test routing, scoped UV/Texture/Animation rechecks, and planned Stage reconnect classification regressions AUTHORED. A changed Stage retains its required transport/catalog reconnect, but the same proven Runtime instance/project does not produce a second generation-change callback. A validated, consistent same-Stage no-op preserves the existing connection/catalog. Gateway now rejects mismatched Stage, Runtime surface, surface-change claim, or requested target before changing affinity; rejected receipts withdraw the stale connection. Every known rejected successful project/Stage receipt now yields uncertain, non-retriable recovery until native state is inspected. Ordinary successful Runtime calls pass their already-verified project UUID into Control Delta and same-project task continuations. Stage handoffs now also reuse the verified preflight phase from the same serialized Runtime invocation instead of issuing a separate status request; unknown identities remain unbound. Different, missing or unverifiable identities keep full invalidation. The UV apply receipt's Graph readiness gate requires consistent moved-island and Cube/face sets, finite before/after rectangles and an actual mapping change; inconsistent reports cannot promote `uv_layout_current` despite a changed fingerprint. The Atlas audit flags an explicitly unresolved native Texture binding instead of declaring `production_gate: ready` from valid UV coordinates alone, while retaining legacy diagnostics with unspecified Texture UUID. The unregistered bitmap+UV migration source contract blocks moving an active face whose Texture owner is missing before pixel copies or Undo; disabled unrelated faces may remain untextured. Its native ownership reader also refuses detached Texture objects sharing a known UUID while preserving valid Blockbench material/group overrides that resolve to real project textures. The adapter transaction now reuses candidate after-revision hashes once actual native RGBA bytes are proven identical, eliminating redundant post-native digest calls while retaining two full-byte native reads, native UV postconditions and conservative Undo recovery. Control Delta now uses the canonical native UV apply receipt validator before narrowing UV/Texture recheck targets; malformed/mismatched receipts require broad verification, but complete Box and per-face targets remain scoped. A non-UV nested receipt no longer suppresses a valid Texture-region recheck when UV is not stale; malformed material/effects ledgers cannot return partial narrowed targets. Bun, TypeScript, CI, native Blockbench, save/reopen, export, user quality acceptance and Cost to Accepted Result **NOT EXECUTED**. No installed build is qualified for this revision. Verification CI remains disabled.

## Historical local and installed qualifications — 2026-10-26

2026-10-26: user-authorized LOCAL_CODE work on OpenITStudios/M-LazyDesigner/Local in the dependency-modernization worktree. Primary source remains dirty at 44b03b52. Recovery preserves 52 payloads; two root GIFs moved to canonical references. The 438 pre-existing missing Crimson Sentinel paths remain recoverable from Git.

CI DISABLED. No release or CI changes. Authoring/visual acceptance: NOT EXECUTED. Desktop 0.1.1 installed; dependencies unchanged. Toolchain: Bun 1.4.3, Node 24.22.0, Rust 1.99.1.

Working source 611024930ec823d544f72ce2a9b417f7a37d4afd: bounded Indonesian discovery repair, not deployed. Seven new regressions cover painting, parent changes, create/update distinction, unrelated queries and prerequisites; four failed before correction. Gateway/contracts 341, repository 302, types/unused, docs freshness and routing/decision evaluations PASS at that prior source SHA. Registered 54-tool source probes select expected routes. Broad discovery remains Top-1=0.537, Top-3=0.787 on 108 cases (unchanged baseline); 19 decision cases remain accurate. No full-source or new live acceptance is claimed. Logs: ignored .cache/intent-routing-*.log.

2026-10-27 REMOTE_GITHUB final MCP semantic-impact bounded traversal: an exact-budget impact queue previously stayed nonempty because the loop stopped when visited.size reached maxCapabilities before inspecting the final admitted node, incorrectly reporting truncated. Canonical owner now drains admitted nodes and only marks genuine unvisited impacted capabilities as truncation. Two focused source regressions authored for a terminal budget of one and an exact-budget transitive invalidation, NOT EXECUTED; prior overflow/duplicate/impact regressions remain. No tests, TypeScript, build, generator, CI, native/visual or PC actions. Branchless READY/UNKNOWN graph and executable semantic fingerprint/generated API alignment remain OPEN. Latest source correctness UNVERIFIED; installed 7b45bd69 unchanged.

Installed qualification — Accepted managed source: 7b45bd69027954d306f9fcf0482227e60fb0de18. Exact-commit verify:full PASS in ignored .cache/canonical-path-msix-verify-retry.log (EXIT_CODE=0): repository 302, Runtime 2529, installer 35, authoring 166, Gateway/manifest 298, Golden 44; remaining source/build gates PASS. The first attempt timed out and Bun crashed; its log is retained. Desktop 0.1.1 remains at source 37baddcc, compatible contract 1; prior unchanged TS6/TS7/frontend/83 Rust proof remains scoped there.

Installed package fixes Windows/MSIX ownership drift; transaction 251eca45-61c9-45b0-a53e-b8d8034c5b40, alignment=aligned, pending=false. Legacy active paths remain absent; unrelated client settings preserved.

LIVE_BLOCKBENCH transport/catalog now verified through this actual chat's mcp__lazydesigner tools. Initial ECONNREFUSED coincided with Blockbench closed. Reopening the same approved profile restored Runtime without another trust action; the same client Gateway recovered through discovery. Status: connection=ready, mcp_client_ready=true, catalog_stale=false, catalog_count=47, Control=READY. Build sha256:7086721b70c6e47db0bde7473b2038318e28f590959b8b4db42f7557a01de6b5 matches the installed package. Desktop's managed projection independently reports aligned, Gateway active, Runtime online, pending=false. One offline-to-online cycle is accepted; repeated fault recovery, model operations and UI quality are not. Receipts: ignored .cache/current-codex-live-proof.json and current-codex-managed-status.json. Earlier temporary-client proof remains in canonical-path-*.json/log.

Recovery: machine-local Codex tmp/lazydesigner-legacy-retirement-2026-10-26-43c676139dad498bb56c019b824e095c; original config/plugin, process receipt and hash inventory of 261 retired files. Hidden content required a separate, hash-verified Directory.Move. Receipt/status: ignored .cache/legacy-retirement*.json. App/Blockbench were subsequently launched for the bounded read-only acceptance above. No UI layout or asset mutation was accepted.

## Desktop readiness assessment — 2026-10-26

Verdict: source/package and live connectivity qualified; complete App readiness remains unaccepted. Process launch is observed; Windows UI layout is not accepted.

| App area | Evidence and remaining acceptance |
| --- | --- |
| Setup, update and recovery | Manager owns transactions, exact package alignment, compatibility and rollback; migration is installed and aligned. Actual Desktop restart/resume, failure recovery and activated rollback remain unverified. |
| Status and action clarity | Nine development fixtures omit staged bootstrap, alignment drift and Desktop-update-required states; ready fixtures omit alignment. This is a coverage gap; stale-state maintenance guards exist. |
| Routine model work | Open/Open Model are independent of AI setup. LAUNCHED does not verify the correct tab; native dialog, cancellation and file/profile selection need disposable acceptance. |
| Project data safety | Source uses reviewed identity/token checks and Windows Recycle Bin; no permanent-delete fallback. Actual recycle, cancellation/failure and restoration are NOT EXECUTED. Do not accept the destructive UI path from source tests alone. |
| UI and accessibility | Historical 1280x720 synthetic frontend evidence exists; it predates the alignment changes. Current Workspace/Support states, narrow layout, keyboard/focus and error recovery need renewed presentation inspection followed by Windows/Tauri checks. |
| Supported delivery | Desktop installer identity is verified. Automatic Desktop self-update and portable wrappers are unsupported; component update does not upgrade Desktop. |

App fixtures/layout and disposable editor/project flows remain unaccepted. Native reconnect/reload recovery and Recycle Bin are separate tasks; passing counts do not establish release readiness.

## Current proof matrix

| Surface | Current evidence / boundary |
| --- | --- |
| Working source | 61102493 prior routing PASS; bounded impact fix/regressions NOT EXECUTED; not deployed |
| Installed source | Exact 7b45bd69 full gate PASS; Desktop checks scoped above |
| Installed Desktop/package | Desktop 0.1.1/contract 1; managed 7b45bd69; compiled installed stdio PASS |
| Migration | INSTALLED/aligned; legacy active paths absent; unrelated settings preserved |
| Runtime transport/catalog | Actual Codex chat: matching build, fresh 47-capability catalog, Control READY; one offline-to-online recovery PASS |
| Native UI / data operations | NOT EXECUTED for this candidate; no product-ready acceptance |

Earlier candidate evidence remains in Git/history logs. Canonical docs:check passed during qualification; generated output remains generator-owned.

## Current source-only authoring boundaries

The 23–24 October source protections remain scoped to regressions, not blanket native approval. Git owns their detailed history.

- Geometry: transform/ancestry identity, Box UV/duplicates and OBB correction source exist; numeric evidence is not silhouette PASS; LD-Q04 sampling remains blocked.
- UV/painted atlas: manage_uv_layout and migration helpers remain unregistered. Empty static bitmap guards remain; installed Undo/save-reopen/Golden acceptance is missing.
- Texture: six-slot Cube census and scoped seam sampling do not certify all face pixels, Mesh, variants/PBR or visual quality. Preserve enabled_face_count = sampled_face_count + unexamined_enabled_face_count; missing/disabled faces remain unsampled. Alpha/rotation/material/revision safeguards remain source-only evidence.
- Animation numeric recovery is not playback acceptance. The B0-A trace separates registered routes from unregistered UV.

## Historical source and frontend evidence

`d334106e`: historical 1280x720 mockIPC UI proof only; native/narrow/Recycle Bin/save-reopen NOT EXECUTED.

## Dependency/security boundaries

Prior toolchain/dependency evidence: Bun 1.4.3, TS7.0.2/TS6.0.3, Node typings 24.19.2, Blockbench typings 5.2.1/Electron typing-only 43.8.1, Cargo.lock 436 packages. Historical Bun high-severity PASS/npm audit zero; no new audit here.

Bun full audit retains low GHSA-5j4c-8p2g-v4jx through Blockbench's exact Vue 2.7.14 typing dependency; no compatible upstream fix established. Full Cargo audit retains proc-macro-error 1.0.4 (RUSTSEC-2024-0370, unmaintained) and glib 0.18.5 (RUSTSEC-2024-0429, unsound), both absent from the locked Windows x64 graph. No advisory ignores or Linux native safety claim. Direct crate licenses remain MIT/Apache-compatible; the pre-existing missing published license field for Blockbench typings remains unresolved. These findings are historical, not a fresh advisory database scan.

## Current source contracts

The persistent Gateway owns client stability/recovery; Control (`mcp/gateway/control/`) owns context/readiness; development planning stays under `mcp/gateway/development/`. The retired Navigator source remains removed. Four public tools remain status, search_capabilities, describe_capability and invoke_capability. Unknown mutations are not replayed. Geometry/Texturing share AUTHORING; Animation handoff is explicit. Generated API/schema/prompt files stay generator-owned. No liveValidatedBuilds entry is promoted by compilation or benchmarking.

## Last reusable proven source baseline

`51324f6da133cb728d0cda27f6b1a3358452161d`: historical full MCP, Desktop checks (80 Rust tests), integrated managed NSIS and disposable compiled-CLI install/status smoke PASS; details at `ce5299aa`. [Windows native report](native-acceptance.md#consolidated-windows-local-test-report--2026-10-14) scopes installed evidence to its named older builds.

LD-Q01–Q04, particle visibility, saved-model/reference fidelity, Golden F and real cost telemetry remain open. Do not strengthen source/static claims into local/live/visual claims without matching evidence from the exact current source SHA. A docs-only head may use Head Proof to show executable source did not change; it is not execution proof. Source-impacting heads continue to require matching checks. Native Undo/Redo, save/reopen, playback, reconnect, installer UI/update/rollback and visual acceptance were not executed here.

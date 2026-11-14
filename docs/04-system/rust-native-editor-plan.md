# Rust-native LazyDesigner — Architecture and Acceptance Contract

**Status:** APPROVED PRODUCT DIRECTION; PHASE 0 CONTRACT + PHASE 1 RUST CORE + INITIAL PHASE 2 EDIT UI SOURCE_AUTHORED / NOT_EXECUTED. The complete editor and Paint/Animate parity remain NOT_IMPLEMENTED.
**Selected development branch:** `Rust`, created from `Local@2fb3b2f2a9f37649c927886122e9442d9f84b7c7`. The source integration parent for this plan is the branch-local profile commit `2260734f01a5803f6679aefb5f6bdf265cdba264`.
**Upstream UI and file-format reference:** `JannisX11/blockbench@e2ede0809ee6bc91f374ac7e00d34cffbdf86a14` (tag `v5.2.1`, Default Dark).
**Product:** Minecraft Bedrock Entity visual assets, not a general Blockbench clone or gameplay/add-on pack generator.

This file owns the **Rust-branch target architecture, transition gates and acceptance matrix**, not the currently installed application. Product outcome and human interaction remain owned by [requirements](../01-product/requirements.md) and [interface UX](../01-product/interface-ux.md); existing source ownership remains mapped by [implementation-map.md](implementation-map.md), and [next-action.md](../05-operations/next-action.md) owns active continuation. Never treat this design as built, tested, installed or accepted.

## 1. Approved outcome and explicit non-goals

The user must be able to work in LazyDesigner as though they are working in the **pinned Blockbench UI**, including the supported Edit, Paint and Animate workflows, while the authoritative model engine is independent **Rust**. A completed editable `.bbmodel` from LazyDesigner must open, remain editable and preserve supported asset data in actual Blockbench. Reverse imports from Blockbench must also work. The visible editor must not require Blockbench as its execution host.

| Locked product decision | Required behavior |
| --- | --- |
| Human experience | 1:1 visual and behavioral parity with the pinned Blockbench 5.2.1 Default Dark baseline for the supported Bedrock Entity workflows; exceptions require explicit user approval. |
| Engine | Single Rust-owned authoring document, validation, history, transaction and persistence authority. No second JS, MCP or CLI asset engine. |
| Presentation | Svelte 5 + Tauri 2 for UI and IPC; Three.js for read-only 3D projection and transient input preview. |
| AI access | Headless first-party Rust CLI for deterministic operations; MCP optional and routed through the same Rust commands. |
| Data interchange | Bidirectional editable `.bbmodel` import/export as a release-blocking acceptance gate, plus required Bedrock visual-asset exports. |
| Migration | Incremental, source-first, preserve existing Blockbench Runtime/Gateway, product Skills, assets and user workflows on `Local` while `Rust` is developed. |
| Quality/cost | Measure cost per accepted asset and human correction count; never assert token, speed, visual or functional improvement from source alone. |

Non-goals: reproducing every unrelated Blockbench plugin, every model format, a Java Minecraft world builder, Bedrock gameplay packs, cloud-hosted inference, a duplicate scene database, new agent Skills, a parallel MCP control plane, or changing the user's selected Low Thinking configuration. Do not port the old Windows native-window composition into the new independent editor as its rendering strategy.

## 2. Grounded baseline and ownership conflict resolution

**Observed source, not execution:**

- `apps/desktop/` is currently Tauri/Svelte/Rust machine management and a development-only native Blockbench window reservation; `NativeEditorStage.svelte` is not a self-hosted model viewport.
- `mcp/server/tools/` owns the existing native Blockbench authoring executors; `mcp/gateway/` and Control own discovery, routing, context and recovery; current first-party CLI planning/analysis commands are read-only for model data.
- The existing `docs/01-product/ui-design-standard.md` explicitly forbids a simulated/reimplemented editor on the legacy companion. That prohibition remains valid for the `Local` runtime, **not for the user-approved Rust-native target**. On `Rust` this document's target UI contract supersedes only that legacy companion-center/layout assumption; it does not relax security, quality, accessibility, project ownership or native proof gates.
- The existing 12 LazyDesigner domain Skills and their semantic quality requirements remain preserved. Reuse their modelling, UV, texture and animation knowledge by bounded interfaces rather than making a competing new Skill system.
- The independent Rust-first pattern in related internal research is architectural comparison only. Do not copy another project's private code, identity or data into this public repository.

Primary upstream comparison owners at the pinned Blockbench revision: `themes/dark.bbtheme`, `css/window.css`, `css/panels.css`, `js/interface/panels.ts`, `js/formats/bbmodel.js` and associated mode/menu/toolbar/animation source. These are **reference data**. A review of GPL-3.0-or-later obligations, compatibility with LazyDesigner's GPL-3.0-only source and rights to individual icons/fonts/brands/assets is mandatory **before copying protected implementation or resources**. A visually equivalent independently implemented UI is not proof of a legal right to use upstream branding.

## 3. Single-authority runtime contract

~~~text
Human Svelte actions     Headless CLI operations     Optional MCP requests
          |                       |                         |
       Tauri IPC           Rust CLI parser             MCP adapter
          \_______________________|_________________________/
                                  |
                Rust CommandEngine: validate + revision guard
                                  |
              AuthoringDocument + atomic transaction + history
                                  |
                mutation receipt / bounded changed entities
                  |                               |
         read-only Three.js scene           format adapters
         transient drag/paint preview       .bbmodel / Bedrock
~~~

**Domain authority:**

- `AuthoringDocument` owns stable object UUIDs, groups/bone hierarchy, cubes and supported mesh semantics, pivots, transforms, UV faces, texture/bitmap references, animation tracks, keyframes, material intent, relevant asset metadata and document revision.
- `CommandEngine` admits typed operations with bounded input, valid object identity, expected revision, atomic validation/apply, reversible history and deterministic failure receipts. No unknown destructive target may silently select an object.
- Rust owns durable file writes, project locking, recovery, data migrations, path sandboxing and content identity. A failed/uncertain write must not be blindly replayed; preserve and inspect state before retry.
- Svelte owns menus, panel layout, active UI tool, focus, selection presentation and transient interaction preview. Three.js builds GPU geometry from revision-tagged Rust snapshots; GPU meshes, render caches and local component state do not become canonical model data.
- Painting may stage a bounded transient GPU/bitmap preview to preserve responsive strokes, but committed pixel patches, texture revision/Undo and save decisions remain Rust-owned. Animation playback evaluates derived track snapshots for display; Rust owns authored keyframe data and export validation.
- The Rust library must be callable without Tauri/WebView and without an installed Blockbench process. Both Tauri commands and the headless CLI use the identical library API, errors, revision policy and codec.
- Use the existing Cargo/desktop ownership; introduce a reusable library boundary only when required by the actual Tauri + headless consumers. Directory names and crate split are implementation decisions under source impact review, not extra Phase 0 root scaffolding.

**Interaction acceptance:** the same semantic action through UI and CLI yields equivalent document data, revision advancement, undo/redo behavior and refusal on stale input. The renderer must never write model data directly.

## 4. Blockbench interoperability — mandatory, bidirectional

The `.bbmodel` codec is a **version-aware adapter**, not the internal document schema. The initial target is a **Bedrock Entity project generated/opened by pinned Blockbench v5.2.1**, whose `js/formats/bbmodel.js` declares format version `5.0`. Upstream separates `groups` from `outliner`; it also serializes model elements, textures and animations. Support must be derived from the actual format and editor format capabilities, not guessed from a generic JSON shape.

| Compatibility family | Minimum loss-prevention requirement |
| --- | --- |
| Identity and hierarchy | Preserve UUIDs, outliner order, groups/bones, parent/child bindings, visibility/locking where supported, pivots and model metadata. |
| Geometry | Preserve supported cubes, faces, face UVs, transforms, rotations, shading/visibility flags and known element extensions. Unsupported geometry must not be silently converted into cubes. |
| UV and textures | Preserve box/per-face UV semantics, atlas dimensions, texture references and embedded/external PNG bytes under explicit path policy; do not lose UV orientation, transparency or unsupported texture-layer data silently. |
| Animation | Preserve supported clips, looping, animator/bone target identities, channels, keyframe times, values, interpolation/expressions and supported effects/controller metadata. Declare partial/unknown support rather than inventing fallback motion. |
| Format identity | Match project `model_format`, declared `format_version`, coordinate convention, scale, default settings and deterministic field mappings for the pinned profile. |
| Unknown fields | Preserve opaque, safe unknown data whenever it can be faithfully round-tripped without semantic conflict; otherwise reject lossy overwrite/export with a precise supported/unsupported-field report. |

**Two required paths:**

1. `Blockbench v5.2.1 → LazyDesigner Rust → Blockbench v5.2.1`. Import a representative editable project, perform a supported change, save/export, reopen in Blockbench, inspect the hierarchy/UV/texture/animation invariants and verify the model remains editable.
2. `LazyDesigner Rust → Blockbench v5.2.1 → LazyDesigner Rust`. Create the same supported asset natively, export it, edit/save it in Blockbench, reimport, and compare the supported semantic state and visual rendering.

Comparison is **semantic**, not byte-for-byte JSON formatting. For each supported family, record `PASS | FAIL | UNVERIFIED` with exact file/build/revision provenance. Never mark a category PASS from parse success, a source fixture or a screenshot alone. Preserve the original file until atomic replacement is confirmed; opening a newer or unknown version must fail closed or be explicitly read-only if loss-free editing cannot be assured. Do not require a proprietary sidecar or a second canonical file to open an ordinary supported `.bbmodel`.

Bedrock geometry, animation and texture PNG exports are separate outputs with their own validity checks; `.bbmodel` interoperability must not be confused with gameplay/add-on packaging.

## 5. Blockbench 1:1 UI/interaction parity matrix

The requested parity applies **within the supported Bedrock Entity workflows**, not every unrelated Blockbench plugin/format. Compare a running Blockbench v5.2.1 reference and the actual Svelte/Tauri app under identical window pixels, DPI scale, Default Dark theme, mode, panel layout, sample model, camera and input conditions. The HTML/Svelte source preview is not a native screenshot or runtime proof.

| Area | Observable acceptance |
| --- | --- |
| Window shell | Menu bar, project tabs, toolbars, status bar, tool grouping, labels, icons, active/hover/disabled/focus and pixel-aligned layout match the pinned reference. |
| Panel management | Left/right/top/bottom/floating/hidden positions, attached/stacked tabs, panel reorder, drag/drop, split resizing, mode-specific positions and persistence follow reference interactions. |
| Edit workspace | Outliner, hierarchy selection/reparenting, properties, creation/deletion, transform modes, pivot operations, shortcuts, context menus, camera movement and gizmos behave like the reference. |
| 3D viewport | Orbit/pan/zoom, projections, grid, selection, hover, shading, textures, transparency, render updates, input capture and loss/recovery of focus match reference expectations. |
| Paint workspace | UV editor placement, texture/atlas list, paint tools, brush response, palette, supported layers, pixel transparency, selection and texture Undo/Redo remain editable. |
| Animate workspace | Timeline layout, animation list, keyframe selection/edit, playback, interpolation, bone transforms, mode transitions and supported controller/effect representations remain editable. |
| Cross-mode behavior | Mode/tool switching preserves project state, Undo history, selection where applicable, panel preferences, unsaved state and keyboard focus without duplicate state owners. |
| Resize/accessibility | Dock bounds, minimum viewport area, keyboard traversal, tooltips, shortcut discoverability, accessible labels and high-DPI rendering do not regress. |

**Parity gate:** retain a per-view reference screenshot, a matching actual application capture, measured geometry/image differences and a real input-action outcome for each relevant row. An area remains `UNVERIFIED` until both visual and behavioral evidence exist. Unsupported behavior must be explicitly tracked and cannot be labeled 1:1. No substitute dashboard, extra AI panel or CLI status chrome may change the default editor composition. Review all actual upstream UI assets and GPL/brand boundaries before copying them.

The existing legacy green/blue companion desktop token arrangement and icon registry describe the *Blockbench-hosted companion*; they are not automatic visual authority for the Rust-native editor. For the Rust branch the pinned **actual Default Dark editor** is the design reference, with independently authored components or reviewed licensed reuse.

## 6. CLI/MCP and measured efficiency

The CLI is a real **mutating and read-only authoring interface**, not only a report wrapper:

- `inspect` returns bounded, focused project and selected-object state; `edit` accepts one validated batch/recipe; `export` emits explicit versioned artifacts; `undo/redo` and save/reopen use Rust document/revision semantics.
- Use a stable schema, machine-readable JSON, exact project identity/revision, no implicit mutable selection for destructive actions, structured errors and compact result deltas. Commands must work headlessly without a Blockbench process, a WebView or an MCP network session.
- MCP remains optional for clients that require it. During transition retain the existing four public Gateway tools and Blockbench Runtime path unchanged until a source-reviewed compatibility/adaptation decision is implemented. Avoid a second persistent router, server or document registry.
- AI should submit a coherent bounded assembly transaction rather than one Cube/tool call per primitive when the semantics permit. Do not hide a real quality decision or omit needed visual evidence to reduce cost.
- Reuse existing relevant context routing, source-bound authoring intelligence and first-party CLI quality diagnostics; `CLI-Anything` vendored reference is **not** an automatically installed Skill or engine.
- Measure **cost per user-accepted asset**, real model token telemetry, number of calls, retries, correction cycles and end-to-end latency with equivalent reference/asset tasks and the fixed user-selected Low Thinking configuration. Separately measure viewport frames and input latency under matching native conditions. No unmeasured saving or speedup claims.

## 7. Development phases and falsifiable gates

| Stage | Work | Minimum exit/stop proof |
| --- | --- | --- |
| Phase 0 — contract (current) | Branch authority, precise target/legacy separation, compatibility policy, parity matrix, migration boundaries and measured acceptance plan. | One source-coherent target spec and current status; no build/visual PASS claimed. |
| Phase 1 — headless Rust slice | Canonical document; cube/group/pivot/UV/texture references; revision-checked command, Undo/Redo, file I/O; initial `.bbmodel` codec; headless CLI. | A representative synthetic Bedrock Entity can be imported, changed, exported/reopened without Blockbench as engine; tests authored in source, execution separately authorized. |
| Phase 2 — Svelte Edit editor | Build the pinned UI shell and Three.js viewport with real editing, panels, modes and input routing against Rust document snapshots. | Edit actions have real handlers and one Rust semantic owner; UI parity remains unverified until actual native comparison. |
| Phase 3 — Paint and textures | Editable UV, atlas, painting, relevant layers and texture export; preserve texture intelligence and visual review. | Native and Blockbench round-trip texture/UV behavior on representative assets when authorized. |
| Phase 4 — Animate and effects | Keyframes, playback, rigging, relevant controllers/effect cues and supported export. | Native replay/round-trip and visual user acceptance of supported animated assets when authorized. |
| Phase 5 — cutover gate | Integrated visual/behavioral 1:1 review; format and render equivalence; measured AI use, Windows distribution, recovery and safety. | Only after matched native/local evidence and user approval may the old required Blockbench Runtime be retired or a release/promotion be proposed. |

The first source implementation must demonstrate a complete **vertical slice**, not isolated GUI mockups or independent geometry planners. Create no new agent Skills, hidden test runners, provider stack, release channel, CI workflow, benchmark system or separate repository as a prerequisite.

## 8. Migration boundaries, proof and open risks

- Current `Local` Blockbench product remains operational and is not automatically replaced, merged or promoted; `Rust` contains the new target. No cross-repository writes. `main` remains stable.
- Keep `AGENTS.md` and `GITHUB_RULES.md` byte-identical shared roots. `Rust` branch profile owns permitted ref; existing 12 project Skills and applicable nested rules remain in place. A later native runtime migration may explicitly adapt domain policies/Skills **without deleting their knowledge**.
- Old `NativeEditorStage.svelte`, `blockbench_surface.rs`, Gateway/native plugin implementation, managed installation and their source regressions stay in source until tested functional replacements and safe rollback exist; do not immediately delete them or make the old native host a new mandatory dependency.
- Treat source artifacts, authored-but-not-executed tests, rendered application captures, actual Blockbench reopen/playback, user visual acceptance and released installer validation as **different evidence classes**.
- Under the active policy, CI, cloud substitute validation, incremental Codex/local/native tests and releases remain on hold; source-only review is the proof ceiling. The later one-shot PC-local validation phase needs a separate user-selected transition.
- Significant risks: format-version drift and unknown fields; advanced Paint/Animate parity; GPU/pixel and animation timing correctness; license/branding rights; Windows high-DPI/focus; native performance under large scenes; AI cost without changed quality. The corresponding gates above remain open until the actual evidence exists.

**Phase 2 first docking slice (2026-11-14):** The `Rust` editor now has an explicit, UI-only panel placement owner (`src/rustDockLayout.ts`). It supports bounded left/right swapping of Textures and Outliner/Properties, pointer/keyboard resizing of both dock widths and their vertical separator, fold/restore rails, reset, and versioned preference persistence. The layout is measured against a 320px minimum viewport at the current desktop window's supported widths; no asset model or Rust revision is stored. This is **SOURCE_AUTHORED / TEST_AUTHORED_NOT_RUN**, not a claim of visually equivalent or natively executed Blockbench panel behavior. **Additional source-authored docking increment (2026-11-14):** The same Textures and Outliner/Properties panel snippets can now be presented in bounded, resizable **in-window floating** surfaces or in left/right docks without a second panel instance. A floating title supports pointer and keyboard movement, explicit docking controls, and pointer-drop reattachment to the editor's left/right edge. The validated `v2` UI layout preference migrates earlier `v1` values without persisting authored data; geometry is clamped to the current editor area. All of this remains SOURCE_ONLY / TEST_AUTHORED_NOT_RUN. True detached OS windows, top/bottom slots, attached tabs, unrestricted panel drag-and-drop, and native Blockbench-equivalent visuals and interaction are NOT_IMPLEMENTED/UNVERIFIED.

**Phase 2 selected-Cube Move gizmo extension (2026-11-14):** The Rust-branch viewport now has a pinned `TransformControls` translation manipulator for the selected Cube. Its start/end **parent-local** positions produce one bounded `translate_cube` request on release; Rust validates identity/revision, mutates the sole document and owns Undo. The viewport temporarily moves a derived mesh and restores it from the Rust snapshot on refusal; orbit is suspended while dragging. This is SOURCE_AUTHORED, TEST_AUTHORED_NOT_RUN, not a 1:1 native interaction pass. Rotation, Scale, bone gizmos and docking remain separate unimplemented behavior.

**Phase 2 initial Edit integration (2026-11-14):** The `Rust` entrypoint now mounts an independently implemented Svelte Edit-mode workspace; Tauri uses the single authoritative Rust `EditorSession` and shared project I/O for File/New/Open/Save Copy, Add Cube, Move/Resize/UV, Undo/Redo and a read-only untextured Three.js preview. Paint/Animate are visibly disabled. No native render, build, Blockbench import/export or 1:1 UI comparison was performed; all remain UNVERIFIED. The old Runtime remains preserved.

**Phase 1 headless source slice (2026-11-14):** A typed `AuthoringDocument` and `EditorSession`, versioned `BlockbenchV5` wire adapter, cube/bone/face-UV batch engine, SHA-guarded `new/inspect/apply` CLI and original synthetic fixture were authored in `apps/desktop/src-tauri/`. [The exact source owner and future commands](../../apps/desktop/src-tauri/src/authoring/README.md) describe the bounded format-5.0 geometry slice. Texture, animation and controller payloads are preserved opaquely; native editing/painting/playback and Blockbench compatibility are NOT proven. Do not treat Phase 1 as a complete editor or replace the legacy Runtime.

**Phase 0 decision:** source baseline and target are approved; remaining GUI/runtime implementation, actual Cargo/CLI execution, editable Blockbench round-trips, UI parity and efficiency gains are `NOT_EXECUTED / UNVERIFIED`.

**Next acceptance boundary:** preserve the current source proof ceiling: evaluate the next concrete unsupported Edit behavior or compatibility issue against the actual caller/renderer/Rust API, while leaving Cargo/Windows/Blockbench validation held. Do not claim the existing Move preview is equivalent to Blockbench 5.2.1 until matched native mouse, keyboard, focus and file round-trip evidence exists.

# Publication Render — Research and implementation proposal

Status: RESEARCH / DESIGN ONLY — **no runtime renderer or export feature has been implemented or tested**.
Branch: `Render`; fork point: `Local@85cb9889435a1c72893a9020f9ac4b73608a8ca9`.
Date: 2026-11-03.

## Goal and boundary

Produce presentation-quality image assets **after model authoring**, from the actual Blockbench project: hero PNGs, transparent cutouts, orthographic/model sheets, and later optional animation/action poses. This is **publication**, not reference-conformance QA. Beauty renders may deliberately alter artistic lighting and backdrop but must not be used as geometric/texture quality evidence or Minecraft-runtime proof.

**Required separation:** Keep `capture_model_views` and its native dependency/approval semantics unchanged. No modification to `Local` or `main`. Do not use a marketing image to claim an approved model/animation or a native QA PASS.

## Current repository facts (read at fork SHA)

- `mcp/server/tools/inspection/camera.ts` owns canonical `capture_model_views`: selected offscreen `Screencam.NoAAPreview`, deterministic framing, same-response PNG compaction and dependency freshness. This is evidence capture, not art-directed studio rendering.
- `mcp/lib/blockbench/capture.ts` is a simple viewport screenshot helper, not a renderer.
- `mcp/lib/geometry/renderedModelBounds.ts` provides transformed model bounds. Reuse its read-only computation where applicable rather than inventing a second model-axis authority.
- `mcp/server/tools/io/export.ts` implements `.bbmodel` and Bedrock codec delivery. It does **not** expose a publication-image codec.
- `mcp/server/runtime/registration.ts` registers the camera/export families; `mcp/lib/capabilities/manifest.ts` declares capability metadata; `mcp/gateway/capabilities/manifest.ts` owns discovery semantics. The AI client must retain exactly four public Gateway methods.
- `mcp/ui/index.ts` and `mcp/plugin/blockbenchIntegration.ts` own the existing human-facing plugin integration; there is no standalone publication renderer.
- `docs/03-authoring/finalization/standard.md` separates stage approval, saved `.bbmodel` identity, requested exports and visual proof. A publication PNG must bind to a known source revision if labeled FINAL, not confer approval on that revision.

## Upstream systems reviewed

| System / source | Why it matters | Limitations / decision |
| --- | --- | --- |
| [Blockbench: Rendering Models](https://www.blockbench.net/wiki/guides/model-rendering/) | Official GLTF→Blender/Light Tracer/Sketchfab overview. Blender is a full lighting/ray-tracing alternative. | External program adds installation/runtime/format boundaries. |
| [Shapescape Render Model](https://github.com/ShapescapeMC/Blockbench-Plugins/tree/main/plugins/render_model) + [usage](https://blockbench-plugins.readthedocs.io/en/latest/render_model/usage.html) | Batch PNG angles, isometric sheets, GIF turntable, animation samples; offscreen native capture, auto frame and multiple resolutions. | Primarily presentation capture, not cinematic lighting. Requires desktop Blockbench 5+ for disk writes. GPL-3.0; do not copy without license compliance. |
| [Lightflow for Blockbench](https://github.com/MidFord/lightflow-blockbench) + [Studio Render](https://github.com/MidFord/lightflow-blockbench/blob/main/studio_render.js) | Rich studio ecosystem: key/fill/rim lighting, soft shadows, material/shader editing, environment, atmosphere, HDR/grade/bloom, tiled supersampled PNGs, transparent backgrounds, camera presets. Apache-2.0. | Development `main` remains explicitly unstable. Do **not** assume a supported programmatic extension contract or require installation; test source and live GPU behavior before adapter work. |
| [Lightflow status (2026-10-18)](https://github.com/MidFord/lightflow-blockbench/blob/main/docs/DEVELOPMENT_STATUS.md) | Stable preview is a pre-release; `main` targets later RC. | No production-ready guarantee; different module versions/dependencies. |
| [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) | Bundled in Blockbench; offscreen rendering, color space, shadow maps, tone mapping, and configurable output resolution. | Texture/material conversion, GPU limits and native scene isolation need live verification. |
| [Blender background rendering](https://docs.blender.org/api/current/info_tips_and_tricks.html) + [Blockbench export formats](https://www.blockbench.net/wiki/guides/export-formats/) | Optional automated high-quality render of glTF/GLB via Python/Eevee/Cycles, physical lights, shadows and compositor. | Extra binary, export fidelity, permission/process security; never required for base workflow. |
| [Blender Image Texture interpolation](https://docs.blender.org/manual/en/3.3/render/shader_nodes/textures/image.html) | `Closest`/nearest-neighbor preserves crisp Minecraft pixel-art edges. | Correct alpha and emission require per-material verification. |

These are **references**, not vendored dependencies. No third-party code was copied into LazyDesigner.

## Engineering decision

Build a **native, optional Studio Publication pipeline first**, with an opt-in Blender high-fidelity backend considered only after a demonstrated need. Benchmark Lightflow and Shapescape against our native implementation rather than installing an experimental plugin as a mandatory dependency.

- Native dependency baseline: existing Blockbench Three.js/canvas and project textures/meshes, no external online service, no new GPU engine/framework.
- Publication scene should be **detached** from the authoring/QA scene where feasible: read transformed visible native geometry, keep textures/material semantics, add temporary presentation-only lights, floor/shadow receiver, background and camera. Any unsupported/ambiguous material or pose semantics must fail explicitly or be marked visually unverified — never silently recolor.
- Reuse existing model/camera orientation contracts and single-source native dependencies; do not reuse QA PNGs as publication results, weaken QA or duplicate its validation.
- One native render service shared by **Plugin UI** and **MCP Runtime capability**. Gateway exposes it through existing `invoke_capability` (never a fifth top-level client tool). Studio settings are presentation-specific; **do not reuse `render_profile`**, which means Bedrock entity material behavior elsewhere in this repository.
- Favor a bounded single render request with direct save and short artifact receipt, not transfer of every full-resolution PNG into the LLM context.

### Proposed user experience

After current-revision finalization or an explicitly labeled draft:
1. Open **LazyDesigner → Render** (or invoke known `export_publication_render` capability).
2. Select a preset and camera, then preview at low resolution. Presets: `clean_studio`, `dark_cinematic`, `marketplace_card`, `transparent_cutout`.
3. Adjust **Key / Fill / Rim**, shadow softness, background, exposure, crop/negative space and optionally label/brand layout. Preserve pixel-art texture sampling; no automatic smoothing or changes to source textures.
4. Choose output (PNG 1:1, 4:5 or 16:9; recommended 2048px long side, optional 4096 on supported GPU). Save high-quality PNG without altering the model.
5. Optionally render 3 fixed hero angles, multi-view sheet, and separate posed frame(s) from actual animation time once native pose preservation is proven.
6. Receive output paths, dimensions, image hashes, source revision identity, preset/camera settings, and honest verification state. Optional small preview for AI inspection, not automatic full-size image delivery.

**Default output = individual PNG files**, not a ZIP, uploaded screenshot or external/cloud render. Do not overwrite existing paths without explicit authorization.

### Illustrative capability contract — not implemented

```ts
export_publication_render({
  preset: "clean_studio" | "dark_cinematic" | "marketplace_card" | "transparent_cutout",
  view: "front_3_4" | "back_3_4" | "front" | "side" | "custom",
  width: 2048, height: 2048,
  background: { mode: "transparent" | "solid" | "gradient", /* bounded colors */ },
  output: { mode: "preview" | "save", path?: /* authorized absolute path */ },
  include_small_mcp_preview: false
}) -> {
  project_uuid, source_checkpoint_sha256_or_null, publication_status,
  output: { path_or_null, image_sha256, width, height, png_bytes },
  pose_metadata, render_settings, source_revision_state,
  viewport_untouched, model_state_untouched, warnings
}
```

No `FINAL` label without a verified matching saved source revision; allow `DRAFT` images explicitly. Do not mistake successful filesystem write or source hash for a visual quality PASS.

### Suggested exact owners after research is accepted

1. `mcp/lib/publication/`: pure presets, bounded parameter policy and camera composition math.
2. `mcp/server/publication/`: native render engine and immutable capture transaction; material/pose compatibility diagnostics.
3. `mcp/server/tools/inspection/publication.ts`: small tool schema and executor registration in **existing camera family**. Retain `inspection/camera.ts` as QA owner.
4. `mcp/ui/publicationRenderDialog.ts` + small existing `mcp/ui/index.ts` integration: human trigger to the **same** native service under the current exclusive runtime operation queue.
5. `mcp/lib/capabilities/manifest.ts` + `mcp/gateway/capabilities/manifest.ts`: explicit discovery, stage/core classification, operation/export effect and heavy execution metadata. Register without changing public Gateway shape; update actual surface tests and only generator-owned artifacts via the canonical generator.
6. `mcp/tests/publication-render*.test.ts` + a real disposable Bedrock fixture for runtime/GPU visual acceptance.

This is a design map, **not permission to bypass native plugin permissions or finalization gates**. Avoid adding new Gateway commands, independent state databases, or broad modifications to QA.

## Minimum first implementation slice (MVP)

- One `clean_studio` PNG preset with orthographic 3/4 camera, automatically framed from current rendered model bounds.
- Isolated background and key/fill/rim; camera and project state unchanged; exact original textures/UV, supported transparency, nearest-neighbor sampling.
- Bounded resolution preview (e.g. 512) and exported PNG (e.g. 2048); resource/GPU guardrails, fresh project identity before/after, path safety and write integrity.
- Both UI button and one MCP capability use **one implementation**; show save path and a small preview where requested.
- Source and contract tests designed before claiming native rendering success. No animation pose iteration, multi-image sheets, or optional Blender until baseline native fidelity is demonstrated.

## Acceptance and negative tests (must be executed before saying production-ready)

- Correct identity: real Bedrock Cube UV/rotations/parent groups, player-size scaling, pixel edges, alpha clip/blend, transparent PNG background, emissive/material distinctions and no missing textures.
- Exact UI/MCP equivalence: same project+settings produce comparable output, with deterministic camera and file metadata (byte equality not assumed across GPU drivers).
- State isolation: original Blockbench camera, lights, selection, pose, Undo stack, project save identity and QA capture dependency behavior unchanged after success **and exceptions**.
- Failure cases: no project, no visible geometry, invalid size/color/camera, oversized output, GPU/context loss, project switch during render, stale source, unsupported texture/pose, filename collision, denied filesystem permission, readback mismatch, timeout.
- Output: PNG signature and dimensions, alpha/background behavior, expected aspect ratio, no cut-off silhouette, explicit image SHA-256, no misleading visual PASS.
- Real visual rubric: 3 fixture classes (humanoid/mob, tall/mechanical asset, translucent/emissive asset), three camera angles, readability at thumbnail, key/fill/rim balance, shadows, texture sharpness and comparable result vs Shapescape/Lightflow/Blender.
- Performance: cold/warm render duration, GPU memory, successful PNG bytes, number of full-res images sent to MCP, **cost per accepted image** and failure rate. No arbitrary claimed percent savings.

## Delivery/proof gate

At this commit, the **research and exact-source audit** is complete; implementation/test/build/native GPU evaluation is **NOT EXECUTED**. GitHub-only proof can validate authored source/contract later; it cannot certify beautiful pixels or Blockbench lifecycle. Local/manual rendering and any Blender optional backend remain separate proof domains. Never silently merge into `Local` or `main`.

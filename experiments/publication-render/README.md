# High-Fidelity Publication Renderer — Technical Research and Architecture Decision

**Date:** 2026-11-03  
**Branch:** Render (initial fork: Local at 85cb9889435a1c72893a9020f9ac4b73608a8ca9)  
**State:** **RENDER CROSS-APP MCP ADAPTER SOURCE-AUTHORED** on `Render` — **BUN/TYPECHECK/BUILD/BLENDER/NATIVE VISUAL ACCEPTANCE NOT EXECUTED**. Earlier single-application architecture statements below are historical; the explicit current boundary is [BLENDER_MCP_CONTROL.md](./BLENDER_MCP_CONTROL.md).  
**Source authority:** This is a branch-isolated research document. Do not merge into Local/main, touch QA capture, change workflows, or publish without an independent explicit request.

## Current Blender MCP control boundary

**[BLENDER_MCP_CONTROL.md](./BLENDER_MCP_CONTROL.md)** is the current integration contract for the two applications: one unchanged main MCP Gateway, an explicit Blockbench GLB `handoff` operation, and the Gateway-local `blender_render` controller (auto/start/status/preview/cancel/recover/release). The `auto` path now requests the native handoff with configured shared-host paths from one AI invocation; this is source-authored, NOT yet runtime-tested. It reuses the same trusted Blender worker and has its own job lifecycle, so the Blockbench session can close after handoff. No native/local tests have run and `Local` must remain untouched.

## Authoritative Object-to-Render Contract (ADR-R01)

Read **[OBJECT_TO_RENDER_CONTRACT.md](./OBJECT_TO_RENDER_CONTRACT.md)** before changing the Render implementation. It contains the exact native source boundary, pose/frame policy, Box UV and per-face material mapping, Group/world transform and chosen unit scale, frozen asset identity, GLB/Blender import checks, snapshot freshness, output semantics, resource limits, error codes and 18 acceptance scenarios.

**ADR-R01 P0 source implementation has now been extended, but native acceptance remains open.** The source now has an explicit Edit/static-frame fence, a fail-closed per-face material rule, 1/16 detached geometry scaling, Group ancestry/bounds manifest and binary GLB UV plus Blender world-bounds checks. Unresolved source/material coverage remains for nonempty Bedrock material slots and advanced alpha; numeric and texture parity require later live Blender/Blockbench evidence. Exact statuses are in ADR-R01 section “Implementation update”. Do not infer those have passed simply from an existing GLB or Cycles PNG.

This specification supersedes any earlier shorthand in this research README that calls the full renderer "complete" or assumes all materials/poses are covered. Native Bun/Blender/Blockbench tests were intentionally **not run**.

## Authoritative Camera & Lighting Director Contract (ADR-R03)

Read **[CAMERA_LIGHTING_SPEC.md](./CAMERA_LIGHTING_SPEC.md)** for the bounded geometry-driven camera algorithm and the source-bound studio light/ROI evidence. The Blender 5.2 Director now evaluates up to 15 projected-angle candidates without a separate beauty render, checks all source Cube bounds for the final camera and records exact camera-fit metadata.

Three area lights remain tied to the actual camera and model radius, with finite power/size bounds, actual RGB/distance/power provenance, and a measured luminance ROI extracted from the **same saved Cycles PNG**. The ROI is explicitly **not an object segmentation mask** and never drives an automatic artistic-quality PASS or silent exposure correction.

This is **source-authoring**, not successful native Blender rendering, professional-reference quality proof, or completed GPU performance measurements. The new Gateway-local Blender render capability is not a second MCP server or general-purpose 3D scene editor.

## Authoritative Material Translation Contract (ADR-R02)

Read **[MATERIAL_TRANSLATION_SPEC.md](./MATERIAL_TRANSLATION_SPEC.md)** for exact source PBR semantics and the GLB material assertions. The Render branch now has a pure channel/expectation owner (`mcp/lib/publication/materialContract.ts`) and uses it in the detached source snapshot and glTF preflight.

Supported source contract: opaque COLOR, explicitly authored MER (texture or uniform), optional NORMAL, genuine nearest/clamped voxel sampling. Source material instances and Bedrock entity render profiles are distinct from PBR TextureGroups. Unknown/duplicate channels, unverified alpha/per-face slots, nonzero subsurface, HEIGHT and editor-only preview modes **fail closed**, rather than being silently replaced with generic materials.

**Source code is authored, NOT Bun/typecheck/Blender/native-verified.** A glTF material receipt and numeric parity do not prove Blender visual equality. See the exact open native gates in ADR-R02.

## Scope lock — the requested product, not arbitrary Blender scene editing

Only render the **actual Bedrock Entity Cube/Group/UV/Texture/PBR object authored by LazyDesigner MCP in Blockbench**. Keep one existing Gateway, native `render_publication` (including `handoff`), one independent Gateway-local `blender_render` control capability, one detached GLB bridge and one shared Blender 5.2 Cycles worker. Do **not** create a second network MCP server, arbitrary Blender scripting/import interfaces, multi-scene cinematic framework or duplicate model representation. All other model-authoring tools, native project state and screenshot QA remain independent.

Final architecture and per-module ownership are frozen in [mcp/server/publication/worker/README.md](../../mcp/server/publication/worker/README.md). The Runtime capability now belongs to the **Export** registration family. Native `render_publication` provides `handoff/start/status/preview/cancel` (five branches); Gateway-local `blender_render` provides `start/status/preview/cancel` (four branches). Both remain beneath the **same four Gateway methods**. Source output is a true Cycles PNG, not an AI-generated picture.

"Closed architecture" refers **only to component responsibilities and authored source**. It does **not** assert successful installation, Blender execution, image fidelity, or equality to the five visual references. User-requested native tests remain deferred.

## Source continuation — bounded genuine Cycles image feedback

- Worker quality_report.py creates ONE evidence.png (maximum 384px each side) by resizing a disposable Blender image datablock loaded from the **actual saved Cycles PNG**; no second renderer, image generator, source atlas replacement or default full-resolution image transfer.
- The TypeScript publication service accepts it only after strict RGBA8 PNG/CRC checks and source-bound diagnostic dimensions. Source GLB identity is rechecked inside the same native serialized queue operation that exclusively saves the final PNG.
- The Blockbench native `render_publication` capability now also has a `handoff` operation to produce a durable, source-checked GLB package for independent Gateway Blender rendering; legacy start/status/preview/cancel remain for compatibility. The Gateway itself still has exactly four top-level methods. The explicit preview operation returns genuine PNG image content only for a completed DRAFT job. Status is text-only by default.
- Plugin Studio includes a View Real PNG Preview dialog using the same validated bytes. The process-local WeakMap ties the cache to the original completed receipt and verifies SHA on each read; no network image URLs.
- Phase labels separate preparation, rendering, output verification and publication, without invented %/ETA. Auto GPU may retry on CPU once for a catchable Cycles exception with accurate backend/fallback provenance.
- AI can visually inspect that low-resolution real 3D output and request a new bounded camera/light configuration; there is **NO automatic artistic PASS or unattended unlimited refinement loop**.

**All of the above is source-authored, NOT executed/visually proven in Blender 5.2.** No user asset was rendered and no native Blockbench/MCP evidence run occurred. Visual quality parity with the five references is still unproven.

## Blender Core modular implementation — current source (3 Nov 2026)

The original source has now been expanded to a **standalone, original multi-module Blender Core** while retaining exactly one existing LazyDesigner MCP/Gateway and one secure headless worker launcher.

The canonical module ownership guide is at mcp/server/publication/worker/README.md.

- core_assets.py: native imported geometry/material/UV/PBR identity, no arbitrary source modification.
- camera_director.py: bounded geometry-projection-based automatic or manual camera, real aspect-safe bounds and a single final Cycles frame; no asset-name taxonomies.
- lighting_director.py: relative soft key/fill/rim plus physical contact-ground/shadow-catcher. Procedural studio is the default. A user-approved local Radiance HDR or OpenEXR may be copied into isolated job directory with signature, size and SHA checks and used as an Environment Texture.
- compositor_director.py: Cycles adaptive sampling, denoising, reliable CPU or best-effort GPU backend with truthful fallback, AgX/Standard and version-pinned Blender 5.2 Fog Glow.
- quality_report.py: actual output PNG histogram/alpha observations and precise camera/lighting/device provenance; **artistic quality is never auto-approved**.
- render.py: reduced to one fixed trusted Blender 5.2 job schema/entrypoint. No MCP-supplied Python, external dependency download or third-party Blender plugin required.
- execute.ts: all trusted Python modules embedded as inert text with whole-worker fingerprint, isolated source/asset files, report JSON and strict PNG/GLB integrity before committing an output image. Only source model files are read; project Undo/editor QA remains distinct.
- source UV atlas semantics: alpha outside sampled UV face regions is treated as unused padding; visible mapped alpha requires explicit verified downstream Bedrock material semantics, never guessed from pixel values.
- Runtime starts/queries/cancels a long-running render by job ID; it does not block Gateway for up to 15 minutes. Canonical plugin load/unload owns cancellation/reactivation.

**Efficiency:** Up to fifteen camera candidates are evaluated geometrically without rendering fifteen images; their scoring uses a bounded subset of mesh bounds, but the final chosen camera verifies **all** imported bounds. One Cycles image is rendered per job; diagnostics downsample the actual PNG after output. Same Cycles engine in preview/final avoids a second independent look.

**Remaining work before actual target quality can be claimed:** Not executed in this ChatGPT/GitHub session: Bun/typecheck/build, packaging/generation, installed Blender 5.2 headless execution and isolated HDRI/compositor behavior, native Blockbench export/UV/pose fidelity, and multi-asset visual comparison to the five references. Feature gaps remain non-Cube, per-face Bedrock alpha shader profiles, arbitrary animation pose sampling/MP4, supplied 3D cinematic scene assets and autonomous image-based artistic decisions. Do not claim those implemented.


## Implementation continuation — 2026-11-03, Render branch

**Source additions since the initial fidelity bridge:**

- `mcp/server/publication/jobs.ts`: one process-local, nonblocking `start / status / cancel` job with native GLB preparation completed before releasing the Runtime queue. Cycles worker runs on a detached, immutable snapshot; Gateway's 120-second default timeout is not held for a 15-minute Cycles render.
- `mcp/plugin/blockbenchIntegration.ts` unload now requests job cancellation. Ordinary UI reconstruction does not cancel an active render.
- `mcp/lib/publication/pngIntegrity.ts`: RGBA8 PNG dimensions, full chunk bounds, CRC and terminal IEND are verified before destination is written; a fake header is no longer accepted.
- `mcp/server/publication/snapshot.ts`: aggregate texture inventory capped at 128 distinct images and 8,388,608 total pixels in addition to the per-texture limit; unresolved or ambiguously named PBR groups fail explicitly.
- `mcp/lib/publication/contracts.ts` + `mcp/ui/publicationRenderDialog.ts`: square/16:9/4:3/4:5 output, exact camera controls, nine lighting/post parameters, conservative Fog Glow, bounded resolution and complete nested worker defaults.
- `mcp/server/publication/worker/render.py`: Cycles camera distance derived from narrower FOV, corner projection clipping check, Blender 5.2 compositing NodeGroup/Fog Glow, verified imported mesh/texture presence and meaningful shadow contact.
- `mcp/server/publication/execute.ts`: render receipts now carry camera, background, lighting, sampling, source identity and SHA provenance. Results are DRAFT; no artistic PASS.
- `mcp/tests/publication-png-integrity.test.ts` and `mcp/tests/publication-jobs.test.ts` add negative file/process/job cases. `mcp/scripts/verify/verify-publication-render-live.ts` is an opt-in **disposable synthetic** GLB→Cycles PNG smoke harness; it is not a test of the user's model.

**Proof available in this ChatGPT/GitHub session:** GitHub exact-source reads and branch-isolated commits; 15/15 static binding/ownership presence checks, then 9/9 lighting controls matched across schema/worker/UI and 5/5 additional source closure checks; independent Python numeric camera-fit sanity for 1:1, 16:9, 4:3, 4:5; Pillow confirmed the two tiny PNG smoke fixtures are genuine 1x1 RGBA pixels. These are **NOT Bun tests, Blender output, native import fidelity, or visual acceptance**.

**Unexecuted gates:** Bun tests, TypeScript compile, canonical generated MCP artifacts, Blender 5.2 process, actual PNG render, Blockbench installed UI/GLB state invariants, reference-quality comparative evaluation. This execution context provides GitHub source access plus a generic local Python/Node sandbox, but no Bun/Blender/native installed Blockbench. Do not claim runtime completeness or source-level quality parity.

**Test entrypoints for a genuinely capable environment:** from `mcp/`, `bun test tests/publication*.test.ts`, `bun run typecheck`, canonical docs/contract generator, and explicit opt-in `bun run scripts/verify/verify-publication-render-live.ts <absolute Blender 5.2 executable>`. Run the real Blockbench fixture only with the Render build identity. Do not run release/merge or enable CI automatically.

## Current Render-branch source implementation (2026-11-03)

**Implemented in source, not runtime-proven:**

- `mcp/lib/publication/contracts.ts`: bounded Blender/path, quality, camera, and general key/fill/rim/softness/environment/exposure inputs; no overwrites or shell flags.
- `mcp/lib/publication/materialChannels.ts`: deterministic Bedrock MER→glTF roughness/metallic/emission and normal-Y conversion; no invented material data.
- `mcp/lib/publication/glbIntegrity.ts`: bounded GLB 2.0 JSON/BIN, material/mesh/UV and embedded PNG checks; not a substitute for Khronos validator or visual comparison.
- `mcp/server/publication/snapshot.ts`: detached Cube mesh + exact texture bytes; fails closed for unsupported non-Cube, alpha, height and unknown texture groups, and rechecks source identity.
- `mcp/server/publication/worker/render.py`: Blender 5.2 Cycles, lights/AgX/ground, closest interpolation, image, UV, and imported mesh validation; 5.2 compositor migrated to group-based API.
- `mcp/server/publication/execute.ts`: permission-scoped child process/filesystem, exclusive output PNG/readback SHA, bounded process shutdown and uncertain-exit cleanup hold.
- `mcp/server/tools/inspection/publication.ts` + registration/metadata: `render_publication` exposed via unchanged four Gateway methods. QA `capture_model_views` not edited.
- `mcp/ui/publicationRenderDialog.ts`: human Render button using the same service.
- `mcp/tests/publication-render-contract.test.ts`, `mcp/tests/publication-process.test.ts`: tests source-authored NOT EXECUTED; Runtime source counts and owner map updated only on Render.

**Current deliberate limitations (updated):** The source currently supports native Cube geometry, opaque face UV pixels, color/MER/normal PBR, a procedural studio, optional user-approved local HDR/EXR lighting, conservative Blender 5.2 Fog Glow and verified preview image retrieval. It still does NOT support arbitrary animation pose sampling, explicit per-zone cutout/translucent/glass semantics, height-to-bump, non-Cube geometry, imported 3D cinematic environment/prop libraries, multi-shot/MP4, or automatic artistic-quality PASS. Source implementation is not a measured finished renderer.

**Required remaining proof:** targeted Bun tests/typecheck/build and canonical generated artifacts, native Blockbench GLB export, real Blender 5.2 import/Cycles PNG, no editor/Undo changes, reference-matched visual asset integrity and performance/cost benchmark. CI verification remains disabled. Do not require user-PC work as prerequisite for ChatGPT-owned source development.

## 1. What the user actually wants (not an object taxonomy)

Input is the **real authored Blockbench asset**. Output must be a **real high-quality 3D render**, visually comparable in rendering craft (not identical scene content) to the five submitted reference images. The requested quality is INDEPENDENT of whether the asset is furniture, a mob, a vehicle, a golem, or a whole scene. Do NOT generate or redraw the model with a diffusion/image model. Do NOT classify the render quality or renderer by asset subject.

Cross-cutting visual outcomes:

1. Strong but controlled key/fill/rim and indirect bounce lighting; expressive but readable forms.
2. Preserved pixel-art / voxel albedo and exact UV alignment; sharp texture texels, not blurred/smoothed or hallucinated detail.
3. Readable recesses and convincing contact shadows; physically plausible reflectance when authored maps exist.
4. Correct alpha, roughness, metalness, normals, emission and postprocessing, not a uniformly glossy/plastic shader.
5. Intentional camera/composition, foreground/background separation, coherent exposure/white balance and color grade.
6. Optional scene/environment, atmospheric depth, volume lighting and action pose; no expectation that rendering invents scenery absent from the source/approved asset library.
7. Delivery as normal PNGs + optional editable scene/EXR, traceable to exact source model and settings.

**Fundamental constraint:** A render engine improves lighting and presentation, but cannot recreate geometry/paint detail that the original model does not contain. A cinematic shot with architecture/props requires actual scene assets; these are composited as 3D geometry, not generated pixels.

## 2. Locked technical decision

**Primary:** Blender 5.2 LTS, pin **5.2.3** for initial proof (released 2026-10-22), using **Cycles path tracing**. Headless deterministic Blender Python worker for both low-sample preview and high-quality final; no Eevee/Cycles look-switch in the normal preview-to-final path. Eevee is an optional future interactive draft, not the source of visual truth.

**Input transport:** Validated **GLB/glTF 2.0** containing a detached, non-mutating Blockbench snapshot + a compact material/source manifest. The input MUST derive from original native meshes and texture pixels. It is never a reconstructed AI image.

**Orchestration:** One Runtime-side publication service callable by the existing Blockbench Plugin UI and through the existing Gateway four-method surface via an additional discoverable Runtime capability. No public fifth Gateway method, new cloud service, parallel model state, mandatory third-party Blockbench plugins, or modification to the QA capture tool.

**Rendering worker:** Explicitly user-authorized local Blender executable, invoked with a validated argv array (never a shell command string) using Blockbench's permission-scoped child_process + filesystem APIs. No dependency on external API, image generator, or paid render service. Worker is optional: if Blender is absent, present an honest unavailable state, not an inferior render mislabeled final.

**Excluded as primary:**
- Existing Blockbench screenshot / Three.js viewport: good for QA/camera orientation, lacks Cycles GI/path-traced final quality.
- Lightflow: excellent lighting/shader/compositor *reference*, but its active development renderer is not a proven stable automation API; optional future integration only after compatibility tests.
- Shapescape Render Model: excellent batch/sheet/turntable *reference*, not the final GI renderer.
- Direct .bbmodel-to-Blender importer: creates a second full model parser and risks geometry/UV/animation divergence; do not build unless source GLB fidelity cannot be solved.
- AI image generation or upscaling: disallowed for source-faithful render output. Do not claim hallucinated detail is an authored 3D asset.

## 3. Critical verified source facts and risks

1. **Blockbench recommends glTF for rendering in Blender** and supports hierarchy/animation. Official: https://blockbench.net/wiki/guides/model-rendering/
2. In upstream Blockbench's actual glTF codec, compile() uses THREE.GLTFExporter but also sets animated texture frames to 0, changes edit/animation preview, changes view mode to textured, temporarily moves scene objects and performs some restoration without a guaranteed full rollback on error. **Do not invoke the current glTF codec in the authoritative live editor as an unquestioned side-effect-free operation**. Source: https://github.com/JannisX11/blockbench/blob/master/js/formats/standards/gltf.js
3. Current LazyDesigner export_model intentionally restricts codec IDs to bedrock/project/bedrock_animation; it does not expose GLB. Source: mcp/server/tools/io/export.ts at initial Render fork.
4. Current LazyDesigner capture_model_views includes valuable frame/bounds/fingerprint concepts, but is explicitly an evidence/QA owner, not a beauty-render pipeline. Reuse safe pure geometry calculations where practical, not its image result or its visual verdict. Source: mcp/server/tools/inspection/camera.ts.
5. LazyDesigner PBR TextureGroup already tracks color, normal, height and MER. Source: mcp/server/tools/texture/materialState.ts. Official Bedrock MER: **R=metalness, G=emissive, B=roughness**, while MERS adds alpha=subsurface and requires separate recognition. Sources: https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/useblockbenchtocreatemodelswithtextures?view=minecraft-bedrock-stable and https://github.com/MicrosoftDocs/minecraft-creator/blob/main/creator/Reference/Content/TextureSetsReference/TextureSetsConcepts/TextureSetsIntroduction.md
6. Bedrock render_profile, PBR texture_set, and Blockbench preview render_mode are DIFFERENT semantic domains and alpha has slot/zone-specific meanings. Never infer transparency, color mask, or emissive mapping from alpha alone. Source: docs/03-authoring/texture/render-profile.md.
7. Blockbench native APIs explicitly allow child_process to launch external programs after plugin permission. Permission denial is a normal blocked outcome. Source: https://github.com/JannisX11/blockbench/blob/master/types/custom/desktop.d.ts and https://github.com/JannisX11/blockbench/blob/master/js/native_apis.ts
8. Blender 5.2.3 LTS is the active patched 5.2 line as of this decision date. Official: https://www.blender.org/releases/5-2/
9. Blender's glTF import uses bpy.ops.import_scene.gltf, including meshes/materials/textures/animations, but importer compatibility is NOT proof of exact per-face equality. API: https://docs.blender.org/api/5.2/bpy.ops.import_scene.html
10. Khronos glTF-Validator checks structure, references, buffer values and extensions; it cannot prove visual fidelity: https://github.com/KhronosGroup/glTF-Validator
11. Pixel-art interpolation **Closest** (nearest neighbor) and Cycles denoising with albedo+normal guide passes are documented: https://docs.blender.org/manual/sl/5.2/render/shader_nodes/textures/image.html and https://docs.blender.org/manual/en/5.2/compositing/types/filter/denoise.html
12. Poly Haven HDRIs are CC0; do not auto-download at render time or ship enormous assets by default: https://polyhaven.com/license

## 4. End-to-end architecture and trust boundaries

~~~text
Approved/current native Blockbench project
    |
    | read-only geometry / exact RGBA atlas / material intent / current pose
    v
[Asset Fidelity Bridge: detached snapshot]
    |  => isolated snapshot.glb
    |  => render-input.json (source/texture hashes, material channels, pose)
    |  => native state BEFORE/AFTER attestation
    v
[GLB structural validation + source fidelity preflight]
    |  invalid, partial, ambiguous => BLOCKED, do not render
    v
[User-permitted local Blender 5.2.3 process]
    |  bpy.ops.import_scene.gltf()
    |  material translation, light rig, ground/shadow catcher, world
    |  camera projection and composition, compositing graph
    v
[Cycles low-sample preview; same scene graph used for final]
    |  user/AI art-direction corrections when needed
    v
[Cycles final + optional transparent/shadow/albedo/depth passes]
    |
    v
[Quality checks + source/job/renderer provenance]
    => named publication PNG(s), optional .blend/EXR, compact receipt
    => same internal service accessed by Blockbench UI or Gateway
~~~

**No AI token burn on full resolution PNG data by default**. Save to a user-authorized location and return path/hash/dimensions and at most one small preview if explicitly requested. Do not write over existing assets without explicit permission.

### 4.1 Non-mutating Asset Fidelity Bridge (the FIRST vertical slice)

Implement a **detached scene snapshot**, NOT the current mutation-prone native glTF codec on the user's active project:

- Lock to current project UUID, native/runtime generation and source revision; read current visible/exportable native model Cube geometry, transformed world matrices, mesh UVs, material groups and exact texture bytes.
- Clone geometry, transform and materials into an independent glTF-compatible THREE.Scene; NEVER reparent the editor's objects, switch native mode, change Texture.currentFrame, select animations, edit Undo, or save the project.
- Export from the detached scene using the bundled THREE.GLTFExporter. Preserve per-face UVs, world space, original color/alpha textures and exact source UUID mapping through extras/sidecar. Convert Blockbench-specific runtime shader materials explicitly into portable glTF channels; do not assume GLTFExporter can serialize arbitrary Blockbench ShaderMaterial.
- For V1, support native visible/exportable Cube-derived geometry and CURRENT verified static pose. If unsupported non-Cube elements, ambiguous baked transforms or shader semantics are present, return a bounded UNSUPPORTED/UNVERIFIED report; **do not silently drop elements**.
- Restore nothing because no authoritative state was mutated. Still attest model/texture/project/generation unchanged before/after snapshot and fail closed if concurrent edits occur.
- Run Khronos glTF-Validator and independent reimport checks; perform camera-matched flat/unlit material comparison with native reference as the actual visual fidelity test.
- A fallback using the native Blockbench glTF codec is allowed ONLY on an independently disposable project with explicit state isolation and proven restoration on success + failure; never relax the source-project non-mutation invariant.

**Animation/pose expansion:** V1 can render the already-verified current pose as static meshes. Deterministic clip/time sampling, rig export, animation snapshots and action-pose batches are a SEPARATE follow-up that must preserve editor's animation state/Undo and prove exact frame fidelity. Do not claim that V1 renders arbitrary animation time.

### 4.2 Material Fidelity Bridge

- Preserve original albedo bitmap/hash and per-face UV orientation. For voxel/pixel textures use Blender image node interpolation=Closest; normal/height/MER use Non-Color as appropriate, color textures use correct sRGB interpretation, not raw data.
- When PBR channels exist, map Color -> Principled Base Color, normal -> Normal Map, MER.R -> Metallic, MER.B -> Roughness, MER.G -> Emission strength/mask (with authored emission hue/color policy), alpha and shadow mode by verified native semantic meaning; handle authored uniform channel values.
- If only color exists, use a conservative neutral non-metal rough material by default and make look-dev overrides opt-in, clearly distinguishing 'publication look' from Minecraft gameplay material. Do not infer metalness/emission from blue or bright pixels.
- Cutout, translucent, emissive alpha/mask, color-mask and Bedrock runtime-only render semantics are NOT interchangeable. Map only supported variants; fail or explicitly mark unsupported/visually unverified.
- Keep flat / voxel normals by default; no smoothing subdivision or speculative geometry. Optional bevels are render-only stylistic overrides, disabled by default and never silently claimed to be authored geometry.
- Texture fidelity and PBR material appearance are two independent verification dimensions.

### 4.3 One quality engine for ALL assets (no asset-category branching)

All scenes share the same render graph, camera logic and quality policy. Adjustable scene parameters are not subject classifications.

1. Camera: calculate native visible-geometry bounding volume, candidate three-quarter angles + orthographic/perspective with explicit known front direction, safe margins, intentional focal length and subject occupancy. Optional bounded low-cost candidate previews rank silhouette coverage, clipping and visibility; don't guess canonical 'front' from asset name.
2. Lighting: relative-size key/fill/rim Area Lights with physically meaningful warm/cool separation and soft shadows; optional calibrated environment HDRI for indirect fill/reflections; tune by measured scene extents rather than absolute hardcoded world coordinates.
3. Ground/contact: real floor, soft contact shadows, optional shadow catcher for compositing; separate object alpha and shadow passes for transparent publication PNGs.
4. Material response: metallic/specular/roughness/normal driven by actual authored maps or explicit presentation overrides; preserve voxel color blocking and edge readability.
5. Color: scene-linear lighting, AgX view transform as a STARTING hypothesis (not mandated without comparison), calibrated exposure/white balance/contrast, limited saturated clipping. Test against 'Standard' on pixel-art swatches to avoid accidental washed-out atlas appearance.
6. Post: use Cycles denoising with albedo+normal guides; conservative emission-only bloom/glare, optional slight vignette; depth of field only where it does not destroy subject detail; optional volumetric fog when requested/scene supplies depth.
7. Compositing: render layers/passes for Albedo, Normal, Z, Emission and Shadow Catcher as relevant; do not bake global haze/bloom into every pixel blindly.
8. Scene/background: initially a neutral physically based stage. For rich environmental images use actual licensed/user-authored 3D background assets or a procedural stage, with separately controlled lighting/atmosphere. **One asset alone cannot automatically yield a detailed city or other authored environment without additional scene content.**

## 5. Initial parameter candidates (TO BE BENCHMARKED, NOT A QUALITY CLAIM)

| Control | Fast review | Publication default | High-quality optional |
| --- | --- | --- | --- |
| Engine | Cycles | Cycles | Cycles |
| Resolution | 640px longest edge | 2048px longest edge | 3840px longest edge / 4K |
| Samples | 24–48 | 128 | 256 |
| Adaptive noise | on | on | on, lower threshold after test |
| Denoise | on, guided | on, guided | on, guided with crispness comparison |
| Texture filtering | Closest for authored voxel pixel art | Same | Same |
| Geometry | Original only | Original only | Original only |
| Background | Neutral stage | Neutral/gradient or supplied scene | Supplied/procedural scene |
| Color/bloom | restrained | calibrated per shot | calibrated per shot |

These are **first benchmark inputs**, not validated performance or a universal recipe. CPU/GPU support, VRAM constraints, timing and exact final sample levels must be measured on real devices. Do not promise minutes/seconds. Use source-preserving preview/final parity, NOT a different renderer for the final look.

## 6. Integration design

### In Blockbench Plugin

A single **Render** panel/dialog under existing LazyDesigner UI: current asset identity, explicit publication draft/final readiness, camera preview, light/environment adjustments, optional material overrides, destination and Render button. The UI calls the SAME internal publication service used by the Runtime tool. A per-job cancellation action and error/permission feedback are required; never freeze or take over the active authoring viewport.

### In MCP

New conditional native capability, tentatively named **render_publication**, discovered/described/invoked through the existing Gateway methods. No fifth method and no new independent Gateway transport.

Illustrative non-implemented request:

~~~json
{
  "quality": "preview|publication|high",
  "source": {"project_uuid": "...", "checkpoint_sha256": "..."},
  "camera": {"mode": "auto|manual", "front_direction": "+z", "projection": "perspective", "framing": "full"},
  "look": {"key": 1, "fill": 0.4, "rim": 0.65, "hdri_id": null, "bloom_strength": 0.1},
  "scene": {"mode": "neutral|supplied", "scene_asset_ids": []},
  "output": {"format": "png", "path": "authorized absolute path", "overwrite": false},
  "preview_delivery": "metadata_only|small_image"
}
~~~

Return structured receipt: success/error code, source checkpoint + texture/source GLB hashes, Blender executable/version/device, import/bridge status, exact camera/light/look/quality settings, output PNG checksum/size/path, elapsed/provenance metrics, native state unchanged, optional preview; **no automatic claim of artistic PASS**.

**Exact source owners to modify only during implementation:**
- mcp/server/tools/inspection/publication.ts — registered native Runtime capability (reuse existing camera family and declarative capability metadata);
- mcp/server/publication/ — one native export snapshot/worker service;
- mcp/lib/publication/ — pure job schema, material channel mapping, camera/light normalization and result policy;
- mcp/ui/publicationRenderDialog.ts + minimal mcp/ui/index.ts integration — human UI consumer of same service;
- mcp/lib/capabilities/manifest.ts and mcp/gateway/capabilities/manifest.ts — semantic discovery/cost/operation, no extra public Gateway method;
- Blender worker script kept under mcp/server/publication/worker/ (trusted, bundled and versioned; no generic user script execution);
- mcp/tests/publication-render*.test.ts — native fidelity/worker/contract regression.
No edits to QA owner mcp/server/tools/inspection/camera.ts unless a narrowly justified shared pure helper is proved necessary. Generated docs/prompts must follow canonical generator; never hand-edit them.

## 7. Worker execution / security

- Only a user-selected, verified Blender executable. Check Blender version/identity and local availability before exposing Ready.
- Explicit scoped Blockbench permissions for fs and child_process; never silently bypass denial. Spawn with argv (no shell), strict trusted script path and dedicated, bounded temporary job directory.
- Use Blender CLI flags: --background --factory-startup --disable-autoexec --python <trusted worker> -- <job-json path>, with environment isolation and plugin auto-run controls. Blender Python script is code trusted from **our signed/verified distribution**, NEVER supplied by arbitrary model/scene content.
- Import only validated GLB and approved scene assets; avoid opening untrusted .blend projects with auto scripts. Do not let a model, user label or remote filename become a Python expression or shell command.
- Reject path traversal, symlink redirection, unauthorized overwrites and unbounded resolutions, sample counts, memory, subprocess durations, scene files or output sizes. On crash/time-out report actual failure, no fabricated artifact or silent retry after uncertain write.
- GPU backend (OptiX/CUDA/HIP/oneAPI/Metal) only when enumerated as available; explicit CPU fallback reported. No measured speed claims.
- Temporary files cleaned only after proof/retention policy; persistent asset files unaffected.

Official Blender CLI/security: https://docs.blender.org/manual/sl/5.2/advanced/command_line/arguments.html , https://docs.staging.blender.org/manual/en/latest/advanced/scripting/security.html  
GPU support: https://docs.blender.org/manual/pt/5.2/render/cycles/gpu_rendering.html

## 8. Acceptance gates — no vague 'looks good'

### Gate A — Asset fidelity (required before polishing renders)

- GLB structurally valid; no broken buffers/texture references; imported Blender scene has non-empty visible native geometry.
- No dropped source-visible elements, faces, UV islands or external/unsupported materials; unsupported category must explicitly block rather than silently degrade.
- Project UUID/stage/checkpoint/texture hashes identical before and after capture; native selection, camera, pose, Undo, save status and QA capture unaffected on both success and error.
- World bounds and silhouette can be compared in aligned coordinates within a documented numerical tolerance; cross-render unlit/albedo views checked visually for flipped UV, missing faces, interpolation blur, alpha difference and color mapping. Structural validation **never substitutes** pixel-level comparison.
- Animated pose/clip/time remains OUT OF SCOPE until own evidence passes.

### Gate B — Renderer / image correctness

- Blender actually runs the pinned worker; accepted RGB/RGBA PNG signature/size/alpha profile; valid successful readback + digest; file write collision blocked.
- Representative renders under a fixed scene/camera show crisp texels, correct PBR/reflection/emissive, no unintended clipping, smooth controllable contact shadows, no light leaks or denoising smear.
- Both neutral and colored/transparent stage outputs retain intended alpha and ground/shadow treatment.
- A render failure returns a truthful code and never "succeeds" by sending a native screenshot or AI-produced image.

### Gate C — Perceptual publication bar (independent of object subject)

Use 5 uploaded references ONLY as a **visual-craft benchmark**, NOT as a request to recreate their scene/subject. Evaluate on 3+ real distinct existing LazyDesigner .bbmodel fixtures with the SAME render engine, with controlled adjustments to camera/lights/scene.

Art-director rubric, scored 1–5 in blind visual review: (a) subject silhouette and readable detail, (b) lighting direction/indirect fill, (c) credible shadows/contact, (d) material response and preserved voxel sharpness, (e) color/composition/post-production discipline. Define success as >=4/5 on all five criteria for each accepted fixture, with no Gate A defects. These are **proposed acceptance criteria**, not measured results. Record rejected frames and settings, not only cherry-picked successes.

Quantitative diagnostics should report occupancy/clipping, overexposure on non-emissive pixels, texture/shader coverage, rendering time, peak memory where measurable, failure/redo rate and count of final PNGs sent to an AI model. Thresholds must be calibrated from real cases, not invented.

## 9. Implementation sequence and stop conditions

1. **Fidelity spike FIRST**: detached Cube/model -> GLB -> structural validation -> Blender import; camera-matched unlit comparison and native-state invariants on real Blockbench fixtures. If this fails, stop and fix bridge before any beauty-render features.
2. **Single Cycles render**: deterministic Blender worker creates camera, lights, physically grounded floor, color/normal/MER/alpha node graph, one output PNG with metadata.
3. **MCP + Plugin equivalence**: same service, permission gating, source revision binding, preview vs final and compact receipts.
4. **Quality convergence**: tune auto composition, key/fill/rim, shadow catcher, AgX vs Standard, PBR, denoise, bloom and HDRI against five references and ≥3 genuine assets; benchmark actual GPU/CPU.
5. **Environment + motion**: user-authored or approved CC0 3D scenes, volumetrics, multi-shot renders, turntable and animation frame sampling only after fidelity gates.

**STOP**: Do not claim "photorealistic / comparable to the references / production ready" from source or docs alone. Require both valid live Blockbench snapshot and real Blender output quality evidence. A working PNG with wrong texture/UV is a FAIL, not a success.

## 10. Current proof and bounded handoff

- Research and exact repository + official external source review: COMPLETE.
- A bounded Cycles publication pipeline, capability/UI and regression test source is committed on Render. No successful Bun/build/Blender/native acceptance has been observed.
- Blender binary, Bun toolchain, installed Blockbench and live Gateway: **NOT AVAILABLE / NOT EXECUTED in this GitHub-only research session**.
- No images generated, downloaded or copied into this branch; five user reference images are quality criteria only.
- No commits to Local/main, no CI workflows changed, no release/publish.

**Next engineering task:** execute focused Bun tests/typecheck, regenerate canonical artifacts, then run an exact-SHA disposable Blockbench→GLB→Blender 5.2 Cycles visual fidelity fixture. Tune lighting/camera against the five reference images only after source-fidelity acceptance. Do not release or merge without proof.

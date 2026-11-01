# Texture & UV Knowledge — K1 Extended Research Corpus

**Status:** RESEARCH ONLY; not authoring code, not native/visual verification. Reviewed 2026-10-29.  
**Authority:** [K0–K9 development plan](knowledge-development-plan.md) and [active standard](standard.md).  
**Source baseline:** `OpenITStudios/M-LazyDesigner` `Local` at `4179e78e8bef5aa5c33644414d66786e2953dbd6`.

## Objective and source quality contract

This is the expanded eight-stream K1 research inventory for **high-fidelity, reference-grounded, editable Bedrock Entity UV and texture**. The previous short source list was insufficient. Each entry states a **technical observation**, a **candidate transfer to an existing owner**, and a **negative-transfer boundary**. Some sources are official documentation, some pinned native source and representative sample JSON, some research abstracts, and some catalogs requiring per-item rights checks. **Source discovery != source reproduction != rights to reuse != integrated feature != visual PASS.**

**Provenance:** Mojang Bedrock Samples files are pinned to commit `15701fa9c13923f12662984c32c124327e40e3d3` (2026-10-28, v1.26.60.5); Blockbench native JS to `ec0b2827104d0799c153bfb5f867579c0c44652f` (2026-10-18); xatlas to `f700c7790aaa030e794b52ba7791a05c085faf0c`; SyncMVD to `faa95621d220d7327847a994cd380608c04af5ab`. Web docs/papers without pinned URL revision are **rolling**; revalidate exact claims, licenses and version before promoting any K3 card.

**Evidence tiers:** **SOURCE** means specific native code/JSON file was inspected, **DOC** primary documented behavior, **PAPER** published research method/abstract rather than reproduced code, **CATALOG** catalog/license discovery only. This is not an executable audit, and model fidelity is not yet evaluated.

## A. Minecraft / Bedrock: standards, rendering and real entity samples

**Rights boundary:** Mojang Bedrock Samples states © Mojang AB, all rights reserved; files subject to Minecraft EULA. No automatic permission for redistribution or AI training. Docs are research references, not authorization to copy assets.

| ID | Primary source | Specific observation | Transfer / limitation |
| --- | --- | --- | --- |
| B01 | [Geometry schema 1.19.30](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/schemasreference/schemas/minecraftschema_geometry_1.19.30?view=minecraft-bedrock-stable) | Cube UV, mirror and texture dimensions in schema | `uv/facePixelMapping`; distinguish logical UV from bitmap pixel (DOC) |
| B02 | [Geometry visual reference v1.21.0](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/geometry.v1.21.0?view=minecraft-bedrock-stable) | Per-face UV sizing and quarter-turn rotation | Preserve signed corners/disabled faces, not normalize away orientation (DOC) |
| B03 | [Add entity guide](https://learn.microsoft.com/en-us/minecraft/creator/documents/introductiontoaddentity?view=minecraft-bedrock-stable) | Geometry, texture, render/material resource bindings are separate | Editor texture presence does not prove Minecraft rendering (DOC) |
| B04 | [Render controllers](https://learn.microsoft.com/en-us/minecraft/creator/documents/behaviorrendercontrollers?view=minecraft-bedrock-stable) | Material/texture selection through controller and bone patterns | `texture/renderProfile`; never infer final code from atlas alone (DOC) |
| B05 | [Material files](https://learn.microsoft.com/en-us/minecraft/creator/documents/material-files?view=minecraft-bedrock-stable) | Alpha-test, alpha-blend and emissive are distinct | `texture/alphaSemantics`; luminous RGB != runtime emission (DOC) |
| B06 | [Mojang Texture Sets documentation](https://github.com/Mojang/bedrock-samples/blob/main/documentation/Texture%20Sets.html) | Color, normal/height, MER-family maps and serialized fields | `texture/pbrContent`; channel/target rules trump generic PBR assumptions (DOC) |
| B07 | [Bedrock resource performance](https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/improvingperformanceandresourceusage?view=minecraft-bedrock-stable) | Texture resources/atlas have runtime cost | Preserve single-base-atlas standard; do not optimize size at the expense of visual fidelity (DOC) |
| B08 | [Vibrant Visuals PBR overview](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/pbroverview?view=minecraft-bedrock-stable) | PBR is a distinct target rendering workflow | Optional capability, not default requirement (DOC) |
| B09 | [Vibrant Visuals resource packs](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/vvresourcepacks?view=minecraft-bedrock-stable) | PBR texture set support and target-specific rendering | `texture/productionAlignment`; preview does not certify runtime (DOC) |
| B10 | [VV subsurface scattering](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/subsurfacescatteringcustomization?view=minecraft-bedrock-stable) | MERS alpha semantics include subsurface; material channels interact | Do not mistake PBR alpha for base-color opacity (DOC) |
| B11 | [VV lighting](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/lightingcustomization?view=minecraft-bedrock-stable) | Appearance depends on target scene lighting | Studio-preview shading is not exported Minecraft proof (DOC) |
| B12 | [Mojang source repository](https://github.com/Mojang/bedrock-samples/tree/15701fa9c13923f12662984c32c124327e40e3d3) | Paired model, entity, bitmap and texture-set examples | Read source relationships, not just isolated screenshot (SOURCE) |
| B13 | [Bee geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/bee.geo.json) | Box UV arrays; tree includes angry/nectar/baby texture variants | `texture/variantPlan`; a variation does not require new Cube UV (SOURCE) |
| B14 | [Bee texture set](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/textures/entity/bee/bee.texture_set.json) | `format_version=1.21.30`, color `bee` and MERS `bee_mers` | Compare source pairing; not proof every runtime supports PBR (SOURCE) |
| B15 | [Creaking geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/creaking.geo.json) | Box UV and separately named eye texture assets | `texture/treatmentPlan`; separate eye semantics need material/binding evidence (SOURCE) |
| B16 | [Creaking eyes texture set](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/textures/entity/creaking/creaking_eyes.texture_set.json) | Eyes color + `creaking_eyes_mers` | File name alone does not prove emissive material binding (SOURCE) |
| B17 | [Copper Golem geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/copper_golem.geo.json) | Mirror+Box UV; exposed/oxidized/eyes assets exist | `uv/stacking` + variants; asymmetric wear cannot share conflicting pixels (SOURCE) |
| B18 | [Copper Golem texture set](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/textures/entity/copper_golem/copper_golem.texture_set.json) | Color + named MERS bound in source | `texture/pbrMaterialMembership`; do not cross-wire variants (SOURCE) |
| B19 | [Axolotl geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/axolotl.geo.json) | Box UV multiple bones and color variants | `texture/variantPlan`; variant identity differs from UV layout ownership (SOURCE) |
| B20 | [Axolotl blue texture set](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/textures/entity/axolotl/axolotl_blue.texture_set.json) | Blue color + blue MERS, with baby counterpart in tree | PBR variant alignment example, not training dataset (SOURCE) |
| B21 | [Frog temperate texture set](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/textures/entity/frog/temperate_frog.texture_set.json) | Temperate/warm/cold naming and PBR variants in tree | Material family may be constant while palette identity changes (SOURCE) |
| B22 | [Enderman geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/enderman.geo.json) | Box UV, authored mirrored Cube faces | `uv/facePixelMapping`; mirror means deliberate orientation, not text-safe symmetry (SOURCE) |
| B23 | [Ender Dragon geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/ender_dragon.geo.json) | Complex Box UV and hierarchy with mirror | `uv/semanticPlanner`; don't convert to generic mesh only to texture (SOURCE) |
| B24 | [Dragon eye texture set](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/textures/entity/dragon/dragon_eyes.texture_set.json) | Color+MERS eye pair | Eye pixels/texture-set not sufficient evidence of renderer glow (SOURCE) |
| B25 | [Allay geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/allay.geo.json) | Relatively simple Box UV model; separate allay color/MERS | Preserve fast simple mapping path (SOURCE) |
| B26 | [Armadillo geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/armadillo.geo.json) | Multi-bone Box UV; adult/baby variants | Do not mandate per-face conversion without reference need (SOURCE) |

## B. Blockbench official editor source: actual behavior, not assumptions

**Rights:** Blockbench code is GPL-3.0; use source knowledge, do not copy implementation without legal/code review. Version pin above, native install remains unverified.

| ID | Primary source | Specific observation | Transfer / limitation |
| --- | --- | --- | --- |
| BB01 | [Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) | Texel density, hue/value, pixel clusters and style anti-patterns | `texture/pixelCraft`; noise metric alone is not aesthetics verdict (DOC) |
| BB02 | [Bedrock modeling guide](https://blockbench.net/wiki/guides/bedrock-modeling/) | Templates, Bedrock UV editing, authoring constraints | `uv/boxUvPolicy`; native format takes precedence over generic DCC (DOC) |
| BB03 | [Blockbench overview/tips](https://blockbench.net/wiki/guides/blockbench-overview-tips/) | Painter and UV tools work on different editor states | `texture/paintTransaction`; UI result does not prove pixel write (DOC) |
| BB04 | [Native UV editor](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/uv/uv.js) | UV flips, face rotations and coordinates in editor | Preserve authored face-local orientation (SOURCE) |
| BB05 | [UV size implementation](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/uv/uv_size.ts) | Resizing UV mode with native Undo | `uv/physicalEvidence`; physical pixels and logical coordinates separate (SOURCE) |
| BB06 | [Native template generator](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/texturing/texture_generator.js) | `rearrange_uv`, `pixel_density`, Box template and padding handled by editor | Reuse generator; no second UV engine (SOURCE) |
| BB07 | [Native Painter](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/texturing/painter.js) | Face-local pixel edits and native Undo transaction | `texture/paintTransaction`; dirty-region and readback guards remain (SOURCE) |
| BB08 | [Texture object implementation](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/texturing/textures.js) | `getUVWidth`, image scale, frame and smoothing semantics | `texture/revision`; texture metadata change invalidates plan (SOURCE) |
| BB09 | [Native PBR TextureGroups](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/texturing/texture_groups.js) | Serializes `texture_set`, normal/height/MER/MERS, normal orientation | `texture/pbrContent`; source serializer != renderer acceptance (SOURCE) |
| BB10 | [Bedrock codec](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/formats/bedrock/bedrock.js) | Imports/exports mirror, Box, per-face and `uv_rotation` | `uv/nativeState`; round-trip native validation required (SOURCE) |
| BB11 | [bbmodel format](https://blockbench.net/wiki/docs/bbmodel/) | Editable native project format can change with editor version | `uv/transaction`; save/reopen needed (DOC) |
| BB12 | [Blockbench releases](https://github.com/JannisX11/blockbench/releases) | Tool/editor behavior evolves per version | Pin matching installed plugin build; do not transfer newer feature blindly (DOC) |
| BB13 | [Texture declarations](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/types/custom/textures.d.ts) | Native texture type surface | Compile-time contract not proof of live image data (SOURCE) |

## C. Blender, Houdini and Adobe Substance: professional DCC transfer boundaries

| ID | Primary source | Specific observation | Transfer / limitation |
| --- | --- | --- | --- |
| D01 | [Blender 4.5 UV editing](https://docs.blender.org/UATEST/manual/en/4.5/modeling/meshes/uv/editing.html) | Pack islands, pinning, pixel snap, scale | `uv/packing`; never reorder locked UV for occupancy alone (DOC) |
| D02 | [Blender UV operators](https://docs.blender.org/manual/id/4.5/modeling/meshes/editing/uv.html) | LSCM/ABF, cube projection and UV methods | Mesh unwrap usually irrelevant to standard Bedrock Cube (DOC) |
| D03 | [Blender baking](https://docs.blender.org/UATEST/manual/en/4.5/render/cycles/baking.html) | Bake margins, adjacent face filling | `texture/seamContinuity`; don't mandate baked shading (DOC) |
| D04 | [Houdini UV Layout](https://www.sidefx.com/docs/houdini/nodes/sop/uvlayout.html) | Chart grouping, rotations, padding, packing preferences | `uv/packing/planner`; keep semantic zone locality (DOC) |
| D05 | [Houdini UV Flatten](https://www.sidefx.com/docs/houdini/nodes/sop/uvflatten.html) | Pinned UV, seam handling and preserving layout | `uv/transaction`; existing pixels/lock outrank repack preference (DOC) |
| D06 | [Houdini UV Unwrap](https://www.sidefx.com/docs/houdini/nodes/sop/uvunwrap.html) | Mesh unwrap representations | Only valid mesh scope; no implicit Cube topology rewrite (DOC) |
| D07 | [Houdini Labs AutoUV](https://www.sidefx.com/docs/houdini/nodes/sop/labs--autouv.html) | Geometry-aware island/charts from surface signals | `uv/islands` research-only, not a dependency (DOC) |
| D08 | [Substance dilation/padding](https://experienceleague.adobe.com/en/docs/substance-3d-painter/using/technical-support/workflow-issues/export-issues/texture-dilation-or-padding) | Padding prevents sampled edge bleed | 2D gutter alone not proof of material seam correctness (DOC) |
| D09 | [Substance Texture Set Settings](https://experienceleague.adobe.com/en/docs/substance-3d-painter/using/interface/texture-set/texture-set-settings) | 2D-neighbor versus 3D-neighbor padding | `texture/seamContinuity`; must identify real neighboring model edges (DOC) |
| D10 | [Substance common baker parameters](https://experienceleague.adobe.com/en/docs/substance-3d/bakers/bakers-settings/common-parameters) | Projection and ray-based map baking | Optional surface signal, not Minecraft painting standard (DOC) |
| D11 | [Substance mesh and UV performance](https://experienceleague.adobe.com/en/docs/substance-3d-painter/using/technical-support/performance-guidelines/mesh-and-uv-setup) | Multiple sets and UV locality affect memory | Multi-texture-set DCC workflow conflicts with normal one base-color Bedrock atlas (DOC) |
| D12 | [Substance mesh map baking](https://experienceleague.adobe.com/en/docs/substance-3d-painter/using/baking/how-to-bake-mesh-maps) | AO/normal/position as derived signals | `texture/geometrySignalBuilder`; baked maps are not reference acceptance (DOC) |

## D. Engine/standard comparisons: deliberately NOT Bedrock norms

| ID | Primary source | Specific observation | Transfer / limitation |
| --- | --- | --- | --- |
| E01 | [Unreal lightmapping](https://dev.epicgames.com/documentation/unreal-engine/understanding-lightmapping-in-unreal-engine?lang=en-US) | Lightmap requires distinct, non-overlapping UV, unlike ordinary texture reuse | Reject universal unique-chart rule for Minecraft base-color UV (DOC) |
| E02 | [Unreal generate lightmap UV](https://dev.epicgames.com/documentation/unreal-engine/generating-lightmap-uvs-in-unreal-engine) | Automated padding/repacking for baked lighting | Do not force lightmap geometry constraints on entity texture atlas (DOC) |
| E03 | [Godot StandardMaterial3D](https://docs.godotengine.org/en/latest/tutorials/3d/standard_material_3d.html) | Alpha scissor vs blend and depth ordering | Concept only; Bedrock material codes differ (DOC) |
| E04 | [Three.js Texture](https://threejs.org/docs/pages/Texture) | UV/filter/wrap/colorSpace and flipY behavior | `texture/frameMapping`; renderer preview may not equal Bedrock (DOC) |
| E05 | [Three.js DataTexture](https://threejs.org/docs/pages/DataTexture.html) | Raw data texture and sampler assumptions | `texture/bitmapRuntime`; distinguish raw-channel interpretation (DOC) |
| E06 | [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) | Separate texture/image/sampler and metallic-roughness alpha materials | glTF naming is not Bedrock material implementation (DOC) |
| E07 | [Unity FilterMode](https://docs.unity3d.com/kr/6000.0/ScriptReference/FilterMode.html) | Point vs bilinear sampling changes pixel-art appearance | `texture/pixelCraft`; preserve nearest behavior where intended (DOC) |
| E08 | [Unity sRGB importer](https://docs.unity3d.com/ja/current/ScriptReference/TextureImporter-sRGBTexture.html) | Color and non-color map conversions differ | `texture/colorProfile`; never gamma-correct normal/MERS as base color (DOC) |
| E09 | [Unity RenderTextureReadWrite](https://docs.unity3d.com/ja/current/ScriptReference/RenderTextureReadWrite.html) | Linear/sRGB readwrite may change pixel bytes | `texture/revision`; source digest must represent actual decoded bytes (DOC) |
| E10 | [MDN image smoothing](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled) | Canvas nearest/linear smoothing control | `texture/bitmapRuntime`; avoid silent AA on pixel art (DOC) |
| E11 | [W3C PNG 3rd edition](https://www.w3.org/TR/png-3/) | PNG alpha/color representation carries byte-level semantics | `uv/pixelMigration`; alpha=0 does not make nonzero RGB disposable (DOC) |
| E12 | [MDN colors/color spaces](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color) | Color model and profile affect perceived ramps | `texture/colorEngine`; avoid arbitrary color-mode conversion (DOC) |

## E. UV algorithms and raster/packing references

| ID | Primary source | Specific observation | Transfer / limitation |
| --- | --- | --- | --- |
| A01 | [xatlas readme](https://github.com/jpcy/xatlas/blob/f700c7790aaa030e794b52ba7791a05c085faf0c/README.md) | Mesh chart generation, parameterization and packing | `uv/packing` conceptual comparison; no native library import (SOURCE; MIT) |
| A02 | [xatlas API](https://github.com/jpcy/xatlas/blob/f700c7790aaa030e794b52ba7791a05c085faf0c/source/xatlas/xatlas.h) | Texel density and padding policy knobs | No claim source constraints fit Bedrock Cube (SOURCE; MIT) |
| A03 | [MaxRects header](https://github.com/juj/RectangleBinPack/blob/master/MaxRectsBinPack.h) | BSSF/BLSF/BAF/contact fit heuristics | `uv/maxRectsPlanner`; compare constraints and stability before occupancy (CODE reference; check license) |
| A04 | [MaxRects implementation](https://github.com/juj/RectangleBinPack/blob/master/MaxRectsBinPack.cpp) | Free-rect splitting/pruning | Audit deterministic packing when justified; no blind replacement (CODE reference) |
| A05 | [stb_rect_pack](https://github.com/nothings/stb/blob/master/stb_rect_pack.h) | Skyline alternative packing | Not equivalent to rotation/stack/semantic grouping requirements (CODE; MIT/public domain options) |
| A06 | [Microsoft UVAtlas](https://github.com/microsoft/UVAtlas) | Mesh UV distortion and atlasing, now archived | Research only; no new archived dependency (CODE; MIT) |
| A07 | [libigl tutorial](https://libigl.github.io/tutorial/) | LSCM/ARAP parameterization of triangular mesh | Geometry-specific, not universal Bedrock Cube path (DOC) |
| A08 | [PyTorch3D renderer notes](https://github.com/facebookresearch/pytorch3d/blob/main/docs/notes/renderer_getting_started.md) | UV/image/face texture representation choices | No PyTorch/diffusion runtime adoption (DOC) |
| A09 | [PyTorch3D textures source](https://github.com/facebookresearch/pytorch3d/blob/main/pytorch3d/renderer/mesh/textures.py) | Different ownership for TextureUV/TextureAtlas | Study representational boundaries only (CODE; BSD family) |

## F. Professional pixel art, color, alpha and image-authoring grammar

| ID | Primary source | Specific observation | Transfer / limitation |
| --- | --- | --- | --- |
| P01 | [Aseprite color modes](https://www.aseprite.org/docs/color-mode/) | RGB versus indexed palette/transparent index | `texture/palette`; never silently convert edited RGBA to indexed palette (DOC) |
| P02 | [Aseprite color bar](https://www.aseprite.org/docs/tutorial/color-bar-tutorial/) | Explicit swatch/ramp selection | `texture/palette`; reference identity outranks generic hue shifts (DOC) |
| P03 | [Aseprite color handling](https://www.aseprite.org/docs/color/) | Sprite color profiles | `texture/colorProfile`; preserving colors and changing bytes are different (DOC) |
| P04 | [Aseprite Sprite Properties](https://www.aseprite.org/docs/sprite-properties/) | Assign versus convert color profile | Recompute bitmap revision if source pixels are converted (DOC) |
| P05 | [Aseprite transparent color](https://www.aseprite.org/docs/transparent-color/) | Indexed transparent color is not universal RGBA semantics | Preserve hidden RGB in exact pixel migration (DOC) |
| P06 | [PixelJoint pixel-art critique](https://pixeljoint.com/forum/forum_posts.asp?TID=11299) | Cluster, banding, jaggies and AA concepts | `texture/pixelCraft` advisory evidence, never hard-coded taste score (COMMUNITY) |
| P07 | [Saint11 pixel tutorials](https://saint11.org/blog/pixel-art-tutorials/) | Surface clusters, material value and stylized shading | `texture/surfacePattern`; don't copy example sprite artwork (AUTHOR) |
| P08 | [LibreSprite](https://github.com/LibreSprite/LibreSprite) | Indexed/pixel-editor techniques in source-available product | Code GPL-2; principles only (CODE) |
| P09 | [Aseprite EULA](https://github.com/aseprite/aseprite/blob/main/EULA.txt) | Source visible does not mean permissively reusable | No copied engine/source/training by assumption (RIGHTS) |

### TX-01 — Intentional pixel clusters and detail-rest (2026-10-31; research-only)

This is an **evidence enrichment of existing** [TEX-P01](decision-cases.md#tex-p01-reference-material-palette-pixel-clusters), not another K3 case, texture style engine or default shader:

- [PixelJoint's pixel-art tutorial](https://pixeljoint.com/forum/forum_posts.asp?TID=11299) discusses clusters, banding, pillow shading and noise. A single isolated texel can be a legitimate glint/antialiasing pixel; cluster diagnostics alone cannot judge visual success (community author tutorial; rolling page).
- [Hytale's art-direction article](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) describes hand-painted form, selective baked shading, avoiding excessive grain and preserving independent model readability. **Do not** adopt Hytale's fixed texel density, proprietary material/shading modes or rendering assumptions for Minecraft Bedrock (first-party source; published 2025-12-22; rolling page).
- [Riot's portfolio art guidance](https://www.riotgames.com/en/portfolio-and-reel-suggestions) identifies distribution between detail-rich and visually resting areas as a craft consideration, not a quantitative rule (first-party editorial guidance).
- [80 Level's stylized-environment artist interview](https://80.lv/articles/creating-modules-for-stylised-environments) describes reducing small detail/noise to maintain readability and using painted-light treatment; this is an artist's reported workflow, not independently reproduced performance evidence.

**Positive probe:** an approved, region-specific material reference shows grouped directional value shapes, quiet base surfaces and sparse identity markings; exact source crop, part/face ownership, native UV and physical texel capacity support a compact `surface_pattern` and mapped painting decision. **Negative:** applying repeated texture noise, uniform metal scratches or an equally bright outline to all faces when these details obscure the focal form. **Ambiguous:** intentional point highlights, stippled/dithered art direction, insufficient texels, mismatched render lighting or absent crop → abstain / `REVIEW_REQUIRED`, do **not** auto-smooth or repaint. Confirm from the mapped shaded model, not atlas statistics alone.

**Consumer:** existing `mcp/lib/texture/pixelCraft.ts` supplies bounded advisory cluster evidence; `treatmentPlan.ts`, `surfacePattern.ts` and the current Texturing specialist choose only a current evidence-supported action. No extra public Gateway tool, model weights, bulk source images or new decision index. `TEX-P01` selection behavior and source-native-human proof boundaries remain unchanged.

## G. AI/procedural texturing research — transferable ideas without new model inference

**Paper license, code license, dataset rights, model weights and source images are independent.** This section supports decision design and counterexamples only: no training, model download, inference or GPU requirement.

| ID | Primary source | Specific observation | Transfer / limitation |
| --- | --- | --- | --- |
| R01 | [TEXTure 2023](https://arxiv.org/abs/2302.01721) | Tri-map/progressively textured-region mask across views | `texture/selection`; transfer coverage ownership logic, not diffusion dependency (PAPER) |
| R02 | [Text2Tex ICCV 2023](https://openaccess.thecvf.com/content/ICCV2023/html/Chen_Text2Tex_Text-driven_Texture_Synthesis_via_Diffusion_Models_ICCV_2023_paper.html) | New/partially filled/unseen texture regions in view loops | Unknown backsides require source review; do not hallucinate as observed (PAPER) |
| R03 | [TexFusion ICCV 2023](https://openaccess.thecvf.com/content/ICCV2023/html/Cao_TexFusion_Synthesizing_3D_Textures_with_Text-Guided_Image_Diffusion_Models_ICCV_2023_paper.html) | Shared latent texture consistency across views | Preserve atlas ownership/consistent identity (PAPER) |
| R04 | [SyncMVD code](https://github.com/LIU-Yuxin/SyncMVD/tree/faa95621d220d7327847a994cd380608c04af5ab) | Synchronization of generated views | `texture/seamContinuity` conceptual; code MIT does not grant weights rights (SOURCE/PAPER) |
| R05 | [Paint3D 2023](https://arxiv.org/abs/2312.13913) | Texture refinement and baked-illumination removal | Minecraft deliberately painted highlights may be identity, not artefact (PAPER) |
| R06 | [TexGen 2024](https://arxiv.org/abs/2408.01291) | UV-referenced progressive texture synthesis | Canonical face/texel ownership matters more than source-view pixel count (PAPER) |
| R07 | [TexOct CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/html/Liu_TexOct_Generating_Textures_of_3D_Models_with_Octree-based_Diffusion_CVPR_2024_paper.html) | Octree material representation alternative | Reject new volumetric texturing engine for Bedrock Cube (PAPER) |
| R08 | [GenesisTex CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/html/Gao_GenesisTex_Adapting_Image_Denoising_Diffusion_to_Texture_Space_CVPR_2024_paper.html) | Texture-space denoising and seam work | Research UV consistency only (PAPER) |
| R09 | [TexGarment CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Liu_TexGarment_Consistent_Garment_UV_Texture_Generation_via_Efficient_3D_Structure-Guided_CVPR_2025_paper.html) | Garment structure guides texture continuity | Directional fabric motifs, but garment ML not general Minecraft default (PAPER) |
| R10 | [TEXTRIX CVPR 2026](https://openaccess.thecvf.com/content/CVPR2026/html/Zeng_TEXTRIX_Latent_Attribute_Grid_for_Native_Texture_Generation_and_Beyond_CVPR_2026_paper.html) | Attribute-grid texture representation | Don't replace native PNG+UV pipeline for semantic grid (PAPER) |
| R11 | [Make-A-Texture WACV 2025](https://openaccess.thecvf.com/content/WACV2025/html/Gorelik_Make-A-Texture_Fast_Shape-Aware_3D_Texture_Generation_in_3_Seconds_WACV_2025_paper.html) | Shape/view mask for unpainted faces | Prioritize important visible regions, don't infer unseen details as factual (PAPER) |
| R12 | [TextureDreamer CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/html/Yeh_TextureDreamer_Image-Guided_Texture_Synthesis_Through_Geometry-Aware_Diffusion_CVPR_2024_paper.html) | Texture generation grounded in real image views | Source-paired views needed; photorealistic diffusion not vanilla style (PAPER) |
| R13 | [Material Anything CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Huang_Material_Anything_Generating_Materials_for_Any_3D_Object_via_Diffusion_CVPR_2025_paper.html) | Materials and PBR confidence estimates | Explicit PBR intent only; source confidence not inferred from labels (PAPER) |
| R14 | [HiTem3D 2.0 2026](https://arxiv.org/abs/2604.09231) | Surface completion where input views are incomplete | Unseen identity may be plausible but still UNOBSERVED (PAPER) |
| R15 | [MVPainter 2025](https://arxiv.org/abs/2505.12635) | Multi-view color/geometry texture coherence | Compare same reference views before a seam verdict (PAPER) |
| R16 | [SeqTex 2025](https://arxiv.org/abs/2507.04285) | UV-native sequence generation | Research ordering only; no native ML dependency (PAPER) |
| R17 | [SuperMat ICCV 2025](https://openaccess.thecvf.com/content/ICCV2025/html/Hong_SuperMat_Physically_Consistent_PBR_Material_Estimation_at_Interactive_Rates_ICCV_2025_paper.html) | Separating surface reflectance and lighting for material inference | Do not auto-convert painted color to 'true PBR' (PAPER) |
| R18 | [Text2Scene CVPR 2023](https://openaccess.thecvf.com/content/CVPR2023/html/Hwang_Text2Scene_Text-Driven_Indoor_Scene_Stylization_With_Part-Aware_Details_CVPR_2023_paper.html) | Per-part semantic material styling | `texture/treatmentPlan`; adopt region decision grammar only (PAPER) |
| R19 | [Text2Tex code repo](https://github.com/daveredrum/Text2Tex) | Noncommercial licensed code reported in repo | No commercial code transfer or model training permission (RIGHTS; reverify license at use) |
| R20 | [NVIDIA TexFusion project](https://research.nvidia.com/labs/toronto-ai/texfusion/) | Research demo of consistent multi-view texturing | Video/demo is not evidence of Minecraft output (PAPER) |

## H. Marketplaces, community models, asset rights & benchmark candidates

| ID | Primary source | Specific observation | Transfer / limitation |
| --- | --- | --- | --- |
| C01 | [Blockbench Workshop Browse](https://blockbenchworkshop.com/Browse) | Mixed license model catalog | Per-item license needed; no model scraping/training (CATALOG) |
| C02 | [Workshop Minecraft models](https://blockbenchworkshop.com/models/minecraft) | Asset categories/community visual references | Don't treat all samples as authoritative quality cases (CATALOG) |
| C03 | [MCModels](https://mcmodels.net/) | Paid/creator marketplace for Minecraft models | Paid access != training/resale/redistribution rights (CATALOG) |
| C04 | [MCModels about](https://mcmodels.net/information/about) | Marketplace provenance | Quality claims require actual separately licensed model inspection (CATALOG) |
| C05 | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/8f492390ddc7a2ae221a1369ef560589cf8c70fb) | Real UV/PBR sample assets, each model own license | glTF source not Bedrock-native; per-model licensing (CATALOG) |
| C06 | [Poly Haven license](https://polyhaven.com/license) | CC0 asset program with website access terms | CC0 files != permission for any scraping approach (RIGHTS) |
| C07 | [Poly Haven texture standard](https://docs.polyhaven.com/en/technical-standards/textures) | High-res PBR material-map expectations | Not directly pixel-art/Bedrock compatible (DOC) |
| C08 | [Kenney support/licenses](https://kenney.nl/support) | CC0-style packages subject to item conditions | Check each package and format (RIGHTS) |
| C09 | [Smithsonian Open Access 3D](https://3d.si.edu/collections/openaccesshighlights) | Open-access artifact models/material references | Item-specific rights; complex scans not Minecraft models (CATALOG) |
| C10 | [Objaverse-XL](https://github.com/allenai/objaverse-xl) | Source metadata and heterogeneous third-party 3D files | Dataset loader license does not clear each model for training (RIGHTS) |
| C11 | [ambientCG creator profile](https://www.artstation.com/ambientcg/profile) | Discovery of PBR material artwork | Licensing **not verified at item level**; research discovery only (CATALOG) |

## K2 candidate decisions — prioritize observed gaps, not number of sources

| Candidate | APPLY when | REJECT / REVIEW when | Actual LazyDesigner owner and negative test | Priority |
| --- | --- | --- | --- | --- |
| UV-K01 Box/per-face | Native Box map remains valid, preserve simple path | Per-face conversion merely for packing aesthetic | `mcp/lib/uv/boxUvPolicy.ts`; no implicit conversion | P1 |
| UV-K02 signed UV | Source quarter-turn + physical mapping known | Flipped mirrored asymmetric eye/text wrong way round | `mcp/lib/uv/facePixelMapping.ts`; 0/90/180/270 and u/v flips | P0 |
| UV-K03 texel density | Fractional logical UV maps to integral physical pixels | Fraction maps to nonintegral physical pixel | `mcp/lib/uv/physicalEvidence.ts`; 0.5 logical at 2× valid, 0.25 at 2× not | P0 |
| UV-K04 sharing/stacking | Explicit same artwork ownership and matching dimensions | Same UV region wants different wear, light, identity | `mcp/lib/uv/stacking.ts` + `mcp/lib/texture/treatmentPlan.ts`; conflict must not paint | P0 |
| UV-K05 packing | Cohort locality improves without moving locks/breaking gutters | Occupancy alone increases but islands scatter | `mcp/lib/uv/packing/planner.ts`; all hard constraints enforced | P1 |
| UV-K06 painted migration | Complete project+atlas+PBR/variant revisions, rollback/Undo verified | Nonzero RGB even alpha=0, animated/layered bitmap, stale source | `mcp/lib/uv/pixelMigrationTransaction.ts`; exact RGBA and OUTCOME_UNKNOWN | P0 |
| TEX-K01 reference palette | Observed color hierarchy and part identity | Generic hue shift overwrites unique marks | `mcp/lib/texture/treatmentPlan.ts` and `palette.ts`; unknown stays review | P1 |
| TEX-K02 pixel grammar | Value clusters/material cues fit actual texel size | Salt/pepper noise or small unreadable detail | `mcp/lib/texture/pixelCraft.ts`; metrics advisory only | P1 |
| TEX-K03 seam intent | Exact observed and comparable edge pair exists | Missing edge/sample or 3-way ambiguity | `mcp/lib/texture/seamContinuity.ts`; never claim all-face clean from partial | P0 |
| TEX-K04 alpha/render/PBR | Explicit Minecraft consumer and target rendering profile | Bright pixels assumed emissive or MERS alpha confused with opacity | `mcp/lib/texture/renderProfile.ts` and `pbrContent.ts`; wrong channel fails | P0 |
| TEX-K05 variant parity | Base atlas + variants use compatible UV and PBR dimensions | Resized or foreign variant loses alignment | `mcp/lib/texture/variantPlan.ts`, `productionAlignment.ts`; mismatch gate | P1 |
| TEX-K06 unseen views | Actual reference shows texture/art per view | Synthesized unseen side called user-approved | `mcp/lib/texture/treatmentPlan.ts`; unknown -> REVIEW_REQUIRED | P1 |
| GOV-K01 rights | Idea or metadata is researched, any asset rights separately confirmed | Mojang EULA, NC code, paid model presumed training data | K3 provenance + license gate; no source import without grant | P0 |

### Critical counterexamples to prevent false transfer

1. **Unreal lightmap UV != Bedrock color UV.** Uniqueness in lightmap generation does not prohibit intentional mirrored/shared texture pixels.
2. **Substance 3D padding 2D != 3D seam continuity.** Dilating atlas boundaries doesn't prove the visible neighboring Cube edges match in-world.
3. **High-res PBR photo textures != Minecraft pixel styling.** Material detail can be technically rich but destroy intentionally coarse pixel clusters.
4. **Generative AI plausible completion != observed reference.** Rear-facing or hidden details must remain unverified when not shown.
5. **Code OSS/CC0 item/free marketplace != training license for all artifacts.** Source rights, asset rights, dataset rights and weights rights remain independent.
6. **Valid JSON/compiler receipt != visual fidelity.** Full mapped model, alpha/material and actual Minecraft export need future matching native proof.

## Checked first-party source specifics

- Mojang sample `bee.geo.json`, `armadillo.geo.json`, `allay.geo.json`, `axolotl.geo.json`, `creaking.geo.json`, `copper_golem.geo.json`, `enderman.geo.json` and `ender_dragon.geo.json` contain Box-style UV arrays. Enderman, Copper Golem and Ender Dragon have authored `mirror:true` occurrences. This is a **sample cohort**, not proof that all assets use Box UV.
- Mojang sample texture-set JSON read for Bee, Creaking eyes, Copper Golem, temperate Frog, blue Axolotl and Dragon eyes; each uses `format_version: 1.21.30` and `metalness_emissive_roughness_subsurface` paired with a named color. Repository SHA is newer than format_version; these are distinct version fields.
- Blockbench source verified on pinned SHA for `uv.js`, `uv_size.ts`, `texture_generator.js`, `painter.js`, `textures.js`, `texture_groups.js` and `formats/bedrock/bedrock.js`. Native source inspection is not an executed installed plugin test.
- License source verification: Mojang `LICENSE.md` is all-rights-reserved/EULA; Blockbench repository GPL-3.0. Paper, code, model and dataset rights cannot be inferred from each other.

## K3/K8 test scenario preparation — no test executed

1. **Vanilla-simple Box UV**: same native model and approved reference, no unnecessary per-face conversion, mapped UV and export preserved.
2. **Asymmetric mirror identity**: left/right eye labels distinguish whether intentional shared pixels remain semantically valid.
3. **Painted atlas migration**: complex cyclic UV swap, alpha=0 nonzero RGB, PBR and variants; no data loss, correct native Undo/save/reopen once tool is actually registered.
4. **Creaking-like separate eyes**: verify material assignment instead of inferring opacity/emissive from eye file naming.
5. **Copper-like oxidation variants**: identical shape+UV but different authored material identity, keep PBR aligned.
6. **Cross-Cube visible seam**: observed edge pair, identical material and controlled sampling; absence of coverage must not become PASS.
7. **Minecraft pixel material**: source-paired character wood/metal/cloth surface, preserve cluster/detail hierarchy at physical texel size.
8. **PBR/legacy target**: validate selected MER/MERS channel semantics in correct target, not only editor preview.

## Evidence and scope restrictions

- **Can learn:** documented and source-observed principles, domain boundaries, candidate heuristics, compatibility requirements, disqualifying examples and legal restrictions.
- **Cannot claim now:** art/texture rights, source-code reuse rights not individually checked, generic multi-view inference fidelity, production-ready knowledge decisions, executed regression PASS, native Undo/rollback or visual Bedrock acceptance.
- **No new engine, model weights, training dataset, source registry, Runtime tools, CI enablement or release.** `manage_uv_layout` remains **UNREGISTERED**. Geometry is frozen; Animation deferred.
- **Next K2:** remove already-covered behavior from the prospective implementation backlog, prioritize P0/P1 decisions with a specific wrong consumer, source-level provenance and paired negative cases. Load only selected sources for K3, not all records in a normal authoring hot path.

## I. Selected voxel material/style studies (2026-11-01; research-only)

These cases record observations from static publisher artwork, NOT raw atlas pixels, measured UVs, exact color values, shader channel evidence or approved art direction for any current asset.

| Case | Source/evidence | Observed contrast / research question |
| --- | --- | --- |
| TV-01 | [Bepoo Warchief](https://bepoo.netlify.app/assets/optimized/3dmodel-goblin_warchief.webp) (PAGE+IMAGE) | Pale bone, dark gray armor, muted metal trim, vivid red banner and hair occupy material/focal regions. Does the *approved* reference call for localized contrasts rather than equal detail everywhere? |
| TV-02 | [Bepoo Zombies](https://bepoo.netlify.app/assets/optimized/3dmodel-zombies.webp) (PAGE+IMAGE) | Cohesive undead skin palettes coexist with class-specific equipment and bright accents. Do not overwrite unique marks with one generic hue shift |
| TV-03 | [Bepoo Haunted Furniture](https://bepoo.netlify.app/assets/optimized/3dmodel-haunted_furnitures.webp) (PAGE+IMAGE) | Wood, paper/books, dark electronics and pale covering have different surface treatment. Reject a single random noise pattern applied to every material |
| TV-04 | [Quinten MEGAMECH](https://quintenbench.wixsite.com/rizaan/overlords) (PAGE+IMAGE) | Dark industrial body and bright functional core produce focal contrast; render lighting is not evidence of actual emissive or PBR maps |
| TV-05 | [Saint11 — Cluster Sketching](https://saint11.art/pixel_art_articles/article2/) (primary PAGE) | Start with large connected color regions then refine small details. The author explicitly permits useful individual-pixel exceptions; never impose arbitrary pixel quotas |
| TV-06 | [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) (official PAGE) | Documents purposeful color ramps, hue shift, banding/noise, model-vs-texture and scale. Vanilla-centric rules are NOT automatically universal for stylized fantasy |
| TV-07 | [Amonde Goblin Boss](https://mcmodels.net/products/13290/goblin-boss) (PAGE+PREVIEW) | Product claims 16x and consistent Goblin Mobs theme; bright/cartoon family should not be merged into dark Warchief family. Marketing resolution does not prove craft quality |

Candidate contrast for current TEX-P01–TEX-P03: POSITIVE material separation, deliberate color clusters, focal accents and mapped-face readability; NEGATIVE undirected speckle/dither, banding, uniform detail distribution, mixed effective pixel scales or painting over geometry defects; AMBIGUOUS when only lit promotional image is available. Compare neutral matching views and original mapped atlas before any promotion. Source RGB, UV seam integrity, full PBR and native visual PASS remain UNKNOWN.

Third-party source images and model textures are copyright-restricted reference links only; no rights to copy, harvest, redistribute or train. No new runtime style system, Skill/standard/casebook update or executable proof.

## J. Cross-artist premium texture and material research (2026-11-01; RESEARCH ONLY)

**Inspection types:** PAGE+IMAGE = primary product/artist page and its static art examined; THUMB = original community thumbnail only; TECH = first-party technique article read. Promotional PNG pixels are NOT the source atlas, UV ownership, display-linear base color, material channel or native texture. Classify style quality *per work and intended family*, not by texture resolution alone.

### J1. Work-level visual material studies

| ID / source | Actually visible treatment | Strong candidate versus style-conditional rejection |
| --- | --- | --- |
| TV-08 [Cozy Bamboo Furniture, Fullcourse Store](https://mcmodels.net/products/15738/cozy-bamboo-furniture-dyeable), [full sheet](https://api.mcmodels.net/storage/product-images/15738/01KFS1D6NJ1XFR0BQDQ811NKMN.png) (PAGE+IMAGE) | Tan bamboo weave on furniture frames, repeated teal upholstery and patterned strips, pale pillow/bedding inserts; similar motif language makes disparate functional objects feel related | Study material-wide hue/value grammar and what should remain unique to fabric, timber, wicker, metal and light. Reject indiscriminate identical noise per material and universal cushion patterns |
| TV-09 [Yeti Boss, DepartmentQDE](https://mcmodels.net/products/15711/yeti-bosss), [front + side](https://api.mcmodels.net/storage/product-images/15711/01KFESC5Y12NMEMQ8PQX4V92WW.png) (PAGE+IMAGE) | Large cyan-blue fur regions carry different value clusters from purple horns/paws; darker mouth/eye region directs focus. Surface patterns are more strongly grouped than uniformly speckled | Premium cartoon-fantasy contrast, not a grim/bone-metal palette template. Publisher lists texture resolution "16", which must not be read as exact atlas 16x16 or proof of effective texel ratio |
| TV-10 [Raccoon Trader, Logan Kant](https://blockbenchworkshop.com/model/logan_kant/raccoon-trader) (PAGE+THUMB) | Light muzzle/eye region, dark paws, red scarf and brown-green hat read distinctly within a small body; accessory colors reinforce personality | Separation of facial and accessory regions can do more than high-frequency texture. Uploader reports 64x64 texture, but color values, cluster sizes and mapped faces were not inspected |
| TV-11 [Ender Whale, Logan Kant](https://blockbenchworkshop.com/model/logan_kant/ender-whale) (PAGE+THUMB) | Dark indigo shell dotted with magenta/nebula-like detail; creator describes star-filled sides | Borderline **visibility** example: luminous small accents cannot by themselves establish global silhouette on a black preview. Need multiple neutral backgrounds before claiming universal readability. 256x256 listing not guarantee source pixel rhythm |
| TV-12 [Nitgo, Dread](https://www.planetminecraft.com/blog/dread-3d-model-block-bench/) (PAGE+IMAGE) | Dark purple shell mass, sparse cyan edge marks and tips suggest sci-fi material/functional anatomy | Distinguish paint/emissive color from screenshot lighting; do not confuse a dark on dark render with a complete evaluation of mapped surfaces |
| TV-13 [BasModel, Thai Lotus Guardian](https://mcmodels.net/products/12092/thai-lotus-guardian), [set montage](https://api.mcmodels.net/storage/product-images/12092/01J2661MB4NG5BYS0GJMAH5QQ7.png) (PAGE+IMAGE) | Repeated saturated green ornaments against bronze/brown shafts and pale blade edges tie weapons, accessories and character theme together | Preserve identity-bearing accents, but crowded collage does not prove every item balances materials or has correct UV seams. Publisher lists resolution 64; exact texel distribution unknown |
| TV-14 [Bepoo, Samurai Models](https://bepoo.netlify.app/assets/optimized/3dmodel-samurai_models.webp) (PAGE+IMAGE) | Red/orange armor plates, dark seams and gilded trim concentrate contrast on layered chest/shoulder/helmet areas, with different values across a set | Distinct historic-fantasy family from ice creature or cozy furniture. Do not demand identical armor ramps for all displayed pieces |
| TV-15 [Bepoo, Staffs](https://bepoo.netlify.app/assets/optimized/3dmodel-staffs.webp) (PAGE+IMAGE) | Five staves differ in headpiece silhouettes and fire/ice/ender/necromancy value families while keeping readable handles | Strong contrast of *material and energy identity* through bounded focal colors; generated VFX sparkles are not proof of painted emittance or true texture alpha |
| TV-16 [Violet, Nintendo DS Lite](https://blockbench.net/gallery/) (official PAGE+IMAGE) | Pastel-pink electronics with pale bevels and dark screen framing; tiny buttons and pixel UI act as identity marks distinct from physical hinge geometry | Precision prop should favor controlled small high-contrast features, not random wear intended for an undead boss; gallery render cannot prove original screen UV coordinates |
| TV-17 [Raccoon/Crab/Whale Workshop works](https://blockbenchworkshop.com/creator/logan_kant) (PAGE metadata across three individual items) | Creator reports 64x64 for Raccoon and Crab, 256x256 for Whale; each serves different subject/motif | Resolution may legitimately differ within one creator's family; do not force one atlas dimension or derive an art-quality score from listed size |

### J2. Independent artist technique sources and a real style tension

| TECH source | Read from primary article | Qualified lesson for investigation — not a universal rule |
| --- | --- | --- |
| [Saint11, Cluster Sketching and Painting](https://saint11.art/pixel_art_articles/article2/) (2021; TECH) | Builds large contiguous same-color pixel regions, refines them, and corrects inconsistent jaggies; explicitly accepts isolated pixels for eyes, texture or important micro-details | Detect **meaningful connected clusters**, not ban all single pixels or invent a minimum connected component size. Strong exception: eyes and equipment accents |
| [Blockbench, Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) (TECH) | Purposeful hue/value ramps, jaggies/banding, dithering, UV ratio, noise and the distinction between Geometry and Texture. The author notes non-Vanilla styles may depart | Use for Minecraft-native scenarios. A stylized fantasy project may use different intentional proportions, overscaled masks or materials. Do not import every Vanilla constraint as mandatory |
| [Hytale art director Thomas Frick, Making Models for Hytale](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) (2025-12-22; TECH) | Hytale treats textures as illustrations; uses pencil, *also selective soft brush*, painted shadows and nuanced color; avoids both uncontrolled grain and perfectly flat surfaces. Renderer enhancement is secondary to model looking good without effects | This intentionally differs from a strict pixel-only/pencil-only reading of Vanilla. Research should classify **stylized hand-painted voxel** versus **strict hard-edge pixel art** as related but distinct treatments, rather than asserting that every soft-edged pixel is bad. Hytale-specific shader/texture ratios are not Bedrock policy |
| [Riot Games Character Art](https://www.riotgames.com/en/artedu/character-art) (TECH) | Translating character concepts to a small in-game model depends on proportion, likeness and readability | Supports inspecting *practical-scale appearance*, not exact sampled textures or an industry-mandated palette |

**Key contradiction resolved as research question, NOT new style lock:** Strict Vanilla / deliberate hard clusters and Hytale painterly 3D surfaces optimize different art languages. The user's three example images favor **visible authored voxel clusters with stylized depth**, but do not establish an exact brush prohibition, minimum shade count, or universal density across object types. If we force a single texture rule, either premium style could be degraded. Separate authoring evidence by intended visual family.

### J3. Non-negotiable evidence honesty during research

- **Base texture ≠ render.** Bloom, shadows, tone mapping and screenshot background change the apparent color. Do not infer emissive map, physically based metallicity, atlas palette or pixel density from lighting.
- **Visual repetition ≠ shared UV.** Repeated geometric motifs across a product sheet do not prove common atlas islands, same colors, per-face orientation or mirrored UV, especially when models ship separately.
- **One saturated accent can be an identity signal.** Negative case is uniform maximum saturation/contrast on every component; positive only if the *approved style* calls for such a focal region; ambiguous when VFX occupies the focal area.
- **Not a global noise ban.** Fine pixels can be deliberate grain on stone, wicker, bark or eyes; reject unstructured random speckle that erases intended clusters. Do not confuse dithered material with poor art solely because it is detailed.
- **No fixed atlas/texel quota.** Marketplace "16"/"64" fields, Photoshop-size images and JPEG/PNG presentation are not interchangeable with source atlas dimensions or per-face physical texel evidence.
- **No copying.** These are cited visual observations. Source textures, marketplace listings, creator copyrights, model rights and AI/training permissions remain separate. No external texture or copyrighted image entered the repo.

**Still UNKNOWN:** original face-level paint and UV mapping, partial transparency, texture baking, actual material channels, pixel-scale continuity across joints, neutral-light versus authored-light result, and whether any of these works would improve a selected LazyDesigner asset. No tests or code changes while research continues.

## K. Third cohort: shape-to-paint correspondence and deliberate color ramps (2026-11-01; RESEARCH ONLY)

Every observation below is about a viewed artist image or original product page, not a sampled source atlas. PAGE=work listing; IMAGE=static artwork; META=publisher-provided texture dimensions; SOCIAL-IMAGE=artist artwork surfaced, original social post inaccessible. File-level colors, UV ownership, PBR and texture reuse remain UNKNOWN.

| ID and source | Actual visible texture/material cue | What it teaches, and what cannot be inferred |
| --- | --- | --- |
| TV-18 [Naldo Anglerfish](https://x.com/Naldo_Nerdlo/status/1331197958193377280) (SOCIAL-IMAGE) | Same image includes painted flat sheet and modeled fish. Orange-brown body bands, darker patterned fins, high-value teeth and tiny lure accent. | Best new bridge between form and paint. Original PNG/UV, texel count and how flat regions map to Cubes not inspected; image must not be traced or copied. |
| TV-19 [AnyVoice Piglin Boss](https://x.com/AnyVoice_/status/1846532038267981839) (SOCIAL-IMAGE) | Sparse bright cyan eyes/crystal tips contrast with dark costume, warm face and muted metal/gold accents. | Localized focal color, not maximum saturation everywhere. No proof of physical emission or original RGB. |
| TV-20 [Banathes Pumpkin Pack](https://mcmodels.net/products/10456/pumpkin-pack) (PAGE+IMAGE) | Consistent orange-brown pumpkin, green vine and bright carved-eye family across diverse model forms. | Shared palette/motif does not entail one atlas or identical forms. Archived listing no acquisition rights. |
| TV-21 [DepartmentQDE Slime Boss](https://mcmodels.net/products/15960/slime-bosss) (PAGE+IMAGE) | Deep-to-light green body regions with very bright eyes/teeth read as slimy in marketing render. | Material appearance can be paint + shape; actual alpha/translucency or animated texture unproven. |
| TV-22 [Experience Golem](https://mcmodels.net/products/8804/experience-golem-boss) (PAGE+IMAGE) | Restrained desaturated dark green and pale horns/bright edge lines signal rigid golem. | Different material than similarly green slime: reject single generic green texture treatment. |
| TV-23 [Ruin Sentinel](https://mcmodels.net/products/17484/the-ruin-sentinel) (PAGE+IMAGE; HOLD) | Cyan glowing geometric runes contrast with black stone shell, under heavy render lighting. | Publisher separately describes emissive/animated **weapon** texture, not verified boss-emission channels. Never sample bloom as atlas RGB. |
| TV-24 [Eann Kintsugi](https://blockbenchworkshop.com/model/eanncrod/kintsugi) (PAGE+IMAGE+META) | Thin gold crack motifs on black wings/body, very dark against black thumbnail; one 1024x1024 texture declared. | Large atlas does not guarantee surface clarity. UV placement, effective physical texel scale, actual palette not seen. |
| TV-25 [Eann Visage Of War](https://blockbenchworkshop.com/model/eanncrod/visage-of-war) and [Minotaur](https://blockbenchworkshop.com/model/eanncrod/minotaur) (PAGE+IMAGE+META) | Pale ivory/gold angular planes versus more subdued dark combat materials. Publisher lists one 128x128 versus 256x256 texture. | Even one creator's works need different pixel scale/contrast. Atlas size is not a quality score. |
| TV-26 [Soggy Sanctuary Urn](https://blockbenchworkshop.com/model/fukuda1320/soggy-sanctuary-urn) and [Deity Statue](https://blockbenchworkshop.com/model/fukuda1320/soggy-deity-statue) (PAGE+IMAGE+META) | Old stone/moss, dark olive trim and pale worn motifs unify objects with differing form and detail. Urn: 5 elements, 3 textures; statue: 47 elements, one texture; both report 64x64. | Model/texture counts are not linked monotonically to artistic value; shared motif is not proof of common UV/atlas. |
| TV-27 [1CAMOU Dungeon Starter](https://1camou.itch.io/dungeon-starter-blockimagine) (PAGE+IMAGE; HOLD) | Vendor offers CC0 source PNG alongside AI-assisted model work; dark scenes and simplifications require individual isolation. | Having a retrievable atlas is not sufficient for premium pixel-art quality or permission to make a training corpus. |

### Artist technique synthesis with justified exceptions

[SLYNYRD Pixelblog #1 Color Palettes](https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes) explains hue shifts and controlled value/saturation ramps; his own color-step numbers are **personal choices**, not fixed targets. [Saint11 Cluster Sketching](https://saint11.art/pixel_art_articles/article2/) builds intentional contiguous colors from large to small; isolated pixels can remain useful for eyes and highlights. [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) addresses form-versus-paint, hue shifts and noise for its applicable Minecraft style. [Hytale art direction](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) permits a painterly voxel surface with selectively soft strokes; these are not universal Bedrock/Vanilla constraints.

Cross-artwork research conclusion: **pixel density and number of shades are poorer indicators than purposeful clusters, value hierarchy, material-specific treatment, and careful focal accents**. A small bright pixel, deliberate dither or soft edge may be valid within its visual family. Marketing lighting, color grading, atlas dimensions and source bitmap must not be conflated.

Rights remain source-specific and uncleared for copying, harvesting, redistribution or AI training. No source PNG, per-face UV, renderer material state or neutral light mapping was inspected. No production Texture rule, automatic treatment, engine or test introduced.


## L. Working Art-Craft Knowledge v0.1 — Texture (2026-11-01; RESEARCH SYNTHESIS)

**Purpose:** Preserve transferable *questions and distinctions* about high-quality authored voxel surfaces, rather than accumulate catalog links or manufacture a generic texture preset. This research sits in the existing Texture source owner, not the active styling standard, Pixel Art Style Lock, new runtime knowledge system or generator. No painted atlas, original third-party texture, Golden Asset or source-model test was produced.

**Evidence classes:** PRIMARY_TECHNIQUE = first-party artist tutorial read; IMAGE = actual rendered artwork inspected at its available quality; LISTING = vendor image/metadata; HYPOTHESIS = conditional cross-source inference; UNKNOWN = no actual source pixels or UV. A promotional render never establishes raw RGB, uv-to-face mapping, actual PBR/emission or production texture rights.

### TK-01 — Cluster intention beats automatic texture noise

**Primary technique:** [Saint11, Cluster Sketching and Painting](https://saint11.art/pixel_art_articles/article2/) starts from connected color regions, refines their shapes and fixes irregular jaggies. The author explains that isolated single pixels often introduce noise but can deliberately depict eyes, texture and sharp details (PRIMARY_TECHNIQUE). [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) warns that random noise, banding and unnecessary dithering can obscure the form in its Vanilla-compatible context.

**Observed artist contrasts:** [Cozy Bamboo Furniture](https://mcmodels.net/products/15738/cozy-bamboo-furniture-dyeable) visibly separates woven frame and quieter upholstery areas; [Eann Kintsugi](https://blockbenchworkshop.com/model/eanncrod/kintsugi) uses thin accent cracks rather than equally dense marks everywhere (IMAGE/LISTING).

**Working interpretation (HYPOTHESIS):** Distinguish *connected value/color regions with a visual job* from incidental high-frequency marks. The job might be volume, wear, material grain or identity. “Remove all tiny clusters” is NOT a valid universal instruction.

**Apply:** A source supports materially meaningful color groups and the current face actually has sufficient physical pixel area.

**Reject/defer:** Blind speckle on every face, blanket de-noising that destroys eye pixels, or importing strict hard-pixel constraints into an intentionally painterly style. Unknown source atlas or insufficient view resolution cannot establish whether an isolated pixel is intentional. Existing owner: Texture standard and surface-pattern; earlier TEX-P01 remains separate.

### TK-02 — A color ramp is a relationship, not an RGB formula

**Primary technique:** [SLYNYRD / Raymond Schlitter, Pixelblog #1](https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes) constructs value/saturation/hue-related ramps and explicitly describes his step sizes and saturation peaks as artistic preferences, not universal rules. [Blockbench's style guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) describes midtone-first shadow/highlight passes and hue shifting in a Minecraft context (PRIMARY_TECHNIQUE).

**Visual contrasts:** Dark armor/bone/red banner from [Bepoo Goblin Warchief](https://bepoo.netlify.app/models), icy blue/purple [Yeti Boss](https://mcmodels.net/products/15711/yeti-bosss), and tan/teal [Bamboo Furniture](https://mcmodels.net/products/15738/cozy-bamboo-furniture-dyeable) achieve different relationships rather than one fixed universal palette (IMAGE/LISTING).

**Working interpretation:** Ask which material dominates, which midtone provides identity, where shadows shift in hue and how accents should contrast at the intended display scale. Preserve material/family coherence without turning hue shift degrees, shade counts or individual sample RGB values into hard-coded constants.

**Apply:** Approved color references have recognizable relative value/color groups; actual atlas painting is allowed only after corresponding face/part evidence is known.

**Reject/defer:** Taking display-render colors as PNG samples, automatically increasing saturation on every material, claiming a fixed number of shades is inherently premium, or imposing a generic ramp where one intentionally flat value is part of the art style.

### TK-03 — The same pixel pattern is not the same material

**Observed work comparisons:** [Bepoo Haunted Furnitures](https://bepoo.netlify.app/models) visibly differentiates wood, paper, electronics and pale fabric; [Experience Golem](https://mcmodels.net/products/8804/experience-golem-boss) and [Slime Boss](https://mcmodels.net/products/15960/slime-bosss) both feature greens but communicate distinctly rigid and viscous subjects; [Bamboo Furniture](https://mcmodels.net/products/15738/cozy-bamboo-furniture-dyeable) uses coherent motifs across structurally different props (IMAGE/LISTING).

**Working interpretation:** Material identity depends on selected edge treatment, directional marks, contrast distribution, amount of visual rest and local accent placement—not merely the nominal hue or the label “wood/stone/slime”.

**Apply:** Approved reference supports a recognizable substance difference and the surface is mapped to the correct part/material region.

**Reject/defer:** Identical random-grain algorithms on metal, cloth and stone; assuming transparency or normal/PBR/emissive channels merely because painted slime or energy looks glossy. Any exact texture recipe remains UNKNOWN without source face/UV information. Existing owner: surface-pattern and existing Texture/UV standard.

### TK-04 — Texturing dialects can contradict each other and still be good

**First-party contrast:** The [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) specifies hard-edged deliberate pixel treatment for Vanilla-style work and warns that the guide is not universally applicable to non-Vanilla art. [Hytale art director Thomas Frick](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) describes an intentionally hybrid stylized voxel + hand-painted texture language, including selective soft brush shading and lighting cues painted into surfaces. Hytale's renderer and numeric texture constraints are explicitly engine-specific (PRIMARY_TECHNIQUE).

**Working interpretation:** Strict hard-edge pixel art, illustrative voxel painting and stylized textured fantasy are **different eligible visual languages**. User-shared reference images establish the desired direction for a given asset; a source’s craft can be learned without adopting that source’s engine renderer, pixel density rule or exact brush.

**Apply:** When several artworks are being compared, first group them by the actual desired style family before judging cluster softness, material shading and pixel scale.

**Reject/defer:** Global prohibition on soft brush, global preference for anti-aliasing, or Hytale-specific 32/64-pixel density prescriptions for Minecraft Bedrock. Do not conflate a content style distinction with a separate Runtime route.

### TK-05 — Color/motif continuity across an asset pack is not one atlas

**Observed examples:** [Pumpkin Pack](https://mcmodels.net/products/10456/pumpkin-pack), [Soggy Sanctuary Stuffs](https://blockbenchworkshop.com/pack/fukuda1320/soggy-sanctuary-stuffs) and [Cozy Bamboo Furniture](https://mcmodels.net/products/15738/cozy-bamboo-furniture-dyeable) visibly repeat identity colors and shapes across different object classes (IMAGE/LISTING). [Soggy Sanctuary Urn](https://blockbenchworkshop.com/model/fukuda1320/soggy-sanctuary-urn) lists multiple textures despite few elements, whereas other objects report different texture counts. Publisher data is not a native atlas readback.

**Working interpretation:** A style family can share color relationships, detail rhythm and material conventions without sharing UV regions, exact bitmap dimensions, or even a uniform resolution. Pack identity and technical atlas identity are different concepts.

**Apply:** Studying an approved collection of visually related assets; ask which colors/marks signal shared world identity and which features belong to an individual object.

**Reject/defer:** A global palette file imposed on unrelated props, automatic UV stacking because motifs look similar, or forcing the same number of textures and pixels per model. Existing owners: approved reference family / Texture standard, with actual atlas ownership unchanged.

### TK-06 — Paint, light, VFX and PBR are separate appearance sources

**Primary source:** [Hytale art direction](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) describes painted shadows/highlights plus renderer effects while deliberately eschewing standard PBR for that game. Minecraft Bedrock and Blockbench have separate native rendering and PBR boundaries described in current Texture standards (PRIMARY_TECHNIQUE + existing repo policy). Marketing art such as [Ruin Sentinel](https://mcmodels.net/products/17484/the-ruin-sentinel) features bright colored linework and strong glow, but that alone is not the raw main atlas.

**Working interpretation:** Attribute an observed effect to its actual evidence owner only: base-color pixels, material/alpha/PBR map, animation/VFX, lighting/render, or UNKNOWN. Artist previews can reveal intended look without revealing technical implementation.

**Apply:** When a premium preview shows apparent glowing energy, shadows, glass or transparent slime, keep appearance as a *visual intention* until source material information exists.

**Reject/defer:** Inferring MER/PBR, emission mask, alpha blending or painted exact cyan from bloom or screenshots, or automatically enabling expensive texture treatment because a screenshot looks polished.

### Texture synthesis — conditional knowledge, not a paint recipe

Learning order: distinguish style family and intended material; identify large color/value groups and focal accents; ask which surface marks actually carry shape/material information; separate UV and real base-color data from renderer appearance; mark all missing pixel/face evidence UNKNOWN. This is a **research interpretation**, not an instruction to generate an atlas or call new tools. No actual source-pixel fidelity or improved LazyDesigner output has been established.

## M. Working Art-Craft Knowledge v0.2 — Lighting, material origin and perceived pixel scale (2026-11-01; RESEARCH SYNTHESIS)

This section extends TK-01–TK-06 with four more distinct art-craft decisions from newly read primary artist sources. The source material is not a portable reference atlas, a machine-training dataset, a new paint command or a verified premium texture. No production rule/engine or Golden Asset changes.

### TK-07 — Face-aware light and shadow placement

**Visual problem.** A flat side of a Cube is often painted with the same center-bright/dark-rim gradient as a rounded cheek, making every material look puffy. Conversely, treating a deliberately rounded mass as one perfectly flat color can suppress its form.

**Primary artist source.** [Saint11, Basic Shading](https://saint11.art/pixel_art_articles/article4/) distinguishes planar faces from curved volumes; he tends to keep flat faces relatively uniform, lets curved forms use directional ramps, and describes reflected, cast and specular illumination separately. He identifies pillow shading and excessive softening as form-misreading mistakes. [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) separately describes banding, noisy paint, pillow and pancake shading under its Vanilla-style boundary. [Blockbench Workshop / capu0410, Light Logic](https://blockbenchworkshop.com/tutorial/capu0410/pixel-art-shading-light-logic-clean-colors) reinforces one consistent imagined directional light and warns about concentric pillow shading; it is a short community teaching example, not a universal material law.

**Working decision:** First ask whether this is a large flat plane, bevel, rounded/stepped volume, deep cavity or decorative surface. Place coherent light/dark regions according to shape and intended light, not a symmetric border recipe. Aged fabric wear, line accents or deliberately painted ambient occlusion can be separate from directional illumination.

**APPLY:** Source views or explicit desired lighting support a readable plane orientation; the mapped face and current art family are known.

**REJECT / UNKNOWN:** Enforce flat face color everywhere, always add a one-pixel highlight to every edge, fake emission from a lit screenshot, or apply a fixed top-left direction when the approved source has a different light rig. Hytale's baked light conventions are not Bedrock rendering requirements. Original source atlas/normal direction remains UNKNOWN.

**Ownership:** Texture standard's value/form treatment plus existing surface-pattern/material distinction; this is an artistic consideration, not native light simulation.

### TK-08 — Material history, wear and shape should tell compatible stories

**Visual problem.** A collection of generic random dots cannot reliably express oxidized stone, carved masonry, splintered timber or woven upholstery because each material suggests different edges, fractures, folds and directional grain.

**Primary source.** [SLYNYRD, Pixelblog #13: Rocks](https://www.slynyrd.com/blog/2019/1/22/pixelblog-13-rocks) ties the look of rock to type, natural/environmental context, coherent contour and deliberate rendering; simply changing a rock's palette does not always make its shape appropriate. [Saint11's cluster method](https://saint11.art/pixel_art_articles/article2/) describes contiguous deliberate color areas and purposeful exceptions to one-pixel noise. [Hytale's artist direction](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) treats textures as illustrations that supply surface volume with intentional painted highlights and ambient shadows, avoiding both overwhelming grain and arbitrary flatness (Hytale-specific examples, not Bedrock policy).

**Working decision:** For a source-supported material, identify its cause/formation, the direction of its texture marks, the character of broken/worn edges, and the quiet regions necessary to preserve readability. Geometry and Texture may carry complementary evidence of the same material history.

**APPLY:** The actual visual reference includes visible fracture direction, wood grain, woven repetition or worn corners; no invented material lore is needed.

**REJECT / UNKNOWN:** One crack generator/identical dither on all materials, random uniform metal scratches, forced aged texture on a clean new prop, and interpreting cinematic bloom as painted luminous pigment. Exact pixels, physical texel capacity and sampled atlas are still UNKNOWN.

**Ownership:** TK-03 expands material distinction; GK-07 owns source-supported *volume*, and Texture/surface-pattern owns authored *paint*. Do not create a second shared recipe owner.

### TK-09 — Texel detail should follow what must be read, not the published atlas dimension

**Visual problem.** A huge atlas can still fail to communicate a tiny eye or ornament at intended display distance, and a smaller atlas can still make a simple object work. Nominal texture size is not face-level pixel evidence.

**Direct primary source.** [Hytale original art-direction article](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) explains why its artists assign higher character/attachment density than world props: faces, cosmetics and held items are read closer and convey emotion. The published 64/32 px-per-Hytale-unit distinction, texture multiples of 32, and permitted node stretch band are **specific to Hytale's renderer/editor** and not transferable Minecraft Bedrock standards. [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) describes Minecraft-specific UV scale consistency and warns about mixed effective pixel sizes. [Microsoft Blockbench primer](https://learn.microsoft.com/en-us/minecraft/creator/documents/blockbench?view=minecraft-bedrock-stable) explains each Cube face maps to particular atlas regions.

**Research interpretation:** Separate (A) source total atlas width/height, (B) actual mapped region per semantic face, (C) resulting physical pixel scale, and (D) the user's expected viewing distance and identity-bearing detail. These are **different** properties. No Hytale numeric rule becomes a Bedrock resolution target.

**APPLY:** Source model or reference actually demands a close-up facial/ornament feature, and real face UV/texture information exists to judge whether its mapped pixel budget can depict it.

**REJECT / UNKNOWN:** Promote a 1024x1024 marketing atlas over a 64x64 art piece on resolution alone; enlarge every surface indiscriminately; interpret glossy interpolation as more detail; infer UV reuse from repeated colors in screenshots. Actual atlas and source-to-face mapping remain UNKNOWN in current catalog-only examples.

**Ownership:** Existing UV physical-evidence and Texture material/style owners; not a new algorithm or texel-density preset.

### TK-10 — A tutorial's shade-count heuristic is not a universal art-quality law

**Primary tension.** [Blockbench Workshop / capu0410, Pixel Art Shading](https://blockbenchworkshop.com/tutorial/capu0410/pixel-art-shading-light-logic-clean-colors) recommends a beginner-facing maximum of **four shades per color** to prevent muddy shading. [SLYNYRD, Pixelblog #1](https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes) explicitly presents his own saturation/hue progression as one personal method rather than a mandatory formula; [Hytale art director](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) uses selectively soft painterly shading as part of a different visual dialect.

**What is genuinely learned:** Limited shades may help preserve clarity on a tiny icon, but a hard maximum of four would wrongly constrain premium textured fantasy, carefully painted organic volumes or close-up expressive features. More shades alone also do not guarantee good art.

**APPLY:** Treat palette restraint as a *question* about whether extra swatches add new visible information at the actual target size, within that artwork's style family.

**REJECT / UNKNOWN:** Prescribe four-shade/three-shade global limits, mandatory hue shift degree, mandatory midtone saturation peak or banned soft brush across all models. Compare the source's own goals and camera scale before drawing any judgment.

**Ownership:** Existing TK-02/TK-04 artist color/style hypotheses, not a newly mandated art profile.

### Cross-domain material lesson

The relevant artistic unit is *the mapped, visible material region*, not a PNG filename, color ramp alone or glittering render. Face shape (Geometry), physical UV/pixels (Texture/UV), material identity (Texture Styling), and visible light/VFX (render/animation) must not silently exchange authority. This research remains source-observational and has no native model, atlas or performance proof.

## N. Working Art-Craft Knowledge v0.3 — Visibility, edges and repetition (2026-11-01; RESEARCH SYNTHESIS)

These studies enrich artistic reasoning but are not paint recipes, exact source atlas samples, UV code, new Texture rules or model-generation tests. First-party editor documentation and named pixel artists' own written tutorials provide the observed statements; proposed adaptation to a specific Bedrock model is conditional.

### TK-11 — An occluded-at-rest face may be exposed and artistically significant

**Primary evidence:** [Minecraft Creator — Entity Modeling and Animation](https://learn.microsoft.com/en-us/minecraft/creator/documents/entitymodelingandanimation?view=minecraft-bedrock-stable) explicitly describes hiding cubes to paint otherwise occluded surfaces that can be revealed when the entity moves. Bedrock bone/UV data is a separate source of truth from the displayed hero pose.

**New art question:** Which actually mapped face becomes visible after the source-supported jaw, arm, wing, door or accessory changes pose? A genuinely revealed face may need consistent base color, material language and identity paint even if not visible at rest. This is NOT a requirement to lavish equal detail on every invisible face.

**APPLY:** Specific face/part and supported visibility change are established in current approved model/reference.

**REJECT/UNKNOWN:** An unseen back in a marketing image is guessed, all inner surfaces are filled from generic presets, exact UV islands are inferred from the screenshot, or static props receive arbitrary hidden paint. GK-09 owns form/occlusion, current Texture/UV standards own mapped pixels.

### TK-12 — Selective hand-authored anti-aliasing is not generic blur or UV filtering

**Original artist source:** [Saint11, Anti-Alias and Banding](https://saint11.art/pixel_art_articles/article5/) separates intended drawn contour from pixel-grid approximation. Intermediate-value pixels can clarify particular long stepped slopes, while overuse can make edges blurry; repeated parallel shade strips can create banding. The author explicitly allows style- and resolution-specific exceptions. [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) has a deliberately Vanilla-limited hard-pixel aesthetic.

**New decision hypothesis:** A deliberate crisp voxel step, a painterly soft transition, an edge needing a controlled halftone, an accidental UV seam and a texture-filtering artifact have **different causes**. An author can decide which individual pixels belong to an edge without universally requesting antialiased output or smooth sampling.

**APPLY:** Native authored pixel grid and target visual family are actually known and a particular outline or color transition is being interpreted.

**REJECT/UNKNOWN:** Blur all edges, remove all jaggies, equate bilinear sampler filtering with painted half-tones, or impose Vanilla no-soft-edge rules onto a user-approved painterly style. No source atlas or actual texture filtering settings of marketplace models were inspected. Cross-reference TK-01 clusters and TK-04 style dialect; no new painter tool.

### TK-13 — Tileable environment texture versus unique entity atlas identity

**First-party source:** [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) distinguishes block textures that must connect across adjacent repeated blocks from unique mapped entity faces. It illustrates a 3-by-3 arrangement as a teaching example of detecting conspicuous repetition; [Microsoft Blockbench introduction](https://learn.microsoft.com/en-us/minecraft/creator/documents/blockbench?view=minecraft-bedrock-stable) describes cube-face UV mapping.

**New art question:** Is the approved surface expected to repeat across a floor/wall or preserve unique face marks such as eyes, one-of-a-kind armor scratches and weapon emblems? Tileability and individuality are not quality rankings: each has a distinct artistic function. A shared pack palette does not prove all models share the same UV islands.

**APPLY:** The asset's surface is explicitly repeatable or intentionally face-unique and actual texture ownership is known.

**REJECT/UNKNOWN:** Repeating a unique face as a tile, making a brick seamless by duplicating the whole character's atlas, or declaring a one-off emblem defective because it cannot tile. The example 3-by-3 image is source pedagogy, **not a request for any LazyDesigner testing**.

**Rights/proof:** Sources were read as teaching materials. No original PNG/UV material from another creator was downloaded or licensed for copying or training; source pixels, effective physical texel size and native appearance remain unverified.

## O. Working Art-Craft Knowledge v0.4 — Appearance carriers and source-level UV identities (2026-11-01; RESEARCH SYNTHESIS)

**Evidence:** Mojang's published Goblin Chef text was read; Allay and Warden original geometry JSON were inspected at bedrock-samples revision 15701fa9c13923f12662984c32c124327e40e3d3. Source-specific canvas dimensions/UV entries are actual file facts, but the original pixel PNG was NOT viewed or sampled and the model was not rendered or opened in Blockbench. Do not treat the Vanilla source style as a mandatory artistic benchmark for premium voxel fantasy.

### TK-14 — A visible fine detail has competing appearance carriers

**Distinct decision:** If an object needs thin straps, a shaped ear, an eyebrow shadow or a physically raised buckle, should it be modeled with a tiny Cube, produced by authored alpha/edge paint or represented by color/shading on an existing surface?

**Primary source:** [Mojang 3D artist Peter Sheff, Creating a Goblin Chef — Part 2](https://learn.microsoft.com/en-us/minecraft/creator/documents/makerseriesmakingthegoblinchef?view=minecraft-bedrock-stable) describes adding smaller blocks during the texture phase, painting large colors before small, using the Eraser to define apron straps/ear shapes, and painted shadows under an eyebrow and on a spatula. [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) independently distinguishes shape-defining geometry from mapped surface detail and shows that alpha/planes may represent features in its Minecraft-oriented art style. These are **artist and editor methods**, not a measurement of what a specific final Goblin Chef pixel actually looks like in source PNG.

**Working interpretation:** A requested detail has a *visible purpose*, then a representation choice: (A) real 3D volume/occlusion; (B) alpha-shaped or thin mapped carrier where that is valid; (C) pigment/shading for marks that do not change required silhouette. Small geometry detail discovered during texture planning is possible, but it changes the Geometry owner and perhaps UV layout. Use the already existing domain boundaries; do not create a “late geometry repair engine.”

**APPLY:** Current approved art/reference and accessible face/part evidence distinguish a true 3D protrusion from a visually painted mark.

**REJECT/UNKNOWN:** Tiny protruding horns replaced with dark pixels, every cloth fold modeled in microcubes, unsupported alpha assumptions, inferring the original Goblin Chef atlas from a tutorial sentence, or copying its exact palette/detail design. Geometry source and raw texture pixels for Goblin Chef not inspected. Owner relation: GK-10 and existing Geometry-vs-Texture, Surface Pattern, Alpha and UV authorities.

### TK-15 — Shared atlas pixels and distinct rig parts can coexist

**Distinct question:** Does a left/right animated part have to occupy two different bitmap areas, or does repeated color automatically mean shared UV?

**Direct pinned Geometry evidence:** [Mojang Allay geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/allay.geo.json) defines separate left_wing/right_wing cubes with the same starting UV coordinate [16,14] and separate bone pivots, while the left/right arms use different offsets [23,6] and [23,0] on a 32x32 canvas. [Mojang Warden geo](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/warden.geo.json) uses two ribcage planes at UV [90,11] with a mirror flag on the left ribcage, on a 128x128 atlas. The exact original JSON was examined; the actual bitmap/sampled RGB and unseen faces were not (PINNED_NATIVE_SOURCE).

**Working interpretation:** Atlas-pixel ownership and bone-transform ownership are **orthogonal**: two separate moving parts can reference the same painted UV region, and another pair can use independent regions or explicit mirroring. This supplies concrete native evidence to previously documented UV-P01 and TK-05 without asserting either strategy universally optimal. It does NOT prove wing side coloring, seam quality or symmetric identity without the corresponding PNG.

**APPLY:** Reuse/mirror only when the current approved art truly expects equivalent surface treatment and the actual source/native UV+face orientation is known; preserve unique regions where wear, eye/badge identity, directional pigment or asymmetry requires them.

**REJECT/UNKNOWN:** Merging two different painted arms because they have the same silhouette; assuming each bone needs a unique texture island; counting duplicated UV offsets as automatically wasteful; judging visual quality by 32-versus-128 canvas dimensions. No new atlas-packing tool, UV mutation, cloned texture art or shader/PBR assumptions.

### One-character appearance chain — currently known vs unknown

Goblin Chef: published artist text describes **small 3D detail + eraser-defined cutout appearance + color/shadow painting**, but there is no raw file to resolve exact UV mapping. Allay/Warden: real JSON proves **spatial carriers + UV offsets + bone ownership**, but actual bitmap content and physical pixel appearance remain unexamined. Therefore do not claim that a web render provides exact sampled color, UV seam correctness, texture compression, emissive behavior or final visual quality. These are complementary research strengths, not interchangeable observations. Rights follow Mojang EULA; no downloaded/source PNG or new production rules.

## P. Working Art-Craft Knowledge v0.5 — Real embedded atlas versus visually convincing paint (2026-11-01; RESEARCH SYNTHESIS)

**Source levels separate:** (1) Original authoring PROJECT_JSON with UV field references and actual embedded PNG displayed; (2) CREATOR_IMAGE from Swuei; (3) WORKSHOP_THUMBNAIL and listing claims; (4) FIRST_PARTY_FORMAT docs. These are not equal to inspected 3D renderer pixels or permission to reproduce the texture. No new automatic texture treatment is introduced.

### Evidence deepening for TK-09 and TK-15 — 32x32 can coexist with many parts and clips

[Desert Dog project, pinned 9f7bfa2](https://github.com/Hoodgail/three-blockbench/blob/9f7bfa2152c5496ee879b53fa65badefb14e9a61/examples/models/desert_dog.bbmodel) was directly inspected as Blockbench Generic. The one embedded PNG was opened for research; project canvas, texture UV size and image are 32x32. The 99 cubes each have six face entries; all **594 face records** in this source reference texture index 0, with **48 distinct serialized UV-coordinate arrays** among the entries. The project has 27 groups and 23 clips. These numbers are *source anatomy facts*, not "48 unique pixel islands", 594 non-overlapping regions, actual texture painting skill, or visual PASS. Reuse and coordinate overlap cannot be judged from counts alone.

**Deeper interpretation:** Complexity in Cube count, bones and authored clip data is **orthogonal to nominal atlas resolution** and to the perceived quality of material painting. A face may share a small UV region, be mapped into a stretched area or have individually packed pixels; its true information capacity depends on actual face mapping and intended viewed scale. An embedded PNG permits inspection of source pixels, unlike a promotional JPEG, but still does not tell what each mapped face looks like during animation without interpreting its real transform/material context. This strengthens existing TK-09/TK-15 instead of creating a duplicate rule or a pixel-count target.

**REJECT:** "99 cubes therefore 99 separate detailed textures"; "32x32 proves this dog is an excellent premium texture"; "594 face records means 594 unique visual regions"; "23 clips imply high-resolution paint". **UNKNOWN:** source art ownership, rendered output, reference fidelity, face-level appearance and actual Bedrock-specific material behavior. Generic Model is not Bedrock export proof. No original atlas/model/animation was copied into this repository.

### Evidence deepening for TK-03/TK-06 — A creator's artwork can be stronger than its metadata

[Phoenix Guardian thumbnail](https://blockbenchworkshop.com/model/eanncrod/phoenix-guardian) displays warm orange/cream tips on brown-red mechanical rods, a few bright focal areas and darker armor-like center; this makes a mechanical fantasy subject readable at a glance. [Visage Of Malice thumbnail](https://blockbenchworkshop.com/model/eanncrod/visage-of-malice) has near-black body parts against a black background, causing its dark shading to be hard to evaluate; this is a **presentation/evidence limitation**, not proof the underlying texture itself is poorly made. Both claim one texture but different dimensions (256x256 versus 128x128), and neither original PNG or face UV was accessed.

[Swuei Quest Board](https://swuei.github.io/Portfolio/pictures/quest_board_sr.png) visibly separates bold red wooden roof planes, lighter notice paper and darker supports with green vegetation. It provides a stronger small-prop material legibility example than a complicated boss promotional scene when the task is specifically a notice board; its textures are not a transferable palette. The creator describes manually painted 16x assets and some 32x projects, but the individual model/atlas was not read.

**Source-rights exception:** Official [Blockbench bbmodel format documentation](https://blockbench.net/wiki/docs/bbmodel/) notes format_version 5.0 and possible breaking format changes; an editable source project does not automatically authorize copying its third-party artwork. [BOs Easy Model Entities repository](https://github.com/MarkusBordihn/BOs-Easy-Model-Entities) explicitly excludes its art assets from the software MIT license. The Hoodgail repo MIT license covers stated software/docs and cannot be presumed to clear all example artwork and its upstream provenance. No redistribution, asset extraction into LazyDesigner, model training set, generic UV unpacker or source painting implementation is authorized.

**No new TK card because these findings sharpen existing TK-03, TK-06, TK-09 and TK-15 rather than establishing a separate unresolved painting decision.** This is intentionally disciplined Knowledge curation, not a lack of research.


## Q. Working Art-Craft Knowledge v0.6 — Aesthetic variation without confusing the underlying texture source (2026-11-01; RESEARCH SYNTHESIS)

This cohort compares original single-work promotional thumbnails from [claypandaoff](https://blockbenchworkshop.com/model/claypandaoff/amethyst-seahorse), [anim](https://blockbenchworkshop.com/model/anim/skeleton-lord) and [nyxaris](https://blockbenchworkshop.com/model/nyxaris/chieftain). Actual screenshots were viewed, not raw PNG pixels/UV. Catalog texture metadata is not a source atlas and page-level usage licenses are independent of authoring technique. Keep Texture standards and existing TK-01..TK-15 unchanged.

### TK-16 — A convincing cosmetic variant preserves material contrast relationships, not merely hue distance

**Distinct question:** When two fantasy creatures share a near-identical visible silhouette, what makes alternate texture themes readable as *intentional variations of the same subject* rather than arbitrary color shifts?

**Observed artist example:** [Amethyst Seahorse](https://blockbenchworkshop.com/model/claypandaoff/amethyst-seahorse) and [Astral Seahorse](https://blockbenchworkshop.com/model/claypandaoff/astral-seahorse) have essentially matching visible body segmentation, snout and curled tail at the published thumbnail camera. Amethyst uses warmer lavender/violet planes and cream/pale band highlights; Astral uses cooler blue-violet/cyan-accented planes. In both static images, the snout, front plates, eye and distinct tail segments remain identifiable (IMAGE). Source files/bitmap RGB not inspected; there is no evidence that one is the other's source-pixel hue shift or that their UV islands are identical. Both list one 64x64 texture under a commercial Standard license, not permission to copy an atlas.

**Working artist interpretation:** A successful *approved cosmetic* alternative may change hue families while retaining recognizable light/dark separation and material reading at meaningful identity regions. Exact per-pixel ramps may legitimately differ for metal, stone, shell, skin or crystals. Repeated silhouette does not imply a duty to create a second distinct bone hierarchy. A variant that changes age/role/appendages may require Geometry as well and cannot be judged by palette alone.

**APPLY:** Approved user request is a skin/material/theme alternative for a known form; observed focal features and mapped materials remain visually identifiable at their intended scale.

**REJECT / UNKNOWN:** Force a whole-atlas RGB hue rotation with no regard for face/material boundaries; assume the two creator source textures are the same PNG with different HSL; force unique geometry for each cosmetic colorway; rank the purple version higher solely for saturation. Exact source color, UV, seam, PBR and rendering remain UNKNOWN. Existing TK-02 color relationships, TK-03 material identity and TK-05 pack language remain in charge; TK-16 isolates the *intentional cosmetic-theme transition* question.

### Source-specific visual comparisons — refine existing knowledge, not new cards

- [Skeleton Lord](https://blockbenchworkshop.com/model/anim/skeleton-lord): IMAGE shows bright magenta crystals/head accents amid pale skull/teeth, olive cloth and near-black structural gaps. **Observed hierarchy**, not sampled pigment: the strongest color is localized rather than uniformly distributed over all surfaces. A viewer comment praising expressiveness is a person's reaction, not actual observed time-varying motion. Five catalog textures and one listed 256x256 size do not establish five distinct material maps or exact style sophistication.
- [Chieftain](https://blockbenchworkshop.com/model/nyxaris/chieftain): IMAGE shows variegated green skin, ivory tusks/horns and deep brown straps/hair. A coarse green pixel rhythm appears across large head and upper body; compared with the user's textured Warchief, its material articulation/armor complexity differs. It is a **contrast** in texture density and style rather than evidence of a defect in its original source pixels. Two advertised textures of 256x128 do not imply alpha/PBR, dual outfits or universal high quality.
- [Fairlins](https://blockbenchworkshop.com/model/anim/fairlins): IMAGE shows flat lilac/pink outfit areas with few strong accents, appropriate to tiny cute villagers. Treat simplicity as style-specific visual rest, not inherently underpainting. The reported five 32x32 textures cannot identify whether they represent variations, separate materials or other project organization without reading actual source.

### Research rights boundary refined by original creator terms

[ACTG Australasian Swamphen](https://actg.itch.io/australasian-swamphen) claims CC0 for an adult/chick source pack; workshop [Ocean Bed](https://blockbenchworkshop.com/pack/atcg/ocean-bed) reports CC0 per item. These are candidates for later lawful *source studying*, but no source ZIP/PNG was acquired here. Workshop commercial [Amethyst Seahorse](https://blockbenchworkshop.com/model/claypandaoff/amethyst-seahorse) explicitly forbids resharing its files and limits its Standard use; public thumbnails are citation references only. On [ArtsByKev's Sketchfab professional examples](https://sketchfab.com/3d-models/end-behemoth-animated-blockbench-model-563bf10892ce484081c0248465c8801e), the **NoAI** notice forbids using the asset as generative-AI data/input; the research does not ingest that model or its textures. A software/project MIT license, uploader license badge, creator artwork copyright and any site acquisition terms are not interchangeable.

**Honest appearance boundary:** Source-page static art can support focal-color, silhouette and theme comparisons, but cannot certify original 64x64/256x128 atlas contents, UV ownership, actual face pixel continuity, motion-time flicker, shader/pigment provenance or performance in Blockbench/Bedrock. No new paint algorithm, texture loader, test or Golden Asset.


## R. Working Art-Craft Knowledge v0.7 — Appearance continuity across shape-state switches (2026-11-01; RESEARCH SYNTHESIS)

**Source:** Pinned Mowzie's Mobs Sculptor geometry and Java model source were read, as well as the official [Blockbench Face Rig guide](https://blockbench.net/wiki/guides/animation-expressions/). The Sculptor's original texture PNG was NOT opened or sampled. Copyright: [Mowzie's License.txt](https://github.com/BobMowzie/MowziesMobs-Public/blob/7aa17309337cbd4102efc418cba12a4983b1540c/License.txt) is All Rights Reserved; no copyrighted pixels/asset file or code are brought into this repository.

### TK-17 — A replaced visible carrier may need a related, not necessarily identical, material identity

**Original source facts:** [Sculptor geometry](https://github.com/BobMowzie/MowziesMobs-Public/blob/7aa17309337cbd4102efc418cba12a4983b1540c/src/main/resources/assets/mowziesmobs/geo/sculptor.geo.json) provides distinct alternate hand Cubes and the original model's declared texture dimensions of 128x64. [ModelSculptor.java](https://github.com/BobMowzie/MowziesMobs-Public/blob/7aa17309337cbd4102efc418cba12a4983b1540c/src/main/java/com/bobmowzie/mowziesmobs/client/model/entity/ModelSculptor.java) references a base Sculptor texture and switches open/closed geometry visibility at runtime. The [Face Rig guide](https://blockbench.net/wiki/guides/animation-expressions/) presents different mouth/eye shapes on different groups. These confirm alternative appearance CARRIERS, not the real bitmaps or how good the finished painted transitions look.

**New artistic question:** During a justified hand, eye or mouth-state switch, which visual identities should remain consistent (skin, eye shape language, readable focal contrast) and which must change for the intended expression? Material continuity across separately mapped faces need not imply one shared UV island, one PNG for every alternate state or identical colors on every expression.

**APPLY:** A current approved character/reference contains genuine alternate shape states, the mapped faces and intended material relation are known, and visual continuity/controlled contrast matters to the story.

**REJECT/UNKNOWN:** Blindly mirroring UV between differently shaped hands; assuming the alternate closed fist uses the same painted pixels; generating a new atlas for every facial pose; declaring perceived temporal continuity from source JSON without the rendered animation. This is distinct from TK-14 static detail carriers and TK-16 cosmetic recolors, while current UV/Texture owners stay authoritative.

**Evidence-sensitive material caution, extending TK-06:** The original repository lists both Sculptor base texture and a separately named highlight image. The inspected Java model selects the base texture; a separate client event calls the highlight image a Sculptor BLOCK glow resource. File-name similarity alone does NOT establish an emissive character texture or a second base atlas. Public [Mowzie's Mobs credits](https://www.curseforge.com/minecraft/mc-mods/mowzies-mobs) name a distinct Sculptor texture contributor, reinforcing independent artist/source rights. No original source PNG, UV-to-face paint or native rendered quality was established.


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

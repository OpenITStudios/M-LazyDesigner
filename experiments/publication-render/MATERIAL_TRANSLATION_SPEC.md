# ADR-R02 — Material Translation Contract for MCP-Authored Cube Renders

**Repository / branch:** OpenITStudios/M-LazyDesigner / `Render`  
**Date:** 2026-11-03  
**State:** source translation and structural GLB contract authored; **Bun, installed Blockbench, Blender 5.2 and visual proof NOT EXECUTED**  
**Depends on:** [ADR-R01 Object-to-Render Contract](./OBJECT_TO_RENDER_CONTRACT.md)  
**Purpose:** Preserve known material appearance when rendering the *existing* Blockbench Bedrock Entity object with the single LazyDesigner Cycles worker. No second Blender MCP, scene generator, Bedrock gameplay export or material inference from object type.

## 1. Architecture decision

The source of truth is the live MCP-authored Blockbench project. A native source snapshot is converted to a detached glTF/GLB still asset and imported by the trusted Blender Cycles worker. Source and material provenance are hashed; the original project is not edited.

**Separate five material namespaces:**

| Namespace | Real source owner | What it says | What it DOES NOT say |
| --- | --- | --- | --- |
| Geometry face material instance | `CubeFace.material_name`, MCP `manage_material_instances` | Explicit geometry slot name on a face | Not a shader and not automatically an alpha policy |
| Entity render profile | `manage_render_profile`, client_entity + render_controller JSON | Downstream Minecraft material codes and per-bone selector assignments | Not guaranteed present in the active Blockbench model or GLB |
| PBR TextureGroup | `TextureGroup.is_material`, `getTextures()`, `material_config` | Color, MER, normal/height and PBR uniform values | Does not declare entity cutout, mask or translucency |
| Texture preview mode | `Texture.render_mode` | Blockbench display/authoring preview intent | **Not** the Bedrock material code or reliable glTF shader |
| Publication studio material | Separate detached THREE.MeshStandardMaterial → glTF PBR | Supported pixel/normal/metal/roughness/emission appearance | Not permission to change the authored Cube, atlas or Bedrock render controller |

Never map a human-readable material name like `glass`, `lamp`, `wood`, or `metal` to a shader without the actual authored render contract. A visually attractive substitute is still a fidelity failure.

Upstream reference sources (inspect exact code before updating):
- Blockbench color/MER/normal material preview: https://github.com/JannisX11/blockbench/blob/master/js/texturing/texture_groups.js
- Blockbench native Cube face groups: https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/cube.js
- Blockbench glTF exporter material/sampler serialization: https://github.com/JannisX11/blockbench/blob/master/js/lib/GLTFExporter.js
- Canonical LazyDesigner Bedrock render profiles: `docs/03-authoring/texture/render-profile.md`
- Khronos glTF 2.0 materials and metallic-roughness: https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc

## 2. Input acceptance matrix — current source contract

| Authored surface | Action | Reason |
| --- | --- | --- |
| Opaque base-color atlas with finite face UVs | ACCEPT as a detached publication material | Preserves exact color pixels and UV layout, sets conservative presentation roughness |
| PBR group with exactly one matching COLOR channel and optional MER/NORMAL | ACCEPT if all source channels valid | Known native roles and explicit deterministic translation |
| PBR group COLOR + uniform MER [R,G,B] with no MER image | ACCEPT | Exact authored uniform factor divided by 255 |
| PBR group COLOR + MER image | ACCEPT | Packed channel conversion and decoded source texture SHA |
| PBR NORMAL texture | ACCEPT when same dimensions as COLOR | Explicit DirectX Bedrock normal Y inversion for glTF |
| COLOR pixels nonopaque only in UV-unused atlas padding | ACCEPT after conservative UV coverage check | Non-sampled atlas padding is not object transparency |
| Nonopaque pixel sampled by any face UV | BLOCK | Alpha is ambiguous without a verified Bedrock source contract |
| Nonempty `CubeFace.material_name` | BLOCK | Geometry slot cannot be resolved to a unique client entity material + render-controller assignment from active project alone |
| Unknown/duplicate/missing PBR channel role or wrong source COLOR UUID | BLOCK | Prevent silent channel substitution or data loss |
| HEIGHT channel | BLOCK | Current bridge does not faithfully translate native height-to-bump |
| Nonzero SUBSURFACE | BLOCK | RenderDragon subsurface has no verified glTF standard-material equivalence in this worker |
| Texture preview render_mode other than `default` | BLOCK | Never mistake editor emissive/additive/layered preview for authored Bedrock shader |
| Animated frame / ambiguous animation pose | BLOCK per ADR-R01 | Snapshot must not move texture frames or project timeline |
| Unknown Minecraft material / custom per-face slot | BLOCK | No inferred opacity, culling or emission |

This acceptance matrix is intentionally strict. A blocked surface is an explicit unsupported input, **not an invitation to generate a different picture**.

## 3. Exact channel translation

| Source | glTF representation | Numeric policy | Preview/source evidence |
| --- | --- | --- | --- |
| COLOR RGBA | `pbrMetallicRoughness.baseColorTexture` | Preserve sampled texture bytes, sRGB interpretation, source UV after Blockbench V flip | Original COLOR raw RGBA SHA; decoded texture parity still native-unverified |
| MER red | `metallicRoughnessTexture` BLUE | Integer R 0–255; normalized by glTF | Source MER SHA + expected glTF map role |
| MER blue | `metallicRoughnessTexture` GREEN | Integer B 0–255; normalized by glTF | Source MER SHA + expected glTF map role |
| MER green | `emissiveTexture` mask times COLOR | Integer G 0–255; emission factor 1 for textured MER | Source MER SHA + expected glTF emission role |
| Uniform MER red/blue | `metallicFactor` and `roughnessFactor` | Each source integer / 255 | Expected numeric factors in source receipt |
| Uniform MER green | `emissiveFactor` plus COLOR as emission map | Source integer / 255 if positive, else emissive factor 0 | Expected factor and presence of emission map |
| NORMAL (Bedrock) | `normalTexture` | Tangent-space normal; green channel inverted once for glTF | Raw NORMAL SHA + expected map role; Blender normal result unverified |
| No PBR group | Plain COLOR + standard material | Presentation-only metalness 0, roughness 0.85; **not inferred material identity** | Explicit `pbr: NONE` marker |

When a MER image is present, the uniform MER is not substituted for it. When only COLOR and uniform MER are present, do not synthesize a MER image. Source uniform `color_value` is not a tint when an actual COLOR texture exists: match Blockbench's authored group semantics. Unsupported subsurface/height never quietly disappears.

The current `convertBedrockMerToGltf` masks emission using the same byte-level COLOR×MER-green convention found in the native Blockbench material preview. The **linear-light equivalence of the Blender imported result remains an untested visual-fidelity gate**; do not infer physical correctness from matching byte values alone.

## 4. glTF material preflight (deterministic, source-bound)

A source receipt includes one `gltf` expectation per exported material name:

```text
alpha_mode: OPAQUE
double_sided: true (render-only geometry visibility policy)
metallic_factor, roughness_factor, emissive_factor
metallic_roughness_texture: bool
normal_texture: bool
emissive_texture: bool
sampler: NEAREST
```

Before launching Blender, the GLB verifier must check:

1. Material names match source receipts, with no missing or extra entry.
2. `alphaMode` is opaque/default and `doubleSided` is the declared presentation choice.
3. `metallicFactor`, `roughnessFactor` and every RGB element of `emissiveFactor` match the authored expected factors (within the narrow numeric serialization tolerance).
4. Required `baseColorTexture`, `metallicRoughnessTexture`, `normalTexture`, and `emissiveTexture` references exist; forbidden roles are absent.
5. Every referenced texture uses `GL_NEAREST = 9728` for minification and magnification, and `GL_CLAMP_TO_EDGE = 33071` for UV atlas safety.
6. Every map must reference its exact exporter source identity (`ld_base_<color_uuid>`, `ld_mer_<color_uuid>`, `ld_normal_<color_uuid>`, or `ld_emission_<color_uuid>`). Uniform-MER emissive reuses COLOR; all references use `TEXCOORD_0` or its implicit default.
7. Cube node → ordered face primitive → source material ID matches ADR-R01 mapping and raw Float32 glTF UV data. A valid glTF header is not enough.
8. The file has only embedded images, no external URL or unapproved extension. PNG integrity and decoded pixel parity are separate checks.

**Important:** The deterministic GLB assertions are implemented as source checks. This is **not** a full Khronos Validator pass and does not prove Blender material appearance. Real importer shader wiring and source COLOR/MER/NORMAL decoded texel comparison are future native gates.

## 5. Blender 5.2 import invariants

Blender is a **consumer**, not a second model author. After glTF import:

- Use the imported Principled BSDF material and linked atlas, normal, metallic/roughness and emission textures.
- Sampling is `Closest` for all source atlases; sRGB COLOR vs linear non-color normal/MER must remain distinct.
- Source material names and actual inventory must equal the job's material receipts.
- Metallic and roughness must preserve sourced uniform factors or source-bound texture links.
- Required normal and emission links must not disappear; no automatic color/roughness guessing.
- No edits to the imported asset's vertices, normals, UVs, or source atlas pixels to increase render beauty.
- Render-stage floor, lights, backdrop, camera, HDRI and Fog Glow are disposable presentation changes only.

Native proof still requires an actual imported Blender 5.2 material inspection, a neutral unlit render and a Cycles beauty image. Numerical GLB validation is necessary, but not sufficient.

## 6. Hard boundaries for per-face Bedrock render slots

`manage_material_instances` can assign a geometry slot name. It does **not** store an authoritative Minecraft render-controller material code. The authored `client_entity.description.materials` and ordered `render_controller.materials` may live in separate files and can contain patterns/Molang conditions.

The renderer will **not** resolve external Bedrock files automatically, guess `Material.<slot>` from names, or launch Minecraft. Explicit mappings might be added only when those inputs are already validated and passed through a future bounded request, with exact profile semantics and no general file crawler. This document does not authorize that expansion.

Cutout/translucency/emissive-alpha remains blocked at this stage. PBR emissive through MER is supported because it comes from an explicit texture channel, which is a different domain from Bedrock alpha masking.

## 7. Source ownership and data boundaries

| Module | Sole owner | Expected output |
| --- | --- | --- |
| `mcp/lib/publication/materialContract.ts` | Pure channel identity and known PBR-to-glTF factor/role expectations | Typed source plan and expected material factors |
| `mcp/lib/publication/materialChannels.ts` | Pure pixel channel packing and normal Y conversion | Byte arrays for detached atlas maps |
| `mcp/lib/publication/atlasCoverage.ts` | Conservative visible-face UV/alpha coverage | Accept unused padding, reject unknown visible alpha |
| `mcp/server/publication/snapshot.ts` | Native TextureGroup resolution and material creation | Source receipt + detached material, without native editor changes |
| `mcp/lib/publication/contracts.ts` | Material expectation in job/receipt | Bounded typed source semantics |
| `mcp/lib/publication/glbIntegrity.ts` | GLB material numeric/role/sampler validation | Fail before Blender on material mismatch |
| `mcp/server/publication/worker/core_assets.py` | Blender imported shader/texture/link inspection | Import proof data, not artistic PASS |

No duplicate PBR registry, second Blender gateway, additional public tool, object-class taxonomy, Python eval or dedicated material-render subprocess is required.

## 8. Acceptance scenarios (source-authored tests vs actual proof)

| Test ID | Scenario | Source contract expectation |
| --- | --- | --- |
| MAT01 | Opaque atlas and default material | Exact baseColor, nearest/clamp, declared non-PBR factors |
| MAT02 | Color + uniform MER | Correct three factors and conditional emission map |
| MAT03 | Color + MER image | Packed metallic BLUE / roughness GREEN and source-color emission mask |
| MAT04 | Color + normal image | Correct source normal Y conversion, texture role preserved |
| MAT05 | Color + MER + normal | Both roles present, no omitted PBR channel |
| MAT06 | Duplicate/unknown role, changed COLOR UUID, height or nonzero subsurface | Explicit source failure |
| MAT07 | Per-face `material_name` without authoritative render profile | Explicit source failure |
| MAT08 | Cutout/translucent/emissive-alpha sampled UV | Explicit source failure |
| MAT09 | Editor-only non-default `render_mode` | Explicit ambiguity failure |
| MAT10 | Tampered metallic factor, missing emissive, incorrect normal role | GLB material parity failure |
| MAT11 | Nearest replaced by linear or wrap changed to repeat | GLB sampler failure |
| MAT12 | Blender import changes normal/emission node wiring or color-space | Native import failure (not tested yet) |
| MAT13 | Valid material renders as wrong light response or blurry atlas | Real PNG visual failure (not tested yet) |

Source contracts and fixture tests are authored under `mcp/tests/publication-material-translation.test.ts` and `mcp/tests/publication-render-contract.test.ts`. **They have NOT been executed.** Do not claim a source pass, Blender import success, visual equivalence or in-game material certification.

## 9. Definition of completion and next narrow step

- **SPECIFIED:** Every supported material role and explicit unsupported case is documented; one canonical source owner per operation.
- **SOURCE-AUTHORED:** Snapshot uses the pure plan; GLB preflight checks numeric factor, role and nearest/clamp expectations; no silent downgrade.
- **BUILD-VERIFIED:** TypeScript/Bun/build checks pass for exact Render commit (**NOT EXECUTED**).
- **BLENDER-VERIFIED:** Native 5.2 import of actual MCP-authored model preserves shader graph, normal/emission maps, texel sharpness and geometry (**NOT EXECUTED**).
- **VISUALLY-ACCEPTED:** Genuine Cycles output has been reviewed against the user's five reference images (**NOT EXECUTED**).

The next engineering boundary after this contract is **camera and lighting quality specification** for the same actual source asset—not expanding into Blender modeling, animation, scene props or another MCP server. Material correctness is a prerequisite to such visual-quality work.

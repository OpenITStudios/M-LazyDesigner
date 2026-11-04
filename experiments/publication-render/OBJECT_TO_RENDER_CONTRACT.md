# ADR-R01 — Object-to-Render Contract for MCP-Authored Assets

**Project:** OpenITStudios/M-LazyDesigner  
**Working branch:** Render (independent from Local)  
**Date:** 2026-11-03  
**Status:** DESIGN CONTRACT / IMPLEMENTATION GAPS OPEN / NO NATIVE ACCEPTANCE  
**Scope:** One real Bedrock Entity model authored by LazyDesigner MCP in Blockbench → one source-faithful Blender Cycles still-image render  
**Not a claim of:** passing build, installed Blockbench behavior, Blender 5.2 rendering, game compatibility, or artistic equivalence to reference images.

This document is the architectural contract for subsequent source changes. It is **not** an assertion that current code implements every clause. Tables explicitly distinguish CURRENT, DECIDED-NOT-IMPLEMENTED, and BLOCKED-PENDING-PROOF. The user requested detailed engineering design before running local/native tests.

## Camera and lighting continuation — ADR-R03

The presentation-only camera and three-light studio contract for the already validated source Cube model is specified in **[CAMERA_LIGHTING_SPEC.md](./CAMERA_LIGHTING_SPEC.md)**. It uses Blender's actual projected geometry, bounded view candidates, finite area-light energy and factual pixel-region diagnostics. These are geometric and radiometric starting points, not claims of perceptual or reference-image quality.

R01 source/GLB material fidelity remains a prerequisite; no Camera/Lighting Director may modify authored geometry, UV, texture or PBR to improve beauty.

## Material translation follow-up — ADR-R02

The material-specific continuation is defined in **[MATERIAL_TRANSLATION_SPEC.md](./MATERIAL_TRANSLATION_SPEC.md)**. It separates face material instances, Bedrock render controller profiles, TextureGroup PBR, and editor preview modes. Current Render source now checks explicit PBR channel identity, material factors, map roles, exact atlas names, UV0, nearest and clamp-to-edge sampler settings, ordered triangle indices, and canonical decoded PNG pixel hashes before launching Blender. PBR subsurface/height and custom/alpha material instances remain unsupported and **fail closed**.

This is only SOURCE-AUTHORED progress; glTF/Blender visual shader parity and Build/Blockbench integration are NOT executed or accepted.

## Implementation update — R01 P0 source pass (2026-11-03)

The following changes are now **authored in the Render branch only**. They have **NOT** been exercised by Bun, the installed Blockbench editor or Blender 5.2. This section overrides earlier "NOT implemented" shorthand in the decision table without claiming tested acceptance.

| P0 item | Source status | Exact change | Proof still missing |
| --- | --- | --- | --- |
| P0-1 static pose/frame | SOURCE-AUTHORED, RESTRICTED | `snapshot.ts` requires Blockbench Edit mode, refuses animation/timeline playback, refuses used texture frames other than static frame 0, hashes frame data and checks editor selection/view/Undo fence before/after GLB | Real Edit/paint/animation-mode behavior, live source/edit/Undo invariants |
| P0-2 face material | SOURCE-AUTHORED, FAIL-CLOSED | `sourceManifest.ts` derives exact native group-to-face-to-texture mapping; any nonempty authored material instance blocks with precise error instead of silently falling back to base color | Mapping for external Bedrock render-controller shader slots remains unsupported; source cannot claim universal alpha/material rendering |
| P0-3 units/coordinates | SOURCE-AUTHORED, UNVERIFIED | Detached geometry is scaled by 1/16; pure source formula calculates glTF Y-up to Blender Z-up bounds `(x,-z,y)` | Real Blender importer/large-coordinate precision and lighting-scale validation |
| P0-4 Group/identity manifest | SOURCE-AUTHORED, IN-MEMORY | Per-Cube UUID, Group ancestry UUIDs, source world matrix, native position/normal/UV/index hashes, expected Blender AABB, face primitive bindings and source manifest SHA; glTF node extras carry UUID and AABB | Persistent sidecar not included in P0; native extras round-trip verification pending |
| P0-5 glTF/Blender fidelity | SOURCE-AUTHORED, PARTIAL | GLB validator checks Cube ID, triangle witness provenance, material and exact index order per primitive, Float32 UV accessor bytes after V flip and source-matched decoded COLOR/MER/NORMAL/emissive PNG pixels (nonopaque padding canonicalized). Blender import source checks world AABB, finite UV loops, oriented triangle corner position+UV+material witness and shader/imported packed PNG provenance | Actual Blender 5.2 numeric/winding tolerance calibration, shader/color-space visual response and full Khronos/native render still unproven |

**Important constraints.** (a) This is deliberately restricted to existing MCP-created Bedrock Cube objects; a Gateway-local Blender rendering MCP capability now exists, but there is no second server or general 3D importer. (b) The Blender import AABB threshold (`max(1e-4, magnitude*1e-5)`) is a conservative provisional float32 guard, **not an empirically calibrated acceptance tolerance**. (c) Snapshot freshness handling from R01-D10 remains an open P1 decision: current code still blocks output after source edits; it does not yet publish stale snapshots. (d) Source manifest is a typed in-memory object with SHA; the worker sees source-bound glTF node extras rather than reading a second full model JSON parser. (e) Per-face shader slots, animated atlases and unknown alpha deliberately block instead of yielding false fidelity.

Source regression intents added/updated: `mcp/tests/publication-source-manifest.test.ts`, `mcp/tests/publication-render-contract.test.ts`, `mcp/tests/publication-jobs.test.ts`, and the opt-in synthetic GLB worker harness. These are authored checks, not executed evidence.

## 0. Executive decisions (R01)

| ID | Decision | Rationale | Current implementation |
| --- | --- | --- | --- |
| R01-D01 | Renderer reads the ACTIVE Bedrock Entity Blockbench project already authored by LazyDesigner MCP | No duplicate model parser or second modeling state | Partly implemented |
| R01-D02 | Initial target is ALL visible, exportable Cubes under visible/exportable Groups; no implicit selection-only or object-category routing | Deterministic scope; no hidden omission | Implemented with gaps listed below |
| R01-D03 | Snapshot is detached, immutable and identified by project UUID plus SHA-256 of the *full render-relevant source* | Source fidelity and repeatability | Partial; fingerprints lack some semantic fields |
| R01-D04 | The native editor's authored data, texture frame, modes, selection, Undo and current camera must not be mutated | Render is presentation/export, not model editing | Source attempts isolation; native invariants unproven |
| R01-D05 | A static still image uses a declared STATIC_POSE provenance. For initial acceptance, require an unambiguous editor/rest pose; do not switch pose or animation state | No secret animation changes | NOT enforced yet |
| R01-D06 | Preserve world-space geometry and face-to-material correspondence. Flattening Group structure inside render-only GLB is allowed if full world-space result is equivalent and parent UUID provenance remains available | Blender need not be a second editable modeler | Geometry flattening exists; provenance incomplete |
| R01-D07 | Define one explicit 16 Blockbench units = 1 Minecraft block = 1 glTF meter-equivalent scene unit conversion for Bedrock assets; never apply an undocumented scale twice | Consistent scene lighting/units | DECIDED-NOT-IMPLEMENTED: current code exports 1:1 coordinates |
| R01-D08 | Convert only declared color/MER/normal semantics; unrecognized alpha, material instance or shader mode is a **blocked source condition**, not a guessed shader | Faithful image rather than a deceptively attractive image | Partial (opaque/PBR channels); per-face material_name ignored |
| R01-D09 | Cycles may change camera/light/world/ground/compositor only. It cannot mutate authored mesh, atlas, UV or material source properties | Separate *presentation* from *asset fidelity* | Partly implemented; Blender-side proof pending |
| R01-D10 | Completion of a valid historical snapshot and whether it is STILL CURRENT are independent facts. A changed snapshot render may be retained with a CHANGED/UNAVAILABLE label, never mislabeled current | Avoid wasting expensive Cycles work | SOURCE-AUTHORED: final receipt now distinguishes CURRENT, CHANGED and UNAVAILABLE; native acceptance deferred |
| R01-D11 | No automatic artistic PASS, source-import PASS or Minecraft certification from a successful PNG or histogram | Correct proof ceiling | Implemented as source metadata; live proof pending |
| R01-D12 | One existing LazyDesigner Gateway, native Blockbench `render_publication` handoff, independent Gateway `blender_render`, one immutable GLB bridge and one trusted Blender worker | Cross-app rendering control without a second server/scene framework | SOURCE-AUTHORED: each owner has a separate one-job lifecycle; both reuse the same Python worker |

## 1. Requirement and non-goals

**Input:** the model that already exists in Blockbench after work by manage_cubes, Group hierarchy, texture tools, PBR tools and any legitimate native edits. We do not attempt to infer authorship of individual cubes from names or past MCP calls. The *current native project state* is authoritative.

**Output:** one PNG with the actual rendered object, source/GLB/worker digest, the exact render settings and a small image for observation. A future persistent manifest is specified in section 10. No AI redraw, no model regeneration, no arbitrary .blend scene authoring, no architecture/environment generator, no render farm, no video production, and no general Blender MCP surface.

The source model may have artistic quality limitations that rendering cannot fix. A renderer may improve illumination and composition; it may not invent missing geometry, paint or model decorations.

## 2. Existing code and audited evidence

| Exact source owner | Currently observed source behavior | Important gap |
| --- | --- | --- |
| mcp/server/publication/snapshot.ts | Reads Cube.all, rejects visible Mesh, copies native THREE geometry and pixels; uses current matrixWorld and GLTFExporter | No formal edit/rest pose guard, no stable per-face material semantic mapping, no explicit 1/16 scale, parent hierarchy UUID not in returned receipt |
| mcp/lib/publication/atlasCoverage.ts | Distinguishes mapped UV alpha from unused transparent padding | Coverage uses face UV rectangles; exact sampling at seams/rotations/UV flips still needs proof |
| mcp/lib/publication/materialChannels.ts | Packs Bedrock MER and flips normal green channel | Channel numbers alone are not proof of imported shader equivalence |
| mcp/lib/publication/glbIntegrity.ts | Checks GLB envelope, source-index order, UV, PBR/material identity and canonical RGBA texels in exported embedded PNGs | Still not a Khronos glTF 2.0 validator or Blender-imported texture/color-space parity proof |
| mcp/server/publication/worker/core_assets.py | Imports GLB, checks mesh/material count, UV presence and some PBR shader links | Does not yet compare numeric vertex/UV coordinates or original face-to-material assignment with a source baseline |
| mcp/server/publication/jobs.ts | Nonblocking start/status/preview/cancel, one process-local job shared with human panel; no native queue for panel receipt reads | Only latest job retained and plugin unload still cancels. No persistent jobs or background coordinator |
| mcp/server/publication/execute.ts | Local Blender subprocess, immutable GLB input, permission/output preflight before snapshot, verified PNG and source revision observation before exclusive output write | Result remains tied to original source SHA, labeled CURRENT/CHANGED/UNAVAILABLE. Restart-independent jobs are not implemented |
| mcp/server/tools/inspection/publication.ts | One Runtime tool with four operation branches, overall readOnlyHint false | Status/preview are query branches but transport retry policy inspects tool-wide annotation |
| mcp/server/publication/worker/*.py | Source modular camera/studio/Cycles/compositor/measurement | No real Blender 5.2 acceptance conducted |
| mcp/compatibility/blockbench.json | Target minimum 5.1.0, source baseline 5.2.1 | liveValidatedBuilds is empty |

Audited upstream Blockbench source:
- https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/cube.js — native updateFaces builds index triangles and geometry groups in face order; consecutive same-texture groups may be merged.
- https://github.com/JannisX11/blockbench/blob/master/js/formats/standards/gltf.js — native glTF compile can change preview mode, texture frame and scene state, so it is not a safe direct export operation on the active project without a complete transaction.
- https://github.com/JannisX11/blockbench/blob/master/js/lib/GLTFExporter.js — the bundled exporter supports glTF material/texture conversion and grouped primitives but has its own conversion assumptions.
- https://github.com/JannisX11/blockbench/blob/master/js/texturing/texture_groups.js — color/normal/height/MER group semantics and a Bedrock normal Y-flip are source-defined.

External specifications:
- https://registry.khronos.org/glTF/ — authoritative glTF 2.0 specification.
- https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc — glTF coordinates, material slots, texture color spaces, alpha and double-sided behavior.
- https://docs.blender.org/manual/en/5.2/addons/import_export/scene_gltf2.html — Blender importer/exporter behavior; check the actual installed 5.2 release at native gate.
- https://learn.microsoft.com/en-us/minecraft/creator/documents/rtxpbrintro — Minecraft PBR/MER background.

## 3. Target boundary — which authored object gets rendered?

**Current MVP target:** every Cube in the active Bedrock Entity project that is visible, exportable and has all visible/exportable ancestors. Only source-owned Groups and Cubes participate; hidden or non-exportable descendants are excluded. The target is not Blockbench's temporary selection set.

| Case | Decision | Required proof / error |
| --- | --- | --- |
| Valid Bedrock Entity project with visible exportable Cubes | ACCEPT for snapshot preflight | Correct project UUID and unique Cube UUIDs |
| No project / non-Bedrock format | BLOCK | PUBLICATION_BEDROCK_PROJECT_REQUIRED |
| No eligible Cubes | BLOCK | PUBLICATION_NO_VISIBLE_CUBES |
| Hidden or nonexportable cube, or hidden ancestor | EXCLUDE | Count and UUID list of excluded elements recorded as metadata |
| Visible/exportable native Mesh, locator-specific generated geometry or unsupported element | BLOCK rather than silently omit | PUBLICATION_UNSUPPORTED_NON_CUBE_GEOMETRY or explicit unsupported-element code |
| Ambiguous Group cycle, missing parent, duplicate Cube UUID | BLOCK | Exact offending UUID/path |
| Selected object only, arbitrary subset/group UUID, objects from a different tab | NOT IN R01 | Requires separate explicit target contract, never implicit selection |
| Source modified after snapshot started | BLOCK snapshot | Source hash before/after must match |

**Render target identity** must be recorded as `target_kind: ACTIVE_PROJECT_VISIBLE_EXPORTABLE_CUBES` with `project_uuid`, a list of included Cube UUIDs, parent Group ancestry and the excluded-element count/reasons. This is provenance, not new editor state.

Do not assume "MCP-authored" can be proven for each Cube. The export source is the *native state* left by MCP and approved direct Blockbench authoring.

## 4. Static pose and state identity

The current code reads `cube.mesh.matrixWorld`. That may reflect a posed editor/animation preview rather than an assured rest pose. Snapshotting an ambiguous pose and labeling it "default" is not acceptable.

**R01 default:** `pose_mode: EDIT_STATIC_VERIFIED`. The source phase must be explicitly compatible with a stable native static model state, or the operation must block with `PUBLICATION_POSE_PROVENANCE_UNVERIFIED`. Do not invoke Animator.showDefaultPose, force texture.currentFrame=0, switch editor modes, alter timelines or mutate Undo to obtain a still image.

**Future explicit input** `pose_mode: CAPTURE_CURRENT_POSE` is intentionally not in R01. It may be added only when the owner can determine animation time/clip, parent transforms and texture frame identity without changing editor state.

**Source state ledger** for a native no-mutation acceptance:
- Active project reference and UUID; name, save path and saved/dirty flag.
- Active Blockbench mode/view mode, selected outliner elements and active texture.
- Undo stack length and current undo pointer/revision; no new Undo entry.
- Texture UUID, dimensions, pixel data digest and animated frame/currentFrame for used images.
- Per-Cube local and world transform, parent ancestry, UV rectangles and face material identity.
- Timeline/animation state and camera state, only if present; absence is not proof of unchanged state.

Collect this ledger before the snapshot and compare afterwards. The *authored state* MUST be unchanged. An internal Three.js world-matrix cache update does not automatically mean authored data changed, but must not cause observable editor state changes.

## 5. Proposed canonical snapshot manifest v1

This is a **versioned source-to-render data contract for implementation**, not an existing production JSON payload.

```json
{
  "schema_version": 1,
  "source": {
    "project_uuid": "<native project UUID>",
    "format_id": "bedrock",
    "blockbench_build": "<actual build>",
    "runtime_generation": "<current bound runtime generation>",
    "source_revision_sha256": "<SHA256 of all render-relevant authored state>",
    "captured_from": "LIVE_NATIVE_BLOCKBENCH",
    "pose_mode": "EDIT_STATIC_VERIFIED",
    "texture_frame_policy": "STATIC_EXPLICIT"
  },
  "target": {
    "kind": "ACTIVE_PROJECT_VISIBLE_EXPORTABLE_CUBES",
    "cube_count": "<integer>",
    "included_cube_uuids": ["<UUID>"],
    "excluded": [
      {"uuid": "<UUID>", "reason": "HIDDEN_OR_NONEXPORTABLE"}
    ]
  },
  "coordinates": {
    "source": "BLOCKBENCH_BEDROCK_Y_UP",
    "units_per_minecraft_block": 16,
    "gltf_axis": "RIGHT_HANDED_Y_UP",
    "gltf_meters_per_blockbench_unit": 0.0625,
    "blender_import_axis": "Z_UP_CONVERTED_BY_IMPORTER",
    "source_world_to_gltf_matrix": "<explicit 4x4 matrix>"
  },
  "geometry": [{
    "cube_uuid": "<UUID>",
    "parent_group_uuids": ["<UUID>"],
    "source_world_matrix": "<16 finite numbers>",
    "world_geometry_sha256": "<digest of transformed positions and indices>",
    "uv_sha256": "<digest of UV data and mapping semantics>",
    "face_bindings": [{
      "face_key": "north",
      "texture_uuid": "<UUID>",
      "material_instance": "<explicit or null>",
      "material_semantics": "OPAQUE_COLOR"
    }]
  }],
  "textures": [{
    "texture_uuid": "<UUID>",
    "role": "COLOR",
    "width": "<integer>",
    "height": "<integer>",
    "raw_rgba_sha256": "<SHA256>",
    "sampler": "NEAREST",
    "frame_index": 0
  }],
  "glb": {
    "container_version": 2,
    "glb_sha256": "<SHA256>",
    "mesh_count": "<integer>",
    "primitive_count": "<integer>",
    "material_count": "<integer>"
  },
  "verification": {
    "native_state_unchanged": "NOT_YET_TESTED",
    "gltf_validator": "NOT_YET_RUN",
    "blender_import_fidelity": "NOT_YET_TESTED",
    "artistic_quality": "NOT_EVALUATED"
  }
}
```

Every field that claims an observed state must be filled from that state, never from defaults or fabricated metadata. Dynamic byte hashes and actual lists replace placeholders. Avoid storing full RGBA buffers in the JSON; actual image bytes belong to the isolated GLB, with hashes in the manifest.

**Source revision scope:** include geometry positions/indices/UV/normals, Cube and Group ancestry/transforms, per-face texture/material mapping, all used color/normal/MER image bytes, relevant uniform PBR values, visibility/export flags, texture frame identity and native pose provenance. A signature that omits any one of these cannot be labeled complete.

Deterministic ordering: sort canonical inventories by UUID; preserve face keys/index material-slot order separately because face order is semantically meaningful. Canonical numeric representation and float quantization MUST be specified once; do not hash unordered native object serialization.

## 6. Coordinate and hierarchy contract

For each included Cube, preserve its fully transformed position in the Blockbench source coordinate system:

```text
p_BB_world = M_parent0 × ... × M_parentN × M_cube × p_local

p_GLTF = S(1/16) × p_BB_world

p_Blender = importer_GLTF_Y_UP_to_Blender_Z_UP(p_GLTF)
```

The 1/16 scale is **chosen design policy**, not current implementation. Current `snapshot.ts` bakes `matrixWorld` but does not apply this scale explicitly. It must be updated and proved before claiming unit-accurate scene output.

A 1:1 raw vertex comparison between glTF and Blender coordinates is invalid because Blender's importer changes axis conventions. Validate using the defined transformation chain and an agreed tolerance based on imported geometry precision.

**Group flattening:** may bake world transforms into detached mesh vertices for a still render, but the manifest must preserve parent Group UUID ancestry and source world-matrix provenance. Do not claim editable hierarchy interchange when GLB nodes have been flattened.

**Mirroring / handedness:** when a negative determinant or mirrored UV is present, verify triangle winding, normals and culling are still correct after export and Blender import. Setting every surface double-sided is not a substitute for preserving authored face orientation.

**Geometry groups:** Blockbench may merge consecutive faces with the same texture. For each GLB primitive, the material slot must correspond to the **correct source face/texture** after this merging. A valid material index range alone is not sufficient evidence.

**Forbidden automatic transformations:** no speculative subdivision, bevel, smoothing, repair, mirror, recentering that changes geometry, or re-rigging. Camera framing may center the *camera target*, not move the source mesh.

## 7. UV and texture sampling fidelity

| Source condition | Render contract | Status |
| --- | --- | --- |
| Standard UV mapping with finite 2D coordinates | Preserve exact face UV orientation and native indexed geometry; nearest texel filtering | Source path exists; native proof pending |
| Box UV | Use native generated geometry/UV; do not recompute independently from dimensions | Source path exists; must verify parity |
| Per-face UV with rotations/flips | Preserve native UV attributes including inversion and face ordering | Needs fixture |
| Mirrored/negative scale | Correct winding and normal orientation; no silently missing faces | Needs fixture |
| Transparent pixels outside referenced UV area | May remain in the atlas; these do not imply transparent visible surfaces | Pure helper exists |
| Transparent/intermediate alpha within referenced UV | Block pending explicit authored Bedrock render-profile semantics | Current fail-closed behavior |
| Atlas padding/UV seams | No texture bleeding, wrong sampler/mipmap or unexpected wrap | Needs pixel-level check |
| Animated texture (frameCount > 1) | Block in R01 unless exact static frame is explicitly supported/proven; do not force currentFrame to zero | Guard not fully implemented |
| Missing/deleted/invalid texture | Block with exact UUID and reason | Partial |

Image integrity now compares **decoded exported GLB texels** to a source-bound canonical RGBA digest for opaque Cube materials, rather than trusting PNG signatures. Nonopaque UV-unused padding is normalized for the digest, while exact source texture hashes remain in the source fingerprint. Browser Canvas encoding, color-space interpretation and Blender image import can still affect appearances despite source-side parity, so genuine native/visual acceptance remains required.

Source color uses the correct sRGB interpretation; normal, roughness and metalness are non-color data; nearest interpolation is retained for voxel texture sharpness. An artistic AgX or exposure change is a presentation choice, not an excuse to alter source albedo.

## 8. Material binding contract

**Material identity is per-face/per-primitive when the source declares it.** One texture UUID is not always equivalent to one complete material identity.

| Input semantics | Required output | R01 behavior |
| --- | --- | --- |
| Plain color atlas + no explicit PBR | glTF baseColorTexture with authored UV and nearest sampler | ACCEPT if opaque/valid |
| PBR color + MER | Bedrock R metalness / G emission / B roughness → glTF B metallic / G roughness + explicit emission | ACCEPT with channel/dimension checks; numeric parity unproven |
| PBR normal | Correct tangent-space normal orientation, verified imported normal shader link | ACCEPT with checks; Blender parity unproven |
| Uniform material MER | Preserve source uniform values and distinguish from default fallback | PARTIAL; authoring semantics require exact parity |
| Per-face material_name or material instance | Map explicit authored shader identity and never collapse to color UUID alone | **BLOCK UNTIL MAPPED**; current code fingerprints this field but ignores it in makeMaterial |
| Height map / subsurface / unknown PBR group | Separate explicit compatibility path or reject | BLOCK R01 |
| Bedrock alpha-test, alpha-blend, emissive-alpha, color mask | Interpret only with explicit render_profile/material instance, not with RGB/alpha guesses | BLOCK R01 |
| Unknown custom material | No inferred roughness/emissive/plastic fallback | BLOCK R01 |

A face marked with a nonempty material name or custom instance must not silently inherit its color texture's generic appearance. This is a P0 implementation gap, not merely a cosmetic refinement.

Avoid inferring material semantics by looking at the asset subject. A wooden object is not automatically "wood roughness 0.8"; only authored maps or explicitly user-approved render-only overrides can choose physical values.

## 9. Source → GLB → Blender acceptance boundary

**Gate S — native source eligibility**
- Correct project format/UUID and active Runtime generation.
- All included Cube IDs unique, eligible ancestor chains resolved.
- Static pose and texture frame provenance unambiguous.
- Finite positions/normals/UVs and valid triangle/index groups.
- All material bindings supported or explicitly blocked.
- Native pre/post state ledger unchanged.

**Gate G — detached GLB**
- Valid glTF 2.0 + GLB framing and full Khronos glTF-Validator run at proof time.
- Exact mesh/primitive/material mapping to source manifest; embedded images only.
- No missing face, group or material mapping; explicit unit conversion.
- No external URIs, unexpected extensions or model-supplied scripts.
- Stable SHA-256 and source revision binding.

**Gate B — Blender 5.2 import**
- Correct Blender build and GPU/CPU selection recorded.
- Imported vertex positions transformed to the expected Z-up coordinates.
- UV/texel alignment verified with a neutral, camera-matched diagnostic render.
- No unexpected lost meshes/materials, PBR channels or normals.
- Native source state still unchanged; render-only studio objects are separate.

**Gate R — actual render**
- Cycles produces the final PNG from the imported GLB; compositor and camera apply to the disposable scene only.
- Full PNG CRC/dimensions and source-bound report verified.
- Small evidence PNG is a downsample of that same Cycles result, not a second renderer.
- An actual image review is required to claim visual quality.

Do not invent pass metrics. Proposed numeric tolerances for source-world vertex and UV float comparisons must first be calibrated against real GLB/Blender import; until then acceptance is PENDING, not a guessed "100%".

## 10. Output and snapshot freshness policy

Three separate identities must be visible:

| Identity | Meaning |
| --- | --- |
| Source project UUID | Which Blockbench project was captured |
| Source snapshot SHA-256 | Exact render-relevant geometry/material/pose revision used by Cycles |
| Render job UUID + worker/settings SHA | Which pipeline execution and render parameters produced this PNG |

**Decision R01-D10:** a complete, source-valid historical snapshot is not intrinsically invalid if a user edits the active project during the render. Publication policy should be:

| Event | Target behavior | Currently implemented |
| --- | --- | --- |
| Source unchanged at completion | Publish PNG with source_revision_at_publication=CURRENT | SOURCE-AUTHORED, native test pending |
| Geometry/texture changes after frozen snapshot | Publish immutable historical PNG with source_revision_at_publication=CHANGED and original digest; never claim current | SOURCE-AUTHORED, native test pending |
| Active project switched, but same Runtime generation | Preserve original project UUID and hash, mark CHANGED; never bind to newly active project | SOURCE-AUTHORED, native test pending |
| Current source cannot be inspected safely | Preserve original snapshot identity and mark UNAVAILABLE, not CURRENT | SOURCE-AUTHORED, native test pending |
| Runtime/plugin generation retired | Cancel or report uncertain outcome; never attach to a new generation | Existing generation-bound recheck present |
| Destination PNG exists | Block; no overwrite | Implemented |
| Blender process exit unconfirmed | Do not publish; retain isolated job for safe recovery | Implemented as source |
| Cancellation before verified output | Do not publish | Source logic present |
| Final write uncertain or SHA mismatch | Preserve explicit UNKNOWN/VERIFY_FAILED status; no false success | Needs expanded persistent recovery contract |

Do NOT silently replace a current-project export with a render from an older revision. The user must be able to tell what exact object was rendered.

**R01 output set (design):** final PNG, a small optional review thumbnail, and a lightweight JSON sidecar containing source/worker/render settings/freshness/proof state. The current implementation writes the PNG, holds one process-local receipt/thumbnail, and deletes the scratch report; persistent sidecar output is **NOT implemented**. Do not claim full reproducibility until it is.

## 11. Errors, retries and permissions

Error structure (proposed, not an existing complete typed result):

```json
{
  "job_id": "<opaque job ID>",
  "phase": "PREPARING_ASSETS",
  "error": {
    "code": "PUBLICATION_UNSUPPORTED_FACE_MATERIAL",
    "category": "UNSUPPORTED_SOURCE",
    "source_cube_uuid": "<UUID>",
    "source_face": "north",
    "safe_to_retry_unchanged": false,
    "required_action": "Declare supported face material or use a fully supported model"
  }
}
```

Categories should distinguish INPUT_INVALID, UNSUPPORTED_SOURCE, SOURCE_CHANGED, VERSION_UNSUPPORTED, RESOURCE_BUDGET, PERMISSION_DENIED, BLENDER_FAILED, PROCESS_EXIT_UNKNOWN, OUTPUT_CONFLICT and OUTPUT_VERIFICATION_FAILED.

Operation-specific retry:
- start: may have launched Blender; network interruption is outcome-unknown. Poll/reconcile rather than blindly start a second render.
- status: read-only, safe to repeat.
- preview: read-only, safe to repeat, but bounded PNG size prevents image-context overload.
- cancel: idempotent by job ID when the job still exists, but "cancel requested" is not proof of process exit.

**Current gap:** render_publication has tool-wide readOnlyHint=false even though status/preview are read-only branches. Gateway interruption classification currently uses that tool-level annotation. Resolve declarative per-operation semantics before promising automatic safe retries; do not add arbitrary transport special cases.

Permissions: local selected Blender binary, explicitly permitted output folder, optional user-approved HDRI read, argv without shell. Do not open network sockets, download extra models, run model-provided Python or accept untrusted .blend files.

## 12. Resource budgets (currently source bounds, not benchmark results)

| Budget | Current value | Meaning |
| --- | --- | --- |
| Source Cubes | 10,000 | hard input ceiling, not a performance target |
| Texture count | 128 | distinct used images limit |
| Texture pixel budget | 4,194,304 per texture; 8,388,608 total | decoded source bitmap memory guard |
| Vertex scalar components | 3,000,000 | source fingerprinting guard |
| GLB | 96 MiB | detached export preflight ceiling |
| PNG output | 12 MP area, max 4096 side; 96 MiB file guard | output contract |
| AI preview | 384 px maximum side, 2 MiB maximum | visual observation cost budget |
| GLTF snapshot timeout | 30 seconds | export operation cap |
| Blender process timeout | 15 minutes, plus bounded termination grace | avoid infinite child-process lifespan |
| Auto camera | 15 candidate views, geometric scoring | avoids 15 expensive Cycles renders |

All above are code constants/proposals for resource protection; no throughput, memory consumption, GPU duration or quality benchmarks have been measured. If a valid large asset exceeds budgets, the system must surface a specific budget error, not silently simplify geometry or downscale texture data.

## 13. Negative and positive scenarios for eventual acceptance

| ID | Fixture / scenario | Expected result |
| --- | --- | --- |
| S01 | One opaque Cubed object, one atlas | GLB and PNG with intact geometry/UV/material |
| S02 | Multiple Cubes with nested rotated/mirrored Groups | Correct world-space positions and winding |
| S03 | Box UV and per-face rotated UV in one model | No texture rotation/bleeding error |
| S04 | Same texture on consecutive and nonconsecutive Cube faces | Exact primitive-to-material mapping despite native group merging |
| S05 | Two atlases with different PBR group channel mappings | No cross-material mixing |
| S06 | PBR color/MER/normal with uniform fallback values | Correct channel values and Blender nodes |
| S07 | Nonempty per-face material instance | Block until supported; do not default to generic color material |
| S08 | Cutout texture on visible UV with no declared alpha semantics | Explicit block, no fake glass or opaque replacement |
| S09 | Animated atlas or ambiguous current animator mode | Explicit pose/frame error; editor unchanged |
| S10 | Hidden child under hidden Group | Properly excluded with source evidence |
| S11 | Source mutation during snapshot | Export aborted with no edited source |
| S12 | Source mutation after snapshot during Cycles | Historical PNG permitted with original source digest and explicit CHANGED/UNAVAILABLE freshness; source tests authored, native test deferred |
| S13 | Blender import alters UV, normals or scale | Fidelity failure before publication-quality claim |
| S14 | Missing Blender executable/permission denied | Clear error, no fallback to screenshot/image AI |
| S15 | Blender timeout, crash, GPU failure or cancel | Correct state and no premature success |
| S16 | Output path collision or incomplete write | Original file unchanged; no silent overwrite |
| S17 | Full final PNG + tiny thumbnail | Both from same completed Cycles render |
| S18 | Plugin reload or project switch during render | Ownership preserved or safe cancellation; no wrong-project publication |

These are test-plan acceptance scenarios **not executed**. A source-only unit test is not a substitute for an installed Blockbench/Blender fixture.

## 14. Implementation priority and ownership (not a feature wishlist)

| Priority | Defect / contract gap | Canonical owner | Required source change |
| --- | --- | --- | --- |
| P0-1 | Unambiguous static pose/frame provenance and native state snapshot ledger | snapshot.ts | reject ambiguous pose/moving texture frame; compare authored state before/after |
| P0-2 | Per-face material instance mapping is silently ignored | snapshot.ts + materialState/renderProfile source | explicit material semantics or fail-closed error |
| P0-3 | Canonical 1/16 unit scale and Blender transform parity | snapshot.ts + worker/core_assets.py | deterministic transform matrix and structural readback |
| P0-4 | Stable Group ancestry and source mesh/face manifest | snapshot.ts + pure contract type in mcp/lib/publication | versioned compact source manifest, no duplicate parser |
| P0-5 | Full GLB primitive/texture semantic parity | glbIntegrity.ts + worker/core_assets.py | assert material slot and UV correspondence, defer visual comparison to native gate |
| P1-1 | Historical snapshot validity vs CURRENT project status | execute.ts + snapshot.ts | SOURCE-AUTHORED: publish provenance-labeled historical PNG, fail closed on cancelled/uncertain subprocess |
| P1-2 | Persistent render sidecar and recovery states | gateway/providers/blenderRender.ts + lib/publication/renderCompletion.ts | SOURCE-AUTHORED: bounded completed-outcome JSON+preview and SHA-checked recover; active job restart recovery is intentionally NOT built |
| P1-3 | Per-operation retry/read-only contract | Gateway interruptionPolicy + branch manifest | SOURCE-AUTHORED: status/preview retryable after interrupted transport, start/cancel remain OUTCOME_UNKNOWN |
| P1-4 | Actual camera/material/light visual quality | worker/*.py + manual/AI image review | compare real Cycles PNGs; no fake scoring |
| P2 | Optional render-only crop evidence optimization | quality_report.py / existing preview operation | only when a specific visible detail cannot be judged at 384px |

**Current addition:** [Independent Blender Render MCP](./BLENDER_MCP_CONTROL.md) implements the explicitly requested Gateway-local Blender rendering control and native Blockbench handoff. It is not a second MCP server. **No work** in arbitrary Blender scene editing, game model export, Bedrock gameplay, MP4 animation evidence, scene generator, asset marketplace or generic DCC task router is authorized by this contract.

## 15. Definition of architecture complete vs implementation complete

**ARCHITECTURE SPECIFIED:** Decisions, source invariants, ownership, unsupported inputs, output identity, failure/recovery and acceptance are documented with exact implementation owners.

**SOURCE IMPLEMENTED:** All P0 clauses are encoded in source/contracts and import-safe tests; no unresolved semantic fallback remains. Mere file presence does not qualify.

**LOCAL VERIFIED:** Bun/typecheck/generator and focused unit tests pass on an exact commit.

**NATIVE VERIFIED:** Installed Blockbench/Bun plugin + Blender 5.2 show source-preserved GLB, real Cycles PNG, correct material/UV/mode/pose behavior, safe reload and process handling.

**VISUALLY ACCEPTED:** Actual render compared to the five user references for craft: lighting, shadows, PBR, voxel crispness and composition. This is a separate evaluation and cannot be inferred from success receipts.

**Current status as of this document:** ARCHITECTURE SPECIFIED for R01; other stages NOT CLAIMED. Current source already implements useful parts, but the P0 gaps in section 14 remain explicit. The user does not want native tests yet, so those gates remain deferred without a schedule or false pass.

## 16. Short continuation instructions

1. Preserve the Render branch and read this contract before changing source. No merge into Local.
2. Implement P0-1 through P0-5 in the canonical files only, preferably using pure, independently testable helpers under mcp/lib/publication.
3. Update exact-source unit test fixtures for negative and success semantics; do not replace live evidence with mocks in acceptance reports.
4. Keep the existing four top-level Gateway methods and the one render_publication capability.
5. Do not expand the renderer beyond the existing MCP-authored Blockbench object workflow.
6. User has deferred installed tests. Report any source changes as SOURCE-AUTHORED and leave native/visual claims explicitly unverified.

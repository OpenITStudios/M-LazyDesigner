# LazyDesigner Blender Core — Publication Rendering

Branch: Render only. State: **render-only architecture closed at source level; build/Blender 5.2/native acceptance NOT EXECUTED**.

Purpose: high-quality actual Cycles rendering of authored Blockbench geometry/UV/texture, never regenerated AI images or renamed objects.

## Frozen product scope — only objects authored in LazyDesigner MCP

Input is the **currently open Bedrock Entity Blockbench project created/edited through LazyDesigner MCP**. The existing manage_cubes, Group/UV, Texture and PBR tools own its authored geometry and surface data. The renderer is a consumer, never a second modeler.

```text
LazyDesigner MCP-authored Bedrock Cube/Group/UV/Texture/PBR
       ↓ detached native Cube snapshot (unchanged authored state)
GLB 2.0 + source/material hashes (no new model parser)
       ↓ existing Render publication job (start/status/preview/cancel)
Blender 5.2 — one trusted bundled Cycles worker
       ↓
PNG final + small PNG evidence + factual receipt
```

- **One public control owner:** existing LazyDesigner Gateway, exactly four public methods. No Blender MCP server or second Blockbench plugin.
- **One Runtime capability:** `render_publication` registered in the **export** family; editor `capture_model_views` remains in **camera** for QA and is not overwritten.
- **One job owner:** `jobs.ts` serializes capture through native Runtime, executes Blender separately to avoid Gateway timeouts, then rechecks source revision in a generation-bound native queue before exclusive PNG publication.
- **One immutable render source:** only real native Cube geometry/face UV/texture pixels and explicitly authored PBR maps. No broad Blender modeling API, generated scenery, semantic asset categories or user-written Python.
- **One final rendering engine:** Cycles preview and publication modes differ only in resolution and samples. Studio lighting/HDRI, camera and compositor affect presentation, not authored geometry.
- **One evidence route:** the image returned to AI/humans is a bounded downsample of the same finished Cycles PNG. Numeric diagnostics cannot assert that the image is artistically approved.
- **One launch target:** a user-authorized Blender 5.2 desktop executable; no other installed Blender MCP/add-ons are required.

**Scope is frozen.** Do not add animation/movie production, arbitrary imported meshes, model generation, scene-building workflows, render farm, multi-agent queues, alternative MCP servers, or external Blender integrations in this effort. Existing optional settings remain available but are not a reason to expand the system. Unsupported data fails explicitly.

## Canonical source owners

| Source | Owner |
| --- | --- |
| render.py | Trusted Blender 5.2 job entry; validates bounded job and assembles one Cycles render |
| core_assets.py | Imported GLB/UV/PBR/material fidelity and bounds |
| camera_director.py | Geometry-driven bounded camera candidates and all-mesh frame safety |
| lighting_director.py | Camera-relative key/fill/rim, ground/shadow catcher and optional approved HDRI |
| compositor_director.py | Cycles sampling, device, AgX/Standard and Blender 5.2 Fog Glow |
| quality_report.py | Measured PNG pixel/alpha observations, NO automatic artistic PASS |
| ../execute.ts | Only trusted Python source bundler and local subprocess/PNG file owner |
| ../jobs.ts | One process-local start/status/cancel controller |
| ../../../lib/publication/ | Pure render contracts, GLB/PNG validation, material channels, atlas coverage, HDRI/source digest and report schema |

## Render lifecycle

1. Start under existing LazyDesigner MCP Runtime (four public Gateway methods, NO fifth method).
2. Capture detached native Cube/UV/atlas/PBR material snapshot under serialized native request queue. The original editor/Undo stays unchanged.
3. Validate GLB integrity and source revision. Transparency on used UV pixels without an explicit Bedrock alpha contract, ambiguous PBR mapping and non-Cube geometry fail closed; unused transparent atlas padding is allowed.
4. Validate an explicitly authorized local Blender executable. Optional user-supplied HDRI stays read-only, has bounded bytes and header check, and is copied into the owned job directory with SHA evidence.
5. Run one isolated Blender 5.2 Cycles process, using only trusted bundled scripts, CPU/GPU-with-truthful-fallback, geometry-driven camera, physically based lights/materials and conservative compositor.
6. Validate COMPLETE RGBA8 PNG chunks/CRC and a strictly typed measured render report. Re-check source hash before exclusive, non-overwriting destination write.
7. Return source/worker checksum, camera, lighting, samples, actual device, measured pixels and DRAFT receipt. Status never implies automatic artistic approval.

The human Blockbench panel and AI use the same service. Plugin unload requests cancel. An unconfirmed external process exit blocks a new render. No remote rendering service, third-party addon dependency, model-supplied Python or network asset fetch is used.

## Genuine visual-evidence and feedback route (source implementation)

Completed renders now produce one additional temporary image: a **maximum 384-pixel downsample of the actual saved Cycles PNG**, inside the isolated workdir. It is not generated by another AI, re-rendered with viewport graphics or read from an arbitrary user path.

- The worker validates the render, writes its measured report and creates the small evidence PNG. The TypeScript owner validates the complete PNG structure/CRC and exact report dimensions.
- The final full-resolution PNG is published only after native project revision recheck under the same serialized Runtime queue lease.
- Once completed, the existing `render_publication` capability supports an explicit **preview** operation. It returns a single PNG image content part and compact receipt/diagnostics; status remains text-only to avoid paying repeated image-token costs.
- The same receipt-owned evidence is displayed by the human Blockbench **View Real PNG Preview** control.
- Preview bytes are held in a process-local WeakMap keyed by the completed receipt; they are not uploaded, embedded into job status or retained when the owner becomes unreachable. No independent image service, image generator or fifth Gateway method.
- A render's source job has discrete source/launch/render/verify/publish/terminal phase labels, not invented progress percentages or estimated completion times.
- Optional auto GPU may use one CPU retry only if Blender reports a catchable Cycles render exception; the actual device/backend and fallback reason must be reported accurately. A GPU process crash or timeout cannot be repaired by pretending a CPU render occurred.
- The AI may inspect the thumbnail and choose a new, bounded camera/lighting request. No self-declared artistic PASS or autonomous unlimited rerender loop is introduced.

## Important proof boundary

All new preview, lifecycle, device fallback, and source-revision queue protections are **source-authored and not natively executed in Blender/Blockbench**. Until a genuine environment test passes, a completed visual-evidence path is an implementation design, not an observed working feature or image-quality certification.

## Scope still unsupported

Full non-Cube mesh geometry, authored cutout/translucent/emissive-alpha per-face Bedrock render contracts, arbitrary animation time sampling and MP4, supplied 3D environments/prop libraries, automatic artistic-quality vision review and full HDRI asset catalogue have NOT been implemented. Do not silently substitute generated scenery or pixels. Studio PNG and approved local HDRI lighting are the current source feature.

## Proof required before release

Bun/typecheck/build/generator must pass. Real native Blockbench project GLB must match Blender import for geometry, UV, pose and materials on success and error. Actual Cycles PNG and Blender 5.2 compositor/HDRI need to execute and be evaluated against five user references. Those executable/native gates have NOT run in this source-only GitHub session.

Open-source Blender MCP projects studied in the prior research informed architecture. This is original new code inside LazyDesigner GPL-3.0-only; foreign repository code was not vendored/copied.

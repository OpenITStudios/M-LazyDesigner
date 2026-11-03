# LazyDesigner Blender Core — Publication Rendering

Branch: Render only. State: source-authored; Blender 5.2 native acceptance NOT EXECUTED.

Purpose: high-quality actual Cycles rendering of authored Blockbench geometry/UV/texture, never regenerated AI images or renamed objects.

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

## Scope still unsupported

Full non-Cube mesh geometry, authored cutout/translucent/emissive-alpha per-face Bedrock render contracts, arbitrary animation time sampling and MP4, supplied 3D environments/prop libraries, automatic artistic-quality vision review and full HDRI asset catalogue have NOT been implemented. Do not silently substitute generated scenery or pixels. Studio PNG and approved local HDRI lighting are the current source feature.

## Proof required before release

Bun/typecheck/build/generator must pass. Real native Blockbench project GLB must match Blender import for geometry, UV, pose and materials on success and error. Actual Cycles PNG and Blender 5.2 compositor/HDRI need to execute and be evaluated against five user references. Those executable/native gates have NOT run in this source-only GitHub session.

Open-source Blender MCP projects studied in the prior research informed architecture. This is original new code inside LazyDesigner GPL-3.0-only; foreign repository code was not vendored/copied.

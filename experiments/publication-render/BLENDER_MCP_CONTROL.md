# Independent Blender Render MCP — Gateway Capability Contract

**Target:** `OpenITStudios/M-LazyDesigner`, branch `Render` only  
**Status:** SOURCE-AUTHORED; NOT tested in installed Blockbench, Gateway+Bun, or Blender 5.2; `Local` remains untouched.

## What is implemented

LazyDesigner has **one MCP Gateway** exposing the existing stable four methods: `status`, `search_capabilities`, `describe_capability`, and `invoke_capability`.

Two explicitly distinct application owners:

| Owner | MCP capability / operation | Runtime boundary |
| --- | --- | --- |
| Blockbench native Runtime | `render_publication`, `operation=handoff` | Captures a validated immutable Bedrock Cube/UV/PBR GLB, writes `model.glb` and `handoff.json` to an explicitly authorized directory, then releases the native modeling queue |
| Gateway-local Blender adapter | `blender_render`, `operation=start/status/preview/cancel` | Reads and verifies the handoff, launches the **same trusted** Blender 5.2 Cycles worker in a separate headless subprocess, owns its job, returns compact status and a real PNG preview |

The existing Blockbench-owned `render_publication` `start/status/preview/cancel` convenience path remains for compatibility. It still requires Blockbench to remain loaded and cancels when its plugin unloads. **Do not run both render-start paths concurrently on the same CPU/GPU until a real resource budget is measured.**

The Gateway-local Blender job **does not require Blockbench to remain open after its immutable handoff has completed**. Gateway itself must stay running. It has **no persistent job recovery across Gateway restart**, no Blender scene-editing API, no arbitrary user-provided Python, no second MCP server, no GPU scheduler and no background service/daemon. On Gateway shutdown it requests cancellation and awaits the child-process close contract.

## Operator workflow (once approved for local validation)

The handoff and independent worker must run on a host where **both processes can see the same local filesystem**. A cloud Gateway cannot use a Windows desktop path it cannot access.

**1. Capture source from Blockbench:**

```json
{
  "capability": "render_publication",
  "arguments": {
    "operation": "handoff",
    "request": {
      "directory": "C:\\Art\\MIVUBI"
    }
  }
}
```

The tool returns `handoff_path`, `glb_path`, the source project UUID, source SHA-256, GLB SHA-256, cube count and material count. It does not launch Blender or mutate the source editor. Save the returned `handoff_path` for step 2; it points to a new `.lazydesigner-blender-handoff-<random>/handoff.json` directory.

**2. Control Blender through the *same* MCP Gateway:**

```json
{
  "capability": "blender_render",
  "arguments": {
    "operation": "start",
    "handoff_path": "C:\\Art\\MIVUBI\\.lazydesigner-blender-handoff-<actual returned id>\\handoff.json",
    "request": {
      "blender_executable": "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe",
      "output_path": "C:\\Art\\MIVUBI\\asset_publication.png",
      "quality": "preview",
      "width": 640,
      "height": 640
    }
  }
}
```

The `<actual returned id>` notation is explanatory: replace the entire `handoff_path` with the exact path returned in step 1. The request is not executed until the user supplies an actual installed Blender executable and an explicit writable output destination.

**3. Inspect or cancel the Gateway-owned job:**

```json
{
  "capability": "blender_render",
  "arguments": {
    "operation": "status",
    "job_id": "blender_<actual returned id>"
  }
}
```

Use `operation=preview` to return a bounded image from the completed Cycles PNG, or `operation=cancel` to request shutdown. Both use the same job ID. If the `start` reply/job ID is lost while the Gateway remains running, call `blender_render` with `{"operation":"status"}` to recover the **latest process-local job ID**; `preview` and `cancel` still require the exact ID. Preview is a **DRAFT**; a source-compatible image is not an artistic approval or Minecraft certification.

## Exact application and trust boundaries

- The source of truth is the Blockbench model when the snapshot is captured. Blender never edits the original Cube, UVs, texture pixels, hierarchy, animation, Undo stack or active project.
- The handoff is explicitly exported, local and immutable by convention: `model.glb` + `handoff.json`. SHA-256 content digests detect mismatches. The JSON is **not an authenticated signature** against an attacker able to replace both files; access to the handoff folder remains the user's responsibility.
- Gateway reads only a bounded, explicitly selected handoff. It rechecks GLB framing, Cube node identity, indexed triangles, UVs, material factors, texture roles and embedded PNG byte SHA-256, using the pre-existing validators—not a second 3D model parser.
- The same `lib/publication/blenderProcess.ts` owns worker source bundling and subprocess lifecycle in both render entrypoints. No duplicated camera/lighting/Cycles engine.
- Gateway uses one job at a time. A new job cannot run while one is pending, cancelling or its child exit is uncertain.
- Output is an exclusive, non-overwriting PNG write. If the subprocess fails to confirm exit, its temporary directory is retained; success is never assumed.
- An output receipt contains source project UUID, original source SHA-256, GLB hash, **exact trusted worker-bundle SHA-256**, effective image/camera/light/sampling/environment settings, output PNG hash, measured diagnostics and `source_revision=FROZEN_HANDOFF_NOT_LIVE_EDITOR`. It does **not** claim the currently open editor still matches the handoff.
- The Blender capability's `start/status/preview/cancel` input schema is derived from **one strict Zod discriminated-union contract**: `describe_capability` exposes the same fields used to validate `invoke_capability`. Unknown branches and stray properties are rejected before a subprocess is admitted.
- A Gateway-local Blender job cannot claim the active Blockbench project's UUID merely because Gateway still has that tab bound. Its receipt always carries the original snapshot project UUID as source provenance, not a native edit claim.
- The handoff persists until explicitly deleted by the user. Gateway's temporary subprocess files are separate and cleaned only after confirmed process close.

## Explicit boundaries before use

- **SOURCE-AUTHORED:** Gateway provider registration/discovery, Blockbench handoff, source-to-GLB checksum gates, shared trusted worker, process lifecycle, job status/cancel/preview, Gateway shutdown ownership and focused regression intents.
- **NOT EXECUTED:** Bun/TypeScript full source checks, worker subprocess contract, installed Blockbench permission/UI behavior, actual Blender 5.2 import and Cycles PNG, performance, visual comparison.
- **NOT BUILT:** direct Blender interactive edit MCP, automatic single-call `render_publication` → Gateway handoff orchestration, durable restart recovery, render farm, persistent job database, cross-process GPU lock. These require separate, demonstrated needs.

**Development rule:** do not request local testing, merge to `Local`, or claim release readiness until the user separately authorizes them. Continue only source-level corrections grounded in a demonstrated defect.

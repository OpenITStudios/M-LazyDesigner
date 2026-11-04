# Independent Blender Render MCP — Gateway Capability Contract

**Target:** `OpenITStudios/M-LazyDesigner`, branch `Render` only  
**Status:** SOURCE-AUTHORED; NOT tested in installed Blockbench, Gateway+Bun, or Blender 5.2; `Local` remains untouched.

## What is implemented

LazyDesigner has **one MCP Gateway** exposing the existing stable four methods: `status`, `search_capabilities`, `describe_capability`, and `invoke_capability`.

Two explicitly distinct application owners:

| Owner | MCP capability / operation | Runtime boundary |
| --- | --- | --- |
| Blockbench native Runtime | `render_publication`, `operation=handoff` | Captures a validated immutable Bedrock Cube/UV/PBR GLB, writes `model.glb` and `handoff.json` to an explicitly authorized directory, then releases the native modeling queue |
| Gateway-local Blender adapter | `blender_render`, `operation=auto/start/status/preview/cancel/recover/release` | One-call `auto` obtains the Blockbench GLB handoff and launches the **same trusted** Cycles worker; explicit `start` still consumes a prepared handoff. Completion, preview and cleanup retain their existing safety contracts |

The existing Blockbench-owned `render_publication` `start/status/preview/cancel` convenience path remains for compatibility. It still requires Blockbench to remain loaded and cancels when its plugin unloads. Both entrypoints now use a **cooperative atomic directory lease** when writing into the *same output directory*. Different output directories DO NOT share this lock: do not schedule concurrent GPU-heavy renders to distinct directories until resource budgets are measured. There is no host-wide scheduler.

The Gateway-local Blender job **does not require Blockbench to remain open after its immutable handoff has completed**. Gateway itself must stay running for an **active** render. **Completed** jobs persist a bounded receipt and verified preview next to the final PNG and can be restored with `operation=recover` after Gateway restart; unfinished or unconfirmed subprocesses cannot be resurrected. There is no interactive Blender scene-editing API, arbitrary user Python, second MCP server, GPU scheduler or background service/daemon. Gateway shutdown requests cancellation and awaits the child-process close contract.

## One-request render workflow (source-authored; NOT runtime-tested)

Configure the existing Gateway host **once** outside this repository:
`LAZYDESIGNER_BLENDER_EXECUTABLE` is an installed absolute Blender 5.2 executable,
and `LAZYDESIGNER_RENDER_OUTPUT_DIRECTORY` is an existing explicit user-approved
folder visible to the Gateway **and** native Blockbench. No implicit filesystem
permissions, guessed paths, downloaded assets, second MCP server or GPU farm.

With the current Bedrock Entity project open, the AI can call the existing
`invoke_capability` with `{"capability":"blender_render","arguments":{"operation":"auto"}}`.
Optional `options` select quality, aspect, background, device or color view
transform. The Gateway requests `render_publication(operation=handoff)` once,
verifies the immutable GLB, starts the independent Cycles worker and returns
a job ID. AI then uses `status` and one real `preview` after
`RENDERED_DRAFT`; it never treats a started job as successful PNG publication.

Auto-owned handoffs are source-verified and released after confirmed terminal
worker closure; interrupted/uncertain outcomes retain available evidence for
review rather than repeating the native mutation. Output PNG/preview/receipt
are exclusive and not deleted by handoff cleanup. Gateway must remain running
until completion. This is a Gateway subprocess, not background ChatGPT work.
Visual quality remains `NOT_EVALUATED` until separately reviewed.

**Proof ceiling:** Gateway/Runtime/worker code and regressions are authored, not
Bun/typecheck, native installed Blockbench/Blender or artistic QA verified.

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

**4. Recover a completed outcome after a Gateway restart:**

```json
{
  "capability": "blender_render",
  "arguments": {
    "operation": "recover",
    "receipt_path": "C:\\Art\\MIVUBI\\asset_publication.png.lazydesigner.json"
  }
}
```

Completed jobs publish THREE exclusive, non-overwriting files: `asset_publication.png`, `asset_publication.png.lazydesigner.preview.png`, and `asset_publication.png.lazydesigner.json`. The JSON is a bounded factual report, not a live Blender process. Recovery verifies the exact PNG/preview checksums and dimensions and restores the completed job plus its preview. A crashed, cancelled or interrupted render cannot be labeled completed using this operation.

**5. Explicitly release a handoff when it is no longer needed:**

```json
{
  "capability": "blender_render",
  "arguments": {
    "operation": "release",
    "handoff_path": "C:\\Art\\MIVUBI\\.lazydesigner-blender-handoff-<actual returned id>\\handoff.json"
  }
}
```

Only the verified `handoff.json` and `model.glb` files inside the exact owned directory are removed. The operation refuses while the Gateway's current job uses that handoff, if the handoff cannot pass the source hash checks, or if unrelated files exist in its directory. No recursive user-directory deletion; no silent cleanup of older handoffs. Because `release` deletes files, the combined `blender_render` tool conservatively advertises `destructiveHint=true`; the branch manifest still classifies `status` and `preview` individually as QUERY operations.

## Exact application and trust boundaries

- The source of truth is the Blockbench model when the snapshot is captured. Blender never edits the original Cube, UVs, texture pixels, hierarchy, animation, Undo stack or active project.
- The handoff is explicitly exported, local and immutable by convention: `model.glb` + `handoff.json`. SHA-256 content digests detect mismatches. The JSON is **not an authenticated signature** against an attacker able to replace both files; access to the handoff folder remains the user's responsibility.
- Gateway reads only a bounded, explicitly selected handoff. It rechecks GLB framing, Cube node identity, indexed triangles, UVs, material factors, texture roles and embedded PNG byte SHA-256, using the pre-existing validators—not a second 3D model parser.
- The same `lib/publication/blenderProcess.ts` owns worker source bundling and subprocess lifecycle in both render entrypoints. No duplicated camera/lighting/Cycles engine.
- Gateway uses one job at a time. A new job cannot run while one is pending, cancelling or its child exit is uncertain. Blockbench and Gateway use the same output-directory Cycles lease only when both write into the SAME directory. There is no host-wide or per-user GPU lock because Blockbench's filesystem permission is limited to the user-approved output directory. Cross-directory coordination would require an explicitly authorized common lock location; it must not silently expand Blockbench's permissions. Any lease left after an uncertain exit is not auto-broken.
- Output consists of three exclusive, non-overwriting files (PNG, small evidence PNG, completion JSON). The JSON is published last as the completed-outcome marker. Failed partial publication attempts revert only files whose bytes still match the attempted job. If the subprocess fails to confirm exit, temporary assets and the directory lease are retained; success is never assumed.
- An output receipt contains source project UUID, original source SHA-256, GLB hash, **exact trusted worker-bundle SHA-256**, effective image/camera/light/sampling/environment settings, output PNG hash, measured diagnostics and `source_revision=FROZEN_HANDOFF_NOT_LIVE_EDITOR`. It does **not** claim the currently open editor still matches the handoff.
- The Blender capability's `start/status/preview/cancel` input schema is derived from **one strict Zod discriminated-union contract**: `describe_capability` exposes the same fields used to validate `invoke_capability`. Unknown branches and stray properties are rejected before a subprocess is admitted.
- A Gateway-local Blender job cannot claim the active Blockbench project's UUID merely because Gateway still has that tab bound. Its receipt always carries the original snapshot project UUID as source provenance, not a native edit claim.
- The handoff persists until explicit `blender_render(operation=release)` or manual deletion. A short-lived atomic `.lazydesigner-handoff-active` directory lease is shared by Gateway GLB readers and the `release` operation: one Gateway cannot remove an in-use handoff while another Gateway is verifying it. A missing process close or orphaned lease requires explicit inspection—no automatic stale-lock breaking. Other software manipulating the files directly does not honor this lease. Gateway subprocess scratch files are separate and cleaned only after confirmed process close.

## Explicit boundaries before use

- **SOURCE-AUTHORED:** Gateway provider registration/discovery, Blockbench handoff, source-to-GLB checksum gates, shared trusted worker, process lifecycle, job status/cancel/preview, Gateway shutdown ownership and focused regression intents.
- **NOT EXECUTED:** Bun/TypeScript full source checks, worker subprocess contract, installed Blockbench permission/UI behavior, actual Blender 5.2 import and Cycles PNG, performance, visual comparison.
- **NOT BUILT:** direct Blender interactive edit MCP, automatic single-call `render_publication` → Gateway handoff orchestration, recovery of ACTIVE jobs across Gateway restart, render farm, persistent job database, and cross-output-directory GPU scheduling. A bounded same-output-directory process lease, short-lived inter-Gateway handoff read/delete lease, completed-outcome receipt recovery and explicitly verified handoff release are SOURCE-AUTHORED.

**Development rule:** do not request local testing, merge to `Local`, or claim release readiness until the user separately authorizes them. Continue only source-level corrections grounded in a demonstrated defect.

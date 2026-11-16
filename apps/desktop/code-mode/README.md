# LazyDesigner Rust Code Mode — source-only agent bridge

**Status:** Rust-branch source integration; local JS host, Rust executable, and native editor **NOT_EXECUTED**. This is a Code Mode *client-side programmatic API*, not an installed server-side Cloudflare Worker sandbox and not a claim of accepted end-to-end asset production.

## End-to-end Code Mode host source — 2026-11-15

The first-party **host.mjs**, **sandbox-worker.mjs** and **run.mjs** now
implement a local agent-program execution path instead of leaving the
sandbox and host as only a proposal. **createCodeModeTool(host)** exposes
one model-facing input, a bounded JavaScript code string. The host launches
a fixed Deno guest with no I/O grants and no prompt; guest code can call
only named codemode.* methods through typed, bounded RPC. The trusted Node
host verifies the project/sibling paths and invokes the existing Rust CLI.
Every mutation is denied unless an independent host-owned authorization
callback explicitly approves it. The Rust engine remains the sole model
owner; resulting files are new siblings with SHA/revision receipts.

The host supports opening an existing .bbmodel OR bootstrapping New from a trusted existing output directory (the initial project handle is null until newModel returns its first SHA-bound handle). The built-in local CLI is **read-only by default**. Write operations require
an explicitly selected interactive operator path or an independently
authorized host callback. It supports New, Edit, Paint PNG import, PNG and
Bedrock geometry export, and every existing focused/batched read; unsupported
Rust authoring capabilities remain unavailable rather than silently emulated.

**State:** SOURCE_AUTHORED / HOST_NOT_EXECUTED. Deno and native runtime
dependencies are not installed from this GitHub session, and true OS
isolation, Blockbench parity, user visual QA and cost savings remain UNVERIFIED.
See [host setup and execution contract](HOST_INTEGRATION.md).

## Decision and ownership
Use one code-execution entry at the **agent host** (Codex CLI or another authenticated, explicitly authorized PC-local host) to write JavaScript/TypeScript which composes calls to `createRustCodeModeClient`. The SDK calls the existing first-party headless `lazydesigner-authoring` binary without `shell`, and Rust alone owns validation, model state, transaction atomicity, Undo/Redo, and non-overwriting publication.

No `eval`, `node:vm`, untrusted remote JS endpoint, cloud Worker loader, implicit filesystem permission, or new model engine is introduced. **This SDK is not an execution sandbox.** The host must enforce code execution, filesystem access, and mutation authorization. Do not run generated scripts with unrestricted Node privileges as a substitute for an approved host. The SDK only restricts its own CLI arguments and payloads.

## Compact API (types in client.d.mts)

**Animation Clip variants (Rust source only):** To create `attack` from `walk`, submit one `duplicate_animation_clip` EditOperation with `{source_uuid,new_uuid,new_name}` inside the existing SHA/revision-guarded, trusted-host-approved `apply` plan. Rust clones the admitted numeric Bone clip, all keyframes and interpolation/Bezier data, assigning stable new keyframe UUIDs. The original remains unchanged and both clips are separately editable. The operation refuses duplicate names/IDs, malformed/opaque source tracks, external identity conflicts and oversized .bbmodel results; it does **not** clone or re-author imported effects/controllers of unknown shape. Existing Code Mode sandbox/host gating remains unchanged. Source regressions AUTHORED_NOT_RUN, native playback and measured tool savings UNVERIFIED.


**Saved Bezier handle control (Rust source, 2026-11-16):** `set_bone_transform_keyframe_bezier` accepts one exact `{animation_uuid,bone_uuid,keyframe_uuid,channel,handles}` operation. `handles` has `linked:boolean`, and `leftTime/leftValue/rightTime/rightValue` as three-component numeric arrays. Rust validates each handle, the referenced channel/keyframe, the whole numeric clip and unambiguous time control segments, then saves Blockbench's native `bezier_* ` fields without sampling or rewriting pixels. Link mode requires opposing time/value handles. The same plan can add a key and set its Bezier controls in one host-approved mutation. The bounded transform/rotation reads return the source `bezier` payload only for recognized curves; existing `scope` labels remain stable. Imported Molang/opaque/incomplete Bezier is not guessed. Local/Blockbench runtime and performance **NOT_EXECUTED/UNVERIFIED**.


**Numeric Catmull-Rom source (2026-11-16):** The existing `set_bone_transform_keyframe_interpolation` typed Rust operation now accepts `interpolation:'catmullrom'` in addition to `linear/step`, for strictly admitted single-numeric-point Bone Position, Rotation and Scale keys. The mode is saved in the Blockbench keyframe field and preserved through other supported edits and timeline retiming. For AI-authored curves, add the numeric keys and set their interpolation in one approved Rust plan; do not simulate spline sampling in the Code Mode guest. `inspectAnimationTransformTrack` keeps legacy scope identifiers but reports per-key `interpolation` and the full admitted mode set. Rust/Tauri own saved state and read-only viewer interpolation; Bezier handles, Molang, controllers and effects are still opaque. Source regressions AUTHORED_NOT_RUN; no native Blockbench playback or performance comparison.


**Numeric Bone Step (2026-11-16; SOURCE_ONLY):** One typed Rust `set_bone_transform_keyframe_interpolation` operation takes `{animation_uuid, bone_uuid, keyframe_uuid, channel:'rotation'|'position'|'scale', interpolation:'linear'|'step'}`. It edits the outgoing segment of that exact keyframe under the current document/SHA and host authorization; the existing `add_bone_transform_keyframe` still creates `linear` by default. To create a Step key, add it and set its mode in one approved Rust edit plan. `inspectAnimationTransformTrack` returns explicit saved `interpolation` on supported numeric keys; legacy `scope` labels remain stable with `interpolation_modes` documenting the admitted `linear/step` subset. Imported Bezier, Catmull-Rom, Molang, effects and unknown metadata remain preserved but are not editable by this operation. Local runtime and native Blockbench playback NOT_EXECUTED.


**Explicit material-palette variants (Rust source only):** `recolor_cube_faces_palette_guarded` accepts one `texture_uuid`, 1–16 `targets: [{cube_uuid,faces:[...]}]` and 1–32 exact `palette: [{from:[r,g,b],to:[r,g,b]}]` RGB pairs. The source RGB must be grounded in approved/current PNG pixels; a material name is *not* an input from which Rust invents a swatch. Rust reuses its guarded saved face-to-atlas mapping and one PNG pass to preserve all original material clusters and per-pixel alpha, and refuses face/atlas aliases or unsupported source formats. When creating an appearance variant, write to an authorized new output file, not over the source. The Code Mode host still requires independent write approval; tests NOT_EXECUTED, artistic/native acceptance UNVERIFIED.


**Face-local Texture zones (Rust source only):** The typed `paint_cube_face_regions_guarded` EditOperation accepts explicit `cube_uuid`, `texture_uuid` and up to 64 ordered `regions: [{face, from:[u,v], to:[u,v], rgba:[r,g,b,a], erase}]`. Face-local `from` is inclusive and `to` exclusive, relative to the face's saved displayed UV orientation, **not atlas-pixel coordinates**. Rust handles signed UV/quarter-turn mapping, strict source-level shared-atlas refusal and one owned PNG/Undo transaction. This does not infer materials or certify six-face visual coverage; code execution and native Blockbench verification remain NOT_EXECUTED.


The SDK is ready for a **host-provided** Code Mode program. `openRustCodeModeProject` binds a path and observed file SHA-256 so subsequent reads and writes fail closed if the source changes. Normal inspection is read-only:

```js
import { createRustCodeModeClient, openRustCodeModeProject } from './client.mjs';

const ld = createRustCodeModeClient({
  binary: '/absolute/path/to/lazydesigner-authoring',
});
const project = await openRustCodeModeProject(
  ld, '/absolute/path/to/model.bbmodel',
);
const firstPage = await project.catalog('cubes', { limit: 16 });
const audit = await project.audit();
console.log({
  sha256: project.expectedSha256,
  firstCubeIds: firstPage.catalog.entries.map(({ uuid }) => uuid),
  faceLinks: audit.audit.faces,
  visualVerification: audit.audit.visual_verdict,
});
```

The sample is illustrative, **NOT_EXECUTED**, and presumes an authorized local host and already-built first-party Rust CLI.

### Write authorization (trusted host only)

All `newModel`, `apply`, `importPng`, `exportPng`, and `exportGeometry` operations **deny by default** unless the trusted host supplies `authorizeMutation`, which must return exactly `true` for each action. Approval receives the exact output path, source SHA and (for edit plans) operation types/count and a SHA-256 digest of the serialized plan. This callback is a guardrail and audit hook, **not** a security sandbox: untrusted scripts running with unrestricted Node/OS privileges can bypass it or directly run executables. A real host must isolate model-authored programs and inject a preconfigured client rather than trusting an agent-supplied authorizer.

Only after the host confirms a specific mutation, a host-supplied project can call:

```js
// `project` was created by the trusted host; the host owns authorization.
const candidate = await project.apply({
  output: '/absolute/path/to/model-candidate.bbmodel',
  operations: [{ op: 'translate_cube', uuid: approvedCubeUuid, delta: [1, 0, 0] }],
});
console.log({
  outputSha256: candidate.output_sha256,
  changed: candidate.mutation.changed_uuids,
});
```

Do not copy this into an unrestricted Node process as a substitute for host isolation. The example's `approvedCubeUuid` is a placeholder: an actual UUID must come from the bounded catalog and the approved asset plan.

### Batch inspection: one model load for several focused reads

For Code Mode reasoning across a catalog, Cube UVs, Paint data and audit,
`project.inspectBatch(requests)` dispatches one SHA-verified, read-only Rust
`inspect-batch` command and one canonical `EditorSession::open`.
The batch does not mutate the project or execute model-written code.

```js
const report = await project.inspectBatch([
  { kind: 'catalog', category: 'cubes', limit: 8 },
  { kind: 'cube_surfaces', uuid: approvedCubeUuid },
  { kind: 'cube_face_alpha', uuid: approvedCubeUuid },
  { kind: 'audit' },
]);
console.log(report.results.map(({ kind }) => kind));
```

`approvedCubeUuid` must come from an actual user-authorized asset selection,
not an invented ID. The real agent host still owns process sandboxing.
Supported kinds: `cube`, `cube_surfaces`, `cube_face_alpha`, `catalog`,
`texture`, `texture_alpha`, `animation`, `animation_track`, `audit`.

- Bounds: 1–8 typed selectors, 64 KiB private request JSON, 96 KiB result.
- Safety: refuse stale SHA, unknown fields, over-limit pages and invalid assets.
- Compatibility: previous focused read CLI commands remain unchanged.
- Proof: SOURCE_REVIEWED / TEST_AUTHORED_NOT_RUN. No actual speed, token or
  quality measurements; rendered material and visual verdicts remain UNVERIFIED.

### API behavior
- `inspect({input})`: summary + source SHA.
- `catalog({input,kind,offset,limit})`: paginated Cube/Bone/Texture/Animation identities, with 1–64 results per page.
- `inspect({input,uuid})`: focused Cube/Bone fields, not full model JSON.
- `inspectCubeSurfaces({input,cubeUuid,expectedSha256})`: all six saved Cube faces with UV rectangles, supported quarter-turn orientation, exact reference kind (`index`, `uuid`, `false`, `null`, or unset), referenced texture index/UUID and declared source kind; uses `project.inspectCubeSurfaces(uuid)` for SHA-bound reads. **Not** a decoded texture coverage or effective-material verdict: Bedrock default and multi-file rules can override stored face references. Result is bounded to 16 KiB and reports `visual_verdict:UNVERIFIED`.
- `inspectCubeFaceAlpha({input,cubeUuid,expectedSha256})`: **one SHA-pinned call for six saved manual Face UV rectangles**. Rust decodes each unique, explicitly referenced supported RGBA8 PNG at most once and counts transparent/translucent/opaque pixels inside an exact integer-bound UV rectangle. It refuses Box UV, Auto UV, multi-file/per-texture rules, external/unsupported textures, missing/false/null references, non-integer/out-of-atlas/zero-area UVs with an explicit per-face reason; malformed supported PNGs fail the whole request. `project.inspectCubeFaceAlpha(uuid)` exposes the same result. `status:measured` refers only to **source PNG pixels in saved UV regions**; effective material, actual face coverage, animation and occluded/visible 3D quality remain `UNVERIFIED`. No raw pixel data are echoed.
- `inspectTexture({input,index})` / `inspectAnimation({input,uuid})`: bounded metadata only, with no bitmap/opaque animation payload.
- `inspectTextureAlpha({input,textureUuid,expectedSha256})`: **fully decoded RGBA8 alpha statistics** for one validated embedded PNG (project atlas 1–256 px per side), with transparent/translucent/opaque pixel counts and fixed 8×8 sample/nonzero-alpha bins. The SHA-bound project offers `inspectTextureAlpha(textureUuid)`. Unknown/imported advanced textures and multi-file UV rules return `supported:false`; a corrupt supposedly supported PNG fails explicitly. No raw pixels or source metadata are returned. Alpha distribution is **not** proof of UV face coverage, hidden-surface paint quality, or a native visual PASS.
- `inspectAnimationTrack({input,animationUuid,boneUuid,offset,limit,expectedSha256})`: bounded (1–64) numeric linear Bone rotation keyframes with UUID/time/XYZ for an exact track. The Rust Core reuses its recognized rotation-frame predicate. Imported Molang or unsupported tracks return `recognized:false`, no opaque keyframe body and `visual_verdict:UNVERIFIED`. The path/SHA-bound project exposes the same method.
- `audit({input})`: source-derived face-reference, source-type, rig and clip counts. `visual_verdict` remains `UNVERIFIED`: count-based QA does not establish texture coverage, silhouette fidelity or animation correctness.
- `openRustCodeModeProject(client,input)`: path/SHA-bound helper that exposes the same reads plus preconditioned output methods. It **does not** cache a mutable model in JavaScript.
- `apply`: one existing Rust transaction (1–128 operations, at most 64 KiB) against an opened CLI document revision 0 and an exact source SHA; a private plan file is created only after host approval.
- `importPng`, `exportPng`, `exportGeometry`: first-party CLI operations and non-overwriting output. Never auto-retry after unknown outcome.

See [local agent host integration](HOST_INTEGRATION.md) for required sandbox and approval boundaries.

## Transition boundary

This is the first functional Code Mode adapter on `Rust`. Existing Blockbench-based `Local` Gateway and all specialist Skills remain intact. Do not call Code Mode a complete replacement until the adapter is integrated into the actual agent host, focused reads/edits cover required asset workflows, full format/cross-mode parity is verified and measured acceptance shows no regressions. No deployment, dependency installation, editor UI rewrites, or local tests are performed by the GitHub source phase.

Official pattern references: https://developers.cloudflare.com/agents/tools/codemode/ ; https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/ . Cloudflare's Worker-based sandbox is a **different** implementation; do not copy its token saving figures as LazyDesigner measurements.

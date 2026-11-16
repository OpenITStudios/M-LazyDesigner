# LazyDesigner Rust Code Mode — source-only agent bridge

**Trusted image review and correction scope (2026-11-16; SOURCE_ONLY):**
`createCodeModeHost` can now receive an optional, independently operator-owned
`reviewVisualPair` function alongside the SHA-pinned `preselectedVisualPair`.
It is passed both actual selected PNG buffers and source/view identities in
trusted Node, not in Deno. The host returns only bounded issue evidence,
`ACCEPTED | REJECTED | UNVERIFIED` and an allowed texture correction area;
this is an operator declaration, never an automatic AI visual PASS.
A `REJECTED` response authorizes the **review direction only**: exact
`correctionScope` must remain within the reviewer-set atlas rectangles and
respect mandatory alpha preservation, and a separate host write approval
and Rust scoped mutation check still apply. `ACCEPTED` blocks further
pixel changes on that reviewed snapshot. `UNVERIFIED`, invalid feedback
or stale images cannot authorize Paint; with no reviewer configured the
previous numeric preflight remains, explicitly `NOT_RECORDED`.
One successful reviewed Paint cohort consumes the selected snapshot
for the current trusted host session. Additional Paint attempts from the
old model SHA are refused until a new capture/review is bound to the
new revision; the existing bounded Rust batch still permits multiple
coherent operations inside the one authorized transaction. This is not
a persistent retry registry or an artistic improvement claim.
No files, images or human verdict are persisted by this mechanism.
Source-only regressions AUTHORED_NOT_RUN; host/AI review effectiveness
and asset acceptance remain unverified.


**Operator-selected reference/capture binding (2026-11-16; SOURCE_ONLY):**
Code Mode host now supports an optional `preselectedVisualPair` made of
two operator-selected still PNGs, their exact SHA-256, a view label and a
source-model SHA. `codemode.inspectSelectedVisualPair` calls one bounded
read-only Rust inspector; no image paths or raw pixels reach model code.
Matched-size RGB/RGBA8 captures may produce alpha-overlap and pixel-difference
diagnostics, but a full opaque background returns silhouette unassessed.
A configured image pair requires one successful source-SHA-matched preflight
before any guest pixel edit and preserves the existing correctionScope.
Neither tool call nor numeric overlap proves image ingestion, correct framing,
human reference approval, material craft or visual PASS. When the project
changes, rebind the capture to its new exact SHA; do not reuse stale evidence.
Regression cases source-authored, NOT_EXECUTED.


**Host-selected material master and measured patch comparison (2026-11-16; SOURCE_ONLY):**
For a Pillager-style tier correction, the trusted operator may configure
`approvedMaterialReferenceUuid` for an already-accepted texture in the
selected `.bbmodel`. The guest must call `codemode.inspectApprovedMaterial`
with `project`, `candidateTextureUuid`, `referenceRegion` and
`candidateRegion`; the host supplies the immutable master UUID and pinned
model SHA, not an agent-supplied reference identity. Matched PNG rectangles
use physical pixels, exclusive end coordinates and a 4,096-pixel limit.
The canonical Rust RGBA8 decoder measures each crop's visible color variety,
horizontal/vertical color transitions, rough luminance range, and alpha;
pairwise RGBA/alpha differences and attention candidates are read-only and
never a material or artistic PASS. Candidate regions with flat color can be
flagged relative to a visibly varied master, but intentional flat materials
remain valid. The generic guest inspectBatch cannot invoke `material_pair`
and a scoped paint cannot target the operator-selected master directly.
While a trusted master is configured, any Code Mode pixel-authoring operation
must supply a Rust-enforced `correctionScope`; omitting it now fails before
operator approval and before native mutation. Generic independent structural
edits remain governed by ordinary operator approval.
This only applies to an explicitly selected master texture within the same
model; standalone photographs/reference renders, cross-mesh UV differences,
semantic material matching, actual image ingestion and user approval are
still unverified. Rust/Node regression source AUTHORED_NOT_RUN.

**Scoped existing-texture correction (2026-11-16; SOURCE_ONLY):**
The same approved Code Mode apply supports an optional correctionScope for one
current atlas. Example: correctionScope: {textureUuid:'tier2-atlas',
allowedRegions:[{from:[12,8],to:[18,24]}],preserveAlpha:true}.
Coordinates are physical PNG pixels and to is exclusive, with at most 16
rectangles. Rust refuses the whole edit when any other atlas pixel, another
texture, Cube, UV, rig, animation, metadata or unknown model field changes.
For RGB-only grading, preserveAlpha additionally prohibits alpha changes even
inside the allowed regions. The guard is enforced before revision/Undo commit
and before the no-overwrite publish. It is optional for general model creation
or deliberate structural edits, but should be supplied for corrections of
already-approved visual regions. The host receives the exact immutable allowed rectangles in its approval
request, so an operator-owned policy can compare them against authorized
regions rather than trusting model-generated claims. The trusted host approves the whole bound
plan; source SHA and region restrictions do not establish that a visual
reference was actually compared or that material shading is professionally
correct. The Rust receipt retains visual_verdict: UNVERIFIED.
Rust/Node regression tests AUTHORED_NOT_RUN; native behavior UNVERIFIED.

**Explicit Animation visibility envelope (2026-11-16; SOURCE_ONLY):** A trusted Code Mode host can authorize one standard SHA-pinned Rust `apply` operation `{op:'set_visible_box',bounds:[widthBlocks,heightBlocks,offsetYBlocks]}`. This stores the recognized Blockbench `.bbmodel.visible_box` project property, not a second Geometry file or a renderer-owned override. The existing Geometry exporter computes a conservative static envelope and takes the union with these user-authored minimum bounds to accommodate known animation reach without enlarging all models automatically. Invalid/nonfinite/beyond supported values refuse; permission approval, no-overwrite publisher, Undo/Redo and project source integrity are unchanged. Untrusted guest reads do not grant write authority. Node and Rust regressions AUTHORED_NOT_RUN; native culling under animation remains UNVERIFIED. The existing `asset_handoff` read returns Geometry-exported `visible_bounds: {width,height,offset}` in blocks and a `visible_bounds_source` flag; it is read-only and says nothing about arbitrary animation poses, so inspect actual motion and native culling separately.

**Texture coverage focused agent read (2026-11-16; SOURCE_ONLY):** A Code Mode agent can request `{kind:'model_texture_coverage',offset:0,limit:4,attention_only:true}` through the existing SHA-pinned `inspectBatch` read. Rust still checks all six sides of each scanned Cube and shares decoded atlas pixels within the page, but emits only faces needing source review. `reviewed_cubes` and `next_offset` use the scanned Cube count even if `returned_cubes` is zero; follow every `next_offset` rather than treating an empty filtered page as completion. Inspect `fully_transparent_faces`, `partially_transparent_faces`, `translucent_faces` and `unresolved_reference_or_mapping_faces` without claiming a visual defect from alpha alone. Omit `attention_only` or set false for the original full result. New selector field is boolean-only and read-only; this is not automatic repaint, file publication or a native quality PASS. Source tests NOT_EXECUTED.

**UV-aware source preflight (2026-11-16; SOURCE_ONLY):** `codemode.inspectBatch([{kind:'asset_handoff',texture_uuid:'...',offset:0,limit:16}])` now also pinpoints selected-atlas faces whose saved manual or derived Box UV rectangle lies outside the atlas or has zero area, and distinguishes unsupported Box projection. `issues[].uv_rect` and `uv_source` give bounded metadata for manual review; reversed/fractional in-range UVs are not coerced to integer pixel coordinates. The inspector remains read-only and never approves a UV edit; the agent must inspect/reason about intended UV layout before using a separately authorized Rust edit. It does not check visual shading or every pixel's alpha: existing paged `model_texture_coverage` is the separate source-only follow-up. Tests authored NOT_EXECUTED.

**One-face correction after paged inspection (2026-11-16; SOURCE_ONLY):** After reading exact `asset_handoff.issues[]` UUID/face evidence, an authorized Code Mode host can submit `{op:'assign_cube_face_texture', cube_uuid:'...', face:'north', texture_uuid:'...'}` through the existing SHA-pinned, permission-approved Rust `apply` plan. Unlike `assign_cube_texture`, this alters precisely one enabled/non-null face and preserves all other Cube UV/texture references and PNG bytes; inappropriate imported UV rules or disabled faces refuse atomically. The Code Mode guest receives no additional filesystem or uncontrolled tool rights, and the inspector itself never fixes anything automatically. Regression source AUTHORED_NOT_RUN.

**Paged asset handoff offenders (2026-11-16; SOURCE_ONLY):** An AI agent can now call the existing `codemode.inspectBatch` selector with `{kind:'asset_handoff', texture_uuid:'...', offset:0, limit:16}` and follow `next_issue_offset` to inspect every problematic Cube face. Each issue gives exact `cube_uuid`, `face`, `problem`, `reference_kind` and `referenced_texture_uuid` (if available). The stable `source_consistent/blocked` report and exporter hashes remain source-only; the agent must choose a correction using existing Rust operations after inspecting reference intent and UV. No new model tool or automatic destructive repair. Rust/CLI/JS regressions are authored, NOT_EXECUTED.

**Bedrock asset handoff inspection (2026-11-16; SOURCE_ONLY):** The existing `codemode.inspectBatch` API now accepts `{kind:'asset_handoff',texture_uuid:'<approved-texture-uuid>'}`. The Rust engine examines all saved Cube face texture bindings, derives exactly which single atlas is referenced, and reuses the current Geometry/PNG/Animation exporters in a single SHA-bound read without creating any output files. The bounded receipt reports per-exporter source hashes/errors, explicit face-reference counts, blockers, `visual_verdict: UNVERIFIED` and `native_verdict: NOT_EXECUTED`; `source_consistent` is a source-data classification, not visual/native PASS. Reject mismatched/unassigned atlas references and missing/opaque assets rather than taking the first texture. This adds only an inspect-batch selector, not a new host tool/permission/router. Rust/CLI/Node tests AUTHORED_NOT_RUN.

**Supported Bedrock animation curves (2026-11-16; SOURCE_ONLY):** The existing `codemode.exportAnimations` operation now routes source-backed Catmull-Rom `lerp_mode` natively and numerical Bezier through bounded adaptive linear keyframe baking, all owned by the Rust exporter. An exported receipt includes `curve_fidelity: native | adaptive_bezier_approximation`; the second value is an explicit warning that output differs from the editable Bezier curves retained in `.bbmodel`. Unsafe/opaque input, impossible precision and exhausted bake budget fail closed. No additional guest capability, filesystem access, unapproved mutation or desktop UI redesign. The same exporter is used by Rust CLI and Tauri. Tests AUTHORED_NOT_RUN; no native correctness or speed claim.

**Initial Rust Animation JSON export (2026-11-16; SOURCE_ONLY; curve refusal superseded above):** `codemode.exportAnimations({project,output:"walk.animation.json"})` uses the same SHA-bound Rust document/CLI and exact per-write trusted host approval as model, PNG and Geometry outputs. The new `export-animation` CLI publishes a separate Bedrock `format_version: 1.8.0` `animations` resource; supported numeric linear/step Bone tracks, loop/hold and authored sound/particle event metadata are converted without rewriting the editable `.bbmodel`. Bezier/Catmull-Rom require separate, verified curve baking and are explicitly rejected for this runtime export; editor Timeline Markers stay in `.bbmodel`. Animation Controllers remain a separate unsupported resource. Source tests authored NOT_EXECUTED; native file adoption and actual playback unverified.

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

**Animation timeline phase markers (Rust source, 2026-11-16):** `add_animation_timeline_marker`, `update_animation_timeline_marker`, and `remove_animation_timeline_marker` use explicit `animation_uuid` and saved time. Add/update specify `time`, `name`, `color` (0–9), and update additionally specifies `target_time` as the original saved time; Blockbench does not persist timeline marker UUIDs. Markers represent animation timing/contacts/artist notes, not automatically executed sound or gameplay events. The same trusted-host `apply` and Rust Undo path validates collision spacing, marker bounds, changed duration and retiming. Read markers with `inspectBatch([{kind:'animation_timeline_markers', animation_uuid, offset:0, limit:32}])`; the source response says `playback_verdict:NOT_EXECUTED` and never loads files. **CLI read routing also now implements the previously declared `animation_effect_events` selector**. Controller state transitions belong to the distinct Bedrock animation-controller format, not regular clip keys. No native or local runtime tests executed.


**Sound/Particle event metadata (2026-11-16; SOURCE_ONLY):** Rust `add_animation_effect_event`, `update_animation_effect_event`, and `remove_animation_effect_event` edit saved Blockbench `animators.effects` keyframes within the same SHA/revision-guarded `apply` plan as Bone animation. Supported channels are `sound` and `particle`, with explicit `points` arrays (1–8), each point containing an effect ID and optionally a locator; particle may specify `bind_to_actor`. Audio files, scripts, executable expressions and arbitrary particle resources are **not** loaded or created. Read the saved markers using `inspectBatch([{kind:'animation_effect_events',animation_uuid,offset:0,limit:16}])` (one document load, 1–16 events per page). Response declares `playback_verdict:'NOT_EXECUTED'`; no sound/particle preview is implied. Invalid selectors, unsafe import metadata or duplicate channel/time/UUIDs refuse before Rust commit. Source tests AUTHORED_NOT_RUN; native event playback/effect-asset availability and speed remain UNVERIFIED.


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

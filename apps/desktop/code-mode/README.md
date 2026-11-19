# LazyDesigner Rust Code Mode — source-only agent bridge

## First-read map

Code Mode is the AI **client** for the canonical Rust authoring library,
not another authoring engine or a source of GUI model state.

```text
sandbox-worker.mjs (Deno: restricted model-authored code)
  → host.mjs (trusted Node RPC/approval, bounded observations)
  → client.mjs (typed project handles + SHA-bound Rust adapter)
  → src-tauri/src/bin/lazydesigner-authoring.rs (first-party CLI)
  → src-tauri/src/authoring/mod.rs (Rust document and transactions)
```

- `client.d.mts`, `host.d.mts`: public TypeScript contracts.
- `task-context.mjs`: bounded source-derived task guidance; not model truth.
- `live-read-client.mjs`: optional Windows read-only pairing only;
  **no live AI write** and no implicit GUI/CLI session synchronization.
- `*.test.mjs`: regression source; actual execution remains on hold.

For the exact domain owner, use [the system map](../../../docs/04-system/implementation-map.md#rust-source-ownership-and-entrypoints).
Only trusted host approval may authorize a separately saved file mutation;
Deno itself cannot grant rights. Source tests, native sandbox and
Blockbench quality remain NOT_EXECUTED.

**G1 Geometry assembly in Code Mode (2026-11-18; SOURCE ONLY):**
The first-party `codemode.planGeometryAssembly({project,assembly})`
now forwards explicit named Bone/Cube parts and UUID parents to the
single Rust `plan-geometry-assembly` compiler. Node transmits only a
bounded temporary JSON request; Rust returns an ordered typed
`EditPlan` plus disposable preflight. A successful read is
`VALIDATED_NOT_APPLIED / NOT_GRANTED / UNVERIFIED`. No direct
write, alternate model, inferred shape, GUI session write or new
approval bypass is introduced. A caller must explicitly supply the
returned operations to the original separately authorized
`codemode.apply`; no automatic replay occurs. Headless source SHA is
verified on every native plan call. SDK and host guest-RPC positive/
negative regressions AUTHORED_NOT_RUN, native execution/visual
quality NOT_EXECUTED.

**G3 Geometry frame in the existing G1 read-only Code Mode (2026-11-19; SOURCE ONLY):**
Use `planGeometryAssembly` with optional `parts[].frames` for rectangular
through-openings in untextured blockouts; specify center, integer size
(1-32 model units), normal_axis X/Y/Z, positive border, and four explicit
panel UUIDs in left/right/bottom/top order. Rust constructs the disjoint
Box UV Cubes under one declared Bone in the same G1 plan/preflight.
The SDK verifies output identities/parent binding and rejects undeclared
operations or forged mutation authority. No image inference, UV packing,
Texture painting, automatic Apply or native/visual quality claim.
Rust/Node/Windows/Blockbench tests NOT_EXECUTED.

**G3.1 hollow box via the existing G1 Code Mode route (2026-11-19; SOURCE ONLY):**
Optional `parts[].hollow_boxes` accepts `name`, `center`,
`size`, `wall`, `open_face` (POS_X/NEG_X/POS_Y/NEG_Y/POS_Z/NEG_Z)
and five `cube_uuids` in wall_a_low, wall_a_high, wall_b_low,
wall_b_high, back order. Exactly five panels are proposed by the Rust
G1 compiler under the caller's Bone in the same source-SHA-bound,
read-only `planGeometryAssembly` call. The SDK checks declared output
UUIDs, parent UUID and unchanged `NOT_GRANTED/UNVERIFIED` preflight;
no JS shape solver, native mutation, UV packing, painting or approval.
Node/host consumer regression fixtures AUTHORED_NOT_RUN.

**G3.2 semicircular arch in existing G1 Code Mode (2026-11-19; SOURCE ONLY):**
Optional `assembly.parts[].arches` takes `name`, `center`,
`size`, `span_axis` X/Z, positive `wall` and `rise`,
plus `cube_uuids` ordered as left_pier, right_pier, then an odd
3–15 top strips (total 5–17). One trusted
`planGeometryAssembly` call delegates all Geometry math and native
preflight to Rust. The SDK binds returned Cube UUIDs, names and Bone
ownership to the declared input and refuses fabricated write approval.
No new CLI command, Deno geometry solver, Texture/UV step or mutation.
Regressions AUTHORED_NOT_RUN; native/visual quality UNVERIFIED.

**G3.3 variable-radius LINEAR Sweep in G1 Code Mode (2026-11-19; SOURCE ONLY):**
Optional `assembly.parts[].sweeps` has a name, UUID seed and 2–8
explicit integer-position/radius stations (2–6 model units).
Rust owns the voxelized Geometry, disjoint-Cube partition, source
SHA-bound preflight, resulting ordinary Cube/Undo operations, and all
safety bounds. No new CLI command or Code Mode execution permission.
The Node SDK checks that generated Cube names and UUIDs follow the
versioned deterministic seed/index namespace, belong to the declared
Bone, and remain `NOT_GRANTED / UNVERIFIED`.
This checks identity/authority only; JavaScript is not another 3D solver.
The number of Cubes depends on the source raster, capped at 64 per
Sweep and 128 total assembly operations. A changed shape can renumber
generated IDs: do not treat the seed as a persisted Recipe identity.
Source-only SDK/guest fixture checks AUTHORED_NOT_RUN; native quality
and relative performance remain UNVERIFIED.

**G3.4a Catmull–Rom opt-in through existing G1 Code Mode (2026-11-19; SOURCE ONLY):**
The already-supported `assembly.parts[].sweeps` accepts optional
`interpolation:"CENTRIPETAL_CATMULL_ROM"` and required
`max_chord_error` of 0.25–1.0 model units (with at least three
source stations). If omitted, the original G3.3 LINEAR behavior
and source JSON representation remain unchanged. Node checks the
transport-level option and independently binds the returned Cube
UUID/owner to the existing versioned seed; Rust alone computes curve
sampling, voxel membership, native disjoint-Cube operations and
the disposable source-SHA-bound preflight.
The tolerance bounds centerline approximation only: it never asserts
silhouette, material, reference, motion or artist acceptance.
No extra process, new permission, new Apply route, default-on feature
or independent JavaScript solver. Node guest/SDK regression source
AUTHORED_NOT_RUN; native Blockbench acceptance UNVERIFIED.

**G3.4b anisotropic profile through existing G1 Code Mode (2026-11-19; SOURCE ONLY):**
Optional `assembly.parts[].profile_sweeps` takes exact `name`,
`uuid_seed`, `stations` (position plus half_width/half_height),
`up_axis` X/Y/Z, and `cross_section` ELLIPSE/RECTANGLE.
The Rust compiler owns 3D minimum-rotation frames, voxel occupancy,
joint/contact rejection, G3.3's shared Cube partition and source-bound
preflight. The SDK validates input shape and binds each contiguous
profile-v1 seed-derived Cube UUID, name, parent Bone and provisional
Box-UV marker to the returned G1 plan; it does not recompute geometry.
No additional trusted permission, writer, profile data store or CLI
command. Explicitly unsupported: authored twist, smooth Catmull–Rom
PROFILE_SWEEP, automatic material/UV layout, artist-quality PASS.
Rust/SDK/guest regression source AUTHORED_NOT_RUN; Blockbench native
fidelity, performance and geometry-vs-Local parity UNVERIFIED.

**G3.4d optional twist on the same Code Mode profile (2026-11-19; SOURCE ONLY):**
Each profile `stations[]` entry may set `twist_degrees` in
[-180, 180], defaulting to zero when absent. Rust alone interpolates
the authored section roll, reuses the existing voxel partition and
G3.4c taper guard, and rejects material twist that produces no voxel
occupancy difference. Code Mode only transports the typed field and
checks its bounded numeric shape; no JavaScript Geometry solver, extra
process, trusted write permission or automatic Apply is introduced.
SDK and host fixture regressions AUTHORED_NOT_RUN; no artistic or
Blockbench-native acceptance is implied.

**G3.5 axial LOFT/REVOLVE through existing read-only G1 plan (2026-11-19; SOURCE ONLY):**
Optional `assembly.parts[].lofts` and `assembly.parts[].revolves` carry
exact `name`, `uuid_seed`, `origin`, `axis` and 2–12 `sections`.
LOFT stations provide `height`, `center: [u,v]`, `size: [w,h]`.
REVOLVE stations provide `height`, `outer_radius`, `inner_radius`.
All distances are model units. Rust alone constructs the voxel solid,
checks hollow ring topology, partitions Cube blocks, admits Box UV
bounds and runs the source-SHA-bound G1 disposable preflight.
Code Mode validates bounded input and verifies returned contiguous
`geometry-loft-v1` / `geometry-revolve-v1` Cube IDs, names, Bone
ownership and unapproved status. No JS geometry kernel, separate
CLI command, hidden writer, material/atlas allocation or Apply grant.
Source fixture tests AUTHORED_NOT_RUN; actual native/visual quality
and measurable performance remain UNVERIFIED.

**G2 Face-to-Face Geometry attachment in Code Mode (2026-11-18; SOURCE ONLY):**
`codemode.planGeometryAttachment({project,attachment})` is a bounded
read-only request that sends caller-authored Cube UUIDs, opposite
faces, clearance and tangential offsets through the existing
Deno → trusted Node → Rust CLI path. Rust alone computes the
`TranslateCube` plan and disposable preflight. The SDK binds
diagnostics/UUIDs/delta to the requested target and refuses
fabricated write authority or collision verdicts; actual
`codemode.apply` remains separately authorized. No live GUI write,
persistent parametric constraints, cross-Bone solver, new process
service or parallel geometry engine is introduced. Node/Deno/Cargo,
Windows and native Blockbench behavior are NOT_EXECUTED.

**G2.2 Code Mode resize-propagation planning (2026-11-18; SOURCE ONLY):**
`codemode.planGeometryResizePropagation({project,propagation})`
forwards an explicit Cube resize and up to 32 same-Bone
attachment links to the SHA-bound Rust
`plan-geometry-resize-propagation` CLI. The first-party SDK checks the
ordered `ReframeCube` / `TranslateCube` plan, dependency targets,
diagnostic deltas, and read-only `NOT_GRANTED/UNVERIFIED` receipt.
Neither Node nor Deno contains an independent geometry solver.
No constraints are saved or applied automatically; an operator-
approved `codemode.apply` is still separately required.
Node/Cargo/native/Blockbench execution remains NOT_EXECUTED.

**G2.3 overlap hints in existing read-only proposals (2026-11-18; SOURCE ONLY):**
Both planGeometryAttachment and planGeometryResizePropagation
return diagnostic.aabb_overlap_review from the same Rust proposal.
The bounded numeric report counts newly introduced, preexisting and
resolved positive-volume AABB overlaps involving changed Cubes and
supported direct same-Bone siblings; it includes at most 16 introduced
pair samples and counts unsupported neighbors. The typed SDK validates
sample target identity, positive bounds and the explicitly UNVERIFIED
whole-model verdict. It cannot certify global collision freedom or
artist-approved intentional overlap, and it does not change host
approval, source SHA, execution isolation or file publication.
Rust/Node/Deno/Windows/native tests remain NOT_EXECUTED.

**G2.4 supplementary OBB source diagnostics (2026-11-19; SOURCE ONLY):**
The existing G2/G2.2 read-only `diagnostic.aabb_overlap_review` now
contains `rotated_neighbor_obb`, a bounded static SAT report for
affected unrotated Cubes versus supported rotated direct same-Bone
neighbors. It distinguishes introduced/preexisting/resolved penetration
and newly touching contacts, with explicit unsupported neighbors,
capped samples, and whole-model `UNVERIFIED`. The SDK validates
nested counts, sample ownership/ordering, bounded penetration, and
refuses fabricated `CLEAR` or permission claims. This does not
expand attachment eligibility, choose an automatic correction, compare
reference images or claim native/model-quality PASS. Rust/Node source
regressions AUTHORED_NOT_RUN; execution and actual visual fidelity
remain held.

## Dated source history (preserved)

**P0 editable .bbmodel identity in asset handoff (2026-11-18; SOURCE ONLY):**
The existing `inspectBatch([{kind:'asset_handoff', texture_uuid:'...'}])`
now returns `handoff.bbmodel` with a streaming canonical SHA-256 and
byte count alongside `geometry`, `texture` and `animation`. Each is
derived from the same validated immutable Rust source; the top-level
`sha256` remains the exact INPUT file digest, which may differ when an
imported file was not canonically formatted. Export failures remain
explicit blockers and no success is a visual or native Blockbench PASS.
The SDK/host command count, security, output publication and guest
authority are unchanged. Source regressions NOT_EXECUTED.

**Bounded Code Mode task context and timing (2026-11-18; SOURCE ONLY):**
The trusted Node host offers taskContext(project,domain,category,name) by
compacting ONE SHA-pinned Rust inspectBatch authoring_target read. Exact
UUID, parent and relevant geometry/face-link metadata remain; unknown and
ambiguous target names never become mutation identities. The new
preflightGuidance(project,operations,correctionScope) is a zero-Rust-call
ADVISORY: only a precisely formed single rename may omit extra preflight;
all real Apply calls retain Rust validation, revision/SHA admission, reviewed
Paint authority, explicit host approval and no-overwrite publication.
No visual PASS is inferred.

Successful host execution receipts now include anonymous performance
aggregates (wall, first Deno frame, host RPC, Rust adapter, approval wait,
errors and call counts). A trusted observer can also collect the aggregates
for failed runs without receiving code, paths, model names, image bytes,
source hashes or credentials. Timings overlap and cannot be summed;
first-frame time includes guest startup and work, not pure Deno startup.
Source regressions AUTHORED_NOT_RUN. Native speed, model quality, token
savings and Windows runtime remain NOT_EXECUTED.

**Live read-only bridge security and footprint correction (2026-11-18; SOURCE ONLY):**
An experimental Windows pairing now requires an independent native
Yes/No dialog, forbids overlapping approval prompts, invalidates late
approval after Stop/Exit, rechecks model epoch, and expires after
15 minutes on a monotonic Rust clock. The UI attempts early cleanup;
Node bounds total response time and refuses sockets that close without
a full frame. A live-only host no longer requires the separate Rust
CLI binary and explicitly rejects disk mutation/PNG/reviewer settings.
Default build remains listener-free. Tests are AUTHORED_NOT_RUN;
Windows UI, ACL, Tauri/Node/Deno and efficiency NOT_EXECUTED.
See HOST_INTEGRATION.md.

**Opt-in live Rust semantic reads (2026-11-18; SOURCE ONLY):**
A Windows-only Cargo feature `live-read-bridge` exposes a local
Named Pipe that the user must explicitly start from the Rust editor.
A trusted Node host may receive the private pipe/token pairing and
offer `liveSessionInfo` / `liveSemanticMap` to the existing Deno
guest. These are **read-only** views of the currently admitted
in-memory Rust `EditorSession`, not a saved .bbmodel or a JS model store.
Model edits, preflight and export remain separate bounded Rust commands;
there is NO live AI write. Default builds disable the listener.
Headless SHA-bound file Code Mode is unchanged, and a live-only host
has no output directory or model publication access. No OS/Node/native
test has been run; see HOST_INTEGRATION.md for the trust boundary and
pairing contract.

**Shared Rust semantic-map and disposable preflight (2026-11-18; SOURCE ONLY):**
Code Mode now exposes two additional read-only, SHA-guarded headless
operations: `semanticMap(category,{offset,limit})` returns only bounded
source identities, parent UUIDs, and limited texture/animation metadata
(up to 24 entries); `preflight({operations,correctionScope})` applies
the exact existing Rust validation and correction-scope rules on a
discarded `EditorSession` clone, returning a candidate hash/revision
without publishing any model, modifying Undo or requesting write approval.
The Deno guest can only call these through the trusted Node host. A
successful preview explicitly reports `VALIDATED_NOT_APPLIED`,
`NOT_GRANTED` and `UNVERIFIED`. It is not permission, visual review,
native acceptance or a promise that a later Apply will succeed. Every
actual Apply retains its independent approval, source-SHA and no-overwrite
publisher checks. CLI read-only commands `semantic-map` and `preflight`
reuse the same Rust Core as the Tauri in-memory read commands. There is
no new live AI transport or in-memory JS model. Positive/negative Rust
and Node regressions are AUTHORED_NOT_RUN under the active hold.

**Uniform Rust model-output receipt verification (2026-11-18; SOURCE ONLY):**
The trusted Code Mode host now requires a matching source-model SHA,
output-model SHA, native mutation count/revision and summary revision for
all model-edit and PNG-import receipts, including unscoped operations.
New-model creation requires its Rust output SHA. Every resulting .bbmodel
is reopened with the first-party Rust inspector and compared to the native
publisher hash before registering a new project handle. Incorrect or
missing receipts fail closed without claiming success; a sibling may already
exist and must not be automatically retried or removed. Scoped Paint review
and its existing stricter pixel guards are unchanged. Source regressions
are AUTHORED_NOT_RUN; no actual CLI, filesystem or native behavior was tested.

**Rust-native shared Texture inspection scratch (2026-11-18; SOURCE ONLY):**
The existing SHA-verified `inspect-batch` now reuses one lazily built
texture-UUID index and up to eight decoded RGBA8 PNG buffers between distinct
Cube surface, Cube alpha and paged six-face Texture coverage selectors.
All buffers belong only to the validated immutable Rust inspection view and
are discarded at the end of the batch; a later CLI call still re-reads the
disk source and validates its exact SHA. Atlas decoding remains bounded to
eight 256² RGBA8 images (~2 MiB), with eviction before a ninth distinct PNG.
Standalone direct inspectors retain their full document validation and
per-page scratch semantics. Exact selector result/error formats, 8-request
and 96 KiB reply budgets, agent permissions and visual review requirements
are unchanged. Native regression source is AUTHORED_NOT_RUN; no throughput
or memory measurements were executed.


**SHA-bound inspectBatch duplicate-selector reduction (2026-11-17; SOURCE ONLY):** Within one bounded Rust `inspect-batch` call, the first-party SDK now sends each normalized identical read-only selector only once and restores the original positional results from the returned immutable source SHA. A later call always re-reads and rechecks the current model SHA; no persistent cache, new runner, loss of caller order, host reference-binding bypass or Rust validation shortcut is introduced. It rejects mismatched source/selector-count/kind receipts and enforces the existing Rust 96 KiB result-array budget after expanding duplicate entries; each duplicate result is independently cloned to prevent accidental guest-side aliasing. Source-only regression cases authored for repeated/reordered selectors, stale source, malformed/oversized receipts and temp-file cleanup. No real Node/Rust/PC-local tests or measured timing were executed.

**Uniform inspectBatch receipt admission (2026-11-18; SOURCE ONLY):**
The typed SDK now checks Rust source SHA, ordered selector kinds, exact
result count and the existing 96 KiB result-array limit for **all** batches,
including batches without duplicate selectors. The previous no-duplicate
fast return skipped those checks. Identical selectors are still forwarded
once per SHA-pinned batch, and only their repeated results are cloned.
Malformed or oversized receipts refuse before reaching Code Mode; no new
tool, cache, mutation authority or visual acceptance is implied.
Positive existing and new negative Node regressions are authored NOT_EXECUTED
under the active repository hold.

**Native cluster footprint admission (2026-11-17; SOURCE ONLY):**
Reviewed `FORM_SHADING` sample/propagation plans now send their
actual Cube-local row spans to the existing `material_face_patch`
inspector. Rust verifies signed/rotated UV projection into the
reviewed atlas region before write approval; missing or contradictory
`cluster_footprint` source receipts block Paint. The Deno guest
cannot compute a substitute atlas mapping or grant visual acceptance.
The small exact-RGBA/detail paths remain available. Regression source
AUTHORED_NOT_RUN; real native behavior and visual quality UNVERIFIED.

**Reference-bound FORM_SHADING samples (2026-11-17; SOURCE ONLY):**
A trusted reviewer-selected `FLAT_SHADING` sample now requires the
same source/reviewer-bound form, light and connected-cluster
`materialWorkPacket` as later propagation. The host compiles the
packet into existing Rust guarded Cube-face Paint, checks the one
reviewer-selected face and atlas patch, and refuses missing/mismatched
plans before permission to write. Exact non-FLAT_SHADING detail
corrections retain direct Paint. Source regressions AUTHORED_NOT_RUN;
native execution and artistic quality remain UNVERIFIED.

**Fail-closed native scoped Paint receipts (2026-11-17; SOURCE ONLY):**
A scoped Rust Paint now requires a complete, matching native receipt
(model SHA, operation count, revision, output SHA, source texture and
three pixel-guard counters). The native CLI previously omitted
`editable_before_rgba` from the receipt despite enforcing the
guard; that source defect is corrected. SDK refuses malformed/missing
receipts before reporting success; Host reopens the published sibling
and matches its SHA before creating the next project handle.
Potentially persisted outputs with uncertain receipts must be
reconciled explicitly rather than auto-retried. Tests authored but
NOT_EXECUTED; no real runtime or visual PASS is claimed.
See HOST_INTEGRATION.md.


**P0 multi-view preflight reuse (2026-11-17; SOURCE ONLY):**
For the same selected model SHA and multi-camera PNG set, repeated
`inspectSelectedVisualPair` reads reuse the already validated numeric
pair receipt rather than spawning six new Rust PNG comparison requests.
A fresh Rust source SHA inspection **and** exact re-hash of every
operator-selected reference/current PNG are required before each reuse.
The original independent reviewer decision is not called again or
changed. Mutating Paint still verifies all view bytes and the Rust
correction scope, and one-view behavior remains unchanged. This is
only a reduction in redundant source reads, not image comprehension,
native validation proof, or a measured performance improvement.
Regression source authored; tests remain NOT_EXECUTED.

**P0 Texturing contract reconciliation (2026-11-17; SOURCE_ONLY):**
The Code Mode SDK now accepts `editableBeforeRgba` consistently with the
trusted reviewer host and Rust's canonical correction scope, carries the
actual source-color preconditions into the operator approval and saved
EditPlan, and rejects explicit empty lists. Rust distinguishes an
omitted legacy guard from an explicitly empty, unsafe request. The
SDK normalizes each scope once instead of duplicating the same
pre-serialization check; the host retains separate reviewer-bound
validation. Guest requests that add any unapproved source color are
refused rather than silently shortened. Regression sources authored
but **NOT_EXECUTED** under the current test/CI hold; no mapped visual
acceptance or performance gain has been measured.

**Source-color-aware safe cluster propagation (2026-11-17; SOURCE ONLY):**
A reviewed broad material Paint now requires an independent reviewer
to select allowed **original** atlas RGBA colors; the guest cannot
expand that source-color set. Rust compares every changed pixel's
pre-image RGBA to the selected colors and rejects the entire edit
when a detail/marking color outside the set is overwritten. The existing
physical-pixel protection and expected-before guards still apply.
A new read-only `texture_source_colors` query shows exact, bounded
source RGBA counts to support grounded reviewer selection without
guessing from render lighting. Source data is not artistic approval;
actual image comparison remains required. Native/Node regression
sources authored; no local/CI tests executed.



**Reviewed landmark protection inside correction scope (SOURCE ONLY):**
Rust now accepts optional `protectedRegions` (preserve the ORIGINAL
RGBA unchanged even inside an allowed atlas rectangle) and
`expectedBeforePixels` (reject a stale/wrong source RGBA before
publishing any edited texture). When an independent reviewer declares
those guards, the trusted host merges them into the guest's correction
scope, even when the guest omits them; conflicting old-pixel claims
are blocked before operator approval. The Rust transaction checks
the actual before/after saved PNG and remains the single Undo owner.
Old exact-RGBA edits without these optional guards are unchanged.
Receipt counters expose enforcement, never artistic quality evidence.
Node/Rust tests AUTHORED_NOT_RUN. See HOST_INTEGRATION.md.



**Connected cluster paint composition (2026-11-17; SOURCE ONLY):**
For reviewer-authorized `FORM_SHADING` samples and propagation, the guest now supplies
`facePlans[].clusters`: connected, 4-neighbour face-local row spans with
explicit shadow/highlight roles and form-based justification. The trusted
host compiles the cluster masks into **existing Rust
`paint_cube_face_regions_guarded` transactions**. No arbitrary guest Paint
operations are accepted alongside this packet. Every pixel comes from a
declared span and palette role; disconnected noise, overlapping clusters,
missing shadow/highlight and off-scope operations refuse before native
mutation. The same pinned Rust UV/atlas and correction-scope owner protects
actual edits; there is NO second bitmap engine, renderer or persistent DB.
`SURFACE_DETAIL` and small exact-RGBA edits retain the existing direct
path. Connected geometry does NOT prove good pixel art; the independent
reviewer must still inspect fresh matched rendered views. Node regressions
are AUTHORED_NOT_RUN under the active hold.

**MaterialWorkPacket — planned professional Rust Texturing (2026-11-17; SOURCE ONLY):**
Reviewed `materialCohort.phase:'sample'` with `FLAT_SHADING`, and all
reviewed `phase:'propagation'`, now require a bounded `materialWorkPacket`
alongside `correctionIntent` and `correctionScope`. A strict, source-only schema records current model and
operator-selected reference image SHA, reviewed issue/approach/part, material,
styling intent, light/form rationale, deliberate shade palette roles and
per-Cube face-local cluster placement. Before mutation, the host matches the
packet to the independent reviewer's actual issue, selected reference/current
revision, every declared correction rectangle, actual guarded Cube-face Paint
operations and one pinned native `material_face_patch` inspection per planned
face (max eight). A base-only paint cannot be called FORM_SHADING on either stage.
Only colors declared in the palette can enter planned face-local Paint.
A first sample requires exactly one reviewer-selected Cube face and scoped
atlas patch; broader styling still requires a fresh, independently accepted
representative. This does not create procedural texture algorithms or certify
that shading follows geometry. The trusted operator sees a compact style/
target summary and exact packet SHA at mutation approval. Model-written
packets cannot grant permission. Small non-FLAT_SHADING samples and
unreviewed known exact-RGBA edits retain their direct path.
Tests AUTHORED_NOT_RUN. See HOST_INTEGRATION.md.


**Canonical Workspace Reference auto-binding (2026-11-18; SOURCE ONLY):**
With a selected existing `--input` and `--visual-manifest`,
the trusted Code Mode CLI now looks ONLY in that model's directory for
`reference/REFERENCE.json`, `references/REFERENCE.json`, or `REFERENCE.json`. An operator may instead
supply one exact `--reference-package` file. When present, the host
requires the package to belong to the same saved model workspace, with
`approval.visual_authority:APPROVED` and matching APPROVED, TEXTURE
source PNGs with explicitly declared camera views. The host pins the
canonical JSON SHA and selected image identity and checks package freshness
after review and before later Paint/readiness. Explicit
`images[].regions` SURFACE_DETAIL/DIRECT declarations for supported
parts with meaningful `parts[].description` become MATCH_REFERENCE
review obligations, **not** PRESERVE claims. Reviewer criterion IDs
include the selected view so repeated per-image annotation IDs
(front/back/side) remain independent; longer source labels get
bounded deterministic reviewer IDs without changing the original
source-region identity. Approval of a source image
does not mean the current model part was accepted. A currently rejected
part is handled by an explicit CORRECT decision instead. Only a
separately established acceptance of the current authored work can
justify a PRESERVE criterion. Native atlas coordinates are NEVER
inferred from reference image boxes. Correction scopes remain explicitly
reviewer/UV-owned. Missing, partial, stale or contradictory source evidence
fails closed; unannotated packages do not invent decisions. No independent
user-approval authentication or visual renderer/agent behavioral proof.
Node regressions AUTHORED_NOT_RUN.

**Approved-reference decision accountability (2026-11-17; SOURCE_ONLY):**
The operator-selected `--visual-manifest` may now carry a bounded
`reviewCriteria` projection of current approved Reference/Workspace
decisions: `PRESERVE` previously accepted model appearance,
`MATCH_REFERENCE` a sourced image expectation, and `CORRECT` a
specific rejected detail. Each criterion names an actual selected image
view and exact source PNG SHA; CORRECT also constrains one physical
texture/atlas patch, while PRESERVE can protect explicit same-atlas
pixel regions. The trusted reviewer receives every criterion alongside
actual PNG bytes. Its response must account for each as
`MET | VIOLATED | UNVERIFIED`, with decisions and editable correction
scope reconciled before any reviewed Paint. An observed regression of
an approved PRESERVE criterion is refused; the agent cannot claim a
global Texturing-ready result without criteria all independently
declared MET. This is one ephemeral reviewed work packet, NOT a new
approval database, auto-import of the Local Workspace, vision model,
or proof of artistic quality. Actual source-bound evaluations
AUTHORED_NOT_RUN; native/user acceptance remains UNVERIFIED.

**Independent multi-view image identities (2026-11-18; SOURCE ONLY):**
The SHA-pinned visual admission rejects source PNG bytes or captured PNG
bytes reused under different selected camera labels, even when filenames
and paths differ. This prevents renamed front screenshots from counting
as six independent observations and follows canonical Reference cross-view
identity accounting. An exact single-view reference/candidate image match
remains permitted. Different hashes are a *necessary* identity check, not
proof of camera direction, native rendering, or independent artistic review.
Multi-view and per-image-region-ID regressions AUTHORED_NOT_RUN.

**Paged large-model source-face review (2026-11-18; SOURCE ONLY):**
The trusted Code Mode image-review host now scans the SHA-pinned Rust
model's saved face inventory and, when all source identities are
resolvable, sends at most **256 distinct faces per external reviewer
invocation**. For a complete model with 257–1024 explicitly active
mapped faces, the operator-owned six-view reviewer can review up to four
independent sequential source-bound pages. The reviewer must independently
return one matching Cube/face/texture review for every saved face on each
page, all selected views and each frozen visual criterion. The host verifies
page identity, SHA-bound source membership and completeness, then keeps
the combined face ledger private; the Deno guest gets only a compact
source-only count. An incomplete/rejected page never becomes all-model
readiness. A focused single-view correction can still use an incomplete
bounded inventory but cannot claim all-face completion.

The original 256-face single callback path remains compatible.
The first-party external reviewer adapter now requires an explicit
`face_page_binding` echo for each paged invocation; an older reviewer
that lacks that capability refuses rather than silently accepting
partial images. Models above four pages, over 256 saved Cubes, with
unknown mapped faces, or beyond the separate 12-criterion contract remain
BLOCKED for whole-model completion. The original per-image PNG/renderer
and actual artistic/user review limitations remain. Source regressions
AUTHORED_NOT_RUN; no measured review latency or artistic quality gain.

**Operator-owned image review bridge (2026-11-17; SOURCE_ONLY):**
The existing `run.mjs` now accepts `--visual-manifest` with
`--reviewer-exe` for one explicitly configured, trusted, image-capable
external reviewer process. Pinned reference/current PNG bytes and native
Cube/face source identity enter the reviewer through bounded no-shell stdin
IPC; generated Deno code can neither select this executable nor read raw
PNG images. Image receipt hashes do not prove semantic inspection; a real
reviewer implementation and current captured images remain dependencies.
Without configuration, the standard CLI still has NO visual reviewer.
See `HOST_INTEGRATION.md` for the manifest, input/output protocol, privacy
and local-test hold.

**Final approval-to-Rust image lease (2026-11-18; SOURCE ONLY):**
Even after a successful image review, the operator can leave an
interactive write-approval prompt open while either source PNG changes.
The synchronous Rust launch lease now rechecks exact contents and
realpaths for every selected reference/capture pair, as well as any
bound Reference Package fingerprint. A changed image prevents launching
the write even when it changed **after** earlier preflight. This is
source-level freshness only; it does not prove a camera angle, saved
model appearance or actual image reviewer evaluation. Negative cases
for replacing either image during approval AUTHORED_NOT_RUN.

**Post-review source/image freshness (2026-11-17; SOURCE ONLY):**
A reviewer callback is now followed by a fresh SHA-bound Rust model
inspection and a rehash of every selected reference/capture PNG
BEFORE the review is cached. A long-running reviewer cannot return a
fresh-looking result for replaced source or images. Existing per-write
approval, Rust source guards and post-Paint fresh-capture requirement
remain separate. Source regressions AUTHORED_NOT_RUN.

**Reviewer face-to-view/source binding (2026-11-17; SOURCE ONLY):**
Each independently accepted material-face declaration must identify a
specific already accepted rendered view (`observedInViewId`). The
trusted host now checks the declared Cube/face/texture against the
current SHA-bound Rust source inventory before exposing reviewer
acceptance to the guest. Missing, mismatched or unresolvable faces
fail closed; an incomplete source inventory remains incomplete at final
readiness. This is provenance/accounting, NOT proof that a camera image
actually shows a face or that an image-capable reviewer is connected.
Source regression cases AUTHORED_NOT_RUN.

**Full source-face review (2026-11-17; SOURCE_ONLY):**
The terminal readiness now checks all Rust-saved explicitly active
Cube faces, including fully opaque faces with no alpha attention warning,
against the selected reviewer-facing source identities. An unreviewed
required face blocks completion. Each reviewer call remains bounded to 256 source faces. A complete,
SHA-pinned inventory of 257–1024 auditable faces can be accounted for
in up to four individually reviewed pages; more faces, unresolved native
mappings, incomplete cube scans, or any missing page remain BLOCKED.
Six camera images alone do not prove the appearance of hidden surfaces.


**Attention-face closure (2026-11-17; SOURCE_ONLY):**
A six-view material review now also reconciles all paged saved-face
`review_candidates`, including partial/translucent/transparent
source faces. Every attention entry requires an exact independently
reviewed `cubeUuid + face + textureUuid`; a fully transparent face
must be explicitly accepted as `INTENTIONAL_TRANSPARENT`.
Unknown/missing links or any unreviewed candidate keep the terminal
readiness BLOCKED. This remains *source* coverage, not native
proof of occluded face visibility or artistic quality.

**Professional pixel-art Texturing source workflow (2026-11-17; NOT_EXECUTED):**
Code Mode now exposes a bounded `inspectBatch({kind:'texture_styling_face',
texture_uuid,cube_uuid,face})` read. It decodes the real saved atlas
through the SAME signed/rotated Cube face-local mapping used by
`paint_cube_face_regions_guarded`, so a horizontal stripe disguised by
a rotated atlas can still become a review candidate. It returns
`visual_verdict:'UNVERIFIED'` and does **not** identify correct
light direction, material identity or quality from color counts.

Rust `apply` reports candidate styling evidence for **every** declared
correction rectangle, including each skipped/unsupported/oversized
region, rather than only the first. Code Mode host wraps Paint success
as `texturing_workflow.status:'PAINT_SAVED_NOT_VISUALLY_ACCEPTED'`.
No successful write may be narrated as STYLED/finished merely because
the PNG changed. After a real operator-owned reviewed six-camera view set,
`codemode.texturingReadiness({project})` reconciles current view/reviewer
evidence, paged saved-face coverage, and up to 32 independently
reviewer-selected Cube-local faces, each marked `STYLED`, `INTENTIONAL_FLAT`, or
`INTENTIONAL_TRANSPARENT` with an observed reason. An opaque exact one-color
face declared STYLED cannot clear this gate. Native warnings for straight
horizontal/vertical color bands or noise-first styling also block STYLED
readiness despite a positive reviewer declaration; deliberate simple material
areas may be reviewed as INTENTIONAL_FLAT with a concrete visual reason.
Weak value variation alone stays advisory because subtle shading may be valid.
Even a cleared gate returns
`REVIEWER_DECLARED_READY_FOR_USER_DECISION`, never visual PASS or
user acceptance. Without the actual independent reviewer callback
(including `run.mjs` without an explicitly configured reviewer executable), it remains BLOCKED.
No native render/camera provenance is invented; matched-view observation
is still the final artistic authority. Test sources authored NOT_EXECUTED.

**Form-shading strip guard (2026-11-17; SOURCE_ONLY):** The reviewed
MaterialWorkPacket rejects a claimed form-shading plan made only from
same-width rectangular shadow/highlight strips. This is checked before
host approval and Rust Paint; stepped value masses and deliberately offset
bevel edges remain available. It cannot judge real material form, image
similarity or all unsupported variations of generic stripes. Authored
negative/positive Node regressions are NOT_EXECUTED.

**Operator CLI approved-material selection (2026-11-17; SOURCE ONLY):**
The first-party `code-mode/run.mjs` now accepts
`--approved-material-reference-uuid` only with an existing `--input`
model. It forwards the operator's selected approved Texture UUID into
the existing trusted host for SHA-bound material comparisons and scoped
Paint refusal when that exact master is targeted. The guest cannot
choose the reference UUID. Host startup now verifies the UUID appears exactly
once in the current SHA-bound Rust texture catalog (bounded paged read);
missing, duplicate, stale or incomplete source evidence refuses the host
before any guest execution. No new permission or native editor binding
is introduced; this is not proof the UUID exists or the visual style
matches the approved image. CLI regression authored, NOT_EXECUTED.

**Reviewed rejected-operation replay guard (2026-11-17; SOURCE_ONLY):**
The trusted host now records a SHA-256 fingerprint of the exact ordered,
key-canonicalized Paint operations in a saved-pixel receipt. An independent
reviewer can carry a previously *actually rejected* fingerprint with the
same part and texture UUID in `rejectedPaintPlans` on a later captured
review. The host then rejects the identical operation plan **before** write
approval and Rust Paint, even if the guest changes `approachId`, treatment,
or descriptive prose. Source history is operator/reviewer-owned, not an
automatic persistent memory. Changed pixels/operation order require fresh
review and are not claimed visually better; identical operation fingerprints
do not measure similarity of rendered images. Source regressions are authored
but NOT_EXECUTED; native/artistic improvement remains UNVERIFIED.

**Artist order, not extra tools:** approved reference/part → Geometry + UV
approved → one material's value/base/shadow/highlight design → tiny
face-local pixel clusters → representative visible face and seam review
→ only compatible cohort propagation → six directions plus relevant
occluded-face close-ups → simplification/noise removal → final human review.
Use existing guarded Cube face-local Paint and protected correction scope;
do not add procedural noise to satisfy numeric hints. Reviewer observations
and rejected causal directions remain operator/workspace context across
host sessions; no automatic persistent correction database is claimed.

**Native Rust Texturing candidate evidence (2026-11-17; SOURCE_ONLY):**
The Rust-native editor now uses its own canonical PNG decoder to
provide a SHA-bound `texture_styling` Code Mode read over one
operator-selected physical atlas rectangle (up to 4,096 pixels).
Exact one-color fills return `BASE_ONLY_CANDIDATE`; low form
contrast, uniform horizontal bands and high-transition noise
produce `REVIEW_REQUIRED` candidate warnings. A reviewed Rust
`apply` receipt also includes a first-region source diagnostic
when correctionScope is present, with safe `NOT_EVALUATED` fallback.
ALL reported evidence retains `texture_completion_attested:false`
and `visual_verdict:'UNVERIFIED'`. This is not an artistic style
validator and does not automatically block intentional flat work.
Native and SDK regressions authored but NOT_EXECUTED.

**Six rendered directions required for broad material propagation (2026-11-16; SOURCE_ONLY):**
The operator-selected six-camera view option is now mandatory for
`materialCohort.phase:'propagation'`, not for the initial small sample.
The host refuses a front-only material propagation, any missing
front/back/left/right/top/bottom view, any `UNVERIFIED` view review,
and reused reference/capture file paths masquerading as new directions.
Reviewer acceptance is still a declaration about actually presented
images; six distinct files or identical pixel statistics do NOT prove
camera provenance or professional shading quality. The local small
sample and legacy unreviewed exact-RGBA edits keep their prior path.
Native tests remain deferred; all new tests are source-authored only.

**Operator-selected multi-view model review (2026-11-16; SOURCE_ONLY):**
One existing `preselectedVisualPair` may now include up to six
`supportingViews` (each with its own explicit `viewId`, reference PNG
and matching current-capture PNG). The host rejects duplicates and
unsupported views. `requireSixDirections:true` requires the real
front/back/left/right/top/bottom camera-image set; an optional
`three_quarter` image is supplementary. All selected reference/capture
files are hash-pinned to the same source `.bbmodel` SHA, compared via
the *existing* bounded Rust `inspect-visual-pair` read, and freshly
hashed again before Paint.

For more than one selected view, the independent reviewer must actually
inspect all supplied PNG pairs and declare a `viewReviews` outcome
for **each** view. `ACCEPTED` is refused if a selected view is
`REJECTED` or `UNVERIFIED`, and a `REJECTED` summary must identify at
least one rejected view. Multi-view material propagation stops if
any selected view is `UNVERIFIED`. A reviewer-declared per-view status
does not certify a model or image-vision engine; source file
`face_source_evidence` remains separate from these *rendered-view*
declarations. The guest receives bounded per-view SHA/verdict metadata
without private image paths or PNG buffers. Single-view corrections
remain compatible and cannot claim whole-model coverage.
Source regressions authored NOT_EXECUTED; PC/local validation deferred.

**Cube face / UV ownership and six-direction source evidence (2026-11-16; SOURCE_ONLY):**
The representative material patch must now identify the reviewer-selected
`cubeUuid` and Cube-local `face` (north/east/south/west/up/down). Before
accepting its sample or propagation review, the trusted host queries
one pinned Rust `material_face_patch` source inspector. Rust resolves
the actual supported Box/manual UV projection, checks the atlas texture
link and requires the selected patch to remain inside that face,
without unresolved or overlapping atlas consumers **at those exact pixels**.
A face may share UV elsewhere, but source completeness still matters. The selected face must
also have measurable saved PNG alpha; unsupported/missing face alpha
refuses before Paint. This is not proof its shading is professional.
Unsupported alias
or implicit texture ownership refuses instead of assuming a safe target.

The same read obtains the selected Cube's six saved face-alpha statuses
through the existing native `cube_face_alpha` inspector. The guest
receives only bounded `face_source_evidence`, never raw PNG pixels;
`face_coverage_verdict` and `visual_verdict` remain `UNVERIFIED`.
This is one Cube's **saved source** mapping, not six rendered camera
views, shaded material PASS, or all-model coverage. Native face direction
does not necessarily match an external camera angle for rotated Cubes.
Actual front/back/side/top/bottom visual reviews are still required
where appropriate before claiming professional texturing completeness.
Tests AUTHORED_NOT_RUN and native execution deferred.

**Reviewed Texturing mutation boundary (2026-11-16; SOURCE_ONLY):**
An independently reviewed sample/cohort host now refuses non-Paint
`apply` operations and PNG imports on that same reviewed source. This
prevents agent-generated geometry/UV/texture replacement from bypassing
the allowed material sample rectangle. Explicitly selected independent
asset-import or structural work must use a separate host/owner and its
ordinary permissions. Unreviewed general authoring remains unchanged.
Canonical Rust still validates every scoped Paint result. Negative
host regression source AUTHORED_NOT_RUN.

**Representative material patch before styling propagation (2026-11-16; SOURCE_ONLY):**
For independent reference-driven styling, a REJECTED review must now
include `materialCohort`. During `phase:'sample'`, the reviewer selects
one atlas rectangle of at most 1,024 physical PNG pixels. The first
reviewed Paint may affect only that patch, plus the normal authorized
correction/alpha boundaries enforced by Rust. For `FLAT_SHADING`, the
first sample is already a one-face, connected form-shading packet; it
cannot use an unplanned flat-fill shortcut.

After the resulting model is saved, the operator selects the **new model
SHA** and **new matching capture** in a new host. A reviewer must actually
see the updated sample and declare `phase:'propagation'` with
`sampleVerdict:'ACCEPTED'` for the same issue/part/approach.
Only then may the remaining reviewed atlas region be styled; the
accepted sample is protected from subsequent Paint. This is a reviewer
declaration bound to exact model/reference/capture SHA and view, not
automatic visual recognition or a universal material-quality score.
Known exact-RGBA writes outside the independent visual-review workflow
retain existing authorization. Tests AUTHORED_NOT_RUN.


**Material-first correction control (2026-11-16; SOURCE_ONLY):**
For a visually REJECTED Texture, the trusted Code Mode host now requires
an issue-linked `correctionIntent` before Paint: stable reviewer issue ID,
causal approach ID, semantic part ID, material class, suspected cause,
treatment family, and expected visible change. The reviewer may optionally
name the affected `partId` and exact previously rejected issue/approach
pairs. The host refuses a missing/unknown issue, a different semantic part,
or an identical rejected approach before write approval/native mutation.
The normalized diagnosis and digest travel in the operator's approval
descriptor, but are not inserted into `.bbmodel` and are not independent
proof of a genuinely different artistic solution. Rejected approaches
must come from a real reviewer or verified prior evaluation; renaming
a strategy without changing its visual treatment is not convergence.
General unreviewed exact-RGBA edits retain previous permissions.
Positive/negative source regression tests AUTHORED_NOT_RUN.

**Frozen Pillager quality case (source-only):** [Tier 1–3 Golden A/B](GOLDEN_PILLAGER_AB.md) now maps the actual Local rejected feedback to explicit source/native visual acceptance boundaries. A repeated reviewer read cannot downgrade an accepted source decision, and both chosen PNGs are rechecked before a scoped Paint. This Golden is not an installed quality evaluator or runtime-pass claim.


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


**G3.6 source-pixel silhouette focus in existing multi-view review (2026-11-19; SOURCE ONLY):**
Each SHA-pinned `inspect-visual-pair` Rust read now includes
`comparison.silhouette.localization`: measured missing/excess mask
pixels, foreground and difference bounds, and up to four ranked
4×4 source-pixel regions. The existing `inspectSelectedVisualPair`
host returns a bounded `view_evidence[].mask_mismatch` summary per
selected view (MEASURED / UNASSESSED / UNAVAILABLE). Invalid counts,
out-of-image rectangles, duplicate regions, and fabricated 3D/visual
claims are rejected at the trusted host boundary. No additional
read/process per view, PNG bytes or paths in guest context, separate
reviewer, classifier, camera calibration, automatic Cube mapping,
EditPlan, approval path or renderer.
These are **pixel-mask hints only**: unless reference approval,
compatible view/framing and current asset provenance are observed
independently, do not interpret a missing pixel as wrong Geometry.
Targeted corrections still require verified Cube UUID and explicit
source-bound Rust preflight/Apply. Native/rendered fidelity and
quality gains UNVERIFIED; Rust/Node regressions AUTHORED_NOT_RUN.

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

### Named-part orientation: one source read, no guessed target

When a user names a part but its UUID is not known, do **not** first
page the Cube/Bone/Texture/Animation catalog and guess a tool. Use the
existing `inspectBatch` with `authoring_target`:

```js
// One model-facing call; process Rust data inside the isolated guest.
const report = await codemode.inspectBatch({
  project: codemode.initial.project,
  requests: [{
    kind:'authoring_target', domain:'texturing',
    category:'cubes', name:'Helmet', // Illustrative exact saved part name.
  }],
});
const target = report.results[0].target;
if (target.status !== 'EXACT_MATCH') {
  return {status:target.status, count:target.candidate_count,
    candidates:target.candidates.slice(0,4).map(({name,uuid})=>({name,uuid})),
    truncated:target.candidates_truncated};
}
const surfaces = target.selected.source.surfaces;
const attention = (surfaces?.faces ?? []).filter(face=>
  face.uv_zero_span || face.uv_rotation_supported === false ||
  ['false','unset'].includes(face.reference_kind));
return {
  status: target.source_blockers.length ? 'SOURCE_BLOCKED' : 'EXACT_MATCH',
  sourceSha256: report.sha256,
  cubeUuid: target.selected.identity.uuid,
  uvMode:{boxUv:surfaces?.uv.box_uv,autoUv:surfaces?.uv.auto_uv},
  sourceAttention:attention.map(({side,reference_kind})=>
    ({face:side,reference:reference_kind})),
  candidateOperations:target.candidate_operations,
  blockers:target.source_blockers,
  visualVerdict:target.visual_verdict, // Always UNVERIFIED here.
};
```

Domain/category combinations are strictly limited: Geometry → Cubes/Bones,
UV → Cubes, Texturing → Cubes/Textures, Animation → Bones/Animations.
Only an **exact, unique** saved name returns selected source identity;
duplicate names are `AMBIGUOUS_NAME`, while partial/substring matches
appear as non-authoritative suggestions. Unsupported/missing UUIDs do not
silently become a writable target. For a Cube in UV/Texturing, the same
native read also includes the existing six-face/UV inspector; for Geometry
it includes focused transforms, and for Texture/Animation assets it returns
bounded metadata. No raw atlas, extra index or mutable state is created. The example
filters the transient six-face read into bounded decision fields **in
guest JavaScript**; intentionally absent faces and statistics are
never automatically labeled artistic failures. If full UV geometry is
needed for an actual edit, it remains available inside that same script
without requiring a second model turn.

For independent, known read selectors, aggregate in one batch and
return only the requested summary, rather than `return report`:

```js
const report = await codemode.inspectBatch({
  project:codemode.initial.project,
  requests:[
    {kind:'catalog',category:'cubes',limit:8},
    {kind:'audit'},
  ],
});
const [catalog,audit] = report.results;
return {
  sourceSha256:report.sha256,
  cubeIds:catalog.catalog.entries.map(item=>item.uuid),
  sourceFaceReferenceCounts:audit.audit.faces,
  visualVerdict:audit.audit.visual_verdict, // Still UNVERIFIED.
};
```

This reuses the same native `inspectBatch`, with **no new public
tool, runner, cache or approval bypass**. If the caller already knows
the UUID and needs only one focused read, do not add an
`authoring_target` lookup. Batch only questions needed for this
decision; do not force unrelated inspections to reduce a tool counter.

`candidate_operations` is filtered using source-owned UV mode, explicit
saved texture-link presence and Rust Paint editability where applicable.
For example, Box UV surfaces do not suggest `set_face_uv`, and a Cube
without an explicit saved texture link does not suggest guarded face Paint.
`source_blockers` explains why no direct candidate was offered. An
imported texture not yet enabled for Rust Paint likewise receives no
pixel-edit suggestion. These are advisory source checks, **not**
permission, an automatic planner, a guarantee of compatibility or
proof of artistic fidelity. Read the returned source
first; when an exact target and the user's requested change are clear,
compose one relevant `codemode.apply` operation batch under existing host
approval and Rust validation. Never rewrite an approved asset from a
name hint. For known UUIDs, use an existing focused read rather than
incurring a redundant named-target lookup.

For a **deterministic Geometry edit explicitly specified by the user**, the
same generated JavaScript program can resolve the target and apply one
approved transaction without returning an intermediate catalog to the model:

```js
const project = codemode.initial.project;
const found = await codemode.inspectBatch({project, requests:[{
  kind:'authoring_target', domain:'geometry',
  category:'cubes', name:'Helmet', // The exact name supplied for this task.
}]});
const target = found.results[0].target;
if (target.status !== 'EXACT_MATCH' ||
    !target.candidate_operations.includes('translate_cube')) {
  return {status:'TARGET_NOT_READY', candidates:target.candidates,
    blockers:target.source_blockers};
}
// The 1-unit Y offset below is illustrative; use it ONLY when the user
// explicitly requested that exact change. The host still approves the write.
const saved = await codemode.apply({
  project, output:'helmet-raised.bbmodel',
  operations:[{op:'translate_cube', uuid:target.selected.identity.uuid,
    delta:[0,1,0]}],
});
return {status:'SOURCE_SAVED_NOT_VISUALLY_APPROVED',
  project:saved.project, sha256:saved.sha256};
```

This composes **one source lookup and one approved mutation inside one
model-visible Code Mode invocation**. It does not remove either Rust call or
the host approval/reopened-output checks. The host receipt now includes
`rpc_calls` (guest RPC count), `rpc_response_bytes` (serialized
host-to-guest RPC reply frames) and `model_result_bytes` (final JSON
value emitted by the guest). These are **raw UTF-8 byte counts**, not
token costs, native CLI invocation counts or proof of fewer corrections.
Use matched real tasks and accepted asset outcomes for efficiency claims. Do not use the pattern for art
decisions that need a fresh visual review, for ambiguous targets, or when
the required operation/data are not supported. Source-authored regressions
remain NOT_EXECUTED; measured token/call/latency savings are UNVERIFIED.

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
Selected kinds include `authoring_target`, `cube`, `cube_surfaces`,
`cube_face_alpha`, `catalog`, `texture`, `texture_alpha`,
`animation`, `animation_track`, `audit`; the full typed selector union
is owned by `client.d.mts`, not repeated here.

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

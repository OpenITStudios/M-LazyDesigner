# Rust-native authoring core — Phase 1/2 source integration

## Entry and domain ownership

This directory is the **single Rust model/transaction implementation**
shared by the Tauri GUI and headless Rust CLI. `mod.rs` owns
`AuthoringDocument`, `EditorSession`, `EditOperation`, validation and
Undo/Redo; domain modules own their specialized semantics.

| Jobdesk | Read these implementations first |
| --- | --- |
| Geometri | `mod.rs` (EditOperation), `geometry.rs`, `subtree.rs`, `uv_sharing.rs` |
| Texture | `paint.rs`, `face_regions.rs`, `material_styling.rs`, `texture_coverage.rs` |
| Animasi | `animation_clip.rs`, `bezier.rs`, `animation_export.rs`, `effects.rs` |
| Cross-domain export/validation | `bbmodel.rs`, `asset_handoff.rs`, `storage.rs`, `tests.rs` |

UI/Tauri lifecycle remains in `../desktop_authoring.rs`; Deno/Node
permission and script composition remain under `../../../code-mode/`.
No new Rust package or duplicate document store is needed. Source
status is NOT_EXECUTED; see [system owner map](../../../../../docs/04-system/implementation-map.md#rust-source-ownership-and-entrypoints)
and [architecture/acceptance](../../../../../docs/04-system/rust-native-editor-plan.md).

**G1 Rust semantic geometry assembly (2026-11-18; SOURCE ONLY):**
The shared `geometry_assembly.rs` compiler accepts exact named Bone/Cube
parts, required Bone pivots and parent UUIDs. It deterministically orders
out-of-order dependencies into the existing `EditPlan`, refusing unknown/
cyclic parent, duplicate UUID/name, stale revision, unsafe Geometry and
over-budget input through the existing disposable Rust preflight.
The CLI `plan-geometry-assembly` is read-only, SHA-bound, and returns
the exact plan and preflight receipt for a later independently authorized
`apply`. No new Geometry model, parallel recipe store, new writer,
Live AI operation, or implicit source-image interpretation is created.
Rust regressions are SOURCE_AUTHORED / NOT_EXECUTED; native Blockbench,
Windows, visual fidelity, performance and accepted quality remain held.

**G3 typed untextured rectangular frame (2026-11-19; SOURCE ONLY):**
The existing G1 assembly now optionally accepts caller-sized rectangular
through-frames with an axis, width/height/depth, border, named Bone and four
explicit panel UUIDs. Rust constructs exactly four disjoint positive-volume
Box-UV Cubes and compiles them through the unchanged parent-first AddBone /
AddCube EditPlan and disposable preflight. A real empty opening is geometric,
not a simulated Texture/alpha hole. The method refuses invalid axes,
collapsed openings, duplicate IDs, out-of-range panels, insufficient atlas
room and pre-textured projects. Atlas content is NOT created, assigned,
packed or accepted; a later Texture stage owns explicit UV layout and
material review. The source regression covers opening topology, stable
identity, export/reopen/Undo and fail-closed cases; tests NOT_EXECUTED.
No independent geometry engine, persistent Recipe, native writer or release.

**G3.1 true hollow-box construction (2026-11-19; SOURCE ONLY):**
The same G1 source planner now accepts optional `parts[].hollow_boxes`
for a caller-authored center, integer size, 1–16-unit wall and six
POS/NEG_X/Y/Z open-face choices. Five non-overlapping native Cubes enclose
a real interior cavity: four side panels plus the opposite back.
Each panel has an explicit UUID and belongs to the declared Bone.
The Rust blockout Cube helper is shared with G3 rectangular frames;
no new authoring database, persistent Recipe, shape runtime, publisher
or CLI subcommand. Requests enforce the same 128-operation budget before
shape allocation, bounds/UUID checks, per-Cube Box UV net capacity,
untouched existing Texture state and independent preflight/Apply.
Blockouts cannot declare Texture/UV/visual completion. Rust tests are
AUTHORED_NOT_RUN (six face directions, disjoint volume, cavity, rejection,
source immutability, Undo/Redo and editable .bbmodel). Native performance
and reference quality relative to Local remain NOT_EXECUTED/UNVERIFIED.

**G3.2 bounded structural semicircular arch (2026-11-19; SOURCE ONLY):**
The same G1 `geometry_assembly.rs` compiler now accepts optional
`parts[].arches`: caller-declared center, size, X/Z horizontal span,
wall, rise, and 5–17 explicit UUIDs. Rust builds two full-height support
piers followed by 3–15 odd-count crown strips along a conservative
semicircular opening. All strips remain ordinary disjoint Bedrock Cubes
in one declared Bone and one canonical EditPlan. Opening depth is real;
no mesh, alpha-illusion, persistent curve system or new executor.
Anti-microcube guards require at least two units per strip, integer
strip widths matching Box UV, and visible post-quantization curvature.
Unsupported/unsafe dimensions, duplicate IDs, over-budget batches,
pretextured projects and insufficient atlas per-Cube net fail closed.
UV packing, appearance and actual profile fidelity remain unverified;
this is only a structural blockout and not general organic sweep.
Positive/negative Rust source regressions cover both X/Z spans,
piers, curvature, disjoint volume, no-mutation preflight, Undo/reopen
and existing G1 request compatibility. Tests NOT_EXECUTED.

**G3.3 bounded linear variable-radius Sweep (2026-11-19; SOURCE ONLY):**
`geometry_sweep.rs` is a pure Rust G1 source helper, not a second geometry
engine. `parts[].sweeps` accepts one named 2–8-station 3D centerline with
integer model-unit positions and radius 2–6, plus an exact UUID seed.
The explicitly declared polyline is rasterized at one model-unit cell
centres as a union of varying-radius swept spheres along straight chords.
A single ≤32,768-cell raster must be 6-face connected; deterministic
X/Z/Y greedy partition returns at most 64 disjoint Box-UV Cubes.
Each Cube UUID is SHA-256-derived from a versioned namespace, the seed and
partition index. Changing source Geometry can shift later UUID indices;
this is NOT a persistent parametric identity or revision engine.
Existing parent-first G1 EditPlan, bounded preflight, no-texture blockout,
atlas/UV admission and independent Apply/Undo remain authoritative.
Reversal, degenerate segments, inaccessible grid, disconnected material,
empty/unrepresented segments, excessive Cubes and UUID collisions refuse
without mutating the source. The method does not claim Catmull-Rom curves,
anisotropic Profile Sweep, transported frames, twist, mesh/CAD accuracy,
accepted 3D silhouette or visual quality.
Source regressions AUTHORED_NOT_RUN. Local/Blockbench comparison and native
Windows/Cargo/Node execution remain DEFERRED/UNVERIFIED.

**G3.4a opt-in curved centerline for the existing G3.3 Sweep (2026-11-19; SOURCE ONLY):**
The same `geometry_sweep.rs` now accepts `interpolation:
"CENTRIPETAL_CATMULL_ROM"` plus explicit `max_chord_error` in
0.25–1.0 model units, with at least three stations. Default
`LINEAR` remains the byte-compatible G3.3 source contract.
Barry–Goldman centripetal interpolation constructs the centerline with
extrapolated endpoint controls. Radius still interpolates linearly.
Adaptive subdivision derives a conservative cubic Bézier control-point
distance bound plus 1.5-unit chord and 0.75-radius-change limits.
Subdivisions are capped at 96 samples, depth eight, and retain their
original source-segment identity. Rust computes the voxel grid from
the resulting path samples to avoid silently clipping spline overshoot.
The original 32,768-cell grid, 64-disjoint-Cube limit, connectivity,
source UUIDs, G1 preflight, UV admission and separately approved Apply
remain the only native Geometry authority. No new CLI or shape store.
This is an isotropic radius sweep, NOT anisotropic rectangular/elliptic
PROFILE_SWEEP, tangent-frame transport, twist, mesh generation or
reference-verified quality. Rust/Node source regressions authored
NOT_EXECUTED; no claims of artistic/PC-native superiority.

**G3.4b anisotropic LINEAR profile sweep (2026-11-19; SOURCE ONLY):**
`geometry_profile_sweep.rs` is a pure native Cuboid compiler inside
the same G1 Rust authoring core. Opt-in `parts[].profile_sweeps`
declares 2–8 integer-position stations (half_width/half_height 1–6),
`cross_section` = ELLIPSE or RECTANGLE, and `up_axis` = X/Y/Z.
An initial projected up axis fixes roll. Minimum tangent-to-tangent
rotation parallel-transports the normal/binormal across authored
polyline bends; an ambiguous parallel starting axis or near-reversal
refuses rather than silently choosing another frame. Cross sections
change width/height linearly per flat-ended segment; there is NO
per-station twist, native mesh, Catmull-Rom profile or hidden rig transform.
One <=32,768-cell voxel source carries 7-bit segment ownership and
union occupancy. Original G3.3 six-connected disjoint-Cuboid partition
and 64-Cube cap are reused: no duplicate voxel engine. Consecutive
segments must contact by a full face near their declared common station,
not only through an unrelated distant segment. Cube IDs are
SHA-256-derived from a distinct profile-v1 namespace and explicit seed,
not persistent parametric shape identities. Existing G1 preflight,
source-SHA-bound Code Mode, Undo/Redo, atlas safety and separately
authorized Apply are unchanged; no texture allocation or visual verdict.
Source regressions AUTHORED_NOT_RUN; actual native quality/compatibility
and comparison with Local remain UNVERIFIED.

**G3.4c voxel-visible profile taper guard (2026-11-19; SOURCE ONLY):**
The existing G3.4b occupancy pass now observes first/last occupied
model-unit bands for each materially changing width/height, measured
in the local transported section frame. A declared half-extent change
of at least 1 model unit must produce at least a 0.5-unit directional
difference in occupied-cell radial extent; otherwise Rust refuses
`GEOMETRY_PROFILE_TAPER_UNREPRESENTED` before Cube partition/preflight.
This reuses the SAME occupancy decisions, with fixed-size per-segment
samples rather than a second raster or a parallel geometry compiler.
No request fields, UUIDs, Code Mode permissions, Box UV allocation,
existing untapered output, or artist/native acceptance change.
One Rust positive/negative regression is AUTHORED_NOT_RUN.

**G3.4d optional authored profile twist (2026-11-19; SOURCE ONLY):**
The existing `GeometryProfileStation` now accepts optional
`twist_degrees` in [-180, 180]. Omitted/zero preserves the original
G3.4b source serialization and zero-twist voxel path. Each segment
linearly interpolates the authored roll around its parallel-transported
tangent, without a second mesh, scene store, or raster. The G3.4c
endpoint-band taper observer uses the actual rotated section axes.
For >=45-degree changes on materially anisotropic profiles (half-width
versus half-height differs by >=1), the same raster compares occupancy
against the fixed starting angle until one voxel differs;
if none does, it refuses `GEOMETRY_PROFILE_TWIST_UNREPRESENTED`.
Circular/symmetric sections and subtle turns are not falsely claimed
to have visibly distinct twist. The immutable G1 plan, UUID namespace,
preflight, Undo, independent Apply approval and untextured Box UV
limits remain intact. Rust source regressions AUTHORED_NOT_RUN;
artist/native quality and Rust>Local parity remain UNVERIFIED.

**G3.5 source-authored axial LOFT and REVOLVE (2026-11-19; SOURCE ONLY):**
The existing `GeometryAssemblyPart` accepts opt-in `lofts` and
`revolves` using explicit `origin`, X/Y/Z axis, 2–12 ascending
axial sections (start height 0, final height 1–32), a name and UUID seed.
LOFT interpolates authored rectangular width/depth and lateral centre,
sampling each axial layer once and using half-open 1-unit voxel membership.
REVOLVE interpolates outer/inner radii (outer 1–12, at least one-unit wall),
then checks per-layer four-connected ring material and eight-connected
background so a requested through-channel cannot silently leak or vanish.
Both use the existing G3.3 bounded 32,768-cell grid, shared 64-Cube
partition, G1 128-operation plan, Box UV preflight and Undo/Redo.
`geometry_axial.rs` owns both small source-local constructors;
generated Cube UUID namespaces are `geometry-loft-v1` and
`geometry-revolve-v1`, separate from Sweep/Profile identities.
This is a voxelized untextured blockout, not mesh/CAD, atlas packing,
native reference fidelity, global contact solving or visual acceptance.
Rust and Node regression sources AUTHORED_NOT_RUN; Windows/Blockbench
native, artistic and performance results UNVERIFIED. No new process,
persistent Recipe or alternate authoring engine.

**G2 same-Bone face attachment planner (2026-11-18; SOURCE ONLY):**
`geometry_attachment.rs` proposes one exact, axis-aligned Face-to-Face
Cube alignment with a caller-specified nonnegative clearance and
tangent offset. It requires two distinct Cubes in the SAME Bone frame,
opposite cardinal faces and nondegenerate unrotated/uninflated/
unstretched bounds. Cross-Bone frames, ambiguous rotations, unsafe
UV-driven moves, zero-delta edits and out-of-range results fail closed;
the existing Rust `TranslateCube` and disposable `EditorSession::preflight`
remain authoritative. `plan-geometry-attachment` is a SHA-pinned
read-only CLI operation, not a persistent constraint, resizing
propagation, collision solver, file write, or native quality verdict.
Authored regressions cover all six facing directions, exact offset,
Undo/Redo, .bbmodel reopen, unsuitable parents/transforms and invalid
input. Tests/native Blockbench remain NOT_EXECUTED.

**G2.2 explicit resize propagation (2026-11-18; SOURCE ONLY):**
The Rust `geometry_propagation.rs` compiler takes one exact root Cube
`ReframeCube` and a bounded acyclic attachment set, constrained to
the same Bone. Every dependent Cube has one incoming attachment;
links are evaluated parent-first, even when supplied out of order.
The same G2.1 face delta helper is reused for `TranslateCube`, and
disposable `EditorSession::preflight` verifies the whole batch with
existing UV/Undo guards. No constraint is persisted in `.bbmodel`;
subsequent resizes require a new explicit request. Unknown targets,
cycles/disconnected links, duplicate targets, unsafe transforms/UV,
overflow and stale revisions are refused. The SHA-pinned CLI
`plan-geometry-resize-propagation` is read-only; a separate approved
`apply` remains necessary. Rust regressions authored NOT_EXECUTED.

**G2.3 bounded same-Bone AABB overlap impact (2026-11-18; SOURCE ONLY):**
Both G2 planners now screen only their changed Cube bounds against
unrotated, uninflated, unstretched Cube siblings directly under the same
Bone, before/after the exact proposed operation. Positive-volume new,
preexisting and resolved overlaps are distinguished; face contact at zero
penetration is not called a collision. Diagnostic samples are capped at
16 pairs with an explicit truncation flag. Unsupported neighbor count
and "whole_model_collision_verdict=UNVERIFIED" prevent false scene-wide
clearance: cross-Bone, rotated/inflated/stretched, and intentional
overlaps still need a separate review. This adds no persistent graph,
new mutation gate, forced overlap rejection or visual approval.
Source regressions are AUTHORED_NOT_RUN, native acceptance DEFERRED.

**G2.4 static rotated-neighbor OBB advisory (2026-11-19; SOURCE ONLY):**
Existing G2 attachment and resize-propagation read-only plans retain
their original AABB report and include a nested
`aabb_overlap_review.rotated_neighbor_obb` hint. This uses each saved
Cube's positive bounds, authored rotation pivot and ZYX Euler order as
the source Rust viewport for direct same-Bone siblings. One separating-
axis test checks only affected UNROTATED Cube proposals against supported
ROTATED neighbors in the shared rigid Bone-local frame. Preexisting,
introduced and resolved intersections, newly touching faces and at most
16 introduced penetration samples are distinguished. Unknown pivot,
inflate, stretch, degenerate shapes, nested/cross-Bone or animated poses
do not silently count as clear. Unsupported neighbors and
`whole_model_collision_verdict=UNVERIFIED` remain explicit.
This is static source QA, not exact live Blockbench/GPU/motion/visual
proof or reference-matched silhouette evaluation. The original G2
attachment restrictions, AABB metrics, preflight and independent Apply
are unchanged. No new process, CLI command, mutation, dependency,
model store or second geometry engine; Rust/Node positive/negative
source regressions AUTHORED_NOT_RUN.

## Dated source history (preserved)

**P0 editable-project/export fingerprint closure (2026-11-18; SOURCE ONLY):**
The existing read-only Bedrock `asset_handoff` now includes the
canonical editable `.bbmodel` SHA-256 and exact serialized byte count
alongside the same-Revision Geometry/PNG/Animation exporter hashes.
It reuses the validated Rust streaming serializer, not a separate file
format or an extra model store. A model too large to export is explicitly
`BBMODEL_EXPORT_BLOCKED`; source consistency still cannot certify
Blockbench editability, pixels, or playback. A nested two-Bone/two-Cube
six-face/animation integration regression, the existing CLI
`inspectBatch` consumer, and streaming-hash equality assertions are
AUTHORED_NOT_RUN. Default permissions, no-overwrite writes, Code Mode
sandbox and active localtest hold are unchanged.

**Shared immutable semantic read and disposable preflight (2026-11-18; SOURCE ONLY):**
`EditorSession::semantic_map` and `EditorSession::preflight` are
single Rust-native read owners used by both the headless CLI and
Tauri's in-memory `EditorState`. Semantic map is a bounded page of
typed Cube/Bone/Texture/Animation identities and declared metadata;
names are not unique and no raw PNG, arbitrary extension or full
document is returned. Preflight clones the already validated
`EditorSession`, invokes the existing atomic `apply_with_correction_scope`
path, obtains a candidate canonical SHA, then discards the clone.
It cannot commit an edit, alter live history, save a file, bypass a
visual reviewer, or grant a future write. Tauri uses
`rust_editor_semantic_map` / `rust_editor_preflight` with epoch/revision
checks before and after the read, without installing any AI live bridge.
Rust CLI equivalents `semantic-map` and `preflight` are SHA-pinned.
Positive/stale/oversize/negative source regressions AUTHORED_NOT_RUN;
Cargo/Windows/Blockbench and measured speed/memory NOT_EXECUTED.

**Private Rust editor recovery (2026-11-18; SOURCE ONLY):**
The standalone Rust Desktop now has a private app-local recovery area,
readable through a native File > Recover Checkpoint dialog. An idle
Svelte timer requests immutable snapshots from the existing Rust
EditorSession (30-second idle, bounded 2-minute pending window).
Checkpoints are exclusive no-overwrite .bbmodel files inside the private
recovery directory, with content SHA identity and limited verified
retention per run/epoch. Restore validates the checkpoint and reopens it
as a new dirty document, never rewrites the original or inherits the
previous source file identity/Undo history. Listing is UNVERIFIED until
actual native file validation. This is not a general autosave replacing
Save Copy, nor an active AI live bridge. Source regressions authored
NOT_EXECUTED. Windows security, interruption and native Blockbench parity
remain UNVERIFIED. See docs/04-system/rust-native-editor-plan.md.

**Rust Open fingerprint allocation reduction (2026-11-18; SOURCE ONLY):**
The native Open command now computes its initial canonical document SHA with
the validated EditorSession streaming sink instead of exporting a second
complete .bbmodel Vec solely for hashing. The independent raw source-file SHA,
original-file change guard, loaded session/Undo, initial clean state, format
and eventual Save Copy behavior are unchanged. A source regression checks a
noncanonical compact imported JSON file against the byte-identical canonical
export oracle and independent raw identity. Regression AUTHORED_NOT_RUN;
actual memory/latency, Windows GUI and Blockbench acceptance UNVERIFIED.

**Rust Save/Export concurrency refinement (2026-11-18; SOURCE ONLY):**
New/Open, editor transactions and native Save Copy, Geometry/Animation,
Texture PNG and review-capture publication now share the existing short
edit/publication lease. A saved file is produced from one immutable,
revision-checked Rust session after the picker returns; external disk SHA,
file encoding and no-overwrite publication do not retain the EditorStore
mutex. Read-only snapshots can proceed while the file operation runs.
Save Copy updates the live source checkpoint only after publication under
a final short lock. As before, competing writes refuse rather than
implicitly retrying a possibly persisted mutation. The in-memory model,
original-file protections, .bbmodel format and visual review gates remain
unchanged. Source regressions are AUTHORED_NOT_RUN and native behavior is
UNVERIFIED.


**Source-bound user-initiated camera PNG capture (2026-11-17; SOURCE ONLY):**
Rust desktop now offers a six-direction fixed-camera `Capture PNG` action for the
current Three.js viewport. The renderer reads a synchronous PNG after drawing
one selected fixed camera, omitting editor grid/gizmo/edge overlays. The
existing Tauri session binds epoch and revision to a clean, canonical saved
`.bbmodel` disk SHA before and after the user-owned Save dialog. It refuses
unsaved or changed models, noncanonical imported disk files (use Save Copy),
invalid/oversized PNGs, another output directory or overwriting existing
files. PNG bytes are decoded and saved through the canonical no-overwrite
publisher; the returned source-model SHA can be matched to Code Mode's
`captureModelSha256`. The human operator still supplies independently
approved reference image paths and selects each capture in the existing
Code Mode visual manifest. This is a first-party **Rust Three.js preview
subset**, not Bedrock rendering, authenticated camera visibility, image
reviewer installation, or artistic acceptance. One direction per explicit
user action, not an unattended six-shot capture. TypeScript and Rust
regressions authored, but Tauri, Node, GPU and visual trials NOT_EXECUTED.

**Validated-session canonical Dirty hashing (2026-11-17; SOURCE ONLY):** The Rust editor's `EditorSession::canonical_sha256()` now reuses its guaranteed validated-document invariant instead of running `AuthoringDocument::validate()` again after every successful Apply/Undo/Redo before streaming the exact saved `.bbmodel` SHA. Construction, imports and every accepted transaction continue validation; history only restores validated documents. Public direct `AuthoringDocument::export_bbmodel()` and Save Copy still validate independently, and malformed input cannot establish a session. The checked fingerprint implementation remains a test-only negative oracle. Source regressions for valid session fingerprint, malformed-session refusal, old/new byte equality and size boundary are AUTHORED_NOT_RUN. No compiler, native or performance measurements executed.

**Borrowed UUID validation sets (2026-11-17; SOURCE ONLY):** Rust `AuthoringDocument::validate` no longer allocates separate copied UUID strings into all-ID, Cube-ID, Bone-ID and Outliner-seen sets on each canonical export or editor Dirty hash. All membership checks use references to the immutable document/Outliner; validation order, error codes and duplicate, missing or incomplete hierarchy refusals remain unchanged. Source regression cases cover valid import/export and duplicate/missing/incomplete IDs without modifying assets. Tests AUTHORED_NOT_RUN under active hold; actual Rust compiler behavior and allocation savings remain unverified.

**Streaming canonical .bbmodel dirty SHA (2026-11-17; SOURCE ONLY):** The existing Tauri editor Dirty reconciliation now asks `EditorSession.canonical_sha256()` to hash the validated, borrowed Rust `.bbmodel` serialization directly as a bounded byte stream, instead of allocating a complete canonical JSON Vec solely to compute a digest. The streaming path shares the same serde pretty formatter and trailing newline as the actual file encoder, enforces the original 16 MiB output limit, and refuses failed validation/serialization as Dirty. Save Copy and no-overwrite file publishing still use the full canonical export bytes and independent source SHA. Authored Rust tests compare fingerprints to actual export SHA across plain/textured/opaque fixtures, reject invalid docs and enforce the output budget; Cargo/Windows/native execution and measured savings NOT_EXECUTED.

**Borrowed canonical .bbmodel serialization (2026-11-17; SOURCE ONLY):** Rust authoring's validated `bbmodel::encode` now serializes the owned `AuthoringDocument` through a borrowed wire view, instead of cloning its entire Cube/Bone/Outliner, Texture PNG Base64, Animation and opaque extension payloads into a second owned wire before creating the output bytes. Field names, order, serde flattening, pretty formatting, final newline, maximum model bytes and validation remain unchanged. The previous owned encoding exists under `#[cfg(test)]` only as a byte-for-byte regression oracle covering plain/textured and opaque-extension models, save/reopen and malformed asset refusal. This also benefits repeated canonical dirty checks without modifying their correctness. `TEST_AUTHORED_NOT_RUN`; actual Cargo compilation, allocations and Blockbench/native equivalence remain UNVERIFIED.

**Rust four-connected Paint fill memory (2026-11-17; SOURCE ONLY):** The existing RGBA8 flood fill now treats an already-recolored pixel as visited because the desired RGBA always differs from the exact source color. It removes a redundant `width × height` visited array while preserving a bounded non-recursive stack, four-connected region matching, transparency, out-of-bounds and unsupported-source refusals, one Undo step and editable `.bbmodel`. Source regression covers a 64×64 atlas with a separating color barrier, unchanged pixels across the barrier, save/reopen, erase, no-op and Undo/Redo. Cargo, native visual and measured memory/latency tests remain NOT_EXECUTED.

**Bounding-box Rectangle Paint working set (2026-11-17; SOURCE ONLY):** The final-writer overlap mask now covers only the union bounding rectangle of affected inclusive pixel regions, instead of the full 256×256 maximum PNG atlas. Reversed rectangle corners, non-zero atlas offsets, multiple overlaps and no-op preservation use the original bounded Rust decoder, PNG encoder, correction scopes and Undo authority. A source-only regression covers an offset 128×128 atlas edit and rollback; Cargo/Windows/native render and peak-memory comparisons NOT_EXECUTED.

**Memory-bounded Rust Rectangle Paint (2026-11-17; SOURCE ONLY):** The existing 64-rectangle RGBA8 writer now resolves final overlapping rectangles in reverse order, marking visited pixels once. This replaces the extra complete decoded-RGBA clone used for true no-op detection with one visited byte per admitted pixel, while preserving last-write-wins colors, erase semantics, PNG source identity when unchanged, revision guard, one Undo step and existing UV/face/correction-scope checks. Source regressions authored for mixed overlaps, final writer precedence, genuine paint-and-erase no-ops, Save/Open and Undo/Redo. No Cargo, Windows/Blockbench, performance or visual tests executed; real latency and peak-RAM savings are UNVERIFIED.

**Rust guarded Face Paint batch efficiency (2026-11-17; SOURCE ONLY):** Adjacent `paint_cube_face_regions_guarded` operations on one atlas now share the existing 64-rectangle PNG decode/edit/encode when their complete ordered plans fit the bound. Every Cube face, actual atlas patch and alias still goes through the canonical UV checker BEFORE the bitmap changes. Interleaved non-Paint operations, another atlas or over-budget regions retain sequential execution, and parent `EditorSession` still enforces atomic rollback, correction scopes, revision checks, Undo and `.bbmodel` preservation. Rust positive/negative regression source AUTHORED_NOT_RUN; actual speed/artistic quality UNVERIFIED.

**Saved face-local cluster footprint (2026-11-17; SOURCE ONLY):**
The existing headless `inspect-batch` `material_face_patch` selector
now accepts optional, bounded `face_spans` rows. Canonical Rust
projects each Cube-face-local span through the same signed/rotated UV
mapper as guarded Paint and refuses any projected texel outside the
selected physical atlas patch. A matching `cluster_footprint` receipt
is source-containment evidence only; it is not visual material QA or
permission to write. Patch-only reads remain backward compatible,
and actual Rust Paint, Undo, protection and no-overwrite authority
are unchanged. Rust/Node tests AUTHORED_NOT_RUN; LOCAL_TEST_DEFERRED.


**Scoped UV alias Paint alignment (2026-11-17; SOURCE_ONLY):**
The existing saved `material_face_patch` inspector and the canonical
`paint_cube_face_regions_guarded` now reuse one Rust overlap-witness
check for the **actual selected physical atlas rectangle**. A face may
have unrelated shared UV elsewhere while a disjoint, uniquely owned
patch is painted; any actual shared-pixel touch, truncated collision
report, missing texture mapping or unknown owner still refuses.
No new Paint engine, release, or visual-quality assertion. Rust
positive/negative regression source AUTHORED_NOT_RUN; LOCAL_TEST_DEFERRED.


**Catmull-Rom Position/Scale visibility bound (2026-11-16; SOURCE_ONLY):** The existing SHA-bound `asset_handoff.geometry.translation_clearance` now includes numeric Catmull-Rom Position and Scale. A read-only helper evaluates the exact *uniform index-neighbor* cubic construction represented by pinned Blockbench 5.2.1 `SplineCurve` and the existing Rust preview: for four saved values `p0,p1,p2,p3`, each spline segment's equivalent scalar Bernstein controls are `p1`, `p1+(p2-p0)/6`, `p2-(p3-p1)/6`, `p2`. Their maximum absolute value provides a conservative per-axis bound even when actual interpolated motion overshoots authored keys. The scan retains Step-before-Catmull priority and Blockbench's first/last neighbor rules for loop clips; short tracks have no invented segment. Bounded Position components are recombined by Euclidean norm; Scale uses the existing maximum hierarchy amplification. The report adds the optional `catmullrom_numeric_tracks` count to the existing type, without modifying `.bbmodel`, Geometry/PNG/Animation export bytes, Undo, file publishers or the Code Mode host. Positive/negative Rust regression source covers overshoot, Step, looping neighbors, malformed numeric values, independent resource hashes, save/reopen and nonmutation; **TEST_AUTHORED_NOT_RUN; LOCAL_TEST_DEFERRED**. This is a **conservative single-clip source model**, not verification of Bedrock's interpolation, native visual correctness, controller blending or performance. Primary references: pinned `JannisX11/blockbench@e2ede0809ee6bc91f374ac7e00d34cffbdf86a14` `js/animations/keyframe.js`, `js/animations/timeline_animators.js`, plus `apps/desktop/src/rustAnimationPose.ts`.


**Nonlinear numeric motion clearance (2026-11-16; SOURCE_ONLY):** The existing SHA-bound `asset_handoff.geometry.translation_clearance` now admits source-validated numeric Bezier Position/Scale with **per-axis cubic control-value bounds** rather than trusting endpoint values or time samples. This is required because each saved Bezier axis has its own time/value handles and may overshoot the authored keys; a shared 3D control-point norm would be unsafe. For Scale the largest absolute control value is combined with the established per-Bone max(1, growth) ancestral product. Bezier and Catmull-Rom numeric Rotation also fit the existing arbitrary rigid pivot sphere; Catmull-Rom Position/Scale remains explicitly `unassessed` due to spline overshoot and unresolved native numeric interpolation. The stable report adds `bezier_bone_tracks` and `catmullrom_rotation_tracks`, without modifying the original `.bbmodel`, Geometry/PNG/Animation exporters, trusted Code Mode host, or Undo/no-overwrite behavior. Source-only regression cases cover control-handle overshoot, absent endpoint motion, Scale growth, Catmull-Rom Rotation vs Position refusal, source-hash/roundtrip preservation, and type consistency. **SOURCE_REVIEWED; TEST_AUTHORED_NOT_RUN; LOCAL_TEST_DEFERRED.** This remains a single-clip conservative *upper bound*, never observed playback, native culling or accepted visual quality. Reference: pinned Blockbench `JannisX11/blockbench@e2ede0809ee6bc91f374ac7e00d34cffbdf86a14` animation/Bezier sources, <https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationsoverview>, mathematical convex-hull explanation <https://people.eecs.ku.edu/~jrmiller/Courses/IntroToCurvesAndSurfaces/BezierCurveProperties.html>, and independent spline overshoot evidence <https://docs.kdenlive.org/en/tips_and_tricks/useful_info/smooth_keyframe_interpolation.html>.



**Scale-aware numeric motion visibility budget (2026-11-16; SOURCE_ONLY):** The existing SHA-bound `asset_handoff.geometry.translation_clearance` read now admits recognized linear/step Bone Scale together with Position and Rotation. Each Bone's maximum numeric scale axis is bounded below by 1 (a shrink never reduces the safe reference envelope); a bounded Outliner traversal multiplies these factors along ancestor chains. A whole-model compiled pivot envelope and the maximum single-clip translation chain are then conservatively multiplied by the largest scale-chain amplification. This is intentionally loose to avoid inventing renderer pose evidence, especially when separate clips have different maxima. New `coverage_mode: scaled_pivot_envelope`, `scale_tracks`, and `max_scale_chain_amplification` fields are read-only advisory metadata; prior statuses and the original Geometry, PNG, Animation, .bbmodel, Undo and no-overwrite exporters remain unchanged. Catmull-Rom/Bezier, Molang or opaque imported animation, simultaneous controller blends, exact Scale/Rotation order, native rendering and comparative performance are **NOT VERIFIED**. Source tests include scale-only, two-level multiplicative Scale, shrink-only safety, explicit saved visible_box, source integrity and exporter SHA preservation: TEST_AUTHORED_NOT_RUN. Official source: https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationsoverview (independent per-Bone channels, hierarchical transforms); pinned Blockbench 5.2.1 geometry/animation codecs used as format references.


**Rotation-aware visibility envelope (2026-11-16; SOURCE_ONLY):** The existing `asset_handoff.geometry.translation_clearance` read now handles numeric linear/step Bone Rotation as well as Position without simulating unverified Euler poses. The canonical Geometry owner computes a padded root-to-leaf pivot-chain *upper radius* directly from the same compiled Bone/Cube resource used for Bedrock output, including inflated Cube corners and saved Cube pivots. The handoff combines this radius with maximum hierarchical Position reach per **one** numeric clip, then compares it against actual exported `visible_bounds`. Existing `scope` and `status` values remain stable; `coverage_mode: translation_only | pivot_rotation_envelope` and a bounded radius distinguish source assumptions. This conservative overestimate never auto-edits `visible_box`, proves native visibility, scores visual art, or changes Geometry/PNG/Animation bytes. Nonidentity animated Scale, Catmull-Rom/Bezier, opaque imported clips, simultaneous controller blends and exact motion are still not assessed. Authored Rust regressions cover nested pivots, rotation-only far-pivot geometry, tiny nonzero rotation, unrepresentable compiled Geometry, explicit user-authored visibility clearance, lossless `.bbmodel` save/reopen and unaffected PNG/Animation hashes. **SOURCE_REVIEWED; TEST_AUTHORED_NOT_RUN; LOCAL_TEST_DEFERRED**. Sources: pinned Blockbench 5.2.1 Geometry/Animation compilers and Microsoft Bedrock Animation Overview.


**Conservative translation-only animation visibility budget (2026-11-16; SOURCE_ONLY):** The canonical Geometry compiler now makes its already-calculated **static** Bedrock bounds available alongside identical resource bytes to the read-only three-domain `asset_handoff`. This avoids a second Geometry compile or a cloned editable model. `geometry.translation_clearance` compares the actual published `visible_bounds` with a conservative single-clip root-to-leaf bound for recognized numeric **linear/step Position** keyframes (max Bone vector magnitude summed along each nested hierarchy path, 16 model units per block). Identity-only Rotation/Scale keys are admitted; non-identity Rotation/Scale, Catmull-Rom/Bezier, opaque imports, non-finite reach, and simultaneous controller blending are explicitly unassessed. The report distinguishes `conservative_margin_shortfall` from `source_budget_covered` and never interprets the former as observed culling, the latter as native PASS. SHA-checked Code Mode already receives this bounded report through `asset_handoff`, with no new tool, model authority, file writes, or auto-expanded `visible_box`; the existing separately authorized `set_visible_box` operation remains the only adjustment. Source-authored regression compares unchanged Geometry/PNG/Animation hashes before/after inspection, changes only Geometry export when a user-authored visibility floor is applied, refuses unsupported curves/rotations and checks editable save/reopen. Tests NOT_EXECUTED, native motion and runtime culling UNVERIFIED.


**Animation loop-endpoint review in the existing Bedrock asset handoff (2026-11-16; SOURCE_ONLY):** The same canonical Rust numeric clip authority now gives the SHA-bound three-domain `asset_handoff.animation.loop_seams` advisory with bounded issue locations for explicit start/end numeric-axis differences and missing endpoint evidence. For rotation it compares endpoint orientation modulo 360 degrees; single-key constant channels do not require artificial end keys. Imported opaque clips remain unsupported, and an exportable asset stays `source_consistent` even when artistic loop-review candidates exist. Numerical Euler-axis differences do not prove a different 3D orientation. It does not calculate tangent/velocity/curve continuity, culling reach, controller blending or native playback. No clip/PNG/Geometry edits or new Code Mode selector; typed client projection and regression source are included. `SOURCE_REVIEWED; TEST_AUTHORED_NOT_RUN; LOCAL_TEST_DEFERRED`.


**Saved Blockbench visible_box respected (2026-11-16; SOURCE_ONLY):** In pinned Blockbench's .bbmodel property serialization, `visible_box` is `[width,height,offsetY]` in blocks and Geometry export preserves it as a minimum relative to calculated model bounds. The canonical Rust Geometry exporter now merges a valid saved `visible_box` with the existing bounded static envelope: it never shrinks static horizontal width and unions both vertical intervals, including a manually shifted center. Missing property retains the old static behavior; malformed/negative/out-of-budget explicit values fail closed during Geometry export rather than silently exporting a different culling envelope. `SetVisibleBox {bounds}` (`set_visible_box`) is one separately authorized, revision-guarded and Undoable Rust edit on the existing .bbmodel project property; typed Code Mode and Tauri use the same operation and trusted host. It changes no Cube, UV, PNG or Animation keyframe. Source regressions AUTHORED_NOT_RUN cover exact union, small-overrides-do-not-shrink, far offsets, malformed original preserved for edit but export refused, movement with a deliberately authored envelope, Undo/Redo and Save/Open. This permits explicit animation clearance; it does NOT automatically calculate all animation poses, guarantee culling, or reproduce native Three.js viewport bounds. The existing `asset_handoff` Rust inspection also now reads the **actual canonical Geometry output** in memory and exposes `geometry.visible_bounds` plus `geometry.visible_bounds_source: computed_static | saved_visible_box_union`. This is source metadata, not animation pose QA; hashes, bitmap non-disclosure, and SHA binding remain unchanged.

**Headless Bedrock Geometry visible bounds (2026-11-16; SOURCE_ONLY):** Compared pinned official Blockbench 5.2.1 `bedrock.js` `calculateVisibleBox` and its `compile` output with the Mojang/Microsoft schema's optional `visible_bounds_width`, `visible_bounds_height`, `visible_bounds_offset`. The Rust Geometry exporter had omitted all three. The single Geometry compiler now derives conservative *static model* visibility bounds from the exact compiled Bones/Cubes: a padded axis-aligned pixel envelope for unrotated geometry; an intentionally larger radial enclosure through all saved Bone/Cube pivot chains for rotated geometry; a finite small fallback for an empty Bone rig. Values are converted from 16 pixels per model block and emitted in the same `.geo.json` description without changing the original editable `.bbmodel`, PNG, Animation, SHA or no-overwrite publishers. Headless bounds cannot replicate Three.js mesh envelopes or automatically cover arbitrary animated poses; the report does **not** claim native render or culling acceptance. Source regressions authored for base/moved Y geometry, pivot rotations, empty rig, combined Geometry/Animation Bone names and preserved editable source. Original sources: https://github.com/JannisX11/blockbench/blob/e2ede0809ee6bc91f374ac7e00d34cffbdf86a14/js/formats/bedrock/bedrock.js#L640-L678 and https://github.com/Mojang/bedrock-samples/blob/main/documentation/Schemas.html. TEST_AUTHORED_NOT_RUN; LOCAL_TEST_DEFERRED.

**Indexed Bedrock export and shared asset validation (2026-11-16; SOURCE_ONLY):** The existing Rust `export_bedrock_geometry` builds temporary UUID→Bone/Cube lookups once for each validated document instead of rescanning the full lists for every Outliner child. Rust `export_bedrock_animations` reuses one UUID→Bone lookup across recognized tracks/clips; the shared numeric clip admission builds a track-local lookup rather than rescanning the rig for each Bone. Common `AuthoringDocument::validate` also builds one Texture UUID membership index for all Cube faces while keeping original numeric-index, malformed texture, duplicate UUID, and missing reference refusal boundaries. Standalone Add/Duplicate Cube validation remains independent. All exporters retain Outliner/clip/track traversal order, `.geo.json`/`.animation.json` shapes, SHA/no-overwrite publishers and editable `.bbmodel`. Source regressions for 9 bones/129 cubes, 16 Bone tracks and 96 textures/65 cubes are AUTHORED_NOT_RUN. No Cargo/Blockbench execution or measured performance claim.

**Texture coverage page scan efficiency (2026-11-16; SOURCE_ONLY):** The same Rust six-face PNG/UV inspector now has an internal prevalidated Cube-borrowing path. `model_texture_coverage` validates the entire input document once per page, builds one temporary Texture UUID→index map, and reuses both that map and the existing in-page decoded-PNG cache across up to eight Cubes. It no longer invokes whole-document validation or rescans Cube UUIDs/texture asset lists for each face. Independent public single-Cube `inspect_cube_surfaces` and `inspect_cube_uv_alpha` keep their own full-document validation and identical result contracts; malformed data in any unscanned Cube still fails closed, even for an empty page. No persistent cache or additional model authority. Source regressions for 8 Cubes/48 faces, public-vs-paged parity, corrupted out-of-page Cube, and .bbmodel preservation AUTHORED_NOT_RUN. Actual runtime speed improvement and native visual QA remain UNVERIFIED.

**Attention-only Texture coverage pages (2026-11-16; SOURCE_ONLY):** The existing Rust `inspect_model_texture_coverage` keeps its full six-face output by default. New `inspect_model_texture_coverage_filtered(doc, offset, limit, attention_only)` reuses the same bounded six-face/PNG-alpha decoder and per-page atlas cache, but optionally returns only faces with source review candidates: fully/partially transparent pixels, translucent pixels, unsupported mapping or unassigned/implicit texture reference. Deliberately absent `null` sides and measured nontransparent sides are omitted *only* from the compact view, not from the underlying scan or statistics. Crucially, `reviewed_cubes` and `next_offset` count input Cubes visited, not returned Cubes, so healthy pages never skip later findings. The report adds `attention_only`, `returned_cubes`, `returned_faces`, `partially_transparent_faces` and `translucent_faces`, alongside existing page-local totals. No automatic repaint, visual verdict, network fetch or persistent image cache; transparent pixels may be intentional. CLI `inspect-batch` and typed Code Mode accept optional boolean `attention_only` while preserving unfiltered callers. Rust/CLI/JS regressions AUTHORED_NOT_RUN; PC-local/native acceptance and efficiency remain UNVERIFIED.

**Atlas UV boundary handoff (2026-11-16; SOURCE_ONLY):** The existing `asset_handoff` inspector now checks whether each explicitly bound selected-atlas Cube face has a nonzero UV area within the project's declared PNG width/height. Manual UVs use the actual saved `[u0,v0,u1,v1]` rectangle; Box UVs are projected once per Cube through the already-owned Rust `refresh_box_uv`, without modifying saved faces. Reversed/fractional in-bounds coordinates remain valid; intentional null faces remain ignored. Paged issues distinguish `uv_out_of_bounds`, `uv_zero_area`, `uv_projection_unsupported` and include an effective `uv_rect`/`uv_source` only for supported UV reads. Failed bounds block *source* handoff even if independent Geometry and PNG exporters can serialize. This is a conservative metadata check, not atlas-alpha or visual QA: run existing `model_texture_coverage` separately for source pixel evidence. Rust/CLI regressions authored NOT_EXECUTED, native Blockbench/Minecraft and performance UNVERIFIED.

**Targeted face correction added to the same Rust authority (2026-11-16; SOURCE_ONLY):** The new canonical `assign_cube_face_texture` EditOperation takes explicit `{cube_uuid, face, texture_uuid}` to repair one located handoff issue without rewriting the other five Cube faces, Atlas PNG bytes, Geometry, Animation or saved UV. It refuses deliberate `null`/disabled faces (never creates an unseen side), unsupported per-texture/multi-file rules, nonexistent UUIDs and invalid face directions; revision-guarded whole-document Undo/Redo and `.bbmodel` serialization remain intact. The same typed operation is available through existing CLI/Code Mode and generic Tauri EditPlan, with trusted-host approval still required. Source regression verifies incorrect-atlas → blocked handoff → one-face correction → source-consistent handoff, unchanged other faces, Save/Open and Undo/Redo; native tests NOT_EXECUTED.

**Bounded exact Cube-face handoff corrections (2026-11-16; SOURCE_ONLY):** The existing read-only `inspect_bedrock_asset_handoff` now has a compatible paged variant that identifies each offending Cube UUID and face orientation rather than only returning model-wide mismatch totals. The same Rust source enumerates all faces in canonical Cube and `north/east/south/west/up/down` order, reports `problem`, `reference_kind` and an optional referenced Texture UUID, and returns at most 32 entries/page with `total_issues`, `issue_offset` and `next_issue_offset`. It never supplies automatic fix instructions, raw PNG, paths, or visual acceptance. `asset_handoff` in SHA-pinned CLI/Code Mode supports optional `offset`/`limit` (0/16 defaults) with explicit bounds and retains identical whole-document Geometry/PNG/Animation hashes across pages. Missing selected texture is now a separate blocker from merely unbound texture. Positive and negative pagination source regressions authored NOT_EXECUTED; real rendering and performance remain unverified.

**Read-only three-domain Bedrock asset handoff (2026-11-16; SOURCE_ONLY):** `inspect_bedrock_asset_handoff(doc, texture_uuid)` compares an explicitly chosen single RGBA8 PNG atlas with every saved Cube face's UUID/numeric texture reference, classifies `null` as intentional absence and `false`/unset/foreign/unknown as unresolved or conflicting. It reuses the actual Rust Geometry, PNG and Animation exporters in memory and returns their prospective output SHA-256/byte counts or exact refusal codes, with a stable source-only `source_consistent | blocked` result. Zero referenced faces, multiple referenced textures, unsupported PNG/UV rules, invalid Geometry, and opaque Animation fail the handoff instead of producing a false asset-ready claim. It never publishes files, exposes image bytes/paths, changes `.bbmodel`, or proves visual coverage. The existing SHA-pinned CLI `inspect-batch` and typed Code Mode `asset_handoff` selector share this one Rust owner; no new model engine or UI. Original publisher: Blockbench 5.2.1 `js/formats/bedrock/bedrock.js` (Bedrock Entity `single_texture: true`, geometry Cube compiler emits UV but not per-face PNG identity). Rust/CLI/Node regressions authored NOT_EXECUTED; native asset assembly and benchmark UNVERIFIED.

**Source-backed Catmull-Rom and adaptive Bezier Bedrock Animation export (2026-11-16; SOURCE_ONLY):** The single Rust `export_bedrock_animations` compiler now emits admitted one-data-point Catmull-Rom keyframes directly as Bedrock `lerp_mode:catmullrom` with source-equivalent `pre/post` fields. For monotone numeric Bezier handles, it adaptively inserts linear keyframes using the same cubic time-axis inversion as the existing editor pose projection; three interior checkpoints per interval check deviations at Rotation ≤0.05°, Position ≤0.005 blocks and Scale ≤0.0025, with depth ≤8, ≤255 inserted keys per segment and ≤4096 keys per channel. This is a bounded, sampled approximation—not proof of continuous or native rendering equivalence. Non-monotone/unsupported Bezier, over-budget/detail, invalid derived Scale and precision collisions fail the export rather than flattening silently. Runtime output reports `curve_fidelity: adaptive_bezier_approximation` when any saved Bezier is present, otherwise `native`; editor UI gives a visible notice. Original `.bbmodel` curves, Timeline Markers, textures and Undo remain unchanged. CLI/Code Mode/Tauri all call the existing exporter; controllers remain separate. Sources: pinned [Blockbench 5.2.1 exporter](https://github.com/JannisX11/blockbench/blob/e2ede0809ee6bc91f374ac7e00d34cffbdf86a14/js/formats/bedrock/bedrock_animation.js) and official [Bedrock animation 1.8.0 schema](https://github.com/MicrosoftDocs/minecraft-creator/blob/main/creator/Reference/Content/SchemasReference/Schemas/minecraftSchema_actor_animation_1.8.0.md). Rust/JS source regressions AUTHORED_NOT_RUN; actual Blockbench/Bedrock visual playback and cost-per-accepted-asset remain UNVERIFIED.

**Initial Bedrock Animation JSON output (2026-11-16; SOURCE_ONLY; curve refusal superseded above):** The canonical Rust `export_bedrock_animations` emits a separate Bedrock Entity `format_version:1.8.0` `animations` JSON file with exact Bone axis conversion, supported numeric linear/step keyframes, `once/loop/hold`, and sound/particle marker metadata. Step segments use the Blockbench-compatible next-keyframe pre/post encoding. Opaque/Molang/malformed clips, unsafe timestamp precision, collisions, Bezier and admitted one-point Catmull-Rom curves fail closed rather than being silently baked or flattened. Timeline Markers remain editor-only in preserved `.bbmodel`; controllers are not animations. CLI `export-animation` and trusted Code Mode `exportAnimations` share bounded SHA-checked source reads, no-overwrite sibling `*.animation.json` publication and permission approval. Rust storage/export, CLI and JS host/guest regressions AUTHORED_NOT_RUN; native Bedrock/Blockbench playback and efficiency UNVERIFIED.

**Source-backed Blockbench Animation Timeline Markers (2026-11-16; SOURCE_ONLY):** Reviewed pinned official Blockbench 5.2.1 `js/animations/timeline.js` `TimelineMarker.getUndoCopy`, `js/animations/animation.js` `Animation.extend/getUndoCopy`, `js/marker_colors.ts` (10 saved colors) and `js/formats/bedrock/animation_controller_codec.js` (separate controller file). The canonical Rust EditOperation now supports `add_animation_timeline_marker`, `update_animation_timeline_marker`, and `remove_animation_timeline_marker` with explicit `{animation_uuid,time,name,color}` (update uses `target_time`). A saved marker is **exactly** `{name,time,color}`, **not a persistent marker UUID**, so Rust identifies a marker by its original exact time and refuses ambiguous/closely colliding timestamps (Blockbench's ~0.001 s import collision threshold). Names, times, color index 0–9 and maximum 128 markers are bounded. Existing recognized Bone/Sound/Particle/Bezier clips, clip variants, Undo/Redo, loop and `.bbmodel` serialization are preserved. Changing Animation length refuses truncation of any marker; retiming scales marker times with Bone/Effect keys and rolls back on collisions. Tauri read-only snapshot exposes admitted markers without changing UI or inventing pose playback; CLI and typed Code Mode `inspectBatch` can page up to 32 markers. **Also repaired a previously unconnected CLI `animation_effect_events` selector** (enum, import and dispatch), preserving the single Rust read owner. No Molang, controller-state editing or executable events. The Bedrock Animation Controller codec exports a distinct `animation_controllers` resource; it must not be stuffed into ordinary numeric clip `animators`. Rust/Tauri/CLI/Code Mode regressions were AUTHORED_NOT_RUN; native marker interoperability, playback visuals, build and measured efficiency remain UNVERIFIED.


**Native Blockbench Sound/Particle event markers (2026-11-16; SOURCE_ONLY):** Examined pinned official Blockbench 5.2.1 `EffectAnimator` (timeline_animators.js), `KeyframeDataPoint` (keyframe.js) and Bedrock animation import/export (bedrock_animation.js). The Rust editor now supports explicit `add_animation_effect_event`, `update_animation_effect_event`, and `remove_animation_effect_event` on the saved `animators.effects` track, restricted to sound and particle metadata. An event has a bounded saved UUID, timestamp, and 1–8 explicitly named `{effect, locator?, bind_to_actor?}` data points; `bind_to_actor` applies to particle only. Audio files, imported file paths, Molang pre-effect scripts, timeline scripts, arbitrary effect metadata, actual particle emitters and controller transitions are **not** interpreted or executed. Strict source admission preserves unknown imported data and refuses unsafe/unsupported mutations. The existing Clip duplicate, length, loop and retime paths can preserve admitted events with independently regenerated IDs; the single Rust .bbmodel/Undo authority remains. Code Mode can read up to 16 events/page with one `inspectBatch` `animation_effect_events` request and mutate through the existing trusted-host authorization. **Tauri intentionally marks animations with effects as unsupported for full pose/playback preview**, since its native viewer cannot fire sound/particles; no fake success and no UI redesign. Source regressions cover mixed Bone+Sound+Particle save/reimport, copy/edit/undo/redo, strict names and key UUIDs, same-channel time conflicts, imported scripts/files, bounded Code Mode inspection and host approval. TEST_AUTHORED_NOT_RUN, native Blockbench effect triggering and performance UNVERIFIED.


**One-operation numeric Bone Animation Clip duplication (2026-11-16; SOURCE_ONLY):** Compared pinned official Blockbench 5.2.1 `js/animations/animation.js` duplicate action, which copies the selected clip/animators and inserts a distinct animation after its source. New canonical Rust `duplicate_animation_clip` takes `source_uuid`, `new_uuid` and `new_name` and copies a strictly recognized numeric Bone clip in one EditOperation/Undo step. It retains Bone track targets, all Rotation/Position/Scale values and times, `once/loop/hold`, `linear/step/catmullrom` and admitted full Bezier handles. The new clip/keyframe UUIDs are distinct and derived deterministically from the supplied clip ID; names, IDs, metadata references and serialized 16 MiB bounds are checked before committing the draft. The source clip, Geometry, UV, Textures, rig and unrelated animations remain untouched. Unsupported imported clips with effects, Molang, unknown metadata or malformed interpolation refuse instead of being flattened or partially copied. Generic Rust Tauri/CLI and typed Code Mode share the same authority, with no new engine, GUI, hosted execution or per-keyframe code-model calls. Authored Rust regression covers source/variant identity, saved curves, deterministic output, standalone variant edits, .bbmodel reimport, Undo/Redo, name/ID/opaque/collision atomic refusal; Tauri projection and Code Mode host-approval regressions also authored, NOT_EXECUTED. Native Blockbench editability, clip playback and relative speed UNVERIFIED.


**Strict per-axis Bezier Animation handles (2026-11-16; SOURCE_ONLY):** Compared official pinned Blockbench v5.2.1 `js/animations/keyframe.js` `getBezierLerp`, saved `getSaveCopy` and its `bezier_linked/left_time/left_value/right_time/right_value` properties, plus `js/animations/timeline_animators.js` mode precedence. New canonical Rust `set_bone_transform_keyframe_bezier` writes complete, bounded X/Y/Z time/value handles and `bezier_linked` on an exact Position/Rotation/Scale Bone keyframe. The strict numeric clip reader admits complete, internally consistent saved Bezier metadata alongside `linear/step/catmullrom`; unknown/Molang/incomplete/crossed-time handles refuse editing or preview rather than receiving invented controls. Explicit switching back to another mode strips only that key's no-longer-relevant Bezier metadata (matching Blockbench save behavior). Timeline scaling also scales each horizontal handle offset while preserving vertical values and texture/rig assets. The existing Tauri snapshot exposes complete saved handles and the prepared read-only pose computes bounded per-axis cubic time inversion with 30 bisection steps. This is intentionally a higher-precision mathematical evaluation than Blockbench's 200-sample curve lookup; runtime and visual parity with native Blockbench is **UNVERIFIED**. Unknown imported formats are preserved. Typed Code Mode composes AddKeyframe + SetBezier in one host-approved Rust edit plan; no second engine, UI changes or global egress. Rust/Tauri/Node/Code Mode source regressions cover save/reimport, time retime, Undo/Redo, selected channels, mixed interpolation, malformed/linked/ambiguous time controls and atomic rollback; all **TEST_AUTHORED_NOT_RUN**. Actual Blockbench native effects/controllers, sampled frames and performance remain unverified.


**Numeric Catmull-Rom Bone authoring and read-only pose evaluation (2026-11-16; SOURCE_ONLY):** Compared pinned official Blockbench v5.2.1 `js/animations/keyframe.js` `getCatmullromLerp` and `js/animations/timeline_animators.js` `BoneAnimator.interpolate`. The Rust-owned strict numeric single-data-point Bone subset now admits saved `catmullrom` alongside `linear/step` for Position, Rotation and Scale, without adding a new format codec or editing imported effects/Molang/Bezier handles. The existing `set_bone_transform_keyframe_interpolation` changes one outgoing curve mode; clip length, loop, update, retiming and Undo preserve stored key values and interpolation. Tauri projects the saved mode; the prepared TypeScript view uses Three.js SplineCurve-equivalent *uniform value-indexed* Catmull-Rom, adjacent key values, Step priority and pinned Loop neighbour selection at track endpoints, without per-frame grouping or re-sorting. Loop seam wrapping, user reference motion, actual Blockbench rendered playback and measured speed remain separately UNVERIFIED. `inspect_transform_track`/`inspect_rotation_track` expose saved `interpolation` with stable legacy read scope IDs and explicit `interpolation_modes`; generic Rust Tauri/CLI and typed Code Mode share the single authoring engine. Source-only regressions cover three channels, mixed curves/Step, exact key boundaries, loop neighbours, source-preserving .bbmodel export/reimport, Undo/Redo, retime, Tauri projection, bad imported metadata and trusted Code Mode writes; all TEST_AUTHORED_NOT_RUN. Bezier/time handles and other advanced animation payloads remain unsupported and preserved opaquely.


**Numeric Step Bone keyframe authoring and preview (2026-11-16; SOURCE_ONLY):** Compared pinned official Blockbench v5.2.1 `js/animations/keyframe.js` interpolation variants and `js/animations/timeline_animators.js` `interpolate`: a previous `step` keyframe holds its value until the next key's exact time, when the next value takes effect. Rust now explicitly admits `linear` and `step` for bounded numeric Position/Rotation/Scale Bone tracks, while preserving strict opaque/Molang/Bezier/Catmull-Rom refusal. New revision-guarded `set_bone_transform_keyframe_interpolation` switches one key's saved outgoing segment mode; the existing add/update/remove, clip-loop, duration and timeline-scale operations retain it without altering original values, UUIDs, textures or rig. Tauri's read-only snapshot projects the saved mode and the prepared Svelte/Three.js Bone pose sampler evaluates mixed linear/step tracks without per-frame re-sorting. Code Mode's bounded transform/rotation inspections include saved per-key `interpolation` and explicit `interpolation_modes`, retaining existing `scope` IDs for compatibility; its typed edit plan uses the same Rust authority. Source regressions cover import/export and undo/redo, mode changes, retiming, mixed channels and key-time snap, opaque/refusal, Tauri invalidation and host-approved Code Mode plan. All TEST_AUTHORED_NOT_RUN; native Blockbench playback, continuous pose quality and speed remain UNVERIFIED. This is *not* general Bezier easing/animation controller parity; UI design remains last.


**Explicit multi-Cube material palette remapping (2026-11-16; SOURCE_ONLY):** New canonical Rust `recolor_cube_faces_palette_guarded` performs up to 32 simultaneous *exact source RGB → target RGB* replacements on explicitly selected faces of up to 16 Cubes sharing one owned atlas, with one strict RGBA8 PNG decode/encode and one Undo/revision. This does not generate an arbitrary material palette or pattern from a material label: the caller must supply observed/approved source swatches and intended palette colors. Existing painted base/shadow/highlight/accent clusters, alpha (including translucency), unseen hidden RGB, mapped UV/Geometry/rig, original Animation, and unrelated atlas pixels remain untouched. Replacements are simultaneous, not transitive, and a true no-op does not re-encode. The original `uv_sharing` inspector refuses shared, unresolved, implicit, disabled or unsupported UV targets; signed/manual, derived Box, explicit Texture UUID/index and bounded face selectors are supported. Other imported/foreign/layered texture formats fail closed. Generic Tauri/CLI and Code Mode share this one Rust authority, with no new texture engine or UI. Rust regression source covers multiswatch shading preservation, alpha/hidden RGB, selected/unselected faces, non-cascading swaps, multi-Cube allocation, Undo/Redo, .bbmodel reimport, invalid/opaque/alias refusals; JS regression verifies one approved Code Mode plan. Tests **AUTHORED_NOT_RUN**; source palettes do not prove reference fidelity, visual material recognition, Blockbench native compatibility or measured efficiency.


**Guarded Cube face-local detail painting (2026-11-16; SOURCE_ONLY):** Added canonical Rust `paint_cube_face_regions_guarded` to author 1–64 ordered, half-open pixel rectangles in **displayed Cube face-local coordinates** (one or several faces per operation), rather than asking an AI to calculate absolute atlas UV rectangles and issue repeated PNG mutations. Source-backed mapping uses pinned Blockbench 5.2.1 `Cube.updateUV` corner permutation for 0/90/180/270 rotations, signed/reversed UVs, and a derived Box net on a transient Cube. The existing shared-atlas UV inspector refuses overlaps, implicit/unresolved links and unsupported Auto/per-texture UV; valid patches use the existing bounded RGBA8 `paint::rectangles` once and one Rust revision/Undo. The operation changes PNG bytes only, never authored Geometry, saved face UV, rig or Animation. Repeated regions on one face apply in caller order, allowing explicit base/shadow/highlight/accent zones without a new procedural material engine. Generic Tauri/CLI and typed Code Mode use the same operation. Source regression checks mapping under all quarter turns/reversed UVs, ordered Box-face shading, manual rotated-face pixels, alias refusal, unsafe metadata, no-op, Undo/Redo, .bbmodel reopen and single approved Code Mode call; **TEST_AUTHORED_NOT_RUN**, native style/visual quality, relative throughput and material inference remain **UNVERIFIED**. Face-local instructions and UV-pixel counts are not physical brush stroke/visual acceptance.


**Symmetric Bone rig Geometry + UV control (2026-11-16; SOURCE_ONLY):** Compared pinned official Blockbench v5.2.1 `js/outliner/types/cube.js` `Cube.flip` and `js/modeling/mirror_modeling.ts` plane/rotation conventions. The Rust-owned `reflect_bone_subtree` now reflects a nested Bone/Cube cohort on an explicit X, Y or Z plane using one revision/Undo operation; it mirrors bounds, Cube/Bone pivots and the two off-axis rotation components, preserving node IDs, hierarchy and source assets. An explicit `uv_policy=preserve` keeps all saved face/bitmap references unchanged; `uv_policy=mirror` mirrors supported manual six-face UV (including 90/270-degree face rotations and opposite face payload swapping), or toggles native Box UV mirror on the supported X axis. Unsupported Box UV Y/Z, Auto UV, advanced atlas rules, ambiguous side-relative culling, bound Animation tracks and non-neutral unreflected ancestors fail closed. Compose `duplicate_bone_subtree` then `reflect_bone_subtree` inside one Code Mode/Rust EditPlan to build a mirrored counterpart without editing the original rig. Tauri generic operation, headless CLI and typed Code Mode share the canonical Rust engine; no GUI redesign or second format owner. Regression source covers nested painted/animated original retention, reflected pivots/rotations, manual rotated UV, Box UV X, .bbmodel preservation, Undo/Redo and atomic refusal. Tests AUTHORED_NOT_RUN; actual Blockbench visual/animation performance UNVERIFIED. This is not full live Mirror Modeling/UV feature parity.


**Single-operation nested Bone rig duplication (2026-11-16; SOURCE_ONLY):** Compared pinned official Blockbench v5.2.1 `js/outliner/types/group.js` (Group.duplicate recurses into children). Rust now supports `duplicate_bone_subtree`: one new root UUID deterministically derives child UUIDs; an explicit suffix gives all copied Bones unique Bedrock-exportable names; the entire nested Cube/Bone Outliner is inserted beside its source in one revision/Undo operation. Cubes, pivots, UV and source Texture bytes are preserved. Animation tracks remain targeted at the original Bones, not silently duplicated. Copied UV faces intentionally share atlas pixels; use `isolate_cube_box_uv` before independent repaint. Invalid ID/name, opaque references into the copied cohort, or excessive bbmodel size refuse atomically. Generic Tauri/CLI and typed Code Mode share the Rust owner. Rust/JS regression source covers textured/animated nested rig copy, deterministic identities, same-transaction translation, Undo/Redo, .bbmodel/Bedrock geometry export, name collisions and full rollback; AUTHORED_NOT_RUN, native fidelity/performance UNVERIFIED.


**Animation preview snapshot preparation (2026-11-16; SOURCE_ONLY):** The Svelte/Three.js read-only Bone preview now validates and sorts bounded numeric-linear transform keyframes once when its Rust/Tauri animation snapshot changes, rather than on every playback tick. Time sampling reuses prepared tracks and binary-searches sorted per-channel keys. The existing direct pose/timeline API, canonical Rust Animation/Undo, `.bbmodel`, loop modes and UI layout are unchanged; unknown imported clips remain preview-unsupported. Source parity, refreshed-snapshot and invalid-clip regressions AUTHORED_NOT_RUN; FPS, native Blockbench playback and asset fidelity UNVERIFIED.

**Paged Texture coverage decode reuse (2026-11-16; SOURCE_ONLY):** The existing eight-Cube `inspect_model_texture_coverage` read now shares a temporary decoded RGBA8 atlas across its Cube inspections instead of decoding the same immutable PNG independently for each Cube. Standalone `inspect_cube_uv_alpha` still uses a fresh local cache; no persistent model/texture cache, new authority, CLI schema, UI or `.bbmodel` change. Source regression checks identical six-face reports, one cached atlas across duplicated Cubes, pagination, corrupt-PNG refusal and untouched document. Complexity improves for many Cubes sharing one texture, but tests remain AUTHORED_NOT_RUN and measured time/native fidelity UNVERIFIED.

**Animation source-mode preview alignment (2026-11-16; SOURCE_ONLY):** After the Rust once/loop/hold authoring change, the existing read-only Tauri AnimationView now projects an explicit `loopMode`, admits supported nonzero-duration numeric-linear Bone clips for all three saved modes, and refuses unknown imported values rather than interpreting them as once. The pre-existing editor playhead helper now handles once reset, loop wrap and hold-at-end in view-only time; RustEditorPage changes only its animation playhead call (no layout, CSS, or UI product redesign). Native Blockbench playback semantics, end-to-end animation rendering and runtime performance remain UNVERIFIED. Source regressions AUTHORED_NOT_RUN cover the three modes, invalid clip metadata, Molang refusal, final pose holding and repeated wrapping; the underlying Rust document/Undo and .bbmodel serializer are unchanged.

**Animation loop/hold source authoring (2026-11-16; SOURCE_ONLY):** Compared official Blockbench v5.2.1 `js/animations/animation.js` `Animation.loop` wire variants `once`, `loop`, `hold`. The canonical Rust `set_animation_loop_mode` now writes an explicit supported loop mode on a strictly admitted numeric-linear Bone clip with positive duration; existing add/update/remove transform keys, `set_animation_length`, and `scale_animation_timeline` retain that mode without rewriting transform values. A shared strict `saved_animation_loop` rejects malformed imported loop values and ambiguous/opaque clip metadata; zero-duration looping/hold authoring is refused, including duration shortening. Code Mode can inspect `loop_mode` and `clip_length` on recognized transform tracks. Generic Tauri/CLI EditOperation and typed Code Mode expose the same Rust authority. **Tauri's limited pose preview deliberately remains unsupported for loop/hold** pending native playback parity; this change is editable `.bbmodel` source semantics, not a claimed visual/rendered animation PASS. Regression for each mode, three-channel retime/edit, Undo/Redo, saved wire, malformed/duplicate/opaque refusal AUTHORED_NOT_RUN. No new UI/Code Mode execution host.

**Bounded UV atlas occupancy correction (2026-11-16; SOURCE_ONLY):** IsolateCubeBoxUv now reserves Box/Manual face rectangles using 2D corner deltas and one bounded per-atlas prefix scan, rather than writing every pixel once for each Cube face reference. Candidate placement remains deterministic, pixel-accurate and checks existing RGBA8 bytes (including hidden RGB at alpha zero). Source regression adds many duplicates referencing the same atlas to detect false free pixels or accidental data changes. This lowers the source algorithmic work for overlapping Cube collections; no elapsed-time benchmark was run. Tests AUTHORED_NOT_RUN and actual Blockbench texture parity UNVERIFIED.

**Independent painted Cube Box UV isolation (2026-11-16; SOURCE_ONLY):** The canonical Rust `isolate_cube_box_uv` operation relocates only a selected Cube's explicitly linked Box UV faces to a first-fit blank and unused atlas island. It copies existing RGBA8 pixels from the source face rectangles to destination on the same owned PNG, preserving old pixels for other Cubes, without resizing the atlas or changing rig/Animation. A bounded 256² occupancy map and summed-area rectangle search refuse overlap with declared faces or existing image art. Unsupported per-texture/multi-file/float Box UV, implicit/default texture references, mixed/non-owned assets and full atlases fail atomically. Generic Tauri/CLI and typed Code Mode operations use the same Rust document and PNG owner. Source regressions for duplicate/copy/independent guarded repaint, Undo/Redo, .bbmodel reimport and refusal are AUTHORED_NOT_RUN; native Blockbench appearance and efficiency UNVERIFIED.

**Paged model Texture/UV alpha review (2026-11-16; SOURCE_ONLY):** The Rust `inspect_model_texture_coverage` projection exposes up to eight Cubes per read with their six saved reference kinds and exact supported atlas-alpha pixel counts, reusing the existing strict six-face PNG inspector. It distinguishes declared absent (`null`), explicit unassigned (`false`), unresolved implicit references, unsupported UV/bitmap metadata, fully transparent, partially transparent, translucent and nontransparent source pixels. None are native visual coverage verdicts; `face_coverage_verdict` remains UNVERIFIED. CLI `inspect-batch` adds `model_texture_coverage` with offset/limit, typed Code Mode allows the same selector, no new host/GUI or model state. This batches independent per-Cube read calls while bounding response size and still honors imported-format refusal. Source regression for blank/painted/duplicated Cube pagination, intentional absent faces, false/unset/invalid UV, native-ready .bbmodel reimport and JS query validation is AUTHORED_NOT_RUN. A bounded batch is not a measured runtime performance claim.

**Opt-in guarded Cube-face Paint (2026-11-16; SOURCE_ONLY):** `paint_cube_uv_faces_guarded` checks only requested Cube faces against all other explicit atlas consumers, including unselected faces of the same Cube. Positive-area UV overlaps refuse with `PAINT_CUBE_UV_GUARD_SHARED`; unsupported or implicit texture/UV references refuse with `PAINT_CUBE_UV_GUARD_UNRESOLVED`. Valid requests call the existing PaintCubeUvFaces bitmap engine and Undo, without a second PNG authority. The older `paint_cube_uv_faces` remains available for intentionally shared UV islands. This is stored-source subset safety, NOT native material/exclusive pixel proof. Tauri/CLI/Code Mode types share the operation; source regression authored NOT_EXECUTED.

**Cross-Cube UV atlas sharing inspection (2026-11-16; SOURCE_ONLY):** `inspect_cube_uv_sharing` reads one Cube/Texture UUID pair against saved/derived Box or manual face rectangles from all Cubes, matching only explicitly linked Texture UUID/index values. It records positive-area half-open overlaps, both within and across Cubes; output is bounded to 32 details plus the full pair count. Unresolved explicit UV mappings and faces lacking a texture reference are counted separately rather than treated as proof of isolated painting; implicit default material resolution and real rendered face coverage remain UNVERIFIED. A per-texture/multi-file ruleset refuses the read instead of inventing atlas coordinates. The existing Rust CLI `inspect-batch` selector `cube_uv_sharing`, typed Code Mode batch schema and host guest's existing generic `inspectBatch` RPC share the source inspection without any new code execution host or UI. Regression source covers two Cube copies using the same atlas, non-overlapping half-open face edges, unsafe UVs, unknown references and batch selector validation. `TEST_AUTHORED_NOT_RUN`, not native Blockbench or speed proof.

**Box UV regeneration safety closure (2026-11-16; SOURCE_ONLY):** `AddCube`, single-edge `SetCubeBounds`, `ScaleCube`, and `SetBoxUvOffset` now enforce the same project/element Box UV preflight as `ReframeCube` and Mirror before rewriting integer atlas face rectangles. Unsupported per-texture/multi-file rules and float-size metadata are refused atomically, rather than implicitly remapped. A shared check emits generic `CUBE_BOX_UV_*` errors; existing Reframe and Mirror refusal error codes remain preserved by explicit mapping. Zero-delta/no-op commands retain their existing behavior, and explicit `false` flags remain valid. Authored positive/negative Rust regressions cover source metadata preservation, stale or unsupported imports, rollback after a valid staged edit, .bbmodel round trip and Undo/Redo. No public Tauri/CLI/Code Mode schema changed. Tests AUTHORED_NOT_RUN; real Blockbench export/visual fidelity remain UNVERIFIED.

**Linear-time subtree Geometry translation correction (2026-11-16; SOURCE_ONLY):** `translate_cube_in_place` is now the single UV-aware Cube movement primitive called by standalone `translate_cube` and `translate_bone_subtree`. A subtree edit scans the Cube and Bone collections once each using precollected descendant identities rather than performing a separate collection search for each Cube/Bone; the same Auto UV and per-texture refusal rules remain enforced. A new negative regression stages a valid Inflate change before an invalid UV subtree move, asserting the entire Rust draft is discarded. This is source complexity improvement, **not measured runtime performance**. Tests AUTHORED_NOT_RUN; no native Blockbench/visual proof.

**One-call Bone subtree translation (2026-11-16; SOURCE_ONLY):** `translate_bone_subtree` moves a selected Bone, all descendant Bone origins and their Cubes' from/to/origin positions with one canonical Rust EditOperation. Source-order traversal reuses the existing `TranslateCube` UV-aware semantics, preserves the Outliner, exact Texture bytes and Animation tracks, and does not synthesize new keyframes or second world transform state. Invalid deltas, absent Bone, unsafe per-texture Auto UV and out-of-bounds resulting coordinates fail the whole atomic Rust session before commit; unrelated sibling/root cohorts remain unchanged. This provides a semantic group translation without per-Cube AI tool calls. Tauri generic apply/CLI/Code Mode typed contracts share the operation. The receipt targets the requested Bone UUID; affected child identities can be read from the existing hierarchy. Source regression AUTHORED_NOT_RUN; full native rig/pose and Blockbench correctness UNVERIFIED.

**Semantic Cube-face atlas painting (2026-11-16; SOURCE_ONLY):** `paint_cube_uv_faces` accepts 1–6 unique Cube face names, one target Texture UUID, and explicit ordered RGBA8 paint/erase colors. Rust derives a supported Box UV net on a transient Cube copy or reads strict manual face rectangles, verifies each face explicitly points at the selected texture, translates integral half-open UV pixel regions into a single `paint::rectangles` PNG transaction, and leaves geometry/UV/other textures/Animation unchanged. Non-Bedrock/multi-file rules, Auto UV, unsafe Box float mode, absent/null/false/mismatched face textures, nonintegral/out-of-bounds atlas coordinates and opaque/unsupported PNG assets fail closed. Atlas pixels are shared: painting a Cube face's UV rectangle can also affect any other face/Cube referencing those same pixels; this method does not promise exclusive face coloring or proven visible-face quality. Tauri/CLI and typed Code Mode share the canonical Rust EditOperation; tests AUTHORED_NOT_RUN. Native Blockbench rendering/export and time-cost benefits UNVERIFIED.

**Single-operation Animation retiming (2026-11-16; SOURCE_ONLY):** `scale_animation_timeline` retimes a whole admitted once-only numeric-linear Bone clip's duration and Position/Rotation/Scale keyframe times in one canonical Rust EditOperation. Authoring accepts finite scale factors 0.1–10, rejects out-of-range duration, ambiguous clip UUIDs, imported opaque/Molang/interpolated metadata and post-scale time collisions. UUIDs, Bone targets, data_points, interpolation, Geometry and Texture are preserved, as are normal Undo/Redo and editable `.bbmodel` serialization. Existing `set_animation_length` remains duration-only and never trims keyframes. Generic Tauri/CLI/Code Mode typed plans support the operation; UI/UX and Code Mode host unchanged. Source tests AUTHORED_NOT_RUN, real Blockbench playback/format acceptance and efficiency UNVERIFIED.

**Texture rectangle batching (2026-11-16; SOURCE_ONLY):** `paint_texture_rectangles` accepts 1–64 ordered, bounded filled/erased atlas rectangles and applies them on a single Rust-decoded 1–256² RGBA8 bitmap before one re-encode. It replaces repeated decode/re-encode per rectangle when the AI authors several color regions on one texture, with only one `EditorSession` revision/Undo. Existing `paint_texture_rectangle` now calls this same codec path for compatibility. The whole plan is validated before touching PNG bytes; final no-change payloads are refused as `EDIT_NO_OP`. Imported/external/layered unsupported texture data remain immutable. The Tauri generic apply, headless CLI and Code Mode typed EditOperation consumers all share the same Rust owner; no new UI. Source positive/negative round-trip, overlap order, erase/no-op, atomic rejection tests AUTHORED_NOT_RUN; native Blockbench texture quality and speedups UNVERIFIED.

**Semantic whole-shape reframe (2026-11-16; SOURCE_ONLY):** `reframe_cube` allows one exact bounded XYZ bounds change under explicit `uv_policy: box_repack | manual_preserve` through the canonical Rust EditOperation used by Tauri, CLI and typed Code Mode, rather than simulating many one-edge Blockbench resizes. Box UV mode regenerates the full cached net with unchanged atlas offset, pivot, visibility and texture links (also repairing stale Box UV cache); manual Face UV mode preserves recorded rectangles. Auto UV, unsupported per-texture rules, float-sized Box UV modes and mismatched policy refuse atomically. Geometry `inspect_cube_surfaces` additionally returns declared Stretch and supported local projected size for source-only review, never visual quality. Source regression AUTHORED_NOT_RUN and actual Blockbench export remains UNVERIFIED. The older `set_cube_bounds` retains its Blockbench-style single-edge semantics.

**Source-backed Cube stretch and Box UV mirroring (2026-11-15; SOURCE_ONLY):** The canonical Rust transaction adds `set_cube_stretch` (bounded positive XYZ factors) and `set_cube_mirror_uv` (one Box UV net toggle) without forcing a manual six-face rewrite, new model engine or UI. Both use shared Rust/Tauri/CLI/Code Mode edit plans, retain bounds, pivots, saved textures/animations and Undo/Redo, and export as editable `.bbmodel` fields. New authoring refuses degenerate/unsupported factors, non-Box UV mirrors, per-texture rules and float-size Box UV ambiguity. The separate `.geo.json` compiler still refuses non-unit Stretch; do not mistake `.bbmodel` support for geometry JSON parity. Authored regressions NOT_EXECUTED. Upstream data-format references: JannisX11/blockbench@e2ede0809ee6bc91f374ac7e00d34cffbdf86a14 `js/outliner/types/cube.js` (Cube save fields) and `js/formats/bbmodel.js` (format 5.0). Source was independently authored; upstream license GPL-3.0 terms remain relevant to any later code reuse.

**Box UV region alpha evidence (2026-11-15; SOURCE_ONLY):** New Bedrock projects default to Box UV, so `inspect_cube_uv_alpha` now recomputes each Box UV face rectangle on a cloned Cube using the existing Rust Box UV layout rule, without trusting stale imported face UV or mutating the model. The six-face inspector can return exact saved-atlas alpha histograms for supported explicit embedded RGBA8 texture references and integer UV cells. The report marks `uv_source=derived_box`, includes saved and sampled UV coordinates and never claims rendered face coverage. Unsupported multi-file/per-texture rules, Box UV float-size flags or invalid mirror settings are refused per face. Read-only CLI, batch and Code Mode consumers share the same output; original sources and Undo are untouched. Regression source AUTHORED_NOT_RUN; real Blockbench Box UV/visual parity remains UNVERIFIED.

**Integrated asset authoring fixture (2026-11-15; TEST_AUTHORED_NOT_RUN):** A single session now has source regression coverage for New/Geometry/Rig/Texture/Animation/.bbmodel reopen, including three-channel inspection, atomic refusal and Undo/Redo. It is a future falsifiable PC-local/native acceptance input, not proof of Blockbench compatibility or a passed Rust build.

**Bone transform channel inspection (2026-11-15; SOURCE_ONLY):** `inspect_transform_track` now projects separately paged numeric-linear Position/Rotation/Scale values using the same strict Rust editable-clip admission as authoring. CLI `inspect --track-channel position|rotation|scale` and Code Mode `inspectAnimationTransformTrack` / batch selector return bounded values, never opaque Molang/Bezier data; old rotation-only inspection remains compatible. Source regressions AUTHORED_NOT_RUN; no native animation playback proof.

**RGBA8 exact region fill (2026-11-15; SOURCE_ONLY):** `paint_texture_fill` paints/erases a four-connected region of exact RGBA8 matches in the existing 1–256² encoded PNG, in one Rust-owned Undo step and without reading foreign/external/layered assets. CLI and Code Mode use the same EditOperation; no UI redesign or second raster engine is introduced. Regression source AUTHORED_NOT_RUN; native textured .bbmodel export remains UNVERIFIED.

**Rig pivot and Cube surface authoring (2026-11-15; SOURCE_ONLY):** `set_bone_origin`, `set_cube_origin` and `set_cube_inflate` use one Rust EditOperation for bounded pivots and non-degenerate surface inflation. Cube bounds/UV, child transforms and imported opaque animation data are retained; revisions, Undo/Redo and editable `.bbmodel` output remain Rust-owned. CLI/Tauri accept the same plans; Code Mode has the typed operations. Regression source AUTHORED_NOT_RUN; actual Blockbench export UNVERIFIED. UI parity deferred behind Geometry/Texturing/Animation.

**Rust Bone transform channels (2026-11-15; SOURCE_ONLY):**
AddBoneTransformKeyframe, UpdateBoneTransformKeyframe and
RemoveBoneTransformKeyframe allow numeric linear Rotation, Position
and Scale under the canonical EditOperation/EditorSession history.
The editable_transform_clip gate checks known Bone/frame metadata,
unique keyframe UUIDs, noncolliding per-channel times, and bounded
Scale 0–100. Unknown imported animation data remains unchanged and
is not promoted to a writable native preview. SetAnimationLength
checks all admitted channels; existing rotation-only operations remain.
Source tests are authored but NOT_EXECUTED; native Blockbench parity
UNVERIFIED.
**Animation duration editing (2026-11-15; SOURCE_ONLY):**
The shared Rust `SetAnimationLength` operation adjusts a selected
UUID-addressed supported clip duration as one atomic, Undoable
EditOperation. It validates all recognized Bone rotation keyframes,
preserves their timestamps/UUIDs/Molang-free numeric data and
refuses to shorten before any retained frame. Imported unknown
animation fields, unsupported tracks, duplicate clip identity and
ambiguous keyframe identifiers are conservatively refused rather
than truncated or normalized. The native Tauri/Svelte and typed
Code Mode consumers share this Rust-owned command. Source
regression coverage AUTHORED_NOT_RUN; native animation and
Blockbench round-trip parity UNVERIFIED.

**Rust-owned Cube/Bone name edits (2026-11-15; SOURCE_ONLY):** `RenameNode`
adds a bounded user-visible name transaction for a selected Cube or
Bone UUID. The operation preserves existing model geometry, texture
links and Outliner references; it updates only recognized Bone UUID
animator display names that still match the previous Bone name.
Invalid names, Bone-name collisions and contradictory opaque animator
names reject the entire batch. It is reversible with the normal
EditorSession Undo/Redo and is exposed through the native Svelte
Inspector and typed Code Mode EditOperation without another model
owner. Tests AUTHORED_NOT_RUN; native .bbmodel acceptance UNVERIFIED.

**Read-only saved Cube Face UV alpha (2026-11-15; SOURCE_ONLY):** Rust `inspect_cube_uv_alpha` reuses canonical `inspect_cube_surfaces` and the existing Paint RGBA8 decoder, caching up to six decoded images transiently per six-face read. Integer manual UV rectangles with explicit Texture IDs are summarized as transparent/translucent/opaque saved atlas pixels; unknown/missing links, Box UV, Auto UV, per-texture rules and unsafe UV coordinates are refused per face. The CLI and typed Code Mode client expose the same SHA-bounded read; no raw bitmap, extra engine or real rendered-face coverage claim. Source regressions AUTHORED_NOT_RUN; native acceptance remains `UNVERIFIED`.

**Code Mode RGBA8 alpha inspection (2026-11-15; SOURCE_ONLY):** The existing Paint decoder now owns read-only `alpha_diagnostics` for an explicitly supported embedded RGBA8 PNG (≤256² pixels); canonical `inspect_paint_alpha` checks the selected Texture UUID, unsupported UV rules and metadata. It reports transparent/translucent/opaque pixels and bounded 8×8 sample/nonzero-alpha counts, with `face_coverage_verdict` and `visual_verdict` kept `UNVERIFIED`. CLI `inspect --alpha-uuid` and typed Code Mode API share the existing SHA-pinned read boundary; no full bitmap, new decoder or extra model authority. Rust/Node regressions AUTHORED_NOT_RUN; native texture fidelity and viewport coverage are not proved.

**Code Mode read-only Cube surfaces (2026-11-15; SOURCE_ONLY):** Canonical `inspect_cube_surfaces` reports a validated Cube's saved geometry and all six UV/texture-reference records (index/UUID/default false/null/unset), including declared texture identity/source type without decoding PNG or exposing opaque imported data. The CLI `inspect --surface-uuid` and SHA-pinned JS SDK reuse this Rust authority; actual effective Bedrock material, hidden-surface paint coverage and Blockbench visual parity remain `UNVERIFIED`. Authored Rust/Node regressions are NOT_EXECUTED.

**Bedrock Geometry .geo.json export (2026-11-15; SOURCE_ONLY):** The shared Rust `export_bedrock_geometry` creates a separate Minecraft Bedrock Entity `minecraft:geometry` JSON from the existing validated authoring document; it does not change editable `.bbmodel`, PNG assets, animations, revision or Undo. It maps supported Cube/Bone hierarchy, names, origins, pivots, rotations and Box/Face UVs using pinned Blockbench 5.2.1 transform rules (format versions 1.12.0 / 1.16.0 binding / 1.21.0 face rotation). Unsupported Cube stretch, opaque geometry fields, unrepresentable face flags, multi-file UV rules and ambiguous bone names refuse rather than silently produce lossy output. The headless CLI adds `export-geometry --input model.bbmodel --output model.geo.json --expected-sha256 <source-model-sha256>`; Tauri adds a separate native Export Bedrock Geometry picker/command, both using the exclusive new-file writer. Opened projects use source SHA and sibling-output guards. This initial geometry-only output does not emit textures/animations/client-entity files or calculate visible bounds and is not proof of Minecraft import or Blockbench parity. Rust/CLI/storage regression sources AUTHORED_NOT_RUN; Cargo, Windows/WebView2 and native validation NOT_EXECUTED.


**Read-only scoped Bedrock attachable UV preview (2026-11-15; SOURCE_ONLY):** The Tauri projection now recognizes only the reviewed `multi_file_ruleset: "bedrock_attachable"` subset with consistent metadata and unambiguous positive Cube/texture `scope` values. It projects each admitted embedded default-material PNG's `uv_width`/`uv_height` separately from decoded image dimensions, with project-grid fallback for omitted UV fields and a matching PNG/grid aspect ratio (flipbook projection stays unsupported). Three.js selects the projected Cube-scoped texture and UV grid without rewriting Cube faces, texture bytes, or the Rust document. Unknown rulesets, ambiguous scopes, invalid UV grids, external/layered/unsupported PNGs, and missing scoped associations keep the colored fallback. The canonical `assign_cube_texture` transaction now refuses all per-texture rulesets instead of implying a global assignment that Blockbench would override by scope. Paint import/edit/export and Auto UV rules remain strictly gated. Rust/Tauri/Node regressions AUTHORED_NOT_RUN; Cargo, Windows/WebView2, and native Blockbench 1:1 UNVERIFIED.

**Rust-owned manual Cube-face UV rotation (2026-11-15; SOURCE_ONLY):** The canonical `set_face_uv_rotation` EditOperation adds 0°/90°/180°/270° orientation changes for Face UV Cubes through the existing CLI/Tauri revision-checked transaction and Undo/Redo. It stores nondefault Blockbench `CubeFace.rotation` metadata, removes the default 0° field, and disables Auto UV only on a real manual change. Existing coordinates, texture references, imported opaque fields, other faces, and PNG bytes are retained; Box UV and unsupported imported rotations refuse. The same source-backed rotation admission drives the Svelte Inspector and read-only Three.js face projection, without a new document engine or IPC. Rust/Node regressions AUTHORED_NOT_RUN; native Blockbench/.bbmodel and WebView2 parity UNVERIFIED.

**Read-only Paint PNG export (2026-11-15; SOURCE_ONLY):** `export_paint_png` selects a known texture UUID, checks the project UV rules and fully validates a simple embedded RGBA8 PNG (current 1–256 atlas, ≤2 MiB). It returns the original compressed PNG bytes without re-encoding, changing the authoring document or creating Undo history. Tauri's Paint Export PNG picker and the headless CLI `export-png --input model.bbmodel --output atlas.png --texture-uuid <uuid> --expected-sha256 <source-model-sha256>` call this same Rust function. Exports use a shared exclusive/no-overwrite file writer; opened model sources require same-directory output and source SHA consistency. The UI projection is metadata-only, while the explicit export validates the complete PNG. Opaque/layered/external/malformed/per-texture UV assets refuse; real Windows/Blockbench export and format parity NOT_EXECUTED/UNVERIFIED. Regression source AUTHORED_NOT_RUN.

**Shared Paint admission (2026-11-15; SOURCE_ONLY):** Generated RGBA8 creation and embedded PNG import now use the same Rust gate for supported 1–256-pixel atlas dimensions, at most 16 texture assets and absence of per-texture UV rules. Generated UUIDs also refuse collisions with model and animation IDs. Tauri derives Paint-addition eligibility from this gate; source regressions cover count overflow, import refusal, history, round-trip and read-only projection. TEST_AUTHORED_NOT_RUN; no Cargo, WebView2 or native Blockbench proof.

**Empty atlas resolution before import (2026-11-15; SOURCE_ONLY):** The shared Rust `can_set_empty_atlas_resolution` helper and `set_empty_atlas_resolution` EditOperation restrict atlas dimension changes to unambiguous new/empty Bedrock projects, with bounds of 1–256 per side. Tauri projects eligibility and Svelte exposes simple numeric controls; no second settings owner or extra IPC command is introduced. Source-authored regression includes a 64×64 atlas resize immediately followed by the existing PNG import, with atomic export/reimport and history checks, NOT_EXECUTED.

**Embedded PNG file import and Cube texture assignment (2026-11-15; SOURCE_ONLY):** `import_paint_texture` embeds a valid unmodified RGBA8 PNG under a caller-supplied UUID after full Rust decode, current-atlas dimension check (≤256×256), and the 1 MiB input limit. `assign_cube_texture` assigns its texture UUID to non-null Cube faces without changing UV; both are atomic Rust `EditOperation` variants with Undo/Redo and .bbmodel export. Tauri uses a native file picker and never sends local file paths to Svelte. The headless CLI bypasses the JSON plan-size limit for this operation with `import-png --input model.bbmodel --output model-imported.bbmodel --png atlas.png --uuid <uuid> --name atlas.png --expected-sha256 <original-model-sha256>`; it verifies the source SHA twice and publishes only a new sibling. The user must select a matching project atlas size beforehand; RGB, differently sized, animated/layered or external assets are conservatively refused. Tests AUTHORED_NOT_RUN, no native validation or 1:1 proof.

**Imported Paint opt-in (2026-11-15; SOURCE_ONLY):** `enable_imported_paint_texture` conservatively adopts only simple, full-decodable embedded RGBA8 PNGs (≤256²) with limited/default/double render metadata and matching optional `uv_width`/`uv_height`. All unknown, external, animated and RGB assets refuse; no metadata/pixels are rewritten except the existing `paint_owner` flag after explicit user action. Later strokes use the same Rust codec/Undo/Redo and the original bitmap remains undoable. UI eligibility is metadata-only; full PNG decode is required on mutation. Authored Rust/Tauri tests NOT_EXECUTED; true Blockbench Paint fidelity unverified.

**Canonical Cube Scale (2026-11-15; SOURCE_ONLY):** `scale_cube` adds factor-based per-axis Cube resizing about the saved pivot, using pinned Blockbench `ModelScaler` inflate math. It changes Auto UV to manual and recalculates derived Box UV faces; the original texture, animation, hierarchy and Undo history remain owned by the single Rust engine. The Svelte Scale gizmo sends the existing Tauri apply operation (no new IPC command). Authored Rust/Node regressions NOT_EXECUTED; original Blockbench native geometry/UV and tool parity remain UNVERIFIED.

**Outliner reparenting (2026-11-15; SOURCE_ONLY):** Shared Rust `reparent_node` moves a Cube to a Bone or Bone to Root/another Bone while retaining original content, nested children, identity and opaque references. Cycle, invalid target and no-op guards use one atomic revision/Undo/Redo transaction; the destination appends the moved node. Svelte uses only the existing Tauri apply route and Rust snapshot. No automatic world-space compensation is performed (matching pinned Blockbench's `adjust_position=false` default). Authored source cases NOT_EXECUTED; native Blockbench/UI acceptance remains unverified.

**Duplicate Cube transaction (2026-11-15; SOURCE_ONLY):** The shared Rust `duplicate_cube` operation clones a validated existing Cube's faces/UV, geometry and opaque extensions under a new caller-supplied UUID, inserts it immediately after the source in its nested Outliner parent and commits with one Undo step. Identity conflicts and unrepresentable opaque self-references fail atomically. The Tauri UI generates the UUID and uses one new IPC wrapper; headless CLI plans use the same typed EditOperation. Rust regression source covers nested order, original data, export/reimport, Undo/Redo and invalid/conflicting IDs, NOT_EXECUTED.

**Recognized Bone rotation keyframe update/remove (2026-11-15; SOURCE_ONLY):** Shared Rust `update_bone_rotation_keyframe` and `remove_bone_rotation_keyframe` operations act only on known finite single-point linear rotation entries, through the same atomic revision/Undo/Redo engine as Create/Add. Remove checks for remaining opaque UUID references before the draft can commit; unsupported shapes and collisions are refused. The existing Tauri apply and CLI schemas pick up these new variants without a second persistence owner. Authored regressions NOT_EXECUTED; true native Blockbench animation editing remains UNVERIFIED.

**Bone bind-rotation editing (2026-11-15; SOURCE_ONLY):** The canonical Rust EditOperation includes `set_bone_rotation` with bounded finite XYZ and explicit Bone identity. The same Rust-owned revision/Undo model persists nonzero values and omits the neutral saved value; Svelte Inspector edits only in Edit workspace. No separate Bone engine or new IPC endpoint. Preservation and refusal regressions authored NOT_EXECUTED; native model/visual parity UNVERIFIED.

**Read-only static Animate pose projection (2026-11-15; SOURCE_ONLY):** The existing Tauri `AnimationView` now admits scrubbing only for recognized linear numeric Bone rotation keyframes without opaque tracks or unsupported interpolation. A pure UI helper interpolates Bone offsets and the Three.js viewport applies them on top of bind rotation. The authoritative Rust Animation document and source `.bbmodel` remain unchanged when scrubbing. Regression source is AUTHORED_NOT_RUN; native playback, Molang interpolation, effect/controller preview and Blockbench visual parity remain UNVERIFIED.

**Initial Animate authoring slice (2026-11-15; SOURCE_ONLY):** The shared Rust EditOperation batch supports creation of a bounded Animation and insertion of a finite Bone rotation keyframe (UUID, time, linear interpolation, Molang axis strings). It rejects invalid IDs, duplicate names/UUIDs, unsupported track shapes and time/channel collisions, retaining all unrelated imported Animation/controller/texture payloads opaquely. Tauri derives limited read-only animation/keyframe views and Svelte supplies a simple editor against the same session. Full playback, pose evaluation, effects, animation export and real Blockbench round trips are NOT_IMPLEMENTED/UNVERIFIED. Rust/Tauri regression source is NOT_EXECUTED.

**Rust Edit viewport Rotate (2026-11-15; SOURCE_ONLY):** The Svelte/Three.js Rotate gizmo now sends the existing canonical `set_cube_rotation` command after each completed gesture, sharing Rust document validation and Undo/Redo with inspector edits and the CLI. Viewport pointer cancellation and rejected edits restore Rust snapshots; no second geometry or history authority was introduced. Source tests AUTHORED_NOT_RUN; actual native interaction remains UNVERIFIED.

**Edit hierarchy creation/removal (2026-11-15; SOURCE_ONLY):** `remove_cube` and `remove_empty_bone` join the existing shared Rust transaction schema; Tauri exposes new Bone creation through the same engine. Removal updates Outliner/element arrays together and rejects nonempty Bone subtrees and explicit opaque JSON UUID references, including imported Animation/metadata. Svelte Add Bone/Delete Selected use the existing session and Undo/Redo. Reparenting, reference-rewriting deletion, native .bbmodel compatibility, Cargo and WebView2 remain unimplemented or UNVERIFIED. Source regressions authored, NOT_EXECUTED.

**Cube render-order projection (2026-11-15; SOURCE_ONLY):** Imported optional `render_order` fields must be one of Blockbench's `default`, `behind`, or `in_front` values; malformed known values fail closed. Tauri derives the corresponding `0`, `-1` or `1` Three.js mesh priority without changing Rust-authored geometry, face UV, texture fields, `.bbmodel` serialization, Undo/Redo or CLI operations. Rust and Tauri regression source was authored, NOT_EXECUTED; Windows/WebView2 pixel/depth and native Blockbench parity remain UNVERIFIED.

**Outliner visibility transactions (2026-11-15; SOURCE_ONLY):** `set_node_visibility` uses the same revision-checked Rust CLI/Tauri EditOperation path to change one Cube or an entire Group subtree, matching Blockbench's propagated visibility toggle without treating Group visibility as inherited GPU masking. Tauri projects Bone visibility into the existing Svelte Outliner; Save Copy, .bbmodel retention, history and imported opaque fields remain Rust-owned. New Rust source regressions are TEST_AUTHORED_NOT_RUN; native interaction and true Blockbench 1:1 remain UNVERIFIED.

This folder owns the **single authoritative Bedrock Entity Geometry/UV model** shared by the headless CLI and the Rust-branch Tauri/Svelte Edit UI. Cargo, WebView2, Windows and native Blockbench have NOT_EXECUTED status. The legacy Runtime, Gateway, Desktop source, Skills and all user assets remain preserved.

## Source owners

- `src/authoring/mod.rs` — typed authoritative Rust `AuthoringDocument`, pinned format-5.0 Bedrock codec, cube/group/outliner checks, bounded Geometry/UV/Rotation transactions, revision guards and in-memory Undo/Redo. Its validation rejects malformed rotation/UV-mode fields, performs bounded native Auto UV 1/2 Move and single-edge Resize mapping, and recalculates Box UV offsets/faces on single-edge Resize.
- `src/authoring/bbmodel.rs` — isolated Blockbench v5.2.1 wire codec; the internal Rust model does not use the wire object's field names.
- `src/authoring/storage.rs` — shared bounded project I/O and non-overwriting output publication for CLI and Tauri.
- `src/lib.rs` — shared Rust library entrypoint for CLI and GUI.
- `src/bin/lazydesigner-authoring.rs` — headless CLI (`new`, `inspect`, `apply`) using the same engine.
- `src/desktop_authoring.rs` — Rust-owned Tauri editor session, explicit native file pickers and read-only UI projection.
- `apps/desktop/src/RustEditorPage.svelte` — Edit mode operations (New/Open/Save Copy, Add Cube, Outliner, Position/Size/UV, Undo/Redo).
- `apps/desktop/src/RustViewport.svelte` — Three.js derived untextured Geometry, selection, orbit/pan/zoom and framing.
- `fixtures/bedrock-basic.bbmodel` — **synthetic** one-bone/one-cube data for authored regression intent, not native compatibility proof.
- `src/authoring/tests.rs` — Rust source regressions, AUTHORED_NOT_EXECUTED.

## Future authorized PC-local usage (NOT_EXECUTED)

From `apps/desktop/src-tauri`:

~~~text
cargo run --bin lazydesigner-authoring -- inspect --input fixtures/bedrock-basic.bbmodel

cargo run --bin lazydesigner-authoring -- apply \
  --input fixtures/bedrock-basic.bbmodel \
  --output fixtures/bedrock-basic-edited.bbmodel \
  --expected-sha256 <inspect result SHA-256> \
  --plan fixtures/edit-cube.plan.json
~~~

Example plan for the **synthetic** cube:

~~~json
{
  "expected_revision": 0,
  "operations": [
    {
      "op": "translate_cube",
      "uuid": "00000000-0000-4000-8000-000000000002",
      "delta": [1, 0, 0]
    },
    {
      "op": "set_face_uv",
      "uuid": "00000000-0000-4000-8000-000000000002",
      "face": "north",
      "uv": [1, 1, 5, 5]
    }
  ]
}
~~~

`new --output <fresh.bbmodel> --name <name> --model-identifier <identifier>` creates an empty Bedrock project entirely in Rust. `apply` supports `add_bone`, `add_cube`, `translate_cube`, `set_cube_bounds`, `set_cube_rotation` and `set_face_uv` as a bounded **atomic batch**. The edited example plan also requests a Cube rotation of 22.5° about Y using the exact same Rust engine as the GUI. Each CLI command returns machine-readable JSON; structured error codes do not echo potentially private project paths.

The in-process `EditorSession` revision starts at 0 when opening a file. The CLI also requires the exact source-file SHA-256 from `inspect` to refuse stale input. `apply` rechecks that source before publication, then writes only a **new sibling .bbmodel** in the same directory to retain relative texture references. The original source is never overwritten. Atomic publication uses a sync'd same-directory staging file and an exclusive hard-link; a file system lacking hard-link support fails closed. File-system race/Windows reparse-point safety remains subject to authorized native review; do not treat source intent as an executed security guarantee.

## Strict format scope

The admitted shape is `meta.model_format="bedrock"` with `meta.format_version="5.0"` from pinned Blockbench `v5.2.1`. This slice supports cubes, six face UV arrays, groups/bones, outliner identity, Cube rotation and read-only preservation of opaque texture/animation/controller/custom JSON fields. A new rotation is saved using Blockbench's optional `elements[].rotation` triplet, while an all-zero rotation omits the field as Blockbench does. Existing Bone rotations and Cube rotation metadata are validated before lossless JSON preservation. It **does not** interpret/edit texture pixels, play animation, support mesh/locator variants, implement Paint/Animate UI, or export Bedrock geometry/animation files yet. **UV mapping boundary:** The shared Rust engine remaps Auto UV modes 1/2 for Cube Move and unambiguous single-edge Resize; Box UV single-edge Resize updates its offset and derived face rectangles. The same behavior is available to CLI and Tauri via the existing edit operation, with UI controls no longer disabled for those supported transformations. Manual per-face UV editing in Auto UV now switches the Cube to manual UV in the same Rust transaction; Box UV still refuses per-face edits. Ambiguous multi-edge Resize, unsupported Auto UV face rotation and per-texture/multi-file UV rules still fail closed with stable error codes. Native Blockbench parity is not yet established. No arbitrary geometry editing or native Blockbench equivalence is implied. Unsupported elements/versions, inconsistent outliner references and invalid texture indexes are rejected rather than silently flattened.

The remaining proof is a **real editable Blockbench bidirectional round-trip** and actual Windows/Tauri/Svelte/Three.js acceptance. Source-authored Edit commands are integrated; Paint, Animate, texture rendering, OS-detached floating panels, advanced edit gestures and full Blockbench 1:1 UI remain NOT_IMPLEMENTED. The Rust GUI is not an installed or proven editor. Cargo, Windows, Blockbench, visual fidelity and token savings remain NOT_EXECUTED / UNVERIFIED under the current hold. See [Rust-native Editor Plan](../../../../../docs/04-system/rust-native-editor-plan.md).

Explicit imported `per_texture_uv_size: true` project/metadata flags, and any present non-boolean flag values, now block Auto UV Move/Resize remapping; Blockbench v5.2.1 can resolve per-face texture UV dimensions under that format capability. The exact Rust-owned refusal helper also gates project-UV PNG previews in Tauri; an explicit `false` remains eligible when the multi-file ruleset is absent or empty. Imported metadata is preserved in `.bbmodel`, not rewritten. This is a conservative refusal, not implemented per-texture mapping or native format validation; regression source is NOT_EXECUTED.

**Audited source correction (2026-11-14; NOT_EXECUTED):** New Bedrock Entity projects now use Blockbench 5.2.1's Box UV default; newly added Cubes get derived Box UV face rectangles in the Rust transaction. Explicit Face UV projects retain manual face editing. Unknown non-string `multi_file_ruleset` values now refuse Auto UV remapping. Position, Size, Rotation and UV inspector inputs use the shared finite decimal parser in `src/rustNumericInput.ts` with authored-only `src/rustNumericInput.test.mjs`. Native `.bbmodel` two-way acceptance remains UNVERIFIED.

**Box UV Inspector (source-only):** The existing Tauri/CLI `apply` supports `set_box_uv_offset` with exact finite integer atlas U/V offsets for a Box UV Cube. The Rust transaction updates derived face rectangles and history atomically. The Svelte Inspector exposes these two fields only in Box UV mode. Per-face Box UV edits and native drag/clamp parity remain unsupported; source regressions are NOT_EXECUTED.

**Synthetic texture-bearing fixture (SOURCE_ONLY, NOT_EXECUTED):** `fixtures/bedrock-texture-interchange.bbmodel` exercises format-5.0 texture asset metadata, an embedded data-URL placeholder (not a valid PNG), an external relative texture path, indexed/null Cube face references, nested bone hierarchy, Animation and opaque extensions. `src/authoring/tests.rs` asserts loss prevention through Rust Edit and export/reimport. This does not establish native Blockbench reopen/edit acceptance or textured rendering. Do not use the placeholder image as paint/viewport proof.

**Read-only embedded PNG projection (SOURCE_ONLY):** `desktop_authoring.rs` exposes only bounded `data:image/png;base64` candidates from the Rust document. Per-texture/multi-file UV resolutions, external file/network paths and unsupported wrap modes are not projected. `RustViewport.svelte` derives per-face UV for unrotated faces and uses temporary Three.js textures. Rust remains the only document owner; browser PNG decoding, animated/rotated/wrapped UV fidelity and real Blockbench compatibility remain UNVERIFIED.

**Bounded material-side projection (SOURCE_ONLY):** `desktop_authoring.rs` checks the texture's default render mode and `render_sides` before passing a PNG candidate into the WebView. Additive, emissive and layered modes are excluded because they need different shaders. The derived projection supplies front/double side selection for the existing Three.js viewport, not a new Rust texture edit transaction. Real blend/alpha correctness and actual Blockbench parity remain UNVERIFIED.

**Initial Rust-owned Paint source (NOT_EXECUTED):** `authoring/paint.rs` uses pinned `png 0.17.16` and `base64 0.22.1` to encode a transparent RGBA8 atlas at current project resolution (maximum 256×256), then edit one pixel in the Rust transaction. `create_paint_texture` and `paint_texture_pixel` use the same CLI/Tauri EditOperation plan and existing Undo/Redo. Imported/unknown texture metadata, external paths, animation, layers, unsupported PNG formats and over-limit dimensions are not mutated; generated texture metadata is strictly whitelisted. The desktop Textures dock has a limited pixel-click painting surface. This is not full Paint workspace parity or native PNG/Blockbench proof.

**Batched stroke source extension (2026-11-14; NOT_EXECUTED):** The canonical Rust authoring `paint_texture_stroke` operation accepts a maximum of 4096 bounded atlas coordinates, validates all points, decodes/encodes one generated RGBA8 texture once and commits one Undo step. The old one-pixel operation uses the same codec helper. Svelte only collects transient pointer samples with a bounded interpolation helper, submitting on gesture release. Imported textures, unknown metadata and unsupported PNGs remain read-only; Rust and Node regressions authored NOT_EXECUTED.

**Circular Pencil/Eraser brush source (2026-11-14, NOT_EXECUTED):** `paint_texture_brush` is an additional canonical Rust EditOperation for the existing generated-only RGBA8 atlas subset. A circle of radius 1–8 around each bounded path point is applied in one PNG decode/encode per gesture; Eraser writes transparent RGBA and Pencil writes the chosen RGBA color. The old single-pixel/stroke operations remain compatible. Rust owns Undo/Redo, transactions, import/export and data safety; the UI holds only transient radius/tool settings. No imported/layered paint or native compatibility proof.

**Paint workspace presentation (2026-11-15, NOT_EXECUTED):** The Svelte Rust-branch mode switch presents a larger central atlas and a read-only 3D preview. The Textures dock retains selection and the Paint controls are rendered in only one central location. The same `paint_texture_brush`, generated-only RGBA8 policy, existing undo history and editable `.bbmodel` Rust codec remain authoritative. No new IPC endpoints, PNG codec, Rust editing state, external texture access or native testing were introduced.

**Filled Rectangle Paint source (2026-11-15; NOT_EXECUTED):** One bounded generated-RGBA8 atlas rectangle is edited by the canonical `paint_texture_rectangle` Rust operation. Two inclusive corners can be given in either order; the same codec decodes/encodes once, refuses invalid coordinates and imported texture data, and commits one transaction/Undo step through CLI/Tauri. This is an additional Paint tool, not a new bitmap engine or a claim that selecting arbitrary texture index changes the Bedrock single-texture 3D material.

**Paint ownership/gesture correction (2026-11-15; NOT_EXECUTED):** Tauri's `paintEditableTextures` now uses the same Rust-owned strict generated texture whitelist as `authoring/paint.rs`, avoiding UI false-positive editability for textures with unsupported opaque extension fields. The Svelte Paint pointer-up handler includes a final in-bounds sample before committing an already bounded gesture. Cancellation remains write-free; the authoritative Rust codec/history/CLI and native hold remain unchanged.

**Tauri PNG preview header guard (2026-11-15; SOURCE_ONLY):** `desktop_authoring.rs` now enforces Base64 decode, exact PNG signature, 13-byte IHDR first chunk, nonzero dimensions capped at 2048 each and four million pixels before forwarding embedded candidate sources to the WebView. This only bounds derived preview data, not the Rust-owned `.bbmodel` texture payload, CLI persistence or Paint transaction. Rust tests authored NOT_EXECUTED; full PNG decode and actual visual fidelity remain unverified.

**PNG preview aggregate budget correction (2026-11-15, NOT_EXECUTED):** A source audit detected that the earlier IHDR validation was present only in tests and not the production projection. Tauri now applies bounded Base64 PNG signature/IHDR checks and an aggregate 4,194,304-pixel/16-image GPU exposure budget before passing candidates to the WebView. This does not change the canonical Rust bitmap codec, imported asset data, `.bbmodel` round-trip or Paint editing authority. Rust regressions are authored but NOT_EXECUTED, and full PNG correctness and native rendering remain unproven.

**Format-5.0 Cube face texture UUID support (2026-11-15; SOURCE_ONLY):** The Rust Cube validator now accepts genuine Blockbench UUID-string face texture references when they match the current `textures[].uuid`, retaining legacy numeric index support and exact opaque payload preservation. Auto UV looks up source texture wrap metadata through either reference form instead of silently assuming a string reference is untextured. The existing CLI/Tauri adapter and Svelte CubeFace typing are updated accordingly. Native Blockbench save/reopen and all local tests remain NOT_EXECUTED.

**Texture UUID ambiguity guard (2026-11-15; SOURCE_ONLY, NOT_EXECUTED):** Imported texture UUIDs now must be distinct valid nonempty strings when present; absent UUIDs remain supported for legacy numeric-reference assets. This prevents duplicate UUIDs from ambiguously resolving one Cube face or Auto UV's wrap metadata to an arbitrary first texture. Opaque texture payloads and .bbmodel serialization remain unchanged; Rust regression source is authored, not run.

**Cube inflate/stretch projection (2026-11-15; SOURCE_ONLY):** Rust validates optional numeric `inflate` and three-axis numeric `stretch` fields, but leaves them in the original Cube extension map for exact `.bbmodel` retention. The Tauri read-only Cube projection makes validated values available to a derived Three.js geometry calculation based on the pinned Blockbench center/half-extent formula. No editing operation, CLI schema or history mutation is added; invalid inputs fail closed and unsupported mirrored/degenerate previews are omitted. Source tests authored NOT_EXECUTED.

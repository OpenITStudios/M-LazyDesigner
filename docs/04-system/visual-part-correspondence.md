# Visual Part Correspondence — bounded architecture decision

**Status:** BATCHES 1+2 SOURCE IMPLEMENTED · NOT EXECUTABLE/NATIVE VERIFIED  
**Updated:** 2026-10-11  
**Working authority:** `Local` (baseline `5b7becaa2feb9bec9c3cd70b2ebaa2cb250d6b88`)  
**Task:** Image Reference → verified semantic-part-to-native-element correspondence

## Decision

Do **not** introduce a second image engine, segmentation inference service, scene
graph, persistent part registry, correction solver, or a fifth public Gateway tool.

The absent boundary is a **read-only correspondence assessment** joining
current, verified source-image part claims with **current and explicitly
identified** Blockbench model parts. A region ID, part ID, recipe
`semantic_group`, Cube name, Cube UUID, and camera-view label are **different
identities**. String equality alone never proves their correspondence.

The normal authoring path remains:

```text
approved REFERENCE.json + current image SHA
→ existing imageRegionEvidence (part / view / visibility / owner)
→ explicit candidate mapping to current native UUID(s)
→ existing native/project evidence + fresh paired model capture
→ bounded correspondence assessment (pure; source-only)
→ existing visualObservation (requires independently inspected images)
→ existing correctionLoop (only after independently supported cause)
```

No image bytes or inferred Cube identities are copied into normal Control
stage context. The explicit image-review `status` path already transports
source image bytes and IDs on demand.

## Owner map — reuse before adding source

| Existing owner | Owns / must continue owning | Must **not** own |
| --- | --- | --- |
| `REFERENCE.json` / `gateway/control/referenceParser.ts` | Approved semantic `parts[].id`; source image/region/landmark declarations, roles, and unknowns | Live Cube UUID, generated geometry |
| `lib/reference/imageRegionEvidence.ts` | Region/part/visibility/ownership evidence; never infers invisible shape | Native model inspection, visual PASS |
| `lib/authoringRecipe/semanticIdentity.ts` | Recipe-owned pattern, semantic group, instance ID ↔ native UUID only after matching compiled/native state | Guessing non-recipe Cube ownership |
| Existing `inspect_elements` and `capture_model_views` capability owners | Current exact native element and image evidence; canonical view/camera **capture plan** | Approval of a reference/model match |
| `lib/orchestration/visualObservation.ts` | Human/AI-verified discrepancy with explicit criterion/owner and evidence refs | Unproven geometry causes from strings or 2D boxes |
| `lib/orchestration/correctionLoop.ts` | Existing causal and bounded correction/reverification | Source image interpretation or new solver |

**Implemented Batch 1 pure owner:** `mcp/lib/reference/partCorrespondence.ts`.
It consumes existing `imageRegionEvidence` and the already validated
`SemanticIdentityResolution` type without creating a store, Gateway tool,
new reference schema, router or mirrored Runtime mapping. It is wired only to the opt-in `capture_model_views.reference_correspondence`
argument through Batch 2, not to default authoring traffic. Native capture,
revision, or visual acceptance cannot be inferred from source-only fixtures.

## High-end source evaluation — adopt contracts, not engines

1. [PartField](https://github.com/nv-tlabs/PartField) (ICCV 2025)
   learns features for 3D part clustering and correspondence. Learn that
   part identity is distinct from a text label; **do not** import its
   GPU/feature-field training stack or claim learned matching.
2. [SAMPart3D](https://github.com/Pointcept/SAMPart3D) handles
   multiscale/hierarchical part evidence. Learn `one part → multiple native
   elements` and preserve hierarchy; do not implement 3D mesh segmentation.
3. [Open3DIS](https://github.com/VinAIResearch/Open3DIS) and
   [OpenMask3D](https://github.com/OpenMask3D/openmask3d) associate multi-view
   2D evidence with actual 3D proposals. Their depth, masks, poses,
   pointclouds, and calibration are **preconditions**, not available merely
   because two views share a label. Adopt evidence pairing, not projection
   confidence claims.
4. [OpenUSD paths](https://docs.nvidia.com/learn-openusd/latest/stage-setting/prim-property-paths.html),
   [relationships](https://docs.nvidia.com/learn-openusd/latest/stage-setting/properties/relationships.html)
   and [collections](https://openusd.org/release/user_guides/collections_and_patterns.html)
   distinguish scene node identity, relationship and grouping. Learn stable
   references and explicit multi-target associations; do **not** add OpenUSD
   dependencies or serialize a competing scene graph.
5. [Grounded SAM 2](https://github.com/IDEA-Research/Grounded-SAM-2)
   separates open-vocabulary grounding from mask generation and tracking.
   Reuse the distinction between a **proposal** and observed instance
   membership; do not treat source region boxes as segmentation masks.

Source evaluation is conceptual. These models' published benchmarks are
not LazyDesigner benchmarks, nor proof of native reference similarity.

## V1 correspondence contract (Batch 1 pure source implemented; no persisted state)

**Source evidence**, selected from the existing approved package:

- `reference_package_fingerprint`; `image_id` and **current image SHA-256**;
  `view`, `region_id`, `part_id`, `evidence_role`, `visibility`;
- optional `landmark_id`, only when it actually identifies a target mass
  center; otherwise do not interpret it as a Cube-center measurement;
- independently reviewed source image **pixels** (never replaced by a box).

**Model evidence**, selected from current native state:

- exact `project_uuid`, explicit `target_cube_uuids[]` (or recipe-owned
  instance mapping already resolved by `resolveSemanticIdentity`);
- one native-state fingerprint/receipt for the **affected model scope**;
  current capture identity, canonical view, front direction, framing/camera
  plan, and evidence handle. Do not invent model revision from a timestamp;
- for each actual shaded capture view, its image SHA-256 bound to that view.
  Reviewed claims must match both the capture handle and the exact view-image
  digest; a view label or unchanged handle alone is insufficient. Identical
  pixels in distinct views are possible for symmetric models and are allowed;
- current target existence/visibility and, if required by the question,
  a real inspected hierarchy/attachment relationship;
- explicit correspondence proposal: `part_id → target Cube UUID(s)`.
  UUID(s) can be many for one semantic part. A Cube allegedly shared by
  unrelated part owners remains ambiguous unless its relationship is
  independently justified.

The original model-side `capture_model_views` response currently exposes
project UUID, selected views and a computed offscreen camera **plan**, not
an authoritative per-Cube model revision or calibrated source camera.
Therefore source/target pairing remains `UNVERIFIED` until actual
model-state/freshness evidence and direct image review exist.

**Output** must remain a compact difference-first verdict using the
existing evidence vocabulary:

```text
SUPPORTED     — explicit IDs + fresh native evidence + direct paired image review
PROVISIONAL   — plausible association, but insufficient native/view support
CONFLICTING   — competing owners, incompatible view/source, or observed mismatch
UNAVAILABLE   — source image, native target or required fresh capture missing
```

For each claim, retain only IDs, matching evidence handles, affected view(s),
and concrete issue/reason. No global similarity score, reconstructed shape,
confidence-as-probability, unbounded list, or implicit correction command.

## Required fail-closed cases

| Case | Required outcome |
| --- | --- |
| Visible required mass, exact reviewed native Cube(s), fresh compatible paired view | Association may be **SUPPORTED**; **not** visual quality PASS |
| Expected native Cube UUID absent from inspected complete relevant scope | Target presence mismatch; `MISSING_REQUIRED_PART` only if independent source requirement is supported |
| No UUID proposed / recipe semantic group absent | `PROVISIONAL / UNAVAILABLE`, **not** `MISSING_REQUIRED_PART` |
| Reference region is `SURFACE_DETAIL` | Texture-owner observation; **not** request to create geometry |
| Region is `PARTIAL` or `OCCLUDED` | Unseen continuation **UNVERIFIED**; absent silhouette is not missing-part proof |
| Source `CONTACT` or `NEGATIVE_SPACE` region | Inspect both relevant elements/empty space; never treat it as a Cube-to-create |
| One image/view repeated under multiple IDs | Still **one independent view**, even when its file has several IDs |
| Same image SHA-256 assigned to different canonical views | `CONFLICTING / SOURCE_VIEW_IDENTITY_CONFLICT` for affected claims; exclude those bytes from `source_views` until references are disambiguated |
| Part maps to many owned Cubes | Valid when resolved identities and relationships are explicit |
| One Cube claims unrelated parts without a justified shared relationship | `CONFLICTING`, no silent ownership merge |
| Model changed since capture, image SHA changed, or cameras cannot be paired | `UNAVAILABLE / PROVISIONAL`, refuse convergence/quality PASS |
| Captured model view missing its shaded PNG hash, or review cites another digest | `UNAVAILABLE`; do not promote an old review by matching view labels alone |
| Correct source/model association but visibly wrong form, attachment, or marking | Feed independently reviewed existing `visualObservation` criterion; **do not** auto-choose a 3D repair operation |

An `EXTRA_UNSUPPORTED_PART` claim needs an explicit relevant scope and
positive *observed* unintended model geometry. Failure to find a source
region in one photo is **not** proof that existing model geometry is extra.

## Build order — two coherent batches, not patch-by-patch testing

**Batch 1: Contract + source-level correspondence — implemented at
source level.** The pure `assessVisualPartCorrespondence` function consumes
existing parsed source image regions and a `SemanticIdentityResolution`
from the existing recipe identity owner. It requires explicit proposed
Cube UUIDs, source/model/capture revision matches and a claim-specific
review referencing the exact image ID, region ID, SHA-256 and current
model capture handle. It distinguishes unsupported source/owner mismatch,
missing proposal, missing proven native target, partial/occluded parts,
surface detail, relationship-only regions and repeated same-view evidence.
One part may map to several independently resolved Cube UUIDs; one Cube
claimed by unrelated parts produces a conflict. There is **no**
auto-classification of missing/extra geometry, and the output
`visual_verdict` remains `NOT_EVALUATED`.

These are caller-supplied **already verified evidence facts**. The pure
join does not inspect Blockbench, load image pixels, independently attest
native snapshot freshness, or manufacture a visual review. Regression
definitions are committed, not executable PASS.

**Batch 2: Opt-in consumer on existing `capture_model_views` — source
implemented.** Caller first obtains actual current approved source images,
regions and SHA-256 from existing Gateway `status` opt-in delivery; to
avoid repeating binary data, it supplies only the bounded source metadata
and explicit part→native Cube UUID proposals in the optional
`reference_correspondence` capture argument. The Runtime reads the
stored recipe/current native owned-Cube snapshot via the existing
`recipes/authoring/service.ts` owner and the existing
`resolveSemanticIdentity`, verifies snapshot/project stability before
and after canonical offscreen captures, and binds proposals to the real
new capture image digests/handle. `assessVisualPartCorrespondence`
is invoked with **NO review declaration**: claims remain
`PROVISIONAL / CONFLICTING / UNAVAILABLE`, never automatically
`SUPPORTED` or visual PASS. Source fields are **caller-supplied and
not independently validated by the Blockbench Runtime**; the Gateway
source image delivery is the origin, not Runtime attestation.

The resulting response contains `part_correspondence`, current
recipe-owned native fingerprint, project UUID, exact available
instance/native UUID identities and per-view capture image digests.
It is a single **read-only opt-in extension of the existing capture tool**,
not an additional Gateway capability, registry, or visual classifier.

**Limitations:** the original recipe-native fingerprint remains unchanged for
recipe transaction/Undo authority. A separate capture-only dependency hash now
covers all native Cube geometry (including Cubes unrelated to the saved
recipe), parent Group pivot/rotation/visibility, UV/face state, and current
loaded texture bitmap bytes. An unrelated Cube obstructing the reference
target therefore changes the capture fingerprint even if recipe-owned
geometry has not changed. Correspondence capture rejects before/after
dependency drift and binds this hash into the evidence handle; later pure
reviews also require a matching current dependency hash supplied by the
caller. Mesh/non-Cube geometry fails closed when present. Animated preview
transforms, GPU material state and source-region visual approval remain
**not attested**. Texture hashing applies only to opt-in correspondence
capture and is not the regular authoring hot path.
Matching image/view labels does not certify source-camera calibration.
The reviewing AI must inspect the freshly returned model pixels beside
the actual approved source pixels. A source claim/capture never
auto-generates a discrepancy, a correction or Undo. Unsupported or
unbound native candidates remain unresolved, not "missing geometry".

**Proof discipline:** define all focused source tests as a batch, then use
the existing owner verifier on one pinned HEAD when actually executable.
Native screenshot comparison, install/reload and visual fidelity require
LIVE_BLOCKBENCH proof; missing execution remains `NOT EXECUTED`. Do
not fabricate a new Actions workflow or ask for the user's PC.

## Stop / non-goals

- No pretrained SAM/PartField/Open3DIS/SAMPart3D model integration, weights,
  CUDA, cloud inference, third-party model license/runtime surface.
- No automatic image-to-voxel or hidden-side reconstruction; no box-IoU PASS.
- No duplicate `REFERENCE.json` schema v2, scene graph, persistent mapping
  table, second approval/route system, fifth public Gateway tool.
- No duplicate aliases of `part_id`, `semantic_group`, `instance_id`, or
  `native_uuid`: relate explicit identities, never collapse them.
- No promotion of missing correspondence to a confirmed bug and no test
  ceremony after each small source edit.
- If direct active-context visual review with existing source/model evidence
  already answers the question, **stop with no extra feature**.

## Acceptance criteria for implementation

1. Same-image SHA/source region/view/revision can be traced to exact
   current native UUID(s); no unverified names-as-IDs.
2. Pure output classifies geometry, surface, occlusion, multi-Cube and
   ambiguous cases without mutation or pretending visual PASS.
3. One front-only image cannot prove side/depth/hidden or absent parts.
4. Stale native or source evidence cannot clear discrepancies or trigger a
   correction route.
5. Existing Control→Gateway→Runtime owners remain intact; four public tools.
6. Measured executable and native proof is reported separately from the
   source-level design, without claiming improved visual fidelity in advance.

**Delivery record:** Batches 1+2 are source-implemented with focused
regression definitions. No matching-SHA Bun/CI, installed Blockbench
runtime, native capture/recipe-fingerprint, or visual correspondence
acceptance has been executed. Runtime source metadata is caller-declared;
candidate assessment never replaces direct review.

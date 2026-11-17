# Rust Code Mode — first-party local host integration

## Native scoped Paint receipt reconciliation (SOURCE ONLY)

A Rust `apply` result is not a trustworthy Code Mode success merely
because the runner reports `status:'OK'`. For **every scoped Paint**,
the first-party SDK now requires all of the following before returning
a successful mutation: matching input model SHA; actual mutation
operation count and matching document revision; a valid output SHA;
and a Rust `correction_scope` receipt with `status:'enforced'`,
the exact selected texture UUID, `visual_verdict:'UNVERIFIED'`,
and exact counts for `protected_regions`,
`expected_before_pixels`, and `editable_before_rgba`.
The Rust CLI emits all three guard counts from the canonical scope
used by the editor. A missing, truncated, contradictory or stale
receipt fails with `CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED`.
Unscoped legacy edits retain their existing separate contract.

For scoped writes, after receiving a valid native receipt, the trusted
Host **reopens the published sibling model** through its normal Rust
inspection and checks the actual SHA against the publisher's
`output_sha256` before registering a project handle. A mismatch
raises `CODE_MODE_RUST_PUBLISHED_OUTPUT_SHA_MISMATCH`.
Neither mismatch is an artistic verdict or evidence that all pixels
were reviewed. Both mean **no successful Code Mode completion**.

Crucially, the native CLI may already have created its new sibling
file when a malformed success response is detected. Do **not**
automatically retry, overwrite, delete, or claim rollback. The
operator should reconcile that saved sibling with the original
model and Rust receipt explicitly. For reviewer-bound corrections,
the host consumes the model's reviewed source lease on an
unverified native correction receipt to prevent a renamed retry
from laundering an unknown publication outcome. Independent
write permission, SHA-pinned review inputs, protected sample,
face/UV checks and fresh rendered-image review remain mandatory.

Source-authored regression cases include missing/incorrect guard
counts, wrong scope or model source, invalid output SHA or operation
count, saved-output SHA disagreement, and disallowing a second
reviewed Paint after an uncertain native result. These tests are
NOT_EXECUTED under the existing CI/local-PC hold.


## Source-color overwrite guards for reviewed material propagation (SOURCE ONLY)

The existing Rust correction scope can now carry
`editableBeforeRgba` (serialized `editable_before_rgba`): one to
16 exact RGBA8 colors which may be **replaced** during a correction.
Every actually changed physical atlas pixel is compared against the
ORIGINAL saved PNG in the canonical Rust transaction. A changed pixel
whose pre-image RGBA is not on the list aborts the entire transaction,
including all earlier edits. This prevents generic cluster shading
from overwriting a red emblem or neutral metal detail that occupies
the same permitted atlas rectangle. Alpha, protected regions, the
per-pixel expected-before guard, UV ownership and all prior
correction-scope checks remain intact.

For independently reviewed **broad propagation**, the host requires
that the trusted reviewer, not the Deno guest, supplies a nonempty
`correctionScope.editableBeforeRgba`. The guest may omit the field
(the reviewer guard is inherited) or narrow the list; any extra
guest-listed colors are **rejected** before write authorization rather
than silently truncated. A guest-supplied list
without a reviewer-supplied source color set cannot authorize broad
propagation. The existing small representative correction and direct
known-safe exact-RGBA workflows remain backward compatible; the
pre-image allowlist is optional outside reviewed propagation.
The Code Mode SDK and Rust both reject an **explicit empty list**:
only omitting the optional field retains legacy unrestricted behavior.
The SDK validates the scope once, then forwards those exact normalized
fields through the approval descriptor and Rust EditPlan. The trusted
host rechecks the merged reviewer/guest scope at its separate trust boundary;
this is intentional, not duplicate model-side artistic scoring.
This does not transform a pixel into an accepted reference or certify
correct shading.

Before the reviewer chooses replaceable original colors, use a SHA-
bound **read-only** Code Mode inspection, for example:

```js
await codemode.inspectBatch({project,requests:[{
  kind:"texture_source_colors",
  texture_uuid:"<actual selected texture UUID>",
  region:{from:[8,8],to:[12,12]}
}]});
```

The Rust result reports up to 16 most frequent **exact RGBA** values
and counts from the selected physical atlas crop; its `complete` flag
distinguishes a full list from a crop with more than 16 unique colors.
It never includes full image bytes, never selects overwrite permission,
and does not infer which colors in a lit reference render correspond
to those saved pixels. Only approved source/reviewer evidence can
justify which colors are intentional material base versus protected
identity/secondary details.

The Rust `apply` receipt now reports the number of source colors
actually guarded. The host compares all guard counts with its own
effective scope; this is source-level enforcement evidence only.
Source-authored Rust and Node tests cover base-color correction with
adjacent artwork preservation, stale/duplicate lists, reviewer-owned
intersection, absence of reviewer permission and original source
palette inspection. All remain TEST_AUTHORED_NOT_RUN under the hold.



## Reviewer-owned inner-scope landmark preservation (SOURCE ONLY)

The existing `correctionScope` supports two bounded **optional** pixel
guards without introducing a second editor or policy database:

```json
{
  "textureUuid": "00000000-0000-4000-8000-000000000101",
  "allowedRegions": [{"from":[1,1],"to":[10,10]}],
  "preserveAlpha": true,
  "protectedRegions": [{"from":[2,2],"to":[4,4]}],
  "expectedBeforePixels": [{"at":[5,5],"rgba":[80,90,100,255]}]
}
```

Coordinates are **physical atlas** pixels with half-open rectangles.
`protectedRegions` (up to 16) prohibit *any* RGBA change, including
inside `allowedRegions`; use them for already-approved emblem, trim,
face trace or another exact identity mark. `expectedBeforePixels` (up to
64 unique positions) assert the actual RGBA8 of the **original saved
bitmap** before Rust may commit the transaction. These are safeguards,
not instructions to recolor a pixel and not proof that the declared
old color was taken from a genuine approved reference. A missing,
stale, conflicting or out-of-bounds guard fails closed.

In a reviewer-bound correction, the independent host reviewer can
declare those two optional fields in its existing `correctionScope`.
The host merges them with any extra restrictions supplied by the
model-written guest; the guest cannot omit or overwrite the reviewer's
protected region or expected original color. A disagreement at one
coordinate is rejected before write authorization. The one canonical
Rust `apply_with_correction_scope` operation checks the actual source
pixels, checks every changed pixel, and rejects any protected-region
edit atomically before updating `.bbmodel` or Undo history. Outside
the review loop, existing exact-pixel edits can opt in to the same
strict guard without creating a new mandatory approval step.

The SHA-bound Rust `apply` receipt now reports
`correction_scope.protected_regions` and
`correction_scope.expected_before_pixels` as **counts** alongside
`status:'enforced'`. The Code Mode workflow receipt compares the
counts to the host's actual submitted scope. This demonstrates
only structural guard admission at the available execution surface;
it cannot prove the protected pixels were artistically correct or
that a model image was visually inspected.

`MaterialWorkPacket` remains responsible for the intended new
shade clusters and texture identity. This guard protects existing
details in or near those clusters; it never changes the palette,
UV geometry, Rust paint source owner, or the approved reference.
Regression fixtures for preserved detail, stale original RGBA,
duplicate old-pixel assertions, rejected reviewer-guard removal
and rollback are authored but NOT_EXECUTED under the current hold.



## Multi-view preflight reuse (SOURCE ONLY; native tests held)

A multi-view `inspectSelectedVisualPair({project})` previously repeated
each Rust `inspect-visual-pair` native PNG comparison on every guest
read, even after the host had frozen the independent reviewer decision
for the selected source-model SHA. The trusted Host now retains only
the **successful, numeric read receipt** in a single ephemeral slot
for the operator-selected model and view set. It is not persistent
review history, not an approval cache, and contains no image buffers
or file paths exposed to the sandboxed guest.

The first preflight remains unchanged: all selected PNG pairs are
checked through Rust, real PNG buffers enter an explicitly configured
independent reviewer, and reviewer-returned sample/UV/alpha bindings
must pass the original checks. For a subsequent read on the **same
pinned model revision with two or more camera view pairs**, the host
uses one read-only Rust `inspect --expected-sha256` to verify current
model bytes, and independently reopens/re-hashes **every** selected
reference and capture PNG before returning the prior numeric report.
If any source/image is stale or unreadable, the cached response is
withheld. A new host, model SHA or visual selection requires the
original full preflight. Single-view preflights are unchanged.

This optimization does **not** bypass fresh image checks before
`apply`, independently authorized mutation approval, native Rust
source revision/UV checks, or the full-face terminal readiness scan.
The old reviewer finding remains immutable for a given SHA; no
model-written code may supply or downgrade it. Source-only regression
fixtures cover six-view repeat (six Rust image pair inspections on
first read versus one Rust source check on a repeat), stale model
and replaced supporting PNG. These are authored—not executed or
benchmarked—in the current ChatGPT/GitHub source work surface.

## Rust-projected face-local cluster footprint (SOURCE ONLY)

For reviewed `FORM_SHADING` sample/propagation packets, Code Mode now
sends actual `facePlans[].clusters[].spans` as bounded `face_spans`
in the existing SHA-pinned Rust `material_face_patch` batch read.
Legacy patch-only reads are unchanged. The native source inspector
uses the exact signed/quarter-turn face-local UV mapper that Paint
uses, and refuses every span projected outside the selected, reviewed
physical atlas rectangle. The host verifies the returned bounded
`cluster_footprint` status and span count **before** requesting
write approval. A missing/mismatched footprint cannot be replaced by
a model-authored assertion. No JS-side UV engine or second atlas owner.
This source containment is not a shading, lighting, 3D-form or image
quality PASS. Positive/negative Rust and Node regression fixtures are
AUTHORED_NOT_RUN under the current localtest/CI hold.

## Connected pixel-art cluster compiler (SOURCE ONLY)

`FORM_SHADING` packets now require actual `facePlans[].clusters`
rather than only a free-text `clusterPlan`. Each cluster supplies:

```json
{
  "id": "joint-shadow",
  "role": "shadow",
  "formReason": "The recessed armor joint needs a connected shadow mass.",
  "spans": [{"y": 0, "x0": 0, "x1": 2},
            {"y": 1, "x0": 0, "x1": 3}]
}
```

`spans` are integer, half-open *Cube face-local pixels*.
Each cluster is one 4-connected mass; same-row spans may not overlap
or remain unnecessarily adjacent, and different clusters cannot
claim the same pixel. Each FORM_SHADING face needs a dark-form and
light-form cluster in the declared palette (the base can be preserved).
The whole packet is bounded to eight faces, 16 clusters per face,
64 total one-pixel-high row spans and 4096 declared local pixels.
The renderer-facing shape, pixel scale, lighting and historical
style approval are **not inferred** from row connectivity.

For this intent, model-generated code calls
`codemode.apply({project,output,correctionScope,correctionIntent,
materialWorkPacket})` and **omits `operations`**.
The host normalizes and compiles the masks to the pre-existing
Rust `paint_cube_face_regions_guarded` operations and checks those
against native SHA-bound `material_face_patch` UV ownership. Extra
guest-supplied operations are rejected rather than silently used.
Each normalized span becomes one 1-pixel-high guarded rectangle
with RGB taken from the named palette role. Rust still performs all
actual texture writes, alpha/scoped preservation and Undo in its
single document/PNG owner.

This is a constrained authoring primitive, not procedural random
noise generation, a new native paint engine, or a claim that a
connected cluster is professionally shaded. Approaches that need
actual source-image interpretation, curved surface lighting and
cross-face seam review still depend on actual independently reviewed
mapped pictures. A material whose reference calls for intentional
flat color should not be forced into FORM_SHADING; `SURFACE_DETAIL`
and exact known-safe edits retain the existing typed paths.
The prior `MaterialWorkPacket` section below describes general
source/reviewer binding; its references to guest-supplied Rust Paint
operations apply only to non-FORM_SHADING intents.

## MaterialWorkPacket: reviewer-bound material composition (SOURCE ONLY)

For **independently reviewed FLAT_SHADING samples and broad material propagation**, the guest
supplies `materialWorkPacket` to `codemode.apply` together with the existing
`correctionIntent`, `correctionScope`, and Rust-owned
`paint_cube_face_regions_guarded` operations. This is a bounded,
non-persisted artist *proposal*, not an alternative Paint engine, second
Reference authority, independent review or native material quality score.

The packet binds exactly:
- `sourceModelSha256` — the same immutable current Rust input snapshot.
- `referencePngSha256` — the operator-selected approved/reference image
  SHA bound by the trusted visual host (not guest-supplied artwork proof).
- `issueId`, `approachId`, `partId`, `material`,
  `reviewedIssueObservation` — identical to current independent reviewer
  issue/cohort and the existing material correction intent.
- `textureUuid`, `shadingIntent`, `styleIntent`, `lightDirection`,
  `lightRationale` — explicit material and lighting hypotheses.
- `palette` — up to eight role/RGB/purpose declarations; FORM_SHADING
  requires different shadow/base/highlight roles, without assuming three
  colors alone make professional art.
- `facePlans` — one to eight exact `cubeUuid + face + atlasRegion`
  targets with `formCue`, `shadowPlacement`,
  `highlightPlacement`, `clusterPlan` descriptions.
  FORM_SHADING requires both placement descriptions.

The `atlasRegion` is a bounded *physical atlas* half-open rectangle.
The Paint operation's `regions` are **face-local coordinates**.
Never exchange these coordinate spaces. The host checks that packet
atlas regions equal the exact authorized correction rectangles; its
pinned Rust `material_face_patch` read proves each rectangle belongs
to the named Cube face with no detected UV alias. The Rust guarded face
Paint and correction scope still enforce actual bitmap writes, Undo,
alpha/saved-source integrity and no changes outside the approved region.

The host refuses:
- a missing, forged/stale, unsupported or extra-field packet;
- a source SHA, reference SHA, part/issue/approach, material or reviewer
  observation that conflicts with the trusted reviewer and Rust model;
- face plans missing shadow/highlight placement for FORM_SHADING, duplicate
  faces/regions, malformed shade palette or unaccounted correction patches;
- raw atlas Paint or a Cube/face missing from the packet during reviewed
  FORM_SHADING samples or propagation; narrow non-FLAT_SHADING samples and
  unreviewed exact-RGBA edits retain the existing direct Paint path;
- arbitrary RGB not in the named palette, base-only FORM_SHADING paint,
  unsupported/shared/reused UV source and edits to the accepted sample.

A valid source plan is **SOURCE_BOUND_PLAN_NOT_ARTISTICALLY_VERIFIED**.
Its hash and planned-face count appear in the provisional Paint receipt.
The one trusted operator approval callback sees the plan SHA and a compact
summary; the image reviewer still has to inspect real fresh mapped
views, and only authorized native/user visual acceptance may declare
professional Texturing complete. In particular, a physically valid
face-local patch is not proof the light source or cluster outline is right.

The schema lives in `material-work-packet.mjs`, its type in
`material-work-packet.d.mts`. No packet is written to the editable
`.bbmodel`, automatically persisted as a second state store or supplied
by a privileged reviewer callback. Existing external Workspace and
reviewer findings carry continuing user corrections. The operator and
model client do not gain a new process/network/asset mutation capability.

### Sequence for a real artist-directed correction

```text
Fresh approved reference + current model snapshot
 → independent visual issue (part, source SHA, actual visual mismatch)
 → reviewer selects one bounded representative Cube face/atlas patch
 → agent proposes one-face FORM_SHADING MaterialWorkPacket (for flat-material defects)
 → host verifies issue, source, sample and exact saved Cube/UV
 → Rust guarded Paint under existing operator approval
 → new model SHA + actual image comparison of improved sample
 → reviewer authorizes broad, compatible material propagation
 → agent proposes new MaterialWorkPacket (form/light/palette/clusters/targets)
 → host binds the accepted sample, source and remaining Cube/UV faces
 → Rust guarded face-local Paint under existing operator approval
 → fresh mapped-view and all-face visual review
 → revised source packet only if evidence supports another correction
```

For intentional small identity pixels or approved flat surfaces, do not
fabricate a multi-color shade ramp. Preserve the existing exact-RGBA
path unless material-scale propagation is actually requested. This
packet currently structures and constrains authoring decisions; it
**does not autonomously compose the clusters** or execute an AI pixel
artist model. Those properties require independent material reference
review and future native visual evidence.


## Trusted image reviewer CLI wiring (SOURCE_ONLY, NOT EXECUTED)

The standard operator CLI now accepts optional `--visual-manifest` and
`--reviewer-exe` options. This **wires the existing reviewVisualPair host
callback to an operator-owned external image-capable process** without giving
the sandboxed Deno model code a filesystem, process or network capability.
It does **not** install a vision model, select a provider, generate native
captures, automatically send images to a service or establish that the
reviewer really interpreted the pixels.

Use only in an independently authorized PC-local phase after releasing the
current hold. Select an existing `.bbmodel`, an approved reference image and
fresh current-revision render(s); bind source SHA and per-view camera labels.
The operator-provided manifest is a regular JSON file with exactly:

```json
{
  "captureModelSha256": "<64 lowercase hex characters of the exact model>",
  "viewId": "front",
  "referencePngPath": "/absolute/operator-selected/front-reference.png",
  "capturePngPath": "/absolute/operator-selected/front-current.png",
  "supportingViews": [
    {
      "viewId": "back",
      "referencePngPath": "/absolute/operator-selected/back-reference.png",
      "capturePngPath": "/absolute/operator-selected/back-current.png"
    }
  ],
  "requireSixDirections": false
}
```

For broad propagation and the final review, set
`requireSixDirections:true` and provide actual front/back/left/right/top/bottom
image pairs, with an optional `three_quarter`. The example above is only a
single/partial review and **cannot** clear whole-material readiness.
The host checks the manifest, current model SHA, absolute PNG paths and
all actual PNG image hashes. It does not authenticate camera direction,
matching perspective or provenance based on a filename.

```sh
node apps/desktop/code-mode/run.mjs \
  --rust /absolute/path/to/lazydesigner-authoring \
  --deno /absolute/path/to/deno \
  --input /absolute/path/to/current.bbmodel \
  --code /absolute/path/to/authoring-code.js \
  --visual-manifest /absolute/path/to/operator-views.json \
  --reviewer-exe /absolute/path/to/trusted-image-reviewer
```

For any actual mutation, the existing `--approve-interactive` is still
required; selecting a reviewer never grants write permission. Supplying
only `--visual-manifest` supports a read-only source/view pairing with
`NOT_RECORDED` reviewer status. Supplying a reviewer executable without
a manifest is rejected.

### External reviewer subprocess contract

`trusted-visual-reviewer.mjs` launches the exact operator-selected executable
with `shell:false`, no model-supplied args and a deliberately minimal
environment. It sends a bounded UTF-8 JSON request on stdin:

```text
schema_version: 1
source_model_sha256
required_six_directions
source_face_inventory:
  scope: trusted_saved_cube_face_inventory
  source_model_sha256
  complete
  total_cubes
  faces: [{cube_uuid, face, texture_uuid, source_status}, ...]
views: [{view_id, reference_sha256, capture_sha256,
         reference_png_base64, capture_png_base64}, ...]
```

The inventory is gathered by the trusted host from the pinned Rust
`model_texture_coverage` inspector. It lets an image reviewer use real
Cube/texture identities instead of inventing UUIDs from image appearance.
It remains a *source face inventory*, **not proof a source face corresponds
to a particular camera pixel**. The bounded inventory reports
`complete:false` if more than 256 source faces or 256 Cubes cannot be
represented; missing/occluded faces must remain UNVERIFIED.

The reviewer must actually inspect the decoded reference and current PNG
bytes through its own visual-capable implementation. It writes one compact
JSON object to stdout (no logs or Markdown):

```json
{
  "schema_version": 1,
  "source_model_sha256": "<same SHA as request>",
  "view_bindings": [
    {
      "view_id": "front",
      "reference_sha256": "<exact SHA from request>",
      "capture_sha256": "<exact SHA from request>"
    }
  ],
  "review": {
    "decision": "UNVERIFIED",
    "issues": []
  }
}
```

Every selected view must have exactly one binding. The `review` object
uses `CodeModeVisualReviewerFeedback` from `host.d.mts`, including
per-direction findings, bounded `reviewedFaces`, or a diagnosis with
correction scope for a rejected material. Missing, mismatched, duplicate,
oversized, timeout and nonzero-process results fail closed. No stdout,
stderr, sensitive raw image or executable path is forwarded to the
untrusted guest. Echoed hashes are identity checks **not evidence of pixel
understanding**; host reviewer outcomes remain declarations pending
native/operator or user visual acceptance.

**Security and privacy:** an operator-selected executable runs under
the operator's operating-system permissions; it is not sandboxed by the
model's Deno restrictions. Only explicitly authorized, verified programs
may be used. The bridge itself does not send data over a network, but
an arbitrary reviewer executable may; do not select one that exports
confidential project images without independent authorization. The default
CLI makes no such selection, so its reviewer remains unconnected.

### Mandatory all-face completion gate

The reviewed Texturing checkpoint now requests the **full saved six-face
inventory** rather than only alpha-attention candidates. Every explicitly
active face, including fully opaque faces with no alpha warning, must match
an independently reviewed exact `cubeUuid + face + textureUuid` entry.
Declared absent faces are not styled; ambiguous/unmapped/unsupported faces
are blocked, and intentional transparency requires an observed exception.
Missing fully opaque faces are blocked as
`REQUIRED_SOURCE_FACES_UNREVIEWED`. Each accepted
`reviewedFaces` entry must cite `observedInViewId` from a selected,
independently accepted image pair. Before accepting that entry, the host
also checks its Cube, face and texture UUID against the SHA-bound Rust
source-face inventory. A camera label cannot create a nonexistent source
face; however, neither this lookup nor the label proves camera direction,
face visibility, image ingestion or artistic quality. There is no implicit PASS for
`measured_nontransparent_pixels`. The selected review array is capped at
256 faces and the scan at 256 Cubes: exceeding a bound stays BLOCKED,
never falsely complete. Full six-direction files alone do not prove each
hidden face was visually seen.

Source fixtures have been authored for both successful transport and
fail-closed negative cases; no tests, native captures or actual visual
reviewer have been run in ChatGPT/GitHub.


## Rust Texturing professional-quality read/finish checkpoint (2026-11-17; SOURCE_ONLY)

The guest can inspect real saved material pixels in correct Cube-local
orientation with `inspectBatch({requests:[{kind:'texture_styling_face',
texture_uuid,cube_uuid,face}]})`. This uses the existing signed/rotated
native Paint mapper, not a second editor, renderer or independent material
classifier. It highlights uniform visible colors, weak value, artificial
bands or high-transition noise as **candidates only**. Intentional flat
style, pixel-art clusters, protected identity and contact/edge shading
still require an actually viewed approved reference and mapped model image.
When a scoped Paint succeeds, its CLI receipt includes every permitted
rectangle and explicit NOT_EVALUATED gaps; the Code Mode host returns
`texturing_workflow.status='PAINT_SAVED_NOT_VISUALLY_ACCEPTED'`.

The trusted reviewer can also return `rejectedTreatments` from
existing authoritative Workspace/Reference continuity, with explicit
`{partId,material,treatment,failedAttempts,observation}` records.
Two failures for the same part/material/treatment family block another
reviewed Paint using that family even if the guest changes approachId.
Only a genuinely different remedy or new independently grounded diagnosis
should proceed. No cross-session memory store is created: a new trusted
host must be given the prior review history. Missing history must not
be described as successfully learned.

For a terminal decision, the model-facing guest calls
`codemode.texturingReadiness({project})` **after**
`codemode.inspectSelectedVisualPair({project})`, with the *same* current
SHA-bound model and full front/back/left/right/top/bottom image pairs.
The trusted `reviewVisualPair` callback must have actually inspected
those images and returned an overall ACCEPTED, ACCEPTED per direction,
plus `reviewedFaces` (up to 32) identifying each exact
`{cubeUuid,textureUuid,face,style,observation}`. The style is
`STYLED`, `INTENTIONAL_FLAT`, or `INTENTIONAL_TRANSPARENT`, and the observation must explain
the seen material/face at meaningful depth; this is never accepted from
model-written code. All unmeasured faces, malformed links, source coverage
gaps, falsely-STYLED flat faces, and unacknowledged invisible faces remain BLOCKED. The host SHA-rechecks
every selected image before decision and pages the existing model
texture coverage read (bounded to 256 Cubes; larger scans are partial).
Even a coherent checkpoint is **REVIEWER_DECLARED_READY_FOR_USER_DECISION**
not source-certified texture perfection, native PASS or user approval.
Selected reviewed faces are not proof every occluded face was seen.
No external image-capable reviewer, native renderer or PC-local validation
is connected by the default CLI; it returns BLOCKED in that mode.

The readiness scan also reconciles every saved-face source *attention*
candidate. A face with transparent/partial-alpha/unknown source evidence
cannot disappear from the final verdict simply because all six camera
labels were accepted. Each such face must match a reviewer-selected
`cubeUuid + face + textureUuid`; a fully transparent face specifically
requires an observed `INTENTIONAL_TRANSPARENT` declaration. An
unsupported/missing link or an unreviewed face remains BLOCKED. This
source inventory is distinct from image visibility: hidden surfaces
still need an actually observed close-up before artistic acceptance.
The scan is deliberately bounded; oversized models remain incomplete
rather than incorrectly PASS.

To approach professional pixel-art quality, the actual reviewer must
observe and communicate material-specific form shading, deliberate
connected shade clusters, meaningful hue shifts, protected identity,
quiet/detail balance, seams and intentionally flat surfaces. AI-authored
plans should use existing `paint_cube_face_regions_guarded` and current
approved references, not noise or a fixed number of palette colors as a
fake quality metric. Preserve the latest user correction and prior rejected
causal treatments from the trusted Workspace/Reference handoff; this
source does **not** create persistent review memory or an image model.
Scoped Paint may remain valid BASE work, but cannot close Texturing.

**State (2026-11-15):** HOST_SOURCE_AUTHORED, NOT_EXECUTED. The code path is implemented on Rust, but no Deno process, Rust binary, PC-local agent or native Blockbench has been observed running. Localtest and CI remain on hold.

### Operator-selected material baseline (source-only)

To compare an already accepted model texture with a new tier, the trusted
host may pass `approvedMaterialReferenceUuid: selectedExistingTextureUuid`
when creating the host. No model-written script may provide or override
the master UUID. The guest calls:

~~~js
const comparison = await codemode.inspectApprovedMaterial({
  project: codemode.initial.project,
  candidateTextureUuid: 'current-tier-2-texture-uuid',
  referenceRegion: {from:[0,0],to:[16,16]},
  candidateRegion: {from:[0,0],to:[16,16]},
});
~~~

The two regions must represent comparable material patches with the same
physical PNG dimensions. A real owner must choose matching regions; the
engine cannot infer semantic correspondence from UV positions. The host
injects its chosen master and source SHA into one strict Rust read. No
bitmap pixels or arbitrary file paths enter the guest. It returns limited
color-variation/alpha evidence and `visual_verdict: UNVERIFIED`.
`inspectBatch({kind:'material_pair'})` is intentionally blocked for guest
calls, and scoped paint cannot modify the selected master. Missing, stale,
unsupported or unselected reference state refuses instead of guessing.
Neither the host option nor the numeric stats confirm external reference
images were viewed or that a human actually approved the material.
### Operator-selected reference and current capture images (source-only)

The trusted host can optionally bind one explicitly selected PNG pair at startup:

~~~js
const host = await createCodeModeHost({
  rustBinary: verifiedRustBinary,
  denoBinary: verifiedDenoBinary,
  input: userSelectedBbmodel,
  // Provided only by the local operator, never model-generated code.
  preselectedVisualPair: {
    referencePngPath: '/absolute/path/approved-front.png',
    capturePngPath: '/absolute/path/current-front.png',
    captureModelSha256: verifiedSelectedModelSha256,
    viewId: 'front',
  },
  authorizeMutation: operatorOwnedApproval,
});
~~~

The guest calls `codemode.inspectSelectedVisualPair({project:'p0'})`.
No user image paths, bytes or raw pixels are returned to the guest.
The host hashes and fixes both selected images and the .bbmodel revision,
and the Rust `inspect-visual-pair` command verifies all three SHA values
before returning bounded alpha-overlap/pixel-difference diagnostics.
Only 8-bit RGB/RGBA still PNGs up to 2048px per side, 2,097,152 pixels
and 8 MiB compressed are accepted, with **equal exact dimensions**.
No scaling, image generation, camera reconstruction, segmentation,
untrusted image loading in Deno, model mutation or extra Gateway tool.
Output `visual_verdict: UNVERIFIED` is mandatory; an opaque background
does not produce a meaningful silhouette IoU. Model code cannot
claim human image approval, native capture provenance or matched framing.
The selected capture only applies to its pinned .bbmodel SHA; after an edit,
a new host/capture binding is required for the new project version.

If a pair is bound, Code Mode pixel corrections require one successful
same-revision `inspectSelectedVisualPair` preflight and the existing
Rust-enforced `correctionScope`. This confirms that source evidence was
obtained, **not** that the AI visually understood it. When the target lacks
matched external image evidence, the review must remain UNVERIFIED and
the existing accepted-asset contract is still open. Tests authored only.

### Operator-owned review of actual image pixels (source only)

A numeric `inspectSelectedVisualPair` preflight alone does **not** show images
to the AI. To attach actual visual feedback, the independently authorized Node
host may provide `reviewVisualPair` alongside `preselectedVisualPair`.
It receives **both original PNG Buffer objects**, SHA-256 identities, the
pinned `.bbmodel` SHA and selected view. No PNG or path is exposed to
model-authored Deno code; no second renderer or image recognition engine is
installed. A trusted human UI or separately authorized visual-capable host
adapter is responsible for actually showing those pixels to its reviewer.

~~~js
const host = await createCodeModeHost({
  ...trustedHostSettings,
  preselectedVisualPair: approvedPair,
  reviewVisualPair: async ({reference, capture, viewId, sourceModelSha256}) => {
    // Operator-owned UI/vision adapter must genuinely display both PNG buffers.
    // Example of its structured response AFTER independent visual inspection:
    return {
      decision:'REJECTED',
      issues:[{id:'helmet-flat',kind:'FLAT_SHADING',partId:'tier3-helmet',
        observation:'Helmet shading is flat relative to the approved master.'}],
      correctionScope:{
        textureUuid:'current-tier3-atlas',
        allowedRegions:[{from:[8,8],to:[20,28]}],
        preserveAlpha:true,
      },
      materialCohort:{phase:'sample',issueId:'helmet-flat',
        partId:'tier3-helmet',approachId:'form-following-metal',
        cubeUuid:'EXACT_REVIEWED_CUBE_UUID',face:'north',
        sampleRegion:{from:[8,8],to:[12,16]}},
    };
  },
});
~~~

Only `REJECTED` with bounded findings and an operator-chosen correction
scope allows further Code Mode pixel correction for that pinned snapshot.
The requested `correctionScope` must stay within a reviewer-permitted
rectangle and may not weaken required alpha preservation. `ACCEPTED`
protects the reviewed snapshot against further Paint, while `UNVERIFIED`
keeps Paint held until usable evidence is obtained. Editing another
asset/view requires separately selecting its exact source and images.
The ordinary independently authorized write approval is **still required**,
and Rust checks actual changed pixels/structure before mutation.

If the callback is absent, the former metadata-only behavior remains, with
`review_feedback.status='NOT_RECORDED'`; it grants no human-review claim.
A reviewer callback is never an automatic classifier. Its bounded decision
is a **host declaration**, not proof of agent image ingestion, native playback
or artistic PASS. Missing, contradictory, overlong, stale or untrusted feedback
must fail before granting correction authority. Review errors do not fall
back silently to numeric acceptance. Repeated review reads for the same
bound .bbmodel SHA reuse the first reviewer decision, and both selected
PNG files are freshly SHA-checked before any scoped Paint operation.
See [Pillager Golden A/B](GOLDEN_PILLAGER_AB.md) for the real
baseline/candidate evidence and rejection matrix. Source regression tests
are authored but not executed during the current CI/native hold.

### Representative sample gate for reviewed material work

An independently reviewed material treatment proceeds in two separate
snapshot-bound rounds. For the **first rejected sample**, the trusted
`reviewVisualPair` callback adds `materialCohort` to its feedback:

~~~js
return {
  decision:'REJECTED',
  issues:[{id:'helmet-flat',kind:'FLAT_SHADING',partId:'tier2-helmet',
    observation:'Helmet shading is still a flat band.'}],
  correctionScope:{textureUuid:'tier2-atlas',
    allowedRegions:[{from:[0,0],to:[16,16]}],preserveAlpha:true},
  materialCohort:{phase:'sample',issueId:'helmet-flat',
    partId:'tier2-helmet',approachId:'form-following-metal',
    cubeUuid:'EXACT_REVIEWED_CUBE_UUID',face:'north',
    sampleRegion:{from:[1,1],to:[5,5]}},
};
~~~

The guest must name the matching issue/part/approach in
`correctionIntent` and keep its `correctionScope` inside the reviewer
sample. For a reviewed `FLAT_SHADING` issue, the **first sample** must
also supply a source/reviewer-bound `materialWorkPacket` with
`shadingIntent:'FORM_SHADING'`, exactly **one** face plan on the
reviewer-selected Cube and face, and an atlas region equal to the
requested correction scope inside the sample. The packet describes
form/light causes and connected shadow/highlight clusters; omit
guest-supplied `operations`. The host compiles these into existing
Rust guarded face-local Paint, confirms exact saved Cube/UV ownership,
and refuses missing, wrong-source or wrong-face plans before approval.
The saved sample is still visually UNVERIFIED until a new matched
image review. Other exact identity/detail corrections retain direct Paint.
The host refuses broad edits despite their earlier approved
larger scope. Rust still checks actual changes before publishing.

To expand the treatment, first save the sample into a new `.bbmodel`,
then select a new **source SHA** and fresh matching render capture.
The independent reviewer must inspect the actual sample on the mapped
model and explicitly declare it accepted while leaving unfinished
regions REJECTED:

~~~js
materialCohort:{phase:'propagation',issueId:'helmet-flat',
  partId:'tier2-helmet',approachId:'form-following-metal',
  cubeUuid:'EXACT_REVIEWED_CUBE_UUID',face:'north',
  sampleRegion:{from:[1,1],to:[5,5]},sampleVerdict:'ACCEPTED'}
~~~

The host pins this declaration to the current source, reference/capture
PNG SHA and view; it refuses a missing/false sample approval, mismatched
identity or any new Paint rectangle intersecting the accepted sample.
The sample region is **atlas pixels**, not normalized source-picture
coordinates. The reviewer must separately establish corresponding
Cube faces/UV ownership; a single camera view does not satisfy
whole-model six-direction artistic QA. The two stages use the same
existing Code Mode tool, Rust model owner and independent write approval.

Source proof: regression tests written but NOT_EXECUTED under the local
validation hold. Reviewer callback declarations are not visual PASS.
#### Actual Rust Cube/UV binding and six saved face statuses

The reviewer must replace `EXACT_REVIEWED_CUBE_UUID` with the Cube's
actual saved UUID and choose a **Cube-local face**, not a camera view.
Code Mode now sends one SHA-pinned `inspectBatch` with
`material_face_patch` (texture UUID, Cube UUID, face, atlas rectangle)
and `cube_face_alpha` (all six saved faces of the selected Cube).
The Rust face binder reconstructs Box UV when applicable and refuses
unknown/implicit texture links, unsupported projections, out-of-face
patches and overlaps with another texture consumer. Failure stops
the reviewer-backed sample before Paint. No raw atlas PNG is returned.

The response carries `review_feedback.materialCohort.faceBinding` and
`review_feedback.face_source_evidence` (six face names, saved link types,
alpha status). Both explicitly retain `UNVERIFIED` for visual quality.
Alpha counts and mapped UV only confirm a saved-source property;
occluded or intentionally transparent faces need a real visual-review
decision. Six saved Cube faces do not imply six camera captures,
especially for rotated Cubes and inherited material settings.
To declare full art coverage, the real reviewer must inspect the
affected shaded front/back/side/underside views independently;
this source reader alone never authorizes whole-model completion.
### Multiple operator-selected rendered views (source-only)

To review more than one camera direction without conflating actual
rendering with saved Cube alpha faces, the trusted host adds view
pairs to the **existing** `preselectedVisualPair` object:

~~~js
preselectedVisualPair: {
  referencePngPath:'/operator/reference-front.png',
  capturePngPath:'/operator/current-front.png',
  captureModelSha256: verifiedSelectedModelSha256,
  viewId:'front',
  supportingViews:[
    {viewId:'back', referencePngPath:'/operator/reference-back.png',
      capturePngPath:'/operator/current-back.png'},
    {viewId:'left', referencePngPath:'/operator/reference-left.png',
      capturePngPath:'/operator/current-left.png'},
    {viewId:'right', referencePngPath:'/operator/reference-right.png',
      capturePngPath:'/operator/current-right.png'},
    {viewId:'top', referencePngPath:'/operator/reference-top.png',
      capturePngPath:'/operator/current-top.png'},
    {viewId:'bottom', referencePngPath:'/operator/reference-bottom.png',
      capturePngPath:'/operator/current-bottom.png'},
  ],
  requireSixDirections:true,
}
~~~

These are **real operator-selected images**; the host does not
produce, rotate, label or authenticate screenshots for the user.
Each source and capture is independently hashed and inspected via
the existing SHA-bound Rust PNG comparator. Duplicate/unsupported
view identifiers or incomplete cardinal sets fail before guest
execution. Maximum total: seven view pairs (six cardinal plus
optional three-quarter); single-view remains the default.

`reviewVisualPair` now receives its existing primary image buffers
plus `supportingViews`, each containing actual reference/capture
buffers and SHA IDs, with `requiredSixDirections`. For two or
more selected views, an independent reviewer must return the
normal overall decision **and** one `viewReviews` item per view:

~~~js
viewReviews:[
  {viewId:'front',decision:'REJECTED',
    observation:'The helmet highlight is still a flat band.'},
  {viewId:'back',decision:'ACCEPTED',
    observation:'Rear metal shading matches this selected reference.'},
  {viewId:'left',decision:'ACCEPTED',
    observation:'The left-side material is intentionally preserved.'},
  {viewId:'right',decision:'ACCEPTED',
    observation:'Right-side sampled material is visibly consistent.'},
  {viewId:'top',decision:'ACCEPTED',
    observation:'Top face material was actually inspected.'},
  {viewId:'bottom',decision:'UNVERIFIED',
    observation:'Bottom face is still occluded in the current capture.'},
]
~~~

The above is a **contract example**, not evidence that the actual
Pillager renders were reviewed. An overall ACCEPTED decision is
invalid while any selected view is rejected or unknown. Rejected
material can still receive a bounded representative patch, but
**propagation** requires all six operator-selected cardinal directions,
with a declared review for each. A missing cardinal direction or
an independently observed, source-fresh review is available. Identical
reference/capture paths under multiple view labels are rejected;
separate file paths still do not authenticate actual camera orientation.
An ACCEPTED view is only a reviewer declaration about that
selected image/view, not Minecraft or Blockbench material PASS.

The `inspectSelectedVisualPair` receipt preserves its original primary
`comparison` and adds `view_evidence` (per-view source/capture SHA,
source revision and UNVERIFIED visual quality) plus `view_scope`.
`review_feedback.viewReviews` contains validated **declarations**.
Do not confuse `six_cardinal_source_pairs_selected` with verified
camera calibration or finished-art acceptance. The separate
`face_source_evidence` still describes six saved Cube faces from
Rust, never screenshots. Replacing any selected PNG after review
refuses Paint before approval. No new renderer, image database or
guest-visible filesystem capability is introduced.
## Programmatic execution architecture

~~~text
Verified local agent (Codex CLI/IDE or another user-selected host)
  → ONE model-visible tool: lazydesigner_code_mode({ code })
  → trusted Node host: host.mjs / createCodeModeHost
    → fixed Deno guest: sandbox-worker.mjs (zero --allow-* grants)
       → model-written JavaScript orchestrates codemode.* RPC
    ← bounded read/transaction receipts, not raw files
    → host-owned permission and per-write user approval
    → first-party lazydesigner-authoring Rust CLI
       → canonical AuthoringDocument + EditorSession + PNG/UV codec
       → no-overwrite sibling .bbmodel, PNG or .geo.json
    ← source SHA, revision and affected UUID receipts
~~~

Model-written code is executed by the restricted Deno subprocess, **never** evaluated inside Node, Tauri/WebView or the Rust engine. The guest has no direct filesystem, network, subprocess, model path or arbitrary CLI command capability. Only the trusted host selects the Rust executable, initial model and optional PNG import path.

## Implemented source owners

| Source | Responsibility |
| --- | --- |
| client.mjs / client.d.mts | Typed CLI methods, SHA-bound reads, atomic Rust plans, per-write approval |
| host.mjs / host.d.mts | Host-owned project handles, one-tool descriptor, RPC, output filename boundary |
| sandbox-worker.mjs | Restricted JavaScript program execution with codemode.* RPC |
| run.mjs | Read-only operator CLI by default; opt-in interactive per-write confirmation |
| client.test.mjs / host.test.mjs | Regression source only; tests NOT_EXECUTED |
| sandbox.integration.test.mjs | Held real-Deno permission/denied-write regression source; NOT_EXECUTED |
| Rust authoring + CLI | Sole model state, validation, Undo, PNG decoder and no-overwrite publisher |

## Trusted host integration

A local host needs actual verified absolute paths to Deno and the compiled first-party Rust CLI, plus **either** an existing user-selected model **or** an authorized empty-model output directory. It must implement authorization outside the model-generated program.

~~~js
import { createCodeModeHost, createCodeModeTool } from './host.mjs';

// Supplied ONLY by a trusted operator/agent host:
const host = await createCodeModeHost({
  rustBinary: verifiedRustBinary,
  denoBinary: verifiedDenoBinary,
  input: userSelectedBbmodel,  // OR outputDirectory: approvedDirectory
  authorizeMutation: operatorOwnedApproval, // omit for read-only
  // Optional operator-selected input, not an arbitrary guest path:
  // preselectedPngPath: selectedPng,
});
const tool = createCodeModeTool(host);
// Register the one plain tool descriptor with the real agent host.
// This does not install an MCP service or bypass host permissions.
~~~

The only model-visible tool argument is a JavaScript code string (at most 32 KiB). TypeScript type declarations are for authoring; the guest executes JavaScript, not arbitrary TypeScript syntax.

### Model-authored Code Mode example

~~~js
const source = codemode.initial.project; // p0: bound to a SHA
const scan = await codemode.inspectBatch({
  project: source,
  requests: [
    { kind: 'catalog', category: 'cubes', limit: 8 },
    { kind: 'audit' },
  ],
});
const cube = scan.results[0].catalog.entries[0];
if (!cube?.uuid) return { status: 'NO_CUBE' };

// Requires independently approved mutation by the host:
const saved = await codemode.apply({
  project: source,
  output: 'candidate-edit.bbmodel', // fresh sibling NAME, not a path
  operations: [
    { op: 'translate_cube', uuid: cube.uuid, delta: [1, 0, 0] },
  ],
});
const review = await codemode.inspectCubeSurfaces({
  project: saved.project, uuid: cube.uuid,
});
return {
  output_sha256: saved.sha256,
  mutation: saved.receipt.mutation,
  source_surfaces: review.surfaces,
  visual_verdict: 'UNVERIFIED',
};
~~~

When bootstrapping from an output directory, the guest starts with a null initial project handle and must call newModel to create the first .bbmodel; the returned handle is p0. When opening an existing project, codemode.initial.project starts at p0. Each successful New, Apply or Import PNG returns a new opaque project handle and pinned file SHA. The guest cannot open arbitrary files. The model does not own a separate in-memory scene. It can call the following bounded host methods: projectInfo, inspect, catalog, inspectBatch, inspectCubeSurfaces, inspectCubeFaceAlpha, inspectTexture, inspectTextureAlpha, inspectAnimation, inspectAnimationTrack, inspectAnimationTransformTrack, audit, newModel, apply, importPng, exportPng, exportGeometry.

For importPng, the PNG path must be **preselected by the trusted host**. The guest may supply a new model sibling name, texture UUID and name, but cannot read arbitrary PNG paths.

## Operator CLI (source-authored; not run)

The desktop package adds the command: npm run code-mode:run -- [arguments].

~~~text
node code-mode/run.mjs --rust <absolute-first-party-cli> \
  --deno <absolute-deno-binary> \
  --input <absolute-approved-model.bbmodel> \
  --code <absolute-model-javascript-file>
~~~

For an existing source, supply --input <absolute.bbmodel>. For New-model bootstrap, replace --input with --output-dir <absolute-existing-directory>; **exactly one is required**. By default, all writes are refused. Optional --approve-interactive requires a real TTY and asks for a new challenge response for every exact write, showing target, source SHA, operation kinds/count and plan digest. A TTY can be spoofed by a sufficiently privileged agent; interactive confirmation is a UX guard, **not** cryptographic identity proof. For stronger host integration use a permission mechanism controlled outside the generated code. The operator can add --png followed by an absolute, separately selected import path.

**Approved material master at the CLI boundary (source only, NOT_EXECUTED):**
With an existing `--input` model the trusted operator may specify
`--approved-material-reference-uuid <existing-texture-uuid>`. The
operator-owned value is passed to the existing
`approvedMaterialReferenceUuid` host option; it is never read from
model-authored JavaScript. `inspectApprovedMaterial` uses that one
reference UUID against the current SHA-bound model, while scoped Paint
cannot target the selected master and other Paint still requires a
correction scope. The operator must verify that the UUID belongs to
the actual approved texture; the host now verifies exact occurrence in
the SHA-bound saved Rust texture catalog before guest execution. This
source-identity check does not prove user acceptance or artistic style. The flag is invalid with
`--output-dir`. It does not protect unrelated Geometry operations,
prove artistic match or grant write authorization. CLI argument
regression is authored, not executed; existing host reference guards
remain the actual enforcement owner.

No automatic installation or download of Deno/Rust is performed. The user-PC host and its actual executable versions must be verified only in the separately authorized local phase.

## Security, limits and proof ceiling

### Session concurrency and delayed approval

A trusted host runs **one Code Mode guest at a time**. Attempts to overlap
`host.execute` calls fail with `CODE_MODE_HOST_BUSY`; this prevents project
handle/permission races across concurrent sessions. The guest's active
90-second execution timer pauses only while a trusted operator approval is
pending. That approval itself has a bounded 10-minute ceiling. A late approval
is invalid once the guest exits or times out. Guest termination during a
pending RPC returns `CODE_MODE_OUTCOME_UNKNOWN_PENDING_RPC`, and the host
must inspect current files rather than automatically retry a mutation. A
source-authored regression covers both overlapping calls and approval
completion after guest termination; neither test has been executed.

**Write-launch lease closure:** Approval is attached to the exact source
operation descriptor and guest execution identity. After a trusted host
approves the request, the SDK may still perform asynchronous plan-file I/O.
Immediately before invoking a mutating Rust CLI command, a synchronous
`permitWriteLaunch` check consumes the approved descriptor and rejects it
if the original guest has ended or been replaced. This closes the
approval-to-spawn time-of-check/time-of-use gap without turning approval
into a reusable token. The check is host-owned and is never exposed to
model-authored code. Regression source is AUTHORED_NOT_RUN.

The **Deno permission model is not a certified hostile-code isolation layer**.
Before running independently supplied untrusted scripts, the eventual
PC-local host must provide and verify suitable OS/process containment and
maintain the exact no-permissions Deno invocation. This source hardening
does not release the repository's test/CI hold.

- Deno subprocess flags: run --no-config --no-lock --no-npm --no-remote --no-prompt, with NO --allow-* grants. The guest cannot spawn the Rust CLI itself.
- Host RPC is fixed and bounded: at most 64 calls, 16 project handles, 128 KiB per message, 1 MiB cumulative stdout, 4 KiB guest stderr, 32 KiB final result and 90 seconds per run. Existing Rust model read/plan limits apply independently.
- The trusted host validates fresh same-directory output filenames, relies on Rust SHA/revision/no-overwrite gates and requires an externally supplied authorizeMutation callback for every write. Uncertain/timeout effects are never automatically replayed.
- The guest receives no inherited agent tokens, HOME or network permissions. The model can author programmatic JavaScript but cannot access arbitrary host files or issue arbitrary shell commands through codemode RPC.
- **Source isolation design is not an executed security audit.** Deno's permission model has limitations for adversarial code and should be supplemented with verified OS isolation as needed. Never grant allow-run or allow-ffi to the guest. Original guidance: https://docs.deno.com/runtime/fundamentals/security/ and https://docs.deno.com/runtime/reference/permissions/ .
- The source still cannot prove actual painted-face/occlusion fidelity, Blockbench format parity, advanced UV/Molang/animation features, or artistic quality. Visual PASS requires appropriate native observation and user review, not a SHA or alpha histogram.

**Proof:** SOURCE_REVIEWED / SOURCE_COMMITTED after the authorized GitHub commit, tests AUTHORED_NOT_RUN, LOCAL_TEST_DEFERRED. No cloud CI, hosted sandbox, release, main/Local writes or installed runtime claim.

## Comparison to upstream Code Mode

Cloudflare's Code Mode runs generated JS in an isolated Dynamic Worker and calls host tools by RPC: https://developers.cloudflare.com/dynamic-workers/examples/codemode/ . This repository implements the same **one-tool programmatic orchestration pattern** in a local Deno guest with the existing Rust CLI, not Cloudflare Worker Loader or hosted inference. Its published performance numbers are not LazyDesigner measurements. Node's permission model is not considered a malicious-code sandbox: https://nodejs.org/api/permissions.html .

Related owners: Rust migration contract at ../../docs/04-system/code-mode-migration.md ; current proof at ../../docs/05-operations/current-validation.md ; next action at ../../docs/05-operations/next-action.md .

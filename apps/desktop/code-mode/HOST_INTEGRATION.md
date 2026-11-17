# Rust Code Mode — first-party local host integration

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
`REQUIRED_SOURCE_FACES_UNREVIEWED`. There is no implicit PASS for
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
sample. The host refuses broad edits despite their earlier approved
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

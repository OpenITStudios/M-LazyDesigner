# Rust Code Mode — first-party local host integration

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
      issues:[{id:'helmet-flat',kind:'FLAT_SHADING',
        observation:'Helmet shading is flat relative to the approved master.'}],
      correctionScope:{
        textureUuid:'current-tier3-atlas',
        allowedRegions:[{from:[8,8],to:[20,28]}],
        preserveAlpha:true,
      },
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
back silently to numeric acceptance. Source regression tests are authored but
not executed during the current CI/native hold.

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

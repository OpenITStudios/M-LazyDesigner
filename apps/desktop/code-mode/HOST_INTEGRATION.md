# Rust Code Mode — first-party local host integration

**State (2026-11-15):** HOST_SOURCE_AUTHORED, NOT_EXECUTED. The code path is implemented on Rust, but no Deno process, Rust binary, PC-local agent or native Blockbench has been observed running. Localtest and CI remain on hold.

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

When bootstrapping from an output directory, the guest starts with a null initial project handle and must call newModel to create the first .bbmodel; the returned handle is p0. When opening an existing project, codemode.initial.project starts at p0. Each successful New, Apply or Import PNG returns a new opaque project handle and pinned file SHA. The guest cannot open arbitrary files. The model does not own a separate in-memory scene. It can call the following bounded host methods: projectInfo, inspect, catalog, inspectBatch, inspectCubeSurfaces, inspectCubeFaceAlpha, inspectTexture, inspectTextureAlpha, inspectAnimation, inspectAnimationTrack, audit, newModel, apply, importPng, exportPng, exportGeometry.

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

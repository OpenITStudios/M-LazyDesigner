# LazyDesigner Rust Code Mode — source-only agent bridge

**Status:** Rust-branch source integration; local JS host, Rust executable, and native editor **NOT_EXECUTED**. This is a Code Mode *client-side programmatic API*, not an installed server-side Cloudflare Worker sandbox and not a claim of accepted end-to-end asset production.

## Decision and ownership

Use one code-execution entry at the **agent host** (Codex CLI or another authenticated, explicitly authorized PC-local host) to write JavaScript/TypeScript which composes calls to `createRustCodeModeClient`. The SDK calls the existing first-party headless `lazydesigner-authoring` binary without `shell`, and Rust alone owns validation, model state, transaction atomicity, Undo/Redo, and non-overwriting publication.

No `eval`, `node:vm`, untrusted remote JS endpoint, cloud Worker loader, implicit filesystem permission, or new model engine is introduced. **This SDK is not an execution sandbox.** The host must enforce code execution, filesystem access, and mutation authorization. Do not run generated scripts with unrestricted Node privileges as a substitute for an approved host. The SDK only restricts its own CLI arguments and payloads.

## Compact API (types in client.d.mts)

The SDK is ready for a **host-provided** Code Mode program. `openRustCodeModeProject` binds a path and observed file SHA-256 so later writes cannot silently target a changed source. Normal inspection is read-only:

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

### API behavior

- `inspect({input})`: summary + source SHA.
- `catalog({input,kind,offset,limit})`: paginated Cube/Bone/Texture/Animation identities, with 1–64 results per page.
- `inspect({input,uuid})`: focused Cube/Bone fields, not full model JSON.
- `inspectTexture({input,index})` / `inspectAnimation({input,uuid})`: bounded metadata only, with no bitmap/opaque animation payload.
- `audit({input})`: source-derived face-reference, source-type, rig and clip counts. `visual_verdict` remains `UNVERIFIED`: count-based QA does not establish texture coverage, silhouette fidelity or animation correctness.
- `openRustCodeModeProject(client,input)`: path/SHA-bound helper that exposes the same reads plus preconditioned output methods. It **does not** cache a mutable model in JavaScript.
- `apply`: one existing Rust transaction (1–128 operations, at most 64 KiB) against an opened CLI document revision 0 and an exact source SHA; a private plan file is created only after host approval.
- `importPng`, `exportPng`, `exportGeometry`: first-party CLI operations and non-overwriting output. Never auto-retry after unknown outcome.

See [local agent host integration](HOST_INTEGRATION.md) for required sandbox and approval boundaries.

## Transition boundary

This is the first functional Code Mode adapter on `Rust`. Existing Blockbench-based `Local` Gateway and all specialist Skills remain intact. Do not call Code Mode a complete replacement until the adapter is integrated into the actual agent host, focused reads/edits cover required asset workflows, full format/cross-mode parity is verified and measured acceptance shows no regressions. No deployment, dependency installation, editor UI rewrites, or local tests are performed by the GitHub source phase.

Official pattern references: https://developers.cloudflare.com/agents/tools/codemode/ ; https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/ . Cloudflare's Worker-based sandbox is a **different** implementation; do not copy its token saving figures as LazyDesigner measurements.

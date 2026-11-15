# LazyDesigner Rust Code Mode — source-only agent bridge

**Status:** Rust-branch source integration; local JS host, Rust executable, and native editor **NOT_EXECUTED**. This is a Code Mode *client-side programmatic API*, not an installed server-side Cloudflare Worker sandbox and not a claim of accepted end-to-end asset production.

## Decision and ownership

Use one code-execution entry at the **agent host** (Codex CLI or another authenticated, explicitly authorized PC-local host) to write JavaScript/TypeScript which composes calls to `createRustCodeModeClient`. The SDK calls the existing first-party headless `lazydesigner-authoring` binary without `shell`, and Rust alone owns validation, model state, transaction atomicity, Undo/Redo, and non-overwriting publication.

No `eval`, `node:vm`, untrusted remote JS endpoint, cloud Worker loader, implicit filesystem permission, or new model engine is introduced. **This SDK is not an execution sandbox.** The host must enforce code execution, filesystem access, and mutation authorization. Do not run generated scripts with unrestricted Node privileges as a substitute for an approved host. The SDK only restricts its own CLI arguments and payloads.

## Compact API (types in client.d.mts)

```js
import { createRustCodeModeClient } from './client.mjs';

const ld = createRustCodeModeClient({
  binary: '/absolute/path/to/lazydesigner-authoring',
});
const model = await ld.inspect({ input: '/absolute/path/to/model.bbmodel' });
const part = await ld.inspect({
  input: '/absolute/path/to/model.bbmodel',
  uuid: 'an-existing-cube-or-bone-uuid',
});
const next = await ld.apply({
  input: '/absolute/path/to/model.bbmodel',
  output: '/absolute/path/to/model-next.bbmodel',
  expectedSha256: model.sha256,
  operations: [{
    op: 'translate_cube', uuid: part.element.uuid, delta: [1, 0, 0],
  }],
});
console.log({ nextSha: next.output_sha256, changed: next.mutation.changed_uuids });
```

The example is **illustrative, not executed**: an actual project, UUID, approved mutation and installed binary are prerequisites. A mutation must not automatically replay after an unknown process result; inspect the source/output state first.

- `inspect({input})`: summary plus source SHA.
- `catalog({input,kind,offset,limit})`: bounded, paginated Cube/Bone/texture/animation identities (≤64 entries per request) for discovering imported asset IDs without loading the whole model.
- `inspect({input,uuid})`: bounded focused Cube/Bone state, not full model/blob echo.
- `inspectTexture({input,index})` / `inspectAnimation({input,uuid})`: bounded metadata only. Embedded bitmap data and opaque animation JSON are never echoed.
- `newModel`, `apply`, `importPng`, `exportPng`, `exportGeometry`: wrappers over existing Rust CLI commands; always explicit paths and preconditions.
- `apply`: a bounded array of existing Rust `EditOperation` variants as one transaction, against `expected_revision:0` for a newly opened CLI session. The CLI enforces the source SHA again and publishes a new sibling without overwrite.
- `runner`: test-only or trusted-agent-host call seam; it **does not** make an arbitrary script secure.

## Transition boundary

This is the first functional Code Mode adapter on `Rust`. Existing Blockbench-based `Local` Gateway and all specialist Skills remain intact. Do not call Code Mode a complete replacement until the adapter is integrated into the actual agent host, focused reads/edits cover required asset workflows, full format/cross-mode parity is verified and measured acceptance shows no regressions. No deployment, dependency installation, editor UI rewrites, or local tests are performed by the GitHub source phase.

Official pattern references: https://developers.cloudflare.com/agents/tools/codemode/ ; https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/ . Cloudflare's Worker-based sandbox is a **different** implementation; do not copy its token saving figures as LazyDesigner measurements.

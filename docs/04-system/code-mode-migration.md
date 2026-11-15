# Code Mode migration — Rust-native LazyDesigner

**Source extension (2026-11-15):** The first Code Mode SDK now supports paged `catalog` reads (Cube/Bone/Texture/Animation UUID/index discovery; 1–64 items) and metadata-only `inspectTexture` / `inspectAnimation` calls. Rust projects source SHA with every query but does not expose raw texture images or opaque Animation content. This enables model-written code to discover imported model identities before a targeted edit; source regressions AUTHORED_NOT_RUN.

**State:** `SOURCE_IN_PROGRESS` on `Rust`, 2026-11-15. No executable/native PASS claimed.

## Product decision and boundary

The maintainer explicitly requested a full Code Mode transition while the independent Rust editor is unfinished. The target is **Code Mode as the default AI composition pattern** for Rust: the agent writes JS/TS that composes typed API calls; the authorized host executes the program under host-owned security; the **single Rust AuthoringDocument** retains semantic authority, validation, revision, Undo/Redo and storage.

```text
Reference + user intent + active model Skill
  -> user-authorized PC-local agent code host
  -> JS/TS code composition (host sandbox and permissions)
  -> apps/desktop/code-mode/client.mjs (typed SDK; not a sandbox)
  -> first-party lazydesigner-authoring CLI
  -> Rust EditorSession / AuthoringDocument
  -> new non-overwritten .bbmodel / PNG / Bedrock geometry
  -> bounded receipt + fresh focused inspection + native/user visual QA

Human Svelte / Tauri -> same Rust core and asset formats.
Legacy Local: Gateway -> Runtime -> Blockbench (preserved separately).
```

Programmatic use does not imply a new model engine, second document registry, or a remote API server.

## Source-integrated first slice

- [Code Mode client](../../apps/desktop/code-mode/README.md): `createRustCodeModeClient` exposes `newModel`, `inspect`, `apply`, `importPng`, `exportPng`, `exportGeometry`; `client.d.mts` declares the complete supported Rust operation union. The SDK calls the existing CLI via `execFile` with `shell:false`, a bounded timeout/output, and absolute paths.
- CLI `inspect --input ... --uuid ...` now returns compact Cube/Bone transforms, parent UUID, per-face UV and texture references, and file SHA. It **does not** send embedded image bytes, opaque extensions, whole model JSON or a duplicated asset store. Existing `inspect --input` remains available.
- Mutations use one Rust `EditPlan` (1–128 operations, ≤64 KiB) with source SHA precondition and exclusive new sibling publish. On failure/timeouts, no automatic replay; inspect resulting state first.
- Node/Rust regression cases were authored for focused reads, argument/plan bounding, no mutation from inspection, no false success and SHA errors. **NOT_EXECUTED** under the current hold.

## Migration coverage and explicit gates

| Domain | Source present | Remaining before Code Mode cutover |
| --- | --- | --- |
| Geometry | Rust typed Cube/Bone operations and focused read | Complete inspection/diff/diagnostics and native Blockbench interoperability |
| UV/Texturing | Bounded PNG/face operations | Coverage proof for all visible/hidden sides, advanced texture consistency and pixel fidelity |
| Animation | Existing Rust rotation keyframe operations | Broader channels, playback/effects fidelity, safe export and native replay |
| Quality | Existing Skills and inspection references preserved | Representative model tasks, 6-angle+close-up review, user acceptance |
| Security | Typed CLI bridge, no in-process JS eval, Rust guards | Host sandbox/permission proof, cancellation and uncertain-outcome recovery |
| Efficiency | Compact result projection and programmatic batching | Actual tokens, latency, retries, corrections and cost per accepted asset |

**Compatibility:** The established Blockbench-hosted `Local` product, 4-tool Gateway, Control routing, installer, 12 project Skills and assets remain untouched. No blanket deletion, auto-branch, release, cloud Worker dependency or remote test runner. The new direction is allowed only on `Rust`. A later migration may retire old routing **only** after parity, safety and native acceptance are demonstrated.

**Security:** The SDK is *not* a sandbox. Do not execute arbitrary AI-generated code with unrestricted Node privileges; the real agent host must restrict code execution and issue explicit approvals for mutations. Node `vm` is not a security boundary. Cloudflare's official Code Mode Worker Loader is an isolated hosted execution solution and is not installed into this standalone native editor.

**Evidence:** CI and PC-local testing remain on hold. Static source review and authored-but-not-executed regressions do not prove that Code Mode is available to the installed agent, improve model quality or reduce measured tokens. Cloudflare's reported token savings for 2,594 endpoints do not transfer to LazyDesigner's already compact Gateway.

## Original sources

- Cloudflare Code Mode overview: https://developers.cloudflare.com/agents/tools/codemode/
- Cloudflare Worker-based MCP Code Mode implementation: https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/
- Anthropic programmatic tool calling: https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling
- Node VM security warning: https://nodejs.org/api/vm.html

**Current state owners:** [Rust editor architecture](rust-native-editor-plan.md), [next-action](../05-operations/next-action.md), [current-validation](../05-operations/current-validation.md).

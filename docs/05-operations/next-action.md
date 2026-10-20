# LazyDesigner Next Action

This file owns continuation only. Proof interpretation: [current-validation.md](current-validation.md). History remains in Git, including the complete pre-modernization record at `48329d013222c841dfe60477b4a3f59030befbaf`.

## Next REMOTE_GITHUB work

Current user direction: modularize and tidy source before testing; defer benchmark execution and collect validation after the structural work. Desktop lifecycle separation starts from `5f04c301` in the isolated checkout. `connectionMonitor.ts` owns passive probe scheduling, stale authority and disposal; `managedProgress.ts` owns asynchronous listener cleanup; `desktopFixtures.ts` owns development-only presentation fixtures. App composes them with one unmount cleanup. Regression consumers are updated, but tests/typechecks/build/native execution for this batch are deliberately NOT_EXECUTED; do not reuse earlier PASS as acceptance of this refactor.

Previous UV repair `5f04c301` is complete: required UV scope remains explicitly unavailable; no empty-evidence CLEAR or correction-loop entry. Its 73 targeted tests, 282 repository tests, typechecks and generated freshness passed before this new batch. Native UV quality remains NOT_EXECUTED. The existing [Batch 0 audit](../../mcp/docs/FLOW_MCP_BATCH0_AUDIT.md) owns remaining quality/cost findings.

Next: continue separating Desktop project/editor actions and managed-maintenance actions by responsibility, keeping shared operation admission and existing Rust safety checks intact. Do not create a parallel state store, generic action framework or new Runtime. After structural cleanup, run grouped frontend typechecks/build plus affected lifecycle/repository regressions, then prepare the existing fixed-reference authoring benchmark through accepted result and save/reopen. Native mutation remains a separately selected disposable asset operation.

Prior dependency/process-scan efficiency work is complete; its measured report and proof boundaries remain in current-validation.md. CI DISABLED: nine verification definitions live only in `.github/disabled-workflows/`; manual distribution/release definitions are not authorization to release. Do not enable or dispatch Actions, modify main, or publish packages.

## Compatibility and security residue

TypeScript 7.0.2 checks source; TypeScript 6.0.3 remains for Svelte diagnostics and the development symbol-map compiler API. Blockbench typings 5.2.1 use BBAnimation/BBKeyframe; Electron is typing-only and must satisfy upstream's range. Nested TypeScript 5.9 remains upstream-owned. Node types stay on supported Node 24.

Bun audit reports one low Vue 2 advisory through exact upstream typings dependency. Do not override Vue to an incompatible major. Cargo audit reports no classified vulnerabilities, one unmaintained warning and one glib unsound warning; both are absent from the locked Windows graph, without advisory ignores. rand 0.10.3, rfd 0.17.2, sha2 0.11.1 and sysinfo 0.39.6 are migrated and tested. Rust minimum is now 1.95; the pinned toolchain stays 1.99.1. Native UI behavior still requires matching installed acceptance.

## System boundaries

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness, Runtime/Plugin owns native Blockbench state. Geometry/Texturing share AUTHORING; AUTHORING/Animation handoff remains explicit. Public Gateway: status, search_capabilities, describe_capability, invoke_capability.

Only the canonical generators may update these artifacts: API docs, hybrid schemas and runtime prompts. Use `bun run generate:owned-artifacts` only when inputs change, then `bun run docs:check`. No second engine, router, shadow registry or progress archive.

## Local/native residue and STOP

Windows source/package proof does not establish LIVE_BLOCKBENCH acceptance. LD-Q01 silhouette, LD-Q02 atlas seams, LD-Q03 rotated pivots and LD-Q04 animation restoration stay open; native sampler remains blocked. Particle playback, reference fidelity, Golden F and real token/cost evidence remain unverified. Follow [the native acceptance runbook](local-acceptance-runbook.md) only with matching installed build identity and an authorized disposable project. Native
and visual checks remain NOT_EXECUTED until actually observed.

Installed native acceptance remains NOT EXECUTED on the upgraded source.

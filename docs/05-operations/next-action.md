# LazyDesigner Next Action

This file owns continuation only. Proof interpretation: [current-validation.md](current-validation.md). Git owns history; test structure belongs to [test-architecture.md](../04-system/test-architecture.md).

## Next REMOTE_GITHUB work

User-approved integration repair (2026-10-21): managed release discovery now pins `OpenITStudios/M-LazyDesigner` and separately accepts the exact prior repository identity only for locally verified historical packages; remote update manifests must be canonical, with full checksum/source/release checks retained. Desktop readiness now distinguishes a detected Gateway PID + ready Blockbench Runtime from an actual MCP handshake: `gateway-detected` is not `healthy`, `ensure_ready` reports `RUNTIME_READY` with `MCP_SESSION_UNVERIFIED` when applicable, and UI prompts verification in the AI client. New source/behavior regressions were added to existing tests; they are NOT EXECUTED. No live session, Windows install, publication, main change or CI dispatch performed. Current exact-HEAD Bun/Rust/TS/Svelte/source packaging proof remains outstanding.

User resumed bounded GitHub-only Desktop source cleanup on 2026-10-21. First batch `73ec4c3`: existing `desktopPresentation.ts` owns ProjectNavigator's pure search/recent/continue selectors and the view caches reactive projections. Its copied selector body passed a TypeScript 5.8.3 check and six Node 22 assertions in an isolated harness, NOT the repository Bun/Svelte/Windows gates. Current batch: App's eleven equivalent action-feedback resets now share one local `clearActionFeedback` function, with mechanically reversible transformation retaining call order and native IPC authority. No live UI, native authoring, manual Actions, release or main changes are authorized. Bun human UI/repository regressions, Desktop TS6/TS7 checks, frontend build and installed Blockbench acceptance remain NOT EXECUTED for these heads. Require executable exact-SHA validation before expanding behavior changes. Prior source repair `d334106e`, grouped proof `ba4ed7f3`, handoff `5fce24e2`.

User explicitly included the older checkout in the GitHub handoff. Reconciliation retains current source: legacy animation deletion/export/atlas-resize changes already landed in `12f8bb29`, `63b2985b`, `727bcee6` and later fixes; do not copy older source/tests/generated files over them. Forty incoming files (13,507,910 original bytes) are preserved (text follows repository LF conventions): Voidtide, ten Citadel sources, five hologram JSON/PNG pairs, delivery ZIP and motion experiments/references. Root GIFs move under experiments/asset-motion/references. ZIP: 87 entries, 86 manifest checksums verified; SHA256 matches saved inventory. Retain all 438 crimson-sentinel files present in Local despite their absence in the old checkout. Original PC checkout remains untouched. Caches/dependencies/build outputs are excluded; native acceptance, authoring benchmarks and asset mutation remain paused.

Grouped source validation is complete on `ba4ed7f3` for the prepared cleanup batches: repository 296 PASS; focused regressions 163 PASS; MCP/Gateway typechecks, Desktop TS6/TS7 checks (zero warnings), generated freshness and frontend/plugin builds PASS. See current-validation.md for exact scope and exclusions. Initial validation defects were repaired without weakening gates. This is not verify:full or native/UI acceptance.

Frontend interaction pass on `d334106e` used the actual Svelte UI with official Tauri mockIPC and synthetic projects at 1280x720. Fixed clipped project actions, missing modal focus restoration and busy Tab escape. Browser verified filter/list/scroll persistence (1235px), initial Cancel, keyboard wrapping, Escape restoration, busy containment and failure feedback. Repository 296 PASS, both Desktop checks zero warnings, frontend build PASS. This is browser frontend proof, not native Windows deletion or installed Tauri proof. Remaining UI work: narrow viewport/responsive layout and animation checks.

Prepare the existing fixed-reference authoring benchmark through accepted result and save/reopen. Measure accepted quality/cost before further optimization. Native mutation requires a separately selected disposable asset operation. The [Batch 0 audit](../../mcp/docs/FLOW_MCP_BATCH0_AUDIT.md) owns remaining quality findings; do not create another roadmap or continue merging solely to lower file counts.

CI DISABLED: verification definitions remain in `.github/disabled-workflows/`. Do not enable or dispatch Actions, change main, release or publish. UV contract repair `5f04c301` preserves required unavailable scope; native UV quality remains unproved.

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

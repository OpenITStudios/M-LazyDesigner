# LazyDesigner Current Validation

This file owns current proof interpretation only. Continuation: [next-action.md](next-action.md); native procedure: [local-acceptance-runbook.md](local-acceptance-runbook.md). Detailed historical evidence remains in Git at baseline `48329d013222c841dfe60477b4a3f59030befbaf` and the linked native reports.

## Current authority

2026-10-20 dependency completion uses an isolated checkout of OpenITStudios/M-LazyDesigner, Local, baseline `48329d0`. The original dirty checkout is preserved. Execution context: LOCAL_CODE, Windows x64. CI DISABLED; no workflow was enabled/dispatched, main changed, release created or package published.

Toolchains: Bun 1.4.3 (repo-local verified npm distribution), Node 24.22.0 LTS (repo-local official npm distribution), npm 11.16.0, Rust/Cargo 1.99.1 (rustup). Earlier initial Desktop runs used installed Node 24.14.1; final Desktop checks and package build used 24.22.0.

## Dependency comparison and decisions

| Component | Baseline | Current |
| --- | --- | --- |
| MCP client/server/core | 2.3.1 | 2.3.1 |
| Zod | 4.6.7 | 4.6.7 |
| TypeScript native | 7.0.2 | 7.0.2 |
| TS compiler API | missing MCP-compatible API | MCP typescript-compat 6.0.3; Desktop 6.0.3 retained |
| Blockbench typings | 5.2.0 | 5.2.1 |
| Bun runtime/types | 1.4.3 source pin | 1.4.3 installed and checked |
| Tauri Rust/npm API | 2.12.3 | 2.12.4 |
| Tauri CLI/build | 2.12.3 / 2.7.3 | unchanged latest stable |
| Vite / Svelte plugin | 8.3.4 / 7.3.1 | unchanged latest stable |
| Svelte / checker | 5.57.2 / 4.7.7 | unchanged latest stable |
| Tailwind | 4.3.3 | unchanged latest stable |
| Rolldown | 1.2.12 | 1.2.14 |
| Electron (typing-only) | incompatible override 41.10.7 / reconstructed lock 40.10.6 | 43.8.1 satisfying ^43.4.0 |

Bun/npm/Cargo generated their canonical lockfiles; no manual lock edits. Compatible transitives were updated with bun update, npm update and cargo update. Blockbench 5.2.1 typings replace legacy _Animation/_Keyframe aliases with upstream BBAnimation/BBKeyframe across type annotations; runtime constructors and behavior remain unchanged. The now-upstream getShortName declaration replaces its redundant local augmentation. Native compiler rejects import assertions, so the JSON import uses standard import attributes. The symbol-map helper/tests import the explicit TypeScript 6 API alias while tsc remains 7.0.2.

An override keeps Bun wildcard Node types deduplicated on supported Node 24.19.2; distinct Undici 7/8 types remain required by their upstream consumers. Keep @types/node on 24.x for supported Node 24; TypeScript 5.9 is nested under upstream Blockbench's ^5.8.3 constraint. Blockbench 5.2.1 moves Electron to ^43.4.0; remove the incompatible 41.x override instead of forcing another major. Electron remains development typings, not the Tauri runtime. Rust API-major migrations are deferred: rand 0.10 replaces RngCore/thread_rng/OsRng interfaces, sysinfo 0.39 changes process refresh/name APIs, and rfd 0.17/sha2 0.11 require independent native integration review. Current compatible lines are updated without a downgrade. Rust manifest MSRV remains 1.90; execution is proven only on pinned 1.99.1, not minimum-version execution.

Registry license metadata remains MIT/Apache-compatible for upgraded npm packages. Blockbench typings publishes no license field; retain the existing upstream licensing uncertainty, not an invented license grant. No new production dependency or framework was added.

## Current proof matrix

| Check | Actual result |
| --- | --- |
| Bun 1.4.3 install and frozen install | PASS |
| npm lock regeneration, clean install | PASS |
| TS7 MCP project graph, root, Gateway, unused checks | PASS |
| Targeted animation and compiler-API regressions | PASS: 34 tests |
| Desktop TS6 and TS7 Svelte checks | PASS: 0 errors, 12 warnings each |
| Vite frontend build | PASS |
| Desktop verify:source, Cargo locked check/test | PASS: 78 Rust tests on Node 24.22.0 / Rust 1.99.1 |
| MCP full verification | PASS: verify:full including repository, types, runtime, authoring, Gateway, benchmarks, surface guards and bundle; initial stale verifier/doc failures corrected |
| Bun security audit | High gate PASS; full audit reports 1 low Vue 2 advisory |
| npm audit | PASS: 0 vulnerabilities |
| cargo-audit 0.22.2, full lock | 0 vulnerabilities; 4 unmaintained + 1 unsound warning; all five absent from locked Windows graph |
| Windows NSIS shell package / Gateway protocol smoke | PASS: build:app:shell and real stdio initialization/discovery (4 public tools) |
| Installed/native Blockbench | NOT_EXECUTED on this source |

Logs are local ignored .cache outputs, not a second durable ledger. Svelte warnings concern existing unused CSS and alertdialog semantics; Rust warns about existing dead fields/helper. No warning suppression was added.

## Security findings

Vue 2.7.14 is pinned by Blockbench typings: [GHSA-5j4c-8p2g-v4jx](https://github.com/advisories/GHSA-5j4c-8p2g-v4jx), low ReDoS. An incompatible Vue 3 override would violate host typing contracts. Full RustSec scan (1,338 advisories) retains proc-macro-error, zbus_names, zvariant and zvariant_derive unmaintained warnings plus glib 0.18.5 unsoundness (RUSTSEC-2024-0429); no advisory ignores. Locked cargo tree --target x86_64-pc-windows-msvc confirms all five packages absent; full-lock findings remain disclosed. Zero classified vulnerabilities does not mean zero warnings.

## Current source contracts

Control is under mcp/gateway/control/; development planning under mcp/gateway/development/. The retired Navigator source remains removed. The persistent Gateway retains four public tools and never blindly replays unknown mutations. Geometry/Texturing share AUTHORING; Animation has explicit handoff. Generated API/schema/prompt output remains generator-owned. No native compatibility or liveValidatedBuilds entry is promoted by compilation.

## Last reusable proven source baseline

Historical source acceptance: 4c0accd, with exact workflow links preserved in the baseline version of this file. [Windows native report](native-acceptance.md#consolidated-windows-local-test-report--2026-10-14) scopes earlier installed evidence to e9b3bca5 and prior fcf66179/4cd2fd06. Those results do not validate this upgraded bundle. LD-Q01–Q04, particle visibility, Golden F, reference fidelity and real cost-to-accepted-result telemetry remain open. Recovery snapshot 3.0 and authored assets are preserved in their existing owners/history.

## Proof boundary

Do not strengthen source/static claims into local/live/visual claims without matching evidence from the exact current source SHA. A successful build is not native Undo/Redo, save/reopen, playback, reconnect or visual acceptance. Source proof and native proof remain separate.

A docs-only head may use Head Proof to show executable source did not change; this is not an executed verification. Source-impacting heads continue to require matching source checks. Native checks remain NOT EXECUTED.

## Executed commands and boundaries

From mcp: bun install; bun update; bun install --frozen-lockfile; bun x tsc --version; bun run verify:types; targeted animation/symbol-map tests (34 PASS); Gateway/affected tests (29 PASS); bun run verify:full (PASS); bun audit (1 low); bun run security:audit (PASS). From Desktop: npm install --package-lock-only --ignore-scripts; npm update; npm ci; npm audit --json; npm ls --all --json; npm run verify:source (PASS); npm run build:app:shell (PASS). Rust: cargo update, cargo check --locked, cargo metadata --locked --filter-platform x86_64-pc-windows-msvc, cargo tree --locked --target x86_64-pc-windows-msvc, cargo-audit 0.22.2 --json. Build logs and audit JSON are ignored local .cache outputs.

Root review found no tracked scattered artifacts requiring moves/deletions. Ignore native Svelte generated workspace; root-layout test permits the already-ignored .cache tooling directory. Preserve instructions and historical knowledge through canonical owners and Git history, replacing obsolete repeated continuation entries. No source boundary, build target, installed app or authored asset was changed. NSIS build is shell-only so far; integrated managed package requires the clean committed checkout. Installer execution, update/rollback, MSRV 1.90 execution and live native/visual acceptance remain NOT EXECUTED.

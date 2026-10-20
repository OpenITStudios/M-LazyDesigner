# LazyDesigner Current Validation

This file owns current proof interpretation only. Continuation: [next-action.md](next-action.md); native procedure: [local-acceptance-runbook.md](local-acceptance-runbook.md). Complete historical evidence remains in Git at `b9b4756ee18497d2cedc9ff475672ddfea81a2aa` (first dependency completion) and `48329d013222c841dfe60477b4a3f59030befbaf` (earlier continuity).

## Current authority

2026-10-20 dependency follow-up continues in the isolated Windows x64 checkout from remote OpenITStudios/M-LazyDesigner / Local, baseline b9b4756e. The original dirty checkout and assets remain untouched. CI DISABLED: nine verifier definitions remain outside Actions discovery. No Actions dispatch, main change, release or publication.

Toolchains: Bun 1.4.3, Node 24.22.0 LTS, npm 11.16.0, pinned Rust/Cargo 1.99.1. The updated manifest minimum Rust 1.95 is independently tested using Rust/Cargo 1.95.0. These are real installed tools, not source-only version declarations.

## Dependency comparison and decisions

| Dependency | Before follow-up | Current |
| --- | --- | --- |
| rand | 0.8.8 | 0.10.3 |
| rfd | 0.15.4 | 0.17.2 |
| sha2 direct | 0.10.9 | 0.11.1 |
| sysinfo | 0.30.13 | 0.39.6 |
| Rust minimum | 1.90 | 1.95 (sysinfo requirement) |
| PostCSS MCP | 8.5.28 override | 8.5.31, normal upstream range |
| Nano ID MCP | 3.3.19 override | 3.3.20, normal upstream range |
| RustSec informational findings | 5 | 2, neither in Windows graph |

Already completed and retained: MCP client/server/core 2.3.1, Zod 4.6.7, native TypeScript 7.0.2, TS6 compatibility API 6.0.3, Bun typings 1.4.3, Node typings 24.19.2, Blockbench typings 5.2.1, Tauri Rust/API 2.12.4 and CLI 2.12.3, Vite 8.3.4, Svelte plugin 7.3.1, Svelte 5.57.2, svelte-check 4.7.7, Tailwind 4.3.3, Rolldown 1.2.14. Registry checks and package-manager updates show no newer direct compatible release left outstanding.

Rust source adopts rand::rng/Rng and fallible SysRng/TryRng. Security-sensitive deletion tokens continue to use system entropy; entropy failure returns an error before publishing a deletion review. sysinfo process refresh explicitly updates all processes and removes dead entries; OsStr process names are converted for exact Blockbench-name matching. sha2 0.11 output uses explicit two-digit lowercase byte formatting, preserving existing identity lengths and persisted hashes. New regressions assert known navigation/project/profile hashes and actual Windows process name/executable discovery.

The rfd upgrade removes obsolete ashpd/zbus/zvariant dependencies and their three unmaintained advisories. No features were removed to hide scanner findings. Cargo regenerated its lockfile. Redundant PostCSS/Nano ID overrides were removed; Bun then resolved the latest compatible patches and regenerated bun.lock. npm update/ci confirm the Desktop lock remains current and consistent.

Required compatibility constraints remain explicit: Node types stay on supported Node 24; TypeScript 6 is retained for svelte-check and compiler API tooling while tsc is verified 7.0.2. Blockbench owns nested TypeScript 5.9, Vue 2.7.14 and Electron ^43.4.0 (resolved 43.8.1); they are typing dependencies, not a second Desktop runtime. Tauri retains its own sha2 0.10 dependency; forcing it to direct sha2 0.11 would violate upstream requirements. Distinct compatible Undici versions similarly retain their actual consumers.

## Current proof matrix

| Check | Evidence/result |
| --- | --- |
| Cargo update and locked dependency resolution | PASS |
| Rust 1.99.1 tests | PASS: 80, including 2 added regression tests |
| Rust minimum 1.95.0 cargo check --locked | PASS, separate target directory |
| Desktop verify:source on Node 24.22.0 | PASS: TS6/TS7 Svelte checks, Vite, Cargo check and 80 Rust tests |
| npm update, npm ci, npm audit | PASS: consistent lock and 0 vulnerabilities |
| Bun update, frozen install, security:audit | PASS; full audit retains one low upstream Vue finding |
| TS7 version/root/project graph/Gateway/unused checks | PASS |
| Repository verifier | PASS: 282 tests before final evidence update |
| MCP verify:full | PASS: repository, TS7, runtime, authoring, Gateway, benchmark, surface and bundle stages |
| Full RustSec cargo-audit 0.22.2 | 0 classified vulnerabilities; 2 informational warnings |
| Windows package | Previous source 06d74d70 integrated NSIS PASS; rebuilt follow-up pending clean source commit |
| Native Blockbench, visual acceptance, installed NSIS UI | NOT EXECUTED on upgraded source |

Current local logs are ignored .cache outputs, not another durable ledger. Existing Svelte unused-CSS/alertdialog warnings (12) and Rust dead-field/helper warnings (3) remain disclosed; no suppression was added.

## Security and license boundaries

Vue 2.7.14 is an exact upstream Blockbench typing dependency affected by low [GHSA-5j4c-8p2g-v4jx](https://github.com/advisories/GHSA-5j4c-8p2g-v4jx). The advisory spans Vue 2; neither upgrading to another Vue 2 patch nor forcing Vue 3 proves remediation. No compatible upstream package release resolves it today. This is an open development-dependency finding, not a claim of zero advisories.

Full-lock RustSec retains proc-macro-error 1.0.4 (RUSTSEC-2024-0370, unmaintained) and glib 0.18.5 (RUSTSEC-2024-0429, unsound), owned by Tauri's GTK stack. The locked x86_64-pc-windows-msvc graph excludes both. No advisory ignore, category suppression or dependency downgrade. Linux native safety is not claimed; Windows x64 remains the supported Desktop target.

Cargo metadata declares maximum Windows dependency MSRV 1.95. The upgraded direct crates retain MIT/Apache-compatible license expressions. Blockbench typings still publishes no license field; its existing upstream licensing uncertainty remains explicit. No new framework or production abstraction was introduced.

## Current source contracts

Control is under mcp/gateway/control/; development planning under mcp/gateway/development/. The retired Navigator source remains removed. The persistent Gateway retains status, search_capabilities, describe_capability and invoke_capability. Unknown mutations are not replayed. Geometry/Texturing share AUTHORING; Animation has explicit handoff. Generated API/schema/prompt files remain generator-owned. No liveValidatedBuilds entry is promoted by compiler/build evidence.

## Last reusable proven source baseline

Source 06d74d7080e5e4fffebbafdd2bdb1b83f4039b31 passed clean exact-SHA MCP full verification, Windows Desktop checks, integrated managed packaging and disposable compiled-CLI install/status smoke. Its installer hash and prior command-level evidence remain in Git at b9b4756e. [Windows native report](native-acceptance.md#consolidated-windows-local-test-report--2026-10-14) scopes older installed evidence to e9b3bca5 and prior fcf66179/4cd2fd06. These do not validate the newly upgraded runtime. LD-Q01–Q04, particle visibility, Golden F and real cost telemetry remain open.

## Proof boundary

Do not strengthen source/static claims into local/live/visual claims without matching evidence from the exact current source SHA. A docs-only head may use Head Proof to show executable source did not change; that is not executable verification. Source-impacting heads continue to require matching source checks. Builds do not prove native Undo/Redo, save/reopen, playback, reconnect, installed update/rollback or visual quality.

Executed follow-up commands: cargo update; cargo test --locked (80 PASS); cargo +1.95.0 check --locked --target-dir ../../.cache/msrv-target (PASS); npm update, npm ci, npm audit, npm run verify:source (PASS); bun update, bun install --frozen-lockfile, bun x tsc --version (7.0.2), bun run verify:types and bun run verify:full (PASS); cargo-audit --json and locked Windows metadata/tree classification. npm audit reports 0 vulnerabilities. Full Bun audit reports the disclosed Vue low advisory; high-severity gate PASS.

Upstream migration references: [Rand 0.10](https://rust-random.github.io/book/update-0.10.html), [sysinfo migration](https://docs.rs/crate/sysinfo/0.39.6/source/migration_guide.md), [sha2 0.11](https://docs.rs/sha2/0.11.1/sha2/), [rfd 0.17](https://docs.rs/rfd/0.17.2/rfd/).

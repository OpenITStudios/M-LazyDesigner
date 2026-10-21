# LazyDesigner Current Validation

This file owns current proof interpretation only and the requested dependency-efficiency report. Continuation: [next-action.md](next-action.md); native procedure: [local-acceptance-runbook.md](local-acceptance-runbook.md). Historical reports remain in Git at ce5299aa and b9b4756e.

## Current authority

2026-10-21: LOCAL_CODE, isolated Windows x64 checkout, OpenITStudios/M-LazyDesigner / Local. Grouped cleanup source: `ba4ed7f376f44d3cd7092bec8016ba26b0cd9f00` (repairs after `30a0c52c`). Original dirty checkout/assets untouched. Bun 1.4.3; existing dependencies reused, Desktop lockfile hashes matched. CI DISABLED; no Actions, main change, release or native mutation.

## Dependency efficiency report - 2026-10-20

### Problem and implemented correction

Desktop consumes only process PID, name and executable for editor selection, focus, deletion safety, Runtime lease checks and model-open proof. Five production paths created System::new_all() and immediately refreshed processes again. Other paths also collected unused per-process CPU, memory and disk statistics. All ten production snapshot call sites now use the existing process.rs owner's process_snapshot helper: one fresh native process scan, explicit executable retrieval, dead-process removal, no global cache. Exact Blockbench-name/executable checks remain at their existing semantic owners.

sysinfo retains only its required system feature. Unused component/disk/network/user feature activation is removed. This does not remove product functionality or weaken Runtime build/profile/PID guards. A controlled hidden child-process regression verifies live executable discovery and confirms the next snapshot excludes the exited PID; the existing self-process identity test now exercises the production helper.

### Measured local results

| Native scan path | Run 1 median / p95 | Run 2 median / p95 |
| --- | --- | --- |
| Previous new_all + second process refresh | 50.373 / 64.267 ms | 68.188 / 77.296 ms |
| Previous new + default process refresh | 11.437 / 14.894 ms | 19.068 / 25.780 ms |
| New production identity snapshot | 8.222 / 8.964 ms | 9.909 / 11.384 ms |

Median scan time fell 83.7–85.5% versus the double-scan paths, and 28.1–48.0% versus the old single-scan path. These are two local measurements, not a full-application latency, startup-time, token-cost or guaranteed cross-machine speedup claim.

Method: Windows x64, Rust 1.99.1 release-mode harness, sysinfo exactly 0.39.6 with system feature; include the actual production process.rs helper. Compare the two exact old scan sequences above against that helper. Each run uses three warmups per case and twenty samples per case, alternating forward/reverse case order. Time native System construction/refresh using Instant; validate each returned inventory includes the current PID and exact executable. Sort samples, select rounded indices (n-1)*0.5 and (n-1)*0.95. Background development workloads differed between runs, which is why both observations are disclosed.

Commands: cargo +1.99.1 run --release --manifest-path .cache/process-scan-bench/Cargo.toml (twice). The disposable harness/raw JSON are ignored local evidence, not a new repository benchmark framework. To reproduce, use the three scan sequences and sampling method above; only the new case calls production::process_snapshot().

### Dependency footprint and limits

| Metric | Before | After |
| --- | --- | --- |
| sysinfo resolved feature set | component, default, disk, network, system, user | system |
| Cargo.lock packages | 437 | 436 |
| Resolved Windows dependency nodes | 258 | 258 |
| Full-lock RustSec informational warnings | 2 | 2, both absent from Windows |

The removed lock entry is macOS-only objc2-open-directory. Windows package-node count is unchanged; reduced feature activation is not claimed as a package-count or installer-size reduction. No dependency downgrade, new dependency, speculative cache, alternate process engine or security suppression.

## Dependency readiness

All compatible stable direct upgrades are complete. Earlier dependency work reduced Cargo.lock from 490 to 437 packages and RustSec warnings from five to two; this focused efficiency change takes the lock to 436.

| Component | Current accepted source |
| --- | --- |
| MCP client/server/core; Zod | 2.3.1; 4.6.7 |
| Native TS; compatibility compiler API | 7.0.2; 6.0.3 |
| Bun; Bun typings; Node typings | 1.4.3; 1.4.3; 24.19.2 |
| Blockbench typings; Electron typing-only | 5.2.1; 43.8.1 satisfying ^43.4.0 |
| Tauri Rust/API; CLI | 2.12.4; 2.12.3 |
| Vite; Svelte plugin; Rolldown | 8.3.4; 7.3.1; 1.2.14 |
| Svelte; svelte-check; Tailwind | 5.57.2; 4.7.7; 4.3.3 |
| rand; rfd; sha2 direct; sysinfo | 0.10.3; 0.17.2; 0.11.1; 0.39.6 |
| MCP PostCSS; Nano ID | 8.5.31; 3.3.20, obsolete overrides removed |

Keep Node typings on supported Node 24. TS6 remains necessary for Svelte/compiler API tooling while tsc is verified native 7.0.2. Blockbench owns nested TypeScript 5.9 and Vue 2.7.14; Tauri owns its separate sha2 0.10 requirement. These upstream constraints are preserved without forcing incompatible versions. The prior rand/sysinfo/sha2 API migration preserves system-entropy deletion tokens and exact persisted SHA256 identity bytes; fixed-hash regressions remain active.

## Current proof matrix

Grouped local cleanup acceptance, 2026-10-21, source `ba4ed7f3`:

| Check | Executed result |
| --- | --- |
| Repository suite | PASS: 296 tests / 61 files |
| Focused orchestration/correction, authoringImpact/evidence, plugin/settings, Runtime/facade, selector/source-owner, human UI and synthetic workflow contracts | PASS: 163 tests / 18 files |
| MCP and Gateway TypeScript | PASS, both canonical checks |
| Desktop TS6 compatibility and TS7 Svelte checks | PASS: 0 errors, 0 warnings |
| Vite frontend and MCP plugin build | PASS |
| Generated artifact freshness | PASS |
| Full MCP verify:full, new Rust/NSIS packaging, visual/keyboard/browser/native acceptance | NOT EXECUTED in this batch |

Repaired overlong continuation, stale TLS ownership, nullable SHA fixture and
nine Svelte warnings. No test gate was relaxed. Raw logs: ignored
`.cache/cleanup-validation/`. This is grouped source acceptance, not full-suite,
UI behavior, native save/reopen or measured efficiency proof. Synthetic benchmark
contracts establish only modeled properties, not real authoring savings.

Historical dependency/Windows packaging proof belongs to `bcdb2399`: 81 Rust
tests, locked Rust 1.95/1.99 checks, integrated NSIS and disposable CLI install/status
smoke. It does not certify the current frontend or installed native behavior.
The process benchmark report above remains scoped to its historical source.

## Security and license boundaries

Bun full audit retains low [GHSA-5j4c-8p2g-v4jx](https://github.com/advisories/GHSA-5j4c-8p2g-v4jx) through Blockbench's exact Vue 2.7.14 typing dependency. No compatible upstream release fixes this advisory; another Vue 2 patch or an incompatible Vue 3 override would not prove remediation. Bun high-severity gate PASS; npm audit reports zero vulnerabilities.

Full Cargo audit retains proc-macro-error 1.0.4 (RUSTSEC-2024-0370, unmaintained) and glib 0.18.5 (RUSTSEC-2024-0429, unsound) through Tauri's GTK stack. Both remain absent from the locked x86_64-pc-windows-msvc graph. No advisory ignores; Linux native safety is not claimed. Windows x64 is the supported Desktop target.

No new license surface: direct crates keep MIT/Apache-compatible expressions. Blockbench typings still has no published license field; that pre-existing upstream uncertainty remains disclosed. See upstream [ProcessRefreshKind contract](https://docs.rs/sysinfo/0.39.6/sysinfo/struct.ProcessRefreshKind.html) for automatic PID/name retrieval and explicit executable selection.

## Current source contracts

Control is under mcp/gateway/control/; development planning under mcp/gateway/development/. The retired Navigator source remains removed. The persistent Gateway retains status, search_capabilities, describe_capability and invoke_capability. Unknown mutations are not replayed. Geometry/Texturing share AUTHORING; Animation has explicit handoff. Generated API/schema/prompt files stay generator-owned. No liveValidatedBuilds entry is promoted by compilation or benchmarking.

## Last reusable proven source baseline

Clean 51324f6da133cb728d0cda27f6b1a3358452161d passed full MCP verification, Desktop checks (80 Rust tests), integrated managed NSIS and disposable compiled-CLI install/status smoke. Its package/provenance hashes and the independent Rust 1.95 proof are recorded in the ce5299aa version of this file. [Windows native report](native-acceptance.md#consolidated-windows-local-test-report--2026-10-14) scopes older installed evidence to its exact historical builds. LD-Q01–Q04, particle visibility, Golden F and real cost telemetry remain open.

## Proof boundary

Do not strengthen source/static claims into local/live/visual claims without matching evidence from the exact current source SHA. A docs-only head may use Head Proof to show executable source did not change; that is not executable verification. Source-impacting heads continue to require matching relevant checks. Build/benchmark success does not prove native Undo/Redo, save/reopen, playback, reconnect, installed NSIS UI/update/rollback or visual fidelity.

Historical exact-source Desktop verification and integrated npm run build:app PASS on bcdb2399. Installer: 35.36 MiB; SHA256 5D27257F580639DA08546B023916A894B93829C763974E484EB5A8291861E9AD. The final report-only commit changes operations documents; its repository verifier passes independently.

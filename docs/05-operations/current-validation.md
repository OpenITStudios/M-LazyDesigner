# LazyDesigner Current Validation

This file owns current proof interpretation only and the requested dependency-efficiency report. Continuation: [next-action.md](next-action.md); native procedure: [local-acceptance-runbook.md](local-acceptance-runbook.md). Git owns historical implementation and acceptance details, including the source-only 23–24 October work at `a3ff57b4` and earlier reports at `ce5299aa`/`b9b4756e`.

## Current authority

2026-10-26: user-authorized LOCAL_CODE work on OpenITStudios/M-LazyDesigner/Local in the dependency-modernization worktree. Primary source remains dirty at 44b03b52. Recovery preserves 52 payloads; two root GIFs moved to canonical references. The 438 pre-existing missing Crimson Sentinel paths remain recoverable from Git.

CI DISABLED. No Actions, main changes or release publishing. New native acceptance: NOT EXECUTED. Dependencies unchanged; Desktop version metadata is 0.1.1. Toolchain: Bun 1.4.3, Node 24.22.0, Rust 1.99.1.

Source reconciliation at `bf42bbac`: exact-commit `verify:full` PASS; matching SHA in `verify-full-exact.log`. Earlier repository failures/installer timeout remain diagnostics.

Current bounded work: App/Gateway/Runtime managed alignment and explicitly authorized PC migration. Source candidate PASS: repository 302, authoring 166, installer/migration 34, Rust 83; Desktop TS6/TS7/frontend and generated freshness. Tests cover drift, unrelated Codex settings, old source process detection, backed-up migration, failed activation recovery, repository ownership and Desktop compatibility. Logs: ignored `.cache/alignment-*.log`.

Native installation/staging artifacts are not built at this source checkpoint. Old Codex source sessions are active and must defer migration. No current installed-runtime, restart/reconnect, trust/load, visual or end-to-end stability PASS is inferred. Older primary source retains its own pending changes.

## Current proof matrix

| Surface | Actual evidence / boundary |
| --- | --- |
| Initial pinned HEAD repository | FAIL: four checks above; not a full MCP run |
| Repaired source candidate | Repository 299/61 files, Runtime 2529/430, authoring 166/31, Gateway+manifest 298/34 PASS; project graph, MCP/Gateway types and unused checks PASS |
| Generated artifacts | Canonical `docs:check` PASS during repair; no hand-edited generated output |
| Desktop source at a3ff57b4 | `npm run verify:source` PASS: TS6 compatibility + TS7 Svelte checks, frontend build, locked Cargo check and 82 Rust tests; Desktop source/dependencies unchanged by this repair |
| Other source gates | Capability/decision evaluations, benchmark contract/scripts, surface guards and plugin build PASS; bundle identity `sha256:7086721b70c6e47db0bde7473b2038318e28f590959b8b4db42f7557a01de6b5` |
| Managed install / full invocation | One full invocation stopped on a 5s installer-test timeout after Runtime PASS. Same test then PASS in 1.2s; all 28 installer tests PASS separately in 5.98s with unchanged deadlines/assertions. This is component evidence, not a successful full invocation |
| Packaging / native / visual / Golden / token cost | NOT EXECUTED in this local reconciliation |

Logs: ignored `.cache/local-acceptance/a3ff57b4/`; retain the failed full invocation. Final exact-commit qualification uses `verify-full-exact.log`; require its completed exit/result and matching Git SHA rather than inheriting the candidate/ancestor proof. No installed/native proof follows.

## Current source-only authoring boundaries

The 23–24 October changes are coherently committed source and regression intent, not blanket accepted native functionality:

- Geometry: native transform/ancestry identity, Box UV/duplicate preflight, bounded OBB/shape evidence and correction parity/no-op refusal. Numeric evidence is not silhouette approval; LD-Q04 sampling remains blocked.
- UV: project-bound/single-use plans, RGBA freshness, signed/rotated physical/logical mapping, shared-cohort/pixel-grid integrity and scoped rollback. `manage_uv_layout` remains UNREGISTERED; activation and generated API must change together.
- Painted atlas: production repack requires proven-empty static flattened bitmaps. Pixel-migration candidates/transactions/native adapter remain unregistered preparation, without installed Undo/save-reopen/Golden acceptance.
- Texture: six-slot Cube census enumerates disabled/missing/untextured/foreign/unreadable ownership, non-Cube/duplicate owners and sample omissions. Preserve `enabled_face_count = sampled_face_count + unexamined_enabled_face_count`; missing/disabled belong to all-unsampled slots. Enumeration does not certify face pixels, Mesh, variants/PBR or visual quality.
- Cross-Cube seams: unregistered helpers pin declared reference observations, native Texture/material/world identity and RGBA revisions. Image-byte identity is not reviewer approval; async freshness is a bounded read window, not an atomic Reference+Model transaction or visual PASS.
- Animation: key compaction/numeric recovery source is not playback acceptance.

The B0-A [trace](../../mcp/docs/FLOW_MCP_BATCH0_AUDIT.md) distinguishes six source-registered routes from unregistered UV; neither is installed proof.

## Historical source and frontend evidence

`ba4ed7f3` (2026-10-21): 296 repository tests/61 files; 163 focused tests/18 files; MCP/Gateway types; Desktop TS6/TS7; frontend/plugin build and generated freshness PASS. Full MCP, new packaging and native/visual checks were NOT EXECUTED in that batch.

`d334106e`: Svelte at 1280x720, official Tauri mockIPC/24 synthetic projects: list persistence/scroll, menus, dialog focus, Tab/Escape and error recovery observed. 296 repository tests, types/build PASS. Narrow viewport, Recycle Bin, installed Tauri and native save/reopen NOT EXECUTED.

## Dependency efficiency report - historical 2026-10-20

At `bcdb2399`, ten production process snapshots use the existing `process.rs` helper: one fresh identity scan with PID/name/executable and dead-process removal, no cache. Removed unused sysinfo component/disk/network/user features without weakening editor/profile/PID guards.

| Native path | Run 1 median / p95 ms | Run 2 median / p95 ms |
| --- | --- | --- |
| Previous new_all + second refresh | 50.373 / 64.267 | 68.188 / 77.296 |
| Previous new + default refresh | 11.437 / 14.894 | 19.068 / 25.780 |
| New production identity snapshot | 8.222 / 8.964 | 9.909 / 11.384 |

Historical median reduction: 83.7–85.5% versus double-scan and 28.1–48.0% versus old single-scan. These are local scan measurements, not application startup/latency, tokens or cross-machine guarantees. Method: Windows x64, Rust 1.99.1 release, sysinfo 0.39.6/system; actual production helper; three warmups + twenty samples per case, alternating order; current PID/executable validated; rounded (n-1)*0.5/p95 indices. Disposable `cargo +1.99.1 run --release --manifest-path .cache/process-scan-bench/Cargo.toml` ran twice. Full source/method details remain in Git at `9c95bd84`.

Feature activation changed from component/default/disk/network/system/user to system. Cargo.lock 437→436 packages (removed macOS-only objc2-open-directory); Windows dependency nodes stayed 258. No installer-size or Windows package-count reduction claim. Historical `bcdb2399` has 81 Rust tests, locked Rust 1.95/1.99 checks, integrated NSIS and disposable CLI install/status smoke. Installer 35.36 MiB, SHA256 `5D27257F580639DA08546B023916A894B93829C763974E484EB5A8291861E9AD`; no current installer acceptance follows.

## Dependency/security boundaries

Prior toolchain/dependency evidence: Bun 1.4.3, TS7.0.2/TS6.0.3, Node typings 24.19.2, Blockbench typings 5.2.1/Electron typing-only 43.8.1, Cargo.lock 436 packages. Historical Bun high-severity PASS/npm audit zero; no new audit here.

Bun full audit retains low GHSA-5j4c-8p2g-v4jx through Blockbench's exact Vue 2.7.14 typing dependency; no compatible upstream fix established. Full Cargo audit retains proc-macro-error 1.0.4 (RUSTSEC-2024-0370, unmaintained) and glib 0.18.5 (RUSTSEC-2024-0429, unsound), both absent from the locked Windows x64 graph. No advisory ignores or Linux native safety claim. Direct crate licenses remain MIT/Apache-compatible; the pre-existing missing published license field for Blockbench typings remains unresolved. These findings are historical, not a fresh advisory database scan.

## Current source contracts

The persistent Gateway owns client stability/recovery; Control (`mcp/gateway/control/`) owns context/readiness; development planning stays under `mcp/gateway/development/`. The retired Navigator source remains removed. Four public tools remain status, search_capabilities, describe_capability and invoke_capability. Unknown mutations are not replayed. Geometry/Texturing share AUTHORING; Animation handoff is explicit. Generated API/schema/prompt files stay generator-owned. No liveValidatedBuilds entry is promoted by compilation or benchmarking.

## Last reusable proven source baseline

`51324f6da133cb728d0cda27f6b1a3358452161d`: historical full MCP, Desktop checks (80 Rust tests), integrated managed NSIS and disposable compiled-CLI install/status smoke PASS; details at `ce5299aa`. [Windows native report](native-acceptance.md#consolidated-windows-local-test-report--2026-10-14) scopes installed evidence to its named older builds.

LD-Q01–Q04, particle visibility, saved-model/reference fidelity, Golden F and real cost telemetry remain open. Do not strengthen source/static claims into local/live/visual claims without matching evidence from the exact current source SHA. A docs-only head may use Head Proof to show executable source did not change; it is not execution proof. Source-impacting heads continue to require matching checks. Native Undo/Redo, save/reopen, playback, reconnect, installer UI/update/rollback and visual acceptance were not executed here.

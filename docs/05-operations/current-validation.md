# LazyDesigner Current Validation

This file owns current proof interpretation only and the requested dependency-efficiency report. Continuation: [next-action.md](next-action.md); native procedure: [local-acceptance-runbook.md](local-acceptance-runbook.md). Historical reports remain in Git at ce5299aa and b9b4756e.

## Current authority

**2026-10-24 REMOTE_GITHUB source-only, cross-Cube seam binding provenance:** The unregistered `inspectDeclaredNativeCrossCubeSeams` helper now requires each declared face edge to carry an expected **resolved** native texture UUID and exact native face material name, in addition to explicit surface/material continuity intent. This closes a real stale-declaration path: a face may resolve its texture via single-texture, group or override rules rather than its raw `face.texture` field. Both binding values, native Texture object membership (including the project inventory where available), UV corners, face rotation, enabled state and the pinned Cube world matrix are checked after bounded edge reads. Inconsistent binding data is omitted, counted and raises `CROSS_CUBE_NATIVE_BINDING_STALE`; a scan with zero comparable pairs is `comparison_state=not_evaluated`. Material approval, full texture SHA revision, native installed sampling and scene-wide/visual PASS are **not attested**. Existing native mock regression owner now covers stale texture/material binding, binding changing during sampling, getter failure and single-texture override semantics. Source/static only: Bun/typecheck, installed Blockbench/Golden and accepted-result cost NOT EXECUTED (CI disabled). The helper remains unregistered; no tool schema, built artifact or production Texture behavior changed.

**2026-10-24 REMOTE_GITHUB source-only, explicitly declared native cross-Cube seam sampling:** The canonical pure `seamContinuity` owner now projects mesh-local `CubeFace.UVToLocal` seam endpoints through validated column-major Blockbench world matrices and computes aligned cardinal world normals, rejecting reflections, shear, degenerate/unbounded endpoints and non-affine transforms rather than guessing world identity. The existing Texture authoring Runtime extension exports an unregistered, read-only `inspectDeclaredNativeCrossCubeSeams` helper: capped explicit per-Cube face/edge material+surface continuity declarations, bounded native texture RGBA sampling via the existing diagnostic owner, and the existing cross-Cube pair comparator. Invalid/duplicate intents fail before sampling; missing/animated/undersampled/matrix-unknown evidence is enumerated as partial, never clean. Focused pure/native-mock regression suites and affected execution routing were authored. **No production `list_textures` schema/registration changed.** Current-SHA Bun/typecheck, actual installed Blockbench world/texel sampling, whole-scene/Golden visual acceptance and measured accepted-result cost are NOT EXECUTED (CI disabled). `native_sampling_attested=false`, `scene_coverage_attested=false`, `visual_verdict=not_evaluated` remain conservative.

**2026-10-24 REMOTE_GITHUB source-only, unregistered native Texture+UV migration adapter:** The U7 all-or-nothing transaction now requires a complete, stable `Cube UUID + face -> Texture UUID` binding manifest in addition to the project/Cube/Texture inventory, rejecting foreign or changed face texture attachments. New unregistered `pixelMigrationRuntime` adapter source enumerates `Outliner.elements` and `Cube.all`, rejects non-Cube or missing owners, verifies `Texture.all` against `Project.textures`, blocks layered/animated/size-inconsistent atlases, pins the unique project, and uses the existing native UV reader/mutator, `Texture.edit` with exact full-RGBA callback, and combined bitmap+UV Undo with verified restore/cancel/finish boundaries. It rechecks source UV, face bindings and full pixels synchronously immediately before Undo; installed mutations are NOT enabled. Existing source-owned transaction tests and nine simulated Blockbench callback/Undo harness cases were authored, with path-filtered regression routing. **Bun/typecheck, actual installed native Undo/rollback, codec/save-reopen, mapped model Golden visual and performance/cost NOT EXECUTED** (CI disabled). Prior painted atlas repack fail-closed guard still governs production. This is source integration, NOT accepted native functionality.

**2026-10-24 REMOTE_GITHUB source-only, all-or-nothing Texture+UV transaction contract:** The existing U7 pure pixel-migration candidate now has a separate import-safe, unregistered `pixelMigrationTransaction` adapter contract. It requires complete Cube/project Texture UUID inventories, canonical SHA-256 decoded-RGBA revisions for every atlas, bounded verified snapshots and second pre-Undo freshness reads; synchronous ownership of one combined bitmap+UV Undo edit; exact native UV instruction/scope and whole-atlas bitmap postconditions with a final post-hash read; and verified rollback of all bitmap+UV bytes. Partial Undo ownership, an uncertain finishEdit or imperfect rollback produces non-retriable `UV_PIXEL_MIGRATION_OUTCOME_UNKNOWN`. Existing regression owners cover candidate byte integrity, inventory drift, changed pixels, collateral writes, precommit stale races, recovery and uncertain native boundaries. **No installed Blockbench adapter is connected.** `committed_by_adapter` is mock-port execution only, not live native/visual proof; painted-atlas native repack remains blocked. Exact-SHA Bun/types, real image+UV Undo/save/reopen/codec, Golden visual and end-to-end cost NOT EXECUTED (CI disabled).

**2026-10-24 REMOTE_GITHUB source-only, lossless UV pixel migration candidate:** Added one pure U7 `pixelMigration` source owner that reuses native UV source fingerprints, plan validation/translation and the existing per-face pixel mapper to prepare bounded read-only RGBA migration candidates for all explicit static flattened color/variant/PBR atlases. Preflights exact local-pixel resolution and rotation/mirror parity; handles Box-UV net translation, shared reuse and swap cycles from original snapshots; fails closed on fixed-source ownership, destination collisions, conflicting source pixels, partial atlas scope, animation/layers, stale fingerprints, resampling and bitmap budgets. Existing focused regression owner and affected-test routing were added. `candidate_only` means no native image update, no UV native apply, no scene-coverage/visual attestation. The prior native painted-atlas repack block remains active. Current-SHA Bun/TypeScript, native Blockbench Undo/save-reopen/rollback, Golden visual and AI accepted-result measures are NOT EXECUTED (CI disabled). Future atomic native texture+UV integration is still required before painted UV relocation can be enabled.

**2026-10-24 REMOTE_GITHUB source-only, bounded seam coverage honesty (P0):** The existing `list_textures` seam Runtime now records an explicit bounded scan coverage state, eligible/unexamined textured-face counts, capped Cube UUID + face + omission-reason examples, and a `SEAM_SCAN_PARTIAL` advisory reason whenever animation, UV mapping or sampling budget skips a face. The pure seam owner rejects invalid counters/examples; existing seam tests cover edge-sampled vs partial vs not-evaluated and native wrapper integration. Full-scene coverage, face interior pixels, cross-Cube native seam sampling, mapped visual/Golden quality, Bun/typecheck and actual installed Blockbench tests are NOT EXECUTED/NOT ATTESTED (CI disabled). This change improves truthfulness and actionable targets, not native cross-Cube analysis or Texture PASS.

**2026-10-24 REMOTE_GITHUB source-only, painted atlas repack protection (P0):** Native `create_texture(type=template, texture_id, rearrange_uv=true)` rebuild and the unregistered U7 UV adapter now use one canonical flattened RGBA preflight before native template generation or Undo. Automatic UV relocation is allowed only when all RGBA bytes are zero and the texture is single-frame, non-layered, and dimension-consistent. A nonzero pixel, hidden RGB with alpha 0, layers, animation or unverified bitmap rejects before native mutation; U7 checks all loaded texture variants/channels even when its caller explicitly overrides bitmap dimensions. Existing bitmap-runtime, atlas-integrity and native-adapter regressions were added; Bun/TypeScript, installed Blockbench Undo/save/reopen/visual and texture migration proof remain NOT EXECUTED (verification CI disabled). This is a safe refusal, not an automatic pixel migration or mapped-model Texture PASS.

**2026-10-24 REMOTE_GITHUB source-only, UV automatic bitmap pixel freshness:** The existing U7 native base-atlas reader now uses the canonical decoded RGBA revision owner alongside physical/frame dimensions, logical UV dimensions and atlas UUID. Its plan registry/content address and the existing read-only pre-Undo freshness check compare revision fields; a same-UUID, same-size repaint now invalidates an old plan before adapter creation. Existing UV service/registration suites include same-size repaint during planning/at apply, content-addressed revision changes, invalid digest and mismatched logical dimensions. Explicit pre-atlas bitmap overrides still bypass atlas discovery. SOURCE IMPLEMENTED only: Bun/TypeScript, real native canvas/Undo/save-reopen, visual/Golden quality and measured latency/cost NOT EXECUTED (CI disabled; no connected Bun/Blockbench). Existing manage_uv_layout registration remains generator/live-gated.

**2026-10-24 REMOTE_GITHUB source-only, semantic per-face UV orientation parity:** Existing `nativeApplyPlan` now retains signed native U/V corner direction (both flips), composes atlas quarter-turns relative to the already-authored 0/90/180/270-degree face rotation rather than resetting to 0/90, and rejects collapsed/non-finite native source orientation. Existing `nativeTransaction` now validates all four native quarter-turn rotations. Semantic physical-pixel placements now require explicit bitmap/project logical dimensions and are converted to native logical face UV at the compiler boundary; non-square 256x512 mapping and missing/invalid scales are covered by existing UV compiler/identity tests. The existing pure compiler and transaction regression owners cover the full signed/rotated matrix and negative inputs. Source/static prepared only: exact-head Bun/TypeScript, Blockbench native Undo/codec/export, mapped visual/Golden fidelity and accepted-result cost NOT EXECUTED (CI disabled). This does not register the generator-gated U7 `manage_uv_layout` route.

**2026-10-24 REMOTE_GITHUB source-only, UV physical grid and shared-cohort integrity:** Existing U7 UV packing preserves an explicitly shared atlas allocation across differing member priorities, refuses incompatible shared-cohort constraints before native mutation, and checks physical texel boundaries for fixed and newly planned UV regions. Density proposals now quantize upward to whole physical pixels. Semantic Runtime validates logical UV against an established single base-color atlas frame when available; Texture audit and coverage inspection share the same physical-grid tolerance. Existing UV and Texture regression suites now include priority split, constraint conflict, fractional logical coordinates, half-texel rejection and density quantization. Source/regression changes are prepared at this HEAD; matching-SHA Bun/TypeScript, native Blockbench apply/Undo/save-reopen/export, visual/Golden quality and measured accepted-result cost are NOT EXECUTED (verification CI is disabled and no connected Bun/Blockbench runtime exists). The existing generator-owned manage_uv_layout registration remains unactivated.

**2026-10-24 REMOTE_GITHUB source-only, correction no-op budget:** The
existing correction loop now rejects a semantically selected candidate when
the incremental rebuild contains no affected native Cube, before spending a
bounded attempt or invalidating evidence. The existing correction-loop reuse
suite covers zero resize/translate/rotate/inflate and a succeeding effective
edit. Actual Bun/TypeScript and native/Golden checks are NOT EXECUTED
(verification CI disabled). This is source-code protection, not a quality
claim about an accepted model.

**2026-10-24 REMOTE_GITHUB source-only, UV bitmap freshness:** Existing U7
UV service/registry now pin auto-discovered base-atlas physical dimensions
and optional native UUID across planning and read-only pre-Undo apply, and
include them in content-addressed plan identity. Explicit pre-atlas
overrides remain independent of atlas discovery. Same-size/same-UUID bitmap
pixel changes and installed texture behavior remain outside this check.
Existing UV plan-service regressions are authored but NOT EXECUTED; CI remains
disabled, and Bun/TypeScript, Blockbench native, and visual/Golden acceptance
have no matching-HEAD execution proof.

**2026-10-24 REMOTE_GITHUB source-only, Workspace → Control lifecycle:**
A legacy plural blocker label was ignored and free-text Current Stage fields
could be mistaken for valid continuity. The existing parser now preserves
known/ambiguous blockers, reports conflicting/missing/invalid lifecycle
fields and Control readiness refuses false READY until status is clarified.
The existing summary now exposes its canonical README recovery path only when
blockers or parsing issues require review, without duplicating free-form text.
Regression cases were authored in existing Workspace/readiness/packet suites.
No asset model/README was changed. Current-head Bun,
TypeScript, installed Runtime and visual/Golden acceptance are NOT EXECUTED
(CI disabled; no connected Bun/Blockbench environment).

**2026-10-23 REMOTE_GITHUB source-only, U7 native UV scope:** Existing UV
atomic transaction now verifies no out-of-scope Cube, geometry or face UV
changes using its already-read before/after snapshots before Undo commit.
Allows only requested per-face edits and the native Box UV offset's own
derived face rectangles; rejects unrelated changes with the existing
verified rollback/OUTCOME_UNKNOWN mechanism. Matching-source pure and
atomic regression cases authored. Exact-SHA Bun/TypeScript, native
Blockbench Undo/export/UV mapping and Golden visual proof remain NOT
EXECUTED (verification CI disabled).

**2026-10-23 REMOTE_GITHUB source-only, constrained correction parity:** A
relation-controlled child translation could previously be overwritten by ANCHOR
resolution while its Recipe still compiled. Existing semanticRewrite now
checks realized selected-Cube parity for all relation-bearing edit operations
and preserves independent non-resize fast paths. Existing regression owner
covers the refusal plus allowed orthogonal/parent movements. Current-HEAD Bun,
TypeScript, native Blockbench and visual-quality checks remain NOT EXECUTED
because verification CI is disabled and the GitHub environment has no Bun or
live native workspace. Earlier source-only parity and Golden proof ceilings
below remain unchanged.

**2026-10-23 REMOTE_GITHUB source-only, correction/UV parity follow-up:** Existing
semantic Recipe rewrite now supports reference BOUNDS CENTER and explicit
MIN/CENTER/MAX resize anchors with pivot and post-compile selected-Cube parity.
Native Geometry export verifier now checks creation-receipt Box UV offsets,
signed Per-face UV orientation and rotation, with negative regressions in the
existing tests. Exact-HEAD Bun/TypeScript, native Blockbench codec output,
visual fidelity and actual accepted-result cost are **NOT EXECUTED**
(verification CI remains disabled). Existing Golden tasks are UNMEASURED.

**2026-10-23 REMOTE_GITHUB source-only:** Four-issue owner changes: Box UV and exact Cube duplicate prevention (`8b14c2a`, `d2fb30b`); underside-first texture scanning and scoped face-treatment coverage (`43c54a4`, `cd265e0`); shared UV cohort safety and semantic locality selection (`984ce3a`, `d5a75e4`); strict keyframe creation compaction and piecewise numeric recovery (`900c0c4`, `4b632c3`). Matching-HEAD Bun/TypeScript, native Blockbench, exported JSON, visual fidelity, and measured model/token cost are **NOT EXECUTED** (verification CI disabled). Regression tests are authored, not run; older proof below remains SHA-scoped.

2026-10-21: LOCAL_CODE, isolated Windows x64 checkout, OpenITStudios/M-LazyDesigner / Local. Grouped cleanup source: `ba4ed7f376f44d3cd7092bec8016ba26b0cd9f00` (repairs after `30a0c52c`). Original dirty checkout/assets untouched. Bun 1.4.3; existing dependencies reused, Desktop lockfile hashes matched. CI DISABLED; no Actions, main change, release or native mutation.

## Frontend interaction evidence - 2026-10-21

Source `d334106e`, actual Svelte UI at 1280x720 in the in-app browser with
Tauri's official mockIPC and 24 synthetic projects; no native filesystem calls.
Fixed clipped project menus, lost opener focus on dialog close, and Tab escape
while buttons are busy. Observed: filter and expanded list persist across
Workspace/Support; scroll restored to 1235px; initial Cancel focus; Tab/Shift+Tab
wrap; Escape restores opener; busy Tab stays inside and Escape cannot dismiss;
mocked failure shows error and restores focus. 296 repository tests PASS;
Desktop TS6/TS7 checks zero errors/warnings; frontend build PASS. No new test file.
Temporary harness used existing App and fixtures with mocked status/delete IPC.
Narrow viewport, real Windows Recycle Bin, installed Tauri and native authoring
save/reopen are NOT EXECUTED. Prior grouped MCP proof below remains scoped to
`ba4ed7f3`; this batch changes frontend and its structural test only.

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

Compatible direct upgrades and dependency migration evidence remain at
`bcdb2399`/`ce5299aa`. Bun 1.4.3; native TypeScript 7.0.2 with TS6.0.3 for
Svelte/compiler API; Node typings 24.19.2; Blockbench typings 5.2.1 with
Electron typing-only 43.8.1. Upstream Vue 2/TS5.9 and Tauri sha2 constraints
remain unchanged. Cargo.lock holds 436 packages; current frontend work does
not repeat dependency/security or Rust/package acceptance.

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

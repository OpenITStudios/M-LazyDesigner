# LazyDesigner Next Action

This file owns **current continuation only**, not the patch history. Canonical workflow: `docs/01-product/flow.md`; implementation: `docs/04-system/implementation-map.md`; proof: `docs/05-operations/current-validation.md`; native procedure: `docs/05-operations/local-acceptance-runbook.md`. All detailed former entries remain recoverable in Git at `3bbb057ad99b9697947abe7ce22371e1ffacd2a1`. Read that historical version only for an actual unresolved source/proof question.

**Branch authority:** `Local`. The recovery snapshot `3.0` is historical and must stay unchanged. **Work mode:** `REMOTE_GITHUB`; never require the user's local PC as a prerequisite for source tasks. Source edits must preserve ownership, exact-SHA evidence and explicit uncertainty.

## Current bounded work — One-Flow context integrity (ChatGPT / GitHub)

**2026-10-18 Bun 1.4.3 selection / pinned-source update (SOURCE_IMPLEMENTED; adoption pending CI):** Official stable Bun `bun-v1.4.3` released 2026-10-10 is the selected upgrade from pinned `1.3.14`; the upstream GitHub release includes `bun-windows-x64-baseline.zip`, required by our Windows packaging workflows. Change only root `.bun-version` to `1.4.3`, preserving `mcp/bun.lock`, dependencies, `tsc` verification, Bun.build macros/shims, and all user assets. Repository test in `mcp/tests/repository/instruction-context-efficiency.test.ts` now checks single-source Bun pin routing for Linux and Windows plus TypeScript/lockfile gates. Existing manual MCP Verify retains `full` and `texture` modes with exact-SHA proof; default/full remains authoritative. Bun 1.4.3 supplies `bun check` and reported better idle CPU, Node HTTP and compiled startup in upstream workloads, **not measured here**. No toolchain, CI or native Windows test executed by this chat; do not mark source/build, packaged Windows or Blockbench as accepted. Next use manually triggered `MCP Verify` Full on Local exact SHA before treating pin as a validated engineering baseline; test packaging separately with a non-publishing Windows verification on matching SHA. Do not silently edit main or publish releases to expose Actions inputs. On failure, restore the prior pinned version in a normal forward commit only after diagnosing the failing step; avoid speculative mass refactors.



**Current next action — seam RGB evidence semantics (source prepared):** The
single `seamSummary` now serves intra-/cross-Cube comparison, excludes RGB
when either alpha is zero in default `OPACITY` mode, uses null + evaluated
count when no RGB pair is visible, and supports explicit `NON_OPACITY` mode
for color/emissive masks. Existing normal, intentional-boundary, alpha-hole
and no-visual-PASS rules remain. Focused fixtures updated in
`mcp/tests/texture-seam-continuity.test.ts`. On a capable cloud checkout
run `cd mcp && bun test tests/texture-seam-continuity.test.ts` followed by
the owning TypeScript/source gates. Bun, CI, real client/material profile,
native mapped visuals and performance remain NOT EXECUTED. No PC localtest
required.



**2026-10-18 Cross-Cube seam endpoint grouping — SOURCE_IMPLEMENTED pending execution:** `mcp/lib/texture/seamContinuity.ts` no longer groups physical edges solely by quantized endpoint string. Candidate edges are located through bounded spatial epsilon cells (both endpoints), then matched by actual endpoint-distance checks in either orientation; connected tolerance chains with more than two candidates are ambiguous, not approved pairs. This addresses false `unpaired` outputs at a 1e-5 rounding boundary while still refusing noncoincident T-junctions, mismatched surface/material identity and explicitly intentional boundaries. Existing 2048-edge input limit and diagnostic-only/no-native/no-visual-PASS semantics remain. Five pure seam regression cases added in `mcp/tests/texture-seam-continuity.test.ts`, including near-boundary, beyond-epsilon, intentional boundary, ambiguous chain and bounded repetition; no new tool or native asset update.

**Proof boundary:** source/fixture content only. Bun tests, typecheck, exact-SHA CI, actual Blockbench mapped-seam visual quality and performance measurement NOT EXECUTED. Existing repo cloud gate: `cd mcp && bun test tests/texture-seam-continuity.test.ts tests/texture-masks.test.ts tests/texture-geometry-signal-compiler.test.ts` followed by owning typecheck/source verifier when a capable cloud runner is available; do not require localtest on the user's PC.



**2026-10-18 Geometry-aware Texture shared-UV safety — SOURCE_PREPARED:** `mcp/lib/texture/geometrySignalCompiler.ts` now preflights physical texel overlaps before building face-derived cavity/contact/upward exposure masks. Exact shared UV rectangles remain permitted when their treatment signals agree; incompatible sharing, partial physical overlap, and different logical rectangles aliasing the same rasterized texels fail closed, referring the upstream mapping decision to Geometry/UV. Finite world-normal *length* is required; huge finite components must not normalize via Infinity into fictitious zero exposure. Distinct footprint comparisons deduplicate identical UV reuse to avoid quadratic repeated-instance overhead. Focused pure fixtures in `mcp/tests/texture-geometry-signal-compiler.test.ts` cover nine boundary cases, including 512 repeated shared instances. Canonical Texture standard and the existing Texturing deep reference explain this narrowly scoped requirement, not a global UV-overlap ban. No new public capability, checker engine, runtime integration, visual verdict, or asset write.

**Proof ceiling:** candidate source/doc/test content statically reviewed; Bun, typecheck, CI and native Blockbench/Minecraft mapped quality NOT EXECUTED. On an available cloud checkout, run `cd mcp && bun test tests/texture-geometry-signal-compiler.test.ts tests/texture-masks.test.ts tests/uv-share-validation.test.ts tests/uv-stacking-proposals.test.ts` and the owning typecheck/semantic gates, then evaluate actual mapped models separately. User localtest is not a prerequisite.



**2026-10-18 Texturing mask evidence preflight (SOURCE_IMPLEMENTED pending executable proof):** The existing `mcp/lib/texture/maskedOps.ts` owner now rejects nonfinite ScalarMask weights, invalid RGBA color channels and mismatched mask dimensions before returning a paint result. Previously NaN mask arithmetic could coerce to 0 in Uint8Array, producing black/transparent pixels without a diagnostic. The same preflight covers composed directional wear and geometry-aware material treatment, while finite RGB-only alpha-preserving behavior remains unchanged. Focused regression fixtures are in `mcp/tests/texture-masks.test.ts`. No new tool, visual quality score, Skill module, atlas or native asset change.

**Next source proof:** matching-SHA cloud Bun `cd mcp && bun test tests/texture-masks.test.ts tests/procedural-texture-ops.test.ts tests/texture-treatment-intelligence.test.ts` and relevant typecheck/source gates when available. GitHub source review is not executable evidence. Native Blockbench/material fidelity remains UNVERIFIED, with no user localtest required.



**2026-10-18 Skill-module maintenance contract — SOURCE_PREPARED:** Existing
Skill Development owner now specifies smallest-surface updates for new,
renamed, retired or revised Geometry/Texturing/Animation modules, including
native/API ownership, direct `SKILL.md` trigger, must-load/no-load fixtures,
content identity invalidation and separate native/visual proof. The repository
budget test no longer duplicates a fixed module-name list: it discovers the
real one-hop Markdown files and fails on unlinked/orphan/missing modules or
modules without a representative positive evaluation case. No registry,
additional router, autonomous update task or asset mutation was added.
Inspect source contracts and pinned cloud test evidence at the next change;
do not claim model compliance from link integrity. Pending: matching-SHA
`cd mcp && bun test tests/repository/agent-skill-context-budget.test.ts
tests/repository/skill-lane-contract.test.ts` and active specialist behavioral
retrieval/visual proof; no user PC localtest required.


**2026-10-18 Skill activation audit (current SOURCE_IMPLEMENTED):** Geometry, Texturing and Animation `SKILL.md` now distinguish `REQUIRED_ON_TRIGGER` deep content from `NO_DEEP_REFERENCE` routine safe work. Geometry no longer uses an absolute one-reference ceiling: separate correction/fidelity/UV decisions can read directly linked modules *sequentially* without preloading them. Texturing exact mapped RGBA edits and Animation pre-agreed numeric keys remain normal hot-path operations when already verified; material fidelity/alpha and motion/contact/correction decisions require their existing specialist evidence module before dependent expansion. No additional specialist, router, runtime/tool contract, or reference file was created.

**Coverage:** module-loading evaluation corpus now has 10 intended scenarios including Geometry sequential correction→verification and redundant-read avoidance; the existing budget/ownership test supports these cases. 22 targeted static consistency checks were performed against candidate file contents; this is not Bun execution or observed retrieval behavior. Next run `cd mcp && bun test tests/repository/agent-skill-context-budget.test.ts tests/repository/skill-lane-contract.test.ts tests/repository/authoring-skill-owner-integrity.test.ts tests/authoring/model-effectiveness-primary-geometry.test.ts tests/authoring/texture-production-discipline.test.ts tests/authoring/animation-professional-reasoning.test.ts` on a capable cloud checkout, then the exact-SHA repository source verifier. Evaluate must-load/must-not-load client traces separately, and reserve Blockbench visual quality for real native proof. Do not require user localtest.



**2026-10-18 SKILL_SYSTEM source implementation — Quality-First Progressive Skills:**
The 15,000-character asset specialist budget is an **advisory review threshold**, not a hard test failure, target to fill or license to skip mandatory guidance. Existing smaller reference/router/delegated budgets are also advisory. `docs/04-system/ai-context-loading.md` owns the policy: operational core always available, one-hop conditional expertise (required-on-trigger versus supporting), load/reload actual client content, preserve critical invariants, and judge quality before savings. No new Skill, second Control layer, or change to the three working specialist contents.

`mcp/tests/repository/agent-skill-context-budget.test.ts` now checks current frontmatter, owner/class declarations, direct existing reference files/explicit load instructions and policy coupling. Over-budget lengths emit review warnings without passing or failing based on character count. `mcp/tests/fixtures/skill-reference-loading-cases.json` holds positive and negative module-loading cases for Geometry, Texturing, Animation; **this is intended test input, not observed AI behavior**. `lazydesigner-skill-development` links the canonical policy and evaluation fixtures.

**Proof boundary:** GitHub source/static consistency can verify files, links, and fixture structure. Bun tests, actual module retrieval traces, repeated model behavioral evaluations, accepted Geometry/Texturing/Animation visual outcomes and cost-to-quality comparisons have **NOT EXECUTED**. Next on an available cloud runner: `cd mcp && bun install --frozen-lockfile && bun test tests/repository/agent-skill-context-budget.test.ts tests/repository/skill-lane-contract.test.ts tests/repository/authoring-skill-owner-integrity.test.ts`, followed by owner-required source verifiers. Do not ask the user's PC to perform source acceptance. Native Blockbench evidence remains a later separate gate.



**2026-10-18 Texturing alpha-safety source change (pending matching-SHA proof):** geometry-aware wear/cavity/contact/exposure treatments and source-composed edge/directional wear now use RGB-only masked blending, skipping fully transparent atlas pixels and retaining original opacity/cutout/emissive alpha. General-purpose `applyMaskedColor` retains legacy RGBA behavior unless explicitly passed the preservation options. Affected owners: `mcp/lib/texture/maskedOps.ts`, `geometryAwareTreatment.ts`, `sourceComposer.ts`, with focused behavioral fixtures in `mcp/tests/texture-masks.test.ts`. This prevents an identified source-level alpha corruption path; it does **not** certify artistic Texture PASS or Minecraft renderer fidelity. No assets were edited, deleted or re-exported.

**Next evidence:** on an actual cloud checkout with Bun, run `cd mcp && bun install --frozen-lockfile && bun test tests/texture-masks.test.ts tests/texture-treatment-intelligence.test.ts tests/authoring/texture-production-discipline.test.ts`, then source typecheck/docs/source gates. Native mapped preview and in-game alpha behavior remain **NOT EXECUTED**; the user's PC/localtest is not required for remote source work.



**2026-10-18 canonical save/Workspace semantics — SOURCE_IMPLEMENTED `d72120df`:**
`export_model(codec_id=project,path=...)` now reports `NATIVE_PROJECT_SAVE`
when the target exactly equals the currently bound project `save_path`, and
`NATIVE_PROJECT_SAVE_AS` for a changed target path. Both preserve explicit
overwrite consent, native `afterSave` lifecycle validation, failure recovery,
and no automatic retry. Regression: existing native filesystem fixture covers
same-path saves, lack of metadata identity changes, consent enforcement, and
existing Save As/error cases. Workspace root and active-index instructions now
agree: one canonical editable `.bbmodel`, checkpoint only at meaningful
boundaries, no automatic archive without the user's explicit direction; do not
rename or delete historical user files.

**Proof:** at `d72120df`, GitHub HEAD/one-commit diff and 10 source
consistency checks were observed. Matching-sha Bun tests, Gateway typecheck,
`docs:check`, CI, native Blockbench save/reopen and persistence **NOT
EXECUTED**. No demonstrated reduction in actual save count or disk usage.

**Next independent REMOTE_GITHUB work:** audit whether other concrete
save/checkpoint callers bypass this canonical path; inspect Workspace files
read-only and avoid bulk moves/deletes. Review exact owner code and add tests
only for reproduced source defects. On an available authenticated cloud
checkout, run `cd mcp && bun install --frozen-lockfile && bun test
tests/export-native-filesystem.test.ts tests/export-lifecycle-control-delta.test.ts`
plus `bun run typecheck` and owning repository gate; do not require the
user's PC. Native matching-build Save/Save As and user-owned historical
workspace cleanup remain separate deferred proof.



**2026-10-18 Animation capture source hardening (`8f11e41`, `8874d3f`):** `animationAwareCaptureModelViewsParameters` now budgets actual resolved camera views (including implicit evidence-target/risk expansion), preview times and possible second silhouette PNGs against eight images; uses safe schema extension to keep inherited capture restrictions; multi-time aggregation rejects missing native view receipts/media rather than reporting a partial-success batch. Focused contract fixtures exist in `mcp/tests/animation-runtime-optimization.test.ts`. The old wrapper still restores editor animation state per sample: do **not** optimize its lifecycle until native full-state restoration is proven. No extra capture capability or screenshot-per-frame workflow was introduced.

**Source proof boundary:** Two commits verified at `Local` head `8874d3f`; ten targeted string assertions about source/test presence were inspected. Bun tests, typecheck, CI exact-SHA, installed Blockbench view capture, actual media-byte budget, and full animation preview restoration have **NOT EXECUTED**. The observed build 3.0 screenshot overhead is historical and cannot be used to claim measured reduction. On an available cloud checkout run `cd mcp && bun install --frozen-lockfile && bun test tests/animation-runtime-optimization.test.ts tests/animation-preview-state.test.ts tests/camera-framing-contract.test.ts` followed by `bun run typecheck`, `bun run typecheck:gateway` and relevant source gates; leave live proof pending without asking the user to localtest.



**Working HEAD before this continuity update:** `ef6cdb22` on `Local`.
Source-only changes, no installation/localtest/release and no changes to historical `3.0` or `main`.

- `9d5c5fa`, `8b1c547`, `0497c62`, `1712e999`: bounded Reference projection detects omitted rows/fields/lists, marks active-stage-only incompleteness, preserves source revision identity and recovery pointer, and supports explicit fingerprint-pinned 24-entry / 16-KiB pages through the existing four-tool Gateway `status`.
- `f2199f0`, `6ab7dada`: Gateway client bootstrap separates handles from loaded Skill content, requires a judgeable sample before costly propagation; Geometry has specific numeric/unit/native-format-warning preflight without universal size restrictions.
- `c1f9244`, `9d8780e`: Reference parser no longer silently ignores nonflat fields, mixed lists, malformed section types or malformed rows; `known_context_ids` now explicitly describes retained *client text*, not merely an ID.
- `ef6cdb22`: Workspace README lists over eight blockers expose `WORKSPACE_PROJECTION_INCOMPLETE`, a recovery path/omitted count and a hash of the hidden tail. Readiness becomes `NEEDS_ORIENTATION`, not a false READY or an automatic native block.

**Proof:** GitHub commits/branch plus twelve targeted static source-presence checks were observed at `ef6cdb22`. **Bun tests, typecheck, docs generation/check, full CI, installed client behavior, native Blockbench and reference/model visual review were NOT EXECUTED.** Static checks are not functional tests or evidence of fewer warnings, less token spend, or higher artistic quality.

**Cloud test path when an authenticated checkout/Bun runner is available:** `cd mcp && bun install --frozen-lockfile && bun test gateway/control/referenceParser.test.ts gateway/control/referencePackage.test.ts gateway/control/workspaceSemantic.test.ts gateway/control/contextProjection.test.ts gateway/control/readiness.test.ts tests/gateway-control-context-headroom.test.ts tests/gateway-control-active-contract.test.ts tests/authoring/model-effectiveness-primary-geometry.test.ts`. Follow with `bun run typecheck:gateway`, `bun run docs:check` and the owning source verifiers. The connected GitHub Actions surface currently cannot dispatch the manual `MCP Verify` workflow, and this chat container lacks Bun and external DNS; do not ask the user to run these as a prerequisite. Do not claim PASS until matching-SHA jobs actually execute.

**Remaining ChatGPT/GitHub-first partition:** audit canonical save/export/checkpoint behavior, Workspace scratch-vs-authority boundaries, Animation evidence/screenshot economy, and Geometry warning sources at their exact owners. Add only independently testable source/tests without new framework/tool count. Client Skill retention after compaction and animation/geometry visual quality require matching client/runtime observation; keep those claims UNVERIFIED and avoid taking the user's local PC as a dependency.

## Immediate MCP work

**2026-10-17 bounded LOCAL_CODE delivery:** resize/delete/native animation export implemented in `727bcee6`, `12f8bb29`, `63b2985b`; generated artifacts now regenerated and `docs:check` PASS on this port. Thirteen focused tests/build/Gateway typecheck/surface budget PASS. Next diagnose eight baseline full-typecheck diagnostics and repository gate failures at their own owners, then obtain matching-build native Undo/rollback/export evidence. No install/release authorized. [Citadel report](mcp-session-retrospective-2026-10-17.md) records package outcome and research backlog; do not reimplement these three fixes or treat partial gates as `verify:full` PASS.

**R02 readiness edge case (2026-10-16):** Only explicit `mcp_client_ready=true` now marks Runtime execution-ready. A missing optional internal snapshot field no longer passes via `!== false`; cold HTTP-only probing is still `NEEDS_ORIENTATION` and a confirmed prior failure stays BLOCKED. This is a source-only fail-closed correction with a focused fixture; Bun/CI/native NOT_EXECUTED.


1. **Verify recent correctness changes before extending Runtime.** Current source commits: `0b1caa56` (same-size/restored-mtime Workspace/Reference/Skill cache invalidation and decision-warning/image compaction), `2fd09e6e` (cold HTTP health ≠ MCP handshake READY), `429706fc` (UV production Layout/PASS owned by Geometry/Modelling; Texturing owns atlas/Painter; `manage_uv_layout` unregistered), and `3bbb057a` (Animation handoff approval/authorization is caller-declared, not independently verified; checkpoint path/file metadata is checked by native Runtime before Stage switch). **All are SOURCE_IMPLEMENTED; exact-SHA Bun/CI/native NOT_EXECUTED.** No new public Gateway tools were added.
2. **Run focused source tests on a capable cloud checkout**, not the user's PC: `cd mcp && bun install --frozen-lockfile`, then `bun test gateway/control/contexts.test.ts gateway/control/workspaceSemantic.test.ts gateway/control/referencePackage.test.ts gateway/presentation/resultCompaction.test.ts gateway/control/readiness.test.ts gateway/control/snapshot.test.ts tests/uv-registration-readiness.test.ts tests/authoring-readiness-gate.test.ts tests/contracts/authority-transition-receipt-contract.test.ts tests/authoring-residue-handoff.test.ts`. Investigate actual failures at their canonical source owner; never weaken an assertion only to turn a failed gate green.
3. **Generator-owned outputs:** Canonical generation and `docs:check` completed in the 2026-10-17 port. Continue regenerating only through `bun run generate:owned-artifacts` when owners change; do not hand-edit API/HTML/schema. This closes the regeneration residue, not release or global source acceptance.
4. **Exact-SHA proof:** On final source state, execute `bun run verify:full` (or the repository-approved matching-SHA composite source gates). The existing `MCP Verify` workflow is manual `workflow_dispatch` and was not callable through the connected GitHub actions in this ChatGPT session. No current-head PASS exists. Do not create temporary workflows, modify `main`, or misrepresent historical Windows/CI results.

**R02 missing-client diagnostic (2026-10-16):** When internal `mcp_client_ready` is absent, existing fail-closed readiness now returns `RUNTIME_CLIENT_STATE_UNKNOWN` in both Asset Authoring and System Development. Cold HTTP-only probes remain `RUNTIME_HANDSHAKE_PENDING`; known failures remain `RUNTIME_CLIENT_NOT_READY`. Source regression authored, Bun/CI/native NOT_EXECUTED. No new Runtime requests or retries.

**Repository-gate fixes:** Canonical LazyDesigner artifact names replace retired BlockIT expectations in the SHA-pinning test; redundant Texturing Skill prose was trimmed below 9,800 characters without weakening UV ownership. Source checks only; Bun/CI NOT_EXECUTED.

## MCP boundaries still open

- **Animation permission:** `geometry_approved`, `texture_approved`, `autonomous_authorized`, `no_blockers`, and evidence text originate with the caller; truthful receipt labels do not prove real user consent. Native file stat confirms a nonempty file and matching saved project path, not model content checksum, approved reference, or whole-asset quality. Independent authorization evidence remains unresolved; do not invent an approval registry, new MCP tool, or a false user approval claim.
- **UV:** Geometry-approved production UV Layout must reach verified `UV Layout PASS` before texture styling; `create_texture(type=template)` can perform native UV arrangement on shared AUTHORING but is not automatic PASS. Future `manage_uv_layout` remains **NOT REGISTERED**.
- **Project/reconnect/Undo/export:** A disconnected mutation may have `OUTCOME_UNKNOWN`; never auto-retry. Project affinity and exact installed Runtime build identity must be checked. Batch Animation / native Undo/rollback, Save As / export file bytes, lifecycle, and Blockbench playback still need matching-build LIVE_BLOCKBENCH acceptance. The source export route checks size and `afterSave`, not full byte integrity or atomic overwrite.
- **Particle and quality:** Particle loader invocation does not prove emitter trigger or render visibility. Golden Tasks remain `UNMEASURED`; synthetic `quality_preserved` is not human quality acceptance, production cost, or token reduction. **Native
and visual checks remain NOT_EXECUTED until actually observed.** Historical Windows evidence is scoped to old builds, never lifted to the current SHA.

## Desktop / Distribution independent tracks

- **D01.3 identity migration:** Canonical source targets LazyDesigner executable/plugin/Codex key, TLS and managed paths. Legacy BlockIT evidence is read-only detection, never an automatically launched fallback. Exact-SHA Windows package, Rust/frontend, rollback/profile, TLS and installed native acceptance are pending; **no release publication or installed upgrade is authorized**.
- **PM-06 deletion:** User-registered folder, review token, Recycle Bin and no-permanent-delete safeguards are source-authored. Native Windows Recycle behavior (including disabled Recycle Bin, nonfixed drives, cancellation and changed folder tree) is **UNVERIFIED**. Do not claim safe installed deletion until Windows evidence exists.
- **PM-01/03 and UX-01–04:** Desktop project/model explorer, safe Open/Continue/picker, visibility-aware passive watcher and calm error messages are source-implemented. Rust/Svelte/Windows/native tests remain NOT_EXECUTED. Safe local file operations are not contingent on AI/Gateway readiness; don't infer a model count beyond bounded observed entries.

## Execution and STOP rules

The persistent Gateway owns client stability and Runtime recovery; Control owns routing/readiness projections; the installed Runtime/Plugin owns Blockbench native state. Production Gateway remains `status`, `search_capabilities`, `describe_capability`, and `invoke_capability`. Normal authoring reuses known capability/receipt and verifies only affected evidence. Stage Geometry↔Texturing is shared AUTHORING; AUTHORING↔Animation is the only Runtime Surface handoff.

Use source → nearest owner/test → smallest falsifying proof → one bounded commit → continuation when material. `docs:check`, `verify:full`, install/native evidence and model acceptance are separate gates. Avoid extra reports or speculative cost claims. **No second engine, router**, duplicate database, shadow registry, proof-of-proof framework or automatic native retry. Complete the current bounded unit, report exact source/native evidence, then STOP.

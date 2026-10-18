# LazyDesigner Current Validation

This file owns **current proof interpretation only**. Workflow: `docs/01-product/flow.md`; source: `docs/04-system/implementation-map.md`; continuation: `next-action.md`; local/live procedure: `local-acceptance-runbook.md`.

## Current authority

**2026-10-19 First auto Full CI execution at `025f2f2`:** Five actual Local push workflows ran. Release Readiness source-only PASS. `MCP Verify` FAIL at repository gate (14 failing static/contracts, including four outdated manual-trigger assertions identified for repair; other baseline failures remain), `Dependency Security` FAIL on four high advisory findings, and `MCP Conformance` FAIL (144 passed / 38 failed under pinned 2026-07-28 suite). These were actual runnable checks, not static proposals; their failures remain blocking for corresponding claims. Windows Desktop outcome must be checked separately. This batch only repairs stale CI-policy expectations and contributor documentation; it does not resolve unrelated repository, dependency, conformance, Windows or native failures. Source is not accepted.

**2026-10-19 Temporary Full CI activation — source implementation:** Following user authorization, five existing non-publishing workflows are configured to run on each `Local` push: MCP full `verify:full`, dependency security, MCP conformance, Windows Desktop Verify, and release readiness source-only. Manual focused MCP mode remains available; release/draft/packaging workflows stay manual. This source configuration does **NOT** prove that the jobs have run or passed. Check exact-SHA workflow runs, required steps and artifacts. Bun 1.4.3, TypeScript, dependency installation, native Blockbench and visual acceptance remain **UNVERIFIED** until corresponding execution evidence exists; native/visual proof requires separate live acceptance. No `main`, dependency/lockfile, release or user asset changes.

**2026-10-18 Manual CI policy reconciliation — source-only:** `release-readiness.yml` was aligned with the manual-only GitHub Actions contract, and `manual-workflow-policy.test.ts` now covers the registered Release Readiness workflow and the current `lazydesigner-v` tag namespace instead of retired `blockit-v`. The release-readiness runbook now describes manual-only dispatch. Source-text consistency checks and exact branch/commit identity are distinct from Bun/CI execution: Bun 1.4.3 frozen install, `verify:repository`, `verify:full`, TypeScript, Windows packaging, and Blockbench remain **NOT EXECUTED** for this change. No dependency or lockfile change, release, user model, or `main` mutation was made.

**2026-10-18 Progressive Bun test modernization — staged source changes:** GitHub `Local` tree enumeration identified **559** test/spec TypeScript files; staleness was not inferred. Source changes prepared an on-demand heuristic inventory, direct owner-test mapping in the canonical affected-execution planner, negative/fallback regression fixtures and a six-phase canonical plan. **No tests retired, quarantined, weakened or executed through Bun/CI in this batch.** Exact-SHA Bun 1.4.3, typecheck, selector behavior, real time savings, Windows packaging and Blockbench validation remain **NOT EXECUTED / UNVERIFIED**. Any source/static inspection only proves proposed code and file links are present; acceptance requires running the stated phase-0 verifier.



**Seam RGB diagnostics alignment (2026-10-18, source only):** Intra-/cross-
Cube share visible RGB calculation, distinguish zero visible sample evidence
from matching colors, preserve alpha-only discrepancies, and allow explicit
non-opacity alpha-mask interpretation. Pure regression cases prepared.
Actual Bun/CI, render-profile provenance and native Blockbench quality:
**NOT EXECUTED**. No user assets changed.



**2026-10-18 Cross-Cube seam tolerance boundary (source):** `seamContinuity.ts` now groups matched physical edges by actual <=1e-6 endpoint distance, using bounded local spatial lookup rather than 1e-5 rounded exact-key equality. Intentional material boundaries remain excluded; tolerance chains are ambiguous, not clean pairs. Five focused regression fixtures written. **Bun, typecheck, CI, native Blockbench sampling, visual quality and performance NOT EXECUTED.** No user files/assets changed.



**2026-10-18 Shared-UV geometry-driven texture masks — pending source acceptance:** `geometrySignalCompiler.ts` now checks exact reusable UV shading compatibility, partial shared texels, raster aliases and finite normal magnitude; nine pure tests and Texture policy reference edits are prepared. No native project or user files changed. **Bun/CI/typecheck and native visual acceptance NOT EXECUTED**; source checks are not proof of improved asset quality. See [next-action](next-action.md#current-bounded-work--one-flow-context-integrity-chatgpt--github).



**2026-10-18 Texture ScalarMask source hardening:** Masked RGB/RGBA and directional wear now fail on nonfinite mask values (preventing implicit Uint8Array black/zero coercion), invalid RGBA color channels or mismatched mask shape. The geometry-aware treatment path is covered by pure fixture tests. Runtime code/test present; Bun/CI/native execution and visual-quality claims NOT EXECUTED. See [next-action](next-action.md#current-bounded-work--one-flow-context-integrity-chatgpt--github).



**2026-10-18 Skill modular maintenance — repository implementation:** Added a
bounded upgrade/retirement contract to the existing Skill Development owner;
the Skill-budget contract now discovers actual direct reference files and
requires a main-Skill link plus activation fixture for every active module.
Source cross-check: 16 expected link/fixture/policy checks matched candidate
source text. Bun/CI, client module loading and model-quality/native claims
remain NOT EXECUTED. New module names are no longer hardcoded into the budget
test; owner names and routing remain explicit.


**2026-10-18 Skill activation follow-up (source only):** Three authoring Skills now explicitly differentiate required-on-trigger deep module reads and routine no-deep-reference work; Geometry allows sequential distinct modules rather than a strict single-module ceiling. Ten module-loading intent cases are prepared and 22 candidate-source consistency checks were recorded. **Bun, CI exact-SHA, AI tool/client retrieval traces and Blockbench quality NOT EXECUTED**; the cases are expectations, not observed decisions. See [next-action](next-action.md#current-bounded-work--one-flow-context-integrity-chatgpt--github).



**2026-10-18 Quality-First Progressive Skills — source policy change:** The hard per-Skill character rejections have been replaced with advisory thresholds (~15,000 for core Geometry/Texturing/Animation, smaller role-specific review levels elsewhere), while preserving static owner/metadata/direct-module activation contracts. Eight development-only must-load/no-deep-reference scenarios were prepared; these do not demonstrate that the model read or followed a module. **Bun/source CI, model behavior, installed Runtime and visual improvement remain NOT EXECUTED.** This policy change does not modify any asset, main specialist content, or public Gateway tool. See [next-action](next-action.md#current-bounded-work--one-flow-context-integrity-chatgpt--github).



**2026-10-18 Texturing alpha-safety source patch:** RGB-only style overlays in geometry-aware and source-composed edge/directional treatments are explicitly restricted to previously nontransparent pixels and preserve their alpha. The base masked-color helper retains its legacy RGBA default for explicit alpha effects. Focused fixtures check transparent islands, intermediate cutout alpha, repeated treatment and backward compatibility. **GitHub source only: Bun, typecheck, CI, native Blockbench, visual and Minecraft proof NOT EXECUTED.** No measured quality or performance gains claimed.



**2026-10-18 Save Lifecycle / Workspace source change `d72120df`:** differentiates
same-path `NATIVE_PROJECT_SAVE` from path-changing `NATIVE_PROJECT_SAVE_AS`
in the export receipt. Overwrite consent and native Save As side effects are
preserved, no file was moved/deleted. Updated fixture assertions and workspace
policy. GitHub branch + diff and 10 targeted static source checks passed.
**Bun/tests/typecheck/CI and native save/reopen NOT EXECUTED;** no quantitative
improvement or production acceptance claim. Continuation: [next-action](next-action.md#current-bounded-work--one-flow-context-integrity-chatgpt--github).



**2026-10-18 Animation evidence source patch:** Commits `8f11e41` and `8874d3f` cap *potential* image count using resolved views × preview times × optional silhouette image; reject partial/missing per-time native image receipts; and preserve base capture-schema refinements via safe extension. Source+fixture text was inspected at `8874d3f` (ten scoped checks). **No exact-SHA Bun/CI/native verification; no measured saved images or proven full pose-state restoration.** The existing native restoration checklist remains an unresolved acceptance boundary. See [next-action](next-action.md#current-bounded-work--one-flow-context-integrity-chatgpt--github).



**Local source HEAD (before this continuity update):** `ef6cdb22a3b00b7ade7865cba8382cc588807447` (ChatGPT/GitHub). One-Flow hardening through `ef6cdb22` covers loss-aware Reference parsing, active-stage source-tail recovery/paging, explicit client Skill retention semantics, and fail-oriented Workspace blocker overflow handling. Geometry specialist numeric/format preflight guidance and regression fixtures are committed. The public Gateway remains the stable four tools; no native Blockbench asset, installed client or model visual was changed or observed in this phase.

**Completed evidence:** exact branch HEAD/commit ancestry and twelve scoped source-string consistency checks at `ef6cdb22`. These checks establish only that specified code branches and fixture text exist; they are not Bun, compiler, schema, end-to-end or artistic acceptance tests.

**Missing evidence:** Bun test execution, Gateway TypeScript typecheck, generated artifact freshness, source/CI exact-SHA gates, actual client Skill reload after compaction, native geometry warnings, project save/export side effects, animation playback/screenshot economy and user visual quality are all **NOT EXECUTED / UNVERIFIED** for these commits. Historical build `3.0` observations are not evidence for current code. [Exact bounded next actions](next-action.md#current-bounded-work--one-flow-context-integrity-chatgpt--github).

## Windows checkpoint — 2026-10-14

The [Windows report](native-acceptance.md#consolidated-windows-local-test-report--2026-10-14) covers seven stages, hashes, repairs, evidence and open claims.

Installed e9b3bca57a954fa858d4a077ceb000fedf10a627: exact-SHA verify:full, Desktop verify:source (52 Rust tests), package/Desktop build and managed install PASS. Debug: 53 tests PASS. Desktop 0.1.0, editor 5.2.0, Runtime b436485f. Proof: mcp/.cache/local-acceptance/e9b3bca5/; data d824b35c.

Prior fcf66179 + harness 6afc8989: exact-SHA full gates and 12 main native steps PASS; fcf66179/acceptance-summary.json. This is historical coverage, not twelve current-build passes. LIFT and saved fixtures preserved. Technical proof is not visual approval.

Prior 4cd2fd06 PASS: Open/Continue, foreign-title focus, minimized 128s, persistence/reopen, two-Gateway affinity, 16 duplicate launches and NO_WINDOW integration. Proof: 4cd2fd06/acceptance-summary.json. Updates OFF.

Native IPC PASS on e9b3bca5: probe/full-status rejection locks actions until full Refresh recovers; injected DENIED/NO_WINDOW retain fallback/model. Physical Windows PASS on debug 59f0a6c2: delayed unchanged focus owner returned DENIED with another foreground window and NO_WINDOW with a real suspended Blockbench process after saved windows closed. Fixture removed; both models reopened. Proof: 59f0a6c2/physical-focus-acceptance.json. Default release focus owner unchanged.

Prior fcf66179 recovery PASS: profile isolation, close/open, surface handoff, reload, disable/enable and Gateway replacement. Subsequent fixes bound status IPC waits and use native background timers with teardown coverage.


MOCKED IPC timeout/six-focus proof retained. Debug fault seam is forbidden in release. Native normal/forced exit trails distinguish paths; Runtime/model survive. Bounded logs record lifecycle/panic PID metadata.

Historical disappearance UNKNOWN: installed e9b3bca5 survived 120 samples/120s, all responding. Minimized Desktop became targetable on relaunch with the same primary PID. Two-day Desktop/WebView fault and display-reset query found no matching entries. Proof: 59f0a6c2/desktop-{stability-observation,visibility-recovery,webview-fault-check}.json. This does not identify the old cause.

Source 561ee8e4d906654deed8bec6fadef6f8618a88ed: exact-SHA verify:full PASS; .cache/localtest-final-focus-full.log. Earlier combined-runtime installer timeouts are retained in localtest-real-focus-full*.log. Separate Bun processes preserve all 2060 runtime tests and deadlines (2039 + 21 PASS). Installed release remains e9b3bca5; later edits affect debug testing/test composition only.

Golden F lacks reference; six efficiency pairs NOT_EXECUTED, visual UNVERIFIED, tokens null; LIFT excluded. Reporting is complete; historical disappearance remains UNKNOWN.

## Authoring retrospective 2026-10-15

[The session retrospective](mcp-session-retrospective-2026-10-15.md) separates historical Windows acceptance from later Crimson Sentinel asset evidence. The user accepted the animation result; the saved model now contains two animations and two embedded texture variants. Particle appearance remains unresolved and was explicitly deferred. Partial custom-client logging records 492 calls and 43,017,467 bytes; this is neither complete session accounting nor token/cost proof. Later status/context resolution, profile/build mismatch, batch-scale rejection and export metadata effects are observed investigation inputs, not reproduced current-HEAD source diagnoses. No executable gates or live checks were rerun for this documentation task; LD-Q01–Q04 and Golden acceptance are not closed by it.

## Current proof matrix

| Surface | Canonical proof | Status authority |
| --- | --- | --- |
| Repository policy / ownership | `Repository Verify` / `verify:repository` | manual exact-SHA execution when available |
| Executable MCP source | `MCP Verify` | manual exact-SHA execution when available |
| Typecheck / Runtime regressions | `MCP Verify` / `verify:full` | manual exact-SHA execution when available |
| Build + provenance artifact | full `MCP Verify` | exact-SHA workflow + artifact provenance |
| Local executable checkout | `LOCAL_CODE` runbook | matching local execution evidence |
| Installed/native Blockbench behavior | `LIVE_BLOCKBENCH` runbook | matching live execution evidence |
| Visual/reference acceptance | live bounded review | matching live review evidence |

Read current `Local` SHA/checks before claiming current-head PASS; only completed matching exact-SHA proof qualifies.

## Exact-SHA source acceptance

During temporary Full CI authorization, Local pushes trigger full MCP, dependency security, conformance, Windows Desktop and source-only readiness checks. A push or queued run is not acceptance: only completed required PASS steps on exact `github.sha` qualify. `MCP Verify` runs `bun run verify:full` and emits an identified read-only build on success; no live Blockbench acceptance.

Narrow claims can use the appropriate targeted script. The affected-execution planner remains available locally/on demand; the old push-specific affected/full CI decision path is retired. A successful `verify:repository` plus `verify:mcp` on one SHA is composite source evidence, not an executed `verify:full`.

### Optional Head Proof

`Head Proof` is manual-only. It classifies the selected commit relative to its parent. A docs-only head classification means only that executable source did not change relative to its parent. Head Proof is source-equivalence evidence, never a fresh compiler/test/build, native or visual PASS. Source-impacting heads continue to require exact-SHA executable verification; docs-only head evidence never substitutes for that proof.

Compatibility requires `liveValidatedBuilds` matching editor version and bundle identity; none is recorded at this source HEAD. Historical native tests do not validate newer builds.
The existing Control path distinguishes missing Reference Package as
`NEEDS_ORIENTATION` (not `READY`) without denying Runtime queries.
Benchmark-only tracing includes known-precondition rejects; it is not
evidence of reduced Codex tokens. Source/static changes here are not
matching-Bun or live-Blockbench PASS.

## Current source contracts 
Local source declares machine-local Runtime authorization on native HTTPS and known-missing prerequisite enforcement for the four-tool Gateway path. Matching source and bounded native transport/execution proof are recorded above; this does not certify every capability/input.



### Control

Current source implements:

```text
ASSET_AUTHORING / SYSTEM_DEVELOPMENT intake
bounded context selection
content-addressed context handles
bounded development projection
semantic freshness scopes
fail-closed unknown mutation outcomes
control_delta continuation
receipt-bounded verification
```

Freshness scopes are:

```text
GEOMETRY_STRUCTURE
UV_MAPPING
TEXTURE_APPEARANCE
MATERIAL_RENDER
ANIMATION_MOTION
ANIMATION_CONTROLLER
ANIMATION_EFFECTS
PARTICLE_SYSTEM
```

Current source guards canonical capability ownership and mutation-policy
coverage against silent drift. Direct authored mutations cannot default to
`NO_CHANGE`. Receipt-proven state-neutral actions may preserve authored
freshness. Incomplete or uncertain mutation receipts remain conservative.

Stable mutation hot paths now share typed receipt contracts between Runtime
producers and Control for Material, Material Instances, Animation Effects,
Animation Controller, Particle writes, Render Profile writes, Locator/Null,
Group mutations, Remove Element, Bone Rigging and TextureGroup creation.
Producer/consumer receipt drift therefore fails at the shared schema boundary
instead of relying on duplicate handwritten shape recognition.

UV layout changes invalidate UV mapping and Texture appearance while preserving
unrelated evidence. Project creation remains conservative across all authored evidence. Undo/Redo
uses ephemeral semantic history metadata keyed by the native Undo entry object.
When every traversed entry has known metadata, Control invalidates only the
recorded freshness scopes and authoring domains; metadata-only/checkpoint
history can preserve authored freshness. Missing metadata fails closed to
all-scope conservative invalidation. No semantic history database is persisted.

### Development Intelligence

Repository-development intent routing, capability source ownership, changed-path impact and affected-execution planning are canonically owned by `mcp/gateway/development/`. Control may project bounded development results into status, but it is not the source-owner registry.

### Receipt / verification boundary

Complete final-state receipts may replace reassurance reads only when their
shared semantics are sufficient for deterministic continuation. Incomplete
receipts retain focused-read or visual verification.

Actual visual Geometry/Texture/Animation mutation remains visual even when its
structural receipt is complete. Semantic completeness is not visual/reference
acceptance.

### Gateway / Runtime

The public AI-client Gateway surface remains exactly:

```text
status
search_capabilities
describe_capability
invoke_capability
```

Gateway owns client stability, reconnect, project/phase affinity, catalog freshness, serialized dispatch and recovery. Runtime executes in Blockbench.

Unknown mutation outcome is never automatically replayed.

### Protocol / compatibility

Current source retains modern MCP SDK v2 handling plus the bounded legacy JSON
compatibility path. Compatibility-bound `blockit_*`, `BLOCKIT_*` and related
persisted identifiers remain intentional until a separately dependency-mapped
migration.

Do not infer current-head protocol PASS from historical evidence.

## Last reusable proven source baseline

Reuse each Windows checkpoint within its exact scope. Remaining: historical disappearance cause, visual acceptance and real cost-to-accepted-result telemetry. Follow the runbook.

## Proof boundary

Do not strengthen source/static claims into local/live/visual claims without matching evidence from the exact current source SHA.

Source-equivalence, prepared harnesses, static fixtures and historical results do not prove current-source execution. Do not combine proof from different SHAs.

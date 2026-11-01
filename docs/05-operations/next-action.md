# LazyDesigner Next Action

This file owns continuation only. Proof interpretation: [current-validation.md](current-validation.md); local/native acceptance: [local-acceptance-runbook.md](local-acceptance-runbook.md). Git owns completed work history. Test ownership: [test-architecture.md](../04-system/test-architecture.md).

## Primary next — Advanced Geometry CODE-FIRST (2026-11-01)

**USER DECISION:** Complete AI-first plugin code before tests. Do not
run/edit tests, Bun/CI, native QA or release. Preserve one plugin,
existing Gateway four-tool public surface, Recipe engine and Undo.

**R3a–R3c source:** Planar Curve/Taper + Cuboid, Frame, Repeat,
Geometry composition and internal Blockbench create adapter reuse
the existing Recipe compiler and `manage_cubes(create)` executor.

**R3d source:** New `geometrySchema.ts` declares strict AI inputs.
Internal `constructGeometry` dispatches plan/apply. Plan returns a
SHA-256 handle tied to the parsed features and native scene revision;
apply rechecks Project, Group, Stage, Undo and scene before a single
native batch. Stale or ambiguous results never trigger auto-retry.

**CURRENT LIMIT:** This path is create-only. Public
`construct_geometry` is not yet registered, because generator-owned
API docs and registration must be delivered together. Parametric
edit/revision needs Undo-consistent Recipe persistence (Blockbench
does not natively snapshot every Project custom property).

**PROOF:** Source authored only. No tests, build/typecheck, Bun/CI,
native save/reopen, Bedrock export or visual acceptance executed.

**NEXT (CODE):** Complete canonical AI Runtime registration and
generated artifact ownership together; design transactional
Recipe metadata persistence and safe edit of feature cohorts.
QA remains postponed until user explicitly reopens validation.
## GitHub boundary and historical local recovery

- `Local` is the current remote working authority. Re-pin its HEAD before edits; this ChatGPT/GitHub context does not establish a local checkout, Bun or live Blockbench.
- Historical 2026-10-27 machine-local handoff: a primary checkout was dirty at `44b03b52`; 52 recovery payloads and 438 missing Crimson Sentinel paths were recorded. This is **not** proof of the user's present PC state. Do not touch or discard those historical assets.
- CI DISABLED: verification definitions remain inert. Do not enable workflows, change `main`/settings or publish releases.

## Current source / installed proof boundary

Gateway Stage receipt consistency and historical Golden/affected-test guards are source-authored, but NOT active Knowledge research work; Bun/native proof remains NOT EXECUTED. Prior installed `7b45bd69` / Desktop 0.1.1 evidence is historical. See [current-validation.md](current-validation.md). Protect user assets; no deployment, CI or release.

## Deferred Gateway integration context

**P0 integration:** Gateway verifies Stage/surface/target receipts. Rejected successful affinity mutations now require state inspection, not replay. Normal Control Delta uses the backend-verified project UUID for task-cohort continuity. Stage-before now comes from the same queued native preflight, without a separate status probe. Binding, catalog, same-Stage no-op and generation guards remain. Native proof/cost pending; no new routing or benchmark.

Production Gateway remains status, search_capabilities, describe_capability and invoke_capability. Retain direct-first routing, branch-specific schema retrieval, authoritative receipts and conservative OUTCOME_UNKNOWN recovery. Do not promote hybrid_4_experimental from static replay. control_delta and continuation contain intentional versioned recovery overlap; do not delete it for payload savings. Host search/compaction/model settings remain host-owned.

## Deferred capability-specific residue

- Legacy Active Workspace READMEs contain ambiguous or missing lifecycle fields; Control correctly requests orientation rather than inferring approval. Reconcile only the explicitly selected asset against its current native state; never bulk-rewrite historical models or fabricate approval/checkpoint hashes.
- UV apply receipt authority now governs both Graph readiness and UV/Texture recheck scope; contradictory receipts cannot narrow seam verification. Native Atlas audit reviews orphaned/blank Texture UUIDs; unregistered painted-atlas migration checks both moved-face Texture ownership and resolved native Texture object identity without rejecting valid material overrides. `manage_uv_layout` and painted-atlas migration remain unregistered pending generator and native proof.
- LIVE_BLOCKBENCH is not yet established in this reconciliation. LD-Q01 silhouette, LD-Q02 atlas seams, LD-Q03 rotated pivots, LD-Q04 animation restoration, particle playback, saved-model/reference quality and Golden F retain existing proof boundaries. Use the native runbook only with a matching installed build, functioning Gateway and authorized disposable fixture.
- Windows installer/OS interactions, narrow viewport and real AI token/latency comparisons are separate from source tests. Historical security/dependency results are not current audits. A particular native residue needs its own bounded task; availability of the PC alone is not proof or activation.

## System boundaries and STOP

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness; Runtime and Plugin own Blockbench-native state. Geometry and Texturing share AUTHORING; Animation handoff is explicit. Never replay an uncertain mutation.

Only the canonical generators may update these artifacts: API docs, hybrid schemas and Runtime prompts. Keep this document below 6,000 UTF-8 bytes. Stop after source reconciliation, relevant proof and coherent continuity; no release, new public capability or unsolicited asset work.

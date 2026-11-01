# LazyDesigner Next Action

This file owns continuation only. Proof interpretation: [current-validation.md](current-validation.md); local/native acceptance: [local-acceptance-runbook.md](local-acceptance-runbook.md). Git owns completed work history. Test ownership: [test-architecture.md](../04-system/test-architecture.md).

## Primary next — Advanced Geometry CODE-FIRST (2026-11-01)

**USER DECISION:** Code first, no tests or native QA until feature code
is mature. Keep one LazyDesigner plugin/Recipe engine, the four Gateway
tools and existing Blockbench-native Undo; no manual UI requirement.

**R3a–R3d source:** Curve, Cuboid, Frame and Repeat Recipe composition;
strict AI shape schema; internal `constructGeometry` plan/apply with
exact Project/Group, source- and scene-revision checks; native create-only
executor. No public AI `construct_geometry` tool registered yet.

**R3e source:** Existing Recipe transactions now preflight and serialize
the Project's canonical Recipe store. On a native Cube commit, store
before/after metadata is stamped on the same Blockbench Undo save;
native undo/redo listeners reconcile only matching Project and source.
Metadata-only native updates without attributable Undo fail closed.
Cross-session Recipe store is still the existing ModelProject property.

**PROOF:** Source-only code; no Bun/build/CI, tests, installed Blockbench,
Undo/Redo execution, save/reopen, export or visual proof. CI disabled.

**NEXT CODE:** Finish an AI-facing registered `construct_geometry`
capability with canonical generated API artifacts in one coherent
delivery. Keep the native transaction/metadata identity invariant.
Do not hand-edit generated docs; no new tests until user reopens QA.
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

# LazyDesigner Next Action

This is the **single current continuation** owner. Proof: [current-validation.md](current-validation.md); native steps: [local-acceptance-runbook.md](local-acceptance-runbook.md); test policy: [test-architecture.md](../04-system/test-architecture.md). Git commits own completed work; this file is not a history log.

## Active execution mode — ChatGPT development + Codex testing/use (2026-11-05)

User-corrected workflow: (1) ChatGPT and the GitHub connector own source development, audits, regressions, documentation, and coherent commits on `Local`; (2) Codex owns executable verification and product usage when implementation is ready and the actual checkout/toolchain is present. No additional cloud test service, GitHub verification Actions or user-PC instructions are required. `REMOTE_GITHUB` does not imply testing. A named Codex session does not prove `LOCAL_CODE` or `LIVE_BLOCKBENCH` until those capabilities are observed.

Current source authority: `7da9e6e2cdc12c87fe1cce0da2dcffd33f365018` introduced the Harness²-style read-only candidate evidence gate and authored regressions. These source contracts have NOT been executed in Codex, and no real model-backed probe or native Golden quality acceptance is demonstrated. Preserve accurate proof limits while continuing independent ChatGPT/GitHub development. On Codex test runs, pin a specific `Local` SHA and return executable failures and evidence for bounded source correction.
Harness candidate Codex evaluation handoff: use the focused source regression
`bun test tests/benchmark/golden-session-comparison.test.ts` on a clean
checkout at the exact tested SHA. Do not call this a visual/model-quality
test. An optional A/B experiment uses two isolated temporary candidate
contexts under one fixed source revision and disposable Golden inputs, per
`mcp/docs/QUALITY_BENCHMARK.md`. Comparison across different committed Skills
is not currently isolated. The evaluator is source-complete but no actual
Codex, Golden or native result is yet verified; there is no automatic
promotion. System code stays developed in ChatGPT; Codex only verifies and
operates the MCP. P0 readiness synchronization remains the current primary
product implementation priority.



## Primary next — Capability source stabilization (2026-11-04)

**Goal:** preserve existing useful Geometry, Texture and Animation capabilities while resolving inaccurate readiness/ownership. No feature expansion, new framework, CI activation or mass cleanup.

**Source authority at the current `Local` branch:**
- `lib/capabilities/manifest.ts` + `gateway/capabilities/manifest.ts` declare metadata, semantics and prerequisites, **not** executable registration.
- `server/runtime/registration.ts` decides enabled tools for profile/Stage. Gateway `runtime/backend.ts` discovers/describes from the actual Runtime catalog; absent exact identities fail closed.
- `gateway/capabilities/graph.ts` currently defaults to `READY` when no graph entry is found. This remains an **internal branch-readiness ambiguity**, not Runtime availability or native proof.
- `gateway/control/capabilities.ts` presents unresolved branch-qualified operations as `UNKNOWN`, including when a generic branchless graph also exists, while retaining confirmed `BLOCKED`. This only safeguards **AI discovery presentation**, not graph execution; the new fallback case has authored (not executed) regression coverage.
- `manage_cubes` and `paint_texture_transaction` have registered routes. `construct_geometry`, `manage_uv_layout`, painted-atlas migration and Cluster authoring remain **UNREGISTERED**.

**Next complete implementation unit:** reconcile unknown/branchless graph readiness with exact branch semantics, canonical semantic revision, owning regressions and generated API/HTML **together**, then verify at the same SHA. The existing affected runner refuses unsynchronized semantic implementation changes. No partial graph edit or manual editing of generator-owned outputs. For this coupled unit, ChatGPT completes source design, impacted consumers and regression preparation; Codex performs the canonical generator and executable verification when the code and its toolchain are ready. Keep the edit atomic across semantic revision, graph, tests and generated API/HTML; never manually edit generator-owned outputs or commit an incomplete contract.

Continue independent source/consumer work in ChatGPT and commit complete bounded units. Mark authored tests NOT EXECUTED until Codex actually runs them. Do not treat Codex testing as a prerequisite for unrelated source work, and do not infer native/visual PASS from source-only evidence.

## Deferred capability-specific work

- **Cluster Control:** current source preflight requires Geometry APPROVED, UV PASS, READY Reference, no Workspace blockers and a fresh trusted Control observation after reference PNG reads. Project/generation/Workspace drift fails closed. Cube/UV/bitmap, face-local recolor/source-ramp and native paint/Undo guards are source-authored. **No registered public route, no native execution/visual proof.** A preflight receipt is not mutation authority. Keep Geometry frozen; reuse the existing paint executor.
- **Geometry:** `construct_geometry` is unregistered (historical v12–14 work `addfb6a008b9af8baf0417ff23435046df7285d4`). Do not publish merely because its source exists.
- **UV/Texture:** `manage_uv_layout` and painted-atlas migration remain unregistered. Native Texture ownership, updated UV receipt and target recheck guards must survive integration; no synthetic readiness promotion.
- **Workspace:** historical Active project READMEs may omit approval/lifecycle fields; ask for current evidence only for the selected asset. Never bulk-rewrite or invent approval/fingerprint values.
- **Native QA:** LD-Q01 silhouette, LD-Q02 atlas seams, LD-Q03 rotated pivots, LD-Q04 animation restoration, particle playback, save/reopen/export and Golden visual acceptance require the matching installed build and real evidence. No automatic MP4 route (retired).

## Gateway / compatibility invariants

Exactly four normal Gateway tools: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`. Gateway retains reconnect/project/Stage and interrupted-mutation safety; Runtime/Plugin own native mutation; Control owns readiness, Stage context and `control_delta`. Geometry/Texturing share AUTHORING; Animation has an explicit handoff. Never replay uncertain mutations or promote `hybrid_4_experimental` from static evidence.

Root `lib/*` and Gateway facades can be intentional compatibility re-exports. Do **not** delete based on size or appearance. First prove zero source/test/external consumers and migration-safe public exports. Do not delete Workspace assets or historical research from static estimates.

## Execution and proof ceiling

- `Local` is the only authorized working branch; `main` and release settings remain unchanged.
- CI verification was disabled on 2026-10-20. Latest Bun, TypeScript, docs generator, CI, native Blockbench, Undo, Windows installer, Golden and performance acceptance: **NOT EXECUTED** in this GitHub-only reconciliation. Historical installed build `7b45bd69` / Desktop 0.1.1 evidence does not qualify current `Local`.
- The prior 2026-10-27 machine-local recovery noted 52 payloads and 438 Crimson Sentinel paths; these are **historical**, not proof about the user's current PC. Preserve all user assets.
- Generated API docs, hybrid schemas and Runtime prompts must be changed only through canonical generators. No release, new public capability, CI reactivation or local-PC prerequisites.

**STOP** after a coherent scoped source unit and actual available proof; hand off only unavoidable generator/native residue. Do not expand the task merely because more source exists.

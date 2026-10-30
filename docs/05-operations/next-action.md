# LazyDesigner Next Action

This file owns continuation only. Proof interpretation: [current-validation.md](current-validation.md); local/native acceptance: [local-acceptance-runbook.md](local-acceptance-runbook.md). Git owns completed work history. Test ownership: [test-architecture.md](../04-system/test-architecture.md).

## Primary next to do — Texture & UV (2026-10-29 chat handoff)

**USER DECISION: STOP Geometry; next chat = Texture & UV via ChatGPT + GitHub (`OpenITStudios/M-LazyDesigner`, branch `Local`).** Do not resume Geometry R0–R5, Animation or live benchmarks without a new request.

**Frozen Geometry checkpoint:** G1/G2 + R1–R4 source; R5 paired Golden benchmark source prepared. Last Geometry commit `ec22a6e9d2420f12d116f31bc25ce59491956150`. Bun/typecheck/build, native/visual acceptance NOT EXECUTED; no Geometry quality PASS. Preserve source/proof history.

**Texture & UV K0–K9 (2026-10-30):** [112 sources](../03-authoring/texture/research-sources.md), [25 decision families](../03-authoring/texture/knowledge-coverage.md), [four pinned cases](../03-authoring/texture/decision-cases.md), K4–K6 review-only Gateway guidance, K7 audit, K8 verifier and [K9 source-closure](../03-authoring/texture/knowledge-integration.md). No automatic UV/Texture mutation; all eight Golden Tasks UNMEASURED. Exact-SHA Bun/typecheck/build/CI/native/visual/human verification NOT EXECUTED.

**P0 Texture/UV source evidence (2026-10-30):** Control verifies current image SHA/SURFACE_DETAIL and samples ≤16 exact source RGB roles; `palette.ts` reviews source-bound shadow/base/highlight/identity. SHARED conflicts and Cross-Cube partial diagnostics stay explicit. New source-only `surfacePattern.ts` face preflight measures **actual physical texels/model unit** and signed motif direction after UV flip/90° rotation using canonical mapping, with explicitly chosen density/direction targets. An unregistered native read-only inspector pins current Cube/face/Texture ownership; no auto-UV, paint, material inference, new Gateway tool, asset write or release. Bun/typecheck/CI/native/visual/Golden **NOT EXECUTED**. Next exact-SHA source tests, then matching-reference native/Bedrock acceptance.

**Order:** Texture & UV ACTIVE; Geometry PAUSED; Animation DEFERRED.

## Current working environment

- 2026-10-27 user handoff: upload all completed work to `OpenITStudios/M-LazyDesigner` / `Local` and continue outside Codex. Baseline `6569aaf2`; re-pin GitHub HEAD. No deployment or app changes.
- Primary stays dirty at `44b03b52`; source/assets already reconciled, current root-policy edits included. Recovery retains 52 payloads; 438 missing local asset paths remain in Git. Preserve the original checkout.
- Cached Bun 1.4.3, Node 24.22.0 and Rust 1.99.1 are available. Reuse unchanged dependencies.
- CI DISABLED: verification definitions remain inert. Do not enable workflows, change main/settings or publish releases. Native installation/asset mutation is not part of source reconciliation.

## Current source / installed proof boundary

Geometry through `ec22a6e9` and R5 comparator source are preserved; Bun/typecheck/build and native/visual acceptance have NOT EXECUTED on them. The older managed `7b45bd69` / Desktop 0.1.1 transport/package qualification applies only to that installed source, not to recent Recipe commits. Detailed prior environment, migration, recovery and execution receipts belong to [current-validation.md](current-validation.md). Preserve the dirty primary checkout, source assets and recovery inventory; do not use the user's PC, deploy, restart clients, enable CI or publish releases. Re-pin GitHub HEAD before any future source work.

## Next REMOTE_GITHUB work

**Texture & UV is the selected next work.** Geometry R0–R5 is paused, and all other MCP work stays deferred unless it directly supports Texture/UV.

Production Gateway remains status, search_capabilities, describe_capability and invoke_capability. Retain direct-first routing, branch-specific schema retrieval, authoritative receipts and conservative OUTCOME_UNKNOWN recovery. Do not promote hybrid_4_experimental from static replay. control_delta and continuation contain intentional versioned recovery overlap; do not delete it for payload savings. Host search/compaction/model settings remain host-owned.

## Deferred capability-specific residue

- manage_uv_layout registration and generator-owned API output must change together in a separately scoped LOCAL_CODE activation. Its source-only plan/rollback/pixel-migration helpers do not establish an installed UV workflow. Painted-atlas production repack remains guarded; do not connect unregistered migration code as a compiler repair.
- LIVE_BLOCKBENCH is not yet established in this reconciliation. LD-Q01 silhouette, LD-Q02 atlas seams, LD-Q03 rotated pivots, LD-Q04 animation restoration, particle playback, saved-model/reference quality and Golden F retain existing proof boundaries. Use the native runbook only with a matching installed build, functioning Gateway and authorized disposable fixture.
- Windows installer/OS interactions, narrow viewport and real AI token/latency comparisons are separate from source tests. Historical security/dependency results are not current audits. A particular native residue needs its own bounded task; availability of the PC alone is not proof or activation.

## System boundaries and STOP

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness; Runtime and Plugin own Blockbench-native state. Geometry and Texturing share AUTHORING; Animation handoff is explicit. Never replay an uncertain mutation.

Only the canonical generators may update these artifacts: API docs, hybrid schemas and Runtime prompts. Keep this document below 6,000 UTF-8 bytes. Stop after source reconciliation, relevant proof and coherent continuity; no release, new public capability or unsolicited asset work.

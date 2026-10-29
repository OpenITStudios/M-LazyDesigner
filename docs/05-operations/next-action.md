# LazyDesigner Next Action

This file owns continuation only. Proof interpretation: [current-validation.md](current-validation.md); local/native acceptance: [local-acceptance-runbook.md](local-acceptance-runbook.md). Git owns completed work history. Test ownership: [test-architecture.md](../04-system/test-architecture.md).

## Primary next to do — Texture & UV (2026-10-29 chat handoff)

**USER DECISION: STOP Geometry; next chat = Texture & UV via ChatGPT + GitHub (`OpenITStudios/M-LazyDesigner`, branch `Local`).** Do not resume Geometry R0–R5, Animation or live benchmarks without a new request.

**Frozen Geometry checkpoint:** G1/G2 + R1–R4 source; R5 paired Golden benchmark source prepared. Last Geometry commit `ec22a6e9d2420f12d116f31bc25ce59491956150`. Bun/typecheck/build, native/visual acceptance NOT EXECUTED; no Geometry quality PASS. Preserve source/proof history.

**Texture/UV K0–K6 (2026-10-30):** [K1 112-source research](../03-authoring/texture/research-sources.md) → [K2 25 decisions](../03-authoring/texture/knowledge-coverage.md) → [K3 four source-pinned cases](../03-authoring/texture/decision-cases.md) → [K4–K6 integration](../03-authoring/texture/knowledge-integration.md). K5 connects UV-P01 to current exact-reuse/overlap evidence from opt-in `list_textures` Gateway diagnostics. K6 connects TEX-P01 only to sampled solid-color face coverage; `planTextureTreatment` flags provable conflicting SHARED pixel/material/color/PBR declarations and rechecks identity before seam handoff. Every knowledge hint is SOURCE_CANDIDATE/REVIEW_REQUIRED, no automatic UV/Texture mutation, visual/model source attestation or target runtime compatibility. K3 TEX-P02/TEX-P03 abstain without actual cross-Cube reference and renderer binding.

**Texture/UV K0–K9 source closure (2026-10-30):** K1 broad primary research, K2 coverage, K3 four source-pinned candidate cases, K4 read-only resource, K5/K6 opt-in live diagnostics and SHARED conflict guards, K7 source audit, K8 disposable verifier preparation, and [K9 source-only final audit](../03-authoring/texture/knowledge-integration.md) recorded on `Local`. K9 now preserves full case provenance (`source`, `section_id`, `title`, SHA-256) in normal Gateway hints, without any new tool. All hints remain REVIEW_REQUIRED/nonmutating; all eight existing Golden Tasks remain UNMEASURED. **No Bun/typecheck/build/CI/native/visual/human PASS was executed.** Next only when execution is available: exact-SHA Bun tests/affected/build, disposable Geometry→Texturing native verify, then same-approved-reference K9 Golden baseline/candidate and Bedrock renderer/export review. Do not add new frameworks, reopen Geometry/Animation, register `manage_uv_layout`, enable CI, modify an asset or publish a release.

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

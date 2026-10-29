# LazyDesigner Next Action

This file owns continuation only. Proof interpretation: [current-validation.md](current-validation.md); local/native acceptance: [local-acceptance-runbook.md](local-acceptance-runbook.md). Git owns completed work history. Test ownership: [test-architecture.md](../04-system/test-architecture.md).

## Primary next to do — verified Recipe knowledge (2026-10-29)

**User priority; G1 eight source-grounded candidates authored; tests/native/visual NOT EXECUTED.** Build on the single Knowledge + Recipe authoring path committed at `8155cb2d`. Enrich it **sequentially**, with a reviewable result for each domain before advancing:

1. **Geometry first:** follow [Geometry Knowledge Curation](../03-authoring/modelling/knowledge-curation.md): review [eight G1 source-grounded case pairs](../03-authoring/modelling/decision-cases.md) (G-P01..G-P08), execute their focused Recipe retrieval regressions on matching source, then connect bounded Runtime retrieval and compare identical approved references. G1 cases authored, executable proof pending; G2+ NOT STARTED.
2. **Texture second:** curate UV/atlas layout, Minecraft pixel-cluster treatment, palette/material/PBR semantics and seam-safe texture patterns. Preserve the reference's visual identity and measure mapped-model quality.
3. **Animation third:** curate grounded rig/motion/keyframe, interpolation, contact, loop and controller patterns. Compare playback, motion fidelity and export correctness.

For each stage, study official Mojang Bedrock Samples and Blockbench references first; community/Blockbench Workshop/marketplace examples require verifiable origin, version, usage rights and applicability. Extract transferable techniques, **never copy protected marketplace assets**. Keep `mcp/lib/authoringRecipe/` as the decision owner and reuse the `mcp/lib/semantic/knowledge.ts` index, current Validation and the four Gateway tools; do not introduce a second engine, database or godfile. Record source/compatibility, focused deterministic regressions, and separately verified native/visual results plus cost-to-accepted-result; static source is not runtime or visual PASS. Do not start these phases until the next explicit continuation request.

## Current working environment

- 2026-10-27 user handoff: upload all completed work to `OpenITStudios/M-LazyDesigner` / `Local` and continue outside Codex. Baseline `6569aaf2`; re-pin GitHub HEAD. No deployment or app changes.
- Primary stays dirty at `44b03b52`; source/assets already reconciled, current root-policy edits included. Recovery retains 52 payloads; 438 missing local asset paths remain in Git. Preserve the original checkout.
- Cached Bun 1.4.3, Node 24.22.0 and Rust 1.99.1 are available. Reuse unchanged dependencies.
- CI DISABLED: verification definitions remain inert. Do not enable workflows, change main/settings or publish releases. Native installation/asset mutation is not part of source reconciliation.

## Current source / installed proof boundary

Recipe Knowledge + Planning source is committed through `8155cb2d`; newly authored tests, Bun/typecheck/build, native Blockbench and visual acceptance have NOT been executed for that revision. The older managed `7b45bd69` / Desktop 0.1.1 transport/package qualification applies only to that installed source, not to recent Recipe commits. Detailed prior environment, migration, recovery and execution receipts belong to [current-validation.md](current-validation.md). Preserve the dirty primary checkout, source assets and recovery inventory; do not use the user's PC, deploy, restart clients, enable CI or publish releases. Re-pin GitHub HEAD before any future source work.

## Next REMOTE_GITHUB work

The verified Recipe knowledge roadmap above is the principal next development goal; other MCP work remains deferred unless needed to unblock its exact owner or acceptance.

Production Gateway remains status, search_capabilities, describe_capability and invoke_capability. Retain direct-first routing, branch-specific schema retrieval, authoritative receipts and conservative OUTCOME_UNKNOWN recovery. Do not promote hybrid_4_experimental from static replay. control_delta and continuation contain intentional versioned recovery overlap; do not delete it for payload savings. Host search/compaction/model settings remain host-owned.

## Deferred capability-specific residue

- manage_uv_layout registration and generator-owned API output must change together in a separately scoped LOCAL_CODE activation. Its source-only plan/rollback/pixel-migration helpers do not establish an installed UV workflow. Painted-atlas production repack remains guarded; do not connect unregistered migration code as a compiler repair.
- LIVE_BLOCKBENCH is not yet established in this reconciliation. LD-Q01 silhouette, LD-Q02 atlas seams, LD-Q03 rotated pivots, LD-Q04 animation restoration, particle playback, saved-model/reference quality and Golden F retain existing proof boundaries. Use the native runbook only with a matching installed build, functioning Gateway and authorized disposable fixture.
- Windows installer/OS interactions, narrow viewport and real AI token/latency comparisons are separate from source tests. Historical security/dependency results are not current audits. A particular native residue needs its own bounded task; availability of the PC alone is not proof or activation.

## System boundaries and STOP

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness; Runtime and Plugin own Blockbench-native state. Geometry and Texturing share AUTHORING; Animation handoff is explicit. Never replay an uncertain mutation.

Only the canonical generators may update these artifacts: API docs, hybrid schemas and Runtime prompts. Keep this document below 6,000 UTF-8 bytes. Stop after source reconciliation, relevant proof and coherent continuity; no release, new public capability or unsolicited asset work.

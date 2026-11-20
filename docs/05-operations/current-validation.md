# LazyDesigner Current Validation

**Observed source baseline (2026-11-20):** `OpenITStudios/M-LazyDesigner`, branch `Rust`, executable source inspected at `fa1383524b0c0fb36da11418b2db1f7a5b5f65a8`. The companion [Next Action](next-action.md) owns present focus; [implementation map](../04-system/implementation-map.md) owns paths. This document owns **proof**, not another progress log.  
**Surface:** `CHATGPT_GITHUB`. `CI=DISABLED`, `tests=ON_HOLD`, `local/native validation=DEFERRED`. No user-PC, Windows/WebView2, Rust/Node/Deno executable or Blockbench connected test was performed in this review. Historical local/CI success cannot be transferred to current Rust.

## Current proof matrix

| Surface | Verified at source level | Still NOT_EXECUTED / UNVERIFIED |
| --- | --- | --- |
| Architecture | The Rust `EditorSession` is the single transaction/history/document owner; Tauri and Code Mode use the same Rust engine but independent saved-file/GUI sessions | Native behavior, synchronization across sessions, live editing |
| AI composition | One Code Mode guest-to-trusted-host-to-typed-SDK-to-CLI path, bounded reads and single authorized `EditPlan` source | Actual sandbox isolation, secure OS permissions, user-PC Codex integration |
| Geometry | Rust Geometry assembly, transforms, rig, UV, read-only impact/negative-space guard and deterministic rib-array source | Real shape similarity, collision/clearance, pivot correctness in Blockbench |
| Texturing | Source guards for RGBA8, source colors/alpha, UV aliasing, scoped Paint/Undo, 2K+ atlas policies and selected preview; one bounded inspection scratch shared by alpha, coverage and face-style queries | Native Paint accuracy, real multi-atlas memory, seams, blindspots, artistic material quality and measured performance |
| Animation | Source numeric Bone/clip/keyframe/curve and export paths; latest periodic rotation is a read-only plan | Native replay, dynamics, continuity, visual timing, controller semantics outside supported subset |
| Asset handoff | Editable `.bbmodel` and bounded Geometry/PNG/Animation outputs have source-owned serializers and source regressions | Actual Blockbench reopen/edit/re-export equivalence, Bedrock playback, user approval |
| Performance | In-memory host counters and source-level batching/projection/caching are present | Latency, RAM, GPU, paid tokens, cost per **accepted** asset, correction convergence |
| Experimental live bridge | Optional Windows Named Pipe is feature gated, user paired, read-only by design | OS ACL, lifecycle, pairing, recovery, actual Windows operation |

**All test fixtures described above are `TEST_AUTHORED_NOT_RUN`, not PASS.** Any specific source claim needs rechecking at the exact future implementation HEAD. No CI, cloud sandbox or browser emulator may be used as a localtest substitute.

## Quality acceptance held for a later user-selected local-PC phase

- **Editable interchange:** open Rust-exported `.bbmodel` in real Blockbench, edit and save/reopen; compare all supported Geometry, UV, PNG, Bone hierarchy and Animation with the approved source.
- **Visual evidence:** compare appropriate fixed-camera front/back/side/top/bottom views and detail close-ups against the approved references; review actual texture coverage and protected original artwork. The [Pillager Golden A/B contract](../../apps/desktop/code-mode/GOLDEN_PILLAGER_AB.md) provides a representative high-quality regression, not current proof.
- **Correctness and security:** positive/negative SHA/target/UV refusal, user approval, no overwrite, transaction atomicity, Undo/Redo, guest sandbox, stale/timeout/unknown outcomes, and held Windows GUI behavior.
- **Efficiency:** matched tasks with identical references and acceptance criteria; measure end-to-end time, host/Rust calls, tokens if actually observed, rejected proposals, corrections and final user-reviewed quality. Structural simplification is not automatically a performance gain.

Do not demand localtest or release while the project hold remains. Preserve protected paths, project Skills and `Local` behavior. A Rust commit can be `SOURCE_COMMITTED` without an installed editor or visual quality PASS.

## Historical source and native evidence

The complete earlier dated proof ledger remains accessible in the [immutable pre-compaction Current Validation history](https://github.com/OpenITStudios/M-LazyDesigner/blob/fa1383524b0c0fb36da11418b2db1f7a5b5f65a8/docs/05-operations/current-validation.md). Older installed `Local` proof (including `51324f6da133cb728d0cda27f6b1a3358452161d` and `7b45bd69`) is scoped to its original executable revisions, not Rust. Separate durable [native acceptance records](native-acceptance.md) and the [local acceptance runbook](local-acceptance-runbook.md) remain unchanged.

## Current source contracts

`Rust`: source-only independent editor, Code Mode host and typed CLI, fail-closed model formats, one Rust authoring authority. `Local`: retained four-tool Gateway/Control/Blockbench Runtime. The [current branch profile](../../.agent-standard/profile.json) supersedes obsolete history that once described `Local` as the only writable branch. No release, promotion, CI change, automatic local tests or cross-repository writes are authorized by this document.

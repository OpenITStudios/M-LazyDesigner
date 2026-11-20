# LazyDesigner Next Action

**Current focus (2026-11-20):** Stabilize the single `Rust` editor and external-agent saved-file handoff. Domain Geometry/Texturing/Animation intelligence expansion is paused; preserve existing quality/safety contracts.  
**Authority:** `OpenITStudios/M-LazyDesigner`, branch `Rust`; verify current HEAD before changes. `Local` is a separate Blockbench-hosted line; `main` is not an automatic target.  
**Work surface:** `CHATGPT_GITHUB` — source inspection and authorized source edits only.  
**Evidence:** `SOURCE_REVIEWED` / `SOURCE_COMMITTED` where supported; authored regressions are `TEST_AUTHORED_NOT_RUN`. No native/Windows, performance, or visual PASS.  
**Hold:** CI, localtest, Codex execution and native Blockbench validation remain deferred until an explicitly selected PC-local phase. No cloud substitute.
**P0 Rust external-host Stage Gate (2026-11-20):** The first-party real Code Mode host now uses the existing asset README plus exact current .bbmodel file/SHA to gate AI writes by Geometry → UV → Texturing → optional Animation. Mixed/unknown operations and premature stages refuse; an unchanged Stage can use Rust-verified sibling versions in one session. Finalization export admission checks recorded upstream states and actual saved Animation count. The Rust asset handoff no longer confuses no saved clips with no animation requirement. Regression source authored, NOT_EXECUTED; user approval and native/visual proof remain separate.  
**Operator boundary (2026-11-20):** Codex/Agent App remains the *only* place where users type AI prompts. The standalone Code Mode host/Deno guest/Rust CLI remain outside Tauri and Svelte. The Rust app only opens, manually edits, displays, reviews, recovers and exports files. External agents publish an independently authorized, new `.bbmodel` sibling; the user selects it via the existing Open Model action, without implicit live-session synchronization. The normal GUI hides disabled experimental pairing; when opt-in functionality is compiled, pairing remains native-gated and read-only. No extra AI chat, SDK in WebView, new protocol, or second asset engine.  
**Latest source increment:** Existing Rust `inspectBatch` now shares the bounded decoded atlas between Cube alpha, coverage and repeated same-atlas `texture_styling_face` reads. Standalone inspection keeps full validation, and parity/refusal regression tests are authored but NOT_EXECUTED.  
**P0 Existing Animation Intelligence + Scoped Correction (2026-11-20):** One SHA-bound read-only `review-existing-animation` CLI/SDK route now scans exactly one selected existing numeric clip (including per-channel Bone/time/keyframe identity, loop endpoint gaps/drift and ambiguous >=180° authored Euler steps), with 16 issue and 24 track-summary result caps. A caller-opted single key correction can close a confirmed <=0.05 numeric loop seam or replace an exact, explicitly source-preconditioned linear key; Rust uses the existing `UpdateBoneTransformKeyframe` + `EditPlan::preflight` and refuses stale/opaque/nonlinear/winding-ambiguous targets. No auto-apply, no controller rewrite or new Animation writer. Regressions are SOURCE_AUTHORED_NOT_RUN; native playback, visual quality, and actual accepted-asset efficiency remain UNVERIFIED.  
**P0 source routing (2026-11-20):** The single existing Code Mode tool now gives bounded Geometry/Texturing/Animation selection rules, prevents duplicate named-target lookup guidance, and avoids recommending a second preflight for an unchanged first-party Rust planner receipt. Native Apply, SHA/revision and host approval still revalidate; test fixtures are AUTHORED_NOT_RUN.  
**P1 source Texture QA (2026-11-20):** Host source inventory and terminal scan now use up to 128 eight-Cube pages (1,024 Cubes). Models above 256 Cubes share pairs of bounded native coverage queries, but per-face reviewer approval remains at four 256-face pages. More than 1,024 source Cubes, incomplete scans, or over-budget/unreviewed faces block completion; no false native/visual PASS. Regression fixtures 1/256/257/513 and unavailable-batch refusal are `TEST_AUTHORED_NOT_RUN`.  
**P1 Source-model 3D trajectory (2026-11-20):** The existing SHA-bound semantic Animation plan now optionally computes at most four Bone-local probe trajectories through the saved source hierarchy, ZYX bind rotations and supported linear Bone keys, returning at most eight ordered samples per probe with model-space displacement/path/speed. Planted probes require a matching declared contact window but cannot attest floor contact or native animation; unsupported/ambiguous transforms refuse rather than fabricating measurements. Fixed the read-only Rust viewport's missing initial unanimated Bone bind rotation. Rust/Code Mode fixtures authored, NOT_EXECUTED; no IK solver, generated collision state, background renderer or second asset authority.
**P0 Semantic Animation / P1 Selective Secondary (2026-11-20):** One source-SHA-bound, read-only Rust `plan-semantic-animation` route compiles explicitly authored Bone key poses into the existing `EditPlan` with native preflight and deterministic keyframe IDs. Optional explicit per-key Step/Catmull-Rom interpolation reuses existing native edit operations; Catmull-Rom is blocked on scale, declared contact Bone tracks and unresolved Euler arcs. Optional one-level, source-linear `followers` now generate delayed/gain-scaled rotation or position keys from an actual primary track, never replacing authored channels, faking contacts, chaining generated motion or dropping loop/settle boundaries. Source-only segment-speed/Euler/loop evidence and at most eight event-prioritized temporal review times include follower intervals as budget permits. Optional planted/grip windows are declared hypotheses (`REQUIRES_NATIVE_WORLD_SPACE_OBSERVATION`), never foot locking or visual PASS. No secondary engine, auto-rigging, persistent recipes, extra writer or change to Approval/Undo. Rust and mocked Code Mode regressions remain `TEST_AUTHORED_NOT_RUN`; native quality/cost remain UNVERIFIED.  
**P1 Geometry Impact (2026-11-20):** Repeated Cube impact queries inside one SHA-pinned Rust `inspectBatch` now share a temporary atlas-user index; single-target source behavior is unchanged. Regression fixtures compare original/new reports, ordering, >12 related Cubes, unresolved source links and unknown identity; all `TEST_AUTHORED_NOT_RUN`. No new persistent constraint/model engine.  
**Next source decision:** STOP domain-feature expansion and the current source-level external-agent/UI simplification at SOURCE_COMMITTED. Native/visual acceptance and performance remain held; no live writer, new AI GUI, second authoring engine, global auto-fixer or cloud test substitute.

## Locked product decisions

- **Quality before UI:** Geometry/rig/pivots/UV → Texturing/atlas/material → Animation → editable `.bbmodel` and appropriate resource exports. UI/UX enhancement is not a reason to delay asset correctness. The Rust editor need not visually duplicate Blockbench.
- **One Rust authority:** `AuthoringDocument` / `EditorSession`, `EditPlan`, validation, revision, Undo/Redo, file publishers and format adapters. Tauri/Svelte/Three.js are GUI and derived preview consumers. The saved-file CLI and GUI share Rust semantics, **not** a live in-memory session.
- **AI route:** one model-facing Code Mode tool → denied-permission Deno guest → trusted Node host/typed SDK → first-party Rust CLI → same Rust engine. The SDK is not a sandbox, and source-authored host controls do not prove OS isolation.
- **Do not add:** a second asset engine, SDK-side model mirror, persistent scene cache, agent router, new Gateway, local HTTP server, background worker, unproven visual scorer or another file publisher. The optional Windows live bridge remains explicitly paired, read-only and off by default; a live writer is **design only**.
- **Preserve:** all 12 domain Skills, existing assets and `Local` behavior, user/host mutation approval, source SHA and exact target checks, no-overwrite output, correction scope, protected colors/alpha/UV and meaningful Undo, and refusal of uncertain or unsupported data.

## Minimal asset workflow (intended use, not executed proof)

```text
Approved reference + precise output/scale/style target
        ↓
Bind one saved .bbmodel SHA + exact Cube/Bone/Texture/Animation identities
        ↓
Use one focused inspectBatch where several related source reads are needed
        ↓
Choose the existing deterministic domain plan; preflight material edits
        ↓
One host-authorized, related EditPlan → one Rust transaction/new sibling
        ↓
Read changed identities AND known affected consumers, not the whole model by habit
        ↓
Review stage-specific visual evidence → correct only actual defects
        ↓
Editable .bbmodel + required output artifacts → real Blockbench/artist acceptance
```

- **Small read:** use one source-bound inspector directly when a batch would add no value. `inspectBatch` is already supported; do not build another reader or cache.
- **Small edit:** group related operations only where Rust atomicity and one meaningful approval are preserved. For complex/multi-domain changes use existing read-only `preflight`; no redundant preflight for an exact simple rename where existing policy permits omission. Actual Apply always rechecks.
- **Review by impact:** Geometry: silhouette, scale, transforms, hierarchy and intended gaps. Texturing: original RGBA8, all relevant Cube faces, UV aliasing/seams, protected details and reference material style. Animation: real target Bones, keyframe/curve preservation, pivot motion and loop/end-state correctness.
- **Escalate evidence deliberately:** six-direction rendered views and close-ups remain essential for broad reviewed material/whole-model acceptance, not an extra six-image loop on every trivial metadata change. Unknown impact expands review rather than weakening it.
- **Failure:** stale SHA, ambiguous identity/UV, changed approved reference, unsupported format or uncertain write outcome => refuse, inspect current authoritative state, never blindly replay. Repeated failed causal correction => diagnose/block; do not broaden features to conceal it.

## Source truth and first owners

| Need | Canonical owner |
| --- | --- |
| Rust transactions, document and format | [Rust core](../../apps/desktop/src-tauri/src/authoring/mod.rs), [format adapter](../../apps/desktop/src-tauri/src/authoring/bbmodel.rs), [storage](../../apps/desktop/src-tauri/src/authoring/storage.rs) |
| Geometry, Texture/Paint, Animation | [Rust source map](../04-system/implementation-map.md), [Rust architecture](../04-system/rust-native-editor-plan.md) |
| Code Mode host, approvals, SDK and read batching | [Code Mode](../../apps/desktop/code-mode/README.md), [host integration](../../apps/desktop/code-mode/HOST_INTEGRATION.md), [migration](../04-system/code-mode-migration.md) |
| Proof/holds and later native acceptance | [Current validation](current-validation.md), [local runbook](local-acceptance-runbook.md), [native acceptance](native-acceptance.md) |
| Asset craft and active specialist | [Authoring standards](../03-authoring/README.md), [Skills](../../.agents/skills/) |

## Efficiency acceptance

Optimize **cost and correction rounds per accepted asset**, not file count or model-call count alone. Compare a matched task/reference/source at the same acceptance level and capture: Rust adapter calls, bytes/results sent to the model, wall-time distribution, failed/refused calls, human correction rounds, final editable model and independently reviewed visual quality. Host counters are observational proxies; they are **not billed tokens or demonstrated savings** without actual host measurements. Never reduce verification, texture detail or necessary safety budgets to improve a proxy.

**Stop rule:** Make the smallest complete change at the first incorrect owner, check source-level caller/consumer/preservation evidence, record the available proof, then stop at the current hold. No repeated audits, speculative helpers, minor-version bumps, new UI screens or release.

## Gateway / compatibility invariants

The retained `Local` Gateway has four public tools (`status`, `search_capabilities`, `describe_capability`, `invoke_capability`) and a different Blockbench-hosted authority. Its Control/stage/legacy compatibility is **not** the active Rust Code Mode authoring engine. Do not delete retained `mcp/`, Skill, distribution or workspace files as a shortcut.

## Execution and proof ceiling

The profile at [`.agent-standard/profile.json`](../../.agent-standard/profile.json) and [project policy](../../.agent-standard/project-policy.md) control current permissions and held tests. `SOURCE_REVIEWED`, `SOURCE_COMMITTED` or `TEST_AUTHORED_NOT_RUN` never means Rust compilation, native Blockbench, visual acceptance, runtime performance, safe Deno containment or release passed.

## Historical continuity

Older daily source checkpoints, superseded `NEXT` entries and previous `Local`-only statements are retained in [the immutable pre-compaction Next Action history](https://github.com/OpenITStudios/M-LazyDesigner/blob/fa1383524b0c0fb36da11418b2db1f7a5b5f65a8/docs/05-operations/next-action.md). Git history owns those records; they are not current authorization. The current source and selected branch profile take precedence.

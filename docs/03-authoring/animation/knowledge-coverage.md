# Animation Knowledge — K0–K3 Source Coverage

**Research snapshot:** `ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d`, 2026-10-30. **Current state:** 145 sources indexed, 30 research decision families mapped, 4 paired K2 decision cases documented, one compiler guard and regression authored. **Bun/typecheck/CI/native/visual/Golden: NOT EXECUTED.** This file is a source adoption map, not a new animation policy, runtime registry, score or approval owner.

## K0 — Existing family-level capabilities

Legend: **POLICY** = semantic guidance exists; **SOURCE** = canonical implementation located (not tested here); **PARTIAL** = executable/diagnostic subset does not prove the full user outcome; **LIVE_PENDING** = native or visual proof missing, not evidence of a broken feature; **UNMEASURED** = no accepted-cost baseline. Owner paths are relative to `mcp/lib/animation/` unless another path is written.

| ID | Decision family | Nearest owner | Audit state | Case |
|---|---|---|---|---|
| F01 | Asset vs gameplay | `standard.md` | POLICY | A01 |
| F02 | Trigger/clip separation | `standard.md; controllerComposition.ts` | SOURCE | A10 |
| F03 | Pose fidelity | `fidelity-correction-evidence.md` | POLICY; LIVE_PENDING | A03 |
| F04 | Rig joint/pivot | `rig/semanticRig.ts` | PARTIAL; LIVE_PENDING | A06 |
| F05 | World hierarchy | `contactMarkerBinding.ts` | PARTIAL; LIVE_PENDING | A08 |
| F06 | Named contact/attachments | `contactEvidence.ts; contactMarkerBinding.ts` | PARTIAL; caller supplied | A08 |
| F07 | Travel vs time drive | `molangSemantics.ts` | SOURCE | A09 |
| F08 | Phase/amplitude/frequency | `phaseRecipe.ts` | SOURCE | A02 |
| F09 | Gait stride | `rootMotionAnalysis.ts` | PARTIAL; LIVE_PENDING | A01 |
| F10 | Foot locking | `contactEvidence.ts` | PARTIAL; LIVE_PENDING | A01 |
| F11 | IK reachability/bake | `rig/fabrik.ts; ikBakeReadiness.ts` | PARTIAL; LIVE_PENDING | A13 |
| F12 | Mechanical joint | `rig/mechanicalTemplates.ts` | SOURCE; LIVE_PENDING | A06 |
| F13 | Anticipation/impact | `standard.md; craftEvidence.ts` | POLICY; LIVE_PENDING | A03 |
| F14 | Weight transfer/recovery | `fidelity-correction-evidence.md` | POLICY; LIVE_PENDING | A04 |
| F15 | Follow-through | `secondaryMotion.ts; springMotion.ts` | SOURCE; LIVE_PENDING | A05 |
| F16 | Organic follower chain | `secondaryMotion.ts` | SOURCE; LIVE_PENDING | A05 |
| F17 | Rotation wrap | `quality.ts` | PARTIAL; LIVE_PENDING | A12 |
| F18 | Mirror L/R | `mirror.ts` | SOURCE; LIVE_PENDING | A12 |
| F19 | Interpolation compatibility | `toolCompiler.ts` | SOURCE; LIVE_PENDING | A15 |
| F20 | Velocity/easing | `easing.ts; motionDynamics.ts` | PARTIAL; LIVE_PENDING | A11 |
| F21 | Loop seam | `quality.ts; motionDynamics.ts` | PARTIAL; LIVE_PENDING | A11 |
| F22 | Controller transition | `server/tools/animation/controller.ts` | SOURCE; LIVE_PENDING | A10 |
| F23 | Controller layers | `controllerComposition.ts` | SOURCE; LIVE_PENDING | A10 |
| F24 | Impact VFX/SFX | `server/tools/animation/effects.ts` | SOURCE; LIVE_PENDING | A14 |
| F25 | Perspective held item | `standard.md` | POLICY; LIVE_PENDING | A08 |
| F26 | UUID/clip identity | `keyframeMatching.ts; native tools` | SOURCE; LIVE_PENDING | A13 |
| F27 | Key simplification | `quality.ts` | PARTIAL; LIVE_PENDING | A16 |
| F28 | Save/reopen/export | `scripts/verify/verify-animation-live.ts` | LIVE_PENDING | A15 |
| F29 | Preview restoration | `nativeRestorationContract.ts` | PARTIAL; LIVE_PENDING | A13 |
| F30 | Cost to accepted motion | `specialist; QUALITY_BENCHMARK.md` | POLICY; UNMEASURED | A01/A15 |

No row is a mandate to add code. The protected native sampling/restoration gap cannot be closed by inventing contact data. All Blender/Unreal/Godot/Houdini/Pixar/motion-ML knowledge in [research-sources.md](research-sources.md) is **advisory** until mapped to a specific source/target-version decision.

## K2 — Paired positive/rejection decisions (authored expectations, NOT EXECUTED)

| Case | Positive decision | Reject / require proof |
|---|---|---|
| **A01 biped walk and foot stance** | Select travel-linked movement where phase must stop with travel; evaluate explicit stance window, world-space planted marker and support plane; prioritize contact over keyframe count | Root/target motion disguised as fixed planted foot, missing sample coverage, foot-floor penetration, invented native capture; all remain REVIEW or UNVERIFIED |
| **A08 fishing grip on a moving rod** | Match exact semantic UUIDs; moving `pair` hand/tool markers may translate together without a planted-foot fault | Inaccurate hand–tool distance or ambiguous Locator/Group identities. Do not classify moving pair contact as world-floor sliding |
| **A12 mirrored ±180° action** | Explicit mirror Euler sign convention plus target-version/native rotation-path evidence; protect impacts | Auto-guessed rotation signs; straight-line numeric simplification across Euler wrap; "shortest path" asserted from source only |
| **A15/A16 scalar scale and round-trip** | Reject nonfinite scalar scale before `create_animation`; preserve finite scalar 0, fractional, negative values; compare saved/reopened/exported animation after native execution | `NaN` or ±`Infinity` passed to native tools; keyframe reductions that remove events; treating a typed source fixture as Codec/runtime/visual acceptance |

The four paired decisions above are selected from the 16 bounded candidate cases below. These are **review/acceptance scenarios**, not new test suites or measured benchmarks.

### A12 — Mirrored Euler Action, Source-Grounded Decision Case

- **Domain / canonical owner:** `ANIMATION`; [Animation Standard](standard.md) owns motion intent, clip timing, interpolation and verification. This A12 case is conditional clarification, not a second animation policy, motion tool or Golden Task.
- **Decision:** determine whether copying a source Bone's motion to a known opposite Bone across a specified plane preserves the intended 3D pose, contact/event timing and rotational trajectory, especially near `+180°`/`-180°`. Equivalent endpoint angles alone do **not** prove equivalent interpolation.
- **Apply:** paired source/target Bone identities and parent/pivot frames are confirmed, the mirror axis and Euler sign convention are explicitly established for the current project/target version, and the source motion/impact times are preserved. A source-only suggestion still needs native visual review.
- **Reject/defer:** do not infer `rotation_signs` from `_L`/`_R` names, Geometry UV `mirror`, a presumed right-hand convention or numeric endpoint equivalence; do not silently overwrite an existing target track or linearly remove keys across a possible angular wrap.
- **Source facts (inspected):** official [Bedrock Animations Overview](https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationsoverview?view=minecraft-bedrock-stable) describes hierarchical bone animation and degree-based X/Y/Z channels, **not automatic mirror parity**. The pinned upstream [Blockbench mirror_animating.ts](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/animations/mirror_animating.ts) resolves an opposite animator and calls `keyframe.flip(0)`; this does not establish equivalence to LazyDesigner's axis-sign multiplier or deployed native playback. Internal `mcp/lib/animation/mirror.ts` requires caller-supplied `rotation_signs` for rotational channels and rejects an already-authored target track.
- **Positive case (hypothetical):** a reference confirms matched left/right arm pivots, ancestry and symmetric poses, and the requested clip includes a turn approaching an Euler wrap. The reviewer explicitly supplies an applicable mirror axis/sign mapping, preserves source event/key timing, compares both sides at rest, transition, impact and return, then checks native playback/round-trip before accepting the result.
- **Counterexample (hypothetical):** multiply Euler X by `-1` merely because the part is named `arm_left`; numerically mirrored endpoints near `+179°`/`-179°` may take an unintended interpolation path or break contact.
- **Ambiguous case (hypothetical):** the target Bone already has authored keys, its parent rest transform differs, the axis/sign convention is not confirmed, key interpolation is Bezier/Molang/pre-post, or only static end poses are supplied. Leave the mirrored motion `UNVERIFIED` and preserve existing tracks; do not guess or delete.
- **Existing consumers / limits:** `mcp/lib/animation/mirror.ts::mirrorMotionBone` is a pure compiled-motion transform, **not** a native rig/clip symmetry verifier; it flips one position axis and multiplies Euler components by explicit signs. `mcp/lib/animation/quality.ts::planLinearKeyframeReduction` avoids unsafe wide rotation deltas but does **not** prove actual shortest-path playback. Existing `mcp/tests/motion-mirror.test.ts` covers an ordinary numeric sign example (`20°`), **not** a proved `±180°` native round-trip.
- **Required evidence:** approved reference or explicit motion specification; source/target Bone UUID/name, parent hierarchy, pivots and rest transforms; mirror plane and coordinate convention; clip/keyframe/interpolation identities and ordered event/contact times; target Bedrock/Blockbench version and current native motion revision.
- **Verification owner / proof:** preserve existing Animation diagnostics and native timeline owner; compare source-vs-target relevant poses and transitions, protected impacts, repeated loop when applicable, saved/reopened/exported clip identity, and actual playback. Numeric source fixtures, inferred sign conventions and a passing compiler are insufficient for motion/visual PASS.
- **Provenance, rights and maturity:** `ANIM-001` official rolling documentation and `ANIM-028` Blockbench pinned source (inspection only; do not copy GPL code). Internal `motion-mirror.test.ts` is authored, but Bun, installed Blockbench, playback/export and human acceptance were **NOT EXECUTED** in this audit. **CANDIDATE / UNVERIFIED** for `±180°` artistic fidelity; no Production promotion.

### Existing Golden/quality acceptance candidates — not executed

| ID | Candidate animation | Failure the review must reject |
|---|---|---|
| A01 | Biped walk | Foot sliding, planted stance gaps or ground penetration |
| A02 | Quadruped walk/trot | Wrong diagonal leg phase or unstable torso |
| A03 | Attack anticipation and impact | Contact/event before the authored impact pose |
| A04 | Heavy hammer slam | Missing weight transfer, landing or follow-through |
| A05 | Flying creature/Allay-like loop | Wing lag, counter-motion or loop phase mismatch |
| A06 | Mechanical lever/piston | Wrong pivot/axis, travel direction or unintended overshoot |
| A07 | Rolling entity transformation | Broken silhouette, collision or attachments |
| A08 | Fishing / moving held object | Hand-to-item grip separation |
| A09 | Travel-driven Molang gait | Walk animation advancing while motion is stopped |
| A10 | Idle → walk → idle controller | Wrong entry/exit, abrupt blend or reset |
| A11 | Cyclic loop seam | Position/velocity discontinuity after repeated playback |
| A12 | Euler wrap and left/right mirror | Unexpected 360° flip or incorrect handedness |
| A13 | Native IK bake | Edited unrelated bones or corrupted Undo/Redo/restoration |
| A14 | Impact sound/particle | Incorrect event timing or missing effect after export |
| A15 | Save/reopen and Bedrock output | Lost clip, changed interpolation or mismatched semantics |
| A16 | Numeric key reduction | Critical contact/event removed or changed motion |

Implement a case only through its existing source/test/native owner when a concrete accepted reference and falsifying hypothesis are available. A 16-row inventory does not certify 16 test executions.

## K3 — Adoption boundary

- **Policy:** `standard.md` retains canonical authority. Its Research-to-decision section chooses one unresolved F-ID and the smallest relevant evidence; normal Animation authoring never preloads 145 links.
- **Executable correction:** `mcp/lib/animation/motionRecipe.ts` rejects scalar `NaN`/±`Infinity`, closing a deterministic data-integrity gap before native clip creation. Existing `mcp/tests/motion-recipe.test.ts` owns both negative and finite-value regression. Authored, **NOT EXECUTED**.
- **Already source-present:** contact analysis, motion dynamics, IK readiness, linear key reduction, controller blending and recipe compilation must be reused, not reimplemented in a new engine.
- **Proof boundary:** caller-supplied world contact samples, IK eligibility, curve plans, technical receipts and source tests are **not** physical foot-locking, native playback, save/reopen proof or accepted animation fidelity.

## K4 — Diagnostic integrity (SOURCE AUTHORED; NOT EXECUTED)

The existing `mcp/lib/animation/motionDynamics.ts` silently kept the last same-time key, and `mcp/server/runtime/extensions/animation/nativeIntelligence.ts` previously extracted `getArray(0)` even for multiple native pre/post data points. This could manufacture numeric movement, velocity and loop continuity from ambiguous motion. This is **not** a claim that actual Blockbench playback is defective.

The corrected motion-dynamics owner marks duplicate-time tracks `unavailable: duplicate_keyframe_time` and native 0/2+ data-point tracks `unavailable: non_single_native_data_point`. Valid single-point tracks still produce evidence; mixed clips retain the clean subset plus bounded omissions. Existing `mcp/tests/animation-native-intelligence.test.ts` owns this regression.

**K5 source follow-up:** `rootMotionAnalysis.ts` also silently bridged expression/invalid middle frames and collapsed duplicate-time root keys. `qualityIntelligence.ts` extracted the first native data point even for pre/post keys. Both owners now refuse those unsupported trajectories and preserve bounded `unevaluated_root_track_count` evidence alongside clean roots. Existing `mcp/tests/quality-intelligence.test.ts` owns the new negative and preservation regressions. All diagnostics remain authored-key observations—not interpolated playback, foot contact, visual fidelity or native PASS.

**K5 numeric integrity follow-up:** RootMotion now accepts finite numeric components and strict decimal numeric strings, while refusing coerced `null`, booleans, blank/hex/overflow values, malformed vectors and nonnumeric timestamps. The existing `quality-intelligence.test.ts` regression covers positive and rejection paths; no new tool or test suite.

No authored keys, assets, public tools, Golden tasks or automatic IK are changed. **Bun, typecheck, native and CI verification NOT EXECUTED.**

## K5 — Animation evidence within the single full-asset Golden (NOT EXECUTED)

Reuse [the canonical Golden](../../../mcp/docs/GOLDEN_TASKS.md), [quality benchmark](../../../mcp/docs/QUALITY_BENCHMARK.md), [native runbook](../../05-operations/local-acceptance-runbook.md) and `mcp/scripts/verify/verify-animation-live.ts`. The **sole** full-asset Golden is `golden-full-asset-authoring`, currently **UNMEASURED**. The A01–A16 inventory above comprises decision/rejection scenarios, **not** separate Golden assets or the retired historical eight Golden tasks. Focused Animation checks retain their existing source/native owners.

| Focused example (not standalone Golden) | Evidence actually required | Insufficient proxy |
| --- | --- | --- |
| Mechanical hinge or lever | Parent/pivot/clearance in required poses, native saved/reopened clip | Rotation number or key count |
| Fishing grip/loop | Exact hand/tool correspondence, complete relevant motion and current reference | Single pose or caller-declared contact |
| Animation-bound effect | Clip-to-effect timing and the requested export; Minecraft visibility only if explicitly required | Blockbench preview described as in-game evidence |

**Live acceptance sequence:** pin approved reference fingerprint, unchanged starting `.bbmodel`, exact Runtime/build and bone/clip UUIDs; run existing disposable `verify:animation-live` and `verify:persistence-live` in a genuinely available live environment, then capture representative playback, three loops where applicable, saved/exported result and human quality review using the existing Golden session evaluator. Gameplay visibility is a separate external integration dependency, not a normal LazyDesigner authoring deliverable. A run without Blockbench/Minecraft/human evidence stays **NOT EXECUTED / UNVERIFIED**, never PASS. No second scoring or runtime framework.

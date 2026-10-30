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

## K5 — Existing Animation Golden acceptance only (NOT EXECUTED)

Reuse [the Golden corpus](../../../mcp/docs/GOLDEN_TASKS.md), [quality benchmark](../../../mcp/docs/QUALITY_BENCHMARK.md), [native runbook](../../05-operations/local-acceptance-runbook.md) and `mcp/scripts/verify/verify-animation-live.ts`. Do not create 16 extra benchmark tasks from the A01–A16 candidate risk list. The established **eight Golden Tasks remain UNMEASURED**.

| Existing task | Minimum real-world evidence | Insufficient proxy |
|---|---|---|
| `golden-mechanical-lift` | Correct hinge/pivot/clearance in closed, transitional and open poses, entry/exit plus saved/reopened native clip | Numeric rotation or key count alone |
| `golden-humanoid-fisherman` | Three full idle loops, reel action and recovery, relative hand-to-rod grip, reference-matched weight and save/reopen | One pose or caller-declared contact values |
| `golden-particle-smoke` | Locator/texture/effect timing plus actual Minecraft witness for `in_game_visibility` | Blockbench preview or asset-only export as gameplay proof |

**Live acceptance sequence:** pin approved reference fingerprint, unchanged starting `.bbmodel`, exact Runtime/build and bone/clip UUIDs; run existing disposable `verify:animation-live` and `verify:persistence-live` in a genuinely available live environment, then capture representative playback, three loops where applicable, saved/exported result and human quality review using the existing Golden session evaluator. Gameplay visibility is a separate external integration dependency, not a normal LazyDesigner authoring deliverable. A run without Blockbench/Minecraft/human evidence stays **NOT EXECUTED / UNVERIFIED**, never PASS. No second scoring or runtime framework.

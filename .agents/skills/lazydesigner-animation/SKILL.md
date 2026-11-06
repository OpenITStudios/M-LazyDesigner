---
name: lazydesigner-animation
description: In-use LazyDesigner Asset Authoring specialist for Minecraft Bedrock motion, keyframes, clip properties, artist-facing controllers/effects and playback verification after upstream approval. Do not use for structural rig mutation, Geometry/Texturing work, MCP/plugin development, runtime debugging, reference generation, or Skill maintenance.
---

# LazyDesigner Bedrock Animation

## Activation Contract

```text
LANE: IN_USE
DOMAIN: ASSET_AUTHORING
CLASS: SPECIALIST
OWNER: ANIMATION_MOTION
```

Enter when the active Control stage owns motion, keyframes, clip state, artist-facing controller composition/effects, or playback evidence. Structural rig defects hand back to Geometry; they do not authorize mutation here. Runtime/tool defects require bounded evidence and a `DEVELOPMENT_HANDOFF`, not source debugging inside this Skill.


Use at `ACTIVE STAGE: ANIMATION` after Texturing approval + checkpoint + Animation Transition Eligibility when participating hierarchy/pivots are suitable.

User-authorized autonomy replaces approval waits with verified checkpoints; never claim user approval.

Durable Animation policy is owned by `docs/03-authoring/animation/standard.md`; this Skill is the compact execution specialist for the active Animation stage and must not become a competing policy owner.

## Control Context Projection

Start from LazyDesigner Control's stage-specific Animation projection; do not reload the complete Modelling Profile or Reference Package.

Keep only motion-relevant context: current animation request, approved checkpoint state, participating semantic IDs, parent/child articulation, pivot/axis intent, contact/clearance requirements, relevant pose/keyframe/deformation guidance and approved reference views, current clip identity/state, and animation-stage blockers.

If a decision-critical motion relationship is missing, request only that exact context through Control. Never broaden into full-profile discovery as reassurance.

**Knowledge focus (only when present):** `decision_packet.knowledge_focus` may identify `VC-MOTION` for one explicitly supported motion `source_fact_id`. If the artistic motion choice is unresolved, consult the matching *Artist-Craft Motion Decisions* row in the existing Animation Standard, then compare the approved motion/poses, attachment and contact evidence with representative native preview times before editing. A reference-package claim does not prove an observed gait, exact timing, playback or animation quality. Prefer the known direct keyframe path when motion is already specified; never preload AK research or invent a universal speed/phase. At correction review, judge pose/contact/loop fidelity and new regressions, not clip count or keyframe density.

## Boundary

Animation owns motion, not structural rig mutation. Blocker → `HANDOFF_REQUIRED`, `target_phase: geometry` + readiness → `switch_authoring_phase` → resume same task through Gateway; if motion structure is unsuitable, handoff Geometry first. Before keys, representative extreme poses preserve contact/clearance. Do not search for `bone_rigging`.

## Artist-Facing Controller Boundary
Animation Controller is artist-facing composition/preview for transition/blend continuity and effects; BP/gameplay integration is out. `resource_operations` is **not a normal asset-authoring route**.

Particle is asset-only. `particle-reference`: Direct Runtime/Inspector only; no client-entity wiring.

## Direct Routing

```text
new animation                         → create_animation
unknown animation/controller          → inspect_animation
all timeline/keyframe work            → manage_animation_timeline (operation: keyframes|graph|timeline|batch|copy_paste)
clip/native property cohort           → manage_animation_timeline (operation: properties)
existing animation effects            → manage_animation_effects
particle inspect/create/patch/save/preview → inspect_particle / manage_particle
controller state/composition/effects  → manage_animation_controller
nested controller/blend curve         → same tool (native_operations)
static pose/reference evidence        → capture_model_views(animation_preview)
continuous motion visual evidence     → independent native playback observation; automated verdict UNVERIFIED
```

`new known clip → create_animation → reuse returned UUID/state; timeline if needed`
`existing/unknown detail → inspect_animation`

Known → Gateway; unknown/stale → `search_capabilities`; schema → `describe_capability` once. Reuse fresh UUID/state; known identity must not fall back to broad hierarchy discovery or confirmation reads.

`batch` uses operation="batch" + batch_operation= for one coherent cohort, not loops per key. `properties` owns clip state; `native_operations` nested controllers/curves. Controller/effect/graph/copy-paste are conditional.

## Execution Path Preference
Use semantic/native animation capabilities directly. Do not emulate the Blockbench timeline UI when the Runtime already exposes the underlying Timeline/Animator behavior.

```text
create a coherent new clip with known numeric keys
→ create_animation once

create/edit/delete multiple related keys
→ manage_animation_timeline(operation="keyframes") with one bone/channel cohort

repeat/pattern/range correction across many keys
→ manage_animation_timeline(operation="batch")

play/pause/stop/set_time/select_range
→ manage_animation_timeline(operation="timeline")

clip properties / length / fps / loop / Molang properties
→ manage_animation_timeline(operation="properties")

sound / particle / timeline effects
→ manage_animation_effects

controller composition / transitions / nested controller operations
→ manage_animation_controller
```

Rules:
- Do **not** use `trigger_action`, `emulate_clicks`, or `fill_dialog` for normal animation playback, timeline navigation, keyframes, graph edits, controllers, or effects.
- Prefer one bounded keyframe/batch mutation over loops of one-key calls when a coherent cohort shares the same correction intent.
- Reuse the animation UUID returned by creation/mutation; do not reselect or rediscover the clip merely to confirm identity.
- Do not call `inspect_animation` after every successful deterministic mutation. Inspect only when required state is unknown/stale or when the next correction depends on a field not present in the mutation receipt.
- Keep three separate gates: authored-key technical readiness, static pose reference fidelity, and temporal visual motion. The current automated tools cannot certify continuous motion from PNGs or a successful playback command: leave temporal motion UNVERIFIED. When available, observe native playback separately; do not recreate a video encoder, binary resource, GIF, or screenshot polling.
- For a specific unresolved pose question, reuse `inspect_animation(diagnostics=true).motion_dynamics.temporal_image_capture_hints` as candidate times without automatic image capture. When one bone/time window is in question, inspect `bone` and `time_range` together so candidate frames focus on that scope rather than the whole clip; unfocused/global checks remain available. The planner favors separate authored motion intervals before redundant frames in the same interval. It does not infer actual intermediate poses. These hints do not attest interpolated motion or PASS; honor the eight-image budget.
- Do not repeatedly `set_time` or take screenshots at uniform intervals. Diagnose authored keys, pivots, contact and loop constraints through native data first; use playback for motion continuity. Request `capture_model_views(animation_preview)` only for unresolved visual pose questions at meaningful events, never for every keyframe or fixed time step. The multi-time tool is optional, not the default verifier.
- Timeline selection/view expansion is editor state, not authored motion. Change it only when it materially supports evidence or a native operation that depends on selection.
- Native Timeline/Animator API calls are the intended execution path; the fact that Blockbench UI updates afterward does not make them UI automation.

## Rig / Clip / Controller Budget

Keep rig, clip, and controller as separate budgets:
`rig = transform/attachment/deformation capability | clip = motion/pose inventory | controller = state/transition/blend composition`.

Reuse existing semantic owners first. More clips/controllers do not justify hierarchy growth. If the requested motion exposes a missing pivot, parent, attachment, clearance, or deformation capability, hand off to Geometry instead of compensating with denser keys/controller complexity.

Locators are not direct animation targets in the current authoring path; a moving Locator inherits motion from the correct parent Group/Bone. Wrong parent ownership is a Geometry blocker.

**Operational art-craft:** For a source-supported motion decision, consult the matching Artist-Craft Motion Decisions row in docs/03-authoring/animation/standard.md. Distinguish grounded/flying, impact/recovery, held equipment, alternate hand/face state and flexible parts based on current approved evidence. No Generic/Java presets or lookup before ordinary known keys.

## Motion Design Contract

**Conditional math authority:** When phase/stride, Euler winding, interpolation/derivatives, sample-rate, IK/contact, spring response, or Animation-to-Particle event timing actually needs derivation, read `docs/03-authoring/animation/math-motion-reference.md` (included in the managed package) and use its smallest relevant decision section. Preserve its negative gates and proof limits; it is not a second solver or a request to run native tests. **NO_DEEP_REFERENCE** for a pre-agreed numeric key with known identity and timing; do not preload the math guide, research catalog, or sibling Skills. This implements the existing Animation Standard rather than redefining it.

Before keys, define only applicable motion causes:

```text
activation: DIRECT | CONTROLLER_STATE | EXTERNAL_CALLER | PREVIEW_ONLY | UNRESOLVED
archetype + intent + duration/snapping
primary driver + counter-motion + followers
phase + contact/attachment invariants
authored-key vs Molang ownership
causal event for sound/particle
loop seam / neutral / controller handoff
```

Do not invent gameplay queries/events for unresolved activation. Archetypes are **not presets**. No universal FPS, duration, amplitude, phase, keyframe count, or Bezier target; do not use an animation quality score.

Use authored poses for identity-critical action/contact/silhouette. Molang owns continuous/cyclic/reactive motion only when math is the real cause: `q.anim_time` for time-driven cycles, `q.modified_distance_moved` for travel phase, and `driver → delayed followers` for causal chains.

For action/weight when applicable: `anticipation → action/impact → follow-through → recovery`. Before follower keys, reconcile latest user correction's event order, primary poses and attachment/contact; test a small cohort. Dense keys do not prove motion. When current track keys are already known and too dense, reuse `inspect_animation(diagnostics=true).animation_quality.keyframe_efficiency` as a **candidate-only** linear numeric review; protect key timing with semantic contact/events first. Use existing `manage_animation_timeline(operation="keyframes", action="delete")` only for verified redundant times and recapture affected playback/attachment evidence. No wholesale decimation for Bezier, Molang, pre/post, step or unknown interpolation.

## Fidelity / Correction / Evidence Deep Reference

**REQUIRED_ON_TRIGGER:** load the current content of
`references/fidelity-correction-evidence.md` before:

- keyframe motion is being judged against an approved visual/reference target;
- a correction loop is active;
- evidence reuse, stale views, or convergence decisions are needed.

**NO_DEEP_REFERENCE:** insert a pre-agreed numeric keyframe into the
verified bone/clip through the normal timeline route without loading
fidelity theory as reassurance. If contact, timing, weight, controller
transition, correction or evidence freshness becomes a material question,
use the relevant module before expanding follower keys or effects.
Missing required-on-trigger content never licenses fabricated motion PASS.

Hot-path invariants:
- tool success never proves motion fidelity;
- correction verdict is `IMPROVED | UNCHANGED | REGRESSED`; only improvement without supported regression is progress;
- correct the highest-impact motion difference first and reject regressions;
- reuse fresh evidence/context rather than screenshot-per-keyframe or inspect-per-mutation loops;
- repeated correction in the same causal direction without new evidence must stop and become blocked.

## Stage Projection Exit

At a review/handoff boundary, return only animation-stage state to Control:

```text
changed animation clip / controller / effect IDs
participating semantic part IDs
articulation relationships used
current playback/evidence freshness
upstream Geometry blocker if discovered
animation-stage blocking unknowns
READY_FOR_USER_REVIEW | BLOCKED | HANDOFF_REQUIRED
```

Do not persist or return the complete Modelling Profile as animation state.

## Completion

Internal `PASS` = `READY_FOR_USER_REVIEW`. User approval → checkpoint → Finalization.
Endpoint counts are not playback proof; Molang must serve motion, never a math-presence quota.

Protected gap: bone-binding expressions beyond `relative_to.rotation=entity`. Source/CI does not prove live Blockbench/Minecraft playback.
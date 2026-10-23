# LazyDesigner — Animation Standard

**Status:** Active Policy  
**Version:** 1.4  
**Updated:** 2026-09-18

## Purpose

Define professional Minecraft Bedrock Entity animation policy after participating hierarchy and pivots are suitable.

This policy governs **reasoning and authored state**, not proof of live playback. Tool success, static tests, controller structure, or valid Molang do not prove final motion quality in Minecraft.

## Core Principle

**Motion intent, causality, phase, and weight come before keyframe density or curve complexity.**

Use the smallest representation that preserves the intended result:

```text
explicit keyframes
→ deliberate pose/action/timing

Molang procedural expression
→ continuous, cyclic, reactive, or parameterized motion

AnimationController
→ state selection, conditions, composition, and blend ownership
```

Hybrid authoring is expected when responsibilities genuinely differ. Professional samples are learning evidence only; archetypes are categories, not presets. Do not impose one global FPS, duration, amplitude, phase, keyframe count, interpolation, or controller topology.

## Rig / Clip / Controller Budget

Treat rig capability, clip inventory, and controller composition as separate authoring budgets.

```text
RIG
→ form + transform / attachment / deformation capability

CLIP
→ authored motion / pose inventory

CONTROLLER
→ state, transition, blend, and composition
```

A new clip or controller state should reuse existing semantic owners first. Add or change hierarchy only when the requested motion exposes a genuine missing pivot, articulation, attachment, clearance, or deformation capability.

Presentation-context growth such as first-person vs third-person or held vs worn may change transforms, clip selection, or a local geometry branch without requiring an unrelated base rig.

Controller/state complexity must not be solved by increasing rig density unless the hierarchy itself is the proven blocker.

Attachment/reference Locators move through their animated parent Group/Bone. Current animation authoring targets Group/Bone animators, not Locator elements directly; if a Locator must follow motion, fix its parent ownership in Geometry rather than inventing a separate Locator animation path.

## Motion Design Contract

Before production animation, define only applicable facts:

```text
motion archetype / intent
duration + snapping intent
primary driver bone(s)
counter-motion / stabilizers
secondary followers / chains
phase relationships
contact / attachment invariants
explicit-key vs Molang ownership
external query/variable caller semantics
causal sound / particle event
loop seam or neutral / controller handoff
```

Reasoning archetypes may include `PROCEDURAL_LAYER`, `LOOP_ORGANIC`, `LOCOMOTION`, `ACTION`, `MECHANICAL`, `HOLD_POSE`, `IDLE_VARIANT`, `FIRST_PERSON_ACTION`, and `THIRD_PERSON_ACTION`. These are not presets.

## Activation Intent Gate

Before production authoring, identify how the motion is intended to become active:

```text
ALWAYS_ON / DIRECT
CONTROLLER_STATE
EXTERNAL_CALLER
PREVIEW_ONLY
UNRESOLVED
```

Animations own raw motion data. Animation controllers own state/transition composition; external gameplay/entity logic may own caller conditions. Do not hide an unresolved trigger by inventing a query/event inside the clip.

Asset-only authoring may still create a requested clip when its external caller is intentionally out of scope, but record that activation as `EXTERNAL_CALLER` or `UNRESOLVED`. `PREVIEW_ONLY` is valid for review/reference clips not yet intended for runtime activation.

When controller composition is requested, use the minimum state/transition logic required by known artist-facing preview/composition intent. Unknown gameplay conditions remain external/unverified.

## Native Bedrock Clip Semantics

Treat non-transform clip state as first-class authored semantics:

```text
length / snapping
loop: once | loop | hold
anim_time_update
blend_weight
start_delay
loop_delay
override_previous_animation
relative_to.rotation = entity
```

`start_delay` delays the first start; `loop_delay` delays later loops. `override_previous_animation` resets affected bones to default pose before the clip contributes. `relative_to.rotation = entity` changes rotation space from parent-relative to entity-relative.

Batch related properties through one `manage_animation_timeline(operation="properties")` call instead of repeated mutations.

## Timing / Snapping

Choose snapping because it fits the motion, then keep authored numeric key times coherent with that grid.

Before a dense transform track, prefer sparse semantic poses plus interpolation. Linear candidate analysis now treats locally straight spans independently and restores any removal whose final retained endpoints would exceed the numeric error bound. Sharp changes of direction and critical timing stay intact; the automatic `create_animation` path retains strict numeric equivalence rather than accepting approximate visual error. `inspect_animation(diagnostics=true).animation_quality.keyframe_efficiency` reports read-only strict-linear numeric reduction candidates, requiring native-known interpolation and a single numeric data point. It does not delete keys or validate contact, end-effectors or playback. Only use the existing targeted keyframe delete operation after protecting event/contact/impact/loop times and confirming equivalent reference-aligned motion. Do not simplify Catmull-Rom, Bezier, step, Molang, pre/post, or rotation wraps from a numeric shortcut. A subtle idle, rapid attack, mechanical cycle, and first-person action may legitimately use different timing density.

For `create_animation` with numeric linear transforms, strict-equivalence compaction runs before the Bedrock codec import: collinear interior channel keys may be omitted only after whole-track numeric reconstruction confirms equality; start/end and initial sound/particle timing survive, and scale scalar/vector shapes are not mixed. This actually reduces authored data for exactly redundant samples, rather than merely returning diagnostic suggestions. Non-collinear authored impact/contact phases are not automatically smoothed; the compaction receipt records only eliminated transform channel keys, never a visual fidelity claim.

Interpolation is a means, not a quality target. Prefer the simplest interpolation that preserves intent. Do not add Bezier complexity merely to appear sophisticated. Bedrock-native delivery uses linear/Catmull-Rom or pre/post discontinuity; editor-only Bezier curves must be baked when direct Bedrock transform output requires it.

## Procedural Math / Molang

Molang may own transform values, animation timing, blend behavior, controller conditions, and effect scripts when the runtime cause is mathematical or reactive. LazyDesigner preserves authored text; it must not evaluate gameplay truth or invent unknown query values. Explicit authored poses retain identity-critical action/contact/silhouette ownership when procedural math is not the real motion cause.

Molang trigonometric functions use degrees. `q.`, `v.`, `t.`, and `c.` are aliases for query/variable/temp/context namespaces.

The current official Bedrock math surface is accepted as authored Molang. Keep guidance compact rather than expanding every function into every prompt:

```text
abs / sign / min / max / clamp
floor / ceil / round / trunc / mod
sin / cos / asin / acos / atan / atan2
lerp / inverse_lerp / lerprotate / hermite_blend
pow / exp / ln / sqrt
random / random_integer / die_roll / die_roll_integer
math.pi
math.ease_{in|out|in_out}_{back|bounce|circ|cubic|elastic|expo|quad|quart|quint|sine}
```

Easing math is version-sensitive and must respect target Bedrock support. Unknown `math.*` names are diagnostics, not automatically rewritten or evaluated.

### Driver selection

Choose the variable that corresponds to the actual cause:

```text
q.anim_time
→ time-driven breathing, sway, vibration, or cycle

q.modified_distance_moved
→ travel-linked phase such as locomotion or wheel rotation

q.modified_move_speed
→ movement intensity / amplitude response

controller animation blend value
→ conditional or continuously weighted layer
```

A time driver is not automatically appropriate for locomotion. If phase should stop when travel stops, a travel-linked driver is the stronger semantic owner.

### Periodic and bounded response

General periodic form:

```text
value = base + amplitude * math.sin(360 * frequency * time + phase)
```

For bounded mapping:

```text
p = clamp(inverse_lerp(input_min, input_max, input), 0, 1)
value = lerp(output_min, output_max, p)
```

`lerprotate` is preferred when angular interpolation must take the shortest circular path. A damped one-shot may use `base + A * exp(-damping * time) * math.sin(360 * frequency * time + phase)` when it matches the physical intent.

### Secondary chain

For tail, cloth, rope, beard, antenna, or similar chains:

```text
driver
→ follower 1
→ follower 2
→ follower 3
```

Reason about phase progression, lag, amplitude hierarchy, attachment continuity, and whether the chain is ambient/procedural or part of an authored action. Secondary motion normally follows the primary driver; do not make every segment move identically.

## Locomotion

A gait is a designed relationship, not a mirrored transform. Reason about left/right phase, contact/support phase, stride amplitude, body compensation, secondary response, and speed-dependent change.

Copy/mirror may initialize symmetric values, but it does not establish gait timing. **Run is not merely walk played faster.** It may require different stride, amplitude, timing, body compensation, secondary response, or contact pattern.

Root-motion diagnostics are measurements, not gameplay-motion proof. Compare authored displacement, travel-linked phase, and intended entity speed before concluding a gait is synchronized.

## Idle

Prefer a low-amplitude living baseline plus occasional identity gesture when appropriate. `start_delay`/`loop_delay` or intentional controller selection can prevent mechanical repetition. Controlled variation should normally select authored clips/states rather than inject arbitrary transforms. Do not use continuous `math.random` as generic jitter.

## Action / Weight

When relevant:

```text
anticipation
→ acceleration / action
→ impact / contact
→ overshoot / follow-through
→ recovery
→ neutral or controller handoff
```

The attacking extremity is not always the only motion owner. Visible weight transfer needs appropriate body counter-motion and support/stabilization. Identity-critical attacks, smashes, interactions, and contact poses generally favor explicit authored key poses over generic procedural oscillation.

## Mechanical Motion

Mechanical quality can come from few keyframes when pivot/axis, rate/travel relationship, start/steady/stop state, and effect synchronization are correct. Do not increase keyframe density solely because organic animations use more articulation.

## Effects

Every authored sound or particle should have a named causal event when one exists: release, contact, ignition, landing, start, stop, or state entry. Place it at the causal/visible phase. Timestamp zero is correct only when animation/state start is itself the event.

Effects are part of motion design, not decoration added after timing is finished. The current capability includes existing-animation particle/sound/timeline effect mutation.

## Controller Composition

Animation clips own motion and timeline-bound effects. Controllers own state/context and layer composition.

Prefer controlled composition only when layers have distinct semantic ownership:

```text
base authored motion
+ procedural look / response layer
+ secondary procedural layer
+ conditional action layer
```

Controller states may link an Animation or another AnimationController. Nested-controller authoring must reject direct self-links and composition cycles. Reuse one `manage_animation_controller(native_operations=[...])` batch when nested links or native curve work belongs to one controller.

`blend_transition`, `blend_via_shortest_path`, and normalized `blend_transition_curve` are native state properties. **controller blend-curve mutation** is supported through `native_operations`; curve time is normalized 0..1 and requires a positive effective blend duration. Controller randomness should normally select intentional alternatives rather than randomize arbitrary bone transforms every frame.

## Runtime Resource Wiring

This retained file-backed route and the state-variable/remap operations below serve explicitly requested integration/compatibility work. Normal visual-asset authoring does not construct an RP file graph.

A valid clip/controller is not Minecraft-active until the resource definition connects it. `manage_animation_controller(resource_operations=[...])` owns bounded file-backed runtime resource edits without creating another MCP tool.

For `resource_kind="client_entity"`, the supported cohort is:

```text
description.animations shortname → animation.* / controller.animation.*
scripts.animate shortname + optional Molang condition
scripts.pre_animation variable assignments
description.sound_effects shortname → sound identifier
existing description.particle_effects mappings are preserved and validated
```

Resource mutation requires an explicit `.json` source path or inline content. A supplied source path may be updated in place; another existing output requires `overwrite=true`. Candidate JSON is validated before a verified atomic write. Unknown sibling fields are preserved.

`set_animate` requires its shortname to resolve through `description.animations` in the same final candidate. `pre_animation` authoring is variable-oriented: upsert/remove one named `variable.*` assignment rather than replacing unrelated scripts.

## Controller State Variables / Remap Curves

Bedrock controller states may define `variables` whose `input` is Molang and whose optional `remap_curve` linearly maps input to output. Use file-backed `resource_kind="animation_controller"` operations:

```text
set_state_variable(state, name, input, remap_curve?)
remove_state_variable(state, name)
```

Remap inputs must be finite and unique; LazyDesigner sorts them deterministically and bounds one authored curve to 2–32 points. This path is intentionally file-backed because the current Blockbench native `AnimationControllerState` model does not preserve `variables/remap_curve` on round-trip. Do not claim native Blockbench state ownership for these fields; the authored JSON resource is the authority until Blockbench exposes a lossless native owner.

## Perspective

First-person and third-person presentations may share action intent without sharing identical motion. When both are required, evaluate framing, visible bones, weapon/readability path, camera proximity, clipping, and recovery silhouette. Reuse only motion that remains valid for both perspectives.

## Diagnostics / Quality Evidence

`inspect_animation(..., diagnostics=true)` is the bounded deep-inspection path. Combine existing technical checks with:

```text
native clip property summary
controller nested-link / blend-curve summary
used / unknown Molang math symbols
query / variable / temp / context dependencies
version-sensitive and nondeterministic math
loaded client-entity mapping / pre_animation evidence
runtime dependency graph: roots → controller aliases → clips
unbound sound / particle shortnames
unreachable loaded animation aliases
numeric motion path / speed / acceleration / jerk
loop boundary velocity evidence
root-motion and loop-seam/cadence evidence
```

Runtime dependency diagnostics are graph evidence, not gameplay truth. Missing mappings/effect bindings are actionable errors; an unresolved variable producer is only a candidate because a controller state variable, game runtime, or other intentional producer may own it. Unreachable loaded aliases are warnings because external triggering paths can exist.

These are review candidates, not an animation quality score. Numeric motion dynamics use Blockbench units for position, degrees for rotation, and unitless scale. They cannot prove weight, contact quality, gameplay velocity, or visual appeal without visual/runtime evidence.

## Verification / Convergence

Review affected motion in this order:

```text
pose / readability
→ timing / phase
→ weight / contact
→ attachment / clipping
→ secondary motion
→ effect synchronization
→ loop seam / neutral return
```

A correction is `IMPROVED | UNCHANGED | REGRESSED`. Only `IMPROVED` without supported regression is progress. If the same causal correction direction fails twice without new evidence, stop and mark the claim `BLOCKED`.

For cyclic/idle motion, repeated full-loop playback is required; static snapshots do not prove timing or phase. Source/static proof does not upgrade live Blockbench playback or Minecraft runtime behavior.

## Current Capability Boundary

Retained strengths include numeric/Molang transform keys, rig/pivots, timeline settings, batch/copy operations, authored Animation inspection, new-animation particle/sound effects, existing-animation particle/sound/timeline effect mutation, `anim_time_update` / `blend_weight`, native `start_delay` / `loop_delay` / `override_previous_animation`, hold mode, `relative_to.rotation=entity`, bounded AnimationController state/effects, nested AnimationController composition with cycle guard, native controller blend curves, client-entity animation/sound/pre-animation runtime wiring, file-backed controller state variables/remap curves, and end-to-end loaded runtime dependency diagnostics.

Protected gap remains:
- bone-binding expressions beyond native `relative_to.rotation=entity`.

File-backed controller variables/remap curves are Bedrock resource authoring, not native Blockbench controller-state round-trip. Source/static proof does not establish installed Blockbench behavior or Minecraft playback. Do not route protected gaps through `risky_eval` or generic UI actions.

---
name: lazydesigner-particle-reference-authoring
description: In-use Reference Preparation specialist for Minecraft Bedrock/Snowstorm particle JSON, particle textures, static preflight evidence, and requested delivery packages. Do not use for MCP implementation, Blockbench mutation, Animation-stage particle integration, or unrelated visual-reference work.
---

# LazyDesigner Particle Reference Authoring

## Activation Contract

```text
LANE: IN_USE
DOMAIN: REFERENCE_PREPARATION
CLASS: SPECIALIST
OWNER: PARTICLE_REFERENCE_ARTIFACT
```

Enter for standalone Bedrock/Snowstorm particle-reference artifacts and their visual texture dependencies. Do not enter for Animation-stage integration or because a runtime particle tool is defective. Proven implementation defects require a bounded `DEVELOPMENT_HANDOFF`; authoring corrections remain here.


Standalone specialist inside the canonical Reference Preparation domain for particle/VFX tasks. It is not an MCP subsystem and does not depend on image/model reference generation.

## Route

```text
USER PARTICLE REQUEST
→ authoring-spec.md
→ classify execution once
→ select minimal physical pattern from patterns.md
→ choose lowest viable complexity tier
→ resolve one output identity
→ workflow.md
→ load minimum knowledge bundle
→ author JSON + required textures
→ relevant qa.md gates only
→ ARTIFACT READY FOR REVIEW
→ delivery.md only when package/handoff is requested
→ USER REVIEW IN TARGET ENVIRONMENT
→ optional Codex / MCP handoff
```

For knowledge/diagnosis questions, start from `knowledge-map.md` instead.

## Execution-first rule

Before deep reading, classify:

```text
DIRECT
COMPOSED
REACTIVE
AUDIT / REVISION
```

Then use `patterns.md` as the single physical starting-pattern owner and choose the lowest viable complexity tier:

```text
0 constants
1 simple particle-owned Molang
2 curves / atlas / flipbook / multi-layer
3 events / collision chains / entity/external reactivity
```

A request such as `buat particle api biru` should normally remain DIRECT and use the Flame family. Do not escalate architecture unless required behavior cannot be represented cleanly at the current tier.

## Pre-confirmation rule

Particle-only authoring does not require a ceremonial pre-generation confirmation when no BLOCKING ambiguity remains.

```text
BLOCKING ambiguity
→ ask minimum decision-changing question

no BLOCKING ambiguity
→ proceed with conservative reversible PROVISIONAL choices where allowed
→ author first pass
→ static QA
→ user review when visual/runtime review is material
```

This is specific to the particle branch. Never provisionally invent hidden geometry, required attachment names, exact viewing distance, device/FPS limits, gameplay semantics, or runtime truth.

## Output identity rule

Resolve one naming source before resources are authored:

```text
namespace
working/package slug
effect slug
root identifier
child role slugs when needed
texture basename/shared mapping
delivery intent: artifact only / standalone package / downstream handoff
```

Use lowercase snake_case by default unless an existing project convention overrides it. One normalized identity drives particle filenames, identifier suffixes, texture mapping, and any later package metadata.

Child suffixes describe physical role (`_debris`, `_plume`, `_flash`), never revision history.

## Pixel Art Texture Intake

Pixel Art supplies visual texture/frame evidence only; Particle owns emitter, lifecycle, motion, Molang, collision, events, and attachment semantics. Consume only decision-relevant texture facts (identity/dimensions/alpha/frame contract/style/provenance/blockers) and load `docs/02-reference/particle/texture-authoring.md` only when that boundary or texture compatibility is material.

Do not promote `PROVISIONAL` visual choices into runtime requirements. If a supplied asset cannot satisfy the required alpha/frame/flipbook contract, return only that bounded visual requirement to Pixel Art rather than loading its full corpus.

## Context-budget rule

Do not preload the corpus.

```text
normal authoring
= authoring-spec + patterns + workflow + 1 primary owner
+ at most 1–2 secondary owners for real cross-domain dependencies

knowledge/diagnosis
= knowledge-map + 1 primary owner
+ secondary owner only when required
```

If more than three technical owners appear necessary, split the problem into causal decisions rather than loading everything.

Do not load closure/default/version/troubleshooting/QA/delivery owners unless the current decision requires them.

## Pattern routing

`patterns.md` exclusively owns the complete keyword/physical-family map. Do not duplicate that map here.

After a pattern is selected, route only to the causal technical owner:

```text
spawn/lifetime dominated → emitter
trajectory dominated     → motion
custom ring/cone/fan      → emitter-shape-math
texture-driven visual     → texture-authoring
age progression           → molang OR curves when needed
entity/locator anchored   → entity-integration
event/contact reactive    → events / collision-advanced
```

Pattern selection reduces reads; it does not expand them.

## Minimal task bundles

```text
simple text particle
→ authoring-spec + patterns + workflow + primary owner
→ texture-authoring only if texture creation/change is required

texture-only
→ texture-authoring
→ + exactly one specialist when needed: resolution-sampling OR filtering-bleeding OR color-science

spawn/lifetime → emitter
trajectory     → motion (+ math-physics only for real derivation)
Molang ownership → molang
Molang language/function → molang-language-math
formula → molang-formula-cookbook
existing JSON audit → component-field-reference
collision → collision-advanced (+ events only when contact triggers events)
nested event → events + event-timing
entity attached → entity-integration + lifecycle-space
Snowstorm generic → snowstorm
Snowstorm release support/fix → snowstorm-compatibility-matrix
Snowstorm regression → snowstorm-version-quirks
unknown symptom → troubleshooting, then only the identified causal owner
```

## Provisional-default rule

When an unknown is not BLOCKING, prefer a conservative reversible first-pass choice rather than another question. Mark it internally as `PROVISIONAL`; never present it as a user requirement or measured runtime fact.

## Numeric pattern rule

Physical patterns do not own universal numeric presets.

Choose numbers from:
1. explicit user target;
2. visible/reference evidence;
3. previously accepted same-context effect;
4. conservative reversible provisional values.

Never promote one accepted speed/lifetime/size/spawn rate into a global default. MCP convenience presets are bootstrap values, not professional visual authority.

## Simplicity ladder

Prefer:

```text
constant
→ simple stable Molang
→ curve / atlas / flipbook
→ multiple layers
→ event/reactive architecture
```

Use the first level that satisfies the requested visual behavior.

## Core authoring rules

Keep emitter timing emitter-owned. Keep persistent living-particle identity particle-owned using stable particle random/age/lifetime values.

Use built-in emitter shapes before custom math. Keep spawn position, launch direction, speed magnitude, and post-spawn motion as separate responsibilities.

Texture is first-class production data. Do not use presentation sheets, baked checkerboards, or generated-background images as production textures.

For Snowstorm-facing authoring where launch magnitude must survive preview predictably:

```text
emitter shape direction = launch vector
particle_initial_speed = scalar speed
```

This is Snowstorm/Wintersky-targeted compatibility guidance, not a generic Bedrock prohibition.

## Appearance / Timing Gate

Before final JSON, resolve only what is material: billboard orientation follows visual role (camera-facing vs direction-aligned); static UV vs flipbook is explicit; flipbook timing has one owner (`frames_per_second` or `stretch_to_lifetime`); emitter `activation_expression` owns emission state, not living-particle age progression. Physical travel stays in motion components, never flipbook animation.

## In-game quality-to-cost discipline

An effect is not professionally finished merely because it looks good in Snowstorm/Blockbench, nor because it has a small emitter count. For a production Minecraft effect, preserve its visual role, contrast, silhouette and causal timing while inspecting the existing `game_cost` diagnostics. Start with redundant/occluded particles, excess lifetime, large overlapping translucent billboards, collision and per-particle child-event fan-out. Avoid inventing exact target device, number of simultaneous mobs/effects, measured FPS or real in-game screenshots. `preview_workload` protects **the editor only**, not game performance. A static source review never overrides quality or prevents a needed visual layer; target-game FPS and visual approval remain UNVERIFIED until observed.

## Single-pass QA rule

Near finalization, run only applicable `qa.md` gates once. After a targeted revision, rerun the causal QA gate; rerun package-integrity checks only when a package exists.

Static QA does not replace target-environment review.

## Delivery rule

A validated authored particle and a delivered package are separate states.

```text
artifact authored + relevant QA complete
→ ready for review

standalone Resource Pack / ZIP requested
→ load delivery.md and assemble exactly that package

downstream LazyDesigner/Codex/MCP handoff requested
→ load delivery.md + ../package/particle-handoff.md

no package requested
→ do not create manifest/README/ZIP/REFERENCE.json merely to complete a template
```

`delivery.md` is the sole owner for exact package naming, manifest, texture path, README, ZIP-root, production-file hygiene, and optional `REFERENCE.json` rules. Do not duplicate those details here.

## Snowstorm round-trip rule

For advanced/external JSON actually edited through Snowstorm:

```text
preserve original
→ import Snowstorm
→ edit
→ export
→ structural diff
→ target Bedrock schema review
```

Successful import is not proof of perfect field-level round trip.

## Evidence discipline

Preserve evidence class:

```text
OFFICIAL BEDROCK
SNOWSTORM / WINTERSKY
EMPIRICALLY VERIFIED
HEURISTIC
```

Never present editor behavior as generic Bedrock validity, current-stable compatibility as exact target-version proof, or static heuristics as runtime/FPS truth.

## Boundary

This Skill may produce `.particle.json`, required textures/atlases, static/preflight diagnostics, and—only when requested—clean Resource Pack or handoff packages.

It does not own MCP implementation, Blockbench runtime mutation, animation/controller integration, live Minecraft/Snowstorm truth, or device/FPS benchmarking.
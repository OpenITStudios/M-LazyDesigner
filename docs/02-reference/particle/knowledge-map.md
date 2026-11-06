# Particle Knowledge Map

Canonical knowledge map for ChatGPT-side Minecraft Bedrock / Snowstorm particle reference authoring.

## Evidence classes

```text
OFFICIAL BEDROCK
SNOWSTORM / WINTERSKY
EMPIRICALLY VERIFIED
HEURISTIC
```

Official Bedrock semantics outrank editor workarounds. Snowstorm-specific behavior must not redefine generic Bedrock validity. Heuristics must never be presented as live runtime/FPS truth.

## Canonical knowledge owners

- [fundamentals.md](fundamentals.md) — document mental model, component families, emitter-vs-particle responsibility
- [component-catalog.md](component-catalog.md) — complete component inventory
- [component-field-reference.md](component-field-reference.md) — field-by-field purpose, ownership and failure modes
- [official-schema-coverage.md](official-schema-coverage.md) — closure audit mapping official component families to canonical owners
- [official-defaults-evaluation.md](official-defaults-evaluation.md) — verified defaults, omission semantics, evaluation timing and schema-version deltas
- [lifecycle-space.md](lifecycle-space.md) — creation/update/render timing, emitter-vs-particle lifetime, local/world simulation
- [emitter.md](emitter.md) — rate, lifetime, initialization, built-in shapes and density
- [emitter-shape-math.md](emitter-shape-math.md) — custom shape/ring/cone/fan direction math
- [math-physics-reference.md](math-physics-reference.md) — vectors, projection, spatial distributions, ballistics, probability and numerical safety
- [motion.md](motion.md) — initial impulse, acceleration, drag, parametric motion and kill planes
- [collision-advanced.md](collision-advanced.md) — restitution, drag, contact events, repeated contact and high-speed caveats
- [appearance-rendering.md](appearance-rendering.md) — materials, billboard, tint, lighting and overdraw
- [billboard-direction.md](billboard-direction.md) — directional/velocity-aligned billboard semantics and edge cases
- [texture-authoring.md](texture-authoring.md) — PNG/RGBA, atlas layout, gutters, UV/flipbook and tint-compatible source art
- [texture-resolution-sampling.md](texture-resolution-sampling.md) — resolution, resampling, texel density, downscale, alpha coverage and frame stability
- [texture-filtering-bleeding.md](texture-filtering-bleeding.md) — hidden RGB, bleed, matte/halo and minification/filtering edge cases
- [texture-color-science.md](texture-color-science.md) — practical value/alpha/color design for opaque/alpha/blend/additive materials
- [molang.md](molang.md) — particle/emitter variable ownership and lifetime stability
- [particle-variable-inventory.md](particle-variable-inventory.md) — documented particle-system built-in variables
- [molang-language-math.md](molang-language-math.md) — syntax, operators, math, easing, interpolation, random and trigonometry
- [molang-formula-cookbook.md](molang-formula-cookbook.md) — reusable lifetime, random-class, oscillation, orbit/spiral, remap and safe-math formulas
- [molang-queries-context.md](molang-queries-context.md) — query/context host availability and external-state coupling
- [curves.md](curves.md) — linear/Bezier/Bezier-chain/Catmull-Rom curves and normalized progression
- [events.md](events.md) — emitter/particle/collision events, child effects, relationships and fan-out
- [event-timing.md](event-timing.md) — emitter time vs particle time, birth-relative timing and nested ordering
- [snowstorm.md](snowstorm.md) — generic Snowstorm/Wintersky editor/preview compatibility boundary
- [snowstorm-compatibility-matrix.md](snowstorm-compatibility-matrix.md) — version-by-version Snowstorm/Wintersky capabilities, fixes, source mapping and round-trip risks
- [snowstorm-version-quirks.md](snowstorm-version-quirks.md) — release-specific anomalies, regressions and minimal-reproduction rules
- [performance.md](performance.md) — population, lifetime/rate/cap, overdraw and expression/collision/event cost guidance
- [entity-integration.md](entity-integration.md) — entity mapping, locators, animation/controller triggering and attached context
- [troubleshooting.md](troubleshooting.md) — symptom-first causal diagnosis

## Workflow and delivery owners

- [authoring-spec.md](authoring-spec.md) — normalize requested effect
- [workflow.md](workflow.md) — authoring sequence
- [qa.md](qa.md) — static/preflight acceptance
- [delivery.md](delivery.md) — clean package contract
- [patterns.md](patterns.md) — reusable physical starting patterns

Knowledge and workflow stay separate. Deep technical rules belong to the nearest knowledge owner, not duplicated into workflow files.

## Lazy-read routing

```text
basic task
→ authoring-spec.md + workflow.md

is official coverage complete?
→ official-schema-coverage.md

what is the exact default / omission meaning / evaluation timing?
→ official-defaults-evaluation.md

unknown component
→ component-catalog.md

specific field purpose/failure mode
→ component-field-reference.md

spawn/lifetime/shape
→ emitter.md

custom distribution/direction/cone/ring math
→ emitter-shape-math.md

general vector/physics/distribution/ballistics
→ math-physics-reference.md

creation/update/render or local/world-space question
→ lifecycle-space.md

trajectory/physics
→ motion.md

contact/bounce/collision event
→ collision-advanced.md

material/billboard/tint
→ appearance-rendering.md

directional sprite issue
→ billboard-direction.md

PNG/atlas/UV/flipbook production
→ texture-authoring.md

resolution/resampling/downscale/frame stability
→ texture-resolution-sampling.md

bleed/halo/filtering/minification
→ texture-filtering-bleeding.md

brightness/alpha/additive/blend color design
→ texture-color-science.md

particle variable ownership
→ molang.md

which built-in particle/emitter variable exists?
→ particle-variable-inventory.md

Molang language/math
→ molang-language-math.md

need a reusable expression/formula
→ molang-formula-cookbook.md

query/context/entity-state dependency
→ molang-queries-context.md

curve issue
→ curves.md

child effect/event graph
→ events.md

event ordering/time ownership
→ event-timing.md

Snowstorm generic editor/preview compatibility
→ snowstorm.md

which Snowstorm/Wintersky release supports or fixes this behavior?
→ snowstorm-compatibility-matrix.md

release-specific Snowstorm anomaly / regression diagnosis
→ snowstorm-version-quirks.md

performance/density
→ performance.md

entity attachment
→ entity-integration.md

unclear failure
→ troubleshooting.md
```

Load multiple files only when the task genuinely crosses boundaries.

## Confidence hierarchy

```text
current explicit user requirement
→ target-version official Bedrock generated schema/reference
→ official semantic/component documentation
→ documented Snowstorm/Wintersky release/source behavior for editor-specific issues
→ reproduced Snowstorm/Wintersky project behavior
→ accepted empirical project evidence
→ conservative heuristic
```

When newer generated Bedrock schema and older hand-written documentation differ, use the target-version schema for JSON shape/defaults and retain older prose only when it remains semantically compatible.

For Snowstorm, published release notes outrank unreleased `master` package metadata when describing stable capability. Source-head evidence may explain implementation but must be labeled development state.

## Coverage state

```text
Official schema closure audit            STRONG / TRACKED
Official defaults/evaluation timing      STRONG / TRACKED
Bedrock architecture/components          STRONG
Field-level component reference          STRONG
Lifecycle/evaluation/local space         STRONG
Emitter lifecycle/shapes                 STRONG
Emitter direction/custom-shape math      STRONG
General vector/physics/distribution math STRONG
Dynamic/parametric motion                STRONG
Advanced collision                       STRONG
Appearance/material/billboards           STRONG
Directional billboard edge cases         STRONG
Texture/RGBA/atlas/UV/flipbook           STRONG
Texture resolution/resampling            STRONG PRACTICAL
Texture filtering/bleeding               STRONG
Texture color/alpha/blend reasoning      STRONG PRACTICAL
Particle Molang ownership                STRONG
Particle built-in variable inventory     STRONG
Molang language/math                     STRONG
Molang formula cookbook                  STRONG
Molang query/context reasoning           STRONG
Curves                                   STRONG
Events/child effects                     STRONG
Event timing                             STRONG
Snowstorm/Wintersky generic compatibility STRONG
Snowstorm compatibility matrix           STRONG RELEASE-MAPPED
Snowstorm version quirks                 STRONG VERSION-AWARE
Performance reasoning                    STRONG STATIC
Entity integration                       STRONG REFERENCE BOUNDARY
Troubleshooting                          STRONG CAUSAL GUIDE
Real multi-family visual cases           DEFERRED BY USER
```

Further work should close only newly discovered official fields/defaults, Snowstorm/Wintersky version-specific behavior, and later empirical visual evidence. Do not create another parallel particle framework.

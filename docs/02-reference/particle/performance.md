# Particle Performance Knowledge

Provenance labels:
- **OFFICIAL BEDROCK** — Microsoft Bedrock particle documentation.
- **SNOWSTORM / WINTERSKY** — editor/preview-specific behavior.
- **EMPIRICALLY VERIFIED** — reproduced in accepted authoring work.
- **HEURISTIC** — authoring guidance.

## Constant-work authoring preview budget (2026-11-07)

The read-only `preview_workload` in existing particle inspection uses a **single-emitter static heuristic**: instant count or `min(spawn_rate × max_lifetime, max_particles)` when numeric. No recursive pack scan, evaluator, or new renderer is introduced. Unknown MoLang/dynamic rates are `unestimated`, never a claim of safety. Child effects are excluded from numeric population estimates.

**Engineering-only viewport admission:** >256 estimated particles or >500/s steady emission pauses automatic Studio preview; nested effects also require explicit Play/Replay. >1024 estimated particles or >5000/s steady emission, and direct self-recursion, prevent native preview. `manage_particle(preview=true)` still commits a valid JSON artifact when native preview is blocked and returns `preview_load_call=BLOCKED`. Exact thresholds are protective editor defaults, **not Minecraft limits or measured device FPS**; live output/render/overdraw remains unverified. Avoid disabling authoring merely because a preview needs to be lighter.

## Performance model

Particle performance is the combined cost of:

```text
how many particles exist
+ how expensive each particle is to update
+ how expensive each visible particle is to render
+ event fan-out
+ collision / Molang / transparency complexity
```

No single field is a complete performance metric.

## Game/runtime cost versus editor-preview cost — mandatory separation

**Target goal:** reference-matched, readable and intentional VFX *at an acceptable cost in the actual Minecraft scene*. The earlier 256/1024 limits are **editor preview admission thresholds only**. Do not present them as Minecraft performance limits, automatically reduce authored particles to those values, or equate native Blockbench emitter count with game FPS.

The existing `inspectParticleDocument` now provides **`game_cost`** alongside `preview_workload`, without a new renderer or frame loop. It is a low-overhead, static source review of the selected effect. Flags cover numeric population/rate/lifetime, missing or nonnumeric steady cap, potential large additive/blended billboard coverage, collision, parametric motion, per-render expressions/curves, and nested child-event fan-out. An unestimated rate, lifetime, or MoLang field is **UNKNOWN**, not automatically efficient. `NO_STATIC_RISKS_FLAGGED` means no heuristic source condition was detected, **not** game readiness or visual approval.

**Creative/performance optimization order (quality-preserving):**

1. Identify the exact artistic job of each layer (readable impact silhouette, energetic streak, dust tail, ambient cue). Remove redundant invisible or visually duplicated work **before** weakening the focal burst.
2. Improve shape/contrast/alpha/atlas framing so **fewer** well-designed particles communicate the same effect. Prefer one intentional flash/ring sprite over a dense, overlapping luminous cloud when the approved reference supports that choice.
3. Choose the shortest lifetime and spawn cadence that still preserve continuity; set an explicit reasonable cap where possible. A cap limits active population, **not** necessarily spawn/update overhead.
4. Reduce large overlapping blended/additive sprites, unnecessary collision, expensive per-render MoLang, and uncontrolled per-particle child effects. Use emitter-time events for shared one-shot phases, not one full child emitter for every parent particle unless intentional.
5. Consider actual concurrent use: copies per mob, projectiles, players, arenas, near-camera effects and simultaneous activations. One efficient emitter multiplied dozens of times may be expensive. No exact concurrency may be invented.
6. Judge the **same** game target at matched viewing distance, scene count, settings and device class: preserve readability and event timing while measuring representative frame-time/FPS and observing worst-case overlaps. Texture/alpha quality and game parity require visual evidence; static diagnostics cannot certify them.

**Event trigger ownership:** A nested effect definition by itself does not prove child spawning per parent particle. Resolve the actual event name from emitter lifetime, particle lifetime, and collision event references. The read-only `game_cost` inspector now flags `per_particle_nested_event_risk` and `repeating_emitter_child_events` only when a child-spawning event is referenced by that owner. Unknown or unreachable event branches remain source-review issues; this does not simulate randomization or prove real event frequency.

**No automatic visual downgrading:** `game_cost` is advisory. It must not mutate particle JSON, replace authored material, strip a curve, remove an effect layer, change event timing, force a global spawn cap, or prevent Save merely to obtain a small metric.

### Preventing game performance incidents

For an authored instant emitter with numeric looping interval `T = active_time + sleep_time > 0`, particle lifetime `L`, and burst size `N`, the source inspector estimates `burst_work_rate ≈ N / T` and `active_burst_population ≈ N × ceil(L / T)`. This is a bounded overlap heuristic, not an exact simulator (loop boundary timing, engine scheduling, child emitters, and game concurrency remain unknown). The authoring preview budget checks **burst emissions per second as well as living population**: a tiny burst that fires thousands of times per second can still be expensive. Extreme numeric arithmetic is clamped to finite reporting bounds, not interpreted as accepted game performance. Missing or dynamic values are marked unestimated; a zero-period instant loop cannot be automatically previewed. The editor preview admission remains **separate** from actual Minecraft performance.

Do not confuse a small per-emitter count with a small **gameplay workload**. A burst can repeat every emitter loop; an event can create children; one effect can have many simultaneous instances across players, mobs, projectiles or arenas. The authoring game-cost inspector flags *repeating_burst_emission* and *repeating_emitter_child_events* in addition to its existing continuous spawn/lifetime/overdraw/MoLang/collision risks. These are conservative source warnings, not proof that the effect will lag.

For a known gameplay scenario, reason about `sum(estimated single-emitter active particles × concurrently active instances)` as an **illustrative lower-information workload estimate**, never a proven simultaneous peak: event repetition, dynamic expressions, GPU fill-rate and scene visibility may dominate. Do not invent concurrency values. The gameplay caller must establish how often/where effects are triggered; this asset-only tool does not change gameplay scripts or automatically disable an authored effect.

**Non-negotiable release review:** A valid particle document, successfully saved resource pack or clean Blockbench preview is not a game-performance approval. The existing pack analysis exposes `gameplay_release_review`: `STATIC_RISKS_REQUIRE_REVIEW` when source hazards are found, otherwise `TARGET_GAME_EVIDENCE_REQUIRED`. In both states `claim_game_performance_safe=false`. Production approval needs recorded representative and worst-reasonable-case concurrent effects, the actual supported low-end target, repeatable frame-time/FPS comparison with and without the effect, and a visual/behavioral equivalence verdict after optimization. Until those facts exist, use `GAME_PERFORMANCE_UNVERIFIED`, not "game-safe".

This is a QA/release decision, not a new runtime service, editor limiter, automatically generated LOD system, shader rewrite, or extra test suite. Source-only warnings remain inexpensive and do not block exploratory authoring.

## Visible population estimate

**HEURISTIC**

For a steady emitter with roughly constant lifetime:

```text
estimated_visible ≈ min(max_particles, spawn_rate × average_lifetime)
```

This is a conservative static estimate, not an FPS predictor.

Use it to catch obvious accumulation mistakes before delivery.

## Spawn rate

High spawn rate is not automatically bad if lifetime is very short and sprites are cheap.

Conversely, a modest spawn rate can become expensive when particles live a long time.

Always inspect rate and lifetime together.

## max_particles

**OFFICIAL BEDROCK + HEURISTIC**

`max_particles` is an important safety boundary for steady/manual emitters.

Use it deliberately. Do not treat a very high cap as harmless just because average population is currently lower.

## Lifetime

Long lifetime increases population and usually increases total update/render work.

For ambient effects, prefer the shortest lifetime that preserves the desired visual continuity.

## Transparent overdraw

**HEURISTIC**

Large `particles_blend` sprites can be more expensive than their raw particle count suggests because many transparent layers may cover the same pixels.

High-risk patterns:
- giant smoke billboards overlapping heavily;
- many soft mist sprites stacked in one region;
- dense full-screen aura effects;
- long-lived translucent particles hidden inside geometry.

## Billboard size

Large particles increase fill-rate/overdraw risk. Use the scale required for readability, but do not solve low density only by making every sprite enormous.

## Collision

**HEURISTIC**

Collision adds world interaction work. Enable it only when contact behavior materially contributes to the effect.

Prefer simpler expiration rules when full collision response is not visually necessary.

## Parametric motion

**HEURISTIC**

Parametric motion executes expression-driven positioning repeatedly. Keep expressions bounded and use it for paths that genuinely need mathematical choreography.

Do not use complex parametric math for a simple ballistic or drifting effect that dynamic motion can express cheaply and clearly.

## Molang cost

**HEURISTIC + OFFICIAL CONTEXT**

Particle expressions may run at creation, update, or render frequency depending on field ownership.

Performance rule:

```text
stable value needed once
→ compute/select once if possible

value genuinely changes each update/render
→ evaluate repeatedly
```

Avoid repeated expensive random/math expressions in multiple per-render fields when a stable per-particle value can be reused.

## Curves

Curves are evaluated repeatedly. Reuse one curve variable for related progression when appropriate instead of duplicating similar expressions.

## Event fan-out

A major hidden cost is nested effects.

Estimate:

```text
parent particles
× events per parent
× child emitters
× child particle population
```

A parent effect with only 20 particles can still become expensive if every particle spawns a 20-particle child effect.

## Occluded particles

**HEURISTIC + EMPIRICALLY VERIFIED**

Particles spawned inside opaque/static geometry may still consume update/render budget while contributing little or nothing visually.

Use:
- keep-out regions;
- surface-only shapes;
- correct offsets;
- separate crown/rise layers;
- bounded spawn volumes.

## Distance-aware budgeting

Long-distance effects often need larger sprites but not necessarily more particles.

Prefer silhouette readability over brute-force density.

## Performance classes

Use simple qualitative budgeting during authoring:

### Light
- short lifetime;
- low/moderate count;
- simple billboard;
- no collision;
- simple expressions.

### Medium
- moderate population;
- some transparency overlap;
- limited curves/events;
- occasional collision or child effects.

### Heavy
- high visible population;
- large blended sprites;
- nested event fan-out;
- frequent collision;
- complex per-frame expressions;
- multiple simultaneous emitters.

This classification is authoring guidance, not hardware benchmarking.

## What we do not claim

Static particle QA does not predict:
- exact FPS;
- device-specific GPU load;
- render distance behavior on every device;
- transparency sorting cost precisely;
- Minecraft engine scheduling details.

Those require live target-hardware testing.

## Optimization order

When an effect is too expensive, optimize in this order:

```text
remove invisible/occluded work
→ reduce unnecessary event fan-out
→ reduce excessive lifetime
→ reduce excessive spawn rate
→ set sensible max_particles
→ reduce overlapping translucent area
→ simplify collision
→ simplify per-frame Molang/curves
→ reduce layer count only if visual roles can genuinely merge
```

Do not destroy the effect's physical decomposition first.

## Common performance failures

- no `max_particles` cap;
- long lifetime plus high steady spawn;
- many large translucent sprites occupying same screen area;
- collision on ambient particles;
- one event per particle spawning another full emitter;
- complex per-render random/math expressions;
- huge spawn volume mostly hidden by geometry;
- adding more particles to solve a readability problem that should be solved with scale/contrast.

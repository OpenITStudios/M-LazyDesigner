# Particle Performance Knowledge

Provenance labels:
- **OFFICIAL BEDROCK** — Microsoft Bedrock particle documentation.
- **SNOWSTORM / WINTERSKY** — editor/preview-specific behavior.
- **EMPIRICALLY VERIFIED** — reproduced in accepted authoring work.
- **HEURISTIC** — authoring guidance.

## Constant-work authoring preview budget (2026-11-07)

The read-only `preview_workload` in existing particle inspection uses a **single-emitter static heuristic**: instant count or `min(spawn_rate × max_lifetime, max_particles)` when numeric. No recursive pack scan, evaluator, or new renderer is introduced. Unknown MoLang/dynamic rates are `unestimated`, never a claim of safety. Child effects are excluded from numeric population estimates.

**Engineering-only viewport admission:** >256 estimated particles or >500/s steady emission pauses automatic Studio preview; nested effects also require explicit Play/Replay. >1024 estimated particles or >5000/s steady emission, and direct self-recursion, prevent native preview. `manage_particle(preview=true)` still commits a valid JSON artifact when native preview is blocked and returns `preview_load_call=BLOCKED`. Exact thresholds are protective editor defaults, **not Minecraft limits or measured device FPS**; live output/render/overdraw remains unverified. Avoid disabling authoring merely because a preview needs to be lighter.


Particle performance is the combined cost of:

```text
how many particles exist
+ how expensive each particle is to update
+ how expensive each visible particle is to render
+ event fan-out
+ collision / Molang / transparency complexity
```

No single field is a complete performance metric.

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

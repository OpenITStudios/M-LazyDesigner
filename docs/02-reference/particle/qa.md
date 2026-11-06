# Particle QA Sequence

Run checks in this order so later conclusions do not hide an earlier structural or semantic defect. Apply only gates relevant to the authored target/effect.

## Gate 1 — Bedrock document + target-schema structure

Check:
- every `.particle.json` parses;
- identifiers are valid and unique where required;
- referenced textures/effects exist when evidence is available;
- component/vector/scalar shapes are valid for the target Bedrock schema/version;
- omitted fields are not silently treated as `0`, `false`, empty collections, or zero vectors when the schema says `not set`;
- one-time, per-update, per-render, and continuous expressions use the intended owner/evaluation stage;
- unknown/new authored fields are preserved rather than rewritten away.

Use `official-defaults-evaluation.md` when exact omission/default behavior materially affects the result.

## Gate 2 — Snowstorm / Wintersky compatibility — conditional

Run only when Snowstorm/Wintersky preview or editing is part of the target.

Check:
- scalar-speed compatibility pattern is used when vector initial-speed magnitude would make Snowstorm preview unreliable;
- launch direction lives on the intended shape/direction owner when scalar speed is used;
- no emitter-age class switching inside living-particle motion, billboard size/UV, or tint when stable particle identity is required;
- version-sensitive behavior is checked against `snowstorm-compatibility-matrix.md`;
- a suspected preview regression is not promoted into a generic Bedrock restriction.

A vector `minecraft:particle_initial_speed` form is not generically invalid merely because Snowstorm preview may be unsuitable for magnitude tuning.

## Gate 3 — Snowstorm import/export round-trip — conditional

Run only when advanced/external JSON has actually been imported and re-exported through Snowstorm.

Check the structural diff for:
- meaningful numeric `0` values;
- meaningful `false` values;
- omitted fields that became explicit or disappeared;
- advanced event structures;
- target-version fields Snowstorm may not expose as first-class controls;
- texture/material/path changes.

Successful import alone is not round-trip proof.

## Gate 4 — Motion / rotation sanity — conditional

When constant numeric inputs make static reasoning useful, estimate or inspect:
- initial velocity;
- acceleration/drag ownership;
- apex/time-to-apex when relevant;
- horizontal travel/final displacement;
- initial rotation/rate and rotational acceleration/drag when relevant.

Compare against explicit authored targets when present. A miss is diagnostic evidence, not permission to silently rewrite intent.

## Gate 5 — Bundle + event integrity

Check when multi-effect/event architecture exists:
- duplicate identifiers;
- document identifier mismatch;
- missing child-effect references;
- circular child chains;
- orphan entries relative to an explicit root;
- event owner/timing is emitter-, particle-, distance-, or collision-relative as intended;
- texture reference resolution when the available set is known.

## Gate 6 — Texture / atlas QA

Check relevant texture concerns when pixel data or direct visual inspection is available:
- real RGBA transparency;
- no baked checkerboard/background;
- no unintended white/dark matte or halo;
- hidden RGB is compatible with intended alpha/filtering behavior;
- dimensions and UV bounds match the authored mapping;
- atlas/flipbook cells have safe gutters;
- visible bounds/frame alignment are stable;
- duplicate cells are intentional;
- tint/texture alpha/material ownership is coherent.

Skip atlas/flipbook checks for a single static sprite with no atlas.

### Static temporal visibility clues

The existing `inspect_particle` semantics now reports optional `particle_billboard_zero_axis`, `particle_constant_zero_tint_alpha`, `particle_flipbook_static_frames` and `particle_flipbook_lifetime_too_short` warnings for literal values. Use them to catch obvious invisible/frozen/truncated effects **without** treating a source heuristic as visible-pixel evidence or blocking intentionally hidden assets. Unknown MoLang and PNG alpha content remain unverified. Only perform these checks when the effect actually has that appearance/flipbook input.

## Gate 7 — Collision / environmental termination — conditional

When collision or environmental expiration is used, check:
- collision radius/restitution/drag are target-schema valid;
- collision-event `min_speed` is intentional;
- repeated contact cannot create accidental fan-out;
- `expire_if_in_blocks` / `expire_if_not_in_blocks` lists have the intended blacklist/allow-list role;
- kill-plane orientation/sign is intentional;
- max lifetime, expiration expression, environmental expiration, collision expiration, and kill plane do not conflict unexpectedly.

## Gate 8 — Spatial / attachment sanity — conditional

When environment geometry or entity attachment is known, check:
- representative spawn/travel paths against explicit keep-out regions;
- local/world-space ownership;
- locator/bone/emitter transform expectations;
- velocity inheritance when relevant;
- bound vs fire-and-forget behavior.

This is not a substitute for Minecraft collision/attachment simulation.

## Gate 9 — View-distance readability — conditional heuristic

When target viewing distance matters, use particle size versus distance only as a warning signal. FOV, display resolution, contrast, alpha, motion, background, and scene salience remain visual-review concerns.

## Gate 10 — Visual quality **and in-game performance** — conditionally required before game-readiness

**Goal:** effects must communicate the approved role clearly **without** avoidable Minecraft runtime cost. The Blockbench preview threshold is not the game budget. Review `inspect_particle.summary.game_cost` and, when multiple effects are available, `analyzeBedrockParticlePack.composition_workload.game_cost_drivers`. Report flags and unknowns, not a fabricated performance score.

Check the relevant physical facts: spawn rate × lifetime versus numeric cap, sustained emitters, blend/additive billboard screen-coverage risk, collision/parametric/per-render complexity, event/child multiplicity and **how many instances may coexist** during actual gameplay. Unknown MoLang, viewing distance and target device remain unresolved. Begin optimization with redundant/occluded work, alpha/texture readability, excess lifetime, overlap and fan-out. Preserve focal flash, silhouette, important animation timing and stylistic consistency; do not reduce quality solely to make a static count smaller.

**Acceptance is separate:** reference-matched visual readability, correct in-game particle/event behavior and target-hardware frame-time/FPS evidence under representative concurrent load. Until those are observed, status is `GAME_PERFORMANCE_UNVERIFIED` and `VISUAL_QUALITY_UNVERIFIED` even when JSON/schema and static cost checks are clear. Do not demand tests while the user test hold is active; retain the evidence boundary.

**Production-safety rule:** A structurally valid pack with a cycle, missing child, unbounded dynamic expression or suspected per-particle event fan-out requires targeted source review before game delivery. A clean static inspection still requires gameplay evidence; neither verdict may claim safe FPS. Check replayed instant bursts, emitter timeline repetition, simultaneous player/mob/projectile activations, overlapping transparent sprites and lower-spec devices. Optimize the minimal visually redundant cost, not the focal effect. `analyzeBedrockParticlePack.gameplay_release_review` is a read-only warning owner and does not certify an actual release gate or replace runtime observation.


### Six-case particle visual and Minecraft game-load acceptance matrix

This is a **future authorized native evidence procedure**, not a new test runner or proof that these effects have been played. Use relevant cases only; do not rerun all six for an unrelated particle change.

| Case | Visual observation | Minecraft game-load risk |
| --- | --- | --- |
| Flame (continuous) | Stable silhouette, source anchoring, lifetime fade | Many flames; spawn rate, lifetime and occlusion |
| Smoke / plume | Soft translucency, atlas edges, rising motion, intentional tail | Overlapping blend sprites and screen-space overdraw |
| Magic aura | Stable age-based pulse/color, attachment and rotation | Many players/mobs with persistent effects and MoLang |
| Impact / explosion | Flash visibility, ordered fragments/dust, clean decay | Concurrent bursts, looping emission and child event fan-out |
| Moving projectile trail | Motion continuity, trail length, correct space/attachment | Multiple projectiles, rapid spawn cadence, movement/retrigger |
| Collision splash / reactive | Correct contact, bounce/expiry, one-shot intent | Repeated collisions and child-effect amplification |

For each selected case use an approved or explicitly provisional visual target, known particle/texture identity and relevant source diagnostics. Observe creation, midlife, expiration/tail, and at least three consecutive cycles when the emitter loops. Compare close and intended distant views against a contrasting background; add a second background only when alpha/contrast is material. For moving/attached effects compare stationary and moving behavior. **A few frozen screenshots cannot prove temporal visual quality.**

**Game-load comparison:** record the same Bedrock version, pack SHA, device (including actual supported low-end hardware), world/scene, render distance and graphics settings. Compare baseline effect off, one effect, typical concurrent uses and worst-reasonable-case uses across real gameplay players/mobs/projectiles. Count simultaneous instances using actual game behavior; do not invent numbers. Collect measured FPS/frame-time distribution (median, p95/p99 frame time when available), stutter/freeze symptoms, run duration and warmup. Use the project's own target-device performance budget rather than a universal numerical limit. Missing metrics remain UNVERIFIED.

**Optimization acceptance:** preserve the primary silhouette, flash, texture readability and timing while first eliminating redundant/occluded work, long-lived overlap, uncontrolled event fan-out, and unnecessary per-render math/collision. After a change, compare the candidate and prior reference at matched conditions. Do not pass an inferior-looking effect because it emits fewer particles.

**Existing evidence record only:** exact source SHA/build, approved reference provenance, effect files, selected scenario, measured game environment, baseline and game-load results, visual PASS/FAIL/UNVERIFIED, performance PASS/FAIL/UNVERIFIED, and unresolved limitations. No new manifest, screenshot archive, Golden identity or recorder is required.

## Gate 11 — Package integrity

Before delivery verify:
- normal Resource Pack structure;
- all JSON texture/effect references resolve;
- no temp/scratch/obsolete QA files;
- no duplicate unused textures;
- no versioned working filenames unless explicitly required;
- usage notes match the actual package;
- Snowstorm-specific notes are included only when Snowstorm is relevant.

## Final acceptance

```text
BEDROCK / STATIC QA PASS OR WARNINGS UNDERSTOOD
→ OPTIONAL SNOWSTORM TARGET REVIEW
→ USER VISUAL REVIEW IN THE ACTUAL TARGET ENVIRONMENT
→ APPROVE OR TARGETED REVISION
```

Static QA, Snowstorm preview, and source inspection never replace Minecraft/runtime visual truth when runtime truth is required.

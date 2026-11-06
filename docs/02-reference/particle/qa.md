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

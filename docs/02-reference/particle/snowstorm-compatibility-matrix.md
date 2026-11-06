# Snowstorm / Wintersky Compatibility Matrix

Purpose: keep version-specific Snowstorm/Wintersky authoring knowledge separate from generic Bedrock validity.

Evidence classes:
- **SNOWSTORM / WINTERSKY** — release/source evidence from Snowstorm/Wintersky.
- **EMPIRICALLY VERIFIED** — reproduced project behavior.
- **HEURISTIC** — bounded compatibility guidance.

## Current release baseline

As of the latest published GitHub release currently available:

```text
Snowstorm published GitHub release: 3.3.0
Wintersky paired release:          1.4.0
```

Snowstorm `master` source metadata reports `3.3.2` at 2026-11-06, while the latest published GitHub release verified here is `3.3.0` (2026-11-04). Source commits/extension publishing are not automatically equivalent to a tagged GitHub release. This is NOT the bundled Blockbench renderer version.

Current `master` dependencies include:

```text
wintersky ^1.4.0
molangjs  ^1.6.6
three     ^0.134.0
```

Do not describe unreleased source-head behavior as a published release feature.

## Release matrix

| Snowstorm | Wintersky | Important particle-authoring changes |
|---|---|---|
| 3.0.0 | 1.3.0 | Quick Setup, Bedrock events, chained/nested preview, basic texture/UV editing, custom materials, manual emitter spawn mode, camera-distance query preview, reference block; fixed curves+Molang returning 0 and unspecified `max_lifetime` import reset. |
| 3.1.0 | 1.3.x family | Variable placeholders for game-only/undefined variables; VS Code texture auto-save/path creation; fixed export dropping `num_particles: 0`; fixed nested-scope Molang issue. |
| 3.2.0 | 1.3.2 | Documentation panel, preview loop default Auto, better VS Code texture path lookup, same event multiple times; fixed zero size fields being omitted, slow VS Code ticking, concurrent timeline events, negative-number Molang, expiration-block multiline export, gradient UI issues. |
| 3.2.1 | 1.3.3 | `math.min_angle`; event-expression undefined-variable detection; fixes for `camera_distance_range_lerp`, expiration event firing at playback start, inconsistent timeline time codes, collision `min_speed`, gradient hue/alpha edit registration, additive black-pixel rendering. |
| 3.3.0 | 1.4.0 | MoLang gradient colors, versioned Molang reading, corrected particle update expression evaluation order and emitter activation default, blend/additive overlapping particles, expiration freeze, outer UV fallback for flipbooks, warning for negative particle size, reference player and collapsible events. |

This table is editor capability history, not Bedrock format history.

## Blockbench renderer boundary

Blockbench 5.2.2 has its own bundled Wintersky dependency (`^1.3.2` in the upstream package manifest). Snowstorm 3.3.0's Wintersky 1.4.0 fixes cannot be presumed present in Blockbench's native viewport. LazyDesigner's Particle Studio reuses the *actual* Blockbench runtime; do **not** install a second renderer or claim that Snowstorm release behavior applies to Blockbench. For preview discrepancies, pin the installed Blockbench build and effective bundled renderer and distinguish editor limitation from invalid Bedrock JSON.

## Source-level JSON mapping

Current Snowstorm source exports a Bedrock particle document with:

```text
format_version = 1.10.0
particle_effect.description.identifier
particle_effect.description.basic_render_parameters.material
particle_effect.description.basic_render_parameters.texture
particle_effect.curves
particle_effect.events
particle_effect.components
```

Source-level mapping confirms direct editor ownership for major families including:

```text
emitter_initialization
emitter_local_space
emitter_rate_instant / steady / manual
emitter_lifetime_looping / once / expression / events
emitter_shape_point / sphere / box / disc / custom / entity_aabb
particle_initialization
particle_lifetime_expression / lifetime_events
particle_expire_if_in_blocks
particle_expire_if_not_in_blocks
particle_initial_spin
particle_initial_speed
particle_motion_dynamic / parametric / collision
appearance / UV / curves / events
```

Do not infer that every valid future Bedrock field is fully editable merely because the JSON parser accepts the file.

## Import / unsupported-field boundary

Current Snowstorm source explicitly tracks some imported event-related structures as `unsupported_fields`, including:

```text
particle_effect.events
minecraft:emitter_lifetime_events
minecraft:particle_lifetime_events
particle_motion_collision.events
```

This is a critical authoring boundary:

```text
file imported successfully
≠ every field has a first-class editor control
≠ round-trip preservation is automatically proven
```

When opening externally authored JSON with advanced or newly introduced fields:
1. preserve an original copy;
2. inspect Snowstorm code preview/export diff before accepting a save;
3. verify zero/false/empty-but-meaningful values survive;
4. compare target Bedrock schema after export;
5. never use Snowstorm save as an implicit schema normalizer.

## Web app vs VS Code extension

### Web app

Strengths:
- fast standalone visual editing;
- child particle tabs can synchronize for event chains;
- built-in/vanilla texture-path assistance.

Limitations:
- referenced local resource-pack files are less naturally available than in a workspace;
- external game-only variables may require placeholders;
- project-wide path resolution is more limited.

### VS Code extension

Strengths:
- resource-pack folder context;
- referenced child effects can resolve/load from project files;
- texture path search uses workspace files;
- saving can write texture changes and create texture directories in supported workflows.

Version caveat: 3.2.0 fixed a VS Code tick-throttling issue that could make particles preview very slowly in some tabs. Do not tune physical speeds against an affected older preview.

## Molang compatibility layers

Snowstorm uses MolangJS; Wintersky also depends on MolangJS. Therefore distinguish:

```text
Molang parser accepts expression
→ syntax/library capability

Snowstorm preview evaluates expression
→ editor host/context capability

Minecraft evaluates expression correctly
→ actual target runtime capability
```

Known release-relevant points:
- 3.0.0 fixed Molang+curve expressions returning 0;
- 3.1.0 fixed nested-scope execution;
- 3.2.0 fixed operations with negative numbers;
- 3.2.1 added `math.min_angle` and improved undefined-variable detection in events;
- 3.2.1 fixed `camera_distance_range_lerp` preview behavior.

Variable placeholders introduced in 3.1.0 are preview substitutions, not proof that the same value/query exists in Minecraft particle context.

## Event compatibility layers

Snowstorm 3.0.0 introduced event authoring and chained preview; Wintersky 1.3.0 introduced event rendering support.

Subsequent fixes matter for diagnosis:

```text
Wintersky 1.3.2 / Snowstorm 3.2.0
→ multiple events at one timeline point no longer only fire the first

Wintersky 1.3.3 / Snowstorm 3.2.1
→ expiration event no longer fires merely from replay/start
→ certain timeline time-code inconsistencies fixed

Snowstorm 3.2.1
→ collision-event min_speed editing/behavior fix
```

If a user reports event timing problems on an older version, check the release matrix before changing valid particle architecture.

## Export-loss risk

Release history proves several export bugs existed and were later fixed:

```text
3.1.0 fixed num_particles = 0 being deleted
3.2.0 fixed billboard size fields = 0 being omitted
3.2.0 fixed expiration block multiline input exporting incorrectly
3.0.0 fixed unspecified max_lifetime being reset on import
```

General rule:

```text
semantically meaningful zero / false / omission
→ must survive editor round trip intentionally
```

For high-value authored packages, compare pre-import and post-export JSON structurally.

## Texture / material preview matrix

Snowstorm 3.0.0 added basic texture editing and static UV manipulation. Use this for quick edits, not as the production texture authority.

Important release caveats:
- 3.2.0 fixed default particle texture being saved into a pack without real edits;
- 3.2.0 fixed gradient editor state/UI issues;
- 3.2.1 fixed gradient hue/alpha edit registration;
- 3.2.1 fixed black pixels under additive material rendering.

Therefore:

```text
preview artifact
→ first check editor release
→ then source PNG/RGBA/material
→ then Minecraft runtime
```

Do not permanently damage a correct additive texture to compensate for a fixed old preview bug.

## Quick Setup boundary

Quick Setup is an editor convenience introduced in 3.0.0. It can configure common shape/motion/timing and starter textures, but its output must still pass the normal particle knowledge/QA path.

After Quick Setup:

```text
inspect JSON
→ remove unnecessary components
→ verify ownership
→ verify units
→ verify direction vs speed
→ verify lifetime/rate
→ verify texture/material
```

## Compatibility decision rule

When Snowstorm and Bedrock expectations differ:

```text
1. identify exact Snowstorm release
2. identify Wintersky version when known
3. identify whether behavior is editor UI, exporter, MolangJS, or renderer
4. confirm target Bedrock schema independently
5. use minimal reproduction
6. compare Minecraft only when runtime truth is required
7. record workaround as target-specific, not generic Bedrock law
```

## Current recommended target

For independent Snowstorm review of event timing, collision events, gradients, additive materials and Molang, the verified published GitHub baseline is Snowstorm `3.3.0` / Wintersky `1.4.0`. Blockbench's embedded renderer remains a separate compatibility target.

Do not equate the `master` package version `3.3.2` with the `3.3.0` published GitHub release; confirm the exact tag/extension separately.

## Sources

- https://github.com/JannisX11/snowstorm/releases/tag/v3.0.0
- https://github.com/JannisX11/snowstorm/releases/tag/v3.1.0
- https://github.com/JannisX11/snowstorm/releases/tag/v3.2.0
- https://github.com/JannisX11/snowstorm/releases/tag/v3.2.1
- https://github.com/JannisX11/snowstorm/releases/tag/v3.3.0
- https://github.com/JannisX11/wintersky/releases/tag/v1.4.0
- https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/package.json
- https://github.com/JannisX11/wintersky/releases/tag/v1.3.0
- https://github.com/JannisX11/wintersky/releases/tag/v1.3.2
- https://github.com/JannisX11/wintersky/releases/tag/v1.3.3
- https://github.com/JannisX11/snowstorm/blob/master/package.json
- https://github.com/JannisX11/snowstorm/blob/master/src/import.js
- https://github.com/JannisX11/snowstorm/blob/master/src/export.js
- https://github.com/JannisX11/wintersky/blob/master/package.json

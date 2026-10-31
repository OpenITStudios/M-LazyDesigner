# Pixel Art Style Lock

## Purpose

Keep a series of pixel-art assets visually coherent without forcing every subject into identical geometry or literal palette values.

Style Lock is a compact reusable visual grammar, not a prompt archive or a second project-state system.

## Identity

Each established set may use one stable `style_lock_id`.

```text
style_lock_id
→ identifies one visual grammar
→ reused across related assets
→ changes only when the shared grammar materially changes
```

Do not create a new ID for ordinary subject-specific exceptions or bounded revisions that preserve the same family grammar.

## Canonical Profile Shape

Keep only fields that can change authoring decisions.

### Core fields

```text
style_lock_id
canvas_or_target_grid
visible_pixel_scale
subject_occupancy
projection_family
outline_treatment
edge_rhythm
palette_relationship
palette_ramp_behavior
light_direction
contrast_range
cluster_density
cluster_shape_language
shadow_language
material_highlight_language
accent_priority
alpha_background_convention
simplification_level
```

### Optional fields

Use only when required:

```text
shared_padding_rule
shared_anchor_rule
shared_emissive_language
shared_animation_timing_language
shared_material_exception_rules
minecraft_asset_family
repeat_rhythm_rule
```

Do not add fields merely because they can be measured.

## Artist Invariants vs Subject Freedom

A useful Style Lock separates shared grammar from subject-specific anatomy.

### Shared invariants

Normally preserve:
- visible pixel scale;
- projection family;
- occupancy range;
- outline/edge logic;
- contrast hierarchy;
- palette-ramp relationship;
- light direction;
- cluster density and shape character;
- shadow/highlight grammar;
- accent priority;
- alpha convention;
- simplification level.

### Subject-specific freedom

Normally allow:
- silhouette and aspect ratio;
- functional exaggeration;
- local palette extension for new materials;
- subject-specific highlight placement;
- asymmetry;
- local outline exceptions required by glass/emissive/negative-space readability.

Consistency means shared visual grammar, not identical treatment everywhere.

## Field Authority

Each material field preserves one authority class:

```text
USER_REQUIREMENT
REFERENCE_SUPPORTED
EXISTING_STYLE_SUPPORTED
PROVISIONAL
```

Provisional fields may guide a first pass but must never be presented as approved project truth.

## Establishing a Profile

Resolve fields in this order:

1. explicit current user instruction;
2. accepted representative asset/set;
3. clearly dominant project convention;
4. conservative provisional choice.

Do not average conflicting accepted examples. If two assets imply materially different edge rhythm, contrast, projection, or palette grammar, determine whether they belong to separate style families.

## Representative Asset Rule

When possible, anchor a Style Lock to one accepted representative asset rather than an abstract verbal description alone.

Use the representative only for grammar:

```text
pixel scale
occupancy
edge rhythm
outline behavior
contrast
palette relationships
cluster density
lighting
material treatment
```

Do not copy subject-specific shapes/details into unrelated assets.

## Compactness Rule

Style Lock must not contain:

```text
full prompts
conversation history
full image/reference corpus
per-pixel coordinates
complete palette dump unless exact reuse is authoritative
UV coordinates
Blockbench texture UUIDs
particle runtime behavior
revision diary
```

## Reuse

For a subsequent asset:

```text
current subject requirement
+ style_lock_id
+ representative asset only when needed
+ only decision-changing style fields
→ author
```

Do not retransmit all previous assets or the full Pixel Art corpus.

## Subject-Specific Exceptions

An exception is valid when required for recognizability, transparency, material behavior, target-family requirements, or functional readability.

Example:

```text
family = selective outline
→ glass bottle reduces interior outline
→ outer silhouette remains compatible
→ transparency becomes clearer
→ style_lock_id unchanged
```

Record the local exception; do not mutate the shared grammar for one subject.

## Drift Detection

Treat these as likely unsupported drift:

- changed implicit pixel scale;
- inconsistent occupancy/padding;
- changed projection without functional reason;
- random switch between full/selective/no-outline;
- edge staircase rhythm inconsistent with the set;
- conflicting light direction;
- materially different contrast hierarchy;
- palette ramps that suddenly become smoother/noisier/more saturated;
- one asset using isolated micro-noise while the set uses clean clusters;
- materially different cluster density;
- same material family rendered with unrelated highlight grammar;
- accent colors spreading into secondary regions and losing focal priority;
- subject rendered at a different simplification level without need.

## Set-Level Review

Do not judge style consistency asset-by-asset only.

For batches, compare assets together at native size and ask:

```text
Do they share one visual weight?
Do focal accents have comparable priority?
Do edges feel authored by the same hand?
Do materials use compatible abstraction?
Does one asset look over-rendered or under-rendered?
```

Correct outliers rather than restyling the entire set.

## Profile Update

When the user intentionally changes the shared direction:

```text
identify changed shared fields
→ update Style Lock once
→ preserve unchanged fields
→ propagate only where materially required
```

A major intentional change that creates a separate visual family gets a new `style_lock_id`; a bounded correction within the same grammar does not.

## Downstream Handoff

Pass only fields that affect the consumer.

Examples:

```text
Texturing
→ visible pixel scale, palette/ramp relationship, light/shadow language,
  outline/edge language, alpha convention, simplification level

Particle texture
→ pixel scale, palette/emissive language, alpha convention,
  frame language when animated
```

Downstream owners do not need the whole Style Lock when a subset is sufficient.

## Cross-Domain 3D Art Direction

For stylized 3D voxel assets, use the **single** [Reference Art Direction](../art-direction.md#stylized-minecraft-voxel-3d--conditional-artist-style-bible). This file remains the canonical **Pixel Art Style Lock** for standalone pixel-art identities, grids, palette/cluster grammar and relevant approved texture references. Do not copy the 3D policy into a second location or infer 3D Geometry, PBR or Animation settings from a pixel-art profile alone.

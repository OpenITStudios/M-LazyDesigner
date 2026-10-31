# LazyDesigner Texture Reference Contract

Updated: 2026-09-12

This document owns the canonical content contract for generated `TEXTURE.md` files inside a LazyDesigner Reference Package.

It does not own runtime texturing implementation, UV packing, painting Tool calls, or Blockbench painter behavior. Those remain downstream LazyDesigner Texturing responsibilities.

## Objective

`TEXTURE.md` should tell Astra/Codex what visual surface result must be preserved without becoming a pixel-by-pixel recipe.

It should answer only material texturing questions such as:

```text
what materials/colors define the asset
which semantic parts share or differ in material identity
which markings/details are identity-critical
which regions require alpha, emissive, or PBR treatment
which visual references own the texture decision
what remains unknown or blocking
```

## Generation Rule

Create `TEXTURE.md` only when texturing guidance materially improves downstream correctness.

Do not create it merely to make the package look complete.

Typical reasons to include it:

```text
multiple material regions
identity-critical color/marking placement
alpha/cutout regions
emissive regions
PBR-relevant material distinction
surface direction/pattern continuity
source-specific wear/damage/styling
```

A simple uniformly colored asset may not need a separate `TEXTURE.md` if `REFERENCE.json` + approved visual reference already provide enough authority.

## Authority

```text
explicit current user requirement
→ approved visual reference
→ REFERENCE.json structured material facts
→ TEXTURE.md interpretation
→ downstream Codex/Texturing decision
```

`TEXTURE.md` must not introduce a new material/color interpretation that is absent from stronger authority.

## Cross-Domain 3D Art Direction

When the approved model target has a shared voxel family grammar, the [canonical Art Direction](../art-direction.md#stylized-minecraft-voxel-3d--conditional-artist-style-bible) may inform only source-supported material/value/pixel rhythm and focal treatment in the existing surface sections. This is distinct from standalone Pixel Art Style Lock: keep `style_lock_id` only when actually established, and do not override approved reference pixels, UV ownership or material/render intent. No additional Reference Package field is introduced.

## Pixel Art Visual Authority

An approved Pixel Art artifact can be a first-class visual reference for Texturing, but it remains **visual authority**, not mapped implementation state.

When Pixel Art supplies the appearance target, `TEXTURE.md` may interpret only the appearance facts that matter downstream:

```text
palette/value relationships
material grouping
identity markings / landmark regions
pixel-cluster language
projection/orientation when relevant
alpha behavior
style_lock_id + relevant style constraints
reference-fidelity constraints
```

Do not copy Pixel Art working history, prompts, QA scratch, or its full knowledge corpus into `TEXTURE.md`.

Do not infer from a Pixel Art image:

```text
UV coordinates
atlas packing
Blockbench texture UUID
material-instance state
render-profile state
mapped-surface PASS
```

Those remain Texturing/Runtime-owned.

If a Pixel Art constraint cannot survive the actual model UV/surface state, downstream Texturing must preserve the visual intent where possible and return the bounded UV/Geometry conflict upstream rather than silently redesigning the reference.

## Canonical Structure

Use only sections that materially apply:

```text
# Texture Reference

## Target Surface Direction
## Material Regions
## Color / Value Relationships
## Identity-Critical Markings
## Surface Character / Pattern
## Alpha / Transparency
## Emissive / PBR
## Continuity / Mapping Concerns
## Texture Constraints
## Visual References
## Unknowns / Blockers
```

Sections may be omitted when not relevant.

## 1. Target Surface Direction

One concise statement describing the overall target surface appearance.

Example:

```text
Muted workwear with darker woven basket material and warm straw accents. Preserve the approved Minecraft-stylized look; avoid photoreal micro-noise.
```

Do not restate full asset geometry or animation intent.

## 2. Material Regions

Describe only decision-critical semantic material cohorts.

Example:

```text
shirt
- muted cloth
- medium value

trousers
- darker cloth than shirt

hat
- warm straw / woven matte

basket
- darker woven wood/rattan than hat

tool
- follow supplied source reference
```

Prefer semantic region names already present in `REFERENCE.json`.

Do not invent materials for hidden or unresolved surfaces.

## 3. Color / Value Relationships

Use relative relationships when exact numeric color is not explicitly required.

Good:

```text
basket darker than straw hat
boots slightly darker than trousers
identity accent remains higher-contrast than surrounding cloth
```

Avoid unnecessary fixed RGB/HEX values unless the user explicitly provides them or exact branded color matching is required.

When an approved Pixel Art artifact carries exact authoritative palette values, those values may be preserved as reference evidence. Do not promote provisional palette shades to fixed requirements.

Do not bake scene lighting into the material description.

## 4. Identity-Critical Markings

Record markings whose absence, placement, orientation, or relative scale would materially change identity.

Examples:

```text
logo / emblem
stripe
warning mark
face marking
vehicle number
patterned sleeve
painted panel identity
```

For each material marking, describe only what matters:

```text
what part owns it
approximate placement relative to the part
orientation
relative scale/readability
symmetry/asymmetry
reference image ID
```

Do not specify atlas coordinates or individual paint operations.

## 5. Surface Character / Pattern

Describe surface behavior that affects the intended look, for example:

```text
woven
rough wood
brushed metal
painted metal
matte cloth
smooth plastic
weathered paint
pixel-clustered fur pattern
```

For directional patterns, state the required relation:

```text
wood grain follows the length of the shelf
fabric stripe continues across adjoining mapped surfaces
vehicle hazard stripe keeps the approved diagonal direction
```

For Pixel Art-backed references, preserve deliberate cluster language and visible pixel scale only when those are part of the approved visual target. Do not convert the reference into smooth painterly shading unless the user explicitly changes style direction.

Do not convert this into a generic procedural texturing tutorial.

## 6. Alpha / Transparency

Include only when required.

Describe the semantic ownership of transparency:

```text
leaf cluster silhouette is alpha-owned
window is translucent material, not an open cavity
cutout signage keeps transparent unused regions
```

If alpha mode materially affects appearance, record the intended visual behavior, not the Runtime implementation command.

Do not use alpha to fake geometry that should own actual volume or openings.

## 7. Emissive / PBR

Include only relevant supported facts.

Examples:

```text
lamp face is emissive
metal frame may use PBR-relevant metallic/roughness treatment
cloth is non-emissive and non-metallic
```

Do not invent advanced PBR requirements for assets that do not need them.

Do not encode Texture Set file implementation, channel packing, or Runtime API details here.

## 8. Continuity / Mapping Concerns

Describe only visible relationships that must survive UV/texturing decisions.

Examples:

```text
stripe continues across torso front/side
wood grain should not flip randomly between adjoining shelf surfaces
paired boots may share a cohort if visual symmetry is intentional
left shoulder emblem is asymmetric and must not be mirrored to the right
```

This is appearance guidance, not UV Layout instruction.

If the required continuity cannot be achieved because UV/Geometry is wrong, downstream Texturing must return the bounded defect upstream rather than repaint around it.

## 9. Texture Constraints

Only include constraints that affect accepted-result correctness.

Examples:

```text
preserve Minecraft-stylized pixel readability
avoid photoreal noise
keep unused transparent atlas regions transparent
supplied tool material must follow source reference
preserve approved asymmetry
```

Do not include generic advice that already belongs to the Texturing Skill.

## 10. Visual References

Use stable image IDs from `REFERENCE.json`.

Example:

```text
IMG_GEO_01
- overall approved color/material distribution

IMG_TEX_01
- close material/color authority for hat, basket, and clothing

IMG_PIXEL_01
- approved Pixel Art authority for palette, cluster language, marking layout, and alpha silhouette

IMG_SOURCE_01
- source authority for held tool material
```

Explain only what each image owns for texturing.

Do not duplicate the visual description pixel by pixel.

## 11. Unknowns / Blockers

Carry only texture-relevant uncertainty.

Example:

```text
Non-blocking:
- exact underside color of basket is not visible

Blocking:
- none
```

A missing texture detail should not block Geometry unless it affects Geometry ownership.

If an identity-critical color/material/marking is unresolved, mark Texturing as `BLOCKED` or `NEEDS_REVIEW` in `REFERENCE.json` as appropriate.

## Representation Boundary

Texture may clarify form but must not compensate for missing structural geometry.

```text
surface color / pattern / seam / marking
→ TEXTURE

real silhouette / volume / opening / attachment / dimensional layer
→ GEOMETRY
```

If the visual target depends on a true 3D change, `TEXTURE.md` should reference the requirement but not instruct painting to fake it.

## Example — Farmer NPC

```markdown
# Texture Reference

## Target Surface Direction
Muted Minecraft-stylized workwear with warm straw and darker woven basket materials.

## Material Regions

### Shirt
- muted cloth
- medium value

### Trousers
- darker than shirt
- simple cloth treatment

### Straw Hat
- warm straw tone
- woven/matte impression
- underside slightly darker when supported by reference

### Basket
- darker woven wood/rattan than hat
- keep visually separated from torso clothing

### Harvesting Tool
- follow supplied source reference

## Color / Value Relationships
- basket darker than straw hat
- trousers darker than shirt
- tool keeps source-reference material contrast

## Identity-Critical Markings
- preserve any approved clothing markings exactly where visible

## Surface Character / Pattern
- cloth: simple pixel-cluster shading
- straw/basket: woven impression through readable pixel grouping, not photoreal noise

## Alpha / Transparency
Not required.

## Emissive / PBR
Not required.

## Texture Constraints
- preserve approved Minecraft-stylized readability
- do not invent decorative patterns absent from the reference

## Visual References
- IMG_GEO_01 — overall material/color distribution
- IMG_TEX_01 — material close reference if present
- IMG_SOURCE_01 — harvesting tool material authority

## Unknowns / Blockers
Blocking: none.
```

## Do Not Include

`TEXTURE.md` must not contain:

```text
exact UV island coordinates
atlas packing instructions
paint tool call sequences
pixel-by-pixel commands
full Geometry hierarchy
animation keyframe instructions
MCP/Gateway schemas
generic Blockbench tutorials
invented RGB/HEX values
generic palette filler not grounded in authority
Pixel Art prompt/history/QA scratch
```

## Correction Rule

For a bounded texture/material correction, update only affected sections.

Example:

```text
hat: straw → dark beanie
```

Possible affected content:

```text
Material Regions
Color / Value Relationships
Identity-Critical Markings
Visual References
REFERENCE.json material/image entries
```

Do not rewrite unrelated texture guidance.

## Completion Condition

`TEXTURE.md` is complete when Astra/Codex can determine, without material guessing:

```text
which surfaces/material regions matter
how their colors/values relate
which markings are identity-critical
which patterns/continuity must be preserved
whether alpha/emissive/PBR matters
which image owns each visual decision
which unresolved facts block texturing
```

Then downstream implementation remains owned by the LazyDesigner Texturing Skill.
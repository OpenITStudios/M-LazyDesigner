# LazyDesigner GEOMETRY.md Contract

Updated: 2026-09-18

This document owns the canonical content and structure of `GEOMETRY.md` inside a ChatGPT-generated LazyDesigner reference package.

`GEOMETRY.md` is a **stage-specific projection** for Codex/Astra. It explains only Geometry consequences already supported by the approved user intent, approved visual references, and `REFERENCE.json`. It is not an independent authority and not a Cube-by-Cube blueprint.

## Objective

`GEOMETRY.md` should let Codex answer quickly:

```text
what must be built?
what world/player scale must it preserve?
what numeric envelope is authoritative when known?
what major parts and relationships matter?
what silhouette/depth/openings must be preserved?
what representation is appropriate?
what hierarchy/pivot/rig-readiness constraints already matter?
which images should be inspected for Geometry?
what is still unknown or blocking?
```

## Authority

```text
1. explicit current user requirement
2. approved visual reference
3. confirmed numeric / player-relative scale requirement
4. REFERENCE.json structured facts
5. GEOMETRY.md explanatory projection
6. downstream Codex interpretation
```

`GEOMETRY.md` must never introduce a fact absent from stronger authority.

## Conditional Voxel 3D Style-Lock Projection

When the current approved image or an established [Voxel 3D Style Bible](../art-direction.md#stylized-minecraft-voxel-3d--conditional-artist-style-bible) makes shape language relevant, project only the evidenced primary/secondary silhouette, focal landmark, negative space or intentional exaggeration into the existing Proportion & Silhouette / Representation Guidance sections. Preserve style_lock_id only if actually established for this asset family. Art direction does not determine hidden depth, numeric dimensions, Cube counts or approved proportions. Mark unknown source views honestly, and never add a second style field, ceremonial section or new REFERENCE.json schema.

## Canonical Section Order

Use only applicable sections, preserving this order for predictable scanning:

```text
# Geometry Reference

## Target
## Scale
## Primary Structure
## Proportion & Silhouette
## Attachment / Contact / Openings
## Representation Guidance
## Rig Readiness            ← only when materially relevant
## Geometry Constraints
## Visual References
## Unknowns / Blockers
```

Simple assets may omit sections with no material content.

## 1. Target

Required. One concise sentence describing the asset being built.

```markdown
## Target
Minecraft Bedrock farmer NPC carrying a back basket and using the approved harvesting tool.
```

Do not paste conversation history or compiled prompts.

## 2. Scale

Include whenever world/player scale or numeric envelope materially affects construction.

Use scale facts from `REFERENCE.json` without inventing conversion values.

Player-relative example:

```markdown
## Scale
- Player-relative: `PLAYER_HEIGHT`
- Numeric dimensions: unspecified
```

Numeric + relative example:

```markdown
## Scale
- Player-relative: `RIDEABLE_1P`
- Width: 1.5 Minecraft blocks
- Height: 1.8 Minecraft blocks
- Length: 2.4 Minecraft blocks
```

Rules:
- explicit numeric dimensions are numeric authority;
- player-relative scale communicates world/interactivity relationship;
- never infer exact block dimensions from image pixels or a relative category;
- never silently replace explicit dimensions with visually convenient values;
- `unspecified` means no numeric fact was confirmed;
- if numeric and player-relative scale materially conflict, mark the dependent Geometry decision `BLOCKED` rather than reconciling silently;
- do not invent per-part dimensions unless explicitly confirmed and materially required.

## 3. Primary Structure

List only decision-critical semantic assemblies, preferably using the same stable IDs as `REFERENCE.json`.

Example:

```markdown
## Primary Structure
- head
- torso
- pelvis
- left/right upper arms
- left/right lower arms
- hands
- left/right upper legs
- left/right lower legs
- feet
- straw hat
- back basket
- harvesting tool
```

Rules:
- semantic part identity, not Cube inventory;
- omit decorative micro-parts that do not affect form or later correction;
- preserve asymmetry explicitly.

## 4. Proportion & Silhouette

Describe only Geometry relationships that materially affect recognition.

Good content includes:

```text
whole-body/body-to-part ratios
major width/height/depth relationships
stance / body axis
wheelbase / occupancy / ground clearance when relevant
major taper / slope / curvature direction
identity-critical silhouette landmarks
```

Example:

```markdown
## Proportion & Silhouette
- Preserve the approved head-to-body ratio.
- Hat brim remains wider than the head and is a major silhouette landmark.
- Basket remains a distinct rear mass in side and 3/4 views.
```

Do not add aesthetic prose that cannot change Geometry.

## 5. Attachment / Contact / Openings

Describe topology and negative-space requirements.

```markdown
## Attachment / Contact / Openings
- Hat attaches to `head`.
- Basket attaches to the upper-back/torso region and must not float behind the body.
- Harvesting tool is owned by `right_hand`.
- Preserve the reference-visible gap between arm and basket.
```

Use for:
- parent/contact relationships;
- ground/support contact;
- intended open cavities;
- boundaries that must remain visually closed;
- articulation overlap/contact requirements;
- orientation that changes construction.

Do not invent hidden supports or internal structure.

## 6. Representation Guidance

Record only representation decisions that materially reduce ambiguity.

Allowed vocabulary:

```text
VOLUMETRIC_GEOMETRY
SEGMENTED_FORM
PLANE_LIKE
CROSSED_CUTOUT
LAYERED_CUTOUT
TEXTURE_ONLY
ANIMATION_ONLY
OMIT
UNRESOLVED
```

Example:

```markdown
## Representation Guidance
- Body, hat, basket and tool: `VOLUMETRIC_GEOMETRY`.
- Flat shirt markings: `TEXTURE_ONLY`.
- Thin basket strap: simplest supported representation; exact implementation remains a Codex decision.
```

Rules:
- guidance is a constraint/hint, not an implementation recipe;
- no fixed Cube count, exact coordinates, mandatory primitive count, or exact plane angle;
- insufficient evidence stays `UNRESOLVED`.

## 7. Rig Readiness

Include only when animation or articulation materially affects Geometry.

```markdown
## Rig Readiness
- Upper legs overlap the pelvis enough to avoid exposed hip gaps during intended swing.
- Shoulder attachment remains visually closed through expected arm range.
- Harvesting tool remains a separable motion participant owned by the right hand.
```

May describe:

```text
participating semantic parts
parent-child relationship
pivot region
axis intent / preferred axis when supported
bend direction when reference-critical
supported rotation envelope when explicitly evidenced
twist policy when materially constrained
overlap / coverage
clearance
attachment/contact invariants
deformation risk
```

Do not provide exact pivot coordinates or animation keys.

When a visible state or presentation context materially changes only one local form, describe the **smallest changed semantic branch** and preserve the unchanged base assembly. Examples include open/closed mouth, local accessory configuration, cargo/upgrade branch, or held/worn presentation. Do not turn a local state difference into a second full-model blueprint.

For moving attachment/reference points, record the owning semantic parent Group/Bone relationship. The downstream Locator should inherit motion from that animated parent; do not specify direct Locator keyframes.

## 8. Geometry Constraints

Keep only stable asset-specific correctness constraints not already expressed more clearly elsewhere.

```markdown
## Geometry Constraints
- Use the user-supplied harvesting tool; do not substitute a generic pickaxe.
- Preserve basket silhouette and attachment.
- Do not close reference-visible negative spaces with convenience geometry.
```

Do not repeat generic Modelling Skill rules.

## 9. Visual References

Required when packaged images materially constrain Geometry.

Refer to stable image IDs from `REFERENCE.json`.

```markdown
## Visual References
- `IMG_GEO_01` — primary whole-form authority.
- `IMG_GEO_02` — basket attachment detail.
- `IMG_RIG_01` — joint overlap / rig-readiness evidence only.
```

State why each image matters; do not redescribe every visible detail.

## 10. Unknowns / Blockers

Include whenever Geometry-relevant uncertainty remains.

```markdown
## Unknowns / Blockers

### Blocking
- None.

### Non-blocking
- Exact underside basket color is unresolved and does not affect Geometry.
```

Only Geometry-stage blockers belong here. A Texture-only unknown must not block Geometry.

## Profile Use

`GEOMETRY.md` may contain conclusions derived from one selected primary profile, but must not copy the profile itself.

```text
profile knowledge
→ asset-specific conclusion only
```

## Concision Rule

Prefer:

```text
stable semantic bullets
explicit relationships
short constraints
image-ID references
```

Avoid long prose, revision history, generic tutorials, implementation speculation, or repeated prompt wording.

## Never Include

```text
guessed Cube coordinates
fixed Cube counts
unverified part dimensions
exact UV islands
texture painting instructions
animation implementation keys
Tool-call sequences
MCP schemas
Blockbench API documentation
unsupported hidden geometry
conversation transcript
compiled-prompt history
```

## Adaptive Size

Simple asset:

```text
Target
Scale
Primary Structure
Representation Guidance
Visual References
Unknowns
```

Complex articulated asset may use the full canonical section set.

Do not inflate trivial assets into long documents.

## Correction Rule

A bounded user correction updates only affected Geometry guidance, image refs, blockers, and scale/proportion facts when applicable. Preserve unaffected accepted guidance.

## Completion

`GEOMETRY.md` is ready when:

```text
it agrees with REFERENCE.json and approved images
scale/world relationship is explicit enough for the next Geometry decision
numeric and player-relative scale do not conflict
Geometry-relevant parts/relationships are clear
representation ambiguity is reduced where evidence allows
articulation constraints appear only when needed
visual references are mapped by stable image ID
Geometry blockers are explicit
no Texture/Animation implementation detail leaked in
```

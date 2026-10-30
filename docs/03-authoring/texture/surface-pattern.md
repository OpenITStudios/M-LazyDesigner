# Surface Pattern Standard

## Purpose

`surface_pattern` describes **how a surface is visually painted** in the base-color texture. It is not a Minecraft render material, not a PBR Texture Set, and not geometry material-instance metadata.

Use it as an optional reasoning/pattern vocabulary for material-specific pixel-art treatment.

## Hard boundary

```text
surface_pattern
= RGB/value/detail language

render_profile
= how Minecraft renders the pixels

pbr_texture_set
= physical/data-map support

geometry_material_instance
= geometry metadata
```

Never infer one domain from another.

A surface can combine any compatible choices, for example:

```text
surface_pattern=clean_glass
render_profile=translucent

surface_pattern=painted_metal
render_profile=opaque

surface_pattern=painted_metal
render_profile=emissive_mask
```

The pattern name alone does not decide transparency, glow, culling, alpha semantics, or PBR.

## Canonical recipe library

`mcp/lib/textureSurfacePattern.ts` owns the compact typed recipe library. Recipes describe qualitative pixel language, not pre-generated bitmaps and not numeric quality targets.

Current vocabulary:

```text
wood_grain            painted_wood
brushed_metal         bare_metal          painted_metal
stone_cluster         concrete_speckle
cloth_weave           leather_wear
clean_glass           dirty_glass
plastic_clean         rubber_matte
organic_skin          fur_cluster
emissive_panel        energy_surface
```

Each recipe records:

```text
directionality
cluster_language
value_behavior
edge_behavior
secondary_detail
avoid[]
render_profile_inference = forbidden
```

The final field is a hard invariant: surface appearance never silently selects Minecraft render behavior.

## Representative treatments

### `wood_grain` / `painted_wood`

- directional cues follow construction grain;
- use irregular clustered runs instead of uniform stripes;
- painted wood remains paint-dominant, with underlying grain/wear only where supported;
- sparse knots/chips are secondary evidence, never a noise blanket.

### `brushed_metal` / `bare_metal` / `painted_metal`

- use clean hard clusters and deliberate value breaks;
- selective edge highlights communicate hard surfaces better than universal outlines;
- brushed metal may carry restrained directional streaks;
- painted metal exposes bare-metal language only at justified chips/edges/seams.

### `stone_cluster` / `concrete_speckle`

- stone uses irregular medium/large value islands;
- concrete keeps larger quiet fields with sparse grouped aggregate marks;
- avoid dense salt-and-pepper noise and wood-like directionality.

### `cloth_weave` / `leather_wear`

- cloth prioritizes fold/form readability with restrained contrast;
- weave hints appear only when physical texel density supports them;
- leather uses broad organic variation plus sparse crease/edge wear.

### `clean_glass` / `dirty_glass`

- keep the field visually quiet enough to read as glass-like surface treatment;
- use sparse reflection, smudge, dust, or structural-edge cues;
- transparency is never encoded by this pattern name—`render_profile` owns that decision.

### `plastic_clean` / `rubber_matte`

- plastic favors broad clean color masses and small selective highlights;
- rubber keeps a compressed darker range with subdued highlights and sparse molded detail.

### `organic_skin` / `fur_cluster`

- organic skin follows body/form and identity markings rather than mechanical panel language;
- fur clusters follow growth direction in grouped tufts, not single-pixel hair noise.

### `emissive_panel` / `energy_surface`

- `emissive_panel` describes visual RGB organization of a luminous-looking panel, not actual runtime glow;
- `energy_surface` uses purposeful flow/arc clusters rather than random electric noise;
- actual emissive behavior still requires an explicit `render_profile` such as `emissive_mask`.

## Reference-grounded selection

Before painting, build a compact region treatment plan:

```text
region
→ reference evidence state
→ surface_pattern
→ render_profile / minecraft_material_code
→ optional pbr_intent
→ identity colors / notes
```

`planTextureTreatment` owns this separation. Missing evidence remains `review_required`; it must not be filled by guessing from object/category names.

## Vanilla knowledge boundary

`textureVanillaKnowledge.ts` provides durable Minecraft/Blockbench texture principles and source categories without copying texture assets or requiring runtime network access. Use it to improve texture grammar, not to clone a Vanilla entity texture.

## Execution order

```text
reference/material cohort
→ treatment plan
→ BASE PASS
→ VALUE / FORM PASS
→ SURFACE PATTERN PASS
→ IDENTITY PASS
→ SECONDARY DETAIL PASS
→ RENDER / ALPHA VERIFY
→ seam/coverage review
→ mapped-model verify
```

Pattern recipes never override the existing anti-noise, anti-mixel, alpha, UV, seam, or evidence rules.


## Physical texel density and directional mapping preflight (2026-10-30)

`mcp/lib/texture/surfacePattern.ts::reviewTexturePatternPhysicalFit`
now reuses the existing canonical UV face→physical pixel grid mapping,
face-local rotation/flip and per-face physical Cube dimension logic. A
caller supplies the **required pixels per model unit** explicitly; the
17 qualitative recipes DO NOT invent one uniform minimum for weave, fur,
grain, metal or other styles. Non-integral/subpixel/out-of-bounds UV
boundaries, insufficient density and degenerate face sizes remain review
conditions, never silent upscale/repack actions.

For a directional motif, an explicit positive/negative atlas U/V axis
and intended positive/negative face-local axis are required. The helper
computes the real signed mapping across per-face UV reversal and
0/90/180/270-degree rotation. Unknown motif orientation or too few
face-local pixels stays `review_required`; the role labels themselves do
not prove which direction appears in a user's photo.

The existing `mcp/server/runtime/extensions/texture/authoring.ts` now
provides an **UNREGISTERED read-only** native consumer
`inspectTreatmentNativePatternPhysicalFit`. It reuses the existing
canonical complete face-treatment handoff recheck, exact Cube/face UUID
and `CubeFace.getTexture()` inventory verification. It reads currently
resolved UV corners, face rotation, texture pixel/UV dimensions and
Cube physical extents, rejects stale/foreign bindings, and reports
only a selected bounded face subset. Neither UV coordinates nor atlas
pixels are changed. No new public Gateway tools or native activation.

`metrics_consistent` certifies only internal numeric UV-grid and
caller-stated direction/threshold consistency: not a real reference
image motif/part correspondence, scene revision, texture bitmap content,
visual PASS, Minecraft renderer behavior or artist approval. Existing
source tests include flip, quarter-turn, insufficient density/subpixel,
missing direction, stale texture UUID and scope refusal; Bun, CI and
Blockbench-installed visual/Golden acceptance **NOT EXECUTED**.

### Multi-face native evidence readback

The unregistered, read-only pattern inspector now rechecks **every**
selected face after the full bounded batch, not just immediately after
each face. It pins Cube identity and exact `from`/`to` positions,
per-face UV/rotation/material name, selected Texture instance/UUID,
and native bitmap/UV dimensions. If a later native getter rewrites
an earlier face or moves a Cube without changing its size, the entire
batch fails with `TEXTURE_PATTERN_NATIVE_FACE_CHANGED_DURING_READ`.
Binding getters are evaluated before checking their own metadata, then
a metadata-only final sweep checks the entire selected batch again after
the last getter. This also rejects a last-getter mutation of an earlier
face. No native scene-wide revision, image appearance or user approval is
attested by this synchronous readback. Source regression definitions
cover both UV rewriting and same-size Cube translation; not executed.

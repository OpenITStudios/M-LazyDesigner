# Procedural Texture / Material Recipe Engine

Status: REMOTE SOURCE BOUNDED / LIVE PROOF PENDING
Updated: 2026-09-21
Branch: Local

## Goal

Replace stroke-oriented texture authoring with deterministic, bounded material intent:

```text
material/surface intent
→ base + seeded variation + optional directional shading
→ optional surface pattern
→ edge treatment / directional wear
→ palette/dither where compatible
→ affected-region planning
→ existing texture/paint/material ownership
```

## Current source foundation

- deterministic material surface profiles with explicit base color and bounded variation defaults;
- gradient/noise/palette/dither source generation;
- deterministic checker/stripe/panel surface patterns;
- edge-mask based treatment and directional wear;
- smallest changed-region detection;
- semantic PBR intent → existing Bedrock MER/color/subsurface values;
- painted-metal default uses dielectric metalness; exposed metal requires explicit authored channel/mask treatment;
- existing texture refinement compilation to `paint_texture_transaction.compute`;
- ROI metadata is emitted only through `compute[0].args.target_rect`;
- ordered palette dithering is rejected for bounded ROI because the existing runtime requires atlas-relative Bayer phase;
- no new public capability.

## Material shade relationship preservation (opt-in source implementation)

The existing `paint_texture_transaction.compute` gradient-map branch accepts
`source_ramp=[shadow,base,highlight]` in current atlas #RRGGBB alongside an
approved target `ramp`, `source_hue_color` and exact `target_rect` or
native `face_targets`. Mapping is piecewise by source Oklab lightness
(shadow→0, base→0.5, highlight→1), preserving material value roles rather
than assuming every painted region spans global black-to-white.
`protected_colors` retains up to 16 exact current-atlas identity RGBs.
Both options are opt-in; the prior generic gradient remains unchanged.
Compute preflight rejects missing source/protected samples in the current
selected visible pixels. This is **not** automatic material recognition,
a blank-atlas texture generator, or reference-to-model visual PASS.

The request still uses one existing compute operation, one native
`paint_texture_transaction`, exact material/UV/texture binding, revision
check, and Undo. Nested `compute[0].args` remains the same dynamic
record schema, so no new public Gateway capability or generated schema
surface is introduced. Selection ambiguity and source claims remain
with the current Texturing Skill and source/native evidence owners.

## Native ownership

```text
new texture source      → create_texture-compatible source path
existing texture refine → paint_texture_transaction.compute
PBR material            → create_pbr_material / configure_material
```

This layer does not create a visual node editor, second Painter, second bitmap transaction engine, background renderer, or material database.

## Benchmark rule

The source benchmark now measures an explicit-pixel authored-numeric-value proxy rather than invented brush-stroke payloads. It is not a wall-clock, token, compression, or visual-quality claim.

## Proof boundary

Native canvas/color-space behavior, PNG/source encoding, layer persistence, Undo/Redo, save/reopen, seam quality and accepted visual fidelity remain LOCAL_CODE/LIVE_BLOCKBENCH proof.

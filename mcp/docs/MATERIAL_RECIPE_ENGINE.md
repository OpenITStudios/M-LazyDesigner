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

## Reference-declared pixel cluster composition (source compiler)

`lib/texture/clusterComposition.ts`, reached through existing
`lib/texture/sourceComposer.ts`, compiles a bounded source-material
recipe containing:

- one current atlas UUID and exact decoded-RGBA revision;
- a current complete Cube-face/Texture inventory, signed physical UV,
  native rotation and declared source-image/region/part/observation;
- base, shadow, highlight, accent/identity/detail colors explicitly
  chosen from the approved art direction;
- face-local connected `rect` / row-span shapes plus intentionally
  quiet regions, with no procedural noise or speculative strokes.

The internal composer has two strictly distinct outcomes:

- **Initial paint:** blank-transparent or uniform-opaque templates only;
  exact `fill_rect` base plus face-local `set_pixels` clusters.
- **Focused correction:** `source_mode=existing_painted_patch` on an
  existing atlas; only exact `set_pixels`, with each cluster declaring up
  to eight existing opaque `expected_source_colors`. Current source RGBs
  must match every selected pixel, or no correction is compiled. All
  other pixels and the existing alpha remain unchanged.

Both reuse the same `paintTransaction` planner and bitmap oracle,
detect off-face writes, reject contradictory clusters and shared/overlapping
UV owners, and pin the exact full RGBA revision. They are not visual
recognition: source-palette and image/face claims are caller declarations.

**Native revalidation now source-authored:** The existing
`server/tools/paint/textureTransaction.ts` contains one shared native
transaction executor and an **internal, unregistered**
`executeNativeBoundClusterComposition` entrypoint. The internal path
reuses existing native face-scope inspection, checks the entire declared
Cube-face/UV/material/Texture inventory against the live scene, compiles
the source operation plan and checks a native snapshot repeatedly before
Undo, within `Texture.edit`, and before finishing Undo/optional PNG
publication. The ordinary public `paint_texture_transaction` schema,
compute routing, exact-operations behavior and Gateway remain unchanged.

**Availability boundary:** The internal entrypoint is not currently
reachable through `invoke_capability`; a trusted authoring owner must
serialize its invocation and authenticate actual approved reference image
bytes plus face correspondence. Never pass an unguarded source plan to the
ordinary public exact-operations branch and call it face-validated.
A native comparison or mutation receipt is not visual acceptance.
The normal direct known-pixel/paint-tool paths remain available.

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

# Texture Runtime Extensions

This directory owns post-registration Runtime augmentation for texture capabilities.

```text
quality.ts    quality/PBR-aware Runtime enrichment
authoring.ts  texture authoring diagnostics and Runtime enrichment
alpha.ts      render-aware alpha evidence enrichment
```

Base texture tools remain under `server/tools`. Extension composition and ordering remain owned by `server/runtime/extensions.ts`.

Historical `server/tools/texture-*-runtime.ts` paths are compatibility re-exports only. Do not add new implementation to those wrappers.


## Mutation ownership

`quality.ts` is diagnostics-only. It may enrich `list_textures`, but it must not wrap or replace material mutation behavior.

```text
texture-materials.ts + canonical PBR planner
→ configure_material
→ assign_texture_channel

runtime/extensions/texture/quality.ts
→ diagnostics only
```

Do not reintroduce a second mutation implementation in the Runtime extension layer.


`authoring.ts` may wrap `manage_material` only to augment the returned authoring status/workflow receipt after calling the original executor. It must not plan or apply PBR membership mutations.

## Seam diagnostic scope and omissions

`list_textures(diagnostics=true, diagnostic_scope="seam"|"full")`
retains bounded native *intra-Cube edge* sampling (64 successful faces,
up to four samples per edge). Its `seam_continuity.scan` now exposes
`coverage_state`, total eligible/scanned/unexamined textured faces,
bounded `cube_uuid + face + reason` omission examples and truncation.
Skipped animated, unmappable or budget-exhausted faces raise
`SEAM_SCAN_PARTIAL` in the existing advisory gate reasons.

`edge_samples_only` does not mean whole-face or model-wide visual
coverage; `partial` identifies omissions and `not_evaluated`
means nothing was sampled. `scene_coverage_attested=false`,
`cross_cube_sampling_attested=false`, and
`visual_verdict=not_evaluated` are permanent limits of this bounded
diagnostic. Do not infer visual PASS or join cross-Cube material seams
from coincident coordinates.

## Declared native cross-Cube seams (unregistered source)

The existing `authoring.ts` now exports
`inspectDeclaredNativeCrossCubeSeams(declarations, context?, alphaSemantics?)`
for a **read-only, unregistered** bounded diagnostic. Each explicitly
declared `cube_uuid + face + edge` carries
`continuity_intent`, `surface_id` and `material_id`. `REQUIRED`
needs non-empty, approved surface/material identity. Duplicate or malformed
declarations fail before sampling; no continuity is inferred from coincident
geometry, image color, Cube/Texture name or missing input.

The native source resolves face-local edge endpoints with the existing
`CubeFace.UVToLocal` helper, transforms them through the actual
`cube.mesh.matrixWorld` (including parent-group pivots), and derives the
world-facing normal from the validated affine Cube matrix. Reflected,
sheared, non-finite, missing or degenerate transforms are **not evaluated**.
Exact RGBA edge samples reuse the existing bounded diagnostic read context
and face pixel mapper; animated, untextured, one-texel or otherwise
unreadable faces generate bounded omission examples. The canonical pure
`analyzeCrossCubeSeamContinuity` then compares only physically coincident,
aligned, declared same-material and same-surface edge pairs.

This source remains **unwired** from production `list_textures`: the
latter keeps its stable intra-Cube response until a complete, generated
and accepted client declaration protocol is available. The new diagnostic
still returns `native_sampling_attested=false`,
`scene_coverage_attested=false`, and
`visual_verdict=not_evaluated`. Mock tests are NOT installed Blockbench
sampling or visual proof; the helper does not approve a texture.

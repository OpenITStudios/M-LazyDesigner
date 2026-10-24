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

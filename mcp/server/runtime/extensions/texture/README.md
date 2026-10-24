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
`continuity_intent`, `surface_id`, `material_id`,
`expected_texture_uuid` (from the resolved native `getTexture()`), and
`expected_native_material_name` (exact `CubeFace.material_name`, including
the empty default). `REQUIRED` needs non-empty surface/material identity.
The resolved texture object must also belong to the native
`Texture.all` inventory (and `Project.textures` when present). The declared
UUID and material name are compared with live native state both before and
after bounded edge sampling; foreign, stale or changed bindings raise
`CROSS_CUBE_NATIVE_BINDING_STALE` and are never analyzed as clean seams.
A raw `face.texture` reference alone is insufficient in single-texture,
per-group and override modes. Duplicate or malformed
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

The receipt exposes `binding_mismatch_count` and
`comparison_state=not_evaluated|partial|advisory_only`.
`texture_revision_attested=false` and
`material_approval_attested=false`: matching the declared native binding
is **not** proof that a human approved its semantic material identity or
that all pixels belong to one pinned atlas revision.

This source remains **unwired** from production `list_textures`: the
latter keeps its stable intra-Cube response until a complete, generated
and accepted client declaration protocol is available. The new diagnostic
still returns `native_sampling_attested=false`,
`scene_coverage_attested=false`, and
`visual_verdict=not_evaluated`. Mock tests are NOT installed Blockbench
sampling or visual proof; the helper does not approve a texture.

## Treatment-plan seam declarations (unregistered)

`lib/texture/treatmentPlan.ts` now accepts optional explicit `seam_pairs`
within a complete `required_faces` inventory. Each cross-Cube pair names
both Cube/face/edge endpoints, `continuity_intent`, `surface_id` and
`material_id`. `REQUIRED` also needs observed reference evidence,
compatible render material/PBR intent, and non-transparent face ownership;
unknown or mismatched data blocks treatment readiness.

The pure `buildTextureTreatmentCrossCubeSeamHandoff` checks **all**
planned face owners against resolved native Texture UUID and
`CubeFace.material_name` bindings; sampling only the convenient paired
faces is not enough. The unregistered read-only
`inspectTreatmentBoundNativeCrossCubeSeams` uses the current Cube/Texture
inventory and the existing cross-Cube sampler. For real Blockbench matrices,
`matrixWorld.elements` may be a `Float32Array` or `Float64Array`:
the projector now accepts exact 16-element typed arrays as well as ordinary
arrays, with the same affine and geometry checks.

No automatic continuity is inferred from neighboring Cubes or matching
colors. Readiness of a treatment plan is **not** user or visual approval.
**REQUIRED cross-Cube seams now require edge-specific reference observations.**
A pair must carry a `reference_observation` with bounded
`reference_id`, `reference_revision`, `observation_id`, and the
**exact two declared Cube/face/edge endpoints**. The observation is
still a caller declaration, not independently authenticated evidence.
A treatment region merely marked `evidence="observed"` without a
corresponding edge observation is no longer enough to make
`REQUIRED` continuity planning ready.

The canonical owner revalidates the *current* treatment result before
the native handoff reads any Cube/Texture data. This detects edited
`seam_pairs`, changed render/PBR fields, reassigned face ownership or
a removed observation after a prior `readiness.state="ready"`.
The handoff preserves a bounded `reference_observations` manifest with
`assertion_provenance="CALLER_DECLARATION_UNVERIFIED"`; it does not
invent user approval or treat a source label/revision as authenticated.

The handoff remains review-only with
`native_binding_attested=false`,
`material_approval_attested=false`,
`texture_revision_attested=false`,
`scene_coverage_attested=false`,
`visual_verdict=not_evaluated`. The existing registered
`list_textures` continues to report intra-Cube seams only until a
genuinely approved public declaration path and native evidence exist.

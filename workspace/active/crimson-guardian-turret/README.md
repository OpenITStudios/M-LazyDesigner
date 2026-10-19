# Crimson Guardian Turret

Current Stage: TEXTURING
Geometry: APPROVED
UV Layout: PASS
Texturing: READY_FOR_USER_REVIEW
Animation: NOT_REQUESTED
Known blockers: visual acceptance pending; in-game material/glow not verified
Current next step: Review detail-textured preview; earlier coarse texture was explicitly rejected.

## Current asset and deliverables
83 Cubes, 12 Groups, all Per-face UV; geometry unchanged during this texture correction. Working scale ~3–4 blocks, unseen rear simplified. Project UUID c4444389-ac95-b6aa-86bd-22478d94bb93.

- crimson_guardian_turret.bbmodel: current editable model with embedded detailed texture.
- crimson_guardian_atlas.png: current 256x256 atlas, byte-identical to embedded PNG.
- crimson_guardian_atlas_detail.png: same detailed atlas under its revision-specific name.
- crimson_guardian_turret_detail.geo.json: current Bedrock geometry/UV export.
- review/detail-textured-{front,back,front-left}.png: current mapped captures, Shading ON.
- review/texture-detail-verification.json: current UV, coverage, palette, surface and render evidence.
- before-texture-detail-correction.bbmodel / review/rejected-texture-v1.png: rejected version retained.
- reference/source.png / reference/REFERENCE.json: supplied two-view reference and structured facts.

## Texture correction — 2026-10-15
User rejected the first painted version as coarse, insufficiently detailed and untidy. A low 6x23 pixel allocation on the long tabard made its gold motif blocky. UV budget was redistributed within the same 256x256 atlas: long tabard front now 17x64, with more texels for face, chest, gold ornaments and crystal. Five editable material zones retained. Geometry was not enlarged or altered.

Representative cloth/helmet/chest/crystal patch inspected on mapped model before final propagation. Replaced repeated black armor bars and blanket square borders with broad satin-metal facets, sparse etched details, connected chevrons/diamond on cloth, asymmetric crystal facets, and subdued cuts in stone. 35 colors, 32163 painted mapped pixels; unused area transparent. Flat underside and covered core receive fewer texels; visible identity detail retained.

## Evidence and limits
Native UV audit ready: all 498 faces valid, in bounds, integer mapped, zero overlap or collapsed UV, autouv locked. Complete face coverage: 498/498, no omissions. Coverage still flags flat-face review; the explicit ledger classifies intentional undersides/slim trims separately from styled faces. Numeric variety does not imply visual quality. Bounded intra-Cube seam audit has no high-contrast or alpha-discontinuity candidates; cross-Cube continuity was visually reviewed. Native surface diagnostic reports zero z-fighting and no other bounded surface risks.

Current texture remains ready for user review, not user-approved. Captures use Blockbench textured/Shading ON preview, not Minecraft. No emissive render pack, animation, particles or sampler claim. Installed Gateway/matching TLS profile used; chat connector TLS mismatch is a separate issue. Old .geo.json and textured-* captures are superseded by the detail revision. No product source edits or GitHub publishing in this authoring step.

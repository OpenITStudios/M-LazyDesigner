# Geometry Decision Cases — G1 Pilot

Status: **SOURCE-FACTS-VERIFIED / DECISIONS PROVISIONAL**, 2026-10-29. These eight paired cases are *conditional advisory knowledge*, not templates, pre-approved model geometry, trained AI weights, or native/visual PASS. Each negative case is a hypothetical counterexample unless separately identified as observed. Only the referenced source *properties* have been checked; no matching asset/reference comparison has yet been executed.

**Authority:** [Geometry Standard](standard.md), [Modelling profiles](profiles/README.md), current user requirements, approved images and explicit dimensions. This file holds **case-specific discriminators only**, not a second modelling policy. Select a single case by the current semantic feature; do not preload the complete pilot during normal authoring. The validation owners and Runtime are unchanged. Source identifiers S1–S5 are resolved below; S1–S3 are pinned official geometry files, S4–S5 are live official documentation and **not immutable snapshots**.

## G-P01 Scale Cross-View Depth

- **Decision:** derive model proportions from confirmed numeric dimensions and genuinely comparable reference views, not uncalibrated image pixels.
- **Apply:** dimensions or world-scale constraints are explicit, and distinct source views agree on the part identity and intended depth.
- **Reject/defer:** a single perspective/front image provides no supported depth or conflicts with another view; preserve `UNAVAILABLE` / `CONFLICTING`.
- **Source evidence:** S1 `body` has size `[8,12,4]`, while `head` has `[8,8,8]`: different numerical depth relationships actually exist. S5 defines cube `origin` and `size` fields; neither source automatically calibrates an unrelated image.
- **Recipe decision:** retain dimensional constraints and primary-mass identity, but require current reference claim IDs before realizing specific placements.
- **Counterexample (hypothetical):** infer 4-unit depth solely because another skeleton example has that value.
- **Proof required:** reference-paired front/side/top as applicable, confirmed scale, Geometry bounds and current visual comparison; source facts alone cannot award PASS.

## G-P02 Primary Silhouette Mass

- **Decision:** place supported primary masses before attempting secondary decorative geometry.
- **Apply:** head/body/limbs or another dominant mass affects the visible silhouette or overall proportions.
- **Reject/defer:** a proposed tiny detail does not repair an incorrect primary outline, or visible identity requires a deliberately different stylized proportion.
- **Source evidence:** S1 separates head, body and limbs; S3 `body` is one `[24,24,64]` principal mass and `head` uses large masses. These are contrasting construction arrangements, **not** approved target ratios for other characters.
- **Recipe decision:** preserve the user/reference envelope; compare a coherent blockout first, then add only identity-bearing secondary structure.
- **Counterexample (hypothetical):** increase the number of face cubes on a model with an incorrectly sized torso.
- **Proof required:** matched silhouette and cross-view ratios, not raw cube count or coordinate-only similarity.

## G-P03 Protruding Form Versus Surface Marking

- **Decision:** use actual Geometry when a supported feature changes silhouette, material volume, contact or independent motion; send color-only marking to Texture.
- **Apply:** the approved reference shows a real protruding horn/armor plate/appendage or equivalent 3D role.
- **Reject/defer:** a stripe, seam, emblem or shading patch has no evidenced 3D contribution; choose `TEXTURE`, not filler cubes.
- **Source evidence:** S3 `head` contains multiple additional small Cuboids (including `[2,4,6]`), showing separate structural additions; their exact aesthetic role is not established by JSON alone. S4 assigns most surface detail to texture.
- **Recipe decision:** `THREE_DIMENSIONAL` with grounded geometry reasons -> `GEOMETRY`; supported `SURFACE_DETAIL` without 3D reasons -> `TEXTURE`; unsupported -> `REVIEW_REQUIRED`.
- **Counterexample (hypothetical):** interpret every bright trim line as a separate protruding Cuboid.
- **Proof required:** exact reference feature/view claim, independent 3D contribution, current front/side inspection and Texture handoff where applicable.

## G-P04 Sloped Form Versus Staircase

- **Decision:** consider one rotated Cuboid before approximating a material diagonal with many step-like Cuboids.
- **Apply:** a real slope is supported and the chosen transform remains valid in the intended Bedrock format.
- **Reject/defer:** the design intentionally requires stepped voxels, a rotated element fails the intended contour, or independent articulation requires meaningful segmentation.
- **Source evidence:** S4 explicitly favors economical shape depiction and warns against staircased slants and unjustified adjacent rotations for Vanilla-compatible aesthetics. S5 documents Cube `rotation` and `pivot`; this is format support, not proof that one rotated Cube fits every slope.
- **Recipe decision:** compare single-rotated and bounded-segment options; escalate only for material silhouette/contact difference.
- **Counterexample (hypothetical):** replace a deliberately stepped architectural feature with a smoothed diagonal.
- **Proof required:** side and 3/4 reference correspondence, pivot/orientation check and export compatibility.

## G-P05 Joint Pivot And Bone Parenting

- **Decision:** when motion ownership is supported, place the part under the correct parent and use the actual joint/hinge pivot.
- **Apply:** an articulated limb, panel, wing, jaw or linked mechanism is evidenced, with known attachment side/axis.
- **Reject/defer:** a bone name or mass center alone is used to guess a pivot; unknown hinge side and motion requirement must remain unresolved.
- **Source evidence:** S1 `rightArm` is parented to `body` with pivot `[-5,22,0]`; S2 `rightWingTip` is parented to `rightWing` with pivot `[-3.5,7,0]`; S5 defines bone parent/pivot semantics. These are factual model relationships, not evidence of any unseen animation pose.
- **Recipe decision:** separate linked transform owners only when necessary, keep attachment relation and do not author keyframes in Geometry.
- **Counterexample (hypothetical):** use object-name `door_y` to infer the hinge is always at its minimum-X face.
- **Proof required:** exact native parent/UUID identity, reference attachment, rest and relevant extreme pose clearance, and native export when required.

## G-P06 Negative Space Versus Painted Shadow

- **Decision:** preserve genuine openings and intentional empty space as topology rather than faking material depth with dark texture.
- **Apply:** comparable reference views show open space that changes the actual silhouette/depth or contact relationships.
- **Reject/defer:** a dark material patch or occlusion in one view does not prove a physical through-hole.
- **Source evidence:** S1 places `rightLeg` on X `[-3,-1]` and `leftLeg` on X `[1,3]` for Y `[0,12]`, leaving a geometrically unoccupied X interval between those limb Cuboids; **this only establishes authored cube coordinates**, not a full-scene rendered hole. S4 distinguishes model geometry from texture detail.
- **Recipe decision:** when source evidence confirms an opening, plan the boundary/structure; otherwise request a relevant side/back view.
- **Counterexample (hypothetical):** cut a hole into a chest plate because its texture shows a deep dark stripe.
- **Proof required:** source-compatible multi-view/occlusion evidence and relevant native contact/surface review.

## G-P07 Symmetry Versus Intentional Asymmetry

- **Decision:** use Recipe symmetry only for proven equivalent structural peers; keep their distinct identities and UV/rig policies.
- **Apply:** references establish equivalent left/right shapes and compatible attachment/transform roles.
- **Reject/defer:** differing armor, held item, asymmetrical anatomy or state-driven variant makes mirroring incorrect.
- **Source evidence:** S1 has `rightArm` and `leftArm` Cuboids of equal `[2,12,2]` size but different origins; `leftArm` declares `mirror: true`. **In Bedrock S5, `mirror` is a UV mirroring property, not an automatic Geometry symmetry constructor**; S1 explicitly contains both left/right bones.
- **Recipe decision:** declare symmetry relationship only with current feature evidence; `uv_policy`, `texture_policy`, and `rig_policy` remain independently reviewed.
- **Counterexample (hypothetical):** mirror an armored right arm onto a bare left arm, or assume UV mirror automatically creates an opposite Cube.
- **Proof required:** current left/right reference views, pair identities, shape/UV/rig comparison and asymmetry exception handling.

## G-P08 Thin Plane And UV Compatibility

- **Decision:** distinguish an intentionally plane-like zero-thickness carrier from a positive sub-unit Box UV Cube whose mapped face could collapse.
- **Apply:** thin sheet/wing/ear carrier truly needs no substantial volume; choose correct UV scheme for current Blockbench format and authored span.
- **Reject/defer:** an essential thick contact surface is flattened only to save cubes, or a positive fractional Box UV axis is silently treated as valid painted area.
- **Source evidence:** S2 `rightWing` uses size `[2,7,0]` and `rightEar` `[3,5,0]`; S3 wing membrane uses `[56,0,56]`. These are **valid source examples of one zero span**, not native UV-generation tests. S5 defines Cube UV variants. The *sub-unit Box UV guard* is an internal LazyDesigner geometry/UV contract in `standard.md`, not asserted as a universal Bedrock minimum Cube size.
- **Recipe decision:** preserve functionally necessary thin Geometry; use explicit Per-face UV when required, never automatically thicken a plane or discard a small 3D feature.
- **Counterexample (hypothetical):** apply a sub-unit Box UV rule to reject every zero-thickness foliage or wing carrier.
- **Proof required:** exact cube spans and UV mode, native template/face-pixel mapping, mapped texture and reference-based visual confirmation.

## Source Identity And Rights

| ID | Source identity and independently inspected fact scope | Usage boundary |
| --- | --- | --- |
| S1 | [Mojang Skeleton geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/skeleton.geo.json), Git blob `15ef729859c5cc243851baef8d26a9b6becc7879`; format `1.8.0`, bone/Cube/pivot/UV fields | Mojang-owned; reference interpretation only |
| S2 | [Mojang Bat v2 geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/bat_v2.geo.json), Git blob `3d9fab89583a940db57d12f0f7c99f1b7243cbaa`; format `1.12.0`, zero-span planes/wing hierarchy | Mojang-owned; reference interpretation only |
| S3 | [Mojang Ender Dragon geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/ender_dragon.geo.json), Git blob `c97d0bba20b3c965d3f184ce20`; format `1.12.0`, masses/jaw/wings | Mojang-owned; reference interpretation only |
| S4 | [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/), inspected 2026-10-29; no pinned immutable page revision | Advisory **only for Vanilla-compatible aesthetic goals**; reference summary, not asset dataset |
| S5 | [Microsoft geometry 1.21.0 schema](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/schemasreference/schemas/minecraftschema_geometry_1.21.0?view=minecraft-bedrock-stable), inspected 2026-10-29; documentation page may update | Bedrock field/format semantics; version-specific, not Blockbench native acceptance |

S1–S3 source facts were inspected at repository commit
`15701fa9c13923f12662984c32c124327e40e3d3`; file SHAs above
are **Git blob object IDs, not SHA-256**. The repository
[LICENSE](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/LICENSE.md)
states Mojang ownership and Minecraft EULA applicability; no sample files
are copied into LazyDesigner. S4/S5 are live documentation without
immutable source-content attestation and must be refreshed for a
version-sensitive implementation or new case promotion.

## Pilot Acceptance Boundary

All eight source cards have factual source references and explicitly
hypothetical rejection cases, but **no actual external positive/negative
visual acceptance experiment has run**. They remain `SOURCE-GROUNDED_CANDIDATE`
and cannot directly authorize any Recipe mutation. Use the existing
`mcp/lib/semantic/knowledge.ts` and `mcp/lib/authoringRecipe/` for
targeted retrieval and decision testing. Runtime currently indexes only its
bundled Bedrock workflow: these cards are **NOT yet installed Runtime
knowledge**. G1 proof requires deterministic source regression execution
on the exact commit; G2 requires wired verified on-demand retrieval without
generated-manifest hand editing; G3 requires live Blockbench and visual
comparison against identical approved references.

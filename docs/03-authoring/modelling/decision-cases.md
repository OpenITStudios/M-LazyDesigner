# Geometry Decision Cases — G1 Pilot

Status: **SOURCE-FACTS-VERIFIED / DECISIONS PROVISIONAL**, 2026-10-29. These eight paired cases are *conditional advisory knowledge*, not templates, pre-approved model geometry, trained AI weights, or native/visual PASS. Each negative case is a hypothetical counterexample unless separately identified as observed. Only the referenced source *properties* have been checked; no matching asset/reference comparison has yet been executed.

**Retrieval:** Optional **Problem signals** on selected G1 cases are curated phrases for finding advisory guidance, never proof of an asset's geometry, source-image observation or permission to mutate. Source/section hashing, applicability and visual acceptance still apply.

**Authority:** [Geometry Standard](standard.md), [Modelling profiles](profiles/README.md), current user requirements, approved images and explicit dimensions. This file holds **case-specific discriminators only**, not a second modelling policy. Select a single case by the current semantic feature; do not preload the complete pilot during normal authoring. The validation owners and Runtime are unchanged. Source identifiers S1–S5 are resolved below; S1–S3 are pinned official geometry files, S4–S5 are live official documentation and **not immutable snapshots**.

## G-P01 Scale Cross-View Depth

- **Decision:** derive model proportions from confirmed numeric dimensions and genuinely comparable reference views, not uncalibrated image pixels.
- **Apply:** dimensions or world-scale constraints are explicit, and distinct source views agree on the part identity and intended depth.
- **Reject/defer:** a single perspective/front image provides no supported depth or conflicts with another view; preserve `UNAVAILABLE` / `CONFLICTING`.
- **Source evidence:** S1 `body` has size `[8,12,4]`, while `head` has `[8,8,8]`: different numerical depth relationships actually exist. S5 defines cube `origin` and `size` fields; neither source automatically calibrates an unrelated image.
- **Recipe decision:** retain dimensional constraints and primary-mass identity, but require current reference claim IDs before realizing specific placements.
- **Counterexample (hypothetical):** infer 4-unit depth solely because another skeleton example has that value.
- **Proof required:** reference-paired front/side/top as applicable, confirmed scale, Geometry bounds and current visual comparison; source facts alone cannot award PASS.
- **Positive case (hypothetical):** Confirmed scale and compatible front/side views establish an asset-specific depth without copying a sample ratio.
- **Ambiguous case (hypothetical):** Perspective-only camera scale or inconsistent views leave depth UNVERIFIED; no guessed back volume.
- **Consumer / limit:** Reference Package constraints plus existing Geometry bounds/Recipe checks; neither a source JSON nor a name reconstructs missing depth.

## G-P02 Primary Silhouette Mass

- **Decision:** preserve supported primary silhouette masses and intended-size focal hierarchy before decorative Geometry (VC-FORM, GK-01).
- **Problem signals:** sofa backrest too flat; sandaran sofa terlalu pendek; weak main silhouette; boss focal silhouette unclear.
- **Apply:** approved views or dimensions identify a dominant head/body/backrest and deliberate proportion; a Style Lock contributes only compatible, reference-supported cues.
- **Reject/defer:** do not impose universal stylized ratios, invent unseen mass or add tiny Cubes to hide a wrong outline; approved exaggeration wins.
- **Source evidence:** S1 separates head/body/limbs; S3 has a [24,24,64] body and large head masses. These illustrate construction, not target ratios.
- **Recipe decision:** block out supported main masses and negative space; compare the silhouette at relevant size before secondary details.
- **Counterexample (hypothetical):** add stitches to a sofa whose main backrest is too low.
- **Proof required:** approved and current model paired views, scale, visual difference and human critique; Cube count cannot pass.
- **Positive case (hypothetical):** approved tall-back sofa outline reads correctly before fabric seams.
- **Ambiguous case (hypothetical):** one 3/4 concept cannot establish hidden depth; preserve visible form, defer unseen Geometry.
- **Consumer / limit:** existing Recipe, Modelling and visual review; retrieval cues are not reference evidence or authoring approval.

## G-P03 Protruding Form Versus Surface Marking

- **Decision:** use Geometry for supported silhouette/volume/contact/motion; paint a surface-only mark in Texture.
- **Craft cue (conditional):** raised bone/jaw/plate versus painted wear is decided by real source contour, not detail count (VC-FORM, GK-10).
- **Problem signals:** armor too many tiny cubes; surface cloth markings; decorative trim should be texture; painted stripe versus raised horn; raised armor mistaken for paint.
- **Apply:** approved reference shows a protruding horn, armor plate or other material 3D contribution.
- **Reject/defer:** stripe, seam, logo or highlight without 3D purpose stays Texture; missing depth evidence stays REVIEW_REQUIRED.
- **Source evidence:** S3 contains small head Cuboids, but their visual role is not proven by JSON; S4 distinguishes surface paint.
- **Recipe decision:** supported THREE_DIMENSIONAL reasons -> GEOMETRY; SURFACE_DETAIL -> TEXTURE; unknown -> REVIEW_REQUIRED.
- **Counterexample (hypothetical):** model every painted trim line as a Cuboid.
- **Proof required:** exact source view/feature claim, actual contour/depth, paired model views and Texture handoff.
- **Positive case (hypothetical):** a horn changes outer contour and needs volume; a painted stripe does not.
- **Ambiguous case (hypothetical):** a bright edge might be ridge or highlight: defer 3D without a comparable view.
- **Consumer / limit:** `mcp/lib/authoringRecipe/featureDecision.ts` reads explicit owner/evidence; no image inspection or automatic approval.

## G-P04 Sloped Form Versus Staircase

- **Decision:** consider one rotated Cuboid before approximating a material diagonal with many step-like Cuboids.
- **Apply:** a real slope is supported and the chosen transform remains valid in the intended Bedrock format.
- **Reject/defer:** the design intentionally requires stepped voxels, a rotated element fails the intended contour, or independent articulation requires meaningful segmentation.
- **Source evidence:** S4 explicitly favors economical shape depiction and warns against staircased slants and unjustified adjacent rotations for Vanilla-compatible aesthetics. S5 documents Cube `rotation` and `pivot`; this is format support, not proof that one rotated Cube fits every slope.
- **Recipe decision:** compare single-rotated and bounded-segment options; escalate only for material silhouette/contact difference.
- **Counterexample (hypothetical):** replace a deliberately stepped architectural feature with a smoothed diagonal.
- **Proof required:** side and 3/4 reference correspondence, pivot/orientation check and export compatibility.
- **Positive case (hypothetical):** Approved side/3/4 views show a genuine rigid slope; one valid rotated Cuboid preserves its contour.
- **Ambiguous case (hypothetical):** A stylized staircase, hidden contour, unknown joint or incompatible transform means no automatic one-Cube simplification.
- **Consumer / limit:** `mcp/lib/authoringRecipe/geometryCurves.ts` reviews supplied curve samples only; no inferred source shape or automated silhouette verdict.

## G-P05 Joint Pivot And Bone Parenting

- **Decision:** When articulation is supported, assign the Bone parent and use the actual joint/hinge pivot.
- **Problem signals:** door swings from center hinge; pintu berputar dari tengah; hinge pivot wrong side; arm pivot.
- **Apply:** Approved reference/requirement identifies moving part, attachment side, axis and parent; confirm current identities.
- **Reject/defer:** Name `door_y`, Cube center or Recipe `ANCHOR` cannot prove hinge side/pivot. Unknown motion remains unresolved.
- **Recipe decision:** `ANCHOR` is positional; `semantic_group` is not native Bone parenting. Preserve transform ownership; no Geometry-stage keyframes.
- **Proof required:** Inspect native parent/pivot IDs, reference-matched attachment, rest/extreme pose clearance and required export.
- **Source evidence:** S1 skeleton `rightArm` parent `body`, pivot `[-5,22,0]`; S2 bat `rightWingTip` parent `rightWing`, pivot `[-3.5,7,0]`; S5 Bone schema.
- **Positive case (hypothetical):** Confirmed hinge side/axis supports a panel Bone at the evidenced joint.
- **Counterexample (hypothetical):** Guessing a minimum-X hinge from `door_y` rotates around the wrong edge.
- **Ambiguous case (hypothetical):** Hinge/motion unseen: retain supported static shape; defer only joint/pivot.
- **Owner / consumer:** `standard.md`; `geometryAssembly.ts` read-only relations, `rig/semanticRig.ts` declared rig plan; native hierarchy tool executes.
- **Provenance / status:** S1/S2 pinned Mojang samples, S5 rolling schema; **CANDIDATE**. Bun/native/visual acceptance **NOT EXECUTED**.

## G-P06 Negative Space Versus Painted Shadow

- **Decision:** preserve genuine openings and intentional empty space as topology rather than faking material depth with dark texture.
- **Apply:** comparable reference views show open space that changes the actual silhouette/depth or contact relationships.
- **Reject/defer:** a dark material patch or occlusion in one view does not prove a physical through-hole.
- **Source evidence:** S1 places `rightLeg` on X `[-3,-1]` and `leftLeg` on X `[1,3]` for Y `[0,12]`, leaving a geometrically unoccupied X interval between those limb Cuboids; **this only establishes authored cube coordinates**, not a full-scene rendered hole. S4 distinguishes model geometry from texture detail.
- **Recipe decision:** when source evidence confirms an opening, plan the boundary/structure; otherwise request a relevant side/back view.
- **Counterexample (hypothetical):** cut a hole into a chest plate because its texture shows a deep dark stripe.
- **Proof required:** source-compatible multi-view/occlusion evidence and relevant native contact/surface review.
- **Positive case (hypothetical):** Front and side/back evidence confirms an opening with a true visible boundary and required clearance.
- **Ambiguous case (hypothetical):** A dark recess in one shaded view may be paint, occlusion or real depth; preserve uncertainty instead of cutting Geometry.
- **Consumer / limit:** `mcp/lib/geometry/surfaceEvidence.ts` reports bounded geometry observations, not an authenticated through-hole/visual PASS.

## G-P07 Symmetry Versus Intentional Asymmetry

- **Decision:** use Recipe symmetry only for proven equivalent structural peers; keep their distinct identities and UV/rig policies.
- **Apply:** references establish equivalent left/right shapes and compatible attachment/transform roles.
- **Reject/defer:** differing armor, held item, asymmetrical anatomy or state-driven variant makes mirroring incorrect.
- **Source evidence:** S1 has `rightArm` and `leftArm` Cuboids of equal `[2,12,2]` size but different origins; `leftArm` declares `mirror: true`. **In Bedrock S5, `mirror` is a UV mirroring property, not an automatic Geometry symmetry constructor**; S1 explicitly contains both left/right bones.
- **Recipe decision:** declare symmetry relationship only with current feature evidence; `uv_policy`, `texture_policy`, and `rig_policy` remain independently reviewed.
- **Counterexample (hypothetical):** mirror an armored right arm onto a bare left arm, or assume UV mirror automatically creates an opposite Cube.
- **Proof required:** current left/right reference views, pair identities, shape/UV/rig comparison and asymmetry exception handling.
- **Positive case (hypothetical):** Reference-matched left/right supports equivalent masses while keeping separate part IDs and independently reviewed UV/rig.
- **Ambiguous case (hypothetical):** Unseen opposite surface, decals or unequal functional joints make mirroring unverified until paired evidence exists.
- **Consumer / limit:** `mcp/lib/authoringRecipe/symmetry.ts` plans declared relationships; Bedrock UV `mirror` never duplicates a Bone/Cube.

## G-P08 Thin Plane And UV Compatibility

- **Decision:** distinguish an intentionally plane-like zero-thickness carrier from a positive sub-unit Box UV Cube whose mapped face could collapse.
- **Apply:** thin sheet/wing/ear carrier truly needs no substantial volume; choose correct UV scheme for current Blockbench format and authored span.
- **Reject/defer:** an essential thick contact surface is flattened only to save cubes, or a positive fractional Box UV axis is silently treated as valid painted area.
- **Source evidence:** S2 `rightWing` uses size `[2,7,0]` and `rightEar` `[3,5,0]`; S3 wing membrane uses `[56,0,56]`. These are **valid source examples of one zero span**, not native UV-generation tests. S5 defines Cube UV variants. The *sub-unit Box UV guard* is an internal LazyDesigner geometry/UV contract in `standard.md`, not asserted as a universal Bedrock minimum Cube size.
- **Recipe decision:** preserve functionally necessary thin Geometry; use explicit Per-face UV when required, never automatically thicken a plane or discard a small 3D feature.
- **Counterexample (hypothetical):** apply a sub-unit Box UV rule to reject every zero-thickness foliage or wing carrier.
- **Proof required:** exact cube spans and UV mode, native template/face-pixel mapping, mapped texture and reference-based visual confirmation.
- **Positive case (hypothetical):** Zero-span wing uses Per-face UV when needed.
- **Ambiguous case (hypothetical):** Unknown UV mode or thickness: defer flattening/paint.
- **Consumer / limit:** `mcp/lib/geometry/cubeSpan.ts` guards positive sub-unit Box UV only.

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
targeted retrieval and decision testing. The Runtime source already **Bun-embeds all eight G1 cases** with the existing
Bedrock workflow for **opt-in Recipe planning/inspection**, using
`mcp/server/runtime/recipes/authoring/knowledgeRuntime.ts` and bounded
source/section-hash guidance. This is G2 **source-level integration**, not
proof of an installed or visually correct model. Executed regression/Bun,
native Blockbench and same-reference G3 visual/quality acceptance remain
**NOT EXECUTED / UNVERIFIED**; no candidate is promoted.

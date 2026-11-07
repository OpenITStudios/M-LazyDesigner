# Visual Asset Expansion — Approved Product Contract

**Scope approved:** 2026-11-07. **Implementation:** incremental; individual entries are NOT production-ready merely because this document exists. Existing Bedrock Entity authoring remains the current default until each additional asset path is integrated and validated.

This is the durable product-contract owner for new visual asset families. Current progress/next action lives only in [next-action.md](../05-operations/next-action.md); commits own history. Do not create a second operations tracker, workflow engine, context router, or capability registry.

## Asset Profile architecture — source foundation

The canonical seven-identity Asset Profile contract lives in
`mcp/lib/product/assetProfiles.ts`, organized into `models_3d`,
`textures_2d`, and `visual_effects`. Its IDs are `entity`, `attachable`,
`custom_block`, `item_icon`, `animated_texture`, `player_skin`, and
`particle`. This is an **Asset Profile**, distinct from a modelling subtype
(`HUMANOID`, etc.), Runtime Registration Profile (`bedrock_entity` /
`extended`), Authoring Stage, Runtime Surface and Capability.

The source contract declares each profile's existing Entity-stage
applicability and intended output family. It does **not** establish native
registrations, a new Stage, a Blockbench project format, profile-specific
output acceptance, or production readiness. In particular, Skin UV, flipbook
timing, holder fit, custom-block compatibility and Particle authoring need
their own evidence even when a model-stage gate is `NOT_APPLICABLE`.
Source-only profile-aware lifecycle helpers preserve existing Entity
defaults; the current Reference Package/Control transport has no
authoritative new `asset_profile_id` selection and must not infer one from
the modelling `selected_profile`. Wire selection only as an atomic
generator/consumer/schema change with a verified Runtime output path.

## Product boundary

LazyDesigner extends its existing Geometry/UV, Texture/Painter/PBR, Animation/Rig and Particle authoring for *Minecraft Bedrock visual assets*. The original editable `.bbmodel` remains a valid output for model-based types, while 2D texture outputs retain their own Texture/Painter delivery boundaries.

- **Included:** equipment/attachables, custom block **visuals**, item icons/sprites, animated block textures, appearance variants, non-authoritative collision/selection previews, classic skins/wearable cosmetics, without any environment/biome visuals.
- **Excluded by user:** Sound/Audio, UI/HUD, and Fog/biome environment visual authoring. Fog/E1 was explicitly withdrawn because it is not part of the Blockbench asset-authoring workflow.
- **Excluded by architecture:** Behavior Pack mechanics, item effects/damage, crafting, mob AI, spawning, Script API, full Add-On/pack assembly, external arbitrary render/shader engines, and automatic gameplay state integration.
- **No implicit capability:** source planning does not mean a registered Runtime route or Minecraft compatibility proof. Never label unregistered `construct_geometry` or `manage_uv_layout` as production-ready.
- **Reuse native owners:** no second Geometry Engine, Texture Engine, Animation Engine, Particle Engine, Stage, Control router, Gateway service, or auto-generated Resource Pack system. The normal Gateway remains exactly four tools.

## Asset intent vs modifiers

| Profile intent | Core existing owners | Minimum output target | Required checks |
| --- | --- | --- | --- |
| **Entity** (current) | Geometry, Rig, Texture, Animation, Particle | Editable project; native geometry/animation where requested | Geometry identity, bone/UV/texture, visual QA, native export |
| **Attachable / Equipment** (P0) | Geometry, Locator/Bone, Texture, Animation | Editable model + exact holder/slot binding review; resource snippet only when separately approved | Player/holder pose, main/off-hand vs wearable fit, first-/third-person, bone identity, clipping and source bindings |
| **Custom Block Visual** (P0) | Geometry, UV, Texture, Material | Editable source if supported + Bedrock geometry/texture + compatibility report | target block `format_version`, culling, rotations, alpha, performance, geometry/material pairing |
| **Item Icon / Sprite** (P0) | Pixel Art Reference, Texture | Pixel-perfect PNG, atlas key and handoff reference | deliberate pixel grid, alpha, silhouette/readability at target size, stable identifier |
| **Animated Block Texture** (P1) | Texture and Pixel Art | Ordered frames + flipbook definition handoff | frame/tick order, source dimensions, seam, atlas target, version |
| **Classic Player Skin** (P2) | Pixel Art, Texture | Skin PNG and supported skin-metadata handoff | 64×64 layout where applicable, classic/slim arms, outer layers, UV identity |

**Cross-profile modifiers, not extra Stages:** appearance/texture/geometry variants; placement context; collision/selection bounds preview; export QA. None may silently promote source evidence to in-game proof.

## Implementation contract

1. **Authority:** original user intent and approved reference. When modelling, numeric requirements/real Minecraft unit dimensions and the target *Minecraft Bedrock resource format version* are explicit; Blockbench version is a separate compatibility dimension.
2. **Routing:** existing Control chooses the active GEOMETRY, TEXTURING, or ANIMATION specialist; profiles only supply task-specific rules and validation. No preload of all profiles. No new `REFERENCE.json` fields until the owning generator, consumers, semantic revision, and generated docs can move atomically.
3. **Native identity:** exact project/geometry, Group, Cube, Locator and texture IDs; ambiguous names, missing expected versions, unsupported format features, interrupted edits, and stale revisions fail closed before mutation. Reuse existing transaction/Undo/atomic-write owners.
4. **Version policy:** use one verified source owner per format rule, cite Mojang/Microsoft reference, distinguish retail vs experimental. Unknown target version or unverified feature must never imply READY.
5. **Non-3D outputs:** PNG/texture files are separate output types; exporting an Entity `.bbmodel` does not prove they are usable. Do not invent pack manifests, attachable JSON or gameplay definitions from incomplete evidence.
6. **Proof hierarchy:** SOURCE_AUTHORED / REGRESSION_AUTHORED_NOT_RUN / NATIVE_UNVERIFIED / MINECRAFT_UNVERIFIED. Actual game acceptance requires matching evidence and tested build, never an assumed PASS.
7. **Efficiency:** reuse inspected source identities and derived scene/UV evidence; validate only affected asset parts; optimize cost to accepted result, not model Cube count alone.

## Format compatibility — initial source floor

The first bounded implementation is `mcp/lib/bedrock/blockVisualCompatibility.ts`: a **pure, advisory custom-block declaration validator**, not a new MCP tool, Blockbench handler, schema generator, or export route. It supports explicit block `format_version`, geometry/material declaration pairing, and the retail feature thresholds below.

| Block visual/interaction feature | Initial minimum `format_version` | Reference boundary |
| --- | --- | --- |
| `minecraft:geometry` | 1.19.40 | Block geometry component |
| `minecraft:collision_box` | 1.19.50 | Single collision box |
| `minecraft:selection_box` | 1.19.60 | Selection outline |
| `minecraft:geometry.culling` | 1.20.60 | External culling definition |
| Paired `minecraft:geometry` + `minecraft:material_instances` | 1.21.80 onward | Both required if either is declared |
| `uv_lock` | 1.21.100 | Box UV square-face restriction still requires visual data |
| Multi-box collision without experiments | 1.26.0 | Preview does not create Behavior Pack collision |
| `culling_shape` | 1.26.30 | Requires a declared culling rule; custom/full-block constraints need future checks |
| `n_way_visual_rotation` | 1.26.30 | Visual-only rotation; does not rotate physical interaction |

The feature gate cannot verify actual geometry content, culling-rule files, UV squares, asset/resource references, Blockbench compatibility, or in-game rendering. No false safety claim may be derived from its successful source assessment. Further format rules should be added only at their owning feature implementation.

**Primary sources (Microsoft stable reference):**

- [Block geometry](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_geometry?view=minecraft-bedrock-stable)
- [Block collision box](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_collision_box?view=minecraft-bedrock-stable)
- [Block selection box](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_selection_box?view=minecraft-bedrock-stable)
- [Attachables](https://learn.microsoft.com/en-us/minecraft/creator/documents/attachables?view=minecraft-bedrock-stable)
- [Mojang Bedrock schema catalog](https://github.com/Mojang/bedrock-schemas/blob/main/catalog.json)

No package installation, bundled copies of Mojang assets, or live integration are authorized by these references.

## A1 — Attachable source binding ownership

The import-safe source owner is mcp/lib/bedrock/attachableBinding.ts. It is a pure planner over explicitly caller-supplied inventories, not a Blockbench binding executor, Resource Pack builder, or proof of Minecraft compatibility.

- Attachables default to an exact namespaced item identifier matching their own. A deliberately different item identifier requires `explicit_item_mapping: true` and returns `EXPLICIT_ITEM_MAPPING_NOT_COMPILED` for Resource Pack review; it is not a generated or verified item binding. Geometry identifiers must already be canonical. No guessed rename or fallback.
- Model bone UUID/name uniqueness, fully resolved parent chains, acyclic hierarchy, explicit selected target and top-level item-slot bone are mandatory. Holder bone inventory is only a caller assertion, not native evidence.
- For held main_hand/off_hand, the only automatic candidate is the official query q.item_slot_to_bone_name(context.item_slot). The specific slot is a preview intent. The resulting holder bone is chosen at runtime and has not been observed.
- Direct-holder-bone binding requires an exact bone name in the declared holder inventory, but returns a review-only result with no geometry-binding expression. This route needs combined holder rig, animation and parentage review.
- Wearable/armor/body slot fitting, first-person vs third-person alignment, native undo, pack JSON compilation, material/texture binding and actual Minecraft rendering are **NOT VERIFIED** and must be scoped to later authoring/native milestones. Never infer wearable slots from hand-only input.
- Source refs are untrusted caller claims. A SOURCE_SLOT_BINDING_PLANNED result is not approval or native readiness.

Primary sources: [Microsoft Using Attachables](https://learn.microsoft.com/en-us/minecraft/creator/documents/attachables?view=minecraft-bedrock-stable) and [Attachable Definition](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/attachablereference/examples/attachabledefinitions/attachable?view=minecraft-bedrock-stable).

## A2 — Contextual equipment preview evidence

The import-safe owner `mcp/lib/bedrock/attachableContextPreview.ts` is an **A2 source-only preview and claim-freshness planner**. It calls A1 on the underlying source inventory; an unverified client-supplied A1 summary is never sufficient. It binds an exact requested asset, holder, model bone, item slot, reference image digest, pose digest, holder/asset scene fingerprints, and expected installed Runtime build fingerprint into one immutable *planning handle*. Those inputs remain caller assertions until actual native observation.

- Every held-item context requires distinct **FIRST_PERSON**, **THIRD_PERSON_FRONT** and **THIRD_PERSON_SIDE** observations. Any omitted perspective is an incomplete claim; no camera angle, right/left item bone, pose transform or player-scale multiplier is guessed.
- The existing `capture_model_views` tool observes isolated model viewpoints. It is **not** a holder+equipment compositor or first-person item fitting tool. A2's planned `NATIVE_HOLDER_COMPOSITE_REQUIRED` path is not currently registered or executed. Do not reuse standalone Cube shots as if they proved a weapon's grip, silhouette or clipping on a player.
- The A2 source plan handle uses A1-validated canonical identities (`attachable-context-a2-v2`): bone/holder/source-ref inventory order and object property order cannot expire otherwise identical claims; changed bone ancestry, holder inventory, binding target, reference or build still invalidates captures. Previous source-only v1 handles intentionally become stale, not native-proven.
- A future holder-context native capture must match the exact plan, asset/holder/pose/Runtime-build/ref fingerprints, and all requested viewpoint images. Reported image hashes, handles and caller labels are **claims**, not an authenticated capture receipt or pixel review; even all-matched claims return **HUMAN_VISUAL_REVIEW_REQUIRED**, never a visual or Minecraft PASS.
- Direct holder-bone usage remains blocked on a combined-rig/parentage review, even when three image claims exist. Non-hand wearables and armor are intentionally not inferred from A1 hand-slot inputs and need their own source-backed target/preview contract.
- A2 does not mutate Blockbench, export an attachable, introduce a second renderer, add a new Gateway tool, or change any existing Camera/Geometry/Animation capability. Any real native integration must live with the current Camera/Runtime owner and retain its existing project/Undo semantics.

Official context: [Microsoft Using Attachables](https://learn.microsoft.com/en-us/minecraft/creator/documents/attachables?view=minecraft-bedrock-stable) (first-/third-person animation distinction, copy-bones limitations). Source evidence baseline: `mcp/server/tools/inspection/camera.ts`.

## B1 — Custom Block Visual source planning and advisory QA

The import-safe source owner is mcp/lib/bedrock/blockVisualPlanning.ts. It **consumes the existing F0** Bedrock format-compatibility assessment instead of duplicating minimum-version rules, and assesses exact caller-supplied custom-block geometry/material/culling/rotation declarations. It is NOT a native Blockbench tool, in-game visual preview, block Resource Pack compiler or automatic geometry optimizer.

- Inputs require an exact project UUID, namespaced block ID, canonical authored geometry ID, declared block format_version/features, bounded Cube inventory (UUID, bone, finite bounds, Box UV mode, optional rotation/inflate/visibility/export), block material instances, optional culling-rule claims, optional n-way rotation state and placement intent.
- B1 currently requires a real authored geometry.<name> inventory: Mojang built-in minecraft:geometry.full_block/cross use a separate geometry source model and are intentionally not misrepresented as authored Cubes.
- Source summaries report an *axis-aligned local coordinate envelope only*. They cannot attest rendered/world bounds when bones are parented, animated, rotated, inflated or have transforms not present in the input. Those require the existing Blockbench native inspection owner.
- Requested culling must name a rule with at least one declared bone/direction. Culling rule content is a caller assertion until the referenced Resource Pack file is read and verified. Custom culling_shape remains subject to F0 version and rule dependencies.
- UV lock with unequal Box UV dimensions is marked for review because only square Box UV faces are supported. No silent UV remap and no claim that a warning determines actual per-face coverage.
- Block material render methods are **not entity render profiles**. Non-opaque render methods trigger a render-distance review, not an automatic downgrade to opaque; unknown future methods require review.
- The official 50-Cube block-model guideline is advisory, with extra warning for repeated placement, not an automatic simplifier or a verified performance score.
- An authored inventory with no exportable Cubes is blocked even when editor-only Cubes exist. The official oversized-block 30-pixel span, ±30 local position and base-block overlap constraints are reviewed against exported source coordinates; because parent transforms/rotation are unobserved, these are advisory and never native or game conformance verdicts. Recognize all officially documented block material render methods, keeping unknown future values review-only. [Advanced Block Visuals](https://learn.microsoft.com/minecraft/creator/documents/customblockoversized); [Block material instances](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_material_instances?view=minecraft-bedrock-stable). Structural quality and intended details must remain intact.
- C1 collision/selection must not conclude that physical interaction lies within or beyond a rotated/inflated visual envelope until the transforms are resolved by native evidence. Disabled interaction remains unambiguously disabled. Only source-declaration compatibility can be blocked here; every otherwise valid assessment remains SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED. Source fingerprint records deterministic declared input identity but does not attest a live Blockbench scene, UV pixels, camera capture or Minecraft runtime.

Sources: [Minecraft block geometry](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_geometry?view=minecraft-bedrock-stable); [Block culling rules](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/definitions/blockculling?view=minecraft-bedrock-stable); [Custom block render distance](https://learn.microsoft.com/en-us/minecraft/creator/documents/customblockrenderdistance?view=minecraft-bedrock-stable); [Performance/resource usage](https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/improvingperformanceandresourceusage?view=minecraft-bedrock-stable).

## I1 — Item Icon & static Sprite source handoff

The source-only I1 owner is `mcp/lib/texture/itemIconPlanning.ts`. It consumes caller-provided RGBA8 bitmap samples and **reuses the existing** `mcp/lib/texture/pixelCraft.ts` cluster diagnostics. Pixel Art Reference continues to own actual artistic judgement, grid construction, palette, approved Style Lock and source-image interpretation; Texturing owns actual bitmap/PNG, texture inventory, atomic writes and atlas changes.

- Bind one exact namespaced Minecraft item ID, one `item_texture.json texture_data` key (namespaced or plain), and one canonical extensionless `textures/items/<name>` path. Reject traversals, aliasing, duplicate source inventory keys and creation collisions. There is **no** automatic pack mutation or inferred item registration.
- The supplied image must be complete row-major 8-bit RGBA with **exactly** `width × height × 4` samples; each component is an integer 0–255. I1 does not pretend these pixels are verified PNG bytes or that the image came from a native Blockbench Texture.
- I1 projects simple, objective pixel counts (visible/transparent/partial alpha, bounds, color count, hidden RGB) and reuses PixelCraft warnings for isolated pixels/color-cluster fragmentation. Warnings are **diagnostic**, not automatic source corrections, a quality score, native-size recognition, or approved pixel art.
- Explicit alpha intent, new-atlas-key collisions, and an output PNG path already claimed by a different atlas entry (extensionless or `.png` spelling) are source blockers. Existing keys may intentionally share a texture path; only creating another file at an occupied path is refused. This is declared-inventory safety, **not** a live filesystem existence check. Half-alpha fringes, palette complexity, border contact, non-square canvases and hidden RGB are warnings requiring actual visual context. Large icons whose exact craft scan exceeds the existing 16,384-pixel budget return the original `unavailable` evidence; no new scanning engine is created.
- The candidate `minecraft:icon.textures.default` points to the supplied atlas key; actual item format_version compatibility, Resource Pack texture registry, file existence, PNG encoding and Minecraft runtime all remain **UNVERIFIED**. It neither writes item JSON nor becomes a UI/HUD authoring system.
- Fingerprints distinguish bitmap byte changes, icon path/key and source/style claims; an internally consistent fingerprint alone does not attest visual appearance or an installed resource.
- Sources: [Microsoft Minecraft icon component](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_icon?view=minecraft-bedrock-stable); [Microsoft Custom Items](https://learn.microsoft.com/en-us/minecraft/creator/documents/addcustomitems?view=minecraft-bedrock-stable); [Pixel Art QA](../02-reference/pixel-art/qa.md); [Pixel Craft source](../../mcp/lib/texture/pixelCraft.ts).

## T1 — Animated Block Flipbook source and atlas integrity

The import-safe source owner is mcp/lib/texture/blockFlipbookPlanning.ts. It consumes explicitly supplied 8-bit RGBA pixels from one **vertical strip of square frames** and returns a non-writing candidate entry for textures/flipbook_textures.json. This is a Texture / Pixel Art handoff, not bone Animation, Particle animation, a Resource Pack compiler, a native Blockbench edit or an in-game animation.

- The strip is exactly frame_size pixels wide and frame_size × physical_frame_count pixels tall. Require two or more complete physical frames, strict row-major RGBA8 byte length, finite integer values 0–255, and bounded source work budgets. The 128-pixel frame, 128-frame, 262,144-pixel and 256-entry playback limits are **LazyDesigner source budgets**, not alleged limits of Minecraft Bedrock.
- The caller provides target Bedrock version, explicit frames (including valid repeated/reversed indices), ticks_per_frame (20 game ticks per second), blend_frames and optional replicate. Indices must refer to physical strip frames. Do not assume that animation uses every physical frame or that repetitions are errors; holds and cycles are supported in Vanilla.
- Atlas tile identity comes from the caller's declared terrain_texture mapping, not from a filename guess. If the tile uses several texture paths, atlas_index must be explicit. Same atlas tile/index/variant target cannot be silently overwritten by an existing flipbook. The atlas_tile_variant field is retained only with a warning because a flattened terrain texture path array does not verify a variation mapping.
- Capture a SHA-256 digest of the strip and each physical frame; the source fingerprint also includes timing, sequence, selected tile, relevant declared inventories and source/style claims. Raw end-to-start **visible pixel difference** is diagnostic, not proof of smooth looping, material consistency or actual animation quality. Hidden RGB under fully transparent alpha is not mistaken for visible seam change.
- No automatic PNG encoding, atlas writes, source conversion, texture resizing, interpolated animation rendering, Minecraft file IO or frame smoothing. Actual Texture/PNG source truth and revisions remain with the existing Texturing Runtime owner; Pixel Art reference/cluster/style QA remains with the Pixel Art Skill.
- All otherwise valid source results remain SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED. Missing texture file, source pixel provenance, exact atlas JSON bytes, frame-size compatibility on a particular Bedrock target, blending behavior, runtime quality and visual loop acceptance remain unverified.

References: [Microsoft Create an Animated Block Texture](https://learn.microsoft.com/en-us/minecraft/creator/documents/createanimatedblocktexture?view=minecraft-bedrock-stable); [Mojang Vanilla flipbook sample](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/textures/flipbook_textures.json); [Pixel Art Animation](../02-reference/pixel-art/animation.md); [Bedrock Wiki flipbook details](https://wiki.bedrock.dev/blocks/flipbook-textures.html).

## V1 — Entity Appearance Variant continuity (source-only)

The import-safe V1 owner is mcp/lib/texture/appearanceVariantContinuity.ts. It calls the canonical mcp/lib/texture/variantPlan.ts planner for create_texture(type=variant) instead of copying bitmap/TextureGroup logic. For render semantics it consults the existing entity material inspection owner in mcp/lib/texture/renderProfile.ts. There is NO second variant creation engine, Render Controller writer, or new Gateway tool. The existing source-wired `create_texture(type=variant)` executor is a distinct native authoring path, not proof that the full V1 Geometry/Material/rig variant profile is supported.

- This phase covers **Entity appearance variants**. Block terrain texture variations use terrain_texture.json variations/weights and are NOT the same mechanism; no block-variant / PBR compatibility claim is made from entity previews.
- One TEXTURE_ONLY variant must preserve the same exact geometry identifier, UV mapping fingerprint, bone UUID/name/parent/pivot inventory and Minecraft material code. The proposed bitmap dimensions must match the base-color source plan. Any drift is an explicit source blocker, not silently recategorized or auto-remapped.
- MATERIAL_CHANGE retains Geometry, UV and rig continuity but may change the Minecraft entity material code only through a distinct declared render-material slot; existing inspectEntityRenderMaterialCode reports unknown custom materials as unverified. It does not create material configs or claim real alpha/PBR rendering.
- GEOMETRY_OVERRIDE must have a **new distinct** Geometry identifier and render Geometry slot. Changed UV/rig are accepted for **review only**, not claimed compatible with clips/locators/attachments, nor substituted for the original base geometry. Material changes also need a dedicated material slot.
- Caller-supplied SHA-256 UV identity, bone inventories, source refs and render slot names are declaration evidence only. V1 validates exact identity and acyclic bone ancestry, including pivots, but cannot prove actual native Blockbench scene/atlas pixels, render controller selector/index or cross-animation compatibility.
- Output includes a bounded source fingerprint and candidate Texture./Material./Geometry. symbolic references, NOT an executable Render Controller or Molang selector. Real entity variant selection needs a separately reviewed client_entity/render_controller resource binding through existing owners. Behavior Pack properties, triggers and gameplay remain excluded.
- Existing Runtime `mcp/server/runtime/contracts/texture.ts` now performs source/variant RGBA byte reconciliation, native Cube face-UV snapshot continuity, exact project/group/UUID/size checks and precommit Undo ownership checks for `create_texture(type=variant)`. The supplemental `variant_native_continuity` receipt is linked by `mcp/lib/receipts/textureCreation.ts` and remains scoped **to creation-time Runtime observations**; it is not a persistent revision, image similarity score, or full V1 Geometry/Render Controller approval.
- Regardless of source consistency, the separate full V1 planner verdict remains SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED. The Runtime path is source-wired but Bun/Blockbench/native image review/Resource Pack/in-game rendering must not be inferred as PASS without matching execution evidence.

References: [Microsoft render controller arrays](https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationrendercontroller?view=minecraft-bedrock-stable); [Microsoft Client Entity JSON](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/entityreference/examples/cliententitydocumentation/cliententitydocumentationintroduction?view=minecraft-bedrock-stable); [Bedrock Wiki block texture variations](https://wiki.bedrock.dev/blocks/block-texture-variation).

## C1 — Block-local Collision & Selection advisory

The import-safe C1 source owner is `mcp/lib/bedrock/blockInteractionBounds.ts`. It consumes the existing **B1** custom-block visual source and passes derived interaction features through **F0** for version validation (including the new, distinct 1.26.0 extended-collision-height check). It does not create Behavior Pack components, change Blockbench scene state, run gameplay physics, raycast a cursor, or verify collision/selection in Minecraft.

- The visual comparison is solely against B1's declared **local Cube envelope**. It is **not** a rendered-world bounding volume, especially for Group transforms, rotation, inflation, animation, or block-permutation states. All results retain NATIVE_UNVERIFIED and MINECRAFT_UNVERIFIED.
- Collision and selection must remain separate. Omitted components default to full 16×16×16, explicit true means full, false disables that individual interaction, and a custom object specifies origin and size in block-local model units. C1 accepts up to 16 explicit collision boxes but rejects empty arrays rather than silently interpreting them as disabled/full.
- Selection supports one box, with x/z in [-8,8] and y in [0,16]. Collision supports the same base limits; for newer versions the collision upper Y limit is 24. Both are bounded source policy, not claims about every experimental preview format. Origin/size are compared via [min,max] local AABBs; nonfinite, reversed, negative-size or out-of-range coordinates fail before any preview/report.
- Collision-array syntax and upper Y beyond 16 are distinct features gated by F0 at format_version **1.26.0**. Exact block version is supplied by the caller; no duplicate version table or game-format auto-promotion is created. Selection arrays are not accepted as supported declarations.
- Reports distinguish disabled interaction, absence of usable visual bounds, within/envelope-exceeding bounds, and differences between collision and selection. A union AABB of several collision boxes is **not** proof that the occupied shape fills that envelope, physically collides, or has appropriate player targeting.
- A C1 source fingerprint binds B1's source identity to normalized collision/selection definitions. It does not replace B1's model UV/rigger or source approval, and the planner never writes a component to the Behavior Pack or promotes source comparison into a Minecraft runtime result.
- Microsoft references: [Collision Box](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_collision_box?view=minecraft-bedrock-stable) and [Selection Box](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_selection_box?view=minecraft-bedrock-stable). Supplemental domain examples: [Bedrock Wiki Block Components](https://wiki.bedrock.dev/blocks/block-components).

## S1 — Classic Player Skin source UV and alpha review

The import-safe source owner is `mcp/lib/texture/classicSkinPlanning.ts`. This is a **modern 64x64 classic Bedrock skin** planner only, not a player Entity/Attachable renderer, Persona/Character Creator implementation, or skin-pack compiler. The 64x32 legacy and 128x128 Bedrock HD dimensions are valid distinct formats deliberately deferred until separate layout proofs exist.

- Input includes an explicitly selected Steve wide (4-pixel arms) or Alex slim (3-pixel arms) body profile; the corresponding skin metadata geometry is **exactly** `geometry.humanoid.custom` or `geometry.humanoid.customSlim`. A texture PNG alone does not determine the arm model; the selected profile is a caller declaration.
- A complete, exact 64x64 RGBA8 buffer and a root-level lowercase PNG filename are required. The candidate `skins.json` entry includes caller-supplied `localization_name`, `geometry`, `texture` and access `type` (free/paid). It also returns the expected localization key for downstream handoff. **No PNG encoding or pack files are written.**
- The six canonical parts (head, body, right/left arms, right/left legs) are evaluated as **actual Box UV face rectangles**, not entire 2D bounding regions. Base/overlay layer alpha counts are kept separate; headwear, jacket, sleeves and pants overlays may be transparent without failing source admission. An opaque or partly transparent base is not automatically judged by Java rules; any missing/partial base skin coverage requires Bedrock visual review.
- Slim arm UV width is 3 pixels at Mojang's standard arm atlas origins; painted columns unused by the slimmer net receive a warning. A painted pixel in an unused atlas region is diagnostic, not proof of any rendered error. Any fully empty mapped skin or duplicate declared localization entry is a source blocker.
- The existing Texture `analyzeTexturePixelCraft` owns pixel-cluster diagnostics and is reused unchanged. A full-sheet noise/cluster report never establishes player skin quality, orientation, correct pose, material interpretation or source-image fidelity.
- SHA-256 identity covers raw bitmap bytes and declared skin metadata, profile, Style Lock and existing skin inventory. Texture filename reuse may be intentional for wide/slim pairs and is a **review warning**, not an automatic rejection; localization identities must remain unique.
- All otherwise valid results remain `SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED`. Source UV maps come from Mojang's example geometry but do not certify native Blockbench orientation/outer layer visibility, PNG contents, in-game transparency thresholds, player-fitting, or skin pack installation. This work does not introduce any new Gateway tool, UI/HUD authoring, Sound/Audio feature, Character Creator customization or pack packaging.

References: [Microsoft Skin Pack JSON Reference](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/skinpacksreference/skinpackjsonreference?view=minecraft-bedrock-stable), [Microsoft Packaging a Skin Pack](https://learn.microsoft.com/en-us/minecraft/creator/documents/packagingaskinpack?view=minecraft-bedrock-stable), [Mojang humanoid.custom wide and slim UV data](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/models/mobs.json), [Pixel Art QA](../02-reference/pixel-art/qa.md).

## Milestone acceptance contract

| ID | Deliverable | Completion criteria before production claim |
| --- | --- | --- |
| **F0** | Product boundary + source format gate | One durable scope owner; pure block-format compatibility with positive/negative regressions. Source complete does **not** mean native accepted. |
| **A1** | Attachable binding/fitting source owner | Exact holder/slot/bone input and fail-closed source review; reuses Geometry/Locator/Animation, no guessed animation or fabricated attachment transform |
| **A2** | Contextual attachable preview | First-/third-person and wearable checks using actual native model/approved reference; receipt tied to project/scene/build |
| **B1** | Block visual planning & QA | Target-format gates consumed by exact block authoring owner, culling/rotation/alpha and repeated-placement review, not a fake entity-only export |
| **I1** | Icon/sprite authoring path | PNG/atlas ID and pixel-grid quality contract; integrates Pixel Art reference with Texturing, no second UI/HUD system |
| **T1** | Animated block flipbook | Frame/tick mapping and atlas resource integrity, distinct from Particle/rig animation |
| **V1** | Appearance variants | Strict texture/geometry/bone mapping continuity and deliberate variant bindings |
| **C1** | Collision/selection preview | Honest geometric comparison with no gameplay collision claim; version aware |
| **S1** | Classic skin and cosmetics | Classic/slim and outer-layer UV proof, separate from wearables |

For each milestone: define its nearest source owner and narrow tests, pin an exact `Local` SHA, preserve existing capability semantics, record actual verification class, and update the **single** current continuation owner. Finish complete independently coherent source units while executable testing remains unavailable. Generator-coupled feature registration is deferred rather than partially written.

# Visual Asset Expansion — Approved Product Contract

**Scope approved:** 2026-11-07. **Implementation:** incremental; individual entries are NOT production-ready merely because this document exists. Existing Bedrock Entity authoring remains the current default until each additional asset path is integrated and validated.

This is the durable product-contract owner for new visual asset families. Current progress/next action lives only in [next-action.md](../05-operations/next-action.md); commits own history. Do not create a second operations tracker, workflow engine, context router, or capability registry.

## Product boundary

LazyDesigner extends its existing Geometry/UV, Texture/Painter/PBR, Animation/Rig and Particle authoring for *Minecraft Bedrock visual assets*. The original editable `.bbmodel` remains a valid output for model-based types, but not every 2D texture or fog profile must be forced into a Blockbench Entity project.

- **Included:** equipment/attachables, custom block **visuals**, item icons/sprites, animated block textures, appearance variants, non-authoritative collision/selection previews, classic skins/wearable cosmetics, and later limited environment visuals.
- **Excluded by user:** Sound/Audio and UI/HUD asset authoring.
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
| **Environment Visual** (P2/P3) | Texture and Bedrock visual compatibility | Fog/biome visual intent and reviewed resource handoff | scope support, resource identity, fog priority and platform compatibility |

**Cross-profile modifiers, not extra Stages:** appearance/texture/geometry variants; placement context; collision/selection bounds preview; export QA. None may silently promote source evidence to in-game proof.

## Implementation contract

1. **Authority:** original user intent and approved reference. When modelling, numeric requirements/real Minecraft unit dimensions and the target *Minecraft Bedrock resource format version* are explicit; Blockbench version is a separate compatibility dimension.
2. **Routing:** existing Control chooses the active GEOMETRY, TEXTURING, or ANIMATION specialist; profiles only supply task-specific rules and validation. No preload of all profiles. No new `REFERENCE.json` fields until the owning generator, consumers, semantic revision, and generated docs can move atomically.
3. **Native identity:** exact project/geometry, Group, Cube, Locator and texture IDs; ambiguous names, missing expected versions, unsupported format features, interrupted edits, and stale revisions fail closed before mutation. Reuse existing transaction/Undo/atomic-write owners.
4. **Version policy:** use one verified source owner per format rule, cite Mojang/Microsoft reference, distinguish retail vs experimental. Unknown target version or unverified feature must never imply READY.
5. **Non-3D outputs:** PNG/texture and fog files are separate output types; exporting an Entity `.bbmodel` does not prove they are usable. Do not invent pack manifests, attachable JSON or gameplay definitions from incomplete evidence.
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

- Attachables must use an **exact** namespaced item identifier matching their own; geometry identifiers must already be canonical. No guessed rename or fallback.
- Model bone UUID/name uniqueness, fully resolved parent chains, acyclic hierarchy, explicit selected target and top-level item-slot bone are mandatory. Holder bone inventory is only a caller assertion, not native evidence.
- For held main_hand/off_hand, the only automatic candidate is the official query q.item_slot_to_bone_name(context.item_slot). The specific slot is a preview intent. The resulting holder bone is chosen at runtime and has not been observed.
- Direct-holder-bone binding requires an exact bone name in the declared holder inventory, but returns a review-only result with no geometry-binding expression. This route needs combined holder rig, animation and parentage review.
- Wearable/armor/body slot fitting, first-person vs third-person alignment, native undo, pack JSON compilation, material/texture binding and actual Minecraft rendering are **NOT VERIFIED** and must be scoped to later authoring/native milestones. Never infer wearable slots from hand-only input.
- Source refs are untrusted caller claims. A SOURCE_SLOT_BINDING_PLANNED result is not approval or native readiness.

Primary sources: [Microsoft Using Attachables](https://learn.microsoft.com/en-us/minecraft/creator/documents/attachables?view=minecraft-bedrock-stable) and [Attachable Definition](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/attachablereference/examples/attachabledefinitions/attachable?view=minecraft-bedrock-stable).

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
| **E1** | Limited environment visuals | Fog/biome visual constraints; only formats officially supported at implementation time |

For each milestone: define its nearest source owner and narrow tests, pin an exact `Local` SHA, preserve existing capability semantics, record actual verification class, and update the **single** current continuation owner. Finish complete independently coherent source units while executable testing remains unavailable. Generator-coupled feature registration is deferred rather than partially written.

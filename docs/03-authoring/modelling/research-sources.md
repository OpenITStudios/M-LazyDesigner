# Geometry Intelligence — Curated Research Sources

Status: **RESEARCH CURATION ONLY** (2026-10-29). This is a conditional
reference catalog under the existing Modelling owner, **not** runtime
knowledge, a new data store, a Model Training corpus, or proof of improved
asset quality. Follow [knowledge-curation.md](knowledge-curation.md) for
case acceptance and [geometry-intelligence-plan.md](geometry-intelligence-plan.md)
for the implementation boundary. Normal authoring does **not** load this file.

## Selection method

A source earns promotion to a source-grounded **decision candidate** only if
it answers one concrete authoring uncertainty, has verifiable provenance
and applicable target constraints, gives a distinct positive/negative
case, and is not already fully covered by `standard.md`/the selected
profile/Recipe. Preserve version and license differences between software
code, publications, model weights, datasets and third-party assets.

Source classes:
- `NORMATIVE_BEDROCK`: official Bedrock format/compatibility authority.
- `CANONICAL_EDITOR`: actual Blockbench native source/behavior, subject to
  version and runtime proof.
- `RESEARCH_CONCEPT`: useful paper/algorithm idea; **not** an implementation
  ready to use or license to import code.
- `EXTERNAL_EXAMPLE`: another project's self-reported behavior; comparison
  requires independent matched-input benchmarking.
- `RESTRICTED_DATA`: rights and purpose must be reviewed before download,
  copying, ingesting or model training.

## A. Adopt first as decision knowledge (P0)

| ID | Source (checked 2026-10-29) | Extract only | Existing LazyDesigner owner | Evidence boundary |
| --- | --- | --- | --- | --- |
| S01 | [Microsoft geometry 1.21.0](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/schemasreference/schemas/minecraftschema_geometry_1.21.0?view=minecraft-bedrock-stable) | Bone parent, pivot, Cubes, rotation, UV fields and version constraints | `authoringRecipe/compiler.ts`; native export/UV owners | `NORMATIVE_BEDROCK`; compare target runtime/version; no inferred artistic PASS |
| S02 | [Mojang Bedrock Samples](https://github.com/Mojang/bedrock-samples/tree/15701fa9c13923f12662984c32c124327e40e3d3) | Actual source anatomy, part identity, relative transforms and exception examples | Modelling profile + `decision-cases.md` | `NORMATIVE_BEDROCK` samples; Mojang EULA, **reference only**, no source model copying |
| S03 | [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) | Silhouette first; detail vs texture; justified rotations and carriers | `standard.md` and `featureDecision.ts` | Style advice **only** for matching art direction, not all fantasy models |
| S04 | [Blockbench source](https://github.com/JannisX11/blockbench) and [API](https://web.blockbench.net/docs/) | Native Cube/Group/codec, transform, Undo/selection, save/export behavior | `mcp/server/tools/**` and native authoring adapter | `CANONICAL_EDITOR`; installed version-specific, not proven from documentation |
| S05 | [ShapeAssembly paper](https://doi.org/10.1145/3414685.3417812), [project](https://rkjones4.github.io/shapeAssembly.html) | Cuboid proxies, surface attachment, hierarchy, symmetry, editable parameters | `authoringRecipe/constraints.ts`, `symmetry.ts`, `components.ts` | `RESEARCH_CONCEPT` **only**. [Code license](https://github.com/rkjones4/ShapeAssembly/blob/cc22bd84afb65e8e37c7d14bebd9a4a629b5d943/LICENSE) excludes commercial incorporation without permission; do not copy code |
| S06 | [StructureNet](https://github.com/daerduoCarey/structurenet/tree/80e79c0536f43b55966415fc1e6e9cafc8ff6701) | Part hierarchy and typed structural relations, distinct from geometric proximity | Selected Modelling profile + Recipe feature relationships | `RESEARCH_CONCEPT`; repository code MIT, dataset/model rights **separate** |
| S07 | [PartNet](https://partnet.cs.stanford.edu/) | Hierarchical part names, parent-child composition and part-instance distinctions | Reference structured facts + Modelling profiles | `RESEARCH_CONCEPT`; published dataset is not permission to copy/ingest |
| S08 | [Houdini Sweep](https://www.sidefx.com/docs/houdini/nodes/sop/sweep.html) | Centerline, varying cross-section, orientation/twist and sampling | `authoringRecipe/patterns.ts` with existing Cube construction | `RESEARCH_CONCEPT`; **do not** promise mesh Sweep in Bedrock; require source-grounded segmented Cuboid approximation |
| S09 | [Fine-to-Coarse Cuboid Abstraction](https://doi.org/10.1111/cgf.70344) (2026) | Multi-resolution primitive candidates and cost-vs-shape-fidelity tradeoff | `geometry/modelQuality.ts`, `surfaceEvidence.ts` and Recipe alternatives | `RESEARCH_CONCEPT`; no fixed Cube target, AI weights or automatic simplification |
| S10 | [Orca img2blockbench](https://github.com/orca-gamedev/img2blockbench/tree/315fff912f83a9923e954ff6c596c00dc9832fa3) | Direct Cuboid vs mesh-guided approaches, reproducible output artifacts and audit ideas | Existing Recipe conceptual comparison only; no Knowledge benchmark during research | `EXTERNAL_EXAMPLE`; repository code MIT but reported metrics are **not** LazyDesigner measurements, asset rights separate |

All P0 entries are **selected for study/adaptation**, not automatically
validated production rules. The first four are highest priority because
Bedrock/native constraints control whether any proposal is executable.

### Artist-oriented composition sources — AD-01/AD-02 (2026-10-31; research-only)

These first-party pages were inspected for the **stated artistic reasoning**, not for transferable Hytale tools, model files, default proportions, texture densities, or claims of LazyDesigner quality. Their content is rolling/unpinned, and all example artwork remains with its creator.

| ID | Publisher source | Observed source-level guidance | Conditional LazyDesigner use / exclusion |
| --- | --- | --- | --- |
| ART-01 | [Hytale art director: Making Models for Hytale](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale), published 2025-12-22 | Style pillars emphasize recognizable simplified shapes, distinctive stylization and consistency; details are added where needed for readability | Evaluate deliberate identity-bearing masses and clean blockout; **do not** transfer Hytale's renderer, export, fixed texel ratios, geometry limitations, or proportions into Bedrock |
| ART-02 | [Riot Games Character Art](https://www.riotgames.com/en/artedu/character-art) | Character translation from 2D into 3D requires recognizable proportions, likeness and readability even at small in-game presentation size | Consider proportional and silhouette decisions only when an approved target view/scale supports them; not a universal character template |
| ART-03 | [Riot Games Portfolio and Reel Suggestions](https://www.riotgames.com/en/portfolio-and-reel-suggestions) | Recommends process sketches, multi-angle rationale, compelling silhouettes and areas of detail versus areas of rest | Treat focal hierarchy/detail restraint as **review questions**; portfolio evaluation advice is not a numeric art score or approval of any source model |

**AD-01 — Focal hierarchy (hypothesis).** On an approved current reference, name one observable identity-bearing focal feature *only when the image actually supports it*. Before secondary Geometry or mapped Texture detail, compare whether the current model preserves the same visual emphasis in a compatible neutral presentation. Positive candidate: a dominant head/crest/crystal is still readable while nonfocal surfaces remain quieter. Reject: adding evenly distributed spikes or bright trim merely to make every part detailed; refuse to infer intrinsic focal color from cinematic bloom. Ambiguous: one dramatic source image, occlusion or incompatible pose/camera → `UNVERIFIED`. Owner: existing Geometry primary-form review / Texture material-region review; no automatic recipe, symmetry or paint mutation.

**AD-02 — Practical-scale silhouette (hypothesis).** Inspect the current shaded view at a realistic intended viewing scale, with an equivalent-scale reference when available, **in addition to** the native full-resolution check. Positive candidate: the required primary silhouette and identity landmarks remain distinguishable. Reject: a large render looks intricate but the target becomes unrecognizable at actual presentation size. Ambiguous: unknown target scale, different framing/camera, intentional stylized contour or missing actual reference image → `UNVERIFIED`. Owner: [Visual Validation](../validation/visual.md); not a fixed pixel-size limit, visual score, new Runtime capture tool or research-to-test trigger.

**Research-only requirement:** study multiple quality-selected works, capture what is observed versus inferred or UNKNOWN, and synthesize positive/negative/ambiguous artistic principles before proposing new rules. No source/model generation, native check or Golden benchmark is required or requested during research; any future adoption or non-Golden evaluation needs separate authorization. These advisory cases are **not** extra G-P01–G-P08 index sections and are not installed source knowledge for normal Gateway/Codex clients. Review counts and art appeal remain unmeasured.

## B. Secondary concepts to evaluate after a demonstrated gap (P1)

| ID | Source | Narrow question | Decision |
| --- | --- | --- | --- |
| S11 | [Blender Geometry Nodes 4.5](https://docs.blender.org/manual/en/4.5/modeling/geometry_nodes/introduction.html) | Can revisions preserve parameter relationships without destructive reauthoring? | Reuse Recipe incremental rebuild; do not add a node graph |
| S12 | [OpenUSD composition/reference](https://openusd.org/release/intro.html) | Can reusable asset branches/variants preserve identity without duplicating geometry? | Apply only to existing semantic assets/components; **not** USD conversion |
| S13 | [meshoptimizer](https://github.com/zeux/meshoptimizer) | What shape/attribute discontinuities must simplification preserve? | Review constraints, not direct triangle-mesh simplification of Bedrock Cubes |
| S14 | [3D-GPT](https://arxiv.org/abs/2310.12945) | How can instruction interpretation be separated from parameter extraction/execution? | Existing Control → Recipe → Runtime owners; no separate agent system |
| S15 | [ShapeMOD](https://rkjones4.github.io/shapeMOD.html) | When does a repeated group of shape operations justify a reusable macro? | Extract repeated need before extending existing Recipe patterns; license review on source |
| S16 | [PartNet-Mobility](https://huggingface.co/datasets/sapien-sim/PartNetMobility) | What joint/hinge/sliding semantics are useful for articulated props? | `RESTRICTED_DATA`; approval/terms required, **not** a ready dataset |
| S17 | [MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) | Does an internal Recipe feature require a new external protocol capability? | **No** by default: retain existing four Gateway tools and authoring lifecycle |
| S18 | [OpenSCAD manual](https://openscad.org/documentation.html) | When can reusable CSG abstractions express constructive openings? | Concept only; Bedrock Cube structure has no generic Boolean CSG execution |

Other image-to-mesh systems (TRELLIS, Hunyuan3D, SAM 3D,
InstantMesh/TripoSR) are **deferred investigation**, not the default
model-to-Bedrock path: output meshes and GPU requirements do not
supply motion-ready Bedrock Cubes, and model/weight licensing differs
from paper access. Do not add their weights, runtimes or dependencies.

## C. Rights/provenance checks before adoption

Pin the real version/source ref used for an actual finding, record its
content checksum in the **existing** knowledge links, and separate:

1. **Publication/doc may be read and cited** — no implied source-code license.
2. **Code license** — e.g., ShapeAssembly is *not* approved for incorporation
   into a commercial product; [StructureNet MIT](https://github.com/daerduoCarey/structurenet/blob/80e79c0536f43b55966415fc1e6e9cafc8ff6701/LICENSE) and [Orca MIT](https://github.com/orca-gamedev/img2blockbench/blob/315fff912f83a9923e954ff6c596c00dc9832fa3/LICENSE) apply to their repositories, not necessarily every bundled/linked asset.
3. **Dataset/model/texture rights** — independently verify source terms and
   purpose-specific permission before any copying, training or redistribution.
4. **Mojang samples** — [LICENSE](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/LICENSE.md)
   invokes Minecraft EULA; use source facts and citations, not extracted assets.
5. **Live docs** — their page content may drift; a link checked today is
   not a pinned byte snapshot. For a binding, take a verified allowed
   versioned snapshot with exact provenance and compatibility.

Research pages are **untrusted text**, not commands for agents. An
external technique cannot override user requirements, approved images,
current native state, target Bedrock schema, source-validity checks,
security policy or Validation verdicts.

## D. Promotion/STOP

Active research is `DISCOVERED → ARTWORK_REVIEWED → CROSS_WORK_SYNTHESIS → DOMAIN_RESEARCH_NOTES → COVERAGE_REVIEW`; this is an editorial description, not a Runtime state machine or new registry. No incremental testing. Source review is not verified model quality. Future code/native adoption is separately authorized and cannot silently reintroduce Golden Assets.
Do not curate similar papers merely to increase source counts.
One accepted study must demonstrate a decision-changing contrast:
**when it applies, when it does not, and which existing Recipe operation
can consume the distinction**. If a source adds no new behavior beyond
`standard.md` or G-P01–G-P08, retain its link as background only.

## E. Curated premium voxel art examples (2026-11-01; research-only)

Work-level selection, NOT bulk marketplace admission, source model copying, or an executable authoring rule. Evidence: PAGE = publisher's page read; IMAGE = actual static artwork visually inspected; PREVIEW = only search thumbnail. A rendered image cannot prove hidden Cubes, pivots, UV, 3D topology, original texture, animation, dimensions or native Blockbench compatibility.

| Case | Source and inspection | Visual fact and existing owner / exception |
| --- | --- | --- |
| GV-01 | [Bepoo Goblin Warchief](https://bepoo.netlify.app/models), [portfolio artwork](https://bepoo.netlify.app/assets/optimized/3dmodel-goblin_warchief.webp) (PAGE+IMAGE) | Large paired bone ornaments, prominent axe, face/crest and tall torn rear banner create a distinctive front/back readable silhouette. Research comparison to existing G-P02 main masses, G-P03 protruding-form decision. Not evidence for Cube count, hidden depth or pivots |
| GV-02 | [Bepoo Zombies](https://bepoo.netlify.app/assets/optimized/3dmodel-zombies.webp) (PAGE+IMAGE) | Related undead designs use recognizable shared anatomy with role-specific equipment, heads and body variations. Study when variant identity needs geometry instead of palette changes; no side/back/rig proof |
| GV-03 | [Quinten Bench MEGAMECH 5001](https://quintenbench.wixsite.com/rizaan/overlords) (PAGE+IMAGE) | Massive legs, mechanical armament, armor masses and crew cockpit have a visible scale/functional hierarchy. Mechanical-profile candidate; cinematic lighting may hide neutral-view complexity |
| GV-04 | [Bepoo Haunted Furnitures](https://bepoo.netlify.app/assets/optimized/3dmodel-haunted_furnitures.webp) (PAGE+IMAGE) | Board, bookshelf, television, covered furniture and doll communicate recognizable functions with differing complexity. Prop-furniture profile candidate; no demand for boss-level geometry or inferred concealed faces |
| GV-05 | [AnyVoice Yeti artwork](https://x.com/AnyVoice_/status/1829225842922188869) (PREVIEW) | Horns, wide body and high-contrast extremities communicate identity with fewer shapes. A complex creature does not have to be ornate. Original page/native asset NOT INSPECTED |

Positive research probe: a selected model retains its source-supported silhouette and focal accessory when compared with an approved multi-view reference at equal neutral scale. Negative: micro-Cubes hide broad errors or painted shapes replace clearly volumetric required forms. Ambiguous: one cinematic view, incompatible scale, occlusion or unknown depth; abstain. **Separate visual families:** battle-worn fantasy, mechanical, prop/furniture, simplified creature. No universal proportions or detail density. Existing standards/profiles/G-P01–G-P08 remain authoritative; nothing promoted.

Rights: creator-owned artwork is link/citation only. No license for source-model/texture copying, dataset ingestion, mass scraping or AI training established. No actual .bbmodel, native test or human visual acceptance.

## F. Comparative artist field study — broader quality-selected cohort (2026-11-01; RESEARCH ONLY)

**Purpose.** Broaden beyond the first five examples to contrasting humanoid, animal, boss, mechanical, prop, weapon and vehicle idioms. Study the *individual visual result*, never admit a whole store or make visual quality a numeric score. Source depth: IMAGE = actual publisher/work image viewed; PAGE = original work listing read; THUMB = limited original thumbnail or third-party indexed image only; FORMAT = publisher-reported file attributes, not file inspected. No original .bbmodel, source asset/UV, live viewer interaction, animation playback or installed Bedrock work is implied.

### F1. Selected works and discriminating form observations

| ID / family | Work and source — actual evidence | Observable shape decision (not a copied design) | Limit, rejection or conditional suitability |
| --- | --- | --- | --- |
| GV-06 / cartoon boss | [DepartmentQDE, Yeti Boss](https://mcmodels.net/products/15711/yeti-bosss), [front + side image](https://api.mcmodels.net/storage/product-images/15711/01KFESC5Y12NMEMQ8PQX4V92WW.png) (PAGE+IMAGE) | Torso/shoulders wider than pelvis; long, heavy arms frame short legs; paired horns and muzzle create a readable personality. Publisher's side view gives extra evidence of forward head/body projection | The blue/purple ice-family character is not interchangeable with user's grim Warchief. Two rendered angles still leave actual Cube depth, rig and UV UNKNOWN. A 16 texture-resolution listing is not a model-shape criterion |
| GV-07 / small personality creature | [Logan Kant, Raccoon Trader](https://blockbenchworkshop.com/model/logan_kant/raccoon-trader) (PAGE+IMAGE thumbnail) | Outsized face/muzzle, flat broad merchant hat, feather, scarf and small paws concentrate narrative into recognizable focal parts. Creator describes body about half a Steve tall | Distinct cute/adventure style, not an ornate boss template. Workshop reports 29 elements/19 bones; neither is a quality quota, and movement was not observed |
| GV-08 / non-humanoid fantasy | [Logan Kant, Ender Whale](https://blockbenchworkshop.com/model/logan_kant/ender-whale) (PAGE+IMAGE thumbnail) | Elongated whale outline, multi-flipper topology, forked tail and stepped back establish a different species grammar from bipeds; creator explicitly describes six eyes and three flipper pairs | Very dark body on black thumbnail makes practical-size silhouette/texture readability uncertain. CONCEPT shortlist, not confirmed premium visual exemplar without better neutral view |
| GV-09 / compact domestic props | [Fullcourse Store, Cozy Bamboo Furniture](https://mcmodels.net/products/15738/cozy-bamboo-furniture-dyeable), [full product sheet](https://api.mcmodels.net/storage/product-images/15738/01KFS1D6NJ1XFR0BQDQ811NKMN.png) (PAGE+IMAGE) | A shared woven frame treatment survives beds, table, sofa, chair, partition and light fixtures, but each piece preserves its functional negative spaces (seat opening, leg clearance, screen divide) | Do not normalize a furniture cohort to creature/armor detail levels; lighting and atlas still unknown. Product states 14 models, not evidence of asset completeness |
| GV-10 / ornamental equipment family | [BasModel, Thai Lotus Guardian](https://mcmodels.net/products/12092/thai-lotus-guardian), [promotional set image](https://api.mcmodels.net/storage/product-images/12092/01J2661MB4NG5BYS0GJMAH5QQ7.png) (PAGE+IMAGE) | Related weapons/equipment repeatedly echo leaf/diamond contours and dark shaft + green gem motifs. This is cross-object motif continuity rather than identical form | A busy promotional composition makes independent silhouette judgements and matching actual weapon scale difficult. Prefer single-asset isolated views before treating one member as exemplary |
| GV-11 / dark mechanical creature | [Nitgo, Dread](https://www.planetminecraft.com/blog/dread-3d-model-block-bench/), [project preview](https://i.imgur.com/n7f3XuU.png) (PAGE+IMAGE from original post / indexed preview) | Long angular shell/chassis, separated hanging appendages, protruding back ridge and negative gaps suggest a clear sci-fi insect language; small cyan tips act as secondary landmarks | Dark-on-dark depiction and glow cannot prove shape in neutral conditions; animated GIF on post was not accessible. External art must not be copied |
| GV-12 / functional transport | [Pabilo8, Motorbike](https://sketchfab.com/3d-models/motorbike-94dfaf195d554f2c9d72e350cd5a5ac2) (indexed source IMAGE; model page unavailable) | Paired wheels, front fork, handlebar/headlight, body frame and engine block remain functionally identifiable despite chunky stylization | 3D source page returned restricted access; model depth, moving components and license UNKNOWN. Treat as a lower-confidence vehicle candidate, not mechanical-reference authority |
| GV-13 / precision small prop | [Violet, Nintendo DS Lite](https://blockbench.net/gallery/) (official selected gallery PAGE+IMAGE) | Clamshell upper/lower planes, separated dual screen apertures, hinge silhouette, side stylus and small button layout convey an exact object without creature-style ornament | Gallery recognition is not Bedrock format proof; static posed open state does not demonstrate hinge articulation or animatable pivots |
| GV-14 / character set | [Bepoo, Samurai Models](https://bepoo.netlify.app/assets/optimized/3dmodel-samurai_models.webp) from [author portfolio](https://bepoo.netlify.app/models) (PAGE+IMAGE) | Horned samurai and plated shoulders are deliberate focal elements; the same thematic set has distinct armor/creature/weapon silhouettes | Composite contains different assets and photographic presentation treatments. Do not claim one common pixel density or per-asset quality from the montage |
| GV-15 / small interactive game prop | [Bepoo, Fun Furnitures](https://bepoo.netlify.app/assets/optimized/3dmodel-fun_furnitures.webp) (PAGE+IMAGE) | Oven cavities, grill legs, serving tray, hanging lamp and jukebox remain identifiable through functional geometric features; low complexity is appropriate for some items | The pack's mixed stylistic complexity and small thumbnail visibility require individual item curation. Do not assume all pieces are equally premium |
| GV-16 / comic animal prop | [Logan Kant, Crab Sailor](https://blockbenchworkshop.com/model/logan_kant/crab-sailor) (PAGE+IMAGE thumbnail) | Strong crab shell/claw outline plus tilted cap and bottle create personality through a few landmarks, distinct from boss-style armor | Creator lists 72 elements/54 bones and 8 clips, but no native file or clip was opened. Count alone is not evidence of artistic or rig quality |
| GV-17 / organic-pattern boss | [Lanostry, Kraken for Bosses Rise](https://x.com/lanostry/status/2057545217721442546) (original link identified, indexed IMAGE; original social page blocked) | Broad central head plus alternating thick and thin curling tentacles; large red-white ornamental patches provide coherent motif hierarchy across organic form | Only a public image preview was accessible. Strong visual candidate, but creator post, multi-view and rights not independently readable; confidence below PAGE+IMAGE |
| GV-18 / reconstructed franchise object (hold) | [Polyjo, Redstone Golem](https://blockbenchworkshop.com/model/polyjo/redstone-golem-minecraft-dungeons) (PAGE+IMAGE thumbnail) | Low element count with massive main body/arms; cracks and strong red features make form recognizable in a tiny thumbnail | Author says nearly 1:1 re-creation of official Minecraft Dungeons model. The uploader's CC BY field is not evidence of ownership of original franchise design; exclude from source copying/training and prefer original designs for master references |
| GV-19 / scene, not isolated asset (hold) | [Blockbench Gallery, 5.0 splash-art winner](https://blockbench.net/gallery/) (official PAGE+IMAGE) | Cinematic giant robot and hangar show world-scale staging and lighting composition | Great showcase art is not automatically a high-quality editable Bedrock Entity benchmark: isolated neutral geometry, texture and rig are not separately shown |

### F2. Synthesis across individual artworks (hypotheses, not production rules)

- **Identity hierarchy rather than fixed complexity:** GV-06 and GV-07 communicate species/personality through main body ratio + face/accessory; GV-09 through functional silhouettes; GV-11 through appendage layout. Source-specific questions should precede detail work. Complexity is an outcome of subject, not a merit score.
- **Protrusion versus painted mark:** Horns, claws, chair openings, vehicle forks and weapon blades carry three-dimensional silhouette/clearance meaning; armor scratches, cushions, fabric print and small labels may live in mapped texture. Borderline cases depend on current approved view, not a generic cube-count threshold.
- **Narrative accessories:** Warchief banner/axe (previous cohort), trader hat/backpack, samurai horns and DS stylus make a subject identifiable. A secondary accessory need not be proportionally large, but must be represented by the correct semantic part, parent and visibility.
- **Silhouette confidence is view-sensitive:** GV-06 has front and side; GV-08/GV-17 are difficult against dark backgrounds or single-angle media; GV-10 is a montage. Do not infer invisible topology from these.
- **Visual-family separation:** gritty/battle-worn monster, saturated fantasy creature, cozy woven props, precision electronics, mechanical sci-fi and whimsical mascots have incompatible detail rhythms even when each is well executed. One global Style Lock or ratio would misrepresent the research.
- **Reject low-value proxies:** screenshots with excessive bloom, intricate background, high marketplace prices, vast model/animation counts, popularity and "AAA" labels are neither sufficient nor required for excellent voxel geometry.

### F3. Source permission and evidence discriminators

[Ender Whale](https://blockbenchworkshop.com/model/logan_kant/ender-whale), [Raccoon Trader](https://blockbenchworkshop.com/model/logan_kant/raccoon-trader) and [Crab Sailor](https://blockbenchworkshop.com/model/logan_kant/crab-sailor) display uploader-declared **CC0**, but the site says creator ownership is an unverified attestation. [Dead Traveler](https://blockbenchworkshop.com/model/polyjo/dead-traveler-skeleton) displays **CC BY 4.0** with attribution; [Redstone Golem](https://blockbenchworkshop.com/model/polyjo/redstone-golem-minecraft-dungeons) uses the same badge while acknowledging franchise reconstruction. [Lion Turtle](https://blockbenchworkshop.com/zh-Hans/model/zombieaddons/lion-turtle) is listed All Rights Reserved. These license labels belong to specific uploads and do not automatically authorize AI-training, automated acquisition, extraction of franchise IP, model reuse across packs, or redistribution. No model source has been downloaded or added to this repository.

**Research scope only:** Source artifact fidelity, source multi-view, face-level geometry, UV, pivot/bone hierarchy and executable behavior remain UNKNOWN. Capture original links and visual facts, keep a deliberate shortlist plus borderline/exclusions, and continue searching for independent high-quality art rather than triggering any generator test.

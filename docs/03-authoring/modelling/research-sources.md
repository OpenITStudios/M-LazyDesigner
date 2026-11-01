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

## G. Third cohort: original art, source structure and independent curation (2026-11-01; RESEARCH ONLY)

Work-level curation: original artwork is judged separately from whether an artist publishes a model file or whether a marketplace advertises many bones/animations. PAGE=original work page read; IMAGE=static visual examined; META=publisher metadata (not inspected file); SOCIAL-IMAGE=original artist image located but social page itself inaccessible. No external model or source texture imported; no native Blockbench, test or Golden Asset.

| ID and work | Observed source and form | Select/reject boundary |
| --- | --- | --- |
| GV-20 [Naldo, Anglerfish Remake](https://x.com/Naldo_Nerdlo/status/1331197958193377280) (SOCIAL-IMAGE) | Same artist sheet shows multiple 3D views and flat painted texture representation. Elongated body, oversized toothed jaw, fins, tail and lure identify subject. | **High-priority cross-domain anatomy/painting study**, not inspected original geometry, exact UV map, bones or texture file. Never reproduce original design. |
| GV-21 [AnyVoice, Piglin Boss](https://x.com/AnyVoice_/status/1846532038267981839) (SOCIAL-IMAGE) | Strong head shape, broad sword and tall backpack frame/crystal tips provide identity on relatively compact humanoid mass. | Compare story-bearing equipment against earlier Goblin Warchief. No native file, orthographic views or license to copy. |
| GV-22 [Banathes, Pumpkin Pack](https://mcmodels.net/products/10456/pumpkin-pack) (PAGE+IMAGE) | Boss, minions, armor and weapons repeat carved faces, leaf/vine and autumn shapes while their silhouettes vary. | Strong **family grammar** reference, not one geometry template. Archived product; no source rights assumed. |
| GV-23 [DepartmentQDE, Slime Boss](https://mcmodels.net/products/15960/slime-bosss) (PAGE+IMAGE) | Stacked green head/body masses, prominent teeth and elongated asymmetric tendrils express viscous fantasy creature. | Compare shape-language to solid golems. No visible proof of rig squash, actual material alpha or animated deformation. |
| GV-24 [Glitch Archive, Experience Golem](https://mcmodels.net/products/8804/experience-golem-boss) (PAGE+IMAGE) | Block-like short-horned torso, thick limbs and huge hammer foreground heavy strength. | Restricted material/form contrast with GV-23; Java ModelEngine listing is not Bedrock verification. |
| GV-25 [Volya, Ruin Sentinel](https://mcmodels.net/products/17484/the-ruin-sentinel) (PAGE+IMAGE; HOLD) | Giant stone/mechanical golem, cyan lines and human scale cue, but cinematic effects/title dominate poster. | Useful **ambiguous high-render case**, not trusted premium neutral-view master; weapon and stage effects partly separate from boss. |
| GV-26 [Eann Rodriguez, Kintsugi](https://blockbenchworkshop.com/model/eanncrod/kintsugi) (PAGE+IMAGE+META; HOLD) | Publisher lists Bedrock, 38 elements, 24 bones, 28 animations, one 1024x1024 atlas. Winged figure is low-contrast on black preview. | Detailed metadata != outstanding visual quality. Original project and motion not accessed. |
| GV-27 [Eann Rodriguez, Visage Of War](https://blockbenchworkshop.com/model/eanncrod/visage-of-war) (PAGE+IMAGE+META) | Bedrock, 31 elements, 20 bones, 16 clips, 128x128 reported. Repeated ivory/gold angular armor, wings and polearm. | Weapon silhouette can occlude body; no proof for hidden faces or pivot accuracy. |
| GV-28 [Eann Rodriguez, Minotaur](https://blockbenchworkshop.com/model/eanncrod/minotaur) (PAGE+IMAGE+META) | Bedrock, 29 elements, 20 bones, 8 clips, 256x256 reported. Horns, heavy forearms and broad hammer identify heavy combat role. | Different primary hierarchy from winged warrior; no universal part count or proportion rule. |
| GV-29 [fukuda1320, Soggy Sanctuary Stuffs](https://blockbenchworkshop.com/pack/fukuda1320/soggy-sanctuary-stuffs) and [Build-Off 01 results](https://blockbenchworkshop.com/contest/season-1/results) (PAGE+IMAGE+META) | Coherent swamp stone/moss visuals across urns, idols and furniture. Judge average 4.40/5 and final score 4.58/5 for competition entry. [Urn](https://blockbenchworkshop.com/model/fukuda1320/soggy-sanctuary-urn) lists 5 elements; [statue](https://blockbenchworkshop.com/model/fukuda1320/soggy-deity-statue) 47. | Strong example of **pack cohesion and differing appropriate detail levels**. Contest submission listed 8 assets, current product pack 9, so revisions not assumed identical. Generic format not Bedrock. |
| GV-30 [1CAMOU, Dungeon Starter](https://1camou.itch.io/dungeon-starter-blockimagine) (PAGE+IMAGE+META; HOLD) | Creator advertises 30+ models with original PNG, Blockbench and GLB assets, discloses AI-assisted creation with manual refinements. | Free/open availability and large asset count do not demonstrate premium artistry. Some promotional images dark; individual works must be judged separately, not rejected merely for AI involvement. |

### Cross-source synthesis

- **Subject identity comes before ornament quantity.** Anglerfish jaw/lure, Piglin equipment, Minotaur horns/hammer, Pumpkin motifs and urn functionality need distinct mass hierarchies. One global detail density or Cube limit is inappropriate.
- **Source richness and visual excellence are independent axes.** Kintsugi has rich Bedrock metadata but a dark, low-information thumbnail. Naldo offers a combined model/texture visual but no inspected original file. A strong research process records both.
- **Visual families remain separate.** Battle-worn humanoids, colorful pumpkins, slime, industrial/stone golems, winged warriors and swamp props should not inherit one fixed shape language.
- **Judged art ≠ production proof.** Blockbench Workshop contest used 3 judges and criteria including craftsmanship, sense of place, creativity and cohesion. The winning pack provides qualitative corroboration about consistency, not a LazyDesigner metric or automatic individual asset rating.
- **Negative curation matters.** Cinematic glow, inaccessible back views, incomplete rights, franchise reconstructions and high metadata counts can inflate apparent quality. Keep lower-confidence examples as contrast, not adopted model standards.

The Workshop uploader labels works with item-specific CC BY, CC BY-SA or CC0, but uploader license/ownership attestation is not a comprehensive rights audit. No source model, 3D geometry, original atlas, UV layout, rig, animation frame or permission for training/redistribution was obtained. No automatic Knowledge promotion or generator testing.


## H. Working Art-Craft Knowledge v0.1 — Geometry (2026-11-01; RESEARCH SYNTHESIS)

**Purpose:** Preserve what research is teaching us about premium stylized voxel *decisions*, rather than accumulating links or converting them into unearned production requirements. This is the existing Modelling research owner, **not** a new router, parser casebook, AI training corpus, automatic model preset, canonical Geometry standard or claim that LazyDesigner already produces better models. Observed original editorial/design statements below are distinct from inferences drawn from third-party promotional artwork. Asset-specific user reference and current approved form always outrank this notebook. No Golden Asset, generator test or native test is requested.

**Evidence vocabulary:** PRIMARY_GUIDE = artist/editor first-party written design guidance read; ART_IMAGE = visual reading of an identifiable creator's published static image; LISTING = product-page image/metadata, not original project; INFERENCE = transfer hypothesis needing case-specific visual evidence; UNKNOWN = information genuinely unavailable. None of these labels proves source model topology, native Bedrock operation, artist approval or AI-training permission.

### GK-01 — Identity-bearing masses, not uniform ornament

**Question:** Where does extra 3D form add recognizability, and where does it only add clutter?

**Source observation:** The [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) places recognizable whole shape in model geometry and most smaller surface detail in texture, warning not to simplify beyond recognition (PRIMARY_GUIDE). [Hytale art direction, Thomas Frick](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) describes iconic and recognizable forms built by selectively preserving and removing geometry (PRIMARY_GUIDE; Hytale's technical restrictions are not Bedrock rules). A [Bepoo Goblin Warchief](https://bepoo.netlify.app/models) art sheet emphasizes a crest/head, oversized paired trophies, axe and back banner; [DepartmentQDE's Yeti](https://mcmodels.net/products/15711/yeti-bosss) emphasizes heavy torso/arms and horns (ART_IMAGE/LISTING).

**Working interpretation (INFERENCE):** First identify the *subject, role and primary focal feature*; supporting masses should amplify that story. More silhouette-changing geometry is not automatically better, and reducing necessary forms solely for fewer Cubes is not better either.

**Use when:** A current approved asset reference clearly demonstrates one or several identity-bearing masses, protrusions or silhouette gaps.

**Reject/defer when:** Extra spikes/plates obscure the subject, a small peripheral mark is only surface color, or hidden depth is unknown. Do not prescribe 1–3 focal parts, Cube quotas or anatomical ratios.

**Unresolved:** Current source-specific front/side/rear, rig attachment, real dimensions and native edited model are required before any individual geometry decision is considered confirmed. Existing owner: modelling standard, selected profile, existing G-P02/G-P03; no new case inserted.

### GK-02 — Functional negative space is a first-class shape

**Question:** When is an empty region actually geometry, rather than a dark painted patch?

**Observed examples:** [Cozy Bamboo Furniture](https://mcmodels.net/products/15738/cozy-bamboo-furniture-dyeable) shows chairs, partitions and furniture frames whose gaps express intended use (ART_IMAGE/LISTING); a [Goblin Warchief](https://bepoo.netlify.app/models) uses separations between trophies, limbs and weapon for readable silhouette. The [Blockbench guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) also distinguishes real form from textured surface detail (PRIMARY_GUIDE).

**Working interpretation:** An opening between chair legs, a handle clearance, a weapon fork or a genuine mouth cavity affects view-dependent silhouette, passage, overlap or articulation; it cannot automatically be substituted with dark pigment. A scratch, seam or inset-looking color patch that does not change relevant space may stay in Texture.

**Use:** Approved views indicate actual spatial separation or a functional clearance whose shape matters.

**Reject/defer:** The reference is a front-only image, or the apparent gap may be a shadow/transparent overlay; depth/through-hole remains UNKNOWN. Do not cut new holes or add hollow geometry from one promotional angle. Existing owners: G-P06 / prop-furniture and the Geometry-vs-Texture boundary.

### GK-03 — Shape dialect belongs to the subject and visual family

**Question:** Can the same simplification/detail pattern be applied to every visually strong asset?

**Observed contrast:** [Experience Golem](https://mcmodels.net/products/8804/experience-golem-boss) uses rigid angular masses and a weighty hammer; [Slime Boss](https://mcmodels.net/products/15960/slime-bosss) conveys a soft creature through stacked masses and extending tendrils; [Bepoo Haunted Furnitures](https://bepoo.netlify.app/models) contains distinct practical object silhouettes. In the [Blockbench guide](https://blockbench.net/wiki/guides/minecraft-style-guide/), even Vanilla proportions are deliberately stylized for legibility, with exceptions to literal real-world scale (ART_IMAGE/LISTING + PRIMARY_GUIDE).

**Working interpretation:** Geometry simplification is *relative to its visual dialect*: rigid heavy boss, soft creature, cute trader, ornamental blade and functional stool may all be well-authored with different mass layering and part density.

**Use:** Comparing multiple examples within the same approved style family and equivalent presentation purpose.

**Reject/defer:** Importing a grim boss's blade/spike density into cozy furniture, or judging a successful simple prop as low-quality because it has fewer elements. Do not claim every work by one artist is exemplary. Existing owner: one selected modelling profile; shared approved art direction remains separate.

### GK-04 — Variation consistency must not erase role identity

**Question:** How do multiple models feel like one pack without turning into recolors?

**Observed examples:** [Bepoo Zombies](https://bepoo.netlify.app/models) display role-specific heads, equipment and silhouettes within an undead visual family (ART_IMAGE). [Banathes Pumpkin Pack](https://mcmodels.net/products/10456/pumpkin-pack) uses a repeated pumpkin/leaf/vine motif across differently shaped bosses, minions and equipment (LISTING).

**Working interpretation:** Separate *shared family tokens* (recurring silhouette motifs, characteristic material regions, scale of detailing) from *identity-specific parts* (weapon, head, appendage count, visible role equipment). Shape may vary even while materials and recognizable motifs remain related.

**Use:** Actual approved user reference is a multi-asset family with both repeated motifs and different roles.

**Reject/defer:** Duplicating all silhouette geometry or mirroring intentional asymmetry for pack uniformity; treating a collage as precise per-asset proportion measurements. Existing owner: selected modelling profile and user-approved family reference, not a universal preset.

### GK-05 — Thumbnail brilliance and native structural evidence are separate

**Question:** Can striking marketing artwork prove that its underlying model has excellent geometry?

**Observed contrast:** [Kintsugi by eanncrod](https://blockbenchworkshop.com/model/eanncrod/kintsugi) explicitly advertises a Bedrock-format model with 38 elements, 24 bones and 28 animations (LISTING/META), but its dark-on-dark thumbnail provides weaker visible silhouette evidence. [Naldo's Anglerfish](https://x.com/Naldo_Nerdlo/status/1331197958193377280) offers multiple model views and a visible texture-sheet image (ART_IMAGE; creator post accessibility varies), but not inspected Cube topology or part pivots.

**Working interpretation:** Track two independent properties: (A) how convincing/legible the presented art is and (B) what structural data is actually accessible. Neither a big atlas nor a high element count demonstrates artistic superiority. A compelling image alone does not reveal actual Bedrock topology.

**Use:** Selecting original creator works for further learning; a work may be strong artistic evidence with low structural access or technically rich but visually ambiguous.

**Reject/defer:** Inferring Cube layouts, exact pivots, neutral-view render quality, geometry counts or full 360-degree consistency from a single thumbnail. Rights and source-version identity still need to be considered.

### Geometry synthesis — reusable research questions, not an authoring algorithm

For the *particular approved reference*, identify: (a) identity-bearing overall silhouette; (b) functions requiring true volume or negative space; (c) which related family grammar is actually supported; (d) which details are surface-only; (e) view and source ambiguity. **Do not convert these questions into compulsory runtime steps, new MCP calls, universal Cube budgets, or presumed approvals.** These research notes are preserved for comparison with future independent sources; no current model or production source has been changed.

## I. Working Art-Craft Knowledge v0.2 — Process-aware Geometry (2026-11-01; RESEARCH SYNTHESIS)

This section EXTENDS GK-01–GK-05 with two genuinely distinct research questions. It does not rewrite the already-owned Geometry standard, hierarchy implementation, normal authoring Skill, or any production casebook. Sources below were read at the identified original pages on 2026-11-01; the observed claims are about published authoring principles, not inspected original third-party model data. No Golden Assets, model-generation tests, native execution or local toolchain requirements.

### GK-06 — Construct the hierarchy around supported articulation, not arbitrary model groups

**Problem / artistic decision.** Two shapes can look identical in a still image but imply different animation structure: a hinged jaw versus a painted open mouth, shoulder armor that follows the upper arm versus a freely rotating chest ornament, a handheld hammer versus a fixed body feature. Part and parent identity affect what motions can later be expressed without tearing or drifting.

**Primary source evidence.** [Minecraft Creator / Getting Started with Blockbench](https://learn.microsoft.com/en-us/minecraft/creator/documents/blockbench?view=minecraft-bedrock-stable) explicitly places authored cubes in named groups/bones and explains that such bones are the foundation of animation. It recommends completing the main cube structure before heavy painting, since large geometry edits can force rework of textures. [Blockbench Bedrock Modeling and Animation](https://blockbench.net/wiki/guides/bedrock-modeling/) describes bone-owned animation in the specific Bedrock workflow. [Hytale's original art director](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale) separately explains a Hytale-specific naming convention and simple primitive hierarchy for that engine: conceptually instructive, not portable identifiers.

**Format-conflict source.** [Blockbench Workshop / legoego19, Armature Basics Part 1](https://blockbenchworkshop.com/tutorial/legoego19/armatures-1o1-tips-and-tricks) demonstrates *Generic Model* armatures, deformation/weight paint, left/right naming and bone orientation. The tutorial itself says the armature feature is Generic-specific. This is **not** native Bedrock cuboid bone hierarchy and must not be silently transformed into a Bedrock armature feature request.

**Art-craft hypothesis.** Interpret an approved reference's moving **semantic part** and attachment relationships *at the same time* as its visible shape; distinguish mass ownership, rotating articulation, and purely painted features. Avoid premature hierarchy complexity for unobserved motion. The relevant geometry is not a mesh optimization or generic skeletal skinning project.

**APPLY:** Original reference/asset brief actually requires mouth, limb, wing, hinged ornament or weapon articulation, and the corresponding parent/rotation relation can be justified by observed design or confirmed requirements.

**REJECT / UNKNOWN:** No source motion or attachment reference; arbitrary per-Cube bones; assuming Hytale bone names or Generic armature weight painting work in Bedrock; naming bones from a promotional poster without pivot/axis evidence. Exact pivot, bone ancestry, constraints and export remain UNKNOWN until source/native evidence exists.

**Owner / relationship:** Existing Modelling hierarchy, pivot, attachment and profile sections; conditional interpretation linked to GK-01/GK-02, not a new stage/recipe or duplicate rule owner.

### GK-07 — Material origin can influence shape grammar, not just surface color

**Problem / artistic decision.** Two rocks can share a gray/brown palette but require different large contours; oxidized cliff stone, broken masonry, soft organic slime and dense armor convey different structural origins and wear.

**Primary artist source.** [SLYNYRD / Raymond Schlitter, Pixelblog #13: Rocks](https://www.slynyrd.com/blog/2019/1/22/pixelblog-13-rocks) advises understanding rock formation, environmental geography, and shape as well as palette. His large rock sprites may start with angular contour outlines; smaller rocks may start from solid color blobs. The choice is context- and scale-dependent, not a universal outline rule. [Saint11, Basic Shading](https://saint11.art/pixel_art_articles/article4/) similarly treats different planar and rounded forms as distinct light/shading problems.

**Curated comparison (image evidence only).** [Experience Golem](https://mcmodels.net/products/8804/experience-golem-boss) reads as rigid angular mass; [Slime Boss](https://mcmodels.net/products/15960/slime-bosss) suggests soft body and tendrils even though both families use large green blocky volumes. A [Soggy Sanctuary stone/urn set](https://blockbenchworkshop.com/pack/fukuda1320/soggy-sanctuary-stuffs) relies on an aged-stone/moss grammar across functional objects. No actual rock geology, internal geometry or material shader is established from artwork.

**Art-craft hypothesis.** A material/subject identity can have a *form dialect*: slab-like facets, load-bearing arches, chips/holes, rounded soft volumes, thin organic appendages or rigid plate breaks. Geometry and Texture must describe compatible causes, not a fixed procedural material preset.

**APPLY:** The source actually shows a characteristic mass/edge pattern and a material/formation context; choosing volume rather than a painted mark changes the recognizable object or functional contact.

**REJECT / UNKNOWN:** Automatically adding cracks/spikes/voids from the word rock; treating the author's 2D sprite process as a direct 3D cuboid construction algorithm; forcing realistic geology into stylized fantasy; inferring physical deformation of a still slime image. Source-specific depth and geometry remain UNKNOWN.

**Owner / relationship:** Existing selected modelling profile, material-specific visual reference and Geometry-vs-Texture split; TK-08 separately owns the *paint* consequences. Cross-domain synthesis is a relation, not a new routing path.

### Interpretation discipline for GK-06/GK-07

Source facts from official Minecraft/Blockbench descriptions outrank Generic/Hytale mechanics **for Bedrock compatibility**, while the user's actual artwork outranks external aesthetic tastes. Do not infer that a correct bone tree or authentic geological material yields a visually premium result. These notes add conditional artist reasoning; implementation remains deferred.

## J. Working Art-Craft Knowledge v0.3 — Design intent and motion-exposed geometry (2026-11-01; RESEARCH SYNTHESIS)

These are conditional *research interpretations*, distinct from the existing Geometry standard and the machine-indexed G-P cases. Source level is explicitly stated. Research does not automatically authorize asset copying, a different 3D format, a generator test, Golden Assets, or engine work.

### GK-08 — Intentional creative interpretation versus unsupported reference deviation

**Observed primary professional sources:** [Mojang / Peter Sheff — Creating a Goblin Chef](https://learn.microsoft.com/en-us/minecraft/creator/documents/makerseriesmakingthegoblinchef?view=minecraft-bedrock-stable) describes ideation, fitting broad body-part shapes, then adding small personality details. It notes that an unintended modeling shape can become a defining characteristic rather than requiring an exact copy. [Minecraft Maker Series introduction](https://www.minecraft.net/pl-pl/creator/article/minecraft-maker-series-episode-1--making-goblin-chef) confirms the professional three-part modeling/texture/animation context. [Riot Games Character Art](https://www.riotgames.com/en/artedu/character-art) independently identifies believable proportions, likeness, in-game-scale readability and character fantasy as goals when translating concept art into 3D. These are first-party written teachings, **not** inspected original project/animation files.

**New decision hypothesis:** The useful target is recognizable *intent and identity* supported by the approved reference, not absolute pixel-wise identity to an artist's 2D illustration. Hidden depth and minor creative modeling choices sometimes require interpretation. That flexibility must be distinguished from inventing a new role, missing essential accessory or overriding the user's locked form. This differs from existing GK-01 because it addresses **when variation from a source is legitimate**, not just which mass is important.

**APPLY:** When the user authorizes stylized interpretation, source silhouette/role survives, and a specific unavailable 3D detail requires a documented decision.

**REJECT/DEFER:** Source dimensions/turnaround exact, user asks same shape, an unobserved back is simply fabricated, or "happy accident" is used to justify an arbitrary random Cube. Unknown depth stays UNKNOWN. Existing owner: Geometry form/scale and user Reference Package; no automatic creative-deviation toggle.

### GK-09 — Articulated models have pose-dependent geometric visibility

**Primary first-party evidence:** [Minecraft Creator — Entity Modeling and Animation](https://learn.microsoft.com/en-us/minecraft/creator/documents/entitymodelingandanimation?view=minecraft-bedrock-stable) explains animation bones and pivots and advises temporarily hiding cubes while painting surfaces that may become visible later in animation. [Blockbench Overview & Tips](https://blockbench.net/wiki/guides/blockbench-overview-tips/) explains bone parenting and pivot placement.

**New decision hypothesis:** A resting three-quarter image can conceal inner jaw faces, back of shields, underarm surfaces, wing roots and gap clearances later revealed by actual supported articulation. Visibility is a relation of shape, occlusion, parent/pose and viewer; the geometry and painting responsibilities must agree. The source does **not** establish the exact unseen faces or joints of a third-party boss.

**APPLY:** An approved asset's actual articulated part has a supported movement envelope exposing a real face or gap.

**REJECT/DEFER:** Static objects, unobserved pose, imaginary hinge, guaranteed hidden faces or demands to model every interior regardless of use. Unknown source topology and pivots remain UNKNOWN. GK-06 owns hierarchy; GK-09 owns visual consequences of pose. TK-11 below owns corresponding surface paint.

**Research boundary:** No original third-party geometry, model file, animation playback or rights to reproduce the Goblin Chef design were obtained. No new rule, casebook, engine or test.

## K. Working Art-Craft Knowledge v0.4 — End-to-end artist process and inspectable Bedrock structure (2026-11-01; RESEARCH SYNTHESIS)

**Research method:** This stage studies one complete *artist-described* creative process (Peter Sheff's Goblin Chef) against two separate Mojang *source-file* examples (Allay and Warden). The models are not interchangeable: Goblin Chef's article explains craft, while Allay/Warden JSON exposes actual Cubes and bones without showing their source texture PNG or proving rendered quality. Official Minecraft content is technical/concept evidence, NOT a mandated style template for the user's premium fantasy voxel assets. No source geometry, texture, animations, video or third-party IP is copied into this repository.

**Evidence vocabulary:** PRIMARY_PROCESS_TEXT = read the original published artist tutorial, not its embedded video; PINNED_NATIVE_SOURCE = original JSON actually read at the exact Mojang bedrock-samples SHA; FIRST_PARTY_CREATIVE_INTERVIEW = the game designer's quoted intent, not the 3D artist's private production process; RESEARCH_INFERENCE = a bounded visual/artistic interpretation. An actual static/runtime visual result remains UNVERIFIED.

### GK-10 — Detail refinement can cross the Geometry–Texture boundary without losing ownership

**Distinct question:** Should all geometric decisions become immutable as soon as texture painting begins, or can a texture pass legitimately reveal a missing shape?

**Observed first-party process:** [Peter Sheff, Creating a Goblin Chef](https://learn.microsoft.com/en-us/minecraft/creator/documents/makerseriesmakingthegoblinchef?view=minecraft-bedrock-stable) describes major forms for the head/limbs/body during modeling; the *texturing* part then explicitly adds more smaller Blocks to enrich visual detail, paints broad colors, uses the Eraser to depict apron straps and ear contours, and adds targeted eyebrow/spatula shading. This establishes that the artist's published process is not a rigid no-geometry-after-modeling sequence (PRIMARY_PROCESS_TEXT). [Microsoft Getting Started with Blockbench](https://learn.microsoft.com/en-us/minecraft/creator/documents/blockbench?view=minecraft-bedrock-stable) still recommends broadly establishing major geometry before texture because large shape changes cause paint rework. These statements are compatible, not contradictory.

**Research interpretation:** Keep large silhouette and parts coherent early, then decide during surface study whether a newly noticed feature is genuinely volumetric, a thin cutout carrier, or painted detail. A legitimate late small form adjustment does not mean unrestricted reconstruction; it should be confined to the specific distinguishing feature and its actual UV/rig implications. The current LazyDesigner AUTHORING surface already semantically separates Geometry and Texture without needing a new stage or tool.

**APPLY when:** The user's approved reference visibly requires protrusion, overlap, thickness, or an articulating subpart which flat pigment cannot express, even if discovered while analyzing texture.

**REJECT/UNKNOWN when:** Replacing every scratch, stitch or shadow with tiny cubes; adding speculative hidden objects; revising large geometry without checking how it would invalidate mapped surfaces; treating this human tutorial as a command for the agent to automatically restructure existing assets. The Goblin Chef video, original project, exact UV and the artist's full revision history were NOT inspected.

**Owner:** Existing Geometry-vs-Texture and primary/secondary Geometry rules, linked to TK-14. Research synthesis only; no new Recipe/Runtime or production edit.

### GK-11 — Visual part carriers can be solids, thin planes or bone-only anchors

**Distinct question:** Does every semantically meaningful moving part have to own a visible thick cube?

**Pinned native observations:** [Allay Geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/allay.geo.json) describes a 32x32 texture canvas. The head and body use volumetric cuboids; each separate left/right wing is a cube with one zero-length size axis (0,5,8), while the rightItem bone has a parent/transform but **no cube**. The look_at bone holds head-face geometry, and left/right arms have their own bone and UV positions. [Warden Geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/warden.geo.json) uses a 128x128 canvas and distinct zero-thickness right/left ribcage plates and head-attached tendril planes, beside bulky solid body, head, arms and legs (PINNED_NATIVE_SOURCE). These are authored original Mojang examples at a fixed SHA, not hypothetical marketing metadata.

**Artist-level interpretation (RESEARCH_INFERENCE):** Choose a carrier according to required *spatial role*: solid for real volume, thin/planar for suitable silhouette/texture features, and an empty semantic anchor for an attachment or transform. The fact that a part moves does not require it to have a visible cube; conversely a plane cannot be assumed to model a full cavity or physical thick surface. The separate bone/transform is evidence of what can articulate, not proof that a source asset's appearance matches a new user reference.

**APPLY when:** Approved current reference identifies a flat fin, wing, rib strip, held-item attachment or joint semantics, and the selected Bedrock format actually supports the chosen representation.

**REJECT/UNKNOWN when:** A thin plane is substituted for genuine thickness/contact, every empty bone is deleted as “waste,” generic armature skinning is inferred from Bedrock bones, or a Warden/Allay part shape is copied into an unrelated fantasy boss. Do not infer transparency, two-sided rendering, back-face paint, or texture pigment from the geometry JSON alone.

**Owner:** Existing Geometry representation ladder, pivot/attachment and profile rules; TK-15 covers the distinct UV question and AK-14/15 the motion relation. None are new universal presets.

### Cross-case artistic provenance and rights

[Meet the Warden](https://www.minecraft.net/en-us/article/meet-warden) quotes the game's designer that the creative goal evolved from a blind piglin/sound-reactive stalker toward a stealth/fear experience; earlier concepts included statue-like forms and a folding 1x1-tunnel idea, while blindness remained. The interview is **conceptual/game-design intent**, not proof of any specific 3D artist's sculpting technique or final runtime model evaluation. Official Warden JSON instead establishes which tendril/rib/limb parts exist and can rotate; its animation source is analyzed under AK-15. This distinction prevents confusing lore, marketing image, source geometry, and actual visual acceptance.

Mojang bedrock-samples LICENSE.md at the same pinned SHA states copyright Mojang AB / Minecraft EULA. Use source links and small factual observations only. No asset-file distribution, third-party geometry copying, texture ingestion or AI training permission is inferred. Hytale/GeckoLib/miscellaneous artist examples remain different technical formats. Research continues without internal testing.

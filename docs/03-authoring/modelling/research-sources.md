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
| S10 | [Orca img2blockbench](https://github.com/orca-gamedev/img2blockbench/tree/315fff912f83a9923e954ff6c596c00dc9832fa3) | Direct Cuboid vs mesh-guided approaches, reproducible output artifacts and audit ideas | Existing Recipe + Golden benchmark | `EXTERNAL_EXAMPLE`; repository code MIT but reported metrics are **not** LazyDesigner measurements, asset rights separate |

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

**AD-02 — Practical-scale silhouette (hypothesis).** Inspect the current shaded view at a realistic intended viewing scale, with an equivalent-scale reference when available, **in addition to** the native full-resolution check. Positive candidate: the required primary silhouette and identity landmarks remain distinguishable. Reject: a large render looks intricate but the target becomes unrecognizable at actual presentation size. Ambiguous: unknown target scale, different framing/camera, intentional stylized contour or missing actual reference image → `UNVERIFIED`. Owner: [Visual Validation](../validation/visual.md); not a fixed pixel-size limit, visual score, new Runtime capture tool or additional Golden task.

**Promotion requirements:** real source/model paired images and exact revisions; one positive, negative and ambiguous case for each decision; then compare accepted results through the existing Golden benchmark. These advisory cases are **not** extra G-P01–G-P08 index sections and are not installed source knowledge for normal Gateway/Codex clients. Review counts and art appeal remain unmeasured.

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

`DISCOVERED → SOURCE_REVIEWED → DECISION_CANDIDATE → DETERMINISTIC_REGRESSION_AUTHORED → EXECUTED_SOURCE_PROOF → NATIVE/VISUAL_REVIEW`
is a **tracking sequence**, not a new runtime approval state machine or
persisted registry. Source review is not verified model quality.
Do not curate similar papers merely to increase source counts.
One accepted study must demonstrate a decision-changing contrast:
**when it applies, when it does not, and which existing Recipe operation
can consume the distinction**. If a source adds no new behavior beyond
`standard.md` or G-P01–G-P08, retain its link as background only.

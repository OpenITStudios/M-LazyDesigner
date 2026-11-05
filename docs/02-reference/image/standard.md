# LazyDesigner Unified Image Reference Standard

Updated: 2026-09-11

This document owns the canonical **visual-sheet composition** for ChatGPT-generated LazyDesigner reference images.

It does not own scale semantics (`scale-and-escalation.md`) or generation prompt construction (`prompt-contract.md`).

## Core Principle

```text
EVERY VISIBLE PANEL MUST REDUCE DOWNSTREAM UNCERTAINTY
```

A panel exists only when it materially helps one or more of:

```text
GEOMETRY_AMBIGUITY
TEXTURE_AMBIGUITY
ANIMATION_AMBIGUITY
```

Decorative, redundant, already-obvious, or decision-neutral panels are removed.

## One Unified Visual System

All profiles use the same visual grammar:

```text
PROP_FURNITURE
VEHICLE
HUMANOID
CREATURE
MECHANICAL
PLANT_FOLIAGE
GENERIC
```

Content adapts by asset; the reference-sheet language does not split into separate template systems.

## Default

```text
1 PRIMARY REFERENCE SHEET PER ASSET
```

Sheet 01 carries the maximum useful non-crowded evidence.

```text
Sheet 01 = canonical identity + scale impression + core construction
Sheet 02+ = bounded elaboration / overflow only
```

Additional sheets never redesign or rescale the asset.

**Mandatory MODEL construction baseline:** for any completed Minecraft/Blockbench **3D model reference**, Sheet 01 presents all **four mandatory object-relative sides: FRONT, RIGHT, BACK, LEFT**, using a balanced 2×2 layout. This applies to vehicles, props, humanoids, creatures, mechanical assets and foliage models. A HERO-only image remains valid only for an explicitly requested single-view deliverable; it is not an automatic preliminary step triggered by style complaints and is never a completed four-side construction reference. The separate Pixel Art/Particle branches are unchanged. User instructions requesting only a HERO or an isolated correction take precedence over the default full-sheet deliverable.

## Geometry-First Four-Side Capture — Verified Production Route

**First wrong boundary learned from the Roman legionary pilots:** a text-to-image model can draw a four-view *illustration*, but it does not maintain a shared model-space object or obey a guaranteed panel compositor. Even an image with exactly four labels is not the production geometric reference. No further prompt adjective or HERO fallback is a substitute for one Blockbench model.

For **construction-quality four-side reference output**, use the **same actual native Blockbench project** as the single source of geometry. Author/repair a coarse but meaningful Blockbench Cube/group model through the existing Geometry stage first; preserve the user's source image for identity. Then request the existing `capture_model_views` native tool with **explicit** `views: ["front","right","back","left"]`, an approved object-relative `front_direction`, `framing: { "mode": "model" }`, `size: 512`, and diagnostic extras disabled. The same native capture invocation now deterministically assembles its four verified PNG observations into one 2×2 image. **No additional image-generation call** produces the production sheet; camera direction, 2×2 placement, labels and reuse of those four pixels are controlled by code.

```text
SOURCE PHOTO / USER-APPROVED INTENT
→ single real Blockbench Cube/group model (Geometry owner, not image illusion)
→ capture_model_views: four explicit orthographic views from one current project
→ same-project, tracked-freshness, source-PNG SHA, view-set and projection checks
→ deterministic 2×2 sheet with Front|Right / Back|Left and no HERO/sidebar
→ actual-pixel P1 source/craft/part-contact review + user visual approval
```

The native board is usable for **visual review**, not automatically construction-ready. `structuredContent.four_side_sheet.state = AVAILABLE` means only that the four capture PNGs were composed with matching internal evidence. Check `evidence_freshness.state = MATCHED`, native image SHA-256 identities and actual visual content. If the model is unavailable, model scope changes mid-capture, texture dependency tracking is incomplete, a view is missing/wrong projection, or a source PNG cannot be decoded, return **NATIVE_4V_UNVERIFIED** rather than pretending an AI drawing is a certified rear/side. Do not use a generated crop as fallback. If a source photograph never showed the BACK, the *model's authored rear* remains PROVISIONAL relative to the source even when native capture is physically consistent.

**Separate non-production concept:** ChatGPT image generation can still produce an `ILLUSTRATIVE_CONCEPT` when the user explicitly wants an illustrative image. It cannot be marked as a verified native four-side construction reference, nor used to prove stable right/left geometry, rig, UV or Bedrock export. The prior approved MD-REF-01 remains a **presentation-only** exemplar, not retroactively a native capture. This route applies only to 3D MODEL work; Pixel Art and Particle remain independent.

## Information Priority

When space is constrained:

```text
GEOMETRY > TEXTURE > ANIMATION
```

This is a space/readability priority, not a statement that downstream stages are less important.

Never shrink critical form/proportion/depth evidence merely to fit lower-value support content.

## Information Budget

For a completed 3D MODEL construction reference, the first sheet reserves full readable area for exactly four object-relative sides:

```text
HERO                 0 in the four-side construction sheet (optional separate style preview)
CONSTRUCTION VIEWS   4 — FRONT / RIGHT / BACK / LEFT
CRITICAL DETAILS     0 on that sheet; separate only if necessary
KEY POSES            0 on that sheet; separate only if animation is required
```

Four sides are the mandatory MODEL baseline, not a fixed count of extra detail, rig, or motion panels. Do not shrink four essential views to fit decorative material. A simple model still presents four views; a HERO-only intermediate is not final construction evidence.

## Panel Priority

```text
P1 — REQUIRED
Without it, Astra/Codex may materially misread the asset.

P2 — USEFUL
Improves accuracy but is not essential.

P3 — REDUNDANT / DECORATIVE
Does not materially change a downstream decision.
```

Use:

```text
include P1
include P2 while readability remains strong
remove P3
```

If crowded, remove the lowest-value P2 before shrinking P1.

## Universal Layout Grammar

For a final 3D MODEL reference sheet, use the balanced **2×2 four-side baseline**:

```text
┌───────────────────────┬───────────────────────┐
│ FRONT                 │ RIGHT                 │
│ same physical model   │ same physical model   │
├───────────────────────┼───────────────────────┤
│ BACK                  │ LEFT                  │
│ same physical model   │ same physical model   │
└───────────────────────┴───────────────────────┘
```

Keep similar apparent object height and 3D model scale, neutral background, restrained lighting and only short direction labels. **Balanced 2×2 does not mean equal pixel widths:** a long side profile may need a wider panel than a compact front/back view. Keep aligned rows, ground baselines and readable uncropped models without changing the physical proportions. Different panel pixel widths are a presentation decision, not evidence of a different object scale. No fifth HERO, title bar, floating parts, palette, moodboard, instructions or badge on the four-side sheet. HERO style calibration is an optional **separate** one-image stage; extra top/bottom views, localized details, UV/material or animation evidence use separate sheets when needed.

```text
CONTENT DECIDES LAYOUT FOR ADDITIONAL EVIDENCE
FOUR SIDES FIX THE BASELINE FOR FINAL 3D MODEL CONSTRUCTION
```

### Balanced Four-Side Construction — Default after LazyBuilder Study

The first user-approved LazyDesigner four-side visual exemplar is cataloged in [reference-samples.md](reference-samples.md) as **MD-REF-01**. It is a layout/visual-treatment guideline with its actual PNG bytes stored in ChatGPT Library, **not** an automatically loaded image or a transferable SUV-design template. A new subject still owns all object-specific geometry, materials and hidden-side uncertainty.

M-LazyBuilder's EX-REF-02/03 approved exteriors establish a useful **presentation pattern**: four balanced large subject views, clean neutral background, thin dividers and short labels. This does **not** approve their house architecture, materials, roof shapes, block-building scale or ornaments as reusable Blockbench model style. Do not claim those example pixels were inspected in a particular generation unless actually accessible.

**Four-side MODEL baseline:** FRONT top-left, RIGHT top-right, BACK bottom-left, LEFT bottom-right. Directions are object-relative, not image-left/right or arbitrary label aliases. One frozen object-space brief must own component count, widths/depths/heights, contacts, gaps, color and material ownership, and orientation; only the camera moves. Image-generation text can request nominal orthographic views, **not prove calibrated 90° camera rotations or true 3D topology**. No side is replaced by a HERO even when the model is visually symmetric or simple.

**Source-hidden rear/side:** if original source pixels do not show a side, do not promote any AI completion to observed source truth. In an original creative concept, a coherent unseen side can be presented as **PROVISIONAL** until reviewed. In a faithful-source job where the hidden side is material, keep it **UNKNOWN / NOT_ASSESSABLE** as source fidelity, even if a provisional design image fills the requested reference sheet; disclose that limitation outside the image. Do not mirror the front and claim the back has been observed. When an unresolved source critical topology blocks geometry, mark only that downstream decision BLOCKED, not the entire independently supported artifact.

The four-side baseline applies to the **VISUAL/MODEL** reference branch. A separately requested HERO-only image, focused correction, 2D pixel artwork or particle asset does not trigger an unsolicited four-view sheet. Other views (TOP/BOTTOM, detail, rig, motion) are decision-driven additions, not replacements for any of the four.


## Header

When a main multi-panel production sheet genuinely needs a header:

```text
ASSET NAME
```

A HERO-only style calibration has no header or labels. A balanced four-side construction-only sheet uses short direction labels only, without an extra poster title. The layout must not force decorative text onto otherwise sufficient construction views.

Optional small subtitle only when it materially helps orientation.

Do not add quotes, slogans, model-info paragraphs, or technical prose inside the image.

## Minecraft-Style Blockbench Model Grammar — Geometry AND Hand-Painted Texture

For ChatGPT visual/model generation, the default Minecraft-style 3D reference is **MINECRAFT_STYLIZED_BLOCKBENCH**: deliberately constructed **cuboid-based game asset geometry** with selected rotated/angular parts, layered depth and **hand-painted pixel-art texturing on the faces**. It is not a real-world object render with a Minecraft label, nor a world-scale sculpture made of hundreds of individual tiny cubes. When the user supplies a visual style example, **use that actual example as the style authority**, while retaining the separate subject/source image as identity and proportion authority.

```text
MINECRAFT_STYLIZED_BLOCKBENCH (default for Minecraft 3D asset references)
→ strong recognizable silhouette built from composed cuboids / broad geometric masses
→ selected beams, inset panels, trims and attachments with visible structural depth
→ angled faces / stepped arcs ONLY where macro geometry or silhouette requires them
→ readable angular/segmented rounded forms, not smoothly shaded CGI cylinders
→ hand-painted face textures: purposeful non-uniform pixel-color clusters, material-aware
  light/shadow and hue-shifted ramps, quiet surfaces and restrained pixel variation
→ texture pixels stay painted ON surfaces: never one physical Cube per painted pixel

CLEAN_BLOCKBENCH_FORM (alternate when user explicitly wants simpler, flatter geometry)
→ fewer broad cuboids, restrained facet/detail density; still a 3D game model

INTENTIONAL_VOXEL_BLOCK_ART (alternate when user explicitly wants world-scale blocks)
→ exposed regular stepped voxel grid is a chosen geometry style, not universal

STANDALONE_PIXEL_ART
→ separate 2D Pixel Art reference branch, never a 3D object render default
```

**Distinguish three scales:** (1) whole-object silhouette and proportion, (2) meaningful Blockbench geometry pieces such as panels/frames/joints, and (3) texture-pixel clusters painted *onto those pieces*. Do not collapse scale 2 into scale 3 by extruding every highlight. Do not remove scale 2 entirely in pursuit of smooth product-render surfaces. Cube is a construction primitive, **not a visible pixel-per-Cube rule**.

The user's object photograph is **subject authority** (recognizable identity, overall proportions, functional parts and confirmed colors). A second visual example can be **style-only authority** (cuboid detail density, painted material shading, angular construction and rendering treatment). Do not copy the example vehicle's identity, body layout, color, logo, accessories or dimensions when it was supplied only to demonstrate style. Preserve UNKNOWN source-hidden details; the illustrative style example cannot reveal them.

### Evidence-Led Style Dissection — Observe Before Generating

When a user supplies a **style example**, inspect the actual image at whole-object and localized detail scale **before** choosing adjectives or issuing image generation. Do not silently substitute a generic image found online, a remembered render, or a prose label for that source. The result is a short internal **style fingerprint**, not a new mode, learned weight, persistent approval, model score or asset-specific geometry template.

```text
MACRO / silhouette    → large volumes, overall proportion, angle language,
                        recognizability, depth and support
MESO / construction   → only actual structural panels, rails, borders,
                        overlapping supports, joints, bevels and attachments
MICRO / face texture  → painted pixel-color clusters, restrained highlight/shadow
                        and material details ON the exposed faces
REST / visual quiet   → which large surfaces deliberately have low detail
MATERIAL DIFFERENCE  → how each visible material handles texture and shade
LIGHT VS PAINT       → visible scene lighting versus model-painted tonal pattern
UNKNOWN              → details, camera, hidden sides or UV resolution not proved
```

**Critical separation:** texture micro-pixels must not become separate protruding cubes. A plausible MESO panel must have structural purpose, depth/attachment or a silhouette effect; do not fabricate it just to display more pattern. On each material's large face, distribute texture detail *non-uniformly* and deliberately: emphasize relevant edges, intersections, inset boundaries, material direction and wear/lighting cues; keep broad **quiet areas**. Do not cover all faces with regular checkerboard rectangles, uniform random squares, evenly spaced white highlights, repeated faux bevels, or unnecessary noise.

**Material-aware clustering, not one procedural overlay:** wood may need directional grain; iron/stone needs weight, restrained highlights and contact-darkened edges; colored paint can use coherent midtones with localized hue-shifted clusters; dark glass may be mostly calm with a few selective reflections. These are conditionally useful examples, not universal rules, palette prescriptions or proof of the supplied model's real material properties. Prefer readable limited ramps and controlled color temperature; avoid pillow shading, repetitive tiling, banding and mixed pixel resolutions when they conflict with the visible style.

**Study example — supplied angular off-road vehicle image (style evidence only):** visible structural hierarchy includes large orange body regions, coherent dark charcoal supports/fenders/roof gear and angular framed windows. It uses clear depth where components really overlap; painted orange/dark tonal clusters are concentrated around meaningful bands and edges, while significant surfaces remain comparatively quiet. The wheel reads as an intentional segmented 3D assembly with face-level shading, not a textured square icon. The rendered dark studio background supports contrast but does not establish the source model format, exact Cube count, true UV texture resolution or Bedrock exportability. Do **not** transplant this vehicle's color, geometry, accessories or silhouette into other source objects. Promote only these *cross-object decisions* into the active prompt.

This image-based visual study is not a claim the sample was exported from Blockbench, nor that one screenshot reveals hidden geometry. The actual style image remains essential: text alone cannot reproduce its precise artistic judgment. The official Blockbench **Minecraft Style Guide** is informative about element economy, texturing, color ramps, mixels and banding, but it documents primarily vanilla style; do not impose vanilla restrictions as mandatory on a user's distinctive non-vanilla example.

### Failure Discriminator — Geometry vs Texture vs Presentation

```text
UNIFORM_CHECKERBOARD_SURFACE → texture distribution FAIL; not solved by adding geometry
CUBIC_MICRO_GRAIN           → texture pixels have been converted into tiny raised Cubes
NO_VISUAL_REST              → every face has equally intense detail; reduce noise
REPETITIVE_COLOR_RAMP       → repeated identical light/dark bands independent of form
MATERIAL_HOMOGENIZATION     → glass, body paint, metal and rubber share one texture noise rule
GENERIC_SMOOTH_PRODUCT      → structure/style stripped away; preserve meaningful MESO construction
STYLE_IDENTITY_LEAK         → style-example object features inserted into subject source
POSTER_INSTEAD_OF_OBJECT    → additional labels, dimensions or panels replace style examination
```

An accepted reference should preserve **recognizable MACRO form**, **purposeful MESO volume**, **controlled MICRO painting**, **quiet regions** and **material-specific treatment** simultaneously. Failure on one layer is not a command to increase detail on all layers. Inspect *actual pixels* and identify the first wrong layer before selecting a new prompt or edit. Do not assign a numerical threshold or assert visual PASS without a reviewed output.

### Negative and acceptance examples

```text
PHOTOREALISTIC_CAR_RENDER → smooth reflective CGI product with no Minecraft geometry identity
PIXELATED_CUBE_GRID      → a mini-cube mosaic or Minecraft terrain blocks posing as a model
FLAT_LOW_POLY_PRODUCT    → conventional smooth low-poly object with all authored voxel character removed
INVENTED_SOURCE_DETAILS  → style example's accessories, dimensions or colors copied to another source
SHADING_AS_VOXEL_DEPTH   → physically extruded texture pixels / every shadow a raised block
FAKE_ROUND_GEOMETRY      → perfect glossy cylinders/curves unsupported by the target format
INFOGRAPHIC_OVER_FORM    → poster labels, palettes, invented dimensions, wireframe or notes dominate image
MULTI_VIEW_BEFORE_STYLE  → many views consume pixels before the intended style has been accepted
```

**Stay on the selected output shape during style repair.** A user asking to correct the visual style of a four-side model has not requested a separate HERO. Maintain FRONT/RIGHT/BACK/LEFT for that correction. A large, uncropped 3/4 model view is available only when the user explicitly requests a single-view deliverable. If two attempts reproduce an added-panel/poster or material P1 geometry defect, stop the image-generation direction; do not crop or keep generating.

Bedrock/Blockbench target compatibility is a design constraint, not a claim of actual native export. A picture of a rotated cuboid, faceted round feature or painterly texture is not proof that an arbitrary mesh, boolean cut or exact UV has been implemented. Use the existing later model/visual verification for that evidence.

Use this grammar across object categories, not just vehicles.

## Hero View

Use one dominant hero when it improves whole-form understanding.

Preferred default:

```text
FRONT-LEFT 3/4
```

Hero communicates:

```text
identity
whole silhouette
volume/depth
major layering
primary attachment relationships
major material separation
```

It is a production reference, not a cinematic beauty render.

## Construction Views

For a completed 3D MODEL reference, **four mandatory object-relative sides** provide a coherent full perimeter, even when a side is simple:

```text
FRONT → identifiable front, width, height and face-specific components
RIGHT → object's right-side silhouette, depth and attachments
BACK  → rear silhouette and continuity; unknown source facts remain UNKNOWN
LEFT  → object's left-side silhouette, depth and attachments
TOP   → only when footprint/depth/layout matters; supplementary
BOTTOM → only when mounting/support/underside matters; supplementary
```

Never skip RIGHT or BACK because a HERO happens to show much of the model. Do not add mirrored detail merely to balance the composition. The minimum supplementary view set can be zero when all four sides plus the explicit brief are enough.

All four views use one object-space coordinate/orientation lock, similar scale and projection conventions, and readable construction framing. A source photograph with only one angle cannot by itself verify the resulting opposite camera views.

## Surface Coverage Gate — Construction Evidence

This is an **internal panel-planning and after-generation review gate**, not a mandatory six-view turnaround, new generator, similarity score or new `REFERENCE.json` field. Four sides are the default final MODEL coverage; this gate selects only supplementary views and determines which unseen-side claims remain UNKNOWN. Inspect only regions that can change a downstream Geometry, Texture or Animation decision; do not count every face merely for completeness.

Before selecting views, keep a compact temporary inventory for **P1 decision-critical** parts/surfaces:

```text
semantic part/region → construction decision (silhouette, width/depth, contact,
opening, support, articulation or identity-critical material)
→ strongest actual image/approved source fact + view
→ SUPPORTED | PROVISIONAL | CONFLICTING | UNAVAILABLE
→ unresolved decision + required view, or evidence-backed reason to omit it
```

- `SUPPORTED`: actual visible evidence or an explicit confirmed construction constraint. An image label or a pretty illustration is not visual agreement.
- `PROVISIONAL`: reversible **original-design** choice; never claim it is observed source geometry.
- `CONFLICTING`: source/approved views disagree; do not average shape or silently choose one.
- `UNAVAILABLE` / UNKNOWN: the necessary source-backed hidden geometry or attachment is not evidenced. Do not invent its depth, ornaments, dimensions or materials.
- P2 supporting views and decision-neutral surfaces may be omitted. An unknown only blocks the dependent decision when it materially changes construction.

The **minimum sufficient view set for a final 3D MODEL** is now FRONT/RIGHT/BACK/LEFT. A single view can be enough only for a requested preliminary HERO/style decision, **not** for a complete construction reference. Add TOP, BOTTOM or focused detail only if they resolve a remaining P1/P2 ambiguity. Even **confirmed symmetry** does not remove RIGHT or BACK from the default layout; it only reduces redundant decoration or extra views. **Merely not seeing asymmetry is insufficient** to claim symmetry. Where a hidden source surface remains unknown, include a clearly qualified conceptual completion only if appropriate and never treat it as source-verified.

A plain back is **not automatically a defect**. It fails when required depth continuity, rear support, attachment or material identity is missing, contradicts approved evidence, or is presented as known without evidence. Do not add decorations solely to fill a side.

### General Decision Scenarios

```text
ONE_VIEW_SUFFICIENT       → one view may suffice for a bounded HERO/style review; full MODEL construction still needs four sides.
REAR_STRUCTURAL_UNKNOWN  → P1 rear depth/attachment unresolved; request source or block dependent Geometry.
PROVEN_SYMMETRY          → simplify repeated detail, but retain each of the four directional views.
RIGHT_SIDE_DIFFERENCE    → object-RIGHT is always shown; confirm any side-specific difference rather than mirror it.
TOP_OR_UNDERSIDE         → include when footprint, opening, support or contact is decision-critical.
CROSS_VIEW_CONFLICT      → correct contradictory form rather than accept a unified but inconsistent asset.
COMPOSITE_TURNAROUND     → one composite is not multiple independently verified single-view images.
ORIGINAL_HIDDEN_SIDE     → coherent creative completion is PROVISIONAL until reviewed, not source truth.
```

After generation, inspect **actual visible pixels** against the inventory and Identity/Scale Locks: critical part presence, back/side continuity, attachments/openings, object-side orientation and Minecraft/Blockbench buildability. Reinspect all affected panels after an edit; the image may already have been shown to the user.

Existing stage-readiness vocabulary applies without creating a new schema:

- `READY`: P1 construction evidence is adequate, material contradictions are resolved and required visual approval was obtained. This describes **reference-stage** input only.
- `NEEDS_REVIEW`: provisional/uninspected imagery still requires review without blocking independent decisions.
- `BLOCKED`: missing or conflicting P1 evidence would force guessing on the dependent modelling decision; block only that stage.
- Manifest `APPROVED`, image hashes, consistent numerical claims or a composite sheet are **never by themselves visual PASS**, native model acceptance or proof of hidden surfaces.

The temporary inventory is not a handoff artifact. Preserve only necessary unresolved facts in existing package `unknowns` and `readiness`; do not create another registry, validator, tool or top-level manifest field.

## Multi-View Consistency & Reconstruction Readiness QA

### Mandatory Five-Pair Cross-Panel Evidence Check

For a completed four-side MODEL reference, compare **actual full-resolution image pixels** against the same source/approved object-space brief, rather than relying on panel labels:

1. `FRONT ↔ RIGHT`: near-front corner, front identity, body height, primary contacts and attachment count.
2. `RIGHT ↔ BACK`: rear corner, body depth, roof/ground support and rear attachment continuity.
3. `BACK ↔ LEFT`: rear silhouette, opposite rear corner, contacts and openings.
4. `LEFT ↔ FRONT`: return to the same front width, left-forward corner and non-mirrored features.
5. `RIGHT ↔ LEFT`: wheel/limb/branch/connector count, spacing, shared depth and real asymmetry.

Record `MATCH`, `LOCAL_VIEW_DEFECT`, `CROSS_VIEW_CONFLICT` or `NOT_ASSESSABLE` only for decision-critical relations. A first observed P1 contradiction blocks its dependent construction claim; issue one bounded `CHANGE + PRESERVE` correction and reinspect every affected panel. A four-panel generated composite remains **one uncalibrated image**, not four independent 3D camera proofs. A source-hidden rear remains `UNKNOWN / NOT_ASSESSABLE` for source fidelity, even where the generated BACK panel is a `PROVISIONAL` creative completion. Do not misinterpret painted shadows as physical holes, or substitute decorative detail for missing topology.

MD-REF-01 remains approved as a **visual guideline only**. Its frozen PNG/ZIP are not to be changed or reclassified as native Blockbench verification.


### Quality Acceptance Firewall — Model Value Before Presentation

**P0_OUTPUT_SHAPE — hard rejection before artistic grading:** for a four-side reference, only four object-relative views FRONT/RIGHT/BACK/LEFT belong in the generated sheet. A fifth feature view, close-up gallery, material swatches, measurements, title banner, status stamp, or notes strip makes the result `P0_FORMAT_FAIL` even if the four directional views appear. Do not crop/reassemble and treat the output as an accepted reference; layout repairs cannot resolve underlying equipment, source-identity, or model-geometry errors. Allow at most ONE evidence-led correction of a repeated output-format error, then STOP rather than produce a third similar poster. A true 3D camera-render workflow needs separately verified model/camera support; a generated image alone is not that proof.

**Output selection precedence:** the current requested artifact type outranks style-error heuristics and former prompt modes. A request for four sides remains four sides throughout any revision; style feedback never authorizes an output-format switch.


**Observed failure in MD-REF-02:** a clean 2x2 crop and valid archive hashes were treated as progress despite the Roman soldier's source-identity drift, unconvincing Minecraft game-model craft, missing right-hand sword continuity and uncertain shield contact. Presentation and preservation are not artistic acceptance.

For every new 3D MODEL reference, compare actual source and generated pixels in this **P1-first** order:

1. **SOURCE IDENTITY / MACRO — P1.** Preserve source-defining silhouette, facial character/expression when material, proportional shield/tool size, major armor/clothing masses, part inventory and side-specific asymmetry. Stylization may simplify surfaces but must not replace a distinctive subject with a generic archetype or transplant another sample's ornaments.
2. **MINECRAFT / BLOCKBENCH CRAFT — P1.** Recognize purposeful primary cuboids, layered plates, joints, negative space and restrained angled parts plausibly expressible in Blockbench. Separate real MESO structural thickness from painted MICRO highlights. Require material-specific hand-painted texture clusters and deliberate quiet surfaces, not global checkerboard/glitter, pointless rivet/gold spam, smooth CGI curves or one raised Cube per pixel. HD styling need not imitate strict vanilla texture limits.
3. **PART / GRIP / CROSS-VIEW TOPOLOGY — P1.** Trace major parts and their contacts across Front/Right/Back/Left using the existing five-pair review. For humanoids, check helmet/torso/shoulder/arm/waist/leg articulation and actual ownership of tools and shield by the right/left hands; for vehicles, trace wheels, doors and attachments. A truly occluded item is `NOT_ASSESSABLE` rather than obligatorily visible, but an unexplained disappearance, changed ownership, or contradictory attachment is a P1 defect.
4. **PRESENTATION — P2 AFTER P1.** Only after P1 review, check four readable sides, balanced panel widths, labels and visual economy. Cropping or reassembling a failed infographic repairs **layout only**; it cannot correct missing sword, changed face, texture, weapon contact or silhouette.
5. **APPROVAL / PROOF.** User acceptance is separate from upload/save authorization; even a good image is not a proven `.bbmodel`, rig, UV atlas, calibrated camera or native Bedrock export.

**Failure outcome:** an observed material P1 identity, craft or physical-continuity failure makes the current output `REJECTED_VISUAL_QUALITY` as a positive exemplar. If one bounded `CHANGE + PRESERVE` correction fails in the same direction, stop; do not generate more posters or camouflage the fault with a crop. If explicitly asked to save, preserve the unmodified failed source/output only as `HISTORICAL_NEGATIVE_QA` away from active positive samples; never load as a reusable `STYLE_EXAMPLE` or `PRESENTATION_EXAMPLE`. Static source tests, hash checks and pretty poster badges do not upgrade this verdict.

**Unknown vs failure:** unseen rear armor/rig, exact scale/UV/camera and source-occluded contacts remain `UNKNOWN / NOT_ASSESSABLE`, not automatically FAILED nor falsely SOURCE-OBSERVED. Creative completion may be `PROVISIONAL`. Block only the dependent modelling decision. A positive visual guideline must have supported quality at the actual image level and separate user approval. This is a human/agent evidence gate, not an automated image classifier or new persistent schema.



Review the **actual generated reference**, not merely its panel labels. This section applies the Surface Coverage Gate; it creates no image classifier, extra score, 3D solver or mandatory turnaround.

### Review sequence

1. **Pin authority.** Preserve user requirements, approved source evidence, Sheet 01 Identity/Scale Locks, object FRONT and object-left/right. In faithful reconstruction, hidden source-critical structure remains UNKNOWN; in an original concept, unseen surfaces may be coherent `PROVISIONAL` creative choices pending review.
2. **Examine P1 construction decisions.** Look at actual pixels for the whole silhouette, primary/secondary volumes, depth/width/height, attachments, openings, negative spaces, support/ground contact and identity-critical surface markings. Every decision has actual evidence, an approved explicit constraint, or an unresolved owner. The strongest front view does not automatically cover the back.
3. **Compare only relevant paired views.** When a decision depends on them, examine front/back, object-left/right and top/side. The camera rotates around the *same* object, not different designs. Two-dimensional outlines can legitimately change with camera angle; underlying part identity/count, proportions, attachments, openings, material continuity and side-specific marks must not contradict.
4. **Assess buildability.** A builder should be able to identify which forms are meaningful voxel volumes, layered/plane-like shapes, texture-only marks, intentional gaps and attachment relationships. Do not demand exact Cube inventories, UV coordinates, pivots, hidden depth or animation keyframes at reference time. A beautiful render with unresolvable primary masses is not reconstruction-ready.
5. **Decide stage-specific readiness.** `READY` requires sufficient P1 support plus required visual approval; `NEEDS_REVIEW` retains nonblocking provisional choices; `BLOCKED` preserves missing or contradictory P1 decisions. Independent stages do not inherit unrelated blockers. A supported plain back is valid; decorative filler is not structural evidence.
6. **Correct the smallest real issue.** Name the defective view and evidence-backed mismatch, preserve unrelated approved content, and inspect all touched views. Stop repeating unsuccessful identical correction directions without new evidence.

| Scenario | Reference-stage outcome / limitation |
| --- | --- |
| One view already explains all P1 volume/contact decisions | A bounded HERO/style review may be usable; the completed MODEL construction sheet still requires four sides |
| Front looks complete, required rear support remains source-occluded/UNKNOWN | Geometry `BLOCKED` on that decision; never invent an observed rear attachment |
| A plain back is confirmed by source or approved original design | Can be `READY`; do not add ornamental filler |
| Front/back have matching bounds but contradict rear attachment | Geometry `BLOCKED`; equal envelope is not topology proof |
| Distinct images declare consistent world constraints | Control `images[].part_world_constraints` can compare claims, but visual agreement remains `NOT_EVALUATED` until inspected |
| One composite image is relabelled as separate canonical camera files | Not independent source evidence; manually inspect relevant panels |
| An original concept needs an undescribed rear form | Only a `PROVISIONAL` design choice before acceptance |
| Front model view matches, required side/back model capture fails or is absent | Whole-form model `FAIL` or `UNVERIFIED`, never `PASS` from front alone |

For a material P1 issue, keep a short transient trace:

```text
construction decision → supporting source panel/view → discrepancy or UNKNOWN
→ owning Geometry/Texture/Animation stage → smallest required evidence/correction
```

This temporary review trace is not a new schema or default exported document. Use the existing `unknowns`, `readiness`, visual images and stage Markdown for requested handoff. Reference `READY` means eligible *input* to modelling, not a visual-quality PASS on a Blockbench asset.

### Panel-Level Visual Review — Composite and Multi-Sheet

Use this procedure only when a material P1/P2 decision spans more than one panel or an ambiguous panel needs focused inspection. It is a **temporary review method** for the actual image shown to the reviewer; it does not require panel segmentation software, create new package fields, or pretend that a composite image is several independent source files.

1. **Ground the whole sheet first.** Inspect the current full image, its actual identity/revision when available, layout and selected P1/P2 panel plan. Never accept a title or `FRONT/BACK` text as proof that the pictured camera and object-space orientation are correct.
2. **Locate only decision-changing panels.** Keep a temporary `PANEL_ID | parent image ID/SHA | observed panel bounds | intended camera/subject | P1/P2 claim | outcome` map. Bounds are visual-review focus coordinates, not `REFERENCE.json images[].regions` on a composite and not calibrated camera data. Do not invent bounding boxes when actual pixels are unavailable.
3. **Inspect the actual focused pixels.** Use the original image and, when available and helpful, a readable zoom/crop of the same existing bytes. Retain the full sheet as context. A zoom/crop never creates an independent source view, changes the underlying world scale, or promotes a panel label to a verified camera pose. If a critical panel cannot be inspected at readable size, mark the dependent claim `UNVERIFIED` and request only the missing compatible view, not an unrelated complete redesign.
4. **Pair by physical object side, not page position.** For the relevant pairs, compare primary mass/part count, silhouette at the correct camera angle, attachment/contact/opening topology, depth continuation, left/right asymmetry and identity-critical material marks. A different 2D outline is expected as the camera rotates; mirrored accessories, incompatible attachment direction, a front panel copied as a fake back, and invented hidden rear detail are not equivalent views.
5. **Separate evidence from intent.** A SOURCE_REFERENCE with unseen rear structure remains UNKNOWN. A new original design may propose the rear as `PROVISIONAL` until the actual result is reviewed. A plain back supported by the approved design is valid; do not manufacture filler for visual balance.
6. **Review revision impact.** Identify the changed semantic part and every panel where it appears or changes depth, contact, scale, material, or symmetry. Check all materially affected panels after editing; also inspect the full sheet for unintended changes outside the requested region. For a new image revision, re-ground panel locations from actual pixels instead of assuming old crop bounds still refer to the same content. Sheet 02+ remains bound to current approved Sheet 01 Identity/Scale Locks.
7. **Deliver one bounded verdict per material claim:** `CONSISTENT`, `LOCAL_VIEW_DEFECT`, `MULTI_VIEW_CONTRADICTION`, or `INSUFFICIENT_EVIDENCE`. A contradiction triggers a scoped `CHANGE + PRESERVE` correction and re-review; it is not automatically a final Geometry operation. Numeric/hash/source identity consistency alone never grants visual `PASS` or authorizes unreviewed images as `APPROVED`.

**Negative scenarios:** a two-view image duplicated under two filenames with identical bytes is still one source; a DRAFT panel does not count as approved coverage; labels can be swapped; cropping can hide a missing body part or wrong attachment; and a localized edit can accidentally alter another panel. Fail closed on these claims rather than treating a clean composition as proof of 3D consistency.

The existing `imageRegionEvidence` owner rejects source hash reuse under conflicting canonical views when computing approved semantic-part coverage. This is a **metadata integrity guard**, not perceptual panel inspection. For a composite, review visible panels manually and keep their evidence under the original parent image. The parser does not accept composite-image region annotations as if they belonged to independent orthographic cameras.

## Critical Detail Panels

Create a detail panel only when a high-risk relationship is not already clear.

Typical useful examples:

```text
PROP_FURNITURE → shelf angle, drawer/door relation, support joint
VEHICLE        → wheel mounting, cockpit opening, hinge/axle
HUMANOID       → hand/tool attachment, backpack attachment, shoulder/hip overlap
CREATURE       → wing root, jaw, tail base
MECHANICAL     → linkage, slider/guide, pivot/axis relation
PLANT_FOLIAGE  → stem/branch or carrier relationship when ambiguous
```

No decorative close-ups.

## Texture Evidence

Do not reserve a mandatory texture panel.

Prefer material/color/marking evidence to remain readable in hero, construction, and detail panels.

Add dedicated material evidence only when needed for:

```text
identity-critical marking
emissive region
alpha/cutout silhouette
important asymmetric material
directional pattern/surface
source-specific material distinction
```

Do not add palette boxes by default.

## Motion Evidence

Include only when animation is required and pose evidence materially helps.

Common action pattern:

```text
READY
ANTICIPATION
ACTION / CONTACT
FOLLOW_THROUGH
RECOVERY
```

Simpler motion may use:

```text
START
EXTREME
RETURN
```

The image owns pose silhouette, direction, and contact. Detailed timing belongs in `ANIMATION.md`.

If poses become unreadable, move them to Sheet 02 rather than shrinking Geometry evidence.

## Multi-Sheet Escalation

Detailed escalation thresholds are owned by `scale-and-escalation.md`.

Semantic naming examples:

```text
01-main-reference.png
02-detail-rig.png
02-motion-reference.png
02-mechanical-detail.png
03-variants.png        ← only when required
```

Every added sheet has one bounded purpose.

## Identity + Scale Lock / Anti-Drift

Once Sheet 01 establishes approved authority, later sheets preserve:

```text
same asset identity
same player/world scale relationship
same whole-model proportions
same required part count
same major silhouette
same approved materials/colors
same accessories/props
same asymmetry/orientation
same construction logic
```

A later sheet may reveal more detail but may not redesign or rescale existing authority.

A user-approved material change to any locked element is a revision and must update affected evidence coherently.

## Repeated View Consistency

When a view repeats across sheets, preserve:

```text
orientation
subject proportions
apparent underlying scale
visible part identity
material identity
camera convention
```

An enlarged detail panel may change presentation size without changing underlying asset proportion/scale.

## Visual Language

```text
clean light/neutral background
neutral studio-like lighting
clear Minecraft/Blockbench target construction
readable MINECRAFT_STYLIZED_BLOCKBENCH form: intentional cuboid-built structure and hand-painted face textures
style-authoritative example drives geometry and texture language; subject photo drives identity
no default smooth photorealistic product render, no mini-cube-per-texture-pixel mosaic
high edge/silhouette clarity
low visual noise
consistent scale within related views
minimal decorative styling
```

Do not use cinematic environments for construction evidence.

Small contextual hero presentation is acceptable only when context materially helps function/attachment understanding.

## Minecraft Target Only

When starting from real-world/non-Minecraft evidence:

```text
source image = evidence
final production sheet = approved Minecraft/Blockbench interpretation
```

Do not place the real source inside the final production sheet merely for comparison. It may remain separately packaged as `SOURCE_REFERENCE` when needed.

## Text Policy

Image text is limited to:

```text
asset title
view labels
short panel labels
short pose labels
```

No paragraphs, JSON-like annotations, implementation instructions, or long technical notes.

## Default Removals

Do not include by default:

```text
color palette box
generic model-info block
text-heavy infographic decorations, invented dimensions or swatches that compete with the model
decorative quote/tagline
scale illustration unless decision-critical
duplicate extra RIGHT/BACK panels beyond the four mandatory directions
TOP when it constrains nothing
repeated props already clear
close-up already clear
long explanatory text
real-image comparison panel
```

## Internal Visual QA

Before user review verify:

```text
identity matches confirmed brief
player/world scale matches current Scale Lock
required parts are present
no unrequested smooth product-render look, mini-cube tessellation or style-example identity copying
all four FRONT/RIGHT/BACK/LEFT panels present, correctly oriented and readable; P1 coverage and optional-view omissions checked against actual pixels
hidden rear/side construction is UNKNOWN unless evidenced, not filled by invention
hero and construction views agree
proportions do not drift
attachments/openings agree
painted shadows/highlights are not mistaken for unsupported physical form
true rear depth continuity and object-side asymmetry remain consistent
approved materials/colors remain stable
support panels describe the same asset
motion poses preserve geometry identity + scale
labels are minimal/correct
no panel is redundant
critical evidence remains large enough to interpret
```

For Sheet 02+, compare directly against Sheet 01 identity and scale locks.

## Failure Rules

A sheet fails on any material condition:

```text
cross-view structural contradiction
shadow or dark paint interpreted as unsupported geometric depth
copied or mirrored front falsely presented as a distinct rear
missing P1 rear/side construction evidence presented as READY
part shape/count changes without approved reason
player/world scale drifts across views/sheets
material identity drifts
later sheet redesigns or rescales asset
critical view becomes unreadably small
panel density reduces usefulness
motion compensates for incorrect Geometry
visual decoration displaces decision-critical evidence
```

Fix the owning issue before approval.

## Completion

A visual reference set is efficient when:

```text
every panel has a decision purpose
one primary sheet carries maximum useful non-crowded evidence
additional sheets exist only for real overflow
all sheets remain identity-locked + scale-locked
Geometry/Texture/Animation evidence appears only where useful
Astra/Codex can interpret the asset without redundant presentation content
```

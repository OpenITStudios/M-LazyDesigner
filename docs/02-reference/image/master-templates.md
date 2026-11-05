# LazyDesigner Image Generation Master Templates

Updated: 2026-09-11

This document owns compact reusable master templates after Reference Preparation resolves only blocking requirements, compiles a brief when useful, and selects relevant panels. A clear user image request already authorizes generation; extra pre-generation confirmation is needed only when explicitly requested.

It complements:
- `prompt-contract.md`
- `standard.md`
- `scale-and-escalation.md`

The templates are internal prompt-construction forms. They are not user-facing prompt requirements and must never be filled from uncontrolled raw chat when a compiled brief exists.

## Core Rule

```text
CURRENT USER REQUEST + APPROVED PRIOR STATE (WHEN PRESENT)
+ MINIMUM RELEVANT VISUAL FACTS / CREATIVE DEFAULTS
+ PANEL PLAN
+ IDENTITY LOCK
+ SCALE LOCK
→ ONE CLEAN GENERATION INSTRUCTION
```

Do not repeat the whole conversation, whole asset profile, whole package schema, or downstream MCP/Blockbench instructions.

## Shared Input State

Before using any template, resolve this compact state:

```text
asset_name
profile
confirmed_target
scale_anchor
identity_lock
material_lock
construction_lock
sheet_purpose
panel_plan
critical_surface_coverage when material
high_risk_failures
source_visual_authority when relevant
```

### `scale_anchor`

Use the strongest available scale authority:

```text
explicit dimensions
or
Minecraft player-relative scale
```

Canonical relative vocabulary is owned by `scale-and-escalation.md`.

Never convert a relative scale category into invented exact block dimensions.

## Shared Visual Language Clause

Use this once per generated sheet, not repeatedly per panel:

```text
Minecraft/Blockbench hand-crafted game-asset reference.
MINECRAFT_STYLIZED_BLOCKBENCH by default: composed cuboid geometry, selected
layered/rotated structural parts, purposeful angled silhouettes, hand-painted
pixel-art face textures and recognizable source proportions.
Not a smooth real-world product render, LEGO/terrain blocks or raised texel cubes.
Use CLEAN_BLOCKBENCH_FORM or INTENTIONAL_VOXEL_BLOCK_ART only if selected.
Neutral/dark studio background, coherent identity; no infographic by default.
```

When the source is real-world/non-Minecraft, the final production sheet still shows the Minecraft/Blockbench target only unless the user explicitly requests otherwise.


## Controlled Image Invocation — `M-LD-REF / 1.3`

This is the **single compact copy-ready invocation** of existing visual-reference rules. It is not a new image engine, Skill, schema, ChatGPT Project activation or substitute for the Template A/B/C continuation/correction contracts below. Fill only applicable facts after inspecting actual images; keep the version label for fair before/after pilots.

```text
M-LD-REF — CONTROLLED REFERENCE REQUEST v1.3
INTENT = <faithful source | new creative asset | approved bounded revision>
SUBJECT_SOURCE = <visible source identity, MACRO proportions/parts, real contact
  and void relations, material ownership, side-specific asymmetry; UNKNOWN if hidden>
STYLE_EXAMPLE = <actual image pixels if available; MESO cuboid layers and MICRO
  hand-painted face-pixel clusters, material separation, visual quiet; STYLE ONLY>
PRESENTATION_EXAMPLE = <actual image pixels if available; framing/layout ONLY,
  never the sample's shape, color, motifs or material palette>
APPROVED_TARGET = <actual accepted HERO/sheet if any, preserving identity/scale>
TARGET = Minecraft-stylized Blockbench model; composed cuboids, meaningful angular
  detail, painted texture ON faces; no smooth product CGI or raised texel cubes
OBJECT_LOCK = <same physical asset; approved front, object-left/right, relative
  width/depth/height, part count, contacts, openings and confirmed colors>
STAGE = <FOUR_SIDE_CONSTRUCTION (default completed 3D MODEL, also style corrections) | HERO_STYLE_CHECK (explicit single-view only) | MINIMUM_CONSTRUCTION (explicit partial correction only)>
DRAW =
  HERO_STYLE_CHECK: only after explicit single-view request, ONE uncropped 3/4 asset, neutral studio; no labels,
    typography, palette, infographic, dimensions or extra thumbnails.
  MINIMUM_CONSTRUCTION: scoped partial/repair image ONLY, not the completed MODEL
    four-side handoff; choose only the relevant visible P1/P2 view(s).
  FOUR_SIDE_CONSTRUCTION: DEFAULT final 3D MODEL reference; exactly four
    visually balanced 2x2 panels: Front top-left / Right top-right / Back
    bottom-left / Left bottom-right, object-relative. Unequal panel pixel widths
    may accommodate long side profiles while preserving aligned ground lines,
    readable silhouettes and identical underlying physical proportions.
    ONLY direction labels, no fifth HERO, title, palette, detail row, invented
    measurements or QA badges.
SINGLE_OBJECT = rotate camera around one unchanged form; do not mirror parts,
  shift attachments, invent the other side as observed or change surface identity.
SOURCE_HIDDEN = UNKNOWN in faithful reconstruction; PROVISIONAL when designing a
  coherent new concept, never masquerading as source-observed or approved.
POST_IMAGE_REVIEW = inspect ACTUAL source and output pixels in order:
  P1 source identity/MACRO → P1 intentional Blockbench MESO plus MICRO hand-painted
  materials and visual rest → P1 part/grip/attachment continuity across four views
  → only then P2 layout, labels and readability.
QUALITY_GATE = Any observed material P1 defect REJECTS this positive exemplar,
  even when the 2x2 crop, checksum, labels and archived files look correct.
  Source-hidden back/rig is UNKNOWN, proposed completion is PROVISIONAL.
CORRECTION = first observed defect only; CHANGE it and PRESERVE correct parts.
  Cropping a poster repairs presentation ONLY. Stop repeated failed direction.
ARCHIVE_RULE = REJECTED_VISUAL_QUALITY may be kept as HISTORICAL_NEGATIVE_QA
  only by explicit request; never reuse as positive STYLE_EXAMPLE or
  PRESENTATION_EXAMPLE for a new object.
NO_FALSE_PASS = no visual approval, native Blockbench/UV/Bedrock or exact-camera
  claim from image labels, hash, generated text, or a static source test.
```

**Routing lock:** style feedback on a selected FOUR_SIDE_CONSTRUCTION task stays FOUR_SIDE_CONSTRUCTION; never automatically route it to HERO_STYLE_CHECK. Only an explicit single-view user request can select HERO. The multi-mode block above is INTERNAL reasoning, not the image prompt; **do not send the entire block to the image generator**. For four-sided work send only the isolated four-side payload below, filled with source-backed facts and permitted actual visual anchors, not historical poster material. An unknown source rear stays UNKNOWN or separately PROVISIONAL. GitHub cannot install a ChatGPT Project, and this written v1.3 update does not prove output compliance.


### Isolated Four-Side Generation Payload — One Selected Output

For a four-sided reference or any correction to an existing four-sided sheet, fill and send **only the content between the two markers below**, plus the actual source/approved image pixels when available. Never send the multi-mode planning contract above, old poster images, sample-specific reproduction instructions, or alternate output templates. The output is one picture containing four physical sides of the same unchanged subject.

```text
FOUR_SIDE_IMAGE_PROMPT_BEGIN
Draw a Minecraft-stylized Blockbench reference of:
<subject identity, source-backed main silhouette, unique parts, and material roles>.

Depict ONE unchanged physical model, observed from exactly four
object-relative directions in a clean balanced two-by-two composition.
TOP LEFT: FRONT.
TOP RIGHT: RIGHT.
BOTTOM LEFT: BACK.
BOTTOM RIGHT: LEFT.

In each panel show the complete same object and stable physical proportions.
Use a quiet dark-neutral backdrop, simple dividers, and short direction labels.
Preserve the same part counts, surfaces, contact points, tools, accessories,
right/left handedness, materials and connections from every viewpoint.
Use purposeful cuboid and angular forms with restrained hand-painted
material-specific textures painted onto model faces.
Finish the image after exactly those four directional views.
FOUR_SIDE_IMAGE_PROMPT_END
```

**P0 prompt lint:** no extra visual sections, unrelated interface decoration, or alternate-stage instructions may be included in the extracted image payload. After generation inspect actual pixels; a fifth or extraneous section is `P0_FORMAT_FAIL`, not a successful four-view reference. Do not crop a failed poster to create apparent acceptance. After one bounded correction that repeats the same issue, STOP. A real 3D model with camera renders would require independent geometry/runtime proof.

---

### Style-Calibrating HERO-Only Pass (explicit single-view requests only)

Use this isolated style-preview option ONLY when the user explicitly requests one large single view. Never treat a style complaint about four sides as permission to switch the output format:

```text
CREATE ONE MINECRAFT-STYLE BLOCKBENCH 3D MODEL IMAGE.
SUBJECT = <source object's recognizable parts, colors, silhouette and proportions>
STYLE  = <actual style example's cuboid construction and hand-painted face texture>
GEOMETRY = <primary masses, angular trims, useful attachment depth, limited facets>
TEXTURE  = <material-specific NON-UNIFORM hand-painted clusters on faces>
REST     = <broad quiet areas; no repeated checkerboard squares or global noise>
PRESERVE = <source identity, confirmed size relationships and part details>
BACKGROUND = neutral or dark studio; full asset visible and uncropped.
ONLY IMAGE = one isolated front-left or matching 3/4 hero asset.
NO INFOGRAPHIC, NO TEXT/LABELS, NO DIMENSIONS, NO SWATCHES,
NO WIREFRAME, NO SECONDARY VIEWS OR DETAIL THUMBNAILS.
```

This is not a new style registry, tool route, or required extra image. When the style is accepted, resume the normal Sheet 01 view plan if the user needs construction evidence. Never invent measurements or claim image-generative consistency is native Blockbench proof.

# TEMPLATE A — SHEET 01 / MAIN_REFERENCE

Use for the canonical first sheet.

## Purpose

Sheet 01 establishes:

```text
visual identity
player/world scale
whole-model proportion
major construction
material identity
core attachment relationships
```

It is the anchor for every later sheet.

## Master Form

```text
CREATE MAIN REFERENCE SHEET

TARGET
<one concise sentence describing the confirmed Minecraft/Blockbench asset>

SCALE
<explicit confirmed dimensions if available>
OR
<Minecraft player-relative scale anchor>
Preserve this scale consistently across every view.

IDENTITY LOCK
- <major silhouette fact>
- <required major parts / part count>
- <required accessories / props>
- <required asymmetry / orientation>
- <identity-critical markings/material facts>

CONSTRUCTION LOCK — ONE SHARED OBJECT-SPACE FORM
- <main masses and supported relative width/height/depth, no invented measurements>
- <secondary volumes and actual attachments/ground contacts>
- <real openings/negative space vs painted shadows or surface marks>
- <front, object-left/right, and confirmed asymmetry>
- <UNKNOWN hidden source geometry or original-design PROVISIONAL facts when material>

VISUAL LANGUAGE
Minecraft/Blockbench handcrafted, stylized cuboid-built game-asset reference.
MINECRAFT_STYLIZED_BLOCKBENCH: primary cuboids with selective angular layers,
visible structural depth, and hand-painted pixel-art shading ON the faces.
Do not create miniature raised cubes per painted pixel or a glossy real vehicle.
Preserve subject identity; the style example provides style only.
Clean dark/neutral studio lighting; no large title, stats or decorative notes.

SHEET PURPOSE
MAIN_REFERENCE — establish canonical identity, scale and core construction.

PANELS — REQUIRED FOR COMPLETED 3D MODEL MAIN_REFERENCE
- FRONT: same model from object's front; width, frontal silhouette and contacts
- RIGHT: same model from object's right; depth and right-side attachments
- BACK: same model from object's rear; rear silhouette and mass continuity
- LEFT: same model from object's left; depth and left-side attachments
Exactly four balanced 2×2 panels, no HERO on this sheet. Extra P1/P2 details belong on a separate continuation sheet. An explicitly HERO-only task is a separate preliminary image, not completed MAIN_REFERENCE.

SURFACE STYLE FROM ACTUAL EXAMPLE
- <MACRO silhouette/shape language; only actual geometric MESO layering>
- <MICRO pixel painting on faces, clustered around material/edge meaning>
- <REST_ZONES with little/no pattern; avoid all-over checkerboard or random dithering>
- <material-specific value ramps; distinguish dark glass, painted body and metal>
- <keep source identity separate from visual example; no invented scale>

SURFACE COVERAGE (only if a P1 decision needs a view)
- <critical mass / back-or-side depth / attachment / opening and the panel supplying evidence>
- <source-backed hidden construction still UNKNOWN; do not invent>
- <any omitted supplementary TOP/BOTTOM/detail view justified by sufficient evidence; never omit FRONT/RIGHT/BACK/LEFT>

CONSISTENCY
- same asset proportions in every panel
- same part count, rear depth continuity, attachments and openings
- same left/right orientation
- same approved materials/colors
- same player-relative/world scale
- orthographic views must read as the exact same asset from different directions

DO NOT CHANGE / HIGH-RISK FAILURES
- <small targeted list only>

PRESENTATION
- no additional feature render or alternate-view panel in the four-side construction-only sheet
- construction views aligned and consistently scaled
- no paragraph text
- no palette box unless decision-critical
- no decorative panels, inferred measurements, large infographic note blocks or unnecessary color swatches
- omit rows that carry no useful evidence
```

## Panel Ordering

For completed 3D MODEL references:

```text
FRONT + RIGHT + BACK + LEFT → mandatory equally readable construction
→ separately approved HERO style preview if a style issue requires one
→ critical detail P1/P2 on a separate continuation sheet only if necessary
→ key poses / material notes on their own focused sheet only when required
```

If required evidence becomes too small, stop and escalate overflow to Sheet 02 instead of compressing the main sheet.

## Scale Visibility

Do not automatically draw a player silhouette.

Add compact visual player-scale evidence only when it materially reduces ambiguity, for example:

```text
vehicle occupancy
stall/kiosk
large machinery
identity-critical creature scale
ambiguous large environment prop
```

Otherwise keep scale in the prompt/package state without spending image area on it.

---

# TEMPLATE B — SHEET 02+ / CONTINUATION

Use only after Sheet 01 exists as approved/current visual anchor.

## Purpose

A continuation sheet may explain one bounded overflow problem:

```text
DETAIL_REFERENCE
RIG_REFERENCE
MOTION_REFERENCE
MECHANICAL_DETAIL
VARIANT_REFERENCE when explicitly required
```

It must not redesign the asset.

## Master Form

```text
CREATE CONTINUATION REFERENCE SHEET

VISUAL ANCHOR
Use approved Sheet 01 as the canonical identity and scale authority.

PRESERVE IDENTITY LOCK
- same whole-model proportions
- same major silhouette
- same required part count
- same accessories/props
- same approved materials/colors
- same asymmetry/orientation
- same construction logic
- same identity-critical markings

PRESERVE SCALE LOCK
- same Minecraft player/world relationship
- same occupancy/interaction scale
- same relative size of major parts

SHEET PURPOSE
<one purpose only: DETAIL_REFERENCE | RIG_REFERENCE | MOTION_REFERENCE | MECHANICAL_DETAIL | VARIANT_REFERENCE>

NEW PANELS ONLY
<only overflow panels that could not remain readable on Sheet 01>

For each panel:
- <PANEL LABEL>: <view/subject> — <single downstream decision purpose>

REPEATED VIEW RULE
If a view from Sheet 01 is repeated, preserve the same orientation, proportions, part identity,
material identity and camera convention. Enlarging a detail for readability must not imply a changed underlying scale.

DO NOT REDESIGN
- do not change proportions
- do not add/remove major parts
- do not change accessories
- do not change material identity
- do not change player-relative scale
- do not reinterpret asymmetry
- do not alter unrelated construction

PRESENTATION
Use the same visual language, background, lighting, typography and label style as Sheet 01.
Keep the sheet bounded to its one declared purpose.
```

## Continuation Sheet Selection

Before creating Sheet 02+, verify that all lower-value alternatives were exhausted:

```text
remove P3
→ remove lowest-value P2
→ remove redundant view
→ restore useful size to P1
→ only then create continuation sheet
```

Sheet 03+ requires remaining P1/P2 evidence that still cannot fit clearly after Sheet 02.

---

# TEMPLATE C — CORRECTION / REVISION

Use bounded image editing whenever possible.

## Principle

```text
APPROVED CURRENT VISUAL
+ CHANGE
+ PRESERVE
→ MINIMUM AFFECTED EDIT
```

Do not regenerate unrelated evidence unless the correction changes a locked identity/scale relationship across multiple panels.

## Master Form

```text
EDIT CURRENT APPROVED REFERENCE

CHANGE
- <exact user-approved change>
- <second change only if directly related>

AFFECTED PANELS
- <panel(s) that materially require update>

PRESERVE
- whole-model proportions unless explicitly changed
- player/world scale unless explicitly changed
- all unrelated geometry
- all unrelated materials/colors
- all unrelated accessories/props
- established left/right orientation
- established construction relationships
- approved layout/visual language

CROSS-VIEW CONSISTENCY
If the changed feature appears in multiple views, update every materially affected view coherently.
Do not leave the old version in another panel.

PANEL-LEVEL RECHECK
- <affected PANEL_IDs and associated P1/P2 evidence decisions>
- Compare with the actual approved image when available; preserve unrelated material and structural authority.
- Re-ground panel boundaries against the new image; do not reuse stale crop/label assumptions.
- Inspect the complete sheet for collateral changes outside the targeted edit.
- A zoom/crop is only a focus on the same parent image, not independent source authority.

SCALE REVISION RULE
If the user changes scale materially, treat it as a new Scale Lock and update every affected panel/sheet coherently.
Do not modify scale accidentally during an unrelated correction.

DO NOT CHANGE
- <targeted high-risk unrelated elements that must remain identical>
```

## Correction Scope Decision

```text
local visual defect
→ edit local panel/region

feature appears in multiple views
→ edit all affected views coherently

identity or scale revision
→ update Sheet 01 authority and every materially dependent sheet

whole-sheet coherence failure
→ regenerate that sheet using current locks, not old raw chat
```

---

# Template Compression Rules

The master templates are structures, not text that must be copied verbatim.

The final generation instruction should remove empty sections and collapse redundant facts. For original creative designs, use provisional choices for unspecified appearance; for source reconstruction, preserve only evidence-backed source facts and explicit constraints.

Example:

```text
no animation
→ remove motion language entirely

no material ambiguity
→ do not add material-detail instructions

symmetric asset
→ no RIGHT panel and no asymmetry warning unless needed

standard humanoid scale
→ preserve PLAYER_HEIGHT internally; no visual scale marker required
```

Do not use token budget to explain why omitted panels are absent.

# Panel Payload Format

Internally, a compact panel item should be sufficient:

```text
<PANEL_ID> | <TYPE> | <VIEW_OR_SUBJECT> | <P1/P2> | <PURPOSE>
```

Example:

```text
HERO_01 | HERO | FRONT_LEFT_3Q | P1 | whole silhouette + depth
VIEW_FRONT | CONSTRUCTION | FRONT | P1 | width + part count
DETAIL_TOOL_HAND | DETAIL | hand/tool attachment | P1 | prevent floating attachment
POSE_CONTACT | KEY_POSE | harvest contact | P2 | clarify tool contact
```

Do not copy a prose description of the entire asset into every panel.

# Profile-Specific Injection Rule

Profiles may contribute only the smallest relevant clause needed for current panels.

Examples:

```text
HUMANOID
→ joint overlap only if rig/motion matters

VEHICLE
→ wheel/cockpit/occupancy relationship only if selected panels depend on it

PLANT_FOLIAGE
→ growth spread/stem attachment only when those are current ambiguity targets

MECHANICAL
→ linkage/axis/clearance only for current mechanism panel
```

Never inject the entire profile guide into a generation prompt.

# Generation Decision and Pre-Call Gate

Generate one useful image/sheet in one pass by default. For a four-sided user request, send only the isolated FOUR_SIDE_IMAGE_PROMPT body and preserve that shape across bounded corrections; do not preface it with an unrequested single-view render or alternate stage. Do not invent extra images, 3D proxies or intermediate assets.

Proceed when:

```text
the user requested this image or edit
no decision-changing BLOCKING ambiguity remains
the concise visual brief is current (compile formally only when useful)
source evidence is preserved; optional creative defaults are not called source facts
scale and identity are resolved enough for the requested artifact
all four FRONT/RIGHT/BACK/LEFT construction panels are planned for a completed 3D MODEL reference; only extra P1/P2 views are optional
critical rear/side/top/contact P1 coverage is planned or honestly UNKNOWN
only omitted EXTRA views rely on confirmed evidence, not assumed symmetry; no missing cardinal view is presented as a finished MODEL sheet
object-space FRONT / side direction is clear when material to multi-view
pre-generation approval is satisfied only when explicitly requested
```

# Post-Call Visual Inspection

For a multi-panel sheet, inspect the actual complete image first and keep a compact per-panel review focus (PANEL_ID, current parent image, intended object side, specific P1/P2 claim). Compare paired panels by object-space view instead of their page labels alone; a focus/crop does not create a new approved image or camera. Re-evaluate the entire sheet after any edit for accidental changes to untouched panels. Never reuse review focus coordinates after a layout-changing revision without observing the new pixels.

ChatGPT image generation may show the result immediately. Inspect the actual generated pixels when available **after generation**; do not promise a hidden pre-display QA gate.

```text
identity and scale remain consistent with the user request and visual source
multi-view panels share one 3D form but may have different projected 2D silhouettes
required part count and attachment relationships are consistent
approved side-specific markings, materials and colors do not drift
P1 rear/side/attachment coverage is actually inspectable or missing information remains UNKNOWN
painted shadows/highlights are not mistaken for extra voxel depth or true openings
no mini-cube mosaics built from individual texture pixels
macro cuboid structural layers remain visible: do not flatten into ordinary smooth CGI
rounded parts remain readable with purposeful Blockbench-style facets, not perfect real-world curves
back is the same underlying object volume, not a copied front or new asset
an empty back is not decorated solely for visual balance
later sheets preserve actual approved Sheet 01 visual identity
motion views use the same object rather than redesigning it
labels and critical views remain legible, without decorative crowding
```

If a visible material defect exists, use bounded CHANGE + PRESERVE image editing when possible, then inspect every affected panel; a broad contradiction may require regenerating the sheet. If images cannot be inspected, report affected claims UNVERIFIED. Do not initiate blind retries or call an unreviewed output approved. Stop repeated same-direction edits without new evidence.

# Economy Target

The intended result is:

```text
poor or casual user prompt
→ Requirement Gate
→ Prompt Compiler only when useful
→ compact current state
→ one reusable master template
→ consistent production reference
```

Generation quality should depend on confirmed visual/technical authority, not on the user's ability to write a sophisticated image prompt.

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

---

### Style-Calibrating HERO-Only Pass (when style feedback is the blocker)

Before generating a new multi-view sheet following a user-supplied Minecraft-style example, resolve the STYLE mismatch with **one large 3/4 model only**, using this temporary panel selection inside the existing image workflow:

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

PANELS
<only selected P1/P2 panels, ordered by priority>

For each panel:
- <PANEL LABEL>: <view/subject> — <single downstream decision purpose>

SURFACE STYLE FROM ACTUAL EXAMPLE
- <MACRO silhouette/shape language; only actual geometric MESO layering>
- <MICRO pixel painting on faces, clustered around material/edge meaning>
- <REST_ZONES with little/no pattern; avoid all-over checkerboard or random dithering>
- <material-specific value ramps; distinguish dark glass, painted body and metal>
- <keep source identity separate from visual example; no invented scale>

SURFACE COVERAGE (only if a P1 decision needs a view)
- <critical mass / back-or-side depth / attachment / opening and the panel supplying evidence>
- <source-backed hidden construction still UNKNOWN; do not invent>
- <omitted view justified by confirmed symmetry or other sufficient evidence>

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
- one dominant hero when useful
- construction views aligned and consistently scaled
- no paragraph text
- no palette box unless decision-critical
- no decorative panels, inferred measurements, large infographic note blocks or unnecessary color swatches
- omit rows that carry no useful evidence
```

## Panel Ordering

Prefer:

```text
HERO P1
→ construction P1
→ construction P2
→ critical detail P1
→ critical detail P2
→ compact key pose only if still clearly readable
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

Generate one useful image/sheet in one pass by default. Use staged generation only when materially complex multi-view evidence cannot fit readably or a concrete output failure requires separating views. Do not invent extra images, 3D proxies or intermediate assets.

Proceed when:

```text
the user requested this image or edit
no decision-changing BLOCKING ambiguity remains
the concise visual brief is current (compile formally only when useful)
source evidence is preserved; optional creative defaults are not called source facts
scale and identity are resolved enough for the requested artifact
selected P1/P2 panels are readable and purposeful
critical rear/side/top/contact P1 coverage is planned or honestly UNKNOWN
omitted views rely on confirmed evidence, not assumed symmetry
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

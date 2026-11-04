# LazyDesigner Image Generation Prompt Contract

Updated: 2026-09-11

This document owns the internal prompt structure used by ChatGPT Reference Preparation for generated reference images. It converts already-confirmed decisions into a compact generation instruction; it does not replace user authority, the Prompt Compiler, or the Unified Image Reference Standard.

## Core Principle

```text
CURRENT USER IMAGE REQUEST
+ CLEAN VISUAL BRIEF (compiled when useful)
+ SOURCE-BACKED FACTS / REVERSIBLE CREATIVE DEFAULTS
+ SHEET PURPOSE
+ PANEL PLAN
+ IDENTITY LOCK
+ SCALE LOCK when material
→ GENERATION PROMPT
```

Never generate directly from the uncontrolled conversation when a compiled brief exists.

## Inputs

Use only the minimum relevant subset of:

```text
confirmed asset identity
reversible creative defaults for unspecified original-design details (if applicable)
selected profile
approved Minecraft/Blockbench target
explicit dimensions when relevant
player-relative scale anchor when relevant
required semantic parts
required materials/colors/markings
required asymmetry/orientation
required attachments/openings
required articulation/action
current sheet purpose
selected panel plan
approved prior-sheet identity + scale locks
source evidence when needed
```

Do not include rejected alternatives, unrelated discussion, system-development context, or MCP implementation instructions.

## Prompt Layers

Build prompts in this order:

```text
1. TARGET IDENTITY
2. VISUAL STYLE / RENDER LANGUAGE
3. IDENTITY LOCK
4. SCALE LOCK when material
5. SHEET PURPOSE
6. PANEL PLAN
7. PANEL-SPECIFIC EVIDENCE
8. CONSISTENCY RULES
9. NEGATIVE / DO-NOT-CHANGE RULES
10. PRESENTATION RULES
```

Identity and scale are established before local panel instructions.

## 1. Target Identity

One concise sentence.

```text
Create a Minecraft Bedrock / Blockbench reference sheet for a stylized fisherman NPC with a small bench, bucket and fishing rod.
```

For source-faithful reconstruction, do not invent lore, environment, accessories or source-specific detail. For an original creative request, restrained unspecified aesthetic choices are allowed when they do not contradict the intended Minecraft/Blockbench target; keep them provisional until reviewed.

## 2. Visual Style / Render Language

```text
Minecraft/Blockbench target only
Minecraft-stylized Blockbench cuboid model with purposeful layered geometry and hand-painted face texture
not a photorealistic product render or pixel-cube-per-texel sculpture
neutral studio-like lighting
light neutral background
high silhouette and edge clarity
readable material separation
consistent proportions across panels
minimal decorative styling
```

Do not embed the original real-world source into the final production sheet by default.

### Minecraft-Style Hand-Painted Cuboid Model Gate

The ChatGPT generator should interpret **Minecraft model style** as `MINECRAFT_STYLIZED_BLOCKBENCH` unless the user supplied or selected a different style. A second picture supplied as a *style example* controls the visual construction grammar, **not the source object's silhouette, dimensions or colors**. Separate the two image authorities explicitly.

```text
SUBJECT_SOURCE (what to model): source-object identity, major volumes,
proportions, distinctive functional parts and known materials/colors.
STYLE_EXAMPLE (how to render/model): cuboid piece density, controlled angular
contours, hand-painted pixel-art surface treatment, layered joints/trim,
contrast, and overall Minecraft/Blockbench game-asset visual language.
```

```text
MINECRAFT_STYLIZED_BLOCKBENCH
= composed primary cuboids + selected rotated layers/frames + purposeful
faceted transitions + intentionally visible block-derived depth
+ detailed hand-painted pixel clusters shaded ON model faces
!= smooth photorealistic car CGI or generic polished conventional low-poly
!= LEGO bricks, Minecraft world terrain, one raised mini-cube per pixel

CLEAN_BLOCKBENCH_FORM          = optional flatter/simpler appearance if requested
INTENTIONAL_VOXEL_BLOCK_ART    = optional regularly stepped blocks if requested
```

**Object-space lock:** preserve the source's true long/short proportions, part count, contact, and view-side attachments. Distinguish structural cuboids from painted face pixels; keep body panels purposeful and avoid cosmetic cube clutter. Make angular/rounded approximations plausible for Blockbench, but do not claim a perfect curved mesh or native export proof.

**Style repair without overcorrecting:** after a user rejects both pixelated block sculptures and smooth real-world product renders, target the **middle**: handcrafted Minecraft game-asset geometry with cuboid layering and painterly/pixel face texture, matching the actual style example. Do not replace it with an untextured low-poly object.

**Style-calibration delivery:** for a correction specifically about visual style, the *next generation* should default to one LARGE hero 3/4 object on a plain neutral or dark studio background. **NO INFOGRAPHIC**: no title, labels, material palette, dimensions, 16×7×7 claims, color-coded construction guide, detached part closeups, or extra front/back/side/top/bottom thumbnails. The hero is the whole reference for that call. Once style is reviewed, use the normal minimum-sufficient sheet/view rules only if construction needs them. Do not silently add an infographic because the word `reference` appeared.

An actual image model can ignore even correct instructions; its pixels still require after-generation inspection. If two targeted retries repeat the same layout defect, stop that direction rather than regenerate a third nearly identical sheet.

## 3. Identity Lock

Sheet 01 builds the lock from the confirmed brief and approved target evidence.

Sheet 02+ preserves:

```text
same asset identity
same required part count
same major silhouette
same materials/colors
same accessories/props
same asymmetry/orientation
same construction logic
same identity-critical markings
```

A user-approved change to a locked element is a revision; rebuild affected locks before generating dependent sheets.

## 4. Scale Lock

Include when scale materially affects world readability, interaction, occupancy, or proportion.

Use either/both:

```text
explicit dimensions_blocks
player_relative_scale
```

Rules:
- numeric dimensions remain numeric authority;
- player-relative scale preserves world/interaction relationship;
- never convert a relative category into invented block dimensions;
- Sheet 02+ preserves Sheet 01 apparent player/world scale and major-part proportions;
- detail panels may be enlarged for readability without implying a different underlying asset scale.

## 5. Sheet Purpose

One primary reason per sheet:

```text
MAIN_REFERENCE
DETAIL_REFERENCE
MOTION_REFERENCE
VARIANT_REFERENCE
```

`MAIN_REFERENCE` is default. Additional sheets exist only for real information/readability pressure.

## 6. Panel Plan

Use the Unified Image Reference Standard.

Default upper guidance:

```text
HERO                 1
CONSTRUCTION VIEWS   2–4
CRITICAL DETAILS     0–3
KEY POSES            0–5
```

Each included panel has:

```text
panel id
type
view / subject
purpose
priority: P1 | P2
```

A panel without downstream purpose is removed before generation.

### Surface Coverage Gate — Internal Panel Decision

Before compiling a panel list, apply the Surface Coverage Gate in `standard.md`. For each critical P1 region, identify the construction decision, what actual source or approved evidence proves it, whether a view can resolve a gap and why an omitted view is safe. This is a **temporary working inventory**, not a new package field or fixed six-view quota.

```text
SUPPORTED P1 region       → reuse its view and remove redundant panels.
UNKNOWN P1 source region  → do not invent rear/hidden source features; ask only if blocking the requested artifact.
PROVISIONAL original form → continue coherently across views but do not label source-observed.
CONFLICTING views         → correct the governing contradiction instead of averaging.
NO MATERIAL VIEW BENEFIT  → omit the panel and keep existing readable construction evidence.
```

A plain back is allowed when supported; a presumed symmetric back or opposite side is not evidence. An additional BACK, RIGHT, TOP, BOTTOM or detail view is justified by the specific unresolved build decision, not by a quota. Where a view cannot reveal unknown source geometry, retain UNKNOWN instead of generating a fictitious source-backed view. Escalate to Sheet 02 only if decision-critical P1/P2 content would otherwise be unreadable.

### ChatGPT Shared Object-Space Build Brief

Before sending a multi-view request to the **ChatGPT image generator**, compile one compact **internal** description of the unchanged object. For a one-view asset, retain only the facts that prevent important construction mistakes. This is a prompt-planning method, **not** a persisted scene graph, modelling engine, generated 3D mesh or new `REFERENCE.json` schema.

```text
INTENT          → faithful source reconstruction | new original design
IDENTITY        → one object, required parts and identity-bearing features
FRONT / SIDES   → front-identifying feature and OBJECT LEFT/RIGHT (not page directions)
PRIMARY VOLUMES → major masses and supported relative width/height/depth
CONNECTIONS     → what attaches, supports, overlaps or contacts what
NEGATIVE SPACE  → actual holes, gaps, arches or openings when evidenced
MATERIAL        → confirmed colors/markings on their actual owning surfaces
DEPTH READ      → evidence for real protrusion/recess vs paint, shadow or highlight
UNKNOWN         → source-hidden missing facts | original-design PROVISIONAL completion
LOCKS           → real approved visual, Scale Lock, side-specific marks and parts
```

Physical continuity is the central rule: if a mass is in the FRONT view, it is the **same mass** in SIDE/BACK/TOP, although its projection and occlusion change. The back is the reverse of one unchanged volume, not a mirrored second front; identity-bearing left/right features cannot switch object sides. A dark painted patch does **not** prove a hole. A highlight or cast shadow does **not** establish thickness, a bevel, or a new Cube. Do not convert stylistic shading into unsupported geometry.

For source-faithful reconstruction, unseen identity-critical structure remains UNKNOWN; never invent source-owned rear/underside topology. In open-ended original design, a restrained, coherent continuation may be PROVISIONAL until the user reviews it. Keep the chosen form consistent across views, and do not present it as an observed source fact.

Each panel contributes a single decision-focused instruction rather than another complete description of the object:

```text
<PANEL_ID> → <needed object-space camera or local detail> → <one P1/P2 build decision>
```

Pick the minimum useful set of views using the existing Surface Coverage Gate. FRONT, BACK, LEFT, RIGHT, TOP, BOTTOM and 3/4 are options—not quotas. Generate one readable sheet by default; only use Sheet 02+ when critical information cannot fit without shrinking or hiding it, preserving the actual approved Sheet 01 image as the visual anchor.

### ChatGPT Image-Generation Failure Targets

Apply a targeted negative only for the current material risk, not a long list of generic constraints:

```text
DUPLICATED_FRONT_AS_BACK → show real supported reverse-side form, never copy the front
SWAPPED_OBJECT_SIDES     → preserve object-left/right asymmetry and markings
PART_COUNT_DRIFT         → preserve primary mass and accessory counts in every view
FLOATING_OR_FAKE_CONTACT → preserve supported attachment and ground contact
SHADOW_AS_GEOMETRY       → distinguish paint/shading from actual voxel volume
UNREADABLE_PANEL         → enlarge decision-critical evidence; remove redundant details
SOURCE_HIDDEN_INVENTION  → UNKNOWN for source fidelity, PROVISIONAL for original design
```

Words can guide but **cannot guarantee true 3D consistency** or prove a generated image matches Minecraft geometry. Do not imply a hidden pre-display visual QA gate or a change to the underlying image model. Inspect actual generated pixels after the call and correct only observed defects.

## 7. Panel-Specific Evidence

### HERO

```text
whole identity
silhouette
volume/depth
major layering
primary attachment relationships
material separation
```

### CONSTRUCTION

```text
FRONT → width/height/part count/front identity
LEFT  → depth/profile/attachment/body axis
BACK  → rear topology/asymmetry when needed
TOP   → footprint/depth/layout when needed
RIGHT → asymmetry only when needed
```

### DETAIL

Only high-risk relationships not already clear in main views.

### KEY_POSE

Pose silhouette, action direction, contact, and articulation only. Do not encode final exact keyframe values in pixels.

## 8. Consistency Rules

Every prompt requires:

```text
same identity across panels
same apparent player/world scale across panels
same proportions across panels
same part count
same accessories
same approved materials/colors
same left/right orientation
same structural attachment logic
same selected Minecraft cuboid geometry density and hand-painted face-texture/detail language
```

Orthographic panels are views of one asset, not independently redesigned illustrations.


### ChatGPT Canonical View Lock — Multi-View Only

Use this small additional clause **only when two or more views of the same asset are requested**. It strengthens the existing Identity / Scale Locks; it is not a new generation mode, a 3D reconstruction claim, or a required intermediate image.

Before generation, resolve the few object-space facts needed by the selected panels:

```text
FRONT = the object's agreed facing direction, identified by <visible front feature>
OBJECT LEFT / OBJECT RIGHT = sides belonging to that same object, not page-relative directions
FIXED FORM = <major masses, part count, relative dimensions and contact/attachment relationships>
FIXED ASYMMETRY = <only confirmed side-specific part or marking locations, if any>
SELECTED VIEWS = <front / object-left / object-right / back / top / front-left 3/4, as needed>
```

Preserve observed/confirmed source facts for reconstruction. For original creative design, unspecified non-critical design choices may be provisional; keep them coherent across views. If the intended front/side is materially ambiguous, resolve it before generating dependent views rather than inventing a source-backed axis. If a hidden side of an existing reference contains unknown identity-critical structure, do not portray invented detail as approved fact. Ask when blocking; otherwise omit that view or label the interpretation provisional.

For a **single generated sheet**, pass one shared object-space description to all panels, rather than repeating independent descriptions per view. When an approved source sheet or image is already available for a continuation/correction, supply that *actual image* as the visual anchor whenever supported; a filename or prose summary is not equivalent.

Append a short, asset-specific clause such as:

```text
Draw ONE unchanged Minecraft/Blockbench asset, seen from the requested cameras.
FRONT points toward <front-identifying feature>; LEFT/RIGHT are the asset's own sides.
Keep <fixed masses / count / attachment> identical in every view.
Keep <confirmed side-specific feature> on the same object side; never mirror it.
Construction views use orthographic, non-perspective projection with consistent proportions.
Only the camera rotates between panels; do not rotate/mirror parts, add accessories,
or change the underlying 3D dimensions, attachments or form. A different projected
2D silhouette is EXPECTED when the view angle changes; do not force identical outlines.
```

Do not substitute a camera-label claim for actual geometry or calibrated projection. Text-only instructions improve direction but **cannot guarantee** true 3D consistency or recover hidden shape. Do not invent exact dimensions, angles, or occluded features from image pixels.

#### Cross-View Acceptance and Correction

Inspect the **actual generated panels** before calling a sheet usable, comparing the selected paired views for:

1. count and identity of major parts (including parts that disappear behind other parts);
2. consistent underlying width/height/depth relationships and relative spacing, allowing the projected 2D silhouette to differ by viewpoint;
3. the same attachment/contact topology, openings and negative spaces;
4. stable object-left/object-right asymmetry without mirroring;
5. unchanged identity-critical markings and selected Blockbench geometry language;
6. P1 rear/side/top/contact coverage is supported by actual images or remains explicitly UNKNOWN; no omitted view is silently counted as independent evidence.

Choose one bounded response based on visible evidence:

```text
CONSISTENT             → send for normal user review; not automatically approved
LOCAL VIEW DEFECT      → edit the existing image, naming CHANGE and PRESERVE
MULTI-VIEW CONTRADICTION → regenerate the affected sheet from the same locks
INSUFFICIENT EVIDENCE  → mark affected claim UNVERIFIED; do not invent a PASS
```

For an edit, identify the faulty panel and one concrete mismatch; preserve all unaffected panels and locked facts. When possible, compare the revised image with the actual previous approved image rather than a prose summary. A believable shadow is not evidence of real thickness or a new recess, and rear ornament cannot substitute for source-supported structure. Reinspect every panel touched by the edit, since image edits can affect unintended regions. Repeating the same failed correction direction twice without new evidence is a stop condition, not a reason to keep regenerating.

Do not create an extra sheet, proxy mesh, camera engine, part registry, or validation score to satisfy this clause. Metadata agreement is not visual PASS; missing P1 evidence blocks only its dependent modelling decision. A simple asset whose one view already answers the task does not need any multi-view work.

#### Panel-Level Review Evidence — Composite Sheets

When a sheet contains multiple panels, use the current **actual image** as the sole parent visual authority. Associate each review focus with its panel ID, current parent image/revision, intended object-space view and one specific P1/P2 decision. A panel label, crop, duplicated sheet file, or declared CAMERA name is not an independently verified view. Never add synthetic camera-specific `REFERENCE.json` entries by reusing the same composite bytes.

After generation, inspect the full sheet before zooming into decision-critical panels. Compare the paired panels against the *same* Identity/Scale and part/attachment locks; inspect whether FRONT/BACK and object LEFT/RIGHT labels correspond to their actual visible directions. If the necessary panel is too small, ambiguous or missing, mark the corresponding claim `INSUFFICIENT_EVIDENCE`; separate a view only when it is essential and retain the original approved identity. A real, supported plain back is valid.

After a bounded correction, re-ground panel focus locations against the **new image** and inspect every dependent panel plus the full composition for unintended changes. Do not carry old focus coordinates, prior-review results, source approval, or assumed unchanged pixels forward without actual evidence. No extra public tool, mandatory multi-view quota, similarity threshold or image classifier is introduced.

## 9. Negative / Do-Not-Change Rules

Use only likely current failure modes.

Common examples:

```text
no cropped subject
no extra/missing major parts
no cross-view proportion or scale drift
no mirrored asymmetry unless required
no floating attachments
no invented accessories
no real-image comparison panel
no decorative scene obscuring construction
no long explanatory text
no unnecessary palette/scale panel
no redundant view
```

Add asset-specific negatives only where they prevent a known high-risk error.

## 10. Presentation Rules

Adaptive composition:

```text
HEADER
HERO + CONSTRUCTION VIEWS
CRITICAL DETAILS when needed
MOTION STRIP when needed
```

Image text is limited to asset title, view labels, short detail labels, and short pose labels.

Remove unused rows and enlarge remaining evidence. If useful evidence becomes too small, escalate to Sheet 02+ rather than overpacking.

## Generation Modes

### Sheet 01 — Main Reference

```text
TARGET IDENTITY
+ VISUAL LANGUAGE
+ IDENTITY LOCK
+ SCALE LOCK when material
+ MAIN_REFERENCE purpose
+ minimum useful panel plan
+ consistency rules
+ targeted negatives
+ adaptive layout
```

### Sheet 02+ — Continuation

```text
APPROVED SHEET 01 AS VISUAL ANCHOR
+ exact same identity lock
+ exact same scale lock
+ one overflow purpose
+ only new required panels
+ explicit DO NOT REDESIGN / DO NOT RESCALE
+ repeated-view consistency
```

Do not regenerate later sheets from prose alone when approved Sheet 01 is available.

### Correction / Revision

```text
APPROVED CURRENT VISUAL
+ CHANGE
+ PRESERVE
+ affected panels
```

Use bounded editing when possible. A scale or identity change is a revision; propagate it coherently to every materially affected view.

## Source-Image Translation

```text
source image = evidence
compiled target = Minecraft interpretation decision
final production sheet = Minecraft/Blockbench target only
```

Preserve source-supported identity while simplifying to a buildable Minecraft visual language.

## Profile Influence

Profiles help identify high-value evidence but do not change the universal prompt structure. Include only profile conclusions relevant to planned panels; never dump the whole profile into the prompt.

## Pre-Generation Check

```text
blocking requirements resolved
current concise visual brief (compiled when materially useful)
direct generation/edit request authorized; explicit pre-generation approval honored only when requested
scale resolved enough for this artifact
sheet purpose justified
canonical FRONT / object-side orientation resolved when multi-view requires it
panel plan readable
all panels P1/P2
identity lock explicit
scale lock explicit when material
no superseded instruction remains
no fabricated source facts or overwritten approved design; creative defaults remain provisional
```

If any check fails, do not generate.

## Post-Generation Check

The image-generation tool may display its result immediately. This is an **after-generation inspection**, not a promise that ChatGPT can withhold a generated image until QA passes. Check the *actual visible output* when available; if the image cannot be inspected, mark visual claims UNVERIFIED rather than claiming PASS. Do not automatically regenerate for an unobserved defect.

```text
identity correct
player/world scale correct
part count correct
cross-view proportions consistent
visible multi-view side identity / attachments checked against the actual generated panels
attachments/openings consistent
materials/colors consistent
asymmetry preserved
critical details useful
motion poses preserve model identity + scale
labels minimal/correct
no redundant/decorative panel displaced useful evidence
```

For Sheet 02+, compare the actual output directly against the approved Sheet 01 image when accessible. If a visible material mismatch exists, use bounded CHANGE + PRESERVE editing where possible and reinspect touched panels; stop repeated corrections without new evidence. User review determines final reference approval.

## Economy Rule

Use the shortest prompt that reliably preserves all decision-critical authority.

Prefer structured clauses, panel-specific facts, identity/scale locks, and a small targeted negative list. Avoid conversation transcript, repeated profile prose, generic art-direction paragraphs, implementation instructions, and duplicate facts.

## Completion

The prompting layer is correct when raw conversation no longer contaminates generation, scale and identity remain stable across sheets, panel selection stays decision-driven, corrections remain bounded, and the generator receives enough structure without unnecessary context.

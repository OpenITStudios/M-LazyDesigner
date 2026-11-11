---
name: lazydesigner-reference-preparation
description: In-use ChatGPT reference-preparation router for LazyDesigner. Resolve only decision-changing requirements, select exactly the needed visual/pixel-art/particle branch, coordinate review, and package only when requested. Do not use for repository/plugin development, Blockbench mutation, or normal Codex asset-authoring stages.
---

# LazyDesigner Reference Preparation

## Activation Contract

```text
LANE: IN_USE
DOMAIN: REFERENCE_PREPARATION
CLASS: ROUTER
OWNER: REFERENCE_CAPABILITY_SELECTION
```

Enter for preparing reference evidence before optional downstream authoring. Select only the branch that materially changes the next decision; do not preload siblings. Do not inspect or modify LazyDesigner implementation source because a reference result is weak. Proven system defects cross lanes through a bounded `DEVELOPMENT_HANDOFF`; ordinary reference-quality correction stays in this lane.


Single ChatGPT-side orchestration authority for preparing references before optional downstream Codex/LazyDesigner authoring. It routes to existing canonical owners rather than duplicating them.

## Route

```text
USER REQUEST → REQUIREMENT GATE (only BLOCKING unknowns)
→ PROMPT COMPILER if normalization helps → CLASSIFY CAPABILITY:
  VISUAL / MODEL → generate image reference → QA / user visual acceptance
  PIXEL ART → lazydesigner-pixel-art-authoring → grid/palette QA
  PARTICLE / VFX → lazydesigner-particle-reference-authoring → VFX QA
  COMPOSED → minimum required branches, each retaining ownership
→ PACKAGE ONLY WHEN REQUESTED → consistency check when handing off
```

Do not require ceremonial confirmation for non-blocking visual or particle choices.

## Canonical owners

Load only the branch owner that can change the next decision:

```text
reference flow/policy → docs/02-reference/flow.md + policy.md
visual/model          → docs/02-reference/image/README.md
pixel art             → lazydesigner-pixel-art-authoring + docs/02-reference/pixel-art/README.md
particle/VFX          → lazydesigner-particle-reference-authoring + docs/02-reference/particle/README.md
package/handoff       → docs/02-reference/package/README.md
```

Prompt normalization is delegated to `lazydesigner-prompt-compiler`. Do not preload branch corpora or maintain parallel copies of their detailed contracts here.

## Boundary

Reference Preparation owns requirement clarification, branch selection, visual/model reference coordination, specialist delegation, review coordination, and package gating.

It does **not** own Blockbench Geometry/Texturing/Animation mutation, exact Cube/pivot/UV plans, Runtime Tool planning, MCP/Gateway implementation, or unobserved Minecraft/Blockbench truth.

## Input authority

Accept text, user image(s), text + image(s), previously approved references, or bounded corrections.

Resolve facts in this order:

```text
explicit current user requirement
→ visible source evidence
→ approved prior target decision
→ canonical branch rules
→ unresolved remains UNKNOWN
```

Never infer numeric scale from pixels. Never silently average materially conflicting evidence.

## Requirement gate

Classify unknowns as `BLOCKING | USEFUL | OPTIONAL`. Ask only when the missing fact changes identity, primary structure, scale/view, articulation, grid/style mode or another material branch decision. Never require users to decide topology, pivots, UV, Molang or prompt-engineering internals.

### Pixel-art fast path

When no BLOCKING pixel-art unknown remains, delegate directly to `lazydesigner-pixel-art-authoring`. The word `pixel` alone is insufficient; Blockbench texture atlas/UV/Painter mutation belongs to `lazydesigner-texturing`.

### Particle-only exception

No ceremonial pre-confirmation when no BLOCKING ambiguity remains. When unblocked, delegate to `lazydesigner-particle-reference-authoring`; mark reversible non-blocking choices `PROVISIONAL`, never invent hidden geometry, runtime truth, or performance.


### Original-concept artistic direction (conditional)

When the user requests a **new original visual design**, apply the existing [professional art reasoning](../../../docs/02-reference/art-direction.md#professional-visual-reasoning---original-design-versus-faithful-reconstruction): define one identity-bearing silhouette, supporting material/value hierarchy, focal accent and optional motion personality before generating the image. Only compare two concise concept directions if the ambiguity materially changes identity or later construction. These are **provisional creative choices**, not facts from an unseen reference; accepted visual output establishes authority after user review.

When the user supplies an **approved reference** or requests a bounded correction, preserve it rather than performing an unsolicited redesign. Reference examples and marketplace images are craft study, not approved motifs or hidden geometry. Do not generate a set of extra preview images, require new approval ceremony or add new runtime tools.

## Prompt compiler

After blocking information is resolved, use `lazydesigner-prompt-compiler` when normalization materially helps.

The compiler may organize, normalize wording, remove superseded directions, and deduplicate. For new creative concepts it may supply reversible appearance defaults, not source facts. It may not override a supplied image, invent numeric scale from pixels, or present unsupported source anatomy, topology, material or identity as observed.

The compiled brief is internal working state and is not exported by default.

## Visual/model generation authorization and review

When the user requests an image or edit and no BLOCKING ambiguity remains, **generate directly**; the request itself authorizes a first pass. Do not add a second confirmation for a clear request, minor design choice, or user-requested revision.

For a genuinely blocking ambiguity, ask the smallest decision-changing question. For an explicitly requested approval-first workflow, present a concise target summary and await the user's answer; silence does not constitute approval. This is not a default visual/model gate.

Review/approval of the **resulting image** is separate: an unreviewed generation cannot silently replace a previously approved visual authority. Pixel Art and Particle retain their independent routes and review needs.

## Visual/model branch

When an approved **single-view** source reference contains a decision-critical
object region, optional `REFERENCE.json images[].regions` may bind an
annotated normalized image box to a known `parts[].id`, explicit
`PRIMARY_VOLUME | SURFACE_DETAIL | CONTACT | NEGATIVE_SPACE` role and
`DIRECT | PARTIAL | OCCLUDED` visibility. Do **not** generate 16 boxes
by default or annotate a composite turnaround sheet as if it were one
camera. A fully occluded region has no box and no invented hidden geometry.
This is source-image evidence for the downstream reviewer, not running
Grounding DINO/SAM, user approval or a Blockbench Cube plan.

For a completed **3D MODEL** construction reference, require the four cardinal object views **FRONT, RIGHT, BACK, LEFT** on a balanced 2×2 sheet **captured from ONE actual Blockbench model**. The native camera/compositor owns those four pixels and layout, not the ChatGPT image generator. A single HERO/style preview or four independent illustrative images alone are insufficient for verified construction. Keep other modules `CONCEPT | TURNAROUND | STRUCTURAL_DETAIL | MATERIAL_TEXTURE | RIG_DEFORMATION | POSE_ACTION | EXPRESSION_FACE | ANIMATION_KEYFRAME` conditional; **do not generate every module by default**.

`docs/02-reference/image/standard.md` owns panel economy and layout; `scale-and-escalation.md` owns player/world scale and multi-sheet escalation; prompt construction remains in `prompt-contract.md` + `master-templates.md`.

Apply the **Surface Coverage Gate** owned by `docs/02-reference/image/standard.md` before selecting panels and again after inspecting the actual generated pixels. Keep a temporary P1 inventory for silhouette, rear/side construction continuity, contacts/openings and identity-critical material or articulation; select only views that resolve material decisions. A single HERO is not a complete construction sheet, even if useful for a bounded style decision; a full 3D MODEL reference requires all four cardinal views. Source-backed hidden structure stays UNKNOWN and blocks only the dependent decision; original-design continuation may be PROVISIONAL pending review. An invented back, assumed symmetry, composite sheet or manifest status is not independent visual proof. Do not add a new schema, tool, or mandatory six-view ritual.

Sheet 01 is the identity/scale anchor when a sheet workflow is needed; Sheet 02+ exists only for real information overflow. Every panel must reduce Geometry, Texture, or Animation ambiguity. Corrections use **CHANGE + PRESERVE against approved authority**.

A generated visual becomes approved visual authority only after explicit user acceptance when visual approval is material.


**Quality-before-archive gate:** use `standard.md#quality-acceptance-firewall--model-value-before-presentation` to review actual source/output **identity → Minecraft/Blockbench craft → physical part/weapon/shield attachment across four sides → presentation**. P1 failure stops positive exemplar promotion; hashes, labels or a cropped poster cannot cure it. Preserve failed imagery only as rejected historical negative QA on explicit request, never as an approved/backup style or presentation example. Distinguish unknown source back from observed inconsistent grip or geometry. No automatic model/native proof.

**Geometry-first production handoff:** classify a request for a reliable/built-from-one-model four-side sheet as `NATIVE_4V`, distinct from `ILLUSTRATIVE_CONCEPT`. If an authored Blockbench model and live native MCP tool are available, call `capture_model_views` once with `views: ["front","right","back","left"]`, the explicitly supported `front_direction`, `framing: { mode: "model" }` and `size: 512`. The tool preserves four orthographic source captures and returns a deterministic `four_side_sheet` PNG and receipt when project/freshness/PNG evidence matches. Check `state: AVAILABLE` and matching evidence freshness before *visual review*. The receipt explicitly retains `authoring_ready: false` and `visual_verdict: NOT_EVALUATED`; NEVER claim model-fidelity, source-back accuracy, animation, UV or Bedrock approval solely from it.

When no actual Blockbench model or LIVE_BLOCKBENCH connection is available, do **not** invoke ChatGPT image generation again to fabricate a production four-side model. Provide the concise source-anchored brief and `NATIVE_MODEL_REQUIRED` dependency for existing Geometry authoring; this is a legitimate bounded handoff, not permission to ask for localtest repeatedly or create a fake model. A user who explicitly asks only for an illustrative image may still select `ILLUSTRATIVE_CONCEPT` under the unchanged bounded image QA (P0/P1) and must not receive a claim of native 3D consistency. Preserve the independent Pixel Art/Particle paths.



### Builder-Learned Execution Discipline

Use the versioned `M-LD-REF / 1.3` invocation in `docs/02-reference/image/master-templates.md` for ChatGPT model-reference generation. Explicitly separate `SUBJECT_SOURCE`, `STYLE_EXAMPLE`, `PRESENTATION_EXAMPLE` and `APPROVED_TARGET` roles: a style example never supplies the object's identity, and presentation samples supply layout only. Only call an exemplar loaded when its **actual image pixels** are available; GitHub catalogs, image IDs and hashes are insufficient. A missing pixel exemplar leaves visual-match claims `UNVERIFIED`.

Take from M-LazyBuilder EX-REF-02/03 the restrained balanced four-side layout as the DEFAULT completed 3D MODEL sheet, never its house architecture or material motifs. **Never route a selected four-side reference or its style correction to HERO.** HERO is permitted only after an explicit single-view user request. Compile the image call using **only** the isolated `FOUR_SIDE_IMAGE_PROMPT_BEGIN`/`FOUR_SIDE_IMAGE_PROMPT_END` payload in `master-templates.md`, filled with source-backed facts; never send the full multi-mode contract, old poster prompts or rejected Roman example. Examine the actual result for P0 shape before P1 identity, Minecraft craft, equipment contacts and physical consistency. A fifth view or poster section is `P0_FORMAT_FAIL`; do not crop and promote it. Allow one bounded `CHANGE + PRESERVE` correction, then STOP if the same defect recurs.

No new runtime, schema, automatic scorer, global approved sample corpus or installed Project is implied. Existing static source checks validate authored contracts only; visual-quality improvement and native Blockbench output remain **UNVERIFIED** without real tests.

**Five-pair visual QA:** inspect actual FRONT ↔ RIGHT, RIGHT ↔ BACK, BACK ↔ LEFT, LEFT ↔ FRONT and RIGHT ↔ LEFT physical continuity following `standard.md`. Check corners, part counts, contacts, handedness and source-hidden uncertainty before declaring reference-stage READY. Unequal panel pixel widths are acceptable; they cannot justify changed object proportions. A label-only composite is not a set of calibrated 3D views and does not establish native Blockbench PASS.


### ChatGPT Image Generator execution path

In the **ILLUSTRATIVE_CONCEPT** route, **ChatGPT is the image-generation actor** and M-LazyDesigner/Blockbench is the downstream consumer, not the image generator; follow the shared object-space brief in `prompt-contract.md` and the bounded image QA. In the **NATIVE_4V** route, a real model is the source and existing Blockbench `capture_model_views` is the rendering actor; do not substitute image-generation prompts or claim a model exists from four illustration panels. Native capture does not fix an incorrectly built model; the subsequent visual/source QA still owns that decision. Do not route a merely weak illustration into MCP development without a proved runtime defect.

```text
USER IMAGE REQUEST + SOURCE / APPROVED VISUALS
→ resolve only BLOCKING facts; distinguish source fidelity from original creation
→ inspect actual accessible SUBJECT_SOURCE / STYLE_EXAMPLE / PRESENTATION_EXAMPLE pixels separately
→ compile one shared object-space build brief (volumes, contacts, voids, surfaces)
→ classify output: NATIVE_4V verified-model construction vs ILLUSTRATIVE_CONCEPT image-only
→ NATIVE_4V: if no actual native model, hand off source brief as NATIVE_MODEL_REQUIRED to Geometry, STOP reference generation; if connected, capture four native views and inspect four_side_sheet
→ ILLUSTRATIVE_CONCEPT only: use selected bounded image payload, never claim native 3D source
→ lock FOUR_SIDE_CONSTRUCTION for four-side requests and all their style corrections; select HERO only for an explicit single-view request
→ invoke image generation once when authorized using only the selected isolated output payload, never a mixed-mode master or rejected poster prompt
→ review ACTUAL source/output pixels for P1 identity, Minecraft craft, physical four-view contacts and only then P2 presentation
→ if a visible material defect exists, bounded CHANGE + PRESERVE image correction
→ reinspect all affected panels; any remaining P1 failure is REJECTED_VISUAL_QUALITY for positive reference use
→ obtain user approval only for a supported visual candidate; package ONLY when explicitly requested
```

Keep the underlying object fixed across panels; only the view and visibility change. Do not confuse a dark painted patch with an opening, shading with a protrusion or a front-facing feature with a backside feature. For source reconstruction, unknown hidden features remain UNKNOWN; for an original creative request, optional plausible completions remain PROVISIONAL until reviewed. An approved prior sheet/image should be supplied as the **actual visual anchor** for correction/continuation whenever possible; filenames and prose are insufficient replacements.

Review actual generated pixels after generation using the quality acceptance firewall; a beautiful composite is not a quality PASS. A generative image may become visible to the user before inspection. Never claim a hidden pre-display quality pass. These Skill instructions do not change image-model weights, execute automatic pixel inspection, or themselves prove visual correctness.

### Minecraft-Style Blockbench 3D — Source and Style Separation

For VISUAL / MODEL references requested in Minecraft style, default to `MINECRAFT_STYLIZED_BLOCKBENCH` from `docs/02-reference/image/standard.md`: intentionally constructed cuboid shapes, layered and rotated details, appropriate angular/faceted contours, with **hand-painted pixel-art textures on the model's faces**. Do not render a smooth photorealistic vehicle or a plain conventional low-poly product just because the user rejected a mini-cube grid. Equally, do not make a physical Cube out of every texture pixel.

When given a real-object photo plus a stylized Minecraft example, treat the photo as **subject identity authority** and the other image as **style-only authority**. Preserve the original object's proportions, major components and color unless the user authorizes a change; never copy the example's unrelated model silhouette or accessories. An example showing layered panels and hand-painted shading is not an instruction to reproduce hundreds of tiny world blocks.

**Reference learning rule:** when a user says the result looks like "AI-slop", do not compensate by making the render busier or immediately generating a third near-identical image. Inspect the actual style reference at whole-asset and local material/structural detail scale, then classify whether the first failure is MACRO silhouette, MESO geometry, MICRO texture distribution, material separation, false structural highlights, style/subject identity mixing, or infographic presentation. Use the evidence-led style fingerprint in `standard.md`: physically meaningful parts versus painted color clusters, asymmetric purposeful detail, and visibly quiet surfaces. Only promote observed **generalizable style principles**, not the sample's own color scheme, accessories or dimensions. Consult official Blockbench/Minecraft-style guidance when it changes the decision, but remember that vanilla constraints are not automatically binding for a distinct stylized example.

This is skill/prompt **learning**, not weight training or a guarantee that future image generation will obey the instructions. Static repository checks establish consistent wording, not actual improved visual quality. If the next correction is a repeat of an already-failed approach, stop and explain the unresolved visual mismatch instead of issuing another blind generation.

**Repair style within the selected output:** an existing or requested four-side model stays FRONT/RIGHT/BACK/LEFT throughout correction; never make a separate HERO as a default repair. Use the isolated one-view template only for explicit single-view user intent; that output is not a completed 3D construction reference. Reject repeated poster extras and stop instead of cropping to fabricate success. Never invent dimensions from a photograph.

Use actual source images as anchors for CHANGE + PRESERVE, inspect the pixels after generation, and stop repeated same-direction failure after two attempts instead of hiding the fault with a larger poster. Native Blockbench fidelity and real exportability remain separate downstream proof.

## Pixel-art branch

Delegate deliberate integer-grid icons, object/prop pixel art, sprites, tiles/patterns, reference conversion, and Minecraft-native/MIVUBI HD pixel references to `lazydesigner-pixel-art-authoring`.

Do not preload smooth image-reference modules for pixel-art-only work. Pixel Art may hand a visual artifact to Texturing or Particle, but ownership immediately returns to the consuming specialist for UV/atlas or particle runtime semantics.

## Particle/VFX branch

Delegate standalone Bedrock/Snowstorm particle-reference authoring to `lazydesigner-particle-reference-authoring`. Image/model references are optional evidence, never a mandatory prerequisite.

A validated `.particle.json` + required texture can stop at review. Manifest/README/ZIP/`REFERENCE.json` are delivery outputs and are not created merely because first-pass authoring completed.

## Package gate

Package only when the user explicitly requests handoff/package delivery or it is already unambiguous in the current instruction. Otherwise stop at the reviewed branch artifact.

Visual/model packaging uses `docs/02-reference/package/`; Pixel Art follows its selected delivery contract; Particle follows `docs/02-reference/particle/delivery.md`. Do not export conversation history, scratch QA, duplicate bootstrap files, or unrelated branch artifacts.

## Unknown / readiness rule

Unknowns stay explicit. Readiness is stage-specific:

```text
READY
NOT_REQUIRED
NEEDS_REVIEW
BLOCKED
```

Missing information in one branch must not block an independent branch unless it changes that branch's actual decision.

## Completion

Reference Preparation is complete when:
- blocking information for the selected branch is resolved;
- explicitly requested pre-generation approval is honored, if applicable;
- only required reference capabilities were used;
- branch-specific QA is complete at the available proof ceiling;
- any requested package passes its consistency contract;
- no unsupported fact was invented.

Then stop. Downstream implementation belongs to Codex/LazyDesigner authoring Skills.

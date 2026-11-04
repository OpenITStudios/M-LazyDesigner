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

Use the minimum evidence that reduces downstream uncertainty. Possible modules remain `CONCEPT | TURNAROUND | STRUCTURAL_DETAIL | MATERIAL_TEXTURE | RIG_DEFORMATION | POSE_ACTION | EXPRESSION_FACE | ANIMATION_KEYFRAME`; **do not generate every module by default**.

`docs/02-reference/image/standard.md` owns panel economy and layout; `scale-and-escalation.md` owns player/world scale and multi-sheet escalation; prompt construction remains in `prompt-contract.md` + `master-templates.md`.

Apply the **Surface Coverage Gate** owned by `docs/02-reference/image/standard.md` before selecting panels and again after inspecting the actual generated pixels. Keep a temporary P1 inventory for silhouette, rear/side construction continuity, contacts/openings and identity-critical material or articulation; select only views that resolve material decisions. A single view is sufficient when its evidence is sufficient. Source-backed hidden structure stays UNKNOWN and blocks only the dependent decision; original-design continuation may be PROVISIONAL pending review. An omitted back, assumed symmetry, composite sheet or manifest status is not independent visual proof. Do not add a new schema, tool, or mandatory multi-view ritual.

Sheet 01 is the identity/scale anchor when a sheet workflow is needed; Sheet 02+ exists only for real information overflow. Every panel must reduce Geometry, Texture, or Animation ambiguity. Corrections use **CHANGE + PRESERVE against approved authority**.

A generated visual becomes approved visual authority only after explicit user acceptance when visual approval is material.

### ChatGPT Image Generator execution path

In the **VISUAL / MODEL** route, **ChatGPT is the image-generation actor** and M-LazyDesigner/Blockbench is the downstream consumer, not the image generator. Reuse the shared object-space brief in `prompt-contract.md`, the existing minimum-useful panel plan, and `master-templates.md`. Do not route a merely weak generated image into MCP/Control development without a proved integration defect.

```text
USER IMAGE REQUEST + SOURCE / APPROVED VISUALS
→ resolve only BLOCKING facts; distinguish source fidelity from original creation
→ compile one shared object-space build brief (volumes, contacts, voids, surfaces)
→ select minimum useful camera directions and panel-specific evidence targets
→ invoke image generation once when authorized using the compact compiled prompt
→ review ACTUAL generated pixels after generation for form, sides, material, P1 coverage
→ if a visible material defect exists, bounded CHANGE + PRESERVE image correction
→ reinspect all affected panels, then obtain user visual approval as appropriate
→ package ONLY when explicitly requested
```

Keep the underlying object fixed across panels; only the view and visibility change. Do not confuse a dark painted patch with an opening, shading with a protrusion or a front-facing feature with a backside feature. For source reconstruction, unknown hidden features remain UNKNOWN; for an original creative request, optional plausible completions remain PROVISIONAL until reviewed. An approved prior sheet/image should be supplied as the **actual visual anchor** for correction/continuation whenever possible; filenames and prose are insufficient replacements.

A generative image may become visible to the user before inspection. Never claim a hidden pre-display quality pass. These Skill instructions do not change image-model weights, execute automatic pixel inspection, or themselves prove visual correctness.

### Minecraft-Style Blockbench 3D — Source and Style Separation

For VISUAL / MODEL references requested in Minecraft style, default to `MINECRAFT_STYLIZED_BLOCKBENCH` from `docs/02-reference/image/standard.md`: intentionally constructed cuboid shapes, layered and rotated details, appropriate angular/faceted contours, with **hand-painted pixel-art textures on the model's faces**. Do not render a smooth photorealistic vehicle or a plain conventional low-poly product just because the user rejected a mini-cube grid. Equally, do not make a physical Cube out of every texture pixel.

When given a real-object photo plus a stylized Minecraft example, treat the photo as **subject identity authority** and the other image as **style-only authority**. Preserve the original object's proportions, major components and color unless the user authorizes a change; never copy the example's unrelated model silhouette or accessories. An example showing layered panels and hand-painted shading is not an instruction to reproduce hundreds of tiny world blocks.

**Repair a rejected style before expanding views:** produce one isolated large 3/4 HERO with a plain dark/neutral studio background and no infographic, dimensions, labels, parts legend, palettes, wireframe or extra thumbnails. The style check is a single-panel evidence decision in the existing workflow, not a new artifact type or mandatory additional generation for ordinary accepted work. Only after the user accepts the style, provide minimum-sufficient orthographic views if useful. Never invent numeric dimensions from the source photograph or style image.

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

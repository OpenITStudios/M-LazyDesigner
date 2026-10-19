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

Sheet 01 is the identity/scale anchor when a sheet workflow is needed; Sheet 02+ exists only for real information overflow. Every panel must reduce Geometry, Texture, or Animation ambiguity. Corrections use **CHANGE + PRESERVE against approved authority**.

A generated visual becomes approved visual authority only after explicit user acceptance when visual approval is material.

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

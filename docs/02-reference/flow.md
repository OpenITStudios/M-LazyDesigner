# LazyDesigner ChatGPT Reference Flow

Updated: 2026-09-12

This document owns the ChatGPT-side operational sequence before an asset reference is handed downstream. Durable policy lives in `policy.md`; image construction lives under `image/`; particle/VFX reference authoring lives under `particle/`; compact Codex package structure and consumption live under `package/`.

## Objective

Convert incomplete or casual user intent into an internally clean reference target without requiring the user to understand prompting, topology, UV, rigging, particle JSON, or package terminology.

## Canonical User Flow

```text
USER REQUEST
→ UNDERSTAND
→ REQUIREMENT GATE
→ missing BLOCKING information?
   ├─ YES → ASK SIMPLE QUESTIONS → USER ANSWERS → GATE AGAIN
   └─ NO
→ PROMPT COMPILER when normalization helps
→ CLEAN VISUAL BRIEF
→ CLASSIFY REQUIRED REFERENCE CAPABILITY
   ├─ visual/model only
   │  → ASK only for unresolved BLOCKING choices or requested pre-generation review
   │  → otherwise GENERATE through image/
   ├─ particle/VFX only
   │  → particle/authoring-spec.md
   │  → no ceremonial pre-confirmation when no BLOCKING ambiguity remains
   │  → particle first-pass authoring
   └─ both
      → use each branch only for the dependency it actually owns
→ BRANCH-SPECIFIC INTERNAL QA
→ USER REVIEW / CORRECTION when material
→ PACKAGE ONLY WHEN EXPLICITLY REQUESTED OR UNAMBIGUOUSLY PART OF THE REQUEST
→ CONSISTENCY GATE when packaging/handoff exists
→ DOWNSTREAM USE / CODEX / MCP when requested
```

## 1. Understand

Resolve only what is supported by current intent/evidence:

```text
asset/effect identity
required capability: visual/model, particle/VFX, or both
task: new / continuation / correction
source/reference authority
scale or viewing distance when known
animation or motion requirement
critical parts/actions/materials/style
still-valid approved prior decisions
```

Do not invent missing facts.

## 2. Requirement Gate

Classify missing information:

```text
BLOCKING
USEFUL
OPTIONAL
```

`BLOCKING` must be resolved when the answer can materially change identity, primary structure, scale/viewing distance, required articulation/motion, or another major output decision.

`USEFUL` is asked only when it is likely to materially improve correctness. `OPTIONAL` does not block a first pass.

For visual/model references, scale follows `image/scale-and-escalation.md`. For particle/VFX tasks, intent normalization and reversible provisional choices follow `particle/authoring-spec.md`.

## 3. Independent Capability Rule

Reference branches are optional and independent.

```text
particle request only
→ particle/
→ do not generate image/model references unless explicitly requested or materially required

visual/model request only
→ image/
→ do not author particle assets unless explicitly requested

combined request
→ use both branches only for requested/material dependencies
```

Do not force a visual reference step before particle authoring. A particle can be authored directly from text, an existing visual/reference source, or a sufficiently resolved effect brief.

## 4. Simple Question Rule

Ask the fewest basic, immediately answerable questions.

Good:
- "Ukurannya sekitar setinggi pinggang player, setinggi player, atau lebih tinggi?"
- "Kendaraannya cukup untuk 1 player atau 2 player?"
- "Bagian mana yang perlu bergerak?"
- "Particle ini terutama dilihat dari dekat atau sekitar puluhan blok?"
- "Efeknya sekali meledak atau terus looping?"

Do not ask the user for topology, pivot ownership, UV strategy, Molang implementation, deformation terminology, or a better prompt.

## 5. Prompt Compiler

After blocking information is resolved, run `.agents/skills/lazydesigner-prompt-compiler/SKILL.md` when normalization materially helps.

```text
raw user intent
+ confirmed answers
+ approved prior decisions
+ source/reference facts
→ CLEAN PRODUCTION BRIEF
```

Rejected or superseded directions are removed. The compiler may organize source-backed requirements and reversible creative defaults. It may not fabricate observed source facts, override approved visuals, or invent exact dimensions from pixels. When the user asks for a new design rather than a faithful reconstruction, reasonable unsupplied colors/materials/details are creative choices, not claims about the source.

The compiled brief is internal working state and is not a default handoff file.

## 6. Branch-specific confirmation

### Visual / model reference

A direct request to create or edit a reference image **already authorizes that generation**. If no decision-changing BLOCKING unknown remains, generate the first useful image without a ceremonial confirmation. Use reasonable, reversible creative defaults for unspecified details of a new concept; do not promote them to observed source facts.

Ask one concise question only when an unresolved decision would materially change the intended identity, required source fidelity, scale, or orientation. If the user explicitly requests a plan or approval before generation, show the bounded target summary and honor that requested review. Do not treat silence as approval in that case.

Approval of the **generated image as reference authority** is a separate, subsequent user decision when material. A user-requested correction authorizes the edit without another confirmation unless the correction itself introduces a new blocking conflict.

### Particle / VFX reference

Particle-only work uses the dedicated fast path:

```text
BLOCKING ambiguity remains
→ ask the minimum decision-changing question

no BLOCKING ambiguity remains
→ do not request ceremonial pre-confirmation
→ use reversible PROVISIONAL choices for non-blocking unknowns
→ author the first particle pass
→ static QA
→ user review in the target environment when material
```

This exception prevents a simple request such as `buat particle api biru` from being stopped by an image-oriented confirmation ceremony. It does not permit inventing hidden geometry, exact runtime behavior, performance truth, or other blocking facts.

## 7. Reference Capability Branches

### Visual / model reference

Use `image/README.md` and choose only modules that materially reduce downstream uncertainty:

```text
CONCEPT
TURNAROUND
STRUCTURAL_DETAIL
MATERIAL_TEXTURE
RIG_DEFORMATION
POSE_ACTION
EXPRESSION_FACE
ANIMATION_KEYFRAME
```

Do not generate every module by default.

### Particle / VFX reference

Use `.agents/skills/lazydesigner-particle-reference-authoring/SKILL.md` and `particle/README.md`.

Typical authored resources may include:

```text
Bedrock .particle.json
particle textures / atlases when required
static/preflight QA
```

A Resource Pack/ZIP, README, manifest, or `REFERENCE.json` is delivery output and is created only when packaging/handoff is requested. Image reference output is not a prerequisite for this branch.

## 8. Generate + Internal QA

Generation uses the smallest branch-ready authority set, not the uncontrolled full conversation.

Visual/model **illustrative concept** generation uses a concise current brief (compiled when useful), any actual source/reference image, and a scale lock when material. Keep source-observed facts distinct from creative design defaults. A clear image-only request may proceed directly, but its output is not a verified 3D construction reference.

**Production four-side exception — geometry first:** when the user needs a buildable/consistent Minecraft Blockbench model reference in Front/Right/Back/Left, do not repeatedly invoke image generation to invent four coherent physical views. If a real Blockbench model is already present and the native Runtime is connected, use the existing `capture_model_views` tool once with explicit views `["front","right","back","left"]`, an agreed `front_direction`, and `framing: { mode: "model" }`. Its deterministic 2×2 sheet is a same-model presentation derived from those four captured PNGs, never an AI-generated fifth view. Review actual source likeness, model geometry/texture and tool/shield contacts independently; receipt `AVAILABLE` is not visual PASS.

If no real model or LIVE_BLOCKBENCH access exists, the independent ChatGPT reference task stops at a source-grounded brief with `NATIVE_MODEL_REQUIRED` for the Geometry owner. Preserve confirmed shape/part/scale facts and meaningful uncertainties; do not declare a final four-side image from a speculative poster or ask for endless local tests. Existing authoring can continue separately with user authorization. A one-view photograph cannot prove unseen geometry; authored completions remain PROVISIONAL. Do not use an empty proxy model, edited crop or a source-string test to manufacture readiness. The Pixel Art and Particle routes are unchanged.

Particle/VFX authoring uses the normalized particle brief with BLOCKING ambiguity resolved, the minimum required particle knowledge owner(s), and reversible provisional choices where allowed.

Visual/model references use image QA. Particle/VFX references use `particle/qa.md` and only the gates relevant to the authored effect.

## 9. User Review / Correction

A generated image or particle becomes approved reference authority only after explicit user acceptance when visual/runtime review is material.

For correction:

```text
USER DELTA
→ compile CHANGE + PRESERVE when useful
→ resolve only new blockers
→ clarification or pre-generation review only when explicitly needed
→ bounded correction
→ causal QA
→ user review
```

Preserve unaffected approved authority.

## 10. Package Generation Gate

Create package files only when package generation is explicitly authorized or already unambiguously requested in the current instruction.

Authoring a first particle pass does not by itself authorize a final Resource Pack ZIP. Do not create optional files or another reference branch merely to complete a template.

## 11. Package Build

### Visual/model package

Canonical package:

```text
asset_reference/
├── REFERENCE.json
├── GEOMETRY.md
├── TEXTURE.md      ← only when useful
├── ANIMATION.md    ← only when useful / required
└── images/
    └── approved/supporting reference images
```

Canonical owners remain under `package/`.

### Particle/VFX package

Follow `particle/delivery.md` only after package/handoff intent is known. Standalone delivery is an ordinary Bedrock Resource Pack folder/ZIP. `REFERENCE.json` is added only for explicit LazyDesigner/Codex/MCP handoff.

Do not add image-reference files unless they are actually part of the particle request. Do not export the compiled production prompt, conversation transcript, duplicate bootstrap files, or internal scratch QA.

## 12. Package Consistency Gate

Before handoff verify the package-specific contract.

```text
all listed/referenced files exist
identifiers/paths agree
no unsupported facts were introduced
omitted optional files are not referenced
blocking unknowns are resolved or explicitly preserved
```

Fix package plumbing internally. Ask the user only when a real requirement conflict needs their decision.

## 13. Downstream Handoff

For visual/model references, consumption is defined by `package/load-contract.md`.

For particle/VFX references, the clean Resource Pack or canonical particle `REFERENCE.json` package is the handoff boundary only when downstream handoff is requested. Codex/MCP should not need the original ChatGPT transcript or a separate image-reference package.

## 14. Authority Order

```text
explicit current user requirement
→ approved branch-specific reference
→ confirmed scale/view-distance requirement when material
→ canonical branch rules
→ downstream interpretation
```

The compiled brief organizes generation but never outranks approved user/reference facts.

## 15. Stop Conditions

Do not generate when:
- a blocking requirement is unresolved;
- materially conflicting evidence remains unresolved;
- the user explicitly requested pre-generation approval and it is still pending;
- a correction would require guessing what must be preserved;
- the proposed artifact does not materially help the downstream decision.

Do not hand off when:
- package consistency fails;
- listed/referenced files are missing;
- readiness contradicts blocking unknowns;
- scale/view-distance authority conflicts internally.

## User Experience Goal

The user should normally only need to:

```text
1. describe what they want
2. answer a few simple questions when vital information is missing
3. review a target summary before generation only when explicitly requested
4. review the requested reference artifact
5. request/authorize packaging when a package is actually needed
6. receive the completed handoff when requested
```

Prompt quality, branch selection, particle preflight, package consistency, and technical terminology remain responsibilities of the ChatGPT-side system.

# LazyDesigner Skill Taxonomy

Updated: 2026-10-01

This file is the canonical classification for LazyDesigner Skills. It defines what kind of work each Skill belongs to and prevents asset-authoring instructions from being mixed with product-development instructions.

It does not replace Skill contents, `AGENTS.md` routing, or Control implementation. This document owns semantic category and canonical Skill naming.

## Authority Boundary

```text
Docs   = durable semantic policy / contracts
Skills = execution procedure and specialist operating instructions
Control= task/stage/context selection and projection
```

A Skill may summarize the operational trigger for a durable rule, but it must not become a competing policy owner. AI context selection is owned by `docs/04-system/ai-context-loading.md`.

Cross-stage Geometry/Texturing/Animation context, evidence economy, convergence and handoff semantics are owned by `docs/04-system/authoring-stage-context.md`. This is a **shared semantic contract, not a Skill or router**. Do not create a `stage`, `authoring-core`, `manager`, or equivalent Skill around it.

## Top-Level Categories

```text
REFERENCE_PREPARATION
ASSET_AUTHORING
PRODUCT_DEVELOPMENT
SKILL_SYSTEM
```

These categories are mutually exclusive as primary ownership. Another category is consulted only when materially required.

## Activation Classes

Every canonical Skill declares one activation class near the top of its `SKILL.md`:

```text
ROUTER      = selects the minimum specialist branch; does not absorb specialist ownership
SPECIALIST  = performs one semantic domain's reusable procedure
DELEGATED   = callable only from its named parent/router; not a top-level route
META        = forms a development/Skill-system contract only when ambiguity actually requires it
```

Every Skill also declares `LANE`, `DOMAIN`, and `OWNER`. These declarations are routing metadata, not a second policy system. The durable category in this taxonomy remains authoritative.

## Canonical Asset Profile Vocabulary

```text
PROP_FURNITURE
VEHICLE
HUMANOID
CREATURE
MECHANICAL
PLANT_FOLIAGE
GENERIC
```

Profile names describe the **asset class**, not the modelling technique. Technical terms such as `PLANE_LIKE`, `CROSSED_CUTOUT`, `LAYERED_CUTOUT`, or `VOLUMETRIC_GEOMETRY` remain representation choices. `GENERIC` is fail-safe fallback only. Profiles are lightweight knowledge overlays, not workflow engines or geometry presets.

## 1. REFERENCE_PREPARATION

Purpose: prepare visual, pixel-art, particle/VFX and structured technical reference evidence before optional Codex authoring so Codex does not repeat avoidable interpretation.

Execution owner: ChatGPT.

| Canonical path | Canonical name | Role |
| --- | --- | --- |
| `.agents/skills/lazydesigner-reference-preparation/SKILL.md` | `lazydesigner-reference-preparation` | orchestration: requirements, branch selection, visual reference planning, QA and optional package/handoff |
| `.agents/skills/lazydesigner-prompt-compiler/SKILL.md` | `lazydesigner-prompt-compiler` | internal prompt normalization helper |
| `.agents/skills/lazydesigner-particle-reference-authoring/SKILL.md` | `lazydesigner-particle-reference-authoring` | standalone Bedrock/Snowstorm particle reference authoring, texture dependencies and particle delivery |
| `.agents/skills/lazydesigner-pixel-art-authoring/SKILL.md` | `lazydesigner-pixel-art-authoring` | standalone grid-accurate pixel art, icons, sprites, tiles/patterns, reference conversion and pixel texture references |

Canonical flow: `docs/02-reference/flow.md`.

```text
UNDERSTAND
→ REQUIREMENT GATE
→ PROMPT COMPILER when useful
→ CLASSIFY REFERENCE CAPABILITY
   ├─ VISUAL / MODEL → image reference owners
   ├─ PIXEL ART      → lazydesigner-pixel-art-authoring
   ├─ PARTICLE / VFX → lazydesigner-particle-reference-authoring
   └─ COMPOSED       → only the branches required by the dependency graph
→ branch-specific QA / review
→ PACKAGE ONLY WHEN REQUESTED
→ optional downstream handoff
```

Reference Preparation must not own Blockbench mutation, MCP/plugin implementation, or Codex modelling decisions.

### Reference specialist boundaries

`lazydesigner-reference-preparation` is the orchestration authority, not a duplicate implementation owner. Pixel Art and Particle are independent specialist branches because each has a materially different production contract and may produce standalone artifacts without requiring visual/model-sheet generation.

```text
smooth visual/model concept/turnaround/reference sheet
→ image reference branch

strict integer-grid icon/sprite/tile/pixel conversion
→ pixel-art specialist

Bedrock/Snowstorm particle JSON, emitter/texture VFX artifact
→ particle specialist
```

When one branch supplies another, preserve ownership rather than merging systems. Example:

```text
PARTICLE requires deliberately authored pixel texture
→ Pixel Art owns the texture image
→ Particle owns emitter/lifecycle/Molang/runtime semantics
```

Pixel Art does not own mapped UV/atlas mutation in Blockbench. Production application to model surfaces remains `lazydesigner-texturing`.

## 2. ASSET_AUTHORING

Purpose: create, modify, verify and finalize Minecraft Bedrock assets through Codex + Gateway + Runtime + Blockbench.

Execution owner: Codex for reasoning; Runtime/Blockbench for mutation.

| Canonical path | Canonical name | Role |
| --- | --- | --- |
| `.agents/skills/lazydesigner-modelling/SKILL.md` | `lazydesigner-modelling` | Geometry, hierarchy, pivots/rig-readiness, surfaces, UV Layout, correction and geometry verification |
| `.agents/skills/lazydesigner-texturing/SKILL.md` | `lazydesigner-texturing` | Texture Atlas, pixel styling, materials/PBR and texture verification |
| `.agents/skills/lazydesigner-animation/SKILL.md` | `lazydesigner-animation` | rig usage, keyframes, motion, controllers, effects and playback verification |

The former asset-router Skill is retired and removed. LazyDesigner Control owns task/stage/context routing.

```text
Reference Package / Workspace / current task
→ LazyDesigner Control
→ shared authoring-stage contract (loaded once/reused)
→ active authoring domain/readiness/context
→ exactly one active specialist
```

The shared authoring-stage contract does not select tools or replace specialist reasoning. It only owns rules that are genuinely cross-stage.

Do not reintroduce a permanent asset-router Skill or duplicate Control routing policy inside specialist Skills.

### Pixel Art vs Texturing

Use semantic ownership, not the word `pixel` alone:

```text
standalone icon / sprite / tile / pixel-art reference image
→ REFERENCE_PREPARATION / lazydesigner-pixel-art-authoring

actual Blockbench texture atlas / mapped UV surface / Painter mutation / PBR
→ ASSET_AUTHORING / lazydesigner-texturing
```

A Pixel Art output may become an input to Texturing, but that handoff does not make Pixel Art an authoring-stage domain.

## 3. PRODUCT_DEVELOPMENT

Purpose: change LazyDesigner itself: MCP contracts, Blockbench plugin/runtime integration, architecture, tooling, source behavior, tests and development continuity.

Execution owner: Codex development workflow.

| Canonical path | Canonical name | Role |
| --- | --- | --- |
| `.agents/skills/lazydesigner-mcp-development/SKILL.md` | `lazydesigner-mcp-development` | client-visible MCP contracts, schemas, registration and protocol/session behavior |
| `.agents/skills/lazydesigner-blockbench-development/SKILL.md` | `lazydesigner-blockbench-development` | Blockbench plugin/runtime APIs, lifecycle, UI, Undo and runtime mutation mechanics |
| `.agents/skills/lazydesigner-desktop-ui-design-development/SKILL.md` | `lazydesigner-desktop-ui-design-development` | Desktop Svelte visual design, explicit real-app UI Preview and browser-rendered source-first QA; never generated-image previews or native Blockbench claims |
| `.agents/skills/lazydesigner-development-brief/SKILL.md` | `lazydesigner-development-brief` | complex/ambiguous cross-owner development design only |

Build/package/compiler mechanics remain owned by the exact source/build owner under `mcp/AGENTS.md` unless repeated work justifies a distinct reusable Skill.

### Product-Development Routing Rule

```text
MCP public/protocol contract
→ lazydesigner-mcp-development

Blockbench plugin/runtime/lifecycle/API behavior
→ lazydesigner-blockbench-development

Desktop Svelte visual hierarchy/responsive UI/explicit real-app preview
→ lazydesigner-desktop-ui-design-development

complex architecture / materially ambiguous ownership
→ lazydesigner-development-brief

clear bounded source/build/test change
→ exact source owner; no development-brief ceremony
```

Asset-authoring and reference-authoring Skills are not loaded for normal product development unless the development task explicitly changes/evaluates those semantics.

## 4. SKILL_SYSTEM

Purpose: create, audit, refine, evaluate, consolidate, or retire LazyDesigner Skills and their activation/routing semantics without contaminating Product Development or normal IN_USE work.

Execution owner: Codex Skill-engineering workflow.

| Canonical path | Canonical name | Role |
| --- | --- | --- |
| `.agents/skills/lazydesigner-skill-development/SKILL.md` | `lazydesigner-skill-development` | Skill activation design, overlap/negative-trigger analysis, eval-corpus maintenance, progressive disclosure, and retirement/consolidation decisions |

```text
Skill create/refine/audit/evaluate/retire
→ lazydesigner-skill-development
→ current taxonomy + affected Skill only
→ positive + negative + collision routing evidence
→ smallest complete Skill change
→ STOP
```

Do not route ordinary source/plugin changes here. Do not use this Skill to redefine product semantics: change the durable product/system owner first, then align the affected Skill. Do not use Product Development Skills merely because a `SKILL.md` file is source-controlled.

### Lane-Crossing Contract

```text
IN_USE → DEVELOPMENT
only after bounded evidence proves a system/runtime/public-contract defect
→ DEVELOPMENT_HANDOFF
→ exact Development owner
→ return to originating stage after the defect is fixed

IN_USE → SKILL_SYSTEM
only when the defect is in Skill activation/instruction/evaluation itself

DEVELOPMENT → IN_USE
never automatic; a development fix restores capability but does not authorize asset continuation
```

A `DEVELOPMENT_HANDOFF` records only decision-changing evidence:

```text
source_lane
source_owner
target_owner
observed
expected
minimum_reproduction_or_evidence
resume_stage
```

“Maybe the tool/MCP/runtime is wrong” is not sufficient evidence.

### Skill Supply-Chain Admission

Current LazyDesigner Skills are repository-owned instructions, not arbitrary executable plugins. Treat imported Skill packages and references as untrusted data until their origin, allowed file types, prompt-injection surface, external processes, credentials and network/install behavior are reviewed. `mcp/tests/repository/agent-supply-chain.test.ts` is a narrow static admission guard for committed Skill packages (including nested references and symlinks). It does not execute third-party content and cannot establish whether an AI agent followed the instructions.

For a legitimate future executable Skill dependency, require a separately reviewed execution/provenance contract and a targeted security test change; never weaken the scan just to let an unreviewed script pass. The active Skill taxonomy and existing routing fixture remain the semantic owners.

## Naming Rules

Canonical LazyDesigner Skill names use prefix `lazydesigner-` plus a direct responsibility noun.

```text
lazydesigner-reference-preparation
lazydesigner-prompt-compiler
lazydesigner-particle-reference-authoring
lazydesigner-pixel-art-authoring
lazydesigner-modelling
lazydesigner-texturing
lazydesigner-animation
lazydesigner-mcp-development
lazydesigner-blockbench-development
lazydesigner-desktop-ui-design-development
lazydesigner-development-brief
lazydesigner-skill-development
```

Avoid ambiguous names such as `core`, `manager`, `director`, `helper`, `builder`, `toolkit`, bare `runtime`, or `router` when Control owns routing.

## Context Isolation Rule

Canonical loading bundles are owned by `docs/04-system/ai-context-loading.md`.

```text
REFERENCE_PREPARATION task
→ orchestration Skill + exactly the selected specialist branch
→ do not preload sibling reference specialists
→ do not load PRODUCT_DEVELOPMENT Skills

ASSET_AUTHORING task
→ load/reuse shared authoring-stage contract only when materially needed
→ Control selects one active specialist
→ do not load REFERENCE_PREPARATION specialists as authoring engines
→ do not load PRODUCT_DEVELOPMENT Skills

PRODUCT_DEVELOPMENT task
→ do not load ASSET_AUTHORING or REFERENCE_PREPARATION Skills unless explicitly required by changed semantics

SKILL_SYSTEM task
→ load lazydesigner-skill-development + only affected Skill(s)
→ do not preload Product Development or IN_USE Skills as execution owners
→ consult durable docs only when the Skill must align to an existing semantic contract
```

The Prompt Compiler receives only current intent, confirmed answers and still-valid approved decisions. Rejected/superseded directions are not active production context.

## Migration Rule

Completed source-level Skill identity migrations:

```text
REFERENCE_PREPARATION → orchestration + prompt compiler + particle specialist + pixel-art specialist
asset-router Skill → retired and removed
ASSET_AUTHORING specialists → canonical lazydesigner-* names
PRODUCT_DEVELOPMENT specialists → canonical lazydesigner-* names
```

Do not recreate removed legacy aliases. Runtime/package compatibility identifiers remain governed separately by `docs/04-system/compatibility-identifiers.md`.

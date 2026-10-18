# LazyDesigner AI Context Loading

Updated: 2026-10-18

This document is the canonical contract for **what AI context to load for a task**. It exists to reduce broad reading, duplicate authority, and repeated context delivery without reducing decision quality.

## Objective

```text
TASK
→ resolve domain / stage
→ load minimum REQUIRED owners
→ add CONDITIONAL owners only for an unresolved material decision
→ execute
```

The goal is **minimum sufficient context**, not the smallest possible prompt.

### Quality-first progressive Skill budget

**Quality before efficiency.** The normal asset-authoring specialist `SKILL.md`
budget is **15,000 characters as an advisory review threshold**, not a
mandatory length, a hard rejection limit, or an invitation to fill spare space.
Router/delegated/reference specialists may retain smaller advisory thresholds
because they have different loading roles. Character counts are a lint signal,
not measured tokens or proof that the agent understood the guidance.

Crossing a review threshold requires a deliberate assessment of: (1) whether
each added rule changes a real decision, (2) whether critical invariants remain
available on the execution hot path, (3) whether the content duplicates its
canonical owner, (4) whether a conditional module would be clearer, and
(5) whether routing/retrieval and representative quality checks support the
change. A justified longer Skill is allowed. Do not automatically truncate,
split into extra specialist Skills, or weaken instructions to pass a size test.

`SKILL.md` contains ownership, critical invariants, the normal execution
procedure, named decision triggers, verification/convergence and handoff.
One-hop `references/*.md` contain deeper *conditional* expertise. A
conditional module is either **required-on-trigger** (do not make its dependent
high-cost decision without the relevant current content) or **supporting**
(use only when it can improve the current decision). Critical safety/approval
and native validity rules cannot live exclusively in an optional module.
Modules are not a second router, supervisor, independent Skill, or duplicate
policy authority; follow only direct links from the active Skill.

Select one decision-changing module at a time, reuse already-loaded current
content, and expand only for a named unresolved need. Multiple distinct
decisions may legitimately require modules **sequentially**; a one-at-a-time
loading rule must not become an absolute one-module quality ceiling. An existing path,
content hash, `known_context_ids`, or `context_ready` does **not** attest that
the client still has the **loaded content** after compaction; reload the current
source before dependent work when it was lost. If required-on-trigger content
is missing, keep only that dependent decision unverified while independent
safe work can proceed.

Skill quality evaluation separates (a) static structure/source integrity,
(b) positive and negative module retrieval/activation cases, (c) procedural
safety compliance, and (d) **quality of the accepted outcome**. Measure
actual context/tool/image cost only *after* quality criteria are met; compare
equal knowledge packaged in different ways before crediting modularization.
Static source tests cannot prove AI retrieval, native Blockbench visuals, or
human approval.

## Source-grounded repository knowledge retrieval

For repository development (not ordinary asset authoring), reuse the existing components:

```text
Task
→ AGENTS.md / docs/README.md router
→ canonical document path + development source owner
→ explicit semantic dependency relation where source-backed
→ content-hashed Markdown sections / bounded symbol map
→ selected source/anchor tests and REQUIRED context
→ decision
```

`mcp/lib/semantic/knowledge.ts` already supplies path/heading-scoped section IDs, content hashes and ranked section selection. `mcp/scripts/development/plan-development-context.ts` composes the existing developer context plan; `mcp/gateway/development/sourceOwners.ts` and `semanticDependencyMatrix.ts` own distinct source and semantic dependency roles. This is *not* a universal documentation graph. For ambiguous or unresolved SYSTEM_DEVELOPMENT intent, the existing context planner now follows the two explicit Markdown edges `docs/README.md → docs/04-system/README.md → docs/04-system/implementation-map.md`; confirmed source-owner routes skip that graph traversal. Missing required documents or edges fail closed instead of silently producing an empty knowledge result. Section ranking remains a navigation aid, never source or runtime authority. Do not add a parallel registry or inferred graph.

## Authority Roles

```text
Docs     = durable semantic policy / contracts
Skills   = execution procedure and specialist operating instructions
Control  = task/stage/context selection and projection
Source   = current implementation/runtime truth
Ops docs = current continuation/proof only
```

Rules:
- do not load a full Skill and every related policy document as reassurance;
- when a Skill summarizes a durable rule, the canonical doc remains semantic authority;
- a Skill may carry the operational trigger needed to execute without restating the whole policy;
- load source only when implementation state can change the decision;
- load `05-operations/` only for continuation, proof interpretation, or local acceptance;
- unchanged large context should be reused by identity/hash when already available.

## Shared Authoring Stage Contract

Geometry, Texturing, and Animation share one canonical cross-stage semantic owner:

```text
docs/04-system/authoring-stage-context.md
```

It owns:
- stage-specific context projection semantics;
- evidence-reuse/economy rules;
- diagnostic PASS vs approval semantics;
- AUTHORING↔Animation handoff semantics;
- correction convergence;
- compact stage-exit projection.

**Normal hot path does not load this document as an additional payload.** Control provides current stage state and the active specialist carries the minimum operational triggers needed to execute. Load the shared contract only when a material cross-stage, approval, evidence-freshness, convergence, or handoff question remains unresolved. Do not load it merely because authoring started.

## Load Classes

```text
REQUIRED     needed for the current decision
CONDITIONAL  load only when a material unresolved question requires it
EXCLUDED     do not load for this task by default
```

A missing CONDITIONAL document is not a reason to broaden into its whole sibling domain.

---

## 1. REFERENCE_PREPARATION

### REQUIRED

```text
current user intent + current source/reference images
.agents/skills/lazydesigner-reference-preparation/SKILL.md
docs/02-reference/flow.md
```

### CONDITIONAL

```text
docs/02-reference/policy.md
  → durable evidence/readiness question

.agents/skills/lazydesigner-prompt-compiler/SKILL.md
  → after blocking requirements are resolved

docs/02-reference/image/*
  → only when generating/editing smooth visual/model reference imagery
.agents/skills/lazydesigner-pixel-art-authoring/SKILL.md + docs/02-reference/pixel-art/*
  → only when the selected artifact is strict integer-grid pixel art, icon, sprite, tile/pattern, or pixel-art reference conversion
.agents/skills/lazydesigner-particle-reference-authoring/SKILL.md + docs/02-reference/particle/*
  → only when authoring/auditing Bedrock/Snowstorm particle/VFX artifacts

docs/02-reference/package/*
  → only when building/validating Codex handoff package
```

### EXCLUDED

```text
docs/03-authoring/**
docs/04-system/control/**
docs/05-operations/**
PRODUCT_DEVELOPMENT Skills
unselected sibling reference specialists
```

Reference Preparation ends at an approved/usable branch artifact or consistent handoff package. It does not pre-author Blockbench geometry.

### Reference branch loading

Select the branch before reading its specialist corpus:

```text
VISUAL / MODEL
→ reference-preparation + image owner(s) only

PIXEL ART
→ reference-preparation + pixel-art Skill
→ one primary pixel-art owner
→ at most 1–2 causal secondary owners

PARTICLE / VFX
→ reference-preparation + particle Skill
→ minimum particle owner bundle

COMPOSED
→ load each specialist only for the dependency it owns
```

Do not load image, pixel-art and particle corpora together merely because they are all Reference Preparation.

Pixel Art hot-path examples:

```text
simple icon
→ pixel-art Skill + iconography
→ qa only near finalization

reference-to-pixel conversion
→ pixel-art Skill + reference-conversion
→ silhouette or palette only when the current decision requires it

Minecraft-native pixel asset
→ pixel-art Skill + minecraft-compatibility + relevant artifact owner

sprite animation
→ pixel-art Skill + sprites + animation
→ qa near finalization

tile/pattern
→ pixel-art Skill + tiles-patterns
→ qa near finalization
```

`pixel` in an actual Blockbench atlas/UV/Painter task is **not** a reason to load Pixel Art Reference Authoring. That belongs to Texturing below.

---

## 2. GEOMETRY

### REQUIRED

```text
current user intent / delta
actual approved reference image(s) relevant to geometry
GEOMETRY_CONTEXT projection
.agents/skills/lazydesigner-modelling/SKILL.md
exactly one selected profile from docs/03-authoring/modelling/profiles/
```

`GEOMETRY_CONTEXT` should already contain only the relevant Reference Package / workspace subset defined by `control/context-projection.md`.

### CONDITIONAL

```text
docs/04-system/authoring-stage-context.md
  → cross-stage / approval / evidence-freshness / convergence / handoff ambiguity
docs/03-authoring/modelling/standard.md
  → durable geometry-policy question not sufficiently resolved by specialist procedure
docs/03-authoring/workflow.md
  → lifecycle/handoff/readiness ambiguity
docs/03-authoring/validation/visual.md
  → visual verdict/evidence policy ambiguity
additional reference package fields/views
  → only when the current geometry decision is blocked by missing evidence
```

### EXCLUDED

```text
full Reference Package
all modelling profiles
full texture standards
full animation standards
REFERENCE_PREPARATION specialist corpora unless consuming a specific already-produced artifact
PRODUCT_DEVELOPMENT Skills
05-operations unless continuing/proving repository work
```

---

## 3. TEXTURING

### REQUIRED

```text
current user intent / texture delta
TEXTURE_CONTEXT projection
.agents/skills/lazydesigner-texturing/SKILL.md
relevant approved material/reference views
current atlas / UV identity supplied by projection/runtime state
```

### CONDITIONAL

```text
docs/04-system/authoring-stage-context.md
  → cross-stage / approval / evidence-freshness / convergence / handoff ambiguity
docs/03-authoring/texture/standard.md
  → durable texture-policy ambiguity
docs/03-authoring/texture/material.md
  → material/PBR semantics are material to the task
docs/03-authoring/texture/render-profile.md
  → render-profile semantics are material
docs/03-authoring/texture/surface-pattern.md
  → pattern/continuity problem is material
docs/03-authoring/validation/visual.md
  → visual verdict ambiguity
bounded Geometry context
  → only for a proved upstream geometry/UV defect
approved pixel-art artifact/profile fields
  → only when the user intentionally supplies Pixel Art output as texture design authority
```

### EXCLUDED

```text
complete modelling profile prose
complete Geometry construction history
complete Animation context
unrelated material sub-standards
pixel-art knowledge corpus after its artifact/profile has already been handed off
PRODUCT_DEVELOPMENT Skills
```

Geometry/Modelling owns production UV Layout (mapping, lock, constraints, UV PASS and corrections). Texturing owns the Blockbench atlas bitmap, Painter/mapped-surface styling, materials and texture verification, even when the design language is pixel art. The native `create_texture(type=template)` route may arrange UV inside shared AUTHORING only after the Geometry-approved UV contract; it does not transfer UV sign-off to Texturing or make unregistered `manage_uv_layout` available. Return UV defects to the Modelling owner without loading the whole Geometry history.

---

## 4. ANIMATION

### REQUIRED

```text
current user intent / animation delta
ANIMATION_CONTEXT projection
.agents/skills/lazydesigner-animation/SKILL.md
relevant approved pose/motion reference views
current participating rig + clip identity supplied by projection/runtime state
```

### CONDITIONAL

```text
docs/04-system/authoring-stage-context.md
  → cross-stage / approval / evidence-freshness / convergence / handoff ambiguity
docs/03-authoring/animation/standard.md
  → durable animation-policy ambiguity
docs/03-authoring/validation/visual.md
  → motion/visual verdict ambiguity
bounded Geometry context
  → only when a proved rig/pivot/clearance defect requires upstream handoff
```

### EXCLUDED

```text
full modelling profile
full texture/UV atlas context
nonparticipating geometry
unrelated clips/controllers
PRODUCT_DEVELOPMENT Skills
```

---

## 5. SYSTEM_DEVELOPMENT

### REQUIRED

```text
current development request
root AGENTS.md + GITHUB_RULES.md
docs/04-system/development-operating-standard.md for material development
exact source owner(s)
docs/04-system/implementation-map.md when ownership is not already exact
matching PRODUCT_DEVELOPMENT Skill only when its reusable procedure materially helps
```

Canonical PRODUCT_DEVELOPMENT Skills:

```text
lazydesigner-mcp-development
lazydesigner-blockbench-development
lazydesigner-development-brief
```

### CONDITIONAL

```text
bounded symbol map (`bun run generate:development-symbol-map -- "<intent>"`)
  → only when exact owner routing is ambiguous/cross-owner and local source navigation would otherwise require broad reads
  → signatures/imports only; never a full-repository payload

docs/05-operations/next-action.md
  → only when continuing unfinished repository work
CONTEXT.md
  → stable project fact materially affects the decision
docs/04-system/skill-taxonomy.md
  → Skill ownership/naming question
docs/04-system/control/context-projection.md
  → Control projection implementation/change
docs/01-product/flow.md
  → product boundary/flow is itself being changed
03-authoring / 02-reference owner
  → only when development explicitly changes that semantic contract
```

### EXCLUDED

```text
all Skills by default
all docs domains by default
full repository scan
05-operations local acceptance unless live acceptance is explicitly active
```

Clear bounded changes go directly to the exact source owner. `lazydesigner-development-brief` is not a mandatory development preamble.

---

## 6. SKILL_SYSTEM

### REQUIRED

```text
current Skill/routing/evaluation request
docs/04-system/skill-taxonomy.md
.agents/skills/lazydesigner-skill-development/SKILL.md
only the affected Skill(s)
```

### CONDITIONAL

```text
mcp/tests/fixtures/skill-routing-cases.json
  → activation/negative/collision regression is material
matching durable product/reference/authoring doc
  → only when the Skill must align to an existing semantic contract
AGENTS.md
  → root routing itself is being changed
```

### EXCLUDED

```text
PRODUCT_DEVELOPMENT Skills by default
unaffected IN_USE specialists
full docs corpus
Runtime/source implementation unless current evidence proves the Skill problem is actually a product defect
```

Skill-system work changes execution guidance, not product truth. If evaluation exposes a product-contract defect, hand that defect to the canonical PRODUCT_DEVELOPMENT/doc owner instead of encoding a workaround in Skill prose.

---

## Correction / Continuation Rule

For an already-oriented task:

```text
current delta
+ still-valid context identity/hash
+ affected owner
+ affected fresh state
→ continue
```

Do not reload the initial package, profile, shared stage contract, or sibling domain unless the current delta invalidated that context or exposed a material cross-stage ambiguity.

## Broadening Rule

Broaden context only when all are true:

```text
1. a named material question is unresolved
2. the current REQUIRED context cannot answer it
3. the additional owner is known
4. reading it can change the next decision
```

Otherwise do not broaden.

## Completion Criterion

AI context loading is correct when:
- the task has one resolved domain/stage;
- one primary specialist is active for that semantic owner;
- Pixel Art and Particle reference specialists are loaded only when their branch is selected;
- one primary modelling profile is loaded when Geometry needs one;
- the shared authoring-stage contract is loaded only for a material cross-stage ambiguity, not as routine duplicate context;
- sibling domains remain unloaded unless a proved dependency crosses the boundary;
- operational history/status is not loaded as general knowledge;
- repeated unchanged context is reused rather than resent;
- Skill-system work loads only the meta-skill plus affected Skill(s), not Product Development or all IN_USE specialists;
- no task uses `read all docs` as a normal boot step.

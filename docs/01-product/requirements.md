# LazyDesigner — Product Requirements

**Status:** Active Policy  
**Version:** 2.2  
**Updated:** 2026-09-18  
**Primary Output:** editable Minecraft Bedrock Entity `.bbmodel`

## 1. Product Objective

A user can hand an original source image directly to Codex, or create an approved Minecraft/Blockbench reference board in ChatGPT for stronger coverage, then have LazyDesigner create or revise a clean Bedrock model through explicit stage approval without requiring the user to specify MCP/tool details.

The system must prefer evidence-backed modelling decisions over assumptions and must not force unnecessary reference conversion. LazyDesigner uses one native Geometry authoring path.

## 2. New-Model Required Input

Before Blockbench project authoring begins, a new model requires:

```text
Asset
Approved Reference Image
Requested Dimensions: width × height × length in Minecraft blocks
Animation Required: YES | NO
```

`Approved Reference Image` may be the original source image itself or an optional canonical five-view board.

If mandatory values are missing, ask for all missing values in one batch. Ask additional questions only when a material ambiguity would change the asset. Complete, non-conflicting intake authorizes Blockbench project creation without another confirmation step.

## 3. Reference Handoff

Reference-board creation belongs in ChatGPT. Canonical generated board:

```text
UPPER: LEFT | FRONT | BACK
LOWER: TOP  | FRONT-LEFT 3/4
```

Do not require board generation when the actual original image provides enough evidence for the next material modelling decisions. If evidence is insufficient, request only the smallest decision-changing extra source image/detail first; recommend the canonical board only when stronger normalized coverage is still needed.

Normal handoff is only:

```text
actual Approved Reference Image + user message
```

No sidecar JSON, ZIP, manifest, coordinate sheet, or modelling blueprint is required. An actual image explicitly handed to Codex for modelling is approved unless the user marks it draft/not ready.

## 4. Canonical New-Model Flow

```text
Approved Reference handed to Codex
↓
Active Workspace created
↓
Requirement Gate
↓
create Blockbench project
↓
native LazyDesigner Geometry
↓
Codex internal verify
↓
READY_FOR_USER_REVIEW
↓
user inspects live Blockbench and explicitly approves
↓
checkpoint save
↓
production UV Layout PASS
↓
Texturing
↓
internal verify → user approve → checkpoint save
↓
Animation only when required
↓
internal verify → user approve → checkpoint save
↓
Finalization technical gate
↓
final save → COMPLETE
```

A completed asset remains active until the user explicitly archives it.

## 5. Geometry Authoring

Normal reference-guided semantic Geometry uses native Blockbench Groups/Cubes through LazyDesigner. The Approved Reference may be an original source image or canonical board; only material evidence gaps justify requesting more reference coverage.

There is one modelling path. External shape reconstruction, Hunyuan, PrimitiveAnything, GLB scaffolding, or provider selection are not current product routes.

## 6. Internal Readiness vs User Approval

Codex must understand and validate what it authored before requesting review. Internal validation may use current Blockbench state, focused structural reads, and fresh model captures; those captures are for Codex and do not need to be shown to the user.

Use `inspect_model_bounds` only for material envelope/scale/ground/displacement or bounded surface/contact questions; reuse fresh evidence.

```text
material defect remains → correct internally
same causal correction fails twice without new evidence → BLOCKED
no material blocker remains → READY_FOR_USER_REVIEW
```

Only explicit user approval advances the stage unless the user explicitly authorized autonomous execution, in which case verified current-revision checkpoints replace intermediate waits without being labelled user approval.

## 7. Geometry Quality / Editability

Geometry must preserve recognizable whole form/proportions, requested dimensions, required parts/count/orientation/attachments, important negative spaces, semantic hierarchy/transform ownership, UV readiness, and future editability.

Naturally movable, structurally distinct parts should remain separately transformable even for a static model, without speculative full rigging.

When `Animation Required = YES`, participating hierarchy/Bones/pivots/attachments must be animation-ready before Geometry approval.

## 8. UV / Texturing

Production UV Layout starts only after Geometry approval. Texture authoring starts only after `Geometry APPROVED + UV Layout PASS`. Texture must not conceal unresolved Geometry. Codex internally verifies UV/atlas/material/identity readability before user review.

## 9. Animation

Animation is authored only when `Animation Required = YES`. Required motion must use the prepared Geometry hierarchy/pivots, remain attached/readable, and be internally verified before user review. A material rig/pivot/hierarchy blocker reopens Geometry at the exact owner.

## 10. Downstream Invalidation

An approved upstream stage reopens only for a material blocker owned by that stage. After correction, invalidate only downstream approvals materially affected by the change.

```text
unaffected downstream stage → keep APPROVED
affected downstream stage   → INVALIDATED → repair → user approval again
```

## 11. Finalization / Save

Stage approval triggers checkpoint save. After the last required authored stage is approved, run one technical Finalization gate.

Finalization checks format/current dimensions/hierarchy/UV/textures/animation references and absence of unintended temporary/debug state. It must not silently change an approved visual result.

A material Finalization defect reopens its exact owner stage and requires acceptance again. If Finalization passes without material change, final save happens automatically; no extra user approval is needed.

## 12. Existing Model Update

```text
recover/create Active Workspace
→ if untracked, persist supplied .bbmodel as current baseline before mutation
→ minimum targeted baseline inspection
→ determine affected stage(s)
→ ask only material missing information
→ update smallest owning stage(s)
→ internal verify
→ user approval for affected stage(s)
→ Finalization
```

Reference is required only when success depends on visual/fidelity judgement.

## 13. Efficiency / Anti-Overdevelopment

- accept the actual original image first when evidence is sufficient;
- escalate reference coverage only when it can change a material decision;
- one Gateway;
- one Geometry authoring path;
- one current editable `.bbmodel` per asset;
- Git history owns old revisions;
- targeted internal captures, not screenshot-per-mutation;
- deferred focused capability discovery;
- same causal failure twice without new evidence → stop;
- invalidate smallest downstream scope.

## 14. Proof Boundary

Static source/docs/CI cannot prove live Blockbench behavior, visual quality, native Undo/playback/persistence, or Gateway lifecycle stability. Those remain local/live proof until deliberately tested.

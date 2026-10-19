# LazyDesigner — Authoring Workflow Policy

**Status:** Active Policy  
**Version:** 2.0  
**Updated:** 2026-09-12

## Purpose

Own durable cross-domain authoring sequence and dependency rules without duplicating specialist procedures. Detailed domain execution remains in the active specialist Skill and its canonical standard.

## Canonical Lifecycle

```text
REFERENCE / REQUIREMENTS
→ GEOMETRY
→ GEOMETRY VERIFY
→ USER APPROVAL or authorized autonomous verification
→ UV LAYOUT / UV PASS
→ TEXTURING
→ TEXTURE VERIFY
→ USER APPROVAL or authorized autonomous verification
→ ANIMATION READINESS when required
→ ANIMATION when required
→ FINALIZATION
→ COMPLETE
```

Geometry and Texturing are distinct semantic owners but share the same `AUTHORING` Runtime surface. Animation uses the separate `ANIMATION` Runtime surface.

```text
GEOMETRY semantic stage  → AUTHORING Runtime surface
TEXTURING semantic stage → AUTHORING Runtime surface
ANIMATION semantic stage → ANIMATION Runtime surface
```

Geometry↔Texturing correction does not require `HANDOFF_REQUIRED` or a Runtime surface switch. `HANDOFF_REQUIRED` is reserved for AUTHORING↔Animation.

## Single-Owner Execution

Normal work activates exactly one semantic specialist:

```text
Geometry / hierarchy / pivots / UV
→ lazydesigner-modelling

Texture / atlas / Painter / material / PBR
→ lazydesigner-texturing

Animation / motion / effects / controllers
→ lazydesigner-animation
```

Control projects only the active-stage context. Geometry may load exactly one selected modelling profile. Do not load sibling specialists or the shared stage contract as reassurance.

## Decision-to-execution contract

A single active semantic owner decides each material change. Before a
high-cost propagation (secondary form, atlas-wide style, many follower keys,
or structural variant), reconcile the current user correction, approved source,
active Skill and the smallest judgeable target. Verify that target before
expanding. This is a **decision within the existing stage**, not an added
user-approval step or a new state machine.

For a bounded correction, recover only affected evidence and preserve unrelated
approved structure. A current Skill handle alone does not prove that the
client still has the instructions: reload missing content at the client boundary
instead of treating a hash or summary as executable guidance.

Do not add routine status/search/describe, file saves, capture-per-mutation,
or per-key/per-Cube approvals. Keep existing Runtime validation, checkpoint,
and handoff safety gates. A capability receipt proves execution, not visual
quality or permission to bypass the next stage's prerequisites.

## Minimum Necessary Evidence

Reuse fresh exact identity/authored state returned by prior calls when sufficient.

```text
known target + known capability
→ mutate
→ reuse receipt
→ verify only evidence made stale or able to change the verdict
```

Use focused discovery only for unknown, stale, or ambiguous state. Avoid confirmation reads after successful deterministic mutations, screenshot-per-micro-mutation loops, broad status/search/describe rituals, and full-profile/package reloads.

## Geometry

Geometry owns shape, hierarchy, transform ownership, pivots, articulation readiness, openings/negative space, contact, dimensions, and UV Layout semantics.

Use the minimum sufficient Bedrock-native geometry. Representation complexity is earned by silhouette, real volume, negative-space boundary, contact, layering, transform ownership, motion, or a proven technical constraint. Surface-only information belongs in Texture.

A coherent geometry cohort is authored first, then visually/structurally verified. Tool success is execution evidence only.

## UV Layout

UV Layout remains Geometry-owned mapping state. Production UV work follows Geometry approval/authorized verification and must reach UV Layout PASS before Texturing can advance.

A material UV change invalidates only affected downstream texture evidence. Do not globally reset unrelated accepted state.

## Texturing

Texturing owns atlas pixels, palette/material styling, mapped-surface readability, alpha/emissive/PBR intent, identity markings, pattern continuity, and Texture Verify.

Texture must not compensate for a missing/incorrect mass, attachment, opening, hierarchy, or pivot. A proved upstream defect returns to Geometry owner inside the shared AUTHORING surface.

## Animation

Animation begins only after canonical readiness: saved checkpoint, UV Layout PASS, no blockers, and either explicit upstream user approval or explicitly authorized current-revision autonomous verification.

Animation owns motion, timeline, controller composition, animation-bound effects, and playback evidence. It does not own structural rig mutation. A proved hierarchy/pivot/clearance blocker returns to AUTHORING through the Gateway handoff and resumes the same task.

## Verification / Correction

```text
MUTATE coherent cohort
→ VERIFY affected evidence
→ PASS?
   ├─ yes → READY_FOR_USER_REVIEW or next legal stage
   └─ no  → diagnose first material owning cause
            → one bounded correction
            → refresh affected evidence
            → IMPROVED | UNCHANGED | REGRESSED
```

Internal PASS never equals user approval. The same causal direction failing twice without new evidence becomes `BLOCKED` rather than a third guess.

### Latest correction before high-cost expansion

This is a **transient decision within the existing stage and verification loop**; it is not a new stage, approval checkpoint, persisted decision register, automated quality score or Gateway tool. Apply it only when a decision would be expensive to reverse (broad secondary geometry, atlas-wide styling, many follower keyframes, a new asset variant), not after every Cube/pixel/keyframe.

1. **Reconcile authority first.** The latest explicit user correction takes precedence over an earlier agent interpretation. Use current conversation intent and the existing `current_user_delta`/Reference/Workspace projection when available; a null delta on a later status call does not revoke an active user correction. Distinguish an earlier *misread requirement* from genuinely *new scope*. Do not reinterpret new requests as proof that all earlier work was wrong.
2. **Constrain impact.** Identify the one material visual/motion relationship the correction changes, its current object/material/clip identity, the relevant approved reference and freshest comparable evidence. Withdraw only superseded assumptions. Preserve unaffected approved facts, UVs, geometry, texture layers and motion. A new durable requirement belongs in the existing approved Reference/Workspace authority at a meaningful persistence boundary, not a new persistent agent state.
3. **Prove the smallest judgeable result before propagation.** Geometry: primary silhouette/attachment from relevant paired views before ornament. Texture: representative mapped material plus a touching seam/surface before atlas-wide treatment. Animation: driver, contact/attachment and causal action order from representative poses before broad follower keys/effects. Reuse the current bounded capture/receipt/correction loop.
4. **Decide using existing evidence, not ceremony.** A visible material mismatch is `FAIL` and is repaired by its canonical owner. Missing/conflicting decision-critical evidence is `UNVERIFIED`/blocked for that dependent expansion, not a fabricated PASS; independent low-risk work may continue. Correctly verified work may continue autonomously within existing stage/approval rules. Do not request repeated user confirmation, impose a new gate on every mutation, or convert an internal PASS to user approval.
5. **Reuse structure for variants.** Color/material-only alternatives first reuse the same model, hierarchy and UV atlas with an explicit texture variant; only a supported geometry, attachment, UV or motion difference justifies a changed structural branch or separate editable model. For action revisions, preserve the newly specified order of events and stationary/attached relationships before editing dependent keys.

A new bulk operation is not justified by a successful tool receipt, a nice-looking single screenshot, a smaller Cube count, or a prior plan that the user has corrected. Do not reload all specialist contexts as an expansion check.

## Dependency Invalidation

Invalidate only what the mutation can materially affect.

```text
Geometry change affecting mapped surfaces
→ affected UV/Texture evidence stale

UV change
→ affected Texture evidence stale

Texture mutation
→ Geometry/UV evidence remains fresh

participating hierarchy/pivot change
→ affected Animation evidence stale

Animation keyframe change
→ Geometry/UV/Texture evidence remains fresh unless a structural blocker is discovered
```

## Persistence

Persist meaningful boundaries such as approval, handoff, resume, park, and completion. Mutation count alone is not a checkpoint trigger. Workspace state is continuation state, not a second Runtime database.

## Canonical Owners

```text
Authoring index / stage routing
→ docs/03-authoring/README.md

Geometry policy
→ docs/03-authoring/modelling/standard.md

Texture policy
→ docs/03-authoring/texture/standard.md

Animation policy
→ docs/03-authoring/animation/standard.md

Cross-stage semantic ambiguity
→ docs/04-system/authoring-stage-context.md

Context loading
→ docs/04-system/ai-context-loading.md

Runtime/source ownership
→ docs/04-system/implementation-map.md
```

## Proof Boundary

Source/static evidence can establish contracts, ownership, schemas, routing, and deterministic behavior. Installed Runtime freshness, native Blockbench mutation/playback/persistence, visual fidelity, and accepted-result efficiency require matching local/live proof.
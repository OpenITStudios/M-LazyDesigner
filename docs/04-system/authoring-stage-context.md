# LazyDesigner Authoring Stage Context Contract

This document owns the cross-stage context and handoff semantics shared by Geometry, Texturing, and Animation specialists. Domain-specific reasoning remains in the relevant specialist Skill.

## Loading Rule

This is a **canonical semantic owner, not a routine authoring payload**.

Normal hot path:

```text
Control stage projection
+ exactly one active specialist
+ exactly one selected modelling profile when Geometry needs it
→ execute
```

The specialist carries only the operational triggers required for normal work. Load this document only when a material cross-stage, approval, evidence-freshness, convergence, or AUTHORING↔Animation handoff question remains unresolved. Do not load it in addition to a specialist merely as reassurance.

## Context Projection

Normal specialist work consumes a **stage-specific projection from LazyDesigner Control**, not the complete prior-stage Skill/Profile/Reference Package.

The Control packet is intentionally compact. It carries current decision identity/readiness and references to the relevant stage evidence rather than duplicating all semantic prose. Domain detail is consumed from the referenced stage document, approved image(s), workspace/Runtime state, or a narrowly requested missing relationship only when it can change the next decision.

Shared projection envelope:

```text
original user intent / current task
asset identity + selected_profile label
current stage and persisted upstream gate state
relevant approved reference document/image identities
current authored asset/workspace identity
blocking unknowns
```

Domain-specific detail when actually required:

```text
Geometry  → primary masses, topology, dimensions, pivots, openings, motion-readiness
Texture   → material cohorts, atlas/UV identity, markings, alpha/emissive/PBR requirements
Animation → moving parts, hierarchy/pivots, axes, contact/clearance, pose/keyframe guidance
```

Do not load a full modelling profile or full reference package as reassurance. Request only the missing decision-changing relationship. A narrow secondary profile fact may be loaded when it materially changes the current decision.

## Authority

Resolve facts in this order:

```text
explicit current user requirement
→ approved/current visual reference evidence
→ persisted approved asset state
→ specialist technical evidence
→ unresolved remains UNKNOWN
```

Runtime/Tool success, validators, diagnostics, scalar scores, hierarchy, bounds, or coordinates do not create visual acceptance or user approval.

## Validation Belongs to the Active Stage

Recipe is an optional deterministic authoring method within Geometry,
Texturing or Animation. Validation is likewise part of **each domain**,
not a fourth production Stage, generic checker or second approval authority.

- Geometry / UV: existing bounds, hierarchy, surface and UV evidence owners.
- Texturing: existing texture, seam, atlas, color and PBR evidence owners.
- Animation: existing authored-motion, timing, rig and playback evidence owners.
- Finalization: consumes current approved upstream gates plus requested output
  integrity; it cannot declare a failed or unverified upstream result accepted.

Run cheap schema and identity preflight inside the existing executor; use
receipt/delta to select **affected-only** verification after a coherent
mutation cohort. Detailed inspections are explicit decision calls:
`inspect_model_bounds` is a focused Geometry inspection;
`list_textures(diagnostics=true)` limits physical UV evidence to the UV,
coverage, seam and full scopes (never PBR-only inventory);
`inspect_animation(diagnostics=true)` enables craft evidence, while the
ordinary clip read does not scan motion. Never replace missing evidence
with a technical or visual PASS merely to save calls.

At Stage exit, incomplete or stale mandatory evidence remains unverified or
blocked until the owning Stage resolves it. Internal validator clearance is
not user approval, visual correctness, or native playback acceptance.
No separate Validation Stage, new MCP tool, per-stage manager or state store
is required.

## Evidence Economy

Reuse fresh evidence and mutation receipts. Refresh only the evidence class made stale by a mutation or required to detect a plausible regression.

Avoid:

```text
broad rediscovery of known capability/identity
confirmation readbacks after successful deterministic mutation
full-profile reloads
screenshot-per-micro-mutation loops
repeated unchanged inspection
```

Use bounded discovery only when identity/schema is unknown or stale.

## Gate Semantics

Diagnostic/internal PASS means technical evidence only. It never means user approval.

Canonical Animation handoff readiness is owned by `mcp/lib/authoringReadiness.ts`:

```text
USER_APPROVED
or
AUTONOMOUS_VERIFIED
```

Both require UV Layout PASS, a saved checkpoint, and no blockers. Autonomous verification requires explicit prior user authorization plus current-revision evidence and must never be described as user approval.

Geometry↔Texturing stays on the shared AUTHORING Runtime surface. Changing Geometry/Texturing focus may update semantic phase state, but it is **not** a foreign Runtime-surface handoff. `HANDOFF_REQUIRED` is reserved for AUTHORING↔Animation.

## Correction / Convergence

A failed review owns one diagnosed cause and one coherent correction round:

```text
FAIL
→ identify first material owning cause
→ reuse fresh state/evidence
→ one bounded coherent mutation
→ refresh affected evidence only
→ IMPROVED | UNCHANGED | REGRESSED
```

A correction is accepted only when the intended defect improves without materially regressing another required relation. The same causal direction failing twice without new evidence becomes `BLOCKED` rather than a third guess.

## Stage Exit Projection

Return only state needed by Control/next stage:

```text
changed authored identities
relevant semantic part IDs/relationships when needed for continuation
current evidence freshness
upstream blocker if discovered
stage-specific blocking unknowns
READY_FOR_USER_REVIEW | BLOCKED | HANDOFF_REQUIRED
```

Do not persist or return the full specialist Skill/Profile as stage state.

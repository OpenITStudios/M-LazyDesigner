# Motion Recipe Engine

Status: REMOTE SOURCE BOUNDED / LIVE PROOF PENDING
Updated: 2026-11-02
Branch: Local

## Goal

Replace frame-by-frame animation authoring with:

```text
motion/sequence intent
→ semantic poses + timing
→ cyclic phase/contact constraints when explicitly required
→ affected-bone diff
→ existing create_animation / manage_keyframes / controller contracts
```

## Current source foundation

- semantic pose recipe;
- sequence/step timing with optional holds;
- deterministic duration/loop handling;
- cyclic normalized-phase authoring;
- contact-position constraints with explicit boundary keyframes;
- motion mirroring with explicit Euler rotation policy instead of guessed handedness;
- affected-bone diff;
- compilation to existing `create_animation` for clips without unsupported interpolation metadata;
- create-plan split that routes interpolation metadata through bounded post-create `manage_keyframes edit` calls;
- compilation to existing `manage_keyframes create` replacement semantics for bounded keyframe upserts;
- motion-set to existing controller-recipe linkage;
- no new public capability.

## Source-only semantic and local-contact compilation

Current planning owners: `lib/animation/motionRecipe.ts`,
`lib/animation/contactConstraints.ts`, and `lib/animation/toolCompiler.ts`.

- `compileSemanticMotionToCreateAnimationPlan` validates explicitly supplied primary
  bones, authored pose IDs/roles, archetype, and activation intent. No motion
  style, timing, rig role, controller, or gameplay trigger is inferred.
- `compileMotionWithLocalContactsToCreateAnimationPlan` only locks bone-local
  positions within declared intervals. Conflicting targets, invalid vectors,
  near-native timestamp collisions, nonlinear interpolation, and unknown
  position tracks fail closed.
- Output reuses `create_animation` and the existing optional
  `manage_keyframes` interpolation-edit plan. Native create may
  compact strictly redundant linear transform keys without changing
  equivalent numeric motion; do not interpret saved anchor identity
  as preserved merely because it appeared in the source plan.
- Native `create_animation` now returns a compact `source_timing` receipt:
  source-authored transform/effect timestamps beyond an explicitly requested
  clip duration are REVIEW candidates, not silently deleted or described as
  actual playback. No added input fields or public capabilities.
- `compileMotionToCreateAnimationPlan` refuses interpolation edits whose
  required channel keys would be removed by the existing strictly-linear
  native creation compactor. Even when the edited endpoint survives, a
  nonlinear curve cannot be safely reconstructed after intermediate keys
  were compacted. A source-only plan is withheld instead of retrying snapped
  post-create mutations.
- No automatic post-create contact-anchor upsert is issued because
  `manage_keyframes` snaps to the currently active native animation grid.
  Exact clock ownership and observed playback are required before
  any grid-sensitive correction can claim safe timing.
- A local hold is NOT world-space foot locking, end-effector IK, physics,
  verified visual contact, or native pose sampling. Existing contactEvidence
  and the protected native restoration contract remain authoritative.
- `withTemporaryAnimationPreview` now attempts independent restoration
  steps after one editor setter fails and rejects overlapping async previews
  through the same port. Port-local seriality does not attest other Blockbench
  extensions, effect state, native full-surface restoration, or authorize the
  protected native Blockbench timeline sampler.

## Hardening rules

- do not guess mirrored Euler rotation signs;
- do not claim a contact hold without exact start/end boundary keyframes;
- do not silently drop interpolation that `create_animation` cannot author;
- do not add standalone curve-sampling helpers without a concrete execution consumer;
- do not add a generic animation graph language.

## Proof boundary

REMOTE_GITHUB establishes source contracts only. Native keyframe replacement, interpolation/Bezier behavior, playback, Undo/Redo, save/reopen, visual fidelity, correction rounds and timing cost remain LOCAL_CODE/LIVE_BLOCKBENCH proof.

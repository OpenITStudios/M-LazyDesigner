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

## Existing Gateway invocation bridge (source-only)

The existing `compileSemanticMotionToGatewayInvocation(recipe, intent)`
returns an exact stable-four request envelope:

```text
gateway_tool: invoke_capability
gateway_arguments:
  capability: create_animation
  arguments: existing native create_animation payload
  cohort_boundary: COMPLETE
```

The compiler validates source-declared primary bones/pose IDs, explicit
archetype and activation intent, optional bone-local contact windows and
case-insensitive Bedrock bone identities. It refuses nonlinear interpolation
when a second mutation would require an unverified native snapping clock.
Explicit linear metadata requires no post-create edit because the native
creation path already authors linear transforms. The argument payload is
checked against the existing `createAnimationParameters` schema in the
focused compiler contract test; no public tool, request field, route or
generator-owned artifact is introduced.

High-impact declared phases (`ANTICIPATION`, `ACTION`, `CONTACT`,
`FOLLOW_THROUGH`, `RECOVERY`, `STANCE`, `SWING`) now require at
least one corresponding keyed primary-bone transform at the exact
source pose time, and at least one such primary key must survive the
existing native strictly-linear creation compactor. The Gateway-plan
compiler refuses `SEMANTIC_MOTION_PRIMARY_ROLE_UNKEYED` or
`SEMANTIC_MOTION_PRIMARY_ROLE_COMPACTED` instead of silently claiming
an authored event anchor that the actual native tool would not keep.
Passive `SETUP`, `HOLD`, and `LOOP_SEAM` roles do not automatically
imply a keyed primary-body motion. The plan reports only
`SOURCE_ONLY_PRIMARY_KEYS_RETAINED`, never a native/visual PASS.

The returned semantic context and SOURCE_PLAN_NOT_EXECUTED evidence are
*not transmitted as native tool arguments*. The gateway still owns project,
Stage, affinity and authorization, and Runtime owns real mutation/Undo.
Compiling an envelope neither calls `invoke_capability` nor verifies live
motion/contact, controller activation, export, or final visual fidelity.

Full direct semantic input as a native `create_animation` branch remains a
separate generator-coupled implementation unit; never hand-edit
`mcp/docs/api.json` or `mcp/docs/index.html` to simulate schema generation.

## Source-only native-safe spring follow-through (2026-11-03)

The canonical `springMotion.ts` follower now supports explicit
`drive_mode: "parent_delta"`, using parent transform displacement from its
first authored sample. This starts a secondary bone at neutral offset instead
of interpreting an absolute parent rotation/position as a child rest pose.
The old `absolute` drive remains the default for source compatibility.

Spring responses are numerically sampled and exported as *linear* keyframes
with no Bezier metadata; a sequence of already-baked samples must not
silently acquire a different native Bezier trajectory or require a second
unverified post-create snapping/Undo edit. The final bounded sample is kept
even when `max_duration * sample_rate` is fractional. Parent timelines must
be finite/strictly increasing; `parent_delta` rotation rejects inferred
Euler arcs exceeding 180 degrees without explicit source intermediate poses.
Already-authored child channels and duplicate child ownership fail closed.

`SemanticMotionIntent.spring_links` is opt-in (maximum 8 links) in the
*existing source-only compiler*; it refuses springs targeting semantic
primary bones or local-contact bones. The source-only Gateway envelope may
now carry sampled secondary transforms inside its existing, schema-valid
`create_animation.bones` argument. `spring_follow_through` metadata stays
outside native arguments and reports `SOURCE_ONLY_LINEAR_BAKE`, never
native playback, contact or visual acceptance.

**Limit:** This is a sampled response in authored bone-local transform space,
not world-space cloth physics, contact-aware IK, guaranteed loop seam,
Bedrock native interpolation equivalence, or an installed animation-quality
PASS. Direct `semantic_motion` Runtime inputs still need canonical generated
API artifacts, Bun source gates and separate Blockbench proof.

### Optional periodic spring seam solver (2026-11-03)

For genuinely cyclic secondary parts, `SpringMotionLink.loop_strategy="periodic"`
explicitly opts into steady-state spring sampling. Each source parent must
have matching finite first/last channel values at exact `0` and clip duration
and must be declared as a looping recipe. Partial spring duration, fractional
spring sample-rate, unresolved Euler wrap and missing closing keys are refused.

The source-only solver integrates at most 32 complete periods until both
spring position and velocity converge. It then samples one more entire
cycle, checks the resulting state, and sets the final *authored transform*
to the converged initial transform within a bounded numeric tolerance.
The default `legacy_reset` mode retains pre-existing spring behavior
for callers who have not opted into this new contract; no global
animation correction or native timeline mutation is performed.

This protects a **source-baked endpoint seam**, not a guarantee of
native frame-time fidelity, continuous piecewise-linear derivative,
physical cloth simulation, visual loop smoothness, or Minecraft playback.
The existing linear native creation/timecode guards remain authoritative.
Verify repeated live playback (not only frame 0 and the final frame) before
claiming reduced visible snapping.

### Semantic plan frame-grid preflight (2026-11-03)

Before returning an existing `invoke_capability(create_animation)` envelope, the
source-only semantic compiler now reuses native
`planNativeCreationSnapping` to check all surviving transform key times
after the exact same linear compaction applied by the native creation path.
The 10 FPS baseline is a **search seed only**; no imported Animation FPS,
Blockbench project, editor state or native timecode is read or modified.

A 24 FPS cape and 25 FPS tail cannot share a supported exact 10..120 FPS
export clock and are rejected with
`ANIMATION_NATIVE_SNAPPING_UNREPRESENTABLE` *before* any invocation.
Compatible 24/30 FPS followers may use a source candidate of 120 FPS.
The returned `semantic_context.source_frame_grid_preflight` is source-only,
reports the **candidate** FPS and retained key count, and explicitly records
that native snapping, export timecodes and playback are NOT verified.

The executable `create_animation` payload remains unchanged and carries
no semantic metadata; native creation still independently negotiates the
actual newly imported clip snapping and verifies source/import/export timecodes
inside Undo. This preflight does not activate direct semantic Runtime input,
nonlinear post-create edits, physical contact, or visual motion QA.

## Read-only Locator trajectory evidence in existing Animation preview (2026-11-03)

The existing `capture_model_views(animation_preview)` Runtime now reuses
`currentPose.ts::readDirectLocatorCandidates` during the **already
requested** screenshot callbacks, for up to five sample times and sixteen
native Locators. Successful image captures may return an optional
`locator_trajectory_review` showing observed world-space travel distance,
displacement from the first sample and the exact Locator/parent UUIDs.
No new public request fields, capability registration, global contact
sampler, controller or additional Timeline writes are introduced.

A whole-session non-reentrant guard now prevents overlapping multi-time
capture calls within this Runtime, closing the gap where each native
`animationPreviewPort()` had a new identity and the helper's per-port
WeakSet could not protect against concurrent requests. All exit paths,
including failure to resolve an Animation, release the session guard.

**Trust boundary:** The existing temporary preview helper restores known
editor flags/timeline with best-effort cleanup, but full Blockbench preview
surfaces (MoLang state, effects, external listeners, transformed geometry,
audio, texture frames) have not been independently verified. The Locator
review is therefore a *read-only observation of a current preview callback*
with `native_preview_restoration_attested=false`, not accepted sample/pose
fidelity. Missing/hidden/ambiguous Locator identities or incomplete
frames produce `unavailable`, never a synthetic zero-motion result.
A moving marker is not automatically a planted foot, and a stationary
marker is not physical-contact evidence. No IK write or correction is
authorized. Explicit contact roles/stance windows, a fully isolated native
harness and visual Golden proof remain required before foot locking.

### Time-aligned Locator evidence and known preview-state readback (2026-11-03)

The existing world-space Locator diagnostic now preserves bounded per-frame
world positions and maximum observed segment speed. Five preview times times
sixteen Locators remain the upper sampling budget. Equal clip endpoints
can no longer conceal sampled intermediate movement. Invalid frame objects,
sub-resolution timestamps and arithmetic overflow produce an unavailable
diagnostic rather than invented stillness or JSON-invalid values.

The existing temporary preview owner now reads back known Timeline time,
playing/selection flags and selected clip after its restoration attempts.
Silent setter no-ops or redraw drift fail with
`ANIMATION_PREVIEW_KNOWN_STATE_MISMATCH`. The receipt scopes
`persistent_timeline_state_restored` to
`KNOWN_TIMELINE_SELECTION_FLAGS_ONLY`, with explicit
`full_native_state_restoration_attested=false`. This does not establish
MoLang/audio/effect/texture/geometry/external-listener restoration or
authorize contact-aware IK mutation. Four Gateway tools and all public
request schemas stay unchanged.

## Native codec timing parity (registered create path)

The already-registered `create_animation` Runtime now checks all requested
position/rotation/scale keys and initial sound/particle timestamp tracks
*after* the Blockbench Bedrock AnimationCodec creates the Animation and
*before* completing its Undo transaction:

```text
authored transform/effect timecodes
→ existing exact-linear compaction
→ native Bedrock AnimationCodec import
→ actual native key inventory
→ native Keyframe.getTimecodeString() for export
→ track-scoped import/export time parity
→ finish existing Undo, or rollback on mismatch
```

`mcp/lib/animation/batchPlanning.ts` owns the pure fail-closed parity
comparison. It rejects lost/extra source keys, nonfinite native evidence,
unexpected import drift, export-grid rounding over the native 0.0001-second
identity tolerance, and same-track serialized key collisions. Distinct
bones/channels may still share identical times. Reuse the real native
`getTimecodeString()` output rather than predicting FPS from a source
placeholder or silently snapping the user's requested times.

A successful native call returns optional `native_timing` receipt with
`CODEC_TIMES_MATCHED`. This is evidence of matching imported/source and
export timecodes only, **not** live pose evaluation, physical contact, correct
interpolation or playback, saved/reopened persistence, or user acceptance.
Historical installed creation receipts lacking the new field remain valid.

This guard strengthens the existing native creation path for compiled
Semantic Motion plans with no new public tool, new input schema, generated
API files, or parallel executor. It does **not** make semantic input
automatically accepted by Runtime: the existing source-only planner still
must supply a schema-valid `create_animation` invocation through the
already-authorized Gateway. Direct semantic schema expansion remains a
separate generator-coupled task.

## Native frame-grid negotiation for newly created clips

The existing registered `create_animation` executor now performs a **bounded
new-clip-only FPS negotiation** using source times after the existing numeric
linear compactor. Upstream Blockbench `Timeline.snapTime(time, animation)`
uses at most 120 effective FPS even when the Animation's stored snapping
setting permits 10–500 FPS. Silent timecode rounding can therefore turn an
otherwise correct authored animation into a different exported motion.

The canonical planner is
`lib/animation/batchPlanning.ts::planNativeCreationSnapping`:

- Preserve the imported new clip's snapping when every keyframe and effect
  timestamp already fits its effective 10–120 FPS export grid.
- Otherwise find the lowest supported integer FPS in 10–120 that preserves
  all source key times within the native 0.0001-second replacement tolerance.
  Verify timestamps separately for each bone/channel, allowing equal times
  across different tracks but never same-track collisions.
- If no supported grid fits, refuse `ANIMATION_NATIVE_SNAPPING_UNREPRESENTABLE`
  and use the existing pre-commit rollback. Never silently move keyframes,
  change an existing clip, or modify the global Timeline setting.
- Apply a selected rate **only to the newly imported Animation** within its
  existing Undo edit, before invoking native `getTimecodeString()` for real
  source/import/export time parity. The prior independent timing guard still
  rejects a bad native readback.

The resulting `native_timing.snapping_resolution` receipt is optional for
backward compatibility and records source key count, old/applied FPS,
effective export FPS and `NEW_NATIVE_CLIP_ONLY` scope. It is independently
validated against the native timing keyframe count. Neither an adjusted
snapping value nor `CODEC_TIMES_MATCHED` proves playback, true contact,
native IK, export persistence or visual acceptance.

This is a functional improvement to the already registered native
creation path; it does **not** add the direct `semantic_motion` input schema.
That generator-coupled capability remains blocked until the canonical
Bun generator and full repository dependencies are available.

## Native creation failure and Undo authority

The registered `create_animation` implementation now separates three
outcomes during native Codec creation:

- **Before `Undo.finishEdit`:** attempt every newly created Animation
  removal independently and cancel the open Undo edit. Preserve the original
  error when recovery succeeds. If inventory, removal or Undo cancellation
  fails, return `ANIMATION_CREATION_ROLLBACK_OUTCOME_UNKNOWN` with aggregated
  causes; never claim the project is clean.
- **`Undo.finishEdit` invoked but did not return:** report
  `ANIMATION_CREATION_COMMIT_OUTCOME_UNKNOWN`. Do not blindly delete
  clips, cancel Undo or replay a non-idempotent creation.
- **`Undo.finishEdit` returned successfully:** mark commit completion
  before semantic history and receipt formatting. An exception afterward
  reports `ANIMATION_CREATION_POST_COMMIT_REPORTING_FAILURE`; do not
  delete the committed clip or encourage a duplicate retry.

These distinctions protect existing native creation and authored animation
identity. They are not semantic input schema support or Blockbench
runtime/visual verification. Use a fresh native project/clip inspection to
resolve an uncertain outcome before any further mutation.

## Hardening rules

- do not guess mirrored Euler rotation signs;
- do not claim a contact hold without exact start/end boundary keyframes;
- do not silently drop interpolation that `create_animation` cannot author;
- do not add standalone curve-sampling helpers without a concrete execution consumer;
- do not add a generic animation graph language.

## Proof boundary

REMOTE_GITHUB establishes source contracts only. Native keyframe replacement, interpolation/Bezier behavior, playback, Undo/Redo, save/reopen, visual fidelity, correction rounds and timing cost remain LOCAL_CODE/LIVE_BLOCKBENCH proof.

# Animation Fidelity, Correction, and Evidence Reference

Load this file only when Animation has reached reference-fidelity judgment, iterative correction, or evidence-budget/recovery work.

The operational routing, motion design contract, direct execution path, and stage exit rules remain in `../SKILL.md`.

## Keyframe Reference Fidelity Contract
When the user supplies animation/keyframe/pose reference, it becomes the motion authority for visible pose intent. Geometry remains authority for actual bone hierarchy, pivots, attachments, and feasible deformation; Animation must not force keys that compensate for a wrong rig.

Use the Control projection as the first motion contract. Before production keys, establish only applicable relationships:
```text
reference pose/event → target time or phase role
participating bone chain → driver + followers
root/COM direction → weight/load intent
contact/attachment invariant → what must stay planted/connected
joint neighborhood → expected bend direction + closure/clearance
silhouette landmark → required pose read from relevant view
secondary motion → delayed/follow-through relation
transition/loop relation → entry, exit, or seam expectation
```
Each item is `SUPPORTED | PROVISIONAL | CONFLICTING | UNAVAILABLE`. If a reference-critical limb, joint direction, contact, or attachment cannot be achieved without excessive separation, penetration, or implausible compensation, stop Animation and hand off to Geometry; do not hide the defect with extra keys.

Reference fidelity is **pose-correspondence-first**, not key-count-first. Compare representative reference poses against current animation at comparable view and phase. A technically smooth curve is still `FAIL` if the pose silhouette, joint closure, contact, or action timing contradicts the supplied reference.

For articulated characters/creatures, explicitly inspect motion-critical gaps at hip/groin, knee, ankle/foot, shoulder, elbow/wrist, neck, waist, jaw/cheek, and any custom hinge only when those regions participate in the current motion. Do not automatically inspect every joint in the asset.

Required rule:
```text
joint rotates through intended range
→ adjacent forms preserve believable overlap/closure
→ no excessive open seam
→ no collision that materially changes silhouette
→ contact/attachment remains intentional
```
Do not solve an open joint by scaling/deforming unrelated geometry through animation unless that behavior is explicitly part of the design.

Prioritize correction by motion impact:
```text
wrong participating bone/rig blocker
→ wrong primary pose silhouette / action direction
→ broken contact or attachment
→ excessive joint gap / penetration
→ wrong timing / phase / weight transfer
→ missing counter-motion / follow-through
→ secondary polish/easing
```
A correction is `REGRESSED` if the target pose improves but another required reference pose, contact phase, loop seam, or neighboring joint becomes materially worse.

## Correction Convergence
Treat each failed motion review as one diagnosed motion cause, not an invitation to add keys broadly.

```text
FAIL
→ identify first wrong motion/rig cause
→ reuse current animation UUID + fresh inspected state/playback evidence
→ mutate one coherent bone/channel cohort
→ recapture only affected reference pose/time or replay the affected loop segment
→ IMPROVED | UNCHANGED | REGRESSED
```
Do not repeatedly `inspect_animation`, re-search capability schemas, or recapture unchanged times between coherent keyframe mutations. A fresh timeline mutation receipt remains authoritative for authored state; visual/playback evidence is refreshed only where the mutation can change the verdict.

If the same causal direction fails twice without new evidence, `BLOCKED`. Do not add denser keys, stronger easing, or extra follower motion as a third guess. If the blocker is hierarchy/pivot/contact geometry, hand off to Geometry immediately and preserve the current animation evidence for resume.

Use Molang for continuous/cyclic/reactive **visual motion**; authored poses own identity-critical action/contact/silhouette. `q.anim_time` is time-driven; `q.modified_distance_moved` can own travel phase. External gameplay callers remain integration contracts; never invent caller values or signed reverse semantics. Chains use `driver → delayed followers`. Actions preserve `anticipation → action/impact → follow-through → recovery`.

### Molang / math

No separate math tool. Author Molang through existing transforms/properties/controller/effect fields. Accept official trig, clamp/rounding, interpolation, exponential/power, random/die-roll, `math.pi`, and `math.ease_{in|out|in_out}_{back|bounce|circ|cubic|elastic|expo|quad|quart|quint|sine}`. Easing math is version-sensitive; trig uses degrees.

Molang route: `create_animation(bones={})` → returned UUID → `manage_animation_timeline(operation="keyframes", action="create", values=[expressions])`, one bone/channel cohort per call. Creation accepts numbers only; do not bake continuous expressions merely to fit it. Contact-critical motion still requires native review.

File-backed client/runtime wiring remains compatibility/inspection, not normal model creation. Never `risky_eval` or evaluate gameplay truth.

## Evidence Economy

Do not schedule screenshots every N seconds or for every keyframe.
Use native `inspect_animation` (focused bone/channel/time-range) and current
mutation receipts to diagnose authored motion first; use actual playback for
continuity, foot contact, rhythm and loop behavior. Only when a still image
can answer a specific reference-pose question, request the event-defined
time(s), such as anticipation, impact, extreme contact or recovery, through
one bounded `capture_model_views(animation_preview)` call. The resolved
view × time × optional silhouette image count must stay within eight,
and fewer events are preferable when no additional claim is answered.
This limit is a ceiling, never a mandatory screenshot quota. Never treat
multiple static poses as proof of smooth motion.

```text
AUTHOR coherent keys/batch
→ capture representative times
→ focused inspect only when evidence can change correction
→ one causal correction
→ recapture affected cohort
```

Verify `DISCOVER → AUTHOR → VERIFY → CORRECT → VERIFY → DONE`; record `IMPROVED | UNCHANGED | REGRESSED`. Cyclic/idle verification requires repeated full-loop playback; three static snapshots do not prove timing/phase/contact/seam.
Observe at least three consecutive cycles for cyclic review. Check only motion-relevant contact, sliding, penetration, weight transfer, follow-through and loop continuity. Action clips also require landing/recovery and any intended preview transition. Retain a playable evidence clip with revision, duration and view at review boundaries. Playback unavailable or interrupted means `UNVERIFIED`, not a replacement static PASS.

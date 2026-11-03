# LazyDesigner Modelling Verification Reference

This file is loaded only for its named modelling decision. Durable Geometry policy remains in `docs/03-authoring/modelling/standard.md`; the modelling Skill owns hot-path execution triggers.


Load only for a material scale/format-warning decision, fresh Geometry/reference comparison, or a Geometry verdict. Do not load at every Cube edit.

## Dimension / Native Format Warning Preflight

Use this once before a meaningful primary-cohort create/resize when the
approved numeric envelope or editor warning can change the construction. It
is not an extra persisted stage or screenshot-per-Cube checklist.

1. **Identify actual format, not the word Minecraft.** Bedrock Entity
   (`Format.id=bedrock`) and Bedrock Block have different restrictions.
   Query the active native format/limit only when a warning makes it material.
   `Format.cube_size_limiter` is optional: never assume a block's coordinate
   box, 30-unit size, or Java model constraints apply to Bedrock Entity.
2. **Convert explicit authority to native units.** For ordinary Bedrock
   entity scale, 1 Minecraft block = 16 Blockbench units; map
   width→X, height→Y, length→Z. If dimensions are absent, do not invent
   them from the pixel width of a reference sheet. Establish an explicit
   player-relative scale when required for the task.
3. **Validate the proposed cohort before one Undo.** Every intended Cube
   has finite `from/to` and derived spans; each `to` coordinate is
   ≥ `from`. Inflate modifies the rendered span on both sides.
   A solid form has three positive rendered axes; one zero axis may
   intentionally represent a plane. A reversed, nonfinite, negative
   rendered, or two-axis-collapsed Cube requires correction before mutation.
   Preserve legitimate thin/fractional geometry; do not round away a
   meaningful feature to satisfy provisional Box UV.
4. **Check the relevant total, not isolated cube widths.** Compare
   the planned visible silhouette/overall X/Y/Z envelope against the
   approved dimensions, including unchanged masses affected by the cohort.
   Group transforms, authored cube bounds, and rotated world-space
   extents are distinct quantities. Native size-limit warnings can use
   unrotated raw `from/to`; a visually fitting rotated Cube may still
   trigger a format warning. Do not move a pivot or inflate every Cube to
   disguise the cause. Use `inspect_model_bounds` only if that envelope
   cannot be established from fresh existing evidence.
5. **Classify the warning before fixing it.** Separate invalid authored
   span, format-specific native size limit, mismatch with approved target
   size, Box-UV quantization/packing, and a purely visual proportion
   discrepancy. Fix the first proven owner and recheck the affected cohort.
   One warning is not authorization for whole-model rescale, silent atlas
   enlargement, or full multi-view recapture.

**Acceptance:** no avoidable geometry/format warning remains for the scoped
cohort, numerical dimensions satisfy explicit approved constraints,
and appropriate comparable reference/model views preserve form. Preflight
success alone never grants Geometry visual PASS.

## Primary Build / Difference-First Reference Fidelity Verdict
`requirement → source evidence → selected profile guidance → simplest recognizable Blockbench-buildable interpretation → PRIMARY BLOCKOUT + required hierarchy/pivots → primary PASS → identity-weighted secondary geometry`.

Verdict requires approved reference + fresh current-revision model evidence:
`claim | matching reference view | current view | observed difference | severity | owning cause | FAIL | UNVERIFIED | PASS`.
Mutation stales affected captures. Correct first cause, then recapture affected views.

A Control `VERIFY_VISUAL` after `CUBE_TARGETS` is **visual verification debt**,
not a command to screenshot after every Cube. Reuse fresh native mutation
receipts first; when structural facts are missing, call `inspect_model_bounds`
once at a material cohort boundary and follow its existing
`surface_integrity.evidence_economy` advice. That advice cannot grant visual
approval. Group related safe edits using the existing Control
`CONTINUE → COMPLETE` cohort so stale scopes are not forgotten.
At an actual reference-fidelity gate obtain the minimum compatible
`capture_model_views` images covering all unanswered claims; do not
postpone required review to save tokens. For Texture reuse a current returned
region PNG only if its revision and rectangle cover the question; otherwise
use `get_texture`. For Animation inspect affected native clip/bone/time data
before meaningful pose review, not every keyframe. Do not use whole-desktop
screenshots as normal QA evidence. `capture_model_views` correspondence metadata only maps captures to canonical board slots; it is not a scorer and never creates visual PASS.
Tool success, coordinates, bounds, hierarchy, validators, or similarity scores cannot justify `PASS`. Internal Geometry `PASS` requires form/depth, surface integrity, hierarchy/pivots, and no major defect.

**Largest-difference-first:** rank only material visible differences by construction consequence, not pixel area. Fix in this order when applicable: missing/extra required part → wrong topology/attachment → wrong primary silhouette/proportion/depth → broken negative space/contact → pivot/motion-readiness defect → secondary geometric detail. Do not spend a correction round polishing a smaller difference while a higher-order structural defect remains.

**Cross-view regression rule:** a correction is accepted only when the intended difference improves and no required orthographic relation materially regresses. A front-view improvement that breaks side depth, rear attachment, top footprint, or motion clearance is `REGRESSED`, not progress.

Before user review, state the largest remaining reference differences at comparable angle/scale, including depth and identity landmarks. Neutral contact alone cannot certify an articulated assembly: inspect required closed boundaries in representative extremes, especially jaw/cheek/chest and limb attachments when present. Correct the owning structure before detail or production keys; do not hide unresolved gaps behind texture or filler Cubes.

**UV Readiness Preflight** checks thin/Box-UV collapse, aspect/representation, seam/unique-region blockers. Read-only: no production UV/`UV Layout PASS`. **User Geometry APPROVED is required** before production UV.
Layered contacts and exposed undersides need an affected side/bottom view when front/three-quarter views conceal the boundary. Distinguish dark material from actual missing surface; a prior approval does not clear a newly observed major defect.

## Reference Grounding (Detailed Evidence)

For reference-driven visual work, the **actual approved reference image** must be in **active multimodal context**; path/prose/memory is not visual evidence. Unavailable → `BLOCKED`. Approved image owns visuals; explicit dimensions own numeric scale.

When using the stable Gateway with a Reference Package, explicitly request
`status(reference_package_path=..., include_reference_images=true)` at a
visual review boundary, selecting only relevant active-stage image IDs if
more than four are present. Compare delivered MCP reference image content
with fresh `capture_model_views` image content under compatible views and
framing. Reuse unchanged images in the active review context; do not fetch
them at every Cube edit. The returned SHA-256/ID/approval fields establish
source identity, not visual quality or native camera calibration.

For an approved single-view image with actual visually inspected regions,
reuse the existing source-image delivery's `regions` and
`semantic_part_grounding`: distinguish visible primary volume from
surface texture, direct from partly occluded from unobserved shape, and
same-view repetition from independent cross-view evidence. Check
`ownership_issues` before building or correcting a part. Region bounding
boxes are proposal metadata, never automatic masks, scale measurements,
3D reconstruction or authority for hidden surfaces. Do not add a
segmentation-model dependency to the normal Gateway.

At a material Geometry part-identification boundary, use the **existing**
`capture_model_views.reference_correspondence` opt-in with the current
`REFERENCE.json` source metadata delivered by Gateway `status` and
explicit native recipe-owned Cube UUID proposals. One capture returns both
the actual model image and a bounded `part_correspondence` observation.
The Runtime validates native recipe ownership/current Cube state, **not**
whether the source image was approved, the annotations were accurate,
parent group transforms or texture material changed. Correspondence
output is provisional until actual source/model pixels are directly
reviewed. Never infer missing geometry from an unmatched part, submit
invented `review` fields to capture, or loop repeated captures merely
to collect candidate labels. No new Gateway capability is required.

For a small number of reference-critical **mass-center** landmarks, reuse
`images[].landmarks` and the same `capture_model_views` call with
`landmark_pairs`: source image ID/hash, visible source UV, canonical view,
and exact target Cube UUID. Request only a bounded meaningful subset. The
result is a normalized 2D projection residual from the rendered Cube center;
do not turn this into a guessed 3D move, camera calibration, visual PASS or
second correction planner. Skip landmark measurement when the visible feature
is an edge/joint/detail rather than the Cube center, or the camera cannot
actually be paired.

When a correction has known semantic cause and a stable camera, the
read-only `assessLandmarkCorrectionDelta` diagnostic can compare previous
and new capture landmark residuals. Only compare the **same** source image
SHA, exact Cube UUID, framing envelope, camera plan and covered view.
Pass that measurement through existing correction-loop evidence updates only
as a veto; any worsened point or uncomparable camera must stop the correction,
leave convergence pending and request undo/recapture at the actual native
execution owner. Do not claim this helper performs Undo, changes the model,
automatically grants clearance, or produces a fidelity score.

Evidence states remain `SUPPORTED | PROVISIONAL | CONFLICTING | UNAVAILABLE`. View Pair Map is conditional only for material front/back, depth, attachment, or 3/4 ambiguity.

Before the first primary batch, resolve only decision-changing structure:

```text
identity-bearing silhouette
primary masses + required visible part count
topology / attachment / required negative spaces
cross-view width-height-depth evidence
Geometry-vs-Texture ownership of identity landmarks
motion participation + pivot/contact/clearance when animation is required
```

Material `CONFLICTING` or `UNAVAILABLE` evidence blocks dependent construction. A visible required part must be accounted for as `GEOMETRY | TEXTURE | ANIMATION | OMIT(with reason)`; no silent omission, filler mass, or unsupported hidden structure. Front agreement never certifies unresolved material depth.

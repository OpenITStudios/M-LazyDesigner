---
name: lazydesigner-modelling
description: In-use LazyDesigner Asset Authoring specialist for Bedrock Geometry, hierarchy, rig foundation, pivots/locators, surfaces, UV Layout, geometry correction and verification. Do not use for texture styling, animation keyframes, MCP/plugin development, Blockbench runtime debugging, reference generation, or Skill-system maintenance.
---
# LazyDesigner Bedrock Modelling

## Activation Contract

```text
LANE: IN_USE
DOMAIN: ASSET_AUTHORING
CLASS: SPECIALIST
OWNER: GEOMETRY_UV
```

Enter when the active Control stage owns Geometry, hierarchy, rig-readiness, pivots/locators, surfaces, or UV Layout. A poor visual result remains a Modelling problem unless bounded evidence proves a system/runtime defect. Do not inspect or patch LazyDesigner source from this Skill; emit a minimal `DEVELOPMENT_HANDOFF` and stop this owner when such evidence exists.


User-authorized autonomy replaces approval waits with verified checkpoints; never claim user approval.

## Modelling Specialist / Profile Contract

This Skill carries compact operational triggers for the Geometry/UV execution hot path. Durable Geometry policy belongs to `docs/03-authoring/modelling/standard.md`; asset-class guidance belongs to exactly one Control-selected profile under `docs/03-authoring/modelling/profiles/`.

```text
Control → current intent/reference readiness → selected_profile
→ this Skill → exactly one selected profile
```

Accept `selected_profile` from Control, sourced from the current Reference Package (`REFERENCE.json.asset.profile`); do not independently classify, rediscover or preload profiles. `GENERIC` is fallback only. Reclassification is context-only: preserve valid asset/reference state, and never let profile guidance override approved reference evidence, explicit dimensions, or user requirements.

## Minimum Necessary Evidence
- **No per-Cube inspection ceremony** without a diagnosed problem.
- **No screenshot-per-mutation loop.** Build a judgeable form, then gate it.
- `inspect_model_bounds` only for material envelope/scale/ground/displacement or bounded surface/contact questions; reuse fresh evidence.
- `UNVERIFIED` is not a retry command; request only decision-changing evidence.

## Reference Grounding

Use the actual approved reference image in active multimodal context; path/prose/memory is not visual evidence. Missing approved evidence blocks dependent Geometry. The approved image owns appearance; exact user dimensions own numeric scale.

Before the first batch, establish silhouette, primary masses/count, topology, attachment, negative spaces, visible depth and motion-critical pivots. Treat conflicting/unavailable required evidence as `BLOCKED`; account for each visible part as `GEOMETRY | TEXTURE | ANIMATION | OMIT(with reason)`.

At material model/reference comparison, request `status(reference_package_path=..., include_reference_images=true)` and pair fresh `capture_model_views` with actual compatible source views. `capture_model_views.reference_correspondence` and `landmark_pairs` provide bounded provisional diagnostics, not visual PASS or automatic correction. Load `references/verification.md` for scale/format warnings, view pairing or part evidence; load `references/correction.md` only for an active correction loop. Reuse fresh images and avoid capture-per-Cube. Evidence: `SUPPORTED | PROVISIONAL | CONFLICTING | UNAVAILABLE`. View Pair Map only for material front/back, depth, attachment or 3/4 ambiguity.

## Geometry Hot Path
`reference evidence contract → selected profile guidance → semantic form → representation choice → primary batch → Core View Triad → conditional surface integrity → causal correction → Geometry PASS → UV preflight → user review`.

**AD-01/AD-02 — conditional artistic read, not a new gate:** When the approved image and a fresh comparable model view make *identity or primary silhouette* a material decision, name the source-visible focal mass/landmark and deliberately quiet regions (if any). Before adding secondary Cubes, compare focal hierarchy, primary form and negative space; when intended in-game display scale is known, reuse the same capture as a derived small-display view. Prefer a proportion or identity-bearing whole-form fix over extra surface Cubes. Do not infer an art direction from a model name or prescribe universal focal-point placement or thumbnail size. Never interpret studio lighting, bloom, framing or perspective differences as geometry defects without supported like-for-like evidence. If the issue is Texture-owned, hand it off rather than reshaping Geometry; missing/ambiguous source/view/scale stays `UNVERIFIED`. Reuse the existing `SILHOUETTE_PROPORTION` / `SECONDARY_GEOMETRY_DETAIL` discrepancy and causal correction; no extra default capture, new scorer or compulsory research-document load.

Nontrivial form: **transient Primary Mass Contract**:
```text
mass / evidence views / must-exist reason
cross-view proportions / identity landmarks / surface-only detail reserved for Texture
parent/contact + symmetry/asymmetry
transform owner/pivot + negative-space boundary + representation
```
No per-Cube plan. New whole-form blockout defaults to Core View Triad `front + left + top`; before detail, recheck affected form/views against latest user correction. Add `back` for rear topology/asymmetry or `front_left_3q` for depth ambiguity requiring source-matched fidelity comparison. Never recapture all five routinely. For bounded edits, inspect affected views only; preserve reference-matched cross-view quality.
Repeated/symmetric cohorts: derive once → one coherent `manage_cubes` batch; no per-Cube loop.

## Execution Path Preference
Geometry should mutate native Blockbench objects directly through semantic capabilities. Do not reproduce a human click/drag workflow when the target UUIDs, transforms, hierarchy, or batch intent are already known.

```text
create multiple related Cubes
→ manage_cubes(operation="create") with one coherent elements batch

correct multiple known Cubes
→ manage_cubes(operation="batch_update")

create related bones/groups
→ add_group(groups=[...]) in dependency order

translate one existing Group subtree
→ modify_group(offset=...)

move one known element between parents
→ reparent_element(id,parent)

rename a coherent Group cohort
→ rename_element(updates=[...], dry_run then apply when needed)
```

Rules:
- Prefer explicit UUID/name targeting over editor selection. `select_all_of_type` / `get_selection` are support tools only when selection state itself is required by a native workflow.
- Do **not** use `trigger_action`, `emulate_clicks`, or `fill_dialog` for normal Cube/Group creation, transforms, hierarchy, pivots, UV, or deletion.
- Do not create one Cube per MCP call when the masses form one coherent batch with known coordinates/parents.
- Do not inspect each newly created Cube after a successful deterministic batch. Use the returned identities/effects, then one bounded structural/visual verification at the cohort level.
- For corrections, inspect once only when current exact authored state is stale/unknown; then mutate the whole diagnosed cohort in one bounded operation where available.
- Do not use `duplicate_element` repeatedly for a known symmetric/repeated cohort if one derived `manage_cubes` batch can author the final intended transforms directly.
- Native Outliner/Cube/Group/Undo operations are the intended execution path; Blockbench UI reflecting the result afterward is not UI automation.
- Normal Group/bone create/pivot/parent/rename/delete work stays on `add_group`, `modify_group`, `reparent_element`, `rename_element`, and `remove_element`. Use `bone_rigging` only when IK or bone mirroring is specifically required; its overlapping legacy actions are compatibility-only, not a second hierarchy workflow.

## Semantic Form / Construction / Transform Gate

Before exact coordinates, determine:

```text
primary masses + must-exist reason
required count / symmetry or deliberate asymmetry
topology: what attaches to what
required negative spaces / continuous surfaces
representation: geometry | texture | animation | omit
transform ownership + required attachment/contact target/invariant
evidence state
```

For identity-weighted/dense new features, perform one **feature-level**
`GEOMETRY | TEXTURE | OMIT | REVIEW_REQUIRED` decision **before** selecting
Cube coordinates. An observed seam/print with no needed silhouette, volume,
negative-space, contact, layering, transform, motion or technical constraint
is `TEXTURE`, not many tiny Cubes. A horn, joint, large fin or articulated
part needs a grounded 3D reason and remains Geometry. Unavailable/conflicting
reference evidence is `REVIEW_REQUIRED`, never a guessed geometry. Each
`SUPPORTED` decision needs at least one actual current reference-view/claim
`evidence_refs` pointer, not merely a feature label. One
semantic feature may own several necessary Cubes: do not create a per-Cube
planning loop. When using an opt-in Authoring Recipe, declare
`feature_intents` and link only Geometry-owned `patterns[].feature_id`.
The existing compiler gates invalid Cube patterns and returns bounded Texture
handoff identities; it neither paints the texture nor deletes an older model.

A semantic label never authorizes coordinates. No orphan/filler Cube; `PROVISIONAL` placement never verifies it. Material `UNRESOLVED` → `BLOCKED`.

Canonical representation vocabulary is:
`SOLID_CUBOID | PLANE_LIKE | PLANAR_CUTOUT_CARRIER | LAYERED_SURFACE | SEGMENTED_FORM | TEXTURE | OMIT`.
The durable eligibility rules live in `docs/03-authoring/modelling/standard.md`; they are **not presets**.

Transform ownership is decided before rotation values:
- local rigid orientation may be **Cube-owned**;
- shared orientation/attachment/articulation is **Group/Bone-owned**;
- pivot role is `MASS_CENTER | ATTACHMENT | JOINT | PARENT_TRANSFORM`; attachment/joint pivot owns the shared relation when that relation is material;
- primary mass state is `AXIS_ALIGNED | ROTATED | UNRESOLVED`.

AABB overlap, hierarchy, or numeric touching is not contact proof. Visible material slope may require rotation; do not use detail/extra Cubes to compensate for wrong mass placement.

### Ownership reuse / variant guard

Before adding a Group/Bone/Locator, ask whether an existing semantic owner already provides the needed transform/attachment/deformation capability. More clips or controller states are not evidence for more hierarchy.

For held/worn, first-/third-person, coupled/uncoupled, or local state variants, reuse the base hierarchy and isolate only the **smallest changed branch**. A moving Locator should inherit motion from the correct parent Group/Bone; do not replace visible required geometry with a Locator.

## Production-Scale Entity Construction

Large counts, rotated Cubes, per-face UV and Locators are valid when earned by visible/functional need. Locator = lightweight attachment/effect anchor. Native `visible_bounds_*` authoring remains a protected gap: review animation extremes/culling risk, but do not add or resize Geometry merely to fake visible-bounds metadata.

## Bedrock Compatibility Gate

Before Geometry PASS, apply only relevant export hygiene from `docs/03-authoring/modelling/standard.md`: new bone names are stable/unique (prefer `snake_case`), root ownership is intentional, Box UV must not distort required fractional Geometry, and Locator scale inheritance is explicit when it differs from the default. Do not remodel or rename accepted structure merely to satisfy style conventions.

## Progressive Deep References

Keep the hot path compact. **REQUIRED_ON_TRIGGER** means read the current
reference content before its dependent material decision. Select one
decision-relevant module at a time; if a later distinct decision needs another
module, load it sequentially without preloading all modules:

```text
material size/format warning or Geometry fidelity / PASS judgement
→ references/verification.md

user-approved Geometry → production UV / UV Layout PASS
→ references/uv-layout.md

bounded local correction / convergence / evidence recovery
→ references/correction.md
```

**NO_DEEP_REFERENCE:** an already specified, unrotated Cube with a verified
parent and fresh reference/scale state can use the normal `manage_cubes`
cohort path. Do not load these references as reassurance. If a new size,
representation, contact, UV or reference-fidelity question emerges, apply
the corresponding trigger before dependent expansion. Absence of required
evidence blocks only that decision; it never authorizes a guessed PASS.

Hot-path invariants:
Surface Coverage / Negative Space; User Geometry APPROVED is required.
- **Difference-First Reference Fidelity Verdict**: Tool success, coordinates, bounds, hierarchy, validators, or similarity scores cannot justify `PASS`;
- fix the largest structural difference first and reject material cross-view regression; overlap alone never proves correctness;
- production UV starts only after **user Geometry APPROVED**;
- correction must reuse fresh state/evidence, require `IMPROVED` without regression elsewhere, never auto-retry `UNKNOWN_OUTCOME`, and the same causal correction failing twice without new evidence becomes `BLOCKED`.
- primary PASS precedes identity-weighted secondary geometry; successful placement is execution evidence only, never visual acceptance.

## Existing Assets / Shared Session
Existing geometry is a baseline, not fidelity proof. Geometry owns shape/rig/UV; Texturing pixels/PBR. Geometry↔Texturing stays shared AUTHORING; `HANDOFF_REQUIRED` + `switch_authoring_phase` only for AUTHORING↔Animation.

## Stage Exit

Return only changed authored identities, current evidence freshness, blocking unknowns/upstream defect, and `READY_FOR_USER_REVIEW | BLOCKED | HANDOFF_REQUIRED`. Do not return the full Skill/profile/reference package as continuation state.
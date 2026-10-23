# LazyDesigner — Geometry Standard

**Status:** Active Policy  
**Version:** 2.2  
**Updated:** 2026-09-18

## Purpose

Define object-agnostic geometry-quality rules for Minecraft Bedrock Entity models created through MCP. Professional `.bbmodel` samples are **evidence of modelling decisions**, not presets, anatomy rules, fixed Cube counts, asset classes, or complexity targets.

## Core Principle

Use the **minimum geometry required to preserve correct 3D form**, not the minimum Cube count.

Every material Cuboid must have a modelling purpose in the **whole form**. Its 3D purpose is silhouette, real volume, opening/negative-space boundary, contact, 3D layering, transform ownership, or motion. Surface information that does not need those properties belongs in Texture; unsupported/immaterial detail may be omitted.

A Cube existing, touching, overlapping, being parented, or being accepted by a tool is structural state only. It does not prove correct representation, size, placement, orientation, hierarchy, pivot, or surface integrity.

## Whole-Form Contract

```text
Modelling Brief
↓
Semantic Form
↓
Representation Choice
↓
construction + transform ownership
↓
Primary Form Hypothesis + required primary hierarchy
↓
intentional coarse geometry
↓
primary visual gate
↓
conditional Surface Integrity review
↓
targeted correction or rebuild
↓
identity-weighted secondary geometry
```

There is no universal support-first, section-first, largest-first, fixed-Cube count, asset preset, watertight requirement, or per-Cube approval order. Construction patterns are **not presets**.

## Minimum Evidence

Reuse fresh authored state and request only evidence that can change the next decision. `inspect_model_bounds` is only for material envelope/scale/ground/displacement or bounded surface/contact questions. Tool success, bounds, hierarchy, or diagnostics never create visual PASS.

## Representation Choice

Choose the simplest construction that preserves the visible 3D requirement:

- **solid Cuboid / `SOLID_CUBOID`** — real volume or silhouette-bearing mass;
- **thin or zero-thickness plane-like Cube / `PLANE_LIKE`** — genuinely sheet-like geometry where thickness is not material;
- **planar cutout carrier / `PLANAR_CUTOUT_CARRIER`** — plane-like host whose alpha texture owns the internal silhouette;
- **layered surface / `LAYERED_SURFACE`** — visible layer over/inside an established form;
- **linked meaningful segments / `SEGMENTED_FORM`** — bend/curve/articulated chain requiring purposeful pieces;
- **texture-only / `TEXTURE`** — surface information requiring no 3D behavior;
- **`OMIT`** — unsupported or immaterial detail.

Rules:

- A plane-like Cube is not a shortcut for unknown depth.
- Zero span on exactly one axis can be valid plane-like Geometry. Two or more collapsed axes do not form a usable surface carrier.
- `inflate` is layer-control, not proportion repair or fake detail. Its sign and magnitude are local authored choices; do not impose a **positive-only or fixed-value rule**.
- Linked meaningful segments must express real changes of direction/contact; reject micro-segmentation and **unit-Cube staircasing** used only to imitate a curve.
- A visible marking, color break, scratch, seam, painted line, or shallow graphic feature stays Texture unless it materially changes 3D behavior.

### Planar cutout carrier

`PLANAR_CUTOUT_CARRIER` is part of the normal native Geometry path, **not a new modelling strategy or object preset**. Use it when broad plane-like faces are the minimum host for a texture/alpha silhouette and the cut-out feature needs no material depth, volume, contact, or independent motion.

- Geometry owns carrier count, envelope, placement, orientation, contact, parent, and pivot; Texture owns silhouette/holes inside carrier bounds.
- **Small-detail thresholds measure the visible feature, not incidental carrier thickness.**
- Prefer `SINGLE`; when yaw coverage needs a cross, `CROSSED_PAIR` uses two co-centered plane-like Cubes about 90° apart under one shared transform and one coherent creation batch. More planes need explicit evidence.
- Do not decompose alpha-owned repeated subfeatures into micro-Cubes.

## Transform Ownership

Decide who owns a transform before choosing rotation values.

### Cube-owned transform

Use when one rigid local part alone needs the orientation and no shared semantic child relationship depends on that transform.

### Group/Bone-owned transform

Use when several Cubes form one semantic segment, attachment, or articulated part whose orientation should move together, or when parent-child transform continuity is itself part of the form.

Do not rotate many child Cubes independently when one shared semantic transform explains the same structure. **Do not create hierarchy solely to increase depth or node count.**

### Primary hierarchy timing

A Group/Bone/pivot belongs in the primary blockout when it is required to establish primary form/orientation, attachment/contact, articulation/segment continuity, or shared transform ownership. Neutral organization may wait until after primary PASS.

### Ownership reuse / local variants

Stable semantic ownership should survive growth in animation clips, controller states, and presentation contexts unless a genuinely new transform, attachment, or deformation capability is required.

Treat these as separate complexity budgets:

```text
Geometry / rig
→ form + transform capability

Animation clips
→ authored motion / pose inventory

Animation controllers
→ temporal / state composition
```

Growth in one budget is not sufficient reason to grow either of the others.

For first-person/third-person, held/worn, coupled/uncoupled, or comparable presentation contexts, preserve the base semantic hierarchy when its transform capability remains valid. Vary only the transform, clip, Locator, or local geometry branch that materially changes.

For local visual/state variants, isolate the **smallest changed branch**. Do not duplicate unchanged base geometry merely because one mouth, accessory, cargo, panel, attachment, or other local form changes.

A family of related assets may reuse attachment/Locator semantics without sharing identical geometry topology, hierarchy depth, segment count, or pivots.


## Initial Cube Creation

Every new Cube requires explicit finite `from` and `to`. Do not create default placeholder Cubes merely to have geometry and decide later.

When a specific parent Group/bone is intended, use exact UUID or unique target. Missing/ambiguous targets fail closed.

```text
rotation = [0,0,0]
→ valid when orientation decision is AXIS_ALIGNED

any non-zero rotation
→ explicit origin/pivot required
```

## Dimensions / Coordinate Frame

```text
X = width / left-right
Y = height / up-down
Z = length / front-back
front direction = explicit
ground relationship = explicit
```

Approved dimensions are numeric target authority. Reference pixels/panel size are not geometry calibration.

Before a significant Cube cohort is applied, convert any approved
block dimensions to native units (16 units per Minecraft block), derive
each actual `to-from` span and rendered span after `inflate`, then
compare the **relevant whole-form envelope** with the approved X/Y/Z
size. A valid plane may have one zero axis; do not round away valid
fractional/plane-like geometry. Native format restrictions are
format-specific: an optional `Format.cube_size_limiter` is not a
universal Bedrock Entity size box. Do not borrow Bedrock Block bounds
for Bedrock Entity or mistake rotated visible extents for raw Cube
coordinate limits. For material ambiguity use the named Modelling
`references/verification.md` preflight, not repetitive per-Cube
inspection. Classify geometry-span, native format-limit, scale-target,
and UV packing warnings separately before correcting them.

## Rotation

**Rotation is justified when** the reference visibly requires an angled orientation/slope, a rotated Cuboid represents that orientation more coherently than an intentional stepped construction, or articulation/shared segment motion requires it.

Before material rotation, identify evidence, transform owner, pivot role, and relationship it should improve. Reject arbitrary multi-axis rotations, rotation used to compensate for wrong size/placement, accumulating small angle changes after failed corrections, or syntactically valid rotation treated as proof.

For an unrotated Cube receiving non-zero rotation, **explicit origin/pivot required** before mutation. An already rotated Cube may reuse its known existing pivot when only rotation changes.

## Pivot / Origin

A meaningful pivot serves rotation center, joint/articulation, attachment, or parent/group transform. A geometric center is only a provisional fallback when no material attachment/joint/parent evidence exists.

Mechanical name-based rig hints (such as `door_y`, `wheel_z`, or the longest Cube axis) are advisory only. An axis token does not establish a real hinge pivot, hinge side, clearance, or intended motion. Before compiling such hints to native rig intent, resolve the actual mechanism and its side/axis from an explicit requirement, approved reference or current native evidence, and retain the specific evidence reference. Heuristic confidence is not an observed probability or a substitute for confirmed intent; do not silently default an unknown hinge to the MIN side.

Pivot-only correction changes origin without changing visible placement. Group pivot changes use exact identity and native transfer-origin semantics.

## Lightweight Parametric Relationships

Use existing Authoring Recipe relationships only when a stable semantic dependency is known from the design. The goal is predictable local regeneration, not a general procedural modeller.

Supported high-value pattern:

```text
primary semantic mass changes
→ existing anchor/symmetry relationship recompiles
→ dependent placement follows
→ incremental rebuild reports directly changed + constraint-propagated instances
→ verify affected assembly views only
```

Examples:
- a leg anchored to the seat edge follows a seat-width change;
- a door/panel anchored to a body boundary follows that boundary;
- an attachment centered on a parent mass follows parent extent changes;
- symmetry relationships remain owned by the existing symmetry system.

Do not create anchor constraints merely to make every coordinate parametric. Use them only for stable design relationships such as shared boundaries, attachment anchors, repeated semantic alignment, or required dependency preservation. A visual correction that should change only one independent part must not drag unrelated geometry through a convenience constraint.

`constraint_propagated_instance_ids` in incremental rebuild evidence distinguishes dependent movement from directly authored changes. This is structural evidence only; the propagated result still requires affected-view visual verification.

## Primary vs Secondary Geometry

Primary geometry is the minimum Cuboids plus **required primary hierarchy/pivots** that establish identity, global silhouette, primary volume, principal orientation, contact, and articulation. Secondary geometry adds only grounded silhouette refinement, attachment/layering, motion support, or visible detail after primary form passes.

Secondary complexity is **identity-weighted**. Do not subdivide every region uniformly or add rotation noise to look detailed.

## Cuboid Efficiency

Cube efficiency is representation-first, never a fixed count target.

Before adding a secondary Cube, ask whether the feature needs 3D silhouette, real volume, contact, negative-space boundary, 3D layering, transform ownership, or motion. If none apply and Texture can carry the visible information, use Texture.

Detail-only span/thickness `<= 4 Blockbench units` is an **anti-overcube guardrail, not a classifier**. It triggers a stronger representation challenge; it does not forbid Geometry when the small feature genuinely carries required 3D form.

For inherited **Bedrock Box UV**, a positive authored axis smaller than **one model unit** is rejected by Cube create/reshape preflight: native logical UV rounding cannot preserve fractional-size detail. A true zero-span plane-like carrier is different and remains valid; intentionally small, functional 3D geometry can use explicit per-face UV instead. Existing legacy Cubes remain inspectable and report `box_uv_subunit` quality risks rather than being silently rewritten. Legacy thin axes can be moved/enlarged without blocking unrelated repairs, but new or worsened sub-unit spans remain blocked. The same pre-Undo guard protects parametric recipe upserts, not only `manage_cubes`. This is a resolution/representation guard, not a universal minimum 3D-feature size.

In a single `manage_cubes(create)` batch, identical untextured Cubes with the same resolved parent, coordinates, pivot, rotation and inflate are rejected **before native Undo** as redundant overlapping masses. This is an exact-duplicate guard, not a universal near-overlap or tiny-geometry ban; independent bones, different transforms and explicitly authored per-face layers remain possible.

Prefer fewer meaningful Cuboids over dense approximations. Split a mass only for demonstrated different silhouette/orientation, separate transform/pivot/motion, genuinely separate visible volume, or verified technical constraint. Adding another Cube is not the default correction.

### Adaptive Cuboid Budget

There is **no universal Cube-count cap**. Complexity budget is earned by visible or functional need.

Each proposed Cube must pass at least one **Marginal Geometry Value** test:

```text
SILHOUETTE      changes a material visible contour
VOLUME          creates a materially distinct 3D mass/depth
NEGATIVE_SPACE  owns an opening/cutout boundary that Texture cannot own
CONTACT         establishes a visible attachment/contact surface
LAYERING        creates a materially separate 3D layer/inset/overhang
TRANSFORM       requires independent/shared transform ownership
MOTION          participates in articulation, clearance, or deformation spacing
TECHNICAL       satisfies a proven Bedrock/export/UV constraint
```

If a proposed Cube passes none of these tests, it is **REDUNDANT_GEOMETRY** and must be represented by Texture, merged into an existing mass, or omitted.

A Cube is not justified merely because:

- the reference contains a small color/shading boundary;
- more segments make a curve look numerically smoother;
- a neighboring Cube already exists;
- a tool can create it cheaply;
- symmetry makes it easy to duplicate;
- it hides a gap caused by a wrong primary mass;
- it increases apparent modelling detail.

### Representation Ladder

Use the lowest-complexity native representation that preserves the requirement:

```text
1. TEXTURE / alpha detail
2. one SOLID_CUBOID or PLANE_LIKE carrier
3. one rotated Cuboid
4. one LAYERED_SURFACE relation
5. CROSSED_PAIR cutout carrier when view coverage requires it
6. small SEGMENTED_FORM cohort
7. denser segmented approximation only after lower levels visibly fail
```

Escalate **one level at a time**. Do not jump directly to dense segmentation.

A more complex level is justified only when the simpler level causes a material failure in one of:

```text
silhouette
volume/depth
opening/negative space
contact/layering
motion/articulation
reference-critical identity landmark
```

### Segmented Curve Rule

A curved/organic/sloped form may use several rotated Cuboids, but every segment must own a meaningful change of direction, silhouette, contact, or articulation.

Reject:

```text
micro-segments whose removal is visually immaterial
unit-Cube staircasing used as generic smoothing
multiple almost-collinear segments with no visible contour benefit
hidden segments that only fill internal volume
```

Prefer the **coarsest segment count that preserves the required contour** at the relevant reference/model viewing scale.

For articulated chains, segment count may be driven by motion topology rather than static smoothness; do not merge across a required joint.

### Merge / Remove Challenge

Before secondary Geometry PASS, perform one cohort-level simplification challenge:

```text
For each dense/repeated cohort:
- can adjacent Cuboids merge without changing a material contour?
- can a repeated surface detail move to Texture?
- can one rotated Cuboid replace several stepped Cuboids?
- can alpha own the internal silhouette on a planar carrier?
- is any Cube compensating for an incorrect neighboring mass?
```

Only mutate when the answer is evidence-backed; this is not an automatic simplifier.

The intended outcome is **minimum sufficient geometry**, not minimum node count.

### Complexity Escalation Gate

Before adding a dense cohort (`>= 4` new Cuboids for one local feature), record a compact reason:

```text
feature
simpler representation attempted/considered
material failure of the simpler representation
why the proposed cohort fixes that failure
```

This reasoning is transient; do not create a persistent per-Cube bureaucracy.

Repeated/symmetric cohorts should still be authored in one coherent batch after the representation decision is made.

## Surface Integrity Contract

Surface integrity means **every material surface relationship is intentional**, **not that every model is universally watertight**.

```text
CLOSED_BOUNDARY
INTENTIONAL_OPENING
LAYERED_OFFSET
INTENTIONAL_INTERSECTION
CUTOUT_CARRIER
```

When adjacency, layering, or contact is material, combine fresh whole-form views with one bounded `inspect_model_bounds` review. Runtime hints such as `z_fighting`, `micro_gap`, `coplanar_edge_gap`, or `shallow_penetration` require judgement; they are not semantic verdicts.

Required closed boundaries must not contain visible uncovered gaps. Intentional openings remain open. Hidden structural intersection may be intentional. A valid plane-like carrier is not degenerate merely because one axis has zero span.

Geometry PASS requires no unresolved material surface risk. A clean diagnostic does not create visual PASS, and positive-volume overlap never proves contact.

## Attachment / Contact

Visible connection quality is judged visually. **AABB overlap or hierarchy alone is not proof.** Avoid floating required parts, accidental penetration, exposed coplanar overlap, excessive unreadable intersection, or compensating Cubes used to conceal a wrong mass relationship.

## Correction Vocabulary

```text
TRANSLATE    placement wrong
RESIZE       extent/proportion wrong
ROTATE       orientation/slope wrong
REATTACH     contact/parent wrong
LAYER OFFSET visible layer separation/inset wrong
SPLIT        distinct orientation/volume genuinely needed
MERGE/REMOVE unnecessary or compensating geometry
ADD MASS     required visible volume genuinely missing
```

`LAYER OFFSET` describes the cause, not a mandatory numeric mechanism. Use `ADD MASS` only when evidence shows missing volume.

## Correction Accuracy Contract

Reuse fresh exact authored state when sufficient. Call `inspect_elements(mode=detail)` once only when required current state is missing or stale.

Before mutation declare:

```text
mismatch + supporting view(s)
causal class
exact target UUID(s)
current authored state
invariant(s) that must remain unchanged
expected structural effect
```

After `manage_cubes(operation=update|batch_update)`, inspect returned `geometry_effect` fields such as `changed_fields`, `center_delta`, `size_delta`, `rotation_delta`, `origin_delta`, `inflate_delta`, and visibility change. If the structural effect violates the declared invariant, the correction is invalid before visual review.

Only after structural effect matches intent should fresh affected views decide `IMPROVED | UNCHANGED | REGRESSED`. Same causal correction failing twice without new evidence → stop and reframe.

## Geometry vs Texture

Use Geometry for required 3D behavior. Use Texture for surface information. Texture must not hide incorrect Geometry, but Geometry must not duplicate detail that Texture can carry without changing the 3D requirement.

## Symmetry

Use symmetry/mirroring only when the reference supports it. Preserve meaningful asymmetry. Do not infer hidden features from symmetry without evidence.

## Hierarchy / Naming

Hierarchy exists for transform ownership, articulation, attachment, or useful organization. Use semantic names and stable UUIDs for mutation identity. Hierarchy never justifies bad placement/pivot/contact.

## Functional Anchors / Locators

A required non-visible effect, hold, or attachment point that needs transform identity but no visible volume is **Locator intent**, not a hidden/placeholder Cube. When that attachment/reference point must move during animation, parent the Locator under the appropriate animated Group/Bone so it inherits that transform. Current animation authoring targets Group/Bone owners, not Locator elements directly.

## Bedrock Export / Skeleton Hygiene

These are compatibility guardrails, not reasons to redesign otherwise-correct Geometry.

### Bone identity

New Bedrock bone/Group names should be stable, unique, and `snake_case`. Animation files address bones by name, while LazyDesigner mutations should continue to prefer UUIDs when available. Do not rename an already accepted/external-facing hierarchy merely for style; rename only when ambiguity/invalid naming is a real compatibility problem and propagate references through the existing rename path.

For a new independent entity hierarchy, prefer one intentional semantic root bone when a whole-asset transform/root animation capability is useful. Do not add an empty root as ceremony when an established template/attachment hierarchy already provides the correct parent contract.

### Box UV compatibility

Bedrock Box UV mapping is integer-oriented and native tooling can round fractional cube dimensions during mapping. Therefore:

```text
fractional Geometry is visually/structurally required
+ Box UV mapping would lose/stretch a face
→ keep the Geometry
→ use/verify per-face UV instead of resizing the model for UV convenience
```

Do not force valid fractional Geometry to whole-number dimensions solely to satisfy Box UV. When Box UV is retained, verify its native mapping before Texture Styling.

### Locator inheritance

A Locator follows its parent bone transform. Keep `ignore_inherited_scale=false` by default. Set it only when the attachment/effect point must inherit parent position/rotation while explicitly discarding parent scale. Treat that as attachment semantics, not a generic optimization.

## Completion Criteria

Geometry is ready for UV/texture only when whole primary form passed visual review, representation choices match the visible 3D requirement, small/detail Geometry survived the guardrail challenge, dense cohorts survived the merge/remove challenge, major proportions/contacts are coherent, required surface relationships are intentional, material shared transforms have an owner, required primary hierarchy/pivots are established, each material rotation/pivot has a reason, Cuboid count is purposeful, no major geometry issue remains, and visual claims use fresh current-revision evidence.

## Related

- [Authoring Workflow](../workflow.md)
- [Visual Validation](../validation/visual.md)
- [Product Flow](../../01-product/flow.md)

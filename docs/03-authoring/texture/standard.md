# LazyDesigner — UV Layout & Texture Standard

**Status:** Active Policy  
**Version:** 1.8
**Updated:** 2026-09-09

## Purpose

Define durable UV Layout, Texture Atlas, Texture Styling, and Texture Verify rules for Minecraft Bedrock models after geometry is coherent.

This policy separates concepts that must not be collapsed into a generic “texture” step.

## Canonical Vocabulary

```text
GEOMETRY        = 3D form, proportion, topology, attachment
UV LAYOUT       = geometry → atlas coordinate mapping
TEXTURE ATLAS   = bitmap/PNG canvas that stores pixels
TEXTURE STYLING = color/material/shading/detail authored into the atlas
TEXTURE VERIFY  = fresh atlas + mapped-model visual validation
```

Hard boundaries:

- UV Layout contains no color/style decision.
- Texture Atlas creation contains no proof of styling quality.
- Texture Styling does not own geometry shape or UV ownership.
- Texture Verify is evidence, not another authoring pass.
- `create_texture(type=blank)` creates only a **Texture Atlas**. `create_texture(type=template)` delegates UV Layout and template bitmap generation to Blockbench's native generator before Texture Styling.
- `uv_offset`, `autouv`, `mirror_uv`, per-face UV, and `box_uv_region` are **UV Layout** state.
- Painter operations are **Texture Styling**.

## Authoring ownership

Production UV Layout is a **Geometry/Modelling-owned mapping and approval gate**. This document specifies the UV constraints, native template mechanics and texture-facing audit that Texturing must respect; its title does not transfer UV Layout authorship to Texturing. After Geometry APPROVED, Modelling owns UV production, native UV lock, review and UV Layout PASS. Texturing owns the atlas pixels, style, PBR/material state and mapped-model texture evidence. A `create_texture(type=template)` operation can perform native UV arrangement on the shared AUTHORING Runtime Surface, but any resulting UV layout still needs Geometry-owned verification; it is not an implicit UV PASS or a substitute for the unregistered `manage_uv_layout` tool.

## Core Principle

**Texture Styling supports geometry; it does not repair geometry.**

Use styling for color/material identity, pattern, form readability, highlights/shadows, small surface detail, and information that does not need silhouette/real volume/separate motion. If silhouette, proportion, attachment, or required volume is wrong, fix Geometry first.

### Alpha-owned silhouette carrier

The rule above still holds for normal Geometry. Narrow exception: when Geometry has explicitly chosen `PLANAR_CUTOUT_CARRIER`, its plane-like carrier is valid Geometry and alpha intentionally owns only the 2D silhouette/holes inside that carrier. This must not invent missing depth, volume, contact, or motion. Geometry changes carrier count/envelope/orientation/contact; Texturing changes the in-plane alpha. Binary cutout uses 0/255 alpha with a compatible `cutout` / `entity_alphatest` consumer; true translucency remains a separate render contract.

## Production Workflow

```text
explicit Geometry APPROVED
↓
UV LAYOUT
↓
UV LOCK / AUDIT
↓
TEXTURE TEMPLATE / ATLAS
  native UV arrangement + exact pixel grid
↓
TEXTURE TREATMENT PLAN
   region + evidence + surface_pattern + render_profile + optional PBR intent
↓
TEXTURE STYLING
   BASE PASS
   VALUE / FORM PASS
   SURFACE PATTERN PASS
   IDENTITY PASS
   SECONDARY DETAIL PASS
   RENDER / ALPHA VERIFY
↓
TEXTURE VERIFY
↓
FINAL PASS
```

A placeholder/flat fill may make geometry readable early, but it is provisional and is not production completion.

## Native Texture Template

When UVs must be rebuilt, use `create_texture(type=template)` with an explicit `pixel_density` (16x means one model unit per pixel), `rearrange_uv=true`, and the required occupancy/padding/power-of-two settings. The native generator writes the UV arrangement and template bitmap with nearest-pixel behavior. Do not approximate this phase with manually guessed face rectangles, stretched source images, or color-only fills. Inspect the fresh UV audit and atlas before any styling operation.

# UV Layout

## UV Layout Purpose

UV Layout answers only:

> Which atlas region does each model surface read?

It owns mapping, orientation, reuse, mirroring, seams, bounds, and lock state. It does not own palette, shading, material appearance, or detail.

## UV Requirements

Important visible surfaces must have usable finite UVs. For new AI production:

- important faces remain inside the logical canvas;
- require integral physical texel mapping; fractional logical UV is valid when it maps to whole physical pixels;
- accidental partial overlap is rejected;
- exact reuse is allowed when intentionally symmetric/repeated;
- mirror use is deliberate;
- directional/asymmetric markings have suitable orientation;
- per-face UV repacking preserves native signed U/V corner order (including authored flips) and face rotation rather than normalizing mirrored UVs;
- seam-critical relationships are known before Texture Styling.

Do not optimize atlas occupancy as a quality score.
Named `semantic_group` cohorts now participate in the existing MaxRects layout: a complete repack may compare one area-first and one cohort-first candidate, adopting cohort order only when both are valid and measured normalized semantic spread decreases. Fit, padding, rotation and existing UV reuse remain hard constraints. Unnamed islands retain area-first behavior; semantic spread is an editability diagnostic, never a visual-quality score.

Physical-pixel boundaries are the shared invariant across UV packing, semantic native apply and texture audits: a fractional logical UV is valid only when its mapped physical U/V coordinate lands on a whole texel. Quantize new density requests **upward** to whole physical pixel extents rather than silently reducing requested detail; then inspect mapped aspect, material, and visual fidelity. Explicitly shared UV regions must stay in one allocation even when member priorities differ. Incompatible member size, padding or rotation constraints block the repack instead of silently splitting one authored pixel owner.

Native packing alone is not a production layout verdict. Organize exact native islands into named semantic zones (body, head, appendages) with stable order and gutters; translate islands without changing their native aspect or density. A scattered atlas that is hard to identify/edit fails this gate even when all UVs are valid.

## Box UV / UV Lock

Box UV is a first-class Bedrock workflow.

For fresh AI-authored Box UV:

```text
manage_cubes(operation=create)
→ deterministic initial uv_offset / returned box_uv_region
→ geometry correction while autouv remains active
→ explicit Geometry APPROVED
→ one coherent final UV lock with autouv=0
→ list_textures global audit
→ TEXTURE ATLAS
→ TEXTURE STYLING
```

Do not manually recalculate a fresh `box_uv_region` already returned by `manage_cubes`. Use `inspect_elements(mode=detail)` only when face-specific mapping/orientation is actually required.

Per-face authored UV follows explicit face rectangles.

## Global UV Audit

The audit distinguishes at least:

```text
invalid/non-finite UV
out-of-bounds faces
fractional UV candidates
unlocked Box-UV Cubes
exact reused regions
partial-overlap candidates
```

Existing exact-reused UV regions with an explicit compatible `stack_group` remain one allocation during coherent full repacking, with separate native face identities preserved. A selected/affected repack that would move only part of an existing shared region now fails before native mutation; an island lock applies to its actively shared cohort. Equal dimensions by themselves **never** create new sharing; independently painted parts need texture/evidence review before any new overlap.

Exact reuse can be correct. Partial overlap is a review condition because it can silently corrupt unrelated styled regions. Degenerate/zero-area UV may occur on sheet/zero-thickness geometry and is not automatically a defect.

**Geometry-aware styling on reused UVs:** before compiling face-derived wear,
contact/cavity or upward-exposure masks, inspect the actual texel ownership.
A single shared atlas region cannot express incompatible per-face exposure or
contact intent. Exact UV reuse remains valid only when the reused faces demand
compatible geometry-driven treatment. This stricter automated-mask preflight
rejects partial rasterized overlap or different logical UV mappings that alias
the same physical texels; it does **not** turn every general UV overlap review
into a global geometry failure. Return conflicting ownership to the Geometry
UV owner or use a separately verified material treatment without claiming
independent per-face shading on shared pixels. Compiled masks are diagnostic
authoring inputs, not mapped-model visual PASS.

## UV Stability

Do not change UV Layout after substantial Texture Styling without a concrete reason.

**Source-only fail-closed protection for repacking an existing atlas:** until an atomic pixel migration with preserved signed face orientation, shared UV ownership, variants/PBR alignment, and verified Undo exists, automatic `create_texture(type=template, texture_id=..., rearrange_uv=true)` and the future U7 `manage_uv_layout` native apply must not rewrite UV ownership while a mapped texture contains any nonzero decoded RGBA channel. Fully transparent **but nonzero RGB** is authored data, not proof of blankness; layers, animation frames, inconsistent bitmap evidence or unreadable pixels also block the operation. A strictly zeroed, flattened, single-frame atlas can be repacked. This safeguard deliberately **does not implement** texture-pixel migration and does not claim visual correctness. The non-repacking atlas resize is a separate operation and has its own constraints.

**Migration candidate is not an apply operation:** `mcp/lib/uv/pixelMigration.ts`
can compute a pure, deterministic RGBA candidate from one pinned U7 plan and
every explicitly supplied, flattened static dependent texture. It preserves
signed U/V face orientation, face-local quarter-turns, complete Box-UV nets,
shared source texels and cyclic swaps without sequential-copy damage.
It refuses any resampling, overlapping fixed ownership, nonzero foreign
destination content (even at alpha 0), inconsistent PBR/variant snapshot or
unrepresentable pixel boundaries. Its bounded results are explicitly
`candidate_only`; scene ownership, native Undo/persistence and mapped-model
appearance are **not attested**. The previously installed pre-Undo guard on
painted atlases stays active. Pixel migration cannot be enabled for a real
model until a texture+UV atomic native owner proves safe apply, rollback and
visual correspondence.

**Atomic source contract, not an activated workflow:** The
`mcp/lib/uv/pixelMigrationTransaction.ts` adapter contract requires
complete Cube-only scene ownership and every project Texture UUID,
exact preflight SHA-256 RGBA revisions, a second whole-state read before
a synchronous bitmap+UV Undo, exact post-apply UV/bitmap readback, and
verified restoration of **both** on failure. Partial Undo ownership or
uncertain finishEdit is `UV_PIXEL_MIGRATION_OUTCOME_UNKNOWN`, not permission
for an automatic retry. The unregistered native adapter source now exists beneath
`mcp/server/runtime/uv/pixelMigrationRuntime.ts`: it enumerates all Cube
and Texture objects, preserves face-to-texture UUID bindings, writes flattened
atlas RGBA with native `Texture.edit`, reuses UV native instructions, and
scopes one combined bitmap + UV Undo. Its simulated runtime tests are NOT
installed Blockbench evidence. Actual Undo/codec/save-reopen/appearance,
non-Cube scenes, layers, and animations are still outside accepted support.
The existing painted-atlas mutation block remains active until native
acceptance and authorized generator-coupled activation are available.

A material UV change invalidates affected downstream assumptions:

- mapped physical region;
- orientation;
- seam continuity;
- shared/reused pixels;
- styled alignment;
- variant alignment;
- PBR/channel alignment where applicable.

Re-check only affected downstream state.

# Texture Atlas

## Atlas Purpose

Texture Atlas is the bitmap/PNG canvas that stores pixels. It is separate from logical UV mapping and separate from styling.

## AI Authoring Canvas Standard

For **new AI-authored Bedrock Entity projects**, logical UV is **128×128 by default**, with **256×256 opt-in**.

The production base-color bitmap uses explicit square 128-based sizes:

```text
128×128
256×256
384×384
512×512
...
```

Choose the smallest sufficient bitmap. Logical UV dimensions and physical bitmap dimensions are different concepts.

```text
128 logical → 128 bitmap = 1× physical pixels per UV unit
128 logical → 256 bitmap = 2×
128 logical → 512 bitmap = 4×
```

Iterative/non-production work may use provisional square 16-based canvases `16..1024`; promote to 128-based before final production. Imported/existing assets may preserve authored nonstandard dimensions.

## Single Base-Color Atlas

Normal production uses **one base-color atlas PNG for the whole model**. Do not create base-color atlases per body part, Cube, material family, or object section.

```text
no base atlas            → create one
one base atlas           → reuse it
multiple base candidates → resolve fragmentation first
```

An explicit color variant may reuse the established Geometry + UV Layout but belongs to an explicit non-material TextureGroup.

Normal/height/MER are PBR support atlas channels. They do not change UV Layout ownership and should match the base bitmap size for new AI authoring.

## Atlas Identity

Retain the base atlas UUID as continuation state and pass `texture_id` explicitly whenever multiple textures are present. Do not rely on whichever texture happens to be selected/default.

Creating an atlas, clearing it, or filling it with one color is **not Texture Styling completion**.
Pixels outside mapped islands stay transparent, apart from deliberate bounded edge padding. Opaque render intent applies to mapped surfaces; it does not require filling unused atlas space. Full-atlas alpha statistics must not trigger an opaque background fill.

# Texture Styling

## Styling Purpose

Texture Styling owns the visual pixels:

```text
palette
material separation
surface_pattern
value / hue
face/form readability
contact / occlusion
edge treatment
identity-critical marks
controlled secondary detail
```

Before detailed styling establish physical pixels per UV unit and readable detail scale.

## Treatment Plan

Before broad painting, convert approved reference evidence into semantic regions. Each region independently records:

```text
reference evidence state
surface_pattern
render_profile / minecraft_material_code
optional pbr_intent
identity colors / notes
```

`surface_pattern` describes visual pixel language only. `render_profile` describes Minecraft render behavior only. PBR remains optional and explicit. Missing evidence stays unresolved; object/category names never fill it automatically.

## Material-Family Palette Ramps

A production texture uses material-aware ramps, not one global brightness ladder and not one flat color per material.

Relevant roles include:

```text
base
shadow / deep shadow when needed
highlight / edge highlight when needed
controlled hue movement
material-specific secondary hue
identity/accent color
```

Reason about **value and hue**. Brightness-only ramps often look procedural and lifeless.

## BASE PASS

The base pass establishes primary/secondary colors, material zones, accent/focal colors, and basic value separation.

A flat fill is only a **BASE PASS** when supported form/material/detail exists. No important required surface should remain unintentionally blank.

## VALUE / FORM PASS

Add controlled information that helps geometry read:

```text
face/form separation
material-specific shadow/highlight
local form transition
contact / occlusion
edge treatment
value / hue ramp
```

Prefer stepped pixel ramps for Minecraft/pixel-art styling. Continuous smooth gradients are optional only when the requested style/reference needs them.
Require visible, intentional pixel clusters at normal mapped-model scale with Shading ON: distinct value masses, form-following folds and readable identity accents. Barely visible noise or low-contrast formula variation remains BASE_ONLY; coverage/variation counts cannot upgrade it to STYLED.

Texture may reinforce real contact/recess/overlap/underside/joint depth but must not invent missing large volume.

## SURFACE PATTERN PASS

Apply the selected `surface_pattern` recipe to each material cohort only after BASE and VALUE/FORM are readable. Recipes describe directionality, cluster language, value behavior, edge behavior, secondary detail, and anti-patterns. They are not bitmap presets and never select transparency/glow/PBR by name.

Examples include `wood_grain`, `painted_metal`, `stone_cluster`, `cloth_weave`, `clean_glass`, `rubber_matte`, `fur_cluster`, and `emissive_panel`. Reference evidence overrides the generic recipe.

## IDENTITY PASS

Identity-critical features include required markings, facial features, emblems, wraps, seams, panel lines, symbols, and recognizability-critical color breaks.

Identity comes before microdetail.

## SECONDARY DETAIL PASS

Use controlled material variation at the chosen physical pixels-per-UV-unit scale. Noise-first painting is rejected.

For crisp Minecraft texture:

- use deliberate pixel clusters;
- use hard texel edges;
- avoid accidental softness/antialiasing;
- for ordinary opacity/cutout authoring, default authored alpha intent is **0 or 255**.

Intermediate alpha is valid only when material behavior requires translucency/blending **or another declared non-opacity alpha semantic such as color/emissive masking**. Never classify the byte range before resolving `render_profile`.

## Render Material / Alpha Contract

Alpha meaning is downstream-material dependent and must not be inferred from PNG/TGA pixels alone:

- opaque/default entity rendering uses the normal `entity` material;
- cutout transparency requires a compatible alpha-test consumer such as `entity_alphatest`;
- true translucency requires a blending consumer such as `entity_alphablend`;
- `entity_change_color` uses alpha as a color mask;
- `entity_emissive` uses alpha as emissive intensity and requires TGA;
- emissive/translucent and layered variants have their own declared contracts.

Use `manage_render_profile` to inspect/bind `client_entity.description.materials` and ordered render-controller bone assignments. `render_mode` remains Blockbench preview state and is not Minecraft runtime proof.

If the downstream client-entity/render material is unknown, alpha-dependent appearance is **UNVERIFIED**. A texture-wide intermediate-alpha scan is only a candidate signal because one atlas can serve bones using different render profiles. Do not treat a transparent-looking atlas preview as Minecraft runtime proof.

## Paint Safety / Atomic Authoring

Use existing Blockbench Painter controls only when they protect declared intent:

- `pixel_perfect` for crisp freehand pixel clusters;
- `lock_alpha` for recolor that must preserve transparent regions;
- `paint_side_restrict` when freehand work could bleed onto another face;
- mirror painting only after left/right semantic symmetry is established.

For a known non-layered target with a fresh texture revision, `paint_texture_transaction` is preferred for one bounded exact-pixel batch because it provides optimistic stale-state protection and one Undo unit. Layered artistic work stays with native Painter tools.

## Mirror / Reuse

Shared/mirrored UV regions are intentional only when surfaces should share pixels.

Avoid shared regions for text/symbols, left/right-specific detail, directional marks, deliberate asymmetric wear, and unique identity features. An explicit Authoring Recipe `uv_policy: SHARE` cannot coexist with `texture_policy: UNIQUE`: a single atlas region cannot carry independent pixel treatment, so semantic UV derivation rejects the conflicting relationship rather than making an unsafe shared alias. Change UV Layout ownership before styling unique content.

## PBR Boundary

PBR is optional and evidence-driven.

Normal/height/MER are support Texture Atlases. PBR does not replace Texture Styling quality and does not justify base-atlas fragmentation.

For active variants/PBR, `list_textures.production_alignment.gate` is the technical consistency gate:

- dependent bitmap dimensions and logical UV mapping must remain aligned with the single production base atlas;
- one material owns at most one texture per semantic PBR channel;
- `normal` and `height` are mutually exclusive depth sources;
- PBR support textures must belong to a material TextureGroup;
- detached superseded support textures are inventory, not an active production failure.

PBR channel images are **data maps**, not ordinary color styling:

- normal RGB encodes surface direction and is an alternative to height;
- height is scalar displacement information and must not coexist with normal in one texture set;
- MER RGB maps Red=Metalness, Green=Emissive, Blue=Roughness.

Do not invent normal/MER data from palette intuition. Use material preview/reference evidence and keep unsupported or unverified PBR intent explicit.

`production_alignment=ready` proves mapping/channel consistency only. It does not prove that normal/MER values are artistically good or that the Minecraft runtime consumer is configured correctly.

# Texture Verify

## Verification Purpose

Texture Verify asks whether the atlas pixels, when mapped through the final UV Layout onto the model, produce the intended result.

Required evidence for visual claims:

```text
fresh Texture Atlas image
+
fresh affected model view(s)
```

Review in this order:

```text
1. UV Layout validity / bounds / overlap / lock
2. Texture Atlas ownership / fragmentation / scale
3. treatment-plan region ownership + palette/material separation
4. form + contact + edge readability
5. surface-pattern language
6. render/alpha contract
7. seam / orientation
8. identity-critical marks
9. secondary detail density
```

**Intentional boundaries within one Cube:** Face edges may legitimately
separate different materials, painted panels, or deliberately different
lighting. The intra-Cube seam diagnostic accepts an optional, caller-declared
`continuity_intent=INTENTIONAL_BOUNDARY` on either face edge and excludes
only that valid paired boundary from contrast-review candidates, accounting
for it separately. `REQUIRED`, `UNSPECIFIED` and absent intent retain the
existing advisory comparison; never infer intentional design solely from
strong contrast or empty findings. Ambiguous three-edge groups remain
unresolved, not suppressed by a single boundary flag. The declaration must
be grounded in the approved reference/material plan; it is not native proof,
permission to modify UV, or a visual PASS.

**Per-face correction ledger:** `optimization_opportunities.coverage.face_review_ledger` names bounded exact `cube_uuid + face` review targets across local directions, prioritizing missing pixels/UV, flat faces and undersides before area-only samples. Truncated examples never imply all surfaces are complete. The `STYLED` and `INTENTIONAL_FLAT` decisions remain reference- and mapped-view-owned, not inferred from pixel color counts. When one material cohort passes, propagate its treatment only to compatible faces; do not automatically repaint an occluded or visually unique surface.

**Diagnostic scan fairness:** the bounded physical-pixel scanner schedules Cube-local `down` and `up` before the larger front/side passes across the model, so small soles/undersides are not systematically starved by early large regions. This is a sampling priority, **not** a guarantee that every face fits into the fixed budget; `SCAN_BUDGET_EXHAUSTED` still prevents scan-complete claims. No extra image pass or automatic texture painting is implied.

**Directional coverage before visual PASS:** `optimization_opportunities.coverage.cube_local_face_coverage` reports scanned, omitted, transparent and detail-capable flat faces by Cube-local orientation, including `down` and `up` even when small examples are not selected by atlas area. This is not world-facing occlusion or an art-quality verdict. Every relevant face still needs an explicit mapped-view or intentional-flat/transparent/shared decision; vary camera/pose when previously hidden soles, underside joints or inner wings become visible.

**Incomplete intra-Cube seam evidence:** Two edges from the *same face*
are duplicate/ambiguous evidence, not a valid comparison pair. A pair of
different faces with unequal sample counts is
`SEAM_SAMPLE_ALIGNMENT_UNVERIFIED`, not a clean seam and not an automatic
color defect; sample counts must be comparable before RGB/alpha evaluation.
Ambiguous groups raise `SEAM_EVIDENCE_AMBIGUOUS`. These flags remain
advisory but require **targeted evidence or sampling correction** before
claiming that the affected seam is resolved. Do not paint over mismatched
sampling or invent intentional material boundaries to suppress unknowns.
An explicitly intentional two-face boundary is separately excluded from
the review even if its sample counts differ. An unrelated, adequately
sampled seam can still be reviewed without recapturing the entire atlas.
Use the bounded `evidence_gaps.sample_alignment_examples` and
`evidence_gaps.ambiguous_examples` to locate the affected Cube/face/sample
cohort; counts and truncated examples are navigation, **not proof** that
all unseen seams have been examined.

**Bounded Runtime seam coverage:** `list_textures(diagnostics=true, diagnostic_scope="seam"|"full")` now reports `seam_continuity.scan.coverage_state`: `edge_samples_only` when all eligible faces received bounded intra-Cube samples, `partial` when animated/mapping/budget omissions exist, and `not_evaluated` when none were sampled. Exact `cube_uuid + face + reason` examples are capped and may be truncated. `unexamined_face_count` counts missed eligible textured faces, not every potential occluded/untextured model surface. An empty review-candidate list is **not a clean-scene verdict**: only four sample points per edge are considered, cross-Cube native continuity is not sampled, and neither whole-face nor visual coverage is attested. `SEAM_SCAN_PARTIAL` makes omissions visible in the existing advisory gate without declaring visual failure.

**Cross-Cube seam diagnostics:** Compare edges only when the surface/material
identity and continuity intent agree, the world-facing normals align, and
both physical endpoints fall within the declared tolerance (including on
opposite sides of a coordinate rounding boundary). Merely sharing a
quantized coordinate, one endpoint, or a nearby T-junction is insufficient.
Three or more edges connected by tolerance remain **ambiguous**, never an
arbitrarily accepted pair. An `INTENTIONAL_BOUNDARY` stays excluded even
when geometry nearly coincides; a sharp color/material separation can be
correct according to the approved reference. The active `list_textures` seam workflow still tests intra-Cube edges only;
its cross-Cube result is not evaluated. An **unregistered read-only**
`inspectDeclaredNativeCrossCubeSeams` source helper is now available for
future native material-intent workflow integration. It requires exact
per-edge continuity/material/surface declarations plus the expected resolved
texture UUID and native face material name. The resolved `CubeFace.getTexture()` object must occur in
`Texture.all` and the project texture inventory where present; a changed
native face material, stale UUID or foreign Texture object is a bounded
omission, never a seamless comparison. It applies the current Cube
mesh's **world matrix** to `CubeFace.UVToLocal` endpoints before
comparing physical 3D edges; it rejects reflection/shear, degenerate
geometry, unsupported animation and insufficient texel evidence. It reuses
the existing bounded RGBA sampler and the pure cross-Cube comparison
owner. Source existence is NOT installed native proof or visual PASS. A matching
native texture UUID/material name does not validate the caller's asserted
`material_id`, prove an approved surface declaration, or pin a full decoded
RGBA revision. The helper reports `comparison_state` and still explicitly
does **not** attest texture revision, material approval, full scene coverage
or mapped visuals. Verify only ranked material seam candidates on fresh model views.

**Treatment-owned cross-Cube seam handoff (source only):**
`planTextureTreatment` may carry explicit pairs of `cube_uuid + face +
edge` targets as `seam_pairs`. Pairs must connect different Cubes and
refer to the complete `required_faces` ownership of the same treatment
plan; a target edge cannot be claimed twice. `REQUIRED` continuity needs
an explicit surface/material identity, compatible render/PBR cohorts,
no intentionally transparent face, and a **pair-scoped reference
observation**. That observation must name `reference_id`,
`reference_revision`, `observation_id` and both exact
`cube_uuid/face/edge` endpoints. A region marked
`evidence="observed"` without this pair observation is insufficient;
no seam is inferred from coincident geometry or matching colors.
These are caller-declared provenance labels, **not authenticated approval**.

`buildTextureTreatmentCrossCubeSeamHandoff` verifies all required face
bindings, not just paired seam faces. The unregistered
`inspectTreatmentBoundNativeCrossCubeSeams` reads current resolved
Blockbench texture UUID and native material names and delegates to the
existing conservative cross-Cube sampler. THREE `matrixWorld.elements`
accepts native `Float32Array`/`Float64Array` and ordinary 16-value
numeric arrays. Before touching native Cube/Texture objects, the handoff re-runs
canonical treatment validation. Edits made after planning—such as
changing material IDs, removing the observation or reassigning faces—cannot
reuse an old `ready` flag. The returned
`reference_observations` manifest explicitly uses
`CALLER_DECLARATION_UNVERIFIED`. Even when a plan is ready and an edge
is sampled, the result is **review-required**: material approval, texture SHA revision,
full scene coverage, installed native validity and mapped visual PASS
are not automatically attested. Production `list_textures` is unchanged.

**Exact Reference Package image identity for seam observations:**
The existing Gateway Control Reference reader now has an *unregistered,
read-only* bridge that checks a `seam_pairs[].reference_observation`
against a **current real image file** in `REFERENCE.json`. The
observation's `reference_id` must match a declared TEXTURE image ID,
`reference_revision` must be `sha256:<actual-image-SHA-256>`, and
the caller must pin the current Reference Package fingerprint. The
reader recomputes image bytes and denies stale/missing, non-TEXTURE,
non-`APPROVED` package-declared sources; no source bytes are copied
into diagnostic JSON. This is stronger than a made-up `source-v1`
label, but *package-declared APPROVED remains unverified user approval*.
Content identity does not establish that the image actually shows the
claimed Cube seam. The sampler is still unregistered and no visual
acceptance, material approval, model-wide coverage or texture pixel
revision is inferred.

**RGB seam evidence and alpha meaning:** Intra-Cube and cross-Cube seam
diagnostics use one sample-comparison rule. In `OPACITY` mode, RGB is
compared only when both corresponding texels have nonzero alpha; alpha holes
remain a separate discontinuity signal. When no RGB pair is visible, report
`mean_rgb_difference=null` rather than a misleading perfect zero, and
retain the evaluated sample count. For an atlas whose alpha represents an
emissive or color mask rather than opacity (e.g., `entity_emissive` or
`entity_change_color`), pass explicit `NON_OPACITY` semantics so zero-alpha
pixels still contribute to RGB comparison. The legacy pure diagnostic
default is `OPACITY` for compatibility, **not proof of the actual render
profile**. If the material consumer is unknown, color-visible seam
conclusions remain UNVERIFIED until alpha meaning is resolved. The analyzer
does not infer the material from PNG bytes.

`Texture Atlas exists`, `UV Layout exists`, or `paint tool succeeded` does not prove Texture Styling quality.

Texture mutation makes visual evidence stale. Correct only diagnosed failures and re-check affected evidence.

## Completion Criteria

Requested texture scope is complete when:

- Geometry dependency is coherent;
- UV Layout is finite, in-bounds, stable, correctly oriented, and final Box UV is locked;
- no unresolved accidental partial overlap remains;
- exactly one intended base-color Texture Atlas exists unless explicit variants are required;
- atlas identity and physical pixel density are known;
- material families have readable palette/value separation;
- visible form is not left as unjustified flat fill;
- reference-important regions have explicit surface treatment instead of generic noise;
- contact/edge treatment is used when materially useful;
- identity-critical markings are present;
- detail density matches physical pixels-per-UV-unit;
- no accidental soft/alpha artifacts remain for crisp pixel style;
- active variants/PBR have `production_alignment.gate=ready`;
- alpha-dependent appearance has a known downstream `render_profile`/material contract or remains explicitly UNVERIFIED;
- Texture Verify has no unresolved critical/major issue.

## Related

- [Geometry Standard](../modelling/standard.md)
- [Visual Validation](../validation/visual.md)
- [PBR Texture Set Standard](material.md)
- [Render Profile Standard](render-profile.md)
- [Surface Pattern Standard](surface-pattern.md)

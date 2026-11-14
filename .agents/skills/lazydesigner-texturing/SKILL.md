---
name: lazydesigner-texturing
description: In-use LazyDesigner Asset Authoring specialist for Texture Atlas, mapped-surface styling, materials/PBR, alpha/emissive, variants, texture correction and verification after Geometry/UV readiness. Do not use for Geometry construction, animation, standalone pixel-art/reference generation, MCP/plugin development, runtime debugging, or Skill maintenance.
---
# LazyDesigner Bedrock Texturing

## Activation Contract

```text
LANE: IN_USE
DOMAIN: ASSET_AUTHORING
CLASS: SPECIALIST
OWNER: TEXTURE_MATERIAL
```

Enter for mapped atlas pixels, styling, PBR/materials, alpha/emissive, variants, or Texture Verify. Geometry/UV defects need bounded Modelling correction, not Cube mutation here. Escalate to product development only with concrete Runtime/system evidence.


Geometry/UV capabilities remain available in the shared AUTHORING Runtime Surface for **Modelling-owned** bounded upstream correction; Texturing **must not borrow Cube/UV mutation or claim UV Layout PASS**.

User-authorized autonomy replaces approval waits with verified checkpoints; never claim user approval.

## Control Context Projection

Start from LazyDesigner Control's stage-specific Texturing projection; do not reload the complete Modelling Profile or Reference Package.

Keep texture intent, asset/profile, Geometry APPROVED + UV Layout PASS, material IDs, palette/identity, render/PBR/alpha constraints, approved reference views, current atlas/UV identity, and blockers.

If a decision-critical item is missing, request only that exact context through Control. Do not broaden into full-profile/reference loading as reassurance.

**Low-thinking hot-path decision:** before a new material treatment or broad propagation, confirm the *actual loaded* approved source pixels, current texture/model revision and latest user correction; first inspect one representative mapped patch/seam. Then execute the coherent material cohort and verify affected shaded views, including relevant back/side faces. If `list_textures` says `partial` or the corresponding model view is unseen, report the affected quality claim `UNVERIFIED`, not finished. A subsequent user Undo or correction supersedes the older style, even when an earlier tool receipt succeeded. This is a reminder of the existing Workplan and Fidelity rules, not another gate for known exact-RGBA edits or a reason for per-pixel captures.

**Optional deterministic CLI at a costly material-plan decision:** Only when an exact bounded `required_faces` inventory and planned material regions already exist, and a matching installed `lazydesigner.exe` is available through an authorized local agent host, the read-only `plan-texture-treatment --input plan.json --json` command may check face ownership, seam declarations and planning blockers *before* broad propagation. For a local source checkout, `bun run plan:texture-treatment -- --input plan.json --json` supplies the same planner. Use this only when the report could change the material decision; never make CLI use mandatory, write over a user asset, preload the third-party CLI-Anything vendor Skill, or replace current approved source pixels/UV evidence with caller-declared JSON. `PLAN_NOT_APPLIED` and planning `ready` are **not** Blockbench changes or artistic PASS. Known exact-RGBA edits remain on the direct Gateway path.

**Optional appearance-variant preflight:** When an approved base atlas and an explicitly scoped variant already have current Geometry/UV/rig/material declarations, `plan-appearance-variant --input variant.json --json` (or `bun run plan:appearance-variant -- --input variant.json --json` from the source checkout) reuses the existing `reviewBedrockAppearanceVariantContinuity` owner. Run only if a matching local CLI is available and it can catch a costly variant drift. A clear report means declared continuity only; it cannot prove RGB/accent-mask parity, source freshness, native Undo or artistic PASS. Never recolor from stale red pixels when the approved blue/master atlas is the source; native pixels and affected mapped faces remain authoritative. No CLI step for ordinary known-safe paint.

**Optional real-PNG diff at review:** If current, already captured `get_texture` source/variant PNGs are available and a consequential material or protected-region correction is unresolved, the read-only `analyze-texture-pair --input pair.json --json` (or Bun `analyze:texture-pair` from a local checkout) compares exact decoded RGBA using the existing native-compatible revision and region-diff owners. Declare `allowed_change_regions` only from the relevant approved change scope, and treat it as unauthenticated until checked against the original approval. A reported change outside that mask requires review; zero such changes is not an artistic, current-native, or user-approved PASS. Compare actual mapped model views before final approval. Do not call this on every paint or force new captures for trivial known edits.

**Knowledge focus (only when present):** `decision_packet.knowledge_focus` may point to `VC-MATERIAL` / `texture-authoring://case-tex-p01` or `VC-EMISSION` / `texture-authoring://case-tex-p03` for a source-declared `source_fact_id`. At a *material or emission decision* that is still unresolved, read only the selected existing case and compare actual approved reference pixels with the exact mapped faces/current atlas (and real renderer binding for emission) before choosing a treatment. Do not turn `REFERENCE_PACKAGE_CLAIM_ONLY` into sampled RGB, paint authorization or visual PASS. If the approved material is already fully specified, keep the direct editing path; no extra lookup per pixel, cohort or known safe edit. After a representative correction, compare matched mapped views and identity/contrast before propagation; `IMPROVED` requires actual evidence, not a source case match.

**Material source-image evidence (conditional):** `decision_packet.texture_surface_regions` offers up to six approved, hash-bound **source image** annotations; `box_uv` is normalized in the reference picture, **not** the Blockbench UV atlas or a paint coordinate. Treat `omitted_count > 0` as incomplete discovery, not permission to ignore other surfaces. At a material/identity decision, use the relevant active-stage image IDs with `status(reference_package_path=..., include_reference_images=true, reference_image_ids=...)` **only if the actual approved images are not already in the active review context**. The source metadata alone does not provide material RGB, mapping or visual PASS. Pair the real images with current `get_texture`, mapped `capture_model_views`, and exact Cube-face UV only when the region-to-face identity needs resolution. See the conditional `references/fidelity-styling-verification.md`, not an always-loaded reference corpus.

## Pixel Art Reference Intake

Pixel Art is conditional reference evidence, never a second Texturing workflow. When an approved Pixel Art artifact exists, consume only its compact visual handoff: identity, target grid/scale, authoritative palette/material/marking/alpha/orientation/style constraints, provenance, and blockers.

Pixel Art supplies visual constraints, not production UV/atlas coordinates, Blockbench texture IDs, material/render state, mapped-surface PASS, or particle semantics. Geometry owns UV Layout/lock/PASS; Texturing owns atlas pixels, materials and mapped-model verification. If native template creation rearranges UV, return it for Modelling review; never infer UV PASS.

Use the active handoff facts directly. Load `docs/02-reference/pixel-art/texture-reference.md` only when the Pixel-Art→Texturing boundary or missing visual contract is materially unclear; never load the full Pixel Art corpus as reassurance.

## Asset-Only Visual Runtime Boundary
No RP dev: opaque/cutout/blend/emissive; Texture variants asset-only.

## Entry / Correction
**No Geometry↔Texturing Runtime Surface switch.** AUTHORING↔Animation only: `HANDOFF_REQUIRED` + compatibility capability `switch_authoring_phase`.
Entry: **Geometry APPROVED + UV Layout PASS**; final Box UV locked with `autouv=0`, no invalid/out-of-bounds/partial-overlap.
unlocked/invalid UV → Geometry owner + bounded UV correction; no Runtime Surface switch.

## Direct Routing
Reuse fresh state.
```text
discovery → list_textures(); readiness → list_textures(diagnostics=true, diagnostic_scope=uv|coverage|seam|pbr|full)
face mapping → inspect_elements(mode=detail) only when needed
blank atlas resolution unknown → get_project_info once
atlas → list_textures / activate_texture / create_texture / get_texture
exact/deterministic pixel mutation → paint_texture_transaction
native fill/shape/brush/eraser behavior → paint_fill_tool|draw_shape_tool|paint_with_brush|eraser_tool
PBR/material semantics → manage_material / manage_material_instances
render/preview → declared profile + mapped-model evidence; explicit file integration → manage_render_profile
```
Unknown → `search_capabilities(limit=4)`. No confirmation rereads.
**Pass the exact native argument name:** production `get_texture` uses `texture` (optional `region` and full-bitmap `expected_revision` after the existing Runtime texture-contract wiring), while `paint_texture_transaction` uses `texture_id` and requires `expected_revision`. With multiple loaded textures, always supply the intended UUID in the correct field; describe only an uncertain schema. A focused region is a bitmap-pixel crop, not a source-image `box_uv` or mapped face target.

## Native Semantic Target Discovery / Material-Aware Recolor

For a user request naming a **part or material** rather than a Cube UUID,
reuse current exact targets if known. Otherwise use the existing
`list_textures(diagnostics=true, diagnostic_scope="coverage")` once and inspect
`semantic_target_candidates`. It is a bounded, opt-in navigation index of
current **native Cube names and material labels**, not image recognition or
source-approved artistic material classification. Never invent a semantic
alias, fuzzy-select the first match, or treat `face_targets_candidate` as
Texture/UV/visual PASS. Match the user's intended **kind** (`part` versus
`native_material`) and exact label; use its `face_targets` only if the
entire named cohort is returned and no review reason exists. On collision,
mixed atlas/material, unresolved binding, incomplete response or missing
target, inspect only the specific native faces via `inspect_elements` and
resolve with current reference/authoring intent. Do not turn a truncated
list into a partial repaint.

For a **recolor while preserving shading**, require an explicit intended
material cohort, a sampled *current atlas* source-hue swatch and an approved
target palette (or user-specified colors). Use the existing one-step
`paint_texture_transaction.compute` with `gradient_map` (authored target
ramp) or `generated_gradient_map` (declared target base/ramp), plus
`source_hue_color` and the complete `face_targets` in `compute[0].args`.
Never combine `face_targets` with `target_rect`, append unrelated compute
steps or silently recolor an entire atlas.

**Opt-in source-bound material-to-pixel ramp:** When *three exact, visible*
current-atlas samples can be identified as source shadow/base/highlight in
strict Oklab lightness order, pass them as `source_ramp` alongside the
source-hue selector. This maps the existing material's own value range to
the authored target ramp instead of flattening it through global 0..1
lightness. The target `ramp` may come from a reviewed approved reference;
the `source_ramp` must **never** be copied from reference image colors unless
those RGBs also exist on the actual target atlas.
**Observed source ramp (opt-in):** When the current selected face/ROI contains
an exact **opaque base swatch** plus actual darker/lighter shades, use
`source_ramp_from_selected_pixels:true` in the same selective gradient's
`compute[0].args` instead of manually enumerating three source RGBs.
`source_hue_color` is the existing sampled base, NOT an inferred material.
This computes existing shadow/base/highlight only from selected current-atlas
opaque texels of the same Oklch hue family, respecting
`protected_face_regions` and `protected_colors`. It refuses missing
or too-similar shades. Never combine the observed option and `source_ramp`,
invent a base swatch from an image crop, or claim material recognition.
Review `compute.execution.source_ramp_observation` and affected mapped
views before repeating on more material faces. For explicitly observed
identity/logo colors on the same face, pass up to 16 distinct exact RGBs
as `protected_colors`. The compute preflight requires every declared
source/protected RGB to be present on current visible pixels in the exact
target mask; no cross-face swatches, stale palette claims, or automatic
style recognition. Protected RGBs must not overlap the source hue swatch
or source ramp. This preserves exact RGB marks only, **not** semantic
identity when an editable pixel and a logo share identical RGB. For that
case, **only if the identity region is verified on the current mapped face**,
use `protected_face_regions:[{cube_uuid,face,rect:{x,y,width,height}}]`
inside the same `compute[0].args` with `face_targets`, one selective
gradient and `source_hue_color`. Rectangles use face-local **physical
pixels**; rotation, flipped UV and atlas mapping come from current native
Blockbench state. The mask preserves those exact texels even when they
share an RGB with the editable material. Do not invent an emblem rectangle
from a part name, normalized source-image crop or arbitrary atlas guess.
Unobserved identity regions remain `REVIEW_REQUIRED`; shared/stacked UV
cannot promise independent protection. Do not combine with `target_rect`.
This protection does not certify an image-to-face visual correspondence.
The existing native transaction retains texture/UV ownership, bitmap
revision and Undo. Missing/ambiguous source roles remain on the existing
direct editor/review path; do not fabricate three shades. Alpha, neutral
colors and artistic texture completion are separate evidence.

Apply the smallest representative material area, inspect the affected
PNG and mapped 3D view, then propagate the *same verified intent* to a
compatible cohort. Use current receipts/control_delta; do not reread every
pixel or rerun full diagnostics after a bounded successful transaction.
The label index and compute receipt prove neither stylistic fidelity nor
human acceptance. If no scoped recolor is needed, preserve the existing
direct exact-pixel/painter path.

## Execution Path Preference
Choose the cheapest executor that preserves the required visual behavior. Do not route through a native UI/Painter state merely because it resembles how a human would perform the edit.

```text
known exact RGBA/pixel coordinates
→ paint_texture_transaction

bounded repeated fill/erase/copy/noise over known pixels
→ one paint_texture_transaction when representable

artistic brush stroke / soft brush / connected stroke
→ paint_with_brush

native flood-fill semantics
→ paint_fill_tool

native shape semantics
→ draw_shape_tool

reference-supported continuous transition
→ gradient_tool

sample an already-authored pixel whose value is unknown
→ color_picker_tool
```

Rules:
- If the intended color is already known from the reference/palette/previous evidence, pass the color directly; **do not call `color_picker_tool` just to put a known value into Blockbench's active color slot**.
- Prefer one `paint_texture_transaction` for deterministic pixel cohorts; exact-pixel brush compatibility bypasses native Painter UI setup.
- Prefer native Painter only when brush/fill/shape behavior itself is part of the required result.
- Exact-data operations do not need proof that a Blockbench brush, slider, preset, or color slot was touched.
- Do not use `trigger_action`, `emulate_clicks`, or `fill_dialog` for normal texturing. Those are maintenance/UI fallbacks, not authoring executors.
- Do not call `activate_texture` immediately before a tool that already accepts explicit `texture_id` unless active-editor state itself is required for a subsequent human/native action.
- Batch a coherent texture-owned correction before verification; do not verify after each pixel/stroke.
- When a focused follow-up is required, reuse `continuation.next_action.evidence_request.args` if supplied: it contains exact `texture`, `region={x,y,width,height}` and `expected_revision` from the current native receipt. Do not manually treat right-exclusive `affected_rect` as width/height. The hint is not an automatic tool call or visual approval.
- For several already-planned paint transactions of one intent, use the existing Gateway `task_context_id` with `cohort_boundary=CONTINUE` on intermediate calls and `COMPLETE` on the last call. The Gateway suppresses **only verified intermediate** affected-region PNG transport; it never skips native mutation integrity checks or final visual review. Use a single-call/default route when immediate visual correction is necessary.
- When the final paint response includes an actual matching PNG and Control returns `REVIEW_RETURNED_EVIDENCE`, review those pixels directly instead of calling `get_texture` again for the same current region/revision. If Control requests `get_texture`, if the PNG is not visible to the AI, or if the final PNG does not cover earlier cohort edits, take the scoped read. An image receipt never substitutes for mapped-model reference fidelity or user approval.

## UV Gate
`uv_audit.production_gate`=ready = hygiene, **not UV Layout PASS**; review face aspect ratio, texel density, semantic UV reuse.
Requested atlas size/density are constraints; never silently enlarge; return to Geometry/UV if detail cannot fit.

## First Call
For production blank-atlas creation, pass explicit width/height from the current project UV contract; **do not rely on omitted size**. The Runtime's 16×16 blank default is compatibility/provisional behavior, not a production sizing recommendation.

New production authoring normally targets the approved atlas/density contract; absent stronger project authority, logical **128×128 default, 256×256 opt-in** remains policy. Reuse an already-approved atlas UUID instead of recreating it.

## Workplan / Coverage
Latest user correction before broad paint: verify one mapped material/seam, then propagate its cohort; palette `BASE | SHADOW | HIGHLIGHT | ACCENT/IDENTITY`. Organize material cohorts by approved material and shading role; verify representative mapped faces before propagation.
**Reference-aware pattern selection:** Inspect the approved crop for cluster shapes, value placement, detailed-versus-quiet areas and any visible motif direction. The internal `planTextureTreatment` helper binds claimed `pattern_observation` to source image/SHA/region/part; it is **not a callable Gateway capability**, and a matched claim is not visual PASS. Normal Codex uses that evidence to choose or reject an existing `surface_pattern` recipe, then uses `invoke_capability` with the actual paint/texture tools and reviews affected PNG plus shaded `capture_model_views` before cohort propagation. Do not select from a material/object name; ambiguous source traits stay `REVIEW_REQUIRED`. Known exact-pixel edits remain direct.
**Operational craft cases (conditional):** Existing on-demand texture-authoring://case-tex-p01 addresses material clusters, case-uv-p01 UV identity, case-tex-p02 intended seams, and case-tex-p03 explicit emission. They return advisory candidates, not pixels or permission to mutate. Load docs/02-reference/art-direction.md only if the relevant visual family remains unclear; no blanket noise or glow.
**TX-01 — source-grounded intentional pixel craft:** At a *material/identity styling decision*, use the actual approved source crop, current mapped Cube faces, physical texel density and Shading-ON model view to choose deliberate base/shadow/light **clusters**, focal accents and intentionally quiet surfaces. This refines the existing `TEX-P01` / `planTextureTreatment` / `surface_pattern` decisions; it is not a default noise, outline or dither pass. Do not distribute scratches, random speckle or identical high-contrast edge highlights across every material simply to create complexity. Preserve deliberate dithering, sparse glints or noise when visibly required by the approved style. A cinematographically lit reference is not proof that lighting should be painted into the atlas. If a focal-form mismatch is Geometry-owned, return the bounded defect upstream; if source regions or texel support are unknown, use `REVIEW_REQUIRED`, not auto-paint. Diagnose pixel fragmentation only as advisory evidence, not a beauty score. Apply the existing representative-patch → mapped-view comparison before cohort propagation; known exact RGBA edits stay on their direct fast path.

**Pixel cluster composition / focused correction (internal source path):**
For an initial blank or flat atlas, derive deliberately connected
shadow, highlight, accent, identity and detail clusters from the actual
approved reference crop. Record exact reference image SHA, crop/part
observation, Cube face, physical rotated/mirrored UV, palette and quiet
zones. A material name cannot imply a cluster layout. The existing
`sourceComposer.compileReferencePixelClusterPaint` maps bounded
rectangles and row spans to standard `paint_texture_transaction`
pixel operations, but is NOT a callable Gateway capability.

For an already painted opaque texture, `existing_painted_patch`
targets only one proven problematic area: require explicit
`expected_source_colors` for every edited cluster; do not base-fill
the entire face, touch alpha, identity marks outside the target, or
replay the previous plan after a mismatch. Reject stale revisions,
shared UV, partial native inventories and unverified correspondence.

The existing native transaction module now owns an *internal*
`executeNativeBoundClusterComposition` guard that compares current
Cube/UV/material/Texture bindings against the source snapshot and
rechecks before Undo, inside the native paint callback, and before
commit. This is NOT registered through `invoke_capability` and requires
a trusted serialized native caller plus authenticated approved image
evidence. A source compiler receipt still means
`source_compiled_needs_native_revalidation`, **not** permission to
invoke ordinary unguarded exact operations on a guessed face. Use
registered normal Paint tools only for already known-safe exact
edits until this internal bridge is given an authorized client route.

**Compact cluster request (internal integration preparation):**
`lib/texture/clusterAuthoringRequest.ts` owns one strict, compact
request shape: `texture_id`, `expected_revision`, `source_mode`,
`palette`, and named `faces` carrying reference claims, face-local
clusters and optional quiet zones. It forbids caller-invented
`bitmap`, `native_faces`, and UV metrics; the native
`executeNativeBoundClusterAuthoringRequest` reads those from
the live connected Blockbench scene and delegates to the one guarded
native transaction. On `existing_painted_patch`, exact old RGB
preconditions are mandatory for each cluster. Unknown colors, UVs,
reference observations or source approval require review, not guesses.
This is **source-level internal only** until canonical generated MCP
schema plus serialized Control evidence are connected. Do not send
this request through current `invoke_capability`: it is not registered.
The existing public `paint_texture_transaction.operations` remains
usable for independently verified **absolute atlas pixel** edits.

**Control Stage-bound preflight (internal, non-mutating):**
`gateway/control/prepareClusterAuthoringControlPreflight` validates
the compact source request and current bound Runtime project, active
Texturing Stage, Geometry APPROVED, UV PASS, Workspace/Reference asset
alignment, and current reference PNG/region identity. The verified
source path/fingerprint come from Control, **not** an arbitrary value
in the artist's cluster request. A successful source preflight
retains `mutation_authorized=false`; the existing native executor
must independently recheck Cube/UV/material, atlas revision and
approved image evidence after entering its serialized call. Do not
turn this internal helper into a Gateway tool or treat Control status
as direct authority to paint.

**Reference-byte verification for source clusters (Control/internal):**
`gateway/control/createCurrentClusterReferenceVerifier` uses the
canonical Reference Package image identity, actual PNG byte SHA-256,
stage `TEXTURE`, package-declared `APPROVED` status and visible
`SURFACE_DETAIL` part/region annotations. It must receive the exact
Cube UUID/face with each source claim; never pass only a user-supplied
SHA or infer crop-to-face alignment from a matching name. This verifier
is internal, not a callable Gateway capability, and checks source
metadata rather than artist-drawn cluster correspondence. An
unverified image/crop or changed package halts source-based automatic
painting; the internal one-Undo path also rechecks this source just
before native commit and rolls back on a mismatch. Independent
known-safe pixel editing remains available.

After one coherent material batch, use the existing
`get_texture(region, expected_revision)` / affected PNG and relevant
`capture_model_views` shaded views. A correction must be based on an
observed discrepancy and target only its actual causal pixels; output
`IMPROVED | UNCHANGED | REGRESSED` only from comparable visual
evidence. No per-pixel capture loop, no automatic quality score,
and no approval inferred from success receipts.

Face Coverage Ledger: `UNPAINTED | BASE_ONLY | STYLED | INTENTIONAL_FLAT | INTENTIONAL_TRANSPARENT | SHARED`. For a bounded material-treatment cohort with known faces, use the existing `planTextureTreatment` owner with `required_faces` plus `regions[].face_targets` to account for each Cube UUID + face before styling; `PAINT` is intent, not completed artwork. Missing soles/inner faces block treatment-plan readiness; shared faces require explicit source ownership. Region-only `ready` remains material readiness, never whole-model coverage. Use `optimization_opportunities.coverage.face_review_ledger.examples` for exact Cube UUID + face targets: fix scan omissions first, then reference-relevant flat/transparent faces, then mapped visual verification. Its bounded examples deliberately cover undersides/back-facing directions and report truncation; `varied` is NOT a styled verdict. Only mark `INTENTIONAL_FLAT`, `INTENTIONAL_TRANSPARENT` or `SHARED` after grounded material/reference/UV ownership evidence, never from a heuristic label.
`list_textures.optimization_opportunities.coverage.gate`: `incomplete|partial` / `FACE_ACCOUNTING_INCOMPLETE` → no completion; one `list_textures`/pass; `ready` ≠ visual PASS.
`states.varied` ≠ `STYLED`; `review.solid_color_faces` locates flat candidates, not failures.
Variants: color-only changes reuse the same `.bbmodel` and UVs; `list_textures.production_alignment.gate=ready`; `seam_continuity` (intra-Cube only; inspect cross-Cube contacts visually); `pbr_content`.

## Render-Format Guard

For format-sensitive profiles, load `render-profile.md`: `entity_emissive` requires TGA alpha semantics and `entity_emissive_layer` its layered-PNG contract. Pixels/Blockbench preview alone never prove Minecraft render behavior.

## Fidelity / Styling / Verification Deep Reference

**REQUIRED_ON_TRIGGER:** load the current content of
`references/fidelity-styling-verification.md` before:

- mapped texture work is being judged against the approved reference;
- a representative styling patch is ready to propagate;
- render/alpha/PBR verification is required;
- a texture-owned correction loop is active.

**NO_DEEP_REFERENCE:** a bounded exact-RGBA change with known pixel/atlas
identity and already verified UV/alpha/mapping state uses the normal
`paint_texture_transaction` path. Do not load the fidelity module merely
to re-enter an approved color. A new seam, material/value, alpha-render or
reference-fidelity ambiguity activates the corresponding review above.
Failure to obtain required-on-trigger content blocks the dependent
large-scale styling decision, not independent known-safe edits.

Hot-path invariants:
- compare mapped model surfaces, not atlas neatness alone;
- preserve Geometry-owned boundaries and return Geometry/UV defects upstream instead of painting around them;
- use integer texels and coherent material/value/pattern logic; unused atlas pixels remain transparent;
- no evidence-per-micro-mutation loop—finish a representative cohort, then verify affected mapped surfaces;
- tool success never creates Texture PASS; use fresh texture + mapped-view evidence;
- same causal correction direction twice without new evidence becomes BLOCKED.

## Stage Projection Exit
When Texturing reaches a review/handoff boundary, return only stage-relevant state to Control:

```text
changed material/texture cohorts
current atlas/texture identity
affected semantic part IDs
texture evidence freshness
upstream Geometry/UV blocker if discovered
texture-stage blocking unknowns
READY_FOR_USER_REVIEW | BLOCKED | HANDOFF_REQUIRED
```

Do not return or persist the whole modelling profile as texture state.

Animation → user Texture APPROVED + checkpoint → Animation Readiness Preflight → `HANDOFF_REQUIRED` → Gateway `switch_authoring_phase`, same task.
Handoff: `target_phase="animation"`, `reason`, `resume_from`, and object `readiness`:
```json
{"geometry_approved":true,"uv_layout":"PASS","texture_approved":true,"checkpoint":"<saved .bbmodel path>","no_blockers":true}
```
Never infer approval.

## Conditional Support — Not Default Routing
Conditional on user intent; not normal hot path.
`gradient_tool | color_picker_tool | copy_brush_tool | paint_settings | create_brush_preset | load_brush_preset | texture_selection | texture_layer_management | add_texture_group | list_materials | get_material_info | import_texture_set`.
`gradient_tool`: reference-supported continuous transition; no extra discovery/readback.
`color_picker_tool`: sample an existing pixel only when its exact authored value is unknown; never use it to re-enter a color already known from current evidence/palette.
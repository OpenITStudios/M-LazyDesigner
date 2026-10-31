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
**Pin atlas UUID and pass `texture_id` when multiple textures are loaded.**

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

## UV Gate
`uv_audit.production_gate`=ready = hygiene, **not UV Layout PASS**; review face aspect ratio, texel density, semantic UV reuse.
Requested atlas size/density are constraints; never silently enlarge; return to Geometry/UV if detail cannot fit.

## First Call
For production blank-atlas creation, pass explicit width/height from the current project UV contract; **do not rely on omitted size**. The Runtime's 16×16 blank default is compatibility/provisional behavior, not a production sizing recommendation.

New production authoring normally targets the approved atlas/density contract; absent stronger project authority, logical **128×128 default, 256×256 opt-in** remains policy. Reuse an already-approved atlas UUID instead of recreating it.

## Workplan / Coverage
Latest user correction before broad paint: verify one mapped material/seam, then propagate its cohort; palette `BASE | SHADOW | HIGHLIGHT | ACCENT/IDENTITY`. Organize material cohorts by approved material and shading role; verify representative mapped faces before propagation.
**TX-01 — source-grounded intentional pixel craft:** At a *material/identity styling decision*, use the actual approved source crop, current mapped Cube faces, physical texel density and Shading-ON model view to choose deliberate base/shadow/light **clusters**, focal accents and intentionally quiet surfaces. This refines the existing `TEX-P01` / `planTextureTreatment` / `surface_pattern` decisions; it is not a default noise, outline or dither pass. Do not distribute scratches, random speckle or identical high-contrast edge highlights across every material simply to create complexity. Preserve deliberate dithering, sparse glints or noise when visibly required by the approved style. A cinematographically lit reference is not proof that lighting should be painted into the atlas. If a focal-form mismatch is Geometry-owned, return the bounded defect upstream; if source regions or texel support are unknown, use `REVIEW_REQUIRED`, not auto-paint. Diagnose pixel fragmentation only as advisory evidence, not a beauty score. Apply the existing representative-patch → mapped-view comparison before cohort propagation; known exact RGBA edits stay on their direct fast path.

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
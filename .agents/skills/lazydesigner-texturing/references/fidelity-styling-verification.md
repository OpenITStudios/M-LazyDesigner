# Texturing Fidelity, Styling, and Verification Reference

Load this file only when reference-fidelity judgment, coherent styling propagation, render/PBR verification, or iterative correction is active.

Routing, UV gates, execution path, and coverage planning remain in `../SKILL.md`.

## Reference Fidelity Contract
Reference-driven Texturing inherits the approved visual authority used by Geometry; it must not invent a new interpretation merely because UV islands differ from the reference projection.

Use the Control projection as the first material contract. Before broad paint propagation, resolve only applicable entries:
```text
material/color region → matching reference evidence
identity marking → required location/orientation/relative scale
value structure → light/base/shadow relationship without baking scene lighting
pattern direction/scale → mapped-surface continuation requirement
transparent/cutout region → silhouette owner and render requirement
hidden-but-required surface → evidence or explicit intentional treatment
```
Evidence remains `SUPPORTED | PROVISIONAL | CONFLICTING | UNAVAILABLE`. A material identity marking, major region boundary, or cutout silhouette that is `CONFLICTING`/`UNAVAILABLE` must not be replaced with generic decoration and called fidelity.

Reference comparison is **mapped-surface-first**, not atlas-image-first. Compare the actual mapped model against the approved reference at comparable view/scale; the atlas is implementation evidence only. Preserve Geometry-owned part boundaries: Texture may clarify form, but must not paint around a missing/incorrect mass, attachment, opening, or joint defect to simulate correctness.

Prioritize correction by visible identity impact:
```text
wrong/missing identity marking
→ wrong major material/color region
→ broken mapped continuity / invented seam
→ wrong pattern direction or scale
→ wrong value/form read
→ secondary detail/noise
```
An improvement on one island is `REGRESSED` if the mapped model introduces a material seam, mirrored identity error, or cross-surface discontinuity elsewhere. Do not let atlas neatness override mapped fidelity.

Within a single Cube, preserve intentional painted/material or face-light
boundaries using the caller-declared `INTENTIONAL_BOUNDARY` on the applicable
edge rather than “correcting” contrast. This removes only a paired boundary
from advisory seam candidates; missing intent still receives diagnostic
comparison, ambiguous groups remain unresolved, and exclusion counts are
not evidence of visual PASS. Derive intent from the approved reference or
material plan, never automatically from the measured pixel difference.

Incomplete seam comparison evidence is not a paint defect: two edges from
the same face are `SEAM_EVIDENCE_AMBIGUOUS`; distinct faces with unequal
sample lengths are `SEAM_SAMPLE_ALIGNMENT_UNVERIFIED`. Recover only the
missing face/edge samples, then evaluate fresh comparable model evidence.
Do not shrink sample arrays to create a false agreement, treat an empty
candidate list as PASS, or initiate a corrective paint batch without a
confirmed difference and approved material intent. Read bounded
`evidence_gaps` examples for targeted resampling; omitted examples require
page/targeted follow-up, not a fabricated zero or full-atlas recapture.

For cross-Cube continuity, use **declared material/surface ownership and
intent** before comparing colors. The seam helper tolerates small world-edge
coordinate differences across rounding boundaries but does not infer a
defect from coincident geometry alone; an intentional boundary is excluded,
and edge groups with multiple candidate matches remain unresolved. Do not
repair color differences automatically or treat pure diagnostics as a fresh
mapped-model verdict.

For both intra-Cube and cross-Cube seam comparisons, inspect the alpha
meaning before interpreting RGB. The pure seam helper defaults to `OPACITY`:
RGB beneath a zero-alpha pixel is not visible contrast evidence and empty
RGB coverage is reported as `null`, not zero difference. For material
consumers using alpha as an emissive/color mask, explicitly select
`NON_OPACITY` so underlying RGB is evaluated. Without a verified render
profile, neither mode establishes a material or visual PASS; one-sided
opacity holes and alpha-mask differences remain advisory evidence.

### Exact reference pixels → native mapped-material verification

Control's `texture_surface_regions` is a **bounded source annotation index**, not a detected mask, material palette, native Cube-face UUID or texture UV. It may omit other parts/views when more than six candidates exist. Never paint the first six regions as if they were the entire object; choose the smallest source-confirmed material/identity discrepancy.

- If the approved source image pixels are absent from the current multimodal comparison, request only the relevant current Texturing-stage images via `status(reference_package_path=..., include_reference_images=true, reference_image_ids=[...])`. The returned image bytes, declared view and SHA identify that source revision; the package's `APPROVED` label alone cannot attest visual similarity or rights.
- A source `box_uv=[left,top,right,bottom]` is in **normalized source-image space**. Do not feed those four numbers to an atlas crop, `paint_texture_transaction`, or `manage_uv_layout`. Use existing `inspect_elements(mode=detail)` for exact face/texture ownership only when unknown, with the current UV layout and revision.
- The installed Runtime's existing `get_texture` extension accepts `texture`, optional `region={x,y,width,height}`, and `expected_revision`; it supplies a fresh full-bitmap revision and a region PNG when selected. `paint_texture_transaction` instead uses `texture_id` plus required full-bitmap `expected_revision`. An animated atlas crop uses absolute bitmap pixels; one-frame UV is frame-local, while a cross-frame crop cannot be treated as one logical UV rectangle.
- Compare **three distinct pieces of evidence** when making a visual decision: the approved source pixels, the selected current atlas region or affected-region receipt PNG, and a fresh shaded `capture_model_views` image showing the actual mapped faces. Source metadata, a clean pixel-craft diagnostic, and an atlas PNG alone cannot establish mapped appearance. A studio-lit concept illustration is not authority to bake its lights into every face.
- For a bounded paint mutation, prefer the returned `affected_region_png` and its revision/extent from `paint_texture_transaction` to an immediate redundant `get_texture` read. Re-read only if the desired face/extent is not covered, the revision is stale, the render/alpha semantics changed or the mapped model view is still needed; never confuse the changed atlas pixel crop with a model-view visual PASS.

**Material Treatment → Pixel Craft evidence boundary.** A reference-bound `planTextureTreatment` must not match a source claim unless its declared Reference Package status is `APPROVED`; missing/DRAFT status stays `REFERENCE_SURFACE_SOURCE_NOT_APPROVED`. A matching SHA/status remains caller-supplied metadata, **not independent pixel inspection, user approval, or permission to paint**. The current `get_texture` path ties `pixel_craft` and `color_profile` to the same decoded-RGBA crop that supplies the returned PNG. Check `evidence_revision`, `source_region` and `evidence_scope=REQUESTED_PNG_REGION`; the palette and clusters describe that crop, not the whole material or mapped view. If a large atlas reports pixel-craft `unavailable`, obtain only the relevant bounded region. Select the existing `surface_pattern` from the approved reference and verified face ownership before proposing edits. Fragmentation hints never authorize blanket noise, denoising, repeated wear or deletion of intentional glints/dithering/alpha-mask marks.

## Correction Convergence
One visible cause owns one correction round. Reuse the latest atlas UUID, mapped-face state, mutation receipt, and fresh comparable capture when they already answer the next decision.

Do not repeat `list_textures`, `get_texture`, face-detail inspection, or mapped captures merely to reconfirm a successful paint mutation. Refresh only the evidence class made stale by the change or needed to detect a likely regression.

```text
FAIL
→ identify one texture-owned cause
→ one coherent patch/cohort mutation
→ affected mapped-surface verification
→ IMPROVED | UNCHANGED | REGRESSED
```
If verification reveals Geometry/UV ownership, stop Texturing correction and return the bounded defect upstream. Same texture-owned causal direction twice without new evidence → `BLOCKED`; do not produce a third palette/pattern variation as guesswork.

### Reference-Grounded Palette / Atlas-Island Discipline
Integer texels; **pixels per UV unit** owns detail scale. Build stepped hue/value ramps, contact shadows and highlights from observed form. Surface coordinates keep shading continuous across Cubes; UV edges do not invent seams. When Cubes intentionally reuse exactly the same UV texels, geometry-driven wear/cavity/contact/exposure signals must agree for every sharing face. Partial UV overlap or different face mappings sharing rasterized texels require Geometry/UV resolution before automatic face-derived shading; do not darken a shared atlas area to imitate independent surface illumination.
Unused atlas pixels stay transparent; opaque material does not authorize full-canvas fill. Paint mapped islands plus deliberate bounded padding only. Geometry-aware wear/cavity/contact/exposure color treatment must preserve the original alpha channel (including cutout/emissive masks) and skip fully transparent atlas pixels. Change alpha only under an explicit render/alpha-owned edit, not as a side effect of color styling.
Pixel art must read as deliberate clusters at normal model scale with Shading ON: distinct shadow/base/light masses, folds and identity accents. Barely visible noise or smooth formula variation is BASE_ONLY, never STYLED.

### Choosing a source-grounded surface pattern

Do not start with the name of a material and mechanically apply a preset. At a real source-based styling decision, inspect the actual approved image crop and write a concise `pattern_observation` describing **(1) cluster shapes and scale, (2) value placement, (3) detail-rich versus resting regions**, and, for a directional recipe, **(4) the observed motif direction**. Link the observation to an existing `reference_surfaces` source image ID, exact image SHA, region ID and part ID before claiming the selected `surface_pattern` is observed. Compare the actual source traits with the existing `surfacePattern` recipe description, including its anti-patterns. If multiple recipes are plausible, the source direction is hidden or the visual trait cannot be confirmed, do not manufacture evidence or paint a generic texture; keep the affected material selection `REVIEW_REQUIRED`. The treatment plan only checks caller-described evidence linkage and physical bounds—**not** artistic similarity, live UV-mapped success or user approval. Never force this reference-only route onto an explicitly requested, already specified numeric pixel edit.

## Texture Styling
generic palette; copied unrelated texture; flat rectangles/random high-contrast noise ≠ completion.
`BASE PASS → VALUE / FORM PASS → SURFACE PATTERN PASS → IDENTITY PASS → SECONDARY DETAIL PASS → RENDER / ALPHA VERIFY → VERIFY`.

### Render / PBR / Paint Safety
Namespaces: `render_profile`+`minecraft_material_code` | `pbr_texture_set` | `geometry_material_instance` | `surface_pattern`; `render_mode` preview-only.
cutout=`entity_alphatest`; translucent=`entity_alphablend`; emissive_mask=`entity_emissive`. Alpha follows render_profile; planar carrier silhouette stays alpha, not Cubes.
Variants preserve production base role + compatible dimensions/mapping; `normal XOR height`.
`authoring_status`; MERS=MER+`subsurface_value>0`.
`paint_settings`: `pixel_perfect`, `lock_alpha`, `paint_side_restrict`; Mirror after semantic symmetry.
Brush settings/presets affect native brushes, not exact-pixel transactions. Configure only the chosen executor; a transaction does not prove brush/plugin use.

## Coherent Styling Window / Anti-Micro-Loop
representative patch/cohort → cohort-wide; formula/gradient/color count is not quality evidence.
Finish an identity-critical patch and adjoining body surface pair before propagation. Compare landmarks, value clusters, pattern direction/scale and seams against the actual reference at matching scale. Generic bands cannot replace observed detail. This is internal verification, not a user gate.
**No evidence-per-micro-mutation loop.**
Preserve unaffected shading/identity during correction. Coordinate formulas execute observed designs, not invent them. Dark patches may be paint, occlusion or missing surfaces: diagnose the owner before repainting.

## Texture Verify
Reference + fresh `get_texture` + fresh **mapped model-view evidence** from `capture_model_views` → `FAIL | UNVERIFIED | PASS`.
Record capture view, front direction, Shading ON and artifact revision. Blockbench preview is not actual in-game lighting proof. Off/unknown shading cannot support final comparison.
Verify required hidden material surfaces.
`FAIL` → **smallest bounded causal correction** → one fresh affected evidence bundle → `IMPROVED | UNCHANGED | REGRESSED`; same causal direction twice → `BLOCKED`.
Never use stale exported PNG/bbmodel.

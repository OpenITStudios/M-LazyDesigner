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
